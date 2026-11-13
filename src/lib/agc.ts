/**
 * Real-time Auto-Gain Control (AGC) & Loudness Normalization Engine.
 *
 * Uses an AudioWorkletProcessor on the audio rendering thread for sample-accurate
 * RMS loudness tracking, noise-gating, smooth attack/release gain leveling, and
 * soft peak limiting before audio reaches MediaStreamAudioDestinationNode (recording)
 * and the monitor output.
 *
 * Automatically runs an AnalyserNode-based RMS gain driver while the worklet loads
 * or if AudioWorklet is unavailable in the browser environment.
 */

export type AgcMode = "worklet" | "analyser" | "bypass";

export type AgcTelemetry = {
  mode: AgcMode;
  gainDb: number;
  inputRms: number;
  enabled: boolean;
};

export type AudioGraph = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  preAnalyser: AnalyserNode;
  agcGain: GainNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  monitorGain: GainNode;
  streamDest: MediaStreamAudioDestinationNode;
  workletNode: AudioWorkletNode | null;
  agcEnabled: boolean;
  mode: AgcMode;
  currentGain: number;
  currentGainDb: number;
  inputRms: number;
  fallbackBuffer: Float32Array<ArrayBuffer>;
};

const TARGET_RMS = 0.21; // ~ -13.5 dBFS broadcast target loudness
const NOISE_GATE_RMS = 0.004; // ~ -48 dBFS (do not boost silence / dead air)
const MIN_GAIN = 0.25; // -12 dB max attenuation
const MAX_GAIN = 3.5; // +10.9 dB max boost

const AGC_WORKLET_SOURCE = `
class OutLawZAgcProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "enabled",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }

  constructor() {
    super();
    this.rmsSquared = 0.04;
    this.gain = 1.0;
    this.framesSinceReport = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const enabled = parameters.enabled[0] >= 0.5;
    const channelCount = Math.min(input.length, output.length);
    const frameCount = input[0].length;

    // 1. Compute block energy across active channels
    let blockSumSq = 0;
    for (let ch = 0; ch < channelCount; ch++) {
      const inCh = input[ch];
      for (let i = 0; i < frameCount; i++) {
        const s = inCh[i];
        blockSumSq += s * s;
      }
    }

    const meanSq = blockSumSq / Math.max(1, channelCount * frameCount);
    // ~250ms RMS smoothing window
    const rmsAlpha = Math.min(1, frameCount / (sampleRate * 0.25));
    this.rmsSquared = this.rmsSquared + rmsAlpha * (meanSq - this.rmsSquared);
    const rms = Math.sqrt(Math.max(0, this.rmsSquared));

    // 2. Compute target gain with noise gate
    let targetGain = 1.0;
    if (enabled) {
      if (rms > ${NOISE_GATE_RMS}) {
        targetGain = Math.max(${MIN_GAIN}, Math.min(${MAX_GAIN}, ${TARGET_RMS} / rms));
      } else {
        targetGain = 1.0;
      }
    }

    // 3. Asymmetric attack / release smoothing (fast ducking, slow natural recovery)
    const attackAlpha = Math.min(1, frameCount / (sampleRate * 0.035));
    const releaseAlpha = Math.min(1, frameCount / (sampleRate * 0.65));
    const coeff = targetGain < this.gain ? attackAlpha : releaseAlpha;

    const prevGain = this.gain;
    const nextGain = prevGain + coeff * (targetGain - prevGain);
    this.gain = nextGain;

    // 4. Apply interpolated gain & soft peak clipper to avoid harsh digital clipping
    const gainStep = (nextGain - prevGain) / Math.max(1, frameCount);
    for (let ch = 0; ch < channelCount; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      let g = prevGain;
      for (let i = 0; i < frameCount; i++) {
        g += gainStep;
        let sample = inCh[i] * g;
        // Soft knee limiter above 0.88
        const abs = sample < 0 ? -sample : sample;
        if (abs > 0.88) {
          const sign = sample < 0 ? -1 : 1;
          const excess = abs - 0.88;
          sample = sign * (0.88 + 0.1 * Math.tanh(excess / 0.1));
        }
        outCh[i] = sample;
      }
    }

    // 5. Post telemetry every ~120ms
    this.framesSinceReport += frameCount;
    if (this.framesSinceReport >= sampleRate * 0.12) {
      this.framesSinceReport = 0;
      const gainDb = 20 * Math.log10(Math.max(0.01, this.gain));
      this.port.postMessage({ gain: this.gain, gainDb, inputRms: rms });
    }

    return true;
  }
}

registerProcessor("outlawz-agc-processor", OutLawZAgcProcessor);
`;

let workletBlobUrl: string | null = null;
const initializedContexts = new WeakSet<AudioContext>();

function getWorkletBlobUrl(): string {
  if (!workletBlobUrl) {
    const blob = new Blob([AGC_WORKLET_SOURCE], { type: "application/javascript" });
    workletBlobUrl = URL.createObjectURL(blob);
  }
  return workletBlobUrl;
}

export function attachAudioGraph(
  audio: HTMLAudioElement,
  initialVolume: number,
  initialMuted: boolean,
  onReady?: (mode: AgcMode) => void,
): AudioGraph | null {
  const tagged = audio as HTMLAudioElement & { __graph?: AudioGraph };
  if (tagged.__graph) return tagged.__graph;

  const AudioCtx =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const source = ctx.createMediaElementSource(audio);

  // Pre-AGC analyser (used for AnalyserNode-based gain calculation / fallback)
  const preAnalyser = ctx.createAnalyser();
  preAnalyser.fftSize = 1024;

  // Gain stage driven by AnalyserNode fallback (unity 1.0 when AudioWorklet handles gain)
  const agcGain = ctx.createGain();
  agcGain.gain.value = 1.0;

  // Brickwall broadcast limiter right before recording destination & visual analyser
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -2.5;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.15;

  // Post-AGC visualizer analyser (256 frequency bins for rich multi-band movement)
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.54;

  // Dedicated monitor gain so user volume / mute never alters the recording pipeline
  const monitorGain = ctx.createGain();
  monitorGain.gain.value = initialMuted ? 0 : initialVolume;

  // Recording audio destination (receives normalized, pre-monitor-volume audio)
  const streamDest = ctx.createMediaStreamDestination();

  // Keep HTMLAudioElement at full unity gain so monitor volume/mute does not affect recording feed
  audio.volume = 1.0;
  audio.muted = false;

  // Wire synchronous fallback graph immediately:
  // source -> preAnalyser -> agcGain -> compressor -> analyser -> streamDest & monitorGain -> destination
  source.connect(preAnalyser);
  preAnalyser.connect(agcGain);
  agcGain.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(streamDest);
  analyser.connect(monitorGain);
  monitorGain.connect(ctx.destination);

  const graph: AudioGraph = {
    ctx,
    source,
    preAnalyser,
    agcGain,
    compressor,
    analyser,
    monitorGain,
    streamDest,
    workletNode: null,
    agcEnabled: true,
    mode: "analyser",
    currentGain: 1.0,
    currentGainDb: 0,
    inputRms: 0,
    fallbackBuffer: new Float32Array(new ArrayBuffer(preAnalyser.fftSize * 4)),
  };

  tagged.__graph = graph;

  // Upgrade to sample-accurate AudioWorkletNode if supported
  if (typeof AudioWorkletNode !== "undefined" && ctx.audioWorklet && !initializedContexts.has(ctx)) {
    initializedContexts.add(ctx);
    const url = getWorkletBlobUrl();
    ctx.audioWorklet
      .addModule(url)
      .then(() => {
        if (ctx.state === "closed") return;
        const workletNode = new AudioWorkletNode(ctx, "outlawz-agc-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });

        const enabledParam = workletNode.parameters.get("enabled");
        if (enabledParam) {
          enabledParam.value = graph.agcEnabled ? 1 : 0;
        }

        workletNode.port.onmessage = (ev: MessageEvent<{ gain: number; gainDb: number; inputRms: number }>) => {
          if (ev.data) {
            graph.currentGain = ev.data.gain;
            graph.currentGainDb = ev.data.gainDb;
            graph.inputRms = ev.data.inputRms;
          }
        };

        // Rewire preAnalyser -> workletNode -> agcGain (kept at 1.0)
        try {
          preAnalyser.disconnect(agcGain);
          preAnalyser.connect(workletNode);
          workletNode.connect(agcGain);
          agcGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.02);
          graph.workletNode = workletNode;
          graph.mode = graph.agcEnabled ? "worklet" : "bypass";
          onReady?.(graph.mode);
        } catch {
          // Keep analyser fallback if rewiring fails
          preAnalyser.connect(agcGain);
          onReady?.("analyser");
        }
      })
      .catch(() => {
        // Fallback to AnalyserNode-based AGC seamlessly
        onReady?.("analyser");
      });
  } else {
    onReady?.("analyser");
  }

  return graph;
}

/**
 * Updates AnalyserNode-based AGC gain when AudioWorklet is not driving gain.
 * Called inside the requestAnimationFrame loop while audio is live.
 */
export function stepAnalyserAgc(graph: AudioGraph, dt: number): void {
  if (graph.workletNode) return; // AudioWorklet handles gain directly on audio thread

  if (!graph.agcEnabled) {
    graph.mode = "bypass";
    graph.currentGain = 1.0;
    graph.currentGainDb = 0;
    graph.agcGain.gain.setTargetAtTime(1.0, graph.ctx.currentTime, 0.04);
    return;
  }

  graph.mode = "analyser";
  graph.preAnalyser.getFloatTimeDomainData(graph.fallbackBuffer);

  let sumSq = 0;
  const len = graph.fallbackBuffer.length;
  for (let i = 0; i < len; i++) {
    const s = graph.fallbackBuffer[i];
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, len));
  graph.inputRms = rms;

  let targetGain = 1.0;
  if (rms > NOISE_GATE_RMS) {
    targetGain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, TARGET_RMS / rms));
  }

  const timeConstant = targetGain < graph.currentGain ? 0.05 : 0.65;
  const alpha = Math.min(1, dt / timeConstant);
  graph.currentGain = graph.currentGain + alpha * (targetGain - graph.currentGain);
  graph.currentGainDb = 20 * Math.log10(Math.max(0.01, graph.currentGain));

  graph.agcGain.gain.setTargetAtTime(graph.currentGain, graph.ctx.currentTime, 0.03);
}

/**
 * Enable or bypass real-time Auto-Gain Control.
 */
export function setGraphAgcEnabled(graph: AudioGraph, enabled: boolean): void {
  graph.agcEnabled = enabled;
  if (graph.workletNode) {
    const param = graph.workletNode.parameters.get("enabled");
    if (param) {
      param.setValueAtTime(enabled ? 1 : 0, graph.ctx.currentTime);
    }
    graph.mode = enabled ? "worklet" : "bypass";
  } else {
    graph.mode = enabled ? "analyser" : "bypass";
    if (!enabled) {
      graph.currentGain = 1.0;
      graph.currentGainDb = 0;
      graph.agcGain.gain.setTargetAtTime(1.0, graph.ctx.currentTime, 0.03);
    }
  }
}

/**
 * Sets monitor speaker output gain without touching the recording stream gain.
 */
export function setGraphMonitorVolume(graph: AudioGraph, volume: number, muted: boolean): void {
  const target = muted ? 0 : Math.max(0, Math.min(1, volume));
  graph.monitorGain.gain.setTargetAtTime(target, graph.ctx.currentTime, 0.015);
}

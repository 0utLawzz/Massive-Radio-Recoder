/**
 * Real-Time Audio Stream BPM Detection & Rhythmic Beat-Sync Engine.
 *
 * Operates directly on the post-AGC AnalyserNode bass/kick frequency bins (~20–450 Hz)
 * at 60fps:
 * 1. Adaptive spectral-flux & local-mean peak thresholding isolates kick/bass onsets.
 * 2. Inter-Onset Interval (IOI) histogram clustering with octave folding (68–180 BPM)
 *    estimates steady tempo and lock confidence.
 * 3. Phase-locked rhythmic oscillator (`beatPhase` 0..1) and tempo-scaled envelope
 *    (`beatPulse` 0..1) synchronize visualizer bar animation scaling and speed directly
 *    to the detected BPM and bass/kick pulses.
 */

export type BpmState = {
  bpm: number | null;
  confidence: number;
  beatPhase: number;
  beatPulse: number;
  isBeat: boolean;
};

export class BpmDetector {
  private readonly historySize = 48; // ~0.8s @ 60fps rolling bass baseline
  private readonly energyHistory = new Float32Array(48);
  private historyIdx = 0;
  private historyFilled = 0;

  private prevBassEnergy = 0;
  private lastPeakMs = 0;
  private peakTimes: number[] = [];

  private smoothedBpm: number | null = null;
  private confidence = 0;
  private beatPhase = 0;
  private beatPulse = 0;

  reset(): void {
    this.energyHistory.fill(0);
    this.historyIdx = 0;
    this.historyFilled = 0;
    this.prevBassEnergy = 0;
    this.lastPeakMs = 0;
    this.peakTimes = [];
    this.smoothedBpm = null;
    this.confidence = 0;
    this.beatPhase = 0;
    this.beatPulse = 0;
  }

  /**
   * Process one animation frame of frequency bins (Uint8Array from AnalyserNode).
   * @param freqBins Post-AGC frequency spectrum (256 bins @ fftSize 512)
   * @param nowMs Current timestamp in milliseconds (e.g. performance.now())
   * @param dt Frame delta time in seconds
   */
  update(freqBins: Uint8Array, nowMs: number, dt: number): BpmState {
    // 1. Sub-bass & kick band energy (~0 - 450 Hz: bins 0..4 @ 48kHz / 512 FFT)
    const b0 = (freqBins[0] || 0) / 255;
    const b1 = (freqBins[1] || 0) / 255;
    const b2 = (freqBins[2] || 0) / 255;
    const b3 = (freqBins[3] || 0) / 255;
    const b4 = (freqBins[4] || 0) / 255;

    const bassEnergy = Math.min(1, b0 * 0.34 + b1 * 0.34 + b2 * 0.18 + b3 * 0.09 + b4 * 0.05);
    const flux = Math.max(0, bassEnergy - this.prevBassEnergy);
    this.prevBassEnergy = this.prevBassEnergy * 0.72 + bassEnergy * 0.28;

    // 2. Rolling local baseline & variance for adaptive kick threshold
    this.energyHistory[this.historyIdx] = bassEnergy;
    this.historyIdx = (this.historyIdx + 1) % this.historySize;
    if (this.historyFilled < this.historySize) this.historyFilled++;

    let sum = 0;
    for (let i = 0; i < this.historyFilled; i++) {
      sum += this.energyHistory[i];
    }
    const localMean = this.historyFilled > 0 ? sum / this.historyFilled : 0;

    let varSum = 0;
    for (let i = 0; i < this.historyFilled; i++) {
      const diff = this.energyHistory[i] - localMean;
      varSum += diff * diff;
    }
    const stdDev = Math.sqrt(varSum / Math.max(1, this.historyFilled));

    // Dynamic threshold adapts to quiet passages & heavy club drops alike
    const dynamicThreshold = Math.max(0.18, localMean * 1.18 + stdDev * 0.65);
    const minRefractoryMs = 280; // Caps instantaneous trigger rate <= ~214 BPM

    let isBeat = false;
    if (
      bassEnergy > dynamicThreshold &&
      (flux > 0.035 || bassEnergy > localMean + 0.14) &&
      nowMs - this.lastPeakMs >= minRefractoryMs
    ) {
      isBeat = true;
      this.lastPeakMs = nowMs;
      this.peakTimes.push(nowMs);

      // Keep recent 12s / max 24 kick onsets
      const cutoff = nowMs - 12000;
      while (this.peakTimes.length > 0 && (this.peakTimes[0] < cutoff || this.peakTimes.length > 24)) {
        this.peakTimes.shift();
      }

      // Snap beat phase toward downbeat 0 on strong kick onset
      this.beatPhase = 0;
      this.estimateTempo();
    }

    // Drop tempo lock cleanly if signal goes silent for > 3.5s
    if (nowMs - this.lastPeakMs > 3500 && localMean < 0.04) {
      this.smoothedBpm = null;
      this.confidence = 0;
      this.peakTimes = [];
    }

    // 3. Advance phase-locked rhythmic clock at detected BPM (defaults to 120 BPM before lock)
    const activeBpm = this.smoothedBpm ?? 120;
    const beatsPerSec = activeBpm / 60;
    if (!isBeat) {
      this.beatPhase = (this.beatPhase + dt * beatsPerSec) % 1;
    }

    // 4. Tempo-scaled beatPulse decay: faster BPM decays snappier, slower BPM sustains longer
    const tempoRatio = activeBpm / 120; // 1.0 @ 120 BPM, 1.4 @ 168 BPM, 0.7 @ 84 BPM
    const decayBase = Math.pow(0.012, dt * tempoRatio);
    const onsetImpulse = isBeat ? Math.min(1, 0.72 + bassEnergy * 0.35 + flux * 1.6) : 0;
    const rhythmicWave = this.smoothedBpm ? Math.pow(Math.max(0, 1 - this.beatPhase * 1.6), 2) * 0.42 * this.confidence : 0;
    const sustainBass = Math.max(0, bassEnergy - 0.3) * 1.1;

    this.beatPulse = Math.min(1, Math.max(onsetImpulse, sustainBass, rhythmicWave, this.beatPulse * decayBase));

    return {
      bpm: this.smoothedBpm !== null ? Math.round(this.smoothedBpm) : null,
      confidence: this.confidence,
      beatPhase: this.beatPhase,
      beatPulse: this.beatPulse,
      isBeat,
    };
  }

  private estimateTempo(): void {
    const n = this.peakTimes.length;
    if (n < 4) return;

    // Build weighted IOI histogram across consecutive and 2-step kick pairs (68 - 180 BPM)
    const minBpm = 68;
    const maxBpm = 180;
    const bucketCount = maxBpm - minBpm + 1;
    const votes = new Float32Array(bucketCount);

    for (let i = 1; i < n; i++) {
      const recencyWeight = 0.45 + (i / n) * 0.85;
      for (let step = 1; step <= 2 && i - step >= 0; step++) {
        const dtMs = this.peakTimes[i] - this.peakTimes[i - step];
        if (dtMs <= 180 || dtMs > 4000) continue;

        let candidateBpm = 60000 / dtMs;
        // Fold half/double-time octaves into primary musical range [68, 180]
        while (candidateBpm < minBpm) candidateBpm *= 2;
        while (candidateBpm > maxBpm) candidateBpm *= 0.5;

        const centerIdx = Math.round(candidateBpm) - minBpm;
        const stepWeight = step === 1 ? 1.0 : 0.55;
        const w = recencyWeight * stepWeight;

        // Soft Gaussian kernel (+/- 2 BPM spread) to merge slight timing jitter
        for (let offset = -2; offset <= 2; offset++) {
          const idx = centerIdx + offset;
          if (idx >= 0 && idx < bucketCount) {
            const kernel = offset === 0 ? 1.0 : Math.abs(offset) === 1 ? 0.65 : 0.25;
            votes[idx] += w * kernel;
          }
        }
      }
    }

    let bestIdx = 0;
    let bestScore = 0;
    let totalScore = 0;
    for (let i = 0; i < bucketCount; i++) {
      totalScore += votes[i];
      if (votes[i] > bestScore) {
        bestScore = votes[i];
        bestIdx = i;
      }
    }

    if (bestScore <= 0 || totalScore <= 0) return;

    const detectedBpm = minBpm + bestIdx;
    this.confidence = Math.min(1, (bestScore / totalScore) * 3.2);

    if (this.smoothedBpm === null) {
      this.smoothedBpm = detectedBpm;
    } else if (Math.abs(detectedBpm - this.smoothedBpm) > 22 && this.confidence > 0.55) {
      // Rapidly track genuine tempo changes between tracks
      this.smoothedBpm = this.smoothedBpm * 0.45 + detectedBpm * 0.55;
    } else {
      // Smooth minor tempo jitter
      this.smoothedBpm = this.smoothedBpm * 0.82 + detectedBpm * 0.18;
    }
  }
}

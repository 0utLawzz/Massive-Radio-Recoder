import { useEffect, useRef, useState, useId } from "react";
import {
  Download,
  Headphones,
  Play,
  Pause,
  Trash2,
  Radio,
  Flame,
  Volume2,
  VolumeX,
  Disc,
  Clock,
  Activity,
  Layers,
  Terminal as TerminalIcon,
  Plus,
  Gauge,
  Wifi,
} from "lucide-react";
import { canPickSaveFile, pickSaveFile, startCapture, type CaptureReason } from "@/lib/capture";
import { downloadBlob, formatBytes, formatDuration, recordingName } from "@/lib/format";
import { deleteTake, getTakeBlob, listTakes, saveTake, type TakeMeta, type TrackMark } from "@/lib/library";
import { fetchNowPlaying, STATIONS, type Station } from "@/lib/stations";

export type BattlestationTheme = "gold" | "cyan" | "purple";

const LIMITS = [
  { id: "off", label: "Manual", ms: null },
  { id: "15", label: "15m", ms: 15 * 60 * 1000 },
  { id: "30", label: "30m", ms: 30 * 60 * 1000 },
  { id: "60", label: "1h", ms: 60 * 60 * 1000 },
  { id: "120", label: "2h", ms: 120 * 60 * 1000 },
] as const;

type LimitId = (typeof LIMITS)[number]["id"];

type PendingTake = {
  id: string;
  stationId: string;
  stationName: string;
  startedAt: number;
  endedAt: number;
  bytes: number;
  tracks: TrackMark[];
  reason: Exclude<CaptureReason, "error">;
  blob: Blob | null;
  fileSaved: boolean;
  kept: boolean;
  downloaded: boolean;
};

type Graph = {
  ctx: AudioContext;
  analyser: AnalyserNode;
};

type VisualizerMode = "spectrum" | "oscilloscope" | "reactor";

// Cyber Audio Synthesizer (Subtle futuristic tactile feedback)
function playCyberSfx(type: "click" | "arm" | "rec" | "stop") {
  try {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "click") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.04);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
    } else if (type === "arm") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.start(now);
      osc.stop(now + 0.09);
    } else if (type === "rec") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.setValueAtTime(900, now + 0.06);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === "stop") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(250, now + 0.09);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
    setTimeout(() => {
      ctx.close().catch(() => undefined);
    }, 200);
  } catch {
    // AudioContext blocked or unsupported
  }
}

function attachAnalyser(audio: HTMLAudioElement): Graph | null {
  const tagged = audio as HTMLAudioElement & { __graph?: Graph };
  if (tagged.__graph) return tagged.__graph;
  const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  const ctx = new AudioCtx();
  const source = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  const graph = { ctx, analyser };
  tagged.__graph = graph;
  return graph;
}

export function Deck() {
  const volumeSliderId = useId();
  const [theme, setTheme] = useState<BattlestationTheme>("gold");
  const [stationsList, setStationsList] = useState<Station[]>(STATIONS);
  const [stationId, setStationId] = useState<string>(STATIONS[0].id);
  const station = stationsList.find((item) => item.id === stationId) ?? stationsList[0];

  const [monitor, setMonitor] = useState(true);
  const [limitId, setLimitId] = useState<LimitId>("off");
  const [saveDirect, setSaveDirect] = useState(false);
  const [canDirect, setCanDirect] = useState(false);
  const [soundFx, setSoundFx] = useState(true);

  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [arming, setArming] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [clock, setClock] = useState(0);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [trackLog, setTrackLog] = useState<TrackMark[]>([]);
  const [pending, setPending] = useState<PendingTake | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Audio analysis telemetry
  const [peakDb, setPeakDb] = useState("-∞");
  const [bassLevel, setBassLevel] = useState(0.2);
  const [midLevel, setMidLevel] = useState(0.2);
  const [trebleLevel, setTrebleLevel] = useState(0.2);
  const [vizMode, setVizMode] = useState<VisualizerMode>("spectrum");

  // Custom station modal
  const [showCustomStation, setShowCustomStation] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");

  // Terminal telemetry logs
  const [sysLogs, setSysLogs] = useState<string[]>([
    "INITIALIZING OUTLAWZ HUD // BATTMOD V3.8",
    "AUDIO ANALYZER MATRIX READY",
    "SECURE ICECAST DECODER STANDBY",
  ]);

  // Saved tapes state
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const libraryAudioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<{ stop: () => void } | null>(null);
  const volumeRef = useRef(0.9);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const preMuteVolume = useRef(0.9);

  const tracksRef = useRef<TrackMark[]>([]);
  const nowPlayingRef = useRef<string | null>(null);
  const stationRef = useRef(station);
  const startedRef = useRef(0);
  const recordingRef = useRef(false);
  const libraryUrl = useRef<string | null>(null);
  const playingUrlTake = useRef<string | null>(null);

  const appendLog = (msg: string) => {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setSysLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 9)]);
  };

  useEffect(() => {
    stationRef.current = station;
  }, [station]);

  useEffect(() => {
    setCanDirect(canPickSaveFile());
  }, []);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
    };
  }, []);

  // Poll now playing
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const title = await fetchNowPlaying(stationRef.current.statusUrl);
        if (!alive) return;
        setNowPlaying(title);
        nowPlayingRef.current = title;
        if (recordingRef.current && title) {
          const list = tracksRef.current;
          const last = list[list.length - 1];
          if (!last || last.title !== title) {
            const mark = { t: Math.max(0, Date.now() - startedRef.current), title };
            list.push(mark);
            setTrackLog([...list]);
            appendLog(`TRACK_DETECTED: ${title}`);
          }
        }
      } catch {
        if (alive) {
          setNowPlaying(null);
          nowPlayingRef.current = null;
        }
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [stationId]);

  // Recording Clock
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [recording]);

  // Unload warning when recording
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (recordingRef.current || (pending && !pending.fileSaved && !pending.kept && !pending.downloaded)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [pending]);

  // List saved takes
  useEffect(() => {
    let alive = true;
    void listTakes()
      .then((rows) => {
        if (alive) setTakes(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Canvas Visualizer Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    let frame = 0;
    const freqBins = new Uint8Array(128);
    const timeDomainBins = new Uint8Array(128);

    const themeColors = {
      gold: {
        primary: "#ffb01f",
        accent: "#ffd447",
        glow: "rgba(255, 176, 31, 0.4)",
        grid: "rgba(255, 176, 31, 0.15)",
        dark: "#141108",
      },
      cyan: {
        primary: "#00f0ff",
        accent: "#39ff14",
        glow: "rgba(0, 240, 255, 0.4)",
        grid: "rgba(0, 240, 255, 0.15)",
        dark: "#05131c",
      },
      purple: {
        primary: "#c026d3",
        accent: "#00ff88",
        glow: "rgba(192, 38, 211, 0.4)",
        grid: "rgba(192, 38, 211, 0.15)",
        dark: "#160924",
      },
    }[theme];

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx2d.clearRect(0, 0, width, height);

      const isLive = Boolean(audio && !audio.paused && audio.src);
      let graph: Graph | null = null;
      if (isLive && audio) {
        graph = attachAnalyser(audio);
        if (graph?.ctx.state === "suspended") void graph.ctx.resume();
      }

      if (graph && isLive) {
        graph.analyser.getByteFrequencyData(freqBins);
        graph.analyser.getByteTimeDomainData(timeDomainBins);

        // Telemetry calculation
        let sum = 0;
        let bSum = 0;
        let mSum = 0;
        let tSum = 0;
        for (let i = 0; i < 40; i++) {
          sum += freqBins[i] || 0;
          if (i < 8) bSum += freqBins[i] || 0;
          else if (i < 24) mSum += freqBins[i] || 0;
          else tSum += freqBins[i] || 0;
        }
        const _avg = sum / 40;
        const bAvg = bSum / 8;
        const mAvg = mSum / 16;
        const tAvg = tSum / 16;

        setBassLevel(Math.min(1, bAvg / 255));
        setMidLevel(Math.min(1, mAvg / 255));
        setTrebleLevel(Math.min(1, tAvg / 255));

        const peak = Math.max(...freqBins);
        if (peak > 0) {
          const db = Math.round(20 * Math.log10(peak / 255));
          setPeakDb(`${db} dBFS`);
        } else {
          setPeakDb("-∞");
        }

        // Render Mode 1: Multi-band Spectrum Equalizer
        if (vizMode === "spectrum") {
          const barCount = 36;
          const barWidth = width / barCount - 2;
          const half = Math.floor(barCount / 2);

          for (let i = 0; i < barCount; i++) {
            const dist = Math.abs(i - (barCount - 1) / 2);
            const norm = half > 0 ? dist / half : 0;
            const binIdx = Math.min(freqBins.length - 1, Math.floor(norm * (freqBins.length * 0.75)));
            const val = freqBins[binIdx] / 255;
            const barH = Math.max(4, val * (height * 0.88));
            const x = i * (barWidth + 2);
            const y = height - barH;

            // Gradient bar
            const grad = ctx2d.createLinearGradient(0, height, 0, y);
            grad.addColorStop(0, themeColors.primary);
            grad.addColorStop(0.7, themeColors.accent);
            grad.addColorStop(1, "#ff3b5c");

            ctx2d.fillStyle = grad;
            ctx2d.fillRect(x, y, barWidth, barH);

            // Floating peak marker
            ctx2d.fillStyle = "#ffffff";
            ctx2d.fillRect(x, Math.max(0, y - 3), barWidth, 1.5);
          }
        }
        // Render Mode 2: Cyber Oscilloscope Waveform
        else if (vizMode === "oscilloscope") {
          ctx2d.lineWidth = 2.5;
          ctx2d.strokeStyle = themeColors.primary;
          ctx2d.shadowColor = themeColors.accent;
          ctx2d.shadowBlur = 10;
          ctx2d.beginPath();

          const sliceWidth = width / timeDomainBins.length;
          let x = 0;
          for (let i = 0; i < timeDomainBins.length; i++) {
            const v = timeDomainBins[i] / 128.0;
            const y = (v * height) / 2;
            if (i === 0) ctx2d.moveTo(x, y);
            else ctx2d.lineTo(x, y);
            x += sliceWidth;
          }
          ctx2d.stroke();
          ctx2d.shadowBlur = 0;
        }
        // Render Mode 3: Cyber Reactor Radar
        else if (vizMode === "reactor") {
          const cx = width / 2;
          const cy = height / 2;
          const maxR = Math.min(cx, cy) - 8;

          // Background concentric target rings
          ctx2d.strokeStyle = themeColors.grid;
          ctx2d.lineWidth = 1;
          for (let r = maxR * 0.25; r <= maxR; r += maxR * 0.25) {
            ctx2d.beginPath();
            ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
            ctx2d.stroke();
          }

          // Dynamic radial energy spikes
          const points = 48;
          ctx2d.strokeStyle = themeColors.primary;
          ctx2d.lineWidth = 2;
          ctx2d.beginPath();
          for (let i = 0; i < points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const binVal = freqBins[i % 32] / 255;
            const r = maxR * 0.4 + binVal * (maxR * 0.6);
            const px = cx + Math.cos(angle) * r;
            const py = cy + Math.sin(angle) * r;
            if (i === 0) ctx2d.moveTo(px, py);
            else ctx2d.lineTo(px, py);
          }
          ctx2d.closePath();
          ctx2d.stroke();
        }
      } else {
        // Idle animation: subtle breathing cyber pulse
        const time = Date.now() * 0.002;
        ctx2d.strokeStyle = themeColors.grid;
        ctx2d.lineWidth = 1.5;
        ctx2d.beginPath();
        for (let x = 0; x < width; x += 4) {
          const y = height / 2 + Math.sin(x * 0.03 + time) * 6;
          if (x === 0) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
      }

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, [theme, vizMode]);

  const elapsed = recording && startedAt ? Math.max(0, (clock || startedAt) - startedAt) : 0;
  const limit = LIMITS.find((item) => item.id === limitId) ?? LIMITS[0];
  const remaining = limit.ms ? Math.max(0, limit.ms - elapsed) : null;
  const blocked = Boolean(pending && !pending.fileSaved);

  function stopMonitor() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setListening(false);
    appendLog("MONITOR_OFFLINE");
  }

  function stopLibraryPlayback() {
    const audio = libraryAudioRef.current;
    if (libraryUrl.current) {
      URL.revokeObjectURL(libraryUrl.current);
      libraryUrl.current = null;
    }
    playingUrlTake.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    setPlayingId(null);
  }

  async function startMonitor(next: Station) {
    const audio = audioRef.current;
    if (!audio) return;
    stopLibraryPlayback();
    audio.crossOrigin = "anonymous";
    audio.volume = isMuted ? 0 : volumeRef.current;
    if (audio.src !== next.streamUrl) audio.src = next.streamUrl;
    const graph = attachAnalyser(audio);
    if (graph?.ctx.state === "suspended") await graph.ctx.resume();
    await audio.play();
    setListening(true);
    appendLog(`MONITOR_STREAMING: ${next.name}`);
  }

  async function onListen() {
    setError(null);
    if (soundFx) playCyberSfx("click");
    if (listening) {
      stopMonitor();
      return;
    }
    try {
      await startMonitor(station);
    } catch {
      setError("Playback blocked. Tap Listen again, or check stream availability.");
      setListening(false);
    }
  }

  async function onRecord() {
    if (captureRef.current) {
      if (soundFx) playCyberSfx("stop");
      captureRef.current.stop();
      appendLog("CAPTURE_STOP_REQUESTED");
      return;
    }
    if (blocked || arming) return;
    setError(null);
    setNotice(null);
    if (soundFx) playCyberSfx("arm");

    const current = stationRef.current;
    const chosenLimit = LIMITS.find((item) => item.id === limitId) ?? LIMITS[0];
    let file: Awaited<ReturnType<typeof pickSaveFile>> | null = null;

    if (saveDirect) {
      setArming(true);
      try {
        file = await pickSaveFile(recordingName(current.name));
        appendLog(`DIRECT_SINK_ARMED: ${recordingName(current.name)}`);
      } catch (err) {
        setArming(false);
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Couldn't open target file.");
        return;
      }
      setArming(false);
    }

    if (monitor) {
      try {
        await startMonitor(current);
      } catch {
        setNotice("Capturing stream in silent background mode.");
      }
    }

    tracksRef.current = [];
    if (nowPlayingRef.current) {
      tracksRef.current = [{ t: 0, title: nowPlayingRef.current }];
    }
    setTrackLog([...tracksRef.current]);
    const begun = Date.now();
    startedRef.current = begun;
    recordingRef.current = true;
    setStartedAt(begun);
    setClock(begun);
    setBytes(0);
    setRecording(true);
    if (soundFx) playCyberSfx("rec");
    appendLog(`RECORDING_ENGAGED: ${current.name}`);

    const capture = startCapture({
      url: current.streamUrl,
      file,
      limitMs: chosenLimit.ms,
      onBytes: (nextBytes) => setBytes(nextBytes),
    });
    captureRef.current = { stop: capture.stop };
    const result = await capture.promise;
    captureRef.current = null;
    recordingRef.current = false;
    setRecording(false);
    appendLog(`CAPTURE_COMPLETE: ${formatBytes(result.bytes)}`);

    if (result.bytes === 0) {
      setError(result.error ?? "No stream data was captured. Ensure stream is online.");
      return;
    }

    const finished: PendingTake = {
      id: crypto.randomUUID(),
      stationId: current.id,
      stationName: current.name,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      bytes: result.bytes,
      tracks: [...tracksRef.current],
      reason: result.reason === "error" ? "stopped" : result.reason,
      blob: file ? null : new Blob(result.chunks.map((chunk) => chunk.buffer as ArrayBuffer), { type: "audio/mpeg" }),
      fileSaved: Boolean(file),
      kept: false,
      downloaded: Boolean(file),
    };
    setPending(finished);
    if (result.reason === "dropped") {
      setNotice("Live stream concluded early. Captured take is preserved.");
    }
  }

  async function onKeep() {
    if (!pending?.blob || pending.kept) return;
    setError(null);
    if (soundFx) playCyberSfx("click");
    try {
      const meta: TakeMeta = {
        id: pending.id,
        stationId: pending.stationId,
        stationName: pending.stationName,
        startedAt: pending.startedAt,
        endedAt: pending.endedAt,
        bytes: pending.bytes,
        tracks: pending.tracks,
      };
      await saveTake(meta, pending.blob);
      setPending({ ...pending, kept: true });
      setTakes(await listTakes());
      appendLog(`TAPE_ARCHIVED: ${meta.stationName}`);
    } catch {
      setError("Local storage full for in-browser tapes. Use 'Save MP3' directly.");
    }
  }

  function onDownload() {
    if (!pending?.blob) return;
    if (soundFx) playCyberSfx("click");
    downloadBlob(pending.blob, recordingName(pending.stationName, new Date(pending.startedAt)));
    setPending({ ...pending, downloaded: true });
    appendLog(`MP3_EXPORTED: ${pending.stationName}`);
  }

  function onCueSheet() {
    if (!pending) return;
    if (soundFx) playCyberSfx("click");
    const lines = [
      `=== OUTLAWZ CYBER RECORDING LOG ===`,
      `Station: ${pending.stationName}`,
      `Captured: ${new Date(pending.startedAt).toLocaleString()}`,
      `Duration: ${formatDuration(pending.endedAt - pending.startedAt)}`,
      `Size: ${formatBytes(pending.bytes)}`,
      "",
      `TRACK MARKS:`,
      ...(pending.tracks.length
        ? pending.tracks.map((mark) => `${formatDuration(mark.t)}  [TRACK] ${mark.title}`)
        : ["No metadata marks announced during stream."]),
    ];
    downloadBlob(
      new Blob([lines.join("\n")], { type: "text/plain" }),
      recordingName(pending.stationName, new Date(pending.startedAt), "txt"),
    );
  }

  async function onPlayTake(meta: TakeMeta) {
    if (soundFx) playCyberSfx("click");
    if (playingId === meta.id) {
      stopLibraryPlayback();
      return;
    }
    setError(null);
    setBusyId(meta.id);
    try {
      stopMonitor();
      const blob = await getTakeBlob(meta.id);
      if (!blob) {
        setError("Tape file unavailable in local cache.");
        return;
      }
      stopLibraryPlayback();
      const url = URL.createObjectURL(blob);
      libraryUrl.current = url;
      playingUrlTake.current = meta.id;
      const audio = libraryAudioRef.current;
      if (!audio) return;
      audio.src = url;
      audio.volume = isMuted ? 0 : volumeRef.current;
      await audio.play();
      setPlayingId(meta.id);
      appendLog(`PLAYBACK_TAPE: ${meta.stationName}`);
    } catch {
      setError("Tape playback error.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDownloadTake(meta: TakeMeta) {
    if (soundFx) playCyberSfx("click");
    setBusyId(meta.id);
    try {
      const blob = await getTakeBlob(meta.id);
      if (!blob) {
        setError("Tape not found.");
        return;
      }
      downloadBlob(blob, recordingName(meta.stationName, new Date(meta.startedAt)));
    } finally {
      setBusyId(null);
    }
  }

  async function onDeleteTake(id: string) {
    if (soundFx) playCyberSfx("stop");
    if (playingId === id) stopLibraryPlayback();
    await deleteTake(id);
    setConfirmId(null);
    setTakes(await listTakes());
    appendLog("TAPE_PURGED_FROM_VAULT");
  }

  function onVolume(next: number) {
    volumeRef.current = next;
    setVolume(next);
    if (isMuted && next > 0) setIsMuted(false);
    if (audioRef.current) audioRef.current.volume = next;
    if (libraryAudioRef.current) libraryAudioRef.current.volume = next;
  }

  function toggleMute() {
    if (soundFx) playCyberSfx("click");
    if (isMuted) {
      setIsMuted(false);
      onVolume(preMuteVolume.current);
    } else {
      preMuteVolume.current = volume;
      setIsMuted(true);
      if (audioRef.current) audioRef.current.volume = 0;
      if (libraryAudioRef.current) libraryAudioRef.current.volume = 0;
    }
  }

  function addCustomStation() {
    if (!customName.trim() || !customUrl.trim()) return;
    const newStation: Station = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      tagline: "Custom OutLawZ Feed",
      streamUrl: customUrl.trim(),
      statusUrl: "",
      bitrate: 192,
    };
    setStationsList((prev) => [...prev, newStation]);
    setStationId(newStation.id);
    setShowCustomStation(false);
    setCustomName("");
    setCustomUrl("");
    appendLog(`CUSTOM_FEED_CONFIGURED: ${newStation.name}`);
  }

  // Visual Palette dynamic mappings based on Battlestation Theme
  const themeClasses = {
    gold: {
      accentText: "text-[#ffb01f]",
      accentBg: "bg-[#ffb01f]",
      accentBorder: "border-[#ffb01f]",
      glowBorder: "border-[#ffb01f]/50 hover:border-[#ffb01f]",
      ringColor: "ring-[#ffb01f]",
      badgeBg: "bg-[#ffb01f]/10 text-[#ffb01f] border-[#ffb01f]/30",
      hudGlow: "shadow-[0_0_20px_rgba(255,176,31,0.25)]",
      panelBg: "bg-[#0d0e12]/90 border-[#2a2417]",
      subPanelBg: "bg-[#15171e]/70 border-[#382d1b]",
      recBg: "bg-[#ff2a51]",
      hex: "#ffb01f",
    },
    cyan: {
      accentText: "text-[#00f0ff]",
      accentBg: "bg-[#00f0ff]",
      accentBorder: "border-[#00f0ff]",
      glowBorder: "border-[#00f0ff]/50 hover:border-[#00f0ff]",
      ringColor: "ring-[#00f0ff]",
      badgeBg: "bg-[#00f0ff]/10 text-[#00f0ff] border-[#00f0ff]/30",
      hudGlow: "shadow-[0_0_20px_rgba(0,240,255,0.25)]",
      panelBg: "bg-[#040e17]/90 border-[#00384d]",
      subPanelBg: "bg-[#081a29]/70 border-[#004f6e]",
      recBg: "bg-[#ff2a51]",
      hex: "#00f0ff",
    },
    purple: {
      accentText: "text-[#c026d3]",
      accentBg: "bg-[#c026d3]",
      accentBorder: "border-[#c026d3]",
      glowBorder: "border-[#c026d3]/50 hover:border-[#c026d3]",
      ringColor: "ring-[#c026d3]",
      badgeBg: "bg-[#c026d3]/10 text-[#c026d3] border-[#c026d3]/30",
      hudGlow: "shadow-[0_0_20px_rgba(192,38,211,0.25)]",
      panelBg: "bg-[#0c0617]/90 border-[#38114f]",
      subPanelBg: "bg-[#180e2b]/70 border-[#501a6f]",
      recBg: "bg-[#ff2a51]",
      hex: "#c026d3",
    },
  }[theme];

  return (
    <div className="flex flex-col gap-5 text-fg font-sans cyber-grid-bg" suppressHydrationWarning>
      {/* HUD Top Control Bar */}
      <header className={`rounded-xl border p-4 sm:p-5 backdrop-blur-md ${themeClasses.panelBg} ${themeClasses.hudGlow}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* OutLawZ Logo with Glowing Emblem */}
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/80 shadow-inner">
              {/* Spinning Cybernetic Rings */}
              <div
                className={`absolute inset-0 rounded-xl border border-dashed ${themeClasses.accentBorder} opacity-40 animate-cyber-radar`}
              />
              <div
                className="absolute h-9 w-9 rounded-full border border-current opacity-30 animate-pulse"
                style={{ color: themeClasses.hex, transform: `scale(${1 + bassLevel * 0.4})` }}
              />
              <Flame className={`h-7 w-7 ${themeClasses.accentText} drop-shadow-[0_0_8px_currentColor]`} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className={`font-orbitron text-xl sm:text-2xl font-black tracking-wider ${themeClasses.accentText} drop-shadow-[0_0_12px_currentColor]`}>
                  OutLawZ
                </span>
                <span className="text-[10px] font-tech text-white/50 tracking-widest border border-white/20 px-1.5 py-0.5 rounded">
                  ™ BE THE NAME
                </span>
              </div>
              <p className="font-tech text-xs tracking-wider text-muted mt-0.5 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>CYBER HUD // AUDIO CAPTURE CORE</span>
                <span className="text-white/30 hidden sm:inline">|</span>
                <span className="text-white/60 hidden sm:inline">{station.name}</span>
              </p>
            </div>
          </div>

          {/* Theme Switcher & SFX */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-tech">
            <span className="text-muted mr-1">THEME:</span>
            <button
              type="button"
              onClick={() => {
                setTheme("gold");
                if (soundFx) playCyberSfx("click");
              }}
              className={`px-2.5 py-1.5 rounded border transition-all flex items-center gap-1.5 ${
                theme === "gold"
                  ? "bg-[#ffb01f] text-black font-bold border-[#ffb01f] shadow-[0_0_10px_rgba(255,176,31,0.5)]"
                  : "bg-black/40 text-[#ffb01f] border-[#ffb01f]/30 hover:border-[#ffb01f]"
              }`}
              suppressHydrationWarning
            >
              <span className="h-2 w-2 rounded-full bg-[#ffb01f]" />
              AMBER
            </button>
            <button
              type="button"
              onClick={() => {
                setTheme("cyan");
                if (soundFx) playCyberSfx("click");
              }}
              className={`px-2.5 py-1.5 rounded border transition-all flex items-center gap-1.5 ${
                theme === "cyan"
                  ? "bg-[#00f0ff] text-black font-bold border-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.5)]"
                  : "bg-black/40 text-[#00f0ff] border-[#00f0ff]/30 hover:border-[#00f0ff]"
              }`}
              suppressHydrationWarning
            >
              <span className="h-2 w-2 rounded-full bg-[#00f0ff]" />
              CYAN
            </button>
            <button
              type="button"
              onClick={() => {
                setTheme("purple");
                if (soundFx) playCyberSfx("click");
              }}
              className={`px-2.5 py-1.5 rounded border transition-all flex items-center gap-1.5 ${
                theme === "purple"
                  ? "bg-[#c026d3] text-white font-bold border-[#c026d3] shadow-[0_0_10px_rgba(192,38,211,0.5)]"
                  : "bg-black/40 text-[#c026d3] border-[#c026d3]/30 hover:border-[#c026d3]"
              }`}
              suppressHydrationWarning
            >
              <span className="h-2 w-2 rounded-full bg-[#c026d3]" />
              RGB PURPLE
            </button>

            {/* Sound FX toggle */}
            <button
              type="button"
              onClick={() => setSoundFx(!soundFx)}
              className={`ml-1 px-2 py-1.5 rounded border text-xs transition-colors ${
                soundFx ? "border-emerald-500/40 text-emerald-400 bg-emerald-950/20" : "border-white/10 text-muted"
              }`}
              title="Cyber HUD Tactical Audio Beeps"
              suppressHydrationWarning
            >
              SFX {soundFx ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </header>

      {/* Station Selector Bar */}
      <section className={`rounded-xl border p-3.5 backdrop-blur-md ${themeClasses.panelBg}`} suppressHydrationWarning>
        <div className="flex items-center justify-between mb-2.5 px-1">
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${themeClasses.accentText}`} />
            <span className="font-tech text-xs tracking-widest uppercase text-muted">TRANSMISSION FREQUENCIES</span>
          </div>
          <button
            type="button"
            onClick={() => setShowCustomStation(!showCustomStation)}
            className={`font-tech text-xs inline-flex items-center gap-1 border px-2 py-1 rounded transition-colors ${themeClasses.badgeBg}`}
            suppressHydrationWarning
          >
            <Plus className="h-3 w-3" />
            <span>CUSTOM FEED</span>
          </button>
        </div>

        {/* Custom Station Drawer */}
        {showCustomStation && (
          <div className="mb-3 p-3.5 rounded-lg border border-white/10 bg-black/60 font-tech text-xs flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Station Name (e.g. Cyberpunk FM)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="bg-black/80 border border-white/20 rounded px-3 py-1.5 text-fg flex-1 focus:border-cyan outline-none"
              suppressHydrationWarning
            />
            <input
              type="url"
              placeholder="Stream URL (http://...)"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="bg-black/80 border border-white/20 rounded px-3 py-1.5 text-fg flex-2 focus:border-cyan outline-none font-mono text-[11px]"
              suppressHydrationWarning
            />
            <button
              type="button"
              onClick={addCustomStation}
              className={`px-3 py-1.5 rounded font-bold ${themeClasses.accentBg} text-black shrink-0`}
              suppressHydrationWarning
            >
              LOCK IN FEED
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stationsList.map((item) => {
            const selected = item.id === station.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={recording || arming}
                aria-pressed={selected}
                onClick={() => {
                  if (item.id === station.id) return;
                  if (soundFx) playCyberSfx("click");
                  setStationId(item.id);
                  setNowPlaying(null);
                  nowPlayingRef.current = null;
                  if (listening) {
                    stopMonitor();
                    void startMonitor(item).catch(() => {
                      setError("Could not reconnect live audio monitor.");
                    });
                  }
                  appendLog(`CHANNEL_SWITCHED: ${item.name}`);
                }}
                className={`relative rounded-lg border px-3 py-2.5 text-left transition-all duration-200 disabled:opacity-50 ${
                  selected
                    ? `${themeClasses.accentBorder} bg-black/60 shadow-[0_0_15px_rgba(255,255,255,0.08)] ring-1 ${themeClasses.ringColor}`
                    : "border-white/10 bg-black/40 hover:border-white/30"
                }`}
                suppressHydrationWarning
              >
                <div className="flex items-center justify-between">
                  <span className={`block font-orbitron text-sm font-bold truncate ${selected ? themeClasses.accentText : "text-white/80"}`}>
                    {item.name}
                  </span>
                  {selected && <span className={`h-1.5 w-1.5 rounded-full ${themeClasses.accentBg} animate-ping`} />}
                </div>
                <span className="mt-1 block text-xs text-muted truncate font-tech">{item.tagline}</span>
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-tech text-white/40">
                  <Wifi className="h-2.5 w-2.5 text-emerald-400" />
                  <span>{item.bitrate} KBPS</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main HUD Deck: Visualizer & Master Deck Controls */}
      <section className={`rounded-xl border p-4 sm:p-6 backdrop-blur-md ${themeClasses.panelBg} relative overflow-hidden`} suppressHydrationWarning>
        {/* Decorative HUD Corner Accents */}
        <div className={`absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />
        <div className={`absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />
        <div className={`absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />
        <div className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />

        {/* Station Live Meta Banner & Master Record Core Button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/10 pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-tech font-bold uppercase tracking-widest ${themeClasses.badgeBg}`}>
                ON AIR
              </span>
              <span className="font-tech text-xs text-muted">SIGNAL 100% // {station.name}</span>
            </div>
            <h2 className="mt-1.5 font-orbitron text-xl sm:text-2xl font-bold tracking-wide text-white truncate drop-shadow-md">
              {nowPlaying ?? "Waiting for broadcast metadata..."}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-tech text-muted">
              <span className="flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5 text-cyan" />
                <span className="text-white/80">{station.bitrate} kbps Icecast MP3</span>
              </span>
              <span className="text-white/30">•</span>
              <span className="flex items-center gap-1">
                <Activity className="h-3.5 w-3.5 text-emerald-400" />
                <span>Peak: {peakDb}</span>
              </span>
              <span className="text-white/30">•</span>
              <span className="text-white/60">Audio Engine: Active</span>
            </div>
          </div>

          {/* Master Glowing RECORD CORE */}
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => void onRecord()}
              disabled={arming || (blocked && !recording)}
              aria-pressed={recording}
              className="group relative flex flex-col items-center gap-1.5 focus:outline-none disabled:opacity-50"
              suppressHydrationWarning
            >
              {/* Pulsing Neon Core Ring */}
              <div
                className={`relative grid h-20 w-20 sm:h-24 sm:w-24 place-items-center rounded-full border-2 transition-transform duration-300 ${
                  recording
                    ? "border-red-500 bg-red-950/40 shadow-[0_0_30px_rgba(255,42,81,0.6)] scale-105"
                    : arming
                    ? "border-amber-400 bg-amber-950/40 shadow-[0_0_20px_rgba(251,191,36,0.5)]"
                    : `${themeClasses.accentBorder} bg-black/60 hover:scale-105 shadow-[0_0_20px_rgba(255,255,255,0.08)]`
                }`}
              >
                {recording && (
                  <div className="absolute inset-0 rounded-full border-2 border-red-500/80 animate-ping opacity-75" />
                )}
                {/* Center Core Shape */}
                <div
                  className={`transition-all duration-300 ${
                    recording
                      ? "h-7 w-7 rounded-md bg-red-500 shadow-[0_0_15px_#ff2a51]"
                      : arming
                      ? "h-6 w-6 rounded-sm bg-amber-400 animate-spin"
                      : `h-8 w-8 rounded-full ${themeClasses.accentBg} shadow-[0_0_15px_currentColor]`
                  }`}
                />
              </div>
              <span className={`font-orbitron text-xs sm:text-sm font-black tracking-widest ${recording ? "text-red-400 animate-pulse" : themeClasses.accentText}`}>
                {arming ? "ARMING FILE..." : recording ? "TERMINATE REC" : "ENGAGE RECORD"}
              </span>
            </button>
          </div>
        </div>

        {/* Live Audio Visualizer Canvas */}
        <div className="mt-4 rounded-lg border border-white/10 bg-black/80 p-3 relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 font-tech text-xs text-muted">
              <Activity className={`h-3.5 w-3.5 ${themeClasses.accentText}`} />
              <span className="tracking-wider uppercase">DYNAMIC FREQUENCY MATRIX</span>
            </div>
            {/* Visualizer Mode Switcher */}
            <div className="flex items-center gap-1 font-tech text-[11px]" suppressHydrationWarning>
              <button
                type="button"
                onClick={() => {
                  setVizMode("spectrum");
                  if (soundFx) playCyberSfx("click");
                }}
                className={`px-2 py-0.5 rounded border transition-colors ${
                  vizMode === "spectrum" ? themeClasses.badgeBg : "border-white/10 text-muted hover:text-fg"
                }`}
                suppressHydrationWarning
              >
                SPECTRUM
              </button>
              <button
                type="button"
                onClick={() => {
                  setVizMode("oscilloscope");
                  if (soundFx) playCyberSfx("click");
                }}
                className={`px-2 py-0.5 rounded border transition-colors ${
                  vizMode === "oscilloscope" ? themeClasses.badgeBg : "border-white/10 text-muted hover:text-fg"
                }`}
                suppressHydrationWarning
              >
                LASER WAVE
              </button>
              <button
                type="button"
                onClick={() => {
                  setVizMode("reactor");
                  if (soundFx) playCyberSfx("click");
                }}
                className={`px-2 py-0.5 rounded border transition-colors ${
                  vizMode === "reactor" ? themeClasses.badgeBg : "border-white/10 text-muted hover:text-fg"
                }`}
                suppressHydrationWarning
              >
                REACTOR RADAR
              </button>
            </div>
          </div>

          {/* Canvas Element with High-Res Rendering */}
          <canvas
            ref={canvasRef}
            width={760}
            height={110}
            className="w-full h-24 sm:h-28 block rounded"
          />

          {/* Visualizer Frequency Distribution Meters */}
          <div className="mt-2.5 pt-2 border-t border-white/10 grid grid-cols-3 gap-3 font-tech text-[11px] text-muted">
            <div>
              <div className="flex justify-between mb-1">
                <span>SUB-BASS</span>
                <span className="text-white/80">{Math.round(bassLevel * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded overflow-hidden">
                <div
                  className={`h-full ${themeClasses.accentBg} transition-all duration-75`}
                  style={{ width: `${Math.round(bassLevel * 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>MIDRANGE</span>
                <span className="text-white/80">{Math.round(midLevel * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded overflow-hidden">
                <div
                  className={`h-full ${themeClasses.accentBg} transition-all duration-75`}
                  style={{ width: `${Math.round(midLevel * 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>HIGHS / AIR</span>
                <span className="text-white/80">{Math.round(trebleLevel * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded overflow-hidden">
                <div
                  className={`h-full ${themeClasses.accentBg} transition-all duration-75`}
                  style={{ width: `${Math.round(trebleLevel * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Tactical Control Bar: Listen Live, Volume Slider, Auto-Stop Timer, Direct Save */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4" suppressHydrationWarning>
          {/* Audio Monitoring & Master Volume */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void onListen()}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-orbitron text-xs font-bold tracking-wider uppercase transition-all ${
                listening
                  ? `${themeClasses.accentBorder} bg-black/60 ${themeClasses.accentText} ${themeClasses.hudGlow}`
                  : "border-white/10 bg-black/40 text-muted hover:border-white/30 hover:text-fg"
              }`}
              suppressHydrationWarning
            >
              <Headphones className="h-4 w-4" />
              <span>{listening ? "MUTE MONITOR" : "MONITOR LIVE"}</span>
            </button>

            <div className="flex items-center gap-2 bg-black/40 border border-white/10 px-3 py-1.5 rounded-lg" suppressHydrationWarning>
              <button
                type="button"
                onClick={toggleMute}
                className="text-muted hover:text-white"
                aria-label="Toggle mute"
                suppressHydrationWarning
              >
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4 text-cyan" />}
              </button>
              <input
                id={volumeSliderId}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => onVolume(parseFloat(e.target.value))}
                className="h-1.5 w-20 sm:w-28 accent-cyan cursor-pointer"
                aria-label="Volume"
                suppressHydrationWarning
              />
              <label htmlFor={volumeSliderId} className="font-tech text-xs text-white/70 w-8 text-right cursor-pointer">
                {isMuted ? "MUT" : `${Math.round(volume * 100)}%`}
              </label>
            </div>
          </div>

          {/* Timer & Hardware Switches */}
          <div className="flex flex-wrap items-center gap-3 font-tech text-xs">
            {/* Auto-Stop Limiters */}
            <div className="flex items-center gap-1 bg-black/40 border border-white/10 p-1 rounded-lg" suppressHydrationWarning>
              <Clock className="h-3.5 w-3.5 text-muted ml-1.5 mr-0.5" />
              <span className="text-muted text-[11px] mr-1">LIMIT:</span>
              {LIMITS.map((lim) => (
                <button
                  key={lim.id}
                  type="button"
                  disabled={recording}
                  onClick={() => {
                    setLimitId(lim.id);
                    if (soundFx) playCyberSfx("click");
                  }}
                  className={`px-2 py-1 rounded text-[11px] transition-colors ${
                    limitId === lim.id
                      ? `${themeClasses.accentBg} text-black font-bold`
                      : "text-muted hover:text-white"
                  }`}
                  suppressHydrationWarning
                >
                  {lim.label}
                </button>
              ))}
            </div>

            {/* Monitor Switch */}
            <label className="flex items-center gap-1.5 bg-black/40 border border-white/10 px-2.5 py-1.5 rounded-lg text-muted cursor-pointer hover:border-white/20" suppressHydrationWarning>
              <input
                type="checkbox"
                checked={monitor}
                disabled={recording}
                onChange={(e) => setMonitor(e.target.checked)}
                className="rounded border-line text-cyan focus:ring-0"
                suppressHydrationWarning
              />
              <span className="text-[11px]">MONITOR REC</span>
            </label>

            {/* Direct Disk Save */}
            {canDirect && (
              <label className="flex items-center gap-1.5 bg-black/40 border border-white/10 px-2.5 py-1.5 rounded-lg text-muted cursor-pointer hover:border-white/20" suppressHydrationWarning>
                <input
                  type="checkbox"
                  checked={saveDirect}
                  disabled={recording}
                  onChange={(e) => setSaveDirect(e.target.checked)}
                  className="rounded border-line text-cyan focus:ring-0"
                  suppressHydrationWarning
                />
                <span className="text-[11px]">DIRECT DISK SINK</span>
              </label>
            )}
          </div>
        </div>

        {/* Live Active Recording HUD Telemetry Strip */}
        {recording && (
          <div className="mt-4 flex flex-wrap items-center justify-between rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-2.5 font-tech text-xs animate-pulse">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_8px_#ff2a51]" />
              <span className="font-orbitron font-bold tracking-wider text-red-400">RECORDING ENGAGED</span>
              <span className="font-tech text-sm text-white font-mono">{formatDuration(elapsed)}</span>
              {remaining !== null && (
                <span className="text-muted text-[11px]">({formatDuration(remaining)} auto-limit)</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white/60">CAPTURED:</span>
              <span className="font-bold text-red-300 font-mono text-sm">{formatBytes(bytes)}</span>
            </div>
          </div>
        )}
      </section>

      {/* Cyber Diagnostics & Stream Logs Console (matching Image 1 & 3) */}
      <section className={`rounded-xl border p-4 backdrop-blur-md ${themeClasses.subPanelBg} font-tech text-xs`} suppressHydrationWarning>
        <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2.5">
          <div className="flex items-center gap-2 text-muted">
            <TerminalIcon className={`h-4 w-4 ${themeClasses.accentText}`} />
            <span className="tracking-widest uppercase">STREAM TELEMETRY & RUNNING LOGS</span>
          </div>
          <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            DIAGNOSTICS NOMINAL
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Recent Announced Tracks */}
          <div className="md:col-span-2 bg-black/60 rounded border border-white/10 p-2.5">
            <p className="text-[11px] text-white/50 mb-1.5 uppercase tracking-wider">Announced Tracks in Current Feed</p>
            {trackLog.length === 0 ? (
              <p className="text-white/40 italic text-[11px]">Waiting for icecast metadata changes...</p>
            ) : (
              <ul className="space-y-1">
                {trackLog.slice(-4).map((tr, idx) => (
                  <li key={idx} className="flex items-center justify-between text-muted text-[11px]">
                    <span className="text-white/90 truncate flex-1">{tr.title}</span>
                    <span className="font-mono text-white/40 text-[10px] ml-2 shrink-0">{formatDuration(tr.t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Diagnostic Console Log Feed */}
          <div className="bg-black/60 rounded border border-white/10 p-2.5 flex flex-col justify-between">
            <div>
              <p className="text-[11px] text-white/50 mb-1.5 uppercase tracking-wider">System Terminal Activity</p>
              <div className="space-y-1 text-[10px] text-white/70 font-mono">
                {sysLogs.slice(0, 4).map((log, i) => (
                  <div key={i} className="truncate">
                    <span className="text-cyan mr-1">&gt;</span>
                    {log}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 pt-1.5 border-t border-white/10 flex justify-between text-[10px] text-white/40 font-mono">
              <span>LATENCY: ~45ms</span>
              <span>BUFFER: STABLE</span>
            </div>
          </div>
        </div>
      </section>

      {/* Notifications / Errors */}
      {error && (
        <div className="rounded-xl border border-red-500/50 bg-red-950/30 p-4 text-sm text-red-400 font-tech">
          <p className="font-bold">SYSTEM ERROR:</p>
          <p className="mt-0.5">{error}</p>
        </div>
      )}

      {notice && (
        <div className={`rounded-xl border ${themeClasses.accentBorder} bg-black/60 p-4 text-sm ${themeClasses.accentText} font-tech`}>
          <p>{notice}</p>
        </div>
      )}

      {/* Pending Take Ready Modal / Card */}
      {pending && (
        <section className={`rounded-xl border-2 ${themeClasses.accentBorder} bg-black/90 p-5 backdrop-blur-lg ${themeClasses.hudGlow}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Disc className={`h-4 w-4 ${themeClasses.accentText} animate-spin`} />
                <span className={`font-orbitron text-xs font-bold tracking-widest uppercase ${themeClasses.accentText}`}>
                  TAKE READY FOR DISPOSITION
                </span>
              </div>
              <h3 className="font-orbitron text-lg font-bold text-white mt-1">
                {pending.stationName} · {formatDuration(pending.endedAt - pending.startedAt)} ({formatBytes(pending.bytes)})
              </h3>
              <p className="text-xs font-tech text-muted mt-1">
                {pending.fileSaved
                  ? "Take successfully flushed straight into selected disk file."
                  : "Audio capture ready in memory. Save MP3 to device or archive in browser vault."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-tech">
              {!pending.fileSaved && (
                <>
                  <button
                    type="button"
                    onClick={onDownload}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-black ${themeClasses.accentBg} transition-transform hover:scale-105 shadow-md`}
                    suppressHydrationWarning
                  >
                    <Download className="h-4 w-4" />
                    <span>SAVE MP3</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onKeep()}
                    disabled={pending.kept}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-fg hover:border-white/40 disabled:opacity-50"
                    suppressHydrationWarning
                  >
                    <span>{pending.kept ? "ARCHIVED IN VAULT" : "KEEP IN BROWSER"}</span>
                  </button>
                </>
              )}
              {pending.tracks.length > 0 && (
                <button
                  type="button"
                  onClick={onCueSheet}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs text-muted hover:text-fg hover:border-white/40"
                  suppressHydrationWarning
                >
                  <span>CUE SHEET .TXT</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setPending(null)}
                className="px-3 py-2 text-xs text-muted hover:text-white"
                suppressHydrationWarning
              >
                DISMISS
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Cyber Tape Library / Saved Recordings Vault */}
      <section className={`rounded-xl border p-5 backdrop-blur-md ${themeClasses.panelBg}`} suppressHydrationWarning>
        <div className="flex items-center justify-between border-b border-white/10 pb-3" suppressHydrationWarning>
          <div className="flex items-center gap-2" suppressHydrationWarning>
            <Layers className={`h-4 w-4 ${themeClasses.accentText}`} />
            <h3 className="font-orbitron text-base sm:text-lg font-bold text-white tracking-wide" suppressHydrationWarning>
              RECORDING ARCHIVE VAULT {takes.length > 0 && <span className={`${themeClasses.accentText} text-xs ml-2`}>[{takes.length} TAPES]</span>}
            </h3>
          </div>
        </div>

        {takes.length === 0 ? (
          <div className="py-8 text-center font-tech text-muted text-xs">
            <Disc className="h-8 w-8 mx-auto text-white/20 mb-2" />
            <p>NO ARCHIVED TAPES IN LOCAL BROWSER STORAGE.</p>
            <p className="mt-1 text-white/40">Record any stream and click &quot;Keep in Browser&quot; to archive takes locally.</p>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-white/10 font-tech">
            {takes.map((take) => {
              const isPlaying = playingId === take.id;
              const isBusy = busyId === take.id;
              const duration = take.endedAt - take.startedAt;
              return (
                <div key={take.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3.5 gap-2.5">
                  <div className="min-w-0">
                    <p className="font-orbitron text-sm font-bold text-white truncate">{take.stationName}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {new Date(take.startedAt).toLocaleString()} • {formatDuration(duration)} • {formatBytes(take.bytes)}
                      {take.tracks.length > 0 && ` • ${take.tracks.length} track(s)`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onPlayTake(take)}
                      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-bold transition-all ${
                        isPlaying
                          ? `${themeClasses.accentBg} text-black shadow-[0_0_10px_currentColor]`
                          : "border border-white/20 text-white hover:border-white/40 bg-black/40"
                      }`}
                      suppressHydrationWarning
                    >
                      {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                      <span>{isPlaying ? "PAUSE" : "PLAY"}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onDownloadTake(take)}
                      className="inline-flex items-center gap-1.5 rounded border border-white/20 bg-black/40 px-3 py-1.5 text-muted hover:text-white hover:border-white/40"
                      suppressHydrationWarning
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>MP3</span>
                    </button>

                    {confirmId === take.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void onDeleteTake(take.id)}
                          className="rounded px-2.5 py-1 text-xs text-red-400 bg-red-950/40 border border-red-500/40 hover:bg-red-900/50"
                          suppressHydrationWarning
                        >
                          CONFIRM PURGE
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="rounded px-2 py-1 text-xs text-muted hover:text-white"
                          suppressHydrationWarning
                        >
                          CANCEL
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(take.id)}
                        className="p-1.5 text-muted hover:text-red-400 transition-colors"
                        aria-label="Delete take"
                        suppressHydrationWarning
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Hidden audio tags for stream playback and tape preview */}
      <audio ref={audioRef} preload="none" suppressHydrationWarning />
      <audio
        ref={libraryAudioRef}
        preload="none"
        onEnded={() => stopLibraryPlayback()}
        suppressHydrationWarning
      />
    </div>
  );
}

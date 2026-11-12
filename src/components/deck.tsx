import { useEffect, useRef, useState, useId } from "react";
import {
  Download,
  Headphones,
  Play,
  Pause,
  Trash2,
  Radio,
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
  Video as VideoIcon,
  ExternalLink,
  Upload,
  RotateCcw,
  SlidersHorizontal,
  Keyboard,
  Settings,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Server,
  Cpu,
  Timer,
  HardDrive,
} from "lucide-react";
import { canPickSaveFile, pickSaveFile, startCapture, type CaptureReason } from "@/lib/capture";
import { downloadBlob, formatBytes, formatDuration, recordingName } from "@/lib/format";
import { deleteTake, getTakeBlob, listTakes, saveTake, type TakeMeta, type TrackMark } from "@/lib/library";
import { fetchNowPlaying, STATIONS, type Station } from "@/lib/stations";
import { fetchAlbumArtwork, getYouTubeSearchUrl, parseTrackMeta } from "@/lib/artwork";
import {
  renderVideoComposition,
  type BattlestationTheme,
  type VisualizerMode,
} from "@/lib/video-composition";
import {
  attachAudioGraph,
  setGraphAgcEnabled,
  setGraphMonitorVolume,
  stepAnalyserAgc,
  type AgcMode,
  type AudioGraph,
} from "@/lib/agc";

const LIMITS = [
  { id: "off", label: "Manual", ms: null },
  { id: "15", label: "15m", ms: 15 * 60 * 1000 },
  { id: "30", label: "30m", ms: 30 * 60 * 1000 },
  { id: "60", label: "1h", ms: 60 * 60 * 1000 },
  { id: "120", label: "2h", ms: 120 * 60 * 1000 },
] as const;

type LimitId = (typeof LIMITS)[number]["id"];
type DeckTab = "deck" | "settings";

type LogoPreset = {
  id: string;
  label: string;
  src: string;
};

const LOGO_PRESETS: LogoPreset[] = [
  {
    id: "gold-cyber",
    label: "Amber Cyber Skull",
    src: "/assets/aistudio/Gemini_Generated_Image___1__42654257.jpg",
  },
  {
    id: "cyan-cyber",
    label: "Cyan Cyber Skull",
    src: "/assets/aistudio/Gemini_Generated_Image_iw7pdriw7pdriw7p.jpg_ccefdf41_b3277807.jpg",
  },
  {
    id: "rgb-metallic",
    label: "RGB Metallic Emblem",
    src: "/assets/aistudio/Embossed_logo_with_metallic_sheen_2e9f782e_7fc9b6d2.jpg",
  },
  {
    id: "gold-classic",
    label: "Black & Gold Crest",
    src: "/assets/aistudio/Creating_gold_circular_badge_design_6bddf475.jpg_70548c28_888d6f5b.jpg",
  },
  {
    id: "neon-split",
    label: "Neon Bolt Ring",
    src: "/assets/aistudio/Brand_logo_design_for_OUTLAWZ_f2a45e21_abbd3e6a.jpg",
  },
  {
    id: "enamel-navy",
    label: "Cloisonné Gold Badge",
    src: "/assets/aistudio/Designing_OutLawZ_cloisonn__enam__fa6619a0_6772c448.jpg",
  },
  {
    id: "wood-badge",
    label: "Carved Wood Badge",
    src: "/assets/aistudio/OutLawZ_wood_pyrography_badge_3719726f.jpg_a62d4d5a_6f5b666a.jpg",
  },
  {
    id: "red-silhouette",
    label: "Crimson & Gold Crest",
    src: "/assets/aistudio/Logo_merging_abstract_and_typogr__1d6fe7fc_af57ed87.jpg",
  },
  {
    id: "bronze-filigree",
    label: "Teal Bronze Filigree",
    src: "/assets/aistudio/file_00000000f7bc82308734d5114d69488c_b9d2cc0b.png",
  },
];

function getThemeDefaultLogo(theme: BattlestationTheme): string {
  if (theme === "cyan") return LOGO_PRESETS[1].src;
  if (theme === "purple") return LOGO_PRESETS[2].src;
  return LOGO_PRESETS[0].src;
}

function parseServerNode(urlStr: string): { host: string; protocol: string; path: string } {
  if (!urlStr) return { host: "LOCAL / UNCONFIGURED", protocol: "—", path: "—" };
  try {
    const parsed = new URL(urlStr);
    return {
      host: parsed.host,
      protocol: parsed.protocol.replace(":", "").toUpperCase(),
      path: parsed.pathname || "/",
    };
  } catch {
    return { host: urlStr, protocol: "STREAM", path: "/" };
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

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
  mediaType: "audio" | "video";
};

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

export function Deck() {
  const volumeSliderId = useId();
  const bgOpacityId = useId();

  const [activeTab, setActiveTab] = useState<DeckTab>("deck");
  const [theme, setTheme] = useState<BattlestationTheme>("gold");
  const [stationsList, setStationsList] = useState<Station[]>(STATIONS);
  const [stationId, setStationId] = useState<string>(STATIONS[0].id);
  const station = stationsList.find((item) => item.id === stationId) ?? stationsList[0];

  const [monitor, setMonitor] = useState(true);
  const [limitId, setLimitId] = useState<LimitId>("off");
  const [saveDirect, setSaveDirect] = useState(false);
  const [canDirect, setCanDirect] = useState(false);
  const [soundFx, setSoundFx] = useState(true);

  // Expand/Collapse metadata panel & Visualizer toggle
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [visualizerEnabled, setVisualizerEnabled] = useState(true);
  const visualizerEnabledRef = useRef(true);

  // Custom Record Button Logo & Custom Background Image
  const [selectedLogoId, setSelectedLogoId] = useState<string>("auto");
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(null);
  const [customBgUrl, setCustomBgUrl] = useState<string | null>(null);
  const [bgOpacity, setBgOpacity] = useState<number>(0.38);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const badgeImgRef = useRef<HTMLImageElement | null>(null);

  // Capture mode: AUDIO (MP3) or VIDEO (1080p 16:9 MP4/WEBM with rotating vinyl + visualizer)
  const [recordMode, setRecordMode] = useState<"audio" | "video">("audio");
  const recordModeRef = useRef<"audio" | "video">("audio");

  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [arming, setArming] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [lastSessionDurationMs, setLastSessionDurationMs] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [clock, setClock] = useState(0);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [trackLog, setTrackLog] = useState<TrackMark[]>([]);
  const [pending, setPending] = useState<PendingTake | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Artwork & Track Metadata State
  const [customArtworkUrl, setCustomArtworkUrl] = useState<string | null>(null);
  const [autoArtworkUrl, setAutoArtworkUrl] = useState<string | null>(null);
  const [artworkLoading, setArtworkLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const artworkImgRef = useRef<HTMLImageElement | null>(null);

  // Audio analysis & Auto-Gain Control (AGC) telemetry (throttled for UI performance)
  const [peakDb, setPeakDb] = useState("-∞");
  const [bassLevel, setBassLevel] = useState(0.2);
  const [midLevel, setMidLevel] = useState(0.2);
  const [trebleLevel, setTrebleLevel] = useState(0.2);
  const [vizMode, setVizMode] = useState<VisualizerMode>("spectrum");
  const [agcEnabled, setAgcEnabled] = useState(true);
  const [agcMode, setAgcMode] = useState<AgcMode>("worklet");
  const [agcGainDb, setAgcGainDb] = useState(0);
  const [sampleRate, setSampleRate] = useState(48000);

  // Custom station form state (hosted in Settings tab)
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");

  // Terminal telemetry logs
  const [sysLogs, setSysLogs] = useState<string[]>([
    "INITIALIZING OUTLAWZ HUD // BATTMOD V4.0",
    "D3 CANVAS VISUALIZER ENGINE READY",
    "AUTO-GAIN CONTROL (AGC) NORMALIZER ACTIVE",
    "SECURE ICECAST DECODER STANDBY",
    "DUAL-MODE CAPTURE ENGINE: AUDIO + VIDEO ACTIVE",
  ]);

  // Saved tapes state
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingVideoTake, setPlayingVideoTake] = useState<{ id: string; url: string; title: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Refs
  const deckRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const libraryAudioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<{ stop: () => void } | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const volumeRef = useRef(0.9);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const preMuteVolume = useRef(0.9);

  const tracksRef = useRef<TrackMark[]>([]);
  const nowPlayingRef = useRef<string | null>(null);
  const stationRef = useRef(station);
  const startedRef = useRef(0);
  const recordingRef = useRef(false);
  const armingRef = useRef(false);
  const agcEnabledRef = useRef(true);
  const libraryUrl = useRef<string | null>(null);
  const playingUrlTake = useRef<string | null>(null);
  const vinylAngleRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());
  const lastStateUpdateRef = useRef(0);

  // Hydration-safe restoration of user visual preferences from localStorage
  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem("outlawz_theme");
      if (savedTheme === "gold" || savedTheme === "cyan" || savedTheme === "purple") {
        setTheme(savedTheme);
      }
      const savedLogoId = window.localStorage.getItem("outlawz_logo_id");
      if (savedLogoId) setSelectedLogoId(savedLogoId);

      const savedCustomLogo = window.localStorage.getItem("outlawz_custom_logo");
      if (savedCustomLogo) setCustomLogoUrl(savedCustomLogo);

      const savedCustomBg = window.localStorage.getItem("outlawz_custom_bg");
      if (savedCustomBg) setCustomBgUrl(savedCustomBg);

      const savedOpacity = window.localStorage.getItem("outlawz_bg_opacity");
      if (savedOpacity) {
        const parsed = parseFloat(savedOpacity);
        if (!Number.isNaN(parsed)) setBgOpacity(Math.max(0.1, Math.min(0.85, parsed)));
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("outlawz_theme", theme);
    } catch {
      // Ignore
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem("outlawz_logo_id", selectedLogoId);
    } catch {
      // Ignore
    }
  }, [selectedLogoId]);

  useEffect(() => {
    try {
      window.localStorage.setItem("outlawz_bg_opacity", String(bgOpacity));
    } catch {
      // Ignore
    }
  }, [bgOpacity]);

  useEffect(() => {
    recordModeRef.current = recordMode;
  }, [recordMode]);

  useEffect(() => {
    visualizerEnabledRef.current = visualizerEnabled;
  }, [visualizerEnabled]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    armingRef.current = arming;
  }, [arming]);

  useEffect(() => {
    agcEnabledRef.current = agcEnabled;
    const audio = audioRef.current as (HTMLAudioElement & { __graph?: AudioGraph }) | null;
    if (audio?.__graph) {
      setGraphAgcEnabled(audio.__graph, agcEnabled);
      setAgcMode(audio.__graph.mode);
    }
  }, [agcEnabled]);

  // Compute active Record Button Logo URL
  const activeLogoUrl =
    selectedLogoId === "custom" && customLogoUrl
      ? customLogoUrl
      : LOGO_PRESETS.find((p) => p.id === selectedLogoId)?.src ?? getThemeDefaultLogo(theme);

  // Preload active badge image for 16:9 vinyl fallback label
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = activeLogoUrl;
    img.onload = () => {
      badgeImgRef.current = img;
    };
    img.onerror = () => {
      badgeImgRef.current = null;
    };
  }, [activeLogoUrl]);

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

  // Automatic Artwork Lookup via iTunes API
  useEffect(() => {
    let alive = true;
    const meta = parseTrackMeta(nowPlaying);
    if (!meta.searchQuery || meta.searchQuery === "OutLawZ Cyber Beats") {
      setAutoArtworkUrl(null);
      return;
    }

    setArtworkLoading(true);
    void fetchAlbumArtwork(meta.searchQuery)
      .then((artUrl) => {
        if (!alive) return;
        setAutoArtworkUrl(artUrl);
        if (artUrl) appendLog(`ARTWORK_FOUND: ${meta.artist}`);
      })
      .catch(() => {
        if (alive) setAutoArtworkUrl(null);
      })
      .finally(() => {
        if (alive) setArtworkLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [nowPlaying]);

  // Load image object for canvas rendering with priority: Custom > Auto > None
  useEffect(() => {
    const activeUrl = customArtworkUrl || autoArtworkUrl;
    if (!activeUrl) {
      artworkImgRef.current = null;
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = activeUrl;
    img.onload = () => {
      artworkImgRef.current = img;
    };
    img.onerror = () => {
      artworkImgRef.current = null;
    };
  }, [customArtworkUrl, autoArtworkUrl]);

  // Handle custom artwork file upload
  const handleArtworkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (soundFx) playCyberSfx("click");
    if (customArtworkUrl) {
      URL.revokeObjectURL(customArtworkUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    setCustomArtworkUrl(objectUrl);
    appendLog(`CUSTOM_ARTWORK_ATTACHED: ${file.name}`);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeCustomArtwork = () => {
    if (soundFx) playCyberSfx("click");
    if (customArtworkUrl) {
      URL.revokeObjectURL(customArtworkUrl);
      setCustomArtworkUrl(null);
      appendLog("CUSTOM_ARTWORK_REMOVED");
    }
  };

  // Handle custom record button logo upload
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (soundFx) playCyberSfx("click");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCustomLogoUrl(dataUrl);
      setSelectedLogoId("custom");
      try {
        if (dataUrl.length < 2_000_000) {
          window.localStorage.setItem("outlawz_custom_logo", dataUrl);
        }
      } catch {
        // Quota exceeded
      }
      appendLog(`RECORD_LOGO_UPDATED: ${file.name}`);
    } catch {
      setError("Could not load custom logo image.");
    } finally {
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const resetCustomLogo = () => {
    if (soundFx) playCyberSfx("click");
    setCustomLogoUrl(null);
    setSelectedLogoId("auto");
    try {
      window.localStorage.removeItem("outlawz_custom_logo");
    } catch {
      // Ignore
    }
    appendLog("RECORD_LOGO_RESET_TO_THEME_DEFAULT");
  };

  // Handle custom background image upload
  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (soundFx) playCyberSfx("click");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCustomBgUrl(dataUrl);
      try {
        if (dataUrl.length < 3_000_000) {
          window.localStorage.setItem("outlawz_custom_bg", dataUrl);
        }
      } catch {
        // Quota exceeded
      }
      appendLog(`CUSTOM_BG_APPLIED: ${file.name}`);
    } catch {
      setError("Could not load custom background image.");
    } finally {
      if (bgInputRef.current) bgInputRef.current.value = "";
    }
  };

  const clearCustomBg = () => {
    if (soundFx) playCyberSfx("click");
    setCustomBgUrl(null);
    try {
      window.localStorage.removeItem("outlawz_custom_bg");
    } catch {
      // Ignore
    }
    appendLog("CUSTOM_BG_CLEARED");
  };

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

  // 1920x1080 Full HD Video & D3 Visualizer Canvas Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    let frame = 0;
    const freqBins = new Uint8Array(128);
    const timeDomainBins = new Uint8Array(128);

    lastFrameTimeRef.current = performance.now();

    const render = (timeNow: number) => {
      const dt = Math.min(0.1, (timeNow - lastFrameTimeRef.current) / 1000);
      lastFrameTimeRef.current = timeNow;

      const isLive = Boolean(audio && !audio.paused && audio.src);

      if (isLive) {
        vinylAngleRef.current += dt * 1.8;
      }

      let graph: AudioGraph | null = null;
      if (isLive && audio) {
        graph = attachAudioGraph(audio, volumeRef.current, isMutedRef.current, (mode) => {
          setAgcMode(mode);
          appendLog(`AGC_ENGINE: ${mode.toUpperCase()} NORMALIZER READY`);
        });
        if (graph) {
          setGraphAgcEnabled(graph, agcEnabledRef.current);
          if (graph.ctx.state === "suspended") void graph.ctx.resume();
          stepAnalyserAgc(graph, dt);
        }
      }

      let curBass = 0.2;
      let curMid = 0.2;
      let curTreble = 0.2;
      let curPeakStr = "-∞";

      if (graph && isLive) {
        graph.analyser.getByteFrequencyData(freqBins);
        graph.analyser.getByteTimeDomainData(timeDomainBins);

        let bSum = 0;
        let mSum = 0;
        let tSum = 0;
        for (let i = 0; i < 40; i++) {
          if (i < 8) bSum += freqBins[i] || 0;
          else if (i < 24) mSum += freqBins[i] || 0;
          else tSum += freqBins[i] || 0;
        }
        curBass = Math.min(1, bSum / 8 / 255);
        curMid = Math.min(1, mSum / 16 / 255);
        curTreble = Math.min(1, tSum / 16 / 255);

        const peak = Math.max(...freqBins);
        if (peak > 0) {
          const db = Math.round(20 * Math.log10(peak / 255));
          curPeakStr = `${db} dBFS`;
        }

        if (timeNow - lastStateUpdateRef.current > 200) {
          lastStateUpdateRef.current = timeNow;
          setBassLevel(curBass);
          setMidLevel(curMid);
          setTrebleLevel(curTreble);
          setPeakDb(curPeakStr);
          setAgcGainDb(graph.currentGainDb);
          setAgcMode(graph.mode);
          setSampleRate(graph.ctx.sampleRate);
        }
      }

      const parsed = parseTrackMeta(nowPlayingRef.current ?? stationRef.current?.name);

      renderVideoComposition({
        ctx: ctx2d,
        width: 1920,
        height: 1080,
        freqBins,
        timeDomainBins,
        isLive,
        visualizerEnabled: visualizerEnabledRef.current,
        theme,
        vizMode,
        artist: parsed.artist,
        title: parsed.title,
        stationName: stationRef.current?.name ?? "LIVE STREAM",
        bitrate: stationRef.current?.bitrate ?? 192,
        artworkImage: artworkImgRef.current,
        badgeImage: badgeImgRef.current,
        vinylAngle: vinylAngleRef.current,
        recording: recordingRef.current && recordModeRef.current === "video",
        recordElapsedMs: recordingRef.current && startedRef.current ? Math.max(0, Date.now() - startedRef.current) : 0,
        recordBytes: bytes,
        peakDb: curPeakStr,
        bassLevel: curBass,
        midLevel: curMid,
        trebleLevel: curTreble,
      });

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, [theme, vizMode, bytes, activeTab]);

  const elapsed = recording && startedAt ? Math.max(0, (clock || startedAt) - startedAt) : 0;
  const displayDurationMs = recording ? elapsed : lastSessionDurationMs;
  const limit = LIMITS.find((item) => item.id === limitId) ?? LIMITS[0];
  const remaining = limit.ms ? Math.max(0, limit.ms - elapsed) : null;
  const blocked = Boolean(pending && !pending.fileSaved);
  const serverNode = parseServerNode(station.streamUrl);
  const statusNode = parseServerNode(station.statusUrl);
  const activeRecordingBitrate = recordMode === "video" ? "6,000 kbps (VP9 / Opus)" : `${station.bitrate} kbps (MP3)`;
  const activeCodecLabel =
    recordMode === "video"
      ? "WebM VP9 / MP4 H.264 + Opus Audio (1080p 60FPS)"
      : "MPEG-1 Audio Layer 3 (Icecast MP3 Stream)";

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
    if (audio.src !== next.streamUrl || audio.error || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      audio.src = next.streamUrl;
      audio.load();
    }
    const graph = attachAudioGraph(audio, volumeRef.current, isMutedRef.current, (mode) => {
      setAgcMode(mode);
    });
    if (graph) {
      setGraphAgcEnabled(graph, agcEnabledRef.current);
      setGraphMonitorVolume(graph, volumeRef.current, isMutedRef.current);
      setSampleRate(graph.ctx.sampleRate);
      if (graph.ctx.state === "suspended") void graph.ctx.resume();
    } else {
      audio.volume = isMutedRef.current ? 0 : volumeRef.current;
    }
    await audio.play();
    setListening(true);
    setError(null);
    appendLog(`MONITOR_STREAMING: ${next.name}`);
  }

  async function onListen() {
    setError(null);
    setNotice(null);
    if (soundFx) playCyberSfx("click");
    if (listening) {
      stopMonitor();
      return;
    }
    try {
      await startMonitor(station);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Playback blocked";
      appendLog(`MONITOR_BLOCKED: ${msg}`);
      setError("Playback blocked. Tap MONITOR LIVE again, or check stream availability.");
      setListening(false);
    }
  }

  async function onRecordAudio() {
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
        setNotice("Capturing stream in silent background mode. Tap MONITOR LIVE to hear playback.");
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
    setLastSessionDurationMs(0);
    setRecording(true);
    if (soundFx) playCyberSfx("rec");
    appendLog(`AUDIO_RECORDING_ENGAGED: ${current.name} [MP3]`);

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
    setLastSessionDurationMs(Math.max(0, result.endedAt - result.startedAt));
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
      mediaType: "audio",
    };
    setPending(finished);
    if (result.reason === "dropped") {
      setNotice("Live stream concluded early. Captured take is preserved.");
    }
  }

  async function onRecordVideo() {
    if (captureRef.current) {
      if (soundFx) playCyberSfx("stop");
      captureRef.current.stop();
      appendLog("VIDEO_CAPTURE_STOP_REQUESTED");
      return;
    }
    if (blocked || arming) return;
    setError(null);
    setNotice(null);
    if (soundFx) playCyberSfx("arm");

    const current = stationRef.current;
    const chosenLimit = LIMITS.find((item) => item.id === limitId) ?? LIMITS[0];

    try {
      await startMonitor(current);
    } catch {
      setError("Playback blocked. Tap Monitor Live, then try recording video.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      setError("Visualizer display is initializing. Switch to Player Deck tab and retry.");
      return;
    }

    const canvasElement = canvas as HTMLCanvasElement & {
      captureStream?: (fps?: number) => MediaStream;
      mozCaptureStream?: (fps?: number) => MediaStream;
    };
    const canvasStream: MediaStream | null = canvasElement.captureStream
      ? canvasElement.captureStream(60)
      : canvasElement.mozCaptureStream
      ? canvasElement.mozCaptureStream(60)
      : null;

    if (!canvasStream) {
      setError("Video recording is not supported in this browser engine.");
      return;
    }

    const audio = audioRef.current;
    const graph = audio
      ? attachAudioGraph(audio, volumeRef.current, isMutedRef.current, (mode) => {
          setAgcMode(mode);
        })
      : null;
    if (graph) {
      setGraphAgcEnabled(graph, agcEnabledRef.current);
      if (graph.ctx.state === "suspended") await graph.ctx.resume();
    }
    const audioTrack = graph?.streamDest.stream.getAudioTracks()[0];

    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    if (audioTrack) {
      tracks.push(audioTrack);
    }
    const combinedStream = new MediaStream(tracks);

    let mimeType = "video/webm";
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) {
        mimeType = "video/webm;codecs=vp9,opus";
      } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) {
        mimeType = "video/webm;codecs=vp8,opus";
      } else if (MediaRecorder.isTypeSupported("video/mp4")) {
        mimeType = "video/mp4";
      }
    }

    videoChunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 6000000 });
    } catch {
      recorder = new MediaRecorder(combinedStream);
    }
    videoRecorderRef.current = recorder;

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
    setLastSessionDurationMs(0);
    setRecording(true);
    if (soundFx) playCyberSfx("rec");
    appendLog(`VIDEO_RECORDING_ENGAGED: 1080P FULL HD // [${recorder.mimeType || mimeType}]`);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        videoChunksRef.current.push(e.data);
        setBytes((prev) => prev + e.data.size);
      }
    };

    let timerId: number | null = null;
    if (chosenLimit.ms) {
      timerId = window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          appendLog("AUTO_LIMIT_REACHED: VIDEO_CONCLUDED");
        }
      }, chosenLimit.ms);
    }

    captureRef.current = {
      stop: () => {
        if (timerId) clearTimeout(timerId);
        if (recorder.state === "recording") recorder.stop();
      },
    };

    const videoPromise = new Promise<{ blob: Blob }>((resolve, reject) => {
      recorder.onstop = () => {
        if (timerId) clearTimeout(timerId);
        const finalBlob = new Blob(videoChunksRef.current, { type: recorder.mimeType || mimeType });
        resolve({ blob: finalBlob });
      };
      recorder.onerror = (err) => {
        if (timerId) clearTimeout(timerId);
        reject(err);
      };
    });

    recorder.start(1000);

    try {
      const { blob: finalBlob } = await videoPromise;
      const ended = Date.now();
      captureRef.current = null;
      videoRecorderRef.current = null;
      recordingRef.current = false;
      setRecording(false);
      setLastSessionDurationMs(Math.max(0, ended - begun));
      appendLog(`VIDEO_RECORDING_COMPLETE: ${formatBytes(finalBlob.size)}`);

      if (finalBlob.size === 0) {
        setError("No video stream data was captured.");
        return;
      }

      const finished: PendingTake = {
        id: crypto.randomUUID(),
        stationId: current.id,
        stationName: current.name,
        startedAt: begun,
        endedAt: ended,
        bytes: finalBlob.size,
        tracks: [...tracksRef.current],
        reason: "stopped",
        blob: finalBlob,
        fileSaved: false,
        kept: false,
        downloaded: false,
        mediaType: "video",
      };
      setPending(finished);
    } catch (err) {
      captureRef.current = null;
      videoRecorderRef.current = null;
      recordingRef.current = false;
      setRecording(false);
      setError(err instanceof Error ? err.message : "Video capture failed.");
    }
  }

  async function onRecord() {
    if (recordMode === "video") {
      await onRecordVideo();
    } else {
      await onRecordAudio();
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
        mediaType: pending.mediaType,
      };
      await saveTake(meta, pending.blob);
      setPending({ ...pending, kept: true });
      setTakes(await listTakes());
      appendLog(`TAPE_ARCHIVED: ${meta.stationName}`);
    } catch {
      setError("Local storage full for in-browser tapes. Download file directly.");
    }
  }

  function onDownload() {
    if (!pending?.blob) return;
    if (soundFx) playCyberSfx("click");
    const isVideo = pending.mediaType === "video";
    const ext = isVideo ? (pending.blob.type.includes("mp4") ? "mp4" : "webm") : "mp3";
    downloadBlob(pending.blob, recordingName(pending.stationName, new Date(pending.startedAt), ext));
    setPending({ ...pending, downloaded: true });
    appendLog(`${isVideo ? "VIDEO" : "MP3"}_EXPORTED: ${pending.stationName}`);
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
      `Type: ${pending.mediaType?.toUpperCase() ?? "AUDIO"} (1080p 60fps)`,
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
    if (playingId === meta.id || playingVideoTake?.id === meta.id) {
      stopLibraryPlayback();
      if (playingVideoTake) {
        URL.revokeObjectURL(playingVideoTake.url);
        setPlayingVideoTake(null);
      }
      return;
    }
    setError(null);
    setBusyId(meta.id);
    try {
      stopMonitor();
      const blob = await getTakeBlob(meta.id);
      if (!blob) {
        setError("Take file unavailable in local cache.");
        return;
      }
      stopLibraryPlayback();
      const url = URL.createObjectURL(blob);

      if (meta.mediaType === "video") {
        setPlayingVideoTake({ id: meta.id, url, title: meta.stationName });
        appendLog(`PLAYBACK_VIDEO_TAPE: ${meta.stationName}`);
        return;
      }

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
      const isVideo = meta.mediaType === "video";
      const ext = isVideo ? (blob.type.includes("mp4") ? "mp4" : "webm") : "mp3";
      downloadBlob(blob, recordingName(meta.stationName, new Date(meta.startedAt), ext));
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
    const nextMuted = isMutedRef.current && next > 0 ? false : isMutedRef.current;
    if (isMutedRef.current && next > 0) {
      setIsMuted(false);
      isMutedRef.current = false;
    }
    const audio = audioRef.current as (HTMLAudioElement & { __graph?: AudioGraph }) | null;
    if (audio?.__graph) {
      setGraphMonitorVolume(audio.__graph, next, nextMuted);
    } else if (audio) {
      audio.volume = next;
    }
    if (libraryAudioRef.current) libraryAudioRef.current.volume = next;
  }

  function toggleMute() {
    if (soundFx) playCyberSfx("click");
    const audio = audioRef.current as (HTMLAudioElement & { __graph?: AudioGraph }) | null;
    if (isMutedRef.current) {
      setIsMuted(false);
      isMutedRef.current = false;
      const restored = preMuteVolume.current > 0 ? preMuteVolume.current : 0.9;
      onVolume(restored);
      appendLog(`AUDIO_UNMUTED (${Math.round(restored * 100)}%)`);
    } else {
      preMuteVolume.current = volumeRef.current;
      setIsMuted(true);
      isMutedRef.current = true;
      if (audio?.__graph) {
        setGraphMonitorVolume(audio.__graph, volumeRef.current, true);
      } else if (audio) {
        audio.volume = 0;
      }
      if (libraryAudioRef.current) libraryAudioRef.current.volume = 0;
      appendLog("AUDIO_MUTED");
    }
  }

  // Keep latest shortcut handlers in refs so global keydown listener stays stable
  const onListenActionRef = useRef(onListen);
  onListenActionRef.current = onListen;
  const toggleMuteActionRef = useRef(toggleMute);
  toggleMuteActionRef.current = toggleMute;

  // Global keyboard shortcuts scoped to the radio player:
  // Space -> Play/Pause | M -> Mute | R -> Toggle Audio/Video recording mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          tag === "OPTION" ||
          target.isContentEditable
        ) {
          return;
        }
        if (tag === "VIDEO" || tag === "AUDIO") {
          return;
        }
        const insideApp =
          target === document.body ||
          target === document.documentElement ||
          Boolean(deckRef.current?.contains(target));
        if (!insideApp) return;

        if (e.code === "Space" && target.closest('button, a, summary, [role="button"]')) {
          return;
        }
      }

      const key = e.key.toLowerCase();
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        void onListenActionRef.current();
      } else if (key === "m") {
        e.preventDefault();
        toggleMuteActionRef.current();
      } else if (key === "r") {
        if (recordingRef.current || armingRef.current) return;
        e.preventDefault();
        const nextMode = recordModeRef.current === "audio" ? "video" : "audio";
        setRecordMode(nextMode);
        if (soundFx) playCyberSfx("click");
        appendLog(`CAPTURE_MODE_SWITCHED: ${nextMode === "video" ? "VIDEO (1080P)" : "AUDIO (MP3)"}`);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [soundFx]);

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
    setCustomName("");
    setCustomUrl("");
    setActiveTab("deck");
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
      subPanelBg: "bg-[#15171e]/75 border-[#382d1b]",
      recBg: "bg-[#ff2a51]",
      sliderClass: "theme-slider-gold",
      checkClass: "theme-check-gold",
      flankColor: "text-[#ffb01f]",
      battlestationBg: "cyber-battlestation-gold",
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
      subPanelBg: "bg-[#081a29]/75 border-[#004f6e]",
      recBg: "bg-[#ff2a51]",
      sliderClass: "theme-slider-cyan",
      checkClass: "theme-check-cyan",
      flankColor: "text-[#00f0ff]",
      battlestationBg: "cyber-battlestation-cyan",
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
      subPanelBg: "bg-[#180e2b]/75 border-[#501a6f]",
      recBg: "bg-[#ff2a51]",
      sliderClass: "theme-slider-purple",
      checkClass: "theme-check-purple",
      flankColor: "text-[#c026d3]",
      battlestationBg: "cyber-battlestation-purple",
      hex: "#c026d3",
    },
  }[theme];

  const parsedMeta = parseTrackMeta(nowPlaying ?? station.name);

  return (
    <div
      ref={deckRef}
      className={`flex flex-col gap-5 text-fg font-sans rounded-2xl transition-all duration-500 relative overflow-hidden ${themeClasses.battlestationBg} p-2 sm:p-5`}
      suppressHydrationWarning
    >
      {/* Custom Background Image Layer */}
      {customBgUrl && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-500"
          style={{
            backgroundImage: `url(${customBgUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: bgOpacity,
          }}
        />
      )}

      {/* Hidden File Inputs for Custom Artwork, Record Button Logo, and Background Image */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleArtworkUpload}
        className="hidden"
      />
      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void handleLogoUpload(e)}
        className="hidden"
      />
      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void handleBgUpload(e)}
        className="hidden"
      />

      {/* Ambient Cyber Flank Chevrons */}
      <div className="pointer-events-none fixed left-1.5 top-1/3 hidden 2xl:flex flex-col gap-5 z-10 opacity-60">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className={`cyber-chevron ${themeClasses.flankColor} animate-chevron-flow`} style={{ animationDelay: `${i * 180}ms` }} />
            <span className={`cyber-chevron ${themeClasses.flankColor} animate-chevron-flow`} style={{ animationDelay: `${i * 180 + 90}ms` }} />
          </div>
        ))}
      </div>
      <div className="pointer-events-none fixed right-1.5 top-1/3 hidden 2xl:flex flex-col gap-5 z-10 opacity-60 rotate-180">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className={`cyber-chevron ${themeClasses.flankColor} animate-chevron-flow`} style={{ animationDelay: `${i * 180}ms` }} />
            <span className={`cyber-chevron ${themeClasses.flankColor} animate-chevron-flow`} style={{ animationDelay: `${i * 180 + 90}ms` }} />
          </div>
        ))}
      </div>

      {/* HUD Top Header with Deck / Settings Navigation Tabs */}
      <header className={`relative z-10 rounded-xl border p-4 sm:p-5 backdrop-blur-md ${themeClasses.panelBg} ${themeClasses.hudGlow}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* OutLawZ Logo with Live Circular Emblem */}
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/80 shadow-inner overflow-hidden">
              <div className={`absolute inset-0 rounded-full border border-dashed ${themeClasses.accentBorder} opacity-50 animate-cyber-radar`} />
              <img
                src={activeLogoUrl}
                alt="OutLawZ Emblem"
                className="h-12 w-12 rounded-full object-cover"
              />
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
                <span className={`inline-block h-2 w-2 rounded-full ${recording ? "bg-red-500 animate-ping" : "bg-emerald-400 animate-pulse"}`} />
                <span>CYBER HUD // AUDIO & FULL HD 1080P RECORDER</span>
                <span className="text-white/30 hidden sm:inline">|</span>
                <span className="text-white/60 hidden sm:inline">{station.name}</span>
              </p>
            </div>
          </div>

          {/* Primary Workspace Tabs: PLAYER DECK | SETTINGS */}
          <nav className="flex items-center gap-2 bg-black/60 border border-white/10 p-1.5 rounded-xl font-orbitron text-xs" aria-label="Workspace Tabs">
            <button
              type="button"
              onClick={() => {
                setActiveTab("deck");
                if (soundFx) playCyberSfx("click");
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold tracking-wider transition-all ${
                activeTab === "deck"
                  ? `${themeClasses.accentBg} text-black ${themeClasses.hudGlow}`
                  : "text-muted hover:text-white hover:bg-white/5"
              }`}
              suppressHydrationWarning
            >
              <Radio className="h-3.5 w-3.5" />
              <span>PLAYER DECK</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("settings");
                if (soundFx) playCyberSfx("click");
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold tracking-wider transition-all ${
                activeTab === "settings"
                  ? `${themeClasses.accentBg} text-black ${themeClasses.hudGlow}`
                  : "text-muted hover:text-white hover:bg-white/5"
              }`}
              suppressHydrationWarning
            >
              <Settings className="h-3.5 w-3.5" />
              <span>SETTINGS</span>
            </button>
          </nav>
        </div>
      </header>

      {/* SETTINGS TAB: All Theme, Logo, Background, Audio Engine, Limit, Direct Sink, Custom Feed & Artwork Controls */}
      {activeTab === "settings" && (
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 1. Theme, SFX & Custom Background Image */}
          <section className={`rounded-xl border p-5 backdrop-blur-md ${themeClasses.panelBg} flex flex-col gap-4`}>
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <ImageIcon className={`h-4 w-4 ${themeClasses.accentText}`} />
              <h2 className="font-orbitron text-sm font-bold tracking-wider uppercase text-white">
                THEME, AUDIO FX & CUSTOM BACKGROUND
              </h2>
            </div>

            <div>
              <p className="font-tech text-xs text-muted mb-2 uppercase tracking-wider">Battlestation Color Profile</p>
              <div className="flex flex-wrap items-center gap-2 text-xs font-tech">
                <button
                  type="button"
                  onClick={() => {
                    setTheme("gold");
                    if (soundFx) playCyberSfx("click");
                  }}
                  className={`px-3 py-2 rounded-lg border transition-all flex items-center gap-2 ${
                    theme === "gold"
                      ? "bg-[#ffb01f] text-black font-bold border-[#ffb01f] shadow-[0_0_12px_rgba(255,176,31,0.5)]"
                      : "bg-black/40 text-[#ffb01f] border-[#ffb01f]/30 hover:border-[#ffb01f]"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-current" />
                  AMBER GOLD
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTheme("cyan");
                    if (soundFx) playCyberSfx("click");
                  }}
                  className={`px-3 py-2 rounded-lg border transition-all flex items-center gap-2 ${
                    theme === "cyan"
                      ? "bg-[#00f0ff] text-black font-bold border-[#00f0ff] shadow-[0_0_12px_rgba(0,240,255,0.5)]"
                      : "bg-black/40 text-[#00f0ff] border-[#00f0ff]/30 hover:border-[#00f0ff]"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-current" />
                  CYBER CYAN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTheme("purple");
                    if (soundFx) playCyberSfx("click");
                  }}
                  className={`px-3 py-2 rounded-lg border transition-all flex items-center gap-2 ${
                    theme === "purple"
                      ? "bg-[#c026d3] text-white font-bold border-[#c026d3] shadow-[0_0_12px_rgba(192,38,211,0.5)]"
                      : "bg-black/40 text-[#c026d3] border-[#c026d3]/30 hover:border-[#c026d3]"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-current" />
                  RGB PURPLE
                </button>

                <button
                  type="button"
                  onClick={() => setSoundFx(!soundFx)}
                  className={`ml-auto px-3 py-2 rounded-lg border text-xs transition-colors ${
                    soundFx ? "border-emerald-500/40 text-emerald-400 bg-emerald-950/20" : "border-white/10 text-muted bg-black/40"
                  }`}
                >
                  TACTILE SFX: {soundFx ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            {/* Custom Background Image */}
            <div className="pt-3 border-t border-white/10">
              <p className="font-tech text-xs text-muted mb-2 uppercase tracking-wider">Custom Battlestation Background Image</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => bgInputRef.current?.click()}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border font-tech text-xs transition-colors ${themeClasses.badgeBg} hover:opacity-90`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{customBgUrl ? "CHANGE BACKGROUND IMAGE" : "UPLOAD BACKGROUND IMAGE"}</span>
                </button>
                {customBgUrl && (
                  <button
                    type="button"
                    onClick={clearCustomBg}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-500/40 bg-red-950/20 text-red-400 font-tech text-xs hover:bg-red-900/30"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>CLEAR BG</span>
                  </button>
                )}
              </div>

              {customBgUrl && (
                <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3 bg-black/50 border border-white/10 p-3 rounded-lg">
                  <img
                    src={customBgUrl}
                    alt="Custom Background Preview"
                    className="h-14 w-24 object-cover rounded border border-white/20 shrink-0"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs font-tech mb-1">
                      <label htmlFor={bgOpacityId} className="text-muted">BACKDROP OPACITY</label>
                      <span className="text-white">{Math.round(bgOpacity * 100)}%</span>
                    </div>
                    <input
                      id={bgOpacityId}
                      type="range"
                      min="0.1"
                      max="0.85"
                      step="0.05"
                      value={bgOpacity}
                      onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                      className={`w-full cursor-pointer ${themeClasses.sliderClass}`}
                      style={{ accentColor: themeClasses.hex }}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 2. Record Button Logo & Vinyl Badge Selector */}
          <section className={`rounded-xl border p-5 backdrop-blur-md ${themeClasses.panelBg} flex flex-col gap-4`}>
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Disc className={`h-4 w-4 ${themeClasses.accentText}`} />
                <h2 className="font-orbitron text-sm font-bold tracking-wider uppercase text-white">
                  RECORD BUTTON LOGO & VINYL EMBLEM
                </h2>
              </div>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-tech text-xs ${themeClasses.badgeBg}`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>UPLOAD CUSTOM LOGO</span>
              </button>
            </div>

            <div className="flex items-center gap-4 bg-black/50 border border-white/10 rounded-lg p-3">
              <div className={`h-16 w-16 rounded-full border-2 ${themeClasses.accentBorder} overflow-hidden shrink-0`}>
                <img src={activeLogoUrl} alt="Active Record Button Logo" className="h-full w-full object-cover" />
              </div>
              <div className="flex-1 min-w-0 font-tech text-xs">
                <p className="text-white font-bold uppercase">
                  {selectedLogoId === "custom"
                    ? "CUSTOM UPLOADED LOGO ACTIVE"
                    : selectedLogoId === "auto"
                    ? "AUTO-MATCHED TO ACTIVE THEME"
                    : LOGO_PRESETS.find((p) => p.id === selectedLogoId)?.label ?? "OUTLAWZ EMBLEM"}
                </p>
                <p className="text-muted mt-0.5">
                  Displayed on the circular ENGAGE RECORD button and on the 16:9 spinning vinyl core when track art is unavailable.
                </p>
              </div>
              {selectedLogoId !== "auto" && (
                <button
                  type="button"
                  onClick={resetCustomLogo}
                  className="px-2.5 py-1.5 rounded border border-white/20 text-xs font-tech text-muted hover:text-white"
                >
                  AUTO
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
              {LOGO_PRESETS.map((preset) => {
                const isSelected = selectedLogoId === preset.id || (selectedLogoId === "auto" && getThemeDefaultLogo(theme) === preset.src);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setSelectedLogoId(preset.id);
                      if (soundFx) playCyberSfx("click");
                      appendLog(`RECORD_LOGO_PRESET: ${preset.label.toUpperCase()}`);
                    }}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${
                      isSelected
                        ? `${themeClasses.accentBorder} bg-white/10 ring-1 ${themeClasses.ringColor}`
                        : "border-white/10 bg-black/40 hover:border-white/30"
                    }`}
                    title={preset.label}
                  >
                    <img
                      src={preset.src}
                      alt={preset.label}
                      className="h-12 w-12 rounded-full object-cover border border-white/20"
                    />
                    <span className="font-tech text-[10px] text-white/80 truncate w-full text-center">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Recording Limits, AGC Normalizer & Hardware Switches */}
          <section className={`rounded-xl border p-5 backdrop-blur-md ${themeClasses.panelBg} flex flex-col gap-4`}>
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <SlidersHorizontal className={`h-4 w-4 ${themeClasses.accentText}`} />
              <h2 className="font-orbitron text-sm font-bold tracking-wider uppercase text-white">
                RECORDING TIMERS, AGC & HARDWARE SWITCHES
              </h2>
            </div>

            <div>
              <p className="font-tech text-xs text-muted mb-2 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Auto-Stop Recording Time Limit</span>
              </p>
              <div className="flex flex-wrap items-center gap-2 bg-black/40 border border-white/10 p-2 rounded-lg font-tech text-xs">
                {LIMITS.map((lim) => (
                  <button
                    key={lim.id}
                    type="button"
                    disabled={recording}
                    onClick={() => {
                      setLimitId(lim.id);
                      if (soundFx) playCyberSfx("click");
                    }}
                    className={`px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
                      limitId === lim.id
                        ? `${themeClasses.accentBg} text-black font-bold`
                        : "text-muted hover:text-white bg-white/5"
                    }`}
                  >
                    {lim.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-tech text-xs">
              <button
                type="button"
                onClick={() => {
                  setAgcEnabled((prev) => {
                    const next = !prev;
                    appendLog(`AGC_NORMALIZER: ${next ? "ENGAGED" : "BYPASSED"}`);
                    return next;
                  });
                  if (soundFx) playCyberSfx("click");
                }}
                className={`flex items-center justify-between border px-3.5 py-3 rounded-lg transition-colors ${
                  agcEnabled
                    ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
                    : "bg-black/40 border-white/10 text-muted hover:border-white/20"
                }`}
              >
                <span className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>AUTO-GAIN CONTROL (AGC)</span>
                </span>
                <span className="font-bold">{agcEnabled ? "ON" : "OFF"}</span>
              </button>

              <label className="flex items-center justify-between bg-black/40 border border-white/10 px-3.5 py-3 rounded-lg text-white/80 cursor-pointer hover:border-white/20">
                <span>MONITOR WHILE RECORDING</span>
                <input
                  type="checkbox"
                  checked={monitor}
                  disabled={recording}
                  onChange={(e) => setMonitor(e.target.checked)}
                  className={`rounded border-line focus:ring-0 ${themeClasses.checkClass}`}
                  style={{ accentColor: themeClasses.hex }}
                />
              </label>

              <label
                className={`flex items-center justify-between bg-black/40 border border-white/10 px-3.5 py-3 rounded-lg text-white/80 ${
                  canDirect ? "cursor-pointer hover:border-white/20" : "opacity-50 cursor-not-allowed"
                }`}
              >
                <span>DIRECT DISK SINK {canDirect ? "" : "(UNSUPPORTED)"}</span>
                <input
                  type="checkbox"
                  checked={saveDirect}
                  disabled={recording || !canDirect}
                  onChange={(e) => setSaveDirect(e.target.checked)}
                  className={`rounded border-line focus:ring-0 ${themeClasses.checkClass}`}
                  style={{ accentColor: themeClasses.hex }}
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  setVisualizerEnabled((v) => !v);
                  if (soundFx) playCyberSfx("click");
                }}
                className={`flex items-center justify-between border px-3.5 py-3 rounded-lg transition-colors ${
                  visualizerEnabled ? themeClasses.badgeBg : "bg-black/40 border-white/10 text-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  {visualizerEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  <span>D3 LIVE VISUALIZER</span>
                </span>
                <span className="font-bold">{visualizerEnabled ? "DYNAMIC" : "STATIC"}</span>
              </button>
            </div>
          </section>

          {/* 4. Custom Stream Feed & Custom Vinyl Artwork */}
          <section className={`rounded-xl border p-5 backdrop-blur-md ${themeClasses.panelBg} flex flex-col gap-4`}>
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <Plus className={`h-4 w-4 ${themeClasses.accentText}`} />
              <h2 className="font-orbitron text-sm font-bold tracking-wider uppercase text-white">
                CUSTOM RADIO FEED & VINYL ARTWORK
              </h2>
            </div>

            <div className="flex flex-col gap-2.5 font-tech text-xs">
              <p className="text-muted uppercase tracking-wider">Add Custom Icecast / MP3 Stream Feed</p>
              <input
                type="text"
                placeholder="Station Name (e.g. Cyberpunk FM)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="bg-black/80 border border-white/20 rounded-lg px-3 py-2 text-fg focus:border-cyan outline-none"
              />
              <input
                type="url"
                placeholder="Stream URL (https://...)"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                className="bg-black/80 border border-white/20 rounded-lg px-3 py-2 text-fg focus:border-cyan outline-none font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={addCustomStation}
                disabled={!customName.trim() || !customUrl.trim()}
                className={`px-4 py-2 rounded-lg font-bold ${themeClasses.accentBg} text-black disabled:opacity-40 self-start`}
              >
                LOCK IN CUSTOM FEED
              </button>
            </div>

            <div className="pt-3 border-t border-white/10 font-tech text-xs">
              <p className="text-muted uppercase tracking-wider mb-2">Custom Vinyl Center Artwork (1080p Video Mode)</p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border transition-colors ${
                    customArtworkUrl
                      ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-300"
                      : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{customArtworkUrl ? "CHANGE CUSTOM ALBUM ART" : "UPLOAD CUSTOM ALBUM ART"}</span>
                </button>
                {customArtworkUrl && (
                  <button
                    type="button"
                    onClick={removeCustomArtwork}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/20 text-white/70 hover:text-white"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>REVERT TO AUTO ITUNES ART</span>
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* PLAYER DECK TAB */}
      {activeTab === "deck" && (
        <>
          {/* Station Selector Bar */}
          <section className={`relative z-10 rounded-xl border p-3.5 backdrop-blur-md ${themeClasses.panelBg}`} suppressHydrationWarning>
            <div className="flex items-center justify-between mb-2.5 px-1">
              <div className="flex items-center gap-2">
                <Radio className={`h-4 w-4 ${themeClasses.accentText}`} />
                <span className="font-tech text-xs tracking-widest uppercase text-muted">TRANSMISSION FREQUENCIES</span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("settings")}
                className={`font-tech text-xs inline-flex items-center gap-1 border px-2 py-1 rounded transition-colors ${themeClasses.badgeBg}`}
                suppressHydrationWarning
              >
                <Settings className="h-3 w-3" />
                <span>CONFIGURE IN SETTINGS</span>
              </button>
            </div>

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

          {/* Main HUD Deck: Player, Expandable Metadata, Digital Timer/Status, 1080p D3 Stage, and Monitor Controls */}
          <section className={`relative z-10 rounded-xl border p-4 sm:p-6 backdrop-blur-md ${themeClasses.panelBg} overflow-hidden`} suppressHydrationWarning>
            {/* Decorative HUD Corner Accents */}
            <div className={`absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />
            <div className={`absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />
            <div className={`absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />
            <div className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 ${themeClasses.accentBorder} m-1 pointer-events-none`} />

            {/* Station Live Meta Banner & Circular Logo Record Button */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-white/10 pb-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-tech font-bold uppercase tracking-widest ${themeClasses.badgeBg}`}>
                    ON AIR
                  </span>
                  <span className="font-tech text-xs text-muted">SIGNAL 100% // {station.name}</span>
                </div>

                {/* Track Title */}
                <h2 className="mt-1.5 font-orbitron text-xl sm:text-2xl font-bold tracking-wide text-white truncate drop-shadow-md">
                  {parsedMeta.title || (nowPlaying ?? "Waiting for broadcast metadata...")}
                </h2>

                {/* Artist Subhead */}
                <p className={`font-rajdhani text-sm sm:text-base font-semibold ${themeClasses.accentText} uppercase tracking-wider`}>
                  {parsedMeta.artist}
                </p>

                {/* Stream Telemetry & Expand/Collapse Details Interaction */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-tech text-muted">
                  <span className="flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5" style={{ color: themeClasses.hex }} />
                    <span className="text-white/80">{station.bitrate} kbps Icecast MP3</span>
                  </span>
                  <span className="text-white/30">•</span>
                  <span className="flex items-center gap-1">
                    <Activity className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Peak: {peakDb}</span>
                  </span>
                  <span className="text-white/30">•</span>
                  <span className="flex items-center gap-1">
                    <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: themeClasses.hex }} />
                    <span className={agcEnabled ? "text-emerald-400" : "text-white/50"}>
                      AGC: {agcEnabled ? `${agcGainDb >= 0 ? "+" : ""}${agcGainDb.toFixed(1)} dB` : "BYPASS"}
                    </span>
                  </span>

                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDetailsExpanded((prev) => !prev);
                        if (soundFx) playCyberSfx("click");
                      }}
                      aria-expanded={detailsExpanded}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-tech transition-colors ${
                        detailsExpanded ? themeClasses.badgeBg : "border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                      }`}
                      suppressHydrationWarning
                    >
                      <Server className="h-3 w-3" />
                      <span>{detailsExpanded ? "COLLAPSE DETAILS" : "EXPAND DETAILS"}</span>
                      {detailsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (soundFx) playCyberSfx("click");
                        const url = getYouTubeSearchUrl(parsedMeta.artist, parsedMeta.title);
                        window.open(url, "_blank", "noopener,noreferrer");
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-red-500/40 bg-red-950/20 text-red-400 hover:bg-red-900/30 font-tech text-[11px] transition-colors"
                      title="Search this track on YouTube"
                      suppressHydrationWarning
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>YOUTUBE SEARCH</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Master Controls: Capture Mode Toggle & Circular Record Button with OutLawZ Badge Logo */}
              <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
                {/* Capture Mode Toggle: AUDIO (MP3) vs VIDEO (1080p Full HD) */}
                <div className="flex items-center gap-1 bg-black/60 border border-white/10 p-1 rounded-xl shadow-inner font-tech" suppressHydrationWarning>
                  <button
                    type="button"
                    disabled={recording}
                    onClick={() => {
                      setRecordMode("audio");
                      if (soundFx) playCyberSfx("click");
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-orbitron font-bold transition-all ${
                      recordMode === "audio"
                        ? `${themeClasses.accentBg} text-black shadow-[0_0_12px_rgba(255,255,255,0.15)]`
                        : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                    suppressHydrationWarning
                  >
                    <Radio className="h-3.5 w-3.5" />
                    <span>AUDIO (MP3)</span>
                  </button>
                  <button
                    type="button"
                    disabled={recording}
                    onClick={() => {
                      setRecordMode("video");
                      if (soundFx) playCyberSfx("click");
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-orbitron font-bold transition-all ${
                      recordMode === "video"
                        ? "bg-red-500 text-white shadow-[0_0_15px_rgba(255,42,81,0.6)]"
                        : "text-muted hover:text-white hover:bg-white/5"
                    }`}
                    suppressHydrationWarning
                  >
                    <VideoIcon className="h-3.5 w-3.5" />
                    <span>VIDEO (1080P)</span>
                  </button>
                </div>

                {/* Circular Record Core Button featuring Selected OutLawZ Logo */}
                <button
                  type="button"
                  onClick={() => void onRecord()}
                  disabled={arming || (blocked && !recording)}
                  aria-pressed={recording}
                  className="group relative flex flex-col items-center gap-1.5 focus:outline-none disabled:opacity-50"
                  suppressHydrationWarning
                >
                  <div
                    className={`relative grid h-20 w-20 sm:h-24 sm:w-24 place-items-center rounded-full border-2 transition-transform duration-300 overflow-hidden ${
                      recording
                        ? "border-red-500 bg-red-950/40 shadow-[0_0_30px_rgba(255,42,81,0.8)] scale-105"
                        : arming
                        ? "border-amber-400 bg-amber-950/40 shadow-[0_0_20px_rgba(251,191,36,0.5)]"
                        : `${themeClasses.accentBorder} bg-black/90 hover:scale-105 shadow-[0_0_24px_rgba(255,255,255,0.12)]`
                    }`}
                  >
                    {recording && (
                      <div className="absolute inset-0 rounded-full border-2 border-red-500/80 animate-ping opacity-75 pointer-events-none z-20" />
                    )}

                    {/* Custom or Preset OutLawZ Logo Image directly inside the Record Button */}
                    <img
                      src={activeLogoUrl}
                      alt="Record Button Emblem"
                      className={`h-full w-full rounded-full object-cover transition-transform duration-500 ${
                        recording ? "opacity-50 animate-spin" : listening ? "animate-spin" : "group-hover:scale-105"
                      }`}
                      style={{ animationDuration: recording ? "6s" : "10s" }}
                    />

                    {/* Subtle inner glowing rim */}
                    <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/20" />

                    {/* Recording Stop Square / Arming Indicator Overlay */}
                    {recording && (
                      <div className="absolute inset-0 bg-red-950/45 flex items-center justify-center z-10">
                        <div className="h-7 w-7 rounded-md bg-red-500 shadow-[0_0_16px_#ff2a51] animate-pulse border border-white/50" />
                      </div>
                    )}
                    {arming && !recording && (
                      <div className="absolute inset-0 bg-amber-950/50 flex items-center justify-center z-10">
                        <div className="h-6 w-6 rounded-sm bg-amber-400 animate-spin" />
                      </div>
                    )}
                  </div>
                  <span
                    className={`font-orbitron text-xs sm:text-sm font-black tracking-widest ${
                      recording ? "text-red-400 animate-pulse" : themeClasses.accentText
                    }`}
                  >
                    {arming
                      ? "ARMING..."
                      : recording
                      ? "STOP REC"
                      : recordMode === "video"
                      ? "REC VIDEO"
                      : "ENGAGE RECORD"}
                  </span>
                </button>
              </div>
            </div>

            {/* Expand/Collapse Metadata & Server Node Panel */}
            {detailsExpanded && (
              <div className="mt-4 rounded-xl border border-white/15 bg-black/65 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-tech text-xs">
                <div className="rounded-lg border border-white/10 bg-black/50 p-3">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider mb-1">
                    <Gauge className="h-3.5 w-3.5" style={{ color: themeClasses.hex }} />
                    <span>STREAM & CAPTURE BITRATE</span>
                  </div>
                  <p className="text-white font-bold">{station.bitrate} kbps Broadcast</p>
                  <p className="text-muted text-[11px] mt-0.5">Rec Target: {activeRecordingBitrate}</p>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/50 p-3">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider mb-1">
                    <Cpu className="h-3.5 w-3.5" style={{ color: themeClasses.hex }} />
                    <span>CODEC INFORMATION</span>
                  </div>
                  <p className="text-white font-bold truncate">{recordMode === "video" ? "VP9 / H.264 + Opus" : "MPEG-1 Layer 3 (MP3)"}</p>
                  <p className="text-muted text-[11px] mt-0.5 truncate" title={activeCodecLabel}>{activeCodecLabel}</p>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/50 p-3">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider mb-1">
                    <Server className="h-3.5 w-3.5" style={{ color: themeClasses.hex }} />
                    <span>SERVER NODE</span>
                  </div>
                  <p className="text-white font-bold truncate" title={serverNode.host}>{serverNode.host}</p>
                  <p className="text-muted text-[11px] mt-0.5 truncate">
                    {serverNode.protocol} • {serverNode.path}
                  </p>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/50 p-3">
                  <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider mb-1">
                    <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: themeClasses.hex }} />
                    <span>DSP ENGINE & METADATA NODE</span>
                  </div>
                  <p className="text-white font-bold">
                    {sampleRate.toLocaleString()} Hz • AGC {agcEnabled ? agcMode.toUpperCase() : "OFF"}
                  </p>
                  <p className="text-muted text-[11px] mt-0.5 truncate" title={statusNode.host}>
                    ICY Node: {statusNode.host}
                  </p>
                </div>
              </div>
            )}

            {/* Digital Timer Display, Duration Counter & Recording Status Section */}
            <div
              className={`mt-4 rounded-xl border p-3.5 grid grid-cols-2 lg:grid-cols-5 gap-3 items-center font-tech transition-colors ${
                recording
                  ? "border-red-500/60 bg-red-950/25 shadow-[0_0_20px_rgba(255,42,81,0.18)]"
                  : "border-white/10 bg-black/55"
              }`}
              suppressHydrationWarning
            >
              {/* Digital Recording Timer */}
              <div className="col-span-2 lg:col-span-1 flex items-center gap-3 border-b lg:border-b-0 lg:border-r border-white/10 pb-2 lg:pb-0 lg:pr-3">
                <div
                  className={`h-3 w-3 rounded-full shrink-0 ${
                    recording ? "bg-red-500 shadow-[0_0_10px_#ff2a51] animate-ping" : "bg-white/20"
                  }`}
                />
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted flex items-center gap-1">
                    <Timer className="h-3 w-3" style={{ color: recording ? "#ff2a51" : themeClasses.hex }} />
                    <span>DIGITAL REC TIMER</span>
                  </div>
                  <div
                    className={`font-orbitron text-xl sm:text-2xl font-black tracking-wider tabular-nums ${
                      recording ? "text-red-400" : "text-white/90"
                    }`}
                  >
                    {formatDuration(elapsed)}
                  </div>
                </div>
              </div>

              {/* Stream Duration Counter */}
              <div className="px-1">
                <div className="text-[10px] uppercase tracking-widest text-muted">STREAM RECORDED</div>
                <div className="font-mono text-sm sm:text-base font-bold text-white tabular-nums mt-0.5">
                  {formatDuration(displayDurationMs)}
                </div>
                <div className="text-[10px] text-white/40">
                  {recording ? "CAPTURING LIVE" : lastSessionDurationMs > 0 ? "LAST SESSION" : "STANDBY"}
                </div>
              </div>

              {/* Recording Bitrate */}
              <div className="px-1">
                <div className="text-[10px] uppercase tracking-widest text-muted">RECORDING BITRATE</div>
                <div className={`text-sm font-bold mt-0.5 ${themeClasses.accentText}`}>{activeRecordingBitrate}</div>
                <div className="text-[10px] text-white/40 uppercase">{recordMode} MODE</div>
              </div>

              {/* Captured File Size */}
              <div className="px-1">
                <div className="text-[10px] uppercase tracking-widest text-muted flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  <span>CAPTURED SIZE</span>
                </div>
                <div className="font-mono text-sm sm:text-base font-bold text-white tabular-nums mt-0.5">
                  {formatBytes(bytes)}
                </div>
                <div className="text-[10px] text-white/40">{saveDirect ? "DIRECT DISK" : "MEMORY BUFFER"}</div>
              </div>

              {/* Estimated Time Remaining */}
              <div className="px-1">
                <div className="text-[10px] uppercase tracking-widest text-muted">EST. TIME REMAINING</div>
                <div className="font-mono text-sm sm:text-base font-bold text-white tabular-nums mt-0.5">
                  {remaining !== null ? formatDuration(remaining) : "UNLIMITED"}
                </div>
                <div className="text-[10px] text-white/40">
                  {limit.ms ? `LIMIT: ${limit.label.toUpperCase()}` : "MANUAL STOP"}
                </div>
              </div>
            </div>

            {/* 1920x1080 Responsive 16:9 Full HD D3 Canvas Stage with Cyber Scanlines */}
            <div className="mt-4 rounded-xl border border-white/10 bg-black/90 p-2 sm:p-3 relative overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
                <div className="flex items-center gap-2 font-tech text-xs text-muted">
                  <Activity className={`h-3.5 w-3.5 ${themeClasses.accentText}`} />
                  <span className="tracking-wider uppercase">16:9 FULL HD D3 STUDIO STAGE</span>
                  <span className="text-white/30 hidden sm:inline">•</span>
                  <span className="text-white/50 hidden sm:inline">1920×1080 60FPS</span>
                  {artworkLoading && (
                    <span className="text-cyan text-[11px] animate-pulse hidden sm:inline">// FETCHING ARTWORK...</span>
                  )}
                </div>

                {/* Visualizer Mode Switcher & Toggle Visualizer Button */}
                <div className="flex flex-wrap items-center gap-1.5 font-tech text-[11px]" suppressHydrationWarning>
                  <button
                    type="button"
                    onClick={() => {
                      setVisualizerEnabled((prev) => {
                        const next = !prev;
                        appendLog(`D3_VISUALIZER: ${next ? "DYNAMIC MODE" : "STATIC LAYOUT"}`);
                        return next;
                      });
                      if (soundFx) playCyberSfx("click");
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border font-bold transition-colors ${
                      visualizerEnabled
                        ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-300"
                        : "border-amber-500/40 bg-amber-950/20 text-amber-300"
                    }`}
                    suppressHydrationWarning
                  >
                    {visualizerEnabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    <span>Toggle Visualizer</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setVizMode("spectrum");
                      if (!visualizerEnabled) setVisualizerEnabled(true);
                      if (soundFx) playCyberSfx("click");
                    }}
                    className={`px-2 py-0.5 rounded border transition-colors ${
                      vizMode === "spectrum" && visualizerEnabled
                        ? themeClasses.badgeBg
                        : "border-white/10 text-muted hover:text-fg"
                    }`}
                    suppressHydrationWarning
                  >
                    SPECTRUM
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVizMode("oscilloscope");
                      if (!visualizerEnabled) setVisualizerEnabled(true);
                      if (soundFx) playCyberSfx("click");
                    }}
                    className={`px-2 py-0.5 rounded border transition-colors ${
                      vizMode === "oscilloscope" && visualizerEnabled
                        ? themeClasses.badgeBg
                        : "border-white/10 text-muted hover:text-fg"
                    }`}
                    suppressHydrationWarning
                  >
                    LASER WAVE
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVizMode("reactor");
                      if (!visualizerEnabled) setVisualizerEnabled(true);
                      if (soundFx) playCyberSfx("click");
                    }}
                    className={`px-2 py-0.5 rounded border transition-colors ${
                      vizMode === "reactor" && visualizerEnabled
                        ? themeClasses.badgeBg
                        : "border-white/10 text-muted hover:text-fg"
                    }`}
                    suppressHydrationWarning
                  >
                    REACTOR RADAR
                  </button>
                </div>
              </div>

              {/* Master 1920x1080 Canvas with CSS Scanline Overlay */}
              <div className="relative rounded-lg overflow-hidden border border-white/10 shadow-2xl">
                <canvas
                  ref={canvasRef}
                  width={1920}
                  height={1080}
                  className="w-full aspect-video block bg-[#06080d] object-contain"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 opacity-25"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(0deg, rgba(0,0,0,0.65) 0px, rgba(0,0,0,0.65) 1px, transparent 1px, transparent 4px)",
                  }}
                />
              </div>

              {/* Quick Audio Telemetry Meters Bar */}
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

            {/* Streamlined Live Monitor Control Bar & Shortcut Legend */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4" suppressHydrationWarning>
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
                    {isMuted || volume === 0 ? (
                      <VolumeX className="h-4 w-4 text-red-400" />
                    ) : (
                      <Volume2 className="h-4 w-4" style={{ color: themeClasses.hex }} />
                    )}
                  </button>
                  <input
                    id={volumeSliderId}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => onVolume(parseFloat(e.target.value))}
                    className={`h-1.5 w-24 sm:w-32 cursor-pointer ${themeClasses.sliderClass}`}
                    style={{ accentColor: themeClasses.hex }}
                    aria-label="Volume"
                    suppressHydrationWarning
                  />
                  <label htmlFor={volumeSliderId} className="font-tech text-xs text-white/70 w-8 text-right cursor-pointer">
                    {isMuted ? "MUT" : `${Math.round(volume * 100)}%`}
                  </label>
                </div>
              </div>

              {/* Keyboard Shortcut Legend */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-tech text-white/50">
                <span className="inline-flex items-center gap-1 text-white/60">
                  <Keyboard className="h-3.5 w-3.5" style={{ color: themeClasses.hex }} />
                  <span>SHORTCUTS:</span>
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-black/60 border border-white/15 text-white/80">SPACE</kbd> Play / Pause
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-black/60 border border-white/15 text-white/80">M</kbd> Mute
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-black/60 border border-white/15 text-white/80">R</kbd> Audio / Video
                </span>
              </div>
            </div>
          </section>

          {/* Cyber Diagnostics & Stream Logs Console */}
          <section className={`relative z-10 rounded-xl border p-4 backdrop-blur-md ${themeClasses.subPanelBg} font-tech text-xs`} suppressHydrationWarning>
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
            <div className="relative z-10 rounded-xl border border-red-500/50 bg-red-950/30 p-4 text-sm text-red-400 font-tech">
              <p className="font-bold">SYSTEM ERROR:</p>
              <p className="mt-0.5">{error}</p>
            </div>
          )}

          {notice && (
            <div className={`relative z-10 rounded-xl border ${themeClasses.accentBorder} bg-black/60 p-4 text-sm ${themeClasses.accentText} font-tech`}>
              <p>{notice}</p>
            </div>
          )}

          {/* Pending Take Ready Modal / Card */}
          {pending && (
            <section className={`relative z-10 rounded-xl border-2 ${themeClasses.accentBorder} bg-black/90 p-5 backdrop-blur-lg ${themeClasses.hudGlow}`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    {pending.mediaType === "video" ? (
                      <VideoIcon className="h-4 w-4 text-red-400 animate-pulse" />
                    ) : (
                      <Disc className={`h-4 w-4 ${themeClasses.accentText} animate-spin`} />
                    )}
                    <span className={`font-orbitron text-xs font-bold tracking-widest uppercase ${pending.mediaType === "video" ? "text-red-400" : themeClasses.accentText}`}>
                      {pending.mediaType === "video" ? "VIDEO TAKE READY (1080P FULL HD)" : "AUDIO TAKE READY FOR DISPOSITION"}
                    </span>
                  </div>
                  <h3 className="font-orbitron text-lg font-bold text-white mt-1">
                    {pending.stationName} · {formatDuration(pending.endedAt - pending.startedAt)} ({formatBytes(pending.bytes)})
                  </h3>
                  <p className="text-xs font-tech text-muted mt-1">
                    {pending.fileSaved
                      ? "Take successfully flushed straight into selected disk file."
                      : pending.mediaType === "video"
                      ? "Full HD 1080p visualizer and synchronized audio captured in memory. Save to device or archive in vault."
                      : "Audio capture ready in memory. Save MP3 to device or archive in browser vault."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 font-tech">
                  {!pending.fileSaved && (
                    <>
                      <button
                        type="button"
                        onClick={onDownload}
                        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-black ${
                          pending.mediaType === "video" ? "bg-red-500 text-white" : themeClasses.accentBg
                        } transition-transform hover:scale-105 shadow-md`}
                        suppressHydrationWarning
                      >
                        {pending.mediaType === "video" ? <VideoIcon className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                        <span>{pending.mediaType === "video" ? "SAVE VIDEO (.WEBM)" : "SAVE MP3"}</span>
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

              {/* Inline Video Playback Preview for Pending Video */}
              {pending.mediaType === "video" && pending.blob && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="font-tech text-xs text-muted mb-2 flex items-center gap-1.5">
                    <VideoIcon className="h-3.5 w-3.5 text-red-400" />
                    <span>VIDEO PREVIEW // 1080P SYNCED AUDIO VISUALIZER</span>
                  </p>
                  <video
                    src={URL.createObjectURL(pending.blob)}
                    controls
                    playsInline
                    className="w-full max-h-72 rounded-lg bg-black border border-white/20 object-contain"
                  />
                </div>
              )}
            </section>
          )}

          {/* Cyber Tape Library / Saved Recordings Vault */}
          <section className={`relative z-10 rounded-xl border p-5 backdrop-blur-md ${themeClasses.panelBg}`} suppressHydrationWarning>
            <div className="flex items-center justify-between border-b border-white/10 pb-3" suppressHydrationWarning>
              <div className="flex items-center gap-2" suppressHydrationWarning>
                <Layers className={`h-4 w-4 ${themeClasses.accentText}`} />
                <h3 className="font-orbitron text-base sm:text-lg font-bold text-white tracking-wide" suppressHydrationWarning>
                  RECORDING ARCHIVE VAULT {takes.length > 0 && <span className={`${themeClasses.accentText} text-xs ml-2`}>[{takes.length} TAPES]</span>}
                </h3>
              </div>
            </div>

            {/* Active Video Tape Player in Vault */}
            {playingVideoTake && (
              <div className="my-4 p-4 rounded-xl border-2 border-red-500/50 bg-black/95 shadow-[0_0_25px_rgba(255,42,81,0.25)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-orbitron text-xs font-bold text-white">
                    <VideoIcon className="h-4 w-4 text-red-400" />
                    <span>PLAYING ARCHIVED VIDEO: {playingVideoTake.title}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(playingVideoTake.url);
                      setPlayingVideoTake(null);
                    }}
                    className="font-tech text-xs text-muted hover:text-white px-2 py-0.5 border border-white/20 rounded hover:border-white/40"
                  >
                    CLOSE VIDEO
                  </button>
                </div>
                <video
                  src={playingVideoTake.url}
                  controls
                  autoPlay
                  playsInline
                  className="w-full max-h-80 rounded bg-black border border-white/20 object-contain"
                />
              </div>
            )}

            {takes.length === 0 ? (
              <div className="py-8 text-center font-tech text-muted text-xs">
                <Disc className="h-8 w-8 mx-auto text-white/20 mb-2" />
                <p>NO ARCHIVED TAPES IN LOCAL BROWSER STORAGE.</p>
                <p className="mt-1 text-white/40">Record any stream and click &quot;Keep in Browser&quot; to archive takes locally.</p>
              </div>
            ) : (
              <div className="mt-3 divide-y divide-white/10 font-tech">
                {takes.map((take) => {
                  const isPlaying = playingId === take.id || playingVideoTake?.id === take.id;
                  const isBusy = busyId === take.id;
                  const duration = take.endedAt - take.startedAt;
                  const isVideo = take.mediaType === "video";
                  return (
                    <div key={take.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3.5 gap-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-orbitron text-sm font-bold text-white truncate">{take.stationName}</p>
                          {isVideo ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/40">
                              🎬 VIDEO 1080P
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white/70 border border-white/20">
                              🎵 MP3
                            </span>
                          )}
                        </div>
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
                              ? isVideo
                                ? "bg-red-500 text-white shadow-[0_0_10px_#ff2a51]"
                                : `${themeClasses.accentBg} text-black shadow-[0_0_10px_currentColor]`
                              : "border border-white/20 text-white hover:border-white/40 bg-black/40"
                          }`}
                          suppressHydrationWarning
                        >
                          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : isVideo ? <VideoIcon className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                          <span>{isPlaying ? "STOP" : isVideo ? "WATCH" : "PLAY"}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void onDownloadTake(take)}
                          className="inline-flex items-center gap-1.5 rounded border border-white/20 bg-black/40 px-3 py-1.5 text-muted hover:text-white hover:border-white/40"
                          suppressHydrationWarning
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>{isVideo ? "VIDEO" : "MP3"}</span>
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
        </>
      )}

      {/* Hidden audio tags for stream playback and tape preview */}
      <audio
        ref={audioRef}
        preload="none"
        onEnded={() => {
          setListening(false);
          appendLog("STREAM_ENDED");
        }}
        onError={() => {
          setListening(false);
          appendLog("STREAM_AUDIO_ERROR");
        }}
        suppressHydrationWarning
      />
      <audio
        ref={libraryAudioRef}
        preload="none"
        onEnded={() => stopLibraryPlayback()}
        suppressHydrationWarning
      />
    </div>
  );
}

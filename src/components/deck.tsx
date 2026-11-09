import { useEffect, useRef, useState } from "react";
import { Download, Headphones, Play, Trash2 } from "lucide-react";
import { canPickSaveFile, pickSaveFile, startCapture, type CaptureReason } from "@/lib/capture";
import { downloadBlob, formatBytes, formatDuration, recordingName } from "@/lib/format";
import { deleteTake, getTakeBlob, listTakes, saveTake, type TakeMeta, type TrackMark } from "@/lib/library";
import { fetchNowPlaying, STATIONS, type Station } from "@/lib/stations";

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

const _LARGE_TAKE = 150 * 1024 * 1024;

function attachAnalyser(audio: HTMLAudioElement): Graph | null {
  const tagged = audio as HTMLAudioElement & { __graph?: Graph };
  if (tagged.__graph) return tagged.__graph;
  const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  const ctx = new AudioCtx();
  const source = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  const graph = { ctx, analyser };
  tagged.__graph = graph;
  return graph;
}

function paintBars(root: HTMLElement, bins: Uint8Array | null) {
  const bars = root.children;
  const count = bars.length;
  const half = Math.floor(count / 2);

  for (let i = 0; i < count; i += 1) {
    const el = bars[i] as HTMLElement;
    let mag = 0.12;
    if (bins) {
      // Mirror style: both sides move the same.
      // Distance from center → same frequency bin on left and right.
      const distFromCenter = Math.abs(i - (count - 1) / 2);
      const normalized = half > 0 ? distFromCenter / half : 0; // 0 at center → 1 at edges
      const idx = Math.min(
        bins.length - 1,
        Math.floor(normalized * (bins.length * 0.85)), // keep most energy in view
      );
      mag = Math.max(0.08, (bins[idx] ?? 0) / 255);
    }
    el.style.transform = `scaleY(${mag})`;
    el.style.opacity = bins ? "0.95" : "0.35";
  }
}

function reasonCopy(reason: PendingTake["reason"], fileSaved: boolean) {
  if (fileSaved && reason === "dropped") return "The stream dropped. What came through is already in your file.";
  if (fileSaved && reason === "limit") return "Time’s up. The MP3 is already saved in the file you picked.";
  if (fileSaved) return "Saved to the file you picked.";
  if (reason === "dropped") return "The stream dropped. Save what was captured before you leave.";
  if (reason === "limit") return "Time’s up. Save this take before you start another.";
  return "This take is ready. Save it to your device, or keep it in this browser.";
}

export function Deck() {
  const [stationId, setStationId] = useState(STATIONS[0].id);
  const station = STATIONS.find((item) => item.id === stationId) ?? STATIONS[0];
  const [monitor, setMonitor] = useState(true);
  const [limitId, setLimitId] = useState<LimitId>("off");
  const [saveDirect, setSaveDirect] = useState(false);
  const [canDirect, setCanDirect] = useState(false);
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
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const libraryAudioRef = useRef<HTMLAudioElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<{ stop: () => void } | null>(null);
  const volumeRef = useRef(0.9);
  const [volume, setVolume] = useState(0.9);
  const tracksRef = useRef<TrackMark[]>([]);
  const nowPlayingRef = useRef<string | null>(null);
  const stationRef = useRef(station);
  const startedRef = useRef(0);
  const recordingRef = useRef(false);
  const libraryUrl = useRef<string | null>(null);
  const playingUrlTake = useRef<string | null>(null);

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

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [recording]);

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

  useEffect(() => {
    const root = barsRef.current;
    const audio = audioRef.current;
    if (!root) return;
    let frame = 0;
    const bins = new Uint8Array(64);
    const draw = () => {
      const live = Boolean(audio && !audio.paused && audio.src);
      if (live && audio) {
        const graph = attachAnalyser(audio);
        if (graph) {
          if (graph.ctx.state === "suspended") void graph.ctx.resume();
          graph.analyser.getByteFrequencyData(bins);
          paintBars(root, bins);
        }
      } else {
        paintBars(root, null);
      }
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
    audio.volume = volumeRef.current;
    if (audio.src !== next.streamUrl) audio.src = next.streamUrl;
    const graph = attachAnalyser(audio);
    if (graph?.ctx.state === "suspended") await graph.ctx.resume();
    await audio.play();
    setListening(true);
  }

  async function onListen() {
    setError(null);
    if (listening) {
      stopMonitor();
      return;
    }
    try {
      await startMonitor(station);
    } catch {
      setError("The browser blocked playback. Tap Listen again, or check that the stream is up.");
      setListening(false);
    }
  }

  async function onRecord() {
    if (captureRef.current) {
      captureRef.current.stop();
      return;
    }
    if (blocked || arming) return;
    setError(null);
    setNotice(null);
    const current = stationRef.current;
    const chosenLimit = LIMITS.find((item) => item.id === limitId) ?? LIMITS[0];
    let file: Awaited<ReturnType<typeof pickSaveFile>> | null = null;
    if (saveDirect) {
      setArming(true);
      try {
        file = await pickSaveFile(recordingName(current.name));
      } catch (err) {
        setArming(false);
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Couldn't open a file to save into.");
        return;
      }
      setArming(false);
    }

    if (monitor) {
      try {
        await startMonitor(current);
      } catch {
        setNotice("Recording without sound — the browser wouldn't start playback.");
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

    if (result.bytes === 0) {
      setError(result.error ?? "Nothing was captured. The stream may be down — try Listen first.");
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
      setNotice("The live stream ended early. Your audio up to that point is ready.");
    }
  }

  async function onKeep() {
    if (!pending?.blob || pending.kept) return;
    setError(null);
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
    } catch (err) {
      const quota = err instanceof DOMException && err.name === "QuotaExceededError";
      setError(
        quota
          ? "This browser ran out of room for saved tapes. Use Save MP3 — that still downloads the file."
          : "Couldn't keep it in this browser. Save MP3 still works.",
      );
    }
  }

  function onDownload() {
    if (!pending?.blob) return;
    downloadBlob(pending.blob, recordingName(pending.stationName, new Date(pending.startedAt)));
    setPending({ ...pending, downloaded: true });
  }

  function onCueSheet() {
    if (!pending) return;
    const lines = [
      pending.stationName,
      new Date(pending.startedAt).toLocaleString(),
      "",
      ...(pending.tracks.length
        ? pending.tracks.map((mark) => `${formatDuration(mark.t)}  ${mark.title}`)
        : ["No track titles were announced during this take."]),
    ];
    downloadBlob(
      new Blob([lines.join("\n")], { type: "text/plain" }),
      recordingName(pending.stationName, new Date(pending.startedAt), "txt"),
    );
  }

  async function onPlayTake(meta: TakeMeta) {
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
        setError("That tape is missing from this browser.");
        return;
      }
      stopLibraryPlayback();
      const url = URL.createObjectURL(blob);
      libraryUrl.current = url;
      playingUrlTake.current = meta.id;
      const audio = libraryAudioRef.current;
      if (!audio) return;
      audio.src = url;
      await audio.play();
      setPlayingId(meta.id);
    } catch {
      setError("Couldn't play that tape.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDownloadTake(meta: TakeMeta) {
    setBusyId(meta.id);
    try {
      const blob = await getTakeBlob(meta.id);
      if (!blob) {
        setError("That tape is missing from this browser.");
        return;
      }
      downloadBlob(blob, recordingName(meta.stationName, new Date(meta.startedAt)));
    } finally {
      setBusyId(null);
    }
  }

  async function onDeleteTake(id: string) {
    if (playingId === id) stopLibraryPlayback();
    await deleteTake(id);
    setConfirmId(null);
    setTakes(await listTakes());
  }

  function onVolume(next: number) {
    volumeRef.current = next;
    setVolume(next);
    if (audioRef.current) audioRef.current.volume = next;
    if (libraryAudioRef.current) libraryAudioRef.current.volume = next;
  }

  const shownTracks = trackLog.slice(-4);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <p className="font-display text-sm tracking-widest text-cyan">MASSIVE TAPE</p>
        <h1 className="font-display text-3xl leading-none text-fg sm:text-4xl">Record the live stream</h1>
        <p className="max-w-xl text-sm text-muted sm:text-base">
          Capture Massive Dance while it plays, then save the set as an MP3 on this device.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {STATIONS.map((item) => {
          const selected = item.id === station.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={recording || arming}
              aria-pressed={selected}
              aria-label={`${item.name}. ${item.tagline}`}
              onClick={() => {
                if (item.id === station.id) return;
                setStationId(item.id);
                setNowPlaying(null);
                nowPlayingRef.current = null;
                if (listening) {
                  stopMonitor();
                  void startMonitor(item).catch(() => {
                    setError("Couldn't switch the live audio. Try Listen again.");
                  });
                }
              }}
              className={`rounded-card border-2 px-2 py-2 text-left transition-colors duration-200 disabled:opacity-50 sm:px-4 sm:py-3 ${
                selected ? "border-cyan bg-surface" : "border-line bg-surface"
              }`}
            >
              <span className="block font-display text-sm leading-tight tracking-wide text-fg sm:text-lg">
                {item.name.replace("Massive ", "")}
              </span>
              <span className="mt-1 hidden text-sm text-muted sm:block">{item.tagline}</span>
            </button>
          );
        })}
      </div>

      <section className="rounded-card border border-line bg-surface px-4 py-4 sm:px-7 sm:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-sm tracking-widest text-cyan">ON AIR · {station.name}</p>
            <h2 className="mt-2 font-display text-2xl leading-tight text-fg sm:text-3xl">
              {nowPlaying ?? "Waiting for a title"}
            </h2>
            <p className="mt-1 text-sm text-muted">{station.bitrate} kbps MP3</p>
          </div>
          <button
            type="button"
            onClick={() => void onRecord()}
            disabled={arming || (blocked && !recording)}
            aria-pressed={recording}
            className="flex shrink-0 flex-col items-center gap-1 disabled:opacity-50"
          >
            <span
              className={`grid h-16 w-16 place-items-center rounded-full bg-record text-bg sm:h-20 sm:w-20 ${
                recording ? "animate-pulse" : ""
              }`}
            >
              <span className={`block bg-bg ${recording ? "h-5 w-5 rounded-sm" : "h-5 w-5 rounded-full"}`} />
            </span>
            <span className="font-display text-sm tracking-widest text-fg">
              {arming ? "FILE" : recording ? "STOP" : "RECORD"}
            </span>
          </button>
        </div>

        <div ref={barsRef} className="mt-4 flex h-12 items-end gap-1" aria-hidden="true">
          {Array.from({ length: 28 }, (_, index) => (
            <span
              key={index}
              className={`block h-full min-w-0 flex-1 origin-bottom rounded-sm ${
                index % 7 === 3 ? "bg-record" : "bg-cyan"
              }`}
              style={{ transform: "scaleY(0.12)", opacity: 0.35 }}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void onListen()}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-display text-sm tracking-wider uppercase transition-colors ${
                listening
                  ? "border-cyan bg-cyan/20 text-cyan"
                  : "border-line bg-surface hover:border-muted text-fg"
              }`}
            >
              <Headphones className="h-4 w-4" />
              <span>{listening ? "Mute Stream" : "Listen Live"}</span>
            </button>

            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => onVolume(parseFloat(e.target.value))}
                className="h-1.5 w-20 sm:w-24 accent-cyan cursor-pointer"
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span>Timer:</span>
              {LIMITS.map((lim) => (
                <button
                  key={lim.id}
                  type="button"
                  disabled={recording}
                  onClick={() => setLimitId(lim.id)}
                  className={`rounded px-2 py-1 transition-colors ${
                    limitId === lim.id
                      ? "bg-cyan text-bg font-semibold"
                      : "border border-line hover:border-muted text-muted"
                  }`}
                >
                  {lim.label}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={monitor}
                disabled={recording}
                onChange={(e) => setMonitor(e.target.checked)}
                className="rounded border-line text-cyan focus:ring-0"
              />
              <span>Monitor while recording</span>
            </label>

            {canDirect && (
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveDirect}
                  disabled={recording}
                  onChange={(e) => setSaveDirect(e.target.checked)}
                  className="rounded border-line text-cyan focus:ring-0"
                />
                <span>Direct Save</span>
              </label>
            )}
          </div>
        </div>

        {recording && (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-bg/60 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-record animate-pulse" />
              <span className="font-display tracking-wider text-record">RECORDING</span>
              <span className="text-fg font-mono">{formatDuration(elapsed)}</span>
              {remaining !== null && (
                <span className="text-muted text-xs">({formatDuration(remaining)} left)</span>
              )}
            </div>
            <div className="text-xs font-mono text-cyan">{formatBytes(bytes)}</div>
          </div>
        )}
      </section>

      {shownTracks.length > 0 && (
        <div className="rounded-card border border-line bg-surface/50 p-4">
          <p className="font-display text-xs tracking-widest text-muted uppercase">Announced Tracks in this Take</p>
          <ul className="mt-2 space-y-1 text-sm">
            {shownTracks.map((track, i) => (
              <li key={i} className="flex items-center justify-between text-muted">
                <span className="text-fg truncate">{track.title}</span>
                <span className="font-mono text-xs text-muted ml-2">{formatDuration(track.t)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-card border border-record/40 bg-record/10 p-4 text-sm text-record">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-card border border-cyan/40 bg-cyan/10 p-4 text-sm text-cyan">
          {notice}
        </div>
      )}

      {pending && (
        <section className="rounded-card border-2 border-cyan bg-surface p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-display text-xs tracking-widest text-cyan uppercase">Take Ready</p>
              <h3 className="text-lg font-display text-fg mt-1">
                {pending.stationName} · {formatDuration(pending.endedAt - pending.startedAt)} ({formatBytes(pending.bytes)})
              </h3>
              <p className="text-sm text-muted mt-1">{reasonCopy(pending.reason, pending.fileSaved)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!pending.fileSaved && (
                <>
                  <button
                    type="button"
                    onClick={onDownload}
                    className="inline-flex items-center gap-1.5 rounded-full bg-cyan px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
                  >
                    <Download className="h-4 w-4" />
                    <span>Save MP3</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onKeep()}
                    disabled={pending.kept}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-muted disabled:opacity-50"
                  >
                    <span>{pending.kept ? "Saved in Browser" : "Keep in Browser"}</span>
                  </button>
                </>
              )}
              {pending.tracks.length > 0 && (
                <button
                  type="button"
                  onClick={onCueSheet}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs font-medium text-muted hover:text-fg hover:border-muted"
                >
                  <span>Tracklist .txt</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-full px-3 py-2 text-xs text-muted hover:text-fg"
              >
                Dismiss
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="mt-2 rounded-card border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-fg tracking-wide">
            SAVED TAPES {takes.length > 0 && <span className="text-cyan text-sm ml-2">({takes.length})</span>}
          </h3>
        </div>

        {takes.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No saved tapes yet. Record a stream and tap &quot;Keep in Browser&quot; to store takes locally.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-line">
            {takes.map((take) => {
              const isPlaying = playingId === take.id;
              const isBusy = busyId === take.id;
              const duration = take.endedAt - take.startedAt;
              return (
                <div key={take.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-base text-fg truncate">{take.stationName}</p>
                    <p className="text-xs text-muted">
                      {new Date(take.startedAt).toLocaleString()} · {formatDuration(duration)} · {formatBytes(take.bytes)}
                      {take.tracks.length > 0 && ` · ${take.tracks.length} track(s)`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onPlayTake(take)}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                        isPlaying
                          ? "bg-cyan text-bg"
                          : "border border-line text-fg hover:border-muted"
                      }`}
                    >
                      <Play className={`h-3.5 w-3.5 ${isPlaying ? "fill-current" : ""}`} />
                      <span>{isPlaying ? "Pause" : "Play"}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onDownloadTake(take)}
                      className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-fg hover:border-muted"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>MP3</span>
                    </button>
                    {confirmId === take.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void onDeleteTake(take.id)}
                          className="rounded px-2 py-1 text-xs text-record bg-record/10 hover:bg-record/20"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="rounded px-2 py-1 text-xs text-muted hover:text-fg"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(take.id)}
                        className="p-1.5 text-muted hover:text-record transition-colors"
                        aria-label="Delete take"
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

      {/* Audio elements for monitor and library playback */}
      <audio ref={audioRef} preload="none" />
      <audio
        ref={libraryAudioRef}
        preload="none"
        onEnded={() => stopLibraryPlayback()}
      />
    </div>
  );
}

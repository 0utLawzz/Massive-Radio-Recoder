import { useEffect, useRef, useState } from "react";
import { Download, Headphones, Play, Radio, Trash2 } from "lucide-react";
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

const LARGE_TAKE = 150 * 1024 * 1024;

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
  for (let i = 0; i < bars.length; i += 1) {
    const el = bars[i] as HTMLElement;
    let mag = 0.12;
    if (bins) {
      const idx = Math.min(bins.length - 1, Math.floor((i / bars.length) * bins.length));
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
          <div>
            <p className="font-display text-4xl leading-none tabular-nums text-fg sm:text-5xl" aria-live="off">
              {recording ? formatDuration(elapsed) : "0:00"}
            </p>
            <p className="mt-1 text-sm text-muted" data-bytes={bytes}>
              {recording
                ? `${formatBytes(bytes)}${remaining !== null ? ` · ${formatDuration(remaining)} left` : ""}`
                : "Not recording"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onListen()}
              disabled={arming}
              className="flex h-11 items-center gap-2 rounded-full border border-line bg-bg px-4 text-sm font-medium text-fg transition-colors duration-200 disabled:opacity-50"
            >
              <Radio aria-hidden="true" size={18} />
              {listening ? "Stop listening" : "Listen"}
            </button>
            <label className="flex h-11 items-center gap-2 rounded-full bg-bg px-3 text-muted">
              <Headphones aria-hidden="true" size={18} />
              <span className="sr-only">Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => onVolume(Number(event.target.value))}
                className="w-24 accent-cyan"
              />
            </label>
          </div>
        </div>

        {shownTracks.length > 0 && (
          <ol className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-sm text-muted">
            {shownTracks.map((mark) => (
              <li key={`${mark.t}-${mark.title}`} className="flex gap-3">
                <span className="tabular-nums text-cyan">{formatDuration(mark.t)}</span>
                <span className="min-w-0 truncate text-fg">{mark.title}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            {LIMITS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={recording || arming}
                aria-pressed={limitId === item.id}
                onClick={() => setLimitId(item.id)}
                className={`h-11 rounded-full px-4 text-sm font-medium transition-colors duration-200 disabled:opacity-50 ${
                  limitId === item.id ? "bg-cyan text-bg" : "bg-bg text-fg"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={monitor}
              disabled={recording || arming}
              onClick={() => setMonitor((value) => !value)}
              className={`h-11 rounded-full px-4 text-sm font-medium transition-colors duration-200 disabled:opacity-50 ${
                monitor ? "bg-cyan text-bg" : "bg-bg text-fg"
              }`}
            >
              {monitor ? "Hear it while recording" : "Record in silence"}
            </button>
            {canDirect && (
              <button
                type="button"
                aria-pressed={saveDirect}
                disabled={recording || arming}
                onClick={() => setSaveDirect((value) => !value)}
                className={`h-11 rounded-full px-4 text-sm font-medium transition-colors duration-200 disabled:opacity-50 ${
                  saveDirect ? "bg-cyan text-bg" : "bg-bg text-fg"
                }`}
              >
                {saveDirect ? "Saving into a file" : "Save into a file as it records"}
              </button>
            )}
          </div>
          <p className="text-sm text-muted">
            {saveDirect
              ? "Long sets go straight to disk, so the browser doesn’t have to hold the whole show."
              : "Manual stops when you hit Stop. A time limit ends the take and asks you to save it."}
          </p>
          {recording && bytes > LARGE_TAKE && !saveDirect && (
            <p className="text-sm text-record">
              This take is getting large. Stop and save it, or next time turn on save-into-a-file.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-record">
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="mt-4 text-sm text-muted">
            {notice}
          </p>
        )}
      </section>

      {pending && (
        <section className="rounded-card border-2 border-cyan bg-surface px-5 py-5 sm:px-7">
          <p className="font-display text-sm tracking-widest text-cyan">READY TO SAVE</p>
          <h2 className="mt-2 font-display text-2xl text-fg">{pending.stationName}</h2>
          <p className="mt-1 text-sm text-muted">
            {formatDuration(pending.endedAt - pending.startedAt)} · {formatBytes(pending.bytes)}
          </p>
          <p className="mt-3 text-sm text-fg">{reasonCopy(pending.reason, pending.fileSaved)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {pending.blob && (
              <button
                type="button"
                onClick={onDownload}
                className="flex h-11 items-center gap-2 rounded-full bg-cyan px-4 text-sm font-semibold text-bg"
              >
                <Download aria-hidden="true" size={18} />
                {pending.downloaded ? "Saved — download again" : "Save MP3"}
              </button>
            )}
            {pending.blob && (
              <button
                type="button"
                onClick={() => void onKeep()}
                disabled={pending.kept}
                className="h-11 rounded-full border border-line bg-bg px-4 text-sm font-medium text-fg disabled:opacity-50"
              >
                {pending.kept ? "Kept in this browser" : "Keep in this browser"}
              </button>
            )}
            <button
              type="button"
              onClick={onCueSheet}
              className="h-11 rounded-full border border-line bg-bg px-4 text-sm font-medium text-fg"
            >
              Save cue sheet
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="h-11 rounded-full px-4 text-sm font-medium text-muted"
            >
              {pending.fileSaved || pending.downloaded || pending.kept ? "Done" : "Discard"}
            </button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl tracking-wide text-fg">Saved on this device</h2>
        {takes.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-5 py-4 text-sm text-muted">
            Nothing kept yet. Record a set, then choose Keep in this browser. Downloads live in your files app either way.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {takes.map((take) => (
              <li
                key={take.id}
                className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{take.stationName}</p>
                  <p className="text-sm text-muted">
                    {new Date(take.startedAt).toLocaleString()} · {formatDuration(take.endedAt - take.startedAt)} ·{" "}
                    {formatBytes(take.bytes)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onPlayTake(take)}
                    disabled={busyId === take.id}
                    className="flex h-11 items-center gap-2 rounded-full bg-bg px-4 text-sm font-medium text-fg"
                  >
                    <Play aria-hidden="true" size={16} />
                    {playingId === take.id ? "Stop" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDownloadTake(take)}
                    disabled={busyId === take.id}
                    className="flex h-11 items-center gap-2 rounded-full bg-bg px-4 text-sm font-medium text-fg"
                  >
                    <Download aria-hidden="true" size={16} />
                    Save
                  </button>
                  {confirmId === take.id ? (
                    <button
                      type="button"
                      onClick={() => void onDeleteTake(take.id)}
                      className="h-11 rounded-full bg-record px-4 text-sm font-semibold text-bg"
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(take.id)}
                      aria-label={`Delete ${take.stationName}`}
                      className="grid h-11 w-11 place-items-center rounded-full bg-bg text-fg"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-muted">
        Audio comes from the public{" "}
        <a
          className="text-cyan underline underline-offset-2"
          href="https://www.massivedance.com/"
          target="_blank"
          rel="noreferrer"
        >
          Massive Dance Radio
        </a>{" "}
        stream. Files stay on your device. The music is still copyrighted — keep recordings for yourself, don’t republish them.
      </p>

      <audio ref={audioRef} crossOrigin="anonymous" preload="none" className="absolute h-0 w-0 opacity-0" />
      <audio
        ref={libraryAudioRef}
        preload="none"
        className="absolute h-0 w-0 opacity-0"
        onEnded={() => setPlayingId(null)}
      />
    </div>
  );
}

export type CaptureReason = "stopped" | "dropped" | "limit" | "error";

export type FileSink = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

export type CaptureResult = {
  chunks: Uint8Array[];
  bytes: number;
  startedAt: number;
  endedAt: number;
  reason: CaptureReason;
  error?: string;
};

type CaptureOptions = {
  url: string;
  file: FileSink | null;
  limitMs: number | null;
  onBytes: (bytes: number) => void;
};

export function startCapture(options: CaptureOptions) {
  const ac = new AbortController();
  let stopped = false;
  let reason: CaptureReason = "stopped";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const startedAt = Date.now();
  let lastTick = 0;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = (why: "stopped" | "limit" = "stopped") => {
    reason = why;
    stopped = true;
    ac.abort();
  };

  if (options.limitMs && options.limitMs > 0) {
    limitTimer = setTimeout(() => stop("limit"), options.limitMs);
  }

  const promise = (async (): Promise<CaptureResult> => {
    let error: string | undefined;
    try {
      const res = await fetch(options.url, {
        signal: ac.signal,
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (!res.ok || !res.body) {
        throw new Error(res.ok ? "This stream has no audio data." : `Stream returned ${res.status}.`);
      }
      const reader = res.body.getReader();
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) {
          if (!stopped) reason = "dropped";
          break;
        }
        if (!value?.byteLength) continue;
        const copy = new Uint8Array(value.byteLength);
        copy.set(value);
        bytes += copy.byteLength;
        if (options.file) await options.file.write(copy);
        else chunks.push(copy);
        const now = performance.now();
        if (bytes === copy.byteLength || now - lastTick > 250) {
          lastTick = now;
          options.onBytes(bytes);
        }
      }
      await reader.cancel().catch(() => undefined);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!stopped && !aborted) {
        reason = bytes > 0 ? "dropped" : "error";
        error = err instanceof Error ? err.message : "Couldn't reach the stream.";
      }
    } finally {
      if (limitTimer) clearTimeout(limitTimer);
      if (options.file) {
        try {
          await options.file.close();
        } catch {
          /* the file may already be closed */
        }
      }
      options.onBytes(bytes);
    }

    return {
      chunks,
      bytes,
      startedAt,
      endedAt: Date.now(),
      reason,
      error,
    };
  })();

  return { promise, stop: () => stop("stopped") };
}

export function canPickSaveFile() {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export async function pickSaveFile(suggestedName: string): Promise<FileSink> {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (opts: {
        suggestedName: string;
        types: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<{ createWritable: () => Promise<FileSink> }>;
    }
  ).showSaveFilePicker;

  if (!picker) throw new Error("This browser can't save straight to a file. Stop the take and use Save MP3.");

  const handle = await picker({
    suggestedName,
    types: [{ description: "MP3 audio", accept: { "audio/mpeg": [".mp3"] } }],
  });
  return handle.createWritable();
}

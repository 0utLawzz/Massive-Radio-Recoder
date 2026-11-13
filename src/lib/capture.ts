export type CaptureReason = "stopped" | "dropped" | "limit" | "error";

export type FileSink = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

export type CaptureSegment = {
  blob: Blob;
  bytes: number;
  startedAt: number;
  endedAt: number;
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
  let segmentChunks: Uint8Array[] = [];
  let segmentBytes = 0;
  let segmentStartedAt = 0;
  let bytes = 0;
  let startedAt = 0;
  let lastTick = 0;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = (why: "stopped" | "limit" = "stopped") => {
    reason = why;
    stopped = true;
    ac.abort();
  };

  /**
   * Flushes accumulated audio chunks since the last split (or capture start)
   * without interrupting the live Icecast HTTP stream.
   */
  const flushSegment = (): CaptureSegment | null => {
    if (segmentBytes === 0 || segmentChunks.length === 0) return null;
    const now = Date.now();
    const blob = new Blob(
      segmentChunks.map((chunk) => chunk.buffer as ArrayBuffer),
      { type: "audio/mpeg" },
    );
    const segment: CaptureSegment = {
      blob,
      bytes: segmentBytes,
      startedAt: segmentStartedAt || startedAt || now,
      endedAt: now,
    };
    segmentChunks = [];
    segmentBytes = 0;
    segmentStartedAt = now;
    return segment;
  };

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

        // Accurately record start time on first audio data chunk, avoiding network connection delay
        if (startedAt === 0) {
          startedAt = Date.now();
          segmentStartedAt = startedAt;
          if (options.limitMs && options.limitMs > 0) {
            limitTimer = setTimeout(() => stop("limit"), options.limitMs);
          }
        }

        const copy = new Uint8Array(value.byteLength);
        copy.set(value);
        bytes += copy.byteLength;
        segmentBytes += copy.byteLength;
        segmentChunks.push(copy);

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

    const now = Date.now();
    return {
      chunks,
      bytes,
      startedAt: startedAt || now,
      endedAt: now,
      reason,
      error,
    };
  })();

  return { promise, stop: () => stop("stopped"), flushSegment };
}

export function canPickSaveFile() {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export function canPickDirectory() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export type DirectoryHandleLike = {
  name: string;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | Uint8Array) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export async function pickDriveDirectory(): Promise<DirectoryHandleLike> {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;

  if (!picker) {
    throw new Error("Folder/Drive picker is unavailable in this browser. Auto-saved songs will download to your Downloads folder.");
  }

  return picker({ mode: "readwrite" });
}

export async function writeBlobToDirectory(
  dir: DirectoryHandleLike,
  filename: string,
  blob: Blob,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
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

export type Station = {
  id: string;
  name: string;
  tagline: string;
  streamUrl: string;
  statusUrl: string;
  bitrate: number;
};

export const STATIONS: Station[] = [
  {
    id: "dance",
    name: "Massive Dance",
    tagline: "Club anthems, 24/7",
    streamUrl: "https://cast3.torontocast.com:1235/stream",
    statusUrl: "https://cast3.torontocast.com:1235/status-json.xsl",
    bitrate: 192,
  },
  {
    id: "anthems",
    name: "Massive Anthems",
    tagline: "The biggest beats",
    streamUrl: "https://puma.streemlion.com:3780/stream",
    statusUrl: "https://puma.streemlion.com:3780/status-json.xsl",
    bitrate: 192,
  },
  {
    id: "chill",
    name: "Massive Chill",
    tagline: "Deep house and nu-disco",
    streamUrl: "https://puma.streemlion.com:3955/stream",
    statusUrl: "https://puma.streemlion.com:3955/status-json.xsl",
    bitrate: 192,
  },
  {
    id: "synth",
    name: "Cyber Synth",
    tagline: "OutLawZ Cyberpunk & Darksynth",
    streamUrl: "https://stream.nightride.fm/nightride.mp3",
    statusUrl: "https://stream.nightride.fm/status-json.xsl",
    bitrate: 320,
  },
];

export async function fetchNowPlaying(statusUrl: string): Promise<string | null> {
  const res = await fetch(statusUrl, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    icestats?: { source?: unknown };
  };
  const source = data.icestats?.source;
  const item = Array.isArray(source) ? source[0] : source;
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const title = rec.title ?? rec.yp_currently_playing;
  if (typeof title !== "string") return null;
  const trimmed = title.trim();
  return trimmed.length ? trimmed : null;
}

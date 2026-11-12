/**
 * Artwork search, metadata parsing, and in-memory caching engine.
 * Supports iTunes Search API with fallback to procedural OutLawZ Cyberpunk art.
 */

export type ParsedTrack = {
  raw: string;
  artist: string;
  title: string;
  searchQuery: string;
};

// In-memory cache for track queries to avoid repeated network hits
const artworkCache = new Map<string, string | null>();

/**
 * Splits raw stream metadata strings like "Artist - Title" or "Artist - Track (Club Mix)"
 */
export function parseTrackMeta(raw: string | null | undefined): ParsedTrack {
  if (!raw || !raw.trim()) {
    return {
      raw: "",
      artist: "LIVE TRANSMISSION",
      title: "OUTLAWZ CYBER BEATS",
      searchQuery: "OutLawZ Cyber Beats",
    };
  }

  const clean = raw.trim();
  // Common radio formats: "Artist - Title", "Artist : Title", "Artist — Title"
  const separators = [" - ", " — ", " : ", " // "];
  for (const sep of separators) {
    if (clean.includes(sep)) {
      const parts = clean.split(sep);
      const artist = parts[0]?.trim() || "UNKNOWN ARTIST";
      const title = parts.slice(1).join(" - ").trim() || "STREAM AUDIO";
      return {
        raw: clean,
        artist,
        title,
        searchQuery: `${artist} ${title}`.replace(/[^\w\s-]/g, " ").trim(),
      };
    }
  }

  // If no separator found, treat the whole string as title
  return {
    raw: clean,
    artist: "LIVE BROADCAST",
    title: clean,
    searchQuery: clean.replace(/[^\w\s-]/g, " ").trim(),
  };
}

/**
 * Fetch high-resolution (600x600) album artwork using iTunes Search API.
 * Results are cached in memory. Returns null if not found or on network failure.
 */
export async function fetchAlbumArtwork(query: string): Promise<string | null> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  if (artworkCache.has(normalized)) {
    return artworkCache.get(normalized) ?? null;
  }

  try {
    const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
    const res = await fetch(endpoint, {
      cache: "force-cache",
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      artworkCache.set(normalized, null);
      return null;
    }

    const data = (await res.json()) as {
      resultCount: number;
      results?: Array<{ artworkUrl100?: string }>;
    };

    if (data.resultCount > 0 && data.results?.[0]?.artworkUrl100) {
      // Scale 100x100 thumbnail to 600x600 high-res
      const highRes = data.results[0].artworkUrl100.replace("100x100bb.jpg", "600x600bb.jpg");
      artworkCache.set(normalized, highRes);
      return highRes;
    }

    artworkCache.set(normalized, null);
    return null;
  } catch {
    // Network or timeout failure
    artworkCache.set(normalized, null);
    return null;
  }
}

/**
 * Generate a YouTube search link for the active track
 */
export function getYouTubeSearchUrl(artist: string, title: string): string {
  const query = `${artist} ${title} official audio`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
}

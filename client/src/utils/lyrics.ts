export interface LyricLine {
  time: number; // in seconds
  text: string;
}

export interface LyricsData {
  synced: boolean;
  lines: LyricLine[];
  plainText?: string;
  instrumental?: boolean;
}

/**
 * Parse an LRC string into structured array of timed lines
 * Example LRC input: [00:12.34] Hello world
 */
export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText) return [];

  const lines = lrcText.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\]/g;

  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    // Skip metadata tags like [ti:Title], [ar:Artist], etc.
    if (/^\[(ti|ar|al|au|length|by|offset):/i.test(cleanLine)) continue;

    const matches = Array.from(cleanLine.matchAll(timeRegex));
    if (matches.length > 0) {
      const text = cleanLine.replace(timeRegex, '').trim();
      if (!text) continue;

      for (const match of matches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const msStr = match[3] || '0';
        const milliseconds = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr, 10);
        const totalSeconds = minutes * 60 + seconds + milliseconds / 1000;

        result.push({
          time: totalSeconds,
          text
        });
      }
    }
  }

  // Sort chronologically
  return result.sort((a, b) => a.time - b.time);
}

// In-memory cache to avoid refetching on same song
const lyricsCache = new Map<string, LyricsData>();

/**
 * Fetch lyrics for a track from the server / LRCLIB
 */
export async function fetchLyrics(
  title: string,
  artist: string = '',
  duration?: number
): Promise<LyricsData | null> {
  const cacheKey = `${title.toLowerCase()}_${artist.toLowerCase()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  try {
    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
    const params = new URLSearchParams({
      title,
      ...(artist ? { artist } : {}),
      ...(duration ? { duration: duration.toString() } : {})
    });

    const res = await fetch(`${serverUrl}/api/lyrics?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) {
        const parsed = parseLRC(data.syncedLyrics);
        const lyricsData: LyricsData = {
          synced: true,
          lines: parsed,
          instrumental: data.instrumental
        };
        lyricsCache.set(cacheKey, lyricsData);
        return lyricsData;
      } else if (data.plainLyrics) {
        // Plain text fallback from Lyrist/Lyrics.ovh mapped dynamically across track duration
        const rawLines = data.plainLyrics
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0 && !/^\[.+\]$/.test(l));

        const totalDuration = duration || (rawLines.length * 4.5);
        const timePerLine = rawLines.length > 0 ? Math.max(2.5, (totalDuration * 0.92) / rawLines.length) : 4.0;

        const plainLines: LyricLine[] = rawLines.map((text: string, idx: number) => ({
          time: Math.round(idx * timePerLine * 10) / 10,
          text
        }));

        const lyricsData: LyricsData = {
          synced: true,
          lines: plainLines,
          plainText: data.plainLyrics,
          instrumental: data.instrumental
        };
        lyricsCache.set(cacheKey, lyricsData);
        return lyricsData;
      }
    }
  } catch (err) {
    console.warn('[Lyrics] Failed to fetch lyrics:', err);
  }

  return null;
}

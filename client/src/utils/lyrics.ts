/**
 * lyrics.ts
 *
 * Portions of the lyrics parser and timing structures are adapted from:
 * binimum/am-lyrics (https://github.com/binimum/am-lyrics)
 * Copyright (c) 2024-2025 binimum
 * Licensed under the Mozilla Public License 2.0 (MPL-2.0)
 */

export interface LyricWord {
  text: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
}

export interface LyricLine {
  time: number; // in seconds (start time of line)
  endTime?: number;
  text: string;
  words?: LyricWord[];
}

export interface LyricsData {
  synced: boolean;
  lines: LyricLine[];
  plainText?: string;
  instrumental?: boolean;
}

/**
 * Parses time format [mm:ss.xx] or <mm:ss.xx> or hh:mm:ss.xx or pure seconds into float seconds
 */
function parseTimestamp(timeStr: string): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim().replace(/^\[|<|\]|>$/g, '');

  // Handle pure float/integer seconds like "139.17" or "139.17s"
  if (/^\d+(?:\.\d+)?s?$/i.test(clean)) {
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  }

  const match = clean.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?/);
  if (!match) return null;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const msStr = match[4] || '0';
  const ms = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

/**
 * Generate natural, syllable/character-weighted word timestamps for lines that only have line-level timing.
 */
export function generateWordTimestamps(lines: LyricLine[], totalDuration?: number): LyricLine[] {
  return lines.map((line, idx) => {
    // If words are already parsed with timestamps (e.g. from enhanced LRC or TTML), keep them
    if (line.words && line.words.length > 0) return line;

    const rawWords = line.text.trim().split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) return line;

    const nextLine = lines[idx + 1];
    const lineStart = line.time;
    // Estimate line duration: up to next line (capped at 7s) or default 4.0s
    let lineDur = nextLine ? Math.max(0.8, nextLine.time - lineStart) : 4.0;
    if (lineDur > 8.0) lineDur = Math.min(6.0, 1.2 + rawWords.length * 0.45);
    const lineEnd = lineStart + lineDur;

    // Weight words by length and syllable count
    const weights = rawWords.map(w => {
      const len = w.replace(/[^a-zA-Z0-9]/g, '').length || 1;
      // Bonus weight for longer words
      return Math.max(1, len);
    });
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    // Leave a small 10% breathing buffer at the end of the line
    const vocalDuration = lineDur * 0.90;
    let currentWordStart = lineStart;

    const words: LyricWord[] = rawWords.map((w, wIdx) => {
      const wordDur = (weights[wIdx] / totalWeight) * vocalDuration;
      const wStart = currentWordStart;
      const wEnd = currentWordStart + wordDur;
      currentWordStart = wEnd;
      return {
        text: w,
        startTime: Math.round(wStart * 1000) / 1000,
        endTime: Math.round(wEnd * 1000) / 1000
      };
    });

    return {
      ...line,
      endTime: lineEnd,
      words
    };
  });
}

/**
 * Parses TTML (Timed Text Markup Language) XML strings
 */
export function parseTTML(ttmlText: string): LyricLine[] {
  if (!ttmlText || !ttmlText.includes('<p') && !ttmlText.includes('<span')) return [];

  const lines: LyricLine[] = [];
  // Regex to extract <p begin="..." end="...">...</p>
  const pRegex = /<p\s+[^>]*begin="([^"]+)"(?:\s+[^>]*end="([^"]+)")?[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;

  while ((pMatch = pRegex.exec(ttmlText)) !== null) {
    const pBegin = parseTimestamp(pMatch[1]);
    const pEnd = pMatch[2] ? parseTimestamp(pMatch[2]) : undefined;
    const innerContent = pMatch[3];

    if (pBegin === null) continue;

    // Check for inner word-level spans <span begin="..." end="...">word</span>
    const spanRegex = /<span\s+[^>]*begin="([^"]+)"(?:\s+[^>]*end="([^"]+)")?[^>]*>([^<]+)<\/span>/gi;
    const words: LyricWord[] = [];
    let spanMatch;

    while ((spanMatch = spanRegex.exec(innerContent)) !== null) {
      const sBegin = parseTimestamp(spanMatch[1]);
      const sEnd = spanMatch[2] ? parseTimestamp(spanMatch[2]) : (sBegin ? sBegin + 0.5 : 0);
      const text = spanMatch[3].trim();
      if (sBegin !== null && text) {
        words.push({ text, startTime: sBegin, endTime: sEnd || sBegin + 0.4 });
      }
    }

    // Clean pure text
    const cleanText = innerContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (cleanText) {
      lines.push({
        time: pBegin,
        endTime: pEnd ?? (pBegin + 4.0),
        text: cleanText,
        words: words.length > 0 ? words : undefined
      });
    }
  }

  const sorted = lines.sort((a, b) => a.time - b.time);
  // If lines don't have word spans, generate natural word timestamps
  const needsWordTimings = sorted.some(l => !l.words || l.words.length === 0);
  if (needsWordTimings) {
    return generateWordTimestamps(sorted);
  }
  return sorted;
}

/**
 * Parse an LRC string into structured array of timed lines, with support for Enhanced LRC word tags: <00:12.34>word
 */
export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText) return [];

  // Check if this is TTML
  if (lrcText.includes('<tt') || (lrcText.includes('<p') && lrcText.includes('begin='))) {
    const ttmlResult = parseTTML(lrcText);
    if (ttmlResult.length > 0) return ttmlResult;
  }

  const rawLines = lrcText.split('\n');
  const parsedLines: LyricLine[] = [];
  const lineTimeRegex = /\[(\d{1,2}):(\d{2})\.?(\d{2,3})?\]/g;
  const wordTimeRegex = /<(\d{1,2}):(\d{2})\.?(\d{2,3})?>([^<]*)/g;

  for (const rawLine of rawLines) {
    const cleanLine = rawLine.trim();
    if (!cleanLine) continue;

    // Skip metadata tags
    if (/^\[(ti|ar|al|au|length|by|offset):/i.test(cleanLine)) continue;

    const lineMatches = Array.from(cleanLine.matchAll(lineTimeRegex));
    if (lineMatches.length === 0) continue;

    // Check for Enhanced LRC word tags: e.g. [00:12.34]<00:12.34>Hello <00:12.80>World
    const hasWordTags = /<\d{1,2}:\d{2}/.test(cleanLine);
    let words: LyricWord[] | undefined = undefined;

    if (hasWordTags) {
      const wMatches = Array.from(cleanLine.matchAll(wordTimeRegex));
      if (wMatches.length > 0) {
        words = [];
        for (let i = 0; i < wMatches.length; i++) {
          const wMatch = wMatches[i];
          const minutes = parseInt(wMatch[1], 10);
          const seconds = parseInt(wMatch[2], 10);
          const msStr = wMatch[3] || '0';
          const ms = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
          const wStart = minutes * 60 + seconds + ms / 1000;
          const text = wMatch[4].trim();

          // Calculate end time as next word's start time or default
          let wEnd = wStart + 0.4;
          if (i < wMatches.length - 1) {
            const nextMatch = wMatches[i + 1];
            const nMin = parseInt(nextMatch[1], 10);
            const nSec = parseInt(nextMatch[2], 10);
            const nMs = (nextMatch[3] || '0').length === 2 ? parseInt(nextMatch[3] || '0', 10) * 10 : parseInt((nextMatch[3] || '0').padEnd(3, '0').slice(0, 3), 10);
            wEnd = nMin * 60 + nSec + nMs / 1000;
          }

          if (text) {
            words.push({ text, startTime: wStart, endTime: wEnd });
          }
        }
      }
    }

    const textOnly = cleanLine
      .replace(lineTimeRegex, '')
      .replace(/<\d{1,2}:\d{2}\.?\d{0,3}?>/g, '')
      .trim();

    if (!textOnly) continue;

    for (const match of lineMatches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const msStr = match[3] || '0';
      const milliseconds = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
      const totalSeconds = minutes * 60 + seconds + milliseconds / 1000;

      parsedLines.push({
        time: totalSeconds,
        text: textOnly,
        words: words && words.length > 0 ? words : undefined
      });
    }
  }

  // Sort chronologically and populate word timestamps
  const sorted = parsedLines.sort((a, b) => a.time - b.time);
  return generateWordTimestamps(sorted);
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
        const isTtml = data.format === 'ttml' || data.syncedLyrics.includes('<p') || data.syncedLyrics.includes('<tt');
        const parsed = isTtml ? parseTTML(data.syncedLyrics) : parseLRC(data.syncedLyrics);
        const lyricsData: LyricsData = {
          synced: true,
          lines: parsed,
          instrumental: data.instrumental
        };
        lyricsCache.set(cacheKey, lyricsData);
        return lyricsData;
      } else if (data.plainLyrics) {
        // Plain text fallback mapped dynamically across track duration
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

        const withWords = generateWordTimestamps(plainLines, totalDuration);

        const lyricsData: LyricsData = {
          synced: true,
          lines: withWords,
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


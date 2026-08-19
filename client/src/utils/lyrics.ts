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

export interface BackgroundVocal {
  text: string;
  time: number;
  endTime?: number;
  words?: LyricWord[];
}

export interface LyricLine {
  time: number; // in seconds (start time of line)
  endTime?: number;
  text: string;
  words?: LyricWord[];
  isBackgroundVocal?: boolean;
  backgroundVocals?: BackgroundVocal[];
  romanizedText?: string; // Pronunciation / Romaji / Pinyin guide
  translation?: string;   // Meaning / English translation guide
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
 * Helper to extract word spans from TTML XML fragment
 */
function extractWordsFromTTMLFragment(fragment: string, defaultStart: number, defaultEnd: number): LyricWord[] {
  const spanRegex = /<span\s+[^>]*begin="([^"]+)"(?:\s+[^>]*end="([^"]+)")?[^>]*>([^<]+)<\/span>/gi;
  const words: LyricWord[] = [];
  let spanMatch;

  while ((spanMatch = spanRegex.exec(fragment)) !== null) {
    const sBegin = parseTimestamp(spanMatch[1]);
    const sEnd = spanMatch[2] ? parseTimestamp(spanMatch[2]) : (sBegin ? sBegin + 0.5 : 0);
    const text = spanMatch[3].trim();
    if (sBegin !== null && text) {
      words.push({ text, startTime: sBegin, endTime: sEnd || sBegin + 0.4 });
    }
  }

  if (words.length === 0) {
    const cleanText = fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (cleanText) {
      const rawWords = cleanText.split(/\s+/).filter(Boolean);
      const vocalDuration = Math.max(0.4, defaultEnd - defaultStart);
      const totalChars = rawWords.reduce((sum, w) => sum + Math.max(1, w.length), 0);
      let curStart = defaultStart;

      rawWords.forEach(w => {
        const dur = (Math.max(1, w.length) / totalChars) * vocalDuration;
        words.push({
          text: w,
          startTime: Math.round(curStart * 1000) / 1000,
          endTime: Math.round((curStart + dur) * 1000) / 1000
        });
        curStart += dur;
      });
    }
  }

  return words;
}

/**
 * Generate natural, syllable/character-weighted word timestamps for lines that only have line-level timing.
 */
export function generateWordTimestamps(lines: LyricLine[], totalDuration?: number): LyricLine[] {
  return lines.map((line, idx) => {
    // If words are already parsed with timestamps (e.g. from enhanced LRC or TTML), keep them
    if (line.words && line.words.length > 0) {
      return line;
    }

    const rawWords = line.text.trim().split(/\s+/).filter(Boolean);
    if (!rawWords.length) return line;

    const lineStart = line.time;
    const nextLine = lines[idx + 1];
    let lineEnd: number;

    if (line.endTime && line.endTime > lineStart) {
      lineEnd = line.endTime;
    } else if (nextLine && nextLine.time > lineStart) {
      const gap = nextLine.time - lineStart;
      lineEnd = gap > 8 ? lineStart + 4.5 : lineStart + gap * 0.88;
    } else {
      lineEnd = totalDuration && totalDuration > lineStart
        ? Math.min(lineStart + 5.0, totalDuration)
        : lineStart + 4.0;
    }

    const lineDur = Math.max(0.5, lineEnd - lineStart);
    const weights = rawWords.map(w => Math.max(1, w.length));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

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
 * Parses TTML (Timed Text Markup Language) XML strings with Apple Music background vocal / ad-lib support
 */
export function parseTTML(ttmlText: string): LyricLine[] {
  if (!ttmlText || (!ttmlText.includes('<p') && !ttmlText.includes('<span'))) return [];

  const lines: LyricLine[] = [];
  const pRegex = /<p\s+([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch;

  while ((pMatch = pRegex.exec(ttmlText)) !== null) {
    const pAttributes = pMatch[1];
    const innerContent = pMatch[2];

    const beginMatch = pAttributes.match(/begin="([^"]+)"/i);
    const endMatch = pAttributes.match(/end="([^"]+)"/i);
    const isLineBg = /ttm:role="x-bg"/i.test(pAttributes);

    if (!beginMatch) continue;
    const pBegin = parseTimestamp(beginMatch[1]);
    const pEnd = endMatch ? parseTimestamp(endMatch[1]) : (pBegin !== null ? pBegin + 4.0 : undefined);
    if (pBegin === null) continue;

    // Check if inner content contains background vocal span <span ... ttm:role="x-bg">...</span>
    const bgSpanRegex = /<span\s+[^>]*ttm:role="x-bg"[^>]*>([\s\S]*?)<\/span>/gi;
    const backgroundVocals: BackgroundVocal[] = [];
    let bgMatch;
    let mainContent = innerContent;

    while ((bgMatch = bgSpanRegex.exec(innerContent)) !== null) {
      const bgInner = bgMatch[1];
      const bgClean = bgInner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (bgClean) {
        const bgWords = extractWordsFromTTMLFragment(bgInner, pBegin, pEnd ?? (pBegin + 3.5));
        const bgStart = bgWords.length > 0 ? bgWords[0].startTime : pBegin;
        const bgEnd = bgWords.length > 0 ? bgWords[bgWords.length - 1].endTime : (pEnd ?? pBegin + 3.5);
        backgroundVocals.push({
          text: bgClean,
          time: bgStart,
          endTime: bgEnd,
          words: bgWords
        });
      }
    }

    // Strip background vocal spans to extract pure main vocal line
    mainContent = mainContent.replace(/<span\s+[^>]*ttm:role="x-bg"[^>]*>[\s\S]*?<\/span>/gi, '');

    const mainWords = extractWordsFromTTMLFragment(mainContent, pBegin, pEnd ?? (pBegin + 4.0));
    const mainClean = mainContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    // Extract pronunciation/romanization or translation guides if available in TTML metadata
    const romanizedMatch = pAttributes.match(/(?:itunes:)?romanized(?:Text)?="([^"]+)"/i) || innerContent.match(/itunes:romanizedText="([^"]+)"/i);
    const translationMatch = pAttributes.match(/(?:itunes:)?translation="([^"]+)"/i) || innerContent.match(/itunes:translation="([^"]+)"/i);
    const romanizedText = romanizedMatch ? romanizedMatch[1].trim() : undefined;
    const translation = translationMatch ? translationMatch[1].trim() : undefined;

    if (mainClean) {
      lines.push({
        time: pBegin,
        endTime: pEnd ?? (pBegin + 4.0),
        text: mainClean,
        words: mainWords.length > 0 ? mainWords : undefined,
        isBackgroundVocal: isLineBg,
        backgroundVocals: backgroundVocals.length > 0 ? backgroundVocals : undefined,
        romanizedText,
        translation
      });
    } else if (backgroundVocals.length > 0) {
      // Entire line was background vocal
      const firstBg = backgroundVocals[0];
      lines.push({
        time: firstBg.time,
        endTime: firstBg.endTime ?? (firstBg.time + 3.5),
        text: firstBg.text,
        words: firstBg.words,
        isBackgroundVocal: true,
        romanizedText,
        translation
      });
    }
  }

  const sorted = lines.sort((a, b) => a.time - b.time);
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


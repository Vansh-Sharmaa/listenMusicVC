/**
 * LyricsView.tsx
 *
 * Portions of the lyrics rendering and animation engine are adapted from:
 * binimum/am-lyrics (https://github.com/binimum/am-lyrics)
 * Copyright (c) 2024-2025 binimum
 * Licensed under the Mozilla Public License 2.0 (MPL-2.0)
 *
 * Native React + TypeScript port for ListenMusicVC
 */

'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { fetchLyrics, LyricsData, LyricLine } from '../utils/lyrics';
import { extractPaletteFromImage, SongColorPalette } from '../utils/colorExtractor';
import { Mic2, Loader2, Music2, Disc, RotateCcw, Minus, Plus } from 'lucide-react';

export interface LyricsViewProps {
  currentTrack?: {
    id?: string;
    title: string;
    artist: string;
    album?: string;
    thumbnail?: string;
    duration?: number;
  };
  currentTime: number;
  getTime?: () => number;
  isPlaying: boolean;
  theme?: 'light' | 'dark';
  onSeek: (seconds: number) => void;
  onClose?: () => void;
  isFloating?: boolean;
  sidebarWidth?: number;
  onSetSidebarWidth?: (w: number) => void;
}

// Reference animation constants from binimum/am-lyrics
const WIPE_GRADIENT_WIDTH_EM = 0.75;
const CHAR_RISE_Y = '-1.12px';
const WORD_PRE_WIPE_LEAD_SEC = 0.08;
const SCROLL_SMOOTH_LAMBDA = 6.8; // Exponential camera settling rate matching cubic-bezier(0.41, 0, 0.12, 0.99)

export const LyricsView: React.FC<LyricsViewProps> = ({
  currentTrack,
  currentTime,
  getTime,
  isPlaying,
  theme = 'dark',
  onSeek,
  onClose,
  sidebarWidth,
  onSetSidebarWidth,
}) => {
  const isLight = theme === 'light';
  const [lyricsData, setLyricsData] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [syncOffset, setSyncOffset] = useState<number>(0.0);
  const [songPalette, setSongPalette] = useState<SongColorPalette | null>(null);
  const [showPronunciation, setShowPronunciation] = useState<boolean>(true);
  const [showTranslation, setShowTranslation] = useState<boolean>(true);

  // High-precision clock extrapolation
  const lastAuthoritativeTimeRef = useRef<{ time: number; perfNow: number }>({
    time: 0,
    perfNow: performance.now(),
  });
  const isPlayingRef = useRef<boolean>(isPlaying);
  const getTimeRef = useRef<(() => number) | undefined>(getTime);
  const syncOffsetRef = useRef<number>(0.0);
  const isLightRef = useRef<boolean>(isLight);

  // DOM and geometry references
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const wordRefs = useRef<(HTMLSpanElement | null)[][]>([]);
  const bgWordRefs = useRef<(HTMLSpanElement | null)[][][]>([]);
  const cleanLinesRef = useRef<LyricLine[]>([]);

  const geometryCacheRef = useRef<{ lineTops: number[]; lineHeights: number[]; containerHeight: number }>({
    lineTops: [],
    lineHeights: [],
    containerHeight: 0,
  });

  // Continuous Camera State
  const scrollStateRef = useRef<{ currentY: number; targetY: number; isUserScrolling: boolean }>({
    currentY: 0,
    targetY: 0,
    isUserScrolling: false,
  });
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeLineIndexRef = useRef<number>(-1);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(performance.now());

  // Keep state refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { getTimeRef.current = getTime; }, [getTime]);
  useEffect(() => { syncOffsetRef.current = syncOffset; }, [syncOffset]);
  useEffect(() => { isLightRef.current = isLight; }, [isLight]);

  // Update clock on authoritative currentTime prop change
  useEffect(() => {
    lastAuthoritativeTimeRef.current = {
      time: currentTime,
      perfNow: performance.now(),
    };
  }, [currentTime]);

  // Extract song album art palette for Apple Music fluid ambient backdrop
  useEffect(() => {
    if (currentTrack?.thumbnail) {
      extractPaletteFromImage(currentTrack.thumbnail).then((palette) => {
        setSongPalette(palette);
      });
    } else {
      setSongPalette(null);
    }
  }, [currentTrack?.thumbnail]);

  // Fetch lyrics
  useEffect(() => {
    if (!currentTrack?.title) {
      setLyricsData(null);
      return;
    }
    let isMounted = true;
    setLoading(true);
    fetchLyrics(currentTrack.title, currentTrack.artist, currentTrack.duration)
      .then((data) => {
        if (isMounted) {
          setLyricsData(data);
          setLoading(false);
          lineRefs.current = [];
          wordRefs.current = [];
          activeLineIndexRef.current = -1;
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });
    return () => { isMounted = false; };
  }, [currentTrack?.title, currentTrack?.artist]);

  // Clean lines: keep valid lines and deduplicate consecutive duplicates
  const cleanLines = useMemo(() => {
    if (!lyricsData?.lines) return [];
    const result: LyricLine[] = [];
    const seen = new Set<string>();
    for (const line of lyricsData.lines) {
      const t = line.text.trim();
      if (!t) continue;
      const lower = t.toLowerCase();
      if (seen.has(lower) && result.length > 0 && result[result.length - 1].text.toLowerCase() === lower) continue;
      seen.add(lower);
      result.push(line);
    }
    cleanLinesRef.current = result;
    return result;
  }, [lyricsData]);

  const hasPronunciation = useMemo(() => cleanLines.some(l => Boolean(l.romanizedText)), [cleanLines]);
  const hasTranslation = useMemo(() => cleanLines.some(l => Boolean(l.translation)), [cleanLines]);

  // Measure and cache layout geometry
  const updateGeometryCache = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerHeight = container.clientHeight;
    const lines = cleanLinesRef.current;
    const lineTops: number[] = [];
    const lineHeights: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const el = lineRefs.current[i];
      if (el) {
        lineTops.push(el.offsetTop);
        lineHeights.push(el.offsetHeight);
      } else {
        lineTops.push(0);
        lineHeights.push(48);
      }
    }

    geometryCacheRef.current = { lineTops, lineHeights, containerHeight };
  }, []);

  // Reset scroll and line index on new lyrics loaded
  useEffect(() => {
    scrollStateRef.current.currentY = 0;
    scrollStateRef.current.targetY = 0;
    activeLineIndexRef.current = -1;
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [cleanLines]);

  // Update geometry on lyrics load, window resize, or container width change (sidebar slide/extend)
  useEffect(() => {
    const timer = setTimeout(updateGeometryCache, 40);
    window.addEventListener('resize', updateGeometryCache);

    let ro: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        updateGeometryCache();
      });
      ro.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateGeometryCache);
      if (ro) ro.disconnect();
    };
  }, [cleanLines, showPronunciation, showTranslation, updateGeometryCache]);

  // ─── Single Unified High-Resolution RAF Loop (am-lyrics Engine) ───────────
  useEffect(() => {
    const paint = (frameTime: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (frameTime - lastFrameTimeRef.current) / 1000));
      lastFrameTimeRef.current = frameTime;

      const lines = cleanLinesRef.current;
      const light = isLightRef.current;
      const offset = syncOffsetRef.current;

      // 1. High-Resolution Audio Clock (Sub-Frame Interpolated)
      let nowSecs: number;
      if (getTimeRef.current) {
        nowSecs = getTimeRef.current() + offset;
      } else {
        const { time, perfNow } = lastAuthoritativeTimeRef.current;
        const elapsed = isPlayingRef.current ? (frameTime - perfNow) / 1000 : 0;
        nowSecs = time + elapsed + offset;
      }

      if (!lines.length) {
        rafRef.current = requestAnimationFrame(paint);
        return;
      }

      // 2. Active Line Index Lookup & Smooth Sweet-Spot Centering
      let cur = -1;
      for (let i = 0; i < lines.length; i++) {
        if (nowSecs >= lines[i].time) {
          cur = i;
        } else {
          break;
        }
      }

      const { lineTops, lineHeights, containerHeight } = geometryCacheRef.current;
      const prev = activeLineIndexRef.current;
      const activeLineChanged = cur !== prev;

      // 3. Smooth Apple Music Center Focus on Active Line Change
      if (activeLineChanged) {
        activeLineIndexRef.current = cur;

        if (cur >= 0 && containerHeight > 0 && lineTops[cur] !== undefined) {
          // Center active line at ~32% viewport height (Apple Music sweet spot)
          const targetFocusY = containerHeight * 0.32;
          scrollStateRef.current.targetY = Math.max(0, (lineTops[cur] || 0) - targetFocusY + (lineHeights[cur] || 48) / 2);
        } else {
          scrollStateRef.current.targetY = 0;
        }

        // Apply smooth depth classes (with CSS transition for organic 0.7s fluid pull & glide)
        for (let i = 0; i < lines.length; i++) {
          const lineEl = lineRefs.current[i];
          if (!lineEl) continue;

          if (cur === -1) {
            if (i === 0) {
              lineEl.style.opacity = '0.80';
              lineEl.style.transform = 'scale(1.0) translate3d(0, 0, 0)';
              lineEl.style.filter = 'none';
            } else if (i === 1) {
              lineEl.style.opacity = '0.45';
              lineEl.style.transform = 'scale(0.98) translate3d(0, 3px, 0)';
              lineEl.style.filter = 'none';
            } else {
              lineEl.style.opacity = '0.18';
              lineEl.style.transform = 'scale(0.95) translate3d(0, 6px, 0)';
              lineEl.style.filter = 'none';
            }
            continue;
          }

          const dist = i - cur;
          if (dist === 0) {
            // Active line: prominent, sharp, and focused
            lineEl.style.opacity = '1';
            lineEl.style.transform = 'scale(1.02) translate3d(0, 0, 0)';
            lineEl.style.filter = 'none';
          } else if (dist === -1) {
            // Immediately previous line (pulled upward)
            lineEl.style.opacity = '0.45';
            lineEl.style.transform = 'scale(0.98) translate3d(0, -3px, 0)';
            lineEl.style.filter = 'none';
          } else if (dist === 1) {
            // Next incoming line (gliding upward from bottom)
            lineEl.style.opacity = '0.45';
            lineEl.style.transform = 'scale(0.98) translate3d(0, 3px, 0)';
            lineEl.style.filter = 'none';
          } else if (dist === 2) {
            lineEl.style.opacity = '0.22';
            lineEl.style.transform = 'scale(0.96) translate3d(0, 6px, 0)';
            lineEl.style.filter = 'none';
          } else {
            lineEl.style.opacity = '0.10';
            lineEl.style.transform = `scale(0.94) translate3d(0, ${dist > 0 ? '9px' : '-6px'}, 0)`;
            lineEl.style.filter = 'none';
          }
        }
      }

      // 4. Frame-Rate Independent Exponential Camera Lerp (Silky Pull & Gliding Physics)
      const container = containerRef.current;
      if (container && !scrollStateRef.current.isUserScrolling) {
        const { targetY } = scrollStateRef.current;
        let { currentY } = scrollStateRef.current;

        // alpha = 1 - e^(-lambda * dt) (lambda = 4.6 for Apple Music elastic pull sensation)
        const alpha = 1 - Math.exp(-4.6 * dt);
        currentY += (targetY - currentY) * alpha;

        if (Math.abs(targetY - currentY) < 0.2) {
          currentY = targetY;
        }

        scrollStateRef.current.currentY = currentY;
        container.scrollTop = currentY;
      }

      // 5. am-lyrics Background-Size Wipe Highlight Formula
      const primaryColor = light ? '#000000' : '#ffffff';
      const secondaryColor = light ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.30)';

      if (cur >= 0 && cur < lines.length) {
        const line = lines[cur];
        const words = line.words || [];
        const wSpans = wordRefs.current[cur] || [];

        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const w = words[wIdx];
          const span = wSpans[wIdx];
          if (!span) continue;

          const preWipeStart = w.startTime - WORD_PRE_WIPE_LEAD_SEC;

          if (nowSecs < preWipeStart) {
            // Future word: dim secondary color
            span.style.background = 'none';
            span.style.backgroundColor = secondaryColor;
            (span.style as any).webkitBackgroundClip = 'text';
            span.style.backgroundClip = 'text';
            (span.style as any).webkitTextFillColor = 'transparent';
            span.style.fontWeight = '700';
            span.style.transform = 'translate3d(0, 0, 0)';
            span.style.filter = 'none';
          } else if (nowSecs >= w.endTime) {
            // Finished word: solid primary color + settled transform
            span.style.background = 'none';
            span.style.backgroundColor = primaryColor;
            (span.style as any).webkitBackgroundClip = 'text';
            span.style.backgroundClip = 'text';
            (span.style as any).webkitTextFillColor = 'transparent';
            span.style.fontWeight = '800';
            span.style.transform = `translate3d(0, ${CHAR_RISE_Y}, 0)`;
            span.style.filter = 'none';
          } else {
            // Active wiping word: am-lyrics linear-gradient wipe formula
            const wordDuration = Math.max(0.05, w.endTime - w.startTime);
            const rawProgress = Math.max(0, Math.min(1, (nowSecs - w.startTime) / wordDuration));

            // Human easeInOut
            const progress = rawProgress < 0.5
              ? 2 * rawProgress * rawProgress
              : -1 + (4 - 2 * rawProgress) * rawProgress;

            // am-lyrics formula: background-size expands from 0% to (100% + wipeGradientWidth)
            const wipeSizePct = Math.min(100, Math.max(0, progress * 100));

            span.style.backgroundColor = secondaryColor;
            span.style.backgroundImage = `linear-gradient(90deg, ${primaryColor} 0%, ${primaryColor} calc(100% - ${WIPE_GRADIENT_WIDTH_EM}em), transparent 100%)`;
            span.style.backgroundRepeat = 'no-repeat';
            span.style.backgroundPosition = 'left';
            span.style.backgroundSize = `${wipeSizePct}% 100%`;
            (span.style as any).webkitBackgroundClip = 'text';
            span.style.backgroundClip = 'text';
            (span.style as any).webkitTextFillColor = 'transparent';
            span.style.fontWeight = '800';
            span.style.transform = `translate3d(0, ${CHAR_RISE_Y}, 0)`;
            span.style.filter = 'none';
          }
        }

        // Paint background vocal / ad-lib words
        if (line.backgroundVocals && bgWordRefs.current[cur]) {
          const bgPrimary = light ? '#1f2937' : 'rgba(255,255,255,0.85)';
          const bgSecondary = light ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)';

          for (let bgIdx = 0; bgIdx < line.backgroundVocals.length; bgIdx++) {
            const bgVocal = line.backgroundVocals[bgIdx];
            const bgWords = bgVocal.words || [];
            const bgSpans = bgWordRefs.current[cur]?.[bgIdx] || [];

            for (let bwIdx = 0; bwIdx < bgWords.length; bwIdx++) {
              const bw = bgWords[bwIdx];
              const bSpan = bgSpans[bwIdx];
              if (!bSpan) continue;

              const preWipeStart = bw.startTime - WORD_PRE_WIPE_LEAD_SEC;

              if (nowSecs < preWipeStart) {
                bSpan.style.background = 'none';
                bSpan.style.backgroundColor = bgSecondary;
                (bSpan.style as any).webkitBackgroundClip = 'text';
                bSpan.style.backgroundClip = 'text';
                (bSpan.style as any).webkitTextFillColor = 'transparent';
                bSpan.style.fontWeight = '600';
                bSpan.style.transform = 'translate3d(0, 0, 0)';
              } else if (nowSecs >= bw.endTime) {
                bSpan.style.background = 'none';
                bSpan.style.backgroundColor = bgPrimary;
                (bSpan.style as any).webkitBackgroundClip = 'text';
                bSpan.style.backgroundClip = 'text';
                (bSpan.style as any).webkitTextFillColor = 'transparent';
                bSpan.style.fontWeight = '700';
                bSpan.style.transform = `translate3d(0, ${CHAR_RISE_Y}, 0)`;
              } else {
                const wordDuration = Math.max(0.05, bw.endTime - bw.startTime);
                const rawProgress = Math.max(0, Math.min(1, (nowSecs - bw.startTime) / wordDuration));
                const progress = rawProgress < 0.5
                  ? 2 * rawProgress * rawProgress
                  : -1 + (4 - 2 * rawProgress) * rawProgress;
                const wipeSizePct = Math.min(100, Math.max(0, progress * 100));

                bSpan.style.backgroundColor = bgSecondary;
                bSpan.style.backgroundImage = `linear-gradient(90deg, ${bgPrimary} 0%, ${bgPrimary} calc(100% - ${WIPE_GRADIENT_WIDTH_EM}em), transparent 100%)`;
                bSpan.style.backgroundRepeat = 'no-repeat';
                bSpan.style.backgroundPosition = 'left';
                bSpan.style.backgroundSize = `${wipeSizePct}% 100%`;
                (bSpan.style as any).webkitBackgroundClip = 'text';
                bSpan.style.backgroundClip = 'text';
                (bSpan.style as any).webkitTextFillColor = 'transparent';
                bSpan.style.fontWeight = '700';
                bSpan.style.transform = `translate3d(0, ${CHAR_RISE_Y}, 0)`;
              }
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(paint);
    };

    rafRef.current = requestAnimationFrame(paint);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Handle explicit user gesture scrolling (wheel / touch) without getting tripped by programmatic RAF scroll
  const handleUserInteractionStart = useCallback(() => {
    scrollStateRef.current.isUserScrolling = true;

    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      scrollStateRef.current.isUserScrolling = false;
      const cur = activeLineIndexRef.current;
      const { lineTops, lineHeights, containerHeight } = geometryCacheRef.current;
      if (cur >= 0 && lineTops[cur] !== undefined && containerHeight > 0) {
        const targetFocusY = containerHeight * 0.38;
        scrollStateRef.current.targetY = Math.max(0, (lineTops[cur] || 0) - targetFocusY + (lineHeights[cur] || 48) / 2);
      }
    }, 2400);
  }, []);

  if (!currentTrack) {
    return (
      <div className={`h-full flex flex-col items-center justify-center p-6 text-center select-none ${isLight ? 'text-black/40' : 'text-white/40'}`}>
        <Disc size={36} className="animate-spin opacity-40 mb-3" />
        <p className="text-sm font-medium">No track playing</p>
        <p className="text-xs opacity-70 mt-1">Play any song to view synchronized lyrics</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full w-full relative overflow-hidden select-none transition-colors duration-500 ${isLight ? 'bg-white text-black' : 'bg-[#0e0e11] text-white'}`}>

      {/* Dynamic Ambient Album Backdrop */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-25 transition-all duration-1000 blur-3xl scale-125"
        style={{
          background: songPalette
            ? `radial-gradient(circle at 25% 25%, ${songPalette.primary}, transparent 60%), radial-gradient(circle at 75% 75%, ${songPalette.secondary}, transparent 60%), radial-gradient(circle at 50% 50%, ${songPalette.darkMuted}, transparent 80%)`
            : undefined
        }}
      />

      {/* Header with Sync Offset controls */}
      <div className={`px-4 py-3.5 border-b flex items-center justify-between z-20 backdrop-blur-2xl ${isLight ? 'bg-white/80 border-black/5' : 'bg-black/40 border-white/10'}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-fuchsia-500/20 text-fuchsia-400">
            <Mic2 size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold tracking-wide flex items-center gap-1.5">
              <span>Apple Music Lyrics</span>
              <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? 'bg-fuchsia-400 animate-pulse' : 'bg-white/30'}`} />
            </span>
            <span className={`text-[10px] truncate ${isLight ? 'text-black/50' : 'text-white/50'}`}>
              {currentTrack.title} • {currentTrack.artist}
            </span>
          </div>
        </div>

        {/* Controls Container */}
        <div className="flex items-center gap-1.5">
          {/* Quick Width Snap Presets */}
          {onSetSidebarWidth && (
            <div className="hidden sm:flex items-center gap-0.5 bg-white/10 border border-white/10 rounded-full p-0.5 text-[10px] font-bold">
              <button
                onClick={() => onSetSidebarWidth(380)}
                className={`px-2 py-0.5 rounded-full transition-all active:scale-95 ${sidebarWidth && sidebarWidth < 460 ? 'bg-fuchsia-600 text-white shadow-sm' : 'text-white/60 hover:text-white'}`}
                title="Compact Width (380px)"
              >
                380
              </button>
              <button
                onClick={() => onSetSidebarWidth(540)}
                className={`px-2 py-0.5 rounded-full transition-all active:scale-95 ${sidebarWidth && sidebarWidth >= 460 && sidebarWidth < 680 ? 'bg-fuchsia-600 text-white shadow-sm' : 'text-white/60 hover:text-white'}`}
                title="Expanded Width (540px)"
              >
                540
              </button>
              <button
                onClick={() => onSetSidebarWidth(760)}
                className={`px-2 py-0.5 rounded-full transition-all active:scale-95 ${sidebarWidth && sidebarWidth >= 680 ? 'bg-fuchsia-600 text-white shadow-sm' : 'text-white/60 hover:text-white'}`}
                title="Cinema Wide (760px)"
              >
                760
              </button>
            </div>
          )}

          {/* Quick Pronunciation (Romaji) & Translation Toggles */}
          {hasPronunciation && (
            <button
              onClick={() => setShowPronunciation(p => !p)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all active:scale-95 ${
                showPronunciation
                  ? 'bg-fuchsia-600 border-fuchsia-500 text-white shadow-sm'
                  : 'bg-white/10 border-white/10 text-white/50 hover:text-white'
              }`}
              title="Toggle Pronunciation / Romanization Guide"
            >
              Romaji
            </button>
          )}
          {hasTranslation && (
            <button
              onClick={() => setShowTranslation(p => !p)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all active:scale-95 ${
                showTranslation
                  ? 'bg-fuchsia-600 border-fuchsia-500 text-white shadow-sm'
                  : 'bg-white/10 border-white/10 text-white/50 hover:text-white'
              }`}
              title="Toggle English Translation Subtitles"
            >
              Trans
            </button>
          )}

          {/* Sync Offset Controls */}
          <div className="flex items-center gap-1 bg-white/10 border border-white/10 rounded-full px-2 py-0.5 text-xs">
            <button
              onClick={() => setSyncOffset(p => Math.round((p - 0.5) * 10) / 10)}
              className="p-1 hover:text-fuchsia-400 transition-colors active:scale-90"
              title="Nudge Lyrics 0.5s Earlier"
            >
              <Minus size={11} />
            </button>
            <span className="font-mono font-bold text-[11px] min-w-[38px] text-center text-white/80">
              {syncOffset >= 0 ? `+${syncOffset.toFixed(1)}s` : `${syncOffset.toFixed(1)}s`}
            </span>
            <button
              onClick={() => setSyncOffset(p => Math.round((p + 0.5) * 10) / 10)}
              className="p-1 hover:text-fuchsia-400 transition-colors active:scale-90"
              title="Nudge Lyrics 0.5s Later"
            >
              <Plus size={11} />
            </button>
            {syncOffset !== 0 && (
              <button
                onClick={() => setSyncOffset(0)}
                className="p-1 hover:text-amber-400 transition-colors active:scale-90 ml-0.5 text-white/50"
                title="Reset Sync Offset"
              >
                <RotateCcw size={10} />
              </button>
            )}
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold transition-all active:scale-90 ${isLight ? 'bg-black/5 hover:bg-black/10 text-black/70' : 'bg-white/10 hover:bg-white/20 text-white/80'}`}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Lyrics Scroll Body */}
      <div
        ref={containerRef}
        onWheel={handleUserInteractionStart}
        onTouchStart={handleUserInteractionStart}
        onTouchMove={handleUserInteractionStart}
        className="flex-1 overflow-y-auto px-6 md:px-12 scrollbar-none relative z-10"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 86%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 12%, rgba(0,0,0,1) 86%, transparent 100%)'
        }}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3 opacity-60">
            <Loader2 size={28} className="animate-spin text-fuchsia-500" />
            <span className="text-xs font-medium tracking-wide">Syncing Apple Music lyrics…</span>
          </div>
        ) : !cleanLines.length ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3 opacity-40 text-center">
            <Music2 size={36} />
            <span className="text-sm font-semibold">No lyrics found for this track</span>
          </div>
        ) : (
          <div className="pt-[28vh] pb-[52vh]">
            {cleanLines.map((line, lineIndex) => {
              const words = line.words || [{ text: line.text, startTime: line.time, endTime: line.endTime || line.time + 4 }];
              if (!wordRefs.current[lineIndex]) {
                wordRefs.current[lineIndex] = [];
              }

              return (
                <div
                  key={`${line.time}-${lineIndex}`}
                  ref={el => { lineRefs.current[lineIndex] = el; }}
                  className="py-3.5 origin-left"
                  style={{
                    transition: 'opacity 0.7s cubic-bezier(0.25, 1, 0.5, 1), transform 0.7s cubic-bezier(0.25, 1, 0.5, 1), filter 0.7s ease',
                    willChange: 'opacity, transform, filter'
                  }}
                >
                  <button
                    onClick={() => {
                      onSeek(line.time);
                      lastAuthoritativeTimeRef.current = { time: line.time, perfNow: performance.now() };
                      activeLineIndexRef.current = lineIndex;
                      scrollStateRef.current.isUserScrolling = false;
                      const { lineTops, lineHeights, containerHeight } = geometryCacheRef.current;
                      if (lineTops[lineIndex] !== undefined && containerHeight > 0) {
                        const targetFocusY = containerHeight * 0.38;
                        scrollStateRef.current.targetY = Math.max(0, (lineTops[lineIndex] || 0) - targetFocusY + (lineHeights[lineIndex] || 48) / 2);
                      }
                    }}
                    className="w-full text-left focus:outline-none cursor-pointer group"
                  >
                    {/* Pronunciation / Romanization Guide (Above Main Line) */}
                    {showPronunciation && line.romanizedText && (
                      <div className="text-xs sm:text-[13px] font-semibold tracking-wide text-fuchsia-300/90 mb-1 select-none flex items-center gap-1.5 opacity-90">
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30">Romaji</span>
                        <span className="tracking-wide">{line.romanizedText}</span>
                      </div>
                    )}

                    <p
                      className={`${
                        line.isBackgroundVocal
                          ? 'text-lg sm:text-xl md:text-[1.55rem] leading-[1.3] font-semibold opacity-85'
                          : 'text-xl sm:text-2xl md:text-[2.1rem] leading-[1.32] font-bold'
                      } tracking-[-0.025em] m-0 break-words`}
                      style={{
                        fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                        color: isLight ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.30)',
                      }}
                    >
                      {words.map((w, wIdx) => (
                        <span
                          key={`${w.startTime}-${wIdx}`}
                          ref={el => { wordRefs.current[lineIndex][wIdx] = el; }}
                          className="inline-block mr-[0.28em] transition-transform duration-300"
                          style={{
                            fontWeight: line.isBackgroundVocal ? 600 : 700,
                            color: 'transparent',
                            backgroundColor: isLight ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.30)',
                            WebkitBackgroundClip: 'text',
                            backgroundClip: 'text',
                          }}
                        >
                          {w.text}
                        </span>
                      ))}
                    </p>

                    {/* Apple Music Nested Background Vocals / Ad-Libs */}
                    {line.backgroundVocals && line.backgroundVocals.map((bgVocal, bgIdx) => {
                      const bgWords = bgVocal.words || [{ text: bgVocal.text, startTime: bgVocal.time, endTime: bgVocal.endTime || bgVocal.time + 3 }];
                      return (
                        <div
                          key={`bg-${bgIdx}`}
                          className="text-base sm:text-lg md:text-[1.35rem] leading-[1.28] tracking-[-0.015em] mt-1.5 break-words opacity-90 pl-1"
                          style={{
                            fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                            color: isLight ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)',
                          }}
                        >
                          {bgWords.map((bw, bwIdx) => (
                            <span
                              key={`bg-${bw.startTime}-${bwIdx}`}
                              ref={el => {
                                if (!bgWordRefs.current[lineIndex]) bgWordRefs.current[lineIndex] = [];
                                if (!bgWordRefs.current[lineIndex][bgIdx]) bgWordRefs.current[lineIndex][bgIdx] = [];
                                bgWordRefs.current[lineIndex][bgIdx][bwIdx] = el;
                              }}
                              className="inline-block mr-[0.25em] transition-transform duration-300"
                              style={{
                                fontWeight: 600,
                                color: 'transparent',
                                backgroundColor: isLight ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)',
                                WebkitBackgroundClip: 'text',
                                backgroundClip: 'text',
                              }}
                            >
                              {bw.text}
                            </span>
                          ))}
                        </div>
                      );
                    })}

                    {/* Translation Guide (Below Main Line) */}
                    {showTranslation && line.translation && (
                      <div
                        className="text-xs sm:text-sm md:text-[1.05rem] font-medium leading-[1.3] opacity-75 mt-1 tracking-normal select-none italic"
                        style={{ color: isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)' }}
                      >
                        {line.translation}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lyricsData?.synced && (
        <div className={`py-2.5 px-4 text-center border-t text-[10px] tracking-widest font-bold uppercase flex items-center justify-center gap-2 backdrop-blur-2xl relative z-20 ${isLight ? 'bg-white/40 border-black/5 text-black/30' : 'bg-black/40 border-white/5 text-white/25'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? 'bg-fuchsia-400 animate-pulse' : 'opacity-30 bg-current'}`} />
          Apple Music Synced Engine
          <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? 'bg-fuchsia-400 animate-pulse' : 'opacity-30 bg-current'}`} />
        </div>
      )}
    </div>
  );
};










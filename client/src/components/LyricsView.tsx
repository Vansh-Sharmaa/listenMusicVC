'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { fetchLyrics, LyricsData, LyricLine } from '../utils/lyrics';
import { motion } from 'motion/react';
import { Mic2, Loader2, Music2, Disc } from 'lucide-react';
import { extractPaletteFromImage, SongColorPalette } from '../utils/colorExtractor';

interface LyricsViewProps {
  currentTrack: {
    id: string;
    title: string;
    artist: string;
    duration?: number;
    thumbnail?: string;
  } | null;
  currentTime: number;
  getTime?: () => number;
  isPlaying: boolean;
  theme?: 'light' | 'dark';
  onSeek: (seconds: number) => void;
  onClose?: () => void;
  isFloating?: boolean;
}

const SPRING_CFG = { type: 'spring', stiffness: 220, damping: 28, mass: 0.9 } as const;

export const LyricsView: React.FC<LyricsViewProps> = ({
  currentTrack,
  currentTime,
  getTime,
  isPlaying,
  theme = 'dark',
  onSeek,
  onClose,
  isFloating = false,
}) => {
  const isLight = theme === 'light';
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);
  const [userIsScrolling, setUserIsScrolling] = useState<boolean>(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lyricsRef = useRef<LyricsData | null>(null);
  const activeLineIndexRef = useRef<number>(-1);
  const [songPalette, setSongPalette] = useState<SongColorPalette | null>(null);

  // Word span refs: wordSpanRefs[lineIndex][wordIndex] -> HTMLSpanElement
  const wordSpanRefs = useRef<HTMLSpanElement[][]>([]);
  const rafRef = useRef<number | null>(null);
  const isLightRef = useRef(isLight);
  useEffect(() => { isLightRef.current = isLight; }, [isLight]);

  // Extract song palette colors for fluid dynamic ambient backdrop
  useEffect(() => {
    if (currentTrack?.thumbnail) {
      extractPaletteFromImage(currentTrack.thumbnail).then(palette => {
        setSongPalette(palette);
      });
    } else {
      setSongPalette(null);
    }
  }, [currentTrack?.thumbnail]);

  // 1. Fetch lyrics
  useEffect(() => {
    if (!currentTrack?.title) { setLyrics(null); lyricsRef.current = null; return; }
    let isMounted = true;
    setLoading(true);
    setActiveLineIndex(-1);
    activeLineIndexRef.current = -1;
    fetchLyrics(currentTrack.title, currentTrack.artist, currentTrack.duration)
      .then((data) => {
        if (isMounted) {
          setLyrics(data);
          lyricsRef.current = data;
          setLoading(false);
          wordSpanRefs.current = [];
        }
      })
      .catch(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [currentTrack?.title, currentTrack?.artist]);

  // 2. Active line tracking via React state (for scroll & structure re-render only)
  useEffect(() => {
    if (!lyrics || !lyrics.lines.length) return;
    let currentIndex = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (currentTime >= lyrics.lines[i].time) { currentIndex = i; } else { break; }
    }
    if (currentIndex !== activeLineIndex) {
      setActiveLineIndex(currentIndex);
      activeLineIndexRef.current = currentIndex;
    }
  }, [currentTime, lyrics]);

  // 3. Smooth auto-scroll to center the active line
  useEffect(() => {
    if (userIsScrolling || activeLineIndex < 0) return;
    const el = lineRefs.current[activeLineIndex];
    if (el && containerRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLineIndex, userIsScrolling]);

  const handleScroll = useCallback(() => {
    setUserIsScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => setUserIsScrolling(false), 2800);
  }, []);

  // 4. THE CORE: 60fps RAF loop that directly paints word glow via DOM style
  //    Zero React re-renders. Pure DOM mutation for buttery smoothness.
  useEffect(() => {
    const paint = () => {
      const lyricData = lyricsRef.current;
      const activeIdx = activeLineIndexRef.current;
      const light = isLightRef.current;

      if (lyricData && activeIdx >= 0) {
        const line = lyricData.lines[activeIdx];
        const nextLine = lyricData.lines[activeIdx + 1];
        const nowSecs = getTime ? getTime() : currentTime;

        const lineDuration = nextLine ? Math.max(1.2, nextLine.time - line.time) : 4.0;
        const elapsed = Math.max(0, nowSecs - line.time);
        const wordSpans = wordSpanRefs.current[activeIdx];

        if (wordSpans && wordSpans.length > 0) {
          const totalWords = wordSpans.length;
          // rawProgress goes from 0 → totalWords over the line duration
          const rawProgress = Math.min(totalWords, (elapsed / lineDuration) * (totalWords + 0.5));

          for (let i = 0; i < totalWords; i++) {
            const span = wordSpans[i];
            if (!span) continue;
            const progress = rawProgress - i; // 0=future, 0-1=current, >1=past
            const isFullyLit = progress >= 1;
            const isCurrentWord = progress > 0 && progress < 1;
            const p = Math.max(0, Math.min(1, progress));

            if (light) {
              if (isFullyLit) {
                span.style.color = 'rgba(0,0,0,0.96)';
                span.style.textShadow = '0 0 12px rgba(0,0,0,0.45)';
                span.style.transform = 'scale(1.025)';
              } else if (isCurrentWord) {
                span.style.color = `rgba(0,0,0,${0.28 + p * 0.68})`;
                span.style.textShadow = `0 0 ${4 + p * 10}px rgba(0,0,0,${0.08 + p * 0.37})`;
                span.style.transform = `scale(${1.0 + p * 0.025})`;
              } else {
                span.style.color = 'rgba(0,0,0,0.28)';
                span.style.textShadow = 'none';
                span.style.transform = 'scale(1.0)';
              }
            } else {
              if (isFullyLit) {
                span.style.color = 'rgba(255,255,255,0.98)';
                span.style.textShadow = '0 0 20px rgba(255,255,255,0.9), 0 0 38px rgba(255,255,255,0.4)';
                span.style.transform = 'scale(1.03)';
              } else if (isCurrentWord) {
                span.style.color = `rgba(255,255,255,${0.26 + p * 0.72})`;
                span.style.textShadow = `0 0 ${5 + p * 22}px rgba(255,255,255,${0.08 + p * 0.82})`;
                span.style.transform = `scale(${1.0 + p * 0.03})`;
              } else {
                span.style.color = 'rgba(255,255,255,0.26)';
                span.style.textShadow = 'none';
                span.style.transform = 'scale(1.0)';
              }
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(paint);
    };

    rafRef.current = requestAnimationFrame(paint);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [getTime]); // only re-subscribe if getTime changes

  if (!currentTrack) {
    return (
      <div className={`h-full flex flex-col items-center justify-center p-6 text-center select-none ${isLight ? 'text-black/40' : 'text-white/40'}`}>
        <Disc size={36} className="animate-spin opacity-40 mb-3" />
        <p className="text-sm font-medium">No track playing</p>
        <p className="text-xs opacity-70 mt-1">Play any song to view real-time synchronized lyrics</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full w-full relative overflow-hidden select-none transition-colors duration-500 ${isLight ? 'bg-white text-black' : 'bg-black/35 text-white'}`}>
      
      {/* Dynamic Fluid Backdrop Mesh (Apple Music style) */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-40 transition-all duration-1000"
        style={{
          background: songPalette
            ? `radial-gradient(circle at 15% 20%, ${songPalette.primary}, transparent 55%), radial-gradient(circle at 85% 80%, ${songPalette.secondary}, transparent 55%), radial-gradient(circle at 50% 50%, ${songPalette.darkMuted}, transparent 75%)`
            : undefined
        }}
      />
      {currentTrack?.thumbnail && (
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center pointer-events-none opacity-20 mix-blend-screen transition-all duration-1000"
          style={{ 
            backgroundImage: `url(${currentTrack.thumbnail})`,
            filter: 'blur(90px) saturate(140%) brightness(0.7)',
            transform: 'scale(1.15)'
          }} 
        />
      )}

      {/* Header */}
      <div className={`p-4 border-b flex items-center justify-between z-10 backdrop-blur-2xl ${isLight ? 'bg-white/40 border-black/5' : 'bg-black/30 border-white/5'}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-fuchsia-500/20 text-fuchsia-400 shadow-inner">
            <Mic2 size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold tracking-wide flex items-center gap-1.5">
              <span>Apple Music Lyrics</span>
              <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 animate-ping" />
            </span>
            <span className={`text-[10px] truncate ${isLight ? 'text-black/50' : 'text-white/50'}`}>
              {currentTrack.title} • {currentTrack.artist}
            </span>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className={`p-1.5 rounded-full text-xs font-semibold px-3 transition-all active:scale-95 ${isLight ? 'bg-black/5 hover:bg-black/10 text-black/70' : 'bg-white/10 hover:bg-white/20 text-white/80'}`}
          >✕</button>
        )}
      </div>

      {/* Lyrics body (with top/bottom gradient fade masks) */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-16 space-y-6 scrollbar-none relative z-10"
        style={{ 
          scrollBehavior: 'smooth',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)'
        }}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 opacity-60">
            <Loader2 size={28} className="animate-spin text-fuchsia-500" />
            <span className="text-xs font-medium tracking-wide">Syncing real-time lyrics...</span>
          </div>
        ) : !lyrics || !lyrics.lines.length ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-3 opacity-50 px-4">
            <Music2 size={36} />
            <span className="text-sm font-semibold">Lyrics not available for this song</span>
            <span className="text-xs max-w-xs">Listen with your friends in synchronized high-fidelity audio!</span>
          </div>
        ) : (
          <>
            <div className="h-32" />
            {lyrics.lines.map((line: LyricLine, index: number) => {
              const isActive = index === activeLineIndex;
              const isPast = index < activeLineIndex;
              // Split words for rendering - preserve spaces
              const tokens = line.text.split(/(\s+)/);
              const nonSpaceTokenIndices: number[] = [];
              tokens.forEach((t, i) => { if (t.trim().length > 0) nonSpaceTokenIndices.push(i); });

              return (
                <div
                  key={`${line.time}-${index}`}
                  ref={(el) => { lineRefs.current[index] = el; }}
                  className="transition-all duration-500"
                >
                  <motion.button
                    onClick={() => onSeek(line.time)}
                    animate={{
                      opacity: isActive ? 1 : isPast ? 0.38 : 0.22,
                      filter: isActive ? 'blur(0px)' : isPast ? 'blur(0.3px)' : 'blur(1.6px)',
                      scale: isActive ? 1.04 : 0.96,
                    }}
                    transition={SPRING_CFG}
                    className="w-full text-left relative py-2.5 px-4 rounded-[24px] focus:outline-none select-none group"
                    style={{ transformOrigin: 'left center' }}
                    whileHover={!isActive ? { opacity: 0.72, filter: 'blur(0px)', transition: { duration: 0.14 } } : undefined}
                  >
                    <p className="text-xl sm:text-2xl md:text-3.5xl leading-relaxed tracking-tight font-black m-0 font-sans break-words whitespace-pre-wrap">
                      {tokens.map((token, tIdx) => {
                        if (token.trim().length === 0) {
                          return <span key={tIdx}>{token}</span>;
                        }
                        const wordIdx = nonSpaceTokenIndices.indexOf(tIdx);
                        return (
                          <span
                            key={tIdx}
                            ref={(el) => {
                              if (isActive && el) {
                                if (!wordSpanRefs.current[index]) wordSpanRefs.current[index] = [];
                                wordSpanRefs.current[index][wordIdx] = el;
                              }
                            }}
                            className="inline-block transition-transform duration-300"
                            style={{
                              // Initial color based on line state; RAF will override for active line
                              color: isActive
                                ? (isLight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.26)')
                                : isPast
                                ? (isLight ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)')
                                : (isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)'),
                            }}
                          >
                            {token}
                          </span>
                        );
                      })}
                    </p>
                  </motion.button>
                </div>
              );
            })}
            <div className="h-48" />
          </>
        )}
      </div>

      {/* Footer */}
      {lyrics && lyrics.synced && (
        <div className={`p-3 px-4 text-center border-t text-[10px] tracking-widest font-bold uppercase flex items-center justify-center gap-2 backdrop-blur-2xl relative z-10 ${isLight ? 'bg-white/30 border-black/5 text-black/30' : 'bg-black/30 border-white/5 text-white/25'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? 'bg-fuchsia-400 animate-pulse' : 'bg-white/30'}`} />
          <span>Real-time synced</span>
          <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? 'bg-fuchsia-400 animate-pulse' : 'bg-white/30'}`} />
        </div>
      )}
    </div>
  );
};

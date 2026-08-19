'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { fetchLyrics, LyricsData, LyricLine } from '../utils/lyrics';
import { motion } from 'motion/react';
import { Mic2, Loader2, Music2, Disc } from 'lucide-react';

interface LyricsViewProps {
  currentTrack: {
    id: string;
    title: string;
    artist: string;
    duration?: number;
    thumbnail?: string;
  } | null;
  currentTime: number;
  isPlaying: boolean;
  theme?: 'light' | 'dark';
  onSeek: (seconds: number) => void;
  onClose?: () => void;
  isFloating?: boolean;
}

const SPRING_CFG = { type: 'spring', stiffness: 280, damping: 32, mass: 0.9 } as const;

// Active line with real word-by-word progressive glow
const ActiveLyricLine = React.memo(function ActiveLyricLine({
  line,
  nextLineTime,
  currentTime,
  isLight,
  onSeek,
}: {
  line: LyricLine;
  nextLineTime: number | undefined;
  currentTime: number;
  isLight: boolean;
  onSeek: (t: number) => void;
}) {
  const words = useMemo(() => line.text.split(/(\s+)/), [line.text]);
  const nonSpaceWords = useMemo(() => words.filter(w => w.trim().length > 0), [words]);
  const totalWords = nonSpaceWords.length || 1;

  const lineDuration = nextLineTime ? Math.max(1.2, nextLineTime - line.time) : 4.0;
  const elapsed = Math.max(0, currentTime - line.time);
  const rawProgress = Math.min(totalWords, (elapsed / lineDuration) * (totalWords + 0.5));

  let wordIdx = 0;

  return (
    <motion.button
      onClick={() => onSeek(line.time)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, scale: 1.025 }}
      transition={SPRING_CFG}
      className="w-full text-left relative py-2 px-3 rounded-2xl focus:outline-none select-none z-10"
      style={{ transformOrigin: 'left center', filter: 'blur(0px)' }}
    >
      <p className="text-xl md:text-3xl leading-relaxed tracking-tight font-black m-0">
        {words.map((word, wIdx) => {
          if (word.trim().length === 0) {
            return <span key={wIdx}>{word}</span>;
          }

          const myWordIdx = wordIdx++;
          const progress = rawProgress - myWordIdx;
          const isFullyLit = progress >= 1;
          const isCurrentWord = progress > 0 && progress < 1;
          const clampedPct = Math.max(0, Math.min(1, progress));

          return (
            <span
              key={wIdx}
              className="inline-block"
              style={{
                color: isLight
                  ? isFullyLit
                    ? 'rgba(0,0,0,0.96)'
                    : isCurrentWord
                    ? `rgba(0,0,0,${0.3 + clampedPct * 0.66})`
                    : 'rgba(0,0,0,0.28)'
                  : isFullyLit
                  ? 'rgba(255,255,255,0.98)'
                  : isCurrentWord
                  ? `rgba(255,255,255,${0.28 + clampedPct * 0.70})`
                  : 'rgba(255,255,255,0.28)',
                textShadow: isLight
                  ? isFullyLit
                    ? '0 0 14px rgba(0,0,0,0.5)'
                    : isCurrentWord
                    ? `0 0 ${4 + clampedPct * 12}px rgba(0,0,0,${0.1 + clampedPct * 0.4})`
                    : 'none'
                  : isFullyLit
                  ? '0 0 22px rgba(255,255,255,0.85), 0 0 40px rgba(255,255,255,0.3)'
                  : isCurrentWord
                  ? `0 0 ${6 + clampedPct * 20}px rgba(255,255,255,${0.1 + clampedPct * 0.8})`
                  : 'none',
                transition: 'color 0.2s linear, text-shadow 0.2s linear',
              }}
            >
              {word}
            </span>
          );
        })}
      </p>
    </motion.button>
  );
});

export const LyricsView: React.FC<LyricsViewProps> = ({
  currentTrack,
  currentTime,
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

  useEffect(() => {
    if (!currentTrack?.title) {
      setLyrics(null);
      return;
    }
    let isMounted = true;
    setLoading(true);
    setActiveLineIndex(-1);
    fetchLyrics(currentTrack.title, currentTrack.artist, currentTrack.duration)
      .then((data) => {
        if (isMounted) { setLyrics(data); setLoading(false); }
      })
      .catch(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [currentTrack?.title, currentTrack?.artist]);

  useEffect(() => {
    if (!lyrics || !lyrics.lines.length) return;
    let currentIndex = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (currentTime >= lyrics.lines[i].time) { currentIndex = i; } else { break; }
    }
    setActiveLineIndex(currentIndex);
  }, [currentTime, lyrics]);

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
    <div className={`flex flex-col h-full w-full relative overflow-hidden select-none transition-colors duration-500 ${isLight ? 'text-black' : 'text-white'}`}>
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

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-14 space-y-5 scrollbar-none"
        style={{ scrollBehavior: 'smooth' }}
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
            <div className="h-24" />
            {lyrics.lines.map((line: LyricLine, index: number) => {
              const isActive = index === activeLineIndex;
              const isPast = index < activeLineIndex;
              const nextLineTime = lyrics.lines[index + 1]?.time;

              return (
                <div key={`${line.time}-${index}`} ref={(el) => { lineRefs.current[index] = el; }}>
                  {isActive ? (
                    <ActiveLyricLine
                      line={line}
                      nextLineTime={nextLineTime}
                      currentTime={currentTime}
                      isLight={isLight}
                      onSeek={onSeek}
                    />
                  ) : (
                    <motion.button
                      onClick={() => onSeek(line.time)}
                      animate={{
                        opacity: isPast ? 0.38 : 0.24,
                        filter: isPast ? 'blur(0.5px)' : 'blur(1.5px)',
                        scale: 1,
                      }}
                      transition={SPRING_CFG}
                      className="w-full text-left relative py-2 px-3 rounded-2xl focus:outline-none select-none group"
                      style={{ transformOrigin: 'left center' }}
                      whileHover={{ opacity: 0.72, filter: 'blur(0px)', transition: { duration: 0.15 } }}
                    >
                      <p
                        className="text-xl md:text-3xl leading-relaxed tracking-tight font-black m-0"
                        style={{
                          color: isLight
                            ? isPast ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)'
                            : isPast ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)',
                        }}
                      >
                        {line.text}
                      </p>
                    </motion.button>
                  )}
                </div>
              );
            })}
            <div className="h-40" />
          </>
        )}
      </div>

      {lyrics && lyrics.synced && (
        <div className={`p-3 px-4 text-center border-t text-[10px] tracking-widest font-bold uppercase flex items-center justify-center gap-2 backdrop-blur-2xl ${isLight ? 'bg-white/30 border-black/5 text-black/30' : 'bg-black/30 border-white/5 text-white/25'}`}>
          <span className={`h-1 w-1 rounded-full ${isPlaying ? 'bg-fuchsia-400 animate-pulse' : 'bg-white/30'}`} />
          <span>Real-time synced</span>
          <span className={`h-1 w-1 rounded-full ${isPlaying ? 'bg-fuchsia-400 animate-pulse' : 'bg-white/30'}`} />
        </div>
      )}
    </div>
  );
};

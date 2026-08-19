'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { fetchLyrics, LyricsData, LyricLine } from '../utils/lyrics';
import { Mic2, Loader2, Sparkles, Music2, Disc } from 'lucide-react';

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

export const LyricsView: React.FC<LyricsViewProps> = ({
  currentTrack,
  currentTime,
  isPlaying,
  theme = 'dark',
  onSeek,
  onClose,
  isFloating = false
}) => {
  const isLight = theme === 'light';
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);
  const [userIsScrolling, setUserIsScrolling] = useState<boolean>(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 1. Fetch lyrics whenever currentTrack changes
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
        if (isMounted) {
          setLyrics(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [currentTrack?.title, currentTrack?.artist]);

  // 2. Find active lyric line based on current playback timestamp
  useEffect(() => {
    if (!lyrics || !lyrics.lines.length) return;

    let currentIndex = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      if (currentTime >= lyrics.lines[i].time) {
        currentIndex = i;
      } else {
        break;
      }
    }

    setActiveLineIndex(currentIndex);
  }, [currentTime, lyrics]);

  // 3. Smooth auto-scroll active lyric into center view (unless user is actively dragging/scrolling)
  useEffect(() => {
    if (userIsScrolling || activeLineIndex < 0) return;

    const activeEl = lineRefs.current[activeLineIndex];
    if (activeEl && containerRef.current) {
      activeEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [activeLineIndex, userIsScrolling]);

  // Handle user manual scroll pause
  const handleScroll = () => {
    setUserIsScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setUserIsScrolling(false);
    }, 2800);
  };

  // Calculate dynamic singing progress percentage through current line
  const activeLineProgress = useMemo(() => {
    if (!lyrics || activeLineIndex < 0 || activeLineIndex >= lyrics.lines.length) return 0;
    const currentLine = lyrics.lines[activeLineIndex];
    const nextLine = lyrics.lines[activeLineIndex + 1];
    const lineDuration = nextLine ? Math.max(1, nextLine.time - currentLine.time) : 4.5;
    const elapsed = Math.max(0, currentTime - currentLine.time);
    return Math.min(100, Math.max(0, (elapsed / lineDuration) * 100));
  }, [lyrics, activeLineIndex, currentTime]);

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
      
      {/* Top Header */}
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
            className={`p-1.5 rounded-full text-xs font-semibold px-3 transition-all active:scale-95 ${
              isLight 
                ? 'bg-black/5 hover:bg-black/10 text-black/70' 
                : 'bg-white/10 hover:bg-white/20 text-white/80'
            }`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Lyrics Content Body with Apple Music Depth & Blur */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-14 space-y-7 scroll-smooth scrollbar-none"
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
            {lyrics.lines.map((line: LyricLine, index: number) => {
              const isActive = index === activeLineIndex;
              const isPast = index < activeLineIndex;
              const words = line.text.split(/(\s+)/); // preserve spaces

              // For active line, calculate real-time word-by-word progression
              const nextLine = lyrics.lines[index + 1];
              const lineDuration = nextLine ? Math.max(1.2, nextLine.time - line.time) : 4.0;
              const elapsed = Math.max(0, currentTime - line.time);
              const progressFraction = Math.min(1, Math.max(0, elapsed / lineDuration));

              const nonSpaceWordCount = words.filter(w => w.trim().length > 0).length || 1;
              const currentActiveWordTarget = progressFraction * nonSpaceWordCount;

              let wordIndexCounter = 0;

              return (
                <button
                  key={`${line.time}-${index}`}
                  ref={(el) => { lineRefs.current[index] = el; }}
                  onClick={() => onSeek(line.time)}
                  className={`w-full text-left transition-all duration-500 ease-out group relative py-2.5 rounded-2xl px-2 focus:outline-none select-none ${
                    isActive
                      ? 'scale-[1.04] translate-x-1.5 opacity-100 z-10'
                      : isPast
                      ? 'opacity-35 hover:opacity-80 hover:blur-0'
                      : 'opacity-25 hover:opacity-75 hover:blur-0'
                  }`}
                  style={{
                    filter: isActive ? 'blur(0px)' : 'blur(0.8px)'
                  }}
                >
                  <p className="text-xl md:text-3xl leading-relaxed tracking-tight font-black transition-all duration-300 m-0">
                    {words.map((word, wIdx) => {
                      const isSpace = word.trim().length === 0;
                      if (isSpace) {
                        return <span key={wIdx}>{word}</span>;
                      }

                      const currentWIdx = wordIndexCounter++;
                      const isWordSung = isActive && currentWIdx < currentActiveWordTarget;
                      const isWordActive = isActive && Math.floor(currentActiveWordTarget) === currentWIdx;

                      return (
                        <span
                          key={wIdx}
                          className={`inline-block transition-all duration-500 ease-out ${
                            isActive
                              ? isWordActive
                                ? isLight
                                  ? 'text-black font-black drop-shadow-[0_0_12px_rgba(0,0,0,0.6)]'
                                  : 'text-white font-black drop-shadow-[0_0_25px_rgba(255,255,255,1)] brightness-125'
                                : isWordSung
                                ? isLight
                                  ? 'text-black/90 font-black'
                                  : 'text-white/95 font-black drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]'
                                : isLight
                                ? 'text-black/35 font-bold'
                                : 'text-white/35 font-bold'
                              : isLight
                              ? 'text-black/40'
                              : 'text-white/40'
                          }`}
                        >
                          {word}
                        </span>
                      );
                    })}
                  </p>
                </button>
              );
            })}

            {/* Bottom spacing for smooth centering */}
            <div className="h-40" />
          </>
        )}
      </div>

      {/* Floating Karaoke Footer */}
      {lyrics && lyrics.synced && (
        <div className={`p-3 px-4 text-center border-t text-[10px] tracking-widest font-bold uppercase flex items-center justify-center gap-2 backdrop-blur-2xl ${
          isLight ? 'bg-white/40 border-black/5 text-black/50' : 'bg-black/30 border-white/5 text-white/50'
        }`}>
          <Sparkles size={12} className="text-fuchsia-400 animate-pulse" />
          <span>Tap any lyric line to jump in sync</span>
        </div>
      )}
    </div>
  );
};

'use client';

import React, { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext';

interface FloatingEmoji {
  id: number;
  emoji: string;
  left: number; // Horizontal offset in percentage (10-90%)
  scale: number;
  username: string;
}

export const ReactionOverlay: React.FC = () => {
  const { activeReaction } = useSocket();
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);

  useEffect(() => {
    if (!activeReaction) return;

    // Create a new floating emoji instance
    const newEmoji: FloatingEmoji = {
      id: activeReaction.id,
      emoji: activeReaction.emoji,
      left: Math.random() * 80 + 10, // Keep within 10% to 90% of screen width
      scale: Math.random() * 0.4 + 0.8, // Random scale between 0.8x and 1.2x
      username: activeReaction.username,
    };

    setEmojis(prev => [...prev, newEmoji]);

    // Remove emoji after animation completes (2.5 seconds)
    const timer = setTimeout(() => {
      setEmojis(prev => prev.filter(e => e.id !== newEmoji.id));
    }, 2500);

    return () => clearTimeout(timer);
  }, [activeReaction]);

  return (
    <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
      {emojis.map(item => (
        <div
          key={item.id}
          className="absolute bottom-0 flex flex-col items-center animate-float-up opacity-0"
          style={{
            left: `${item.left}%`,
            transform: `scale(${item.scale})`,
          }}
        >
          {/* User tag showing who reacted */}
          <span className="text-[10px] text-white bg-black/60 px-2 py-0.5 rounded-full mb-1 border border-white/10 backdrop-blur-sm whitespace-nowrap shadow-md">
            {item.username}
          </span>
          {/* Reaction Emoji */}
          <span className="text-4xl filter drop-shadow-lg select-none">
            {item.emoji}
          </span>
        </div>
      ))}
    </div>
  );
};

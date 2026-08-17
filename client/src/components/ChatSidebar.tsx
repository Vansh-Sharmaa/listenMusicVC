'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { Send } from 'lucide-react';

export const ChatSidebar: React.FC = () => {
  const { chatMessages, sendChatMessage } = useSocket();
  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendChatMessage(text);
    setText('');
  };

  // Auto scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  return (
    <div className="flex flex-col h-full bg-black/40 border-l border-white/10 backdrop-blur-md text-white w-80">
      <div className="p-4 border-b border-white/10">
        <h2 className="text-lg font-semibold tracking-wide">Group Chat</h2>
      </div>

      {/* Messages list */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {chatMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/40 text-sm italic">
            No messages yet. Say hi!
          </div>
        ) : (
          chatMessages.map((msg) => {
            const isSystem = msg.userId === 'system';
            const isMe = msg.userId === 'me';

            if (isSystem) {
              return (
                <div key={msg.id} className="text-center text-xs text-emerald-400/80 bg-emerald-500/10 py-1.5 px-3 rounded-md border border-emerald-500/10">
                  {msg.message}
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${
                  isMe ? 'ml-auto items-end' : 'mr-auto items-start'
                }`}
              >
                <span className="text-[10px] text-white/50 mb-1 px-1">
                  {msg.username}
                </span>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm ${
                    isMe
                      ? 'bg-emerald-600 text-white rounded-tr-none'
                      : 'bg-white/10 text-white rounded-tl-none border border-white/5'
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-black/20 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-white placeholder-white/30"
        />
        <button
          type="submit"
          className="bg-emerald-600 hover:bg-emerald-500 transition-all p-2 rounded-xl text-white flex items-center justify-center active:scale-95 shadow-lg shadow-emerald-950/40"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
};

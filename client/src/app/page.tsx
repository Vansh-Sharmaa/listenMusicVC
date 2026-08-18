'use client';

import React, { useState, useEffect } from 'react';
import { SocketProvider } from '../context/SocketContext';
import { AudioMixerProvider } from '../context/AudioMixerContext';
import { CallInterface } from '../components/CallInterface';
import { Video, Music, MessageSquare, Tv, Activity, Sparkles, LogIn, Plus } from 'lucide-react';

export default function Home() {
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [isCreating, setIsCreating] = useState(true); // Toggle between Create or Join
  const [userId, setUserId] = useState('');
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [activeRoomId, setActiveRoomId] = useState('');
  const [token, setToken] = useState('');
  const [livekitUrl, setLivekitUrl] = useState('');
  const [isMock, setIsMock] = useState(true);

  const [mounted, setMounted] = useState(false);

  // Generate or restore tab-unique userId & username on mount
  useEffect(() => {
    setMounted(true);
    let uid = sessionStorage.getItem('lmvc_userid');
    if (!uid) {
      uid = 'user_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('lmvc_userid', uid);
    }
    setUserId(uid);

    let savedName = sessionStorage.getItem('lmvc_username');
    if (!savedName) {
      // Default to tab-unique nickname so side-by-side tabs don't clash
      savedName = 'User_' + Math.floor(Math.random() * 899 + 100);
    }
    setUsername(savedName);

    // Auto detect room from URL query param ?room=xyz
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomId(roomParam);
      setIsCreating(false);
    }
  }, []);

  if (!mounted) {
    return <div suppressHydrationWarning className="min-h-screen bg-[#09090b]" />;
  }

  const handleJoinCall = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawTarget = isCreating ? roomName : roomId;
    if (!username.trim() || !rawTarget.trim()) return;

    setLoading(true);
    sessionStorage.setItem('lmvc_username', username);
    localStorage.setItem('lmvc_username', username);

    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

    try {
      const slug = rawTarget.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'room';
      let resolvedRoomId = slug;

      // Try connecting to backend with a 4-second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        if (isCreating) {
          const createRes = await fetch(`${serverUrl}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: rawTarget.trim(), hostId: userId }),
            signal: controller.signal,
          });
          if (createRes.ok) {
            const createdRoom = await createRes.json();
            resolvedRoomId = createdRoom.id || slug;
          }
        }

        const tokenRes = await fetch(`${serverUrl}/api/rooms/${resolvedRoomId}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, username }),
          signal: controller.signal,
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          setToken(tokenData.token);
          setLivekitUrl(tokenData.url);
          setIsMock(tokenData.isMock);
        } else {
          // Graceful fallback token
          setToken(`mock-token-${resolvedRoomId}-${userId}`);
          setLivekitUrl('mock://localhost:7880');
          setIsMock(true);
        }
      } catch (err) {
        console.warn('Backend server not directly reachable, entering fallback WebRTC call mode:', err);
        // Never leave user hanging - generate instant fallback token
        setToken(`mock-token-${resolvedRoomId}-${userId}`);
        setLivekitUrl('mock://localhost:7880');
        setIsMock(true);
      } finally {
        clearTimeout(timeoutId);
      }
      
      setRoomId(resolvedRoomId);
      setActiveRoomId(resolvedRoomId);
      setJoined(true);
    } catch (error: any) {
      console.error('Failed to join call:', error);
      const fallbackRoom = rawTarget.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'room';
      setRoomId(fallbackRoom);
      setActiveRoomId(fallbackRoom);
      setToken(`mock-token-${fallbackRoom}-${userId}`);
      setLivekitUrl('mock://localhost:7880');
      setIsMock(true);
      setJoined(true);
    } finally {
      setLoading(false);
    }
  };

  if (joined) {
    return (
      <SocketProvider>
        <AudioMixerProvider>
          <CallInterface
            roomId={activeRoomId || roomId}
            userId={userId}
            username={username}
            token={token}
            livekitUrl={livekitUrl}
            isMock={isMock}
            onLeave={() => setJoined(false)}
          />
        </AudioMixerProvider>
      </SocketProvider>
    );
  }

  return (
    <div
      suppressHydrationWarning
      className="min-h-screen bg-[#09090b] bg-radial-[at_top_right] from-emerald-950/20 via-zinc-950 to-zinc-950 text-white flex flex-col justify-between selection:bg-emerald-500/30 selection:text-emerald-300"
    >
      
      {/* Navbar Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-white/5 backdrop-blur-md bg-black/20">
        <div className="flex items-center gap-2.5">
          <div className="bg-gradient-to-tr from-emerald-600 to-fuchsia-600 p-2 rounded-xl shadow-lg shadow-emerald-950/30">
            <Music size={20} className="text-white" />
          </div>
          <span className="font-extrabold text-base tracking-wide bg-gradient-to-r from-emerald-400 to-fuchsia-400 bg-clip-text text-transparent">
            ListenMusicVC
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center max-w-6xl mx-auto px-6 gap-12 lg:gap-16 py-12">
        
        {/* Left Side: Copywriting Content */}
        <div className="flex-1 space-y-6 text-center lg:text-left max-w-lg">
          <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full font-semibold">
            <Sparkles size={12} />
            Co-Listen during calls!
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-[1.1] bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
            Watch together. <br/>
            Talk together. <br/>
            <span className="bg-gradient-to-r from-emerald-400 to-fuchsia-400 bg-clip-text text-transparent">
              Listen in harmony.
            </span>
          </h1>
          
          <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
            Experience high-definition video calling synced with legal shared music playback. 
            Features separate controls for voice, music, screen shares, and custom auto-ducking that automatically lowers the music when someone speaks.
          </p>

          {/* Features bullet points */}
          <div className="grid grid-cols-2 gap-4 text-xs font-semibold text-zinc-400 text-left pt-4">
            <div className="flex items-center gap-2.5 bg-white/5 border border-white/5 p-3 rounded-2xl">
              <Video size={16} className="text-emerald-400" />
              <span>HD Video & Audio</span>
            </div>
            <div className="flex items-center gap-2.5 bg-white/5 border border-white/5 p-3 rounded-2xl">
              <Music size={16} className="text-fuchsia-400" />
              <span>Synced Music Playback</span>
            </div>
            <div className="flex items-center gap-2.5 bg-white/5 border border-white/5 p-3 rounded-2xl">
              <Activity size={16} className="text-emerald-400" />
              <span>Automatic Audio Ducking</span>
            </div>
            <div className="flex items-center gap-2.5 bg-white/5 border border-white/5 p-3 rounded-2xl">
              <Tv size={16} className="text-amber-400" />
              <span>Lag-free Screen Sharing</span>
            </div>
          </div>
        </div>

        {/* Right Side: Form Card */}
        <div className="w-full max-w-md bg-zinc-900/60 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden flex flex-col justify-center">
          <div className="absolute top-0 right-0 h-40 w-40 bg-fuchsia-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 h-40 w-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Action Tabs: Create vs Join */}
          <div className="bg-black/40 p-1.5 rounded-2xl border border-white/5 flex mb-6 z-10">
            <button
              onClick={() => setIsCreating(true)}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 ${
                isCreating 
                  ? 'bg-emerald-600 text-white shadow-lg' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Plus size={14} />
              Create Room
            </button>
            <button
              onClick={() => setIsCreating(false)}
              className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 ${
                !isCreating 
                  ? 'bg-emerald-600 text-white shadow-lg' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <LogIn size={14} />
              Join Room
            </button>
          </div>

          <form onSubmit={handleJoinCall} className="space-y-4 z-10">
            {/* Nickname */}
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Your Nickname
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. DJ Sparkles"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-white placeholder-white/20"
              />
            </div>

            {/* Room Name or Room ID */}
            {isCreating ? (
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  New Room Name
                </label>
                <input
                  type="text"
                  required
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. Chill Session"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-white placeholder-white/20"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Room ID to Join
                </label>
                <input
                  type="text"
                  required
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Paste Room UUID here"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-white placeholder-white/20"
                />
              </div>
            )}

            {/* Join Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white rounded-xl py-3 text-sm font-bold tracking-wide transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 shadow-xl shadow-emerald-950/30 mt-6"
            >
              {loading ? (
                <span>Generating Token...</span>
              ) : isCreating ? (
                <>
                  <Plus size={16} />
                  Start & Join Call
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  Connect to Call
                </>
              )}
            </button>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-white/5 text-center text-xs text-zinc-500">
        <span>© 2026 ListenMusicVC. All rights reserved. Supporting only legal and CC royalty-free music sources.</span>
      </footer>
    </div>
  );
}

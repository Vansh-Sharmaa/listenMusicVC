'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAudioMixer } from '../context/AudioMixerContext';
import { Play, Pause, Music, Upload, Loader2, Plus, Volume2, Link as LinkIcon, Radio, Share2, Disc, Zap, ExternalLink } from 'lucide-react';


import { parseMediaUrl, extractYouTubeId, isYouTubeUrl, isSpotifyUrl, isMonochromeUrl, extractSpotifyInfo } from '../utils/mediaPlatform';

interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  duration: number;
  isRoyaltyFree: boolean;
  thumbnail?: string;
}

interface PlaylistSidebarProps {
  theme?: 'light' | 'dark';
  onStartScreenShare?: () => void;
}

export const PlaylistSidebar: React.FC<PlaylistSidebarProps> = ({ theme = 'dark', onStartScreenShare }) => {
  const isLight = theme === 'light';
  const { musicState, sendMusicAction } = useSocket();
  const { registerRemoteScreenShareTrack } = useAudioMixer();

  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);

  // Quick YouTube / Song URL input bar
  const [quickUrl, setQuickUrl] = useState('');

  // Tab mode: 'online' | 'upload'
  const [modalTab, setModalTab] = useState<'online' | 'upload'>('online');
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sidebar panel mode: 'youtube' | 'monochrome'
  const [sidebarMode, setSidebarMode] = useState<'youtube' | 'monochrome'>('youtube');

  // Monochrome.tf state
  const [monoUrl, setMonoUrl] = useState('');
  const [monoTitle, setMonoTitle] = useState('');
  const [monoArtist, setMonoArtist] = useState('');
  const [monoSubmitting, setMonoSubmitting] = useState(false);

  // Form states for online URL / YouTube
  const [onlineTitle, setOnlineTitle] = useState('');
  const [onlineArtist, setOnlineArtist] = useState('');
  const [onlineUrl, setOnlineUrl] = useState('');

  // Upload states
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadArtist, setUploadArtist] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Curated list of popular hits & live online music streams
  const onlinePresetTracks: MusicTrack[] = [
    {
      id: 'yt-the-weeknd-starboy',
      title: 'Starboy',
      artist: 'The Weeknd ft. Daft Punk',
      url: 'https://www.youtube.com/watch?v=34Na4j8AVgA',
      duration: 230,
      isRoyaltyFree: false,
      thumbnail: 'https://img.youtube.com/vi/34Na4j8AVgA/hqdefault.jpg'
    },
    {
      id: 'yt-the-weeknd-blinding',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
      duration: 200,
      isRoyaltyFree: false,
      thumbnail: 'https://img.youtube.com/vi/4NRXx6U8ABQ/hqdefault.jpg'
    },
    {
      id: 'yt-chase-atlantic-slide',
      title: 'SLIDE',
      artist: 'Chase Atlantic',
      url: 'https://www.youtube.com/watch?v=tOVIeLZtxDc',
      duration: 210,
      isRoyaltyFree: false,
      thumbnail: 'https://img.youtube.com/vi/tOVIeLZtxDc/hqdefault.jpg'
    },
    {
      id: 'yt-drake-massive',
      title: 'Massive',
      artist: 'Drake',
      url: 'https://www.youtube.com/watch?v=ay1l_u6vltY',
      duration: 336,
      isRoyaltyFree: false,
      thumbnail: 'https://img.youtube.com/vi/ay1l_u6vltY/hqdefault.jpg'
    },
    {
      id: 'yt-lofi-girl',
      title: 'Lofi Hip Hop / Study Beats',
      artist: 'Lofi Girl Live',
      url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      duration: 14400,
      isRoyaltyFree: true,
      thumbnail: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg'
    },
    {
      id: 'yt-future-weeknd',
      title: "We Still Don't Trust You",
      artist: 'Future, Metro Boomin, The Weeknd',
      url: 'https://www.youtube.com/watch?v=mq4wClhFmA8',
      duration: 252,
      isRoyaltyFree: false,
      thumbnail: 'https://img.youtube.com/vi/mq4wClhFmA8/hqdefault.jpg'
    },
    {
      id: 'yt-tricksingh-taaj',
      title: 'TAAJ (Official Music Video)',
      artist: 'Tricksingh',
      url: 'https://www.youtube.com/watch?v=Du8E8g2LVoU',
      duration: 198,
      isRoyaltyFree: false,
      thumbnail: 'https://img.youtube.com/vi/Du8E8g2LVoU/hqdefault.jpg'
    },
    {
      id: 'yt-lofi-girl',
      title: 'Lofi Hip Hop / Study Beats',
      artist: 'Lofi Girl Live',
      url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      duration: 14400,
      isRoyaltyFree: true,
      thumbnail: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg'
    },
    {
      id: 'spotify-preset-1',
      title: 'Starboy (feat. Daft Punk)',
      artist: 'The Weeknd • Spotify',
      url: 'https://open.spotify.com/track/7MXVkk9YM5IZxh0VU621v0',
      duration: 230,
      isRoyaltyFree: false,
      thumbnail: 'https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png'
    },
    {
      id: 'spotify-preset-2',
      title: 'Espresso',
      artist: 'Sabrina Carpenter • Spotify',
      url: 'https://open.spotify.com/track/2qSk1gOKZw19PU879apHVQ',
      duration: 175,
      isRoyaltyFree: false,
      thumbnail: 'https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png'
    },
    {
      id: 'monochrome-preset-1',
      title: 'Monochrome Hi-Fi Chill (Studio Master)',
      artist: 'Monochrome Lossless',
      url: 'https://ia800905.us.archive.org/19/items/FREE_background_music_loops/chill_groove.mp3',
      duration: 425,
      isRoyaltyFree: true,
      thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop&q=80'
    },
    {
      id: 'monochrome-preset-2',
      title: 'Monochrome Midnight Synthwave (FLAC Quality)',
      artist: 'Monochrome Hi-Fi',
      url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
      duration: 302,
      isRoyaltyFree: true,
      thumbnail: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=100&auto=format&fit=crop&q=80'
    },
    {
      id: 'online-1',
      title: 'Lofi Chill Study Beats',
      artist: 'Lofi Records',
      url: 'https://ia802802.us.archive.org/5/items/lofi-study-112191/lofi-study-112191.mp3',
      duration: 372,
      isRoyaltyFree: true,
    },
    {
      id: 'online-2',
      title: 'Midnight Jazz & Chill Groove',
      artist: 'Archive Music',
      url: 'https://ia800905.us.archive.org/19/items/FREE_background_music_loops/chill_groove.mp3',
      duration: 425,
      isRoyaltyFree: true,
    },
    {
      id: 'online-3',
      title: 'Electro Synth Vibes',
      artist: 'MDN Audio',
      url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
      duration: 302,
      isRoyaltyFree: true,
    }
  ];

  const [selectedCategory, setSelectedCategory] = useState<'all' | 'youtube' | 'spotify' | 'monochrome' | 'lofi'>('all');

  const fetchTracks = async () => {
    try {
      const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const res = await fetch(`${serverUrl}/api/music`);
      if (res.ok) {
        const dbTracks = await res.json();
        // Merge preset online tracks with DB tracks
        const merged = [...dbTracks];
        onlinePresetTracks.forEach(preset => {
          if (!merged.some(t => t.id === preset.id)) {
            merged.push(preset);
          }
        });
        setTracks(merged);
      } else {
        setTracks(onlinePresetTracks);
      }
    } catch (error) {
      console.warn('Backend music fetch error, showing preset online streams:', error);
      setTracks(onlinePresetTracks);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracks();
  }, []);

  // Toggle play/pause
  const activeTrack = tracks.find(t => t.id === musicState.currentTrackId) || musicState.currentTrack;

  const handlePlayPause = () => {
    const currentPos = musicState.lastPosition || 0;

    if (musicState.isPlaying) {
      sendMusicAction('pause', musicState.currentTrackId, currentPos, activeTrack);
    } else {
      sendMusicAction('play', musicState.currentTrackId, currentPos, activeTrack);
    }
  };

  const handleTrackSelect = (track: MusicTrack) => {
    sendMusicAction('change', track.id, 0, track);
  };

  // Capture Spotify / System Audio Screen Share
  const handleShareSpotifyAudio = () => {
    if (onStartScreenShare) {
      onStartScreenShare();
    }
  };

  // Submit online URL track (YouTube / MP3 link)
  const handleAddOnlineUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onlineUrl.trim() || !onlineTitle.trim()) return;

    setSubmitting(true);
    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');

    try {
      const response = await fetch(`${serverUrl}/api/music/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: onlineTitle,
          artist: onlineArtist || 'Online Stream',
          url: onlineUrl,
          duration: 300
        })
      });

      if (response.ok) {
        const newTrack = await response.json();
        setTracks(prev => [newTrack, ...prev]);
        handleTrackSelect(newTrack);
      } else {
        // Fallback: add locally if API endpoint isn't reached
        const localOnlineTrack: MusicTrack = {
          id: `online-${Date.now()}`,
          title: onlineTitle,
          artist: onlineArtist || 'Online Link',
          url: onlineUrl,
          duration: 300,
          isRoyaltyFree: true
        };
        setTracks(prev => [localOnlineTrack, ...prev]);
        handleTrackSelect(localOnlineTrack);
      }
      setShowAddModal(false);
      setOnlineTitle('');
      setOnlineArtist('');
      setOnlineUrl('');
    } catch (error) {
      console.error('Failed to add online track:', error);
    } finally {
      setSubmitting(false);
    }
  };

  // Submit binary upload file
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadTitle.trim()) return;

    setSubmitting(true);
    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');

    try {
      const fileData = await uploadFile.arrayBuffer();
      const response = await fetch(
        `${serverUrl}/api/music/upload?title=${encodeURIComponent(uploadTitle)}&artist=${encodeURIComponent(uploadArtist || 'Unknown Artist')}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': uploadFile.type,
            'x-file-name': uploadFile.name,
            'x-file-uploader': 'me',
          },
          body: fileData,
        }
      );

      if (response.ok) {
        const newTrack = await response.json();
        setTracks(prev => [newTrack, ...prev]);
        handleTrackSelect(newTrack);
        setShowAddModal(false);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  // Live Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Debounced search handler
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().startsWith('http')) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
        const res = await fetch(`${serverUrl}/api/music/search?q=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch (e) {
        console.warn('Search query error:', e);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle Quick Play or Search Submit
  const handleQuickPlay = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    // If direct link entered
    if (query.startsWith('http://') || query.startsWith('https://')) {
      let newTrack: MusicTrack;
      const ytId = extractYouTubeId(query);
      const spotifyInfo = extractSpotifyInfo(query);

      if (ytId) {
        newTrack = {
          id: `yt-${ytId}`,
          title: `YouTube Track (${ytId})`,
          artist: 'YouTube',
          url: `https://www.youtube.com/watch?v=${ytId}`,
          duration: 240,
          isRoyaltyFree: false,
          thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
        };
      } else if (spotifyInfo) {
        newTrack = {
          id: `spotify-${spotifyInfo.id}`,
          title: `Spotify Track (${spotifyInfo.id})`,
          artist: 'Spotify',
          url: query,
          duration: 210,
          isRoyaltyFree: false,
          thumbnail: 'https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png'
        };
      } else {
        newTrack = {
          id: `stream-${Date.now()}`,
          title: 'Direct Online Stream',
          artist: 'Web Audio',
          url: query,
          duration: 300,
          isRoyaltyFree: true
        };
      }

      setTracks(prev => [newTrack, ...prev.filter(t => t.id !== newTrack.id)]);
      handleTrackSelect(newTrack);
      setSearchQuery('');
      setSearchResults([]);
      return;
    }

    // Otherwise, perform live song search and play top result
    setIsSearching(true);
    try {
      const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const res = await fetch(`${serverUrl}/api/music/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const results = await res.json();
        if (Array.isArray(results) && results.length > 0) {
          const topSong = results[0];
          setTracks(prev => [topSong, ...prev.filter(t => t.id !== topSong.id)]);
          handleTrackSelect(topSong);
          setSearchQuery('');
          setSearchResults([]);
        } else {
          alert(`No tracks found for "${query}". Try another song name or paste a direct YouTube link!`);
        }
      }
    } catch (err) {
      console.error('Failed to search song:', err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className={`flex flex-col h-full border-l backdrop-blur-md w-80 ${isLight ? 'bg-white/40 border-black/5 text-black' : 'bg-black/40 border-white/10 text-white'}`}>
      {/* Header with mode switcher */}
      <div className={`p-4 border-b flex justify-between items-center ${isLight ? 'border-black/5' : 'border-white/10'}`}>
        <div className="flex items-center gap-2">
          <Music size={20} className={isLight ? "text-fuchsia-600" : "text-fuchsia-400"} />
          <h2 className="text-lg font-semibold tracking-wide">Shared Music Hub</h2>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-fuchsia-600 hover:bg-fuchsia-500 transition-all p-1.5 rounded-lg active:scale-95 flex items-center justify-center text-white shadow-md shadow-fuchsia-950/40"
          title="Add Custom Track"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Mode Tabs: YouTube | Monochrome */}
      <div className={`flex border-b ${isLight ? 'border-black/5' : 'border-white/10'}`}>
        <button
          onClick={() => setSidebarMode('youtube')}
          className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-all border-b-2 ${
            sidebarMode === 'youtube'
              ? 'border-red-500 text-red-400 bg-red-500/5'
              : `border-transparent ${isLight ? 'text-black/40 hover:text-black' : 'text-white/40 hover:text-white'}`
          }`}
        >
          <span>🔴</span> YouTube
        </button>
        <button
          onClick={() => setSidebarMode('monochrome')}
          className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-all border-b-2 ${
            sidebarMode === 'monochrome'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-400/5'
              : `border-transparent ${isLight ? 'text-black/40 hover:text-black' : 'text-white/40 hover:text-white'}`
          }`}
        >
          <Zap size={12} /> Monochrome Hi-Fi
        </button>
      </div>

      {/* ======== MONOCHROME PANEL ======== */}
      {sidebarMode === 'monochrome' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Monochrome Banner */}
          <div className={`p-3 border-b space-y-2 ${isLight ? 'bg-cyan-50/50 border-black/5' : 'bg-cyan-950/30 border-cyan-900/30'}`}>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/20">
                <Zap size={14} className="text-cyan-400" />
              </div>
              <div>
                <p className={`text-xs font-bold ${isLight ? 'text-cyan-700' : 'text-cyan-300'}`}>Monochrome.tf — Lossless Hi-Fi</p>
                <p className={`text-[10px] ${isLight ? 'text-black/50' : 'text-white/40'}`}>Both users hear the same stream in sync</p>
              </div>
            </div>

            {/* How to get URL tip */}
            <div className={`text-[10px] rounded-xl p-2.5 flex gap-2 ${isLight ? 'bg-black/5 text-black/60' : 'bg-white/5 text-white/50'}`}>
              <span>💡</span>
              <span>On Monochrome, open a track → right-click the audio player → <strong>Copy audio address</strong> → paste below</span>
            </div>

            {/* Monochrome URL input */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const url = monoUrl.trim();
                if (!url) return;
                setMonoSubmitting(true);
                const newTrack = {
                  id: `mono-${Date.now()}`,
                  title: monoTitle.trim() || 'Monochrome Track',
                  artist: monoArtist.trim() || 'Monochrome Hi-Fi',
                  url,
                  duration: 300,
                  isRoyaltyFree: false,
                  thumbnail: 'https://monochrome.tf/favicon.ico'
                };
                setTracks(prev => [newTrack, ...prev.filter(t => t.id !== newTrack.id)]);
                handleTrackSelect(newTrack as any);
                setMonoUrl('');
                setMonoTitle('');
                setMonoArtist('');
                setMonoSubmitting(false);
              }}
              className="space-y-1.5"
            >
              <input
                type="url"
                value={monoUrl}
                onChange={e => setMonoUrl(e.target.value)}
                required
                placeholder="Paste direct audio URL (.flac / .mp3 / stream)"
                className={`w-full border rounded-xl px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:border-cyan-400 transition-all ${
                  isLight ? 'bg-black/5 border-black/10 text-black placeholder-black/30' : 'bg-white/5 border-white/15 text-white placeholder-white/30'
                }`}
              />
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={monoTitle}
                  onChange={e => setMonoTitle(e.target.value)}
                  placeholder="Track name (optional)"
                  className={`flex-1 border rounded-xl px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-cyan-400 transition-all ${
                    isLight ? 'bg-black/5 border-black/10 text-black placeholder-black/30' : 'bg-white/5 border-white/15 text-white placeholder-white/30'
                  }`}
                />
                <button
                  type="submit"
                  disabled={!monoUrl.trim() || monoSubmitting}
                  className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white text-[11px] px-3 py-1.5 rounded-xl font-bold transition-all active:scale-95 flex items-center gap-1 flex-shrink-0"
                >
                  {monoSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} fill="white" />}
                  Play
                </button>
              </div>
            </form>

            {/* Open Monochrome button */}
            <a
              href="https://monochrome.tf"
              target="_blank"
              rel="noopener noreferrer"
              className={`w-full flex items-center justify-center gap-1.5 text-[10px] font-semibold py-1.5 rounded-xl transition-all ${
                isLight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-white/5 hover:bg-white/10 text-white/50'
              }`}
            >
              <ExternalLink size={10} /> Open Monochrome.tf to find tracks
            </a>
          </div>

          {/* Now Playing (Monochrome) */}
          {activeTrack && isMonochromeUrl(activeTrack.url) && (
            <div className={`p-3 border-b ${isLight ? 'bg-black/5 border-black/5' : 'bg-white/5 border-white/10'}`}>
              <span className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2 ${isLight ? 'text-cyan-600' : 'text-cyan-400'}`}>
                <Radio size={10} className="animate-pulse" /> Now Streaming Hi-Fi
              </span>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
                  <Zap size={18} className="text-cyan-400" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-semibold truncate">{activeTrack.title}</span>
                  <span className={`text-[10px] truncate ${isLight ? 'text-black/50' : 'text-white/40'}`}>{activeTrack.artist}</span>
                </div>
                <button
                  onClick={handlePlayPause}
                  className="bg-cyan-500 hover:bg-cyan-400 text-white rounded-full p-2 transition-all active:scale-95"
                >
                  {musicState.isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" />}
                </button>
              </div>
            </div>
          )}

          {/* Monochrome preset / recent tracks */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className={`text-[10px] uppercase tracking-widest font-bold px-1 pb-1 ${isLight ? 'text-black/30' : 'text-white/30'}`}>Recent & Demo Tracks</p>
            {tracks
              .filter(t => isMonochromeUrl(t.url) || t.id.startsWith('mono-'))
              .map(track => {
                const isCurrent = track.id === musicState.currentTrackId;
                return (
                  <button
                    key={track.id}
                    onClick={() => handleTrackSelect(track)}
                    className={`w-full text-left p-2.5 rounded-xl flex items-center gap-2.5 transition-all ${
                      isCurrent
                        ? 'bg-cyan-500/15 border border-cyan-500/30'
                        : isLight ? 'bg-black/5 hover:bg-black/10 border border-transparent' : 'bg-white/5 hover:bg-white/10 border border-transparent'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isCurrent ? 'bg-cyan-500/30' : isLight ? 'bg-black/10' : 'bg-white/10'
                    }`}>
                      <Zap size={14} className={isCurrent ? 'text-cyan-400' : isLight ? 'text-black/40' : 'text-white/40'} />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`text-xs font-semibold truncate ${
                        isCurrent ? (isLight ? 'text-cyan-700' : 'text-cyan-300') : ''
                      }`}>{track.title}</span>
                      <span className={`text-[10px] truncate ${isLight ? 'text-black/50' : 'text-white/40'}`}>{track.artist}</span>
                    </div>
                    {isCurrent && <Radio size={12} className="text-cyan-400 animate-pulse flex-shrink-0" />}
                  </button>
                );
              })}
            {tracks.filter(t => isMonochromeUrl(t.url) || t.id.startsWith('mono-')).length === 0 && (
              <div className={`text-center py-8 text-xs ${isLight ? 'text-black/30' : 'text-white/30'}`}>
                <Zap size={24} className="mx-auto mb-2 opacity-20" />
                Paste a Monochrome.tf stream URL above to play lossless audio for everyone in the room
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======== YOUTUBE PANEL (unchanged) ======== */}
      {sidebarMode === 'youtube' && (
        <>
      <div className={`p-3 border-b relative ${isLight ? 'bg-gradient-to-b from-fuchsia-100/50 to-white/50 border-black/5' : 'bg-gradient-to-b from-fuchsia-950/40 to-black/20 border-white/10'}`}>
        <form onSubmit={handleQuickPlay} className="space-y-2">
          <div className={`flex items-center justify-between text-[11px] font-semibold px-0.5 ${isLight ? 'text-fuchsia-700' : 'text-fuchsia-300'}`}>
            <span>🔍 Search ANY Song in the World or Paste Link</span>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Desi Kalakaar, Starboy, Arijit..."
              className={`flex-1 border rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-fuchsia-500 transition-all ${
                isLight 
                  ? 'bg-black/5 border-black/10 text-black placeholder-black/40' 
                  : 'bg-white/10 border-white/15 text-white placeholder-white/40'
              }`}
            />
            <button
              type="submit"
              disabled={!searchQuery.trim() || isSearching}
              className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-xl font-bold transition-all active:scale-95 shadow-md shadow-fuchsia-950/40 flex items-center gap-1 flex-shrink-0"
            >
              {isSearching ? <Disc size={12} className="animate-spin" /> : <Play size={12} fill="white" />}
              <span>{isSearching ? 'Searching...' : 'Play'}</span>
            </button>
          </div>
        </form>

        {/* Live Search Results Dropdown */}
        {searchResults.length > 0 && (
          <div className={`absolute top-full left-0 right-0 z-50 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto mt-1 divide-y border ${isLight ? 'bg-white/95 border-fuchsia-300/40 divide-black/10' : 'bg-[#18181b]/95 border-fuchsia-500/40 divide-white/10'}`}>
            <div className={`p-2 text-[10px] uppercase tracking-wider font-bold flex items-center justify-between ${isLight ? 'bg-black/5 text-fuchsia-600' : 'bg-white/5 text-fuchsia-300'}`}>
              <span>Matching Songs</span>
              <span>Tap to Play for Room</span>
            </div>
            {searchResults.map((result) => (
              <button
                key={result.id}
                onClick={() => {
                  setTracks(prev => [result, ...prev.filter(t => t.id !== result.id)]);
                  handleTrackSelect(result);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                className="w-full p-2 text-left hover:bg-fuchsia-600/20 transition-all flex items-center gap-2.5 group"
              >
                {result.thumbnail ? (
                  <img src={result.thumbnail} alt={result.title} className="w-10 h-10 rounded-lg object-cover border border-white/10 flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-fuchsia-900/50 flex items-center justify-center flex-shrink-0">
                    <Music size={16} className="text-fuchsia-300" />
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={`text-xs font-semibold truncate ${isLight ? 'text-black group-hover:text-fuchsia-700' : 'text-white group-hover:text-fuchsia-200'}`}>{result.title}</span>
                  <span className={`text-[10px] truncate ${isLight ? 'text-black/50' : 'text-white/50'}`}>{result.artist}</span>
                </div>
                <div className="p-1.5 rounded-full bg-fuchsia-600 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play size={10} fill="white" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Share Spotify / Laptop Audio Action Banner */}
      <div className={`p-2.5 border-b ${isLight ? 'bg-gradient-to-r from-fuchsia-100 to-emerald-100 border-black/5' : 'bg-gradient-to-r from-fuchsia-950/20 to-emerald-950/20 border-white/10'}`}>
        <button
          onClick={handleShareSpotifyAudio}
          className={`w-full rounded-xl p-2 flex items-center justify-center gap-2 text-xs font-semibold transition-all active:scale-95 border ${isLight ? 'bg-black/5 hover:bg-black/10 border-black/10 text-emerald-700 hover:text-emerald-800' : 'bg-white/5 hover:bg-white/10 border-white/10 text-emerald-300 hover:text-emerald-200'}`}
        >
          <Share2 size={13} className={isLight ? "text-emerald-600" : "text-emerald-400"} />
          <span>Stream Spotify / Desktop Audio</span>
        </button>
      </div>

      {/* Now Playing Card */}
      <div className={`p-4 shadow-inner border-b ${isLight ? 'bg-black/5 border-black/5' : 'bg-white/5 border-white/10'}`}>
        {activeTrack ? (
          <div className="space-y-3">
            <span className="text-[10px] text-fuchsia-400 uppercase tracking-widest font-bold flex items-center gap-1">
              <Radio size={12} className="animate-pulse" />
              Now Streaming in Room
            </span>
            <div className="flex items-center gap-3">
              {(activeTrack as any)?.thumbnail ? (
                <img
                  src={(activeTrack as any).thumbnail}
                  alt={activeTrack.title}
                  className="w-12 h-12 rounded-lg object-cover border border-white/10 shadow-md flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-fuchsia-600/30 border border-fuchsia-500/30 flex items-center justify-center flex-shrink-0 text-fuchsia-300">
                  <Music size={20} />
                </div>
              )}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-semibold text-sm truncate">{activeTrack.title}</span>
                <span className={`text-xs truncate ${isLight ? 'text-black/50' : 'text-white/50'}`}>{activeTrack.artist}</span>
              </div>
            </div>
            
            {/* Playback Controls */}
            <div className="flex items-center justify-center gap-4 pt-1">
              <button
                onClick={handlePlayPause}
                className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-full p-2.5 transition-all duration-300 hover:scale-105 active:scale-95 shadow-md shadow-fuchsia-950/30"
              >
                {musicState.isPlaying ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
              </button>
            </div>
          </div>
        ) : (
          <div className={`text-center text-xs py-3 italic flex flex-col items-center gap-1.5 ${isLight ? 'text-black/40' : 'text-white/40'}`}>
            <Volume2 size={22} className={`animate-pulse ${isLight ? 'text-black/20' : 'text-white/20'}`} />
            No track playing. Click a song below or paste any YouTube link!
          </div>
        )}
      </div>

      {/* Up Next / Queue */}
      {musicState.queue && musicState.queue.length > 0 && (
        <div className={`p-3 shadow-inner border-b ${isLight ? 'bg-black/5 border-black/5' : 'bg-white/5 border-white/10'}`}>
          <span className="text-[10px] text-fuchsia-400 uppercase tracking-widest font-bold mb-2 flex items-center gap-1">
            <Radio size={10} />
            Up Next
          </span>
          <div className="space-y-2 max-h-24 overflow-y-auto scrollbar-none pr-1">
            {musicState.queue.map((qTrack: any, idx: number) => (
              <div key={`${qTrack.id}-${idx}`} className="flex items-center gap-2.5 text-xs group">
                <span className={`font-mono text-[9px] w-3 ${isLight ? 'text-black/30' : 'text-white/30'}`}>{idx + 1}.</span>
                {qTrack.thumbnail ? (
                  <img src={qTrack.thumbnail} alt="thumb" className={`w-5 h-5 rounded object-cover flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity border ${isLight ? 'border-black/10' : 'border-white/10'}`} />
                ) : (
                  <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${isLight ? 'bg-black/10' : 'bg-white/10'}`}>
                    <Music size={10} className={isLight ? "text-black/50" : "text-white/50"} />
                  </div>
                )}
                <span className={`truncate transition-colors flex-1 ${isLight ? 'text-black/70 group-hover:text-black' : 'text-white/70 group-hover:text-white'}`}>{qTrack.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category Tabs: All, YouTube, Spotify, Monochrome, Lofi */}
      <div className={`px-3 pt-2.5 pb-1 flex gap-1 overflow-x-auto border-b scrollbar-none ${isLight ? 'border-black/5' : 'border-white/5'}`}>
        {[
          { id: 'all', label: 'All' },
          { id: 'youtube', label: '🔴 YouTube' },
          { id: 'spotify', label: '🟢 Spotify' },
          { id: 'monochrome', label: '⚫ Monochrome' },
          { id: 'lofi', label: '📻 Lofi' }
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id as any)}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition-all ${
              selectedCategory === cat.id
                ? 'bg-fuchsia-600 text-white shadow-sm'
                : isLight
                  ? 'bg-black/5 hover:bg-black/10 text-black/50 hover:text-black'
                  : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className={`flex items-center justify-center py-10 text-xs ${isLight ? 'text-black/30' : 'text-white/30'}`}>
                <Loader2 size={16} className="animate-spin mr-2" />
                Loading music...
              </div>
            ) : (
              tracks
                .filter((t) => {
                  if (selectedCategory === 'all') return true;
                  if (selectedCategory === 'youtube') return isYouTubeUrl(t.url);
                  if (selectedCategory === 'spotify') return isSpotifyUrl(t.url);
                  if (selectedCategory === 'monochrome') return isMonochromeUrl(t.url) || t.url.includes('flac');
                  if (selectedCategory === 'lofi') return t.title.toLowerCase().includes('lofi') || t.isRoyaltyFree;
                  return true;
                })
                .map((track) => {
                  const isCurrent = track.id === musicState.currentTrackId;
                  const badge = isYouTubeUrl(track.url)
                    ? { label: 'YOUTUBE', color: 'bg-red-500/20 text-red-300 border-red-500/30' }
                    : isSpotifyUrl(track.url)
                    ? { label: 'SPOTIFY', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' }
                    : isMonochromeUrl(track.url)
                    ? { label: 'MONOCHROME', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' }
                    : { label: 'LOSSLESS', color: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' };

                return (
                  <div
                    key={track.id}
                    className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 group transition-all duration-300 ${
                      isCurrent
                        ? isLight
                          ? 'bg-fuchsia-600/15 border border-fuchsia-500/30 text-black shadow-lg'
                          : 'bg-fuchsia-600/25 border border-fuchsia-500/40 text-white shadow-lg'
                        : isLight
                          ? 'bg-transparent hover:bg-black/5 border border-transparent hover:border-black/10'
                          : 'bg-transparent hover:bg-white/5 border border-transparent hover:border-white/10'
                    }`}
                  >
                    <button onClick={() => handleTrackSelect(track)} className="flex-1 flex items-center gap-3 min-w-0 text-left">
                      {track.thumbnail ? (
                        <img
                          src={track.thumbnail}
                          alt={track.title}
                          className={`w-10 h-10 rounded-lg object-cover flex-shrink-0 border ${isLight ? 'border-black/10' : 'border-white/10'}`}
                        />
                      ) : (
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border ${isLight ? 'bg-black/5 border-black/10 text-black/40 group-hover:text-fuchsia-600' : 'bg-white/5 border-white/10 text-white/40 group-hover:text-fuchsia-300'}`}>
                          <Music size={16} />
                        </div>
                      )}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-xs font-semibold truncate ${isCurrent ? (isLight ? 'text-fuchsia-700 font-bold' : 'text-fuchsia-200 font-bold') : (isLight ? 'text-black' : 'text-white')}`}>
                          {track.title}
                        </span>
                        <span className={`text-[11px] truncate ${isLight ? 'text-black/50 group-hover:text-black/80' : 'text-white/40 group-hover:text-white/60'}`}>
                          {track.artist}
                        </span>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold border ${badge.color}`}>
                        {badge.label}
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        sendMusicAction('queue-add', track.id, 0, track);
                      }}
                      className={`p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity active:scale-95 ${isLight ? 'bg-black/5 hover:bg-black/10 text-black' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                      title="Add to Queue"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Add Track / Online Link Modal Overlay */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#18181b] border border-white/10 w-full max-w-sm p-6 rounded-2xl shadow-2xl text-white space-y-4">
            
            {/* Modal Header & Tabs */}
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setModalTab('online')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                    modalTab === 'online'
                      ? 'bg-fuchsia-600 text-white'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  <LinkIcon size={12} className="inline mr-1" />
                  Paste Link
                </button>
                <button
                  onClick={() => setModalTab('upload')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                    modalTab === 'upload'
                      ? 'bg-fuchsia-600 text-white'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  <Upload size={12} className="inline mr-1" />
                  Upload File
                </button>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-white/40 hover:text-white text-xs"
              >
                Cancel
              </button>
            </div>

            {/* Tab 1: Paste Online Audio URL / YouTube Link */}
            {modalTab === 'online' ? (
              <form onSubmit={handleAddOnlineUrl} className="space-y-4 pt-1">
                <div className="space-y-1">
                  <label className="text-xs text-white/60">Song Title *</label>
                  <input
                    type="text"
                    required
                    value={onlineTitle}
                    onChange={(e) => setOnlineTitle(e.target.value)}
                    placeholder="e.g. Lofi Study Beats"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-500 transition-all text-white placeholder-white/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-white/60">Artist / Channel Name</label>
                  <input
                    type="text"
                    value={onlineArtist}
                    onChange={(e) => setOnlineArtist(e.target.value)}
                    placeholder="e.g. Online Streamer"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-500 transition-all text-white placeholder-white/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-white/60">Audio / Music URL *</label>
                  <input
                    type="url"
                    required
                    value={onlineUrl}
                    onChange={(e) => setOnlineUrl(e.target.value)}
                    placeholder="https://example.com/stream.mp3"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-500 transition-all text-white placeholder-white/20 font-mono text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-fuchsia-950/40 mt-4"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Adding Track...
                    </>
                  ) : (
                    <>
                      <Plus size={16} />
                      Add to Shared Player
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* Tab 2: Upload File */
              <form onSubmit={handleFileUpload} className="space-y-4 pt-1">
                <div className="space-y-1">
                  <label className="text-xs text-white/60">Song Title *</label>
                  <input
                    type="text"
                    required
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="e.g. Midnight Track"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-500 transition-all text-white placeholder-white/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-white/60">Artist Name</label>
                  <input
                    type="text"
                    value={uploadArtist}
                    onChange={(e) => setUploadArtist(e.target.value)}
                    placeholder="e.g. Artist"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-500 transition-all text-white placeholder-white/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-white/60">Audio File (.mp3) *</label>
                  <input
                    type="file"
                    required
                    accept="audio/mpeg,audio/mp3"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-white/60 bg-white/5 border border-white/10 rounded-xl px-3 py-2 focus:outline-none file:mr-4 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-fuchsia-600 file:text-white cursor-pointer"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-lg shadow-fuchsia-950/40 mt-4"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Upload File
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

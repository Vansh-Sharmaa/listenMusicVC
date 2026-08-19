'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAudioMixer } from '../context/AudioMixerContext';
import { Play, Pause, Music, Upload, Loader2, Plus, Volume2, Link as LinkIcon, Radio, Share2 } from 'lucide-react';

import { parseMediaUrl, extractYouTubeId, isYouTubeUrl, isSpotifyUrl, isMonochromeUrl } from '../utils/mediaPlatform';

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
  onStartScreenShare?: () => void;
}

export const PlaylistSidebar: React.FC<PlaylistSidebarProps> = ({ onStartScreenShare }) => {
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
      id: 'yt-the-weeknd-blinding',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
      duration: 200,
      isRoyaltyFree: false,
      thumbnail: 'https://img.youtube.com/vi/4NRXx6U8ABQ/hqdefault.jpg'
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
    setTimeout(() => {
      sendMusicAction('play', track.id, 0, track);
    }, 100);
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

  // Quick Play handler: immediately starts playing any YouTube, Spotify, SoundCloud, or Monochrome / Lossless audio link
  const handleQuickPlay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickUrl.trim()) return;

    const trimmed = quickUrl.trim();
    const media = parseMediaUrl(trimmed);
    
    let newTrack: MusicTrack;
    if (media.platform === 'youtube' && media.id) {
      newTrack = {
        id: `yt-${media.id}-${Date.now()}`,
        title: 'YouTube Track',
        artist: 'YouTube Music',
        url: trimmed,
        duration: 300,
        isRoyaltyFree: false,
        thumbnail: `https://img.youtube.com/vi/${media.id}/hqdefault.jpg`
      };
    } else if (media.platform === 'spotify') {
      newTrack = {
        id: `spotify-${media.id}-${Date.now()}`,
        title: 'Spotify Track',
        artist: 'Spotify',
        url: trimmed,
        duration: 240,
        isRoyaltyFree: false,
        thumbnail: 'https://open.spotifycdn.com/cdn/images/favicon32.8e66b099.png'
      };
    } else if (media.platform === 'soundcloud') {
      newTrack = {
        id: `sc-${Date.now()}`,
        title: 'SoundCloud Track',
        artist: 'SoundCloud',
        url: trimmed,
        duration: 240,
        isRoyaltyFree: false,
        thumbnail: 'https://a-v2.sndcdn.com/assets/images/sc-icons/favicon-2cadd14bdb.ico'
      };
    } else {
      // Monochrome / Direct Lossless / Web Audio Stream
      newTrack = {
        id: `stream-${Date.now()}`,
        title: trimmed.includes('monochrome') ? 'Monochrome Stream' : 'Lossless Audio Stream',
        artist: 'High-Fidelity Audio',
        url: trimmed,
        duration: 300,
        isRoyaltyFree: true
      };
    }

    setTracks(prev => [newTrack, ...prev]);
    handleTrackSelect(newTrack);
    setQuickUrl('');
  };

  return (
    <div className="flex flex-col h-full bg-black/40 border-l border-white/10 backdrop-blur-md text-white w-80">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Music size={20} className="text-fuchsia-400" />
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

      {/* Instant Multi-Platform Song Link Bar */}
      <div className="p-3 bg-gradient-to-b from-fuchsia-950/40 to-black/20 border-b border-white/10">
        <form onSubmit={handleQuickPlay} className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-fuchsia-300 font-semibold px-0.5">
            <span>⚡ YouTube, Spotify, SoundCloud, Monochrome</span>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              placeholder="Paste Spotify, YouTube, or Stream link..."
              className="flex-1 bg-white/10 border border-white/15 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-fuchsia-500 transition-all"
            />
            <button
              type="submit"
              disabled={!quickUrl.trim()}
              className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-xl font-bold transition-all active:scale-95 shadow-md shadow-fuchsia-950/40 flex items-center gap-1"
            >
              <Play size={12} fill="white" />
              <span>Play</span>
            </button>
          </div>
        </form>
      </div>

      {/* Share Spotify / Laptop Audio Action Banner */}
      <div className="p-2.5 bg-gradient-to-r from-fuchsia-950/20 to-emerald-950/20 border-b border-white/10">
        <button
          onClick={handleShareSpotifyAudio}
          className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-2 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition-all active:scale-95"
        >
          <Share2 size={13} className="text-emerald-400" />
          <span>Stream Spotify / Desktop Audio</span>
        </button>
      </div>

      {/* Now Playing Card */}
      <div className="p-4 bg-white/5 border-b border-white/10 shadow-inner">
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
                <span className="text-xs text-white/50 truncate">{activeTrack.artist}</span>
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
          <div className="text-center text-xs text-white/40 py-3 italic flex flex-col items-center gap-1.5">
            <Volume2 size={22} className="text-white/20 animate-pulse" />
            No track playing. Click a song below or paste any YouTube link!
          </div>
        )}
      </div>

      {/* Online Streams & Tracks List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <span className="text-xs font-semibold text-white/40 px-1 uppercase tracking-wider block mb-2">
          Featured & Trending Tracks
        </span>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-white/30 text-xs">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading music...
          </div>
        ) : (
          tracks.map((track) => {
            const isCurrent = track.id === musicState.currentTrackId;
            const badge = isYouTubeUrl(track.url)
              ? { label: 'YOUTUBE', color: 'bg-red-500/20 text-red-300 border-red-500/30' }
              : isSpotifyUrl(track.url)
              ? { label: 'SPOTIFY', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' }
              : isMonochromeUrl(track.url)
              ? { label: 'MONOCHROME', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' }
              : { label: 'LOSSLESS', color: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' };

            return (
              <button
                key={track.id}
                onClick={() => handleTrackSelect(track)}
                className={`w-full text-left p-2.5 rounded-xl flex items-center gap-3 group transition-all duration-300 ${
                  isCurrent
                    ? 'bg-fuchsia-600/25 border border-fuchsia-500/40 text-white shadow-lg'
                    : 'hover:bg-white/5 border border-transparent text-white/70 hover:text-white'
                }`}
              >
                {track.thumbnail ? (
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="w-10 h-10 rounded-lg object-cover border border-white/10 flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 text-white/40 group-hover:text-fuchsia-300">
                    <Music size={16} />
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className={`text-xs font-semibold truncate ${isCurrent ? 'text-fuchsia-200 font-bold' : ''}`}>
                    {track.title}
                  </span>
                  <span className="text-[11px] text-white/40 group-hover:text-white/60 truncate">
                    {track.artist}
                  </span>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold border ${badge.color}`}>
                  {badge.label}
                </span>
              </button>
            );
          })
        )}
      </div>

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

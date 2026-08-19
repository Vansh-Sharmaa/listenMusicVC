'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAudioMixer } from '../context/AudioMixerContext';
import { Play, Pause, Music, Upload, Loader2, Plus, Volume2, Link as LinkIcon, Radio, Share2, Disc } from 'lucide-react';

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

      {/* Instant Live Song Search & URL Bar */}
      <div className="p-3 bg-gradient-to-b from-fuchsia-950/40 to-black/20 border-b border-white/10 relative">
        <form onSubmit={handleQuickPlay} className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-fuchsia-300 font-semibold px-0.5">
            <span>🔍 Search ANY Song in the World or Paste Link</span>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Desi Kalakaar, Starboy, Arijit..."
              className="flex-1 bg-white/10 border border-white/15 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-fuchsia-500 transition-all"
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
          <div className="absolute top-full left-0 right-0 z-50 bg-[#18181b]/95 border border-fuchsia-500/40 backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto mt-1 divide-y divide-white/10">
            <div className="p-2 bg-white/5 text-[10px] uppercase tracking-wider font-bold text-fuchsia-300 flex items-center justify-between">
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
                  <span className="text-xs font-semibold text-white group-hover:text-fuchsia-200 truncate">{result.title}</span>
                  <span className="text-[10px] text-white/50 truncate">{result.artist}</span>
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

      {/* Category Tabs: All, YouTube, Spotify, Monochrome, Lofi */}
      <div className="px-3 pt-2.5 pb-1 flex gap-1 overflow-x-auto border-b border-white/5 scrollbar-none">
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
                : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Online Streams & Tracks List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-white/30 text-xs">
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

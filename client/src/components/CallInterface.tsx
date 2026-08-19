'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAudioMixer } from '../context/AudioMixerContext';
import { ChatSidebar } from './ChatSidebar';
import { PlaylistSidebar } from './PlaylistSidebar';
import { AudioMixerPanel } from './AudioMixerPanel';
import { ReactionOverlay } from './ReactionOverlay';
import { extractYouTubeId, isYouTubeUrl, extractSpotifyInfo, extractSoundCloudInfo, isMonochromeUrl, parseMediaUrl } from '../utils/mediaPlatform';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  MessageSquare,
  Music,
  Sliders,
  Smile,
  Users,
  Tv,
  Copy,
  Play,
  Pause,
  Radio,
  Eye,
  EyeOff,
  Volume2,
  Maximize2,
  Minimize2,
  ExternalLink,
  Sparkles,
  Disc,
  SkipForward,
  SkipBack,
  Sun,
  Moon,
  Mic2,
  Search,
  X,
  Plus,
  ListPlus
} from 'lucide-react';
import { LyricsView } from './LyricsView';
import { extractPaletteFromImage, SongColorPalette } from '../utils/colorExtractor';

interface CallInterfaceProps {
  roomId: string;
  userId: string;
  username: string;
  token: string;
  livekitUrl: string;
  isMock: boolean;
  onLeave: () => void;
}

interface PeerStream {
  socketId: string;
  userId: string;
  username: string;
  stream: MediaStream;
}

// Safe remote video & audio player with guaranteed playback and Camera Off placeholder
const RemoteVideoPlayer: React.FC<{
  stream: MediaStream;
  username?: string;
  cameraEnabled?: boolean;
}> = ({ stream, username = 'Partner', cameraEnabled }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!stream) return;

    if (video) {
      video.srcObject = stream;
      video.play().then(() => {
        if (video.videoWidth > 0) setIsVideoPlaying(true);
      }).catch(() => {});
    }

    if (audio) {
      audio.srcObject = stream;
      audio.play().catch(e => console.warn('[Audio] Direct remote audio playback waiting for gesture:', e));
    }

    const checkTrackStatus = () => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().then(() => {
          if (videoRef.current && videoRef.current.videoWidth > 0) {
            setIsVideoPlaying(true);
          }
        }).catch(() => {});
      }
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {});
      }
    };

    stream.onaddtrack = checkTrackStatus;
    stream.onremovetrack = checkTrackStatus;
  }, [stream]);

  // Video is visible if camera is explicitly enabled OR if incoming video track is active
  const showVideo = cameraEnabled !== undefined ? cameraEnabled : isVideoPlaying;

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-transparent overflow-hidden">
      {/* Avatar placeholder when camera is OFF */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2.5 select-none z-0 transition-opacity duration-300 ${showVideo ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-gradient-to-br from-fuchsia-600 to-indigo-600 flex items-center justify-center text-xl md:text-2xl font-bold text-white shadow-xl border border-white/20">
          {username.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[11px] md:text-xs text-white/70 font-semibold">{username}</span>
          <span className="text-[10px] text-white/40 flex items-center gap-1 bg-black/40 px-2.5 py-0.5 rounded-full border border-white/5">
            <VideoOff size={10} /> Camera Off
          </span>
        </div>
      </div>

      {/* Video Element - Shown when camera is ON or receiving frames */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`absolute inset-0 w-full h-full object-cover z-10 transition-opacity duration-300 ${showVideo ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onPlaying={() => setIsVideoPlaying(true)}
        onLoadedMetadata={() => setIsVideoPlaying(true)}
      />

      {/* Direct Remote Audio Stream Element */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </div>
  );
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

export const CallInterface: React.FC<CallInterfaceProps> = ({
  roomId,
  userId,
  username,
  onLeave
}) => {
  // Context hooks
  const {
    socket,
    joinRoom,
    sendReaction,
    participants,
    participantMediaStates,
    updateMyMediaState,
    sendSpeakingState,
    isConnected,
    musicState,
    sendMusicAction,
    getServerTime,
    isHost,
    hostId,
    isDjAuthorized,
    permissionError,
    clearPermissionError
  } = useSocket();
  const {
    initAudio,
    processLocalMicTrack,
    registerRemoteVoiceTrack,
    unregisterRemoteVoiceTrack,
    registerRemoteScreenShareTrack,
    getMusicTrack,
    musicVolume,
    registerMusicElement,
    audioContext
  } = useAudioMixer();

  // Local media state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<Map<string, PeerStream>>(new Map());
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const isLight = theme === 'light';

  // Toolbar controls - Camera and Microphone must be OFF by default
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Real-time speech detection using Web Audio API
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const speechIntervalRef = useRef<any>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const lastSpeechTimeRef = useRef<number>(0);

  // Mock speaking state (testing utility)
  const [mockSpeakingUser, setMockSpeakingUser] = useState<string | null>(null);
  const mockOscillatorRef = useRef<OscillatorNode | null>(null);
  const mockOscillatorGainRef = useRef<GainNode | null>(null);

  // Sidebar toggles
  const [activeSidebar, setActiveSidebar] = useState<'chat' | 'music' | 'mixer' | 'lyrics' | null>('music');
  const [showReactionMenu, setShowReactionMenu] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [songPalette, setSongPalette] = useState<SongColorPalette | null>(null);

  // Dynamic Apple Music fluid color extraction from album art
  useEffect(() => {
    if (musicState.currentTrack?.thumbnail) {
      extractPaletteFromImage(musicState.currentTrack.thumbnail).then(palette => {
        setSongPalette(palette);
      });
    } else {
      setSongPalette(null);
    }
  }, [musicState.currentTrack?.thumbnail]);

  // Expanded Apple-style Theater View states
  const [expandedSearchQuery, setExpandedSearchQuery] = useState('');
  const [expandedSearchResults, setExpandedSearchResults] = useState<any[]>([]);
  const [isExpandedSearching, setIsExpandedSearching] = useState(false);
  const [showExpandedSearchPopup, setShowExpandedSearchPopup] = useState(false);
  const [expandedViewMode, setExpandedViewMode] = useState<'visualizer' | 'video'>('visualizer');

  // Debounced search for expanded Apple-style player
  useEffect(() => {
    if (!expandedSearchQuery.trim() || expandedSearchQuery.trim().startsWith('http')) {
      setExpandedSearchResults([]);
      setIsExpandedSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsExpandedSearching(true);
      try {
        const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
        const res = await fetch(`${serverUrl}/api/music/search?q=${encodeURIComponent(expandedSearchQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setExpandedSearchResults(data);
          setShowExpandedSearchPopup(true);
        }
      } catch (e) {
        console.warn('[Expanded Search] Error:', e);
      } finally {
        setIsExpandedSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [expandedSearchQuery]);

  const handleExpandedSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDjAuthorized) {
      alert('👑 Enter the 4-digit DJ PIN in the Music Hub to control tracks for the room.');
      return;
    }
    const q = expandedSearchQuery.trim();
    if (!q) return;

    if (q.startsWith('http://') || q.startsWith('https://')) {
      const ytId = extractYouTubeId(q);
      if (ytId) {
        const newTrack = {
          id: `yt-${ytId}`,
          title: `YouTube Track (${ytId})`,
          artist: 'YouTube',
          url: `https://www.youtube.com/watch?v=${ytId}`,
          duration: 240,
          isRoyaltyFree: false,
          thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
        };
        sendMusicAction('change', newTrack.id, 0, newTrack);
        setExpandedSearchQuery('');
        setShowExpandedSearchPopup(false);
        return;
      }
    }

    setIsExpandedSearching(true);
    try {
      const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const res = await fetch(`${serverUrl}/api/music/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          sendMusicAction('change', data[0].id, 0, data[0]);
          setExpandedSearchQuery('');
          setShowExpandedSearchPopup(false);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsExpandedSearching(false);
    }
  };

  // Real-time Speech Detection Loop with Hysteresis Smoothing
  useEffect(() => {
    if (!micOn || !localStream) {
      if (isSpeakingRef.current) {
        isSpeakingRef.current = false;
        setIsLocalSpeaking(false);
        sendSpeakingState(false);
      }
      if (speechIntervalRef.current) {
        clearInterval(speechIntervalRef.current);
        speechIntervalRef.current = null;
      }
      return;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = audioContext || new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const micStream = new MediaStream([audioTrack]);
      const source = ctx.createMediaStreamSource(micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const SPEECH_ENTER_THRESHOLD = 0.025; // Root-mean-square volume threshold to start speaking
      const SPEECH_EXIT_THRESHOLD = 0.015;  // Volume threshold to stop speaking
      const HANGOVER_MS = 350;             // Delay before clearing speaking state to avoid rapid flickering

      speechIntervalRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const now = Date.now();

        if (rms > SPEECH_ENTER_THRESHOLD) {
          lastSpeechTimeRef.current = now;
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            setIsLocalSpeaking(true);
            sendSpeakingState(true);
          }
        } else if (isSpeakingRef.current && (now - lastSpeechTimeRef.current > HANGOVER_MS) && rms < SPEECH_EXIT_THRESHOLD) {
          isSpeakingRef.current = false;
          setIsLocalSpeaking(false);
          sendSpeakingState(false);
        }
      }, 50);

      return () => {
        if (speechIntervalRef.current) {
          clearInterval(speechIntervalRef.current);
          speechIntervalRef.current = null;
        }
        try { source.disconnect(); } catch (_) {}
      };
    } catch (err) {
      console.warn('[Speech Detector] Initialization warning:', err);
    }
  }, [micOn, localStream, audioContext, sendSpeakingState]);

  // Refs - these are stable across renders
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceCandidateQueuesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const localMediaReadyRef = useRef<boolean>(false);
  const pendingOffersRef = useRef<{ socketId: string; username: string }[]>([]);

  // Permanent music player ref
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  if (typeof window !== 'undefined' && !musicAudioRef.current) {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    musicAudioRef.current = audio;
  }
  const isSyncingMusicRef = useRef(false);

  // Mapping socketId -> { userId, username } so remote peer cards have the actual userId
  const socketIdToPeerInfoRef = useRef<Map<string, { userId: string; username: string }>>(new Map());

  // Senders for screen share tracks per peer connection
  const screenShareSendersRef = useRef<Map<string, RTCRtpSender[]>>(new Map());

  // We use a socketRef inside this component so all WebRTC callbacks get the latest socket
  // without needing to be inside a useEffect that re-registers on every socket change.
  const socketRef = useRef(socket);
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  const renegotiateAllPeers = useCallback(async () => {
    console.log('[WebRTC] Starting renegotiation for all peers...');
    for (const [sid, pc] of peerConnectionsRef.current.entries()) {
      if (pc.signalingState === 'closed') continue;
      try {
        makingOfferRef.current.set(sid, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('webrtc:offer', {
          targetSocketId: sid,
          offer: pc.localDescription
        });
        console.log(`[WebRTC] → Renegotiation offer sent to ${sid}`);
      } catch (e) {
        console.error(`[WebRTC] Renegotiation offer error for ${sid}:`, e);
      } finally {
        makingOfferRef.current.set(sid, false);
      }
    }
  }, []);

  const addTracksToPC = useCallback((pc: RTCPeerConnection, stream: MediaStream) => {
    const existingSenders = pc.getSenders();
    const existingTrackIds = new Set(existingSenders.map(s => s.track?.id).filter(Boolean));
    stream.getTracks().forEach(track => {
      if (!existingTrackIds.has(track.id)) {
        try {
          pc.addTrack(track, stream);
          console.log(`[WebRTC] Added local ${track.kind} track (${track.id}) to PC`);
        } catch (e) {
          console.warn('[WebRTC] addTrack error:', e);
        }
      }
    });
  }, []);

  /** Add the music WebRTC track to a single PC (idempotent). */
  const addMusicTrackToPC = useCallback((pc: RTCPeerConnection) => {
    const musicTrack = getMusicTrack();
    if (!musicTrack) return;
    const existingSenders = pc.getSenders();
    const alreadyAdded = existingSenders.some(s => s.track?.id === musicTrack.id);
    if (!alreadyAdded) {
      try {
        pc.addTrack(musicTrack, new MediaStream([musicTrack]));
        console.log('[WebRTC] Added music track to PC');
      } catch (e) {
        console.warn('[WebRTC] addTrack (music) error:', e);
      }
    }
  }, [getMusicTrack]);

  const processQueuedCandidates = useCallback(async (sid: string, pc: RTCPeerConnection) => {
    const queue = iceCandidateQueuesRef.current.get(sid) || [];
    if (queue.length === 0) return;
    console.log(`[WebRTC] Flushing ${queue.length} queued ICE candidates for ${sid}`);
    iceCandidateQueuesRef.current.set(sid, []);
    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[WebRTC] Queued ICE candidate error:', e);
      }
    }
  }, []);

  const createPeerConnection = useCallback((targetSocketId: string, peerUsername: string): RTCPeerConnection => {
    // Close any existing stale connection
    const existing = peerConnectionsRef.current.get(targetSocketId);
    if (existing && existing.signalingState !== 'closed') {
      console.log(`[WebRTC] Reusing existing PC for ${targetSocketId} (state: ${existing.signalingState})`);
      return existing;
    }
    if (existing) {
      try { existing.close(); } catch (_) {}
    }

    console.log(`[WebRTC] Creating new RTCPeerConnection for ${peerUsername} (${targetSocketId})`);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current.set(targetSocketId, pc);
    iceCandidateQueuesRef.current.set(targetSocketId, []);
    makingOfferRef.current.set(targetSocketId, false);

    // Attach local tracks immediately if available
    if (localStreamRef.current) {
      addTracksToPC(pc, localStreamRef.current);
    }
    // Attach music track if available
    addMusicTrackToPC(pc);

    // ICE candidates
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current) {
        socketRef.current.emit('webrtc:ice-candidate', {
          targetSocketId,
          candidate: candidate.toJSON()
        });
      }
    };

    pc.oniceconnectionstatechange = async () => {
      console.log(`[WebRTC] ICE state with ${peerUsername}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        console.log(`[WebRTC] ICE failed with ${peerUsername}, initiating ICE restart offer...`);
        try {
          makingOfferRef.current.set(targetSocketId, true);
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          socketRef.current?.emit('webrtc:offer', {
            targetSocketId,
            offer: pc.localDescription
          });
          console.log(`[WebRTC] → ICE restart offer sent to ${targetSocketId}`);
        } catch (e) {
          console.warn('[WebRTC] ICE restart error:', e);
        } finally {
          makingOfferRef.current.set(targetSocketId, false);
        }
      }
    };

    pc.onnegotiationneeded = async () => {
      console.log(`[WebRTC] onnegotiationneeded with ${peerUsername} (state: ${pc.signalingState})`);
      if (pc.signalingState !== 'stable' || makingOfferRef.current.get(targetSocketId)) return;
      try {
        makingOfferRef.current.set(targetSocketId, true);
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('webrtc:offer', {
          targetSocketId,
          offer: pc.localDescription
        });
        console.log(`[WebRTC] → Negotiation offer sent to ${targetSocketId}`);
      } catch (err) {
        console.warn('[WebRTC] Negotiation offer error:', err);
      } finally {
        makingOfferRef.current.set(targetSocketId, false);
      }
    };

    // Remote track handler
    pc.ontrack = (event) => {
      console.log(`[WebRTC] ← Remote ${event.track.kind} track from ${peerUsername}`, event.track.id);

      let peerStream = event.streams && event.streams[0] ? event.streams[0] : remoteStreamsRef.current.get(targetSocketId);
      if (!peerStream) {
        peerStream = new MediaStream();
      }
      if (!peerStream.getTracks().some(t => t.id === event.track.id)) {
        peerStream.addTrack(event.track);
      }
      remoteStreamsRef.current.set(targetSocketId, peerStream);

      event.track.onended = () => {
        console.log(`[WebRTC] Track ended: ${event.track.kind} from ${peerUsername}`);
      };

      // Create a fresh MediaStream reference so React state updates and video tags rebind
      const freshStream = new MediaStream(peerStream.getTracks());

      const peerInfo = socketIdToPeerInfoRef.current.get(targetSocketId);
      const actualUserId = peerInfo?.userId || targetSocketId;
      const actualUsername = peerInfo?.username || peerUsername;

      setRemotePeers(prev => {
        const updated = new Map(prev);
        updated.set(targetSocketId, {
          socketId: targetSocketId,
          userId: actualUserId,
          username: actualUsername,
          stream: freshStream
        });
        return updated;
      });

      if (event.track.kind === 'audio') {
        registerRemoteVoiceTrack(targetSocketId + '_' + event.track.id, event.track);
        registerRemoteScreenShareTrack(targetSocketId + '_screen_' + event.track.id, event.track);
      }
    };

    return pc;
  }, [addTracksToPC, addMusicTrackToPC, registerRemoteVoiceTrack, registerRemoteScreenShareTrack]);

  // ─────────────────────────────────────────────────────────────
  // Init: join room + media + permanent music sync
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    joinRoom(roomId, userId, username);
    initAudio();
    startLocalMedia();

    // Global unlock & foreground wake handler
    const unlockAudioAndVideo = () => {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      if (musicAudioRef.current && musicAudioRef.current.paused && musicState.isPlaying) {
        musicAudioRef.current.play().then(() => {
          setAutoplayBlocked(false);
        }).catch(() => {});
      }
    };

    // Resynchronize immediately on tab visibility change or laptop wake
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Sync] Tab returned to foreground — syncing clock & timeline...');
        socketRef.current?.emit('music:sync-ping', { clientTimestamp: Date.now() });
        if (audioContext && audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
      }
    };

    // Bluetooth / headphone device switch handler
    const handleDeviceChange = () => {
      console.log('[Media] Audio/Video device change detected (Bluetooth/Headphones switch)');
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
    };

    window.addEventListener('click', unlockAudioAndVideo);
    window.addEventListener('touchstart', unlockAudioAndVideo);
    window.addEventListener('keydown', unlockAudioAndVideo);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    return () => {
      window.removeEventListener('click', unlockAudioAndVideo);
      window.removeEventListener('touchstart', unlockAudioAndVideo);
      window.removeEventListener('keydown', unlockAudioAndVideo);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
      cleanupAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId, username, audioContext]);

  // Multi-Platform Player state & refs
  const [showYtVideo, setShowYtVideo] = useState(true);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [isYtApiReady, setIsYtApiReady] = useState(false);
  const ytPlayerRef = useRef<any>(null);
  const ytPlayerReadyRef = useRef<boolean>(false);
  const currentYtVideoIdRef = useRef<string | null>(null);
  const lastAppliedStateVersionRef = useRef<number>(0);

  // Load YouTube IFrame API script once with deterministic ready callback & polling
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).YT && (window as any).YT.Player) {
      setIsYtApiReady(true);
      return;
    }

    const prevReady = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (prevReady) prevReady();
      setIsYtApiReady(true);
    };

    if (!document.getElementById('youtube-iframe-api-script')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }

    // Safety fallback interval for fast-cached script loads
    const checkInterval = setInterval(() => {
      if ((window as any).YT && (window as any).YT.Player) {
        setIsYtApiReady(true);
        clearInterval(checkInterval);
      }
    }, 250);

    return () => clearInterval(checkInterval);
  }, []);

  // Global Mobile Touch / Tap gesture unlocker for AudioContext & YouTube
  useEffect(() => {
    const unlockAudio = () => {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      if (ytPlayerRef.current && ytPlayerReadyRef.current) {
        try {
          if (musicState.isPlaying) {
            ytPlayerRef.current.playVideo();
          }
        } catch (_) {}
      }
      if (musicAudioRef.current && musicState.isPlaying) {
        musicAudioRef.current.play().catch(() => {});
      }
    };

    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, [audioContext, musicState.isPlaying]);

  // Sync music element with Web Audio mixer
  useEffect(() => {
    if (musicAudioRef.current) {
      registerMusicElement(musicAudioRef.current);
    }
  }, [musicAudioRef.current, registerMusicElement]);

  // Apply volume changes to permanent music audio element & YouTube player
  useEffect(() => {
    if (musicAudioRef.current) {
      musicAudioRef.current.volume = Math.max(0, Math.min(1, musicVolume));
    }
    if (ytPlayerRef.current && ytPlayerReadyRef.current) {
      try {
        ytPlayerRef.current.setVolume(Math.max(0, Math.min(100, Math.round(musicVolume * 100))));
      } catch (_) {}
    }
  }, [musicVolume]);

  // Live interactive timeline position tracking
  const [songProgress, setSongProgress] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 });
  const isSeekingRef = useRef<boolean>(false);
  const isLocalTriggeredRef = useRef<boolean>(false);

  // High-precision smooth UI progress updater (60fps animation frame loop for butter-smooth lyrics sync)
  useEffect(() => {
    let animFrameId: number;

    const updatePrecisionTime = () => {
      if (!isSeekingRef.current) {
        if (ytPlayerRef.current && ytPlayerReadyRef.current && ytPlayerRef.current.getCurrentTime) {
          try {
            const cur = ytPlayerRef.current.getCurrentTime() || 0;
            const dur = ytPlayerRef.current.getDuration() || (musicState.currentTrack?.duration || 0);
            setSongProgress({ current: cur, duration: dur });
          } catch (_) {}
        } else if (musicAudioRef.current) {
          setSongProgress({
            current: musicAudioRef.current.currentTime || 0,
            duration: musicAudioRef.current.duration || (musicState.currentTrack?.duration || 0)
          });
        }
      }

      animFrameId = requestAnimationFrame(updatePrecisionTime);
    };

    animFrameId = requestAnimationFrame(updatePrecisionTime);
    return () => cancelAnimationFrame(animFrameId);
  }, [musicState]);

  // Handle user seeking on the shared timeline bar
  const handleSeek = (newTime: number) => {
    if (!isDjAuthorized) {
      alert('👑 Only the room creator (Host) or authorized DJs with the 4-digit PIN can seek or control the music.');
      return;
    }
    isSeekingRef.current = false;
    isLocalTriggeredRef.current = true;
    setSongProgress(prev => ({ ...prev, current: newTime }));

    if (ytPlayerRef.current && ytPlayerReadyRef.current && ytPlayerRef.current.seekTo) {
      try { ytPlayerRef.current.seekTo(newTime, true); } catch (_) {}
    }
    if (musicAudioRef.current) {
      musicAudioRef.current.currentTime = newTime;
    }

    sendMusicAction('seek', musicState.currentTrackId, newTime, musicState.currentTrack);
    setTimeout(() => { isLocalTriggeredRef.current = false; }, 500);
  };

  const isProgrammaticActionRef = useRef<boolean>(false);
  const lastSeekTimestampRef = useRef<number>(0);

  // Synchronized YouTube Video & Audio Engine (Zero-Stuttering & Feedback-Protected)
  useEffect(() => {
    const audio = musicAudioRef.current;

    if (!musicState.currentTrackId && !musicState.currentTrack) {
      if (audio && !audio.paused) audio.pause();
      if (ytPlayerRef.current && ytPlayerReadyRef.current) {
        try {
          isProgrammaticActionRef.current = true;
          ytPlayerRef.current.pauseVideo();
          setTimeout(() => { isProgrammaticActionRef.current = false; }, 800);
        } catch (_) {}
      }
      return;
    }

    const currentTrack = musicState.currentTrack;
    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
    let trackUrl = currentTrack?.url || '';

    // Fallback URL preset lookup if trackData wasn't attached
    if (!trackUrl && musicState.currentTrackId) {
      const presetList: Record<string, string> = {
        'yt-the-weeknd-starboy': 'https://www.youtube.com/watch?v=34Na4j8AVgA',
        'yt-the-weeknd-blinding': 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
        'yt-chase-atlantic-slide': 'https://www.youtube.com/watch?v=tOVIeLZtxDc',
        'yt-drake-massive': 'https://www.youtube.com/watch?v=ay1l_u6vltY',
        'yt-future-weeknd': 'https://www.youtube.com/watch?v=mq4wClhFmA8',
        'yt-tricksingh-taaj': 'https://www.youtube.com/watch?v=Du8E8g2LVoU',
        'yt-lofi-girl': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
        'online-1': 'https://ia802802.us.archive.org/5/items/lofi-study-112191/lofi-study-112191.mp3',
        'online-2': 'https://ia800905.us.archive.org/19/items/FREE_background_music_loops/chill_groove.mp3',
        'online-3': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'monochrome-preset-1': 'https://ia800905.us.archive.org/19/items/FREE_background_music_loops/chill_groove.mp3',
        'monochrome-preset-2': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'monochrome-preset-3': 'https://ia802802.us.archive.org/5/items/lofi-study-112191/lofi-study-112191.mp3',
        'monochrome-preset-4': 'https://ia800905.us.archive.org/19/items/FREE_background_music_loops/chill_groove.mp3'
      };
      trackUrl = presetList[musicState.currentTrackId] || '';
    }

    if (trackUrl.startsWith('/')) {
      trackUrl = `${serverUrl}${trackUrl}`;
    }

    if (!trackUrl) {
      if (audio && !audio.paused) audio.pause();
      return;
    }

    const ytId = extractYouTubeId(trackUrl);

    // ───────────────────────────────────────────
    // Path A: Synchronized Smooth YouTube Video & Audio
    // ───────────────────────────────────────────
    if (ytId) {
      if (audio && !audio.paused) audio.pause();

      const elapsed = musicState.isPlaying
        ? (getServerTime() - Number(musicState.lastPositionUpdatedAt || Date.now())) / 1000
        : 0;
      const targetPos = Math.max(0, (musicState.lastPosition || 0) + elapsed);

      const isNewVersion = musicState.stateVersion !== lastAppliedStateVersionRef.current;
      if (isNewVersion && musicState.stateVersion) {
        lastAppliedStateVersionRef.current = musicState.stateVersion;
      }

      if (!ytPlayerRef.current) {
        if ((window as any).YT && (window as any).YT.Player) {
          try {
            isProgrammaticActionRef.current = true;
            ytPlayerRef.current = new (window as any).YT.Player('youtube-sync-player', {
              height: '100%',
              width: '100%',
              videoId: ytId,
              playerVars: {
                autoplay: musicState.isPlaying ? 1 : 0,
                controls: 1,
                disablekb: 0,
                modestbranding: 1,
                rel: 0,
                playsinline: 1,
                enablejsapi: 1,
                origin: typeof window !== 'undefined' ? window.location.origin : undefined,
                widget_referrer: typeof window !== 'undefined' ? window.location.href : undefined,
                start: Math.floor(targetPos)
              },
              events: {
                onReady: (event: any) => {
                  ytPlayerReadyRef.current = true;
                  currentYtVideoIdRef.current = ytId;
                  event.target.setVolume(Math.max(0, Math.min(100, Math.round(musicVolume * 100))));
                  
                  const liveElapsed = musicState.isPlaying
                    ? (getServerTime() - Number(musicState.lastPositionUpdatedAt || Date.now())) / 1000
                    : 0;
                  const liveTargetPos = Math.max(0, (musicState.lastPosition || 0) + liveElapsed);
                  
                  if (liveTargetPos > 0) {
                    event.target.seekTo(liveTargetPos, true);
                  }
                  if (musicState.isPlaying) {
                    event.target.playVideo();
                  } else {
                    event.target.pauseVideo();
                  }
                  setTimeout(() => { isProgrammaticActionRef.current = false; }, 1000);
                },
                onStateChange: (event: any) => {
                  // Guard: Ignore all state changes triggered programmatically or by sync seeks
                  if (isProgrammaticActionRef.current || isLocalTriggeredRef.current) return;

                  // YT.PlayerState.PLAYING = 1, PAUSED = 2
                  if (event.data === 1 && !musicState.isPlaying) {
                    const curTime = event.target.getCurrentTime ? event.target.getCurrentTime() : 0;
                    isLocalTriggeredRef.current = true;
                    sendMusicAction('play', musicState.currentTrackId, curTime, musicState.currentTrack);
                    setTimeout(() => { isLocalTriggeredRef.current = false; }, 800);
                  } else if (event.data === 2 && musicState.isPlaying) {
                    const curTime = event.target.getCurrentTime ? event.target.getCurrentTime() : 0;
                    isLocalTriggeredRef.current = true;
                    sendMusicAction('pause', musicState.currentTrackId, curTime, musicState.currentTrack);
                    setTimeout(() => { isLocalTriggeredRef.current = false; }, 800);
                  } else if (event.data === 0) { // ENDED
                    if (musicState.queue && musicState.queue.length > 0) {
                      isLocalTriggeredRef.current = true;
                      sendMusicAction('queue-pop');
                      setTimeout(() => { isLocalTriggeredRef.current = false; }, 800);
                    } else {
                      isLocalTriggeredRef.current = true;
                      sendMusicAction('pause', musicState.currentTrackId, 0, musicState.currentTrack);
                      setTimeout(() => { isLocalTriggeredRef.current = false; }, 800);
                    }
                  }
                },
                onError: async (err: any) => {
                  console.warn('[YouTube Player] Error code:', err?.data);
                  if (err?.data === 101 || err?.data === 150 || err?.data === 2) {
                    if (musicState.currentTrack?.title) {
                      try {
                        const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
                        const res = await fetch(`${serverUrl}/api/music/search?q=${encodeURIComponent(musicState.currentTrack.title + ' audio')}`);
                        if (res.ok) {
                          const results = await res.json();
                          const fallback = results.find((r: any) => r.id !== `yt-${ytId}`);
                          if (fallback) {
                            sendMusicAction('change', fallback.id, 0, fallback);
                            return;
                          }
                        }
                      } catch (_) {}
                    }
                  }
                }
              }
            });
          } catch (e) {
            console.warn('[YouTube] Player initialization error:', e);
            isProgrammaticActionRef.current = false;
          }
        }
      } else if (ytPlayerReadyRef.current) {
        try {
          // If track changed: load the new video once and seek
          if (currentYtVideoIdRef.current !== ytId) {
            currentYtVideoIdRef.current = ytId;
            isProgrammaticActionRef.current = true;
            ytPlayerRef.current.loadVideoById({
              videoId: ytId,
              startSeconds: Math.floor(targetPos)
            });
            setTimeout(() => { isProgrammaticActionRef.current = false; }, 1000);
          }

          ytPlayerRef.current.setVolume(Math.max(0, Math.min(100, Math.round(musicVolume * 100))));

          if (musicState.isPlaying) {
            isProgrammaticActionRef.current = true;
            ytPlayerRef.current.playVideo();
            setTimeout(() => { isProgrammaticActionRef.current = false; }, 600);

            const currentPos = ytPlayerRef.current.getCurrentTime ? ytPlayerRef.current.getCurrentTime() : 0;
            const drift = Math.abs(targetPos - currentPos);
            const now = Date.now();

            // Only hard seek if drift is massive (> 3.5s) AND at least 4 seconds have passed since last seek
            if (drift > 3.5 && (now - lastSeekTimestampRef.current > 4000)) {
              lastSeekTimestampRef.current = now;
              isProgrammaticActionRef.current = true;
              ytPlayerRef.current.seekTo(targetPos, true);
              setTimeout(() => { isProgrammaticActionRef.current = false; }, 800);
            }
          } else {
            isProgrammaticActionRef.current = true;
            ytPlayerRef.current.pauseVideo();
            setTimeout(() => { isProgrammaticActionRef.current = false; }, 600);
            
            const currentPos = ytPlayerRef.current.getCurrentTime ? ytPlayerRef.current.getCurrentTime() : 0;
            if (musicState.lastPosition !== undefined && Math.abs(currentPos - musicState.lastPosition) > 1.5) {
              ytPlayerRef.current.seekTo(musicState.lastPosition, true);
            }
          }
        } catch (err) {
          console.warn('[YouTube] Sync loop exception:', err);
        }
      }
      return;
    }

    // ───────────────────────────────────────────
    // Path B: Web Widgets (Spotify, SoundCloud)
    // ───────────────────────────────────────────
    if (extractSpotifyInfo(trackUrl) || extractSoundCloudInfo(trackUrl)) {
      if (audio && !audio.paused) audio.pause();
      if (ytPlayerRef.current && ytPlayerReadyRef.current) {
        try { ytPlayerRef.current.pauseVideo(); } catch (_) {}
      }
      setShowYtVideo(true); // Automatically ensure widget is visible
      return;
    }

    // ───────────────────────────────────────────
    // Path C: Synchronized Direct MP3 / Audio Stream
    // ───────────────────────────────────────────
    if (ytPlayerRef.current && ytPlayerReadyRef.current) {
      try { ytPlayerRef.current.pauseVideo(); } catch (_) {}
    }

    if (!audio) return;

    if (audio.src !== trackUrl) {
      audio.src = trackUrl;
      audio.load();
    }

    audio.onended = () => {
      if (musicState.queue && musicState.queue.length > 0) {
        isLocalTriggeredRef.current = true;
        sendMusicAction('queue-pop');
        setTimeout(() => { isLocalTriggeredRef.current = false; }, 800);
      } else {
        isLocalTriggeredRef.current = true;
        sendMusicAction('pause', musicState.currentTrackId, 0, musicState.currentTrack);
        setTimeout(() => { isLocalTriggeredRef.current = false; }, 800);
      }
    };

    const syncAudio = async () => {
      if (isSyncingMusicRef.current || !audio.src) return;
      isSyncingMusicRef.current = true;

      try {
        if (musicState.isPlaying) {
          const elapsed = (getServerTime() - Number(musicState.lastPositionUpdatedAt)) / 1000;
          const targetPos = Math.max(0, musicState.lastPosition + elapsed);

          if (Math.abs(audio.currentTime - targetPos) > 2.0) {
            audio.currentTime = targetPos;
          }

          if (audio.paused) {
            await audio.play().catch(err => {
              console.warn('[Music] Autoplay waiting for user gesture:', err.message);
              setAutoplayBlocked(true);
            });
            setAutoplayBlocked(false);
          }
        } else {
          if (!audio.paused) {
            audio.pause();
          }
          if (Math.abs(audio.currentTime - musicState.lastPosition) > 1.0) {
            audio.currentTime = musicState.lastPosition;
          }
        }
      } catch (err) {
        console.warn('[Music] Sync play exception:', err);
      } finally {
        isSyncingMusicRef.current = false;
      }
    };

    syncAudio();
  }, [musicState, getServerTime, musicVolume, isYtApiReady]);

  // Sync local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const startLocalMedia = async () => {
    let audioTrack: MediaStreamTrack | null = null;
    let videoTrack: MediaStreamTrack | null = null;

    // 1. Try to acquire audio track (Microphone) with fallbacks
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let audioStream;
        try {
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: false
            }
          });
        } catch (firstErr) {
          console.warn('[Media] Ideal audio constraints failed, trying basic audio:true...', firstErr);
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true
          });
        }
        audioTrack = audioStream.getAudioTracks()[0] || null;
      }
    } catch (err) {
      console.warn('[Media] Failed to acquire microphone track on startup:', err);
    }

    // 2. Try to acquire video track (Camera) with fallbacks
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let videoStream;
        try {
          videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          });
        } catch (firstErr) {
          console.warn('[Media] Ideal video constraints failed, trying basic video:true...', firstErr);
          videoStream = await navigator.mediaDevices.getUserMedia({
            video: true
          });
        }
        videoTrack = videoStream.getVideoTracks()[0] || null;
      }
    } catch (err) {
      console.warn('[Media] Failed to acquire camera track on startup:', err);
    }

    // 3. Assemble local stream
    let stream = new MediaStream();
    if (audioTrack) stream.addTrack(audioTrack);
    if (videoTrack) stream.addTrack(videoTrack);

    // If both failed or are empty, create fallback virtual tracks
    if (stream.getTracks().length === 0) {
      stream = createFallbackStream();
    } else {
      // If we got one but not both, fill in the missing track with fallback
      if (!audioTrack) {
        const fallbackStream = createFallbackStream();
        const fallbackAudio = fallbackStream.getAudioTracks()[0];
        if (fallbackAudio) stream.addTrack(fallbackAudio);
      }
      if (!videoTrack) {
        const fallbackStream = createFallbackStream();
        const fallbackVideo = fallbackStream.getVideoTracks()[0];
        if (fallbackVideo) stream.addTrack(fallbackVideo);
      }
    }

    // Camera and Microphone must be OFF by default
    stream.getVideoTracks().forEach(t => { t.enabled = false; });
    stream.getAudioTracks().forEach(t => { t.enabled = false; });

    localStreamRef.current = stream;
    setLocalStream(stream);

    // Route mic through audio mixer
    const micTrack = stream.getAudioTracks()[0];
    if (micTrack) {
      processLocalMicTrack(micTrack).catch(e => console.warn('[Media] Mic process warning:', e));
    }

    // Mark media as ready
    localMediaReadyRef.current = true;

    // Broadcast default OFF media state to room
    updateMyMediaState({ cameraEnabled: false, microphoneEnabled: false, screenSharing: false });

    // Add local tracks (and music track) to any already-existing peer connections
    peerConnectionsRef.current.forEach((pc, _sid) => {
      if (pc.signalingState !== 'closed') {
        addTracksToPC(pc, stream!);
        addMusicTrackToPC(pc);
      }
    });

    // BUG FIX #2 + #3: Now send any offers that were queued while media wasn't ready yet
    // and add the music track to all PCs
    for (const { socketId, username } of pendingOffersRef.current) {
      const pc = peerConnectionsRef.current.get(socketId);
      if (!pc || pc.signalingState === 'closed') continue;
      try {
        makingOfferRef.current.set(socketId, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('webrtc:offer', {
          targetSocketId: socketId,
          offer: pc.localDescription
        });
        console.log(`[WebRTC] → Deferred offer sent to ${socketId} (${username})`);
      } catch (e) {
        console.error('[WebRTC] Error sending deferred offer:', e);
      } finally {
        makingOfferRef.current.set(socketId, false);
      }
    }
    pendingOffersRef.current = [];
  };

  const cleanupAll = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerConnectionsRef.current.forEach(pc => { try { pc.close(); } catch (_) {} });
    peerConnectionsRef.current.clear();
    iceCandidateQueuesRef.current.clear();
    makingOfferRef.current.clear();
    stopMockSpeech();
  };

  // Canvas fallback stream when camera is blocked
  const createFallbackStream = (): MediaStream => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    let frame = 0;

    const draw = () => {
      if (!ctx) return;
      frame++;
      const grad = ctx.createLinearGradient(0, 0, 640, 360);
      grad.addColorStop(0, '#09090b');
      grad.addColorStop(1, '#18181b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 360);
      ctx.beginPath();
      ctx.arc(320, 160, 50 + Math.sin(frame * 0.05) * 5, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(username || 'User', 320, 250);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#a1a1aa';
      ctx.fillText('(Virtual Camera Active)', 320, 275);
    };

    const interval = setInterval(draw, 100);
    const canvasStream = canvas.captureStream(20);

    // Silent audio track
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const actx = new AudioCtx();
    const osc = actx.createOscillator();
    const dest = actx.createMediaStreamDestination();
    const gain = actx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();

    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    return canvasStream;
  };

  // ─────────────────────────────────────────────────────────────
  // WebRTC signaling via socket events
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    // ── A. We just joined: server sends us the list of existing peers ──
    // We (the newcomer) initiate offers to each existing peer.
    // BUG FIX #2: If local media isn't ready yet, create the PC (so we can accept ICE)
    // but defer sending the offer until startLocalMedia() finishes.
    const onPeerList = async (payload: { peers: { socketId: string; userId: string; username: string }[] }) => {
      console.log('[WebRTC] peer-list received:', payload.peers);
      for (const peer of payload.peers) {
        if (peer.socketId === socket.id) continue; // skip self
        socketIdToPeerInfoRef.current.set(peer.socketId, { userId: peer.userId, username: peer.username });
        const pc = createPeerConnection(peer.socketId, peer.username || 'Participant');

        if (!localMediaReadyRef.current) {
          // Queue the offer — will be sent from startLocalMedia once stream is ready
          console.log(`[WebRTC] Media not ready yet — deferring offer to ${peer.socketId}`);
          pendingOffersRef.current.push({ socketId: peer.socketId, username: peer.username || 'Participant' });
          continue;
        }

        try {
          makingOfferRef.current.set(peer.socketId, true);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc:offer', {
            targetSocketId: peer.socketId,
            offer: pc.localDescription
          });
          console.log(`[WebRTC] → Offer sent to ${peer.socketId}`);
        } catch (e) {
          console.error('[WebRTC] Error creating offer:', e);
        } finally {
          makingOfferRef.current.set(peer.socketId, false);
        }
      }
    };

    // ── B. Existing peer in room: a new peer just joined ──
    const onPeerJoined = (payload: { socketId: string; userId: string; username: string }) => {
      console.log('[WebRTC] peer-joined:', payload);
      if (payload.socketId === socket.id) return; // skip self
      socketIdToPeerInfoRef.current.set(payload.socketId, { userId: payload.userId, username: payload.username });
      createPeerConnection(payload.socketId, payload.username || 'Participant');
    };

    // ── C. Receive an offer ──
    const onOffer = async (payload: { offer: RTCSessionDescriptionInit; senderSocketId: string; senderUsername: string }) => {
      console.log(`[WebRTC] ← Offer from ${payload.senderSocketId}`);
      if (payload.senderSocketId === socket.id) return;

      const pc = createPeerConnection(payload.senderSocketId, payload.senderUsername || 'Participant');
      const isOffer = payload.offer.type === 'offer';
      const offerCollision = isOffer && (
        makingOfferRef.current.get(payload.senderSocketId) === true ||
        pc.signalingState !== 'stable'
      );

      // Polite peer: socket with lexicographically LARGER id yields (rolls back)
      const isPolite = (socket.id || '') > payload.senderSocketId;

      if (offerCollision) {
        if (!isPolite) {
          console.log('[WebRTC] Glare: impolite peer drops incoming offer');
          return;
        }
        console.log('[WebRTC] Glare: polite peer rolling back');
        try {
          await pc.setLocalDescription({ type: 'rollback' });
        } catch (e) {
          console.warn('[WebRTC] Rollback failed (ok in some browsers):', e);
        }
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        await processQueuedCandidates(payload.senderSocketId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', {
          targetSocketId: payload.senderSocketId,
          answer: pc.localDescription
        });
        console.log(`[WebRTC] → Answer sent to ${payload.senderSocketId}`);
      } catch (e) {
        console.error('[WebRTC] Error handling offer:', e);
      }
    };

    // ── D. Receive an answer ──
    const onAnswer = async (payload: { answer: RTCSessionDescriptionInit; senderSocketId: string }) => {
      console.log(`[WebRTC] ← Answer from ${payload.senderSocketId}`);
      const pc = peerConnectionsRef.current.get(payload.senderSocketId);
      if (!pc) {
        console.warn('[WebRTC] No PC found for answer sender:', payload.senderSocketId);
        return;
      }
      if (pc.signalingState === 'stable') {
        console.warn('[WebRTC] Received answer but already stable — ignoring');
        return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
        await processQueuedCandidates(payload.senderSocketId, pc);
        console.log(`[WebRTC] ✓ Connection established with ${payload.senderSocketId}`);
      } catch (e) {
        console.error('[WebRTC] Error setting answer:', e);
      }
    };

    // ── E. Receive ICE candidate ──
    const onIceCandidate = async (payload: { candidate: RTCIceCandidateInit; senderSocketId: string }) => {
      if (!payload.candidate) return;
      const pc = peerConnectionsRef.current.get(payload.senderSocketId);

      if (!pc || !pc.remoteDescription?.type) {
        // Queue until we have remote description
        const queue = iceCandidateQueuesRef.current.get(payload.senderSocketId) || [];
        queue.push(payload.candidate);
        iceCandidateQueuesRef.current.set(payload.senderSocketId, queue);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (e) {
        console.warn('[WebRTC] addIceCandidate error:', e);
      }
    };

    // ── F. Peer left ──
    const onUserLeft = (payload: { userId: string; username: string; socketId?: string }) => {
      console.log('[WebRTC] User left:', payload);
      setRemotePeers(prev => {
        const updated = new Map(prev);
        for (const [sid, peer] of updated.entries()) {
          if (sid === payload.socketId || peer.userId === payload.userId) {
            unregisterRemoteVoiceTrack(sid);
            const pc = peerConnectionsRef.current.get(sid);
            if (pc) {
              try { pc.close(); } catch (_) {}
              peerConnectionsRef.current.delete(sid);
            }
            iceCandidateQueuesRef.current.delete(sid);
            updated.delete(sid);
          }
        }
        return updated;
      });
    };

    socket.on('webrtc:peer-list', onPeerList);
    socket.on('webrtc:peer-joined', onPeerJoined);
    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice-candidate', onIceCandidate);
    socket.on('room:user-left', onUserLeft);

    return () => {
      socket.off('webrtc:peer-list', onPeerList);
      socket.off('webrtc:peer-joined', onPeerJoined);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onIceCandidate);
      socket.off('room:user-left', onUserLeft);
    };
  }, [socket, createPeerConnection, processQueuedCandidates, unregisterRemoteVoiceTrack]);

  // ─────────────────────────────────────────────────────────────
  // Media controls (Real-time WebRTC track enable/disable & signaling broadcast)
  // ─────────────────────────────────────────────────────────────

  const toggleMic = async () => {
    const newMicState = !micOn;

    // If enabling mic and we don't have a real audio track yet or permission was needed
    if (newMicState && localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length === 0 || audioTracks[0].label.includes('Virtual') || audioTracks[0].label.includes('Silent')) {
        try {
          let realStream;
          try {
            realStream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
            });
          } catch (firstErr) {
            console.warn('[Media] Ideal audio constraints failed, trying basic audio:true...', firstErr);
            realStream = await navigator.mediaDevices.getUserMedia({
              audio: true
            });
          }
          const realTrack = realStream.getAudioTracks()[0];
          if (realTrack) {
            localStreamRef.current.removeTrack(audioTracks[0]);
            localStreamRef.current.addTrack(realTrack);
            peerConnectionsRef.current.forEach(pc => {
              pc.getSenders().forEach(s => {
                if (s.track?.kind === 'audio' && !Array.from(screenShareSendersRef.current.values()).some(list => list.includes(s))) {
                  s.replaceTrack(realTrack).catch(() => {});
                }
              });
            });
            processLocalMicTrack(realTrack).catch(() => {});
          }
        } catch (e) {
          console.warn('[Media] Failed to get microphone device:', e);
          alert('Microphone Access Notice:\nPlease allow microphone access in your browser settings to speak.');
          return;
        }
      }
    }

    setMicOn(newMicState);

    // 1. Mute/unmute all local audio tracks
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = newMicState;
      });
    }

    // 2. Mute/unmute all active WebRTC audio senders across all peer connections
    peerConnectionsRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'audio') {
          // Do not mute screenshare senders if screen sharing is active
          const isScreenSender = Array.from(screenShareSendersRef.current.values()).some(list => list.includes(sender));
          if (!isScreenSender) {
            sender.track.enabled = newMicState;
          }
        }
      });
    });

    // 3. Broadcast updated media state to all peers
    updateMyMediaState({ microphoneEnabled: newMicState });

    // 4. If turning mic OFF, immediately cancel speaking state everywhere
    if (!newMicState) {
      isSpeakingRef.current = false;
      setIsLocalSpeaking(false);
      sendSpeakingState(false);
    }

    console.log(`[Media] Microphone toggled: ${newMicState ? 'UNMUTED 🎙️ (GREEN)' : 'MUTED 🔇 (RED)'}`);
  };

  const toggleCam = async () => {
    const newCamState = !camOn;

    // If enabling camera and we need to acquire a real camera track
    if (newCamState && localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length === 0 || videoTracks[0].label.includes('Virtual') || videoTracks[0].label.includes('canvas')) {
        try {
          let realStream;
          try {
            realStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
          } catch (firstErr) {
            console.warn('[Media] Ideal camera constraints failed, trying basic video:true...', firstErr);
            realStream = await navigator.mediaDevices.getUserMedia({
              video: true
            });
          }
          const realTrack = realStream.getVideoTracks()[0];
          if (realTrack) {
            localStreamRef.current.removeTrack(videoTracks[0]);
            localStreamRef.current.addTrack(realTrack);
            peerConnectionsRef.current.forEach(pc => {
              pc.getSenders().forEach(s => {
                if (s.track?.kind === 'video' && !Array.from(screenShareSendersRef.current.values()).some(list => list.includes(s))) {
                  s.replaceTrack(realTrack).catch(() => {});
                }
              });
            });
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = localStreamRef.current;
            }
          }
        } catch (e) {
          console.warn('[Media] Failed to get camera device:', e);
          alert('Camera Access Notice:\nPlease allow camera access in your browser settings to share your video.');
          return;
        }
      }
    }

    setCamOn(newCamState);

    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = newCamState;
      });
    }

    peerConnectionsRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === 'video') {
          const isScreenSender = Array.from(screenShareSendersRef.current.values()).some(list => list.includes(sender));
          if (!isScreenSender) {
            sender.track.enabled = newCamState;
          }
        }
      });
    });

    // Broadcast updated camera state to all peers
    updateMyMediaState({ cameraEnabled: newCamState });

    console.log(`[Media] Camera toggled: ${newCamState ? 'ON 📷' : 'OFF 🚫'}`);
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStream?.getTracks().forEach(t => t.stop());
      // Remove screen share senders from all active peer connections
      peerConnectionsRef.current.forEach((pc, sid) => {
        const senders = screenShareSendersRef.current.get(sid) || [];
        senders.forEach(s => {
          try { pc.removeTrack(s); } catch (_) {}
        });
        screenShareSendersRef.current.delete(sid);
      });
      setScreenStream(null);
      setIsScreenSharing(false);
      updateMyMediaState({ screenSharing: false });
      await renegotiateAllPeers();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      setScreenStream(stream);
      setIsScreenSharing(true);
      updateMyMediaState({ screenSharing: true });

      // Add screen share tracks to all active peer connections so the partner receives them
      peerConnectionsRef.current.forEach((pc, sid) => {
        const addedSenders: RTCRtpSender[] = [];
        stream.getTracks().forEach(track => {
          try {
            const sender = pc.addTrack(track, stream);
            addedSenders.push(sender);
            console.log(`[WebRTC] Added screen share ${track.kind} track to peer ${sid}`);
          } catch (e) {
            console.warn('[WebRTC] Error adding screen share track to PC:', e);
          }
        });
        screenShareSendersRef.current.set(sid, addedSenders);
      });

      // Send renegotiation offer to partner so they receive the new stream
      await renegotiateAllPeers();

      // Check if user shared audio
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log('[Media] Screen share captured with system/tab audio successfully!');
      } else {
        alert('Notice: No audio track detected from screen share.\n\nTip: In the Chrome screen share popup, make sure to select "Chrome Tab" (Spotify tab) and check the "Also share tab audio" checkbox at the bottom left!');
      }

      // Handle user clicking native browser "Stop sharing" bar
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = async () => {
          console.log('[Media] Screen sharing stopped by user');
          stream.getTracks().forEach(t => t.stop());
          peerConnectionsRef.current.forEach((pc, sid) => {
            const senders = screenShareSendersRef.current.get(sid) || [];
            senders.forEach(s => {
              try { pc.removeTrack(s); } catch (_) {}
            });
            screenShareSendersRef.current.delete(sid);
          });
          setScreenStream(null);
          setIsScreenSharing(false);
          await renegotiateAllPeers();
        };
      }
    } catch (e) {
      console.warn('[Media] Screen share cancelled or error:', e);
    }
  };

  const handleLeaveCall = () => {
    cleanupAll();
    onLeave();
  };

  const handleTriggerReaction = (emoji: string) => {
    sendReaction(emoji);
    setShowReactionMenu(false);
  };

  // ─────────────────────────────────────────────────────────────
  // Mock speech (solo testing utility)
  // ─────────────────────────────────────────────────────────────

  const stopMockSpeech = () => {
    if (mockOscillatorRef.current) {
      try {
        mockOscillatorRef.current.stop();
        mockOscillatorRef.current.disconnect();
        mockOscillatorGainRef.current?.disconnect();
      } catch (_) {}
      mockOscillatorRef.current = null;
      mockOscillatorGainRef.current = null;
    }
    setMockSpeakingUser(null);
  };

  const toggleMockSpeech = (mockUsername: string) => {
    if (mockSpeakingUser === mockUsername) { stopMockSpeech(); return; }
    stopMockSpeech();
    const ctx = (window as any).audioContextInstance || audioContext;
    const analyser = (window as any).voiceAnalyserInstance;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      osc.connect(gain);
      if (analyser) gain.connect(analyser);
      else { gain.gain.setValueAtTime(0.001, ctx.currentTime); gain.connect(ctx.destination); }
      osc.start();
      mockOscillatorRef.current = osc;
      mockOscillatorGainRef.current = gain;
      setMockSpeakingUser(mockUsername);
    } catch (err) {
      console.error('[Mock] Speech error:', err);
    }
  };

  // Responsive layout detection
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const remotePeerList = Array.from(remotePeers.values());
  const totalParticipants = Math.max(remotePeerList.length + 1, participants.length);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  // Standard Track Playlist for Skip Next / Prev
  const standardPlaylist = [
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
    }
  ];

  const handleSkipNext = () => {
    const currentIndex = standardPlaylist.findIndex(t => t.id === musicState.currentTrackId);
    const nextIndex = (currentIndex + 1) % standardPlaylist.length;
    const nextTrack = standardPlaylist[nextIndex];
    if (nextTrack) {
      sendMusicAction('change', nextTrack.id, 0, nextTrack);
    }
  };

  const handleSkipPrev = () => {
    const currentIndex = standardPlaylist.findIndex(t => t.id === musicState.currentTrackId);
    const prevIndex = (currentIndex - 1 + standardPlaylist.length) % standardPlaylist.length;
    const prevTrack = standardPlaylist[prevIndex];
    if (prevTrack) {
      sendMusicAction('change', prevTrack.id, 0, prevTrack);
    }
  };

  return (
    <div className={`flex flex-col h-[100dvh] overflow-hidden font-sans select-none relative ${isLight ? 'bg-white text-black' : 'bg-black text-white'}`}>
      {/* Dynamic Apple Music Fluid Ambient Mesh Gradient */}
      <div 
        className="absolute inset-0 z-0 transition-all duration-[2000ms] ease-in-out pointer-events-none opacity-90"
        style={{
          background: songPalette
            ? isLight
              ? `radial-gradient(circle at 15% 25%, ${songPalette.primary}, transparent 55%), radial-gradient(circle at 85% 75%, ${songPalette.secondary}, transparent 55%), radial-gradient(circle at 50% 50%, ${songPalette.lightMuted}, transparent 80%)`
              : `radial-gradient(circle at 15% 25%, ${songPalette.primary}, transparent 65%), radial-gradient(circle at 85% 75%, ${songPalette.secondary}, transparent 65%), radial-gradient(circle at 50% 50%, ${songPalette.darkMuted}, transparent 85%)`
            : undefined
        }}
      />
      {/* Dynamic Ambient Blur Texture Layer */}
      {musicState.currentTrack?.thumbnail && (
        <div 
          className={`absolute inset-0 z-0 bg-cover bg-center transition-all duration-[2000ms] ease-in-out ${isLight ? 'opacity-70 mix-blend-multiply' : 'opacity-60 mix-blend-screen'}`}
          style={{ 
            backgroundImage: `url(${musicState.currentTrack.thumbnail})`,
            filter: isLight ? 'blur(120px) saturate(160%) brightness(1.1)' : 'blur(120px) saturate(140%) brightness(0.7)',
            transform: 'scale(1.15)'
          }} 
        />
      )}
      <div className={`absolute inset-0 z-0 pointer-events-none ${isLight ? 'bg-white/30' : 'bg-gradient-to-b from-black/40 to-black/80'}`} />

      {/* Top Navigation Bar */}
      <div className={`h-12 md:h-14 border-b backdrop-blur-xl px-3 md:px-6 flex justify-between items-center z-20 flex-shrink-0 relative ${isLight ? 'bg-white/40 border-black/5' : 'bg-black/20 border-white/5'}`}>
        <div className="flex items-center gap-2 md:gap-3">
          <span className={`font-medium text-xs md:text-sm tracking-wide font-sans ${isLight ? 'text-black/90' : 'text-white/90'}`}>
            Room {roomId}
          </span>
          <button
            onClick={() => {
              const url = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
              navigator.clipboard.writeText(url);
              alert(`Room Link Copied!\n\nShare this with your partner:\n${url}`);
            }}
            className={`px-2.5 py-1 rounded-md text-[10px] md:text-xs flex items-center gap-1.5 transition-all active:scale-95 ${isLight ? 'bg-black/5 hover:bg-black/10 text-black/70 hover:text-black' : 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white'}`}
          >
            <Copy size={11} />
            <span>Copy</span>
          </button>
          
          {isConnected ? (
            <span className={`text-[9px] md:text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1.5 font-medium ${isLight ? 'text-black/60' : 'text-white/60'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isLight ? 'bg-emerald-500' : 'bg-emerald-400'}`} />
              Live
            </span>
          ) : (
            <span className={`text-[9px] md:text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1.5 font-medium ${isLight ? 'text-black/60' : 'text-white/60'}`}>
              <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${isLight ? 'bg-amber-500' : 'bg-amber-400'}`} />
              Connecting...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`p-1.5 rounded-full transition-all active:scale-90 ${isLight ? 'bg-black/5 hover:bg-black/10 text-black/70 hover:text-black' : 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white'}`}
            title="Toggle Theme"
          >
            {isLight ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <div className={`flex items-center gap-1.5 text-[11px] md:text-xs px-2.5 py-0.5 md:py-1 rounded-full border ${isLight ? 'bg-black/5 border-black/10 text-black/70' : 'bg-white/5 border-white/10 text-white/70'}`}>
            <Users size={13} className={totalParticipants > 1 ? (isLight ? "text-emerald-600" : "text-emerald-400") : (isLight ? "text-zinc-500" : "text-zinc-400")} />
            <span className={totalParticipants > 1 ? (isLight ? "text-black font-semibold" : "text-white font-semibold") : (isLight ? "text-black/60" : "text-white/60")}>
              {totalParticipants}
            </span>
          </div>
        </div>
      </div>

      {!isConnected && (
        <div className="bg-amber-950/80 border-b border-amber-500/30 text-amber-200 text-[11px] px-4 py-1 flex items-center justify-between">
          <span>⏳ Connecting to signaling server...</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Permanent hidden music audio element */}
        <audio ref={musicAudioRef} playsInline preload="auto" className="hidden" />

        {autoplayBlocked && (
          <button
            onClick={() => {
              if (musicAudioRef.current) {
                musicAudioRef.current.play().then(() => setAutoplayBlocked(false)).catch(() => {});
              }
              if (ytPlayerRef.current && ytPlayerReadyRef.current) {
                try { ytPlayerRef.current.playVideo(); } catch (_) {}
              }
            }}
            className="absolute top-2 left-1/2 -translate-x-1/2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-[11px] md:text-xs px-4 py-2 rounded-full font-bold shadow-xl z-50 animate-bounce flex items-center gap-2 border border-fuchsia-400"
          >
            <Music size={14} />
            <span>Tap to Enable Shared Sound 🔊</span>
          </button>
        )}

        <div className="flex-1 flex flex-col relative justify-between bg-transparent p-2 md:p-6 overflow-hidden">
          <ReactionOverlay />

          {/* Video Grid (Optimized for iPhone / Mobile vertical stack & Desktop horizontal grid) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 w-full max-w-5xl mx-auto items-center justify-center p-1 md:p-2 overflow-y-auto min-h-0">

            {/* Local Video Tile */}
            {(() => {
              const isLocalSpeakingActive = isLocalSpeaking && micOn;
              return (
                <div
                  className={`backdrop-blur-3xl w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-[32px] overflow-hidden border relative shadow-lg flex items-center justify-center transition-all duration-300 ${
                    isLocalSpeakingActive
                      ? 'ring-2 ring-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.45)] border-emerald-400'
                      : isLight ? 'bg-white/30 border-white/40' : 'bg-white/5 border-white/5'
                  }`}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${camOn ? 'opacity-100' : 'opacity-0 hidden'}`}
                  />
                  {!camOn && (
                    <div className="text-center space-y-2 select-none">
                      <div className="h-14 w-14 md:h-18 md:w-18 bg-gradient-to-br from-fuchsia-600 to-indigo-600 rounded-full flex items-center justify-center mx-auto border border-white/20 text-white font-bold text-xl shadow-lg">
                        {username.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[11px] md:text-xs text-white/70 font-semibold">{username} (You)</span>
                        <span className="text-[10px] text-white/40 flex items-center gap-1 bg-black/40 px-2.5 py-0.5 rounded-full border border-white/5">
                          <VideoOff size={10} /> Camera Off
                        </span>
                      </div>
                    </div>
                  )}
                  <span className={`absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border backdrop-blur-sm flex items-center gap-1.5 z-20 ${isLight ? 'bg-white/80 text-black border-black/10' : 'bg-black/60 text-white border-white/10'}`}>
                    <span className={`h-2 w-2 rounded-full ${micOn ? (isLocalSpeakingActive ? 'bg-emerald-400 animate-ping' : 'bg-emerald-500') : 'bg-red-500'}`} />
                    <span>{username} (You)</span>
                    <span className={`text-[9px] px-1.5 py-0.2 rounded-md font-bold uppercase ${
                      micOn
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-red-500/20 text-red-300 border border-red-500/30'
                    }`}>
                      {micOn ? (isLocalSpeakingActive ? '🔊 Speaking' : 'Mic ON') : 'Mic OFF'}
                    </span>
                    {isHost && <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded-full font-bold">👑 Host</span>}
                  </span>
                </div>
              );
            })()}

            {/* Screen Share Tile */}
            {isScreenSharing && (
              <div className={`backdrop-blur-3xl w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-[32px] overflow-hidden border relative shadow-lg flex items-center justify-center transition-all duration-500 ${isLight ? 'bg-emerald-50/50 border-emerald-500/30' : 'bg-white/5 border-emerald-500/20'}`}>
                <video
                  ref={(el) => { if (el && screenStream) el.srcObject = screenStream; }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
                <span className={`absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border backdrop-blur-sm flex items-center gap-1.5 ${isLight ? 'bg-emerald-100/90 text-emerald-800 border-emerald-500/30' : 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30'}`}>
                  <Tv size={12} /> Your Screen Share
                </span>
              </div>
            )}

            {/* Remote Peer Videos & Remote Screen Shares */}
            {remotePeerList.flatMap(peer => {
              const videoTracks = peer.stream.getVideoTracks();
              const peerMedia = participantMediaStates[peer.userId] || { cameraEnabled: false, microphoneEnabled: false, speaking: false };
              const isPeerSpeaking = peerMedia.speaking && peerMedia.microphoneEnabled;
              const glowClass = isPeerSpeaking
                ? 'ring-2 ring-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.45)] border-emerald-400'
                : (isLight ? 'bg-white/30 border-white/40' : 'bg-white/5 border-white/5');

              if (videoTracks.length <= 1) {
                return [
                  <div key={peer.socketId} className={`backdrop-blur-3xl w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-[32px] overflow-hidden border relative shadow-lg flex items-center justify-center transition-all duration-300 ${glowClass}`}>
                    <RemoteVideoPlayer
                      stream={peer.stream}
                      username={peer.username}
                      cameraEnabled={peerMedia.cameraEnabled}
                    />
                    <span className={`absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border backdrop-blur-sm flex items-center gap-1.5 z-20 ${isLight ? 'bg-white/80 text-black border-black/10' : 'bg-black/60 text-white border-white/10'}`}>
                      <span className={`h-2 w-2 rounded-full ${peerMedia.microphoneEnabled ? (isPeerSpeaking ? 'bg-emerald-400 animate-ping' : 'bg-emerald-500') : 'bg-red-500'}`} />
                      <span>{peer.username}</span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded-md font-bold uppercase ${
                        peerMedia.microphoneEnabled
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-red-500/20 text-red-300 border border-red-500/30'
                      }`}>
                        {peerMedia.microphoneEnabled ? (isPeerSpeaking ? '🔊 Speaking' : 'Mic ON') : 'Mic OFF'}
                      </span>
                      {hostId === peer.userId && <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded-full font-bold">👑 Host</span>}
                    </span>
                  </div>
                ];
              }
              return videoTracks.map((track, idx) => {
                const singleStream = new MediaStream([track, ...peer.stream.getAudioTracks()]);
                const isScreen = idx > 0;
                return (
                  <div key={`${peer.socketId}_${track.id}`} className={`backdrop-blur-3xl w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-[32px] overflow-hidden relative shadow-lg flex items-center justify-center transition-all duration-300 ${isScreen ? (isLight ? 'bg-emerald-50/50 border border-emerald-500/30' : 'bg-white/5 border border-emerald-500/20') : glowClass}`}>
                    <RemoteVideoPlayer
                      stream={singleStream}
                      username={peer.username}
                      cameraEnabled={isScreen ? true : peerMedia.cameraEnabled}
                    />
                    <span className={`absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border backdrop-blur-sm flex items-center gap-1.5 z-20 ${isScreen ? (isLight ? 'bg-emerald-100/90 text-emerald-800 border-emerald-500/30' : 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30') : (isLight ? 'bg-white/80 text-black border-black/10' : 'bg-black/60 text-white border-white/10')}`}>
                      {isScreen ? <Tv size={12} /> : <span className={`h-2 w-2 rounded-full ${peerMedia.microphoneEnabled ? (isPeerSpeaking ? 'bg-emerald-400 animate-ping' : 'bg-emerald-500') : 'bg-red-500'}`} />}
                      {peer.username} {isScreen ? "'s Screen" : ''}
                      {!isScreen && (
                        <span className={`text-[9px] px-1.5 py-0.2 rounded-md font-bold uppercase ${
                          peerMedia.microphoneEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-red-500/20 text-red-300 border border-red-500/30'
                        }`}>
                          {peerMedia.microphoneEnabled ? (isPeerSpeaking ? '🔊 Speaking' : 'Mic ON') : 'Mic OFF'}
                        </span>
                      )}
                    </span>
                  </div>
                );
              });
            })}

            {/* Waiting placeholder (only when no remote peers) */}
            {remotePeerList.length === 0 && (
              <div className={`backdrop-blur-3xl w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-[32px] overflow-hidden border relative shadow-lg flex items-center justify-center transition-all duration-500 ${isLight ? 'bg-white/30 border-white/40' : 'bg-white/5 border-white/5'}`}>
                <div className="text-center space-y-2 md:space-y-3">
                  <div className="h-12 w-12 md:h-16 md:w-16 rounded-full flex items-center justify-center mx-auto border bg-white/5 border-white/10">
                    <span className="text-base md:text-lg font-bold text-white/70">P</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] md:text-xs text-white/60">Partner (Waiting to join...)</span>
                  </div>
                </div>
                <span className="absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold bg-black/60 px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border border-white/10 backdrop-blur-sm">
                  Waiting for Partner...
                </span>
              </div>
            )}
          </div>

          {/* Emoji Reaction Menu */}
          {showReactionMenu && (
            <div className="absolute bottom-20 md:bottom-24 left-1/2 -translate-x-1/2 bg-[#18181b]/95 border border-white/10 backdrop-blur-md py-2 px-3 md:py-2.5 md:px-4 rounded-2xl flex gap-2 md:gap-3 shadow-2xl z-50">
              {['❤️', '😂', '👍', '😮', '👏', '🔥'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleTriggerReaction(emoji)}
                  className="text-xl md:text-2xl hover:scale-125 transition-transform active:scale-95 duration-200"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Permanent YouTube Synchronized Player Container (Always Mounted in DOM) */}
          <div
            className={`transition-all duration-300 rounded-[32px] overflow-hidden shadow-2xl border border-white/10 bg-black/20 backdrop-blur-3xl ${
              musicState.currentTrack && isYouTubeUrl(musicState.currentTrack.url)
                ? isPlayerExpanded
                  ? 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-4xl aspect-video block shadow-[0_0_60px_rgba(0,0,0,0.95)]'
                  : showYtVideo
                    ? 'absolute bottom-20 md:bottom-24 right-3 md:right-6 z-30 w-64 sm:w-80 md:w-96 aspect-video block'
                    : 'absolute -top-[9999px] -left-[9999px] w-1 h-1 opacity-0 pointer-events-none'
                : 'absolute -top-[9999px] -left-[9999px] w-1 h-1 opacity-0 pointer-events-none'
            }`}
          >
            <div id="youtube-sync-player" className="w-full h-full" />
            <button
              onClick={() => setShowYtVideo(!showYtVideo)}
              className="absolute top-1.5 right-1.5 md:top-2 md:right-2 bg-black/80 hover:bg-black text-white/80 hover:text-white p-1 rounded-full text-xs z-40 backdrop-blur-sm border border-white/10"
              title={showYtVideo ? "Hide Media Player" : "Show Media Player"}
            >
              {showYtVideo ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button
              onClick={() => setIsPlayerExpanded(!isPlayerExpanded)}
              className="absolute top-1.5 right-8 md:top-2 md:right-9 bg-black/80 hover:bg-black text-white/80 hover:text-white p-1 rounded-full text-xs z-40 backdrop-blur-sm border border-white/10"
              title={isPlayerExpanded ? "Minimize View" : "Expand Center Stage"}
            >
              {isPlayerExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>

          {/* Multi-Platform Web Widget Overlay (Spotify, Monochrome, SoundCloud) */}
          {musicState.currentTrack && !isYouTubeUrl(musicState.currentTrack.url) && (
            <div
              className={`absolute bottom-20 md:bottom-24 right-3 md:right-6 z-30 transition-all duration-300 rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-[#121212] ${
                showYtVideo && !isPlayerExpanded
                  ? 'w-72 sm:w-88 md:w-96 h-64 sm:h-72 block'
                  : 'w-1 h-1 opacity-0 pointer-events-none'
              }`}
            >
              {/* Spotify Embed Widget */}
              {extractSpotifyInfo(musicState.currentTrack.url) && (
                <iframe
                  src={extractSpotifyInfo(musicState.currentTrack.url)?.embedUrl}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  className="w-full h-full rounded-2xl"
                />
              )}

              {/* SoundCloud Embed Widget */}
              {extractSoundCloudInfo(musicState.currentTrack.url) && (
                <iframe
                  src={extractSoundCloudInfo(musicState.currentTrack.url)?.embedUrl}
                  width="100%"
                  height="100%"
                  scrolling="no"
                  frameBorder="no"
                  allow="autoplay"
                  className="w-full h-full rounded-2xl"
                />
              )}

              {/* Expand to Theater Mode Button */}
              <button
                onClick={() => setIsPlayerExpanded(true)}
                className="absolute top-1.5 right-8 md:top-2 md:right-9 bg-black/80 hover:bg-black text-white/80 hover:text-white p-1 rounded-full text-xs z-40 backdrop-blur-sm border border-white/10"
                title="Expand Center Stage View"
              >
                <Maximize2 size={13} />
              </button>

              <button
                onClick={() => setShowYtVideo(!showYtVideo)}
                className="absolute top-1.5 right-1.5 md:top-2 md:right-2 bg-black/80 hover:bg-black text-white/80 hover:text-white p-1 rounded-full text-xs z-40 backdrop-blur-sm border border-white/10"
                title={showYtVideo ? "Hide Media Player" : "Show Media Player"}
              >
                {showYtVideo ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          )}

          {/* Full Center-Stage Apple Music Blurred Theater View */}
          {isPlayerExpanded && musicState.currentTrack && (
            <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-3xl flex items-center justify-center p-2 sm:p-6 animate-fade-in select-none">
              {/* Dynamic Apple Music Fluid Ambient Mesh Background Layer */}
              <div 
                className="absolute inset-0 z-0 pointer-events-none opacity-60 transition-all duration-1000"
                style={{
                  background: songPalette
                    ? `radial-gradient(circle at 20% 30%, ${songPalette.primary}, transparent 60%), radial-gradient(circle at 80% 70%, ${songPalette.secondary}, transparent 60%), radial-gradient(circle at 50% 50%, ${songPalette.darkMuted}, transparent 80%)`
                    : undefined
                }}
              />
              {musicState.currentTrack?.thumbnail && (
                <div 
                  className="absolute inset-0 z-0 bg-cover bg-center pointer-events-none opacity-40 mix-blend-screen transition-all duration-1000"
                  style={{ 
                    backgroundImage: `url(${musicState.currentTrack.thumbnail})`,
                    filter: 'blur(100px) saturate(160%) brightness(0.8)',
                    transform: 'scale(1.2)'
                  }} 
                />
              )}

              {/* Main Card Container */}
              <div className="bg-black/40 border border-white/15 rounded-[36px] w-full max-w-5xl h-[90vh] max-h-[850px] shadow-[0_16px_48px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden relative backdrop-blur-2xl z-10">
                
                {/* ── HEADER WITH INTEGRATED APPLE SEARCH BAR ── */}
                <div className="p-3.5 sm:p-4 border-b border-white/10 bg-white/5 flex items-center justify-between gap-3 relative z-30">
                  {/* Left: Track Status Pill */}
                  <div className="flex items-center gap-2.5 min-w-0 max-w-[200px] sm:max-w-xs">
                    <span className="h-2.5 w-2.5 rounded-full bg-fuchsia-400 animate-pulse flex-shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs sm:text-sm font-bold text-white truncate">
                        {musicState.currentTrack.title}
                      </span>
                      <span className="text-[10px] sm:text-xs text-fuchsia-300/80 truncate">
                        {musicState.currentTrack.artist}
                      </span>
                    </div>
                  </div>

                  {/* Center: Integrated Extended Search Bar */}
                  <div className="flex-1 max-w-md relative">
                    <form onSubmit={handleExpandedSearchSubmit} className="relative w-full">
                      <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
                      <input
                        type="text"
                        value={expandedSearchQuery}
                        onFocus={() => setShowExpandedSearchPopup(true)}
                        onChange={(e) => {
                          setExpandedSearchQuery(e.target.value);
                          setShowExpandedSearchPopup(true);
                        }}
                        placeholder="Search YouTube or paste song link..."
                        className="w-full bg-white/10 hover:bg-white/15 focus:bg-black/60 border border-white/15 focus:border-fuchsia-400/80 rounded-full pl-9 pr-8 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none transition-all shadow-inner backdrop-blur-md"
                      />
                      {expandedSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedSearchQuery('');
                            setExpandedSearchResults([]);
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white p-0.5"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </form>

                    {/* ── FROSTED GLASS SEARCH & SUGGESTIONS POPUP ── */}
                    {showExpandedSearchPopup && (
                      <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-black/85 backdrop-blur-3xl border border-white/20 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden max-h-80 flex flex-col animate-fade-in divide-y divide-white/10">
                        {/* Quick Trending Suggestion Chips */}
                        <div className="p-2.5 bg-white/5 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-white/50 px-1">
                            <span>🔥 Instant Mood / Trending</span>
                            <button
                              type="button"
                              onClick={() => setShowExpandedSearchPopup(false)}
                              className="text-white/40 hover:text-white text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
                            {[
                              { label: '🔥 Trending', query: 'Top Global Hits 2024' },
                              { label: '🌙 Lo-Fi', query: 'Lofi Hip Hop chill study' },
                              { label: '✨ Pop Hits', query: 'Top Pop Music' },
                              { label: '🎧 Hip-Hop', query: 'Hip Hop Rap Hits' },
                              { label: '🕺 Bollywood', query: 'Bollywood Top Hits' },
                              { label: '☕ Chill', query: 'Acoustic Chill Vibes' },
                              { label: '⚡ EDM', query: 'EDM Party Festival' }
                            ].map((chip) => (
                              <button
                                key={chip.label}
                                type="button"
                                onClick={() => setExpandedSearchQuery(chip.query)}
                                className="text-[10px] whitespace-nowrap px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-fuchsia-600 hover:text-white text-white/80 border border-white/10 transition-all active:scale-95 font-medium"
                              >
                                {chip.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Search Results List */}
                        <div className="overflow-y-auto max-h-56 divide-y divide-white/5">
                          {isExpandedSearching && (
                            <div className="p-4 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                              <Disc size={14} className="animate-spin text-fuchsia-400" />
                              <span>Searching YouTube live...</span>
                            </div>
                          )}

                          {!isExpandedSearching && expandedSearchResults.length > 0 && (
                            expandedSearchResults.map((result) => (
                              <div
                                key={result.id}
                                className="p-2 hover:bg-fuchsia-600/20 transition-all flex items-center gap-2.5 group"
                              >
                                {result.thumbnail ? (
                                  <img src={result.thumbnail} alt={result.title} className="w-10 h-10 rounded-lg object-cover border border-white/10 flex-shrink-0" />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-fuchsia-900/50 flex items-center justify-center flex-shrink-0">
                                    <Music size={15} className="text-fuchsia-300" />
                                  </div>
                                )}
                                <div
                                  onClick={() => {
                                    sendMusicAction('change', result.id, 0, result);
                                    setShowExpandedSearchPopup(false);
                                    setExpandedSearchQuery('');
                                  }}
                                  className="flex flex-col min-w-0 flex-1 cursor-pointer"
                                >
                                  <span className="text-xs font-semibold text-white group-hover:text-fuchsia-200 truncate">{result.title}</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-white/50 truncate max-w-[120px]">{result.artist}</span>
                                    {result.duration > 0 && (
                                      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-white/10 text-white/40">
                                        {Math.floor(result.duration / 60)}:{(result.duration % 60).toString().padStart(2, '0')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      sendMusicAction('queue-add', result.id, 0, result);
                                      alert(`Added "${result.title}" to Up Next! 🎶`);
                                    }}
                                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] transition-all"
                                    title="Add to Up Next Queue"
                                  >
                                    <Plus size={12} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      sendMusicAction('change', result.id, 0, result);
                                      setShowExpandedSearchPopup(false);
                                      setExpandedSearchQuery('');
                                    }}
                                    className="p-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-md transition-all active:scale-95"
                                    title="Play Now for Room"
                                  >
                                    <Play size={12} fill="white" />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}

                          {!isExpandedSearching && expandedSearchResults.length === 0 && expandedSearchQuery && (
                            <div className="p-4 text-center text-xs text-white/40">
                              Press Enter or click Play to search "{expandedSearchQuery}"
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Controls: Mode Switcher & Minimize */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Switch between Vinyl Visualizer and Live YouTube Video */}
                    {isYouTubeUrl(musicState.currentTrack.url) && (
                      <button
                        onClick={() => setExpandedViewMode(expandedViewMode === 'visualizer' ? 'video' : 'visualizer')}
                        className="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-xl text-xs transition-all active:scale-95 border border-white/15 flex items-center gap-1.5 font-semibold"
                        title={expandedViewMode === 'visualizer' ? "Switch to Live Video" : "Switch to Visualizer Lounge"}
                      >
                        {expandedViewMode === 'visualizer' ? <Tv size={13} /> : <Disc size={13} />}
                        <span className="hidden sm:inline">{expandedViewMode === 'visualizer' ? 'Watch Video' : 'Visualizer'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setActiveSidebar('lyrics');
                      }}
                      className="bg-fuchsia-600/30 hover:bg-fuchsia-600 text-fuchsia-200 hover:text-white px-2.5 py-1.5 rounded-xl text-xs transition-all active:scale-95 border border-fuchsia-400/30 flex items-center gap-1.5 font-semibold"
                      title="Open Synced Apple Lyrics"
                    >
                      <Mic2 size={13} />
                      <span className="hidden sm:inline">Lyrics</span>
                    </button>

                    <button
                      onClick={() => {
                        setIsPlayerExpanded(false);
                        setShowExpandedSearchPopup(false);
                      }}
                      className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl text-xs transition-all active:scale-95 border border-white/15"
                      title="Minimize Player"
                    >
                      <Minimize2 size={15} />
                    </button>
                  </div>
                </div>

                {/* ── CENTER STAGE DISPLAY AREA ── */}
                <div className="flex-1 relative flex items-center justify-center overflow-hidden p-4 sm:p-8">
                  {/* Visualizer Mode: Big Glowing Vinyl Album Art */}
                  {expandedViewMode === 'visualizer' && (
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12 max-w-4xl mx-auto w-full">
                      {/* Album Art with Vinyl Glow */}
                      <div className="relative group flex-shrink-0">
                        <div 
                          className="w-48 h-48 sm:w-72 sm:h-72 rounded-[32px] overflow-hidden border border-white/20 shadow-[0_20px_60px_rgba(0,0,0,0.6)] relative z-10 transition-transform duration-500 group-hover:scale-105"
                          style={{
                            boxShadow: songPalette ? `0 24px 70px ${songPalette.primary}40` : undefined
                          }}
                        >
                          {musicState.currentTrack.thumbnail ? (
                            <img
                              src={musicState.currentTrack.thumbnail}
                              alt={musicState.currentTrack.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-fuchsia-600 to-indigo-600 flex items-center justify-center text-white">
                              <Music size={64} />
                            </div>
                          )}
                        </div>

                        {/* Subtle Vinyl Record emerging from behind */}
                        <div className={`absolute top-2 -right-4 sm:-right-8 w-44 h-44 sm:w-68 sm:h-68 rounded-full bg-[#111] border-4 border-black shadow-2xl flex items-center justify-center z-0 transition-all duration-700 ${
                          musicState.isPlaying ? 'animate-spin' : ''
                        }`} style={{ animationDuration: '6s' }}>
                          <div className="w-16 h-16 rounded-full bg-fuchsia-600/40 border-2 border-white/20 flex items-center justify-center">
                            <div className="w-4 h-4 rounded-full bg-black" />
                          </div>
                        </div>
                      </div>

                      {/* Song Details & Apple Typography */}
                      <div className="flex flex-col items-center sm:items-start text-center sm:text-left space-y-2 min-w-0 max-w-md">
                        <span className="text-xs text-fuchsia-400 font-bold uppercase tracking-widest flex items-center gap-1.5 bg-fuchsia-500/10 px-3 py-1 rounded-full border border-fuchsia-500/20">
                          <Radio size={12} className="animate-pulse" />
                          Synchronized Room Audio
                        </span>
                        <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight line-clamp-2">
                          {musicState.currentTrack.title}
                        </h2>
                        <p className="text-base sm:text-lg text-fuchsia-200/80 font-medium line-clamp-1">
                          {musicState.currentTrack.artist}
                        </p>

                        {/* Animated Equalizer Wave Bars */}
                        <div className="flex items-center gap-1 pt-2">
                          {[40, 70, 90, 60, 100, 50, 80, 60, 95, 45, 75, 55].map((h, i) => (
                            <div
                              key={i}
                              className="w-1 bg-fuchsia-400 rounded-full transition-all duration-300"
                              style={{
                                height: musicState.isPlaying ? `${Math.max(6, (h * (0.4 + (i % 3) * 0.2)))}px` : '4px',
                                opacity: musicState.isPlaying ? 0.9 : 0.3
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Video Mode: Live YouTube Video Frame */}
                  {expandedViewMode === 'video' && isYouTubeUrl(musicState.currentTrack.url) && (
                    <div className="w-full h-full max-w-4xl max-h-[500px] rounded-3xl overflow-hidden border border-white/20 shadow-2xl bg-black flex items-center justify-center">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${extractYouTubeId(musicState.currentTrack.url)}?autoplay=1&enablejsapi=1&playsinline=1`}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  )}
                </div>

                {/* ── BOTTOM PLAYER CONTROLS DOCK ── */}
                <div className="p-4 sm:p-6 border-t border-white/10 bg-white/5 flex flex-col gap-3.5 backdrop-blur-xl relative z-20">
                  {/* Real-Time Synced Timeline Bar */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-white/70 font-mono w-10 text-right">
                      {Math.floor(songProgress.current / 60)}:{(Math.floor(songProgress.current % 60)).toString().padStart(2, '0')}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={songProgress.duration > 0 ? songProgress.duration : (musicState.currentTrack?.duration || 240)}
                      value={songProgress.current}
                      disabled={!isDjAuthorized}
                      onMouseDown={() => { if (isDjAuthorized) isSeekingRef.current = true; }}
                      onTouchStart={() => { if (isDjAuthorized) isSeekingRef.current = true; }}
                      onChange={(e) => { if (isDjAuthorized) setSongProgress(prev => ({ ...prev, current: parseFloat(e.target.value) })); }}
                      onMouseUp={(e) => { if (isDjAuthorized) handleSeek(parseFloat((e.target as HTMLInputElement).value)); }}
                      onTouchEnd={(e) => { if (isDjAuthorized) handleSeek(parseFloat((e.target as HTMLInputElement).value)); }}
                      className={`flex-1 accent-fuchsia-500 h-2 bg-white/20 rounded-lg transition-all ${isDjAuthorized ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                      title={isDjAuthorized ? "Scrub timeline (DJ Control)" : "Synced with Room DJ (Enter PIN to unlock)"}
                    />
                    <span className="text-xs text-white/70 font-mono w-10">
                      {Math.floor((songProgress.duration || musicState.currentTrack?.duration || 0) / 60)}:{(Math.floor((songProgress.duration || musicState.currentTrack?.duration || 0) % 60)).toString().padStart(2, '0')}
                    </span>
                  </div>

                  {/* Playback Control Buttons */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Skip Previous */}
                      <button
                        onClick={handleSkipPrev}
                        disabled={!isDjAuthorized}
                        className={`p-3 rounded-2xl text-xs transition-all border ${isDjAuthorized ? 'bg-white/10 hover:bg-white/20 text-white active:scale-90 border-white/15' : 'bg-white/5 text-white/30 border-white/5 cursor-not-allowed'}`}
                        title={isDjAuthorized ? "Previous Track" : "Only Host or PIN DJs can skip"}
                      >
                        <SkipBack size={18} />
                      </button>

                      {/* Main Play / Pause Button with Glow Ring */}
                      <button
                        onClick={() => {
                          if (!isDjAuthorized) {
                            alert('👑 Only the room creator (Host) or users with the 4-digit DJ PIN can control playback.');
                            return;
                          }
                          let currentPos = musicState.lastPosition || 0;
                          if (ytPlayerRef.current && ytPlayerReadyRef.current && ytPlayerRef.current.getCurrentTime) {
                            try { currentPos = ytPlayerRef.current.getCurrentTime(); } catch (_) {}
                          } else if (musicAudioRef.current) {
                            currentPos = musicAudioRef.current.currentTime;
                          }

                          if (musicState.isPlaying) {
                            sendMusicAction('pause', musicState.currentTrackId, currentPos, musicState.currentTrack);
                          } else {
                            sendMusicAction('play', musicState.currentTrackId, currentPos, musicState.currentTrack);
                          }
                        }}
                        className={`px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2.5 text-sm shadow-xl active:scale-95 ${
                          isDjAuthorized
                            ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-fuchsia-950/60 ring-2 ring-fuchsia-400/40'
                            : 'bg-white/10 text-white/50 cursor-not-allowed'
                        }`}
                      >
                        {musicState.isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                        <span>{musicState.isPlaying ? 'Pause' : 'Play'}</span>
                      </button>

                      {/* Skip Next */}
                      <button
                        onClick={handleSkipNext}
                        disabled={!isDjAuthorized}
                        className={`p-3 rounded-2xl text-xs transition-all border ${isDjAuthorized ? 'bg-white/10 hover:bg-white/20 text-white active:scale-90 border-white/15' : 'bg-white/5 text-white/30 border-white/5 cursor-not-allowed'}`}
                        title={isDjAuthorized ? "Next Track" : "Only Host or PIN DJs can skip"}
                      >
                        <SkipForward size={18} />
                      </button>
                    </div>

                    {/* Volume Slider & Library Browse */}
                    <div className="flex items-center gap-4">
                      <div className="hidden sm:flex items-center gap-2 bg-white/5 px-3 py-2 rounded-2xl border border-white/10">
                        <Volume2 size={15} className="text-white/60" />
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={musicVolume}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (musicAudioRef.current) musicAudioRef.current.volume = v;
                            if (ytPlayerRef.current && ytPlayerReadyRef.current) {
                              try { ytPlayerRef.current.setVolume(Math.round(v * 100)); } catch (_) {}
                            }
                          }}
                          className="w-20 accent-fuchsia-500 h-1.5 bg-white/20 rounded-lg cursor-pointer"
                        />
                      </div>

                      <button
                        onClick={() => {
                          setActiveSidebar('music');
                          setIsPlayerExpanded(false);
                        }}
                        className="text-xs text-fuchsia-300 hover:text-fuchsia-200 flex items-center gap-1.5 font-bold bg-white/10 hover:bg-white/20 px-4 py-2.5 rounded-2xl border border-white/15 transition-all active:scale-95"
                      >
                        <Music size={14} />
                        <span>Music Hub</span>
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Autoplay Recovery Banner for Mobile/Safari/Background Devices */}
          {autoplayBlocked && musicState.isPlaying && (
            <button
              onClick={() => {
                setAutoplayBlocked(false);
                if (audioContext && audioContext.state === 'suspended') {
                  audioContext.resume().catch(() => {});
                }
                if (ytPlayerRef.current && ytPlayerReadyRef.current) {
                  try { ytPlayerRef.current.playVideo(); } catch (_) {}
                }
                if (musicAudioRef.current) {
                  musicAudioRef.current.play().catch(() => {});
                }
              }}
              className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white text-xs font-bold px-4 py-2 rounded-2xl shadow-2xl border border-fuchsia-400 animate-bounce flex items-center gap-2"
            >
              <Play size={14} fill="white" />
              <span>Tap to Join Live Music in Sync</span>
            </button>
          )}

          {/* Global Synchronized Music Pill & Interactive Shared Seek Bar (when song is selected) */}
          {musicState.currentTrack && (
            <div className={`absolute top-2 right-2 md:top-4 md:right-6 z-30 border backdrop-blur-3xl px-4 py-3 rounded-[32px] shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-col gap-2 animate-fade-in w-64 sm:w-80 md:w-96 transition-all duration-500 ${isLight ? 'bg-white/80 border-white/40' : 'bg-black/30 border-white/10'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`h-2 w-2 rounded-full animate-pulse flex-shrink-0 ${isLight ? 'bg-fuchsia-500' : 'bg-fuchsia-400'}`} />
                  <div className="flex flex-col min-w-0">
                    <span className={`text-xs md:text-sm font-bold truncate ${isLight ? 'text-black' : 'text-white'}`}>
                      {musicState.currentTrack.title}
                    </span>
                    <span className={`text-[10px] truncate ${isLight ? 'text-fuchsia-800' : 'text-fuchsia-300/70'}`}>
                      {musicState.currentTrack.artist}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {isDjAuthorized && (
                    <button
                      onClick={handleSkipPrev}
                      className="p-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white transition-all"
                      title="Previous Track"
                    >
                      <SkipBack size={13} />
                    </button>
                  )}

                  {isDjAuthorized ? (
                    <button
                      onClick={() => {
                        let currentPos = musicState.lastPosition || 0;
                        if (ytPlayerRef.current && ytPlayerReadyRef.current && ytPlayerRef.current.getCurrentTime) {
                          try { currentPos = ytPlayerRef.current.getCurrentTime(); } catch (_) {}
                        } else if (musicAudioRef.current) {
                          currentPos = musicAudioRef.current.currentTime;
                        }

                        if (musicState.isPlaying) {
                          sendMusicAction('pause', musicState.currentTrackId, currentPos, musicState.currentTrack);
                        } else {
                          sendMusicAction('play', musicState.currentTrackId, currentPos, musicState.currentTrack);
                        }
                      }}
                      className="bg-fuchsia-600 hover:bg-fuchsia-500 p-1.5 rounded-xl text-white transition-all active:scale-95 shadow-md shadow-fuchsia-950/40"
                    >
                      {musicState.isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" />}
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/5 text-white/40 border border-white/10">
                      🔒 In Sync
                    </span>
                  )}

                  {isDjAuthorized && (
                    <button
                      onClick={handleSkipNext}
                      className="p-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white transition-all"
                      title="Next Track"
                    >
                      <SkipForward size={13} />
                    </button>
                  )}

                  <button
                    onClick={() => setActiveSidebar(activeSidebar === 'lyrics' ? null : 'lyrics')}
                    className={`p-1.5 rounded-lg text-xs border transition-all ${
                      activeSidebar === 'lyrics'
                        ? 'bg-fuchsia-600 text-white border-fuchsia-500 shadow-md shadow-fuchsia-950/40'
                        : isLight
                        ? 'bg-black/5 hover:bg-black/10 text-black/80 hover:text-black border-black/10'
                        : 'bg-white/5 hover:bg-white/15 text-white/80 hover:text-white border-white/10'
                    }`}
                    title="Live Synchronized Lyrics"
                  >
                    <Mic2 size={13} />
                  </button>

                  <button
                    onClick={() => setIsPlayerExpanded(!isPlayerExpanded)}
                    className="p-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white transition-all ml-1"
                    title={isPlayerExpanded ? "Minimize Theater View" : "Expand Center Stage"}
                  >
                    {isPlayerExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>
                </div>
              </div>

              {/* Real-time Synchronized Interactive Timeline Scrub Bar */}
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-[10px] text-white/50 font-mono w-7 text-right">
                  {Math.floor(songProgress.current / 60)}:{Math.floor(songProgress.current % 60).toString().padStart(2, '0')}
                </span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(1, songProgress.duration || 180)}
                  step="0.5"
                  value={songProgress.current}
                  disabled={!isDjAuthorized}
                  onMouseDown={() => { if (isDjAuthorized) isSeekingRef.current = true; }}
                  onTouchStart={() => { if (isDjAuthorized) isSeekingRef.current = true; }}
                  onChange={(e) => {
                    if (isDjAuthorized) {
                      const val = parseFloat(e.target.value);
                      setSongProgress(prev => ({ ...prev, current: val }));
                    }
                  }}
                  onMouseUp={(e) => {
                    if (isDjAuthorized) handleSeek(parseFloat((e.target as HTMLInputElement).value));
                  }}
                  onTouchEnd={(e) => {
                    if (isDjAuthorized) handleSeek(parseFloat((e.target as HTMLInputElement).value));
                  }}
                  className={`flex-1 h-1.5 bg-white/10 rounded-lg appearance-none accent-fuchsia-500 transition-all ${isDjAuthorized ? 'cursor-pointer hover:h-2' : 'cursor-not-allowed opacity-50'}`}
                />
                <span className="text-[10px] text-white/50 font-mono w-7">
                  {Math.floor((songProgress.duration || 180) / 60)}:{Math.floor((songProgress.duration || 180) % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          )}

          {/* Bottom Toolbar (iPhone & Mobile optimized with safe areas) */}
          <div className="h-16 md:h-20 flex justify-center items-center gap-1.5 md:gap-3.5 z-20 flex-shrink-0 select-none pb-2 md:pb-0">
            {/* Microphone Toggle Button */}
            <button
              onClick={toggleMic}
              aria-label={micOn ? "Turn microphone off" : "Turn microphone on"}
              title={micOn ? "Turn microphone off (Currently ON)" : "Turn microphone on (Currently OFF)"}
              className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center gap-1.5 justify-center active:scale-90 font-bold text-xs ${
                micOn
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 border border-emerald-400'
                  : 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 shadow-md'
              }`}
            >
              {micOn ? <Mic size={18} /> : <MicOff size={18} />}
              <span className="hidden sm:inline text-[11px]">{micOn ? 'Mic ON' : 'Mic OFF'}</span>
            </button>

            {/* Camera Toggle Button */}
            <button
              onClick={toggleCam}
              aria-label={camOn ? "Turn camera off" : "Turn camera on"}
              title={camOn ? "Turn camera off (Currently ON)" : "Turn camera on (Currently OFF)"}
              className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center gap-1.5 justify-center active:scale-90 font-bold text-xs ${
                camOn
                  ? (isLight ? 'bg-black text-white shadow-lg border border-black' : 'bg-white text-black shadow-lg border border-white')
                  : (isLight ? 'bg-black/5 hover:bg-black/10 text-black/50 border border-black/10' : 'bg-white/10 hover:bg-white/20 text-white/50 border border-white/10')
              }`}
            >
              {camOn ? <Video size={18} /> : <VideoOff size={18} />}
              <span className="hidden sm:inline text-[11px]">{camOn ? 'Cam ON' : 'Cam OFF'}</span>
            </button>

            {/* Screen Share Button */}
            <button
              onClick={toggleScreenShare}
              aria-label={isScreenSharing ? "Stop sharing screen" : "Share screen"}
              title={isScreenSharing ? "Stop sharing screen" : "Share screen"}
              className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center justify-center active:scale-90 ${isScreenSharing ? (isLight ? 'bg-black text-white shadow-lg' : 'bg-white text-black shadow-lg') : (isLight ? 'bg-black/5 hover:bg-black/10 text-black' : 'bg-white/10 hover:bg-white/20 text-white')}`}
            >
              <Monitor size={18} />
            </button>
            <button onClick={() => setShowReactionMenu(!showReactionMenu)} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center justify-center active:scale-90 ${showReactionMenu ? (isLight ? 'bg-black text-white shadow-lg' : 'bg-white text-black shadow-lg') : (isLight ? 'bg-black/5 hover:bg-black/10 text-black' : 'bg-white/10 hover:bg-white/20 text-white')}`}>
              <Smile size={18} />
            </button>
            <span className={`w-[1px] h-5 mx-0.5 md:mx-1 ${isLight ? 'bg-black/10' : 'bg-white/10'}`} />
            <button onClick={() => setActiveSidebar(activeSidebar === 'mixer' ? null : 'mixer')} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center justify-center active:scale-90 ${activeSidebar === 'mixer' ? (isLight ? 'bg-black text-white shadow-lg' : 'bg-white text-black shadow-lg') : (isLight ? 'bg-black/5 hover:bg-black/10 text-black' : 'bg-white/10 hover:bg-white/20 text-white')}`} title="Volume Mixer">
              <Sliders size={18} />
            </button>
            <button onClick={() => setActiveSidebar(activeSidebar === 'music' ? null : 'music')} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center justify-center active:scale-90 ${activeSidebar === 'music' ? (isLight ? 'bg-black text-white shadow-lg' : 'bg-white text-black shadow-lg') : (isLight ? 'bg-black/5 hover:bg-black/10 text-black' : 'bg-white/10 hover:bg-white/20 text-white')}`} title="Music Library">
              <Music size={18} />
            </button>
            <button onClick={() => setActiveSidebar(activeSidebar === 'lyrics' ? null : 'lyrics')} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center justify-center active:scale-90 ${activeSidebar === 'lyrics' ? 'bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-950/40' : (isLight ? 'bg-black/5 hover:bg-black/10 text-black' : 'bg-white/10 hover:bg-white/20 text-white')}`} title="Live Apple Lyrics">
              <Mic2 size={18} />
            </button>
            <button onClick={() => setActiveSidebar(activeSidebar === 'chat' ? null : 'chat')} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 flex items-center justify-center active:scale-90 ${activeSidebar === 'chat' ? (isLight ? 'bg-black text-white shadow-lg' : 'bg-white text-black shadow-lg') : (isLight ? 'bg-black/5 hover:bg-black/10 text-black' : 'bg-white/10 hover:bg-white/20 text-white')}`} title="Chat">
              <MessageSquare size={18} />
            </button>
            <button onClick={handleLeaveCall} className="p-2.5 md:p-3.5 rounded-2xl bg-red-500 hover:bg-red-400 text-white transition-all active:scale-90 duration-300" title="Leave Room">
              <PhoneOff size={18} />
            </button>
          </div>
        </div>

        {/* Sidebars (Mobile modal bottom-sheet / overlay on iPhone, side-docked on desktop) */}
        {activeSidebar && (
          <div className={`${isMobile ? `fixed inset-x-0 bottom-0 top-12 z-50 backdrop-blur-3xl ${isLight ? 'bg-white/80' : 'bg-black/80'}` : `relative h-full flex-shrink-0 border-l backdrop-blur-3xl rounded-[32px] overflow-hidden ml-2 ${isLight ? 'bg-white/30 border-black/5' : 'bg-black/20 border-white/5'}`} ${activeSidebar === 'lyrics' ? 'w-80 md:w-96' : 'w-80'}`}>
            <div className="relative h-full w-full">
              {isMobile && (
                <button
                  onClick={() => setActiveSidebar(null)}
                  className={`absolute top-3 right-3 z-50 text-xs px-2.5 py-1 rounded-full border ${isLight ? 'bg-black/5 hover:bg-black/10 text-black border-black/10' : 'bg-white/10 hover:bg-white/20 text-white border-white/20'}`}
                >
                  ✕ Close
                </button>
              )}
              {activeSidebar === 'chat' && <ChatSidebar />}
              {activeSidebar === 'music' && <PlaylistSidebar theme={theme} onStartScreenShare={toggleScreenShare} />}
              {activeSidebar === 'mixer' && <AudioMixerPanel />}
              {activeSidebar === 'lyrics' && (
                <LyricsView
                  currentTrack={musicState.currentTrack as any}
                  currentTime={songProgress.current}
                  getTime={() => {
                    if (ytPlayerRef.current && ytPlayerReadyRef.current && ytPlayerRef.current.getCurrentTime) {
                      try { return ytPlayerRef.current.getCurrentTime() || 0; } catch (_) { return songProgress.current; }
                    }
                    return musicAudioRef.current?.currentTime || songProgress.current;
                  }}
                  isPlaying={musicState.isPlaying}
                  theme={theme}
                  onSeek={handleSeek}
                  onClose={() => setActiveSidebar(null)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

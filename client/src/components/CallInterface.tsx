'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAudioMixer } from '../context/AudioMixerContext';
import { ChatSidebar } from './ChatSidebar';
import { PlaylistSidebar } from './PlaylistSidebar';
import { AudioMixerPanel } from './AudioMixerPanel';
import { ReactionOverlay } from './ReactionOverlay';
import { extractYouTubeId, isYouTubeUrl, extractSpotifyInfo, extractSoundCloudInfo, parseMediaUrl } from '../utils/mediaPlatform';
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
  Volume2
} from 'lucide-react';

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

// Safe remote video & audio player with guaranteed playback
const RemoteVideoPlayer: React.FC<{ stream: MediaStream; username?: string }> = ({ stream, username = 'Partner' }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!stream) return;

    if (video) {
      video.srcObject = stream;
      video.play().then(() => {
        if (video.videoWidth > 0) setIsPlaying(true);
      }).catch(() => {});
    }

    if (audio) {
      audio.srcObject = stream;
      audio.play().catch(e => console.warn('[Audio] Direct remote audio playback waiting for gesture:', e));
    }

    const handleTrack = () => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {});
      }
    };

    stream.onaddtrack = handleTrack;
    stream.onremovetrack = handleTrack;
  }, [stream]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-[#18181b] overflow-hidden">
      {/* Background Avatar placeholder when video frames are loading */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 select-none z-0">
        <div className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-gradient-to-br from-fuchsia-600 to-indigo-600 flex items-center justify-center text-xl md:text-2xl font-bold text-white shadow-xl border border-white/20 animate-pulse">
          {username.charAt(0).toUpperCase()}
        </div>
        <span className="text-[11px] md:text-xs text-white/50">{username} (Connecting...)</span>
      </div>

      {/* Video Element - ALWAYS active in DOM so browser decodes and displays frames */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`absolute inset-0 w-full h-full object-cover z-10 transition-opacity duration-300 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
        onPlaying={() => setIsPlaying(true)}
      />

      {/* Direct Remote Audio Stream Element (Plays screenshare audio and voice cleanly) */}
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
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

export const CallInterface: React.FC<CallInterfaceProps> = ({
  roomId,
  userId,
  username,
  onLeave
}) => {
  // Context hooks
  const { socket, joinRoom, sendReaction, participants, isConnected, musicState, sendMusicAction, getServerTime } = useSocket();
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

  // Toolbar controls
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Sidebar toggles
  const [activeSidebar, setActiveSidebar] = useState<'chat' | 'music' | 'mixer' | null>('music');
  const [showReactionMenu, setShowReactionMenu] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Mock speaking state (solo testing utility)
  const [mockSpeakingUser, setMockSpeakingUser] = useState<string | null>(null);
  const mockOscillatorRef = useRef<OscillatorNode | null>(null);
  const mockOscillatorGainRef = useRef<GainNode | null>(null);

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
  const isSyncingMusicRef = useRef(false);

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

      setRemotePeers(prev => {
        const updated = new Map(prev);
        updated.set(targetSocketId, {
          socketId: targetSocketId,
          userId: targetSocketId,
          username: peerUsername,
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

  // YouTube Synchronized Player state & refs
  const [showYtVideo, setShowYtVideo] = useState(true);
  const ytPlayerRef = useRef<any>(null);
  const ytPlayerReadyRef = useRef<boolean>(false);
  const currentYtVideoIdRef = useRef<string | null>(null);

  // Load YouTube IFrame API script once
  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

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

  // Periodic smooth UI progress updater
  useEffect(() => {
    const updateTime = () => {
      if (isSeekingRef.current) return;
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
    };

    const interval = setInterval(updateTime, 500);
    return () => clearInterval(interval);
  }, [musicState]);

  // Handle user seeking on the shared timeline bar
  const handleSeek = (newTime: number) => {
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

  // Permanent Shared Music Playback Synchronization (Ultra-Smooth YouTube + Direct Audio Engine)
  useEffect(() => {
    const audio = musicAudioRef.current;

    if (!musicState.currentTrackId && !musicState.currentTrack) {
      if (audio && !audio.paused) audio.pause();
      if (ytPlayerRef.current && ytPlayerReadyRef.current) {
        try { ytPlayerRef.current.pauseVideo(); } catch (_) {}
      }
      return;
    }

    const currentTrack = musicState.currentTrack;
    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
    let trackUrl = currentTrack?.url || '';

    // Fallback URL preset lookup if trackData wasn't attached
    if (!trackUrl && musicState.currentTrackId) {
      const presetList: Record<string, string> = {
        'yt-chase-atlantic-slide': 'https://www.youtube.com/watch?v=tOVIeLZtxDc',
        'yt-drake-massive': 'https://www.youtube.com/watch?v=ay1l_u6vltY',
        'yt-future-weeknd': 'https://www.youtube.com/watch?v=mq4wClhFmA8',
        'yt-tricksingh-taaj': 'https://www.youtube.com/watch?v=Du8E8g2LVoU',
        'yt-the-weeknd-blinding': 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
        'yt-lofi-girl': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
        'online-1': 'https://ia802802.us.archive.org/5/items/lofi-study-112191/lofi-study-112191.mp3',
        'online-2': 'https://ia800905.us.archive.org/19/items/FREE_background_music_loops/chill_groove.mp3',
        'online-3': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'rf-1': 'https://ia802802.us.archive.org/5/items/lofi-study-112191/lofi-study-112191.mp3',
        'rf-2': 'https://ia800905.us.archive.org/19/items/FREE_background_music_loops/chill_groove.mp3',
        'rf-3': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
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

      if (!ytPlayerRef.current) {
        if ((window as any).YT && (window as any).YT.Player) {
          try {
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
                start: Math.floor(targetPos)
              },
              events: {
                onReady: (event: any) => {
                  ytPlayerReadyRef.current = true;
                  currentYtVideoIdRef.current = ytId;
                  event.target.setVolume(Math.max(0, Math.min(100, Math.round(musicVolume * 100))));
                  
                  // Calculate dynamic exact position at the moment the player is ready (late-joiners fix)
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
                },
                onStateChange: (event: any) => {
                  if (isLocalTriggeredRef.current) return;

                  // YT.PlayerState.PLAYING = 1, PAUSED = 2
                  if (event.data === 1 && !musicState.isPlaying) {
                    const curTime = event.target.getCurrentTime ? event.target.getCurrentTime() : 0;
                    isLocalTriggeredRef.current = true;
                    sendMusicAction('play', musicState.currentTrackId, curTime, musicState.currentTrack);
                    setTimeout(() => { isLocalTriggeredRef.current = false; }, 600);
                  } else if (event.data === 2 && musicState.isPlaying) {
                    const curTime = event.target.getCurrentTime ? event.target.getCurrentTime() : 0;
                    isLocalTriggeredRef.current = true;
                    sendMusicAction('pause', musicState.currentTrackId, curTime, musicState.currentTrack);
                    setTimeout(() => { isLocalTriggeredRef.current = false; }, 600);
                  }
                },
                onError: (err: any) => {
                  console.warn('[YouTube Player] Error code:', err?.data);
                  if (err?.data === 101 || err?.data === 150) {
                    alert('Notice: The owner of this video has disabled external embedding.\n\nTip: Please paste another YouTube song link or choose one of the featured tracks!');
                  }
                }
              }
            });
          } catch (e) {
            console.warn('[YouTube] Player initialization error:', e);
          }
        }
      } else if (ytPlayerReadyRef.current) {
        try {
          // If track changed: load the new video once at the synced position
          if (currentYtVideoIdRef.current !== ytId) {
            currentYtVideoIdRef.current = ytId;
            ytPlayerRef.current.loadVideoById({
              videoId: ytId,
              startSeconds: Math.floor(targetPos)
            });
          }

          ytPlayerRef.current.setVolume(Math.max(0, Math.min(100, Math.round(musicVolume * 100))));

          if (musicState.isPlaying) {
            ytPlayerRef.current.playVideo();
            const currentPos = ytPlayerRef.current.getCurrentTime ? ytPlayerRef.current.getCurrentTime() : 0;
            const drift = targetPos - currentPos;

            // 3-Tier Drift Management Policy
            if (Math.abs(drift) > 1.2) {
              // Tier 3: Major drift (> 1.2s) -> Hard seek
              ytPlayerRef.current.seekTo(targetPos, true);
              if (ytPlayerRef.current.setPlaybackRate) ytPlayerRef.current.setPlaybackRate(1.0);
            } else if (Math.abs(drift) > 0.25) {
              // Tier 2: Medium drift (250ms - 1.2s) -> Smooth rate nudge without stuttering
              if (ytPlayerRef.current.setPlaybackRate) {
                ytPlayerRef.current.setPlaybackRate(drift > 0 ? 1.04 : 0.96);
              }
            } else {
              // Tier 1: Perfect sync zone (< 250ms) -> Normal rate
              if (ytPlayerRef.current.setPlaybackRate) {
                ytPlayerRef.current.setPlaybackRate(1.0);
              }
            }
          } else {
            ytPlayerRef.current.pauseVideo();
            if (ytPlayerRef.current.setPlaybackRate) ytPlayerRef.current.setPlaybackRate(1.0);
            const currentPos = ytPlayerRef.current.getCurrentTime ? ytPlayerRef.current.getCurrentTime() : 0;
            if (musicState.lastPosition !== undefined && Math.abs(currentPos - musicState.lastPosition) > 1.0) {
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
    // Path B: Synchronized Direct MP3 / Audio Stream
    // ───────────────────────────────────────────
    if (ytPlayerRef.current && ytPlayerReadyRef.current) {
      try { ytPlayerRef.current.pauseVideo(); } catch (_) {}
    }

    if (!audio) return;

    if (audio.src !== trackUrl) {
      audio.src = trackUrl;
      audio.load();
    }

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
  }, [musicState, getServerTime, musicVolume]);

  // Sync local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const startLocalMedia = async () => {
    let stream: MediaStream | null = null;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
        } catch (e1) {
          console.warn('[Media] Ideal constraints failed, trying basic video/audio:', e1);
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
        }
      }
      console.log('[Media] Real camera/mic acquired');
    } catch (err) {
      console.warn('[Media] Camera/mic blocked or unavailable, using canvas fallback:', err);
    }

    if (!stream) {
      stream = createFallbackStream();
    }

    localStreamRef.current = stream;
    setLocalStream(stream);

    // Route mic through audio mixer
    const micTrack = stream.getAudioTracks()[0];
    if (micTrack) {
      processLocalMicTrack(micTrack).catch(e => console.warn('[Media] Mic process warning:', e));
    }

    // BUG FIX #2: mark media as ready
    localMediaReadyRef.current = true;

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
    // Pre-create the PC so we're ready when the offer arrives.
    const onPeerJoined = (payload: { socketId: string; userId: string; username: string }) => {
      console.log('[WebRTC] peer-joined:', payload);
      if (payload.socketId === socket.id) return; // skip self
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
  // Media controls
  // ─────────────────────────────────────────────────────────────

  const toggleMic = () => {
    const newMicState = !micOn;
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

    console.log(`[Media] Microphone toggled: ${newMicState ? 'UNMUTED 🎙️' : 'MUTED 🔇'}`);
  };

  const toggleCam = () => {
    const newCamState = !camOn;
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

  return (
    <div className="flex flex-col h-[100dvh] bg-[#09090b] overflow-hidden text-white font-sans select-none">
      {/* Top Navigation Bar */}
      <div className="h-12 md:h-14 bg-black/50 border-b border-white/10 backdrop-blur-md px-3 md:px-6 flex justify-between items-center z-20 flex-shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          <span className="font-semibold text-xs md:text-sm tracking-wide bg-gradient-to-r from-emerald-400 to-fuchsia-400 bg-clip-text text-transparent font-mono">
            Room: {roomId}
          </span>
          <button
            onClick={() => {
              const url = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
              navigator.clipboard.writeText(url);
              alert(`Room Link Copied!\n\nShare this with your partner:\n${url}`);
            }}
            className="bg-white/10 hover:bg-white/20 text-white/80 hover:text-white px-2 py-1 rounded-lg text-[10px] md:text-xs flex items-center gap-1 border border-white/10 transition-all active:scale-95"
          >
            <Copy size={11} />
            <span>Copy</span>
          </button>
          
          {isConnected ? (
            <span className="text-[9px] md:text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 font-semibold uppercase flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          ) : (
            <span className="text-[9px] md:text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-semibold flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
              Connecting...
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] md:text-xs text-white/70 bg-white/5 px-2.5 py-0.5 md:py-1 rounded-full border border-white/10">
          <Users size={13} className={totalParticipants > 1 ? "text-emerald-400" : "text-zinc-400"} />
          <span className={totalParticipants > 1 ? "text-white font-semibold" : "text-white/60"}>
            {totalParticipants}
          </span>
        </div>
      </div>

      {!isConnected && (
        <div className="bg-amber-950/80 border-b border-amber-500/30 text-amber-200 text-[11px] px-4 py-1 flex items-center justify-between">
          <span>⏳ Connecting to signaling server...</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
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

        <div className="flex-1 flex flex-col relative justify-between bg-black/20 p-2 md:p-6 overflow-hidden">
          <ReactionOverlay />

          {/* Video Grid (Optimized for iPhone / Mobile vertical stack & Desktop horizontal grid) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 w-full max-w-5xl mx-auto items-center justify-center p-1 md:p-2 overflow-y-auto min-h-0">

            {/* Local Video */}
            <div className="bg-[#18181b] w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transform scale-x-[-1] ${!camOn ? 'hidden' : ''}`}
              />
              {!camOn && (
                <div className="text-center space-y-2">
                  <div className="h-12 w-12 md:h-16 md:w-16 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-white/10 text-white/30">
                    <VideoOff size={20} />
                  </div>
                  <span className="text-[11px] text-white/40">{username} (Camera Off)</span>
                </div>
              )}
              <span className="absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold bg-black/60 px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border border-white/10 backdrop-blur-sm flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${micOn ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {username} (You)
              </span>
            </div>

            {/* Screen Share Tile */}
            {isScreenSharing && (
              <div className="bg-[#18181b] w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-2xl md:rounded-3xl overflow-hidden border border-emerald-500/30 relative shadow-2xl flex items-center justify-center">
                <video
                  ref={(el) => { if (el && screenStream) el.srcObject = screenStream; }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
                <span className="absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold bg-emerald-950/80 text-emerald-300 px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border border-emerald-500/30 backdrop-blur-sm flex items-center gap-1.5">
                  <Tv size={12} /> Your Screen Share
                </span>
              </div>
            )}

            {/* Remote Peer Videos & Remote Screen Shares */}
            {remotePeerList.flatMap(peer => {
              const videoTracks = peer.stream.getVideoTracks();
              if (videoTracks.length <= 1) {
                return [
                  <div key={peer.socketId} className="bg-[#18181b] w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
                    <RemoteVideoPlayer stream={peer.stream} username={peer.username} />
                    <span className="absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold bg-black/60 px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border border-white/10 backdrop-blur-sm flex items-center gap-1.5 z-10">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      {peer.username}
                    </span>
                  </div>
                ];
              }
              return videoTracks.map((track, idx) => {
                const singleStream = new MediaStream([track, ...peer.stream.getAudioTracks()]);
                const isScreen = idx > 0;
                return (
                  <div key={`${peer.socketId}_${track.id}`} className={`bg-[#18181b] w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-2xl md:rounded-3xl overflow-hidden ${isScreen ? 'border border-emerald-500/30' : 'border border-white/10'} relative shadow-2xl flex items-center justify-center`}>
                    <RemoteVideoPlayer stream={singleStream} username={peer.username} />
                    <span className={`absolute bottom-2 left-2 md:bottom-4 md:left-4 text-[10px] md:text-xs font-semibold ${isScreen ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30' : 'bg-black/60 text-white border-white/10'} px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border backdrop-blur-sm flex items-center gap-1.5 z-10`}>
                      {isScreen ? <Tv size={12} /> : <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />}
                      {peer.username} {isScreen ? "'s Screen" : ''}
                    </span>
                  </div>
                );
              });
            })}

            {/* Waiting placeholder (only when no remote peers) */}
            {remotePeerList.length === 0 && (
              <div className="bg-[#18181b] w-full h-full max-h-[42vh] md:max-h-none aspect-video rounded-2xl md:rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
                <div className="text-center space-y-2 md:space-y-3">
                  <div className={`h-12 w-12 md:h-16 md:w-16 rounded-full flex items-center justify-center mx-auto border transition-all duration-300 ${
                    mockSpeakingUser === 'Partner'
                      ? 'bg-emerald-600/30 border-emerald-400 shadow-[0_0_12px_#10b981]'
                      : 'bg-white/5 border-white/10'
                  }`}>
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

          {/* Multi-Platform Player Overlay (YouTube, Spotify, SoundCloud, Web Audio) */}
          {musicState.currentTrack && (
            <div
              className={`absolute bottom-20 md:bottom-24 right-3 md:right-6 z-30 transition-all duration-300 rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-black ${
                showYtVideo ? 'w-64 sm:w-80 md:w-96 aspect-video block' : 'w-1 h-1 opacity-0 pointer-events-none'
              }`}
            >
              {/* YouTube Container */}
              <div
                id="youtube-sync-player"
                className={`w-full h-full ${isYouTubeUrl(musicState.currentTrack.url) ? 'block' : 'hidden'}`}
              />

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

              <button
                onClick={() => setShowYtVideo(!showYtVideo)}
                className="absolute top-1.5 right-1.5 md:top-2 md:right-2 bg-black/70 hover:bg-black/90 text-white/80 hover:text-white p-1 rounded-full text-xs z-40 backdrop-blur-sm border border-white/10"
                title={showYtVideo ? "Hide Media Player" : "Show Media Player"}
              >
                {showYtVideo ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          )}

          {/* Global Synchronized Music Pill & Interactive Shared Seek Bar (when song is selected) */}
          {musicState.currentTrack && (
            <div className="absolute top-2 right-2 md:top-4 md:right-6 z-30 bg-[#18181b]/95 border border-fuchsia-500/30 backdrop-blur-md px-3 py-2 rounded-2xl shadow-2xl flex flex-col gap-1.5 animate-fade-in w-64 sm:w-80 md:w-96">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="h-2 w-2 rounded-full bg-fuchsia-400 animate-pulse flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs md:text-sm font-bold text-white truncate">
                      {musicState.currentTrack.title}
                    </span>
                    <span className="text-[10px] text-fuchsia-300/70 truncate">
                      {musicState.currentTrack.artist}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isYouTubeUrl(musicState.currentTrack.url) && (
                    <button
                      onClick={() => setShowYtVideo(!showYtVideo)}
                      className={`p-1.5 rounded-lg text-xs transition-all border ${
                        showYtVideo 
                          ? 'bg-fuchsia-600/30 border-fuchsia-500/40 text-fuchsia-200' 
                          : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                      }`}
                      title={showYtVideo ? "Hide YouTube Video" : "Show YouTube Video"}
                    >
                      {showYtVideo ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  )}
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
                  onMouseDown={() => { isSeekingRef.current = true; }}
                  onTouchStart={() => { isSeekingRef.current = true; }}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setSongProgress(prev => ({ ...prev, current: val }));
                  }}
                  onMouseUp={(e) => {
                    handleSeek(parseFloat((e.target as HTMLInputElement).value));
                  }}
                  onTouchEnd={(e) => {
                    handleSeek(parseFloat((e.target as HTMLInputElement).value));
                  }}
                  className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-fuchsia-500 hover:h-2 transition-all"
                />
                <span className="text-[10px] text-white/50 font-mono w-7">
                  {Math.floor((songProgress.duration || 180) / 60)}:{Math.floor((songProgress.duration || 180) % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>
          )}

          {/* Bottom Toolbar (iPhone & Mobile optimized with safe areas) */}
          <div className="h-16 md:h-20 flex justify-center items-center gap-1.5 md:gap-3.5 z-20 flex-shrink-0 select-none pb-2 md:pb-0">
            <button onClick={toggleMic} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${micOn ? 'bg-white/10 hover:bg-white/15 border-white/10 text-white' : 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-400'}`}>
              {micOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button onClick={toggleCam} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${camOn ? 'bg-white/10 hover:bg-white/15 border-white/10 text-white' : 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-400'}`}>
              {camOn ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
            <button onClick={toggleScreenShare} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${isScreenSharing ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Monitor size={18} />
            </button>
            <button onClick={() => setShowReactionMenu(!showReactionMenu)} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${showReactionMenu ? 'bg-fuchsia-600/20 border-fuchsia-500/30 text-fuchsia-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Smile size={18} />
            </button>
            <span className="w-[1px] h-5 bg-white/10 mx-0.5 md:mx-1" />
            <button onClick={() => setActiveSidebar(activeSidebar === 'mixer' ? null : 'mixer')} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${activeSidebar === 'mixer' ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Sliders size={18} />
            </button>
            <button onClick={() => setActiveSidebar(activeSidebar === 'music' ? null : 'music')} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${activeSidebar === 'music' ? 'bg-fuchsia-600/20 border-fuchsia-500/30 text-fuchsia-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Music size={18} />
            </button>
            <button onClick={() => setActiveSidebar(activeSidebar === 'chat' ? null : 'chat')} className={`p-2.5 md:p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${activeSidebar === 'chat' ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <MessageSquare size={18} />
            </button>
            <button onClick={handleLeaveCall} className="p-2.5 md:p-3.5 rounded-2xl bg-red-600 hover:bg-red-500 text-white transition-all active:scale-90 duration-300 shadow-lg shadow-red-950/40">
              <PhoneOff size={18} />
            </button>
          </div>
        </div>

        {/* Sidebars (Mobile modal bottom-sheet / overlay on iPhone, side-docked on desktop) */}
        {activeSidebar && (
          <div className={`${isMobile ? 'fixed inset-x-0 bottom-0 top-12 z-50 bg-[#09090b]/98' : 'relative h-full flex-shrink-0'}`}>
            <div className="relative h-full w-full">
              {isMobile && (
                <button
                  onClick={() => setActiveSidebar(null)}
                  className="absolute top-3 right-3 z-50 bg-white/10 hover:bg-white/20 text-white text-xs px-2.5 py-1 rounded-full border border-white/20"
                >
                  ✕ Close
                </button>
              )}
              {activeSidebar === 'chat' && <ChatSidebar />}
              {activeSidebar === 'music' && <PlaylistSidebar onStartScreenShare={toggleScreenShare} />}
              {activeSidebar === 'mixer' && <AudioMixerPanel />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

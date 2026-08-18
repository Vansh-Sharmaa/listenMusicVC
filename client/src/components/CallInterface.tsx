'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAudioMixer } from '../context/AudioMixerContext';
import { ChatSidebar } from './ChatSidebar';
import { PlaylistSidebar } from './PlaylistSidebar';
import { AudioMixerPanel } from './AudioMixerPanel';
import { ReactionOverlay } from './ReactionOverlay';
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
  Copy
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

// Safe remote video player with guaranteed autoplay
const RemoteVideoPlayer: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;

    const playVideo = () => {
      video.play().catch(err => {
        console.warn('[WebRTC] Remote video play retry:', err.message);
      });
    };

    playVideo();
    video.onloadedmetadata = playVideo;
    video.oncanplay = playVideo;
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="w-full h-full object-cover"
    />
  );
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
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
  const { socket, joinRoom, sendReaction, participants, isConnected, musicState, getServerTime } = useSocket();
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

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state with ${peerUsername}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        console.log('[WebRTC] ICE failed, restarting...');
        pc.restartIce();
      }
    };

    pc.onsignalingstatechange = () => {
      console.log(`[WebRTC] Signaling state with ${peerUsername}: ${pc.signalingState}`);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${peerUsername}: ${pc.connectionState}`);
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

    // Global unlock handler for browser autoplay policies
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

    window.addEventListener('click', unlockAudioAndVideo);
    window.addEventListener('touchstart', unlockAudioAndVideo);
    window.addEventListener('keydown', unlockAudioAndVideo);

    return () => {
      window.removeEventListener('click', unlockAudioAndVideo);
      window.removeEventListener('touchstart', unlockAudioAndVideo);
      window.removeEventListener('keydown', unlockAudioAndVideo);
      cleanupAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId, username, audioContext]);

  // Sync music element with Web Audio mixer
  useEffect(() => {
    if (musicAudioRef.current) {
      registerMusicElement(musicAudioRef.current);
    }
  }, [musicAudioRef.current, registerMusicElement]);

  // Apply volume changes to permanent music audio element
  useEffect(() => {
    if (musicAudioRef.current) {
      musicAudioRef.current.volume = Math.max(0, Math.min(1, musicVolume));
    }
  }, [musicVolume]);

  // Permanent Shared Music Playback Synchronization (always running)
  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio) return;

    if (!musicState.currentTrackId && !musicState.currentTrack) {
      if (!audio.paused) audio.pause();
      return;
    }

    const currentTrack = musicState.currentTrack;
    const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
    let trackUrl = currentTrack?.url || '';

    // Fallback URL preset lookup if trackData wasn't attached
    if (!trackUrl && musicState.currentTrackId) {
      const presetList: Record<string, string> = {
        'online-1': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        'online-2': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        'online-3': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
        'online-4': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
        'rf-1': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        'rf-2': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        'rf-3': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
      };
      trackUrl = presetList[musicState.currentTrackId] || '';
    }

    if (trackUrl.startsWith('/')) {
      trackUrl = `${serverUrl}${trackUrl}`;
    }

    if (!trackUrl) {
      if (!audio.paused) audio.pause();
      return;
    }

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

          if (Math.abs(audio.currentTime - targetPos) > 0.6) {
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
          if (Math.abs(audio.currentTime - musicState.lastPosition) > 0.6) {
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
    const interval = setInterval(syncAudio, 2000);
    return () => clearInterval(interval);
  }, [musicState, getServerTime]);

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
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !micOn;
      setMicOn(!micOn);
    }
  };

  const toggleCam = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !camOn;
      setCamOn(!camOn);
    }
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

  const remotePeerList = Array.from(remotePeers.values());
  const totalParticipants = Math.max(remotePeerList.length + 1, participants.length);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-[#09090b] overflow-hidden text-white font-sans">
      {/* Top Navigation Bar */}
      <div className="h-14 bg-black/40 border-b border-white/5 backdrop-blur-md px-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm tracking-wide bg-gradient-to-r from-emerald-400 to-fuchsia-400 bg-clip-text text-transparent font-mono">
            Room: {roomId}
          </span>
          <button
            onClick={() => {
              const url = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
              navigator.clipboard.writeText(url);
              alert(`Room Link Copied!\n\nShare this with your partner:\n${url}`);
            }}
            className="bg-white/10 hover:bg-white/20 text-white/80 hover:text-white px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 border border-white/10 transition-all active:scale-95"
          >
            <Copy size={12} />
            <span>Copy Link</span>
          </button>
          
          {isConnected ? (
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-semibold uppercase flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Connected
            </span>
          ) : (
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-500/30 font-semibold flex items-center gap-1.5" title="Connecting to signaling backend server...">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
              Connecting to Server...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-white/60 bg-white/5 px-3 py-1 rounded-full border border-white/5">
          <Users size={14} className={totalParticipants > 1 ? "text-emerald-400" : "text-zinc-400"} />
          <span className={totalParticipants > 1 ? "text-white font-semibold" : "text-white/60"}>
            {totalParticipants} Participant{totalParticipants === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {!isConnected && (
        <div className="bg-amber-950/70 border-b border-amber-500/30 text-amber-200 text-xs px-6 py-1.5 flex items-center justify-between">
          <span>
            ⏳ Connecting to backend signaling server... If using free-tier Render, it may take ~30s to wake up on first visit.
          </span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Permanent hidden music audio element */}
        <audio ref={musicAudioRef} playsInline preload="auto" crossOrigin="anonymous" className="hidden" />

        {autoplayBlocked && (
          <button
            onClick={() => {
              if (musicAudioRef.current) {
                musicAudioRef.current.play().then(() => setAutoplayBlocked(false)).catch(() => {});
              }
            }}
            className="absolute top-2 left-1/2 -translate-x-1/2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs px-4 py-2 rounded-full font-bold shadow-xl z-50 animate-bounce flex items-center gap-2 border border-fuchsia-400"
          >
            <Music size={14} />
            <span>Click here to enable shared music sound 🔊</span>
          </button>
        )}

        <div className="flex-1 flex flex-col relative justify-center bg-black/20 p-6 overflow-hidden">

          <ReactionOverlay />

          {/* Video Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full w-full max-w-5xl mx-auto items-center justify-center p-2 overflow-y-auto">

            {/* Local Video */}
            <div className="bg-[#18181b] aspect-video rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transform scale-x-[-1] ${!camOn ? 'hidden' : ''}`}
              />
              {!camOn && (
                <div className="text-center space-y-2">
                  <div className="h-16 w-16 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-white/10 text-white/30">
                    <VideoOff size={24} />
                  </div>
                  <span className="text-xs text-white/40">{username} (Camera Off)</span>
                </div>
              )}
              <span className="absolute bottom-4 left-4 text-xs font-semibold bg-black/60 px-3 py-1 rounded-full border border-white/10 backdrop-blur-sm flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${micOn ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {username} (You)
              </span>
            </div>

            {/* Screen Share */}
            {isScreenSharing && (
              <div className="bg-[#18181b] aspect-video rounded-3xl overflow-hidden border border-emerald-500/30 relative shadow-2xl flex items-center justify-center">
                <video
                  ref={(el) => { if (el && screenStream) el.srcObject = screenStream; }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
                <span className="absolute bottom-4 left-4 text-xs font-semibold bg-emerald-950/80 text-emerald-300 px-3 py-1 rounded-full border border-emerald-500/30 backdrop-blur-sm flex items-center gap-1.5">
                  <Tv size={14} /> Your Screen Share
                </span>
              </div>
            )}

            {/* Remote Peer Videos & Remote Screen Shares */}
            {remotePeerList.flatMap(peer => {
              const videoTracks = peer.stream.getVideoTracks();
              if (videoTracks.length <= 1) {
                return [
                  <div key={peer.socketId} className="bg-[#18181b] aspect-video rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
                    <RemoteVideoPlayer stream={peer.stream} />
                    <span className="absolute bottom-4 left-4 text-xs font-semibold bg-black/60 px-3 py-1 rounded-full border border-white/10 backdrop-blur-sm flex items-center gap-1.5 z-10">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      {peer.username}
                    </span>
                  </div>
                ];
              }
              return videoTracks.map((track, idx) => {
                const singleStream = new MediaStream([track, ...peer.stream.getAudioTracks()]);
                const isScreen = idx > 0;
                return (
                  <div key={`${peer.socketId}_${track.id}`} className={`bg-[#18181b] aspect-video rounded-3xl overflow-hidden ${isScreen ? 'border border-emerald-500/30' : 'border border-white/10'} relative shadow-2xl flex items-center justify-center`}>
                    <RemoteVideoPlayer stream={singleStream} />
                    <span className={`absolute bottom-4 left-4 text-xs font-semibold ${isScreen ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30' : 'bg-black/60 text-white border-white/10'} px-3 py-1 rounded-full border backdrop-blur-sm flex items-center gap-1.5 z-10`}>
                      {isScreen ? <Tv size={14} /> : <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />}
                      {peer.username} {isScreen ? "'s Screen Share" : ''}
                    </span>
                  </div>
                );
              });
            })}

            {/* Waiting placeholder (only when no remote peers) */}
            {remotePeerList.length === 0 && (
              <div className="bg-[#18181b] aspect-video rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className={`h-16 w-16 rounded-full flex items-center justify-center mx-auto border transition-all duration-300 ${
                    mockSpeakingUser === 'Partner'
                      ? 'bg-emerald-600/30 border-emerald-400 shadow-[0_0_12px_#10b981]'
                      : 'bg-white/5 border-white/10'
                  }`}>
                    <span className="text-lg font-bold text-white/70">P</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-white/60">Partner (Waiting to join...)</span>
                    <button
                      onClick={() => toggleMockSpeech('Partner')}
                      className={`text-[10px] mt-2 px-2.5 py-1 rounded-full font-semibold transition-all ${
                        mockSpeakingUser === 'Partner'
                          ? 'bg-emerald-600 text-white shadow-lg'
                          : 'bg-white/10 hover:bg-white/15 text-white/60 hover:text-white'
                      }`}
                    >
                      {mockSpeakingUser === 'Partner' ? 'Stop Speaking' : 'Test Speech Ducking'}
                    </button>
                  </div>
                </div>
                <span className="absolute bottom-4 left-4 text-xs font-semibold bg-black/60 px-3 py-1 rounded-full border border-white/10 backdrop-blur-sm">
                  Waiting for 2nd Tab / Partner...
                </span>
              </div>
            )}
          </div>

          {/* Emoji Reaction Menu */}
          {showReactionMenu && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-[#18181b]/95 border border-white/10 backdrop-blur-md py-2.5 px-4 rounded-2xl flex gap-3 shadow-2xl z-50">
              {['❤️', '😂', '👍', '😮', '👏', '🔥'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleTriggerReaction(emoji)}
                  className="text-2xl hover:scale-125 transition-transform active:scale-95 duration-200"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Bottom Toolbar */}
          <div className="h-20 flex justify-center items-center gap-3 md:gap-4 z-10 select-none">
            <button onClick={toggleMic} className={`p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${micOn ? 'bg-white/10 hover:bg-white/15 border-white/10 text-white' : 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-400'}`}>
              {micOn ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button onClick={toggleCam} className={`p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${camOn ? 'bg-white/10 hover:bg-white/15 border-white/10 text-white' : 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-400'}`}>
              {camOn ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
            <button onClick={toggleScreenShare} className={`p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${isScreenSharing ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Monitor size={20} />
            </button>
            <button onClick={() => setShowReactionMenu(!showReactionMenu)} className={`p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${showReactionMenu ? 'bg-fuchsia-600/20 border-fuchsia-500/30 text-fuchsia-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Smile size={20} />
            </button>
            <span className="w-[1px] h-6 bg-white/10 mx-2" />
            <button onClick={() => setActiveSidebar(activeSidebar === 'mixer' ? null : 'mixer')} className={`p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${activeSidebar === 'mixer' ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Sliders size={20} />
            </button>
            <button onClick={() => setActiveSidebar(activeSidebar === 'music' ? null : 'music')} className={`p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${activeSidebar === 'music' ? 'bg-fuchsia-600/20 border-fuchsia-500/30 text-fuchsia-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <Music size={20} />
            </button>
            <button onClick={() => setActiveSidebar(activeSidebar === 'chat' ? null : 'chat')} className={`p-3.5 rounded-2xl transition-all duration-300 border flex items-center justify-center active:scale-90 ${activeSidebar === 'chat' ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400' : 'bg-white/10 hover:bg-white/15 border-white/10 text-white'}`}>
              <MessageSquare size={20} />
            </button>
            <button onClick={handleLeaveCall} className="p-3.5 rounded-2xl bg-red-600 hover:bg-red-500 text-white transition-all active:scale-90 duration-300 shadow-lg shadow-red-950/40">
              <PhoneOff size={20} />
            </button>
          </div>
        </div>

        {/* Sidebars */}
        {activeSidebar === 'chat' && <ChatSidebar />}
        {activeSidebar === 'music' && <PlaylistSidebar onStartScreenShare={toggleScreenShare} />}
        {activeSidebar === 'mixer' && <AudioMixerPanel />}
      </div>
    </div>
  );
};

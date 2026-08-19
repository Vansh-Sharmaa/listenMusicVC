'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  createdAt: string;
}

interface Participant {
  userId: string;
  username: string;
  joinedAt: string;
}

interface MusicState {
  currentTrackId: string | null;
  isPlaying: boolean;
  lastPosition: number;
  lastPositionUpdatedAt: string | number;
  stateVersion?: number;
  updatedBy?: string;
  currentTrack?: {
    id: string;
    title: string;
    artist: string;
    url: string;
    duration: number;
    isRoyaltyFree?: boolean;
    thumbnail?: string;
  } | null;
  queue?: any[];
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinRoom: (roomId: string, userId: string, username: string) => void;
  sendChatMessage: (message: string) => void;
  sendReaction: (emoji: string) => void;
  sendMusicAction: (
    action: 'play' | 'pause' | 'seek' | 'change' | 'queue-add' | 'queue-remove' | 'queue-pop',
    trackId?: string | null,
    position?: number,
    trackData?: { id: string; title: string; artist: string; url: string; duration: number; isRoyaltyFree?: boolean } | null
  ) => void;
  chatMessages: ChatMessage[];
  participants: Participant[];
  musicState: MusicState;
  clockOffset: number;
  getServerTime: () => number;
  activeReaction: { userId: string; username: string; emoji: string; id: number } | null;
  roomName: string;
  hostId: string | null;
  isHost: boolean;
  djPasscode: string | null;
  isDjAuthorized: boolean;
  unlockDj: (passcode: string) => void;
  regenerateDjPin: () => void;
  unlockError: string | null;
  unlockSuccess: string | null;
  clearUnlockError: () => void;
  permissionError: string | null;
  clearPermissionError: () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomName, setRoomName] = useState<string>('');
  const [hostId, setHostId] = useState<string | null>(null);
  const [djPasscode, setDjPasscode] = useState<string | null>(null);
  const [isDjAuthorizedState, setIsDjAuthorizedState] = useState<boolean>(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockSuccess, setUnlockSuccess] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [activeReaction, setActiveReaction] = useState<SocketContextType['activeReaction']>(null);
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [musicState, setMusicState] = useState<MusicState>({
    currentTrackId: null,
    isPlaying: false,
    lastPosition: 0.0,
    lastPositionUpdatedAt: 0,
    queue: []
  });

  const isHost = Boolean(hostId && myUserId && hostId === myUserId);
  const isDjAuthorized = isHost || isDjAuthorizedState;
  const clearPermissionError = useCallback(() => setPermissionError(null), []);
  const clearUnlockError = useCallback(() => {
    setUnlockError(null);
    setUnlockSuccess(null);
  }, []);

  // Use ref for socket so all callbacks always have latest socket reference
  // Also track as state so consumers can react to socket being available
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const pendingRoomJoinRef = useRef<{ roomId: string; userId: string; username: string } | null>(null);
  const offsetsRef = useRef<number[]>([]);

  const getServerTime = useCallback(() => Date.now() + clockOffset, [clockOffset]);

  const emitRoomJoin = useCallback((sock: Socket, roomId: string, userId: string, username: string) => {
    console.log(`[Socket] Emitting room:join for ${username} in room ${roomId}`);
    sock.emit('room:join', { roomId, userId, username });
  }, []);

  useEffect(() => {
    const socketUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
    console.log(`[Socket] Connecting to ${socketUrl}`);

    const sock = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    socketRef.current = sock;
    setSocket(sock);

    sock.on('connect', () => {
      console.log(`[Socket] Connected: ${sock.id}`);
      setIsConnected(true);
      setSocket(sock); // ensure consumers see the connected socket
      // Sync clock immediately
      sock.emit('music:sync-ping', { clientTimestamp: Date.now() });
      // If joinRoom was called before socket connected, re-emit now
      if (pendingRoomJoinRef.current) {
        const { roomId, userId, username } = pendingRoomJoinRef.current;
        emitRoomJoin(sock, roomId, userId, username);
      }
    });

    sock.on('disconnect', (reason) => {
      console.log(`[Socket] Disconnected: ${reason}`);
      setIsConnected(false);
    });

    sock.on('connect_error', (err) => {
      console.error(`[Socket] Connection error: ${err.message}`);
    });

    // NTP clock sync
    sock.on('music:sync-pong', (payload: { clientTimestamp: number; serverTimestamp: number }) => {
      const now = Date.now();
      const rtt = now - payload.clientTimestamp;
      const offset = payload.serverTimestamp - (now - rtt / 2);
      offsetsRef.current.push(offset);
      if (offsetsRef.current.length > 5) offsetsRef.current.shift();
      const avgOffset = Math.round(
        offsetsRef.current.reduce((sum, o) => sum + o, 0) / offsetsRef.current.length
      );
      setClockOffset(avgOffset);
    });

    // Room joined confirmation
    sock.on('room:joined', (payload: {
      roomName: string;
      hostId?: string;
      djPasscode?: string;
      isDjAuthorized?: boolean;
      participants: any[];
      musicState: any;
      chatHistory: ChatMessage[];
    }) => {
      console.log(`[Socket] room:joined - name: "${payload.roomName}", hostId: "${payload.hostId}", isDj: ${payload.isDjAuthorized}`);
      setRoomName(payload.roomName || '');
      if (payload.hostId) {
        setHostId(payload.hostId);
      }
      if (payload.djPasscode) {
        setDjPasscode(payload.djPasscode);
      }
      if (payload.isDjAuthorized !== undefined) {
        setIsDjAuthorizedState(payload.isDjAuthorized);
      }
      setChatMessages(payload.chatHistory || []);
      if (payload.participants) {
        setParticipants(payload.participants.map(p => ({
          userId: p.userId,
          username: p.user?.username || p.username || 'Unknown',
          joinedAt: p.joinedAt,
        })));
      }
      if (payload.musicState) {
        setMusicState(payload.musicState);
      }
    });

    // Host promotion & updates
    sock.on('room:host-promoted', (payload: { hostId: string; djPasscode: string; isHost: boolean; isDjAuthorized: boolean }) => {
      console.log(`[Socket] Promoted to Host! Passcode:`, payload.djPasscode);
      setHostId(payload.hostId);
      if (payload.djPasscode) setDjPasscode(payload.djPasscode);
      setIsDjAuthorizedState(true);
    });

    sock.on('room:host-updated', (payload: { hostId: string; hostUsername?: string }) => {
      console.log(`[Socket] Room host updated to:`, payload.hostId);
      setHostId(payload.hostId);
    });

    // DJ PIN Unlock & Revoke responses
    sock.on('room:dj-unlocked', (payload: { isDjAuthorized: boolean; message: string }) => {
      console.log(`[Socket] DJ access unlocked!`, payload);
      setIsDjAuthorizedState(true);
      setUnlockSuccess(payload.message || '🎉 DJ Access Unlocked!');
      setUnlockError(null);
      setTimeout(() => setUnlockSuccess(null), 5000);
    });

    sock.on('room:dj-unlock-failed', (payload: { message: string }) => {
      console.warn(`[Socket] DJ unlock failed:`, payload.message);
      setUnlockError(payload.message || 'Incorrect 4-digit DJ PIN.');
      setUnlockSuccess(null);
    });

    sock.on('room:pin-regenerated', (payload: { djPasscode: string }) => {
      console.log(`[Socket] New DJ PIN received:`, payload.djPasscode);
      setDjPasscode(payload.djPasscode);
      setUnlockSuccess('🔄 New random DJ Passcode generated!');
      setTimeout(() => setUnlockSuccess(null), 4000);
    });

    sock.on('room:dj-revoked', (payload: { message: string }) => {
      console.log(`[Socket] DJ access revoked - PIN changed`);
      setIsDjAuthorizedState(false);
      setPermissionError(payload.message || 'DJ PIN has changed.');
      setTimeout(() => setPermissionError(null), 5000);
    });

    // Permission denied on music actions (if non-host tries to change track)
    sock.on('music:permission-denied', (payload: { message: string; action?: string }) => {
      console.warn(`[Socket] Music permission denied:`, payload.message);
      setPermissionError(payload.message || 'Only the room creator / admin can change the music.');
      setTimeout(() => setPermissionError(null), 4000);
    });

    // User joined/left notifications
    sock.on('room:user-joined', (payload: { userId: string; username: string; joinedAt: string }) => {
      console.log(`[Socket] User joined: ${payload.username}`);
      setParticipants(prev => {
        if (prev.some(p => p.userId === payload.userId)) return prev;
        return [...prev, payload];
      });
      setChatMessages(prev => [...prev, {
        id: `sys-${Date.now()}`,
        userId: 'system',
        username: 'System',
        message: `${payload.username} joined the call.`,
        createdAt: new Date().toISOString()
      }]);
    });

    sock.on('room:user-left', (payload: { userId: string; username: string }) => {
      console.log(`[Socket] User left: ${payload.username}`);
      setParticipants(prev => prev.filter(p => p.userId !== payload.userId));
      setChatMessages(prev => [...prev, {
        id: `sys-${Date.now()}`,
        userId: 'system',
        username: 'System',
        message: `${payload.username} left the call.`,
        createdAt: new Date().toISOString()
      }]);
    });

    // Chat
    sock.on('chat:message', (payload: ChatMessage) => {
      setChatMessages(prev => [...prev, payload]);
    });

    // Reactions
    sock.on('reaction:broadcast', (payload: { userId: string; username: string; emoji: string }) => {
      setActiveReaction({ ...payload, id: Date.now() });
    });

    // Music state changes (Authoritative Server Events)
    sock.on('music:state-change', (payload: {
      action: 'play' | 'pause' | 'seek' | 'change' | 'queue-add' | 'queue-remove' | 'queue-pop';
      trackId: string | null;
      position?: number;
      isPlaying?: boolean;
      trackData?: any;
      queue?: any[];
      timestamp: number;
      stateVersion?: number;
      updatedBy?: string;
    }) => {
      setMusicState(prev => {
        // Discard stale out-of-order state events
        if (payload.stateVersion && prev.stateVersion && payload.stateVersion < prev.stateVersion) {
          console.warn(`[Sync] Discarding stale music event (received v${payload.stateVersion} < current v${prev.stateVersion})`);
          return prev;
        }

        const next = { ...prev };
        if (payload.trackId !== undefined) next.currentTrackId = payload.trackId;
        if (payload.isPlaying !== undefined) next.isPlaying = payload.isPlaying;
        if (payload.position !== undefined) next.lastPosition = payload.position;
        if (payload.trackData !== undefined) next.currentTrack = payload.trackData;
        if (payload.queue !== undefined) next.queue = payload.queue;
        next.lastPositionUpdatedAt = payload.timestamp;
        next.stateVersion = payload.stateVersion || Date.now();
        next.updatedBy = payload.updatedBy;

        if (payload.action === 'change') {
          next.isPlaying = false;
          next.lastPosition = 0.0;
        }
        return next;
      });
    });

    // Periodic clock sync
    const syncInterval = setInterval(() => {
      if (sock.connected) {
        sock.emit('music:sync-ping', { clientTimestamp: Date.now() });
      }
    }, 15000);

    return () => {
      clearInterval(syncInterval);
      sock.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [emitRoomJoin]);

  const joinRoom = useCallback((roomId: string, userId: string, username: string) => {
    roomIdRef.current = roomId;
    setMyUserId(userId);
    const sock = socketRef.current;
    if (sock && isConnected) {
      emitRoomJoin(sock, roomId, userId, username);
    } else {
      pendingRoomJoinRef.current = { roomId, userId, username };
    }
  }, [isConnected, emitRoomJoin]);

  const sendChatMessage = useCallback((message: string) => {
    const sock = socketRef.current;
    if (!sock || !roomIdRef.current) return;
    sock.emit('chat:send', { roomId: roomIdRef.current, message });
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    const sock = socketRef.current;
    if (!sock || !roomIdRef.current) return;
    sock.emit('reaction:send', { roomId: roomIdRef.current, emoji });
    setActiveReaction({ userId: 'me', username: 'Me', emoji, id: Date.now() });
  }, []);

  const sendMusicAction = useCallback((
    action: 'play' | 'pause' | 'seek' | 'change' | 'queue-add' | 'queue-remove' | 'queue-pop',
    trackId?: string | null,
    position?: number,
    trackData?: { id: string; title: string; artist: string; url: string; duration: number; isRoyaltyFree?: boolean; thumbnail?: string } | null
  ) => {
    const sock = socketRef.current;
    if (!sock || !roomIdRef.current) return;

    setMusicState(prev => {
      const next = { ...prev };
      if (trackData !== undefined) next.currentTrack = trackData;
      if (action === 'change' && trackId !== undefined) {
        next.currentTrackId = trackId;
        next.isPlaying = false;
        next.lastPosition = 0.0;
      } else if (action === 'play') {
        next.isPlaying = true;
        if (position !== undefined) next.lastPosition = position;
      } else if (action === 'pause') {
        next.isPlaying = false;
        if (position !== undefined) next.lastPosition = position;
      } else if (action === 'seek' && position !== undefined) {
        next.lastPosition = position;
      }
      next.lastPositionUpdatedAt = Date.now();
      return next;
    });

    sock.emit('music:action', {
      roomId: roomIdRef.current,
      action,
      trackId,
      position,
      trackData,
      timestamp: Date.now()
    });
  }, []);

  const unlockDj = useCallback((passcode: string) => {
    const sock = socketRef.current;
    if (sock && roomIdRef.current) {
      setUnlockError(null);
      sock.emit('room:unlock-dj', {
        roomId: roomIdRef.current,
        passcode: passcode.trim()
      });
    }
  }, []);

  const regenerateDjPin = useCallback(() => {
    const sock = socketRef.current;
    if (sock && roomIdRef.current) {
      sock.emit('room:regenerate-dj-pin', {
        roomId: roomIdRef.current
      });
    }
  }, []);

  // Expose socket as state (triggers re-renders in consumers on connect/disconnect)
  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        joinRoom,
        sendChatMessage,
        sendReaction,
        sendMusicAction,
        chatMessages,
        participants,
        musicState,
        clockOffset,
        getServerTime,
        activeReaction,
        roomName,
        hostId,
        isHost,
        djPasscode,
        isDjAuthorized,
        unlockDj,
        regenerateDjPin,
        unlockError,
        unlockSuccess,
        clearUnlockError,
        permissionError,
        clearPermissionError
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

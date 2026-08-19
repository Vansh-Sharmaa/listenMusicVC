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
  currentTrack?: {
    id: string;
    title: string;
    artist: string;
    url: string;
    duration: number;
    isRoyaltyFree?: boolean;
    thumbnail?: string;
  } | null;
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinRoom: (roomId: string, userId: string, username: string) => void;
  sendChatMessage: (message: string) => void;
  sendReaction: (emoji: string) => void;
  sendMusicAction: (
    action: 'play' | 'pause' | 'seek' | 'change',
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
  const [activeReaction, setActiveReaction] = useState<SocketContextType['activeReaction']>(null);
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [musicState, setMusicState] = useState<MusicState>({
    currentTrackId: null,
    isPlaying: false,
    lastPosition: 0.0,
    lastPositionUpdatedAt: 0
  });

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
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });

    socketRef.current = sock;
    setSocket(sock);

    sock.on('connect', () => {
      console.log(`[Socket] Connected: ${sock.id}`);
      setIsConnected(true);
      setSocket(sock); // ensure consumers see the connected socket
      // Sync clock
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
      participants: any[];
      musicState: any;
      chatHistory: ChatMessage[];
    }) => {
      console.log(`[Socket] room:joined - name: "${payload.roomName}", participants: ${payload.participants?.length}`);
      setRoomName(payload.roomName || '');
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

    // Music state changes
    sock.on('music:state-change', (payload: {
      action: 'play' | 'pause' | 'seek' | 'change';
      trackId: string | null;
      position?: number;
      isPlaying?: boolean;
      trackData?: any;
      timestamp: number;
    }) => {
      setMusicState(prev => {
        const next = { ...prev };
        if (payload.trackId !== undefined) next.currentTrackId = payload.trackId;
        if (payload.isPlaying !== undefined) next.isPlaying = payload.isPlaying;
        if (payload.position !== undefined) next.lastPosition = payload.position;
        if (payload.trackData !== undefined) next.currentTrack = payload.trackData;
        next.lastPositionUpdatedAt = payload.timestamp;
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
    console.log(`[Socket] joinRoom: ${username} → ${roomId}`);
    pendingRoomJoinRef.current = { roomId, userId, username };
    roomIdRef.current = roomId;

    const sock = socketRef.current;
    if (sock && sock.connected) {
      emitRoomJoin(sock, roomId, userId, username);
    } else {
      console.log('[Socket] Socket not connected yet - will emit room:join on connect');
    }
  }, [emitRoomJoin]);

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
    action: 'play' | 'pause' | 'seek' | 'change',
    trackId?: string | null,
    position?: number,
    trackData?: { id: string; title: string; artist: string; url: string; duration: number; isRoyaltyFree?: boolean } | null
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
        roomName
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

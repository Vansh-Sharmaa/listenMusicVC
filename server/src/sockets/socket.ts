import { Server, Socket } from 'socket.io';
import { db } from '../db/db';
import { cache } from '../db/redis';

export function setupSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    let currentRoomId: string | null = null;
    let currentUserId: string | null = null;
    let currentUsername: string | null = null;

    console.log(`Socket connected: ${socket.id}`);

    // NTP-style clock synchronization event
    socket.on('music:sync-ping', (payload: { clientTimestamp: number }) => {
      socket.emit('music:sync-pong', {
        clientTimestamp: payload.clientTimestamp,
        serverTimestamp: Date.now()
      });
    });

    // Handle user joining a call room
    socket.on('room:join', async (payload: { roomId: string; userId: string; username: string }) => {
      const { roomId, userId, username } = payload;
      currentRoomId = roomId;
      currentUserId = userId;
      currentUsername = username;

      console.log(`User ${username} (${userId}) joining room: ${roomId}`);
      
      socket.join(roomId);

      try {
        // Save membership in database
        const room = await db.joinRoom(roomId, userId, username);
        
        // Fetch active music state
        const musicState = await db.getRoomMusicState(roomId);

        // Fetch past chat history
        const chatHistory = await db.getChatMessages(roomId);

        // Collect active socket IDs in the room for WebRTC P2P mesh
        const socketRoom = io.sockets.adapter.rooms.get(roomId);
        const existingSockets: { socketId: string; userId: string; username: string }[] = [];
        if (socketRoom) {
          for (const sId of socketRoom) {
            if (sId !== socket.id) {
              const targetSock = io.sockets.sockets.get(sId);
              existingSockets.push({
                socketId: sId,
                userId: (targetSock as any)?.data?.userId || 'unknown',
                username: (targetSock as any)?.data?.username || 'Participant'
              });
            }
          }
        }
        (socket as any).data = { userId, username, roomId };

        // Send room state confirmation
        socket.emit('room:joined', {
          roomName: room?.name,
          participants: room?.participants || [],
          musicState,
          chatHistory,
          existingSockets
        });

        // Emit dedicated WebRTC signaling peer events
        socket.emit('webrtc:peer-list', { peers: existingSockets });

        socket.to(roomId).emit('webrtc:peer-joined', {
          socketId: socket.id,
          userId,
          username
        });

        // Broadcast user joined for chat notification
        socket.to(roomId).emit('room:user-joined', {
          userId,
          username,
          socketId: socket.id,
          joinedAt: new Date()
        });

        // Cache active user ID list in Redis (non-blocking)
        const cachedUsers = await cache.get(`room:${roomId}:users`);
        const userList = cachedUsers ? JSON.parse(cachedUsers) : [];
        if (!userList.includes(userId)) {
          userList.push(userId);
          await cache.set(`room:${roomId}:users`, JSON.stringify(userList), 86400);
        }

      } catch (error) {
        console.error('Error handling room join:', error);
      }
    });

    // Handle chat message sending
    socket.on('chat:send', async (payload: { roomId: string; message: string }) => {
      const { roomId, message } = payload;
      if (!currentUserId) return;

      try {
        const savedMsg = await db.saveChatMessage(roomId, currentUserId, message);
        io.to(roomId).emit('chat:message', {
          id: savedMsg.id,
          userId: savedMsg.userId,
          username: currentUsername || 'Unknown User',
          message: savedMsg.message,
          createdAt: savedMsg.createdAt
        });
      } catch (error) {
        console.error('Error saving/broadcasting chat message:', error);
      }
    });

    // Handle emoji reaction broadcasting
    socket.on('reaction:send', (payload: { roomId: string; emoji: string }) => {
      const { roomId, emoji } = payload;
      if (!currentUserId) return;

      // Broadcast to everyone else in the room
      socket.to(roomId).emit('reaction:broadcast', {
        userId: currentUserId,
        username: currentUsername || 'Unknown User',
        emoji
      });
    });

    // Handle WebRTC P2P signaling
    socket.on('webrtc:offer', (payload: { targetSocketId: string; offer: any }) => {
      io.to(payload.targetSocketId).emit('webrtc:offer', {
        offer: payload.offer,
        senderSocketId: socket.id,
        senderUserId: currentUserId,
        senderUsername: currentUsername
      });
    });

    socket.on('webrtc:answer', (payload: { targetSocketId: string; answer: any }) => {
      io.to(payload.targetSocketId).emit('webrtc:answer', {
        answer: payload.answer,
        senderSocketId: socket.id
      });
    });

    socket.on('webrtc:ice-candidate', (payload: { targetSocketId: string; candidate: any }) => {
      io.to(payload.targetSocketId).emit('webrtc:ice-candidate', {
        candidate: payload.candidate,
        senderSocketId: socket.id
      });
    });

    // Handle synchronized music actions
    socket.on('music:action', async (payload: {
      roomId: string;
      action: 'play' | 'pause' | 'seek' | 'change';
      trackId?: string | null;
      position?: number;
      timestamp?: number;
      trackData?: any;
    }) => {
      const { roomId, action, trackId, position, trackData } = payload;
      if (!roomId) return;

      try {
        const currentServerState = await db.getRoomMusicState(roomId);
        const serverNow = Date.now();

        // Calculate authoritative current playback position based on server clock
        let calculatedPosition = position;
        if (calculatedPosition === undefined) {
          if (currentServerState) {
            const elapsed = currentServerState.isPlaying
              ? (serverNow - Number(currentServerState.lastPositionUpdatedAt || serverNow)) / 1000
              : 0;
            calculatedPosition = Math.max(0, (currentServerState.lastPosition || 0) + elapsed);
          } else {
            calculatedPosition = 0;
          }
        }

        let updatedState: any = null;
        if (action === 'change') {
          updatedState = await db.updateRoomMusicState(roomId, {
            currentTrackId: trackId,
            isPlaying: true,
            lastPosition: 0.0,
            trackData,
            updatedBy: currentUserId || socket.id
          });
        } else if (action === 'play') {
          updatedState = await db.updateRoomMusicState(roomId, {
            currentTrackId: trackId || currentServerState?.currentTrackId,
            isPlaying: true,
            lastPosition: calculatedPosition,
            trackData: trackData || currentServerState?.currentTrack,
            updatedBy: currentUserId || socket.id
          });
        } else if (action === 'pause') {
          updatedState = await db.updateRoomMusicState(roomId, {
            currentTrackId: trackId || currentServerState?.currentTrackId,
            isPlaying: false,
            lastPosition: calculatedPosition,
            trackData: trackData || currentServerState?.currentTrack,
            updatedBy: currentUserId || socket.id
          });
        } else if (action === 'seek') {
          updatedState = await db.updateRoomMusicState(roomId, {
            currentTrackId: trackId || currentServerState?.currentTrackId,
            lastPosition: calculatedPosition,
            trackData: trackData || currentServerState?.currentTrack,
            updatedBy: currentUserId || socket.id
          });
        }

        const finalState = updatedState || currentServerState;

        // Broadcast authoritative music state change with monotonic stateVersion & server timestamp
        io.to(roomId).emit('music:state-change', {
          action,
          trackId: finalState?.currentTrackId || trackId,
          position: finalState?.lastPosition !== undefined ? finalState.lastPosition : calculatedPosition,
          isPlaying: finalState?.isPlaying,
          trackData: finalState?.currentTrack || trackData,
          timestamp: serverNow,
          stateVersion: finalState?.stateVersion || Date.now(),
          updatedBy: currentUserId || socket.id
        });

      } catch (error) {
        console.error('Error handling server authoritative music action:', error);
      }
    });

    // Handle user disconnect
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (currentRoomId && currentUserId) {
        try {
          await db.leaveRoom(currentRoomId, currentUserId);
          
          socket.to(currentRoomId).emit('room:user-left', {
            userId: currentUserId,
            username: currentUsername,
            socketId: socket.id
          });

          // Update Redis user list cache
          const cachedUsers = await cache.get(`room:${currentRoomId}:users`);
          if (cachedUsers) {
            const userList = JSON.parse(cachedUsers).filter((uid: string) => uid !== currentUserId);
            await cache.set(`room:${currentRoomId}:users`, JSON.stringify(userList), 86400);
          }
        } catch (error) {
          console.error('Error handling disconnect room cleanup:', error);
        }
      }
    });
  });
}

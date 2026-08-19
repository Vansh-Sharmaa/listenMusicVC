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
        let room = await db.joinRoom(roomId, userId, username);
        
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

        // If this user is the first/only person in the room OR host is inactive, assign this user as Host
        const isHostActiveInRoom = room?.hostId && (room.hostId === userId || existingSockets.some(s => s.userId === room.hostId));
        if (!isHostActiveInRoom || !room?.hostId) {
          room = await db.setRoomHost(roomId, userId);
        }

        const isHost = Boolean(room?.hostId && room.hostId === userId);
        const djPasscode = isHost ? db.generateNewDjPasscode(roomId, userId) : undefined;
        const isDjAuthorized = isHost;

        // Initialize participant media state (Camera OFF, Mic OFF by default)
        const initialMediaState = db.updateParticipantMediaState(roomId, userId, {
          cameraEnabled: false,
          microphoneEnabled: false,
          speaking: false,
          screenSharing: false
        });

        console.log(`[Room Join] User "${username}" (${userId}) joined room "${roomId}". isHost: ${isHost}, hostId: "${room?.hostId}", djPasscode: "${djPasscode}"`);

        // Send room state confirmation (includes all participant media states)
        socket.emit('room:joined', {
          roomName: room?.name,
          hostId: room?.hostId,
          djPasscode,
          isDjAuthorized,
          participants: room?.participants || [],
          participantMediaStates: db.getParticipantMediaStates(roomId),
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

        // Broadcast initial media state to all other participants
        socket.to(roomId).emit('participant:media-state-updated', {
          userId,
          ...initialMediaState
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

    // Handle unlocking DJ permissions using 4-digit PIN
    socket.on('room:unlock-dj', async (payload: { roomId: string; passcode: string }) => {
      const { roomId, passcode } = payload;
      const targetUserId = currentUserId || (socket as any)?.data?.userId;
      if (!roomId || !targetUserId || !passcode) return;

      try {
        const isSuccess = await db.authorizeDjUser(roomId, targetUserId, passcode);
        if (isSuccess) {
          console.log(`[DJ Unlocked] User ${currentUsername} (${targetUserId}) unlocked DJ access in room ${roomId}`);
          socket.emit('room:dj-unlocked', {
            isDjAuthorized: true,
            message: '🎉 DJ Access Unlocked! You can now change songs, search music, and control playback.'
          });

          // Broadcast system message in chat
          io.to(roomId).emit('chat:message', {
            id: `sys-${Date.now()}`,
            userId: 'system',
            username: 'System',
            message: `🔑 ${currentUsername || 'A participant'} entered the DJ PIN and unlocked music controls!`,
            createdAt: new Date().toISOString()
          });
        } else {
          socket.emit('room:dj-unlock-failed', {
            message: '❌ Incorrect 4-digit DJ PIN. Please ask the room host for the correct code.'
          });
        }
      } catch (error) {
        console.error('Error unlocking DJ access:', error);
      }
    });

    // Handle Host regenerating new random DJ PIN
    socket.on('room:regenerate-dj-pin', async (payload: { roomId: string }) => {
      const { roomId } = payload;
      const requesterId = currentUserId || (socket as any)?.data?.userId;
      if (!roomId || !requesterId) return;

      try {
        const room = await db.getRoom(roomId);
        if (room?.hostId === requesterId) {
          const newPasscode = db.generateNewDjPasscode(roomId, requesterId);
          console.log(`[PIN Regenerated] Host ${currentUsername} regenerated PIN for room ${roomId}: ${newPasscode}`);

          // Emit new PIN to host
          socket.emit('room:pin-regenerated', { djPasscode: newPasscode });

          // Revoke non-hosts
          socket.to(roomId).emit('room:dj-revoked', {
            message: 'The room host has generated a new random DJ Passcode. Please enter the new PIN to control music.'
          });

          // Chat notification
          io.to(roomId).emit('chat:message', {
            id: `sys-${Date.now()}`,
            userId: 'system',
            username: 'System',
            message: `🔄 The room host generated a new random DJ Passcode.`,
            createdAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Error regenerating DJ PIN:', error);
      }
    });

    // Real-time participant media state change (Camera ON/OFF, Mic ON/OFF, Screen Sharing)
    socket.on('participant:media-state', (payload: {
      roomId: string;
      cameraEnabled?: boolean;
      microphoneEnabled?: boolean;
      screenSharing?: boolean;
    }) => {
      const { roomId, cameraEnabled, microphoneEnabled, screenSharing } = payload;
      const targetUserId = currentUserId || (socket as any)?.data?.userId;
      if (!roomId || !targetUserId) return;

      const updateData: any = {};
      if (cameraEnabled !== undefined) updateData.cameraEnabled = cameraEnabled;
      if (microphoneEnabled !== undefined) {
        updateData.microphoneEnabled = microphoneEnabled;
        if (!microphoneEnabled) {
          updateData.speaking = false; // Microphone OFF overrides speaking
        }
      }
      if (screenSharing !== undefined) updateData.screenSharing = screenSharing;

      const updated = db.updateParticipantMediaState(roomId, targetUserId, updateData);

      io.to(roomId).emit('participant:media-state-updated', {
        userId: targetUserId,
        ...updated
      });
    });

    // Real-time speaking detection broadcast (Discord-like speech indicator)
    socket.on('participant:speaking', (payload: { roomId: string; speaking: boolean }) => {
      const { roomId, speaking } = payload;
      const targetUserId = currentUserId || (socket as any)?.data?.userId;
      if (!roomId || !targetUserId) return;

      const states = db.getParticipantMediaStates(roomId);
      const userMedia = states[targetUserId];
      const isMicOn = userMedia ? userMedia.microphoneEnabled : false;
      const actualSpeaking = isMicOn && Boolean(speaking);

      db.updateParticipantMediaState(roomId, targetUserId, { speaking: actualSpeaking });

      io.to(roomId).emit('participant:speaking-updated', {
        userId: targetUserId,
        speaking: actualSpeaking
      });
    });

    // Handle synchronized music actions
    socket.on('music:action', async (payload: {
      roomId: string;
      action: 'play' | 'pause' | 'seek' | 'change' | 'queue-add' | 'queue-remove' | 'queue-pop';
      trackId?: string | null;
      position?: number;
      timestamp?: number;
      trackData?: any;
    }) => {
      const { roomId, action, trackId, position, trackData } = payload;
      if (!roomId) return;

      try {
        // Enforce Host or PIN-Authorized DJ Permission Check
        const requesterId = currentUserId || (socket as any)?.data?.userId;
        const isAuthorized = await db.isDjAuthorized(roomId, requesterId);

        if (!isAuthorized) {
          console.warn(`[Music Permission Denied] User ${currentUsername} (${requesterId}) is not authorized as DJ in room ${roomId}`);
          socket.emit('music:permission-denied', {
            message: 'Only the room creator (Host) or users with the 4-digit DJ PIN can change or control the music.',
            action
          });
          return;
        }

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
        } else if (action === 'queue-add') {
          const newQueue = [...(currentServerState?.queue || []), trackData];
          updatedState = await db.updateRoomMusicState(roomId, {
            queue: newQueue,
            updatedBy: currentUserId || socket.id
          });
        } else if (action === 'queue-remove') {
          const newQueue = (currentServerState?.queue || []).filter((t: any) => t.id !== trackId);
          updatedState = await db.updateRoomMusicState(roomId, {
            queue: newQueue,
            updatedBy: currentUserId || socket.id
          });
        } else if (action === 'queue-pop') {
          const newQueue = [...(currentServerState?.queue || [])];
          const nextTrack = newQueue.shift();
          if (nextTrack) {
            updatedState = await db.updateRoomMusicState(roomId, {
              currentTrackId: nextTrack.id,
              isPlaying: true,
              lastPosition: 0.0,
              trackData: nextTrack,
              queue: newQueue,
              updatedBy: currentUserId || socket.id
            });
          } else {
            updatedState = currentServerState; // nothing to pop
          }
        }

        const finalState = updatedState || currentServerState;

        // Broadcast authoritative music state change with monotonic stateVersion & server timestamp
        io.to(roomId).emit('music:state-change', {
          action,
          trackId: finalState?.currentTrackId || trackId,
          position: finalState?.lastPosition !== undefined ? finalState.lastPosition : calculatedPosition,
          isPlaying: finalState?.isPlaying,
          trackData: finalState?.currentTrack || trackData,
          queue: finalState?.queue || [],
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
          db.removeParticipantMediaState(currentRoomId, currentUserId);
          
          socket.to(currentRoomId).emit('room:user-left', {
            userId: currentUserId,
            username: currentUsername,
            socketId: socket.id
          });

          socket.to(currentRoomId).emit('participant:media-state-removed', {
            userId: currentUserId
          });

          // If the disconnected user was the host, promote the next active user to Host
          const room = await db.getRoom(currentRoomId);
          if (room?.hostId === currentUserId) {
            const socketRoom = io.sockets.adapter.rooms.get(currentRoomId);
            if (socketRoom && socketRoom.size > 0) {
              const nextSocketId = Array.from(socketRoom)[0];
              const nextSocket = io.sockets.sockets.get(nextSocketId);
              const nextUserId = (nextSocket as any)?.data?.userId;
              const nextUsername = (nextSocket as any)?.data?.username;
              if (nextUserId) {
                await db.setRoomHost(currentRoomId, nextUserId);
                const newPasscode = db.getDjPasscode(currentRoomId);
                console.log(`[Host Promoted] User ${nextUsername} (${nextUserId}) promoted to Host in room ${currentRoomId}. New PIN: ${newPasscode}`);

                nextSocket?.emit('room:host-promoted', {
                  hostId: nextUserId,
                  djPasscode: newPasscode,
                  isHost: true,
                  isDjAuthorized: true
                });

                io.to(currentRoomId).emit('room:host-updated', {
                  hostId: nextUserId,
                  hostUsername: nextUsername
                });
              }
            }
          }

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

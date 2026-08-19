import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

// In-memory data store for fallback
class MockDatabase {
  users = new Map<string, any>();
  rooms = new Map<string, any>();
  participants = new Map<string, any[]>();
  messages = new Map<string, any[]>();
  tracks = new Map<string, any>();
  roomMusicStates = new Map<string, any>();
  roomQueues = new Map<string, any[]>();
  roomDjPasscodes = new Map<string, string>();
  roomAuthorizedDjs = new Map<string, Set<string>>();
  roomParticipantMedia = new Map<string, Map<string, { cameraEnabled: boolean; microphoneEnabled: boolean; speaking: boolean; screenSharing: boolean }>>();

  constructor() {
    // Seed some royalty-free music tracks
    const sampleTracks = [
      {
        id: 'rf-1',
        title: 'SoundHelix Song 1',
        artist: 'SoundHelix',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        duration: 372, // 6:12
        isRoyaltyFree: true,
        uploadedById: null,
        createdAt: new Date(),
      },
      {
        id: 'rf-2',
        title: 'SoundHelix Song 2',
        artist: 'SoundHelix',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        duration: 425, // 7:05
        isRoyaltyFree: true,
        uploadedById: null,
        createdAt: new Date(),
      },
      {
        id: 'rf-3',
        title: 'SoundHelix Song 3',
        artist: 'SoundHelix',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
        duration: 302, // 5:02
        isRoyaltyFree: true,
        uploadedById: null,
        createdAt: new Date(),
      }
    ];
    sampleTracks.forEach(t => this.tracks.set(t.id, t));
  }

  async createUser(username: string, avatarUrl?: string) {
    const user = {
      id: randomUUID(),
      username,
      avatarUrl: avatarUrl || null,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUser(id: string) {
    return this.users.get(id) || null;
  }

  async createRoom(name: string, hostId: string) {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'room';
    // If room with this slug already exists, reuse it or append short suffix
    let roomId = slug;
    if (this.rooms.has(roomId)) {
      // Reuse existing room if host or active
      return this.getRoom(roomId);
    }

    const room = {
      id: roomId,
      name,
      hostId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rooms.set(room.id, room);
    this.participants.set(room.id, []);
    this.messages.set(room.id, []);
    
    // Generate 4-digit DJ passcode
    if (!this.roomDjPasscodes.has(roomId)) {
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      this.roomDjPasscodes.set(roomId, code);
      this.roomAuthorizedDjs.set(roomId, new Set([hostId]));
    } else {
      const djs = this.roomAuthorizedDjs.get(roomId) || new Set<string>();
      djs.add(hostId);
      this.roomAuthorizedDjs.set(roomId, djs);
    }
    
    // Initialize music state
    const musicState = {
      id: randomUUID(),
      roomId: room.id,
      currentTrackId: null,
      isPlaying: false,
      lastPosition: 0.0,
      lastPositionUpdatedAt: new Date(),
      updatedAt: new Date(),
    };
    this.roomMusicStates.set(room.id, musicState);
    this.roomQueues.set(room.id, []);
    return { ...room, musicState: { ...musicState, queue: [] } };
  }

  async getRoom(id: string) {
    const searchId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    let room = this.rooms.get(id) || this.rooms.get(searchId);
    
    if (!room) {
      // Fallback search by room name
      for (const r of this.rooms.values()) {
        if (r.name.toLowerCase() === id.trim().toLowerCase()) {
          room = r;
          break;
        }
      }
    }

    if (!room) return null;
    const participants = this.participants.get(room.id) || [];
    const musicState = this.roomMusicStates.get(room.id) || null;
    return {
      ...room,
      participants,
      musicState: musicState ? {
        ...musicState,
        currentTrack: musicState.currentTrackId ? this.tracks.get(musicState.currentTrackId) : null
      } : null
    };
  }

  async joinRoom(roomId: string, userId: string, username: string) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        name: roomId,
        hostId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.rooms.set(roomId, room);
      this.participants.set(roomId, []);
      this.messages.set(roomId, []);
      if (!this.roomDjPasscodes.has(roomId)) {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        this.roomDjPasscodes.set(roomId, code);
        this.roomAuthorizedDjs.set(roomId, new Set([userId]));
      }
      const musicState = {
        id: randomUUID(),
        roomId,
        currentTrackId: null,
        isPlaying: false,
        lastPosition: 0.0,
        lastPositionUpdatedAt: new Date(),
        updatedAt: new Date(),
      };
      this.roomMusicStates.set(roomId, musicState);
      this.roomQueues.set(roomId, []);
    } else if (!room.hostId) {
      room.hostId = userId;
    }

    const participants = this.participants.get(roomId) || [];
    const user = this.users.get(userId) || { id: userId, username, createdAt: new Date() };
    if (!this.users.has(userId)) {
      this.users.set(userId, user);
    }
    
    const existing = participants.find(p => p.userId === userId);
    if (!existing) {
      const participant = {
        id: randomUUID(),
        roomId,
        userId,
        joinedAt: new Date(),
        leftAt: null,
        user,
      };
      participants.push(participant);
      this.participants.set(roomId, participants);
    }
    return this.getRoom(roomId);
  }

  setRoomHost(roomId: string, hostId: string) {
    let room = this.rooms.get(roomId);
    if (room) {
      room.hostId = hostId;
    }
    const djs = this.roomAuthorizedDjs.get(roomId) || new Set<string>();
    djs.add(hostId);
    this.roomAuthorizedDjs.set(roomId, djs);
    return this.getRoom(roomId);
  }

  async leaveRoom(roomId: string, userId: string) {
    const participants = this.participants.get(roomId) || [];
    const updated = participants.filter(p => p.userId !== userId);
    this.participants.set(roomId, updated);
    this.removeParticipantMediaState(roomId, userId);
    return this.getRoom(roomId);
  }

  getParticipantMediaStates(roomId: string): Record<string, any> {
    const states = this.roomParticipantMedia.get(roomId);
    if (!states) return {};
    const res: Record<string, any> = {};
    states.forEach((val, key) => { res[key] = val; });
    return res;
  }

  updateParticipantMediaState(roomId: string, userId: string, state: any) {
    let states = this.roomParticipantMedia.get(roomId);
    if (!states) {
      states = new Map();
      this.roomParticipantMedia.set(roomId, states);
    }
    const current = states.get(userId) || { cameraEnabled: false, microphoneEnabled: false, speaking: false, screenSharing: false };
    const updated = { ...current, ...state };
    states.set(userId, updated);
    return updated;
  }

  removeParticipantMediaState(roomId: string, userId: string) {
    const states = this.roomParticipantMedia.get(roomId);
    if (states) {
      states.delete(userId);
    }
  }

  async saveChatMessage(roomId: string, userId: string, message: string) {
    const user = this.users.get(userId) || { id: userId, username: 'Unknown User' };
    const chatMsg = {
      id: randomUUID(),
      roomId,
      userId,
      message,
      createdAt: new Date(),
      user,
    };
    const roomMsgs = this.messages.get(roomId) || [];
    roomMsgs.push(chatMsg);
    this.messages.set(roomId, roomMsgs);
    return chatMsg;
  }

  async getChatMessages(roomId: string) {
    return this.messages.get(roomId) || [];
  }

  async getMusicTracks() {
    return Array.from(this.tracks.values());
  }

  async createMusicTrack(title: string, artist: string, url: string, duration: number, isRoyaltyFree: boolean, uploadedById?: string) {
    const track = {
      id: randomUUID(),
      title,
      artist,
      url,
      duration,
      isRoyaltyFree,
      uploadedById: uploadedById || null,
      createdAt: new Date(),
    };
    this.tracks.set(track.id, track);
    return track;
  }

  async getRoomMusicState(roomId: string) {
    const state = this.roomMusicStates.get(roomId);
    if (!state) return null;
    return {
      ...state,
      queue: this.roomQueues.get(roomId) || [],
      currentTrack: state.currentTrackId ? this.tracks.get(state.currentTrackId) : null
    };
  }

  async updateRoomMusicState(roomId: string, data: {
    currentTrackId?: string | null;
    isPlaying?: boolean;
    lastPosition?: number;
    trackData?: any;
    updatedBy?: string;
    queue?: any[];
  }) {
    const state = this.roomMusicStates.get(roomId) || {
      id: randomUUID(),
      roomId,
      currentTrackId: null,
      isPlaying: false,
      lastPosition: 0.0,
      lastPositionUpdatedAt: Date.now(),
      updatedAt: Date.now(),
      stateVersion: 0,
      currentTrack: null,
      updatedBy: null
    };

    if (data.trackData !== undefined) {
      state.currentTrack = data.trackData;
      if (data.trackData?.id) {
        this.tracks.set(data.trackData.id, data.trackData);
      }
    }

    if (data.currentTrackId !== undefined) {
      state.currentTrackId = data.currentTrackId;
      if (!data.trackData && data.currentTrackId && this.tracks.has(data.currentTrackId)) {
        state.currentTrack = this.tracks.get(data.currentTrackId);
      }
    }

    if (data.isPlaying !== undefined) {
      state.isPlaying = data.isPlaying;
    }

    if (data.lastPosition !== undefined) {
      state.lastPosition = data.lastPosition;
      state.lastPositionUpdatedAt = Date.now();
    }

    if (data.updatedBy !== undefined) {
      state.updatedBy = data.updatedBy;
    }

    if (data.queue !== undefined) {
      this.roomQueues.set(roomId, data.queue);
    }

    state.stateVersion = (state.stateVersion || 0) + 1;
    state.updatedAt = Date.now();

    this.roomMusicStates.set(roomId, state);
    return {
      ...state,
      queue: this.roomQueues.get(roomId) || [],
      currentTrack: state.currentTrack || (state.currentTrackId ? this.tracks.get(state.currentTrackId) : null)
    };
  }
}

// Instantiate clients
const mockDb = new MockDatabase();
let prisma: PrismaClient | null = null;
let useMock = true;

if (process.env.DATABASE_URL) {
  try {
    prisma = new PrismaClient();
    useMock = false;
    console.log('Database URL detected, initialized Prisma Client.');
  } catch (error) {
    console.warn('Prisma initialization failed. Falling back to Mock In-Memory Database.', error);
    useMock = true;
  }
} else {
  console.log('No DATABASE_URL found. Running with Mock In-Memory Database.');
}

// Unified Database API
export const db = {
  isMock: () => useMock,
  
  createUser: async (username: string, avatarUrl?: string) => {
    if (useMock || !prisma) return mockDb.createUser(username, avatarUrl);
    return prisma.user.create({
      data: { username, avatarUrl }
    });
  },

  getUser: async (id: string) => {
    if (useMock || !prisma) return mockDb.getUser(id);
    return prisma.user.findUnique({ where: { id } });
  },

  createRoom: async (name: string, hostId: string) => {
    if (useMock || !prisma) return mockDb.createRoom(name, hostId);
    return prisma.room.create({
      data: {
        name,
        hostId,
        musicState: {
          create: {}
        }
      },
      include: {
        musicState: true
      }
    });
  },

  getRoom: async (id: string) => {
    if (useMock || !prisma) return mockDb.getRoom(id);
    return prisma.room.findUnique({
      where: { id },
      include: {
        participants: {
          include: { user: true }
        },
        musicState: {
          include: { currentTrack: true }
        }
      }
    });
  },

  joinRoom: async (roomId: string, userId: string, username: string) => {
    if (useMock || !prisma) return mockDb.joinRoom(roomId, userId, username);
    
    // Ensure room exists with hostId
    let room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      try {
        room = await prisma.room.create({
          data: {
            id: roomId,
            name: roomId,
            hostId: userId,
            musicState: { create: {} }
          }
        });
      } catch (_) {
        room = await prisma.room.findUnique({ where: { id: roomId } });
      }
    } else if (!room.hostId) {
      await prisma.room.update({
        where: { id: roomId },
        data: { hostId: userId }
      });
    }

    // Ensure user exists
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      user = await prisma.user.create({ data: { id: userId, username } });
    }

    // Add to participants if not already there
    const existing = await prisma.callParticipant.findFirst({
      where: { roomId, userId, leftAt: null }
    });

    if (!existing) {
      await prisma.callParticipant.create({
        data: { roomId, userId }
      });
    }

    return db.getRoom(roomId);
  },

  leaveRoom: async (roomId: string, userId: string) => {
    if (useMock || !prisma) return mockDb.leaveRoom(roomId, userId);
    
    await prisma.callParticipant.deleteMany({
      where: { roomId, userId }
    });

    return db.getRoom(roomId);
  },

  saveChatMessage: async (roomId: string, userId: string, message: string) => {
    if (useMock || !prisma) return mockDb.saveChatMessage(roomId, userId, message);
    return prisma.chatMessage.create({
      data: { roomId, userId, message },
      include: { user: true }
    });
  },

  getChatMessages: async (roomId: string) => {
    if (useMock || !prisma) return mockDb.getChatMessages(roomId);
    return prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      include: { user: true }
    });
  },

  getMusicTracks: async () => {
    if (useMock || !prisma) return mockDb.getMusicTracks();
    // Fetch both royalty free and user uploaded
    return prisma.musicTrack.findMany({
      orderBy: { createdAt: 'desc' }
    });
  },

  createMusicTrack: async (title: string, artist: string, url: string, duration: number, isRoyaltyFree: boolean, uploadedById?: string) => {
    if (useMock || !prisma) return mockDb.createMusicTrack(title, artist, url, duration, isRoyaltyFree, uploadedById);
    return prisma.musicTrack.create({
      data: {
        title,
        artist,
        url,
        duration,
        isRoyaltyFree,
        uploadedById: uploadedById || null
      }
    });
  },

  getRoomMusicState: async (roomId: string) => {
    if (useMock || !prisma) return mockDb.getRoomMusicState(roomId);
    const dbState = await prisma.roomMusicState.findUnique({
      where: { roomId },
      include: { currentTrack: true }
    });
    if (!dbState) return null;
    return {
      ...dbState,
      queue: mockDb.roomQueues.get(roomId) || []
    };
  },

  updateRoomMusicState: async (roomId: string, data: {
    currentTrackId?: string | null;
    isPlaying?: boolean;
    lastPosition?: number;
    trackData?: any;
    updatedBy?: string;
    queue?: any[];
  }) => {
    if (useMock || !prisma) return mockDb.updateRoomMusicState(roomId, data);
    
    const updateData: any = {};
    if (data.currentTrackId !== undefined) updateData.currentTrackId = data.currentTrackId;
    if (data.isPlaying !== undefined) updateData.isPlaying = data.isPlaying;
    if (data.lastPosition !== undefined) {
      updateData.lastPosition = data.lastPosition;
      updateData.lastPositionUpdatedAt = new Date();
    }

    if (data.queue !== undefined) {
      mockDb.roomQueues.set(roomId, data.queue);
    }

    try {
      const dbState = await prisma.roomMusicState.update({
        where: { roomId },
        data: updateData,
        include: { currentTrack: true }
      });
      return {
        ...dbState,
        queue: mockDb.roomQueues.get(roomId) || []
      };
    } catch (_) {
      return mockDb.updateRoomMusicState(roomId, data);
    }
  },

  getDjPasscode: (roomId: string) => {
    let code = mockDb.roomDjPasscodes.get(roomId);
    if (!code) {
      code = Math.floor(1000 + Math.random() * 9000).toString();
      mockDb.roomDjPasscodes.set(roomId, code);
    }
    return code;
  },

  generateNewDjPasscode: (roomId: string, hostId?: string) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    mockDb.roomDjPasscodes.set(roomId, code);
    mockDb.roomAuthorizedDjs.set(roomId, hostId ? new Set([hostId]) : new Set());
    return code;
  },

  isDjAuthorized: async (roomId: string, userId: string) => {
    const room = await db.getRoom(roomId);
    if (room?.hostId && room.hostId === userId) return true;
    const authDjs = mockDb.roomAuthorizedDjs.get(roomId);
    return Boolean(authDjs && authDjs.has(userId));
  },

  authorizeDjUser: async (roomId: string, userId: string, passcode: string) => {
    const correctCode = db.getDjPasscode(roomId);
    if (passcode.trim() === correctCode) {
      let djs = mockDb.roomAuthorizedDjs.get(roomId);
      if (!djs) {
        djs = new Set<string>();
        mockDb.roomAuthorizedDjs.set(roomId, djs);
      }
      djs.add(userId);
      return true;
    }
    return false;
  },

  setRoomHost: async (roomId: string, hostId: string) => {
    mockDb.setRoomHost(roomId, hostId);
    if (!useMock && prisma) {
      try {
        await prisma.room.update({
          where: { id: roomId },
          data: { hostId }
        });
      } catch (_) {}
    }
    return db.getRoom(roomId);
  },

  getParticipantMediaStates: (roomId: string) => {
    return mockDb.getParticipantMediaStates(roomId);
  },

  updateParticipantMediaState: (roomId: string, userId: string, state: any) => {
    return mockDb.updateParticipantMediaState(roomId, userId, state);
  },

  removeParticipantMediaState: (roomId: string, userId: string) => {
    return mockDb.removeParticipantMediaState(roomId, userId);
  }
};

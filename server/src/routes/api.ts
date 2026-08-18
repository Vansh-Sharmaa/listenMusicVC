import { Router, Request, Response } from 'express';
import { db } from '../db/db';
import { AccessToken } from 'livekit-server-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const apiRouter = Router();

// Ensure uploads directory exists safely
const UPLOADS_DIR = path.join(process.cwd(), 'public/music');
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('Could not create uploads directory at', UPLOADS_DIR, e);
}

// POST /api/rooms - Create a room
apiRouter.post('/rooms', async (req: Request, res: Response) => {
  const { name, hostId } = req.body;
  if (!name || !hostId) {
    return res.status(400).json({ error: 'Missing name or hostId' });
  }
  try {
    const room = await db.createRoom(name, hostId);
    return res.status(201).json(room);
  } catch (error) {
    console.error('Failed to create room:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/rooms/:roomId - Get room details
apiRouter.get('/rooms/:roomId', async (req: Request, res: Response) => {
  const { roomId } = req.params;
  try {
    const room = await db.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    return res.json(room);
  } catch (error) {
    console.error('Failed to get room:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/rooms/:roomId/token - Generate LiveKit token
apiRouter.post('/rooms/:roomId/token', async (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { userId, username } = req.body;

  if (!userId || !username) {
    return res.status(400).json({ error: 'Missing userId or username' });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  // Fallback / Mock Mode if LiveKit is not configured
  if (!apiKey || !apiSecret || !livekitUrl) {
    console.log(`LiveKit credentials not fully configured. Issuing mock token for Room: ${roomId}, User: ${userId}`);
    return res.json({
      token: `mock-token-${roomId}-${userId}-${Buffer.from(username).toString('base64')}`,
      url: 'mock://localhost:7880',
      isMock: true
    });
  }

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: username,
    });

    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return res.json({
      token: await at.toJwt(),
      url: livekitUrl,
      isMock: false
    });
  } catch (error) {
    console.error('Failed to generate LiveKit token:', error);
    return res.status(500).json({ error: 'Failed to generate token' });
  }
});

// GET /api/music - Get music track library
apiRouter.get('/music', async (req: Request, res: Response) => {
  try {
    const tracks = await db.getMusicTracks();
    return res.json(tracks);
  } catch (error) {
    console.error('Failed to fetch music tracks:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/music/upload - Upload a user track (handles raw binary data or JSON URL metadata)
apiRouter.post('/music/upload', async (req: Request, res: Response) => {
  // If request is JSON, they are submitting a link to a song (e.g. licensed/royalty-free URL)
  if (req.headers['content-type']?.includes('application/json')) {
    const { title, artist, url, duration, uploadedById } = req.body;
    if (!title || !artist || !url || !duration) {
      return res.status(400).json({ error: 'Missing title, artist, url, or duration' });
    }
    try {
      const track = await db.createMusicTrack(title, artist, url, parseFloat(duration), false, uploadedById);
      return res.status(201).json(track);
    } catch (error) {
      console.error('Failed to create music track from URL:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // Otherwise, handle raw binary file upload (header must contain metadata in query or headers)
  const title = (req.query.title as string) || req.headers['x-file-title'] as string || 'Untitled Upload';
  const artist = (req.query.artist as string) || req.headers['x-file-artist'] as string || 'Unknown Artist';
  const uploadedById = (req.query.uploadedById as string) || req.headers['x-file-uploader'] as string;
  const originalFileName = (req.headers['x-file-name'] as string) || 'upload.mp3';
  
  if (!req.body) {
    return res.status(400).json({ error: 'No file data received' });
  }

  try {
    const fileId = randomUUID();
    const extension = path.extname(originalFileName) || '.mp3';
    const filename = `${fileId}${extension}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Save binary data buffer to public directory
    fs.writeFileSync(filePath, req.body);

    // Simple estimation of duration if not provided (we can default to 180 seconds or read file tags. 
    // Here we'll default to 180 and update dynamically on client side when loaded)
    const duration = 180.0;
    const clientUrl = `/music/${filename}`;

    const track = await db.createMusicTrack(title, artist, clientUrl, duration, false, uploadedById);
    return res.status(201).json(track);
  } catch (error) {
    console.error('Failed to handle binary music upload:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

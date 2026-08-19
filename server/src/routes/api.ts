import { Router, Request, Response } from 'express';
import { db } from '../db/db';
import { AccessToken } from 'livekit-server-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import ytsr from '@distube/ytsr';

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

// GET /api/music/search - Search any song in the world (YouTube Music Engine)
apiRouter.get('/music/search', async (req: Request, res: Response) => {
  const rawQuery = (req.query.q as string || '').trim();
  if (!rawQuery) {
    return res.json([]);
  }

  const query = rawQuery.replace(/^(song|track|music|video)\s+/i, '').trim();

  const results: Array<{
    id: string;
    title: string;
    artist: string;
    url: string;
    duration: number;
    thumbnail: string;
    isRoyaltyFree: boolean;
  }> = [];

  // Helper to clean up song titles (e.g. remove "[Official Video]", "(Lyrics)", etc.)
  const cleanSongTitle = (raw: string) => {
    return raw
      .replace(/\[\s*(Official\s*Video|Music\s*Video|Audio|Lyrics|Visualizer|HD|4K|HQ)\s*\]/gi, '')
      .replace(/\(\s*(Official\s*Video|Music\s*Video|Audio|Lyrics|Visualizer|HD|4K|HQ)\s*\)/gi, '')
      .replace(/ft\.|feat\./gi, 'feat.')
      .trim();
  };

  // --- PRIMARY: @distube/ytsr (Fast, reliable, rich YouTube metadata) ---
  try {
    const searchTarget = query.toLowerCase().includes('song') || query.toLowerCase().includes('music')
      ? query
      : `${query} song`;

    const searchResults = await ytsr(searchTarget, { limit: 25 });
    for (const item of searchResults.items) {
      if (item.type !== 'video') continue;
      const video = item as any;
      if (!video.id) continue;

      // Parse duration string "MM:SS" or "HH:MM:SS"
      let durationSec = 210;
      if (video.duration) {
        const parts = String(video.duration).split(':').map(Number);
        if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
        else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }

      // Filter out overly long videos (e.g. 10hr mixes) unless explicitly asked
      if (!query.toLowerCase().includes('hour') && durationSec > 3600) continue;

      const rawTitle = video.name || video.title || 'Unknown Track';
      const cleanTitle = cleanSongTitle(rawTitle);
      const artist = video.author?.name?.replace(/ - Topic$/i, '') || 'YouTube Artist';

      results.push({
        id: `yt-${video.id}`,
        title: cleanTitle || rawTitle,
        artist,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        duration: durationSec,
        thumbnail: `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`,
        isRoyaltyFree: false
      });

      if (results.length >= 20) break;
    }

    if (results.length > 0) {
      console.log(`[Music Search] ytsr returned ${results.length} results for "${query}"`);
      return res.json(results);
    }
  } catch (ytsrErr) {
    console.warn('[Music Search] @distube/ytsr failed, trying scrape fallback:', ytsrErr);
  }

  // --- FALLBACK 1: YouTube HTML Results Scrape ---
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' audio')}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const html = await response.text();

    const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/s) ||
                      html.match(/var ytInitialData\s*=\s*({.+?});/s);

    if (jsonMatch && jsonMatch[1]) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const sectionContents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
        if (Array.isArray(sectionContents)) {
          for (const section of sectionContents) {
            const items = section?.itemSectionRenderer?.contents;
            if (Array.isArray(items)) {
              for (const item of items) {
                const video = item?.videoRenderer;
                if (video && video.videoId) {
                  const rawTitle = video.title?.runs?.[0]?.text || video.title?.simpleText || 'Unknown Song';
                  const cleanTitle = cleanSongTitle(rawTitle);
                  const artist = (video.ownerText?.runs?.[0]?.text || video.shortBylineText?.runs?.[0]?.text || 'YouTube Artist').replace(/ - Topic$/i, '');
                  const durationStr = video.lengthText?.simpleText || '3:30';
                  const parts = durationStr.split(':').map(Number);
                  let durationSec = 210;
                  if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
                  else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
                  
                  results.push({
                    id: `yt-${video.videoId}`,
                    title: cleanTitle,
                    artist,
                    url: `https://www.youtube.com/watch?v=${video.videoId}`,
                    duration: durationSec,
                    thumbnail: `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`,
                    isRoyaltyFree: false
                  });
                  if (results.length >= 15) break;
                }
              }
            }
            if (results.length >= 15) break;
          }
        }
      } catch (parseErr) {
        console.warn('[Music Search] JSON parse failed, trying regex');
      }
    }

    if (results.length > 0) return res.json(results);
  } catch (scrapeErr) {
    console.warn('[Music Search] YouTube scrape failed:', scrapeErr);
  }

  // --- FALLBACK 2: iTunes Search API (reliable, global) ---
  try {
    const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=15`);
    if (itunesRes.ok) {
      const itunesData = (await itunesRes.json()) as any;
      if (itunesData && Array.isArray(itunesData.results)) {
        for (const item of itunesData.results) {
          results.push({
            id: `itunes-${item.trackId}`,
            title: item.trackName || 'Song',
            artist: item.artistName || 'Artist',
            url: item.previewUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(item.artistName + ' ' + item.trackName)}`,
            duration: Math.round((item.trackTimeMillis || 180000) / 1000),
            thumbnail: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
            isRoyaltyFree: true
          });
        }
      }
    }
  } catch (itunesErr) {
    console.warn('[Music Search] iTunes fallback failed:', itunesErr);
  }

  return res.json(results);
});

// GET /api/lyrics - Fetch synchronized LRC lyrics (LRCLIB Integration & Custom URL Proxy)
apiRouter.get('/lyrics', async (req: Request, res: Response) => {
  const customUrl = (req.query.customUrl as string || '').trim();

  // If user provided a direct custom lyrics URL (e.g. Pastebin, GitHub raw, LRC link)
  if (customUrl) {
    try {
      const response = await fetch(customUrl);
      if (!response.ok) {
        return res.status(response.status).json({ error: `Failed to fetch from custom URL (${response.statusText})` });
      }
      const text = await response.text();
      const isTtml = text.includes('<tt') || (text.includes('<p') && text.includes('begin='));
      return res.json({
        trackName: 'Custom Track',
        artistName: 'Custom Artist',
        plainLyrics: text.replace(/<[^>]+>/g, '').replace(/\[\d{2}:\d{2}\.?\d*\]/g, '').trim(),
        syncedLyrics: text,
        format: isTtml ? 'ttml' : 'lrc'
      });
    } catch (fetchErr: any) {
      console.warn('[Lyrics API] Custom URL fetch error:', fetchErr);
      return res.status(500).json({ error: 'Failed to fetch custom lyrics URL: ' + (fetchErr?.message || 'Network error') });
    }
  }

  const trackName = (req.query.title as string || '').trim();
  const artistName = (req.query.artist as string || '').trim();
  const duration = req.query.duration ? parseInt(req.query.duration as string, 10) : undefined;

  if (!trackName) {
    return res.status(400).json({ error: 'Missing title parameter' });
  }

  // Clean track title (strip "(Official Video)", "feat. ...", "[4K]", etc.)
  const cleanTitle = trackName
    .replace(/\s*[\(\[](official\s*(music\s*)?video|video|audio|lyrics?|hd|4k|remix|feat\.?|ft\.?).*?[\)\]]/gi, '')
    .trim();
  const cleanArtist = artistName
    .replace(/\s*-\s*topic/gi, '')
    .replace(/\s*vevo/gi, '')
    .trim();

  try {
    const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 3000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
      } catch (err) {
        clearTimeout(id);
        throw err;
      }
    };

    // 1. Try Apple Music / BiniLyrics TTML Word-Synced API (Primary for exact word-by-word timestamps)
    try {
      const biniParams = new URLSearchParams({
        track: cleanTitle,
        ...(cleanArtist ? { artist: cleanArtist } : {}),
        ...(duration ? { duration: duration.toString() } : {})
      });
      const biniRes = await fetchWithTimeout(`https://lyrics-api.binimum.org/?${biniParams.toString()}`, {}, 3000);
      if (biniRes.ok) {
        const biniData = (await biniRes.json()) as any;
        if (biniData && Array.isArray(biniData.results) && biniData.results.length > 0) {
          const hit = biniData.results[0];
          if (hit.lyricsUrl) {
            const ttmlRes = await fetchWithTimeout(hit.lyricsUrl, {}, 3000);
            if (ttmlRes.ok) {
              const ttmlText = await ttmlRes.text();
              return res.json({
                id: hit.id || `bini-${Date.now()}`,
                trackName: hit.track_name || cleanTitle,
                artistName: hit.artist_name || cleanArtist,
                syncedLyrics: ttmlText,
                format: 'ttml',
                source: 'AppleMusic-WordSync',
                isWordSynced: true
              });
            }
          }
        }
      }
    } catch (biniErr) {
      console.warn('[Lyrics API] BiniLyrics TTML fetch error, falling back to LRCLIB:', biniErr);
    }

    // 2. Try exact match from LRCLIB
    const queryParams = new URLSearchParams({
      track_name: cleanTitle,
      ...(cleanArtist ? { artist_name: cleanArtist } : {}),
      ...(duration ? { duration: duration.toString() } : {})
    });

    let lrcRes = await fetchWithTimeout(`https://lrclib.net/api/get?${queryParams.toString()}`, {
      headers: { 'User-Agent': 'ListenMusicVC/1.0 (https://listen-music-vc.vercel.app)' }
    }, 4000);

    if (lrcRes.ok) {
      const data = (await lrcRes.json()) as any;
      return res.json({
        id: data.id,
        trackName: data.trackName,
        artistName: data.artistName,
        plainLyrics: data.plainLyrics,
        syncedLyrics: data.syncedLyrics,
        instrumental: data.instrumental
      });
    }

    // 2. Fallback: LRCLIB Fuzzy Search
    try {
      const searchRes = await fetchWithTimeout(`https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`.trim())}`, {
        headers: { 'User-Agent': 'ListenMusicVC/1.0 (https://listen-music-vc.vercel.app)' }
      }, 4000);
      if (searchRes.ok) {
        const results = (await searchRes.json()) as any;
        if (Array.isArray(results) && results.length > 0) {
          const best = results.find((r: any) => r.syncedLyrics) || results[0];
          return res.json({
            id: best.id,
            trackName: best.trackName,
            artistName: best.artistName,
            plainLyrics: best.plainLyrics,
            syncedLyrics: best.syncedLyrics,
            instrumental: best.instrumental
          });
        }
      }
    } catch (searchErr) {
      console.warn('[Lyrics API] LRCLIB search failed:', searchErr);
    }

    // 3. Fallback: Lyrist Open Lyrics API (Supports global, bollywood, indie, pop)
    try {
      const lyristRes = await fetchWithTimeout(`https://lyrist.vercel.app/api/${encodeURIComponent(cleanTitle)}/${encodeURIComponent(cleanArtist)}`, {}, 3000);
      if (lyristRes.ok) {
        const lyristData = (await lyristRes.json()) as any;
        if (lyristData && lyristData.lyrics) {
          return res.json({
            id: `lyrist-${Date.now()}`,
            trackName: lyristData.title || cleanTitle,
            artistName: lyristData.artist || cleanArtist,
            plainLyrics: lyristData.lyrics,
            syncedLyrics: null,
            instrumental: false
          });
        }
      }
    } catch (lyristErr) {
      console.warn('[Lyrics API] Lyrist fallback failed:', lyristErr);
    }

    // 4. Fallback: Lyrics.ovh Open API
    try {
      const ovhRes = await fetchWithTimeout(`https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist || 'Various')}/${encodeURIComponent(cleanTitle)}`, {}, 3000);
      if (ovhRes.ok) {
        const ovhData = (await ovhRes.json()) as any;
        if (ovhData && ovhData.lyrics) {
          return res.json({
            id: `ovh-${Date.now()}`,
            trackName: cleanTitle,
            artistName: cleanArtist,
            plainLyrics: ovhData.lyrics,
            syncedLyrics: null,
            instrumental: false
          });
        }
      }
    } catch (ovhErr) {
      console.warn('[Lyrics API] Lyrics.ovh fallback failed:', ovhErr);
    }

    // 5. Fallback: NetEase Cloud Music Synced LRC API (Huge database for international & Asian music)
    try {
      const neteaseSearch = await fetchWithTimeout(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim())}&type=1&limit=5`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      }, 3000);
      if (neteaseSearch.ok) {
        const neteaseSearchData = (await neteaseSearch.json()) as any;
        const songId = neteaseSearchData?.result?.songs?.[0]?.id;
        if (songId) {
          const lrcFetch = await fetchWithTimeout(`https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          }, 3000);
          if (lrcFetch.ok) {
            const lrcData = (await lrcFetch.json()) as any;
            const lrcText = lrcData?.lrc?.lyric;
            if (lrcText) {
              return res.json({
                id: `netease-${songId}`,
                trackName: cleanTitle,
                artistName: cleanArtist,
                plainLyrics: lrcText.replace(/\[\d{2}:\d{2}\.?\d*\]/g, '').trim(),
                syncedLyrics: lrcText,
                instrumental: false
              });
            }
          }
        }
      }
    } catch (neteaseErr) {
      console.warn('[Lyrics API] NetEase fallback failed:', neteaseErr);
    }

    return res.status(404).json({ error: 'Lyrics not found across platforms' });
  } catch (err) {
    console.error('[Lyrics API] Fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch lyrics' });
  }
});


/**
 * Multi-Platform Media URL Parser & Embed Helper
 * Supports: YouTube, YouTube Music, Spotify, SoundCloud, Monochrome / FLAC Lossless streams, Direct Audio Streams
 */

export type PlatformType = 'youtube' | 'spotify' | 'soundcloud' | 'monochrome' | 'direct_audio' | 'web_stream';

export interface ParsedMedia {
  platform: PlatformType;
  id?: string;
  embedUrl?: string;
  originalUrl: string;
  titleSuggestion?: string;
}

export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/)|music\.youtube\.com\/watch\?v=)([\w-]{11})/;
  const match = trimmed.match(regExp);
  return match && match[1] ? match[1] : null;
}

export function extractSpotifyInfo(url: string): { type: 'track' | 'album' | 'playlist'; id: string; embedUrl: string } | null {
  if (!url) return null;
  const trimmed = url.trim();
  const match = trimmed.match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
  if (match && match[1] && match[2]) {
    const type = match[1] as 'track' | 'album' | 'playlist';
    const id = match[2];
    return {
      type,
      id,
      embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`
    };
  }
  return null;
}

export function extractSoundCloudInfo(url: string): { embedUrl: string } | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes('soundcloud.com/')) {
    return {
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(trimmed)}&color=%23ff5500&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`
    };
  }
  return null;
}

export function isMonochromeUrl(url: string): boolean {
  if (!url) return false;
  return url.toLowerCase().includes('monochrome.tf');
}

export function isDirectAudioUrl(url: string): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp3') || clean.endsWith('.flac') || clean.endsWith('.wav') || clean.endsWith('.m4a') || clean.endsWith('.ogg') || clean.endsWith('.aac') || clean.endsWith('.opus');
}

export function parseMediaUrl(url: string): ParsedMedia {
  const trimmed = (url || '').trim();

  // 1. YouTube
  const ytId = extractYouTubeId(trimmed);
  if (ytId) {
    return {
      platform: 'youtube',
      id: ytId,
      originalUrl: trimmed
    };
  }

  // 2. Spotify
  const spotifyInfo = extractSpotifyInfo(trimmed);
  if (spotifyInfo) {
    return {
      platform: 'spotify',
      id: spotifyInfo.id,
      embedUrl: spotifyInfo.embedUrl,
      originalUrl: trimmed,
      titleSuggestion: `Spotify ${spotifyInfo.type.toUpperCase()}`
    };
  }

  // 3. SoundCloud
  const scInfo = extractSoundCloudInfo(trimmed);
  if (scInfo) {
    return {
      platform: 'soundcloud',
      embedUrl: scInfo.embedUrl,
      originalUrl: trimmed,
      titleSuggestion: 'SoundCloud Track'
    };
  }

  // 4. Monochrome Web Lossless Player
  if (isMonochromeUrl(trimmed)) {
    return {
      platform: 'monochrome',
      embedUrl: trimmed.startsWith('http') ? trimmed : `https://${trimmed}`,
      originalUrl: trimmed,
      titleSuggestion: 'Monochrome Lossless Stream'
    };
  }

  // 5. Direct Audio (Lossless / FLAC / MP3 / WAV stream)
  if (isDirectAudioUrl(trimmed) || trimmed.includes('archive.org') || trimmed.includes('.mp3') || trimmed.includes('.flac')) {
    return {
      platform: 'direct_audio',
      originalUrl: trimmed,
      titleSuggestion: 'Lossless Audio Stream'
    };
  }

  return {
    platform: 'web_stream',
    originalUrl: trimmed
  };
}

export function isYouTubeUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

export function isSpotifyUrl(url: string): boolean {
  return extractSpotifyInfo(url) !== null;
}

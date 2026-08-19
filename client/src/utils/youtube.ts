/**
 * Helper to extract YouTube video ID from various URL formats or raw IDs
 */
export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  
  // If it's already an 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  
  // Match standard youtube.com, youtu.be, music.youtube.com, youtube.com/embed, etc.
  const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/)|music\.youtube\.com\/watch\?v=)([\w-]{11})/;
  const match = trimmed.match(regExp);
  if (match && match[1]) {
    return match[1];
  }
  
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

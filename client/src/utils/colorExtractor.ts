export interface SongColorPalette {
  primary: string;    // Dominant vibrant color (e.g. rgba(230, 45, 90, 0.8))
  secondary: string;  // Complementary tone (e.g. rgba(70, 20, 120, 0.7))
  accent: string;     // Bright glowing highlight
  darkMuted: string;  // Deep dark ambient shadow
  lightMuted: string; // Frosted light ambient
}

const defaultDarkPalette: SongColorPalette = {
  primary: 'rgba(217, 70, 239, 0.4)',   // Fuchsia
  secondary: 'rgba(99, 102, 241, 0.3)', // Indigo
  accent: '#ec4899',
  darkMuted: 'rgba(15, 23, 42, 0.95)',
  lightMuted: 'rgba(255, 255, 255, 0.85)'
};

const paletteCache = new Map<string, SongColorPalette>();

/**
 * Extracts a fluid 4-color ambient palette from an image URL using an in-memory canvas
 */
export async function extractPaletteFromImage(imageUrl: string): Promise<SongColorPalette> {
  if (!imageUrl) return defaultDarkPalette;
  if (paletteCache.has(imageUrl)) return paletteCache.get(imageUrl)!;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(defaultDarkPalette);
          return;
        }

        canvas.width = 40;
        canvas.height = 40;
        ctx.drawImage(img, 0, 0, 40, 40);

        const imageData = ctx.getImageData(0, 0, 40, 40).data;
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        let maxVibrancy = 0;
        let vibrantR = 217, vibrantG = 70, vibrantB = 239;

        // Sample pixels
        for (let i = 0; i < imageData.length; i += 16) {
          const r = imageData[i];
          const g = imageData[i + 1];
          const b = imageData[i + 2];
          const a = imageData[i + 3];

          if (a > 128) {
            rSum += r;
            gSum += g;
            bSum += b;
            count++;

            // Calculate color saturation / vibrancy
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const delta = max - min;
            if (delta > maxVibrancy && max > 50 && min < 220) {
              maxVibrancy = delta;
              vibrantR = r;
              vibrantG = g;
              vibrantB = b;
            }
          }
        }

        if (count === 0) {
          resolve(defaultDarkPalette);
          return;
        }

        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);

        const palette: SongColorPalette = {
          primary: `rgba(${vibrantR}, ${vibrantG}, ${vibrantB}, 0.55)`,
          secondary: `rgba(${avgR}, ${avgG}, ${avgB}, 0.45)`,
          accent: `rgb(${vibrantR}, ${vibrantG}, ${vibrantB})`,
          darkMuted: `rgba(${Math.round(avgR * 0.15)}, ${Math.round(avgG * 0.15)}, ${Math.round(avgB * 0.15)}, 0.95)`,
          lightMuted: `rgba(${Math.min(255, Math.round(avgR * 1.4 + 100))}, ${Math.min(255, Math.round(avgG * 1.4 + 100))}, ${Math.min(255, Math.round(avgB * 1.4 + 100))}, 0.85)`
        };

        paletteCache.set(imageUrl, palette);
        resolve(palette);
      } catch (err) {
        console.warn('[ColorExtractor] Canvas read error (CORS fallback):', err);
        resolve(defaultDarkPalette);
      }
    };

    img.onerror = () => {
      resolve(defaultDarkPalette);
    };
  });
}

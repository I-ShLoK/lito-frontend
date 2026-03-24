/**
 * useAdaptiveColor
 *
 * Extracts the dominant hue from a track thumbnail URL and writes
 * CSS variables onto :root so the whole UI adapts in real-time.
 *
 * Variables set:
 *   --adapt-hue        0-360
 *   --adapt-sat        e.g. "72%"
 *   --adapt-primary    computed hsl
 *   --adapt-dim        muted version
 *   --adapt-glow       transparent version for glows
 *   --adapt-bg-tint    very subtle bg overlay
 */

import { useEffect, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011';

function toAdaptiveThumbSrc(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return `${API_URL}/api/music/thumb?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

function setAdaptVars(h: number, s: number) {
  const root = document.documentElement;
  root.style.setProperty('--adapt-hue', String(Math.round(h)));
  root.style.setProperty('--adapt-sat', `${Math.round(s)}%`);
  // Derived vars are computed via CSS calc(), so we only need hue + sat here.
}

function resetToAccent() {
  // Fall back to the red base
  setAdaptVars(350, 80);
}

/** Sample pixels from a canvas and return the dominant hue & saturation */
function extractHueSat(canvas: HTMLCanvasElement): { h: number; s: number } {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { h: 350, s: 80 };

  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let totalH = 0, totalS = 0, count = 0;

  for (let i = 0; i < data.length; i += 16) { // sample every 4th pixel
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const a = data[i + 3];
    if (a < 128) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    // Skip near-grey pixels — they skew the average towards boring
    if (delta < 0.15) continue;

    let h = 0;
    if (delta === 0) h = 0;
    else if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else                h = 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;

    const l = (max + min) / 2;
    const s = l === 0 || l === 1 ? 0 : delta / (1 - Math.abs(2 * l - 1));

    totalH += h;
    totalS += s;
    count++;
  }

  if (count === 0) return { h: 350, s: 80 };

  const avgH = totalH / count;
  const avgS = Math.min(1, (totalS / count) * 1.3); // boost saturation slightly

  // Clamp saturation to something vivid enough to be visible
  return { h: avgH, s: Math.max(0.5, avgS) * 100 };
}

export function useAdaptiveColor(thumbnailUrl: string | undefined | null) {
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!thumbnailUrl) {
      resetToAccent();
      return;
    }
    if (thumbnailUrl === lastUrl.current) return;
    lastUrl.current = thumbnailUrl;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const SIZE = 48; // small canvas = fast
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resetToAccent(); return; }
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { h, s } = extractHueSat(canvas);
        setAdaptVars(h, s);
      } catch {
        resetToAccent();
      }
    };

    img.onerror = () => resetToAccent();

    // Add a cache-busting proxy-friendly URL if needed
    img.src = toAdaptiveThumbSrc(thumbnailUrl);
  }, [thumbnailUrl]);
}

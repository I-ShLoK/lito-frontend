import React, { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011';
const FALLBACK_THUMB = '/icons/icon-192.svg';

export interface ThumbProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  sizes?: string;
}

function toThumbSrc(src: string): string {
  const trimmed = (src || '').trim();
  if (!trimmed) return FALLBACK_THUMB;
  if (/^https?:\/\//i.test(trimmed)) {
    return `${API_URL}/api/music/thumb?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

export default function Thumb({ src, alt, className, style, sizes = '160px' }: ThumbProps) {
  const resolved = useMemo(() => toThumbSrc(src), [src]);
  const [currentSrc, setCurrentSrc] = useState(resolved);

  useEffect(() => {
    setCurrentSrc(resolved);
  }, [resolved]);

  return (
    <span className={`relative block ${className || ''}`} style={style}>
      <Image
        src={currentSrc}
        alt={alt || 'thumbnail'}
        fill
        sizes={sizes}
        unoptimized
        onError={() => {
          if (currentSrc !== FALLBACK_THUMB) {
            setCurrentSrc(FALLBACK_THUMB);
          }
        }}
        className="object-cover"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}

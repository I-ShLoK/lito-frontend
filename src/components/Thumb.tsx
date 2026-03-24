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

function isRemoteUrl(src: string): boolean {
  return /^https?:\/\//i.test((src || '').trim());
}

function toProxyThumbSrc(src: string): string {
  const trimmed = (src || '').trim();
  if (!trimmed) return FALLBACK_THUMB;
  if (isRemoteUrl(trimmed)) {
    return `${API_URL}/api/music/thumb?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

export default function Thumb({ src, alt, className, style, sizes = '160px' }: ThumbProps) {
  const trimmedSrc = useMemo(() => (src || '').trim(), [src]);
  const proxiedSrc = useMemo(() => toProxyThumbSrc(trimmedSrc), [trimmedSrc]);
  const [currentSrc, setCurrentSrc] = useState(trimmedSrc || FALLBACK_THUMB);
  const [usingProxy, setUsingProxy] = useState(false);

  useEffect(() => {
    setUsingProxy(false);
    setCurrentSrc(trimmedSrc || FALLBACK_THUMB);
  }, [trimmedSrc]);

  const onImageError = () => {
    if (!usingProxy && isRemoteUrl(trimmedSrc)) {
      setUsingProxy(true);
      setCurrentSrc(proxiedSrc);
      return;
    }
    if (currentSrc !== FALLBACK_THUMB) {
      setCurrentSrc(FALLBACK_THUMB);
    }
  };

  return (
    <span className={`relative block ${className || ''}`} style={style}>
      <Image
        src={currentSrc}
        alt={alt || 'thumbnail'}
        fill
        sizes={sizes}
        unoptimized
        onError={onImageError}
        className="object-cover"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}

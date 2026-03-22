'use client';

import { useState } from 'react';

interface ThumbProps {
  src?: string | null;
  alt?: string;
  className?: string;
}

export default function Thumb({ src, alt = '', className = '' }: ThumbProps) {
  const [loaded, setLoaded] = useState(false);
  if (!src) return null;
  // i.ytimg.com URLs load directly without referrer tricks
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`${className} transition-all duration-300 ${loaded ? 'blur-0 opacity-100' : 'blur-sm opacity-70'}`}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
    />
  );
}

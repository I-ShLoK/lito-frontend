'use client';

interface ThumbProps {
  src?: string | null;
  alt?: string;
  className?: string;
}

export default function Thumb({ src, alt = '', className = '' }: ThumbProps) {
  if (!src) return null;
  // i.ytimg.com URLs load directly without referrer tricks
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} loading="lazy" />
  );
}

import React from 'react';

export interface ThumbProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function Thumb({ src, alt, className, style }: ThumbProps) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
    />
  );
}

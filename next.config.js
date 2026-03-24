const defaultRuntimeCaching = require('next-pwa/cache');

/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https?.*\/api\/audio\/proxy\/.*/i,
      handler: 'NetworkOnly',
      options: {
        cacheName: 'audio-proxy-no-cache',
      },
    },
    {
      urlPattern: /^https?.*\/api\/audio\/stream\/.*/i,
      handler: 'NetworkOnly',
      options: {
        cacheName: 'audio-stream-no-cache',
      },
    },
    {
      urlPattern: /^https?.*\/api\/music\/search.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-search-cache',
        networkTimeoutSeconds: 4,
        expiration: { maxEntries: 80, maxAgeSeconds: 60 * 10 },
      },
    },
    {
      urlPattern: /^https:\/\/i\.ytimg\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'yt-thumb-cache',
        expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
    ...defaultRuntimeCaching,
  ],
});

module.exports = withPWA({
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.ytimg.com' },
      { protocol: 'https', hostname: '**.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
    ],
  },
});

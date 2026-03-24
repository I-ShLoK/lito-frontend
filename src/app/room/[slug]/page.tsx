'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useStore, QueueItem } from '@/store';
import { useSocket } from '@/hooks/useSocket';
import { useAudio } from '@/hooks/useAudio';
import { useAdaptiveColor } from '@/hooks/useAdaptiveColor';
import Queue from '@/components/Queue';
import Chat from '@/components/Chat';
import People from '@/components/People';
import Visualizer from '@/components/Visualizer';
import Thumb from '@/components/Thumb';
import InstallAppButton from '@/components/InstallAppButton';
import api from '@/lib/api';

const SEARCH_CACHE_TTL_MS = 45_000;
const RECO_CACHE_TTL_MS = 60_000;
const searchCache = new Map<string, { ts: number; data: Suggestion[] }>();
const recoCache = new Map<string, { ts: number; data: Suggestion[] }>();

function formatTime(ms: number): string {
  if (!ms || Number.isNaN(ms) || ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

interface Suggestion {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  thumbnailUrl: string;
}

type HomeLanguage = 'english' | 'telugu' | 'hindi' | 'tamil' | 'punjabi' | 'malayalam';
const HOME_LANGUAGES: HomeLanguage[] = ['english', 'telugu', 'hindi', 'tamil', 'punjabi', 'malayalam'];

function avatarColor(seed: string): string {
  const colors = ['#c8f135', '#f135c8', '#35c8f1', '#f1c835', '#c835f1', '#35f1c8'];
  let hash = 0;
  for (const ch of seed) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function canonicalSongKey(title: string, artist?: string): string {
  const strip = (s: string) => s
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]+\)/g, ' ')
    .replace(/\b(official|video|lyric|lyrics|audio|full song|reaction|teaser|trailer|4k|hd|visualizer|remaster(ed)?|version|shorts?|feat|ft)\b/g, ' ')
    .replace(/[^a-z0-9\u0900-\u0d7f]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const t = strip(title || '');
  const a = strip(artist || '');
  // Deduplicate across different channels uploading the same song.
  return `${t.slice(0, 80)}::${a.split(' ')[0] || ''}`;
}

function tokenizedTitle(title: string): Set<string> {
  const cleaned = title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]+\)/g, ' ')
    .replace(/\b(official|video|lyric|lyrics|audio|full song|reaction|teaser|trailer|4k|hd|visualizer|remaster(ed)?|version|shorts?|feat|ft)\b/g, ' ')
    .replace(/[^a-z0-9\u0900-\u0d7f]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return new Set(cleaned.split(' ').filter((x) => x.length > 2));
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((v) => { if (b.has(v)) inter += 1; });
  return inter / Math.max(a.size, b.size);
}

function detectLanguageHintFromText(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';
  if (/[\u0980-\u09FF]/.test(text)) return 'bengali';
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gujarati';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'tamil';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'malayalam';
  return 'english';
}

function normalizedArtist(artist: string): string {
  return artist
    .toLowerCase()
    .replace(/\b(records?|music|official|topic|vevo|channel|entertainment)\b/g, ' ')
    .replace(/[^a-z0-9\u0900-\u0d7f]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

function isNoisyNonSong(title: string, artist: string): boolean {
  const s = `${title} ${artist}`.toLowerCase();
  return /reaction|review|status|shorts?|interview|vlog|gameplay|car|truck|vs\b|news|prank|comedy|travel|transform|trailer/.test(s);
}

function isSameSongVariant(candidate: { title: string; artist: string }, current: { title: string; artist: string }): boolean {
  const cTitle = (candidate.title || '').toLowerCase();
  const pTitle = (current.title || '').toLowerCase();
  const tokenScore = tokenOverlap(tokenizedTitle(candidate.title || ''), tokenizedTitle(current.title || ''));
  const artistMatch = normalizedArtist(candidate.artist || '') === normalizedArtist(current.artist || '');

  if (!pTitle.trim()) return false;
  if (cTitle.includes(pTitle) || pTitle.includes(cTitle)) return true;
  if (tokenScore > 0.78) return true;
  if (tokenScore > 0.62 && artistMatch) return true;
  return false;
}

function queueHasYoutubeId(queue: QueueItem[], youtubeId?: string | null): boolean {
  if (!youtubeId) return false;
  const target = youtubeId.toLowerCase();
  return queue.some((item) => (item.youtubeId || '').toLowerCase() === target);
}

async function fetchPersonalizedRecommendations(
  currentTrack: { youtubeId: string; title: string; artist: string },
  queue: Array<{ youtubeId?: string; title: string; artist: string }>,
  roomArtists: string[],
  maxItems = 16,
  roomId?: string
): Promise<Suggestion[]> {
  const recoCacheKey = `${currentTrack.youtubeId}::${roomArtists.map((a) => a.toLowerCase()).join('|')}::${queue.length}::${roomId || '-'}`;
  const cached = recoCache.get(recoCacheKey);
  if (cached && Date.now() - cached.ts < RECO_CACHE_TTL_MS) return cached.data;

  const response = await api.post('/api/music/recommendations', {
    currentTrack,
    queue,
    roomArtists,
    roomId,
    limit: maxItems,
  }).then((r) => r.data).catch(() => []);

  const results = (Array.isArray(response) ? response : []) as Suggestion[];
  const filtered = results.filter((r) => {
    if (!r?.id || r.id === currentTrack.youtubeId) return false;
    if (isSameSongVariant({ title: r.title, artist: r.artist }, { title: currentTrack.title, artist: currentTrack.artist })) return false;
    return true;
  });
  recoCache.set(recoCacheKey, { ts: Date.now(), data: filtered });
  return filtered;
}

function isLikelyMusicResult(item: Suggestion): boolean {
  const t = (item.title || '').toLowerCase();
  const a = (item.artist || '').toLowerCase();
  const s = `${t} ${a}`;

  const musicSignals = [
    'official song', 'audio', 'lyrical', 'lyrics', 'music', 'album', 'ost', 'single',
    'records', 'music', 'entertainment', 'vevo', 't-series', 'saregama', 'sony music',
    'zee music', 'aditya music', 'lahari', 'tips', 'think music', 'wynk', 'gaana', 'jiosaavn',
    'anirudh', 'ar rahman', 'devi sri prasad', 'sid sriram',
  ];
  const nonMusicSignals = [
    'vlog', 'news', 'live stream', 'gameplay', 'walkthrough', 'review', 'reaction',
    'transform', 'vs ', 'truck', 'car', 'auto', 'tractor', 'travel', 'cooking',
    'comedy', 'prank', 'unboxing', 'shorts', 'status', 'interview',
  ];

  const hasMusicSignal = musicSignals.some((x) => s.includes(x));
  const hasNonMusicSignal = nonMusicSignals.some((x) => s.includes(x));

  // Strong rule: reject obvious non-music even if it accidentally has "audio" somewhere.
  if (hasNonMusicSignal) return false;

  // Accept clear music entities/labels or music-ish titles.
  if (hasMusicSignal) return true;
  if (/\b(song|audio|lyrical|lyrics|album|theme|jukebox|ost)\b/i.test(t)) return true;

  // Fallback strict reject.
  return false;
}

function extractYouTubeId(input: string): string | null {
  const text = input.trim();
  const direct = text.match(/^[a-zA-Z0-9_-]{11}$/);
  if (direct) return direct[0];
  try {
    const u = new URL(text);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace('/', '').trim();
      return id.length === 11 ? id : null;
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && v.length === 11) return v;
      const parts = u.pathname.split('/');
      const last = parts[parts.length - 1];
      if (last && last.length === 11) return last;
    }
  } catch {
    return null;
  }
  return null;
}

function isPlaylistLink(input: string): boolean {
  const text = input.trim().toLowerCase();
  return text.includes('list=') || text.includes('open.spotify.com/playlist');
}

function SearchResultsPanel({
  query,
  onQueryChange,
  onAddToQueue,
  recentKey,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onAddToQueue: (item: { youtubeId: string; title: string; artist: string; durationMs: number; thumbnailUrl: string; mode: 'next' | 'end' }) => void;
  recentKey: string;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [playlistMode, setPlaylistMode] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const trimmedQuery = query.trim();
  const detectedPlaylist = isPlaylistLink(trimmedQuery);
  const detectedYoutube = !!extractYouTubeId(trimmedQuery);

  const pushRecentSearch = useCallback((text: string) => {
    const value = text.trim();
    if (!value || typeof window === 'undefined') return;
    setRecentSearches((prev) => {
      const next = [value, ...prev.filter((x) => x.toLowerCase() !== value.toLowerCase())].slice(0, 10);
      window.localStorage.setItem(recentKey, JSON.stringify(next));
      return next;
    });
  }, [recentKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(recentKey) || '[]');
      if (Array.isArray(parsed)) setRecentSearches(parsed.filter((x) => typeof x === 'string').slice(0, 10));
    } catch {
      setRecentSearches([]);
    }
  }, [recentKey]);

  useEffect(() => {
    const q = query.trim();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (!q) {
      setResults([]);
      setPlaylistMode(false);
      return;
    }

    const t = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        if (isPlaylistLink(q)) {
          pushRecentSearch(q);
          const importRes = await api.post('/api/music/import-playlist', { url: q }, { signal: controller.signal });
          setPlaylistMode(true);
          const imported = (importRes.data || []) as Suggestion[];
          setResults(imported);
          if (imported.length === 0) {
            toast.error('Playlist import returned no playable tracks. Try again in a few seconds.');
          }
          return;
        }

        const youtubeId = extractYouTubeId(q);
        if (youtubeId) {
          pushRecentSearch(q);
          setPlaylistMode(false);
          const infoRes = await api.get(`/api/audio/info/${youtubeId}`);
          setResults([{
            id: youtubeId,
            title: String(infoRes.data?.title || 'YouTube Track'),
            artist: String(infoRes.data?.artist || 'Unknown'),
            durationMs: Number(infoRes.data?.durationMs || 0),
            thumbnailUrl: String(infoRes.data?.thumbnailUrl || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`),
          }]);
        } else {
          pushRecentSearch(q);
          setPlaylistMode(false);
          const cacheKey = q.toLowerCase();
          const cached = searchCache.get(cacheKey);
          if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL_MS) {
            setResults(cached.data);
          } else {
            const res = await api.get(`/api/music/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
            const data = (res.data || []) as Suggestion[];
            searchCache.set(cacheKey, { ts: Date.now(), data });
            setResults(data);
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'CanceledError' || (err as { name?: string }).name === 'AbortError') return;
        setResults([]);
        setPlaylistMode(false);
        if (isPlaylistLink(q)) toast.error('Playlist import failed. Please retry with the playlist URL.');
      } finally {
        setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    }, 300);

    return () => {
      clearTimeout(t);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [query, pushRecentSearch]);

  const rowHeight = 66;
  const viewportHeight = 420;
  const overscan = 4;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(results.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const visibleResults = results.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = Math.max(0, (results.length - endIndex) * rowHeight);

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 bg-elevated/80 rounded-xl px-3 py-2 border border-[var(--border)]">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search songs, artists, albums..."
              className="flex-1 bg-transparent text-sm outline-none text-t1 placeholder:text-t3"
            />
          </div>
        </div>
        <div className="p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 bg-elevated/80 rounded-xl px-3 py-2 border border-[var(--border)]">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search songs, artists, albums..."
            className="flex-1 bg-transparent text-sm outline-none text-t1 placeholder:text-t3"
          />
        </div>
        {(detectedPlaylist || detectedYoutube) && (
          <div className="mt-2 px-2 py-1.5 rounded-lg bg-elevated border border-[var(--border)] text-[11px] text-t2">
            {detectedPlaylist ? 'Playlist link detected - import mode ready.' : 'YouTube link detected - direct add mode ready.'}
          </div>
        )}
      </div>
      {!query.trim() ? (
        <div className="px-4 py-5 space-y-3">
          <p className="text-sm text-t3">Search from here to add songs to queue instantly.</p>
          {recentSearches.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] uppercase tracking-wider text-t3">Recent</p>
                <button
                  className="text-xs text-t3 hover:text-t1"
                  onClick={() => {
                    setRecentSearches([]);
                    if (typeof window !== 'undefined') window.localStorage.removeItem(recentKey);
                  }}
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((s) => (
                  <button
                    key={s}
                    onClick={() => onQueryChange(s)}
                    className="px-3 py-1.5 rounded-full bg-elevated text-xs text-t2 border border-[var(--border)] hover:text-t1"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={listRef}
          className="overflow-y-auto h-full p-2"
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          {playlistMode && results.length > 0 && (
            <button
              onClick={() => {
                pushRecentSearch(query);
                results.forEach((r) => onAddToQueue({
                  youtubeId: r.id,
                  title: r.title,
                  artist: r.artist,
                  durationMs: r.durationMs,
                  thumbnailUrl: r.thumbnailUrl,
                  mode: 'end',
                }));
              }}
              className="w-full mb-2 px-3 py-2 rounded-xl bg-accent text-bg text-sm font-medium"
            >
              Import Playlist ({results.length} songs)
            </button>
          )}
          <div style={{ height: topPad }} />
          {visibleResults.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-elevated group">
              <div className="w-11 h-11 rounded-lg overflow-hidden bg-elevated">
                <Thumb src={r.thumbnailUrl || `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{r.title}</p>
                <p className="text-xs text-t3 truncate">{r.artist}</p>
              </div>
              <button
                onClick={() => onAddToQueue({ youtubeId: r.id, title: r.title, artist: r.artist, durationMs: r.durationMs, thumbnailUrl: r.thumbnailUrl, mode: 'end' })}
                className="text-xs px-2 py-1.5 rounded-lg bg-accent text-bg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Add
              </button>
            </div>
          ))}
          <div style={{ height: bottomPad }} />
        </div>
      )}
    </div>
  );
}

function TopRoomIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M6.5 10.5V20h11V10.5" />
    </svg>
  );
}

function TopPlayerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M10 9.5v5l4-2.5-4-2.5z" />
    </svg>
  );
}

function TopChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 15a4 4 0 0 1-4 4H8l-4 3v-7a4 4 0 0 1-2-3.5A4.5 4.5 0 0 1 6.5 7H16a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function TopBackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m14 18-6-6 6-6" />
    </svg>
  );
}

function RecommendationsPanel({
  onAddToQueue,
}: {
  onAddToQueue: (item: { youtubeId: string; title: string; artist: string; durationMs: number; thumbnailUrl: string; mode: 'next' | 'end' }) => void;
}) {
  const { currentTrack, queue, roomId } = useStore();
  const [results, setResults] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const lastKeyRef = useRef('');

  const roomArtists = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of queue) {
      const artist = (item.artist || '').trim();
      if (!artist) continue;
      map.set(artist, (map.get(artist) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([artist]) => artist);
  }, [queue]);

  useEffect(() => {
    if (!currentTrack) return;

    const key = `${currentTrack.youtubeId}:${roomArtists.join(',')}:${refreshTick}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    setLoading(true);
    fetchPersonalizedRecommendations(
      { youtubeId: currentTrack.youtubeId, title: currentTrack.title, artist: currentTrack.artist },
      queue.map((q) => ({ youtubeId: q.youtubeId, title: q.title, artist: q.artist })),
      roomArtists,
      14,
      roomId || undefined
    )
      .then((out) => setResults(out))
      .finally(() => setLoading(false));
  }, [currentTrack, queue, roomArtists, refreshTick, roomId]);

  if (!currentTrack) return <div className="p-4 text-sm text-t3">Play something to get recommendations.</div>;
  if (loading) return <div className="p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>;

  return (
    <div className="overflow-y-auto h-full p-2 space-y-1">
      <div className="flex items-center justify-end px-1 pb-1">
        <button
          onClick={() => setRefreshTick((v) => v + 1)}
          className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2"
        >
          Refresh
        </button>
      </div>
      {results.map((r) => (
        <div key={r.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-elevated group">
          <div className="w-11 h-11 rounded-lg overflow-hidden bg-elevated">
            <Thumb src={r.thumbnailUrl || `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{r.title}</p>
            <p className="text-xs text-t3 truncate">{r.artist}</p>
          </div>
          <button
            onClick={() => onAddToQueue({ youtubeId: r.id, title: r.title, artist: r.artist, durationMs: r.durationMs, thumbnailUrl: r.thumbnailUrl, mode: 'end' })}
            className="text-xs px-2 py-1.5 rounded-lg bg-accent text-bg opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Add
          </button>
        </div>
      ))}
    </div>
  );
}

function RoomHomePanel({
  onAddToQueue,
  language,
  onLanguageChange,
  compact = false,
}: {
  onAddToQueue: (item: { youtubeId: string; title: string; artist: string; durationMs: number; thumbnailUrl: string; mode: 'next' | 'end' }) => void;
  language: HomeLanguage;
  onLanguageChange: (language: HomeLanguage) => void;
  compact?: boolean;
}) {
  const { currentTrack, queue, roomId } = useStore();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const shownKeysRef = useRef<Set<string>>(new Set());

  const roomArtists = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of queue) {
      const artist = (item.artist || '').trim();
      if (!artist) continue;
      counts.set(artist, (counts.get(artist) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([artist]) => artist);
  }, [queue]);

  useEffect(() => {
    let mounted = true;
    const limit = compact ? 8 : 15;
    const flavor = refreshTick % 6;
    const facets = ['latest official songs', 'new music releases', 'top movie songs', 'official lyrical songs', 'audio jukebox', 'best hits'];
    const primaryQueries = [
      `${language} ${facets[flavor]}`,
      `${language} official songs`,
      `${language} music label hits`,
    ];

    const fallbackSeeds: Record<HomeLanguage, string[]> = {
      english: ['vevo official audio', 'warner records official songs', 'universal music official songs'],
      telugu: ['aditya music telugu songs', 'lahari music telugu', 'saregama telugu official songs'],
      hindi: ['t-series official songs', 'zee music official songs', 'saregama hindi official songs'],
      tamil: ['sony music south tamil songs', 'think music india tamil', 'saregama tamil official songs'],
      punjabi: ['speed records official songs', 'tips punjabi songs', 'white hill music official songs'],
      malayalam: ['muzik247 malayalam songs', 'satyam audios official songs', 'manorama music malayalam'],
    };

    const getRows = async (queries: string[]) => {
      const lists = await Promise.all(
        queries.map((q) => api.get(`/api/music/search?q=${encodeURIComponent(q)}`).then((r) => r.data).catch(() => []))
      );
      return lists.flat() as Suggestion[];
    };

    const dedupe = (rows: Suggestion[], strictMusic: boolean, allowOldPool: boolean) => {
      const seen = new Set<string>();
      if (!allowOldPool) shownKeysRef.current.clear();
      return rows.filter((x) => {
        const key = canonicalSongKey(x.title || '', x.artist || '');
        if (!x?.id || seen.has(key)) return false;
        if (!allowOldPool && shownKeysRef.current.has(key)) return false;
        if (strictMusic && !isLikelyMusicResult(x)) return false;
        seen.add(key);
        return true;
      });
    };

    const queueIds = new Set(
      queue
        .map((q) => (q.youtubeId || '').toLowerCase())
        .filter((id) => !!id)
    );

    setLoading(true);
    (async () => {
      try {
        let personalizedSeed: Suggestion[] = [];
        if (currentTrack?.youtubeId) {
          const personalized = await fetchPersonalizedRecommendations(
            { youtubeId: currentTrack.youtubeId, title: currentTrack.title, artist: currentTrack.artist },
            queue.map((q) => ({ youtubeId: q.youtubeId, title: q.title, artist: q.artist })),
            roomArtists,
            limit + 6,
            roomId || undefined
          ).catch(() => []);

          personalizedSeed = personalized
            .filter((x) => !!x?.id && !queueIds.has(x.id.toLowerCase()))
            .slice(0, limit);

          if (!mounted) return;
          if (personalizedSeed.length >= Math.min(6, limit)) {
            personalizedSeed.forEach((x) => shownKeysRef.current.add(canonicalSongKey(x.title || '', x.artist || '')));
            setItems(personalizedSeed);
            return;
          }
        }

        const merged = await getRows(primaryQueries);
        let deduped = dedupe(merged, true, false);
        if (deduped.length < limit) {
          deduped = dedupe(merged, true, true);
        }

        if (deduped.length === 0) {
          const fallbackMerged = await getRows(fallbackSeeds[language].slice(0, compact ? 2 : 3));
          deduped = dedupe(fallbackMerged, false, true);
        }

        if (deduped.length === 0) {
          const lastResort = await getRows([`${language} songs`, `${language} official music`]);
          deduped = dedupe(lastResort, false, true);
        }

        if (currentTrack) {
          deduped = deduped.filter((x) => !isSameSongVariant({ title: x.title, artist: x.artist }, { title: currentTrack.title, artist: currentTrack.artist }));
        }
        deduped = deduped.filter((x) => !!x?.id && !queueIds.has(x.id.toLowerCase()));

        if (!mounted) return;
        const mergedFinal = [...personalizedSeed, ...deduped].filter((x, idx, arr) => {
          const key = canonicalSongKey(x.title || '', x.artist || '');
          return arr.findIndex((y) => canonicalSongKey(y.title || '', y.artist || '') === key) === idx;
        });
        const next = mergedFinal.slice(0, limit);
        next.forEach((x) => shownKeysRef.current.add(canonicalSongKey(x.title || '', x.artist || '')));
        setItems(next);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [language, compact, refreshTick, currentTrack, queue, roomArtists, roomId]);

  if (loading) {
    return <div className="p-3 grid grid-cols-3 gap-2">{Array.from({ length: compact ? 6 : 9 }).map((_, i) => <div key={i} className="skeleton rounded-xl h-28" />)}</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-t3 uppercase tracking-wide">Discover</p>
        <button
          onClick={() => setRefreshTick((v) => v + 1)}
          className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2"
        >
          Refresh
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
        {HOME_LANGUAGES.map((lang) => (
          <button
            key={lang}
            onClick={() => onLanguageChange(lang)}
            className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${language === lang ? 'bg-accent text-bg' : 'bg-elevated text-t2'}`}
          >
            {lang}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="px-1 py-6 text-center text-sm text-t3">
          <p>No recommendations yet.</p>
          <button onClick={() => setRefreshTick((v) => v + 1)} className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-elevated text-t2">Retry</button>
        </div>
      ) : (
      <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onAddToQueue({
              youtubeId: item.id,
              title: item.title,
              artist: item.artist,
              durationMs: item.durationMs,
              thumbnailUrl: item.thumbnailUrl,
              mode: 'end',
            })}
            className="text-left rounded-xl overflow-hidden bg-elevated/60 border border-[var(--border)] hover:border-accent/60 transition-colors"
          >
            <div className="aspect-square bg-elevated">
              <Thumb src={item.thumbnailUrl || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`} alt={item.title} className="w-full h-full object-cover" />
            </div>
            <div className="p-2">
              <p className="text-sm truncate">{item.title}</p>
              <p className="text-xs text-t3 truncate">{item.artist}</p>
            </div>
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

function SmartQueuePanel({
  items,
  loading,
  enabled,
  onToggleEnabled,
  onAdd,
  currentTrackTitle,
  roomArtists,
}: {
  items: Suggestion[];
  loading: boolean;
  enabled: boolean;
  onToggleEnabled: () => void;
  onAdd: (item: { youtubeId: string; title: string; artist: string; durationMs: number; thumbnailUrl: string; mode: 'next' | 'end' }) => void;
  currentTrackTitle?: string;
  roomArtists: string[];
}) {
  const getTags = (item: Suggestion) => {
    const tags: string[] = [];
    const itemArtist = (item.artist || '').toLowerCase();
    if (roomArtists.some((a) => a && itemArtist.includes(a.toLowerCase().split(',')[0].trim()))) tags.push('room taste');
    if (currentTrackTitle && tokenOverlap(tokenizedTitle(currentTrackTitle), tokenizedTitle(item.title || '')) > 0.22) tags.push('same artist');
    if (/telugu|hindi|tamil|punjabi|malayalam|english/i.test(`${item.title} ${item.artist}`)) tags.push('language match');
    return tags.slice(0, 2);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-t3">Smart Queue</p>
        <button
          onClick={onToggleEnabled}
          className={`text-xs px-2 py-1 rounded-lg border ${enabled ? 'bg-accent text-bg border-accent' : 'bg-elevated text-t2 border-[var(--border)]'}`}
        >
          {enabled ? 'Auto-play ON' : 'Auto-play OFF'}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)
        ) : items.length === 0 ? (
          <div className="text-xs text-t3 px-2 py-2">No smart suggestions yet. Play a song to generate them.</div>
        ) : (
          items.slice(0, 8).map((r) => (
            <div key={`smart-desktop-${r.id}`} className="flex items-center gap-2 p-2 rounded-xl hover:bg-elevated group">
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-elevated">
                <Thumb src={r.thumbnailUrl || `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs truncate">{r.title}</p>
                <p className="text-[11px] text-t3 truncate">{r.artist}</p>
                <div className="flex gap-1 mt-1">
                  {getTags(r).map((tag) => (
                    <span key={`${r.id}-${tag}`} className="text-[10px] px-1.5 py-0.5 rounded-full bg-elevated text-t3 border border-[var(--border)]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => onAdd({ youtubeId: r.id, title: r.title, artist: r.artist, durationMs: r.durationMs, thumbnailUrl: r.thumbnailUrl, mode: 'end' })}
                className="text-xs px-2 py-1.5 rounded-lg bg-accent text-bg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Add
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PlayerCore({
  isHostOrDj,
  seekValue,
  onSeekPreview,
  onSeekCommit,
  onPlay,
  onPause,
  onSkipPrev,
  onSkipNext,
  onShuffle,
  onToggleLoop,
  volume,
  onVolumeChange,
  onSeekStart,
  onSeekEnd,
}: {
  isHostOrDj: boolean;
  seekValue: number;
  onSeekPreview: (v: number) => void;
  onSeekCommit: (v: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onSkipPrev: () => void;
  onSkipNext: () => void;
  onShuffle: () => void;
  onToggleLoop: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
}) {
  const { currentTrack, playbackState } = useStore();
  const [showSecondaryControls, setShowSecondaryControls] = useState(false);

  return (
    <div className="mx-auto max-w-md">
        <motion.div layoutId={currentTrack ? `track-art-${currentTrack.youtubeId}` : 'track-art-empty'} className="aspect-square rounded-2xl overflow-hidden bg-elevated mb-4 shadow-2xl">
          {currentTrack?.thumbnailUrl
            ? <Thumb src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-6xl text-t3">♪</div>}
        </motion.div>

        <div className="text-center mb-3">
          <p className="font-display text-2xl text-t1 truncate">{currentTrack?.title || 'Nothing playing'}</p>
          <p className="text-sm text-t2 truncate mt-1">{currentTrack?.artist || '-'}</p>
        </div>

        <div className="mb-3">
          <input
            className="w-full h-11 appearance-none bg-transparent cursor-pointer seeker-range"
            type="range"
            min={0}
            max={currentTrack?.durationMs || 100}
            value={seekValue}
            onChange={(e) => onSeekPreview(Number(e.target.value))}
            onMouseUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            onMouseDown={onSeekStart}
            onTouchStart={onSeekStart}
            onPointerUp={onSeekEnd}
            disabled={!isHostOrDj}
          />
          <div className="flex justify-between text-xs text-t3 font-mono mt-1">
            <span>{formatTime(seekValue)}</span>
            <span>{formatTime(currentTrack?.durationMs || 0)}</span>
          </div>
        </div>

        <div className="flex justify-center mb-3"><Visualizer isPlaying={playbackState.isPlaying} bars={28} /></div>

        <div className="flex items-center justify-center gap-6">
          <button onClick={onShuffle} disabled={!isHostOrDj} className="p-2 text-t3 disabled:opacity-30">↺</button>
          <button onClick={onSkipPrev} disabled={!isHostOrDj} className="p-2 text-t2 disabled:opacity-30">⏮</button>
          <button onClick={playbackState.isPlaying ? onPause : onPlay} disabled={!isHostOrDj} className="w-14 h-14 rounded-full bg-accent text-bg text-2xl disabled:opacity-30">
            {playbackState.isPlaying ? '❚❚' : '▶'}
          </button>
          <button onClick={onSkipNext} disabled={!isHostOrDj} className="p-2 text-t2 disabled:opacity-30">⏭</button>
          <button onClick={() => setShowSecondaryControls((v) => !v)} className="p-2 text-t3">⋯</button>
        </div>

        <AnimatePresence>
          {showSecondaryControls && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="mt-2 flex items-center justify-center gap-3"
            >
              <button onClick={onToggleLoop} className={`px-3 py-1.5 rounded-lg text-xs ${playbackState.isLooping ? 'bg-accent text-bg' : 'bg-elevated text-t2'}`}>Loop</button>
              <button onClick={onShuffle} disabled={!isHostOrDj} className="px-3 py-1.5 rounded-lg text-xs bg-elevated text-t2 disabled:opacity-30">Shuffle</button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 px-2 flex items-center gap-2">
          <span className="text-xs text-t3">Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="w-full h-1.5 accent-[var(--accent)] cursor-pointer"
          />
          <span className="text-[11px] text-t3 w-9 text-right">{Math.round(volume * 100)}%</span>
        </div>
      </div>
  );
}

export default function RoomPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const isMobile = useIsMobile();

  const {
    token, userId,
    roomId, roomName, hostId, djMode,
    currentTrack, queue, playbackState, localPositionMs,
    setRoom, clearRoom, setCurrentTrack, setPlaybackState,
    setQueue, setParticipants, setDjMode, setMessages, messages, participants,
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [seekValue, setSeekValue] = useState(0);
  const [draggingSeek, setDraggingSeek] = useState(false);
  const [mobileTab, setMobileTab] = useState<'room' | 'player' | 'chat'>('player');
  const [mobileRoomPanel, setMobileRoomPanel] = useState<'home' | 'listeners'>('home');
  const [mobilePlayerPanel, setMobilePlayerPanel] = useState<'search' | 'recommendations' | 'queue'>('search');
  const [mobilePanelSnap, setMobilePanelSnap] = useState<35 | 65 | 92>(65);
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [swipePreviewX, setSwipePreviewX] = useState(0);
  const [desktopSocialTab, setDesktopSocialTab] = useState<'chat' | 'people'>('chat');
  const [desktopLeftTab, setDesktopLeftTab] = useState<'home' | 'queue' | 'search' | 'recommendations'>('home');
  const [desktopSearchQuery, setDesktopSearchQuery] = useState('');
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(false);
  const [desktopRightOpen, setDesktopRightOpen] = useState(false);
  const [desktopLeftWidth, setDesktopLeftWidth] = useState(360);
  const [desktopRightWidth, setDesktopRightWidth] = useState(360);
  const [desktopDockActive, setDesktopDockActive] = useState<'home' | 'search' | 'recommendations' | 'queue' | 'chat'>('home');
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [homeLanguage, setHomeLanguage] = useState<HomeLanguage>('english');
  const [volume, setVolume] = useState(0.92);
  const [isOffline, setIsOffline] = useState(false);
  const [showInstallCard, setShowInstallCard] = useState(false);
  const [smartQueueEnabled, setSmartQueueEnabled] = useState(true);
  const [smartQueueItems, setSmartQueueItems] = useState<Suggestion[]>([]);
  const [smartQueueLoading, setSmartQueueLoading] = useState(false);

  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const warnedLastTrackRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(0);
  const chatInitializedRef = useRef(false);
  const smartQueueAutoRef = useRef('');
  const playedCanonRef = useRef<string[]>([]);
  const drawerResizeRef = useRef<'left' | 'right' | null>(null);
  const isHost = userId === hostId;
  const isHostOrDj = isHost || djMode;
  const roomArtists = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of queue) {
      const artist = (item.artist || '').trim();
      if (!artist) continue;
      map.set(artist, (map.get(artist) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([artist]) => artist);
  }, [queue]);

  const desktopPlayerMaxWidth = useMemo(() => {
    const reduction = (desktopLeftOpen ? desktopLeftWidth : 0) + (desktopRightOpen ? desktopRightWidth : 0);
    return Math.max(760, 1240 - reduction * 0.5);
  }, [desktopLeftOpen, desktopRightOpen, desktopLeftWidth, desktopRightWidth]);

  const {
    timeOffsetRef, joinRoom, leaveRoom,
    play, pause, seek, skipNext, skipPrev,
    shuffleQueue, toggleLoop, sendChat, toggleDjMode, trackEnded, syncRequest,
    addToQueue, removeFromQueue, reorderQueue, clearQueue,
    connectionState,
  } = useSocket();

  useAudio({ isHost, djMode, volume, timeOffsetRef, onTrackEnded: trackEnded, onPlay: play, onPause: pause });

  // Adaptive colour — tints the whole UI to match the current track's artwork
  useAdaptiveColor(currentTrack?.thumbnailUrl);

  useEffect(() => {
    if (!token) { router.replace('/'); return; }
    chatInitializedRef.current = false;
    prevMessageCountRef.current = 0;
    setUnreadChatCount(0);

    (async () => {
      try {
        const res = await api.get(`/api/rooms/${params.slug}`);
        const room = res.data;
        const roomIdValue = String(room.id ?? '');
        const roomSlugValue = String(room.slug ?? params.slug ?? '');
        const roomNameValue = String(room.name ?? 'Room');
        const roomHostId = String(room.host_id ?? room.hostId ?? '');

        setRoom(roomIdValue, roomSlugValue, roomNameValue, roomHostId);
        setPlaybackState({
          trackId: room.playbackState?.trackId ? String(room.playbackState.trackId) : null,
          positionMs: Number(room.playbackState?.positionMs || 0),
          isPlaying: Boolean(room.playbackState?.isPlaying),
          timestamp: Number(room.playbackState?.timestamp || Date.now()),
          isLooping: Boolean(room.playbackState?.isLooping),
        });

        setQueue(room.queue.map((q: Record<string, unknown>) => ({
          id: String(q.id),
          position: Number(q.position || 0),
          votes: Number(q.votes || 0),
          addMode: String(q.add_mode || 'end'),
          addedBy: (q.added_by || null) as string | null,
          addedByUsername: (q.added_by_username || null) as string | null,
          trackId: String(q.track_id || ''),
          youtubeId: String(q.youtube_id || ''),
          title: String(q.title || ''),
          artist: String(q.artist || ''),
          durationMs: Number(q.duration_ms || 0),
          thumbnailUrl: String(q.thumbnail_url || ''),
        })));

        setParticipants(room.participants.map((p: Record<string, unknown>) => ({
          userId: String(p.user_id),
          username: String(p.username),
          joinedAt: String(p.joined_at),
        })));

        setDjMode(Boolean(room.djMode || false));

        if (room.queue?.length > 0) {
          const activeYoutubeId = room.playbackState?.trackId ? String(room.playbackState.trackId) : null;
          const t = activeYoutubeId
            ? (room.queue.find((q: Record<string, unknown>) => String(q.youtube_id || '') === activeYoutubeId) || room.queue[0])
            : room.queue[0];
          setCurrentTrack({
            id: String(t.track_id),
            youtubeId: String(t.youtube_id),
            title: String(t.title),
            artist: String(t.artist),
            durationMs: Number(t.duration_ms || 0),
            thumbnailUrl: String(t.thumbnail_url || ''),
          });
        }

        const msgRes = await api.get(`/api/rooms/${params.slug}/messages`);
        const initialMessages = (Array.isArray(msgRes.data) ? msgRes.data : []).map((m: Record<string, unknown>) => ({
          userId: String(m.user_id),
          username: String(m.username),
          content: String(m.content),
          createdAt: String(m.created_at),
        }));
        setMessages(initialMessages);
        prevMessageCountRef.current = initialMessages.length;
        setUnreadChatCount(0);
        chatInitializedRef.current = true;

        joinRoom(roomIdValue);
        setLoading(false);
      } catch {
        toast.error('Room not found');
        router.replace('/browse');
      }
    })();

    return () => { clearRoom(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.slug]);

  useEffect(() => {
    if (!draggingSeek) setSeekValue(localPositionMs);
  }, [localPositionMs, draggingSeek]);

  const triggerHaptic = useCallback((pattern: number | number[] = 10) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('lito-home-language') as HomeLanguage | null;
    if (saved && HOME_LANGUAGES.includes(saved)) {
      setHomeLanguage(saved);
    }
    const savedVolume = Number(window.localStorage.getItem('lito-pref-volume') || '0.92');
    if (!Number.isNaN(savedVolume)) setVolume(Math.max(0, Math.min(1, savedVolume)));
    const savedMobileTab = window.localStorage.getItem('lito-pref-mobile-tab');
    if (savedMobileTab === 'room' || savedMobileTab === 'player' || savedMobileTab === 'chat') setMobileTab(savedMobileTab);
    const savedPlayerPanel = window.localStorage.getItem('lito-pref-mobile-player-panel');
    if (savedPlayerPanel === 'search' || savedPlayerPanel === 'recommendations' || savedPlayerPanel === 'queue') setMobilePlayerPanel(savedPlayerPanel);
    const savedDesktopLeft = window.localStorage.getItem('lito-pref-desktop-left');
    if (savedDesktopLeft === 'home' || savedDesktopLeft === 'queue' || savedDesktopLeft === 'search' || savedDesktopLeft === 'recommendations') setDesktopLeftTab(savedDesktopLeft);
    const savedSmartEnabled = window.localStorage.getItem('lito-smart-queue-enabled');
    if (savedSmartEnabled === '0' || savedSmartEnabled === '1') setSmartQueueEnabled(savedSmartEnabled === '1');
    const savedLeftWidth = Number(window.localStorage.getItem('lito-pref-desktop-left-width') || '360');
    const savedRightWidth = Number(window.localStorage.getItem('lito-pref-desktop-right-width') || '360');
    if (!Number.isNaN(savedLeftWidth)) setDesktopLeftWidth(Math.max(300, Math.min(520, savedLeftWidth)));
    if (!Number.isNaN(savedRightWidth)) setDesktopRightWidth(Math.max(300, Math.min(520, savedRightWidth)));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-home-language', homeLanguage);
  }, [homeLanguage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-pref-volume', String(volume));
  }, [volume]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-pref-mobile-tab', mobileTab);
  }, [mobileTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-pref-mobile-player-panel', mobilePlayerPanel);
  }, [mobilePlayerPanel]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-pref-desktop-left', desktopLeftTab);
  }, [desktopLeftTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-pref-desktop-left-width', String(desktopLeftWidth));
  }, [desktopLeftWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-pref-desktop-right-width', String(desktopRightWidth));
  }, [desktopRightWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drawerResizeRef.current || typeof window === 'undefined') return;
      if (drawerResizeRef.current === 'left') {
        const next = Math.max(300, Math.min(560, e.clientX - 20));
        setDesktopLeftWidth(next);
      } else {
        const next = Math.max(300, Math.min(560, window.innerWidth - e.clientX - 20));
        setDesktopRightWidth(next);
      }
    };
    const onUp = () => {
      drawerResizeRef.current = null;
      if (typeof document !== 'undefined') document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-smart-queue-enabled', smartQueueEnabled ? '1' : '0');
  }, [smartQueueEnabled]);

  useEffect(() => {
    const currentId = currentTrack?.youtubeId;
    if (!currentId || !playbackState.isPlaying) return;

    const isLastSong = queue.length <= 1;
    if (isLastSong && warnedLastTrackRef.current !== currentId) {
      toast('Last song is playing. Queue will be empty next.', { icon: '⚠', duration: 4000 });
      warnedLastTrackRef.current = currentId;
    }

    if (!isLastSong) {
      warnedLastTrackRef.current = null;
    }
  }, [currentTrack?.youtubeId, playbackState.isPlaying, queue.length]);

  useEffect(() => {
    if (!currentTrack) return;
    const key = canonicalSongKey(currentTrack.title || '', currentTrack.artist || '');
    if (!key) return;
    playedCanonRef.current = [key, ...playedCanonRef.current.filter((x) => x !== key)].slice(0, 60);
  }, [currentTrack, currentTrack?.youtubeId, currentTrack?.title, currentTrack?.artist]);

  useEffect(() => {
    const recoverSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      syncRequest();
    };

    document.addEventListener('visibilitychange', recoverSync);
    window.addEventListener('focus', recoverSync);
    window.addEventListener('pageshow', recoverSync);
    return () => {
      document.removeEventListener('visibilitychange', recoverSync);
      window.removeEventListener('focus', recoverSync);
      window.removeEventListener('pageshow', recoverSync);
    };
  }, [syncRequest]);

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    const promptKey = 'lito-install-nudge-ts';
    const lastPromptAt = Number(window.localStorage.getItem(promptKey) || '0');
    const cooldownMs = 12 * 60 * 60 * 1000;
    if (Date.now() - lastPromptAt < cooldownMs) return;

    const ua = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    setShowInstallCard(true);

    window.localStorage.setItem(promptKey, String(Date.now()));
  }, [isMobile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setIsOffline(!window.navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isMobile && !window.localStorage.getItem('lito-tip-swipe-tabs')) {
      toast('Tip: swipe left or right to switch Room / Player / Chat.', { duration: 3600 });
      window.localStorage.setItem('lito-tip-swipe-tabs', '1');
    }
    if (isHostOrDj && !window.localStorage.getItem('lito-tip-queue-drag')) {
      toast('Tip: drag queue rows to reorder instantly.', { duration: 3200 });
      window.localStorage.setItem('lito-tip-queue-drag', '1');
    }
    if (!window.localStorage.getItem('lito-tip-playlist-import')) {
      toast('Tip: paste YouTube/Spotify playlist links in search to import.', { duration: 3400 });
      window.localStorage.setItem('lito-tip-playlist-import', '1');
    }
  }, [isMobile, isHostOrDj]);

  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = e.key.toLowerCase();

      if (key === 'q') {
        e.preventDefault();
        setDesktopLeftOpen((v) => !v);
        setDesktopDockActive('queue');
        setDesktopLeftTab('queue');
        return;
      }
      if (key === 'c') {
        e.preventDefault();
        setDesktopRightOpen((v) => !v);
        setDesktopDockActive('chat');
        setDesktopSocialTab('chat');
        return;
      }
      if (key === 'h') {
        e.preventDefault();
        setDesktopLeftOpen(true);
        setDesktopLeftTab('home');
        setDesktopDockActive('home');
        return;
      }
      if (key === '?') {
        e.preventDefault();
        setShowShortcutHelp((v) => !v);
        return;
      }

      if (!isHostOrDj) return;

      if (e.code === 'Space') {
        e.preventDefault();
        triggerHaptic();
        if (playbackState.isPlaying) pause(localPositionMs);
        else play(localPositionMs);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(Math.min((currentTrack?.durationMs || 0), localPositionMs + 5000));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(0, localPositionMs - 5000));
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        skipNext();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        skipPrev();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, isHostOrDj, playbackState.isPlaying, localPositionMs, currentTrack?.durationMs, play, pause, seek, skipNext, skipPrev, triggerHaptic]);

  useEffect(() => {
    if (!chatInitializedRef.current) {
      prevMessageCountRef.current = messages.length;
      return;
    }

    const previous = prevMessageCountRef.current;
    const next = messages.length;
    if (next > previous) {
      const desktopUnread = !isMobile && desktopSocialTab !== 'chat';
      const mobileUnread = isMobile && mobileTab !== 'chat';
      if (desktopUnread || mobileUnread) {
        setUnreadChatCount((v) => v + (next - previous));
      }
    }
    prevMessageCountRef.current = next;
  }, [messages.length, isMobile, desktopSocialTab, mobileTab]);

  useEffect(() => {
    let mounted = true;
    if (!currentTrack) {
      setSmartQueueItems([]);
      return;
    }

    setSmartQueueLoading(true);
    fetchPersonalizedRecommendations(
      { youtubeId: currentTrack.youtubeId, title: currentTrack.title, artist: currentTrack.artist },
      queue.map((q) => ({ youtubeId: q.youtubeId, title: q.title, artist: q.artist })),
      roomArtists,
      12,
      roomId || undefined
    )
      .then(async (items) => {
        if (!mounted) return;
        const recentSet = new Set(playedCanonRef.current);
        let filtered = items.filter((x) => !recentSet.has(canonicalSongKey(x.title || '', x.artist || '')));
        if (filtered.length === 0) {
          const langHint = detectLanguageHintFromText(`${currentTrack.title} ${currentTrack.artist}`);
          const fallback = await api.get(`/api/music/search?q=${encodeURIComponent(`${langHint} official songs`)}`).then((r) => r.data as Suggestion[]).catch(() => []);
          filtered = fallback.filter((x) => {
            const key = canonicalSongKey(x.title || '', x.artist || '');
            return !!x?.id && !recentSet.has(key);
          }).slice(0, 12);
        }
        setSmartQueueItems(filtered);
      })
      .finally(() => {
        if (mounted) setSmartQueueLoading(false);
      });

    return () => { mounted = false; };
  }, [currentTrack, currentTrack?.youtubeId, queue, roomArtists, roomId]);

  useEffect(() => {
    if (!smartQueueEnabled || !isHostOrDj) return;
    if (!currentTrack || !playbackState.isPlaying) return;
    // queue includes currently playing track at index 0. Auto-fill when only current is left.
    if (queue.length > 1) {
      smartQueueAutoRef.current = '';
      return;
    }
    const autoInsert = async () => {
      let next = smartQueueItems[0];
      if (!next) {
        const langHint = detectLanguageHintFromText(`${currentTrack.title} ${currentTrack.artist}`);
        const fallback = await api.get(`/api/music/search?q=${encodeURIComponent(`${langHint} official songs`)}`).then((r) => r.data as Suggestion[]).catch(() => []);
        next = (fallback || [])[0];
      }
      if (!next) return;

      const fingerprint = `${currentTrack.youtubeId}:${next.id}`;
      if (smartQueueAutoRef.current === fingerprint) return;
      smartQueueAutoRef.current = fingerprint;

      if (queueHasYoutubeId(useStore.getState().queue, next.id)) {
        return;
      }

      const optimistic: QueueItem = {
        id: `optimistic-smart-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        position: queue.length,
        votes: 0,
        addMode: 'end',
        addedBy: userId,
        addedByUsername: useStore.getState().username || 'smart queue',
        trackId: next.id,
        youtubeId: next.id,
        title: next.title,
        artist: next.artist,
        durationMs: next.durationMs,
        thumbnailUrl: next.thumbnailUrl,
      };
      setQueue([...useStore.getState().queue, optimistic]);
      addToQueue({
        youtubeId: next.id,
        title: next.title,
        artist: next.artist,
        durationMs: next.durationMs,
        thumbnailUrl: next.thumbnailUrl,
        mode: 'end',
      });
      toast('Smart queue picked the next song', { duration: 2200 });
    };

    void autoInsert();
  }, [smartQueueEnabled, isHostOrDj, currentTrack, currentTrack?.youtubeId, playbackState.isPlaying, queue.length, smartQueueItems, userId, setQueue, addToQueue]);

  const handleSeekCommit = (value: number) => {
    setDraggingSeek(false);
    if (isHostOrDj) seek(value);
  };
  const handleSeekStart = () => {
    setDraggingSeek(true);
    triggerHaptic(8);
  };
  const handleSeekEnd = () => {
    triggerHaptic(8);
  };

  const handleLeave = () => {
    if (roomId) leaveRoom(roomId);
    clearRoom();
    router.push('/browse');
  };
  const clearEntireQueue = () => {
    if (!isHostOrDj) return;
    const ok = typeof window === 'undefined' ? true : window.confirm('Clear the entire queue? This will stop current playback.');
    if (!ok) return;
    clearQueue();
    toast.success('Queue cleared');
  };

  const onPlay = () => {
    triggerHaptic();
    if (!playbackState.trackId && queue.length > 0) {
      skipNext();
      return;
    }
    play(localPositionMs);
  };
  const onPause = () => {
    triggerHaptic();
    pause(localPositionMs);
  };
  const onSkipPrevAction = () => {
    triggerHaptic(12);
    skipPrev();
  };
  const onSkipNextAction = () => {
    triggerHaptic(12);
    skipNext();
  };
  const onShuffleAction = () => {
    triggerHaptic(12);
    shuffleQueue();
  };
  const onToggleLoopAction = () => {
    triggerHaptic(10);
    toggleLoop();
  };
  const addToQueueFromSearch = useCallback((item: { youtubeId: string; title: string; artist: string; durationMs: number; thumbnailUrl: string; mode: 'next' | 'end' }) => {
    const currentQueue = useStore.getState().queue;
    if (queueHasYoutubeId(currentQueue, item.youtubeId)) {
      toast('Song is already in queue', { duration: 2000 });
      return;
    }

    const optimistic: QueueItem = {
      id: `optimistic-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      position: queue.length,
      votes: 0,
      addMode: item.mode,
      addedBy: userId,
      addedByUsername: useStore.getState().username || 'you',
      trackId: item.youtubeId,
      youtubeId: item.youtubeId,
      title: item.title,
      artist: item.artist,
      durationMs: item.durationMs,
      thumbnailUrl: item.thumbnailUrl,
    };
    const nextQueue = [...currentQueue];
    if (item.mode === 'next') nextQueue.splice(Math.min(1, nextQueue.length), 0, optimistic);
    else nextQueue.push(optimistic);
    setQueue(nextQueue);

    addToQueue(item);
    triggerHaptic(14);
    toast.success(`Added to queue: ${item.title}`, { duration: 2200 });
  }, [queue.length, userId, setQueue, addToQueue, triggerHaptic]);

  const shouldIgnoreTabSwipe = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest('input, textarea, [contenteditable="true"], [data-no-tab-swipe="true"]');
  }, []);

  if (loading) return <div className="min-h-screen grid place-items-center"><div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  if (isMobile) {
    const tabOrder: Array<'room' | 'player' | 'chat'> = ['room', 'player', 'chat'];
    const currentIndex = tabOrder.indexOf(mobileTab);

    const onSwipeEnd = (x: number) => {
      if (touchStartXRef.current === null) return;
      const deltaX = x - touchStartXRef.current;
      if (Math.abs(deltaX) < 140) return;
      if (deltaX < 0 && currentIndex < tabOrder.length - 1) setMobileTab(tabOrder[currentIndex + 1]);
      if (deltaX > 0 && currentIndex > 0) setMobileTab(tabOrder[currentIndex - 1]);
      setSwipePreviewX(0);
    };

    return (
      <div className="min-h-screen bg-bg safe-pt safe-pb">
        <div className="mesh-bg">
          <div className="mesh-blob w-80 h-80 -top-20 -left-20" style={{ background: 'var(--accent)' }} />
          <div className="mesh-blob w-80 h-80 top-1/2 -right-24" style={{ background: 'var(--accent-dim)' }} />
        </div>

        <div
          className="relative z-[1] px-4 pt-4 space-y-3"
          onTouchStart={(e) => {
            if (shouldIgnoreTabSwipe(e.target)) {
              touchStartXRef.current = null;
              setSwipePreviewX(0);
              return;
            }
            touchStartXRef.current = e.changedTouches[0].clientX;
            setSwipePreviewX(0);
          }}
          onTouchMove={(e) => {
            if (touchStartXRef.current === null) return;
            const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
            const atLeftEdge = currentIndex === 0 && deltaX > 0;
            const atRightEdge = currentIndex === tabOrder.length - 1 && deltaX < 0;
            const resisted = (atLeftEdge || atRightEdge) ? deltaX * 0.35 : deltaX * 0.18;
            setSwipePreviewX(Math.max(-48, Math.min(48, resisted)));
          }}
          onTouchEnd={(e) => {
            onSwipeEnd(e.changedTouches[0].clientX);
            setSwipePreviewX(0);
          }}
        >
          <div className="flex items-center gap-2">
            <button onClick={() => router.push('/browse')} className="h-11 w-11 rounded-2xl apple-glass flex items-center justify-center text-t2 shrink-0">
              <TopBackIcon />
            </button>
            <div className="apple-glass glow-accent rounded-[28px] px-2 py-1.5 grid grid-cols-3 gap-2 flex-1">
            {([
              { id: 'room', label: 'Room', icon: <TopRoomIcon /> },
              { id: 'player', label: 'Player', icon: <TopPlayerIcon /> },
              { id: 'chat', label: 'Chat', icon: <TopChatIcon /> },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  triggerHaptic();
                  setMobileTab(tab.id);
                  if (tab.id === 'chat') setUnreadChatCount(0);
                  if (tab.id === 'room') setMobileRoomPanel('home');
                }}
                aria-label={tab.label}
                className={`relative h-11 rounded-2xl flex items-center justify-center transition-all active:scale-95 ${mobileTab === tab.id ? 'text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)] scale-[1.02]' : 'text-t2 bg-white/[0.04]'}`}
              >
                {mobileTab === tab.id && (
                  <motion.span
                    layoutId="mobile-top-tab-indicator"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-2xl bg-accent -z-[1]"
                  />
                )}
                {tab.icon}
                {tab.id === 'chat' && unreadChatCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] leading-[18px] text-white text-center">
                    {unreadChatCount > 9 ? '9+' : unreadChatCount}
                  </span>
                )}
              </button>
            ))}
            </div>
            <div className="shrink-0"><InstallAppButton compact /></div>
          </div>
          <div className="px-1">
            <div className="inline-flex items-center gap-2 text-[11px] text-t3">
              <span className={`inline-block w-2 h-2 rounded-full ${connectionState === 'synced' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              {connectionState === 'synced' ? 'Synced' : 'Reconnecting'}
            </div>
          </div>

          <div style={{ transform: `translate3d(${swipePreviewX}px, 0, 0)`, transition: swipePreviewX === 0 ? 'transform 160ms ease-out' : 'none' }}>
          <AnimatePresence mode="wait">
            {mobileTab === 'room' && (
              <motion.div key="room" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="apple-glass rounded-2xl h-[68vh] overflow-hidden flex flex-col">
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-t1">{roomName}</p>
                    <p className="text-xs text-t3">Room home</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isHost && <button onClick={toggleDjMode} className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2">DJ</button>}
                    <button onClick={handleLeave} className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2">Leave</button>
                  </div>
                </div>
                <button
                  onClick={() => { triggerHaptic(); setMobileRoomPanel('listeners'); }}
                  className="mx-3 mb-2 px-2 py-2 rounded-xl bg-elevated/60 border border-[var(--border)] flex items-center justify-between"
                >
                  <div className="flex -space-x-2 items-center overflow-hidden">
                    {participants.slice(0, 6).map((p) => (
                      <div key={p.userId} className="w-7 h-7 rounded-full border border-black flex items-center justify-center text-[10px] font-bold" style={{ background: avatarColor(p.username), color: '#000' }}>
                        {p.username[0]?.toUpperCase()}
                      </div>
                    ))}
                    <span className="text-xs text-t2 ml-3">{participants.length} listeners</span>
                  </div>
                  <span className="text-xs text-t3">Open</span>
                </button>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {mobileRoomPanel === 'listeners' ? (
                    <div className="h-full min-h-0 flex flex-col">
                      <div className="px-3 pb-2">
                        <button
                          onClick={() => { triggerHaptic(); setMobileRoomPanel('home'); }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-elevated text-t2"
                        >
                          ← Back to Home
                        </button>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        <People />
                      </div>
                    </div>
                  ) : (
                    <RoomHomePanel onAddToQueue={addToQueueFromSearch} language={homeLanguage} onLanguageChange={setHomeLanguage} compact />
                  )}
                </div>
              </motion.div>
            )}

            {mobileTab === 'player' && (
              <motion.div key="player" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-2">
                <div className="apple-glass rounded-2xl overflow-hidden">
                  <div className="px-3 py-2">
                    <PlayerCore
                      isHostOrDj={isHostOrDj}
                      seekValue={seekValue}
                      onSeekPreview={(v) => { setDraggingSeek(true); setSeekValue(v); }}
                      onSeekCommit={handleSeekCommit}
                      onPlay={onPlay}
                      onPause={onPause}
                      onSkipPrev={onSkipPrevAction}
                      onSkipNext={onSkipNextAction}
                      onShuffle={onShuffleAction}
                      onToggleLoop={onToggleLoopAction}
                      volume={volume}
                      onVolumeChange={setVolume}
                      onSeekStart={handleSeekStart}
                      onSeekEnd={handleSeekEnd}
                    />
                  </div>

                  <div
                    className="border-t border-[var(--border)] overflow-hidden rounded-t-2xl apple-glass flex flex-col"
                    style={{ height: `${mobilePanelSnap}vh` }}
                    onTouchStart={(e) => { touchStartYRef.current = e.changedTouches[0].clientY; }}
                    onTouchEnd={(e) => {
                      if (touchStartYRef.current === null) return;
                      const delta = e.changedTouches[0].clientY - touchStartYRef.current;
                      if (Math.abs(delta) < 28) return;
                      const snaps: Array<35 | 65 | 92> = [35, 65, 92];
                      const idx = snaps.indexOf(mobilePanelSnap);
                      if (delta < 0 && idx < snaps.length - 1) setMobilePanelSnap(snaps[idx + 1]);
                      if (delta > 0 && idx > 0) setMobilePanelSnap(snaps[idx - 1]);
                    }}
                  >
                    <div className="sticky top-0 z-10 bg-bg/65 backdrop-blur-md">
                      <div className="pt-2 pb-1 flex justify-center">
                        <button
                          onClick={() => setMobilePanelSnap((v) => (v === 35 ? 65 : v === 65 ? 92 : 35))}
                          className="w-14 h-1.5 rounded-full bg-white/30"
                          aria-label="Resize panel"
                        />
                      </div>
                      <div className="px-3 pb-1">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-xs text-t2 truncate max-w-[240px]">{currentTrack?.title || 'Nothing playing'}</p>
                            <p className="text-[11px] text-t3 truncate max-w-[240px]">{currentTrack?.artist || '-'}</p>
                          </div>
                          <div className="inline-flex items-center gap-1 text-[10px] text-t3">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${connectionState === 'synced' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                            {connectionState === 'synced' ? 'Synced' : 'Reconnecting'}
                          </div>
                        </div>
                        <div className="apple-glass glow-accent rounded-[24px] px-4 py-2 flex items-center justify-around">
                          <button onClick={() => { triggerHaptic(); setMobilePlayerPanel('search'); }} className={`relative h-11 w-11 rounded-2xl flex items-center justify-center active:scale-95 ${mobilePlayerPanel === 'search' ? 'text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Search">
                            {mobilePlayerPanel === 'search' && <motion.span layoutId="mobile-player-tab-indicator" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-2xl bg-accent -z-[1]" />}
                            <SearchIcon />
                          </button>
                          <button onClick={() => { triggerHaptic(); setMobilePlayerPanel('recommendations'); }} className={`relative h-11 w-11 rounded-2xl flex items-center justify-center active:scale-95 ${mobilePlayerPanel === 'recommendations' ? 'text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Recommendations">
                            {mobilePlayerPanel === 'recommendations' && <motion.span layoutId="mobile-player-tab-indicator" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-2xl bg-accent -z-[1]" />}
                            <RecommendIcon />
                          </button>
                          <button onClick={() => { triggerHaptic(); setMobilePlayerPanel('queue'); }} className={`relative h-11 w-11 rounded-2xl flex items-center justify-center active:scale-95 ${mobilePlayerPanel === 'queue' ? 'text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Queue">
                            {mobilePlayerPanel === 'queue' && <motion.span layoutId="mobile-player-tab-indicator" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-2xl bg-accent -z-[1]" />}
                            <QueueIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                    {mobilePlayerPanel === 'search' && (
                      <div data-no-tab-swipe="true">
                        <SearchResultsPanel
                          query={mobileSearchQuery}
                          onQueryChange={setMobileSearchQuery}
                          onAddToQueue={addToQueueFromSearch}
                          recentKey="lito-recent-searches-mobile"
                        />
                      </div>
                    )}
                    {mobilePlayerPanel === 'recommendations' && <RecommendationsPanel onAddToQueue={addToQueueFromSearch} />}
                    {mobilePlayerPanel === 'queue' && (
                      <Queue
                        onAddToQueue={addToQueueFromSearch}
                        onRemoveFromQueue={(id) => { triggerHaptic(10); removeFromQueue(id); }}
                        onReorderQueue={reorderQueue}
                        isHostOrDj={isHostOrDj}
                        showSearch={false}
                        onRequestSearch={() => setMobilePlayerPanel('search')}
                        smartQueueItems={smartQueueItems}
                        smartQueueEnabled={smartQueueEnabled}
                        smartQueueLoading={smartQueueLoading}
                        onToggleSmartQueueEnabled={() => setSmartQueueEnabled((v) => !v)}
                        canClearQueue={isHostOrDj}
                        onClearQueue={clearEntireQueue}
                      />
                    )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {mobileTab === 'chat' && (
              <motion.div key="chat" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="apple-glass rounded-2xl h-[68vh] overflow-hidden">
                <Chat onSendMessage={sendChat} />
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>
        <AnimatePresence>
          {isOffline && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} className="fixed left-4 right-4 bottom-6 z-50 apple-glass rounded-xl px-3 py-2 text-xs text-t2">
              Offline mode: reconnecting to room...
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showInstallCard && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} className="fixed left-4 right-4 bottom-20 z-40 apple-glass rounded-xl px-3 py-2 text-xs text-t2 flex items-center justify-between">
              <span>Install LiTo for smoother background playback.</span>
              <button onClick={() => setShowInstallCard(false)} className="px-2 py-1 rounded-lg bg-elevated text-t2">Hide</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg relative overflow-hidden">
      <div className="mesh-bg">
        <div className="mesh-blob w-[38rem] h-[38rem] -top-24 -left-24" style={{ background: 'var(--accent)' }} />
        <div className="mesh-blob w-[36rem] h-[36rem] top-1/3 -right-24" style={{ background: 'var(--accent-dim)' }} />
      </div>

      <div className="relative z-[1] max-w-[1700px] mx-auto px-5 py-5 min-h-screen flex flex-col">
        <div className="apple-glass rounded-2xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl">{roomName}</h1>
            <p className="text-xs text-t3">Minimal Glass Pro</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setDesktopRightOpen(true); setDesktopSocialTab('people'); }}
              className="flex -space-x-2 items-center"
              title="Open listeners"
            >
              {participants.slice(0, 6).map((p) => (
                <div key={p.userId} className="w-7 h-7 rounded-full border border-black flex items-center justify-center text-[10px] font-bold" style={{ background: avatarColor(p.username), color: '#000' }}>
                  {p.username[0]?.toUpperCase()}
                </div>
              ))}
            </button>
            <div className="inline-flex items-center gap-2 text-xs text-t3">
              <span className={`inline-block w-2 h-2 rounded-full ${connectionState === 'synced' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              {connectionState === 'synced' ? 'Synced' : 'Reconnecting'}
            </div>
            <InstallAppButton compact />
            {isHost && <button onClick={toggleDjMode} className="px-3 py-1.5 rounded-lg bg-elevated text-t2">DJ</button>}
            <button onClick={handleLeave} className="px-3 py-1.5 rounded-lg bg-elevated text-t2">Leave</button>
          </div>
        </div>

        <div className="relative flex-1 mt-4">
          <AnimatePresence>
            {desktopLeftOpen && (
              <motion.div
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="absolute left-0 top-0 bottom-0 apple-glass rounded-2xl overflow-hidden z-20 flex flex-col"
                style={{ width: desktopLeftWidth }}
              >
                <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wider text-t3">{desktopLeftTab}</p>
                  <button onClick={() => setDesktopLeftOpen(false)} className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2">Close</button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {desktopLeftTab === 'home' && (
                    <RoomHomePanel
                      onAddToQueue={addToQueueFromSearch}
                      language={homeLanguage}
                      onLanguageChange={setHomeLanguage}
                    />
                  )}
                  {desktopLeftTab === 'queue' && (
                    <div className="h-full flex flex-col">
                      <div className="flex-1 min-h-0 border-b border-[var(--border)]">
                        <Queue
                          onAddToQueue={addToQueueFromSearch}
                          onRemoveFromQueue={removeFromQueue}
                          onReorderQueue={reorderQueue}
                          isHostOrDj={isHostOrDj}
                          showSearch={false}
                          onRequestSearch={() => setDesktopLeftTab('search')}
                          showSmartQueueSection={false}
                          canClearQueue={isHostOrDj}
                          onClearQueue={clearEntireQueue}
                        />
                      </div>
                      <div className="h-[40%] min-h-[220px]">
                        <SmartQueuePanel
                          items={smartQueueItems}
                          loading={smartQueueLoading}
                          enabled={smartQueueEnabled}
                          onToggleEnabled={() => setSmartQueueEnabled((v) => !v)}
                          onAdd={addToQueueFromSearch}
                          currentTrackTitle={currentTrack?.title}
                          roomArtists={roomArtists}
                        />
                      </div>
                    </div>
                  )}
                  {desktopLeftTab === 'search' && (
                    <SearchResultsPanel
                      query={desktopSearchQuery}
                      onQueryChange={setDesktopSearchQuery}
                      onAddToQueue={addToQueueFromSearch}
                      recentKey="lito-recent-searches-desktop"
                    />
                  )}
                  {desktopLeftTab === 'recommendations' && <RecommendationsPanel onAddToQueue={addToQueueFromSearch} />}
                </div>
                <div
                  className="absolute top-0 right-0 h-full w-2 cursor-ew-resize"
                  onMouseDown={() => {
                    drawerResizeRef.current = 'left';
                    if (typeof document !== 'undefined') document.body.style.cursor = 'ew-resize';
                  }}
                  onDoubleClick={() => setDesktopLeftWidth(360)}
                  title="Drag to resize"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {desktopRightOpen && (
              <motion.div
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                className="absolute right-0 top-0 bottom-0 apple-glass rounded-2xl overflow-hidden z-20 flex flex-col"
                style={{ width: desktopRightWidth }}
              >
                <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {(['chat', 'people'] as const).map((tab) => (
                      <button key={tab} onClick={() => { setDesktopSocialTab(tab); if (tab === 'chat') setUnreadChatCount(0); }} className={`text-xs px-2 py-1 rounded-lg ${desktopSocialTab === tab ? 'bg-accent text-bg' : 'bg-elevated text-t2'}`}>
                        {tab}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setDesktopRightOpen(false)} className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2">Close</button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {desktopSocialTab === 'chat' ? <Chat onSendMessage={sendChat} /> : <People />}
                </div>
                <div
                  className="absolute top-0 left-0 h-full w-2 cursor-ew-resize"
                  onMouseDown={() => {
                    drawerResizeRef.current = 'right';
                    if (typeof document !== 'undefined') document.body.style.cursor = 'ew-resize';
                  }}
                  onDoubleClick={() => setDesktopRightWidth(360)}
                  title="Drag to resize"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className="h-full transition-all duration-200 flex items-center justify-center"
            style={{
              paddingLeft: desktopLeftOpen ? desktopLeftWidth + 16 : 0,
              paddingRight: desktopRightOpen ? desktopRightWidth + 16 : 0,
            }}
          >
            <div className="apple-glass rounded-3xl p-5 w-full" style={{ maxWidth: desktopPlayerMaxWidth }}>
              <PlayerCore
                isHostOrDj={isHostOrDj}
                seekValue={seekValue}
                onSeekPreview={(v) => { setDraggingSeek(true); setSeekValue(v); }}
                onSeekCommit={handleSeekCommit}
                onPlay={onPlay}
                onPause={onPause}
                onSkipPrev={onSkipPrevAction}
                onSkipNext={onSkipNextAction}
                onShuffle={onShuffleAction}
                onToggleLoop={onToggleLoopAction}
                volume={volume}
                onVolumeChange={setVolume}
                onSeekStart={handleSeekStart}
                onSeekEnd={handleSeekEnd}
              />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="apple-glass glow-accent rounded-[26px] px-3 py-2 flex items-center justify-center gap-3 max-w-[720px] mx-auto">
            <button
              onClick={() => { setDesktopLeftOpen(true); setDesktopLeftTab('home'); setDesktopDockActive('home'); }}
              className={`h-11 px-4 rounded-2xl text-sm ${desktopDockActive === 'home' ? 'bg-accent text-bg' : 'text-t2 bg-white/[0.04]'}`}
            >
              Home
            </button>
            <button
              onClick={() => { setDesktopLeftOpen(true); setDesktopLeftTab('search'); setDesktopDockActive('search'); }}
              className={`h-11 px-4 rounded-2xl text-sm ${desktopDockActive === 'search' ? 'bg-accent text-bg' : 'text-t2 bg-white/[0.04]'}`}
            >
              Search
            </button>
            <button
              onClick={() => { setDesktopLeftOpen(true); setDesktopLeftTab('recommendations'); setDesktopDockActive('recommendations'); }}
              className={`h-11 px-4 rounded-2xl text-sm ${desktopDockActive === 'recommendations' ? 'bg-accent text-bg' : 'text-t2 bg-white/[0.04]'}`}
            >
              Recommendations
            </button>
            <button
              onClick={() => { setDesktopLeftOpen(true); setDesktopLeftTab('queue'); setDesktopDockActive('queue'); }}
              className={`h-11 px-4 rounded-2xl text-sm ${desktopDockActive === 'queue' ? 'bg-accent text-bg' : 'text-t2 bg-white/[0.04]'}`}
            >
              Queue
            </button>
            <button
              onClick={() => { setDesktopRightOpen(true); setDesktopSocialTab('chat'); setDesktopDockActive('chat'); setUnreadChatCount(0); }}
              className={`relative h-11 px-4 rounded-2xl text-sm ${desktopDockActive === 'chat' ? 'bg-accent text-bg' : 'text-t2 bg-white/[0.04]'}`}
            >
              Chat
              {unreadChatCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] leading-[18px] text-white text-center">
                  {unreadChatCount > 9 ? '9+' : unreadChatCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowShortcutHelp((v) => !v)}
              className="h-11 w-11 rounded-2xl text-sm text-t2 bg-white/[0.04]"
              title="Shortcuts"
            >
              ?
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showShortcutHelp && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute right-8 bottom-24 apple-glass rounded-xl p-3 text-xs text-t2 space-y-1"
            >
              <p><span className="text-t1">Q</span> Queue drawer</p>
              <p><span className="text-t1">C</span> Chat drawer</p>
              <p><span className="text-t1">H</span> Home drawer</p>
              <p><span className="text-t1">Space</span> Play/Pause</p>
              <p><span className="text-t1">←/→</span> Seek 5s</p>
              <p><span className="text-t1">N / P</span> Next / Previous</p>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isOffline && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 14 }} className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 apple-glass rounded-xl px-3 py-2 text-xs text-t2">
              Offline mode: reconnecting to room...
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.65" y2="16.65" />
    </svg>
  );
}

function RecommendIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h6" />
      <path d="M3 12h10" />
      <path d="M3 17h14" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="14" cy="12" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

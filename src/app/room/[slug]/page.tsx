'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useStore, QueueItem } from '@/store';
import { useSocket } from '@/hooks/useSocket';
import { useAudio } from '@/hooks/useAudio';
import Queue from '@/components/Queue';
import Chat from '@/components/Chat';
import People from '@/components/People';
import Visualizer from '@/components/Visualizer';
import Thumb from '@/components/Thumb';
import InstallAppButton from '@/components/InstallAppButton';
import api from '@/lib/api';

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

async function fetchPersonalizedRecommendations(
  currentTrack: { youtubeId: string; title: string; artist: string },
  queue: Array<{ title: string; artist: string }>,
  roomArtists: string[],
  maxItems = 16
): Promise<Suggestion[]> {
  const cleanTitle = currentTrack.title.split('|')[0].trim();
  const mainArtist = (currentTrack.artist || '').split(',')[0].trim();
  const langHint = detectLanguageHintFromText(`${currentTrack.artist} ${cleanTitle}`);
  const currentCanon = canonicalSongKey(cleanTitle, mainArtist);
  const currentTokens = tokenizedTitle(cleanTitle);
  const currentArtistNorm = normalizedArtist(mainArtist);
  const queueCanon = new Set(queue.map((q) => canonicalSongKey(q.title, q.artist)));
  const roomArtistNorms = new Set(roomArtists.map((a) => normalizedArtist(a)));

  const querySet = new Set<string>([
    `${mainArtist} radio ${langHint} songs`,
    `${cleanTitle} similar songs official audio`,
    `${mainArtist} top hits ${langHint}`,
    `${cleanTitle} ${langHint} album songs`,
    `${langHint} latest official songs`,
    `${langHint} music label songs`,
    ...roomArtists.flatMap((a) => [`${a} best songs`, `${a} official songs ${langHint}`]),
  ]);

  const queries = Array.from(querySet).slice(0, 8);
  const lists = await Promise.all(
    queries.map((q) => api.get(`/api/music/search?q=${encodeURIComponent(q)}`).then((r) => r.data).catch(() => []))
  );
  const merged = lists.flat() as Suggestion[];

  const seenIds = new Set<string>();
  const seenCanon = new Set<string>();
  const ranked: Array<Suggestion & { __score: number; __artistNorm: string; __tokens: Set<string> }> = [];

  for (const r of merged) {
    if (!r?.id || seenIds.has(r.id)) continue;
    if (!isLikelyMusicResult(r)) continue;
    if (isNoisyNonSong(r.title || '', r.artist || '')) continue;
    if (r.durationMs && (r.durationMs < 60000 || r.durationMs > 15 * 60 * 1000)) continue;

    const key = canonicalSongKey(r.title || '', r.artist || '');
    const tokens = tokenizedTitle(r.title || '');
    const overlap = tokenOverlap(currentTokens, tokens);
    const artistNorm = normalizedArtist(r.artist || '');
    const sameAsCurrent = key === currentCanon || overlap > 0.6 || (artistNorm && artistNorm === currentArtistNorm && overlap > 0.4);

    if (r.id === currentTrack.youtubeId || seenCanon.has(key) || queueCanon.has(key) || sameAsCurrent) continue;

    seenIds.add(r.id);
    seenCanon.add(key);

    let score = 0;
    if (`${r.title} ${r.artist}`.toLowerCase().includes(langHint)) score += 2;
    if (roomArtistNorms.has(artistNorm)) score += 2;
    score += Math.max(0, 1.4 - overlap * 2.1);
    if (/official|audio|lyrical|lyrics|album/i.test(r.title || '')) score += 0.6;

    ranked.push({ ...r, __score: score, __artistNorm: artistNorm, __tokens: tokens });
  }

  ranked.sort((a, b) => b.__score - a.__score);

  const artistCount = new Map<string, number>();
  const selected: Array<Suggestion & { __score: number; __artistNorm: string; __tokens: Set<string> }> = [];
  for (const candidate of ranked) {
    const artistKey = candidate.__artistNorm || 'unknown';
    if ((artistCount.get(artistKey) || 0) >= 2) continue;

    const nearDuplicate = selected.some((s) => tokenOverlap(s.__tokens, candidate.__tokens) > 0.72);
    if (nearDuplicate) continue;

    selected.push(candidate);
    artistCount.set(artistKey, (artistCount.get(artistKey) || 0) + 1);
    if (selected.length >= maxItems) break;
  }

  return selected.map(({ __score, __artistNorm, __tokens, ...rest }) => rest);
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
    if (!q) {
      setResults([]);
      setPlaylistMode(false);
      return;
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        if (isPlaylistLink(q)) {
          pushRecentSearch(q);
          const importRes = await api.post('/api/music/import-playlist', { url: q });
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
          const res = await api.get(`/api/music/search?q=${encodeURIComponent(q)}`);
          setResults((res.data || []) as Suggestion[]);
        }
      } catch {
        setResults([]);
        setPlaylistMode(false);
        if (isPlaylistLink(q)) toast.error('Playlist import failed. Please retry with the playlist URL.');
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [query, pushRecentSearch]);

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
        <div className="overflow-y-auto h-full p-2 space-y-1">
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
  const { currentTrack, queue } = useStore();
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
      queue.map((q) => ({ title: q.title, artist: q.artist })),
      roomArtists,
      14
    )
      .then((out) => setResults(out))
      .finally(() => setLoading(false));
  }, [currentTrack, queue, roomArtists, refreshTick]);

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
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const shownKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    const flavor = refreshTick % 6;
    const facets = ['latest official songs', 'new music releases', 'top movie songs', 'official lyrical songs', 'audio jukebox', 'best hits'];
    const queries = [
      `${language} ${facets[flavor]}`,
      `${language} official songs`,
      `${language} music label hits`,
      `${language} album songs`,
    ];

    setLoading(true);
    Promise.all(queries.map((q) => api.get(`/api/music/search?q=${encodeURIComponent(q)}`).then((r) => r.data).catch(() => [])))
      .then(async (lists) => {
        if (!mounted) return;
        const merged = lists.flat() as Suggestion[];
        const seenLocal = new Set<string>();
        let deduped = merged.filter((x) => {
          const key = canonicalSongKey(x.title || '', x.artist || '');
          if (!x?.id || !isLikelyMusicResult(x) || seenLocal.has(key) || shownKeysRef.current.has(key)) return false;
          seenLocal.add(key);
          return true;
        });

        if (deduped.length < (compact ? 8 : 15)) {
          // If we run out of fresh cards, allow older pool again.
          shownKeysRef.current.clear();
          deduped = merged.filter((x) => {
            const key = canonicalSongKey(x.title || '', x.artist || '');
            if (!x?.id || !isLikelyMusicResult(x) || seenLocal.has(key)) return false;
            seenLocal.add(key);
            return true;
          });
        }

        if (deduped.length === 0) {
          // Hard fallback to known music-label seeds so home never appears empty.
          const fallbackSeeds: Record<HomeLanguage, string[]> = {
            english: ['vevo official audio', 'warner records official songs', 'universal music official songs'],
            telugu: ['aditya music telugu songs', 'lahari music telugu', 'saregama telugu official songs'],
            hindi: ['t-series official songs', 'zee music official songs', 'saregama hindi official songs'],
            tamil: ['sony music south tamil songs', 'think music india tamil', 'saregama tamil official songs'],
            punjabi: ['speed records official songs', 'tips punjabi songs', 'white hill music official songs'],
            malayalam: ['muzik247 malayalam songs', 'satyam audios official songs', 'manorama music malayalam'],
          };
          const fallbackQueries = fallbackSeeds[language].slice(0, compact ? 2 : 3);
          const fallbackLists = await Promise.all(
            fallbackQueries.map((q) => api.get(`/api/music/search?q=${encodeURIComponent(q)}`).then((r) => r.data).catch(() => []))
          );
          const fallbackMerged = fallbackLists.flat() as Suggestion[];
          deduped = fallbackMerged.filter((x) => {
            const key = canonicalSongKey(x.title || '', x.artist || '');
            if (!x?.id || seenLocal.has(key)) return false;
            seenLocal.add(key);
            return true;
          });
        }

        const next = deduped.slice(0, compact ? 8 : 15);
        next.forEach((x) => shownKeysRef.current.add(canonicalSongKey(x.title || '', x.artist || '')));
        setItems(next);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [language, compact, refreshTick]);

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
}) {
  const { currentTrack, playbackState } = useStore();

  return (
    <div className="mx-auto max-w-md">
        <div className="aspect-square rounded-2xl overflow-hidden bg-elevated mb-4 shadow-2xl">
          {currentTrack?.thumbnailUrl
            ? <Thumb src={currentTrack.thumbnailUrl} alt={currentTrack.title} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-6xl text-t3">♪</div>}
        </div>

        <div className="text-center mb-3">
          <p className="font-display text-2xl text-t1 truncate">{currentTrack?.title || 'Nothing playing'}</p>
          <p className="text-sm text-t2 truncate mt-1">{currentTrack?.artist || '-'}</p>
        </div>

        <div className="mb-3">
          <input
            className="w-full h-2 accent-[var(--accent)] cursor-pointer"
            type="range"
            min={0}
            max={currentTrack?.durationMs || 100}
            value={seekValue}
            onChange={(e) => onSeekPreview(Number(e.target.value))}
            onMouseUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
            disabled={!isHostOrDj}
          />
          <div className="flex justify-between text-xs text-t3 font-mono mt-1">
            <span>{formatTime(seekValue)}</span>
            <span>{formatTime(currentTrack?.durationMs || 0)}</span>
          </div>
        </div>

        <div className="flex justify-center mb-3"><Visualizer isPlaying={playbackState.isPlaying} bars={28} /></div>

        <div className="flex items-center justify-center gap-6">
          <button onClick={onToggleLoop} className={`p-2 rounded-lg ${playbackState.isLooping ? 'text-accent' : 'text-t3'}`}>↻</button>
          <button onClick={onSkipPrev} disabled={!isHostOrDj} className="p-2 text-t2 disabled:opacity-30">⏮</button>
          <button onClick={playbackState.isPlaying ? onPause : onPlay} disabled={!isHostOrDj} className="w-14 h-14 rounded-full bg-accent text-bg text-2xl disabled:opacity-30">
            {playbackState.isPlaying ? '❚❚' : '▶'}
          </button>
          <button onClick={onSkipNext} disabled={!isHostOrDj} className="p-2 text-t2 disabled:opacity-30">⏭</button>
          <button onClick={onShuffle} disabled={!isHostOrDj} className="p-2 text-t3 disabled:opacity-30">↺</button>
        </div>

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
    setQueue, setParticipants, setDjMode, addMessage, messages, participants,
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [seekValue, setSeekValue] = useState(0);
  const [draggingSeek, setDraggingSeek] = useState(false);
  const [mobileTab, setMobileTab] = useState<'room' | 'player' | 'chat'>('player');
  const [mobileRoomPanel, setMobileRoomPanel] = useState<'home' | 'listeners'>('home');
  const [mobilePlayerPanel, setMobilePlayerPanel] = useState<'search' | 'recommendations' | 'queue'>('search');
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [desktopSocialTab, setDesktopSocialTab] = useState<'chat' | 'people'>('chat');
  const [desktopLeftTab, setDesktopLeftTab] = useState<'queue' | 'search' | 'recommendations'>('queue');
  const [desktopSearchQuery, setDesktopSearchQuery] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [homeLanguage, setHomeLanguage] = useState<HomeLanguage>('english');
  const [volume, setVolume] = useState(0.92);
  const [smartQueueEnabled, setSmartQueueEnabled] = useState(true);
  const [smartQueueItems, setSmartQueueItems] = useState<Suggestion[]>([]);
  const [smartQueueLoading, setSmartQueueLoading] = useState(false);

  const touchStartXRef = useRef<number | null>(null);
  const warnedLastTrackRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(0);
  const smartQueueAutoRef = useRef('');
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

  const {
    timeOffsetRef, joinRoom, leaveRoom,
    play, pause, seek, skipNext, skipPrev,
    shuffleQueue, toggleLoop, sendChat, toggleDjMode, trackEnded, syncRequest,
    addToQueue, removeFromQueue, reorderQueue,
    connectionState,
  } = useSocket();

  useAudio({ isHost, djMode, volume, timeOffsetRef, onTrackEnded: trackEnded, onPlay: play, onPause: pause });

  useEffect(() => {
    if (!token) { router.replace('/'); return; }

    (async () => {
      try {
        const res = await api.get(`/api/rooms/${params.slug}`);
        const room = res.data;

        setRoom(room.id, room.slug, room.name, room.host_id);
        setPlaybackState(room.playbackState);

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

        if (room.playbackState?.trackId && room.queue?.length > 0) {
          const t = room.queue[0];
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
        msgRes.data.forEach((m: Record<string, unknown>) => {
          addMessage({ userId: String(m.user_id), username: String(m.username), content: String(m.content), createdAt: String(m.created_at) });
        });

        joinRoom(room.id);
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
    if (savedDesktopLeft === 'queue' || savedDesktopLeft === 'search' || savedDesktopLeft === 'recommendations') setDesktopLeftTab(savedDesktopLeft);
    const savedSmartEnabled = window.localStorage.getItem('lito-smart-queue-enabled');
    if (savedSmartEnabled === '0' || savedSmartEnabled === '1') setSmartQueueEnabled(savedSmartEnabled === '1');
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
    if (isIOS) {
      toast('Install LiTo as an app: open Share and tap "Add to Home Screen".', { duration: 7000 });
    } else {
      toast('Install LiTo as an app for better performance. Use the Install App button.', { duration: 5500 });
    }

    window.localStorage.setItem(promptKey, String(Date.now()));
  }, [isMobile]);

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
      queue.map((q) => ({ title: q.title, artist: q.artist })),
      roomArtists,
      12
    )
      .then((items) => {
        if (!mounted) return;
        setSmartQueueItems(items);
      })
      .finally(() => {
        if (mounted) setSmartQueueLoading(false);
      });

    return () => { mounted = false; };
  }, [currentTrack, currentTrack?.youtubeId, queue, roomArtists]);

  useEffect(() => {
    if (!smartQueueEnabled || !isHostOrDj) return;
    if (!currentTrack || !playbackState.isPlaying) return;
    if (queue.length > 0) {
      smartQueueAutoRef.current = '';
      return;
    }
    if (smartQueueItems.length === 0) return;

    const next = smartQueueItems[0];
    const fingerprint = `${currentTrack.youtubeId}:${next.id}`;
    if (smartQueueAutoRef.current === fingerprint) return;
    smartQueueAutoRef.current = fingerprint;

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
  }, [smartQueueEnabled, isHostOrDj, currentTrack, currentTrack?.youtubeId, playbackState.isPlaying, queue.length, smartQueueItems, userId, setQueue, addToQueue]);

  const handleSeekCommit = (value: number) => {
    setDraggingSeek(false);
    if (isHostOrDj) seek(value);
  };

  const handleLeave = () => {
    if (roomId) leaveRoom(roomId);
    clearRoom();
    router.push('/browse');
  };

  const onPlay = () => {
    triggerHaptic();
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
    const currentQueue = useStore.getState().queue;
    const nextQueue = [...currentQueue];
    if (item.mode === 'next') nextQueue.splice(Math.min(1, nextQueue.length), 0, optimistic);
    else nextQueue.push(optimistic);
    setQueue(nextQueue);

    addToQueue(item);
    triggerHaptic(14);
    toast.success(`Added to queue: ${item.title}`, { duration: 2200 });
  }, [queue.length, userId, setQueue, addToQueue, triggerHaptic]);

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
    };

    return (
      <div className="min-h-screen bg-bg pb-6">
        <div className="mesh-bg">
          <div className="mesh-blob w-80 h-80 -top-20 -left-20" style={{ background: 'var(--accent)' }} />
          <div className="mesh-blob w-80 h-80 top-1/2 -right-24" style={{ background: 'var(--accent-dim)' }} />
        </div>

        <div
          className="relative z-[1] px-4 pt-4 space-y-3"
          onTouchStart={(e) => { touchStartXRef.current = e.changedTouches[0].clientX; }}
          onTouchEnd={(e) => onSwipeEnd(e.changedTouches[0].clientX)}
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
                className={`relative h-11 rounded-2xl flex items-center justify-center transition-all ${mobileTab === tab.id ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2 bg-white/[0.04]'}`}
              >
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
                    />
                  </div>

                  <div className="px-3 pb-3">
                    <div className="apple-glass glow-accent rounded-[24px] px-4 py-2 flex items-center justify-around">
                      <button onClick={() => { triggerHaptic(); setMobilePlayerPanel('search'); }} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobilePlayerPanel === 'search' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Search">
                        <SearchIcon />
                      </button>
                      <button onClick={() => { triggerHaptic(); setMobilePlayerPanel('recommendations'); }} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobilePlayerPanel === 'recommendations' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Recommendations">
                        <RecommendIcon />
                      </button>
                      <button onClick={() => { triggerHaptic(); setMobilePlayerPanel('queue'); }} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobilePlayerPanel === 'queue' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Queue">
                        <QueueIcon />
                      </button>
                    </div>
                  </div>

                  <div className="h-[30vh] border-t border-[var(--border)] overflow-hidden">
                    {mobilePlayerPanel === 'search' && (
                      <SearchResultsPanel
                        query={mobileSearchQuery}
                        onQueryChange={setMobileSearchQuery}
                        onAddToQueue={addToQueueFromSearch}
                        recentKey="lito-recent-searches-mobile"
                      />
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
                      />
                    )}
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
    );
  }

  return (
    <div className="min-h-screen bg-bg relative overflow-hidden">
      <div className="mesh-bg">
        <div className="mesh-blob w-[38rem] h-[38rem] -top-24 -left-24" style={{ background: 'var(--accent)' }} />
        <div className="mesh-blob w-[36rem] h-[36rem] top-1/3 -right-24" style={{ background: 'var(--accent-dim)' }} />
      </div>

      <div className="relative z-[1] max-w-[1500px] mx-auto px-5 py-5">
        <div className="apple-glass rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl">{roomName}</h1>
            <p className="text-xs text-t3">Synchronized room playback</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 text-xs text-t3 mr-1">
              <span className={`inline-block w-2 h-2 rounded-full ${connectionState === 'synced' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              {connectionState === 'synced' ? 'Synced' : 'Reconnecting'}
            </div>
            <InstallAppButton compact />
            {isHost && <button onClick={toggleDjMode} className="px-3 py-1.5 rounded-lg bg-elevated text-t2">DJ Mode</button>}
            <button onClick={handleLeave} className="px-3 py-1.5 rounded-lg bg-elevated text-t2">Leave</button>
          </div>
        </div>

        <div className="apple-glass rounded-2xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <div>
              <p className="text-sm text-t2">Room Home</p>
              <h2 className="text-xl font-display">Recommendations For This Room</h2>
            </div>
            <div className="flex -space-x-2 items-center">
              {participants.slice(0, 8).map((p) => (
                <div key={p.userId} className="w-8 h-8 rounded-full border border-black flex items-center justify-center text-[10px] font-bold" style={{ background: avatarColor(p.username), color: '#000' }}>
                  {p.username[0]?.toUpperCase()}
                </div>
              ))}
            </div>
          </div>
          <div className="h-[36vh]">
            <RoomHomePanel onAddToQueue={addToQueueFromSearch} language={homeLanguage} onLanguageChange={setHomeLanguage} />
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '360px minmax(480px, 1fr) 360px' }}>
          <div className="apple-glass rounded-2xl overflow-hidden min-h-[78vh] flex flex-col">
            <div className="flex border-b border-[var(--border)]">
              {(['queue', 'search', 'recommendations'] as const).map((tab) => (
                <button key={tab} onClick={() => setDesktopLeftTab(tab)} className={`flex-1 py-2.5 text-xs uppercase tracking-wider ${desktopLeftTab === tab ? 'text-accent border-b-2 border-accent' : 'text-t3'}`}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {desktopLeftTab === 'queue' && (
                <Queue
                  onAddToQueue={addToQueueFromSearch}
                  onRemoveFromQueue={(id) => removeFromQueue(id)}
                  onReorderQueue={reorderQueue}
                  isHostOrDj={isHostOrDj}
                  showSearch={false}
                  onRequestSearch={() => setDesktopLeftTab('search')}
                  smartQueueItems={smartQueueItems}
                  smartQueueEnabled={smartQueueEnabled}
                  smartQueueLoading={smartQueueLoading}
                  onToggleSmartQueueEnabled={() => setSmartQueueEnabled((v) => !v)}
                />
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
          </div>

          <div className="min-h-[78vh] apple-glass rounded-2xl p-4">
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
            />
          </div>

          <div className="apple-glass rounded-2xl overflow-hidden min-h-[78vh] flex flex-col">
            <div className="flex border-b border-[var(--border)]">
              {(['chat', 'people'] as const).map((tab) => (
                <button key={tab} onClick={() => { setDesktopSocialTab(tab); if (tab === 'chat') setUnreadChatCount(0); }} className={`flex-1 py-2.5 text-xs uppercase tracking-wider ${desktopSocialTab === tab ? 'text-accent border-b-2 border-accent' : 'text-t3'}`}>
                  {tab}
                  {tab === 'chat' && unreadChatCount > 0 && (
                    <span className="ml-2 inline-flex min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[16px] justify-center">
                      {unreadChatCount > 9 ? '9+' : unreadChatCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {desktopSocialTab === 'chat' ? <Chat onSendMessage={sendChat} /> : <People />}
            </div>
          </div>
        </div>
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

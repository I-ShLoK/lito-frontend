'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useStore } from '@/store';
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
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onAddToQueue: (item: { youtubeId: string; title: string; artist: string; durationMs: number; thumbnailUrl: string; mode: 'next' | 'end' }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [playlistMode, setPlaylistMode] = useState(false);

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
          const importRes = await api.post('/api/music/import-playlist', { url: q });
          setPlaylistMode(true);
          setResults((importRes.data || []) as Suggestion[]);
          return;
        }

        const youtubeId = extractYouTubeId(q);
        if (youtubeId) {
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
          setPlaylistMode(false);
          const res = await api.get(`/api/music/search?q=${encodeURIComponent(q)}`);
          setResults((res.data || []) as Suggestion[]);
        }
      } catch {
        setResults([]);
        setPlaylistMode(false);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [query]);

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
        <div className="px-4 py-6 text-sm text-t3">Search from here to add songs to queue instantly.</div>
      ) : (
        <div className="overflow-y-auto h-full p-2 space-y-1">
          {playlistMode && results.length > 0 && (
            <button
              onClick={() => {
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
  const lastKeyRef = useRef('');

  const detectLanguageHint = useCallback((text: string): string => {
    if (/[\u0900-\u097F]/.test(text)) return 'hindi';
    if (/[\u0980-\u09FF]/.test(text)) return 'bengali';
    if (/[\u0A80-\u0AFF]/.test(text)) return 'gujarati';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'tamil';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'telugu';
    if (/[\u0D00-\u0D7F]/.test(text)) return 'malayalam';
    return 'english';
  }, []);

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

    const key = `${currentTrack.youtubeId}:${roomArtists.join(',')}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const cleanTitle = currentTrack.title.split('|')[0].trim();
    const mainArtist = (currentTrack.artist || '').split(',')[0].trim();
    const langHint = detectLanguageHint(`${currentTrack.artist} ${cleanTitle}`);

    const queries = [
      `${mainArtist} ${cleanTitle} similar songs ${langHint}`,
      `${cleanTitle} ${langHint} album songs`,
      `${mainArtist} best songs ${langHint}`,
      ...roomArtists.map((a) => `${a} ${langHint} hits`),
    ].slice(0, 4);

    setLoading(true);
    Promise.all(
      queries.map((q) => api.get(`/api/music/search?q=${encodeURIComponent(q)}`).then((r) => r.data).catch(() => []))
    )
      .then((lists) => {
        const merged = lists.flat() as Suggestion[];
        const seenIds = new Set<string>();
        const seenCanon = new Set<string>();
        const out = merged.filter((r) => {
          const key = canonicalSongKey(r?.title || '', r?.artist || '');
          const noisy = /reaction|review|status|shorts?/i.test(`${r?.title || ''} ${r?.artist || ''}`);
          if (!r?.id || seenIds.has(r.id) || r.id === currentTrack.youtubeId || seenCanon.has(key) || noisy) return false;
          seenIds.add(r.id);
          seenCanon.add(key);
          return true;
        });
        setResults(out.slice(0, 12));
      })
      .finally(() => setLoading(false));
  }, [currentTrack, roomArtists, detectLanguageHint]);

  if (!currentTrack) return <div className="p-4 text-sm text-t3">Play something to get recommendations.</div>;
  if (loading) return <div className="p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>;

  return (
    <div className="overflow-y-auto h-full p-2 space-y-1">
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
      .then((lists) => {
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

  const touchStartXRef = useRef<number | null>(null);
  const warnedLastTrackRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(0);
  const isHost = userId === hostId;
  const isHostOrDj = isHost || djMode;

  const {
    timeOffsetRef, joinRoom, leaveRoom,
    play, pause, seek, skipNext, skipPrev,
    shuffleQueue, toggleLoop, sendChat, toggleDjMode, trackEnded, syncRequest,
    addToQueue, removeFromQueue, reorderQueue,
  } = useSocket();

  useAudio({ isHost, djMode, timeOffsetRef, onTrackEnded: trackEnded, onPlay: play, onPause: pause });

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('lito-home-language') as HomeLanguage | null;
    if (saved && HOME_LANGUAGES.includes(saved)) {
      setHomeLanguage(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('lito-home-language', homeLanguage);
  }, [homeLanguage]);

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

  const handleSeekCommit = (value: number) => {
    setDraggingSeek(false);
    if (isHostOrDj) seek(value);
  };

  const handleLeave = () => {
    if (roomId) leaveRoom(roomId);
    clearRoom();
    router.push('/browse');
  };

  const onPlay = () => play(localPositionMs);
  const onPause = () => pause(localPositionMs);
  const addToQueueFromSearch = (item: { youtubeId: string; title: string; artist: string; durationMs: number; thumbnailUrl: string; mode: 'next' | 'end' }) => {
    addToQueue(item);
    toast.success(`Added to queue: ${item.title}`, { duration: 2200 });
  };

  if (loading) return <div className="min-h-screen grid place-items-center"><div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" /></div>;

  if (isMobile) {
    const tabOrder: Array<'room' | 'player' | 'chat'> = ['room', 'player', 'chat'];
    const currentIndex = tabOrder.indexOf(mobileTab);

    const onSwipeEnd = (x: number) => {
      if (touchStartXRef.current === null) return;
      const deltaX = x - touchStartXRef.current;
      if (Math.abs(deltaX) < 90) return;
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
                  onClick={() => setMobileRoomPanel('listeners')}
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
                          onClick={() => setMobileRoomPanel('home')}
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
                      onSkipPrev={skipPrev}
                      onSkipNext={skipNext}
                      onShuffle={shuffleQueue}
                      onToggleLoop={toggleLoop}
                    />
                  </div>

                  <div className="px-3 pb-3">
                    <div className="apple-glass glow-accent rounded-[24px] px-4 py-2 flex items-center justify-around">
                      <button onClick={() => setMobilePlayerPanel('search')} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobilePlayerPanel === 'search' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Search">
                        <SearchIcon />
                      </button>
                      <button onClick={() => setMobilePlayerPanel('recommendations')} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobilePlayerPanel === 'recommendations' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Recommendations">
                        <RecommendIcon />
                      </button>
                      <button onClick={() => setMobilePlayerPanel('queue')} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobilePlayerPanel === 'queue' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Queue">
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
                      />
                    )}
                    {mobilePlayerPanel === 'recommendations' && <RecommendationsPanel onAddToQueue={addToQueue} />}
                    {mobilePlayerPanel === 'queue' && (
                      <Queue onAddToQueue={addToQueue} onRemoveFromQueue={removeFromQueue} onReorderQueue={reorderQueue} isHostOrDj={isHostOrDj} showSearch={false} />
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
                <Queue onAddToQueue={addToQueue} onRemoveFromQueue={removeFromQueue} onReorderQueue={reorderQueue} isHostOrDj={isHostOrDj} showSearch={false} />
              )}
              {desktopLeftTab === 'search' && (
                <SearchResultsPanel
                  query={desktopSearchQuery}
                  onQueryChange={setDesktopSearchQuery}
                  onAddToQueue={addToQueueFromSearch}
                />
              )}
              {desktopLeftTab === 'recommendations' && <RecommendationsPanel onAddToQueue={addToQueue} />}
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
              onSkipPrev={skipPrev}
              onSkipNext={skipNext}
              onShuffle={shuffleQueue}
              onToggleLoop={toggleLoop}
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

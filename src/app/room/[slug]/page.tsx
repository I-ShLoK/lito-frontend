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

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/api/music/search?q=${encodeURIComponent(q)}`);
        setResults((res.data || []) as Suggestion[]);
      } catch {
        setResults([]);
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
    const langHint = detectLanguageHint(`${currentTrack.artist} ${cleanTitle}`);

    const queries = [
      `${currentTrack.artist} ${cleanTitle} similar songs ${langHint}`,
      `${cleanTitle} ${langHint} mix`,
      ...roomArtists.map((a) => `${a} ${langHint} hits`),
    ].slice(0, 4);

    setLoading(true);
    Promise.all(
      queries.map((q) => api.get(`/api/music/search?q=${encodeURIComponent(q)}`).then((r) => r.data).catch(() => []))
    )
      .then((lists) => {
        const merged = lists.flat() as Suggestion[];
        const seen = new Set<string>();
        const out = merged.filter((r) => {
          if (!r?.id || seen.has(r.id) || r.id === currentTrack.youtubeId) return false;
          seen.add(r.id);
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

function PlayerCore({
  isHostOrDj,
  seekValue,
  onSeekPreview,
  onSeekCommit,
  onPlay,
  onPause,
  onSkipPrev,
  onSkipNext,
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
          <div className="w-6" />
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
    setQueue, setParticipants, setDjMode, addMessage,
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [seekValue, setSeekValue] = useState(0);
  const [draggingSeek, setDraggingSeek] = useState(false);
  const [mobileTab, setMobileTab] = useState<'room' | 'player' | 'chat'>('player');
  const [mobilePlayerPanel, setMobilePlayerPanel] = useState<'search' | 'recommendations' | 'queue'>('search');
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [desktopSocialTab, setDesktopSocialTab] = useState<'chat' | 'people'>('chat');
  const [desktopLeftTab, setDesktopLeftTab] = useState<'queue' | 'recommendations'>('queue');

  const touchStartXRef = useRef<number | null>(null);
  const warnedLastTrackRef = useRef<string | null>(null);
  const isHost = userId === hostId;
  const isHostOrDj = isHost || djMode;

  const {
    timeOffsetRef, joinRoom, leaveRoom,
    play, pause, seek, skipNext, skipPrev,
    toggleLoop, sendChat, toggleDjMode, trackEnded,
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
      if (Math.abs(deltaX) < 45) return;
      if (deltaX < 0 && currentIndex < tabOrder.length - 1) setMobileTab(tabOrder[currentIndex + 1]);
      if (deltaX > 0 && currentIndex > 0) setMobileTab(tabOrder[currentIndex - 1]);
    };

    return (
      <div className="min-h-screen bg-bg pb-24">
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
                onClick={() => setMobileTab(tab.id)}
                aria-label={tab.label}
                className={`h-11 rounded-2xl flex items-center justify-center transition-all ${mobileTab === tab.id ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2 bg-white/[0.04]'}`}
              >
                {tab.icon}
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
                    <p className="text-xs text-t3">Room details and listeners</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isHost && <button onClick={toggleDjMode} className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2">DJ</button>}
                    <button onClick={handleLeave} className="text-xs px-2 py-1 rounded-lg bg-elevated text-t2">Leave</button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden"><People /></div>
              </motion.div>
            )}

            {mobileTab === 'player' && (
              <motion.div key="player" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-2">
                <div className="apple-glass rounded-2xl px-3 py-2">
                  <PlayerCore
                    isHostOrDj={isHostOrDj}
                    seekValue={seekValue}
                    onSeekPreview={(v) => { setDraggingSeek(true); setSeekValue(v); }}
                    onSeekCommit={handleSeekCommit}
                    onPlay={onPlay}
                    onPause={onPause}
                    onSkipPrev={skipPrev}
                    onSkipNext={skipNext}
                    onToggleLoop={toggleLoop}
                  />
                </div>

                <div className="apple-glass rounded-2xl h-[27vh] overflow-hidden">
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
              </motion.div>
            )}

            {mobileTab === 'chat' && (
              <motion.div key="chat" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="apple-glass rounded-2xl h-[68vh] overflow-hidden">
                <Chat onSendMessage={sendChat} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="fixed bottom-0 inset-x-0 p-3 z-20">
          <div className="apple-glass glow-accent rounded-[28px] px-5 py-3 flex items-center justify-around">
            <button onClick={() => { setMobileTab('player'); setMobilePlayerPanel('search'); }} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobileTab === 'player' && mobilePlayerPanel === 'search' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Search">
              <SearchIcon />
            </button>
            <button onClick={() => { setMobileTab('player'); setMobilePlayerPanel('recommendations'); }} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobileTab === 'player' && mobilePlayerPanel === 'recommendations' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Recommendations">
              <RecommendIcon />
            </button>
            <button onClick={() => { setMobileTab('player'); setMobilePlayerPanel('queue'); }} className={`h-11 w-11 rounded-2xl flex items-center justify-center ${mobileTab === 'player' && mobilePlayerPanel === 'queue' ? 'bg-accent text-bg shadow-[0_10px_30px_rgba(255,255,255,0.22)]' : 'text-t2'}`} aria-label="Queue">
              <QueueIcon />
            </button>
          </div>
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

        <div className="grid gap-4" style={{ gridTemplateColumns: '360px minmax(480px, 1fr) 360px' }}>
          <div className="apple-glass rounded-2xl overflow-hidden min-h-[78vh] flex flex-col">
            <div className="flex border-b border-[var(--border)]">
              {(['queue', 'recommendations'] as const).map((tab) => (
                <button key={tab} onClick={() => setDesktopLeftTab(tab)} className={`flex-1 py-2.5 text-xs uppercase tracking-wider ${desktopLeftTab === tab ? 'text-accent border-b-2 border-accent' : 'text-t3'}`}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {desktopLeftTab === 'queue'
                ? <Queue onAddToQueue={addToQueue} onRemoveFromQueue={removeFromQueue} onReorderQueue={reorderQueue} isHostOrDj={isHostOrDj} showSearch={false} />
                : <RecommendationsPanel onAddToQueue={addToQueue} />}
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
              onToggleLoop={toggleLoop}
            />
          </div>

          <div className="apple-glass rounded-2xl overflow-hidden min-h-[78vh] flex flex-col">
            <div className="flex border-b border-[var(--border)]">
              {(['chat', 'people'] as const).map((tab) => (
                <button key={tab} onClick={() => setDesktopSocialTab(tab)} className={`flex-1 py-2.5 text-xs uppercase tracking-wider ${desktopSocialTab === tab ? 'text-accent border-b-2 border-accent' : 'text-t3'}`}>
                  {tab}
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Trophy,
  Users,
  Sparkles,
  Lock,
  Hourglass,
  LogIn,
  Crown,
  AlertTriangle,
  X,
} from 'lucide-react';
import { supabase, type Room, type Envelope, type RoomParticipant } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { GiftBg, Confetti, Money } from '@/components/Shell';
import { WithdrawModal } from '@/components/WithdrawModal';
import { themeOf } from '@/lib/utils';

function Shagai({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 64" className={className} fill="none">
      <path
        d="M14 4c6-3 14-3 20 0 4 2 5 7 3 11 4 3 6 9 3 14-2 4-7 5-11 4-2 6-3 12-2 18 1 5-2 10-7 10s-8-5-7-10c1-6 0-12-2-18-4 1-9 0-11-4-3-5-1-11 3-14-2-4-1-9 3-11 3-2 6 0 8 0z"
        fill="currentColor"
      />
      <path d="M20 12c2 3 6 3 8 0" stroke="rgba(255,255,255,.6)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LuckyDrawRoom({ room, onNeedAuth }: { room: Room; onNeedAuth: () => void }) {
  const theme = themeOf(room.theme);
  const isShagai = room.theme === 'tsagaan_sar';
  const { session, profile, loading: authLoading } = useAuth();
  const accountName = (profile?.display_name || session?.user.email || '').trim();

  const [liveRoom, setLiveRoom] = useState<Room>(room);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [picked, setPicked] = useState<Envelope | null>(null);
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joinError, setJoinError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const startRequested = useRef(false);

  const load = useCallback(async () => {
    const [envRes, partRes, roomRes] = await Promise.all([
      supabase.from('envelopes').select('*').eq('room_id', room.id).order('claimed_at', { ascending: true, nullsFirst: false }),
      supabase.from('room_participants').select('*').eq('room_id', room.id).order('joined_at', { ascending: true }),
      supabase.from('rooms').select('*').eq('id', room.id).maybeSingle(),
    ]);
    if (envRes.data) setEnvelopes(envRes.data as Envelope[]);
    if (partRes.data) setParticipants(partRes.data as RoomParticipant[]);
    if (roomRes.data) setLiveRoom(roomRes.data as Room);
    setLoading(false);
  }, [room.id]);

  useEffect(() => { load(); }, [load]);

  // Өрөөний төлөв, оролцогчид, дугтуй — бодит цагт шинэчлэгдэнэ.
  useEffect(() => {
    const channel = supabase
      .channel('lucky-room-' + room.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'envelopes', filter: 'room_id=eq.' + room.id }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: 'room_id=eq.' + room.id }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + room.id }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room.id, load]);

  // Линкээр орж ирсэн нэвтэрсэн хэрэглэгч өөрөө оролцогч болно (нэр асуухгүй).
  useEffect(() => {
    if (!session?.user.id) { setJoinError(''); return; }
    let active = true;
    supabase.rpc('join_lucky_room', { p_room_id: room.id }).then(({ data, error }) => {
      if (!active) return;
      if (error) { setJoinError(error.message); return; }
      const joined = data as RoomParticipant | null;
      if (joined) setParticipants((prev) => (prev.some((p) => p.id === joined.id) ? prev : [...prev, joined]));
    });
    return () => { active = false; };
  }, [session?.user.id, room.id]);

  const required = liveRoom.participant_count ?? 0;
  const joinedCount = participants.length;
  const remaining = Math.max(0, required - joinedCount);
  const isFull = required <= 0 || joinedCount >= required;
  const modeLabel = liveRoom.mode === 'equal' ? 'Тэнцүү хуваах' : 'Санамсаргүй хуваах';

  const winners = envelopes.filter((e) => e.claimed).sort((a, b) => b.amount - a.amount);
  const claimedCount = winners.length;
  const total = envelopes.length || required || 0;

  const claimedByUser = new Map<string, number>();
  envelopes.forEach((e) => { if (e.claimed && e.claimed_by) claimedByUser.set(e.claimed_by, e.amount); });
  const deviceKey = `claimed_${room.code}`;
  const isOwner = !!session && session.user.id === liveRoom.user_id;
  const cancelled = liveRoom.status === 'CANCELLED';
  const canCancel =
    isOwner &&
    !cancelled &&
    (liveRoom.status === 'active' || liveRoom.status === 'PAID') &&
    !isFull &&
    claimedCount === 0;

  const cancelRoom = async () => {
    if (cancelBusy) return;
    setCancelBusy(true);
    setCancelError('');
    const { error } = await supabase.rpc('cancel_room', { p_room_id: room.id });
    setCancelBusy(false);
    if (error) {
      setCancelError(error.message);
      return;
    }
    setCancelOpen(false);
    await load();
  };

  // Оролцогчид бүрэн бүрдсэн үед дугтуйг серверт хуваалгана (нэг л удаа).
  useEffect(() => {
    if (!session || startRequested.current) return;
    if (!isFull || envelopes.length > 0) return;
    startRequested.current = true;
    void (async () => {
      await supabase.rpc('start_lucky_draw', { p_room_id: room.id });
      await load();
      startRequested.current = false;
    })();
  }, [session, isFull, envelopes.length, room.id, load]);

  const pick = async (env: Envelope) => {
    if (env.claimed || opening || !isFull || cancelled) return;
    if (!session) { onNeedAuth(); return; }
    if (localStorage.getItem(deviceKey)) { alert('Та дугтуйгаа аль хэдийн задалсан байна!'); return; }
    setOpening(true);
    setPicked(env);
    const { data, error } = await supabase.rpc('claim_envelope', {
      p_envelope_id: env.id,
      p_name: accountName || 'Хэрэглэгч',
    });
    setOpening(false);
    if (error || !data) {
      setPicked(null);
      load();
      if (error) alert(error.message);
      return;
    }
    setPicked(data as Envelope);
    localStorage.setItem(deviceKey, (data as Envelope).claim_token ?? 'claimed');
    setTimeout(() => setRevealed(true), 1300);
  };

  if (authLoading || loading) {
    return <div className="py-32 text-center text-neutral-500">Ачаалж байна...</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-neutral-200 p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-3">{theme.emojiHint}</div>
          <h1 className="text-2xl font-bold text-neutral-900">{room.title}</h1>
          <p className="text-sm text-neutral-500 mt-2 mb-6">
            Өрөөнд орохын тулд бүртгэлтэй дансаараа нэвтэрнэ үү. Нэр дахин асуухгүй — профайлын нэрээр тань оролцогчдын жагсаалтад орно.
          </p>
          <button onClick={onNeedAuth} className="w-full rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3 font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
            <LogIn className="w-4 h-4" /> Нэвтрэх / Бүртгүүлэх
          </button>
          <p className="mt-4 text-xs text-neutral-400 flex items-center justify-center gap-1">
            <Users className="w-3.5 h-3.5" /> {joinedCount}/{required || '—'} хүн орсон
          </p>
          <p className="mt-2 text-xs text-neutral-400 flex items-center justify-center gap-1">
            <Lock className="w-3.5 h-3.5" /> {modeLabel}
          </p>
        </motion.div>
      </div>
    );
  }

  if (picked && revealed) {
    // 0₮ (хоосон дугтуй) таарсан бол хөгжилтэй мэдэгдэл харуулж, татах товчийг нуулна.
    const isEmpty = picked.amount <= 0;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        {!isEmpty && <Confetti />}
        <div className="bg-white/95 rounded-3xl shadow-2xl border border-neutral-200 p-8 w-full max-w-sm text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}>
            {isEmpty ? (
              <span className="text-6xl">😜</span>
            ) : (
              <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
            )}
          </motion.div>
          {isEmpty ? (
            <>
              <p className="mt-4 text-lg font-bold text-neutral-900">
                Аз чинь дараагийн удаа ирнэ ээ! 😜
              </p>
              <p className="mt-2 text-sm text-neutral-500">
                Энэ дугтуй хоосон таарлаа. Дараагийн тоглоомд аз тань ирээрэй!
              </p>
              <Money amount={0} className="block text-2xl font-extrabold text-neutral-400 mt-4" />
            </>
          ) : (
            <>
              <p className="mt-4 text-neutral-500">Баяр хүргэе, {picked.claimed_by_name}!</p>
              <Money amount={picked.amount} className="block text-4xl font-extrabold text-neutral-900 mt-2" />
              <button onClick={() => setShowWithdraw(true)} className="mt-6 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 transition-colors">
                Мөнгөө татах
              </button>
              <p className="mt-3 text-xs text-neutral-400">Данс руу шууд шилжинэ. Нэг л удаа татаж болно.</p>
            </>
          )}
        </div>
        {showWithdraw && !isEmpty && (
          <WithdrawModal roomId={room.id} envelopeId={picked.id} name={picked.claimed_by_name ?? accountName} amount={picked.amount} onClose={() => setShowWithdraw(false)} />
        )}
      </div>
    );
  }

  if (picked && !revealed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <motion.div initial={{ scale: 1 }} animate={{ scale: [1, 1.15, 0.9, 1.1], rotate: [0, -5, 5, 0] }} transition={{ duration: 1.2 }} className="text-center">
          <div className="text-8xl">{theme.revealEmoji}</div>
          <p className="mt-6 text-lg font-medium text-neutral-700 animate-pulse">{theme.revealLabel} нээж байна...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4">
      <GiftBg theme={room.theme} />
      <div className="mx-auto max-w-lg pt-8 pb-16">
        <h1 className="text-2xl font-bold text-center text-neutral-900">{room.title}</h1>
        <p className="text-center text-sm text-neutral-500 mt-1">Сайн байна уу, {accountName || 'Оролцогч'}?</p>

        {cancelled && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
            <p className="mt-1 font-semibold text-red-900">Өрөө цуцлагдсан</p>
            <p className="mt-1 text-sm text-red-800">
              Өрөө үүсгэгчийн төлсөн мөнгө хэтэвчинд 100% буцаж орсон.
            </p>
          </div>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={() => {
              setCancelError('');
              setCancelOpen(true);
            }}
            className="mt-4 w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 transition-colors"
          >
            Өрөөг цуцлах
          </button>
        )}

        {/* оролцогчид / хүлээлгийн төлөв */}
        <div className="mt-6 rounded-2xl bg-white border border-neutral-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-sky-500" /> Оролцогчид
            <span className="ml-auto text-xs font-normal text-neutral-400">{joinedCount}/{required || joinedCount}</span>
          </h2>
          <div className="mt-2 h-2 rounded-full bg-neutral-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${isFull ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${required > 0 ? Math.min(100, (joinedCount / required) * 100) : 100}%` }} />
          </div>
          <p className="mt-2 text-xs flex items-center gap-1.5">
            {isFull ? (
              <span className="text-emerald-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {required > 0 ? 'Оролцогчдын тоо бүрэн бүрдлээ' : 'Оролцогчид нээлттэй'} — бэлгээ сонгоорой
              </span>
            ) : (
              <span className="text-amber-600 font-medium flex items-center gap-1">
                <Hourglass className="w-3.5 h-3.5" /> Хүлээж байна — {remaining} хүн дутуу
              </span>
            )}
          </p>
          {joinError && (
            <p className="mt-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">{joinError}</p>
          )}
          {participants.length === 0 ? (
            <p className="mt-3 text-xs text-neutral-400">Одоогоор хэн ч ороогүй байна.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              <AnimatePresence initial={false}>
                {participants.map((p, i) => {
                  const prize = claimedByUser.get(p.user_id);
                  const isOrganizer = liveRoom.user_id === p.user_id;
                  return (
                    <motion.li key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 shrink-0 rounded-full bg-sky-100 text-[10px] font-bold flex items-center justify-center text-sky-700">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 text-neutral-800">
                            <span className="truncate">{p.display_name}</span>
                            {isOrganizer && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
                          </span>
                          {p.email && p.email !== p.display_name && (
                            <span className="block truncate text-[11px] text-neutral-400">{p.email}</span>
                          )}
                        </span>
                      </span>
                      {prize !== undefined ? (
                        <Money amount={prize} className="shrink-0 font-bold text-emerald-600" />
                      ) : (
                        <span className="shrink-0 text-[11px] text-neutral-400">Хүлээж байна</span>
                      )}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
          <p className="mt-3 text-[11px] text-neutral-400 flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> {modeLabel} · {total} дугтуй
          </p>
        </div>

        {/* амжилтын самбар */}
        <div className="mt-4 rounded-2xl bg-white border border-neutral-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-amber-500" /> Амжилтын самбар
            <span className="ml-auto text-xs font-normal text-neutral-400">{claimedCount}/{required || total} авсан</span>
          </h2>
          {winners.length === 0 ? (
            <p className="mt-3 text-xs text-neutral-400">Одоогоор хэн ч бэлгээ аваагүй байна.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              <AnimatePresence>
                {winners.map((w, i) => (
                  <motion.li key={w.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 text-neutral-800">
                      <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-neutral-400' : i === 2 ? 'bg-orange-400' : 'bg-neutral-300'}`}>{i + 1}</span>
                      {w.claimed_by_name}
                    </span>
                    <Money amount={w.amount} className="font-bold text-emerald-600" />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {/* дугтуйн сүлжээ — зөвхөн оролцогчдын тоо бүрэн бүрдсэний дараа */}
        {cancelled ? null : isFull ? (
          <div className="mt-6 grid grid-cols-3 gap-3">
            {envelopes.map((env, i) => (
              <motion.button
                key={env.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.5) }}
                whileHover={!env.claimed ? { scale: 1.06, rotate: i % 2 ? 2 : -2 } : undefined}
                whileTap={!env.claimed ? { scale: 0.95 } : undefined}
                onClick={() => pick(env)}
                disabled={env.claimed}
                className={`relative rounded-2xl flex flex-col items-center justify-center aspect-[3/4] shadow-md transition-colors ${
                  env.claimed
                    ? 'bg-neutral-100 opacity-60 cursor-default'
                    : isShagai
                      ? 'bg-gradient-to-b from-amber-100 to-amber-200 cursor-pointer'
                      : 'bg-gradient-to-b from-red-500 to-red-600 cursor-pointer'
                }`}
              >
                {env.claimed ? (
                  <>
                    <CheckCircle2 className="w-6 h-6 text-neutral-400" />
                    <span className="mt-1 text-[10px] text-neutral-500 px-1 text-center leading-tight">{env.claimed_by_name}</span>
                  </>
                ) : isShagai ? (
                  <>
                    <Shagai className="w-10 h-12 text-amber-700" />
                    <span className="mt-1 text-[10px] font-medium text-amber-800">Шагай #{i + 1}</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl">{theme.revealEmoji}</span>
                    <span className="mt-1 text-[10px] text-white/80">{theme.revealLabel} #{i + 1}</span>
                  </>
                )}
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border-2 border-dashed border-neutral-300 bg-white/70 backdrop-blur p-8 text-center">
            <Hourglass className="w-9 h-9 mx-auto text-neutral-400" />
            <p className="mt-3 font-semibold text-neutral-800">Хүлээлгийн төлөв</p>
            <p className="mt-1 text-sm text-neutral-500">{joinedCount}/{required} хүн орсон · {remaining} хүн дутуу</p>
            <p className="mt-2 text-xs text-neutral-400">Оролцогчдын тоо бүрэн бүрдсэний дараа бэлэг сонгож, дугтуй задлах хэсэг нээгдэнэ.</p>
            <p className="mt-4 text-xs text-neutral-500">Өрөөний линкээ найзуудтайгаа хуваалцаарай.</p>
          </div>
        )}

        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-neutral-400">
          <Sparkles className="w-4 h-4" /> Бодит цагт шинэчлэгдэж байна
        </p>
      </div>

      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-500">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <h2 className="text-lg font-bold text-neutral-900">Өрөөг цуцлах уу?</h2>
              </div>
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100"
                aria-label="Хаах"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-3 text-sm text-neutral-600">
              «{room.title}» өрөө цуцлагдаж, төлсөн мөнгө таны хэтэвчинд 100% буцаж орно. Энэ
              үйлдлийг буцаах боломжгүй.
            </p>
            {cancelError && (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
                {cancelError}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Болих
              </button>
              <button
                type="button"
                onClick={() => void cancelRoom()}
                disabled={cancelBusy}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {cancelBusy ? 'Цуцалж байна...' : 'Тийм, цуцлах'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

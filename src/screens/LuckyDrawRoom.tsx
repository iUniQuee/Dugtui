import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Trophy, Users, Sparkles, Lock, Clock } from 'lucide-react';
import { supabase, type Room, type Envelope } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { GiftBg, Confetti, Money } from '@/components/Shell';
import { WithdrawModal } from '@/components/WithdrawModal';
import { themeOf } from '@/lib/utils';

function Shagai({ className = '' }: { className?: string }) {
  // simple decorative shagai (ankle bone) shape
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
  const { session, profile } = useAuth();
  const accountName = session ? profile?.display_name || session.user.email || '' : '';
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [picked, setPicked] = useState<Envelope | null>(null);
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from('envelopes')
      .select('*')
      .eq('room_id', room.id)
      .order('claimed_at', { ascending: true, nullsFirst: false });
    if (data) setEnvelopes(data as Envelope[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('envelopes-' + room.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'envelopes', filter: 'room_id=eq.' + room.id },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  const winners = envelopes
    .filter((e) => e.claimed)
    .sort((a, b) => b.amount - a.amount);
  const claimedCount = winners.length;
  const total = envelopes.length || room.participant_count || 0;
  const deviceKey = `claimed_${room.code}`;
  const expired = !!room.expires_at && new Date(room.expires_at) < new Date();

  useEffect(() => {
    if (session && !name && accountName) setName(accountName);
  }, [session, accountName]);

  const pick = async (env: Envelope) => {
    if (env.claimed || opening) return;
    if (!session) {
      onNeedAuth();
      return;
    }
    if (localStorage.getItem(deviceKey)) {
      alert('Та дугтуйгаа аль хэдийн задалсан байна!');
      return;
    }
    setOpening(true);
    setPicked(env);
    const { data, error } = await supabase.rpc('claim_envelope', {
      p_envelope_id: env.id,
      p_name: name.trim() || accountName,
    });

    setOpening(false);
    if (error || !data) {
      // another guest claimed this one first (server rejects double claims)
      setPicked(null);
      load();
      if (error) alert(error.message);
      return;
    }
    setPicked(data as Envelope);
    localStorage.setItem(deviceKey, (data as Envelope).claim_token ?? 'claimed');
    setTimeout(() => setRevealed(true), 1300);
  };

  if (loading) return <div className="py-32 text-center text-neutral-500">Ачаалж байна...</div>;

  // ---- name gate ----
  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-neutral-200 p-8 w-full max-w-sm text-center"
        >
          <div className="text-5xl mb-3">{theme.emojiHint}</div>
          <h1 className="text-2xl font-bold text-neutral-900">{room.title}</h1>
          <p className="text-sm text-neutral-500 mt-2 mb-6">
            {isShagai
              ? 'Шагайнууд хүлээж байна. Нэрээ бичээд орно уу.'
              : 'Дугтуйнууд хүлээж байна. Нэрээ бичээд орно уу.'}
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && setJoined(true)}
            placeholder="Таны нэр"
            className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-center text-lg text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
          <button
            onClick={() => name.trim() && setJoined(true)}
            disabled={!name.trim()}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3 font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Орох
          </button>
          <p className="mt-4 text-xs text-neutral-400 flex items-center justify-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {claimedCount}/{total} хүн бэлгээ авсан
          </p>
          {!session && (
            <p className="mt-3 text-xs text-amber-600 flex items-center justify-center gap-1">
              <Lock className="w-3.5 h-3.5" /> Дугтуй задлахын тулд бүртгэлтэй данс руугаа нэвтрэх шаардлагатай.
            </p>
          )}
        </motion.div>
      </div>
    );
  }

  // ---- reveal ----
  if (picked && revealed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <Confetti />
        <div className="bg-white/95 rounded-3xl shadow-2xl border border-neutral-200 p-8 w-full max-w-sm text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', bounce: 0.5 }}
          >
            <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
          </motion.div>
          <p className="mt-4 text-neutral-500">Баяр хүргэе, {picked.claimed_by_name}!</p>
          <Money amount={picked.amount} className="block text-4xl font-extrabold text-neutral-900 mt-2" />
          <button
            onClick={() => setShowWithdraw(true)}
            className="mt-6 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 transition-colors"
          >
            Мөнгөө татах
          </button>
          <p className="mt-3 text-xs text-neutral-400">
            Данс руу шууд шилжинэ. Нэг л удаа татаж болно.
          </p>
        </div>
        {showWithdraw && (
          <WithdrawModal
            roomId={room.id}
            envelopeId={picked.id}
            name={picked.claimed_by_name ?? name}
            amount={picked.amount}
            onClose={() => setShowWithdraw(false)}
          />
        )}
      </div>
    );
  }

  // ---- opening animation ----
  if (picked && !revealed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <motion.div
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.15, 0.9, 1.1], rotate: [0, -5, 5, 0] }}
          transition={{ duration: 1.2 }}
          className="text-center"
        >
          <div className="text-8xl">{theme.revealEmoji}</div>
          <p className="mt-6 text-lg font-medium text-neutral-700 animate-pulse">
            {theme.revealLabel} нээж байна...
          </p>
        </motion.div>
      </div>
    );
  }

  // ---- board ----
  return (
    <div className="min-h-screen p-4">
      <GiftBg theme={room.theme} />
      <div className="mx-auto max-w-lg pt-8 pb-16">
        <h1 className="text-2xl font-bold text-center text-neutral-900">{room.title}</h1>
        <p className="text-center text-sm text-neutral-500 mt-1">
          Сайн байна уу, {name}? Нэгийг сонгоод бэлгээ задлаарай.
        </p>

        {/* live leaderboard */}
        <div className="mt-6 rounded-2xl bg-white border border-neutral-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-amber-500" /> Амжилтын самбар
            <span className="ml-auto text-xs font-normal text-neutral-400">
              {claimedCount}/{total} авсан
            </span>
          </h2>
          {winners.length === 0 ? (
            <p className="mt-3 text-xs text-neutral-400">
              Одоогоор хэн ч дугтуйгаа задлаагүй байна. Хамгийн анхных нь та байж болох юм!
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              <AnimatePresence>
                {winners.map((w, i) => (
                  <motion.li
                    key={w.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 text-neutral-800">
                      <span
                        className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${
                          i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-neutral-400' : i === 2 ? 'bg-orange-400' : 'bg-neutral-300'
                        }`}
                      >
                        {i + 1}
                      </span>
                      {w.claimed_by_name}
                    </span>
                    <Money amount={w.amount} className="font-bold text-emerald-600" />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {/* envelopes / shagai grid */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          {envelopes.map((env, i) => {
            const isShagai = room.theme === 'tsagaan_sar';
            return (
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
                  <span className="mt-1 text-[10px] text-neutral-500 px-1 text-center leading-tight">
                    {env.claimed_by_name}
                  </span>
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
            );
          })}
        </div>

        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-neutral-400">
          <Sparkles className="w-4 h-4" /> Бодит цагт шинэчлэгдэж байна
        </p>
      </div>
    </div>
  );
}

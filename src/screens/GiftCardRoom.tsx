import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Copy, Gift, Link2, Lock, Wallet, XCircle } from 'lucide-react';
import { supabase, type Room } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { GiftBg, Confetti, Money } from '@/components/Shell';
import { themeOf } from '@/lib/utils';

/**
 * Бэлгийн карт (Мэндчилгээт бэлэг).
 *
 * 1. Линкээр орсон хүн нэвтрээгүй бол түгжээтэй цонх гарч, нэвтэрнэ.
 * 2. Нэвтэрсний дараа дүн шууд харагдахгүй — зөвхөн битүү дугтуй.
 * 3. «Бэлгээ задлах» дармагц `claim_gift_card` RPC ажиллаж, дүн болон
 *    мэндчилгээ харагдана; мөнгө хэтэвчид нэмэгдэнэ.
 *
 * Бэлгийг үүсгэсэн (илгээсэн) хүнд зөвхөн хяналтын мэдээлэл болон линк
 * хуулах товч харагдана — өөрөө авч чадахгүй.
 */
export function GiftCardRoom({
  room,
  onNeedAuth,
  onWallet,
  onClaimed,
}: {
  room: Room;
  onNeedAuth: (tab?: 'login' | 'signup') => void;
  onWallet: () => void;
  onClaimed?: (claimed: Room) => void;
}) {
  const theme = themeOf(room.theme);
  const { session } = useAuth();
  const [live, setLive] = useState<Room>(room);
  const [claimedRoom, setClaimedRoom] = useState<Room | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const running = useRef(false);
  const approved = live.status === 'PAID' || live.status === 'CLAIMED' || live.status === 'active';
  const takenByOther = !!live.claimed_by && live.claimed_by !== session?.user?.id;
  const isMine = !!session?.user && live.claimed_by === session.user.id;
  const isSender = !!session?.user && live.user_id === session.user.id;
  const reveal = !!claimedRoom || isMine;

  useEffect(() => {
    setLive(room);
  }, [room]);

  // Админ батлахыг хүлээж байгаа үед төлөвийг тогтмол шинэчилнэ.
  useEffect(() => {
    if (approved || live.status === 'REJECTED' || isSender) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', live.code)
        .maybeSingle();
      if (data) setLive(data as Room);
    }, 6000);
    return () => clearInterval(timer);
  }, [approved, live.code, live.status, isSender]);

  const claim = useCallback(async () => {
    if (running.current || claimedRoom) return;
    if (!session) {
      onNeedAuth('login');
      return;
    }
    if (isSender) {
      setError('Та өөрийн илгээсэн бэлгийг авах боломжгүй.');
      return;
    }
    running.current = true;
    setClaiming(true);
    setError('');
    const { data, error: err } = await supabase.rpc('claim_gift_card', {
      p_code: live.code,
    });
    running.current = false;
    setClaiming(false);
    if (err || !data) {
      setError(err?.message ?? 'Бэлгийг авахад алдаа гарлаа. Дахин оролдоно уу.');
      return;
    }
    const next = data as Room;
    setLive(next);
    setClaimedRoom(next);
    onClaimed?.(next);
  }, [claimedRoom, isSender, live.code, onClaimed, onNeedAuth, session]);

  const giftUrl = `${window.location.origin}/?room=${live.code}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(giftUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard блоклогдсон бол алгасна */
    }
  };

  // ---- Илгээгч (өрөө үүсгэсэн) хүний хяналтын дэлгэц ----
  if (isSender) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={live.theme} />
        <div className="w-full max-w-md rounded-3xl bg-white shadow-xl border border-neutral-200 p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h1 className="mt-4 text-xl font-bold text-neutral-900">Таны бэлэг илгээгдлээ</h1>
          <p className="mt-2 text-sm text-neutral-500">
            «{live.title}» бэлэг хүлээн авагчид илгээгдсэн / хүлээгдэж байна.
          </p>
          {live.claimed_by && (
            <p className="mt-1 text-sm font-medium text-emerald-600">
              Хүлээн авагч бэлгээ авсан байна.
            </p>
          )}
          {!approved && live.status !== 'REJECTED' && (
            <p className="mt-1 text-xs text-amber-600 flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Төлбөр батлагдахыг хүлээж байна
            </p>
          )}
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2.5 text-left">
            <Link2 className="w-4 h-4 shrink-0 text-neutral-400" />
            <span className="flex-1 min-w-0 truncate text-xs text-neutral-700">{giftUrl}</span>
          </div>
          <button
            onClick={() => void copyLink()}
            className="mt-3 w-full rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 transition-colors flex items-center justify-center gap-2"
          >
            <Copy className="w-4 h-4" /> {copied ? 'Хуулагдлаа' : 'Линк хуулах'}
          </button>
          <p className="mt-2 text-xs text-neutral-400">
            Линкээр орсон хүн бэлгээ задлахад мөнгө автоматаар түүний хэтэвчид орно.
          </p>
        </div>
      </div>
    );
  }

  // ---- Нэвтрээгүй: түгжээтэй цонх ----
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={live.theme} />
        <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl border border-neutral-200 p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <Lock className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-neutral-900">Танд бэлэг ирлээ!</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Бэлгээ задлахын тулд нэвтэрнэ үү / Бүртгүүлнэ үү.
          </p>
          <button
            onClick={() => onNeedAuth('login')}
            className="mt-6 w-full rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 transition-colors"
          >
            Нэвтрэх
          </button>
          <button
            onClick={() => onNeedAuth('signup')}
            className="mt-2 w-full rounded-xl border border-neutral-300 py-3 font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            Бүртгүүлэх
          </button>
        </div>
      </div>
    );
  }

  // ---- аль хэдийн өөр хүн авсан ----
  if (takenByOther) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={live.theme} />
        <div className="w-full max-w-sm rounded-3xl bg-white shadow-xl border border-neutral-200 p-8 text-center">
          <Gift className="w-12 h-12 text-neutral-300 mx-auto" />
          <h1 className="mt-4 text-xl font-bold text-neutral-900">
            Энэ бэлгийг аль хэдийн авсан байна
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            «{live.title}» бэлгийг өөр хэрэглэгч хүлээн авсан тул дахин авах боломжгүй.
          </p>
        </div>
      </div>
    );
  }

  // ---- төлбөр батлагдаагүй ----
  if (live.status === 'REJECTED') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={live.theme} />
        <div className="w-full max-w-sm rounded-3xl bg-white shadow-xl border border-neutral-200 p-8 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto" />
          <h1 className="mt-4 text-xl font-bold text-neutral-900">Төлбөр батлагдаагүй</h1>
          <p className="mt-2 text-sm text-neutral-500">
            «{live.title}» бэлгийн шилжүүлэг админаар батлагдсангүй.
            {live.reject_reason ? ` Шалтгаан: ${live.reject_reason}` : ''}
          </p>
        </div>
      </div>
    );
  }

  // ---- админ батлахыг хүлээж байна ----
  if (!approved) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={live.theme} />
        <div className="w-full max-w-sm rounded-3xl bg-white shadow-xl border border-neutral-200 p-8 text-center">
          <motion.div
            animate={{ rotate: [-3, 3, -3] }}
            transition={{ repeat: Infinity, duration: 2.6 }}
          >
            <Gift className="w-14 h-14 text-amber-400 mx-auto" />
          </motion.div>
          <h1 className="mt-4 text-xl font-bold text-neutral-900">
            Төлбөр баталгаажихыг хүлээж байна
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            «{live.title}» бэлгийн шилжүүлгийг админ шалгаж байна. Батлагдмагц энэ хуудас
            автоматаар шинэчлэгдэнэ.
          </p>
          <p className="mt-3 text-xs text-neutral-400 flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5" /> 6 секунд тутам шалгаж байна
          </p>
        </div>
      </div>
    );
  }

  // ---- Задарсан: дүн + мэндчилгээ + хэтэвч ----
  if (reveal) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={live.theme} />
        <Confetti />
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.35 }}
          className="w-full max-w-sm rounded-3xl bg-white shadow-2xl border border-neutral-200 p-8 text-center"
        >
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
          <p className="mt-4 text-neutral-500">Баяр хүргэе!</p>
          <h1 className="mt-1 text-xl font-bold text-neutral-900">«{live.title}»</h1>
          {live.organizer_name && (
            <p className="mt-1 text-sm text-neutral-500">— {live.organizer_name}</p>
          )}
          {live.message && (
            <p className="mt-3 text-sm leading-relaxed text-neutral-600 italic">
              “{live.message}”
            </p>
          )}
          <div className="mt-5 rounded-2xl bg-neutral-50 border border-neutral-100 px-6 py-4">
            <p className="text-xs text-neutral-500">Бэлгийн дүн</p>
            <Money amount={live.total_amount} className="text-3xl font-extrabold text-neutral-900" />
          </div>
          <p className="mt-3 text-sm font-medium text-emerald-700">
            Мөнгө таны хэтэвчинд орлоо!
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Та Профайл → Хэтэвч хэсгээс банкны данс руугаа татах боломжтой.
          </p>
          <button
            onClick={onWallet}
            className="mt-5 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" /> Хэтэвч рүү
          </button>
        </motion.div>
      </div>
    );
  }

  // ---- Битүү дугтуй ----
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <GiftBg theme={live.theme} />
      <div className="text-center">
        <motion.button
          onClick={() => void claim()}
          disabled={claiming}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="relative"
        >
          <motion.div
            animate={{ rotate: [-2, 2, -2], y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 2.4 }}
            className={`w-56 h-56 rounded-3xl shadow-2xl bg-gradient-to-br ${theme.gradient} flex items-center justify-center`}
          >
            <Gift className="w-20 h-20 text-white" />
          </motion.div>
        </motion.button>
        <h1 className="mt-8 text-2xl font-bold text-neutral-900">Танд бэлэг ирлээ!</h1>
        <p className="mt-2 text-sm text-neutral-500">
          {live.organizer_name ? `${live.organizer_name} · ` : ''}Дугтуйгаа дарж бэлгээ задална уу.
        </p>
        {claiming && (
          <p className="mt-3 text-sm text-emerald-600">Бэлгийг таны хэтэвчид хийж байна...</p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          onClick={() => void claim()}
          disabled={claiming}
          className="mt-6 w-full max-w-xs rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors"
        >
          {claiming ? 'Задалж байна...' : 'Бэлгээ задлах'}
        </button>
      </div>
    </div>
  );
}

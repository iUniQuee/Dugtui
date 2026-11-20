import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Gift, Lock, MousePointerClick, Wallet } from 'lucide-react';
import { supabase, type Room } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { GiftBg, Confetti, Money } from '@/components/Shell';
import { themeOf } from '@/lib/utils';

/**
 * Бэлгийн карт: линкээр орж нэвтэрсэн хэрэглэгчид бэлгийг автоматаар
 * түүний бүртгэл рүү шилжүүлж, хэтэвчинд нь нэмнэ (claim_gift_card RPC).
 */
export function GiftCardRoom({
  room,
  onNeedAuth,
  onWallet,
  onClaimed,
}: {
  room: Room;
  onNeedAuth: () => void;
  onWallet: () => void;
  onClaimed?: (claimed: Room) => void;
}) {
  const theme = themeOf(room.theme);
  const { session } = useAuth();
  const [claimedRoom, setClaimedRoom] = useState<Room | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const [showCard, setShowCard] = useState(false);

  const running = useRef(false);
  const mine = claimedRoom !== null;
  const takenByOther = !!room.claimed_by && room.claimed_by !== session?.user?.id;

  const claim = useCallback(async () => {
    if (running.current || mine) return;
    running.current = true;
    setClaiming(true);
    setError('');
    const { data, error: err } = await supabase.rpc('claim_gift_card', {
      p_code: room.code,
    });
    running.current = false;
    setClaiming(false);
    if (err || !data) {
      setError(err?.message ?? 'Бэлгийг авахад алдаа гарлаа. Дахин оролдоно уу.');
      return;
    }
    const next = data as Room;
    setClaimedRoom(next);
    setShowCard(true);
    onClaimed?.(next);
  }, [mine, onClaimed, room.code]);

  // Нэвтэрсэн даруйд (бүртгүүлэх эсвэл нэвтрэх) бэлэг автоматаар шилжинэ.
  useEffect(() => {
    if (!session?.user || claimedRoom) return;
    if (room.claimed_by && room.claimed_by !== session.user.id) return;
    void claim();
  }, [session?.user, claimedRoom, room.claimed_by, claim]);

  const handleOpen = () => {
    if (!session) {
      onNeedAuth();
      return;
    }
    void claim();
  };

  // ---- Амжилттай: бэлэг таны хэтэвчид орлоо ----
  if (mine && showCard) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <Confetti />
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.35 }}
          className="w-full max-w-sm rounded-3xl bg-white shadow-2xl border border-neutral-200 p-8 text-center"
        >
          <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
          <p className="mt-4 text-neutral-500">Баяр хүргэе!</p>
          <p className="mt-1 font-semibold text-neutral-900">
            «{claimedRoom.title}» бэлэг таны бүртгэлд шилжлээ.
          </p>
          <Money
            amount={claimedRoom.total_amount}
            className="mt-4 block text-4xl font-extrabold text-neutral-900"
          />
          <p className="mt-2 text-xs text-neutral-400">
            Хэтэвчний үлдэгдэлд нэмэгдсэн. «Миний профайл» → «Хэтэвч» хэсгээс харна уу.
          </p>
          <button
            onClick={onWallet}
            className="mt-6 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" /> Хэтэвч рүү
          </button>
        </motion.div>
      </div>
    );
  }

  // ---- аль хэдийн өөр хүн авсан ----
  if (takenByOther) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <div className="w-full max-w-sm rounded-3xl bg-white shadow-xl border border-neutral-200 p-8 text-center">
          <Gift className="w-12 h-12 text-neutral-300 mx-auto" />
          <h1 className="mt-4 text-xl font-bold text-neutral-900">
            Энэ бэлгийг аль хэдийн авсан байна
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            «{room.title}» бэлгийг өөр хэрэглэгч хүлээн авсан тул дахин авах боломжгүй.
          </p>
        </div>
      </div>
    );
  }

  // ---- нээх дэлгэц ----
  if (!showCard) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <div className="text-center">
          <motion.button
            onClick={handleOpen}
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
          <p className="mt-2 text-neutral-500 flex items-center justify-center gap-1 text-sm">
            <MousePointerClick className="w-4 h-4" /> Дарж бэлгээ хүлээн авна уу
          </p>
          {!session && (
            <p className="mt-3 text-xs text-amber-600 flex items-center justify-center gap-1">
              <Lock className="w-3.5 h-3.5" /> Бэлгээ авахын тулд бүртгүүлэх эсвэл нэвтрэх
              шаардлагатай.
            </p>
          )}
          {claiming && (
            <p className="mt-3 text-sm text-emerald-600">
              Бэлгийг таны бүртгэлд шилжүүлж байна...
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button
            onClick={handleOpen}
            disabled={claiming}
            className="mt-6 w-full max-w-xs rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {claiming ? 'Шилжүүлж байна...' : session ? 'Бэлгээ авах' : 'Бүртгүүлж бэлгээ авах'}
          </button>
        </div>
      </div>
    );
  }

  // ---- бэлгийн карт (нээсэн) ----
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <GiftBg theme={room.theme} />
      <Confetti />
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.4 }}
        className={`w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden bg-gradient-to-br ${theme.gradient} text-white`}
      >
        {room.image_url && (
          <img src={room.image_url} alt="" className="w-full h-48 object-cover" />
        )}
        <div className="p-8 text-center">
          <h1 className="text-xl font-bold">{room.title}</h1>
          {room.organizer_name && (
            <p className="mt-1 text-sm opacity-80">— {room.organizer_name}</p>
          )}
          {room.message && (
            <p className="mt-4 text-sm leading-relaxed opacity-95">{room.message}</p>
          )}
          <div className="mt-6 rounded-2xl bg-white/15 backdrop-blur px-6 py-4">
            <p className="text-xs opacity-80">Бэлгийн дүн</p>
            <Money amount={room.total_amount} className="text-3xl font-extrabold" />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

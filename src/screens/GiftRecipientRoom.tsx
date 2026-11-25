import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Gift,
  Link2,
  Loader2,
  Lock,
  MessageSquareHeart,
  Wallet,
  XCircle,
} from 'lucide-react';
import { supabase, type Room, type RoomStatus } from '@/lib/supabase';
import { GiftBg, Money } from '@/components/Shell';
import { Celebration } from '@/components/Celebration';
import { useAuth } from '@/lib/useAuth';
import { themeOf, formatMNT } from '@/lib/utils';

interface GiftContribution {
  name: string;
  amount: number;
  message: string | null;
  created_at: string;
}

interface GiftTransfer {
  bank_name: string;
  account_number: string;
  account_name: string;
  amount: number;
  status: 'pending' | 'paid';
  created_at: string;
  paid_at: string | null;
}

interface GiftView {
  room: {
    code: string;
    title: string;
    theme: Room['theme'];
    message: string | null;
    organizer_name: string | null;
    status: RoomStatus;
    goal: number;
    raised: number;
  };
  is_sender?: boolean;
  claimed?: boolean;
  claimed_by_me?: boolean;
  contributions: GiftContribution[];
  transfer: GiftTransfer | null;
}

interface ClaimResult {
  room_id: string;
  amount: number;
  already: boolean;
}

/**
 * «Бэлгийн линк»-ээр орсон хүлээн авагчийн дэлгэц.
 *
 * 1. Линкээр орсон хүн нэвтрээгүй бол түгжээтэй цонх гарч, нэвтэрнэ.
 * 2. Нэвтэрсний дараа дүн шууд харагдахгүй — зөвхөн битүү дугтуй.
 * 3. «Бэлгээ задлах» дармагц `claim_group_gift` RPC нийт дүнг хэтэвчид
 *    нэмж, дараа нь дүн болон мэндчилгээнүүд харагдана.
 *
 * Өрөө үүсгэсэн (илгээсэн) хүнд зөвхөн хяналтын мэдээлэл болон линк
 * хуулах товч харагдана — бэлгийг өөрөө авч чадахгүй.
 */
export function GiftRecipientRoom({
  token,
  onNeedAuth,
  onWallet,
}: {
  token: string;
  onNeedAuth: (tab?: 'login' | 'signup') => void;
  onWallet: () => void;
}) {
  const { session } = useAuth();
  const [data, setData] = useState<GiftView | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc('get_gift_by_token', {
      p_token: token,
    });
    if (err || !res) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    const view = res as GiftView;
    setData(view);
    setLoading(false);
    if (view.claimed_by_me) setRevealed(true);
  }, [token]);

  // Нэвтрэлт солигдвол линкний мэдээллийг дахин татна (is_sender/claimed).
  useEffect(() => {
    void load();
  }, [load, session?.user.id]);

  // Баярын эффект зөвхөн бэлгийг одоо задлах үед ажиллана (хуудсаа дахин
  // нээхэд давтан асахгүй). Canvas эффект өөрөө 4.5 секундэд зогсоно.
  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), 5200);
    return () => clearTimeout(timer);
  }, [celebrate]);

  const openGift = async () => {
    if (claiming) return;
    if (!session) {
      onNeedAuth('login');
      return;
    }
    setClaiming(true);
    setError('');
    const { data: res, error: err } = await supabase.rpc('claim_group_gift', {
      p_token: token,
    });
    setClaiming(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (res) {
      const claim = res as ClaimResult;
      setData((prev) =>
        prev ? { ...prev, room: { ...prev.room, raised: claim.amount }, claimed_by_me: true } : prev
      );
    }
    setRevealed(true);
    setCelebrate(true);
    void load();
  };

  const giftUrl = `${window.location.origin}/?gift=${token}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(giftUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard блоклогдсон бол алгасна */
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="flex items-center gap-2 text-neutral-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Ачаалж байна...
        </div>
      </div>
    );
  }

  if (invalid || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow">
          <AlertCircle className="w-10 h-10 text-neutral-300 mx-auto" />
          <p className="mt-3 font-semibold text-neutral-900">Линк хүчингүй байна</p>
          <p className="mt-1 text-sm text-neutral-500">
            Бэлгийн линк буруу эсвэл хугацаа дууссан байна. Линк илгээсэн хүнээс дахин
            хүсээрэй.
          </p>
        </div>
      </div>
    );
  }

  const { room, contributions } = data;
  const theme = themeOf(room.theme);

  // ---- Илгээгч (өрөө үүсгэсэн) хүний хяналтын дэлгэц ----
  if (data.is_sender) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <div className="w-full max-w-md rounded-3xl bg-white shadow-xl border border-neutral-200 p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h1 className="mt-4 text-xl font-bold text-neutral-900">Таны бэлэг илгээгдлээ</h1>
          <p className="mt-2 text-sm text-neutral-500">
            «{room.title}» бэлэг хүлээн авагчид илгээгдсэн / хүлээгдэж байна.
          </p>
          {data.claimed && (
            <p className="mt-1 text-sm font-medium text-emerald-600">
              Хүлээн авагч бэлгээ авсан байна.
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
        <GiftBg theme={room.theme} />
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

  // ---- Өөр хүн аль хэдийн авсан ----
  if (data.claimed && !data.claimed_by_me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <div className="w-full max-w-sm rounded-3xl bg-white shadow-xl border border-neutral-200 p-8 text-center">
          <XCircle className="w-12 h-12 text-neutral-300 mx-auto" />
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

  // ---- Битүү дугтуй ----
  if (!revealed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <div className="text-center">
          <motion.button
            onClick={() => void openGift()}
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
            {room.organizer_name ? `Илгээгч: ${room.organizer_name} · ` : ''}Дугтуйгаа дарж бэлгээ
            задална уу.
          </p>
          {claiming && (
            <p className="mt-3 text-sm text-emerald-600">Бэлгийг таны хэтэвчид хийж байна...</p>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <button
            onClick={() => void openGift()}
            disabled={claiming}
            className="mt-6 w-full max-w-xs rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {claiming ? 'Задалж байна...' : 'Бэлгээ задлах'}
          </button>
        </div>
      </div>
    );
  }

  // ---- Задарсан: дүн + мэндчилгээ + хэтэвч ----
  return (
    <div className="min-h-screen p-4">
      <GiftBg theme={room.theme} />
      {celebrate && <Celebration theme={room.theme} />}
      <div className="mx-auto max-w-lg pt-8 pb-24">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600">
            <Gift className="w-4 h-4 text-red-500" /> Хамтын бэлэг
          </div>
          <h1 className="mt-3 text-2xl font-bold text-neutral-900">{room.title}</h1>
          {room.message && <p className="mt-2 text-sm text-neutral-500">{room.message}</p>}
          {room.organizer_name && (
            <p className="mt-1 text-sm text-neutral-500">Зохион байгуулагч: {room.organizer_name}</p>
          )}
        </div>

        <motion.div
          layout
          className={`mt-6 rounded-3xl shadow-lg p-6 bg-gradient-to-br ${theme.gradient} text-white text-center`}
        >
          <p className="text-sm opacity-90">Танд цугласан бэлэг</p>
          <Money amount={room.raised} className="text-4xl font-extrabold" />
          <p className="mt-2 text-xs opacity-90">{contributions.length} хүний нэмэр</p>
        </motion.div>

        <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
          <p className="mt-2 font-semibold text-emerald-900">
            Мөнгө таны хэтэвчинд орлоо!
          </p>
          <p className="mt-1 text-sm text-emerald-800">
            {formatMNT(room.raised)} таны «Миний хэтэвч» үлдэгдэлд нэмэгдлээ. Та Профайл → Хэтэвч
            хэсгээс банкны данс руугаа татах боломжтой.
          </p>
          <button
            onClick={onWallet}
            className="mt-4 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" /> Хэтэвч рүү
          </button>
        </div>

        {/* Мэндчилгээнүүд */}
        <div className="mt-6">
          <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
            <MessageSquareHeart className="w-5 h-5" /> Найзуудын мэндчилгээ
          </h2>
          <div className="mt-3 space-y-3">
            {contributions.length === 0 ? (
              <p className="text-sm text-neutral-500">Одоогоор мэндчилгээ байхгүй байна.</p>
            ) : (
              contributions.map((c, i) => (
                <motion.div
                  key={`${c.name}-${c.created_at}-${i}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.4) }}
                  className="rounded-2xl border border-neutral-200 bg-white px-5 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-neutral-900">{c.name}</p>
                    <Money amount={c.amount} className="text-sm font-bold text-emerald-600" />
                  </div>
                  {c.message && (
                    <p className="mt-1 text-sm text-neutral-600 italic">“{c.message}”</p>
                  )}
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

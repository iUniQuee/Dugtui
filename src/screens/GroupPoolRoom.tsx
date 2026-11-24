import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  HeartHandshake,
  Link2,
  Send,
  Share2,
  Users,
} from 'lucide-react';
import { supabase, type Contribution, type Room, type RoomStatus } from '@/lib/supabase';
import { GiftBg, Money } from '@/components/Shell';
import { BankTransferModal } from '@/components/BankTransferModal';
import { generatePaymentCode } from '@/lib/payments';
import { notifyAdmin } from '@/lib/push';
import { useAuth } from '@/lib/useAuth';
import { themeOf, formatMNT } from '@/lib/utils';

export function GroupPoolRoom({ room }: { room: Room }) {
  const theme = themeOf(room.theme);
  const { session, profile } = useAuth();
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [mine, setMine] = useState<Contribution[]>([]);
  const [liveStatus, setLiveStatus] = useState<RoomStatus>(room.status);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // QR төлбөрийн цонх
  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [paymentCode, setPaymentCode] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [submittedCode, setSubmittedCode] = useState('');

  // Хүлээн авагчийн линк (зөвхөн өрөө үүсгэсэн хүнд)
  const [giftUrl, setGiftUrl] = useState('');
  const [giftError, setGiftError] = useState('');
  const [copied, setCopied] = useState(false);

  const isOwner = !!session && session.user.id === room.user_id;

  const load = async () => {
    const [contribRes, roomRes] = await Promise.all([
      supabase
        .from('contributions')
        .select('*')
        .eq('room_id', room.id)
        .order('created_at', { ascending: false }),
      supabase.from('rooms').select('status').eq('id', room.id).maybeSingle(),
    ]);
    const rows = (contribRes.data ?? []) as Contribution[];
    setContribs(rows.filter((c) => c.status === 'PAID'));
    setMine(
      session?.user.id
        ? rows.filter((c) => c.status === 'PENDING_APPROVAL' && c.user_id === session.user.id)
        : []
    );
    if (roomRes.data) setLiveStatus((roomRes.data as { status: RoomStatus }).status);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel('contribs-' + room.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contributions', filter: 'room_id=eq.' + room.id },
        () => void load()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'id=eq.' + room.id },
        () => void load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, session?.user.id]);

  // Нэвтэрсэн хэрэглэгчийн бүртгэлтэй нэрийг автоматаар бөглөнө.
  useEffect(() => {
    const saved = (profile?.display_name ?? '').trim();
    if (!nameTouched && saved) setName(saved);
  }, [profile?.display_name, nameTouched]);

  const raised = useMemo(() => contribs.reduce((s, c) => s + c.amount, 0), [contribs]);
  const goal = room.total_amount;
  const percent = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
  const goalReached = goal > 0 && raised >= goal;
  const completed = liveStatus === 'completed';

  // Зорилго 100% болмогц линкийг бэлдэж, зөвхөн өрөө үүсгэсэн хүнд харуулна.
  useEffect(() => {
    if (!isOwner || !goalReached || completed) {
      setGiftUrl('');
      return;
    }
    let alive = true;
    void supabase
      .rpc('ensure_gift_link', { p_room_id: room.id })
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (typeof data === 'string' && data) {
          setGiftUrl(`${window.location.origin}/?gift=${data}`);
          setGiftError('');
        } else if (err) {
          setGiftError(err.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [isOwner, goalReached, completed, room.id]);

  const openPay = () => {
    const amt = parseInt(amount.replace(/\D/g, ''), 10);
    if (!name.trim()) return setError('Нэрээ оруулна уу.');
    if (!amt || amt <= 0) return setError('Зөв мөнгөн дүн оруулна уу.');
    if (goalReached) return setError('Зорилго биелсэн тул нэмэр авахыг хаасан байна.');
    setError('');
    setPayAmount(amt);
    setPaymentCode(generatePaymentCode());
    setPayError('');
    setShowPay(true);
  };

  const submitContribution = async () => {
    setPaying(true);
    setPayError('');
    const { data, error: err } = await supabase.rpc('submit_group_contribution', {
      p_room_id: room.id,
      p_name: name.trim(),
      p_amount: payAmount,
      p_message: message.trim() || null,
      p_payment_code: paymentCode,
    });
    setPaying(false);
    if (err) {
      setPayError(err.message);
      return;
    }
    setShowPay(false);
    setSubmittedCode(paymentCode);
    setAmount('');
    setMessage('');
    if (data && typeof data === 'object' && 'id' in data) {
      void notifyAdmin({ kind: 'contribution', contributionId: String(data.id) });
    }
    void load();
  };

  const copyLink = async () => {
    if (!giftUrl) return;
    try {
      await navigator.clipboard.writeText(giftUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard блоклогдсон бол алгасна */
    }
  };

  const shareLink = async () => {
    if (!giftUrl) return;
    const shareData = {
      title: `${room.title} — хамтын бэлэг`,
      text: 'Бэлгийг хүлээн авах дансаа энд бөглөнө үү.',
      url: giftUrl,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* цуцалсан бол хуулах руу шилжинэ */
      }
    }
    await copyLink();
  };

  const pendingTotal = mine.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="min-h-screen p-4">
      <GiftBg theme={room.theme} />
      <div className="mx-auto max-w-lg pt-8 pb-24">
        <h1 className="text-2xl font-bold text-center text-neutral-900">{room.title}</h1>
        {room.message && (
          <p className="text-center text-sm text-neutral-500 mt-2">{room.message}</p>
        )}
        <p className="text-center text-sm text-neutral-500 mt-1">
          {room.organizer_name ? `${room.organizer_name} · ` : ''}
          Хамтдаа цуглуулъя — нэмэрээ үлдээгээрэй!
        </p>

        {/* progress card */}
        <motion.div
          layout
          className={`mt-6 rounded-3xl shadow-lg p-6 bg-gradient-to-br ${theme.gradient} text-white`}
        >
          <p className="text-sm opacity-90">Цугласан дүн</p>
          <Money amount={raised} className="text-4xl font-extrabold" />
          {goal > 0 && (
            <>
              <div className="mt-4 h-3 rounded-full bg-white/25 overflow-hidden">
                <motion.div
                  className="h-full bg-white rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${percent}%` }}
                  transition={{ type: 'spring', stiffness: 60 }}
                />
              </div>
              <p className="mt-2 text-xs opacity-90">
                Зорилго: {formatMNT(goal)} · {percent}%
              </p>
            </>
          )}
          <div className="mt-4 flex items-center gap-2 text-sm">
            <Users className="w-4 h-4" /> {contribs.length} хүн оролцсон
          </div>
          {completed && (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Хүргэгдсэн (Completed)
            </div>
          )}
        </motion.div>

        {/* Бэлэг хүргэгдсэн */}
        {completed && (
          <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <Gift className="w-10 h-10 text-emerald-600 mx-auto" />
            <p className="mt-2 font-semibold text-emerald-900">Бэлэг хүргэгдлээ 🎉</p>
            <p className="mt-1 text-sm text-emerald-800">
              Цугласан {formatMNT(raised)} хүлээн авагчийн данс руу шилжигдсэн байна.
            </p>
          </div>
        )}

        {/* Зорилго биелсэн — нэмэр хаах + хүлээн авагчийн линк */}
        {!completed && goalReached && (
          <div className="mt-6 bg-white/90 backdrop-blur rounded-3xl border border-neutral-200 shadow p-6">
            <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Зорилго 100% биеллээ
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Нэмэр авах хаагдсан. Одоо бэлгийг хүлээн авагчид илгээнэ үү.
            </p>

            {isOwner ? (
              giftUrl ? (
                <>
                  <p className="mt-4 text-xs font-medium text-neutral-600">
                    Бэлгийн линк (хүлээн авагчид илгээнэ)
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2.5">
                    <Link2 className="w-4 h-4 shrink-0 text-neutral-400" />
                    <span className="flex-1 min-w-0 truncate text-xs text-neutral-700">
                      {giftUrl}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => void copyLink()}
                      className="flex-1 rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      {copied ? 'Хуулагдлаа' : 'Линк хуулах'}
                    </button>
                    <button
                      onClick={() => void shareLink()}
                      className="flex-1 rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3 font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                    >
                      <Share2 className="w-4 h-4" /> Илгээх
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-neutral-400">
                    Линкээр орсон хүн нийт дүн, бүх мэндчилгээг харж, бэлэг хүлээх дансаа
                    бөглөнө.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">
                  {giftError
                    ? `Линк үүсгэхэд алдаа гарлаа: ${giftError}`
                    : 'Бэлгийн линкийг бэлдэж байна...'}
                </p>
              )
            ) : (
              <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                Зохион байгуулагч бэлгийн линкийг хүлээн авагчид илгээнэ.
              </p>
            )}
          </div>
        )}

        {/* contribution form */}
        {!goalReached && !completed && (
          <div className="mt-6 bg-white/90 backdrop-blur rounded-3xl border border-neutral-200 shadow p-6">
            <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
              <HeartHandshake className="w-5 h-5" /> Нэмэр оруулах
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Нэмрээ илгээсний дараа QR-аар төлж, админ баталгаажуулсны дараа цугласан дүнд
              нэмэгдэнэ.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder="Таны нэр"
                className="rounded-xl border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="Дүн (₮)"
                inputMode="numeric"
                className="rounded-xl border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Мэндчилгээ (сонголттой)"
              className="mt-3 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              onClick={openPay}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3 font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" /> Нэмэр оруулах
            </button>
            {!session && (
              <p className="mt-2 text-xs text-neutral-400 text-center">
                Нэвтэрсэн бол нэр тань автоматаар бөглөгдөнө.
              </p>
            )}
          </div>
        )}

        {/* Шалгагдаж байгаа нэмэр */}
        {(submittedCode || mine.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5"
          >
            <p className="font-semibold text-amber-900 flex items-center gap-2">
              <Clock className="w-5 h-5" /> Шалгагдаж байна (Pending)
            </p>
            {submittedCode && (
              <p className="mt-1 text-sm text-amber-800">
                Таны {formatMNT(payAmount)} нэмэр хүлээн авагдлаа. Гүйлгээний утга:{' '}
                <span className="font-mono font-bold tracking-widest">{submittedCode}</span>.
              </p>
            )}
            {mine.length > 0 && (
              <>
                <p className="mt-1 text-sm text-amber-800">
                  Админ төлбөрийг тулгаж баталгаажуулсны дараа цугласан дүнд нэмэгдэнэ.
                </p>
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {mine.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span>
                        {formatMNT(c.amount)}
                        {c.payment_code ? ` · код ${c.payment_code}` : ''}
                      </span>
                      <span className="text-xs">Хүлээгдэж байна</span>
                    </li>
                  ))}
                </ul>
                {mine.length > 1 && (
                  <p className="mt-1 text-xs text-amber-700">
                    Нийт хүлээгдэж буй: {formatMNT(pendingTotal)}
                  </p>
                )}
              </>
            )}
          </motion.div>
        )}

        {/* list */}
        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="text-center text-neutral-500 text-sm">Ачаалж байна...</p>
          ) : contribs.length === 0 ? (
            <p className="text-center text-neutral-500 text-sm">
              Одоогоор нэмэр оруулаагүй байна. Эхний нэмрийг та өөрөө үлдээгээрэй!
            </p>
          ) : (
            contribs.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4) }}
                className="bg-white rounded-2xl border border-neutral-200 shadow-sm px-5 py-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-neutral-900">{c.name}</p>
                  {c.message && <p className="text-sm text-neutral-500 mt-0.5">{c.message}</p>}
                </div>
                <Money amount={c.amount} className="font-bold text-emerald-600" />
              </motion.div>
            ))
          )}
        </div>
      </div>

      {showPay && (
        <BankTransferModal
          amount={payAmount}
          title={room.title}
          paymentCode={paymentCode}
          busy={paying}
          error={payError}
          onSubmitted={() => void submitContribution()}
          onClose={() => {
            if (!paying) setShowPay(false);
          }}
        />
      )}
    </div>
  );
}

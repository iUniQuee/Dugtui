import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Gift,
  Landmark,
  Loader2,
  MessageSquareHeart,
  PencilLine,
  Send,
} from 'lucide-react';
import { supabase, type Room, type RoomStatus } from '@/lib/supabase';
import { GiftBg, Confetti, Money } from '@/components/Shell';
import { formatAccountNumber, normalizeAccountNumber } from '@/lib/payments';
import { themeOf, formatMNT } from '@/lib/utils';

export const BANKS = [
  'Богд банк',
  'Хаан банк',
  'Голомт банк',
  'Худалдаа хөгжлийн банк',
  'Ариг банк',
  'Капитрон банк',
  'Хас банк',
  'Төрийн банк',
];

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
  contributions: GiftContribution[];
  transfer: GiftTransfer | null;
}

/**
 * «Бэлгийн линк»-ээр орсон хүлээн авагчийн дэлгэц.
 *
 * Линкний токеныг `get_gift_by_token` RPC шалгана. Цугласан нийт дүн, бүх
 * мэндчилгээг харуулж, хүлээн авах дансаа бөглүүлнэ. Данс илгээгдмэгц админ
 * самбарт «Бэлэг шилжүүлэх хүсэлт» болж очно.
 */
export function GiftRecipientRoom({ token }: { token: string }) {
  const [data, setData] = useState<GiftView | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [editing, setEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justSent, setJustSent] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.rpc('get_gift_by_token', {
      p_token: token,
    });
    if (err) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    if (!res) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    const view = res as GiftView;
    setData(view);
    setLoading(false);
    if (view.transfer) {
      setBankName(view.transfer.bank_name);
      setAccountNumber(view.transfer.account_number);
      setAccountName(view.transfer.account_name);
      setEditing(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Админ «Шилжүүлсэн» дарсныг хүлээн авагч автоматаар харна.
  useEffect(() => {
    if (!data?.transfer || data.transfer.status !== 'pending') return;
    const timer = setInterval(() => void load(), 6000);
    return () => clearInterval(timer);
  }, [data?.transfer, load]);

  // Бэлэг хүргэгдэж нээгдсэн үед 5 секунд салют буудна.
  const delivered = !!data && (data.room.status === 'completed' || data.transfer?.status === 'paid');
  useEffect(() => {
    if (!delivered) return;
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), 5000);
    return () => clearTimeout(timer);
  }, [delivered]);

  const submit = async () => {
    if (!bankName) return setError('Банкаа сонгоно уу.');
    if (!normalizeAccountNumber(accountNumber)) return setError('Дансны дугаараа оруулна уу.');
    if (!accountName.trim()) return setError('Хүлээн авагчийн нэрээ оруулна уу.');
    setSaving(true);
    setError('');
    const { error: err } = await supabase.rpc('submit_gift_transfer', {
      p_token: token,
      p_bank_name: bankName,
      p_account_number: normalizeAccountNumber(accountNumber),
      p_account_name: accountName.trim(),
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setJustSent(true);
    setEditing(false);
    void load();
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

  const { room, contributions, transfer } = data;
  const theme = themeOf(room.theme);
  const completed = room.status === 'completed' || transfer?.status === 'paid';
  const sendForm = !completed && (!transfer || editing);

  return (
    <div className="min-h-screen p-4">
      <GiftBg theme={room.theme} />
      {celebrate && <Confetti />}
      <div className="mx-auto max-w-lg pt-8 pb-24">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600">
            <Gift className="w-4 h-4 text-red-500" /> Хамтын бэлэг
          </div>
          <h1 className="mt-3 text-2xl font-bold text-neutral-900">{room.title}</h1>
          {room.message && <p className="mt-2 text-sm text-neutral-500">{room.message}</p>}
          {room.organizer_name && (
            <p className="mt-1 text-sm text-neutral-500">
              Зохион байгуулагч: {room.organizer_name}
            </p>
          )}
        </div>

        {/* Нийт дүн */}
        <motion.div
          layout
          className={`mt-6 rounded-3xl shadow-lg p-6 bg-gradient-to-br ${theme.gradient} text-white text-center`}
        >
          <p className="text-sm opacity-90">Танд цугласан бэлэг</p>
          <Money amount={room.raised} className="text-4xl font-extrabold" />
          <p className="mt-2 text-xs opacity-90">{contributions.length} хүний нэмэр</p>
          {completed && (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Хүргэгдсэн (Completed)
            </div>
          )}
        </motion.div>

        {completed && (
          <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <p className="font-semibold text-emerald-900">Бэлэг хүргэгдлээ 🎉</p>
            <p className="mt-1 text-sm text-emerald-800">
              {formatMNT(room.raised)} таны данс руу шилжигдсэн байна. Баяр хүргэе!
            </p>
          </div>
        )}

        {/* Дансны хүсэлтийн төлөв */}
        {!completed && transfer && !editing && (
          <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-6">
            <p className="font-semibold text-amber-900 flex items-center gap-2">
              <Clock className="w-5 h-5" /> Данс илгээгдсэн — шилжүүлэг хийгдэж байна
            </p>
            <p className="mt-1 text-sm text-amber-800">
              Админ {formatMNT(transfer.amount)}-г доорх данс руу шилжүүлсний дараа энэ хуудас
              «Хүргэгдсэн» болно.
            </p>
            <dl className="mt-3 space-y-1 text-sm text-amber-900">
              <div className="flex justify-between gap-3">
                <dt className="text-amber-700">Банк</dt>
                <dd className="font-medium">{transfer.bank_name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-amber-700">Данс</dt>
                <dd className="font-mono font-medium">
                  {formatAccountNumber(transfer.account_number)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-amber-700">Нэр</dt>
                <dd className="font-medium">{transfer.account_name}</dd>
              </div>
            </dl>
            <button
              onClick={() => setEditing(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 transition-colors"
            >
              <PencilLine className="w-4 h-4" /> Дансны мэдээлэл засах
            </button>
          </div>
        )}

        {/* Дансны форм */}
        {sendForm && (
          <div className="mt-5 rounded-3xl border border-neutral-200 bg-white shadow p-6">
            <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
              <Landmark className="w-5 h-5" /> Бэлэг хүлээн авах дансны мэдээлэл
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Цугласан дүнг энэ данс руу шилжүүлнэ. Мэдээллээ зөв бөглөнө үү.
            </p>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-neutral-600">Банк сонгох</span>
              <select
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                <option value="">— Банк сонгох —</option>
                {BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="text-xs font-medium text-neutral-600">Дансны дугаар</span>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="5000 1234 5678"
                inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 font-mono text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-xs font-medium text-neutral-600">Хүлээн авагчийн нэр</span>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Овог Нэр"
                className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </label>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              onClick={() => void submit()}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3 font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {saving ? 'Илгээж байна...' : 'Дансаа илгээх'}
            </button>
            {editing && transfer && (
              <button
                onClick={() => setEditing(false)}
                className="mt-2 w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Болих
              </button>
            )}
          </div>
        )}

        {justSent && !completed && (
          <p className="mt-3 text-center text-sm text-emerald-700">
            Данс илгээгдлээ. Админ шилжүүлсний дараа мэдэгдэнэ.
          </p>
        )}

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

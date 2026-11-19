import { useState } from 'react';
import { Landmark, CheckCircle2, X } from 'lucide-react';
import { BANKS, MONGOORI_PARTNERS } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

export function WithdrawModal({
  roomId,
  envelopeId,
  contributorId,
  name,
  amount,
  onClose,
}: {
  roomId: string;
  envelopeId?: string | null;
  contributorId?: string | null;
  name: string;
  amount: number;
  onClose: () => void;
}) {
  const [bank, setBank] = useState('');
  const [account, setAccount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!bank || !account.trim()) {
      setError('Банк болон дансны дугаараа оруулна уу.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('withdrawals').insert({
      room_id: roomId,
      envelope_id: envelopeId ?? null,
      contributor_id: contributorId ?? null,
      participant_name: name,
      amount,
      bank_name: bank,
      account_number: account.trim(),
      account_name: accountName.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError('Хадгалахад алдаа гарлаа: ' + err.message);
      return;
    }
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg text-neutral-900 flex items-center gap-2">
            <Landmark className="w-5 h-5" /> Мөнгөө татах
          </h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-neutral-100">
            <X className="w-5 h-5 text-neutral-500" />
          </button>
        </div>

        {done ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
            <p className="font-medium text-neutral-900">Хүсэлт амжилттай илгээгдлээ!</p>
            <p className="text-sm text-neutral-500 mt-1">
              Мөнгө таны данс руу автоматаар шилжих болно.
            </p>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-700 transition-colors"
            >
              ОК
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between">
              <span className="text-sm text-emerald-700">Хүлээж буй дүн</span>
              <span className="font-bold text-emerald-700">
                {new Intl.NumberFormat('mn-MN').format(amount)}₮
              </span>
            </div>

            <label className="block">
              <span className="text-sm text-neutral-600 mb-1 block">Банк</span>
              <select
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                <option value="">Сонгоно уу...</option>
                {BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-neutral-600 mb-1 block">Дансны дугаар</span>
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))}
                placeholder="Дансааны дугаар"
                inputMode="numeric"
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </label>

            <label className="block">
              <span className="text-sm text-neutral-600 mb-1 block">Дансны эзэмшигчийн нэр (сонголттой)</span>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder={name}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </label>

            <p className="text-xs text-neutral-500">
              Шилжүүлгийг дараах банкуудын апп дамжуулан хийнэ: {MONGOORI_PARTNERS.join(', ')}.
            </p>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={submit}
              disabled={saving}
              className="w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Илгээж байна...' : 'Баталгаажуулах'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

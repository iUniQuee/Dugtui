import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Send, HeartHandshake } from 'lucide-react';
import { supabase, type Room, type Contribution } from '@/lib/supabase';
import { GiftBg, Money } from '@/components/Shell';
import { themeOf, formatMNT } from '@/lib/utils';

export function GroupPoolRoom({ room }: { room: Room }) {
  const theme = themeOf(room.theme);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from('contributions')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: false });
    if (data) setContribs(data as Contribution[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('contribs-' + room.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contributions', filter: 'room_id=eq.' + room.id },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  const raised = contribs.reduce((s, c) => s + c.amount, 0);
  const goal = room.total_amount;

  const submit = async () => {
    const amt = parseInt(amount.replace(/\D/g, ''), 10);
    if (!name.trim() || !amt || amt <= 0) {
      setError('Нэр болон зөв дүн оруулна уу.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('contributions').insert({
      room_id: room.id,
      name: name.trim(),
      amount: amt,
      message: message.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError('Алдаа гарлаа: ' + err.message);
      return;
    }
    setAmount('');
    setMessage('');
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  };

  return (
    <div className="min-h-screen p-4">
      <GiftBg theme={room.theme} />
      <div className="mx-auto max-w-lg pt-8 pb-24">
        <h1 className="text-2xl font-bold text-center text-neutral-900">{room.title}</h1>
        {room.message && (
          <p className="text-center text-sm text-neutral-500 mt-2">{room.message}</p>
        )}
        <p className="text-center text-sm text-neutral-500 mt-1">
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
                  animate={{ width: `${Math.min(100, (raised / goal) * 100)}%` }}
                  transition={{ type: 'spring', stiffness: 60 }}
                />
              </div>
              <p className="mt-2 text-xs opacity-90">
                Зорилго: {formatMNT(goal)} · {Math.round((raised / goal) * 100)}%
              </p>
            </>
          )}
          <div className="mt-4 flex items-center gap-2 text-sm">
            <Users className="w-4 h-4" /> {contribs.length} хүн оролцсон
          </div>
        </motion.div>

        {/* contribution form */}
        <div className="mt-6 bg-white/90 backdrop-blur rounded-3xl border border-neutral-200 shadow p-6">
          <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
            <HeartHandshake className="w-5 h-5" /> Нэмэр оруулах
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
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
            onClick={submit}
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3 font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            {saving ? 'Илгээж байна...' : 'Нэмэр оруулах'}
          </button>
          {justAdded && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 text-sm text-emerald-600 text-center"
            >
              Баярлалаа! Таны нэмэр нэмэгдлээ.
            </motion.p>
          )}
        </div>

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
    </div>
  );
}

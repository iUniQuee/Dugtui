import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet,
  Gift,
  Landmark,
  CheckCircle2,
  Clock,
  Settings2,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { supabase, type Room, type Envelope, type Withdrawal } from '@/lib/supabase';
import type { Profile } from '@/lib/useAuth';
import { Money, Spinner } from '@/components/Shell';
import { themeOf } from '@/lib/utils';
import { notifyAdmin } from '@/lib/push';

function statusLabel(status: Room['status']): string {
  switch (status) {
    case 'active':
      return 'Идэвхтэй';
    case 'PENDING_APPROVAL':
      return 'Төлбөр шалгагдаж байна';
    case 'PAID':
      return 'Төлбөр батлагдсан';
    case 'REJECTED':
      return 'Татгалзсан';
    case 'CLAIMED':
      return 'Хүлээн авсан';
    case 'pending':
      return 'Төлбөр хүлээж байна';
    default:
      return 'Дууссан';
  }
}

export function ProfileScreen({
  profile,
  userId,
  isAdmin,
  onAdmin,
  onOpenRoom,
  onLogout,
}: {
  profile: Profile | null;
  userId: string;
  isAdmin?: boolean;
  onAdmin?: () => void;
  onOpenRoom: (code: string) => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<'wallet' | 'rooms' | 'winnings'>('wallet');
  const [walletTx, setWalletTx] = useState<
    { id: string; amount: number; type: string; status: string; description: string | null; created_at: string }[]
  >([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [winnings, setWinnings] = useState<(Envelope & { room?: Room })[]>([]);
  const [giftCards, setGiftCards] = useState<Room[]>([]);
  const [balance, setBalance] = useState(profile?.balance ?? 0);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [bank, setBank] = useState(profile?.bank_name ?? '');
  const [account, setAccount] = useState(profile?.account_number ?? '');
  const [accountName, setAccountName] = useState(profile?.account_name ?? '');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cashOutBusy, setCashOutBusy] = useState(false);
  const [cashOutNotice, setCashOutNotice] = useState('');

  useEffect(() => {
    const run = async () => {
      const [txRes, roomRes, winRes, wdRes, giftRes, balRes] = await Promise.all([
        supabase
          .from('wallet_transactions')
          .select('id, amount, type, status, description, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.from('rooms').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase
          .from('envelopes')
          .select('*, room:rooms(*)')
          .eq('claimed_by', userId)
          .order('claimed_at', { ascending: false }),
        supabase.from('withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase
          .from('rooms')
          .select('*')
          .eq('type', 'gift_card')
          .eq('claimed_by', userId)
          .order('claimed_at', { ascending: false }),
        supabase.from('profiles').select('balance').eq('id', userId).maybeSingle(),
      ]);
      if (txRes.data) setWalletTx(txRes.data as typeof walletTx);
      if (roomRes.data) setRooms(roomRes.data as Room[]);
      if (winRes.data) setWinnings(winRes.data as (Envelope & { room?: Room })[]);
      if (giftRes.data) setGiftCards(giftRes.data as Room[]);
      if (wdRes.data) setWithdrawals(wdRes.data as Withdrawal[]);
      if (balRes.data && typeof balRes.data.balance === 'number') setBalance(balRes.data.balance);
      setLoading(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const saveBank = async () => {
    await supabase
      .from('profiles')
      .update({ bank_name: bank.trim(), account_number: account.trim(), account_name: accountName.trim() })
      .eq('id', userId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const cashOut = async () => {
    if (!balance || balance <= 0) return;
    setCashOutBusy(true);
    setCashOutNotice('');
    const { error } = await supabase.from('wallet_transactions').insert({
      user_id: userId,
      amount: balance,
      type: 'payout',
      status: 'pending',
      bank_name: bank.trim() || profile?.bank_name,
      account_number: account.trim() || profile?.account_number,
      account_name: accountName.trim() || profile?.account_name,
      description: 'Хэтэвчнээс мөнгө татах хүсэлт',
    });
    setCashOutBusy(false);
    if (error) {
      setCashOutNotice('Хүсэлт илгээж чадсангүй: ' + error.message);
      return;
    }
    // Админы утсанд push мэдэгдэл илгээнэ.
    void notifyAdmin({ kind: 'withdrawal', amount: balance });
    {
      // refresh wallet ledger + balance display happens on next profile load
      const { data } = await supabase
        .from('wallet_transactions')
        .select('id, amount, type, status, description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (data) setWalletTx(data as typeof walletTx);
    }
  };

  if (loading) return <Spinner />;

  const pendingPayout = walletTx.find((t) => t.type === 'payout' && t.status === 'pending');

  return (
    <div className="min-h-screen pb-24">
      <div className="mx-auto max-w-2xl px-4 pt-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">Миний профайл</h1>

        {isAdmin && onAdmin && (
          <button
            onClick={onAdmin}
            className="mt-4 w-full flex items-center justify-between rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 text-left hover:bg-emerald-100 transition-colors"
          >
            <span className="flex items-center gap-2 font-semibold text-emerald-900">
              <ShieldCheck className="w-5 h-5" /> Админ самбар
            </span>
            <ArrowRight className="w-4 h-4 text-emerald-700" />
          </button>
        )}

        {/* balance card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-6 shadow-lg"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-85">Миний хэтэвч</p>
              <Money amount={balance} className="text-4xl font-extrabold" />
            </div>
            <Wallet className="w-10 h-10 opacity-80" />
          </div>
          <button
            onClick={cashOut}
            disabled={!balance || balance <= 0 || !!pendingPayout || cashOutBusy}
            className="mt-5 w-full rounded-xl bg-white/15 backdrop-blur border border-white/30 py-2.5 font-semibold hover:bg-white/25 disabled:opacity-50 transition-colors"
          >
            {pendingPayout
              ? 'Татах хүсэлт хүлээгдэж байна'
              : !balance || balance <= 0
                ? 'Хэтэвч хоосон байна'
                : cashOutBusy
                  ? 'Илгээж байна...'
                  : 'Мөнгө татах хүсэлт илгээх'}
          </button>
          {cashOutNotice && (
            <p className="mt-2 text-xs text-white/90">{cashOutNotice}</p>
          )}
        </motion.div>

        {/* tabs */}
        <div className="mt-6 grid grid-cols-3 gap-2 p-1 bg-neutral-100 rounded-xl">
          {(
            [
              ['wallet', 'Хэтэвч'],
              ['rooms', 'Миний өрөөнүүд'],
              ['winnings', 'Хожсон бэлгүүд'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === id ? 'bg-white shadow text-neutral-900' : 'text-neutral-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'wallet' && (
          <div className="mt-5 space-y-4">
            {/* bank details */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
                <Landmark className="w-5 h-5" /> Дансны мэдээлэл
              </h2>
              <div className="mt-3 grid sm:grid-cols-3 gap-2">
                <input
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  placeholder="Банкны нэр"
                  className="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="Дансны дугаар"
                  className="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
                <input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Дансны эзэмшигч"
                  className="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </div>
              <button
                onClick={saveBank}
                className="mt-3 rounded-xl bg-neutral-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-neutral-700 transition-colors"
              >
                {saved ? 'Хадгалагдлаа' : 'Хадгалах'}
              </button>
            </div>

            {/* ledger */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <h2 className="font-semibold text-neutral-900">Гүйлгээний түүх</h2>
              {walletTx.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-400">Одоогоор гүйлгээ байхгүй.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {walletTx.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-2.5 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {t.status === 'pending' ? (
                          <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        )}
                        <span className="text-neutral-700 truncate">
                          {t.description ??
                            (t.type === 'payout'
                              ? 'Мөнгө татах хүсэлт'
                              : t.type === 'refund'
                                ? 'Буцаан олголт'
                                : 'Хожсон дүн')}
                        </span>
                      </div>
                      <Money
                        amount={t.amount}
                        className={`shrink-0 font-bold ${t.type === 'payout' ? 'text-neutral-500' : 'text-emerald-600'}`}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'rooms' && (
          <div className="mt-5 space-y-3">
            {rooms.length === 0 ? (
              <p className="text-sm text-neutral-400">Та одоогоор өрөө үүсгээгүй байна.</p>
            ) : (
              rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onOpenRoom(r.code)}
                  className="w-full flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-left hover:border-neutral-300 transition-colors"
                >
                  <div>
                    <p className="font-medium text-neutral-900">{r.title}</p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {themeOf(r.theme).label} · {statusLabel(r.status)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Money amount={r.total_amount} className="text-sm font-bold text-neutral-700" />
                    <ArrowRight className="w-4 h-4 text-neutral-400" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'winnings' && (
          <div className="mt-5 space-y-3">
            {giftCards.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-5 py-4"
              >
                <div>
                  <p className="font-medium text-neutral-900 flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-red-500" /> {g.title}
                  </p>
                  {g.claimed_at && (
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {new Date(g.claimed_at).toLocaleDateString('mn-MN')} · Бэлгийн карт
                    </p>
                  )}
                </div>
                <Money amount={g.total_amount} className="font-bold text-emerald-600" />
              </div>
            ))}
            {winnings.length === 0 && giftCards.length === 0 ? (
              <p className="text-sm text-neutral-400">Одоогоор бэлэг хожоогүй байна.</p>
            ) : (
              winnings.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white px-5 py-4"
                >
                  <div>
                    <p className="font-medium text-neutral-900 flex items-center gap-1.5">
                      <Gift className="w-4 h-4 text-red-500" /> {w.room?.title ?? 'Азын дугтуй'}
                    </p>
                    {w.claimed_at && (
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {new Date(w.claimed_at).toLocaleDateString('mn-MN')}
                      </p>
                    )}
                  </div>
                  <Money amount={w.amount} className="font-bold text-emerald-600" />
                </div>
              ))
            )}
          </div>
        )}

        <button
          onClick={onLogout}
          className="mt-8 w-full rounded-xl border border-neutral-300 py-3 font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Гарах
        </button>
      </div>
    </div>
  );
}

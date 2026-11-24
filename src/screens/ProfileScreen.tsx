import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet,
  Gift,
  Landmark,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  X,
} from 'lucide-react';
import { supabase, type Room, type Envelope } from '@/lib/supabase';
import type { Profile } from '@/lib/useAuth';
import { Money, Spinner } from '@/components/Shell';
import {
  themeOf,
  formatMNT,
  MIN_WITHDRAW_BALANCE,
  WITHDRAW_FEE,
} from '@/lib/utils';
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
    case 'CANCELLED':
      return 'Цуцлагдсан';
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
}: {
  profile: Profile | null;
  userId: string;
  isAdmin?: boolean;
  onAdmin?: () => void;
  onOpenRoom: (code: string) => void;
}) {
  const [tab, setTab] = useState<'wallet' | 'rooms' | 'winnings'>('wallet');
  const [walletTx, setWalletTx] = useState<
    { id: string; amount: number; type: string; status: string; description: string | null; created_at: string }[]
  >([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [winnings, setWinnings] = useState<(Envelope & { room?: Room })[]>([]);
  const [giftCards, setGiftCards] = useState<Room[]>([]);
  const [balance, setBalance] = useState(profile?.balance ?? 0);
  const [bank, setBank] = useState(profile?.bank_name ?? '');
  const [account, setAccount] = useState(profile?.account_number ?? '');
  const [accountName, setAccountName] = useState(profile?.account_name ?? '');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cashOutBusy, setCashOutBusy] = useState(false);
  const [cashOutNotice, setCashOutNotice] = useState('');
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState('');
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});
  const [contributionSums, setContributionSums] = useState<Record<string, number>>({});
  const [roomMetaLoaded, setRoomMetaLoaded] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Room | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    const run = async () => {
      const [txRes, roomRes, winRes, giftRes, balRes] = await Promise.all([
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
        supabase
          .from('rooms')
          .select('*')
          .eq('type', 'gift_card')
          .eq('claimed_by', userId)
          .order('claimed_at', { ascending: false }),
        supabase.from('profiles').select('balance').eq('id', userId).maybeSingle(),
      ]);
      if (txRes.data) setWalletTx(txRes.data as typeof walletTx);
      if (roomRes.data) {
        const list = roomRes.data as Room[];
        setRooms(list);
        // Цуцлах боломжийг шалгахын тулд оролцогчдын тоо, батлагдсан нэмрийн
        // нийлбэрийг тусад нь татна (gift_transfers-ыг клиентээс уншихгүй).
        const luckyIds = list
          .filter((r) => r.type === 'lucky_draw' && (r.status === 'active' || r.status === 'PAID'))
          .map((r) => r.id);
        const groupIds = list
          .filter((r) => r.type === 'group_pool' && (r.status === 'active' || r.status === 'PAID'))
          .map((r) => r.id);
        if (luckyIds.length || groupIds.length) {
          const [partRes, contribRes] = await Promise.all([
            supabase
              .from('room_participants')
              .select('room_id')
              .in('room_id', luckyIds.length ? luckyIds : ['00000000-0000-0000-0000-000000000000']),
            supabase
              .from('contributions')
              .select('room_id, amount')
              .in('room_id', groupIds.length ? groupIds : ['00000000-0000-0000-0000-000000000000'])
              .eq('status', 'PAID'),
          ]);
          const pCount: Record<string, number> = {};
          for (const p of (partRes.data ?? []) as { room_id: string }[]) {
            pCount[p.room_id] = (pCount[p.room_id] ?? 0) + 1;
          }
          setParticipantCounts(pCount);
          const cSum: Record<string, number> = {};
          for (const c of (contribRes.data ?? []) as { room_id: string; amount: number }[]) {
            cSum[c.room_id] = (cSum[c.room_id] ?? 0) + Number(c.amount ?? 0);
          }
          setContributionSums(cSum);
        }
      }
      if (winRes.data) setWinnings(winRes.data as (Envelope & { room?: Room })[]);
      if (giftRes.data) setGiftCards(giftRes.data as Room[]);
      if (balRes.data && typeof balRes.data.balance === 'number') setBalance(balRes.data.balance);
      setRoomMetaLoaded(true);
      setLoading(false);
    };
    run();
  }, [userId]);

  const saveBank = async () => {
    await supabase
      .from('profiles')
      .update({ bank_name: bank.trim(), account_number: account.trim(), account_name: accountName.trim() })
      .eq('id', userId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const openCashOut = () => {
    setCashOutNotice('');
    setCashOutAmount('');
    setCashOutOpen(true);
  };

  const cashOut = async () => {
    const amount = Number(cashOutAmount.replace(/\D/g, '')) || 0;
    if (amount < MIN_WITHDRAW_BALANCE) {
      setCashOutNotice(
        `Хамгийн багадаа ${MIN_WITHDRAW_BALANCE.toLocaleString('mn-MN')}₮ татах боломжтой.`
      );
      return;
    }
    if (amount > balance) {
      setCashOutNotice(
        `Үлдэгдэл хүрэлцэхгүй байна. Хамгийн ихдээ ${balance.toLocaleString('mn-MN')}₮ татах боломжтой.`
      );
      return;
    }
    const bankName = bank.trim() || profile?.bank_name || '';
    const bankAccount = account.trim() || profile?.account_number || '';
    const bankOwner = accountName.trim() || profile?.account_name || '';
    if (!bankName || !bankAccount || !bankOwner) {
      setCashOutNotice('Эхлээд дансны мэдээллээ оруулж хадгална уу.');
      return;
    }
    setCashOutBusy(true);
    setCashOutNotice('');
    // Хүсэлт илгээгдэх үед зөвхөн хүссэн дүн хэтэвчнээс хасагдана.
    const { error } = await supabase.rpc('request_withdrawal', {
      p_amount: amount,
      p_bank_name: bankName,
      p_account_number: bankAccount,
      p_account_name: bankOwner,
    });
    if (error) {
      setCashOutBusy(false);
      setCashOutNotice('Хүсэлт илгээж чадсангүй: ' + error.message);
      return;
    }
    // Админы утсанд push мэдэгдэл илгээнэ.
    void notifyAdmin({ kind: 'withdrawal', amount });
    const [balRes, txRes] = await Promise.all([
      supabase.from('profiles').select('balance').eq('id', userId).maybeSingle(),
      supabase
        .from('wallet_transactions')
        .select('id, amount, type, status, description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    if (balRes.data && typeof balRes.data.balance === 'number') setBalance(balRes.data.balance);
    if (txRes.data) setWalletTx(txRes.data as typeof walletTx);
    setCashOutBusy(false);
    setCashOutOpen(false);
    setCashOutAmount('');
    setCashOutNotice(
      `Хүсэлт илгээгдлээ. Банкны шимтгэл ${WITHDRAW_FEE}₮ хасагдаж таны дансанд ${formatMNT(
        amount - WITHDRAW_FEE
      )} шилжинэ.`
    );
  };

  const cancelRoom = async () => {
    const target = cancelTarget;
    if (!target || cancelBusy) return;
    setCancelBusy(true);
    setCancelError('');
    const { data, error } = await supabase.rpc('cancel_room', { p_room_id: target.id });
    if (error) {
      setCancelError(error.message);
      setCancelBusy(false);
      return;
    }
    setRooms((prev) =>
      prev.map((r) => (r.id === target.id ? { ...r, status: 'CANCELLED' as const } : r)),
    );
    const refunded = Number((data as { refunded_total?: number } | null)?.refunded_total ?? 0);
    if (refunded > 0) {
      const [balRes, txRes] = await Promise.all([
        supabase.from('profiles').select('balance').eq('id', userId).maybeSingle(),
        supabase
          .from('wallet_transactions')
          .select('id, amount, type, status, description, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);
      if (balRes.data && typeof balRes.data.balance === 'number') setBalance(balRes.data.balance);
      if (txRes.data) setWalletTx(txRes.data as typeof walletTx);
    }
    setCancelBusy(false);
    setCancelTarget(null);
  };

  if (loading) return <Spinner />;

  const pendingPayout = walletTx.find((t) => t.type === 'payout' && t.status === 'pending');
  const canCashOut = balance >= MIN_WITHDRAW_BALANCE;
  const typedWithdrawAmount = Number(cashOutAmount.replace(/\D/g, '')) || 0;
  const typedNetPayout = Math.max(0, typedWithdrawAmount - WITHDRAW_FEE);

  const canCancel = (r: Room) => {
    if (r.status !== 'active' && r.status !== 'PAID') return false;
    if (r.type === 'group_pool') {
      return !(r.total_amount > 0 && (contributionSums[r.id] ?? 0) >= r.total_amount);
    }
    if (r.type === 'lucky_draw') {
      const required = r.participant_count ?? 0;
      return required <= 0 || (participantCounts[r.id] ?? 0) < required;
    }
    // gift_card
    return !r.claimed_by;
  };

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
            onClick={openCashOut}
            disabled={!canCashOut || !!pendingPayout || cashOutBusy}
            className="mt-5 w-full rounded-xl bg-white/15 backdrop-blur border border-white/30 py-2.5 font-semibold hover:bg-white/25 disabled:opacity-50 transition-colors"
          >
            {pendingPayout
              ? 'Татах хүсэлт хүлээгдэж байна'
              : !canCashOut
                ? `Мөнгө татах (хамгийн багадаа ${MIN_WITHDRAW_BALANCE.toLocaleString('mn-MN')}₮)`
                : cashOutBusy
                  ? 'Илгээж байна...'
                  : 'Мөнгө татах хүсэлт илгээх'}
          </button>
          {cashOutOpen && canCashOut && !pendingPayout && (
            <div className="mt-3 rounded-2xl border border-white/30 bg-white/15 p-4">
              <span className="text-xs text-white/85">Татах дүн (₮)</span>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={cashOutAmount}
                  onChange={(e) => {
                    setCashOutAmount(e.target.value.replace(/\D/g, ''));
                    setCashOutNotice('');
                  }}
                  inputMode="numeric"
                  autoFocus
                  placeholder={MIN_WITHDRAW_BALANCE.toLocaleString('mn-MN')}
                  className="min-w-0 flex-1 rounded-xl border border-white/40 bg-white/95 px-3 py-2.5 font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    setCashOutAmount(String(balance));
                    setCashOutNotice('');
                  }}
                  className="shrink-0 rounded-xl border border-white/40 bg-white/25 px-4 py-2.5 text-sm font-semibold hover:bg-white/35 transition-colors"
                >
                  Бүгдийг
                </button>
              </div>
              {typedWithdrawAmount > 0 ? (
                <p className="mt-2 text-xs text-white/95">
                  Банкны шимтгэл {WITHDRAW_FEE}₮ хасагдаж таны дансанд{' '}
                  <Money amount={typedNetPayout} className="font-semibold" /> шилжинэ.
                </p>
              ) : (
                <p className="mt-2 text-xs text-white/80">
                  Хамгийн багадаа {MIN_WITHDRAW_BALANCE.toLocaleString('mn-MN')}₮, хамгийн
                  ихдээ {balance.toLocaleString('mn-MN')}₮.
                </p>
              )}
              {typedWithdrawAmount > 0 && typedWithdrawAmount < MIN_WITHDRAW_BALANCE && (
                <p className="mt-1 text-xs font-medium text-amber-100">
                  Хамгийн багадаа {MIN_WITHDRAW_BALANCE.toLocaleString('mn-MN')}₮ байх ёстой.
                </p>
              )}
              {typedWithdrawAmount > balance && (
                <p className="mt-1 text-xs font-medium text-amber-100">
                  Хэтэвчний үлдэгдлээс ({balance.toLocaleString('mn-MN')}₮) хэтэрч болохгүй.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={cashOut}
                  disabled={cashOutBusy}
                  className="flex-1 rounded-xl bg-white py-2.5 font-semibold text-emerald-700 hover:bg-white/90 disabled:opacity-50 transition-colors"
                >
                  {cashOutBusy ? 'Илгээж байна...' : 'Хүсэлт илгээх'}
                </button>
                <button
                  onClick={() => {
                    setCashOutOpen(false);
                    setCashOutAmount('');
                    setCashOutNotice('');
                  }}
                  className="rounded-xl border border-white/40 px-4 py-2.5 text-sm font-medium hover:bg-white/10 transition-colors"
                >
                  Болих
                </button>
              </div>
            </div>
          )}
          {!cashOutOpen && canCashOut && (
            <p className="mt-2 text-xs text-white/80">
              Татах дүнгээ өөрөө сонгоно. Хамгийн багадаа{' '}
              {MIN_WITHDRAW_BALANCE.toLocaleString('mn-MN')}₮.
            </p>
          )}
          {!canCashOut && (
            <p className="mt-2 text-xs text-white/80">
              {MIN_WITHDRAW_BALANCE.toLocaleString('mn-MN')}₮-өөс доош үлдэгдлийг дараагийн
              хожлоо нэмэх эсвэл шинэ өрөө үүсгэхэд ашиглаарай.
            </p>
          )}
          {cashOutNotice && (
            <p className="mt-2 text-xs font-medium text-white/95">{cashOutNotice}</p>
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
                      {t.type === 'payout' || t.type === 'payment' ? (
                        <span className="shrink-0 font-bold text-red-600">−{formatMNT(t.amount)}</span>
                      ) : (
                        <span className="shrink-0 font-bold text-emerald-600">+{formatMNT(t.amount)}</span>
                      )}
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
                <div
                  key={r.id}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenRoom(r.code)}
                      className="flex-1 min-w-0 flex items-center justify-between gap-2 rounded-xl px-1 py-1 text-left"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-900 truncate">{r.title}</p>
                        <p className="text-xs text-neutral-400 mt-0.5">
                          {themeOf(r.theme).label} ·{' '}
                          <span className={r.status === 'CANCELLED' ? 'text-red-500 font-medium' : ''}>
                            {statusLabel(r.status)}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Money amount={r.total_amount} className="text-sm font-bold text-neutral-700" />
                        <ArrowRight className="w-4 h-4 text-neutral-400" />
                      </div>
                    </button>
                    {roomMetaLoaded && canCancel(r) && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelError('');
                          setCancelTarget(r);
                        }}
                        className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors"
                      >
                        Өрөөг цуцлах
                      </button>
                    )}
                  </div>
                </div>
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
                <div className="flex flex-col items-end gap-1">
                  <Money amount={g.total_amount} className="font-bold text-emerald-600" />
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <CheckCircle2 className="w-3 h-3" /> Хэтэвчинд орсон ✓
                  </span>
                </div>
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
                  <div className="flex flex-col items-end gap-1">
                    <Money amount={w.amount} className="font-bold text-emerald-600" />
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      <CheckCircle2 className="w-3 h-3" /> Хэтэвчинд орсон ✓
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </div>

      {cancelTarget && (
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
                onClick={() => setCancelTarget(null)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100"
                aria-label="Хаах"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-3 text-sm text-neutral-600">
              «{cancelTarget.title}» өрөө цуцлагдаж, төлсөн/нэмэрлэсэн мөнгө хэтэвчинд 100% буцаж
              орно. Энэ үйлдлийг буцаах боломжгүй.
            </p>
            {cancelError && (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{cancelError}</p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Болих
              </button>
              <button
                type="button"
                onClick={cancelRoom}
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

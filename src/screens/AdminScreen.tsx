import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ShieldCheck, Users, Gift, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Money, Spinner } from '@/components/Shell';
import { FEE_RATE, formatMNT } from '@/lib/utils';

export function AdminScreen() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [payouts, setPayouts] = useState<
    {
      id: string;
      user_id: string;
      amount: number;
      status: string;
      bank_name: string | null;
      account_number: string | null;
      account_name: string | null;
      created_at: string;
      profile?: { display_name: string } | null;
    }[]
  >([]);
  const [stats, setStats] = useState({
    roomCount: 0,
    roomToday: 0,
    giftVolume: 0,
    feeRevenue: 0,
    users: 0,
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const admin = await supabase.rpc('is_admin');
      const adminFlag = admin.data === true;
      setIsAdmin(adminFlag);
      if (!adminFlag) {
        setLoading(false);
        return;
      }

      const [payoutRes, roomsRes, envelopesRes, profilesRes] = await Promise.all([
        supabase
          .from('wallet_transactions')
          .select('*, profile:profiles(display_name)')
          .eq('type', 'payout')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('rooms').select('total_amount, fee_amount, created_at'),
        supabase.from('envelopes').select('amount, claimed'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]);

      if (payoutRes.data) setPayouts(payoutRes.data as typeof payouts);
      if (roomsRes.data) {
        const today = new Date().toDateString();
        const rs = roomsRes.data as RoomStat[];
        setStats((s) => ({
          ...s,
          roomCount: rs.length,
          roomToday: rs.filter((r) => new Date(r.created_at).toDateString() === today).length,
          giftVolume: rs.reduce((sum, r) => sum + (r.total_amount ?? 0), 0),
          feeRevenue: rs.reduce((sum, r) => sum + (r.fee_amount ?? 0), 0),
        }));
      }
      if (envelopesRes.data) {
        const claimed = (envelopesRes.data as { amount: number; claimed: boolean }[]).filter((e) => e.claimed);
        setStats((s) => ({ ...s, giftVolume: s.giftVolume + claimed.reduce((sum, e) => sum + e.amount, 0) }));
      }
      if (typeof profilesRes.count === 'number') setStats((s) => ({ ...s, users: profilesRes.count as number }));
      setLoading(false);
    };
    run();
  }, []);

  const confirmPaid = async (id: string) => {
    setBusyId(id);
    await supabase.from('wallet_transactions').update({ status: 'completed' }).eq('id', id);
    setPayouts((ps) => ps.map((p) => (p.id === id ? { ...p, status: 'completed' } : p)));
    setBusyId(null);
  };

  if (loading) return <Spinner />;
  if (!isAdmin)
    return (
      <div className="max-w-md mx-auto mt-24 text-center rounded-3xl bg-white border border-neutral-200 shadow p-10">
        <ShieldCheck className="w-12 h-12 text-neutral-300 mx-auto" />
        <p className="mt-3 font-semibold text-neutral-900">Зөвхөн админд нээлттэй</p>
        <p className="mt-1 text-sm text-neutral-500">
          Энэ хуудас руу хандах эрх таны бүртгэлд байхгүй байна.
        </p>
      </div>
    );

  return (
    <div className="min-h-screen pb-24">
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" /> Админ самбар
        </h1>

        {/* stats */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<Users className="w-4 h-4" />} label="Бүртгэлтэй хэрэглэгч" value={String(stats.users)} />
          <StatCard icon={<Gift className="w-4 h-4" />} label="Өнөөдрийн өрөө" value={String(stats.roomToday)} />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Нийт гүйлгээ" value={formatMNT(stats.giftVolume)} />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label={`Шимтгэлийн орлого (${(FEE_RATE * 100).toFixed(0)}%)`} value={formatMNT(stats.feeRevenue)} />
        </div>

        {/* payouts */}
        <h2 className="mt-8 font-semibold text-lg text-neutral-900">Мөнгө татах хүсэлтүүд</h2>
        {payouts.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">Одоогоор хүсэлт байхгүй.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {payouts.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-neutral-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-neutral-900">
                    {p.profile?.display_name ?? 'Хэрэглэгч'}
                    <Money amount={p.amount} className="ml-2 text-emerald-600" />
                  </p>
                  <p className="text-sm text-neutral-500 mt-0.5">
                    {p.bank_name ?? '—'} · {p.account_number ?? '—'}
                    {p.account_name ? ` · ${p.account_name}` : ''}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {new Date(p.created_at).toLocaleString('mn-MN')}
                  </p>
                </div>
                {p.status === 'pending' ? (
                  <button
                    onClick={() => confirmPaid(p.id)}
                    disabled={busyId === p.id}
                    className="shrink-0 rounded-xl bg-emerald-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {busyId === p.id ? <Clock className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Шилжүүлсэн
                  </button>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-3 py-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Шилжсэн
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface RoomStat {
  total_amount: number;
  fee_amount: number;
  created_at: string;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
        {icon} {label}
      </p>
      <p className="mt-1.5 font-bold text-neutral-900 text-lg leading-tight">{value}</p>
    </div>
  );
}

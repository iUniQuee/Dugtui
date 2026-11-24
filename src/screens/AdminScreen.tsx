import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Gift,
  ImagePlus,
  Landmark,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle,
} from 'lucide-react';
import { supabase, type Room } from '@/lib/supabase';
import { Money, Spinner } from '@/components/Shell';
import { FEE_RATE, formatMNT } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { DEFAULT_BANK_SETTINGS, loadBankSettings, saveBankSettings } from '@/lib/payments';
import { enableAdminPush, pushPermission } from '@/lib/push';

interface PayoutRow {
  id: string;
  user_id: string;
  amount: number;
  status: string;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  created_at: string;
  profile?: { display_name: string } | null;
}

type Tab = 'income' | 'withdrawals';

export function AdminScreen() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>('income');

  const [pendingRooms, setPendingRooms] = useState<Room[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [stats, setStats] = useState({
    roomCount: 0,
    roomToday: 0,
    giftVolume: 0,
    feeRevenue: 0,
    users: 0,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const [bank, setBank] = useState(DEFAULT_BANK_SETTINGS);
  const [savingBank, setSavingBank] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  const [isAdminError, setIsAdminError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  const loadAdminData = useCallback(async () => {
    const [pendingRes, payoutRes, roomsRes, profilesRes] = await Promise.all([
      supabase
        .from('rooms')
        .select('*')
        .eq('status', 'PENDING_APPROVAL')
        .order('created_at', { ascending: false }),
      supabase
        .from('wallet_transactions')
        .select('*, profile:profiles(display_name)')
        .eq('type', 'payout')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('rooms').select('total_amount, fee_amount, created_at, status'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);

    if (pendingRes.data) setPendingRooms(pendingRes.data as Room[]);
    if (payoutRes.data) setPayouts(payoutRes.data as PayoutRow[]);
    if (roomsRes.data) {
      const today = new Date().toDateString();
      const rs = roomsRes.data as { total_amount: number; fee_amount: number; created_at: string; status: string }[];
      const paid = rs.filter((r) => ['PAID', 'CLAIMED', 'active'].includes(r.status));
      setStats((s) => ({
        ...s,
        roomCount: rs.length,
        roomToday: rs.filter((r) => new Date(r.created_at).toDateString() === today).length,
        giftVolume: paid.reduce((sum, r) => sum + (r.total_amount ?? 0), 0),
        feeRevenue: paid.reduce((sum, r) => sum + (r.fee_amount ?? 0), 0),
      }));
    }
    if (typeof profilesRes.count === 'number') {
      setStats((s) => ({ ...s, users: profilesRes.count as number }));
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      const admin = await supabase.rpc('is_admin');
      // Функц/эрх дутуу бол (SQL ажиллаагүй) алдааг нь харуулна.
      if (admin.error) setIsAdminError(admin.error.message);
      const adminFlag = admin.data === true;
      setIsAdmin(adminFlag);
      if (!adminFlag) {
        setLoading(false);
        return;
      }
      await loadAdminData();
      setBank(await loadBankSettings());
      setPushMessage(
        pushPermission() === 'granted'
          ? 'Мэдэгдлийн зөвшөөрөл нээлттэй байна.'
          : ''
      );
      setLoading(false);
    };
    void run();
  }, [loadAdminData]);

  const reviewRoom = async (roomId: string, approve: boolean) => {
    setBusyId(roomId);
    setNotice('');
    const { error } = await supabase.rpc('admin_review_room', {
      p_room_id: roomId,
      p_approve: approve,
    });
    setBusyId(null);
    if (error) {
      setNotice(error.message);
      return;
    }
    setPendingRooms((rooms) => rooms.filter((r) => r.id !== roomId));
    setNotice(approve ? 'Төлбөр батлагдлаа. Бэлэг идэвхжлээ.' : 'Төлбөр татгалзагдлаа.');
    void loadAdminData();
  };

  const confirmPayout = async (txId: string) => {
    setBusyId(txId);
    setNotice('');
    const { error } = await supabase.rpc('admin_complete_payout', { p_tx_id: txId });
    setBusyId(null);
    if (error) {
      setNotice(error.message);
      return;
    }
    setPayouts((rows) => rows.map((r) => (r.id === txId ? { ...r, status: 'completed' } : r)));
    setNotice('Шилжүүлэг батлагдаж, хэтэвчнээс хасагдлаа.');
  };

  const enablePush = async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      setPushMessage(await enableAdminPush());
    } catch (e) {
      setPushMessage(e instanceof Error ? e.message : 'Мэдэгдэл тохируулж чадсангүй.');
    } finally {
      setPushBusy(false);
    }
  };

  const saveSettings = async () => {
    setSavingBank(true);
    setSettingsMessage('');
    try {
      setSettingsMessage(await saveBankSettings(bank));
    } catch (e) {
      setSettingsMessage(e instanceof Error ? e.message : 'Хадгалж чадсангүй.');
    } finally {
      setSavingBank(false);
    }
  };

  const uploadQr = async (file?: File) => {
    if (!file || !session) return;
    setUploadingQr(true);
    setSettingsMessage('');
    const ext = file.name.split('.').pop() ?? 'png';
    const path = `${session.user.id}/bank-qr-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('gift-images')
      .upload(path, file, { upsert: true, cacheControl: '3600' });
    if (error) {
      setSettingsMessage('QR зураг хуулж чадсангүй: ' + error.message);
      setUploadingQr(false);
      return;
    }
    const { data } = supabase.storage.from('gift-images').getPublicUrl(path);
    setBank((b) => ({ ...b, qr_url: data.publicUrl }));
    setUploadingQr(false);
    setSettingsMessage('QR зураг хуулагдлаа. «Хадгалах» дарж бэхжүүлнэ үү.');
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
        {isAdminError ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-900">
            <p className="font-semibold">Supabase функц ажиллахгүй байна:</p>
            <p className="mt-1 break-words font-mono">{isAdminError}</p>
            <p className="mt-2">
              <b>supabase/ALL_IN_ONE_SETUP.sql</b> файлыг Supabase → SQL Editor дээр ажиллуулна уу.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-neutral-400">
            Админ эрх авахын тулд <b>supabase/ALL_IN_ONE_SETUP.sql</b> файлын
            «АЛХАМ 2» хэсгийн SQL-д өөрийн email-ээ оруулаад ажиллуулна уу.
          </p>
        )}
      </div>
    );

  return (
    <div className="min-h-screen pb-24">
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" /> Админ самбар
        </h1>

        {/* Данс ба QR тохиргоо — самбар нээгдэхэд хамгийн эхэнд харагдана */}
        {/* bank settings */}
          <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
                <Landmark className="w-5 h-5" /> Хүлээн авах данс ба QR
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                Төлбөрийн цонх дээр эдгээр мэдээлэл харагдана.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="text-xs text-neutral-500">Банк</span>
                <input
                  value={bank.bank_name}
                  onChange={(e) => setBank({ ...bank, bank_name: e.target.value })}
                  placeholder="Богд банк"
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-500">Дансны дугаар</span>
                <input
                  value={bank.account_number}
                  onChange={(e) => setBank({ ...bank, account_number: e.target.value })}
                  placeholder="5000 1234 5678"
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-500">Хүлээн авагчийн нэр</span>
                <input
                  value={bank.account_name}
                  onChange={(e) => setBank({ ...bank, account_name: e.target.value })}
                  placeholder="Овог Нэр"
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <div className="rounded-2xl border border-neutral-200 p-2 bg-white">
                <img
                  src={bank.qr_url || DEFAULT_BANK_SETTINGS.qr_url}
                  alt="Богд банкны QR"
                  className="w-40 h-40 object-contain"
                />
              </div>
              <div className="flex-1 space-y-2">
                <label className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 cursor-pointer hover:bg-neutral-50">
                  <ImagePlus className="w-4 h-4" />
                  {uploadingQr ? 'Хуулж байна...' : 'QR зураг солих'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void uploadQr(e.target.files?.[0])}
                  />
                </label>
                <input
                  value={bank.qr_url}
                  onChange={(e) => setBank({ ...bank, qr_url: e.target.value })}
                  placeholder="/qr.png эсвэл https://..."
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-xs text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
                <p className="text-xs text-neutral-400">
                  Зургийг хуулсны дараа «Хадгалах» дарна уу. Хоосон бол /qr.png ашиглана.
                </p>
              </div>
            </div>

            {settingsMessage && (
              <p className="text-sm text-neutral-700">{settingsMessage}</p>
            )}

            <button
              onClick={() => void saveSettings()}
              disabled={savingBank}
              className="rounded-xl bg-neutral-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {savingBank ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Хадгалах
            </button>
          </div>

        {/* push notification */}
        <div className="mt-5 rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="font-semibold text-neutral-900 flex items-center gap-2">
                <BellRing className="w-5 h-5 text-amber-500" /> Утасны мэдэгдэл
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                Төлбөр шилжүүлэг, мөнгө татах хүсэлт ирэхэд энэ төхөөрөмж рүү шууд мэдэгдэл
                ирнэ.
              </p>
              {pushMessage && (
                <p className="mt-1 text-xs text-neutral-600">{pushMessage}</p>
              )}
            </div>
            <button
              onClick={() => void enablePush()}
              disabled={pushBusy}
              className="shrink-0 rounded-xl bg-neutral-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {pushBusy ? <Clock className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
              Мэдэгдэл зөвшөөрөх
            </button>
          </div>
        </div>

        {/* stats */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={<Users className="w-4 h-4" />} label="Бүртгэлтэй хэрэглэгч" value={String(stats.users)} />
          <StatCard icon={<Gift className="w-4 h-4" />} label="Өнөөдрийн өрөө" value={String(stats.roomToday)} />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label="Батлагдсан гүйлгээ" value={formatMNT(stats.giftVolume)} />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label={`Шимтгэл (${(FEE_RATE * 100).toFixed(0)}%)`} value={formatMNT(stats.feeRevenue)} />
        </div>

        {/* tabs */}
        <div className="mt-6 grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-xl">
          {(
            [
              ['income', 'Орлогын баталгаажуулалт'],
              ['withdrawals', 'Мөнгө татах хүсэлтүүд'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-lg py-2 text-xs sm:text-sm font-medium transition-colors ${
                tab === id ? 'bg-white shadow text-neutral-900' : 'text-neutral-500'
              }`}
            >
              {label}
              {id === 'income' && pendingRooms.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] px-1.5">
                  {pendingRooms.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {notice && (
          <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
            {notice}
          </p>
        )}

        {/* income */}
        {tab === 'income' && (
          <div className="mt-4 space-y-3">
            {pendingRooms.length === 0 ? (
              <p className="text-sm text-neutral-400">Баталгаажуулах хүсэлт байхгүй.</p>
            ) : (
              pendingRooms.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-neutral-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-neutral-900">
                      {r.title}
                      <Money
                        amount={(r.total_amount ?? 0) + (r.fee_amount ?? 0)}
                        className="ml-2 text-emerald-600"
                      />
                    </p>
                    <p className="text-sm text-neutral-600 mt-0.5">
                      Гүйлгээний утга:{' '}
                      <span className="font-mono font-bold tracking-widest text-neutral-900">
                        {r.payment_code ?? '—'}
                      </span>
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      {r.organizer_name ? `${r.organizer_name} · ` : ''}
                      {new Date(r.created_at).toLocaleString('mn-MN')}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => void reviewRoom(r.id, true)}
                      disabled={busyId === r.id}
                      className="rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                      {busyId === r.id ? (
                        <Clock className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Батлах
                    </button>
                    <button
                      onClick={() => void reviewRoom(r.id, false)}
                      disabled={busyId === r.id}
                      className="rounded-xl border border-red-200 text-red-600 px-4 py-2.5 text-sm font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                      <XCircle className="w-4 h-4" /> Татгалзах
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* withdrawals */}
        {tab === 'withdrawals' && (
          <div className="mt-4 space-y-3">
            {payouts.length === 0 ? (
              <p className="text-sm text-neutral-400">Одоогоор хүсэлт байхгүй.</p>
            ) : (
              payouts.map((p) => (
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
                      onClick={() => void confirmPayout(p.id)}
                      disabled={busyId === p.id}
                      className="shrink-0 rounded-xl bg-emerald-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                      {busyId === p.id ? (
                        <Clock className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Шилжүүлсэн / Батлах
                    </button>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-3 py-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Шилжсэн
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
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

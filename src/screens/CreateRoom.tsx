import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, CreditCard, QrCode as QrCodeIcon, Copy, PartyPopper, Sparkles, ImagePlus as ImageIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase, type Room } from '@/lib/supabase';
import { GiftBg, Money } from '@/components/Shell';
import { FEE_RATE, THEMES, generateRoomCode, splitAmount, themeOf } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';

type Mode = 'lucky_draw' | 'group_pool' | 'gift_card';

const MODE_LABELS: Record<Mode, string> = {
  lucky_draw: 'Азын дугтуй',
  group_pool: 'Хамтын бэлэг',
  gift_card: 'Мэндчилгээт бэлэг',
};

export function CreateRoom({ onHome, initialMode, onNeedAuth }: { onHome: () => void; initialMode?: Mode; onNeedAuth?: () => void }) {
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode ?? 'lucky_draw');
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState<Room['theme']>('shine_jil');
  const [organizerName, setOrganizerName] = useState('');
  const [message, setMessage] = useState('');
  const [total, setTotal] = useState('200000');
  const [people, setPeople] = useState('10');
  const [splitMode, setSplitMode] = useState<'equal' | 'random'>('random');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [messageTouched, setMessageTouched] = useState(false);

  const [showPay, setShowPay] = useState(false);
  const [paying, setPaying] = useState(false);
  const [created, setCreated] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const totalNum = parseInt(total.replace(/\D/g, ''), 10) || 0;
  const peopleNum = parseInt(people, 10) || 0;
  const isFree = mode === 'group_pool'; // group gifts collect from members instead
  const fee = isFree ? 0 : Math.ceil(totalNum * FEE_RATE);
  const grand = totalNum + fee;
  const activeTheme = themeOf(theme);
  const shareUrl = created ? `${window.location.origin}/?room=${created.code}` : '';

  const openPay = () => {
    if (!session) {
      onNeedAuth?.();
      return;
    }
    if (!title.trim()) return setError('Үйл явдлын нэрээ оруулна уу.');
    if (totalNum <= 0) return setError('Зөв мөнгөн дүн оруулна уу.');
    if (mode === 'lucky_draw' && peopleNum <= 0) return setError('Оролцогчдын тоог оруулна уу.');
    setError('');
    if (isFree) {
      onQrPaid();
      return;
    }
    setShowPay(true);
  };

  const onQrPaid = async () => {
    if (!session) return;
    setPaying(true);
    // QPay simulator: in production this is a webhook confirmation
    await new Promise((r) => setTimeout(r, 1600));
    const code = generateRoomCode();
    const { data, error: err } = await supabase
      .from('rooms')
      .insert({
        code,
        type: mode,
        title: title.trim(),
        theme,
        total_amount: totalNum,
        fee_amount: fee,
        participant_count: mode === 'lucky_draw' ? peopleNum : null,
        mode: mode === 'lucky_draw' ? splitMode : null,
        status: 'active',
        user_id: session.user.id,
        expires_at: mode === 'lucky_draw' ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() : null,
        organizer_name: organizerName.trim() || null,
        message: message.trim() || null,
        image_url: imageUrl.trim() || null,
      })
      .select()
      .single();
    if (err || !data) {
      setPaying(false);
      setError('Өрөө үүсгэхэд алдаа гарлаа. Дахин оролдоорэй.');
      setShowPay(false);
      return;
    }
    const room = data as Room;
    if (mode === 'lucky_draw') {
      const amounts = splitAmount(totalNum, peopleNum, splitMode);
      await supabase.from('envelopes').insert(amounts.map((a) => ({ room_id: room.id, amount: a })));
    }
    setPaying(false);
    setCreated(room);
    setShowPay(false);
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const uploadImage = async (file?: File) => {
    if (!file || !session) return;
    setUploading(true);
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${session.user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('gift-images').upload(path, file);
    if (!upErr) {
      const { data } = supabase.storage.from('gift-images').getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } else {
      setError('Зураг хуулахад алдаа гарлаа.');
    }
    setUploading(false);
  };

  // ------- success screen -------
  if (created) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={created.theme} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md text-center"
        >
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}>
            <PartyPopper className="w-16 h-16 text-emerald-500 mx-auto" />
          </motion.div>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900">Таны өрөө бэлэн боллоо!</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Энэ линк, QR кодыг оролцогчдодоо илгээнэ үү.
          </p>

          <div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-6 shadow-lg text-left">
            <div>
              <p className="text-xs text-neutral-500">Өрөөний код</p>
              <p className="text-2xl font-mono font-bold tracking-widest text-neutral-900">
                {created.code}
              </p>
            </div>
            <div className="mt-4">
              <p className="text-xs text-neutral-500">Хуваалцах линк</p>
              <p className="mt-1 text-sm text-neutral-800 break-all bg-neutral-50 rounded-lg px-3 py-2">
                {shareUrl}
              </p>
            </div>
            <div className="mt-4 flex justify-center rounded-2xl border-4 border-neutral-900 p-4 w-fit mx-auto bg-white">
              <QRCodeSVG value={shareUrl} size={180} />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={copyLink}
                className="flex-1 rounded-xl bg-neutral-900 text-white px-4 py-2.5 font-medium hover:bg-neutral-700 transition-colors flex items-center justify-center gap-2"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Хуулагдлаа' : 'Линк хуулах'}
              </button>
            </div>
          </div>

          <button
            onClick={() => (window.location.href = `/?room=${created.code}`)}
            className="mt-6 w-full max-w-md rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3.5 font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> Өрөөндөө орох
          </button>
        </motion.div>
      </div>
    );
  }

  // ------- form -------
  return (
    <div className="min-h-screen pb-24">
      <GiftBg theme={theme} />
      <div className="mx-auto max-w-lg px-4 pt-8">
        <button
          onClick={onHome}
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800"
        >
          <ArrowLeft className="w-4 h-4" /> Нүүр хуудасруу буцах
        </button>

        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-neutral-900">
          Өрөө үүсгэх
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Мэдээнүүдээ бөглөөд QPay-аар төлбөр төлснөөр линк үүснэ.
        </p>

        <div className="mt-6 space-y-5">
          {/* event title */}
          <label className="block">
            <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Үйл явдлын нэр</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Жишээ нь: "Манай ангийн Шинэ жил"'
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </label>

          {/* gift mode */}
          <div>
            <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Бэлгийн төрөл</span>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-xl border-2 px-2 py-3 text-sm font-medium transition-all ${
                    mode === m
                      ? 'border-red-500 bg-red-50 text-neutral-900'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                  }`}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* theme */}
          <div>
            <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Загвар</span>
            <div className="grid grid-cols-4 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTheme(t.id);
                    if (!messageTouched) setMessage(t.greeting);
                  }}
                  className={`rounded-xl border-2 px-1 py-3 text-center transition-all ${
                    theme === t.id
                      ? `border-red-500 bg-gradient-to-br ${t.gradient} text-white shadow`
                      : 'border-neutral-200 bg-white hover:border-neutral-300'
                  }`}
                >
                  <div className="text-2xl">{t.emojiHint}</div>
                  <div className={`mt-1 text-xs font-medium ${theme === t.id ? 'text-white' : 'text-neutral-700'}`}>
                    {t.label}
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Загвар сонгоход дэвсгэр, анимац, мэндчилгээ автоматаар өөрчлөгдөнө.
            </p>
          </div>

          {/* amount + participants */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-neutral-700 mb-1.5 block">
                {mode === 'group_pool' ? 'Зорилтот дүн (MNT)' : 'Нийт дүн (MNT)'}
              </span>
              <input
                value={total}
                onChange={(e) => setTotal(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="200000"
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </label>
            {mode === 'lucky_draw' ? (
              <label className="block">
                <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Оролцогчдын тоо</span>
                <input
                  value={people}
                  onChange={(e) => setPeople(e.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                  placeholder="10"
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </label>
            ) : (
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3 flex items-center text-sm text-neutral-500">
                {mode === 'gift_card' ? 'Ганц хүнд зориулсан бэлэг' : 'Олон хүн нэмэр оруулна'}
              </div>
            )}
          </div>

          {/* distribution type (lucky draw only) */}
          {mode === 'lucky_draw' && (
            <div>
              <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Хуваарилалтын төрөл</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSplitMode('random')}
                  className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition-all ${
                    splitMode === 'random'
                      ? 'border-red-500 bg-red-50 text-neutral-900'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  }`}
                >
                  Санамсаргүй хуваах
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode('equal')}
                  className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition-all ${
                    splitMode === 'equal'
                      ? 'border-red-500 bg-red-50 text-neutral-900'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  }`}
                >
                  Тэнцүү хуваах
                </button>
              </div>
              {totalNum > 0 && peopleNum > 0 && splitMode === 'equal' && (
                <p className="mt-2 text-sm text-neutral-500">
                  Хүн бүрд <Money amount={Math.floor(totalNum / peopleNum)} className="font-semibold" /> хүртэнэ.
                </p>
              )}
            </div>
          )}

          {/* extras */}
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-neutral-700 mb-1.5 block">
                Таны нэр <span className="font-normal text-neutral-400">(сонголттой)</span>
              </span>
              <input
                value={organizerName}
                onChange={(e) => setOrganizerName(e.target.value)}
                placeholder="Зохион байгуулагчийн нэр"
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-neutral-700 mb-1.5 block">
                Мэндчилгээ <span className="font-normal text-neutral-400">(сонголттой)</span>
              </span>
              <textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setMessageTouched(true);
                }}
                rows={2}
                placeholder="Баяр хүргэе!"
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
              {!messageTouched && (
                <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Загвар сонгоход тохирох мэндчилгээ автоматаар бичигдэнэ.
                </p>
              )}
            </label>
            {mode === 'gift_card' && (
              <div>
                <span className="text-sm font-medium text-neutral-700 mb-1.5 block">
                  Бэлгийн зураг <span className="font-normal text-neutral-400">(сонголттой)</span>
                </span>
                {imageUrl ? (
                  <div className="relative rounded-xl overflow-hidden border border-neutral-200">
                    <img src={imageUrl} alt="Бэлэг" className="w-full h-40 object-cover" />
                    <button
                      type="button"
                      onClick={() => setImageUrl('')}
                      className="absolute top-2 right-2 rounded-full bg-black/60 text-white text-xs px-2.5 py-1"
                    >
                      Арилгах
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 bg-white py-8 cursor-pointer hover:border-neutral-400 transition-colors">
                    <ImageIcon className="w-6 h-6 text-neutral-400" />
                    <span className="text-sm text-neutral-600">Зураг оруулах</span>
                    <span className="text-xs text-neutral-400">Утаснаасаа шууд сонгоорой</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => uploadImage(e.target.files?.[0])}
                    />
                    {uploading && <span className="text-xs text-neutral-500">Хуулж байна...</span>}
                  </label>
                )}
              </div>
            )}
          </div>

          {/* fee summary */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-2">
            {isFree ? (
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">Зорилтот дүн</span>
                <Money amount={totalNum} className="font-medium text-neutral-900" />
              </div>
            ) : (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Бэлгийн дүн</span>
                  <Money amount={totalNum} className="font-medium text-neutral-900" />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Үйлчилгээний шимтгэл ({(FEE_RATE * 100).toFixed(0)}%)</span>
                  <Money amount={fee} className="font-medium text-neutral-900" />
                </div>
              </>
            )}
            <div className="border-t border-neutral-100 pt-2 flex justify-between font-bold">
              <span className="text-neutral-900">{isFree ? 'Өрөө үүсгэх' : 'Нийт төлөх'}</span>
              <Money amount={grand} className={isFree ? 'text-emerald-600' : 'text-red-600'} />
            </div>
            {isFree && (
              <p className="text-xs text-neutral-400 pt-1">
                Хамтын бэлэг тул өрөө үнэгүй үүснэ. Оролцогчид өөрсдөө мөнгөө шилжүүлж зорилтот дүнг бүрдүүлнэ.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={openPay}
            className="w-full rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3.5 font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <CreditCard className="w-4 h-4" />
            {!session
              ? 'Нэвтрээд өрөө үүсгэх'
              : isFree
                ? 'Үнэгүй үүсгэх'
                : 'QPay Төлбөр төлөх'}
          </button>
        </div>
      </div>

      {/* QPay simulated modal */}
      {showPay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center">
            <h3 className="font-semibold text-lg text-neutral-900">QPay Төлбөр төлөх</h3>
            <p className="mt-1 text-sm text-neutral-500">
              QR кодыг банкны апп-аараа уншуулж {formatGrand(grand)} төлнө үү.
            </p>
            <div className="mt-6 mx-auto w-fit rounded-2xl border-4 border-neutral-900 p-4 bg-white">
              <QRCodeSVG value={`qpay://order/${title.trim() || 'order'}`} size={200} />
            </div>
            <button
              onClick={onQrPaid}
              disabled={paying}
              className="mt-6 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {paying ? 'Баталгаажуулж байна...' : 'Төлбөр төлсөн'}
            </button>
            <button
              onClick={() => setShowPay(false)}
              className="mt-3 w-full rounded-xl border border-neutral-300 py-3 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Цуцлах
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatGrand(n: number): string {
  return new Intl.NumberFormat('mn-MN').format(n) + '₮';
}

import { useState } from 'react';
import { ArrowLeft, CreditCard, ImagePlus as ImageIcon, Sparkles } from 'lucide-react';
import { supabase, type Room } from '@/lib/supabase';
import { GiftBg, Money } from '@/components/Shell';
import { QpayModal } from '@/components/QpayModal';
import { CreateRoomSuccess } from '@/screens/CreateRoomSuccess';
import { CreateRoomModeTheme, MODE_LABELS, type Mode } from '@/screens/CreateRoomModeTheme';
import { CreateRoomFeeSummary } from '@/screens/CreateRoomFeeSummary';
import { CreateRoomAmounts } from '@/screens/CreateRoomAmounts';
import { FEE_RATE, generateRoomCode, splitAmount, themeOf } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';

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
    // Төлбөр баталгаажсаны дараа л өрөө идэвхжинэ (QPay check / simulate).
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
      <CreateRoomSuccess room={created} shareUrl={shareUrl} copied={copied} onCopy={copyLink} />
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

          <CreateRoomModeTheme
            mode={mode}
            onMode={setMode}
            theme={theme}
            onTheme={setTheme}
            messageTouched={messageTouched}
            onGreeting={setMessage}
          />

          <CreateRoomAmounts
            mode={mode}
            total={total}
            onTotal={setTotal}
            people={people}
            onPeople={setPeople}
            splitMode={splitMode}
            onSplitMode={setSplitMode}
            totalNum={totalNum}
            peopleNum={peopleNum}
          />

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

          <CreateRoomFeeSummary isFree={isFree} totalNum={totalNum} fee={fee} grand={grand} />

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

      {/* QPay төлбөрийн цонх: QR, банкны deeplink, төлбөр шалгах, simulate */}
      {showPay && (
        <QpayModal
          amount={grand}
          title={title.trim()}
          onPaid={() => void onQrPaid()}
          onClose={() => setShowPay(false)}
        />
      )}
    </div>
  );
}

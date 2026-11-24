import { useState } from 'react';
import { ArrowLeft, CreditCard, ImagePlus as ImageIcon, Sparkles, Wallet } from 'lucide-react';
import { supabase, type Room } from '@/lib/supabase';
import { GiftBg, Money } from '@/components/Shell';
import { BankTransferModal } from '@/components/BankTransferModal';
import { generatePaymentCode } from '@/lib/payments';
import { notifyAdmin } from '@/lib/push';
import { CreateRoomSuccess } from '@/screens/CreateRoomSuccess';
import { CreateRoomModeTheme, MODE_LABELS, type Mode } from '@/screens/CreateRoomModeTheme';
import { CreateRoomFeeSummary } from '@/screens/CreateRoomFeeSummary';
import { CreateRoomAmounts } from '@/screens/CreateRoomAmounts';
import { FEE_RATE, generateRoomCode, splitAmount, themeOf } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';

export function CreateRoom({ onHome, initialMode, onNeedAuth }: { onHome: () => void; initialMode?: Mode; onNeedAuth?: () => void }) {
  const { session, profile } = useAuth();
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
  const [payWithWallet, setPayWithWallet] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [paymentCode, setPaymentCode] = useState('');
  const [paying, setPaying] = useState(false);
  const [created, setCreated] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const totalNum = parseInt(total.replace(/\D/g, ''), 10) || 0;
  const peopleNum = parseInt(people, 10) || 0;
  const isFree = mode === 'group_pool'; // group gifts collect from members instead
  const fee = isFree ? 0 : Math.ceil(totalNum * FEE_RATE);
  const grand = totalNum + fee;
  const walletBalance = profile?.balance ?? 0;
  const walletEnough = walletBalance >= grand;
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
    // Өрөөний код болон гүйлгээний утга (6 орон) урьдчилан үүснэ.
    setRoomCode((prev) => prev || generateRoomCode());
    setPaymentCode((prev) => prev || generatePaymentCode());
    if (isFree) {
      void submitRoom();
      return;
    }
    if (payWithWallet) {
      if (!walletEnough) {
        setError('Хэтэвчний үлдэгдэл хүрэлцэхгүй байна.');
        return;
      }
      void submitRoomFromWallet();
      return;
    }
    setShowPay(true);
  };

  // Хэтэвчний үлдэгдлээр шууд төлж өрөө үүсгэх (QR/шилжүүлэггүй).
  const submitRoomFromWallet = async () => {
    if (!session) return;
    setPaying(true);
    setError('');
    const amounts = mode === 'lucky_draw' ? splitAmount(totalNum, peopleNum, splitMode) : [];
    const expiresAt =
      mode === 'lucky_draw' ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() : null;

    let room: Room | null = null;
    let failure = 'Хэтэвчээр төлөхөд алдаа гарлаа. Дахин оролдоорой.';
    for (let attempt = 0; attempt < 3 && !room; attempt += 1) {
      const code =
        attempt === 0 ? roomCode || generateRoomCode() : generateRoomCode();
      const { data, error: err } = await supabase.rpc('create_room_from_wallet', {
        p_code: code,
        p_type: mode,
        p_title: title.trim(),
        p_theme: theme,
        p_total_amount: totalNum,
        p_fee_amount: fee,
        p_participant_count: mode === 'lucky_draw' ? peopleNum : null,
        p_mode: mode === 'lucky_draw' ? splitMode : null,
        p_organizer_name: organizerName.trim() || null,
        p_message: message.trim() || null,
        p_image_url: imageUrl.trim() || null,
        p_expires_at: expiresAt,
        p_envelope_amounts: amounts,
      });
      if (data) room = data as Room;
      else if (err?.code !== '23505') failure = `Алдаа: ${err?.message ?? 'тодорхойгүй'}`;
    }

    setPaying(false);
    if (!room) {
      setError(failure);
      return;
    }
    setCreated(room);
  };

  const submitRoom = async (codeArg?: string) => {
    if (!session) return;
    setPaying(true);
    setError('');

    // Код давхцвал (unique constraint) шинэ кодоор дахин оролдоно.
    let room: Room | null = null;
    let failure = 'Өрөө үүсгэхэд алдаа гарлаа. Дахин оролдоорой.';
    for (let attempt = 0; attempt < 3 && !room; attempt += 1) {
      const code =
        attempt === 0 ? codeArg || roomCode || generateRoomCode() : generateRoomCode();
      const pcode =
        attempt === 0 ? paymentCode || generatePaymentCode() : generatePaymentCode();
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
          // Админ шилжүүлгийг шалгаж батлах хүртэл PENDING_APPROVAL.
          status: isFree ? 'active' : 'PENDING_APPROVAL',
          payment_code: isFree ? null : pcode,
          user_id: session.user.id,
          expires_at:
            mode === 'lucky_draw'
              ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
              : null,
          organizer_name: organizerName.trim() || null,
          message: message.trim() || null,
          image_url: imageUrl.trim() || null,
        })
        .select()
        .single();
      if (data) room = data as Room;
      else if (err?.code !== '23505') failure = `Алдаа: ${err?.message ?? 'тодорхойгүй'}`;
    }

    if (!room) {
      setPaying(false);
      setError(failure);
      return;
    }

    if (mode === 'lucky_draw') {
      const amounts = splitAmount(totalNum, peopleNum, splitMode);
      await supabase.from('envelopes').insert(amounts.map((a) => ({ room_id: room.id, amount: a })));
    }

    // Админы утас руу шууд push мэдэгдэл.
    if (!isFree) void notifyAdmin({ kind: 'payment', roomId: room.id });

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
          Мэдээнүүдээ бөглөөд Богд банкны QR-аар төлбөр шилжүүлсний дараа линк үүснэ.
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

          {session && !isFree && (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <p className="text-sm font-medium text-neutral-700">Төлбөрийн хэрэгсэл</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayWithWallet(false)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    !payWithWallet
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  Банкны QR
                </button>
                <button
                  type="button"
                  onClick={() => setPayWithWallet(true)}
                  disabled={!walletEnough}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    payWithWallet
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  <Wallet className="w-4 h-4" /> Хэтэвч ({walletBalance.toLocaleString('mn-MN')}₮)
                </button>
              </div>
              {!walletEnough && (
                <p className="mt-2 text-xs text-neutral-400">
                  Хэтэвчний үлдэгдэл {grand.toLocaleString('mn-MN')}₮-өөс бага тул QR-аар төлнө үү.
                </p>
              )}
            </div>
          )}

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
                : payWithWallet
                  ? `Хэтэвчээр төлөх (${grand.toLocaleString('mn-MN')}₮)`
                  : 'Банкны QR-аар төлөх'}
          </button>
        </div>
      </div>

      {/* Богд банкны QR + дансны мэдээлэл + 6 оронтой гүйлгээний утга */}
      {showPay && (
        <BankTransferModal
          amount={grand}
          title={title.trim()}
          paymentCode={paymentCode}
          busy={paying}
          error={error}
          onSubmitted={() => void submitRoom()}
          onClose={() => setShowPay(false)}
        />
      )}
    </div>
  );
}

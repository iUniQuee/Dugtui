import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Mail, Lock, User as UserIcon, Chrome } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function AuthModal({
  initialTab,
  onClose,
}: {
  initialTab: 'login' | 'signup';
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'login' | 'signup'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resending, setResending] = useState(false);

  const googleLogin = async () => {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (err) {
      setError('Google-ээр нэвтрэхэд алдаа гарлаа: ' + err.message);
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    setResending(true);
    setError('');
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    setResending(false);
    if (err) {
      setError('Баталгаажуулах и-мэйл илгээж чадсангүй: ' + err.message);
      return;
    }
    setInfo('Баталгаажуулах холбоосыг ' + email.trim() + ' хаяг руу дахин илгээлээ. Spam хавтсаа ч шалгана уу.');
  };

  const submit = async () => {
    setError('');
    setInfo('');
    setNeedsConfirm(false);
    if (!email.trim() || !password) {
      setError('И-мэйл болон нууц үгээ бүрэн оруулна уу.');
      return;
    }
    setBusy(true);
    if (tab === 'signup') {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: window.location.origin,
        },
      });
      setBusy(false);
      if (err) {
        setError(signUpErrorText(err.message));
        return;
      }
      // И-мэйл баталгаажуулалт шаарддаг үед session үүсэхгүй.
      if (data.session) {
        onClose();
        return;
      }
      setInfo(
        'Бүртгэл үүслээ. ' +
          email.trim() +
          ' хаяг руу илгээсэн баталгаажуулах холбоосыг дарж баталгаажуулсны дараа нэвтэрнэ үү.'
      );
      setNeedsConfirm(true);
      setTab('login');
      return;
    }
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) {
      if (isEmailNotConfirmed(err)) {
        setError(
          'И-мэйл хаяг баталгаажаагүй байна. ' +
            email.trim() +
            ' хаяг руу илгээсэн баталгаажуулах холбоосыг дарна уу.'
        );
        setNeedsConfirm(true);
        return;
      }
      setError(loginErrorText(err));
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-7 relative"
      >
        <button onClick={onClose} className="absolute right-4 top-4 p-1 rounded-full hover:bg-neutral-100">
          <X className="w-5 h-5 text-neutral-500" />
        </button>

        <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-xl">
          {(['login', 'signup'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError('');
                setInfo('');
              }}
              className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                tab === t ? 'bg-white shadow text-neutral-900' : 'text-neutral-500'
              }`}
            >
              {t === 'login' ? 'Нэвтрэх' : 'Бүртгүүлэх'}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {tab === 'signup' && (
            <label className="relative block">
              <UserIcon className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Таны нэр"
                className="w-full rounded-xl border border-neutral-300 pl-10 pr-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </label>
          )}
          <label className="relative block">
            <Mail className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="И-мэйл хаяг"
              className="w-full rounded-xl border border-neutral-300 pl-10 pr-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </label>
          <label className="relative block">
            <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Нууц үг"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="w-full rounded-xl border border-neutral-300 pl-10 pr-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-emerald-600">{info}</p>}
          {needsConfirm && (
            <button
              onClick={() => void resendConfirmation()}
              disabled={resending || !email.trim()}
              className="text-xs font-medium text-neutral-700 underline disabled:opacity-50"
            >
              {resending ? 'Илгээж байна...' : 'Баталгаажуулах и-мэйлийг дахин илгээх'}
            </button>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Хүлээнэ үү...' : tab === 'login' ? 'Нэвтрэх' : 'Бүртгүүлэх'}
          </button>

          <div className="flex items-center gap-3 py-1">
            <span className="flex-1 h-px bg-neutral-200" />
            <span className="text-xs text-neutral-400">эсвэл</span>
            <span className="flex-1 h-px bg-neutral-200" />
          </div>

          <button
            onClick={googleLogin}
            disabled={busy}
            className="w-full rounded-xl border border-neutral-300 py-3 font-medium text-neutral-800 hover:bg-neutral-50 transition-colors flex items-center justify-center gap-2"
          >
            <Chrome className="w-4 h-4" /> Google-ээр нэвтрэх
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function isEmailNotConfirmed(err: { code?: string; message: string }): boolean {
  return err.code === 'email_not_confirmed' || /email not confirmed/i.test(err.message);
}

function loginErrorText(err: { code?: string; message: string }): string {
  if (err.code === 'invalid_credentials' || /invalid login credentials/i.test(err.message))
    return 'И-мэйл эсвэл нууц үг буруу байна.';
  return 'Нэвтрэхэд алдаа гарлаа: ' + err.message;
}

function signUpErrorText(message: string): string {
  if (message.includes('already registered') || message.includes('already exists'))
    return 'Энэ и-мэйл хаягаар бүртгүүлсэн байна. Нэвтрэх цэснээс оролдоорой.';
  if (message.includes('password') && message.includes('6'))
    return 'Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой.';
  return 'Бүртгүүлэхэд алдаа гарлаа: ' + message;
}

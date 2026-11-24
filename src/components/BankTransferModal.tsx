import { useEffect, useState } from 'react';
import { AlertCircle, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import {
  DEFAULT_BANK_SETTINGS,
  formatAccountNumber,
  loadBankSettings,
  normalizeAccountNumber,
  type BankSettings,
} from '@/lib/payments';

function formatMnt(n: number): string {
  return new Intl.NumberFormat('mn-MN').format(n) + '₮';
}

/**
 * Богд банкны QR-аар шилжүүлэг авах цонх.
 *
 * QR зураг, дансны дугаар, хүлээн авагчийн нэрийг админ `platform_settings`-ээс
 * удирдана. Хэрэглэгч шилжүүлгийн утга дээр 6 оронтой кодыг бичиж,
 * «Төлбөр шилжүүлсэн» дарсны дараа өрөө PENDING_APPROVAL болж, админд push
 * мэдэгдэл очно.
 */
export function BankTransferModal({
  amount,
  title,
  paymentCode,
  busy,
  error,
  onSubmitted,
  onClose,
}: {
  amount: number;
  title: string;
  paymentCode: string;
  busy: boolean;
  error: string;
  onSubmitted: () => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<BankSettings>(DEFAULT_BANK_SETTINGS);
  const [qrFailed, setQrFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadBankSettings().then((next) => {
      if (alive) setSettings(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const copy = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard блоклогдсон бол алгасна */
    }
  };

  const qrSrc = settings.qr_url || DEFAULT_BANK_SETTINGS.qr_url;
  const missingAccount = !settings.account_number || !settings.account_name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-lg text-neutral-900">
              Банкны QR уншуулж төлөх (Богд банк)
            </h3>
            <p className="mt-1 text-sm text-neutral-500">
              {title ? `“${title}”` : 'Бэлгийн өрөө'} · {formatMnt(amount)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Хаах"
            className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* QR */}
        <div className="mt-5 mx-auto w-fit rounded-2xl border-4 border-neutral-900 p-3 bg-white">
          {!qrFailed ? (
            <img
              src={qrSrc}
              alt="Богд банкны QR код"
              onError={() => setQrFailed(true)}
              className="w-[240px] h-[240px] object-contain"
            />
          ) : (
            <div className="w-[240px] h-[240px] flex flex-col items-center justify-center gap-2 text-center text-sm text-neutral-400 px-6">
              <AlertCircle className="w-6 h-6" />
              QR зураг ачаалагдсангүй. Доорх дансны дугаараар шилжүүлнэ үү.
            </div>
          )}
        </div>

        {/* Мэдээлэл */}
        <div className="mt-4 divide-y divide-neutral-100 rounded-2xl border border-neutral-200 overflow-hidden">
          <InfoRow label="Банк" value={settings.bank_name} />
          <InfoRow
            label="Дансны дугаар"
            value={formatAccountNumber(settings.account_number) || '-'}
            copied={copied === 'account'}
            onCopy={() => void copy('account', normalizeAccountNumber(settings.account_number))}
          />
          <InfoRow
            label="Хүлээн авагч"
            value={settings.account_name || '-'}
            copied={copied === 'name'}
            onCopy={() => void copy('name', settings.account_name)}
          />
          <InfoRow label="Төлөх дүн" value={formatMnt(amount)} strong />
          <InfoRow
            label="Гүйлгээний утга"
            value={paymentCode}
            mono
            strong
            copied={copied === 'code'}
            onCopy={() => void copy('code', paymentCode)}
          />
        </div>

        <p className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 leading-relaxed">
          QR уншуулаад <span className="font-semibold">«Гүйлгээний утга»</span> дээр энэ{' '}
          <span className="font-mono font-bold">{paymentCode}</span> 6 оронтой кодыг заавал
          бичнэ үү. Кодгүй шилжүүлэг баталгаажихгүй.
        </p>

        {missingAccount && (
          <p className="mt-2 text-xs text-neutral-400">
            Админ банкны дансны мэдээллээ бөглөөгүй байна. Төлбөр хийхээс өмнө админтай
            холбогдоно уу.
          </p>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-600 flex gap-1.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <button
          onClick={onSubmitted}
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {busy ? 'Илгээж байна...' : 'Төлбөр шилжүүлсэн'}
        </button>

        <p className="mt-2 text-center text-xs text-neutral-400 flex items-center justify-center gap-1">
          <RefreshCw className="w-3 h-3" /> Төлбөрийг админ шалгаж баталгаажуулна.
        </p>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl border border-neutral-300 py-2.5 font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Цуцлах
        </button>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  strong = false,
  copied = false,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  copied?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-32 shrink-0 text-xs text-neutral-500">{label}</span>
      <span
        className={`flex-1 min-w-0 break-words ${mono ? 'font-mono tracking-widest' : ''} ${
          strong ? 'font-bold text-neutral-900' : 'font-medium text-neutral-800'
        }`}
      >
        {value}
      </span>
      {onCopy && value !== '-' && (
        <button
          onClick={onCopy}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Хуулагдлаа' : 'Хуулах'}
        </button>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FlaskConical, Loader2, RefreshCw, X } from 'lucide-react';
import {
  checkQpayPayment,
  createQpayInvoice,
  simulateQpayPayment,
  type QpayInvoice,
} from '@/lib/qpay';

function formatMnt(n: number): string {
  return new Intl.NumberFormat('mn-MN').format(n) + '₮';
}

/**
 * QPay төлбөрийн цонх: QR код, банкны апп-ийн deeplink-ууд,
 * төлбөр шалгах polling болон "Туршилтын төлбөр төлөх" товч.
 * Бүх QPay нууц мэдээлэл сервер талд; энэ компонент зөвхѩн invoice мэдээлэл авна.
 */
export function QpayModal({
  amount,
  title,
  onPaid,
  onClose,
}: {
  amount: number;
  title: string;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [invoice, setInvoice] = useState<QpayInvoice | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);

  const settled = useRef(false);

  const finish = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    setPaid(true);
    onPaid();
  }, [onPaid]);

  const createInvoice = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const inv = await createQpayInvoice({
        amount,
        description: title ? `Бэлгийн өрөө: ${title}` : 'Бэлгийн өрөө',
        senderInvoiceNo: `GIFT-${Date.now()}`,
      });
      setInvoice(inv);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'QPay нэхэмжлэх үүсгэж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [amount, title]);

  useEffect(() => {
    void createInvoice();
  }, [createInvoice]);

  // Төлбөрийн төлөвийг 3 секунд тутам шалгана
  useEffect(() => {
    if (!invoice || paid) return;
    const id = window.setInterval(async () => {
      try {
        const status = await checkQpayPayment(invoice.invoiceId);
        if (status.paid) finish();
      } catch {
        /* түр зуурын сүлжээний алдааг алгасна */
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [invoice, paid, finish]);

  const handleSimulate = async () => {
    if (!invoice || busy) return;
    setBusy(true);
    setError('');
    try {
      const status = await simulateQpayPayment(invoice.invoiceId);
      if (status.paid) finish();
      else setError('Туршилтын төлбөр баталгаажсангүй.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Туршилтын төлбөр амжилтгүй.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheck = async () => {
    if (!invoice || busy) return;
    setBusy(true);
    setError('');
    try {
      const status = await checkQpayPayment(invoice.invoiceId);
      if (status.paid) finish();
      else setError('Төлбөр хараахан ирээгүй байна. Банкны апп-аараа төлнө үү.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Төлбөр шалгаж чадсангүй.');
    } finally {
      setBusy(false);
    }
  };

  // QPay-с жинхэнэ QR ирээгүй (туршилтын горим) үед public/qr.png-г харуулна
  const qrImageSrc = invoice?.qrImage
    ? invoice.qrImage.startsWith('data:')
      ? invoice.qrImage
      : `data:image/png;base64,${invoice.qrImage}`
    : '/qr.png';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-lg text-neutral-900">QPay төлбөр</h3>
            <p className="mt-1 text-sm text-neutral-500">
              {title ? `“${title}”` : 'Бэлгийн өрөө'} — {formatMnt(amount)}
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

        {loading && (
          <div className="flex flex-col items-center gap-3 py-14 text-neutral-500">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Нэхэмжлэх үүсгэж байна...</span>
          </div>
        )}

        {!loading && error && !invoice && (
          <div className="mt-6 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p>{error}</p>
              <button
                onClick={() => void createInvoice()}
                className="mt-2 inline-flex items-center gap-1 font-medium underline"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Дахин оролдох
              </button>
            </div>
          </div>
        )}

        {invoice && (
          <>
            {paid ? (
              <div className="mt-8 flex flex-col items-center gap-2 py-10 text-emerald-600">
                <CheckCircle2 className="w-10 h-10" />
                <p className="font-medium">Төлбөр баталгаажлаа</p>
              </div>
            ) : (
              <>
                <div className="mt-5 mx-auto w-fit rounded-2xl border-4 border-neutral-900 p-4 bg-white">
                  <img
                    src={qrImageSrc}
                    alt="Төлбөрийн QR код"
                    className="w-[200px] h-[200px] object-contain"
                  />
                </div>
                <p className="mt-3 text-center text-sm text-neutral-500">
                  QR кодыг банкны апп-аараа уншуулж төлнө үү.
                </p>

                {invoice.bankLinks.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {invoice.bankLinks.map((bank) => (
                      <a
                        key={bank.link}
                        href={bank.link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
                      >
                        <span className="truncate">{bank.name}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                      </a>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => void handleCheck()}
                  disabled={busy}
                  className="mt-4 w-full rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Төлбөр шалгах
                </button>

                {invoice.testMode && (
                  <button
                    onClick={() => void handleSimulate()}
                    disabled={busy}
                    className="mt-2 w-full rounded-xl bg-emerald-600 text-white py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <FlaskConical className="w-4 h-4" />
                    Туршилтын төлбөр төлөх (Simulate Payment)
                  </button>
                )}

                {invoice.testMode && (
                  <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
                    QPay түлхүүр тохируулаагүй тул туршилтын горимд ажиллаж байна. Дээрх товчоор
                    төлбөрийг дуурайж, өрөө үүсэх урсгалыг бүрэн шалгаж болно.
                  </p>
                )}
              </>
            )}
          </>
        )}

        {error && invoice && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl border border-neutral-300 py-3 font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Цуцлах
        </button>
      </div>
    </div>
  );
}

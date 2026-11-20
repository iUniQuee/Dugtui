import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import { checkQpayPayment, createQpayInvoice, type QpayInvoice } from '@/lib/qpay';

function formatMnt(n: number): string {
  return new Intl.NumberFormat('mn-MN').format(n) + '₮';
}

/**
 * Bogd QPay төлбөрийн цонх: жинхэнэ нэхэмжлэхийн QR код, банкны апп-аар
 * төлөх заавар болон "Төлбөр шалгах" товч. Бүх QPay нууц мэдээлэл сервер
 * талд; энэ компонент зөвхөн invoice мэдээлэл авна.
 */
export function QpayModal({
  amount,
  title,
  senderInvoiceNo,
  onPaid,
  onClose,
}: {
  amount: number;
  title: string;
  senderInvoiceNo: string;
  onPaid: (invoiceId: string) => void;
  onClose: () => void;
}) {
  const [invoice, setInvoice] = useState<QpayInvoice | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);

  const finish = useCallback(
    (invoiceId: string) => {
      if (paid) return;
      setPaid(true);
      onPaid(invoiceId);
    },
    [onPaid, paid]
  );

  const createInvoice = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const inv = await createQpayInvoice({
        amount,
        description: title ? `Бэлгийн өрөө: ${title}` : 'Бэлгийн өрөө',
        senderInvoiceNo,
      });
      setInvoice(inv);
      if (!inv.qrImage && !inv.qrText) {
        setError('QPay-с QR код ирсэнгүй. Дахин оролдоно уу.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bogd QPay нэхэмжлэх үүсгэж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [amount, title, senderInvoiceNo]);

  useEffect(() => {
    void createInvoice();
  }, [createInvoice]);

  const handleCheck = async () => {
    if (!invoice || busy) return;
    setBusy(true);
    setError('');
    try {
      const status = await checkQpayPayment(invoice.invoiceId);
      if (status.paid) finish(invoice.invoiceId);
      else setError('Төлбөр хараахан ороогүй байна. Банкны апп-аараа төлнө үү.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Төлбөр шалгаж чадсангүй.');
    } finally {
      setBusy(false);
    }
  };

  const qrImageSrc = invoice?.qrImage
    ? invoice.qrImage.startsWith('data:')
      ? invoice.qrImage
      : `data:image/png;base64,${invoice.qrImage}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-lg text-neutral-900">Bogd QPay төлбөр</h3>
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

        {!loading && !invoice && (
          <div className="mt-6 rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p>{error || 'Bogd QPay нэхэмжлэх үүсгэж чадсангүй.'}</p>
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
                  {qrImageSrc ? (
                    <img
                      src={qrImageSrc}
                      alt="Bogd QPay төлбөрийн QR код"
                      className="w-[200px] h-[200px] object-contain"
                    />
                  ) : invoice.qrText ? (
                    <QRCodeSVG value={invoice.qrText} size={200} />
                  ) : (
                    <div className="w-[200px] h-[200px] flex items-center justify-center text-sm text-neutral-400 text-center px-4">
                      QR код ирээгүй байна
                    </div>
                  )}
                </div>

                <p className="mt-3 text-center text-sm text-neutral-600 leading-relaxed">
                  QPay-д холбогдсон банкны апп-аараа (Bogd, Khan, Golomt г.м.) энэ QR кодыг
                  уншуулж төлнө үү.
                </p>
                <p className="mt-1 text-center text-xs text-neutral-400">
                  Төлбөр төлсний дараа доорх «Төлбөр шалгах» товчийг дарна уу.
                </p>

                <button
                  onClick={() => void handleCheck()}
                  disabled={busy}
                  className="mt-4 w-full rounded-xl bg-neutral-900 text-white py-3 font-semibold hover:bg-neutral-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Төлбөр шалгах
                </button>
              </>
            )}
          </>
        )}

        {error && invoice && !paid && <p className="mt-3 text-sm text-red-600">{error}</p>}

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

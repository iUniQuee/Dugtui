/**
 * QPay client — browser side.
 *
 * Аюулгүй байдлын дүрэм: QPAY_USERNAME / QPAY_PASSWORD / QPAY_INVOICE_CODE
 * зэрэг нууцууд зөвхөн серверт (server/index.mjs) байна. Энэ файл зөвхөн
 * манай backend-ийн /api/qpay/* route-уудтай ярьдаг бөгөөд ямар ч түлхүүр
 * эсвэл токеныг агуулаагүй, браузер руу илгээдэггүй.
 */

export interface QpayBankLink {
  name: string;
  link: string;
  logo?: string | null;
}

export interface QpayInvoice {
  invoiceId: string;
  amount: number;
  qrText: string;
  qrImage: string | null;
  bankLinks: QpayBankLink[];
  /** true бол QPay түлхүүр тохируулаагүй/туршилтын горим — simulate товч харагдана. */
  testMode: boolean;
}

export interface QpayPaymentStatus {
  paid: boolean;
  paidAmount: number;
  testMode: boolean;
}

const API_BASE = '/api/qpay';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error('QPay сервер ажиллахгүй байна. `npm run api`-г асаана уу.');
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok || !data) {
    throw new Error(data?.error ?? 'QPay серверээс буруу хариу ирлээ.');
  }
  return data;
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** QPay дээр нэхэмжлэх (invoice) үүсгэж, QR болон банкны deeplink-уудыг авна. */
export function createQpayInvoice(input: {
  amount: number;
  description: string;
  senderInvoiceNo: string;
}): Promise<QpayInvoice> {
  return request<QpayInvoice>('/invoice', jsonInit(input));
}

/** Нэхэмжлэх төлөгдсөн эсэхийг QPay-ээс шалгана. */
export function checkQpayPayment(invoiceId: string): Promise<QpayPaymentStatus> {
  return request<QpayPaymentStatus>(
    `/check?invoice_id=${encodeURIComponent(invoiceId)}`
  );
}

/** Зөвхөн туршилтын горимд: төлбөрийг "төлөгдсөн" болгож тестлэнэ. */
export function simulateQpayPayment(invoiceId: string): Promise<QpayPaymentStatus> {
  return request<QpayPaymentStatus>(
    `/simulate`,
    jsonInit({ invoiceId })
  );
}

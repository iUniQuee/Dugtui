/**
 * Cloudflare Pages Function — QPay Merchant V2 (sandbox/production).
 *
 * АЮУЛГҮЙ БАЙДЛЫН ГОЛ ДҮРЭМ:
 *   QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE нь ЗӨВХӨН Cloudflare-ийн
 *   environment variables (Secrets) хэлбэрээр энд уншигдана. Эдгээр утга нь
 *   хэзээ ч `VITE_` угтвартай болж browser bundle руу орохгүй, ямар ч хариунд
 *   буцаж явахгүй.
 *
 * Route-ууд (frontend `src/lib/qpay.ts`-ээс дуудагдана):
 *   POST /api/qpay/invoice   → QPay нэхэмжлэх үүсгэж QR/deeplink буцаана
 *   GET  /api/qpay/check     → төлбөр баталгаажсан эсэхийг QPay-с шалгана
 *   POST /api/qpay/simulate  → зөвхөн туршилтын (түлхүүргүй) горимд
 *   POST /api/qpay/callback  → QPay-ийн webhook
 *
 * Cloudflare Pages нь төлөв хадгалах сан байхгүй (isolate бүр тусдаа) тул
 * нэхэмжлэхийн төлөвийг энд хадгалахгүй: жинхэнэ горимд QPay-ийн
 * /v2/payment/check хариу эрхтэй, туршилтын горимд simulate шууд буцаана.
 */

const DEFAULT_BASE = 'https://merchant-sandbox.qpay.mn';

/** Туршилтын нэхэмжлэхийн id: test_<дүн>_<uuid> (Cloudflare дээр төлөв хадгалахгүй тул дүнг id-д хийнэ). */
const TEST_INVOICE_ID = /^test_(\d+)_[0-9a-f-]{36}$/i;

let tokenCache = null;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readJson(request) {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
}

function readConfig(env) {
  return {
    base: String(env.QPAY_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    username: env.QPAY_USERNAME || '',
    password: env.QPAY_PASSWORD || '',
    invoiceCode: env.QPAY_INVOICE_CODE || '',
    callbackUrl: env.QPAY_CALLBACK_URL || '',
    allowSimulate: String(env.ALLOW_SIMULATED_PAYMENT ?? 'true') !== 'false',
    configured: Boolean(env.QPAY_USERNAME && env.QPAY_PASSWORD && env.QPAY_INVOICE_CODE),
  };
}

/* ------------------------------------------------------------------ */
/* QPay API                                                            */
/* ------------------------------------------------------------------ */

async function getAccessToken(cfg) {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const basic = btoa(`${cfg.username}:${cfg.password}`);
  const res = await fetch(`${cfg.base}/v2/auth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) {
    throw new Error(
      `QPay нэвтрэлт амжилтгүй (${res.status}). QPAY_USERNAME / QPAY_PASSWORD-оо шалгана уу.`
    );
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

async function qpayFetch(cfg, pathname, init = {}) {
  const token = await getAccessToken(cfg);
  const res = await fetch(`${cfg.base}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.message || data.error_description)) || `QPay алдаа (${res.status})`;
    throw new Error(message);
  }
  return data ?? {};
}

async function createRealInvoice(cfg, { amount, description, senderInvoiceNo }) {
  const raw = await qpayFetch(cfg, '/v2/invoice', {
    method: 'POST',
    body: JSON.stringify({
      invoice_code: cfg.invoiceCode,
      sender_invoice_no: senderInvoiceNo,
      invoice_receiver_code: 'terminal',
      invoice_description: description,
      amount,
      callback_url: cfg.callbackUrl || undefined,
    }),
  });

  return {
    invoiceId: raw.invoice_id,
    amount,
    qrText: raw.qr_text || '',
    qrImage: raw.qr_image || null,
    bankLinks: Array.isArray(raw.urls)
      ? raw.urls.map((u) => ({ name: u.name || 'Банк', link: u.link, logo: u.logo || null }))
      : [],
    testMode: false,
  };
}

function createTestInvoice({ amount }) {
  return {
    invoiceId: `test_${amount}_${crypto.randomUUID()}`,
    amount,
    qrText: '',
    qrImage: null,
    bankLinks: [],
    testMode: true,
  };
}

async function paymentStatus(cfg, invoiceId) {
  const data = await qpayFetch(cfg, '/v2/payment/check', {
    method: 'POST',
    body: JSON.stringify({
      object_type: 'INVOICE',
      object_id: invoiceId,
      offset: { page_number: 1, page_limit: 10 },
    }),
  });

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const paid = rows.some(
    (r) => String(r.payment_status || '').toUpperCase() === 'PAID'
  );
  return { paid, paidAmount: Number(data.paid_amount || 0), testMode: false };
}

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/qpay\/?/, '').replace(/\/+$/, '');
  const cfg = readConfig(env);

  try {
    if (route === 'invoice' && request.method === 'POST') {
      const body = await readJson(request);
      const amount = Math.round(Number(body.amount) || 0);
      const description = String(body.description || 'Бэлгийн өрөө').slice(0, 200);

      if (!Number.isFinite(amount) || amount < 100) {
        return jsonResponse({ error: 'Дүн хамгийн багадаа 100₮ байх ёстой.' }, 400);
      }
      if (!cfg.configured) {
        return jsonResponse(createTestInvoice({ amount }));
      }

      const senderInvoiceNo = String(body.senderInvoiceNo || `GIFT-${Date.now()}`).slice(0, 45);
      return jsonResponse(await createRealInvoice(cfg, { amount, description, senderInvoiceNo }));
    }

    if (route === 'check' && request.method === 'GET') {
      const invoiceId = url.searchParams.get('invoice_id') || '';
      if (!invoiceId) return jsonResponse({ error: 'invoice_id шаардлагатай.' }, 400);
      if (!cfg.configured || TEST_INVOICE_ID.test(invoiceId)) {
        return jsonResponse({ paid: false, paidAmount: 0, testMode: true });
      }
      return jsonResponse(await paymentStatus(cfg, invoiceId));
    }

    if (route === 'simulate' && request.method === 'POST') {
      if (!cfg.allowSimulate) {
        return jsonResponse({ error: 'Туршилтын төлбөр хаагдсан байна.' }, 403);
      }
      const body = await readJson(request);
      const invoiceId = String(body.invoiceId || '');
      const match = invoiceId.match(TEST_INVOICE_ID);
      if (!match || cfg.configured) {
        return jsonResponse(
          { error: 'Туршилтын төлбөрийг зөвхөн түлхүүргүй туршилтын горимд хийж болно.' },
          403
        );
      }
      return jsonResponse({ paid: true, paidAmount: Number(match[1]), testMode: true });
    }

    if (route === 'callback' && request.method === 'POST') {
      // Жинхэнэ горимд төлөвийг /v2/payment/check-ээс шалгадаг тул энд зөвхөн хүлээн авна.
      await readJson(request);
      return jsonResponse({ accepted: true });
    }

    return jsonResponse({ error: 'API route олдсонгүй.' }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Серверийн алдаа.';
    return jsonResponse({ error: message }, 502);
  }
}

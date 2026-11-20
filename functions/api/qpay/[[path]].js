/**
 * Cloudflare Pages Function — Bogd QPay Merchant V2.
 *
 * АЮУЛГҮЙ БАЙДЛЫН ГОЛ ДҮРЭМ:
 *   QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE, QPAY_CALLBACK_URL нь
 *   ЗӨВХӨН Cloudflare-ийн environment variables (Secrets) хэлбэрээр энд
 *   уншигдана. Эдгээр утга нь хэзээ ч `VITE_` угтвартай болж browser bundle
 *   руу орохгүй, ямар ч хариунд буцаж явахгүй.
 *
 * Route-ууд (frontend `src/lib/qpay.ts`-ээс дуудагдана):
 *   POST /api/qpay/invoice   → /v2/invoice: нэхэмжлэх + QR код үүсгэнэ
 *   GET  /api/qpay/check     → /v2/payment/check: төлбөр баталгаажсан эсэх
 *   POST /api/qpay/callback  → QPay-ийн webhook: төлбөрийг шалгаад өрөөг PAID болгоно
 *
 * Нэмэлт (сонголттой, зөвхөн серверт):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — callback/check үед өрөөний
 *   төлөвийг 'PAID' болгож бичихэд ашиглана.
 */

const DEFAULT_BASE = 'https://merchant.qpay.mn';

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
    configured: Boolean(env.QPAY_USERNAME && env.QPAY_PASSWORD && env.QPAY_INVOICE_CODE),
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

const MISSING_KEYS =
  'Bogd QPay түлхүүр тохируулаагүй байна. QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE-г Cloudflare-ийн environment variables (Secrets) дээр нэмнэ үү.';

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
  return { paid, paidAmount: Number(data.paid_amount || 0) };
}

/**
 * Төлбөр баталгаажсаны дараа тухайн нэхэмжлэхээр үүссэн өрөөг 'PAID' болгоно.
 * SUPABASE_SERVICE_ROLE_KEY байхгүй бол чимээгүй алгасна (frontend өөрөө
 * төлбөр баталгаажсаны дараа өрөөг PAID төлөвтэй үүсгэдэг).
 */
async function markRoomPaid(cfg, invoiceId) {
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !invoiceId) return false;
  try {
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/rooms?qpay_invoice_id=eq.${encodeURIComponent(
        invoiceId
      )}&status=neq.CLAIMED`,
      {
        method: 'PATCH',
        headers: {
          apikey: cfg.supabaseKey,
          Authorization: `Bearer ${cfg.supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ status: 'PAID', paid_at: new Date().toISOString() }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
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
        return jsonResponse({ error: MISSING_KEYS }, 503);
      }

      const senderInvoiceNo = String(body.senderInvoiceNo || `GIFT-${Date.now()}`).slice(0, 45);
      return jsonResponse(await createRealInvoice(cfg, { amount, description, senderInvoiceNo }));
    }

    if (route === 'check' && request.method === 'GET') {
      const invoiceId = url.searchParams.get('invoice_id') || '';
      if (!invoiceId) return jsonResponse({ error: 'invoice_id шаардлагатай.' }, 400);
      if (!cfg.configured) {
        return jsonResponse({ error: MISSING_KEYS }, 503);
      }
      const status = await paymentStatus(cfg, invoiceId);
      if (status.paid) await markRoomPaid(cfg, invoiceId);
      return jsonResponse(status);
    }

    if (route === 'callback' && request.method === 'POST') {
      const body = await readJson(request);
      const invoiceId = String(
        body.invoice_id || body.object_id || url.searchParams.get('invoice_id') || ''
      );
      if (!invoiceId || !cfg.configured) {
        return jsonResponse({ accepted: false, paid: false }, 200);
      }

      // QPay-ийн мэдэгдлийг сохроор итгэхгүй: /v2/payment/check-ээр баталгаажуулна.
      const status = await paymentStatus(cfg, invoiceId);
      if (status.paid) await markRoomPaid(cfg, invoiceId);
      return jsonResponse({ accepted: true, paid: status.paid });
    }

    return jsonResponse({ error: 'API route олдсонгүй.' }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Серверийн алдаа.';
    return jsonResponse({ error: message }, 502);
  }
}

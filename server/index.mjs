/**
 * QPay Merchant V2 backend (Sandbox/Production) + static hosting for `dist`.
 *
 * АЮУЛГҮЙ БАЙДЛЫН ГОЛ ДҮРЭМ:
 *   QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE нь ЗӨВХӨН энэ файлд
 *   (сервер талд) уншигдана. Эдгээр утга нь хэзээ ч `VITE_` угтвартай болж
 *   browser bundle руу орохгүй, ямар ч хариунд буцаж явахгүй.
 *
 * Ажиллуулах:
 *   npm run api     → http://localhost:8787 (Vite-ийн /api proxy энэ рүү харна)
 *   npm run start   → build хийсэн dist/ -ийг мөн энэ серверээр үйлчилнэ
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');

const PORT = Number(process.env.API_PORT || process.env.PORT || 8787);
const QPAY_BASE = (process.env.QPAY_BASE_URL || 'https://merchant.qpay.mn').replace(/\/+$/, '');
const QPAY_USERNAME = process.env.QPAY_USERNAME || '';
const QPAY_PASSWORD = process.env.QPAY_PASSWORD || '';
const QPAY_INVOICE_CODE = process.env.QPAY_INVOICE_CODE || '';
const QPAY_CALLBACK_URL = process.env.QPAY_CALLBACK_URL || '';

/** Бүх гурван утга байгаа бол л жинхэнэ QPay руу хандлана. */
const QPAY_CONFIGURED = Boolean(QPAY_USERNAME && QPAY_PASSWORD && QPAY_INVOICE_CODE);

/** Callback/check үед өрөөг 'PAID' болгож бичихэд (сонголттой). */
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* ------------------------------------------------------------------ */
/* QPay API                                                            */
/* ------------------------------------------------------------------ */

let tokenCache = null;

async function getAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const basic = Buffer.from(`${QPAY_USERNAME}:${QPAY_PASSWORD}`).toString('base64');
  const res = await fetch(`${QPAY_BASE}/v2/auth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
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

async function qpayFetch(pathname, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${QPAY_BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || data?.error_description || `QPay алдаа (${res.status})`;
    throw new Error(msg);
  }
  return data ?? {};
}

async function createRealInvoice({ amount, description, senderInvoiceNo }) {
  const raw = await qpayFetch('/v2/invoice', {
    method: 'POST',
    body: JSON.stringify({
      invoice_code: QPAY_INVOICE_CODE,
      sender_invoice_no: senderInvoiceNo,
      invoice_receiver_code: 'terminal',
      invoice_description: description,
      amount,
      callback_url: QPAY_CALLBACK_URL || undefined,
    }),
  });

  return {
    invoiceId: raw.invoice_id,
    amount,
    qrText: raw.qr_text || '',
    qrImage: raw.qr_image || null,
  };
}

/**
 * Төлбөр баталгаажсаны дараа тухайн нэхэмжлэхээр үүссэн өрөөг 'PAID' болгоно.
 * SUPABASE_SERVICE_ROLE_KEY байхгүй бол чимээгүй алгасна.
 */
async function markRoomPaid(invoiceId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !invoiceId) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rooms?qpay_invoice_id=eq.${encodeURIComponent(invoiceId)}&status=neq.CLAIMED`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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

async function paymentStatus(invoiceId) {
  const data = await qpayFetch('/v2/payment/check', {
    method: 'POST',
    body: JSON.stringify({
      object_type: 'INVOICE',
      object_id: invoiceId,
      offset: { page_number: 1, page_limit: 10 },
    }),
  });

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const paid = rows.some((r) => String(r.payment_status || '').toUpperCase() === 'PAID');
  const paidAmount = Number(data.paid_amount || 0);
  return { paid, paidAmount };
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Хүсэлт хэт том байна.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON буруу байна.'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Static files (production: `npm run build` дараа `npm start`)        */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) {
    sendJson(res, 404, {
      error: 'dist/ байхгүй байна. Эхлээд `npm run build` хийнэ үү.',
    });
    return;
  }

  const decoded = decodeURIComponent(pathname);
  const target = path.join(DIST, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ''));
  let filePath = target;

  if (!existsSync(filePath) || existsSync(filePath) && !path.extname(filePath)) {
    const indexCandidate = path.join(filePath, 'index.html');
    filePath = existsSync(indexCandidate) ? indexCandidate : path.join(DIST, 'index.html');
  }
  // SPA fallback: hash/query routing ашигладаг тул бүх route index.html руу
  if (!existsSync(filePath)) filePath = path.join(DIST, 'index.html');

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: 'Файл олдсонгүй.' });
  }
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, qpayConfigured: QPAY_CONFIGURED });
    }

    if (pathname === '/api/qpay/invoice' && req.method === 'POST') {
      const body = await readJson(req);
      const amount = Math.round(Number(body.amount) || 0);
      const description = String(body.description || 'Бэлгийн өрөө').slice(0, 200);

      if (!Number.isFinite(amount) || amount < 100) {
        return sendJson(res, 400, { error: 'Дүн хамгийн багадаа 100₮ байх ёстой.' });
      }

      if (!QPAY_CONFIGURED) {
        return sendJson(res, 503, {
          error:
            'Bogd QPay түлхүүр тохируулаагүй байна. .env файлд QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE-г бөглөнө үү.',
        });
      }

      const senderInvoiceNo = String(body.senderInvoiceNo || `GIFT-${Date.now()}`).slice(0, 45);
      return sendJson(res, 200, await createRealInvoice({ amount, description, senderInvoiceNo }));
    }

    if (pathname === '/api/qpay/check' && req.method === 'GET') {
      const invoiceId = url.searchParams.get('invoice_id') || '';
      if (!invoiceId) return sendJson(res, 400, { error: 'invoice_id шаардлагатай.' });

      if (!QPAY_CONFIGURED) {
        return sendJson(res, 503, {
          error:
            'Bogd QPay түлхүүр тохируулаагүй байна. .env файлд QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE-г бөглөнө үү.',
        });
      }
      const status = await paymentStatus(invoiceId);
      if (status.paid) await markRoomPaid(invoiceId);
      return sendJson(res, 200, status);
    }

    // QPay-ийн callback (төлбөр баталгаажсаны дараа QPay өөрөө дуудна)
    if (pathname === '/api/qpay/callback' && req.method === 'POST') {
      const body = await readJson(req);
      const invoiceId = String(body.invoice_id || body.object_id || '');
      if (!invoiceId || !QPAY_CONFIGURED) {
        return sendJson(res, 200, { accepted: false, paid: false });
      }
      // Сохор итгэхгүй: /v2/payment/check-ээр баталгаажуулна.
      const status = await paymentStatus(invoiceId);
      if (status.paid) await markRoomPaid(invoiceId);
      return sendJson(res, 200, { accepted: true, paid: status.paid });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'API route олдсонгүй.' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    return await serveStatic(req, res, pathname);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Серверийн алдаа.';
    console.error('[qpay]', message);
    return sendJson(res, 502, { error: message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API + static server: http://0.0.0.0:${PORT}`);
  console.log(`QPay base: ${QPAY_BASE}`);
  console.log(
    QPAY_CONFIGURED
      ? 'Bogd QPay мэдээлэл тохируулсан — /v2/invoice-оор жинхэнэ нэхэмжлэх үүсгэнэ.'
      : 'Bogd QPay мэдээлэл дутуу — нэхэмжлэх үүсгэх боломжгүй (.env-ээ бөглөнө үү).'
  );
});

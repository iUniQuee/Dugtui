/**
 * Push notification API (Cloudflare Pages Function ба локал Node server хоёулаа
 * энэ нэг логикийг ашиглана).
 *
 *   GET  /api/push/key     → { publicKey }  (browser-т VAPID public key)
 *   POST /api/push/notify  → админы бүх төхөөрөмж рүү push илгээнэ
 *
 * Хамгаалалт:
 *   - VAPID private key зөвхөн серверийн env-д байна.
 *   - /notify нь Supabase access token шаардана; payment мэдэгдлийг зөвхөн
 *     тухайн өрөөг үүсгэсэн хэрэглэгч, зөвхөн PENDING_APPROVAL төлөвтэй үед
 *     илгээж чадна (дүн, код DB-ээс уншигдана — клиентээс итгэхгүй).
 *
 * Зөвхөн 2 төрлийн мэдэгдэл байна:
 *   - payment    : шинэ төлбөр (дүн + 6 оронтой гүйлгээний код)
 *   - withdrawal : мөнгө татах хүсэлт (дүн + банкны нэр)
 */

import { sendWebPush, vapidPublicKey } from './webpush.js';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function formatMnt(amount) {
  return new Intl.NumberFormat('mn-MN').format(Math.round(Number(amount) || 0));
}

function supabaseConfig(env) {
  return {
    url: String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, ''),
    key: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '',
  };
}

async function readJson(request) {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
}

async function notifyAdmin(request, env) {
  if (!env.VAPID_PRIVATE_KEY) {
    return json(
      { sent: 0, error: 'Push мэдэгдэл тохируулаагүй (VAPID_PRIVATE_KEY байхгүй).' },
      503
    );
  }

  const cfg = supabaseConfig(env);
  if (!cfg.url || !cfg.key) {
    return json({ sent: 0, error: 'SUPABASE_URL / SUPABASE_ANON_KEY тохируулаагүй.' }, 503);
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!/^bearer\s+/i.test(authorization)) {
    return json({ sent: 0, error: 'Нэвтрэх шаардлагатай.' }, 401);
  }
  const token = authorization.replace(/^bearer\s+/i, '').trim();

  const userRes = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    return json({ sent: 0, error: 'Нэвтрэлт хүчингүй байна.' }, 401);
  }
  const user = await userRes.json().catch(() => null);
  if (!user?.id) return json({ sent: 0, error: 'Нэвтрэлт хүчингүй байна.' }, 401);

  const body = await readJson(request);
  let title = '';
  let text = '';
  let tag = '';
  let url = '/#admin';

  if (body.kind === 'payment') {
    const roomId = String(body.room_id || '');
    if (!roomId) return json({ sent: 0, error: 'room_id шаардлагатай.' }, 400);

    const roomRes = await fetch(
      `${cfg.url}/rest/v1/rooms?id=eq.${encodeURIComponent(
        roomId
      )}&select=id,user_id,status,total_amount,fee_amount,payment_code,title`,
      { headers: { apikey: cfg.key, Authorization: `Bearer ${token}` } }
    );
    const rows = roomRes.ok ? await roomRes.json().catch(() => []) : [];
    const room = Array.isArray(rows) ? rows[0] : null;

    if (!room || room.user_id !== user.id || room.status !== 'PENDING_APPROVAL') {
      return json({ sent: 0, error: 'Төлбөрийн хүсэлт олдсонгүй.' }, 404);
    }

    const amount = Number(room.total_amount || 0) + Number(room.fee_amount || 0);
    const code = String(room.payment_code || '').trim() || '-';
    title = 'Шинэ төлбөр';
    text = `${formatMnt(amount)}₮ · Код: ${code}`;
    tag = `payment-${room.id}`;
  } else if (body.kind === 'withdrawal') {
    // Дүн, банкны нэрийг хэрэглэгчийн хамгийн сүүлийн хүлээгдэж буй
    // татах хүсэлтээс уншина (клиентээс итгэхгүй).
    const res = await fetch(
      `${cfg.url}/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(
        user.id
      )}&type=eq.payout&status=eq.pending&select=id,amount,bank_name&order=created_at.desc&limit=1`,
      { headers: { apikey: cfg.key, Authorization: `Bearer ${token}` } }
    );
    const rows = res.ok ? await res.json().catch(() => []) : [];
    const payout = Array.isArray(rows) ? rows[0] : null;
    const amount = Math.round(Number(payout?.amount) || 0);
    if (!payout || !Number.isFinite(amount) || amount <= 0) {
      return json({ sent: 0, error: 'Мөнгө татах хүсэлт олдсонгүй.' }, 404);
    }
    const bankName = String(payout.bank_name || '').trim() || '-';
    title = 'Мөнгө татах хүсэлт';
    text = `${formatMnt(amount)}₮ · ${bankName}`;
    tag = `withdrawal-${payout.id}`;
  } else {
    return json({ sent: 0, error: 'Мэдэгдлийн төрөл буруу.' }, 400);
  }

  const subsRes = await fetch(`${cfg.url}/rest/v1/rpc/admin_push_subscriptions`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!subsRes.ok) {
    return json(
      { sent: 0, error: 'Push бүртгэлийг уншиж чадсангүй (migration ажилласан эсэхээ шалгана уу).' },
      502
    );
  }
  const subscriptions = await subsRes.json().catch(() => []);
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  if (!list.length) return json({ sent: 0, total: 0 });

  let sent = 0;
  for (const subscription of list) {
    try {
      if (!subscription?.endpoint || !subscription.p256dh || !subscription.auth) continue;
      const status = await sendWebPush(
        subscription,
        { title, body: text, url, tag, kind: body.kind },
        env
      );
      if (status >= 200 && status < 300) sent += 1;
    } catch {
      /* нэг төхөөрөмж дээр алдаа гарсан ч бусад руу илгээнэ */
    }
  }

  return json({ sent, total: list.length });
}

export async function handlePushApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/push\/?/, '').replace(/\/+$/, '');

  try {
    if (route === 'key' && request.method === 'GET') {
      return json({ publicKey: vapidPublicKey(env) });
    }
    if (route === 'notify' && request.method === 'POST') {
      return await notifyAdmin(request, env);
    }
    return json({ error: 'API route олдсонгүй.' }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Серверийн алдаа.';
    return json({ error: message }, 502);
  }
}

/**
 * Web Push (RFC 8030 / 8291 / 8188) — VAPID + aes128gcm, WebCrypto only.
 *
 * Cloudflare Workers болон Node 18+ хоёуланд ажиллана (зөвхөн WebCrypto,
 * fetch, TextEncoder). Гадаад сан хэрэггүй.
 *
 * Шаардлагатай env (зөвхөн серверт):
 *   VAPID_PUBLIC_KEY   — base64url, 65 байт uncompressed P-256 цэг
 *   VAPID_PRIVATE_KEY  — base64url, 32 байт ECDSA private key (d)
 *   VAPID_SUBJECT      — mailto:... эсвэл https://... хаяг
 */

const encoder = new TextEncoder();

// VAPID public key нь нийтэд нээлттэй утга. Серверт env тохируулаагүй ч
// browser-т өгөх, JWT-ийн `k=` талбарт хийх энэ нөөц утгыг ашиглана.
export const DEFAULT_VAPID_PUBLIC_KEY = 'BCo56aVOjAkTETbPUHJfSGODJdoTsG0i5zRUq3mdHnRoy2VhqFokAIRTBndK_Iju4T1aLBLH2w9NJfY3DyTeFg0';

export function vapidPublicKey(env) {
  return env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
}

export function b64urlToBytes(value) {
  if (!value) return new Uint8Array(0);
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToB64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function importVapidPrivateKey(env) {
  const publicKey = b64urlToBytes(vapidPublicKey(env));
  const privateKey = b64urlToBytes(env.VAPID_PRIVATE_KEY);
  if (publicKey.length !== 65 || privateKey.length !== 32) {
    throw new Error('VAPID түлхүүр буруу форматтай байна');
  }
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(publicKey.slice(1, 33)),
    y: bytesToB64url(publicKey.slice(33, 65)),
    d: bytesToB64url(privateKey),
    ext: true,
  };
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function buildVapidHeaders(endpoint, env) {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(
    encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  );
  const claims = bytesToB64url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: env.VAPID_SUBJECT || 'mailto:admin@dugtui.pages.dev',
      })
    )
  );
  const signingInput = `${header}.${claims}`;
  const key = await importVapidPrivateKey(env);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput)
  );
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(signature))}`;
  return { Authorization: `vapid t=${jwt}, k=${vapidPublicKey(env)}` };
}

/** RFC 8291: subscription-ийн түлхүүрээр payload-ыг aes128gcm болгож шифрлэнэ. */
export async function encryptPayload(payloadText, p256dh, authSecret) {
  const uaPublic = b64urlToBytes(p256dh);
  const auth = b64urlToBytes(authSecret);
  if (uaPublic.length !== 65 || auth.length !== 16) {
    throw new Error('Push subscription-ийн түлхүүр буруу байна');
  }

  const local = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const asPublic = new Uint8Array(
    await crypto.subtle.exportKey('raw', local.publicKey)
  );
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256)
  );

  const authInfo = concatBytes(
    encoder.encode('WebPush: info'),
    new Uint8Array([0]),
    uaPublic,
    asPublic
  );
  const ikmKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
    'deriveBits',
  ]);
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: auth, info: authInfo },
      ikmKey,
      256
    )
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const cek = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: encoder.encode('Content-Encoding: aes128gcm\u0000'),
      },
      prkKey,
      128
    )
  );
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: encoder.encode('Content-Encoding: nonce\u0000'),
      },
      prkKey,
      96
    )
  );

  const plaintext = concatBytes(encoder.encode(payloadText), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      plaintext
    )
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);

  return concatBytes(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/**
 * Нэг төхөөрөмж рүү push илгээнэ. HTTP статусыг буцаана (404/410 = хуучирсан).
 */
export async function sendWebPush(subscription, payload, env) {
  const body = await encryptPayload(
    JSON.stringify(payload),
    subscription.p256dh,
    subscription.auth
  );
  const headers = await buildVapidHeaders(subscription.endpoint, env);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}

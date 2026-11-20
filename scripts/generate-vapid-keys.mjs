/**
 * Web Push VAPID түлхүүр үүсгэнэ.
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * Гарсан 3 утгыг Cloudflare Pages → Settings → Environment variables дээр
 * (Production) VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT нэрээр
 * secret болгон нэмнэ. Private key-г хэзээ ч git-д хийхгүй, chat-д хуулахгүй.
 */

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

// Uncompressed P-256 point: 0x04 || x(32) || y(32)
const publicRaw = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, 'base64url'),
  Buffer.from(pub.y, 'base64url'),
]);

console.log('VAPID_PUBLIC_KEY=' + publicRaw.toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + priv.d);
console.log('VAPID_SUBJECT=mailto:admin@example.com');

/**
 * Web Push — browser тал.
 *
 * VAPID private key хэзээ ч browser руу орохгүй: public key-г `/api/push/key`
 * серверээс авна. Серверт env тохируулаагүй үед доорх нөөц public key
 * ашиглагдана (public key нь нийтэд нээлттэй утга, private key л нууц).
 *
 * Мэдэгдэл зөвхөн 2 төрөлтэй:
 *   1. Шинэ төлбөр (дүн + 6 оронтой гүйлгээний код)
 *   2. Мөнгө татах хүсэлт (дүн + банкны нэр)
 */

import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY_FALLBACK = 'BCo56aVOjAkTETbPUHJfSGODJdoTsG0i5zRUq3mdHnRoy2VhqFokAIRTBndK_Iju4T1aLBLH2w9NJfY3DyTeFg0';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function bytesOf(value: ArrayBuffer | ArrayBufferView | null | undefined): Uint8Array | null {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function sameKey(a: ArrayBuffer | ArrayBufferView | null | undefined, b: Uint8Array): boolean {
  const bytes = bytesOf(a);
  if (!bytes || bytes.length !== b.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] !== b[i]) return false;
  return true;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Админ төхөөрөмжийг бүртгэнэ: зөвшөөрөл асууж, service worker-ээр
 * subscription үүсгээд Supabase-д хадгална.
 */
export async function enableAdminPush(): Promise<string> {
  if (!pushSupported()) {
    throw new Error('Энэ төхөөрөмж/хөтөч push мэдэгдэл дэмжихгүй байна.');
  }

  const keyRes = await fetch('/api/push/key').catch(() => null);
  const keyData = keyRes
    ? ((await keyRes.json().catch(() => null)) as { publicKey?: string } | null)
    : null;
  const publicKey = (keyData?.publicKey || VAPID_PUBLIC_KEY_FALLBACK).trim();
  if (!publicKey) {
    throw new Error('Серверт VAPID_PUBLIC_KEY тохируулаагүй байна.');
  }
  const applicationServerKey = urlBase64ToUint8Array(publicKey);

  if (Notification.permission === 'denied') {
    throw new Error('Мэдэгдэл блоклогдсон байна. Хөтчийн тохиргооноос зөвшөөрнө үү.');
  }
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Мэдэгдлийн зөвшөөрөл өгөгдөөгүй.');

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  // Өмнөх subscription өөр public key-ээр үүссэн бол дахин бүртгэнэ,
  // эс бөгөөс серверээс илгээсэн push үл ойлгогдох алдаатай буцдаг.
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as unknown as BufferSource,
    });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Эхлээд админ дансаараа нэвтэрнэ үү.');

  const json = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: session.user.id,
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      user_agent: navigator.userAgent.slice(0, 200),
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw new Error(error.message);

  return 'Мэдэгдэл тохируулагдлаа. Шинэ төлбөр, мөнгө татах хүсэлт ирэхэд энэ төхөөрөмж рүү шууд мэдэгдэнэ.';
}

/**
 * Админы утсанд push илгээхийг серверээс хүснэ. Алдаа гарвал төлбөрийн
 * урсгалыг зогсоохгүй (мэдэгдэл бол нэмэлт). Дүн, код, банкны нэрийг
 * сервер DB-ээс өөрөө уншдаг тул клиентээс итгэлтэй утга дамжуулахгүй.
 */
export async function notifyAdmin(
  payload: { kind: 'payment'; roomId: string } | { kind: 'withdrawal'; amount?: number }
): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const body =
      payload.kind === 'payment'
        ? { kind: 'payment', room_id: payload.roomId }
        : { kind: 'withdrawal', amount: payload.amount };
    await fetch('/api/push/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    /* push тохируулаагүй ч үндсэн урсгал үргэлжилнэ */
  }
}

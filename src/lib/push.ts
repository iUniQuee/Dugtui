/**
 * Web Push — browser тал.
 *
 * VAPID private key хэзээ ч browser руу орохгүй: public key-г `/api/push/key`
 * серверээс авч, subscription-ыг Supabase-д (зөвхөн админ) хадгална.
 */

import { supabase } from '@/lib/supabase';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function bufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  const keyData = keyRes ? ((await keyRes.json().catch(() => null)) as { publicKey?: string } | null) : null;
  const publicKey = keyData?.publicKey || '';
  if (!publicKey) {
    throw new Error('Серверт VAPID_PUBLIC_KEY тохируулаагүй байна.');
  }

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

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    }));

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

  return 'Мэдэгдэл тохируулагдлаа. Төлбөр, татах хүсэлт ирэхэд утсан дээр мэдэгдэнэ.';
}

/**
 * Админы утсанд push илгээхийг серверээс хүсэ. Алдаа гарвал төлбөрийн
 * урсгалыг зогсоохгүй (мэдэгдэл бол нэмэлт).
 */
export async function notifyAdmin(
  payload:
    | { kind: 'payment'; roomId: string }
    | { kind: 'withdrawal'; amount: number }
    | { kind: 'contribution'; contributionId: string }
): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const body =
      payload.kind === 'payment'
        ? { kind: 'payment', room_id: payload.roomId }
        : payload.kind === 'withdrawal'
          ? { kind: 'withdrawal', amount: payload.amount }
          : { kind: 'contribution', contribution_id: payload.contributionId };
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

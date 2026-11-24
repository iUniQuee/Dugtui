/**
 * Бүртгэлгүй хэрэглэгч бэлгийн линкээр (`/?room=…` эсвэл `/?gift=…`) орж
 * ирээд нэвтрэх/бүртгүүлэх үед линкний утгыг хөтөч дээр түр хадгалж,
 * нэвтэрсний дараа шууд тэр хуудас руу буцаж ороход ашиглана.
 * Ингэснээр хэрэглэгч бэлгээ алдахгүй.
 */

const KEYS = {
  room: 'dugtui_pending_room',
  gift: 'dugtui_pending_gift',
} as const;

export type PendingKind = keyof typeof KEYS;

// Хэт хуучин хадгалсан линк санамсаргүй өөр хуудас руу шидэхгүйн тулд 7 хоног.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredLink {
  value: string;
  at: number;
}

function read(kind: PendingKind): StoredLink | null {
  try {
    const raw = localStorage.getItem(KEYS[kind]);
    if (!raw) return null;
    // Хуучин формат (зүгээр утга, эсвэл { code, at }) болон шинэ { value, at }
    // бүгдийг дэмжинэ.
    const parsed: unknown = raw.trim().startsWith('{') ? JSON.parse(raw) : raw;
    const record = (parsed ?? {}) as { value?: unknown; code?: unknown; at?: unknown };
    const value = typeof parsed === 'string' ? parsed : (record.value ?? record.code);
    const at = typeof parsed === 'string' ? Date.now() : Number(record.at) || 0;
    if (typeof value !== 'string' || !value.trim()) return null;
    if (at && Date.now() - at > MAX_AGE_MS) return null;
    return { value: value.trim(), at };
  } catch {
    return null;
  }
}

/** Линкний утгыг (өрөөний код эсвэл бэлгийн токен) түр хадгална. */
export function rememberLink(kind: PendingKind, value: string) {
  const clean = value.trim();
  if (!clean) return;
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify({ value: clean, at: Date.now() }));
  } catch {
    /* localStorage боломжгүй орчинд алгасна */
  }
}

/** Хадгалсан линкийг уншиж, дараа нь давтахгүйн тулд устгана. */
export function takePendingLink(kind: PendingKind): string | null {
  const stored = read(kind);
  try {
    localStorage.removeItem(KEYS[kind]);
  } catch {
    /* алгасна */
  }
  return stored?.value ?? null;
}

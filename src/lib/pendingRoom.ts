/**
 * Бүртгэлгүй хэрэглэгч `/?room=…` линкээр орж ирээд нэвтрэх/бүртгүүлэх үед
 * өрөөний кодыг хөтөч дээр түр хадгалж, нэвтэрсний дараа шууд тэр өрөө рүү
 * буцаж ороход ашиглана. Ингэснээр хэрэглэгч бэлгийн линкээ алдахгүй.
 */

const STORAGE_KEY = 'dugtui_pending_room';
// Хэт хуучин хадгалсан код санамсаргүй өөр хуудас руу шидэхгүйн тулд 7 хоног.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredRoom {
  code: string;
  at: number;
}

function read(): StoredRoom | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Хуучин формат (зүгээр код) болон JSON хоёуланг дэмжинэ.
    const parsed: unknown = raw.trim().startsWith('{') ? JSON.parse(raw) : raw;
    const code =
      typeof parsed === 'string' ? parsed : (parsed as { code?: unknown } | null)?.code;
    const at =
      typeof parsed === 'string'
        ? Date.now()
        : Number((parsed as { at?: unknown } | null)?.at) || 0;
    if (typeof code !== 'string' || !code.trim()) return null;
    if (at && Date.now() - at > MAX_AGE_MS) return null;
    return { code: code.trim().toUpperCase(), at };
  } catch {
    return null;
  }
}

/** Өрөөний кодыг түр хадгална (нэвтрэхээс өмнө). */
export function rememberRoom(code: string) {
  const clean = code.trim().toUpperCase();
  if (!clean) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: clean, at: Date.now() }));
  } catch {
    /* localStorage боломжгүй орчинд алгасна */
  }
}

/** Хадгалсан өрөөг уншиж, дараа нь давтахгүйн тулд устгана. */
export function takePendingRoom(): string | null {
  const stored = read();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* алгасна */
  }
  return stored?.code ?? null;
}

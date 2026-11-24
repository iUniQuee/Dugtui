export const FEE_RATE = 0.02;

/** Санамсаргүй хуваалтын хамгийн бага нэгж — зөвхөн 100₮-өөр бүхэлдсэн дүн гарна. */
export const SPLIT_UNIT = 100;
/** Өрөө үүсгэх доод хязгаар (азтан & хамтын бэлгийн зорилтот дүн). */
export const MIN_ROOM_AMOUNT = 10000;
/** Хамтын бэлэгт нэг удаа нэмэрлэх доод дүн. */
export const MIN_CONTRIBUTION_AMOUNT = 5000;
/** Хэтэвчнээс банк руу татах үед суутгах шимтгэл. */
export const WITHDRAW_FEE = 200;
/** Татах товч идэвхжихийн тулд үлдэгдэл үүнээс дээш байх ёстой. */
export const MIN_WITHDRAW_BALANCE = 5000;

export function formatMNT(amount: number): string {
  return new Intl.NumberFormat('mn-MN').format(amount) + '₮';
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * `units` нэгжийг `count` оролцогчид цэвэр санамсаргүйгээр хуваана.
 * 0 нэгж (хоосон дугтуй) таарах боломжтой, нийлбэр нь яг `units`.
 * Арга: `units + count - 1` боломжит байрлалаас `count - 1` зүсэлтийг
 * санамсаргүй сонгож, хоорондын зайг тоолно (жигд санамсаргүй бүрдэл).
 */
function randomUnits(units: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [units];
  const span = units + count - 1;
  const cuts = new Set<number>();
  while (cuts.size < count - 1) cuts.add(1 + Math.floor(Math.random() * span));
  const sorted = [...cuts].sort((a, b) => a - b);
  const bounds = [0, ...sorted, span + 1];
  return Array.from({ length: count }, (_, i) => bounds[i + 1] - bounds[i] - 1);
}

/**
 * Нийт дүнг оролцогчдод 100% бүрэн хуваарилна (нэг ч ₮ дутахгүй/илүү гарахгүй).
 * Дүнгүүд зөвхөн 100₮-өөр бүхэлдэнэ (8,500₮ / 4,200₮ / 0₮ гэх мэт).
 * «random» — цэвэр санамсаргүй, 0₮ (хоосон дугтуй) таарч болно.
 */
export function splitAmount(total: number, count: number, mode: 'equal' | 'random'): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(0, Math.floor(total));
  const units = Math.floor(safeTotal / SPLIT_UNIT);
  // 100₮-д бүхэлдэхгүй үлдэгдлийг (0–99₮) санамсаргүй нэг дугтуйд нэмж,
  // нийт дүнг яг 100% хуваарилна.
  const rest = safeTotal - units * SPLIT_UNIT;

  let unitAmounts: number[];
  if (mode === 'equal') {
    // Тэнцүү хуваах: 100₮-ийн нэгжийг тэнцүү хувааж, үлдэгдлийг эхнийхүүдэд нэмнэ.
    const base = Math.floor(units / count);
    const rem = units - base * count;
    unitAmounts = Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
  } else {
    unitAmounts = randomUnits(units, count);
  }

  const amounts = unitAmounts.map((u) => u * SPLIT_UNIT);
  if (rest > 0) amounts[Math.floor(Math.random() * count)] += rest;
  return amounts;
}

export interface ThemeDef {
  id: 'tsagaan_sar' | 'shine_jil' | 'birthday' | 'normal';
  label: string;
  emojiHint: string;
  hero: string;
  gradient: string;
  accent: string;
  ring: string;
  cardBg: string;
  pageBg: string;
  greeting: string;
  revealEmoji: string;
  revealLabel: string;
  overlay: 'khadag' | 'snow' | 'balloons' | 'none';
}

export const THEMES: ThemeDef[] = [
  {
    id: 'tsagaan_sar',
    label: 'Цагаан сар',
    emojiHint: '🥛',
    hero: 'from-orange-100 via-amber-50 to-white',
    gradient: 'from-amber-500 to-orange-600',
    accent: 'text-amber-600',
    ring: 'ring-amber-400',
    cardBg: 'bg-amber-50',
    pageBg: 'from-amber-100 via-orange-50 to-white',
    greeting: 'Сар шинэдээ сайхан шинэлэж, айлболон амгалан жаргаарай!',
    revealEmoji: '🎲',
    revealLabel: 'Шагай',
    overlay: 'khadag',
  },
  {
    id: 'shine_jil',
    label: 'Шинэ жил',
    emojiHint: '🎄',
    hero: 'from-rose-100 via-red-50 to-white',
    gradient: 'from-red-500 to-rose-600',
    accent: 'text-red-600',
    ring: 'ring-red-400',
    cardBg: 'bg-red-50',
    pageBg: 'from-red-100 via-rose-50 to-white',
    greeting: 'Шинэ оны баярын мэнд хүргэе, 2026 он тань үр бүтээлт, жаргалант байг!',
    revealEmoji: '🎁',
    revealLabel: 'Бэлэг',
    overlay: 'snow',
  },
  {
    id: 'birthday',
    label: 'Төрсөн өдөр',
    emojiHint: '🎂',
    hero: 'from-sky-100 via-cyan-50 to-white',
    gradient: 'from-sky-500 to-cyan-600',
    accent: 'text-sky-600',
    ring: 'ring-sky-400',
    cardBg: 'bg-sky-50',
    pageBg: 'from-pink-100 via-sky-50 to-white',
    greeting: 'Төрсөн өдрийн баяр хүргэе, хүсэл бүхэн чинь биелэгээрэй!',
    revealEmoji: '🎂',
    revealLabel: 'Бялуу',
    overlay: 'balloons',
  },
  {
    id: 'normal',
    label: 'Энгийн',
    emojiHint: '🎁',
    hero: 'from-stone-100 via-neutral-50 to-white',
    gradient: 'from-stone-500 to-neutral-600',
    accent: 'text-stone-600',
    ring: 'ring-stone-400',
    cardBg: 'bg-stone-50',
    pageBg: 'from-stone-100 via-neutral-50 to-white',
    greeting: 'Бэлгийн мэнд хүргэе!',
    revealEmoji: '🎁',
    revealLabel: 'Дугтуй',
    overlay: 'none',
  },
];

export function themeOf(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[3];
}

export const BANKS = [
  'Хаан банк',
  'Голомт банк',
  'Хасбанк',
  'Худалдаа хөгжлийн банк',
  'Монгол пост банк',
  'Арай банк',
  'Capital банк',
  'State банк',
];

export const MONGOORI_PARTNERS = ['Хаан банк', 'Голомт банк', 'Хасбанк', 'Худалдаа хөгжлийн банк'];

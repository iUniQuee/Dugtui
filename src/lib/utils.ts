export const FEE_RATE = 0.02;

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

export function splitAmount(total: number, count: number, mode: 'equal' | 'random'): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(0, Math.floor(total));

  // Тэнцүү хуваах: нийт дүн / оролцогчдын тоо (үлдэгдлийг 1₮-өөр тараана).
  if (mode === 'equal' || safeTotal < count) {
    const base = Math.floor(safeTotal / count);
    const remainder = safeTotal - base * count;
    return Array.from({ length: count }, (_, i) => (i < remainder ? base + 1 : base));
  }

  // Санамсаргүй хуваах: санамсаргүй жинтэй, доод хэмжээ 1₮,
  // нийлбэр яг нийт дүнтэй тэнцэнэ.
  const weights = Array.from({ length: count }, () => 0.5 + Math.random());
  const sum = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map((w) => Math.max(1, Math.floor((w / sum) * safeTotal)));

  // Бөөрөнхийлөлтийн зөрүүг 1₮-өөр тараана.
  let diff = safeTotal - amounts.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (diff !== 0 && guard < 100000) {
    const idx = (Math.random() * count) | 0;
    if (diff > 0) {
      amounts[idx] += 1;
      diff -= 1;
    } else if (amounts[idx] > 1) {
      amounts[idx] -= 1;
      diff += 1;
    }
    guard += 1;
  }

  // Дүнгүүдийг аль болох ялгаатай болгоно (нийлбэр хэвээр).
  for (let attempt = 0; attempt < count * 4; attempt += 1) {
    const dupIdx = amounts.findIndex((a, i) => amounts.indexOf(a) !== i);
    if (dupIdx === -1) break;
    const maxIdx = amounts.indexOf(Math.max(...amounts));
    if (maxIdx === dupIdx || amounts[maxIdx] <= 2) break;
    amounts[maxIdx] -= 1;
    amounts[dupIdx] += 1;
  }

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

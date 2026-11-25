import { useEffect, useRef } from 'react';

/**
 * Баярын загвар бүрт тохирсон, ар талын хөдөлгөөнт чимэглэл.
 *
 *   🥛 Цагаан сар - дулаан алтан туяа + бударч унах алтан оч, зоос
 *   🎄 Шинэ жил   - том/дунд/жижиг цасан ширхэг салхинд найган буух
 *   🎂 Төрсөн өдөр - уяатай бөмбөлгүүд дээш хөөрөх + өнгөлөг тууз
 *   🎁 Энгийн      - зүрх, од, оч агаарт хөвж анивчих
 *
 * Бүх чимэглэл нэг Canvas дээр requestAnimationFrame-аар зурагддаг тул олон
 * DOM элемент үүсгэхгүй, гар утас болон компьютер дээр жигд 60fps ажиллана.
 * Тунгалагийг бага байлгаж, текстийг уншихад саад болохгүй.
 */

type ThemeKey = 'tsagaan_sar' | 'shine_jil' | 'birthday' | 'normal';

const TAU = Math.PI * 2;

function themeKey(theme: string): ThemeKey {
  if (theme === 'tsagaan_sar' || theme === 'shine_jil' || theme === 'birthday') return theme;
  return 'normal';
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Тогтвортой, давтагдашгүй байрлал үүсгэх жижиг PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = 'coin' | 'spark' | 'star' | 'flake' | 'balloon' | 'ribbon' | 'heart';

interface P {
  kind: Kind;
  x: number;
  y: number;
  size: number;
  speed: number;
  sway: number;
  swaySpeed: number;
  phase: number;
  rot: number;
  spin: number;
  alpha: number;
  color: string;
}

const GOLD = ['#fde68a', '#fcd34d', '#fbbf24', '#f59e0b'];
const GOLD_GLOW = ['253,230,138', '251,191,36', '252,211,77'];
const PASTEL = ['#fb7185', '#38bdf8', '#fbbf24', '#a78bfa', '#34d399', '#f472b6'];
const HEART_COLORS = ['#fb7185', '#f472b6', '#ef4444', '#fda4af'];
const STAR_COLORS = ['#fde68a', '#fbbf24', '#c4b5fd', '#fcd34d'];
const SPARK_GLOW = ['253,230,138', '251,191,36', '251,113,133', '196,181,253'];

const seedOf: Record<ThemeKey, number> = {
  tsagaan_sar: 11,
  shine_jil: 22,
  birthday: 33,
  normal: 44,
};

function seedScene(key: ThemeKey, w: number, h: number): P[] {
  const rnd = mulberry32(seedOf[key]);
  const R = (a: number, b: number) => a + rnd() * (b - a);
  const pick = (arr: string[]) => arr[Math.floor(rnd() * arr.length)];
  const ps: P[] = [];

  if (key === 'tsagaan_sar') {
    for (let i = 0; i < 13; i++) {
      ps.push({
        kind: 'coin',
        x: R(-40, w + 40),
        y: R(0, h + 280),
        size: R(4.5, 9),
        speed: R(15, 30),
        sway: R(8, 20),
        swaySpeed: R(0.25, 0.55),
        phase: R(0, TAU),
        rot: R(0, TAU),
        spin: R(-0.5, 0.5),
        alpha: R(0.35, 0.58),
        color: '#fbbf24',
      });
    }
    for (let i = 0; i < 30; i++) {
      ps.push({
        kind: 'spark',
        x: R(0, w),
        y: R(0, h + 240),
        size: R(1.6, 3.6),
        speed: R(6, 18),
        sway: R(4, 14),
        swaySpeed: R(0.3, 0.8),
        phase: R(0, TAU),
        rot: 0,
        spin: 0,
        alpha: R(0.4, 0.75),
        color: pick(GOLD_GLOW),
      });
    }
    for (let i = 0; i < 10; i++) {
      ps.push({
        kind: 'star',
        x: R(0, w),
        y: R(0, h + 240),
        size: R(3.5, 7.5),
        speed: R(5, 14),
        sway: R(6, 18),
        swaySpeed: R(0.3, 0.7),
        phase: R(0, TAU),
        rot: R(0, TAU),
        spin: R(-0.3, 0.3),
        alpha: R(0.45, 0.8),
        color: pick(GOLD),
      });
    }
  } else if (key === 'shine_jil') {
    for (let i = 0; i < 60; i++) {
      const tier = i % 3;
      ps.push({
        kind: 'flake',
        x: R(-30, w + 30),
        y: R(0, h + 220),
        size: tier === 0 ? R(26, 40) : tier === 1 ? R(14, 22) : R(6, 11),
        speed: tier === 0 ? R(13, 21) : tier === 1 ? R(22, 34) : R(34, 52),
        sway: tier === 0 ? R(26, 48) : tier === 1 ? R(14, 30) : R(8, 18),
        swaySpeed: tier === 0 ? R(0.18, 0.32) : R(0.3, 0.5),
        phase: R(0, TAU),
        rot: R(0, TAU),
        spin: R(-0.25, 0.25),
        alpha: tier === 0 ? R(0.42, 0.58) : tier === 1 ? R(0.52, 0.68) : R(0.6, 0.8),
        color: '#ffffff',
      });
    }
  } else if (key === 'birthday') {
    for (let i = 0; i < 10; i++) {
      ps.push({
        kind: 'balloon',
        x: R(24, w - 24),
        y: R(0, h + 340),
        size: R(20, 34),
        speed: R(12, 26),
        sway: R(16, 40),
        swaySpeed: R(0.3, 0.65),
        phase: R(0, TAU),
        rot: R(-0.06, 0.06),
        spin: 0,
        alpha: R(0.26, 0.42),
        color: pick(PASTEL),
      });
    }
    for (let i = 0; i < 22; i++) {
      ps.push({
        kind: 'ribbon',
        x: R(0, w),
        y: R(0, h + 340),
        size: R(9, 17),
        speed: R(20, 42),
        sway: R(10, 26),
        swaySpeed: R(0.5, 1.1),
        phase: R(0, TAU),
        rot: R(0, TAU),
        spin: R(-0.8, 0.8),
        alpha: R(0.3, 0.55),
        color: pick(PASTEL),
      });
    }
  } else {
    for (let i = 0; i < 12; i++) {
      ps.push({
        kind: 'heart',
        x: R(0, w),
        y: R(0, h + 260),
        size: R(7, 14),
        speed: R(7, 16),
        sway: R(12, 30),
        swaySpeed: R(0.25, 0.55),
        phase: R(0, TAU),
        rot: R(-0.25, 0.25),
        spin: R(-0.1, 0.1),
        alpha: R(0.3, 0.5),
        color: pick(HEART_COLORS),
      });
    }
    for (let i = 0; i < 16; i++) {
      ps.push({
        kind: 'star',
        x: R(0, w),
        y: R(0, h + 260),
        size: R(3, 7),
        speed: R(5, 12),
        sway: R(14, 34),
        swaySpeed: R(0.3, 0.7),
        phase: R(0, TAU),
        rot: R(0, TAU),
        spin: R(-0.2, 0.2),
        alpha: R(0.4, 0.75),
        color: pick(STAR_COLORS),
      });
    }
    for (let i = 0; i < 24; i++) {
      ps.push({
        kind: 'spark',
        x: R(0, w),
        y: R(0, h + 240),
        size: R(1.4, 3.2),
        speed: R(4, 10),
        sway: R(6, 16),
        swaySpeed: R(0.3, 0.8),
        phase: R(0, TAU),
        rot: 0,
        spin: 0,
        alpha: R(0.35, 0.7),
        color: pick(SPARK_GLOW),
      });
    }
  }

  return ps;
}

function makeSprite(size: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const c = cv.getContext('2d');
  if (c) {
    c.translate(size / 2, size / 2);
    paint(c);
  }
  return cv;
}

function makeCoinSprite(): HTMLCanvasElement {
  return makeSprite(64, (c) => {
    const g = c.createLinearGradient(-17, -19, 17, 19);
    g.addColorStop(0, '#fef3c7');
    g.addColorStop(0.5, '#fbbf24');
    g.addColorStop(1, '#d97706');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 25, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(180,83,9,0.85)';
    c.lineWidth = 3;
    c.stroke();
    c.strokeStyle = 'rgba(146,64,14,0.5)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, 17, 0, TAU);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath();
    c.ellipse(-8, -9, 7, 4, -0.6, 0, TAU);
    c.fill();
  });
}

function makeSnowSprite(): HTMLCanvasElement {
  return makeSprite(64, (c) => {
    const arms = (lineWidth: number, stroke: string) => {
      c.strokeStyle = stroke;
      c.lineWidth = lineWidth;
      c.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        c.save();
        c.rotate((i * Math.PI) / 3);
        c.beginPath();
        c.moveTo(0, -24);
        c.lineTo(0, 24);
        for (const dir of [-1, 1]) {
          c.moveTo(0, dir * 13);
          c.lineTo(6.5, dir * 19);
          c.moveTo(0, dir * 13);
          c.lineTo(-6.5, dir * 19);
          c.moveTo(0, dir * 20);
          c.lineTo(4, dir * 24);
          c.moveTo(0, dir * 20);
          c.lineTo(-4, dir * 24);
        }
        c.stroke();
        c.restore();
      }
    };
    // Цайвар дэвсгэр дээр ч харагдахын тулд зөөлөн ягаан контур, дээрээс нь цагаан.
    arms(7, 'rgba(190,24,93,0.16)');
    arms(3, 'rgba(255,255,255,1)');
  });
}

function makeGlowSprite(rgb: string): HTMLCanvasElement {
  return makeSprite(48, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 23);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.35, `rgba(${rgb},0.5)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 23, 0, TAU);
    c.fill();
  });
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
  alpha: number,
  rot = 0
) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  rot: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const k = r * 0.32;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(k, -k, r, 0);
  ctx.quadraticCurveTo(k, k, 0, r);
  ctx.quadraticCurveTo(-k, k, -r, 0);
  ctx.quadraticCurveTo(-k, -k, 0, -r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHeart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
  alpha: number,
  rot: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s / 16, s / 16);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 7);
  ctx.bezierCurveTo(-11, -1, -8, -13, 0, -7);
  ctx.bezierCurveTo(8, -13, 11, -1, 0, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBalloon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  color: string,
  alpha: number,
  t: number,
  phase: number
) {
  const bh = w * 1.22;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 0.5 + phase) * 0.1);
  ctx.strokeStyle = 'rgba(120,113,108,0.32)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(0, bh / 2 + 4);
  ctx.bezierCurveTo(
    Math.sin(t * 1.1 + phase) * 6,
    bh / 2 + 16,
    -Math.sin(t * 1.1 + phase) * 7,
    bh / 2 + 28,
    Math.sin(t * 0.9 + phase) * 5,
    bh / 2 + 36
  );
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, bh / 2, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-3.2, bh / 2 - 1);
  ctx.lineTo(3.2, bh / 2 - 1);
  ctx.lineTo(0, bh / 2 + 5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.ellipse(-w * 0.2, -bh * 0.2, w * 0.13, bh * 0.09, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  color: string,
  alpha: number,
  t: number,
  phase: number,
  rot: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot + Math.sin(t * 1.2 + phase) * 0.4);
  ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(t * 2 + phase));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  const seg = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let k = 1; k <= seg; k++) {
    ctx.lineTo(Math.sin(t * 1.8 + phase + k * 0.95) * 3.4, -k * (len / seg));
  }
  ctx.stroke();
  ctx.restore();
}

interface Sprites {
  coin: HTMLCanvasElement;
  snow: HTMLCanvasElement;
  glow: Map<string, HTMLCanvasElement>;
}

function render(
  ctx: CanvasRenderingContext2D,
  key: ThemeKey,
  w: number,
  h: number,
  t: number,
  ps: P[],
  sprites: Sprites
) {
  ctx.clearRect(0, 0, w, h);

  if (key === 'tsagaan_sar') {
    // Дулаан алтан туяа — дээд талаас зөөлөн буух гэрэл.
    const glow = ctx.createRadialGradient(w / 2, -h * 0.12, 0, w / 2, -h * 0.12, h * 1.05);
    glow.addColorStop(0, 'rgba(253,230,138,0.26)');
    glow.addColorStop(0.5, 'rgba(251,191,36,0.09)');
    glow.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const ray = ctx.createLinearGradient(0, 0, 0, h * 1.1);
    ray.addColorStop(0, 'rgba(253,230,138,0.16)');
    ray.addColorStop(0.6, 'rgba(252,211,77,0.05)');
    ray.addColorStop(1, 'rgba(252,211,77,0)');
    ctx.save();
    ctx.translate(w / 2, -h * 0.1);
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i - 2.5) * 0.19 + Math.sin(t * 0.12 + i * 0.8) * 0.02);
      ctx.globalAlpha = 0.5 + Math.sin(t * 0.35 + i * 0.9) * 0.18;
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.lineTo(56 + i * 9, h * 1.15);
      ctx.lineTo(-56 - i * 9, h * 1.15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  } else if (key === 'shine_jil') {
    // Цасан дээрх бүрхэг гэрэл.
    const glow = ctx.createRadialGradient(w * 0.5, -h * 0.05, 0, w * 0.5, -h * 0.05, h * 0.8);
    glow.addColorStop(0, 'rgba(255,255,255,0.34)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  } else if (key === 'birthday') {
    // Доод талаас дулаахан ягаан гэрэл.
    const glow = ctx.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.9);
    glow.addColorStop(0, 'rgba(244,114,182,0.1)');
    glow.addColorStop(1, 'rgba(244,114,182,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Зөөлөн дулаахан дэвсгэр.
    const warm = ctx.createRadialGradient(w * 0.15, h * 1.05, 0, w * 0.15, h * 1.05, h * 0.85);
    warm.addColorStop(0, 'rgba(251,191,36,0.14)');
    warm.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.globalAlpha = 0.75 + Math.sin(t * 0.25) * 0.25;
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);
    const rose = ctx.createRadialGradient(w * 0.88, h * 0.02, 0, w * 0.88, h * 0.02, h * 0.7);
    rose.addColorStop(0, 'rgba(251,113,133,0.1)');
    rose.addColorStop(1, 'rgba(251,113,133,0)');
    ctx.fillStyle = rose;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  const fall = (p: P, extra: number) => {
    const span = h + extra;
    return {
      x: p.x + Math.sin(p.phase + t * p.swaySpeed) * p.sway,
      y: mod(p.y + p.speed * t, span) - extra / 2,
    };
  };
  const rise = (p: P, extra: number) => {
    const span = h + extra;
    return {
      x: p.x + Math.sin(p.phase + t * p.swaySpeed) * p.sway,
      y: h + extra / 2 - mod(p.y + p.speed * t, span),
    };
  };

  for (const p of ps) {
    if (p.kind === 'coin') {
      const pos = fall(p, 280);
      drawSprite(ctx, sprites.coin, pos.x, pos.y, p.size * 2.56, p.alpha, p.rot + t * p.spin);
    } else if (p.kind === 'flake') {
      const pos = fall(p, 220);
      const twinkle = 0.85 + 0.15 * Math.sin(t * 0.9 + p.phase);
      drawSprite(
        ctx,
        sprites.snow,
        pos.x,
        pos.y,
        p.size,
        p.alpha * twinkle,
        p.rot + Math.sin(t * 0.6 + p.phase) * 0.35
      );
    } else if (p.kind === 'spark') {
      const pos = key === 'normal' ? rise(p, 240) : fall(p, 240);
      const img = sprites.glow.get(p.color);
      if (img) {
        const twinkle = 0.55 + 0.45 * Math.sin(t * 1.6 + p.phase);
        drawSprite(ctx, img, pos.x, pos.y, p.size * 2.1, p.alpha * twinkle);
      }
    } else if (p.kind === 'star') {
      const pos = key === 'normal' ? rise(p, 260) : fall(p, 240);
      const twinkle = 0.6 + 0.4 * Math.sin(t * 1.4 + p.phase);
      drawSparkle(ctx, pos.x, pos.y, p.size, p.color, p.alpha * twinkle, p.rot + t * p.spin);
    } else if (p.kind === 'balloon') {
      const pos = rise(p, 340);
      drawBalloon(ctx, pos.x, pos.y, p.size, p.color, p.alpha, t, p.phase);
    } else if (p.kind === 'ribbon') {
      const pos = rise(p, 340);
      drawRibbon(ctx, pos.x, pos.y, p.size, p.color, p.alpha, t, p.phase, p.rot + t * p.spin);
    } else {
      const pos = rise(p, 260);
      const twinkle = 0.8 + 0.2 * Math.sin(t * 1.2 + p.phase);
      drawHeart(
        ctx,
        pos.x,
        pos.y,
        p.size,
        p.color,
        p.alpha * twinkle,
        p.rot + Math.sin(t * 0.9 + p.phase) * 0.15
      );
    }
  }
}

export function GiftBgScene({ theme }: { theme: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const key = themeKey(theme);
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = window.innerWidth;
    let h = window.innerHeight;
    const particles = seedScene(key, w, h);

    const glow = new Map<string, HTMLCanvasElement>();
    for (const rgb of new Set([...GOLD_GLOW, ...SPARK_GLOW])) glow.set(rgb, makeGlowSprite(rgb));
    const sprites: Sprites = { coin: makeCoinSprite(), snow: makeSnowSprite(), glow };

    let raf = 0;
    let last = 0;
    let t = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduceMotion) render(ctx, key, w, h, 2.4, particles, sprites);
    };

    const frame = (now: number) => {
      if (!last) last = now;
      t += Math.min((now - last) / 1000, 0.05);
      last = now;
      render(ctx, key, w, h, t, particles, sprites);
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduceMotion && !raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    if (reduceMotion) {
      render(ctx, key, w, h, 2.4, particles, sprites);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}

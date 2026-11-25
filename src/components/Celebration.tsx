import { useEffect, useRef } from 'react';

/**
 * Баярын загварт тохирсон, дугтуй задрах мөчид 4.5 секунд ажилладаг
 * Canvas эффект. Гурван бэлгийн төрөл бүгд ижил компонентыг ашиглана.
 *
 *   🎂 Төрсөн өдөр - салют + дээш хөөрөх бөмбөлөг
 *   🎄 Шинэ жил     - зөөлөн цас + алтан салют
 *   🥛 Цагаан сар   - алтан зоосон бороо + алтан оч
 *   ❤️ Энгийн       - зүрх + конфетти
 *
 * Бүх хөдөлгөөн нэг canvas дээр, requestAnimationFrame-аар зурагддаг тул
 * олон зуун DOM элемент үүсгэхгүй, гар утас болон компьютер дээр жигд ажиллана.
 * Хэрэглэгч «хөдөлгөөн багасгах» тохиргоотой бол тоосонцрын тоо цөөрнө.
 */

type ThemeId = 'tsagaan_sar' | 'shine_jil' | 'birthday' | 'normal';

const DEFAULT_DURATION = 4500;
const TAU = Math.PI * 2;

const PALETTES: Record<ThemeId, string[]> = {
  birthday: ['#fb7185', '#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24'],
  shine_jil: ['#fecdd3', '#fda4af', '#fcd34d', '#fbbf24', '#fff7ed', '#f87171'],
  tsagaan_sar: ['#fbbf24', '#f59e0b', '#fcd34d', '#d97706', '#fde68a'],
  normal: ['#f472b6', '#ef4444', '#a855f7', '#fb7185', '#f59e0b', '#facc15'],
};

const GOLD = ['#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#fef3c7'];

function themeKey(theme: string): ThemeId {
  if (theme === 'tsagaan_sar' || theme === 'shine_jil' || theme === 'birthday') return theme;
  return 'normal';
}

type Kind = 'spark' | 'confetti' | 'balloon' | 'snow' | 'coin' | 'heart';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
  rot: number;
  vrot: number;
  sway: number;
  phase: number;
  gravity: number;
  drag: number;
}

export function Celebration({
  theme,
  duration = DEFAULT_DURATION,
}: {
  theme: string;
  duration?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const key = themeKey(theme);
    const palette = PALETTES[key];
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const density = reduceMotion ? 0.45 : 1;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = [];
    const maxParticles = key === 'tsagaan_sar' ? 280 : 340;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = () => palette[(Math.random() * palette.length) | 0];
    const pickGold = () => GOLD[(Math.random() * GOLD.length) | 0];

    const add = (p: Particle) => {
      if (particles.length < maxParticles) particles.push(p);
    };

    const base = (kind: Kind, extra: Partial<Particle>): Particle => ({
      kind,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      ttl: duration / 1000,
      size: 10,
      color: pick(),
      rot: 0,
      vrot: 0,
      sway: 0,
      phase: Math.random() * TAU,
      gravity: 0,
      drag: 0,
      ...extra,
    });

    /** Салют: нэг цэгээс радиалаар цацрах оч. */
    const burst = (cx: number, cy: number, gold: boolean) => {
      const count = Math.round((gold ? 24 : 32) * density);
      const colors = gold ? GOLD : palette;
      for (let i = 0; i < count; i++) {
        const angle = (TAU * i) / count + rand(-0.14, 0.14);
        const speed = rand(gold ? 110 : 130, gold ? 330 : 400);
        add(
          base('spark', {
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            ttl: rand(0.85, 1.6),
            size: rand(1.6, 3.4),
            color: colors[(Math.random() * colors.length) | 0],
            gravity: gold ? 130 : 190,
            drag: 1.6,
          })
        );
      }
    };

    let elapsed = 0;
    let lastTs: number | null = null;
    let raf = 0;

    let balloonAcc = 0;
    let snowAcc = 0;
    let coinAcc = 0;
    let sparkAcc = 0;
    let confettiAcc = 0;
    let heartAcc = 0;
    let nextBoom = rand(0.12, 0.45);

    const spawn = (dt: number) => {
      // --- Салют: төрсөн өдөр (өнгөлөг) ба шинэ жил (алтан) ---
      if (key === 'birthday' || key === 'shine_jil') {
        if (elapsed >= nextBoom) {
          burst(rand(width * 0.12, width * 0.88), rand(height * 0.1, height * 0.45), key === 'shine_jil');
          nextBoom = elapsed + rand(key === 'shine_jil' ? 0.6 : 0.42, key === 'shine_jil' ? 1.0 : 0.8);
        }
      }

      if (key === 'birthday') {
        // Дээш хөөрөх өнгөлөг бөмбөлөг
        balloonAcc += dt;
        while (balloonAcc >= 0.22) {
          balloonAcc -= 0.22;
          add(
            base('balloon', {
              x: rand(width * 0.05, width * 0.95),
              y: height + rand(20, 90),
              vy: -rand(70, 130),
              size: rand(13, 24),
              color: pick(),
              sway: rand(10, 26),
              ttl: rand(3.4, 4.6),
            })
          );
        }
      }

      if (key === 'shine_jil') {
        // Зөөлөн цас будрах
        snowAcc += dt;
        while (snowAcc >= 0.06) {
          snowAcc -= 0.06;
          add(
            base('snow', {
              x: rand(0, width),
              y: rand(-40, -6),
              vy: rand(26, 58),
              size: rand(1.4, 3.2),
              color: '#ffffff',
              sway: rand(8, 22),
              ttl: Math.max(1.6, duration / 1000 - elapsed + 0.4),
            })
          );
        }
      }

      if (key === 'tsagaan_sar') {
        // Алтан зоосон бороо
        coinAcc += dt;
        while (coinAcc >= 0.075) {
          coinAcc -= 0.075;
          add(
            base('coin', {
              x: rand(0, width),
              y: rand(-60, -10),
              vy: rand(110, 210),
              vx: rand(-14, 14),
              size: rand(7, 13),
              color: pickGold(),
              rot: Math.random() * TAU,
              vrot: rand(2.2, 5.2),
              sway: rand(6, 18),
              ttl: Math.max(1.8, duration / 1000 - elapsed + 0.5),
            })
          );
        }
        // Алтан оч цацагдах
        sparkAcc += dt;
        while (sparkAcc >= 0.045) {
          sparkAcc -= 0.045;
          add(
            base('spark', {
              x: rand(0, width),
              y: rand(height * 0.05, height * 0.75),
              vx: rand(-30, 30),
              vy: rand(-70, -20),
              ttl: rand(0.8, 1.5),
              size: rand(1.2, 2.8),
              color: pickGold(),
              gravity: -20,
              drag: 0.6,
            })
          );
        }
      }

      if (key === 'normal') {
        // Конфетти
        confettiAcc += dt;
        while (confettiAcc >= 0.035) {
          confettiAcc -= 0.035;
          add(
            base('confetti', {
              x: rand(-20, width + 20),
              y: rand(-40, -8),
              vy: rand(90, 190),
              vx: rand(-30, 30),
              size: rand(5, 10),
              color: pick(),
              rot: Math.random() * TAU,
              vrot: rand(-4, 4),
              ttl: Math.max(1.6, duration / 1000 - elapsed + 0.4),
            })
          );
        }
        // Зүрх
        heartAcc += dt;
        while (heartAcc >= 0.15) {
          heartAcc -= 0.15;
          add(
            base('heart', {
              x: rand(width * 0.04, width * 0.96),
              y: height + rand(10, 70),
              vy: -rand(60, 115),
              size: rand(9, 18),
              color: palette[(Math.random() * 3) | 0],
              sway: rand(10, 24),
              ttl: rand(3.2, 4.4),
            })
          );
        }
      }
    };

    const draw = (p: Particle, alpha: number) => {
      ctx.globalAlpha = alpha;
      if (p.kind === 'spark') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
        return;
      }
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size * 0.8, p.size, p.size * 1.6);
        ctx.restore();
        return;
      }
      if (p.kind === 'balloon') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 1.22, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, p.size * 1.22);
        ctx.lineTo(0, p.size * 2.5);
        ctx.stroke();
        ctx.restore();
        return;
      }
      if (p.kind === 'snow') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
        return;
      }
      if (p.kind === 'coin') {
        const squash = 0.3 + 0.7 * Math.abs(Math.cos(p.rot));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * squash, p.size, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * squash * 0.55, p.size * 0.55, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
        return;
      }
      // heart
      const s = p.size;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.sin(p.rot) * 0.25);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.42);
      ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.52, -s, 0, -s * 0.42);
      ctx.bezierCurveTo(s * 0.52, -s, s, -s * 0.3, 0, s * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const frame = (ts: number) => {
      if (lastTs === null) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;
      elapsed += dt;

      ctx.clearRect(0, 0, width, height);

      if (elapsed <= duration / 1000) spawn(dt);

      // Төгсгөлд нь зөөлөн бүдгэрүүлнэ.
      const tail = duration / 1000 + 0.55 - elapsed;
      const globalAlpha = tail < 0.55 ? Math.max(0, tail / 0.55) : 1;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.ttl) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += p.gravity * dt;
        p.vx *= Math.exp(-p.drag * dt);
        p.vy *= Math.exp(-p.drag * dt);
        p.x += p.vx * dt + Math.sin(p.phase + elapsed * 2.1) * p.sway * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;

        if (p.y > height + 120 || p.x < -120 || p.x > width + 120) {
          particles.splice(i, 1);
          continue;
        }

        const fade = Math.min(1, (p.ttl - p.life) / 0.45);
        draw(p, Math.max(0, Math.min(1, fade)) * globalAlpha);
      }
      ctx.globalAlpha = 1;

      // Бүх тоосонцор алга болсны дараа циклийг бүрэн зогсооно.
      if (particles.length === 0 && elapsed > duration / 1000 + 0.6) return;
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [theme, duration]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50"
    />
  );
}

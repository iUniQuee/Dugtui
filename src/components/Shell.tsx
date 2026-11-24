import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Gift, Sparkles, PartyPopper } from 'lucide-react';
import { themeOf } from '@/lib/utils';

export function GiftBg({ theme }: { theme: string }) {
  const t = themeOf(theme);
  return (
    <>
      <div className={`fixed inset-0 -z-10 bg-gradient-to-br ${t.pageBg}`} />
      {t.overlay === 'khadag' && <KhadagOverlay />}
      {t.overlay === 'snow' && <SnowOverlay />}
      {t.overlay === 'balloons' && <BalloonOverlay />}
    </>
  );
}

function KhadagOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg className="absolute top-0 left-1/2 -translate-x-1/2 w-64 opacity-20" viewBox="0 0 200 400" fill="none">
        <path d="M100 0v400" stroke="#b45309" strokeWidth="2" />
        {[80, 160, 240, 320].map((y) => (
          <g key={y} stroke="#b45309" strokeWidth="2" fill="none">
            <path d={`M100 ${y} q-30 20 -60 0 q30 20 60 0 q30 -20 60 0 q-30 -20 -60 0`} />
            <circle cx="100" cy={y + 10} r="4" fill="#b45309" />
          </g>
        ))}
      </svg>
    </div>
  );
}

function SnowOverlay() {
  const flakes = Array.from({ length: 30 }, (_, i) => ({
    left: (i * 37) % 100,
    d: 6 + ((i * 13) % 8),
    delay: (i % 10) * 0.7,
    size: 10 + ((i * 7) % 14),
  }));
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {flakes.map((f, i) => (
        <motion.span
          key={i}
          className="absolute text-white select-none"
          style={{ left: `${f.left}%`, fontSize: f.size }}
          initial={{ y: -30, opacity: 0.7 }}
          animate={{ y: '110vh', x: [0, 30, -20, 0] }}
          transition={{ duration: f.d, delay: f.delay, repeat: Infinity, ease: 'linear' }}
        >
          ❄
        </motion.span>
      ))}
    </div>
  );
}

function BalloonOverlay() {
  const balloons = Array.from({ length: 8 }, (_, i) => ({
    left: 5 + i * 12,
    d: 9 + (i % 5) * 2,
    delay: i * 1.6,
    color: ['#f472b6', '#38bdf8', '#facc15', '#f87171', '#34d399'][i % 5],
  }));
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {balloons.map((b, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ left: `${b.left}%`, width: 26, height: 34, background: b.color, opacity: 0.35 }}
          initial={{ y: '110vh' }}
          animate={{ y: -60, x: [0, 18, -12, 0] }}
          transition={{ duration: b.d, delay: b.delay, repeat: Infinity, ease: 'linear' }}
        />
      ))}
    </div>
  );
}

export function Confetti({ count = 60 }: { count?: number }) {
  const [pieces, setPieces] = useState<
    { x: number; d: number; delay: number; color: string; rot: number }[]
  >([]);
  useEffect(() => {
    const colors = ['#f59e0b', '#ef4444', '#0ea5e9', '#10b981', '#f97316'];
    setPieces(
      Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        d: 3 + Math.random() * 1.2,
        delay: Math.random() * 0.8,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * 360,
      }))
    );
  }, [count]);
  if (!pieces.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-50">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute block rounded-sm"
          style={{
            left: `${p.x}%`,
            width: 8,
            height: 14,
            background: p.color,
            rotate: p.rot,
          }}
          initial={{ y: -30, opacity: 1 }}
          animate={{ y: '110vh', rotate: 360 }}
          transition={{ duration: p.d, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

export function Spinner({ label = 'Уншиж байна...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 gap-3 text-neutral-500">
      <Sparkles className="w-5 h-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="max-w-md mx-auto mt-20 text-center rounded-2xl bg-white shadow-lg border border-neutral-200 p-8">
      <PartyPopper className="w-10 h-10 text-neutral-300 mx-auto mb-3" />
      <p className="text-neutral-700">{message}</p>
    </div>
  );
}

export function Money({ amount, className = '' }: { amount: number; className?: string }) {
  return (
    <span className={className}>
      {new Intl.NumberFormat('mn-MN').format(amount)}
      <span className="ml-1">₮</span>
    </span>
  );
}

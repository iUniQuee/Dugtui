import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, PartyPopper } from 'lucide-react';
import { themeOf } from '@/lib/utils';
import { GiftBgScene } from './GiftBgScene';

export function GiftBg({ theme }: { theme: string }) {
  const t = themeOf(theme);
  return (
    <>
      <div className={`fixed inset-0 -z-10 bg-gradient-to-br ${t.pageBg}`} />
      <GiftBgScene theme={t.id} />
    </>
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

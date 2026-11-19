import { motion } from 'framer-motion';
import { Gift, MousePointerClick } from 'lucide-react';
import type { Room } from '@/lib/supabase';
import { GiftBg, Confetti, Money } from '@/components/Shell';
import { themeOf } from '@/lib/utils';
import { useState } from 'react';

export function GiftCardRoom({ room }: { room: Room }) {
  const theme = themeOf(room.theme);
  const [opened, setOpened] = useState(false);

  if (!opened) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GiftBg theme={room.theme} />
        <div className="text-center">
          <motion.button
            onClick={() => setOpened(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="relative"
          >
            <motion.div
              animate={{ rotate: [-2, 2, -2], y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 2.4 }}
              className={`w-56 h-56 rounded-3xl shadow-2xl bg-gradient-to-br ${theme.gradient} flex items-center justify-center`}
            >
              <Gift className="w-20 h-20 text-white" />
            </motion.div>
          </motion.button>
          <h1 className="mt-8 text-2xl font-bold text-neutral-900">Танд бэлэг ирлээ!</h1>
          <p className="mt-2 text-neutral-500 flex items-center justify-center gap-1 text-sm">
            <MousePointerClick className="w-4 h-4" /> Дарж нээнэ үү
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <GiftBg theme={room.theme} />
      <Confetti />
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.4 }}
        className={`w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden bg-gradient-to-br ${theme.gradient} text-white`}
      >
        {room.image_url && (
          <img src={room.image_url} alt="" className="w-full h-48 object-cover" />
        )}
        <div className="p-8 text-center">
          <h1 className="text-xl font-bold">{room.title}</h1>
          {room.organizer_name && (
            <p className="mt-1 text-sm opacity-80">— {room.organizer_name}</p>
          )}
          {room.message && <p className="mt-4 text-sm leading-relaxed opacity-95">{room.message}</p>}
          <div className="mt-6 rounded-2xl bg-white/15 backdrop-blur px-6 py-4">
            <p className="text-xs opacity-80">Бэлгийн дүн</p>
            <Money amount={room.total_amount} className="text-3xl font-extrabold" />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

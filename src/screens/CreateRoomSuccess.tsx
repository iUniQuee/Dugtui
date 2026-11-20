import { motion } from 'framer-motion';
import { Check, Copy, PartyPopper, Sparkles } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { GiftBg } from '@/components/Shell';
import type { Room } from '@/lib/supabase';

/** Өрөө амжилттай үүссэний дарагх дэлгэц: код, хуваалцах линк, QR. */
export function CreateRoomSuccess({
  room,
  shareUrl,
  copied,
  onCopy,
}: {
  room: Room;
  shareUrl: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <GiftBg theme={room.theme} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md text-center"
      >
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5 }}>
          <PartyPopper className="w-16 h-16 text-emerald-500 mx-auto" />
        </motion.div>
        <h1 className="mt-4 text-2xl font-bold text-neutral-900">Таны өрөө бэлэн боллоо!</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Энэ линк, QR кодыг оролцогчдодоо илгээнэ үү.
        </p>

        <div className="mt-6 rounded-3xl border border-neutral-200 bg-white p-6 shadow-lg text-left">
          <div>
            <p className="text-xs text-neutral-500">Өрөөний код</p>
            <p className="text-2xl font-mono font-bold tracking-widest text-neutral-900">
              {room.code}
            </p>
          </div>
          <div className="mt-4">
            <p className="text-xs text-neutral-500">Хуваалцах линк</p>
            <p className="mt-1 text-sm text-neutral-800 break-all bg-neutral-50 rounded-lg px-3 py-2">
              {shareUrl}
            </p>
          </div>
          <div className="mt-4 flex justify-center rounded-2xl border-4 border-neutral-900 p-4 w-fit mx-auto bg-white">
            <QRCodeSVG value={shareUrl} size={180} />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={onCopy}
              className="flex-1 rounded-xl bg-neutral-900 text-white px-4 py-2.5 font-medium hover:bg-neutral-700 transition-colors flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Хуулагдлаа' : 'Линк хуулах'}
            </button>
          </div>
        </div>

        <button
          onClick={() => (window.location.href = `/?room=${room.code}`)}
          className="mt-6 w-full max-w-md rounded-xl bg-gradient-to-r from-red-500 to-amber-500 text-white py-3.5 font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Өрөөндөө орох
        </button>
      </motion.div>
    </div>
  );
}

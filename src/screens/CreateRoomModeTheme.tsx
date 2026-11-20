import { Sparkles } from 'lucide-react';
import type { Room } from '@/lib/supabase';
import { THEMES } from '@/lib/utils';

export type Mode = 'lucky_draw' | 'group_pool' | 'gift_card';

export const MODE_LABELS: Record<Mode, string> = {
  lucky_draw: 'Азын дугтуй',
  group_pool: 'Хамтын бэлэг',
  gift_card: 'Мэндчилгээт бэлэг',
};

/** Бэлгийн төрөл болон загвар сонгох хэсэг. */
export function CreateRoomModeTheme({
  mode,
  onMode,
  theme,
  onTheme,
  messageTouched,
  onGreeting,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  theme: Room['theme'];
  onTheme: (t: Room['theme']) => void;
  messageTouched: boolean;
  onGreeting: (greeting: string) => void;
}) {
  return (
    <>
      {/* gift mode */}
      <div>
        <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Бэлгийн төрөл</span>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={`rounded-xl border-2 px-2 py-3 text-sm font-medium transition-all ${
                mode === m
                  ? 'border-red-500 bg-red-50 text-neutral-900'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* theme */}
      <div>
        <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Загвар</span>
        <div className="grid grid-cols-4 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onTheme(t.id);
                if (!messageTouched) onGreeting(t.greeting);
              }}
              className={`rounded-xl border-2 px-1 py-3 text-center transition-all ${
                theme === t.id
                  ? `border-red-500 bg-gradient-to-br ${t.gradient} text-white shadow`
                  : 'border-neutral-200 bg-white hover:border-neutral-300'
              }`}
            >
              <div className="text-2xl">{t.emojiHint}</div>
              <div className={`mt-1 text-xs font-medium ${theme === t.id ? 'text-white' : 'text-neutral-700'}`}>
                {t.label}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-400 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Загвар сонгоход дэвсгэр, анимац, мэндчилгээ автоматаар өөрчлөгдөнө.
        </p>
      </div>
    </>
  );
}

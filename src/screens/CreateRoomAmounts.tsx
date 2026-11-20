import { Money } from '@/components/Shell';
import type { Mode } from '@/screens/CreateRoomModeTheme';

/** Дүн, оролцогчдын тоо болон хуваарилалтын төрөл сонгох хэсэг. */
export function CreateRoomAmounts({
  mode,
  total,
  onTotal,
  people,
  onPeople,
  splitMode,
  onSplitMode,
  totalNum,
  peopleNum,
}: {
  mode: Mode;
  total: string;
  onTotal: (v: string) => void;
  people: string;
  onPeople: (v: string) => void;
  splitMode: 'equal' | 'random';
  onSplitMode: (m: 'equal' | 'random') => void;
  totalNum: number;
  peopleNum: number;
}) {
  return (
    <>
      {/* amount + participants */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-neutral-700 mb-1.5 block">
            {mode === 'group_pool' ? 'Зорилтот дүн (MNT)' : 'Нийт дүн (MNT)'}
          </span>
          <input
            value={total}
            onChange={(e) => onTotal(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="200000"
            className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </label>
        {mode === 'lucky_draw' ? (
          <label className="block">
            <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Оролцогчдын тоо</span>
            <input
              value={people}
              onChange={(e) => onPeople(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="10"
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </label>
        ) : (
          <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3 flex items-center text-sm text-neutral-500">
            {mode === 'gift_card' ? 'Ганц хүнд зориулсан бэлэг' : 'Олон хүн нэмэр оруулна'}
          </div>
        )}
      </div>

      {/* distribution type (lucky draw only) */}
      {mode === 'lucky_draw' && (
        <div>
          <span className="text-sm font-medium text-neutral-700 mb-1.5 block">Хуваарилалтын төрөл</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onSplitMode('random')}
              className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition-all ${
                splitMode === 'random'
                  ? 'border-red-500 bg-red-50 text-neutral-900'
                  : 'border-neutral-200 bg-white text-neutral-600'
              }`}
            >
              Санамсаргүй хуваах
            </button>
            <button
              type="button"
              onClick={() => onSplitMode('equal')}
              className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition-all ${
                splitMode === 'equal'
                  ? 'border-red-500 bg-red-50 text-neutral-900'
                  : 'border-neutral-200 bg-white text-neutral-600'
              }`}
            >
              Тэнцүү хуваах
            </button>
          </div>
          {totalNum > 0 && peopleNum > 0 && splitMode === 'equal' && (
            <p className="mt-2 text-sm text-neutral-500">
              Хүн бүрд <Money amount={Math.floor(totalNum / peopleNum)} className="font-semibold" /> хүртэнэ.
            </p>
          )}
        </div>
      )}
    </>
  );
}

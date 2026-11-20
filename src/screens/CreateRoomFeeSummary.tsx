import { Money } from '@/components/Shell';
import { FEE_RATE } from '@/lib/utils';

/** Төлбөрийн дүнгийн хураангуй (бэлэг + шимтгэл = нийт). */
export function CreateRoomFeeSummary({
  isFree,
  totalNum,
  fee,
  grand,
}: {
  isFree: boolean;
  totalNum: number;
  fee: number;
  grand: number;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-2">
      {isFree ? (
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Зорилтот дүн</span>
          <Money amount={totalNum} className="font-medium text-neutral-900" />
        </div>
      ) : (
        <>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500">Бэлгийн дүн</span>
            <Money amount={totalNum} className="font-medium text-neutral-900" />
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500">Үйлчилгээний шимтгэл ({(FEE_RATE * 100).toFixed(0)}%)</span>
            <Money amount={fee} className="font-medium text-neutral-900" />
          </div>
        </>
      )}
      <div className="border-t border-neutral-100 pt-2 flex justify-between font-bold">
        <span className="text-neutral-900">{isFree ? 'Өрөө үүсгэх' : 'Нийт төлөх'}</span>
        <Money amount={grand} className={isFree ? 'text-emerald-600' : 'text-red-600'} />
      </div>
      {isFree && (
        <p className="text-xs text-neutral-400 pt-1">
          Хамтын бэлэг тул өрөө үнэгүй үүснэ. Оролцогчид өөрсдөө мөнгөө шилжүүлж зорилтот дүнг бүрдүүлнэ.
        </p>
      )}
    </div>
  );
}

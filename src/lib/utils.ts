export const FEE_RATE = 0.02;

/** Санамсаргүй хуваалтын хамгийн бага нэгж — зөвхөн 100₮-өөр бүхэлдсэн дүн гарна. */
export const SPLIT_UNIT = 100;
/** Өрөө үүсгэх доод хязгаар (азтан & хамтын бэлгийн зорилтот дүн). */
export const MIN_ROOM_AMOUNT = 10000;
/** Хамтын бэлэгт нэг удаа нэмэрлэх доод дүн. */
export const MIN_CONTRIBUTION_AMOUNT = 5000;
/** Хэтэвчнээс банк руу татах үед суутгах шимтгэл. */
export const WITHDRAW_FEE = 200;
/** Мөнгө татах хамгийн бага дүн (мөн татах товч идэвхжих доод үлдэгдэл). */
export const MIN_WITHDRAW_BALANCE = 5000;

export function formatMNT(amount: number): string {
  return new Intl.NumberFormat('mn-MN').format(amount) + '₮';
}

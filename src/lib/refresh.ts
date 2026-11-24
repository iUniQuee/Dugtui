import { createContext, useContext } from 'react';

/**
 * Доош чирж шинэчлэх (pull-to-refresh) token.
 *
 * `PullToRefresh` бүр шинэчлэлт бүрд утгыг нэмэгдүүлнэ. Дэлгэцүүд энэ
 * утгыг `key` болгон ашигласнаар дахин mount болж, өгөгдлөө дахин татна.
 */
export const RefreshContext = createContext<number>(0);

export function useRefreshToken(): number {
  return useContext(RefreshContext);
}

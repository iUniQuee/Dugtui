import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { RefreshContext } from '@/lib/refresh';

/**
 * Гар утсан дээр хуудасны дээд хэсгээс доош чирж шинэчлэх (pull-to-refresh).
 *
 * • Хуудас хамгийн дээрээ (scrollY === 0) байхад л ажиллана.
 * • Чирэх тусам эргэлдэх дүрс гарч, босго хэтэрвэл spinner эргэлдэж,
 *   `refreshToken` нэмэгдэнэ. Тухайн дэлгэцүүд token-оор дахин mount болж,
 *   өгөгдлөө (өрөө, хэтэвч, админ хүсэлт гэх мэт) дахин татна.
 * • Энгийн хөтөч, PWA (standalone) горим хоёуланд ижил DOM дээр ажиллана.
 */

const THRESHOLD = 70;
const MAX_PULL = 110;
const DAMPING = 0.5;
const SPIN_MS = 900;

export function PullToRefresh({ children }: { children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [dragging, setDragging] = useState(false);

  const pullRef = useRef(0);
  const startY = useRef(0);
  const startX = useRef(0);
  const tracking = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const reset = () => {
      tracking.current = false;
      pullRef.current = 0;
      setDragging(false);
      setPull(0);
    };

    const onStart = (event: TouchEvent) => {
      if (refreshing || event.touches.length !== 1 || !atTop()) return;
      const touch = event.touches[0];
      startY.current = touch.clientY;
      startX.current = touch.clientX;
      tracking.current = true;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking.current || refreshing) return;
      const touch = event.touches[0];
      const dy = touch.clientY - startY.current;
      const dx = Math.abs(touch.clientX - startX.current);

      if (dy <= 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Хэвтээ swipe (carousel гэх мэт) бол алгасна.
      if (dx > dy) return;
      if (!atTop()) {
        reset();
        return;
      }
      // Хөтчийн өөрийн pull-to-refresh-ийг зогсооно.
      if (event.cancelable) event.preventDefault();
      const next = Math.min(MAX_PULL, dy * DAMPING);
      pullRef.current = next;
      setDragging(true);
      setPull(next);
    };

    const onEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      setDragging(false);

      if (pullRef.current >= THRESHOLD) {
        pullRef.current = 0;
        setRefreshing(true);
        setPull(THRESHOLD);
        setRefreshToken((token) => token + 1);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          setRefreshing(false);
          setPull(0);
        }, SPIN_MS);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);

    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [refreshing]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const value = useMemo(() => refreshToken, [refreshToken]);
  const progress = Math.min(1, pull / THRESHOLD);
  const visible = pull > 0 || refreshing;
  const offset = refreshing ? THRESHOLD : pull;
  const transition = dragging && !refreshing ? 'none' : 'transform 180ms ease, opacity 180ms ease';

  return (
    <RefreshContext.Provider value={value}>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
        style={{ height: 0 }}
      >
        <div
          className="mt-2 flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-lg"
          style={{
            transform: `translateY(${Math.round(offset * 0.7 - 56)}px)`,
            opacity: visible ? 1 : 0,
            transition,
          }}
        >
          <RefreshCw
            className={`h-5 w-5 text-neutral-600 ${refreshing ? 'animate-spin' : ''}`}
            style={
              refreshing ? undefined : { transform: `rotate(${Math.round(progress * 300)}deg)` }
            }
          />
        </div>
      </div>
      {children}
    </RefreshContext.Provider>
  );
}

import { Gift, LogOut, UserRound } from 'lucide-react';

export function Header({
  onCreate,
  userName,
  onProfile,
  onAuth,
  onSignOut,
}: {
  onCreate?: () => void;
  userName?: string | null;
  onProfile?: () => void;
  onAuth?: (tab: 'login' | 'signup') => void;
  onSignOut?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-white/70 border-b border-neutral-200">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
        <button onClick={() => onCreate?.()} className="flex items-center gap-2" aria-label="Нүүр">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-amber-500 flex items-center justify-center">
            <Gift className="w-5 h-5 text-white" />
          </span>
          <span className="text-lg font-bold tracking-tight text-neutral-900">Бэлэг</span>
        </button>

        <div className="flex items-center gap-2">
          {onCreate && !userName && (
            <button
              onClick={onCreate}
              className="rounded-full bg-neutral-900 text-white text-sm font-medium px-4 py-2 hover:bg-neutral-700 transition-colors"
            >
              Өрөө үүсгэх
            </button>
          )}
          {userName ? (
            <>
              <button
                onClick={onProfile}
                className="flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 transition-colors"
              >
                <UserRound className="w-4 h-4" />
                {userName}
              </button>
              {onSignOut && (
                <button
                  onClick={onSignOut}
                  aria-label="Гарах"
                  className="p-2 rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <>
              {onAuth && (
                <>
                  <button
                    onClick={() => onAuth('login')}
                    className="rounded-full border border-neutral-300 bg-white text-neutral-800 text-sm font-medium px-4 py-2 hover:bg-neutral-50 transition-colors"
                  >
                    Нэвтрэх
                  </button>
                  <button
                    onClick={() => onAuth('signup')}
                    className="rounded-full bg-neutral-900 text-white text-sm font-medium px-4 py-2 hover:bg-neutral-700 transition-colors"
                  >
                    Бүртгүүлэх
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

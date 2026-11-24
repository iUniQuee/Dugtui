import { useEffect, useState } from 'react';
import { supabase, type Room } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { Landing } from '@/screens/Landing';
import { CreateRoom } from '@/screens/CreateRoom';
import { LuckyDrawRoom } from '@/screens/LuckyDrawRoom';
import { GroupPoolRoom } from '@/screens/GroupPoolRoom';
import { GiftCardRoom } from '@/screens/GiftCardRoom';
import { GiftRecipientRoom } from '@/screens/GiftRecipientRoom';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { AdminScreen } from '@/screens/AdminScreen';
import { AuthModal } from '@/components/AuthModal';
import { Header } from '@/components/Header';
import { ErrorState, Spinner } from '@/components/Shell';
import { useRefreshToken } from '@/lib/refresh';
import { rememberLink, takePendingLink } from '@/lib/pendingLink';

type View =
  | { page: 'home' }
  | { page: 'create'; mode?: 'lucky_draw' | 'group_pool' | 'gift_card' }
  | { page: 'room'; code: string }
  | { page: 'gift'; token: string }
  | { page: 'profile' }
  | { page: 'admin' };

function getView(): View {
  const params = new URLSearchParams(window.location.search);
  const gift = params.get('gift');
  if (gift) return { page: 'gift', token: gift };
  const room = params.get('room');
  if (room) return { page: 'room', code: room.toUpperCase() };
  if (window.location.hash === '#create') return { page: 'create' };
  if (window.location.hash === '#profile') return { page: 'profile' };
  if (window.location.hash === '#admin') return { page: 'admin' };
  return { page: 'home' };
}

function App() {
  const [view, setView] = useState<View>(getView);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(view.page === 'room');
  const [notFound, setNotFound] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'signup' | null>(null);
  const { session, profile, isAdmin, signOut } = useAuth();
  // Доош чирч шинэчлэхэд token нэмэгдэж, дэлгэцүүд дахин mount болж өгөгдлөө татна.
  const refreshToken = useRefreshToken();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // Хэрэглэгч хаягийн мөрөнд #admin / #profile гэж бичих, back/forward
  // дарахад ч зөв дэлгэц нээгдэхээр hash-ыг сонсоно.
  useEffect(() => {
    const onHashChange = () => setView(getView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (view.page !== 'room') {
      setRoom(null);
      return;
    }
    setLoading(true);
    setNotFound(false);
    supabase
      .from('rooms')
      .select('*')
      .eq('code', view.code)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setRoom(data as Room);
        else setNotFound(true);
        setLoading(false);
      });
  }, [view, refreshToken]);

  // Бүртгэлгүй хэрэглэгч өрөө эсвэл бэлгийн линкээр орж ирвэл утгыг түр хадгална:
  // нэвтэрсний дараа шууд тэр хуудас руу буцаж ороход ашиглана.
  useEffect(() => {
    if (session) return;
    if (view.page === 'room') rememberLink('room', view.code);
    else if (view.page === 'gift') rememberLink('gift', view.token);
  }, [view, session]);

  // Нэвтэрсний дараа (модал, Google, и-мэйл баталгаажуулалт) хадгалсан линк рүү
  // автоматаар буцаана. Аль хэдийн тэр хуудас дээр байгаа бол зөвхөн цэвэрлэнэ.
  useEffect(() => {
    if (!session) return;

    const pendingRoom = takePendingLink('room');
    if (pendingRoom) {
      if (view.page === 'room' && view.code === pendingRoom) return;
      window.history.replaceState(null, '', `/?room=${encodeURIComponent(pendingRoom)}`);
      setView({ page: 'room', code: pendingRoom });
      return;
    }

    const pendingGift = takePendingLink('gift');
    if (!pendingGift) return;
    if (view.page === 'gift' && view.token === pendingGift) return;
    window.history.replaceState(null, '', `/?gift=${encodeURIComponent(pendingGift)}`);
    setView({ page: 'gift', token: pendingGift });
  }, [session, view]);

  // Дээд цэсний товч — хаяг дээрх хуучин ?room=… (болон бусад query)-ийг
  // бүрэн цэвэрлэж, зөвхөн үндсэн зам (+ hash) руу шилжинэ.
  const goTo = (next: View, hash = '') => {
    window.history.replaceState(null, '', window.location.pathname + hash);
    setView(next);
  };

  const goHome = () => goTo({ page: 'home' });

  const nav = (
    <Header
      onHome={goHome}
      onCreate={() => goTo({ page: 'create' }, '#create')}
      userName={session ? profile?.display_name || 'Профайл' : null}
      isAdmin={isAdmin}
      onProfile={() => goTo({ page: 'profile' }, '#profile')}
      onAdmin={() => goTo({ page: 'admin' }, '#admin')}
      onAuth={(tab) => setAuthTab(tab)}
      onSignOut={() => {
        signOut();
        goHome();
      }}
    />
  );

  const authModal = authTab && (
    <AuthModal initialTab={authTab} onClose={() => setAuthTab(null)} />
  );

  if (view.page === 'gift') {
    return (
      <>
        {nav}
        <GiftRecipientRoom
          key={refreshToken}
          token={view.token}
          onNeedAuth={(tab) => setAuthTab(tab ?? 'login')}
          onWallet={() => goTo({ page: 'profile' }, '#profile')}
        />
        {authModal}
      </>
    );
  }

  if (view.page === 'profile') {
    if (!session)
      return (
        <>{nav}
          <RequireAuth
            title="Энэ хуудасанд нэвтрэх шаардлагатай"            body="Профайлаа харахын тулд данс руугаа нэвтэрч орно уу."
            onLogin={() => setAuthTab('login')}
            onSignup={() => setAuthTab('signup')}
          />
        </>
      );
    return (
      <>
        {nav}
        <ProfileScreen
          key={refreshToken}
          profile={profile}
          userId={session.user.id}
          isAdmin={isAdmin}
          onAdmin={() => goTo({ page: 'admin' }, '#admin')}
          onOpenRoom={(code) => setView({ page: 'room', code })}
        />
        {authModal}
      </>
    );
  }

  if (view.page === 'admin') {
    return (
      <>
        {nav}
        <AdminScreen key={refreshToken} />
        {authModal}
      </>
    );
  }

  if (view.page === 'room') {
    if (loading) return <Spinner label="Өрөөг олж байна..." />;
    if (notFound || !room)
      return <ErrorState message="Ийм өрөө олдсонгүй. Линкээ шалгаад дахин оролдоорой." />;
    if (room.type === 'lucky_draw')
      return (
        <>
          {nav}
          <LuckyDrawRoom
            key={refreshToken}
            room={room}
            onNeedAuth={() => setAuthTab('signup')}
            onHome={goHome}
          />
          {authModal}
        </>
      );
    if (room.type === 'group_pool')
      return (
        <>
          {nav}
          <GroupPoolRoom key={refreshToken} room={room} onNeedAuth={() => setAuthTab('signup')} />
          {authModal}
        </>
      );
    return (
      <>
        {nav}
        <GiftCardRoom
          key={refreshToken}
          room={room}
          onNeedAuth={(tab) => setAuthTab(tab ?? 'login')}
          onWallet={() => goTo({ page: 'profile' }, '#profile')}
          onClaimed={(claimed) => setRoom(claimed)}
        />
        {authModal}
      </>
    );
  }

  if (view.page === 'create') {
    if (!session) {
      // Auth guard: creating a room moves money, so require an account
      return (
        <>
          {nav}
          <RequireAuth
            title="Өрөө үүсгэхийн тулд данстай болох шаардлагатай"
            body="Мөнгө төвлөрүүлж, бэлэг хуваарилдаг тул бүх үйлдэл бүртгэлтэй данстай холбогдоно. Үнэгүй бүртгүүлээд үргэлжлүүлээрэй."
            onLogin={() => setAuthTab('login')}
            onSignup={() => setAuthTab('signup')}
          />
        </>
      );
    }
    return (
      <>
        {nav}
        <CreateRoom initialMode={view.mode} onHome={goHome} onNeedAuth={() => setAuthTab('signup')} />
        {authModal}
      </>
    );
  }

  return (
    <>
      {nav}
      <Landing onCreate={(mode) => setView({ page: 'create', mode })} />
      {authModal}
    </>
  );
}

function RequireAuth({
  title,
  body,
  onLogin,
  onSignup,
}: {
  title: string;
  body: string;
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <div className="max-w-md mx-auto mt-16 px-4">
      <div className="rounded-3xl bg-white border border-neutral-200 shadow p-10 text-center">
        <p className="font-semibold text-lg text-neutral-900">{title}</p>
        <p className="mt-2 text-sm text-neutral-500">{body}</p>
        <div className="mt-6 flex gap-2 justify-center">
          <button
            onClick={onSignup}
            className="rounded-xl bg-neutral-900 text-white px-5 py-3 font-semibold hover:bg-neutral-700 transition-colors"
          >
            Бүртгүүлэх
          </button>
          <button
            onClick={onLogin}
            className="rounded-xl border border-neutral-300 px-5 py-3 font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            Нэвтрэх
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;

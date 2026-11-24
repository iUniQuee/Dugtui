import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  display_name: string;
  balance: number;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
}

// Дэлгэцүүд pull-to-refresh-ээр дахин mount болоход session/профайл/админ эрх
// "алга болсон" мэт гялбаа гарахгүйн тулд сүүлийн утгыг модуль түвшинд хадгална.
let cachedSession: Session | null = null;
let cachedProfile: Profile | null = null;
let cachedAdmin = false;
let sessionKnown = false;

export function useAuth() {
  const [session, setSession] = useState<Session | null>(cachedSession);
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [isAdmin, setIsAdmin] = useState(cachedAdmin);
  const [loading, setLoading] = useState(!sessionKnown);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      sessionKnown = true;
      cachedSession = data.session;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      sessionKnown = true;
      cachedSession = newSession;
      setSession(newSession);
      if (!newSession) {
        cachedProfile = null;
        cachedAdmin = false;
        setProfile(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    const user = session.user;
    const load = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, balance, bank_name, account_number, account_name')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        cachedProfile = data as Profile;
        setProfile(data as Profile);
        setLoading(false);
        return;
      }
      // Шинэ бүртгэлд profiles мөр автоматаар үүсдэггүй тул нэвтэрсэн үед
      // хэрэглэгчийн нэрээр нээж өгнө (хэтэвч, дансны мэдээлэл үүн дээр ажиллана).
      const name =
        ((user.user_metadata?.display_name as string | undefined) ?? '').trim() ||
        user.email?.split('@')[0] ||
        'Хэрэглэгч';
      const { data: created } = await supabase
        .from('profiles')
        .insert({ id: user.id, display_name: name })
        .select('id, display_name, balance, bank_name, account_number, account_name')
        .maybeSingle();
      if (created) {
        cachedProfile = created as Profile;
        setProfile(created as Profile);
      } else {
        // зэрэг үүссэн бол дахин уншина
        const { data: again } = await supabase
          .from('profiles')
          .select('id, display_name, balance, bank_name, account_number, account_name')
          .eq('id', user.id)
          .maybeSingle();
        cachedProfile = (again as Profile) ?? null;
        setProfile(cachedProfile);
      }
      setLoading(false);
    };
    load();
  }, [session?.user?.id]);

  // Админ эрх нь сервер талд (is_admin RPC) шалгагдана.
  useEffect(() => {
    if (!session?.user) {
      cachedAdmin = false;
      setIsAdmin(false);
      return;
    }
    let active = true;
    supabase.rpc('is_admin').then(({ data }) => {
      if (!active) return;
      cachedAdmin = data === true;
      setIsAdmin(cachedAdmin);
    });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const signOut = () => {
    cachedSession = null;
    cachedProfile = null;
    cachedAdmin = false;
    return supabase.auth.signOut();
  };

  return {
    session,
    user: session?.user as User | undefined,
    profile,
    isAdmin,
    loading,
    signOut,
  };
}

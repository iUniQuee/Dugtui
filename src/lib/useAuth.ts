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

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
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
        setProfile(created as Profile);
      } else {
        // зэрэг үүссэн бол дахин уншина
        const { data: again } = await supabase
          .from('profiles')
          .select('id, display_name, balance, bank_name, account_number, account_name')
          .eq('id', user.id)
          .maybeSingle();
        setProfile((again as Profile) ?? null);
      }
      setLoading(false);
    };
    load();
  }, [session?.user?.id]);

  // Админ эрх нь сервер талд (is_admin RPC) шалгагдана.
  useEffect(() => {
    if (!session?.user) {
      setIsAdmin(false);
      return;
    }
    let active = true;
    supabase.rpc('is_admin').then(({ data }) => {
      if (active) setIsAdmin(data === true);
    });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const signOut = () => supabase.auth.signOut();

  return {
    session,
    user: session?.user as User | undefined,
    profile,
    isAdmin,
    loading,
    signOut,
  };
}

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
    const load = () => {
      supabase
        .from('profiles')
        .select('id, display_name, balance, bank_name, account_number, account_name')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          setProfile((data as Profile) ?? null);
          setLoading(false);
        });
    };
    load();
  }, [session?.user?.id]);

  const signOut = () => supabase.auth.signOut();

  return { session, user: session?.user as User | undefined, profile, loading, signOut };
}

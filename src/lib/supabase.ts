import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Room {
  id: string;
  code: string;
  type: 'lucky_draw' | 'group_pool' | 'gift_card';
  title: string;
  theme: 'tsagaan_sar' | 'shine_jil' | 'birthday' | 'normal';
  total_amount: number;
  fee_amount: number;
  participant_count: number | null;
  mode: 'equal' | 'random' | null;
  status: 'pending' | 'active' | 'completed';
  organizer_name: string | null;
  message: string | null;
  image_url: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Envelope {
  id: string;
  room_id: string;
  amount: number;
  claimed: boolean;
  claimed_by_name: string | null;
  claimed_by_phone: string | null;
  claimed_at: string | null;
  claim_token: string | null;
}

export interface Contribution {
  id: string;
  room_id: string;
  name: string;
  amount: number;
  message: string | null;
  created_at: string;
}

export interface Withdrawal {
  id: string;
  room_id: string;
  envelope_id: string | null;
  contributor_id: string | null;
  participant_name: string;
  amount: number;
  bank_name: string;
  account_number: string;
  account_name: string | null;
  status: 'pending' | 'paid';
  created_at: string;
}

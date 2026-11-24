import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type RoomStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'PENDING_APPROVAL'
  | 'PAID'
  | 'REJECTED'
  | 'CLAIMED'
  | 'CANCELLED';

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
  status: RoomStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  paid_at: string | null;
  payment_code: string | null;
  payment_reviewed_at: string | null;
  reject_reason: string | null;
  qpay_invoice_id: string | null;
  user_id: string | null;
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
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_by_phone: string | null;
  claimed_at: string | null;
  claim_token: string | null;
}

export interface RoomParticipant {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  joined_at: string;
}

export interface Contribution {
  id: string;
  room_id: string;
  name: string;
  amount: number;
  message: string | null;
  status: 'PENDING_APPROVAL' | 'PAID' | 'REJECTED';
  payment_code: string | null;
  user_id: string | null;
  payment_reviewed_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface GiftTransfer {
  id: string;
  room_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  amount: number;
  status: 'pending' | 'paid';
  paid_at: string | null;
  created_at: string;
}

export interface PlatformSettings {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  qr_url: string;
  updated_at: string;
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

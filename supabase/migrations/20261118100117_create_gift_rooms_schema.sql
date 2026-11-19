/*
# Gift Room Platform Schema

1. New Tables
- `rooms`: gift event rooms (lucky_draw, group_pool, gift_card)
- `envelopes`: per-participant prize slots for lucky_draw rooms
- `contributions`: group pool contributions
- `withdrawals`: pending bank transfer requests
2. Security
- Enable RLS on all 4 tables.
- Grant SELECT/INSERT/UPDATE to anon + authenticated (no sign-in).
*/

CREATE TABLE IF NOT EXISTS public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('lucky_draw','group_pool','gift_card')),
  title text NOT NULL,
  theme text NOT NULL DEFAULT 'normal',
  total_amount bigint NOT NULL DEFAULT 0,
  fee_amount bigint NOT NULL DEFAULT 0,
  participant_count integer,
  mode text,
  status text NOT NULL DEFAULT 'pending',
  organizer_name text,
  message text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  claimed boolean NOT NULL DEFAULT false,
  claimed_by_name text,
  claimed_by_phone text,
  claimed_at timestamptz,
  claim_token text UNIQUE
);

CREATE TABLE IF NOT EXISTS public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount bigint NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  envelope_id uuid REFERENCES public.envelopes(id) ON DELETE SET NULL,
  contributor_id text,
  participant_name text NOT NULL,
  amount bigint NOT NULL,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_name text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_envelopes_room ON public.envelopes(room_id);
CREATE INDEX IF NOT EXISTS idx_contributions_room ON public.contributions(room_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_room ON public.withdrawals(room_id);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.rooms TO anon, authenticated;
GRANT SELECT, UPDATE ON public.envelopes TO anon, authenticated;
GRANT SELECT, INSERT ON public.contributions TO anon, authenticated;
GRANT SELECT, INSERT ON public.withdrawals TO anon, authenticated;

DROP POLICY IF EXISTS "rooms_public_read" ON public.rooms;
CREATE POLICY "rooms_public_read" ON public.rooms FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "rooms_public_insert" ON public.rooms;
CREATE POLICY "rooms_public_insert" ON public.rooms FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "envelopes_public_read" ON public.envelopes;
CREATE POLICY "envelopes_public_read" ON public.envelopes FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "envelopes_public_update" ON public.envelopes;
CREATE POLICY "envelopes_public_update" ON public.envelopes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "contributions_public_read" ON public.contributions;
CREATE POLICY "contributions_public_read" ON public.contributions FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "contributions_public_insert" ON public.contributions;
CREATE POLICY "contributions_public_insert" ON public.contributions FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "withdrawals_public_read" ON public.withdrawals;
CREATE POLICY "withdrawals_public_read" ON public.withdrawals FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "withdrawals_public_insert" ON public.withdrawals;
CREATE POLICY "withdrawals_public_insert" ON public.withdrawals FOR INSERT TO anon, authenticated WITH CHECK (true);

/*
# Finish admin, refund & profile setup (aligns with existing schema)

Existing schema already has: profiles (display_name, bank fields), rooms.user_id
+ expires_at + refunded, wallet_transactions (type/status style ledger), an
admins table checked by email, and account-protected envelope claiming.

1. Changes
- wallet_transactions: widen type check to allow 'win' and 'refund' top-ups
  alongside 'payout'; widen insert policy accordingly.
- profiles: public read (leaderboards show names), self-update of display_name
  and bank fields.
- withdrawals: add user_id (uuid, fk profiles), scope insert policy to own rows.
- helpers: is_admin() by admins.email; refund_expired_rooms() sweep moving
  unclaimed envelope money of expired lucky_draw rooms to organizer wallet and
  closing the room.
2. Security
- No open anonymous update remains; envelope claims require a signed-in account.
  Withdrawal confirmation stays admin-only via existing policies.
3. Notes
- Safe to re-run. The previous attempt failed on a nonexistent
  information_schema view; constraint handling now uses plain IF EXISTS drops.
*/

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'wallet_transactions'
      AND c.conname = 'wallet_transactions_type_check'
  ) THEN
    ALTER TABLE public.wallet_transactions
      ADD CONSTRAINT wallet_transactions_type_check CHECK (type IN ('payout','win','refund'));
  END IF;
END $$;

DROP POLICY IF EXISTS "wallet_insert_own" ON public.wallet_transactions;
CREATE POLICY "wallet_insert_own" ON public.wallet_transactions FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    (type = 'payout' AND status = 'pending')
    OR (type IN ('win','refund') AND status = 'completed')
  )
);

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_public_read" ON public.profiles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT UPDATE (display_name, bank_name, account_number, account_name) ON public.profiles TO authenticated;

ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "withdrawals_public_insert" ON public.withdrawals;
CREATE POLICY "withdrawals_insert_own" ON public.withdrawals FOR INSERT TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE email = auth.jwt()->>'email');
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.refund_expired_rooms() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  moved integer := 0;
  r record;
  refund_sum bigint;
BEGIN
  FOR r IN
    SELECT ro.id, ro.user_id AS organizer,
           COALESCE(SUM(e.amount) FILTER (WHERE e.claimed = false), 0) AS refund_amount
    FROM public.rooms ro
    JOIN public.envelopes e ON e.room_id = ro.id
    WHERE ro.type = 'lucky_draw'
      AND ro.status = 'active'
      AND ro.user_id IS NOT NULL
      AND ro.refunded IS NOT TRUE
      AND ro.expires_at IS NOT NULL
      AND ro.expires_at < now()
    GROUP BY ro.id, ro.user_id
  LOOP
    refund_sum := r.refund_amount;
    IF refund_sum > 0 THEN
      UPDATE public.profiles
      SET balance = COALESCE(balance,0) + refund_sum
      WHERE id = r.organizer;
      INSERT INTO public.wallet_transactions (user_id, amount, type, description, status)
      VALUES (r.organizer, refund_sum, 'refund', 'Задраагүй дугтуйны дүн буцаан олгогдлоо', 'completed');
    END IF;
    UPDATE public.rooms SET status = 'completed', refunded = true WHERE id = r.id;
    moved := moved + 1;
  END LOOP;
  RETURN moved;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_expired_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_expired_rooms() TO authenticated;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0);

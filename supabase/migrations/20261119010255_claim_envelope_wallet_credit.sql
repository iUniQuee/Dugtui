/*
# Winner wallet credit on envelope claim

1. New Functions
- `claim_envelope(p_envelope_id uuid, p_name text)` SECURITY DEFINER:
  atomically claims an unclaimed envelope for the caller, credits the amount to
  the winner's profiles.balance, and writes a 'win' wallet_transactions row.
  Returns the envelope row. Raises if not signed in, already claimed, or the
  envelope belongs to a non-lucky_draw room.
2. Security
- All cross-table writes happen server-side; the client can no longer craft an
  arbitrary claim update. Double-claiming is impossible (row is locked and the
  claim is conditional on claimed = false).
- Revoke from anon/PUBLIC; only authenticated callers may execute.
- Uses extensions schema for pgcrypto's gen_random_bytes.
*/

CREATE OR REPLACE FUNCTION public.claim_envelope(p_envelope_id uuid, p_name text)
RETURNS public.envelopes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_room_type text;
  v_env public.envelopes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай';
  END IF;

  SELECT ro.type INTO v_room_type
  FROM public.envelopes e
  JOIN public.rooms ro ON ro.id = e.room_id
  WHERE e.id = p_envelope_id
  FOR UPDATE OF e;

  IF v_room_type IS NULL THEN
    RAISE EXCEPTION 'Дугтуй олдсонгүй';
  END IF;
  IF v_room_type <> 'lucky_draw' THEN
    RAISE EXCEPTION 'Зөвхөн сугалааны дугтуй задлах боломжтой';
  END IF;

  UPDATE public.envelopes
  SET claimed = true,
      claimed_by = auth.uid(),
      claimed_by_name = p_name,
      claimed_at = now(),
      claim_token = encode(gen_random_bytes(16), 'hex')
  WHERE id = p_envelope_id AND claimed = false
  RETURNING * INTO v_env;

  IF v_env.id IS NULL THEN
    RAISE EXCEPTION 'Энэ дугтуйг өөр хүн аль хэдийн авчихсан байна';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, amount, type, status, description)
  VALUES (auth.uid(), v_env.amount, 'win', 'completed',
          'Сугалаагаар хожсон дүн («' || (
            SELECT title FROM public.rooms WHERE id = v_env.room_id
          ) || '»)');

  UPDATE public.profiles
  SET balance = COALESCE(balance, 0) + v_env.amount
  WHERE id = auth.uid();

  RETURN v_env;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_envelope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_envelope(uuid, text) TO authenticated;

-- wins/refunds can no longer be inserted by clients directly; only payouts
DROP POLICY IF EXISTS "wallet_insert_own" ON public.wallet_transactions;
CREATE POLICY "wallet_insert_own" ON public.wallet_transactions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND type = 'payout' AND status = 'pending');

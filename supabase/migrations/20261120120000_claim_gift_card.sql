/*
# Gift card claim → wallet credit

1. New columns on `rooms`
- claimed_by  uuid  — the account that received the gift (idempotent ownership)
- claimed_at  timestamptz
- paid_at     timestamptz — set when the Bogd QPay payment is confirmed
- qpay_invoice_id text    — Bogd QPay invoice that paid for this room (callback match)
2. New function
- `claim_gift_card(p_code text)` SECURITY DEFINER: atomically claims an unclaimed
  gift_card room for the signed-in caller, credits rooms.total_amount to
  profiles.balance, writes a 'win' wallet_transactions row, sets status = 'CLAIMED'.
  Raises if not signed in, if the room is not a gift_card, if it is not paid yet,
  or if somebody else already claimed it. Calling it again by the same account
  returns the room and does not credit twice.
3. Security
- All cross-table writes happen server-side, so clients cannot craft an arbitrary
  claim update nor insert fake wallet credits.
- Only authenticated callers may execute the function.
*/

ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS claimed_by uuid;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS qpay_invoice_id text;

CREATE INDEX IF NOT EXISTS idx_rooms_claimed_by ON public.rooms(claimed_by);
CREATE INDEX IF NOT EXISTS idx_rooms_qpay_invoice ON public.rooms(qpay_invoice_id);

CREATE OR REPLACE FUNCTION public.claim_gift_card(p_code text)
RETURNS public.rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_room public.rooms;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE upper(code) = upper(trim(p_code))
  FOR UPDATE;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Бэлэг олдсонгүй';
  END IF;
  IF v_room.type <> 'gift_card' THEN
    RAISE EXCEPTION 'Энэ линк бэлгийн карт биш байна';
  END IF;

  -- already claimed: the owner can reopen it, anybody else is rejected
  IF v_room.claimed_by IS NOT NULL THEN
    IF v_room.claimed_by = auth.uid() THEN
      RETURN v_room;
    END IF;
    RAISE EXCEPTION 'Энэ бэлгийг өөр хүн аль хэдийн авчихсан байна';
  END IF;

  IF v_room.status NOT IN ('active', 'PAID') THEN
    RAISE EXCEPTION 'Энэ бэлэг төлбөр баталгаажаагүй байна';
  END IF;

  -- a fresh signup may not have a profile row yet
  INSERT INTO public.profiles (id, display_name)
  SELECT u.id, COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'Хэрэглэгч')
  FROM auth.users u
  WHERE u.id = auth.uid()
  ON CONFLICT (id) DO NOTHING;

  IF v_room.total_amount > 0 THEN
    INSERT INTO public.wallet_transactions (user_id, amount, type, status, description)
    VALUES (auth.uid(), v_room.total_amount, 'win', 'completed',
            'Бэлэг авсан дүн («' || v_room.title || '»)');

    UPDATE public.profiles
    SET balance = COALESCE(balance, 0) + v_room.total_amount
    WHERE id = auth.uid();
  END IF;

  UPDATE public.rooms
  SET claimed_by = auth.uid(),
      claimed_at = now(),
      status = 'CLAIMED'
  WHERE id = v_room.id AND claimed_by IS NULL
  RETURNING * INTO v_room;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Энэ бэлгийг өөр хүн аль хэдийн авчихсан байна';
  END IF;

  RETURN v_room;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_gift_card(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_gift_card(text) TO authenticated;

/*
# Бэлэг хүлээн авах нэгдсэн урсгал + илгээгчийн хамгаалалт

1. `claim_gift_card(p_code)` — бэлэг үүсгэсэн хүн өөрөө авахыг хориглоно.
2. `claim_group_gift(p_token)` — ШИНЭ. Хамтын бэлгийг линкээр нь хүлээн
   авагчийн хэтэвчид шууд оруулна. Илгээгч өөрөө авахыг хориглоно,
   давхар credit хийхгүй (idempotent). `wallet_transactions`-д `'win'`
   бичилт үүсгэж, өрөөг `completed` болгоно.
3. `get_gift_by_token(p_token)` — `is_sender`, `claimed`, `claimed_by_me`
   талбаруудыг нэмж, илгээгч/хүлээн авагчийг ялгах боломж олгоно.

SQL Editor-т бүхэлд нь нэг удаа ажиллуулна. Дахин ажиллуулахад аюулгүй.
*/

-- ============================================================================
-- 1. БЭЛГИЙН КАРТ — илгээгч өөрөө авахыг хориглох
-- ============================================================================
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

  -- Бэлэг илгээсэн хүн өөрөө авах боломжгүй.
  IF v_room.user_id IS NOT NULL AND v_room.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Та өөрийн илгээсэн бэлгийг авах боломжгүй. Линкийг хүлээн авагчид илгээнэ үү.';
  END IF;

  IF v_room.claimed_by IS NOT NULL THEN
    IF v_room.claimed_by = auth.uid() THEN
      RETURN v_room;
    END IF;
    RAISE EXCEPTION 'Энэ бэлгийг өөр хүн аль хэдийн авчихсан байна';
  END IF;

  IF v_room.status = 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Төлбөр батлагдахыг хүлээж байна. Батлагдмагц бэлэг таны хэтэвчид орно';
  END IF;
  IF v_room.status = 'REJECTED' THEN
    RAISE EXCEPTION 'Энэ бэлгийн төлбөр батлагдаагүй байна';
  END IF;
  IF v_room.status NOT IN ('active', 'PAID') THEN
    RAISE EXCEPTION 'Энэ бэлэг төлбөр баталгаажаагүй байна';
  END IF;

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

-- ============================================================================
-- 2. ХАМТЫН БЭЛЭГ — линкээр хэтэвчид шууд авах
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_group_gift(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_total bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Бэлгээ авахын тулд нэвтрэх шаардлагатай.';
  END IF;

  SELECT r.* INTO v_room
  FROM public.gift_links gl
  JOIN public.rooms r ON r.id = gl.room_id
  WHERE gl.token = trim(COALESCE(p_token, ''))
  FOR UPDATE OF r;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Линк хүчингүй байна.';
  END IF;
  IF v_room.type <> 'group_pool' THEN
    RAISE EXCEPTION 'Энэ линк хамтын бэлэг биш байна.';
  END IF;

  -- Бэлэг зохион байгуулсан хүн өөрөө авах боломжгүй.
  IF v_room.user_id IS NOT NULL AND v_room.user_id = v_uid THEN
    RAISE EXCEPTION 'Та өөрийн зохион байгуулсан бэлгийг авах боломжгүй. Линкийг хүлээн авагчид илгээнэ үү.';
  END IF;

  -- Давхар credit хийхгүй: аль хэдийн өөр хүн авсан бол алдаа,
  -- өөрөө авсан бол зөвхөн дүнг буцаана.
  IF v_room.claimed_by IS NOT NULL AND v_room.claimed_by <> v_uid THEN
    RAISE EXCEPTION 'Энэ бэлгийг өөр хүн аль хэдийн авсан байна.';
  END IF;

  SELECT COALESCE(SUM(c.amount), 0) INTO v_total
  FROM public.contributions c
  WHERE c.room_id = v_room.id AND c.status = 'PAID';

  IF v_room.claimed_by = v_uid THEN
    RETURN jsonb_build_object(
      'room_id', v_room.id,
      'amount', v_total,
      'already', true
    );
  END IF;

  IF v_room.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Өрөө цуцлагдсан тул бэлэг авах боломжгүй.';
  END IF;
  IF v_room.status = 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Төлбөр батлагдахыг хүлээж байна. Батлагдмагц бэлгээ задална уу.';
  END IF;
  IF v_room.status = 'REJECTED' THEN
    RAISE EXCEPTION 'Энэ бэлгийн төлбөр батлагдаагүй байна.';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Цугласан дүн байхгүй байна.';
  END IF;

  INSERT INTO public.profiles (id, display_name)
  SELECT u.id, COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'Хэрэглэгч')
  FROM auth.users u
  WHERE u.id = v_uid
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles
  SET balance = COALESCE(balance, 0) + v_total
  WHERE id = v_uid;

  INSERT INTO public.wallet_transactions (user_id, amount, type, status, description)
  VALUES (v_uid, v_total, 'win', 'completed',
          'Хамтын бэлэг авсан дүн («' || v_room.title || '»)');

  UPDATE public.rooms
  SET claimed_by = v_uid,
      claimed_at = now(),
      status = 'completed'
  WHERE id = v_room.id AND claimed_by IS NULL;

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'amount', v_total,
    'already', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_group_gift(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_group_gift(text) TO authenticated;

-- ============================================================================
-- 3. ЛИНКЭЭР ХАРАГДАХ ӨГӨГДӨЛ — илгээгч/хүлээн авагчийг ялгах
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_gift_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms;
  v_uid uuid := auth.uid();
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT r.* INTO v_room
  FROM public.gift_links gl
  JOIN public.rooms r ON r.id = gl.room_id
  WHERE gl.token = trim(p_token);
  IF v_room.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'code', v_room.code,
      'title', v_room.title,
      'theme', v_room.theme,
      'message', v_room.message,
      'organizer_name', v_room.organizer_name,
      'status', v_room.status,
      'goal', v_room.total_amount,
      'raised', COALESCE((
        SELECT SUM(c.amount) FROM public.contributions c
        WHERE c.room_id = v_room.id AND c.status = 'PAID'
      ), 0)
    ),
    'is_sender', (v_uid IS NOT NULL AND v_room.user_id IS NOT NULL AND v_room.user_id = v_uid),
    'claimed', (v_room.claimed_by IS NOT NULL),
    'claimed_by_me', (v_uid IS NOT NULL AND v_room.claimed_by = v_uid),
    'contributions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', c.name,
          'amount', c.amount,
          'message', c.message,
          'created_at', c.created_at
        ) ORDER BY c.created_at
      )
      FROM public.contributions c
      WHERE c.room_id = v_room.id AND c.status = 'PAID'
    ), '[]'::jsonb),
    'transfer', (
      SELECT jsonb_build_object(
        'bank_name', t.bank_name,
        'account_number', t.account_number,
        'account_name', t.account_name,
        'amount', t.amount,
        'status', t.status,
        'created_at', t.created_at,
        'paid_at', t.paid_at
      )
      FROM public.gift_transfers t
      WHERE t.room_id = v_room.id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gift_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_by_token(text) TO anon, authenticated;

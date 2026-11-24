/*
# Өрөө цуцлах, мөнгө буцаах, хэтэвчээр төлөх

1. Шинэ функцууд
- `cancel_room(p_room_id)` SECURITY DEFINER: өрөө үүсгэгч (эсвэл админ)
  дуусаагүй өрөөг цуцална. `lucky_draw` / `gift_card` бол төлсөн бүтэн дүн
  (total_amount + fee_amount) үүсгэгчийн хэтэвчинд буцаж, `group_pool` бол
  батлагдсан (PAID) нэмэр бүрийг тухайн хэрэглэгчийн хэтэвчинд буцаана.
  Өрөөний төлөв `CANCELLED`, `refunded = true`, түүхэнд `refund` бичилт үүснэ.
- `create_room_from_wallet(...)` SECURITY DEFINER: хэтэвчний үлдэгдлээс
  төлөөд өрөөг шууд `PAID` болгож үүсгэнэ (QR/шилжүүлэг шаардлагагүй).
- `submit_group_contribution_from_wallet(...)` SECURITY DEFINER: хэтэвчний
  үлдэгдлээс хамтын бэлгийн нэмрийг шууд `PAID` болгоно.

2. Өөрчлөлт
- `wallet_transactions.type` constraint-д `'payment'` (зарлага) нэмнэ.
- `submit_group_contribution` нэмэр авахад заавал нэвтэрсэн байхыг шаардана.

3. Аюулгүй байдал
- Бүх мөнгөний хөдөлгөөн сервер талд, SECURITY DEFINER дотор атомаар
  хийгдэнэ; клиент шууд баланс/түүх бичихгүй.
- Зөвхөн `authenticated` ролид execute эрх өгнө.

SQL Editor-т бүхэлд нь нэг удаа ажиллуулна. Дахин ажиллуулахад аюулгүй.
*/

-- ============================================================================
-- 1. WALLET TRANSACTIONS — 'payment' төрөл (хэтэвчнээс зарцуулалт)
-- ============================================================================
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('payout', 'win', 'refund', 'payment'));

-- Буцаалт хийгдсэн эсэхийг тэмдэглэх багана (хуучин схемд байхгүй бол нэмнэ).
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS refunded boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 2. ТУСЛАХ: профайлын мөр байхгүй бол нээх
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ensure_profile_row(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.profiles (id, display_name)
  SELECT u.id, COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'Хэрэглэгч')
  FROM auth.users u
  WHERE u.id = p_user_id
  ON CONFLICT (id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_profile_row(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. ӨРӨӨ ЦУЦЛАХ + БУЦААЛТ
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_room(p_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_raised bigint := 0;
  v_joined integer := 0;
  v_required integer;
  v_refund_total bigint := 0;
  v_refund_count integer := 0;
  v_amount bigint := 0;
  v_c public.contributions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай.';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Өрөө олдсонгүй.';
  END IF;

  IF v_room.user_id IS DISTINCT FROM v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн өрөө үүсгэсэн хүн цуцалж чадна.';
  END IF;

  IF v_room.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Өрөө аль хэдийн цуцлагдсан байна.';
  END IF;

  -- Зөвхөн дуусаагүй (идэвхтэй / төлбөр батлагдсан) өрөөг цуцална.
  IF v_room.status NOT IN ('active', 'PAID') THEN
    RAISE EXCEPTION 'Энэ төлөвт байгаа өрөөг цуцлах боломжгүй.';
  END IF;

  IF v_room.type = 'group_pool' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_raised
    FROM public.contributions
    WHERE room_id = v_room.id AND status = 'PAID';

    IF v_room.total_amount > 0 AND v_raised >= v_room.total_amount THEN
      RAISE EXCEPTION 'Зорилго 100%% биелсэн тул цуцлах боломжгүй.';
    END IF;

    -- Хүлээн авагч руу шилжүүлэлт эхэлсэн бол цуцлахгүй.
    IF EXISTS (SELECT 1 FROM public.gift_transfers WHERE room_id = v_room.id) THEN
      RAISE EXCEPTION 'Бэлэг хүлээн авагч руу илгээгдсэн тул цуцлах боломжгүй.';
    END IF;

    -- Батлагдсан нэмэр бүрийг өөр өөрсдийн хэтэвчинд 100% буцаана.
    FOR v_c IN
      SELECT * FROM public.contributions
      WHERE room_id = v_room.id AND status = 'PAID'
      FOR UPDATE
    LOOP
      IF v_c.user_id IS NOT NULL THEN
        PERFORM public.ensure_profile_row(v_c.user_id);

        INSERT INTO public.wallet_transactions (user_id, amount, type, status, description)
        VALUES (v_c.user_id, v_c.amount, 'refund', 'completed',
                'Өрөө цуцлагдсан буцаалт («' || v_room.title || '»)');

        UPDATE public.profiles
        SET balance = COALESCE(balance, 0) + v_c.amount
        WHERE id = v_c.user_id;

        v_refund_total := v_refund_total + v_c.amount;
        v_refund_count := v_refund_count + 1;
      END IF;
    END LOOP;

    -- Хүлээгдэж буй нэмрийг хаана.
    UPDATE public.contributions
    SET status = 'REJECTED',
        reject_reason = 'Өрөө цуцлагдсан',
        payment_reviewed_at = now()
    WHERE room_id = v_room.id AND status = 'PENDING_APPROVAL';

  ELSIF v_room.type = 'lucky_draw' THEN
    IF EXISTS (SELECT 1 FROM public.envelopes WHERE room_id = v_room.id AND claimed) THEN
      RAISE EXCEPTION 'Дугтуй задалсан тул цуцлах боломжгүй.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.withdrawals WHERE room_id = v_room.id) THEN
      RAISE EXCEPTION 'Мөнгө татах хүсэлт үүссэн тул цуцлах боломжгүй.';
    END IF;

    v_required := COALESCE(v_room.participant_count, 0);
    IF v_required > 0 THEN
      SELECT count(*) INTO v_joined
      FROM public.room_participants
      WHERE room_id = v_room.id;

      IF v_joined >= v_required THEN
        RAISE EXCEPTION 'Оролцогчдын тоо бүрэн бүрдсэн тул цуцлах боломжгүй.';
      END IF;
    END IF;

    v_amount := COALESCE(v_room.total_amount, 0) + COALESCE(v_room.fee_amount, 0);

  ELSE
    -- gift_card
    IF v_room.claimed_by IS NOT NULL THEN
      RAISE EXCEPTION 'Бэлэг аль хэдийн авагдсан тул цуцлах боломжгүй.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.withdrawals WHERE room_id = v_room.id) THEN
      RAISE EXCEPTION 'Мөнгө татах хүсэлт үүссэн тул цуцлах боломжгүй.';
    END IF;

    v_amount := COALESCE(v_room.total_amount, 0) + COALESCE(v_room.fee_amount, 0);
  END IF;

  -- Азын дугтуй / бэлгийн карт: үүсгэгчийн төлсөн бүтэн дүнг буцаана.
  IF v_room.type <> 'group_pool' AND v_amount > 0 AND v_room.user_id IS NOT NULL THEN
    PERFORM public.ensure_profile_row(v_room.user_id);

    INSERT INTO public.wallet_transactions (user_id, amount, type, status, description)
    VALUES (v_room.user_id, v_amount, 'refund', 'completed',
            'Өрөө цуцлагдсан буцаалт («' || v_room.title || '»)');

    UPDATE public.profiles
    SET balance = COALESCE(balance, 0) + v_amount
    WHERE id = v_room.user_id;

    v_refund_total := v_refund_total + v_amount;
    v_refund_count := v_refund_count + 1;
  END IF;

  UPDATE public.rooms
  SET status = 'CANCELLED',
      refunded = (v_refund_total > 0),
      reject_reason = NULL,
      payment_reviewed_at = now()
  WHERE id = v_room.id;

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'refunded_total', v_refund_total,
    'refunded_count', v_refund_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_room(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_room(uuid) TO authenticated;

-- ============================================================================
-- 4. ХЭТЭВЧЭЭР ӨРӨӨ ҮҮСГЭХ (QR/шилжүүлэггүй)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_room_from_wallet(
  p_code text,
  p_type text,
  p_title text,
  p_theme text,
  p_total_amount bigint,
  p_fee_amount bigint,
  p_participant_count integer,
  p_mode text,
  p_organizer_name text,
  p_message text,
  p_image_url text,
  p_expires_at timestamptz,
  p_envelope_amounts bigint[]
) RETURNS public.rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_amount bigint;
  v_balance bigint;
  v_sum bigint := 0;
  v_room public.rooms;
  v_total bigint := COALESCE(p_total_amount, 0);
  v_fee bigint := COALESCE(p_fee_amount, 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай.';
  END IF;

  IF p_type NOT IN ('lucky_draw', 'gift_card') THEN
    RAISE EXCEPTION 'Зөвхөн азын дугтуй эсвэл бэлгийн картыг хэтэвчээр төлнө.';
  END IF;

  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION 'Өрөөний код хоосон байна.';
  END IF;

  IF v_total < 0 OR v_fee < 0 OR v_total + v_fee = 0 THEN
    RAISE EXCEPTION 'Зөв мөнгөн дүн оруулна уу.';
  END IF;

  v_amount := v_total + v_fee;

  IF p_type = 'lucky_draw' THEN
    IF p_envelope_amounts IS NULL OR array_length(p_envelope_amounts, 1) IS NULL THEN
      RAISE EXCEPTION 'Дугтуйны дүн байхгүй байна.';
    END IF;
    SELECT COALESCE(SUM(x), 0) INTO v_sum FROM unnest(p_envelope_amounts) AS x;
    IF v_sum <> v_total THEN
      RAISE EXCEPTION 'Дугтуйнуудын нийлбэр нийт дүнтэй тэнцэхгүй байна.';
    END IF;
  END IF;

  PERFORM public.ensure_profile_row(v_uid);

  SELECT balance INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF COALESCE(v_balance, 0) < v_amount THEN
    RAISE EXCEPTION 'Хэтэвчний үлдэгдэл хүрэлцэхгүй байна (үлдэгдэл: %₮, шаардлагатай: %₮)',
      COALESCE(v_balance, 0), v_amount;
  END IF;

  -- Түүхэн бичилт (transaction_history) үүсэхийн тулд эхлээд
  -- PENDING_APPROVAL-аар үүсгэж, дараа нь PAID болгоно.
  INSERT INTO public.rooms
    (code, type, title, theme, total_amount, fee_amount, participant_count,
     mode, status, organizer_name, message, image_url, user_id, expires_at,
     payment_code)
  VALUES
    (trim(p_code), p_type, p_title, COALESCE(NULLIF(trim(p_theme), ''), 'normal'),
     v_total, v_fee, p_participant_count, p_mode, 'PENDING_APPROVAL',
     NULLIF(trim(p_organizer_name), ''), NULLIF(trim(p_message), ''),
     NULLIF(trim(p_image_url), ''), v_uid, p_expires_at, NULL)
  RETURNING * INTO v_room;

  IF p_envelope_amounts IS NOT NULL AND array_length(p_envelope_amounts, 1) IS NOT NULL THEN
    INSERT INTO public.envelopes (room_id, amount)
    SELECT v_room.id, x FROM unnest(p_envelope_amounts) AS x;
  END IF;

  UPDATE public.profiles
  SET balance = COALESCE(balance, 0) - v_amount
  WHERE id = v_uid;

  INSERT INTO public.wallet_transactions (user_id, amount, type, status, description)
  VALUES (v_uid, v_amount, 'payment', 'completed',
          'Өрөө үүсгэх төлбөр («' || p_title || '») — хэтэвч');

  UPDATE public.rooms
  SET status = 'PAID',
      paid_at = now(),
      payment_reviewed_at = now()
  WHERE id = v_room.id
  RETURNING * INTO v_room;

  RETURN v_room;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_room_from_wallet(
  text, text, text, text, bigint, bigint, integer, text, text, text, text, timestamptz, bigint[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room_from_wallet(
  text, text, text, text, bigint, bigint, integer, text, text, text, text, timestamptz, bigint[]
) TO authenticated;

-- ============================================================================
-- 5. ХЭТЭВЧЭЭР ХАМТЫН БЭЛГИЙН НЭМЭР
-- ============================================================================
CREATE OR REPLACE FUNCTION public.submit_group_contribution_from_wallet(
  p_room_id uuid,
  p_name text,
  p_amount bigint,
  p_message text
) RETURNS public.contributions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_raised bigint := 0;
  v_balance bigint;
  v_row public.contributions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Нэмэр хийхийн тулд нэвтрэх шаардлагатай.';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Өрөө олдсонгүй.';
  END IF;
  IF v_room.type <> 'group_pool' THEN
    RAISE EXCEPTION 'Энэ өрөө хамтын бэлэг биш байна.';
  END IF;
  IF v_room.status NOT IN ('active', 'PAID') THEN
    RAISE EXCEPTION 'Энэ өрөөнд нэмэр авах боломжгүй.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Зөв мөнгөн дүн оруулна уу.';
  END IF;

  IF v_room.total_amount > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_raised
    FROM public.contributions
    WHERE room_id = v_room.id AND status = 'PAID';
    IF v_raised >= v_room.total_amount THEN
      RAISE EXCEPTION 'Зорилго биелсэн тул нэмэр авахыг хаасан байна.';
    END IF;
  END IF;

  PERFORM public.ensure_profile_row(v_uid);

  SELECT balance INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF COALESCE(v_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Хэтэвчний үлдэгдэл хүрэлцэхгүй байна (үлдэгдэл: %₮)', COALESCE(v_balance, 0);
  END IF;

  INSERT INTO public.contributions
    (room_id, name, amount, message, status, payment_code, user_id)
  VALUES (
    v_room.id,
    COALESCE(NULLIF(trim(p_name), ''), 'Хэрэглэгч'),
    p_amount,
    NULLIF(trim(p_message), ''),
    'PENDING_APPROVAL',
    NULL,
    v_uid
  )
  RETURNING * INTO v_row;

  UPDATE public.profiles
  SET balance = COALESCE(balance, 0) - p_amount
  WHERE id = v_uid;

  INSERT INTO public.wallet_transactions (user_id, amount, type, status, description)
  VALUES (v_uid, p_amount, 'payment', 'completed',
          'Хамтын бэлэгт нэмэр («' || v_room.title || '») — хэтэвч');

  -- Түүхэн бичилт үүсэхийн тулд төлөвийг тусад нь PAID болгоно.
  UPDATE public.contributions
  SET status = 'PAID',
      payment_reviewed_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Зорилго биелсэн бол хүлээн авагчийн линк үүсгэнэ.
  IF v_room.total_amount > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_raised
    FROM public.contributions
    WHERE room_id = v_room.id AND status = 'PAID';

    IF v_raised >= v_room.total_amount THEN
      INSERT INTO public.gift_links (room_id, token)
      VALUES (
        v_room.id,
        replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
      )
      ON CONFLICT (room_id) DO NOTHING;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_group_contribution_from_wallet(uuid, text, bigint, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_group_contribution_from_wallet(uuid, text, bigint, text)
  TO authenticated;

-- ============================================================================
-- 6. БАНКНЫ ШИЛЖҮҮЛГЭЭГЭЭР НЭМЭР ХИЙХЭД НЭВТРЭХ ШААРДЛАГА
-- ============================================================================
CREATE OR REPLACE FUNCTION public.submit_group_contribution(
  p_room_id uuid,
  p_name text,
  p_amount bigint,
  p_message text,
  p_payment_code text
) RETURNS public.contributions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms;
  v_raised bigint;
  v_row public.contributions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Нэмэр хийхийн тулд нэвтрэх шаардлагатай.';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Өрөө олдсонгүй.';
  END IF;
  IF v_room.type <> 'group_pool' THEN
    RAISE EXCEPTION 'Энэ өрөө хамтын бэлэг биш байна.';
  END IF;
  IF v_room.status NOT IN ('active', 'PAID') THEN
    RAISE EXCEPTION 'Энэ өрөөнд нэмэр авах боломжгүй.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Зөв мөнгөн дүн оруулна уу.';
  END IF;

  IF v_room.total_amount > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_raised
    FROM public.contributions
    WHERE room_id = v_room.id AND status = 'PAID';
    IF v_raised >= v_room.total_amount THEN
      RAISE EXCEPTION 'Зорилго биелсэн тул нэмэр авахыг хаасан байна.';
    END IF;
  END IF;

  INSERT INTO public.contributions
    (room_id, name, amount, message, status, payment_code, user_id)
  VALUES (
    v_room.id,
    COALESCE(NULLIF(trim(p_name), ''), 'Хэрэглэгч'),
    p_amount,
    NULLIF(trim(p_message), ''),
    'PENDING_APPROVAL',
    NULLIF(trim(p_payment_code), ''),
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_group_contribution(uuid, text, bigint, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_group_contribution(uuid, text, bigint, text, text)
  TO authenticated;

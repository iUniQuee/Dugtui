-- ============================================================================
-- Хамтын бэлэг (group_pool) — төлбөр цуглуулах ба бэлэг хүлээлгэн өгөх урсгал
--
--  1. `contributions`-д `status` (PENDING_APPROVAL / PAID / REJECTED),
--     `payment_code`, `user_id`, `payment_reviewed_at`, `reject_reason` нэмнэ.
--     Хуучин (аль хэдийн цугласан) мөрүүд `PAID` төлөвтэй үлдэнэ.
--  2. Клиентээс шууд INSERT хийх эрхийг хааж, зөвхөн RPC-ээр PENDING хүсэлт
--     үүсгэдэг болгоно. Нийлбэрт зөвхөн админ баталгаажуулсан (PAID) нэмэр орно.
--  3. Зорилго 100% болмогц нэмэр авахыг RPC түвшинд хаана.
--  4. `gift_links` — зөвхөн өрөө үүсгэсэн хүн авдаг, таамаглах боломжгүй
--     хүлээн авагчийн линк. Линкээр нийт дүн, мэндчилгээ, дансны форм харна.
--  5. `gift_transfers` — хүлээн авагчийн илгээсэн дансны хүсэлт; админ
--     "Шилжүүлсэн" гэж баталмагц өрөө `completed` болно.
--
-- SQL Editor-т бүхэлд нь нэг удаа ажиллуулна. Дахин ажиллуулахад аюулгүй.
-- ============================================================================

-- ============================================================================
-- 1. CONTRIBUTIONS — шинэ баганууд
-- ============================================================================
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS payment_code text;
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS payment_reviewed_at timestamptz;
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS reject_reason text;

-- Хуучин мөрүүд аль хэдийн цугласан дүнд орсон тул PAID болгоно.
UPDATE public.contributions SET status = 'PAID' WHERE status IS NULL;
ALTER TABLE public.contributions ALTER COLUMN status SET DEFAULT 'PENDING_APPROVAL';
ALTER TABLE public.contributions ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contributions_status_check'
  ) THEN
    ALTER TABLE public.contributions
      ADD CONSTRAINT contributions_status_check
      CHECK (status IN ('PENDING_APPROVAL', 'PAID', 'REJECTED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contributions_room_status
  ON public.contributions(room_id, status);
CREATE INDEX IF NOT EXISTS idx_contributions_payment_code
  ON public.contributions(payment_code) WHERE payment_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contributions_user
  ON public.contributions(user_id) WHERE user_id IS NOT NULL;

-- Realtime-ээр админ самбарт шинэ хүсэлт, өөрчлөлт харагдана.
ALTER TABLE public.contributions REPLICA IDENTITY FULL;

-- Публик уншилт: зөвхөн батлагдсан нэмэр. Өөрийн pending-ээ харж болно.
DROP POLICY IF EXISTS "contributions_public_read" ON public.contributions;
DROP POLICY IF EXISTS "contributions_read_paid" ON public.contributions;
CREATE POLICY "contributions_read_paid" ON public.contributions
  FOR SELECT TO anon, authenticated USING (status = 'PAID');

DROP POLICY IF EXISTS "contributions_read_own" ON public.contributions;
CREATE POLICY "contributions_read_own" ON public.contributions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "contributions_admin_read" ON public.contributions;
CREATE POLICY "contributions_admin_read" ON public.contributions
  FOR SELECT TO authenticated USING (public.is_admin());

-- Шууд INSERT-ээр PAID мөр үүсгэх боломжийг хаана (RPC нь SECURITY DEFINER).
DROP POLICY IF EXISTS "contributions_public_insert" ON public.contributions;
REVOKE INSERT, UPDATE, DELETE ON public.contributions FROM anon, authenticated;
GRANT SELECT ON public.contributions TO anon, authenticated;

-- ============================================================================
-- 2. НЭМЭР ИЛГЭЭХ RPC (нэвтэрсэн бол user_id хадгална, үргэлж PENDING)
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

  -- Зорилго 100% болмогц шинэ нэмэр авахгүй.
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
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_group_contribution(uuid, text, bigint, text, text)
  TO anon, authenticated;

-- ============================================================================
-- 3. АДМИН НЭМЭР БАТАЛГААЖУУЛАХ / ТАТГАЛЗАХ
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_review_contribution(
  p_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
) RETURNS public.contributions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.contributions;
  v_room public.rooms;
  v_raised bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн админ баталгаажуулна.';
  END IF;

  SELECT * INTO v_row FROM public.contributions
  WHERE id = p_id AND status = 'PENDING_APPROVAL'
  FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Хүлээгдэж буй нэмэр олдсонгүй.';
  END IF;

  IF COALESCE(p_approve, false) THEN
    UPDATE public.contributions
    SET status = 'PAID',
        payment_reviewed_at = now(),
        reject_reason = NULL
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.contributions
    SET status = 'REJECTED',
        payment_reviewed_at = now(),
        reject_reason = NULLIF(trim(p_reason), '')
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  -- Зорилго биелсэн бол хүлээн авагчийн линкийг урьдчилан бэлдэнэ.
  SELECT * INTO v_room FROM public.rooms WHERE id = v_row.room_id;
  IF v_room.id IS NOT NULL AND v_room.total_amount > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_raised
    FROM public.contributions
    WHERE room_id = v_room.id AND status = 'PAID';
    IF v_raised >= v_room.total_amount THEN
      INSERT INTO public.gift_links (room_id, token)
      VALUES (v_room.id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
      ON CONFLICT (room_id) DO NOTHING;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_contribution(uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_contribution(uuid, boolean, text)
  TO authenticated;

-- ============================================================================
-- 4. GIFT LINKS — хүлээн авагчийн тусгай линк
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gift_links (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gift_links FROM anon, authenticated;

-- Зөвхөн өрөө үүсгэсэн хүн линк авна (зорилго биелсэн үед).
CREATE OR REPLACE FUNCTION public.ensure_gift_link(p_room_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms;
  v_raised bigint;
  v_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай.';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Өрөө олдсонгүй.';
  END IF;
  IF v_room.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Бэлгийн линкийг зөвхөн өрөө үүсгэсэн хүн авна.';
  END IF;
  IF v_room.total_amount <= 0 THEN
    RAISE EXCEPTION 'Энэ өрөөнд зорилтот дүн байхгүй.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_raised
  FROM public.contributions
  WHERE room_id = v_room.id AND status = 'PAID';
  IF v_raised < v_room.total_amount THEN
    RAISE EXCEPTION 'Зорилго хараахан биелээгүй байна.';
  END IF;

  INSERT INTO public.gift_links (room_id, token)
  VALUES (v_room.id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (room_id) DO NOTHING;

  SELECT token INTO v_token FROM public.gift_links WHERE room_id = v_room.id;
  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_gift_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_gift_link(uuid) TO authenticated;

-- Хүлээн авагчийн линкээр нээгдэх өгөгдөл: нийт дүн, бүх мэндчилгээ,
-- илгээсэн дансны төлөв. Токенгүй хүн дуудаж чадахгүй.
CREATE OR REPLACE FUNCTION public.get_gift_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms;
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

-- ============================================================================
-- 5. GIFT TRANSFERS — хүлээн авагчийн дансны хүсэлт
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gift_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL UNIQUE REFERENCES public.rooms(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_name text NOT NULL,
  amount bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CONSTRAINT gift_transfers_status_check CHECK (status IN ('pending', 'paid'))
);

CREATE INDEX IF NOT EXISTS idx_gift_transfers_status
  ON public.gift_transfers(status);

ALTER TABLE public.gift_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_transfers REPLICA IDENTITY FULL;
GRANT SELECT ON public.gift_transfers TO authenticated;

DROP POLICY IF EXISTS "gift_transfers_admin_read" ON public.gift_transfers;
CREATE POLICY "gift_transfers_admin_read" ON public.gift_transfers
  FOR SELECT TO authenticated USING (public.is_admin());

-- Хүлээн авагч дансаа илгээх (зөвхөн линкний токеноор).
CREATE OR REPLACE FUNCTION public.submit_gift_transfer(
  p_token text,
  p_bank_name text,
  p_account_number text,
  p_account_name text
) RETURNS public.gift_transfers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_room_id uuid;
  v_room public.rooms;
  v_total bigint;
  v_row public.gift_transfers;
BEGIN
  SELECT gl.room_id INTO v_room_id
  FROM public.gift_links gl
  WHERE gl.token = trim(COALESCE(p_token, ''));
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Линк хүчингүй байна.';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = v_room_id FOR UPDATE;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Өрөө олдсонгүй.';
  END IF;
  IF v_room.status = 'completed' THEN
    RAISE EXCEPTION 'Энэ бэлэг аль хэдийн хүргэгдсэн байна.';
  END IF;
  IF COALESCE(trim(p_bank_name), '') = ''
    OR COALESCE(trim(p_account_number), '') = ''
    OR COALESCE(trim(p_account_name), '') = '' THEN
    RAISE EXCEPTION 'Банк, дансны дугаар, нэрийг бүрэн бөглөнө үү.';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total
  FROM public.contributions
  WHERE room_id = v_room.id AND status = 'PAID';
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Цугласан дүн байхгүй байна.';
  END IF;

  INSERT INTO public.gift_transfers
    (room_id, bank_name, account_number, account_name, amount, status)
  VALUES (
    v_room.id,
    trim(p_bank_name),
    trim(p_account_number),
    trim(p_account_name),
    v_total,
    'pending'
  )
  ON CONFLICT (room_id) DO UPDATE
    SET bank_name = EXCLUDED.bank_name,
        account_number = EXCLUDED.account_number,
        account_name = EXCLUDED.account_name,
        amount = EXCLUDED.amount,
        status = 'pending',
        paid_at = NULL,
        created_at = now()
    WHERE public.gift_transfers.status = 'pending'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Хүсэлт аль хэдийн шилжүүлэгдсэн байна.';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_gift_transfer(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_gift_transfer(text, text, text, text)
  TO anon, authenticated;

-- Админ мөнгө шилжүүлээд "Шилжүүлсэн" дарна → өрөө completed.
CREATE OR REPLACE FUNCTION public.admin_complete_gift_transfer(p_id uuid)
RETURNS public.gift_transfers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.gift_transfers;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн админ шилжүүлгийг батална.';
  END IF;

  SELECT * INTO v_row FROM public.gift_transfers WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Шилжүүлэх хүсэлт олдсонгүй.';
  END IF;
  IF v_row.status = 'paid' THEN
    RETURN v_row;
  END IF;

  UPDATE public.gift_transfers
  SET status = 'paid', paid_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  UPDATE public.rooms
  SET status = 'completed'
  WHERE id = v_row.room_id;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_complete_gift_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_complete_gift_transfer(uuid) TO authenticated;

-- ============================================================================
-- 6. REALTIME
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.contributions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.gift_transfers;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

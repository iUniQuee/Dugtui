/* ============================================================================
   АДМИН ЭРХ + ТӨЛБӨРИЙН БАГАНУУД + RPC — НЭГ УДАА АЖИЛЛУУЛНА
   ----------------------------------------------------------------------------
   Supabase → SQL Editor дээр энэ файлыг БҮХЭЛД НЬ хуулж Run дарна.
   Дахин ажиллуулж болно (idempotent).

   Юу хийнэ:
   0. `admins` хүснэгт + `profiles.is_admin` → admin эрх (доор 1-Р АЛХАМ)
   1. `rooms.payment_code` (гүйлгээний утга) + payment_reviewed_at, reject_reason,
      claimed_by, claimed_at, paid_at  ← "Could not find the 'payment_code'
      column" алдаа үүгээр арилна. (Төлбөрийн төлөв нь `rooms.status` баганад
      'PENDING_APPROVAL' / 'PAID' / 'REJECTED' гэж хадгалагдана.)
   2. `platform_settings` — админы Богд банкны QR, данс, нэр
   3. `push_subscriptions` — утасны Web Push бүртгэл
   4. RPC: is_admin, save_platform_settings, admin_review_room,
      admin_complete_payout, admin_push_subscriptions, claim_gift_card
      (+ authenticated рольд EXECUTE эрх — өмнө нь дутуу байсан)
   ============================================================================ */

-- ============================================================ 0. ADMIN БҮРТГЭЛ
CREATE TABLE IF NOT EXISTS public.admins (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
-- Клиентээс шууд унших/бичих эрхгүй; зөвхөн SECURITY DEFINER функц уншина.
DROP POLICY IF EXISTS "admins_no_client_access" ON public.admins;

-- `profiles.is_admin` нь admins мөр оруулахгүйгээр эрх өгөх нөөц зам.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- is_admin баганыг клиентээс өөрчлөх боломжгүй болгоно.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT UPDATE (display_name, bank_name, account_number, account_name) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.admins a
      WHERE lower(a.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ---------------------------------------------------------------- 1. ROOMS
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS payment_code text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS payment_reviewed_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS claimed_by uuid;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS qpay_invoice_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_payment_code
  ON public.rooms(payment_code) WHERE payment_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_claimed_by ON public.rooms(claimed_by);

-- Төлбөргүй мөнгө үүсгэхээс сэргийлж: зөвхөн өөрийн нэр дээр, зөвхөн
-- PENDING_APPROVAL (эсвэл үнэгүй group_pool-ыг 'active') төлөвтэй оруулна.
DROP POLICY IF EXISTS "rooms_public_insert" ON public.rooms;
DROP POLICY IF EXISTS "rooms_insert_own" ON public.rooms;
CREATE POLICY "rooms_insert_own" ON public.rooms FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    status = 'PENDING_APPROVAL'
    OR (type = 'group_pool' AND status = 'active')
  )
);

REVOKE INSERT ON public.rooms FROM anon;
GRANT SELECT, INSERT ON public.rooms TO authenticated;
GRANT SELECT ON public.rooms TO anon;

-- ------------------------------------------------------- 2. PLATFORM SETTINGS
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name text NOT NULL DEFAULT 'Богд банк',
  account_number text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  qr_url text NOT NULL DEFAULT '/qr.png',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.platform_settings TO anon, authenticated;

DROP POLICY IF EXISTS "platform_settings_public_read" ON public.platform_settings;
CREATE POLICY "platform_settings_public_read" ON public.platform_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.save_platform_settings(
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_qr_url text
) RETURNS public.platform_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.platform_settings;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн админ тохиргоог өөрчилнө';
  END IF;

  INSERT INTO public.platform_settings (id, bank_name, account_number, account_name, qr_url, updated_at)
  VALUES (
    1,
    COALESCE(NULLIF(trim(p_bank_name), ''), 'Богд банк'),
    COALESCE(trim(p_account_number), ''),
    COALESCE(trim(p_account_name), ''),
    COALESCE(NULLIF(trim(p_qr_url), ''), '/qr.png'),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    bank_name = EXCLUDED.bank_name,
    account_number = EXCLUDED.account_number,
    account_name = EXCLUDED.account_name,
    qr_url = EXCLUDED.qr_url,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_platform_settings(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_platform_settings(text, text, text, text) TO authenticated;

-- ------------------------------------------------------- 3. PUSH SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

DROP POLICY IF EXISTS "push_subscriptions_read" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_read" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "push_subscriptions_insert" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_insert" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND public.is_admin());

DROP POLICY IF EXISTS "push_subscriptions_update" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_update" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subscriptions_delete" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_delete" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.admin_push_subscriptions()
RETURNS TABLE (endpoint text, p256dh text, auth text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT s.endpoint, s.p256dh, s.auth
  FROM public.push_subscriptions s
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_push_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_push_subscriptions() TO authenticated;

-- --------------------------------------------------------- 4. ADMIN ACTIONS
CREATE OR REPLACE FUNCTION public.admin_review_room(
  p_room_id uuid,
  p_approve boolean,
  p_reason text DEFAULT NULL
) RETURNS public.rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room public.rooms;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн админ төлбөрийг батална';
  END IF;

  IF p_approve THEN
    UPDATE public.rooms
    SET status = 'PAID',
        paid_at = now(),
        payment_reviewed_at = now(),
        reject_reason = NULL
    WHERE id = p_room_id AND status = 'PENDING_APPROVAL'
    RETURNING * INTO v_room;
  ELSE
    UPDATE public.rooms
    SET status = 'REJECTED',
        payment_reviewed_at = now(),
        reject_reason = NULLIF(trim(p_reason), '')
    WHERE id = p_room_id AND status = 'PENDING_APPROVAL'
    RETURNING * INTO v_room;
  END IF;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Хүсэлт олдсонгүй эсвэл аль хэдийн шийдвэрлэгдсэн байна';
  END IF;

  RETURN v_room;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_room(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_room(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_complete_payout(p_tx_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tx public.wallet_transactions;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Зөвхөн админ шилжүүлгийг батална';
  END IF;

  SELECT * INTO v_tx FROM public.wallet_transactions WHERE id = p_tx_id FOR UPDATE;

  IF v_tx.id IS NULL OR v_tx.type <> 'payout' THEN
    RAISE EXCEPTION 'Мөнгө татах хүсэлт олдсонгүй';
  END IF;

  IF v_tx.status = 'completed' THEN
    RETURN v_tx.id;
  END IF;

  UPDATE public.profiles
  SET balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0)
  WHERE id = v_tx.user_id;

  UPDATE public.wallet_transactions SET status = 'completed' WHERE id = v_tx.id;

  RETURN v_tx.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_complete_payout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_complete_payout(uuid) TO authenticated;

-- Бэлэг авах үед зөвхөн батлагдсан (PAID) бэлэг хэтэвчид орно.
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

-- ===================================================== 1-Р АЛХАМ: ADMIN ЭРХ
-- а) Өөрийн бүртгэлийг олж харах (email / профайл нэр):
SELECT u.id, u.email, p.display_name, p.is_admin
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at DESC
LIMIT 50;

-- б) Доорх 'CHANGE_ME@example.com'-ыг ӨӨРИЙН бүртгэлийн email-ээр солиод
--    энэ хоёр мөрийг тусдаа Run дарна:
-- INSERT INTO public.admins (email) VALUES ('CHANGE_ME@example.com')
--   ON CONFLICT (email) DO NOTHING;

-- в) Эсвэл email-гүй бол профайлын id-аар:
-- UPDATE public.profiles SET is_admin = true WHERE id = 'ӨӨРИЙН-USER-UUID';

-- ================================================ ШАЛГАЛТ (сервер тал)
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'rooms'
  AND column_name IN ('payment_code', 'payment_reviewed_at', 'reject_reason', 'paid_at', 'claimed_by')
ORDER BY column_name;

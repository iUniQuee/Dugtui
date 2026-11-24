/* ============================================================================
   DUGTUI — БҮХ СХЕМИЙГ НЭГ УДААГААР ҮҮСГЭХ SQL (ALL-IN-ONE)
   ----------------------------------------------------------------------------
   Supabase → SQL Editor → New query → энэ файлыг БҮХЭЛД НЬ хуулж → Run.

   Энэ скрипт нь `supabase/migrations/` доторх 7 миграцийг он цагийн дарааллаар
   нэгтгэж, хоосон (шинэ) database дээр ажиллахаар зассан хувилбар юм.
   Хуучин миграцууд нь `profiles`, `wallet_transactions` хүснэгтүүд өмнө нь
   гараар үүссэн гэж үздэг байсан — тиймээс "relation public.rooms does not
   exist" / "column display_name does not exist" гэсэн алдаа гардаг байв.
   Одоо бүх хүснэгт, багана, RLS policy, функц (RPC) энд бүрэн орсон.

   Юу үүснэ:
     • profiles              — хэрэглэгчийн нэр, хэтэвч (balance), банкны данс
     • admins                — админ эрх (email), клиентээс хандах боломжгүй
     • rooms                 — бэлгийн өрөө (+ payment_code, status, claimed_by…)
     • envelopes             — сугалааны дугтуй
     • contributions         — group_pool-ийн хувь нэмэр
     • withdrawals           — банк руу татах хүсэлт
     • wallet_transactions   — хэтэвчийн гүйлгээ (payout / win / refund)
     • platform_settings     — Богд банкны данс + QR (нэг мөр)
     • push_subscriptions    — админы Web Push төхөөрөмж
     • storage bucket        — `gift-images` (бэлгийн зураг)
     • RPC: is_admin, save_platform_settings, admin_review_room,
            admin_complete_payout, admin_push_subscriptions,
            claim_envelope, claim_gift_card, refund_expired_rooms

   Дахин ажиллуулж болно (бүх команд idempotent: IF NOT EXISTS / OR REPLACE /
   DROP POLICY IF EXISTS).

   ⚠️ АЖИЛЛУУЛСНЫ ДАРАА — ӨӨРИЙГӨӨ АДМИН БОЛГОХ:
   Скриптийн хамгийн доор «АЛХАМ 2» хэсэгт байгаа 2 мөрийг өөрийн email-ээр
   солиод тусдаа Run дарна (эсвэл profiles.is_admin = true болгоно).
   ============================================================================ */

-- pgcrypto: gen_random_bytes() (claim_envelope/claim_gift_card ашиглана).
-- gen_random_uuid() нь Postgres 13+ дээр цөмдөө байдаг.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- ============================================================================
-- 1. PROFILES  (хэрэглэгчийн профайл + хэтэвч)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Хэрэглэгч',
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bank_name text,
  account_number text,
  account_name text,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Хуучин/хэсэгчилсэн хүснэгт байсан ч дутуу баганыг нөхнө.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS balance bigint NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_public_read" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

-- Удирдах самбарт нэр харуулахын тулд нийтэд уншигдана.
CREATE POLICY "profiles_public_read" ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);

-- Нэвтэрсэн хэрэглэгч зөвхөн өөрийн мөрийг үүсгэнэ (шинэ бүртгэл).
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Зөвхөн өөрийн мөрийг, зөвхөн доорх баганаар шинэчилнэ (is_admin/balance хамгаалагдсан).
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT ON public.profiles TO authenticated;
REVOKE UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, bank_name, account_number, account_name) ON public.profiles TO authenticated;

-- ============================================================================
-- 2. ADMINS  (email-ээр админ эрх)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admins (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
-- Клиентээс шууд унших/бичих эрхгүй; зөвхөн SECURITY DEFINER функц уншина.
REVOKE ALL ON public.admins FROM anon, authenticated;
DROP POLICY IF EXISTS "admins_no_client_access" ON public.admins;

-- ============================================================================
-- 3. IS_ADMIN()  — бусад policy/функцууд үүнийг ашиглана
-- ============================================================================
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

-- ============================================================================
-- 4. ROOMS  (бэлгийн өрөө)
-- ============================================================================
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
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz,
  refunded boolean NOT NULL DEFAULT false,
  payment_code text,
  payment_reviewed_at timestamptz,
  reject_reason text,
  claimed_by uuid,
  claimed_at timestamptz,
  paid_at timestamptz,
  qpay_invoice_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Хуучин/хэсэгчилсэн хүснэгт байсан ч дутуу баганыг нөхнө.
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS refunded boolean NOT NULL DEFAULT false;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS payment_code text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS payment_reviewed_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS claimed_by uuid;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS qpay_invoice_id text;

CREATE INDEX IF NOT EXISTS idx_rooms_user_id ON public.rooms(user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_claimed_by ON public.rooms(claimed_by);
CREATE INDEX IF NOT EXISTS idx_rooms_qpay_invoice ON public.rooms(qpay_invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_payment_code
  ON public.rooms(payment_code) WHERE payment_code IS NOT NULL;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rooms_public_read" ON public.rooms;
DROP POLICY IF EXISTS "rooms_public_insert" ON public.rooms;
DROP POLICY IF EXISTS "rooms_insert_own" ON public.rooms;

-- Линкээр орж ирсэн зочин өрөөг уншина.
CREATE POLICY "rooms_public_read" ON public.rooms
  FOR SELECT TO anon, authenticated USING (true);

-- Төлбөргүй мөнгө үүсгэхээс сэргийлж: зөвхөн өөрийн нэр дээр, зөвхөн
-- PENDING_APPROVAL (төлбөртэй) эсвэл үнэгүй group_pool-ыг 'active' төлөвтэй.
CREATE POLICY "rooms_insert_own" ON public.rooms
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND (
      status = 'PENDING_APPROVAL'
      OR (type = 'group_pool' AND status = 'active')
    )
  );

GRANT SELECT ON public.rooms TO anon;
GRANT SELECT, INSERT ON public.rooms TO authenticated;
REVOKE INSERT ON public.rooms FROM anon;
REVOKE UPDATE, DELETE ON public.rooms FROM anon, authenticated;

-- ============================================================================
-- 5. ENVELOPES  (сугалааны дугтуй)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  claimed boolean NOT NULL DEFAULT false,
  claimed_by uuid,
  claimed_by_name text,
  claimed_by_phone text,
  claimed_at timestamptz,
  claim_token text UNIQUE
);

ALTER TABLE public.envelopes ADD COLUMN IF NOT EXISTS claimed_by uuid;

CREATE INDEX IF NOT EXISTS idx_envelopes_room ON public.envelopes(room_id);
CREATE INDEX IF NOT EXISTS idx_envelopes_claimed_by ON public.envelopes(claimed_by);

ALTER TABLE public.envelopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "envelopes_public_read" ON public.envelopes;
DROP POLICY IF EXISTS "envelopes_public_update" ON public.envelopes;

CREATE POLICY "envelopes_public_read" ON public.envelopes
  FOR SELECT TO anon, authenticated USING (true);

-- Дугтуйг зөвхөн claim_envelope() RPC (SECURITY DEFINER) зарцуулна.
GRANT SELECT, INSERT ON public.envelopes TO authenticated;
GRANT SELECT ON public.envelopes TO anon;
REVOKE UPDATE, DELETE ON public.envelopes FROM anon, authenticated;

-- ============================================================================
-- 6. CONTRIBUTIONS  (group_pool-ийн хувь нэмэр)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount bigint NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contributions_room ON public.contributions(room_id);

ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contributions_public_read" ON public.contributions;
DROP POLICY IF EXISTS "contributions_public_insert" ON public.contributions;

CREATE POLICY "contributions_public_read" ON public.contributions
  FOR SELECT TO anon, authenticated USING (true);

-- Зочин (нэвтрэхгүй) ч хувь нэмрээ оруулна.
CREATE POLICY "contributions_public_insert" ON public.contributions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.contributions TO anon, authenticated;
REVOKE UPDATE, DELETE ON public.contributions FROM anon, authenticated;

-- ============================================================================
-- 7. WITHDRAWALS  (банкны карт руу татах хүсэлт)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  envelope_id uuid REFERENCES public.envelopes(id) ON DELETE SET NULL,
  contributor_id text,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  participant_name text NOT NULL,
  amount bigint NOT NULL,
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_name text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawals_room ON public.withdrawals(room_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON public.withdrawals(user_id);

ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawals_public_read" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_public_insert" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_insert_own" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_read_own" ON public.withdrawals;

-- Дансны дугаар нь хувийн мэдээлэл: зөвхөн эзэн (эсвэл админ) уншина.
CREATE POLICY "withdrawals_read_own" ON public.withdrawals
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

-- Нэвтэрсэн хэрэглэгч өөрийн нэр дээр, зочин user_id-гүйгээр бичнэ.
CREATE POLICY "withdrawals_insert_own" ON public.withdrawals
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

GRANT SELECT, INSERT ON public.withdrawals TO anon, authenticated;
REVOKE UPDATE, DELETE ON public.withdrawals FROM anon, authenticated;

-- ============================================================================
-- 8. WALLET_TRANSACTIONS  (хэтэвчийн гүйлгээний бүртгэл)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  type text NOT NULL CHECK (type IN ('payout','win','refund')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  description text,
  bank_name text,
  account_number text,
  account_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS account_name text;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS idx_wallet_user ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_type_status ON public.wallet_transactions(type, status);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_select_own" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_insert_own" ON public.wallet_transactions;

CREATE POLICY "wallet_select_own" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- Зөвхөн 'payout' (мөнгө татах) хүсэлтийг клиентээс бичнэ.
-- 'win' / 'refund' нь зөвхөн SECURITY DEFINER функцээр бичигдэнэ.
CREATE POLICY "wallet_insert_own" ON public.wallet_transactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND type = 'payout' AND status = 'pending');

GRANT SELECT, INSERT ON public.wallet_transactions TO authenticated;
REVOKE UPDATE, DELETE ON public.wallet_transactions FROM anon, authenticated;

-- ============================================================================
-- 9. PLATFORM_SETTINGS  (Богд банкны данс + QR — нэг мөр)
-- ============================================================================
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

DROP POLICY IF EXISTS "platform_settings_public_read" ON public.platform_settings;
CREATE POLICY "platform_settings_public_read" ON public.platform_settings
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.platform_settings TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.platform_settings FROM anon, authenticated;

-- ============================================================================
-- 10. PUSH_SUBSCRIPTIONS  (админы төхөөрөмжийн Web Push)
-- ============================================================================
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

DROP POLICY IF EXISTS "push_subscriptions_read" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_insert" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_update" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_delete" ON public.push_subscriptions;

CREATE POLICY "push_subscriptions_read" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "push_subscriptions_insert" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND public.is_admin());

CREATE POLICY "push_subscriptions_update" ON public.push_subscriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_delete" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

-- ============================================================================
-- 11. STORAGE — `gift-images` bucket (бэлгийн картын зураг)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('gift-images', 'gift-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gift_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "gift_images_auth_upload" ON storage.objects;

CREATE POLICY "gift_images_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'gift-images');

CREATE POLICY "gift_images_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gift-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- 12. RPC — Тохиргоо хадгалах (зөвхөн админ)
-- ============================================================================
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

-- ============================================================================
-- 13. RPC — Push илгээх серверт админы төхөөрөмжүүдийг буцаана
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_push_subscriptions()
RETURNS TABLE (endpoint text, p256dh text, auth text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT s.endpoint, s.p256dh, s.auth
  FROM public.push_subscriptions s
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_push_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_push_subscriptions() TO authenticated;

-- ============================================================================
-- 14. RPC — Админ: төлбөрийг батлах / татгалзах
-- ============================================================================
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

-- ============================================================================
-- 15. RPC — Админ: мөнгө татах хүсэлтийг баталж, хэтэвчнээс хасна
-- ============================================================================
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

  -- Дахин дарахад хэтэвчнээс хоёр удаа хасагдахаас сэргийлнэ.
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

-- ============================================================================
-- 16. RPC — Дугтуй задлах (сугалаа) → хэтэвчид 'win' гүйлгээ
-- ============================================================================
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

  -- Шинэ бүртгэлд профайлын мөр байхгүй байж болно (хэтэвч/гүйлгээ унахаас сэргийлнэ).
  INSERT INTO public.profiles (id, display_name)
  SELECT u.id, COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'Хэрэглэгч')
  FROM auth.users u
  WHERE u.id = auth.uid()
  ON CONFLICT (id) DO NOTHING;

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

-- ============================================================================
-- 17. RPC — Бэлгийн карт авах → хэтэвчид 'win' гүйлгээ
--     (Зөвхөн төлбөр батлагдсан PAID/active бэлэг хэтэвчид орно.)
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

  -- Аль хэдийн авсан бол эзэн нь дахин нээж болно, өөр хүн бол алдаа.
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

  -- Шинэ бүртгэлд профайлын мөр байхгүй байж болно.
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
-- 18. RPC — Хугацаа дууссан сугалааны мөнгыг эзэнд буцаах
-- ============================================================================
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
      SET balance = COALESCE(balance, 0) + refund_sum
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

-- ============================================================================
-- 19. REALTIME  (дугтуй/хувь нэмэр/өрөөний өөрчлөлт шууд харагдана)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.envelopes;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.contributions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ============================================================================
-- ШАЛГАЛТ — бүх хүснэгт, функц үүссэн эсэх
-- ============================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
ORDER BY routine_name;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'rooms'
ORDER BY ordinal_position;

/* ============================================================================
   АЛХАМ 2 — ӨӨРИЙГӨӨ АДМИН БОЛГОХ  (дээрх скрипт амжилттай ажилласны дараа)
   ----------------------------------------------------------------------------
   Доорх SELECT нь бүртгэлүүдийг харуулна. Дараа нь ӨӨРИЙН email-ээр доорх
   INSERT-ийг (эсвэл id-гаар UPDATE-ыг) сонгож, тусдаа Run дарна.

   SELECT u.id, u.email, p.display_name, p.is_admin
   FROM auth.users u
   LEFT JOIN public.profiles p ON p.id = u.id
   ORDER BY u.created_at DESC
   LIMIT 50;

   INSERT INTO public.admins (email) VALUES ('CHANGE_ME@example.com')
     ON CONFLICT (email) DO NOTHING;

   -- Email-гүй бол профайлын id-гаар:
   UPDATE public.profiles SET is_admin = true WHERE id = 'ӨӨРИЙН-USER-UUID';
   ============================================================================ */

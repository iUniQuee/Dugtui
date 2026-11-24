-- ============================================================================
-- PRODUCTION-Ы ӨМНӨХ ЦЭВЭРЛЭГЭЭ
-- ----------------------------------------------------------------------------
-- Зорилго: туршилтын бүх өгөгдлийг устгаж, хэрэглэгчдийн хэтэвчийг 0₮ болгох.
--
-- ХАДГАЛАГДАНА:
--   • auth.users          - нэвтрэх данс, и-мэйл, нууц үг
--   • public.profiles     - нэр, банкны мэдээлэл (зөвхөн balance нь 0 болно)
--   • public.admins       - админ эрх
--   • public.platform_settings - банкны данс, QR тохиргоо
--   • public.push_subscriptions - админы төхөөрөмжийн push бүртгэл
--
-- УСТАНА:
--   • бүх өрөө (Азын дугтуй, Хамтын бэлэг, Мэндчилгээт бэлэг)
--   • оролцогчид, дугтуй, нэмэр, шилжүүлэг, бэлгийн линк
--   • гүйлгээний түүх, хэтэвчний гүйлгээ, татах хүсэлт
--
-- Үүний дараа админ самбарын болон нүүр хуудасны бүх тоолуур 0 болно
-- (тэдгээр нь rooms / envelopes / wallet_transactions-оос тооцогддог).
--
-- ХАМГААЛАЛТ: цэвэрлэгээ нэг л удаа ажиллана. Гүйцэтгэсний дараа
-- public.data_reset_log хүснэгтэд тэмдэг үлдэх бөгөөд дараа нь энэ файлыг
-- (эсвэл `supabase db push`-ыг) дахин ажиллуулахад юу ч устахгүй.
-- Тиймээс бодит өгөгдөл орж эхэлсний дараа энэ migration санамсаргүй
-- дахин ажиллах эрсдэлгүй.
--
-- АНХААР: эхний ажиллагаа буцаах боломжгүй. Production дээр Supabase
-- SQL Editor-оос эсвэл `supabase db push` командаар гүйцэтгэнэ.
-- ============================================================================

BEGIN;

-- Нэг удаагийн гүйцэтгэлийн тэмдэг (RLS-тэй, policyгүй: зөвхөн сервер харна).
CREATE TABLE IF NOT EXISTS public.data_reset_log (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reset_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.data_reset_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.data_reset_log) THEN
    RAISE NOTICE 'Цэвэрлэгээ аль хэдийн хийгдсэн. Дахин ажиллуулахгүй.';
    RETURN;
  END IF;

  -- 1. Туршилтын өрөө, оролцогч, гүйлгээ, хүсэлтүүд.
  --    rooms-ыг устгахад түүн рүү заасан бүх хүснэгт CASCADE-аар цэвэрлэгдэнэ.
  TRUNCATE TABLE
    public.transaction_history,
    public.wallet_transactions,
    public.gift_links,
    public.gift_transfers,
    public.withdrawals,
    public.contributions,
    public.room_participants,
    public.envelopes,
    public.rooms
    RESTART IDENTITY CASCADE;

  -- 2. Бүх хэрэглэгч (админ орно) хэтэвчний үлдэгдэл 0₮.
  UPDATE public.profiles
  SET balance = 0
  WHERE balance IS DISTINCT FROM 0;

  INSERT INTO public.data_reset_log (id) VALUES (1);

  RAISE NOTICE 'Туршилтын өгөгдөл устлаа. Бүх хэтэвч 0₮ боллоо.';
END $$;

COMMIT;

-- ============================================================================
-- ГҮЙЛГЭЭНИЙ ТҮҮХ (transaction_history)
--
--  1. Батлагдсан орлого (өрөөний төлбөр, хамтын бэлгийн нэмэр) болон
--     гүйцэтгэсэн зарлага (бэлэг шилжүүлэх, мөнгө татах)-ыг тусдаа
--     ledger хүснэгтэд мөнхөд хадгална. Өрөө/нэмэр устсан ч түүх үлдэнэ
--     (гадаад түлхүүргүй, нэр/дүнг snapshot хэлбэрээр хадгална).
--  2. Төлөв батлагдсан үед trigger автоматаар бичнэ — admin RPC-г дахин
--     бичих шаардлагагүй, аль ч замаар батлагдсан гүйлгээ бүртгэгдэнэ.
--  3. Өмнө нь батлагдсан мөрүүдийг backfill хийнэ.
--  4. Зөвхөн админ уншина (RLS). Бичих эрх зөвхөн SECURITY DEFINER
--     trigger функцуудад байна.
--
-- SQL Editor-т бүхэлд нь нэг удаа ажиллуулна. Дахин ажиллуулахад аюулгүй.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transaction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  source text NOT NULL CHECK (
    source IN ('lucky_draw', 'gift_card', 'group_pool', 'gift_transfer', 'payout')
  ),
  reference_id uuid NOT NULL,
  room_id uuid,
  room_title text,
  payment_code text,
  actor_name text,
  bank_name text,
  account_number text,
  account_name text,
  amount bigint NOT NULL,
  fee_amount bigint NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transaction_history_source_ref_key UNIQUE (source, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_tx_history_occurred
  ON public.transaction_history(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_history_payment_code
  ON public.transaction_history(payment_code);
CREATE INDEX IF NOT EXISTS idx_tx_history_actor
  ON public.transaction_history(actor_name);
CREATE INDEX IF NOT EXISTS idx_tx_history_kind
  ON public.transaction_history(kind, occurred_at DESC);

ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_history REPLICA IDENTITY FULL;

GRANT SELECT ON public.transaction_history TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transaction_history FROM anon, authenticated;

DROP POLICY IF EXISTS "transaction_history_admin_read" ON public.transaction_history;
CREATE POLICY "transaction_history_admin_read" ON public.transaction_history
  FOR SELECT TO authenticated USING (public.is_admin());

-- ============================================================================
-- 1. TRIGGER: Өрөөний төлбөр батлагдах (lucky_draw / gift_card)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_tx_history_room()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'PAID'
     AND COALESCE(OLD.status, '') <> 'PAID'
     AND NEW.type IN ('lucky_draw', 'gift_card') THEN
    INSERT INTO public.transaction_history
      (kind, source, reference_id, room_id, room_title, payment_code,
       actor_name, amount, fee_amount, occurred_at)
    VALUES
      ('income', NEW.type, NEW.id, NEW.id, NEW.title, NEW.payment_code,
       COALESCE(NULLIF(trim(NEW.organizer_name), ''), '—'),
       NEW.total_amount, NEW.fee_amount,
       COALESCE(NEW.payment_reviewed_at, NEW.paid_at, now()))
    ON CONFLICT (source, reference_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tx_history_room ON public.rooms;
CREATE TRIGGER trg_tx_history_room
  AFTER UPDATE OF status ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.log_tx_history_room();

-- ============================================================================
-- 2. TRIGGER: Хамтын бэлгийн нэмэр батлагдах
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_tx_history_contribution()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'PAID' AND COALESCE(OLD.status, '') <> 'PAID' THEN
    INSERT INTO public.transaction_history
      (kind, source, reference_id, room_id, room_title, payment_code,
       actor_name, amount, fee_amount, occurred_at)
    VALUES
      ('income', 'group_pool', NEW.id, NEW.room_id,
       (SELECT r.title FROM public.rooms r WHERE r.id = NEW.room_id),
       NEW.payment_code, NEW.name, NEW.amount, 0,
       COALESCE(NEW.payment_reviewed_at, now()))
    ON CONFLICT (source, reference_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tx_history_contribution ON public.contributions;
CREATE TRIGGER trg_tx_history_contribution
  AFTER UPDATE OF status ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION public.log_tx_history_contribution();

-- ============================================================================
-- 3. TRIGGER: Бэлэг шилжүүлэлт гүйцэтгэгдэх (зарлага)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_tx_history_gift_transfer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'paid' AND COALESCE(OLD.status, '') <> 'paid' THEN
    INSERT INTO public.transaction_history
      (kind, source, reference_id, room_id, room_title, payment_code,
       actor_name, bank_name, account_number, account_name,
       amount, fee_amount, occurred_at)
    VALUES
      ('expense', 'gift_transfer', NEW.id, NEW.room_id,
       (SELECT r.title FROM public.rooms r WHERE r.id = NEW.room_id),
       (SELECT r.payment_code FROM public.rooms r WHERE r.id = NEW.room_id),
       NEW.account_name, NEW.bank_name, NEW.account_number, NEW.account_name,
       NEW.amount, 0, COALESCE(NEW.paid_at, now()))
    ON CONFLICT (source, reference_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tx_history_gift_transfer ON public.gift_transfers;
CREATE TRIGGER trg_tx_history_gift_transfer
  AFTER UPDATE OF status ON public.gift_transfers
  FOR EACH ROW EXECUTE FUNCTION public.log_tx_history_gift_transfer();

-- ============================================================================
-- 4. TRIGGER: Мөнгө татах хүсэлт гүйцэтгэгдэх (зарлага)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_tx_history_payout()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.type = 'payout'
     AND NEW.status = 'completed'
     AND COALESCE(OLD.status, '') <> 'completed' THEN
    SELECT COALESCE(NULLIF(trim(p.display_name), ''), 'Хэрэглэгч')
      INTO v_name
      FROM public.profiles p
     WHERE p.id = NEW.user_id;

    INSERT INTO public.transaction_history
      (kind, source, reference_id, room_id, room_title, payment_code,
       actor_name, bank_name, account_number, account_name,
       amount, fee_amount, occurred_at)
    VALUES
      ('expense', 'payout', NEW.id, NULL, 'Хэтэвч', NULL,
       COALESCE(v_name, 'Хэрэглэгч'),
       NEW.bank_name, NEW.account_number,
       COALESCE(NULLIF(trim(NEW.account_name), ''), v_name),
       NEW.amount, 0, now())
    ON CONFLICT (source, reference_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tx_history_payout ON public.wallet_transactions;
CREATE TRIGGER trg_tx_history_payout
  AFTER UPDATE OF status ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.log_tx_history_payout();

-- ============================================================================
-- 5. BACKFILL — өмнө нь батлагдсан гүйлгээнүүд
-- ============================================================================
-- Өрөөний төлбөр (lucky_draw / gift_card)
INSERT INTO public.transaction_history
  (kind, source, reference_id, room_id, room_title, payment_code,
   actor_name, amount, fee_amount, occurred_at)
SELECT
  'income', r.type, r.id, r.id, r.title, r.payment_code,
  COALESCE(NULLIF(trim(r.organizer_name), ''), '—'),
  r.total_amount, r.fee_amount,
  COALESCE(r.payment_reviewed_at, r.paid_at, r.created_at)
FROM public.rooms r
WHERE r.type IN ('lucky_draw', 'gift_card')
  AND (r.status = 'PAID' OR r.paid_at IS NOT NULL)
ON CONFLICT (source, reference_id) DO NOTHING;

-- Хамтын бэлгийн батлагдсан нэмэр
INSERT INTO public.transaction_history
  (kind, source, reference_id, room_id, room_title, payment_code,
   actor_name, amount, fee_amount, occurred_at)
SELECT
  'income', 'group_pool', c.id, c.room_id, r.title, c.payment_code,
  c.name, c.amount, 0,
  COALESCE(c.payment_reviewed_at, c.created_at)
FROM public.contributions c
LEFT JOIN public.rooms r ON r.id = c.room_id
WHERE c.status = 'PAID'
ON CONFLICT (source, reference_id) DO NOTHING;

-- Гүйцэтгэсэн бэлэг шилжүүлэлт
INSERT INTO public.transaction_history
  (kind, source, reference_id, room_id, room_title, payment_code,
   actor_name, bank_name, account_number, account_name,
   amount, fee_amount, occurred_at)
SELECT
  'expense', 'gift_transfer', t.id, t.room_id, r.title, r.payment_code,
  t.account_name, t.bank_name, t.account_number, t.account_name,
  t.amount, 0, COALESCE(t.paid_at, t.created_at)
FROM public.gift_transfers t
LEFT JOIN public.rooms r ON r.id = t.room_id
WHERE t.status = 'paid'
ON CONFLICT (source, reference_id) DO NOTHING;

-- Гүйцэтгэсэн мөнгө таталт
INSERT INTO public.transaction_history
  (kind, source, reference_id, room_id, room_title, payment_code,
   actor_name, bank_name, account_number, account_name,
   amount, fee_amount, occurred_at)
SELECT
  'expense', 'payout', w.id, NULL, 'Хэтэвч', NULL,
  COALESCE(NULLIF(trim(p.display_name), ''), 'Хэрэглэгч'),
  w.bank_name, w.account_number,
  COALESCE(NULLIF(trim(w.account_name), ''), p.display_name),
  w.amount, 0, w.created_at
FROM public.wallet_transactions w
LEFT JOIN public.profiles p ON p.id = w.user_id
WHERE w.type = 'payout' AND w.status = 'completed'
ON CONFLICT (source, reference_id) DO NOTHING;

-- ============================================================================
-- 6. REALTIME — админ самбар аяндаа шинэчлэгдэнэ
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.transaction_history;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

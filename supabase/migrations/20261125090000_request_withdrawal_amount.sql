-- ============================================================================
-- ХЭТЭВЧНЭЭС ӨӨРӨӨ ДҮН СОНГОЖ МӨНГӨ ТАХИХ
-- ----------------------------------------------------------------------------
-- • Хэрэглэгч хамгийн багадаа 5,000₮, хамгийн ихдээ хэтэвчний үлдэгдэл
--   хүртэл дүнг оруулж хүсэлт илгээнэ.
-- • Хүсэлт илгээгдэх үед тухайн дүн хэтэвчний үлдэгдлээс ШУУД хасагдана
--   (үлдсэн мөнгө хэтэвчид хэвээр үлдэнэ).
-- • Админ «Шилжүүлсэн» гэж батлах үед хэтэвчнээс дахин хасахгүй.
-- • Банкны 200₮ шимтгэлийг админ самбар хүссэн дүнгээс тооцож харуулна.
-- ============================================================================

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS balance_deducted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount bigint,
  p_bank_name text,
  p_account_number text,
  p_account_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Мөнгө татах хүсэлт илгээхийн тулд нэвтрэх шаардлагатай.';
  END IF;

  IF p_amount IS NULL OR p_amount < 5000 THEN
    RAISE EXCEPTION 'Хамгийн багадаа 5,000₮ татах боломжтой.';
  END IF;

  IF NULLIF(trim(p_bank_name), '') IS NULL
     OR NULLIF(trim(p_account_number), '') IS NULL THEN
    RAISE EXCEPTION 'Эхлээд дансны мэдээллээ оруулж хадгална уу.';
  END IF;

  PERFORM public.ensure_profile_row(v_uid);

  SELECT balance INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF p_amount > COALESCE(v_balance, 0) THEN
    RAISE EXCEPTION 'Хэтэвчний үлдэгдэл хүрэлцэхгүй байна (үлдэгдэл: %₮)', COALESCE(v_balance, 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE user_id = v_uid AND type = 'payout' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Танд хүлээгдэж буй мөнгө татах хүсэлт байна.';
  END IF;

  UPDATE public.profiles
  SET balance = COALESCE(balance, 0) - p_amount
  WHERE id = v_uid;

  INSERT INTO public.wallet_transactions
    (user_id, amount, type, status, bank_name, account_number, account_name,
     description, balance_deducted)
  VALUES (
    v_uid, p_amount, 'payout', 'pending',
    trim(p_bank_name), trim(p_account_number), NULLIF(trim(p_account_name), ''),
    'Хэтэвчнээс мөнгө татах хүсэлт (банкны шимтгэл 200₮ суутгагдана)',
    true
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(bigint, text, text, text) TO authenticated;

-- Админ батлах үед хэтэвчнээс дахин хасахгүй: дүн нь хүсэлт илгээх үед
-- аль хэдийн хасагдсан. Зөвхөн хуучин (хасагдаагүй) хүсэлтийг л хасна.
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

  IF COALESCE(v_tx.balance_deducted, false) = false THEN
    UPDATE public.profiles
    SET balance = GREATEST(COALESCE(balance, 0) - v_tx.amount, 0)
    WHERE id = v_tx.user_id;
  END IF;

  UPDATE public.wallet_transactions
  SET status = 'completed', balance_deducted = true
  WHERE id = v_tx.id;

  RETURN v_tx.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_complete_payout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_complete_payout(uuid) TO authenticated;

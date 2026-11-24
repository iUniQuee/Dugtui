/* ============================================================================
   АЗЫН ДУГТУЙ — ОРOЛЦОГЧДЫН БҮРТГЭЛ + БҮРЭН ДҮҮРСЭН ҮЕД СУГАЛАА
   ----------------------------------------------------------------------------
   Supabase → SQL Editor дээр энэ файлыг БҮХЭЛД НЬ хуулж Run дарна.
   Дахин ажиллуулж болно (idempotent).

   Юу хийнэ:
   1. `room_participants` — линкээр орсон хэрэглэгчид (real-time).
   2. `join_lucky_room(room_id)` — нэвтэрсэн хэрэглэгчийн нэр/имэйлээр
      өрөөнд бүртгэнэ; дахин нэр асуухгүй.
   3. `start_lucky_draw(room_id)` — оролцогчдын тоо бүрэн бүрдсэн үед л
      дугтуйг серверт хуваана (random = нийлбэр яг тэнцүү, equal = тэнцүү).
   4. `claim_envelope()` — оролцогч бүрэн болоогүй бол задлахыг хориглоно,
      зөвхөн бүртгэгдсэн оролцогч задлана.
   5. `envelopes` INSERT бодлого — өрөө эзэмшигч дугтуй бэлдэх эрх.
   6. `room_participants`-ыг `supabase_realtime` publication-д нэмнэ.
   ============================================================================ */

-- ============================================================================
-- 1. ROOM PARTICIPANTS  (линкээр орсон хүмүүс — real-time)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Хэрэглэгч',
  email text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

ALTER TABLE public.room_participants ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS idx_room_participants_room ON public.room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user ON public.room_participants(user_id);

ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "room_participants_read" ON public.room_participants;
CREATE POLICY "room_participants_read" ON public.room_participants
  FOR SELECT TO anon, authenticated USING (true);

-- Оролцогч зөвхөн join_lucky_room() RPC-ээр бүртгэгдэнэ (нэр/имэйл серверээс авна).
GRANT SELECT ON public.room_participants TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.room_participants FROM anon, authenticated;

ALTER TABLE public.room_participants REPLICA IDENTITY FULL;

-- ============================================================================
-- 2. RPC — Өрөөнд орох (нэвтэрсэн хэрэглэгчийн нэр/имэйлээр)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.join_lucky_room(p_room_id uuid)
RETURNS public.room_participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room public.rooms;
  v_row public.room_participants;
  v_count integer;
  v_name text;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай';
  END IF;

  -- Зэрэг орох хүсэлтүүдийг дараалуулна (өрөө дүүрэхээс сэргийлж).
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Өрөө олдсонгүй';
  END IF;
  IF v_room.type <> 'lucky_draw' THEN
    RAISE EXCEPTION 'Зөвхөн сугалааны өрөөнд орно';
  END IF;

  SELECT * INTO v_row
  FROM public.room_participants
  WHERE room_id = p_room_id AND user_id = auth.uid();

  SELECT COALESCE(NULLIF(p.display_name, ''), NULLIF(split_part(u.email, '@', 1), ''), 'Хэрэглэгч'),
         u.email
    INTO v_name, v_email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = auth.uid();

  IF v_row.id IS NOT NULL THEN
    -- Нэрээ профайлаас шинэчилнэ (дахин нэр асуухгүй).
    IF v_name IS NOT NULL AND v_name <> v_row.display_name THEN
      UPDATE public.room_participants
      SET display_name = v_name, email = COALESCE(v_email, email)
      WHERE id = v_row.id
      RETURNING * INTO v_row;
    END IF;
    RETURN v_row;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.room_participants
  WHERE room_id = p_room_id;

  IF v_room.participant_count IS NOT NULL AND v_count >= v_room.participant_count THEN
    RAISE EXCEPTION 'Өрөө дүүрсэн байна (%/%)', v_count, v_room.participant_count;
  END IF;

  INSERT INTO public.room_participants (room_id, user_id, display_name, email)
  VALUES (p_room_id, auth.uid(), COALESCE(v_name, 'Хэрэглэгч'), v_email)
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET display_name = EXCLUDED.display_name
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_lucky_room(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_lucky_room(uuid) TO authenticated;

-- ============================================================================
-- 3. RPC — Сугалаа эхлүүлэх (оролцогч бүрэн болмогц дугтуйг серверт хуваана)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.start_lucky_draw(p_room_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_room public.rooms;
  v_existing integer;
  v_joined integer;
  v_count integer;
  v_total bigint;
  v_base bigint;
  v_rem bigint;
  v_weights double precision[];
  v_wsum double precision;
  v_amounts bigint[];
  v_sum bigint;
  v_diff bigint;
  v_i integer := 0;
  v_guard integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'Өрөө олдсонгүй';
  END IF;
  IF v_room.type <> 'lucky_draw' THEN
    RAISE EXCEPTION 'Зөвхөн сугалааны өрөөнд ажиллана';
  END IF;

  SELECT count(*) INTO v_existing FROM public.envelopes WHERE room_id = p_room_id;
  IF v_existing > 0 THEN
    RETURN 0;  -- дугтуй аль хэдийн бэлэн
  END IF;

  SELECT count(*) INTO v_joined FROM public.room_participants WHERE room_id = p_room_id;
  IF v_room.participant_count IS NULL OR v_room.participant_count <= 0 THEN
    RETURN 0;
  END IF;
  IF v_joined < v_room.participant_count THEN
    RETURN 0;  -- оролцогчид хүрээгүй
  END IF;

  v_count := v_room.participant_count;
  v_total := GREATEST(COALESCE(v_room.total_amount, 0), 0);
  IF v_total < v_count THEN
    RETURN 0;  -- хуваахад хэт бага дүн
  END IF;

  IF COALESCE(v_room.mode, 'random') = 'equal' THEN
    -- Тэнцүү хуваах: нийт дүн / оролцогчдын тоо (үлдэгдлийг эхний хүмүүст 1₮-өөр).
    v_base := v_total / v_count;
    v_rem := v_total - v_base * v_count;
    SELECT array_agg(v_base + CASE WHEN g < v_rem THEN 1 ELSE 0 END ORDER BY g)
      INTO v_amounts
    FROM generate_series(0, v_count - 1) g;
  ELSE
    -- Санамсаргүй хуваах: санамсаргүй жин → нийлбэр яг нийт дүнтэй тэнцэнэ.
    SELECT array_agg(random() + 0.5) INTO v_weights FROM generate_series(1, v_count);
    SELECT sum(w) INTO v_wsum FROM unnest(v_weights) w;
    SELECT array_agg(GREATEST(1, floor(v_total * w / v_wsum)::bigint) ORDER BY ord)
      INTO v_amounts
    FROM unnest(v_weights) WITH ORDINALITY AS t(w, ord);

    SELECT sum(a) INTO v_sum FROM unnest(v_amounts) a;
    v_diff := v_total - v_sum;
    -- Бөөрөнхийлөлтийн зөрүүг 1₮-өөр тараана.
    WHILE v_diff <> 0 AND v_guard < 100000 LOOP
      v_i := (v_i % v_count) + 1;
      IF v_diff > 0 THEN
        v_amounts[v_i] := v_amounts[v_i] + 1;
        v_diff := v_diff - 1;
      ELSIF v_amounts[v_i] > 1 THEN
        v_amounts[v_i] := v_amounts[v_i] - 1;
        v_diff := v_diff + 1;
      END IF;
      v_guard := v_guard + 1;
    END LOOP;
  END IF;

  INSERT INTO public.envelopes (room_id, amount)
  SELECT p_room_id, a FROM unnest(v_amounts) a;

  RETURN array_length(v_amounts, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_lucky_draw(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_lucky_draw(uuid) TO authenticated;

-- ============================================================================
-- 4. ENVELOPES — өрөө эзэмшигч дугтуй бэлдэх INSERT бодлого
--    (өмнө нь INSERT эрх/бодлого байхгүй тул CreateRoom-ийн INSERT чимээгүй
--     унаж, дугтуй огт үүсдэггүй байсан)
-- ============================================================================
DROP POLICY IF EXISTS "envelopes_insert_room_owner" ON public.envelopes;
CREATE POLICY "envelopes_insert_room_owner" ON public.envelopes
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.user_id = auth.uid())
  );

GRANT SELECT, INSERT ON public.envelopes TO authenticated;
GRANT SELECT ON public.envelopes TO anon;
REVOKE UPDATE, DELETE ON public.envelopes FROM anon, authenticated;

-- ============================================================================
-- 5. RPC — Дугтуй задлах (оролцогч бүрэн бүрдсэн үед л)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_envelope(p_envelope_id uuid, p_name text)
RETURNS public.envelopes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_room_type text;
  v_room_id uuid;
  v_required integer;
  v_joined integer;
  v_env public.envelopes;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Нэвтрэх шаардлагатай';
  END IF;

  SELECT ro.type, ro.id, ro.participant_count INTO v_room_type, v_room_id, v_required
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

  -- Оролцогчдын тоо бүрэн бүрдсэн үед л дугтуй задална.
  IF v_required IS NOT NULL AND v_required > 0 THEN
    SELECT count(*) INTO v_joined
    FROM public.room_participants
    WHERE room_id = v_room_id;

    IF v_joined < v_required THEN
      RAISE EXCEPTION 'Оролцогчдын тоо бүрэн бүрдээгүй байна (%/%)', v_joined, v_required;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = v_room_id AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Эхлээд өрөөнд орно уу';
    END IF;
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
-- 6. REALTIME — room_participants-ыг publication-д нэмнэ
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

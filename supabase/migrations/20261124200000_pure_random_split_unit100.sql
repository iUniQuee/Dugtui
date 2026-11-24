-- ============================================================================
-- Санамсаргүй хуваалт — зөвхөн 100₮-өөр бүхэлдсэн дүн, нийт дүн 100% хуваарилагдана
-- 0₮ (хоосон дугтуй) таарч болно.
-- ============================================================================

-- `p_units` нэгжийг `p_count` хэсэгт цэвэр санамсаргүйгээр хуваана.
-- Арга: 1..(units+count-1) мужаас (count-1) ялгаатай зүсэлт санамсаргүй сонгож,
-- хоорондын зайг тоолно (жигд санамсаргүй бүрдэл). Нийлбэр нь яг `p_units`.
CREATE OR REPLACE FUNCTION public.random_split_units(p_units bigint, p_count integer)
RETURNS bigint[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_span bigint;
  v_cuts bigint[] := '{}';
  v_amounts bigint[] := '{}';
  v_c bigint;
  v_prev bigint := 0;
  v_guard integer := 0;
  v_i integer;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN '{}';
  END IF;
  IF p_units IS NULL OR p_units <= 0 THEN
    RETURN array_fill(0::bigint, ARRAY[p_count]);
  END IF;
  IF p_count = 1 THEN
    RETURN ARRAY[p_units];
  END IF;

  v_span := p_units + p_count - 1;

  -- (count-1) ширхэг ялгаатай санамсаргүй зүсэлт
  WHILE coalesce(array_length(v_cuts, 1), 0) < p_count - 1 AND v_guard < 1000000 LOOP
    v_c := 1 + floor(random() * v_span)::bigint;
    IF NOT (v_c = ANY (v_cuts)) THEN
      v_cuts := array_append(v_cuts, v_c);
    END IF;
    v_guard := v_guard + 1;
  END LOOP;

  -- Ямар нэг шалтгаанаар зүсэлт дутвал тэнцүү хуваалт руу шилжинэ.
  IF coalesce(array_length(v_cuts, 1), 0) < p_count - 1 THEN
    RETURN (
      SELECT array_agg(p_units / p_count + CASE WHEN g < (p_units % p_count) THEN 1 ELSE 0 END)
      FROM generate_series(0, p_count - 1) g
    );
  END IF;

  SELECT array_agg(c ORDER BY c) INTO v_cuts FROM unnest(v_cuts) c;

  FOR v_i IN 1 .. (p_count - 1) LOOP
    v_amounts := array_append(v_amounts, v_cuts[v_i] - v_prev - 1);
    v_prev := v_cuts[v_i];
  END LOOP;
  v_amounts := array_append(v_amounts, v_span - v_prev);

  RETURN v_amounts;
END;
$$;

-- ============================================================================
-- start_lucky_draw — 100₮-ийн нэгжтэй хуваалт (equal & random)
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
  v_units bigint;
  v_rest bigint;
  v_base bigint;
  v_rem bigint;
  v_units_arr bigint[];
  v_amounts bigint[];
  v_i integer;
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
  v_units := v_total / 100;
  v_rest := v_total - v_units * 100;  -- 100₮-д бүхэлдэхгүй үлдэгдэл

  IF COALESCE(v_room.mode, 'random') = 'equal' THEN
    -- Тэнцүү хуваах: 100₮-ийн нэгжийг тэнцүү хувааж, үлдэгдлийг эхнийхүүдэд нэмнэ.
    v_base := v_units / v_count;
    v_rem := v_units - v_base * v_count;
    SELECT array_agg(v_base + CASE WHEN g < v_rem THEN 1 ELSE 0 END ORDER BY g)
      INTO v_units_arr
    FROM generate_series(0, v_count - 1) g;
  ELSE
    -- Цэвэр санамсаргүй: 0₮ (хоосон дугтуй) таарч болно, нийлбэр яг тэнцүү.
    v_units_arr := public.random_split_units(v_units, v_count);
  END IF;

  SELECT array_agg(u * 100) INTO v_amounts FROM unnest(v_units_arr) u;

  -- 100₮-д бүхэлдэхгүй үлдэгдлийг санамсаргүй нэг дугтуйд нэмж 100% хуваарилна.
  IF v_rest > 0 THEN
    v_i := 1 + floor(random() * v_count)::integer;
    v_amounts[v_i] := v_amounts[v_i] + v_rest;
  END IF;

  INSERT INTO public.envelopes (room_id, amount)
  SELECT p_room_id, a FROM unnest(v_amounts) a;

  RETURN array_length(v_amounts, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_lucky_draw(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_lucky_draw(uuid) TO authenticated;

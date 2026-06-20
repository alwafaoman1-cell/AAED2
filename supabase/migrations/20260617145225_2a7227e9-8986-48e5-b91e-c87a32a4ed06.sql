
-- ============================================================
-- 1. أعمدة جديدة
-- ============================================================
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS plate_letters text,
  ADD COLUMN IF NOT EXISTS plate_country text NOT NULL DEFAULT 'OM';

-- ============================================================
-- 2. دوال مساعدة (IMMUTABLE — صالحة للاستخدام في الفهارس)
-- ============================================================

-- استخراج الأرقام فقط
CREATE OR REPLACE FUNCTION public.extract_plate_digits(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g')
$$;

-- استخراج الحروف فقط (إنجليزية فقط — كبيرة)
-- ملاحظة: حروف عربية شائعة في لوحات عُمان تُحوَّل تلقائياً إلى Latin
CREATE OR REPLACE FUNCTION public.extract_plate_letters(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(
    regexp_replace(
      translate(
        COALESCE(p, ''),
        'ابتثجحخدذرزسشصضطظعغفقكلمنهوي',
        'ABTTJHKDDRZSSSDTZAGFQKLMNHWY'
      ),
      '[^A-Za-z]', '', 'g'
    )
  )
$$;

-- ============================================================
-- 3. تعبئة الأعمدة الجديدة من القيمة الحالية
-- ============================================================
UPDATE public.vehicles
SET
  plate_letters = public.extract_plate_letters(plate_number),
  plate_number  = COALESCE(NULLIF(public.extract_plate_digits(plate_number), ''), plate_number)
WHERE plate_letters IS NULL;

-- ============================================================
-- 4. Trigger: تطبيع الحقول تلقائياً عند الإدخال/التعديل
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_vehicle_plate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_raw_letters text;
  v_raw_digits  text;
BEGIN
  -- تنظيف الحروف
  v_raw_letters := COALESCE(NEW.plate_letters, '');
  NEW.plate_letters := upper(
    regexp_replace(
      translate(v_raw_letters, 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', 'ABTTJHKDDRZSSSDTZAGFQKLMNHWY'),
      '[^A-Za-z]', '', 'g'
    )
  );

  -- تنظيف الأرقام (plate_number أصبح أرقاماً فقط)
  v_raw_digits := COALESCE(NEW.plate_number, '');
  NEW.plate_number := regexp_replace(v_raw_digits, '[^0-9]', '', 'g');

  -- تنظيف الدولة
  NEW.plate_country := COALESCE(NULLIF(upper(trim(NEW.plate_country)), ''), 'OM');

  -- إذا أُدخلت اللوحة كاملة في plate_number (مثل "AA 12345") نوزّعها
  IF NEW.plate_number = '' AND NEW.plate_letters = '' AND v_raw_digits <> '' THEN
    NEW.plate_letters := public.extract_plate_letters(v_raw_digits);
    NEW.plate_number  := public.extract_plate_digits(v_raw_digits);
  END IF;

  -- يجب أن يبقى plate_number غير فارغ (NOT NULL في الجدول)
  IF NEW.plate_number IS NULL OR NEW.plate_number = '' THEN
    NEW.plate_number := 'TMP' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_vehicle_plate ON public.vehicles;
CREATE TRIGGER trg_normalize_vehicle_plate
  BEFORE INSERT OR UPDATE OF plate_number, plate_letters, plate_country
  ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_vehicle_plate();

-- ============================================================
-- 5. دالة بحث ذكي (تُستخدم من الواجهة قبل الحفظ لمنع التكرار)
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_vehicle_by_plate(
  p_letters text,
  p_digits  text,
  p_country text DEFAULT 'OM'
)
RETURNS TABLE (
  id uuid,
  customer_id uuid,
  plate_number text,
  plate_letters text,
  plate_country text,
  brand text,
  model text,
  year integer,
  color text,
  archived boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.customer_id, v.plate_number, v.plate_letters, v.plate_country,
         v.brand, v.model, v.year, v.color, v.archived
  FROM public.vehicles v
  WHERE v.tenant_id = public.get_user_tenant_id()
    AND v.plate_number  = public.extract_plate_digits(p_digits)
    AND v.plate_letters = upper(regexp_replace(translate(COALESCE(p_letters,''),'ابتثجحخدذرزسشصضطظعغفقكلمنهوي','ABTTJHKDDRZSSSDTZAGFQKLMNHWY'),'[^A-Za-z]','','g'))
    AND v.plate_country = COALESCE(NULLIF(upper(trim(p_country)),''), 'OM')
  ORDER BY v.archived ASC, v.created_at ASC
  LIMIT 5
$$;

GRANT EXECUTE ON FUNCTION public.find_vehicle_by_plate(text, text, text) TO authenticated;

-- ============================================================
-- 6. عرض رصد المكررات (لشاشة "تنظيف المركبات")
-- ============================================================
CREATE OR REPLACE VIEW public.vehicle_duplicates AS
SELECT
  tenant_id,
  plate_letters,
  plate_number,
  plate_country,
  COUNT(*) AS dup_count,
  array_agg(id ORDER BY created_at) AS vehicle_ids,
  array_agg(brand || ' ' || model ORDER BY created_at) AS vehicle_labels,
  MIN(created_at) AS first_created_at,
  MAX(updated_at) AS last_updated_at
FROM public.vehicles
WHERE archived = false
  AND plate_letters IS NOT NULL
  AND plate_letters <> ''
GROUP BY tenant_id, plate_letters, plate_number, plate_country
HAVING COUNT(*) > 1;

GRANT SELECT ON public.vehicle_duplicates TO authenticated;

-- ============================================================
-- 7. فهرس مساعد (يسرّع البحث، ويُمهّد لإضافة UNIQUE لاحقاً)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_vehicles_plate_split
  ON public.vehicles (tenant_id, plate_letters, plate_number, plate_country)
  WHERE archived = false;

-- ============================================================
-- 8. تحديث الـ trigger auto_create_job_order_on_approval ليستخدم الحقول الجديدة
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_create_job_order_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_vehicle_id uuid;
  v_should_create boolean := false;
  v_entry_date date;
  v_letters text;
  v_digits  text;
BEGIN
  IF NEW.auto_job_order_id IS NULL
     AND NEW.status = 'approved' THEN
    IF TG_OP = 'INSERT' THEN
      v_should_create := true;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.status IS DISTINCT FROM 'approved' THEN
        v_should_create := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_should_create THEN
    RETURN NEW;
  END IF;

  v_vehicle_id := NEW.vehicle_id;
  v_letters := public.extract_plate_letters(NEW.vehicle_plate);
  v_digits  := public.extract_plate_digits(NEW.vehicle_plate);

  IF v_vehicle_id IS NULL THEN
    IF NEW.vehicle_plate IS NOT NULL AND NEW.vehicle_plate <> '' THEN
      SELECT id INTO v_vehicle_id
      FROM public.vehicles
      WHERE tenant_id = NEW.tenant_id
        AND customer_id = NEW.customer_id
        AND plate_letters = v_letters
        AND plate_number  = v_digits
      LIMIT 1;
    END IF;

    IF v_vehicle_id IS NULL THEN
      INSERT INTO public.vehicles (
        tenant_id, customer_id, brand, model, plate_number, plate_letters, plate_country, year, color
      ) VALUES (
        NEW.tenant_id,
        NEW.customer_id,
        COALESCE(NULLIF(NEW.vehicle_make, ''), 'غير محدد'),
        COALESCE(NULLIF(NEW.vehicle_model, ''), 'غير محدد'),
        COALESCE(NULLIF(v_digits, ''), 'TMP' || substr(NEW.id::text, 1, 8)),
        v_letters,
        'OM',
        NEW.vehicle_year,
        NEW.vehicle_color
      )
      RETURNING id INTO v_vehicle_id;
    END IF;

    NEW.vehicle_id := v_vehicle_id;
  END IF;

  v_entry_date := COALESCE(
    NEW.workshop_arrival_date::date,
    NEW.estimate_date::date,
    CURRENT_DATE
  );

  INSERT INTO public.job_orders (
    tenant_id, customer_id, vehicle_id,
    description, diagnosis,
    labor_cost, parts_cost,
    status,
    insurance_claim_number,
    insurance_approved,
    entry_date
  ) VALUES (
    NEW.tenant_id,
    NEW.customer_id,
    v_vehicle_id,
    COALESCE(NEW.incident_description, 'مطالبة تأمين معتمدة #' || NEW.claim_number),
    'وارد من المطالبة ' || NEW.claim_number || ' - ' || COALESCE(NEW.insurance_company,'') ||
      CASE WHEN NEW.vehicle_make IS NOT NULL
        THEN ' | المركبة: ' || COALESCE(NEW.vehicle_make,'') || ' ' || COALESCE(NEW.vehicle_model,'') || ' - ' || COALESCE(NEW.vehicle_plate,'')
        ELSE ''
      END,
    0,
    COALESCE(NEW.approved_amount, NEW.estimated_amount, 0),
    'received'::job_status,
    NEW.claim_number,
    true,
    v_entry_date
  )
  RETURNING id INTO v_order_id;

  NEW.auto_job_order_id := v_order_id;
  NEW.job_order_id := COALESCE(NEW.job_order_id, v_order_id);

  INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, details)
  VALUES (NEW.tenant_id, NEW.id, auth.uid(), 'job_order_created',
    jsonb_build_object('job_order_id', v_order_id, 'auto', true, 'vehicle_id', v_vehicle_id,
      'entry_date', v_entry_date, 'trigger', 'claim_approved'));

  RETURN NEW;
END $function$;

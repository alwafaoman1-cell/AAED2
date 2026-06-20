
-- 1) تعديل trigger لإنشاء سيارة تلقائياً إذا لم تكن مرتبطة
CREATE OR REPLACE FUNCTION public.auto_create_job_order_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_vehicle_id uuid;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') AND NEW.auto_job_order_id IS NULL THEN
    v_vehicle_id := NEW.vehicle_id;

    -- إذا لا توجد سيارة مرتبطة، أنشئها من بيانات المطالبة
    IF v_vehicle_id IS NULL THEN
      IF NEW.vehicle_plate IS NOT NULL AND NEW.vehicle_plate <> '' THEN
        -- ابحث أولاً عن سيارة بنفس اللوحة لنفس العميل
        SELECT id INTO v_vehicle_id
        FROM public.vehicles
        WHERE tenant_id = NEW.tenant_id
          AND customer_id = NEW.customer_id
          AND lower(plate_number) = lower(NEW.vehicle_plate)
        LIMIT 1;
      END IF;

      IF v_vehicle_id IS NULL THEN
        INSERT INTO public.vehicles (
          tenant_id, customer_id, brand, model, plate_number, year, color
        ) VALUES (
          NEW.tenant_id,
          NEW.customer_id,
          COALESCE(NULLIF(NEW.vehicle_make, ''), 'غير محدد'),
          COALESCE(NULLIF(NEW.vehicle_model, ''), 'غير محدد'),
          COALESCE(NULLIF(NEW.vehicle_plate, ''), 'TMP-' || substr(NEW.id::text, 1, 8)),
          NEW.vehicle_year,
          NEW.vehicle_color
        )
        RETURNING id INTO v_vehicle_id;
      END IF;

      NEW.vehicle_id := v_vehicle_id;
    END IF;

    INSERT INTO public.job_orders (
      tenant_id, customer_id, vehicle_id,
      description, diagnosis,
      labor_cost, parts_cost,
      status,
      insurance_claim_number,
      insurance_approved
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
      true
    )
    RETURNING id INTO v_order_id;

    NEW.auto_job_order_id := v_order_id;
    NEW.job_order_id := COALESCE(NEW.job_order_id, v_order_id);

    INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, details)
    VALUES (NEW.tenant_id, NEW.id, auth.uid(), 'job_order_created',
      jsonb_build_object('job_order_id', v_order_id, 'auto', true, 'vehicle_id', v_vehicle_id));
  END IF;

  RETURN NEW;
END $function$;

-- 2) إثراء مكتبة الماركات العالمية (is_global=true)
INSERT INTO public.vehicle_makes (name, name_ar, is_global, tenant_id) VALUES
  ('Acura', 'أكورا', true, NULL),
  ('Alfa Romeo', 'ألفا روميو', true, NULL),
  ('Aston Martin', 'أستون مارتن', true, NULL),
  ('Bentley', 'بنتلي', true, NULL),
  ('Buick', 'بويك', true, NULL),
  ('BYD', 'بي واي دي', true, NULL),
  ('Chrysler', 'كرايسلر', true, NULL),
  ('Citroen', 'ستروين', true, NULL),
  ('Daihatsu', 'دايهاتسو', true, NULL),
  ('Dongfeng', 'دونغ فينغ', true, NULL),
  ('Ferrari', 'فيراري', true, NULL),
  ('Fiat', 'فيات', true, NULL),
  ('Foton', 'فوتون', true, NULL),
  ('GAC', 'جي إيه سي', true, NULL),
  ('Great Wall', 'جريت وول', true, NULL),
  ('Hino', 'هينو', true, NULL),
  ('Hummer', 'هامر', true, NULL),
  ('JAC', 'جاك', true, NULL),
  ('Jetour', 'جتور', true, NULL),
  ('Lamborghini', 'لامبورجيني', true, NULL),
  ('Lincoln', 'لينكولن', true, NULL),
  ('Lotus', 'لوتس', true, NULL),
  ('Maserati', 'مازيراتي', true, NULL),
  ('Maybach', 'مايباخ', true, NULL),
  ('McLaren', 'ماكلارين', true, NULL),
  ('Mini', 'ميني', true, NULL),
  ('Opel', 'أوبل', true, NULL),
  ('Pagani', 'باغاني', true, NULL),
  ('Polestar', 'بولستار', true, NULL),
  ('Ram', 'رام', true, NULL),
  ('Rolls-Royce', 'رولز رويس', true, NULL),
  ('Saab', 'ساب', true, NULL),
  ('SEAT', 'سيات', true, NULL),
  ('Skoda', 'سكودا', true, NULL),
  ('Smart', 'سمارت', true, NULL),
  ('SsangYong', 'سانج يونج', true, NULL),
  ('Tata', 'تاتا', true, NULL),
  ('Tesla', 'تسلا', true, NULL),
  ('UAZ', 'أواز', true, NULL),
  ('Wuling', 'وولينغ', true, NULL),
  ('Lada', 'لادا', true, NULL),
  ('GAZ', 'غاز', true, NULL),
  ('NIO', 'نيو', true, NULL),
  ('Lucid', 'لوسيد', true, NULL),
  ('Rivian', 'ريفيان', true, NULL),
  ('Mahindra', 'ماهيندرا', true, NULL),
  ('Proton', 'بروتون', true, NULL),
  ('Perodua', 'بيرودوا', true, NULL),
  ('Holden', 'هولدن', true, NULL),
  ('Datsun', 'داتسون', true, NULL)
ON CONFLICT DO NOTHING;

-- توحيد الماركات الموجودة لتكون عالمية
UPDATE public.vehicle_makes SET is_global = true, tenant_id = NULL
WHERE name IN ('Toyota','Nissan','Hyundai','Kia','Honda','Mazda','Mitsubishi','Suzuki','Lexus','Infiniti','BMW','Mercedes-Benz','Audi','Volkswagen','Porsche','Volvo','Land Rover','Range Rover','Jaguar','Ford','Chevrolet','GMC','Cadillac','Dodge','Jeep','Isuzu','Subaru','Renault','Peugeot','Genesis','Chery','Geely','Haval','Changan','MG');

-- 3) إثراء الموديلات العالمية لكل ماركة
WITH m AS (SELECT id, name FROM public.vehicle_makes WHERE is_global = true)
INSERT INTO public.vehicle_models (make_id, name, name_ar, is_global, tenant_id)
SELECT m.id, x.model, x.model_ar, true, NULL
FROM m JOIN (VALUES
  -- Toyota
  ('Toyota','Camry','كامري'),('Toyota','Corolla','كورولا'),('Toyota','Land Cruiser','لاند كروزر'),
  ('Toyota','Prado','برادو'),('Toyota','Hilux','هايلكس'),('Toyota','Fortuner','فورتشنر'),
  ('Toyota','Yaris','يارس'),('Toyota','RAV4','راف 4'),('Toyota','Highlander','هايلاندر'),
  ('Toyota','Avalon','أفالون'),('Toyota','Innova','إنوفا'),('Toyota','Hiace','هايس'),
  ('Toyota','Coaster','كوستر'),('Toyota','Sequoia','سيكويا'),('Toyota','Tundra','تندرا'),
  ('Toyota','4Runner','فور رنر'),('Toyota','Supra','سوبرا'),('Toyota','GR86','جي آر 86'),
  ('Toyota','C-HR','سي إتش آر'),('Toyota','Rush','راش'),('Toyota','Crown','كراون'),
  ('Toyota','Avanza','أفانزا'),('Toyota','Veloz','فيلوز'),('Toyota','Raize','رايز'),
  -- Nissan
  ('Nissan','Altima','ألتيما'),('Nissan','Sunny','صني'),('Nissan','Maxima','ماكسيما'),
  ('Nissan','Patrol','باترول'),('Nissan','X-Trail','إكستريل'),('Nissan','Pathfinder','باثفايندر'),
  ('Nissan','Navara','نافارا'),('Nissan','Sentra','سنترا'),('Nissan','Kicks','كيكس'),
  ('Nissan','Juke','جوك'),('Nissan','Murano','مورانو'),('Nissan','Armada','أرمادا'),
  ('Nissan','370Z','370 زد'),('Nissan','GT-R','جي تي آر'),('Nissan','Tiida','تيدا'),
  ('Nissan','Urvan','أورفان'),('Nissan','Civilian','سيفيليان'),
  -- Hyundai
  ('Hyundai','Sonata','سوناتا'),('Hyundai','Elantra','إلنترا'),('Hyundai','Accent','أكسنت'),
  ('Hyundai','Tucson','توسان'),('Hyundai','Santa Fe','سانتافي'),('Hyundai','Creta','كريتا'),
  ('Hyundai','Kona','كونا'),('Hyundai','Palisade','باليسيد'),('Hyundai','Venue','فينيو'),
  ('Hyundai','i10','آي 10'),('Hyundai','i20','آي 20'),('Hyundai','i30','آي 30'),
  ('Hyundai','H-1','إتش 1'),('Hyundai','Staria','ستاريا'),('Hyundai','Veloster','فيلوستر'),
  ('Hyundai','Genesis','جنسيس'),('Hyundai','Azera','أزيرا'),('Hyundai','Ioniq','أيونيك'),
  -- Kia
  ('Kia','Cerato','سيراتو'),('Kia','Optima','أوبتيما'),('Kia','K5','كي 5'),
  ('Kia','Sportage','سبورتاج'),('Kia','Sorento','سورينتو'),('Kia','Telluride','تيلورايد'),
  ('Kia','Picanto','بيكانتو'),('Kia','Rio','ريو'),('Kia','Carnival','كرنفال'),
  ('Kia','Seltos','سيلتوس'),('Kia','Stinger','ستينجر'),('Kia','Soul','سول'),
  ('Kia','Mohave','موهافي'),('Kia','Niro','نيرو'),('Kia','Carens','كارينز'),
  -- Honda
  ('Honda','Accord','أكورد'),('Honda','Civic','سيفيك'),('Honda','City','سيتي'),
  ('Honda','CR-V','سي آر في'),('Honda','HR-V','إتش آر في'),('Honda','Pilot','بايلوت'),
  ('Honda','Odyssey','أوديسي'),('Honda','Jazz','جاز'),('Honda','BR-V','بي آر في'),
  ('Honda','ZR-V','زد آر في'),('Honda','Passport','باسبورت'),('Honda','Ridgeline','ريدج لاين'),
  -- Mazda
  ('Mazda','Mazda3','مازدا 3'),('Mazda','Mazda6','مازدا 6'),('Mazda','CX-3','سي إكس 3'),
  ('Mazda','CX-5','سي إكس 5'),('Mazda','CX-9','سي إكس 9'),('Mazda','CX-30','سي إكس 30'),
  ('Mazda','CX-90','سي إكس 90'),('Mazda','MX-5','إم إكس 5'),('Mazda','BT-50','بي تي 50'),
  -- Mitsubishi
  ('Mitsubishi','Lancer','لانسر'),('Mitsubishi','Pajero','باجيرو'),('Mitsubishi','Pajero Sport','باجيرو سبورت'),
  ('Mitsubishi','L200','إل 200'),('Mitsubishi','ASX','إيه إس إكس'),('Mitsubishi','Outlander','أوتلاندر'),
  ('Mitsubishi','Eclipse Cross','إكليبس كروس'),('Mitsubishi','Attrage','أترج'),('Mitsubishi','Mirage','ميراج'),
  ('Mitsubishi','Xpander','إكسباندر'),('Mitsubishi','Montero','مونتيرو'),
  -- Suzuki
  ('Suzuki','Swift','سويفت'),('Suzuki','Baleno','بالينو'),('Suzuki','Vitara','فيتارا'),
  ('Suzuki','Grand Vitara','جراند فيتارا'),('Suzuki','Jimny','جيمني'),('Suzuki','Ciaz','سياز'),
  ('Suzuki','Dzire','دزاير'),('Suzuki','Ertiga','إرتيجا'),('Suzuki','S-Cross','إس كروس'),
  -- Lexus
  ('Lexus','ES','إي إس'),('Lexus','LS','إل إس'),('Lexus','IS','آي إس'),('Lexus','RX','آر إكس'),
  ('Lexus','NX','إن إكس'),('Lexus','UX','يو إكس'),('Lexus','LX','إل إكس'),('Lexus','GX','جي إكس'),
  ('Lexus','RC','آر سي'),('Lexus','LC','إل سي'),('Lexus','RZ','آر زد'),
  -- Infiniti
  ('Infiniti','Q50','كيو 50'),('Infiniti','Q60','كيو 60'),('Infiniti','Q70','كيو 70'),
  ('Infiniti','QX50','كيو إكس 50'),('Infiniti','QX55','كيو إكس 55'),('Infiniti','QX60','كيو إكس 60'),
  ('Infiniti','QX70','كيو إكس 70'),('Infiniti','QX80','كيو إكس 80'),
  -- BMW
  ('BMW','1 Series','الفئة 1'),('BMW','2 Series','الفئة 2'),('BMW','3 Series','الفئة 3'),
  ('BMW','4 Series','الفئة 4'),('BMW','5 Series','الفئة 5'),('BMW','6 Series','الفئة 6'),
  ('BMW','7 Series','الفئة 7'),('BMW','8 Series','الفئة 8'),
  ('BMW','X1','إكس 1'),('BMW','X2','إكس 2'),('BMW','X3','إكس 3'),('BMW','X4','إكس 4'),
  ('BMW','X5','إكس 5'),('BMW','X6','إكس 6'),('BMW','X7','إكس 7'),
  ('BMW','Z4','زد 4'),('BMW','M2','إم 2'),('BMW','M3','إم 3'),('BMW','M4','إم 4'),
  ('BMW','M5','إم 5'),('BMW','M8','إم 8'),('BMW','i3','آي 3'),('BMW','i4','آي 4'),
  ('BMW','i7','آي 7'),('BMW','iX','آي إكس'),
  -- Mercedes-Benz
  ('Mercedes-Benz','A-Class','الفئة A'),('Mercedes-Benz','B-Class','الفئة B'),
  ('Mercedes-Benz','C-Class','الفئة C'),('Mercedes-Benz','E-Class','الفئة E'),
  ('Mercedes-Benz','S-Class','الفئة S'),('Mercedes-Benz','CLA','سي إل إيه'),
  ('Mercedes-Benz','CLS','سي إل إس'),('Mercedes-Benz','GLA','جي إل إيه'),
  ('Mercedes-Benz','GLB','جي إل بي'),('Mercedes-Benz','GLC','جي إل سي'),
  ('Mercedes-Benz','GLE','جي إل إي'),('Mercedes-Benz','GLS','جي إل إس'),
  ('Mercedes-Benz','G-Class','جي كلاس'),('Mercedes-Benz','EQS','إي كيو إس'),
  ('Mercedes-Benz','EQE','إي كيو إي'),('Mercedes-Benz','EQA','إي كيو إيه'),
  ('Mercedes-Benz','EQB','إي كيو بي'),('Mercedes-Benz','SL','إس إل'),
  ('Mercedes-Benz','AMG GT','إيه إم جي جي تي'),('Mercedes-Benz','Sprinter','سبرنتر'),
  ('Mercedes-Benz','Vito','فيتو'),('Mercedes-Benz','V-Class','الفئة V'),
  -- Audi
  ('Audi','A1','إيه 1'),('Audi','A3','إيه 3'),('Audi','A4','إيه 4'),('Audi','A5','إيه 5'),
  ('Audi','A6','إيه 6'),('Audi','A7','إيه 7'),('Audi','A8','إيه 8'),
  ('Audi','Q2','كيو 2'),('Audi','Q3','كيو 3'),('Audi','Q5','كيو 5'),('Audi','Q7','كيو 7'),
  ('Audi','Q8','كيو 8'),('Audi','TT','تي تي'),('Audi','R8','آر 8'),
  ('Audi','e-tron','إي ترون'),('Audi','RS3','آر إس 3'),('Audi','RS6','آر إس 6'),
  -- Volkswagen
  ('Volkswagen','Golf','جولف'),('Volkswagen','Passat','باسات'),('Volkswagen','Polo','بولو'),
  ('Volkswagen','Jetta','جيتا'),('Volkswagen','Tiguan','تيجوان'),('Volkswagen','Touareg','طوارق'),
  ('Volkswagen','Atlas','أطلس'),('Volkswagen','Arteon','آرتيون'),('Volkswagen','T-Roc','تي روك'),
  ('Volkswagen','ID.4','آي دي 4'),('Volkswagen','ID.6','آي دي 6'),('Volkswagen','Amarok','أماروك'),
  -- Porsche
  ('Porsche','911','911'),('Porsche','718 Cayman','718 كايمان'),('Porsche','718 Boxster','718 بوكستر'),
  ('Porsche','Panamera','باناميرا'),('Porsche','Macan','ماكان'),('Porsche','Cayenne','كايين'),
  ('Porsche','Taycan','تايكان'),
  -- Land Rover / Range Rover
  ('Land Rover','Defender','ديفندر'),('Land Rover','Discovery','ديسكفري'),
  ('Land Rover','Discovery Sport','ديسكفري سبورت'),('Land Rover','Freelander','فري لاندر'),
  ('Range Rover','Range Rover','رانج روفر'),('Range Rover','Sport','سبورت'),
  ('Range Rover','Velar','فيلار'),('Range Rover','Evoque','إيفوك'),
  -- Jaguar
  ('Jaguar','XE','إكس إي'),('Jaguar','XF','إكس إف'),('Jaguar','XJ','إكس جيه'),
  ('Jaguar','F-Type','إف تايب'),('Jaguar','F-Pace','إف بيس'),('Jaguar','E-Pace','إي بيس'),
  ('Jaguar','I-Pace','آي بيس'),
  -- Volvo
  ('Volvo','S60','إس 60'),('Volvo','S90','إس 90'),('Volvo','V60','في 60'),('Volvo','V90','في 90'),
  ('Volvo','XC40','إكس سي 40'),('Volvo','XC60','إكس سي 60'),('Volvo','XC90','إكس سي 90'),
  -- Ford
  ('Ford','Fiesta','فييستا'),('Ford','Focus','فوكس'),('Ford','Fusion','فيوجن'),('Ford','Mustang','موستنج'),
  ('Ford','EcoSport','إيكو سبورت'),('Ford','Edge','إيدج'),('Ford','Escape','إسكيب'),
  ('Ford','Explorer','إكسبلورر'),('Ford','Expedition','إكسبيديشن'),('Ford','Bronco','برونكو'),
  ('Ford','F-150','إف 150'),('Ford','Ranger','رينجر'),('Ford','Raptor','رابتور'),
  ('Ford','Territory','تيريتوري'),('Ford','Transit','ترانزيت'),('Ford','Mustang Mach-E','موستنج ماك إي'),
  -- Chevrolet
  ('Chevrolet','Aveo','أفيو'),('Chevrolet','Cruze','كروز'),('Chevrolet','Malibu','ماليبو'),
  ('Chevrolet','Impala','إمبالا'),('Chevrolet','Camaro','كامارو'),('Chevrolet','Corvette','كورفيت'),
  ('Chevrolet','Spark','سبارك'),('Chevrolet','Sonic','سونيك'),('Chevrolet','Trax','تراكس'),
  ('Chevrolet','Equinox','إكوينوكس'),('Chevrolet','Traverse','ترافيرس'),('Chevrolet','Tahoe','تاهو'),
  ('Chevrolet','Suburban','سوبربان'),('Chevrolet','Silverado','سيلفرادو'),('Chevrolet','Captiva','كابتيفا'),
  ('Chevrolet','Blazer','بليزر'),('Chevrolet','Trailblazer','تريل بليزر'),
  -- GMC
  ('GMC','Sierra','سييرا'),('GMC','Yukon','يوكن'),('GMC','Yukon XL','يوكن إكس إل'),
  ('GMC','Acadia','أكاديا'),('GMC','Terrain','تيرين'),('GMC','Canyon','كانيون'),('GMC','Hummer EV','هامر EV'),
  -- Cadillac
  ('Cadillac','CT4','سي تي 4'),('Cadillac','CT5','سي تي 5'),('Cadillac','CT6','سي تي 6'),
  ('Cadillac','XT4','إكس تي 4'),('Cadillac','XT5','إكس تي 5'),('Cadillac','XT6','إكس تي 6'),
  ('Cadillac','Escalade','إسكاليد'),('Cadillac','Lyriq','ليريك'),
  -- Dodge
  ('Dodge','Charger','تشارجر'),('Dodge','Challenger','تشالنجر'),('Dodge','Durango','دورانجو'),
  ('Dodge','Journey','جيرني'),('Dodge','Ram','رام'),('Dodge','Hornet','هورنت'),
  -- Jeep
  ('Jeep','Wrangler','رانجلر'),('Jeep','Grand Cherokee','جراند شيروكي'),('Jeep','Cherokee','شيروكي'),
  ('Jeep','Compass','كومباس'),('Jeep','Renegade','رينيجيد'),('Jeep','Gladiator','جلادياتور'),
  ('Jeep','Wagoneer','واجونير'),('Jeep','Grand Wagoneer','جراند واجونير'),
  -- Isuzu
  ('Isuzu','D-Max','دي ماكس'),('Isuzu','MU-X','إم يو إكس'),('Isuzu','NPR','إن بي آر'),
  ('Isuzu','NQR','إن كيو آر'),('Isuzu','FRR','إف آر آر'),
  -- Subaru
  ('Subaru','Impreza','إمبريزا'),('Subaru','Legacy','ليجاسي'),('Subaru','Outback','أوت باك'),
  ('Subaru','Forester','فوريستر'),('Subaru','XV','إكس في'),('Subaru','BRZ','بي آر زد'),
  ('Subaru','Ascent','أسنت'),
  -- Renault
  ('Renault','Clio','كليو'),('Renault','Megane','ميجان'),('Renault','Captur','كابتر'),
  ('Renault','Duster','داستر'),('Renault','Koleos','كوليوس'),('Renault','Symbol','سيمبل'),
  ('Renault','Talisman','طاليسمان'),('Renault','Logan','لوجان'),
  -- Peugeot
  ('Peugeot','208','208'),('Peugeot','301','301'),('Peugeot','308','308'),('Peugeot','508','508'),
  ('Peugeot','2008','2008'),('Peugeot','3008','3008'),('Peugeot','5008','5008'),
  -- Genesis
  ('Genesis','G70','جي 70'),('Genesis','G80','جي 80'),('Genesis','G90','جي 90'),
  ('Genesis','GV60','جي في 60'),('Genesis','GV70','جي في 70'),('Genesis','GV80','جي في 80'),
  -- Chery
  ('Chery','Tiggo 4','تيجو 4'),('Chery','Tiggo 7','تيجو 7'),('Chery','Tiggo 8','تيجو 8'),
  ('Chery','Arrizo 5','أريزو 5'),('Chery','Arrizo 6','أريزو 6'),('Chery','Omoda 5','أومودا 5'),
  -- Geely
  ('Geely','Emgrand','إمجراند'),('Geely','Coolray','كولراي'),('Geely','Azkarra','أزكارا'),
  ('Geely','Tugella','توجيلا'),('Geely','Monjaro','مونجارو'),('Geely','Boyue','بوي يو'),
  -- Haval
  ('Haval','H6','إتش 6'),('Haval','H9','إتش 9'),('Haval','Jolion','جوليون'),
  ('Haval','Dargo','دارجو'),('Haval','F7','إف 7'),
  -- Changan
  ('Changan','CS35','سي إس 35'),('Changan','CS55','سي إس 55'),('Changan','CS75','سي إس 75'),
  ('Changan','CS85','سي إس 85'),('Changan','CS95','سي إس 95'),('Changan','Eado','إيدو'),
  ('Changan','Alsvin','ألسفين'),('Changan','UNI-T','يو إن آي تي'),('Changan','UNI-K','يو إن آي كيه'),
  -- MG
  ('MG','MG3','إم جي 3'),('MG','MG5','إم جي 5'),('MG','MG6','إم جي 6'),('MG','MG7','إم جي 7'),
  ('MG','HS','إتش إس'),('MG','RX5','آر إكس 5'),('MG','RX8','آر إكس 8'),('MG','ZS','زد إس'),
  ('MG','Marvel R','مارفل آر'),
  -- Tesla
  ('Tesla','Model S','موديل إس'),('Tesla','Model 3','موديل 3'),('Tesla','Model X','موديل إكس'),
  ('Tesla','Model Y','موديل واي'),('Tesla','Cybertruck','سايبر تراك'),
  -- Mini
  ('Mini','Cooper','كوبر'),('Mini','Countryman','كانتري مان'),('Mini','Clubman','كلوب مان'),
  ('Mini','Convertible','كونفرتبل'),
  -- Bentley/Rolls/Ferrari/Lambo/Maserati/Aston/McLaren
  ('Bentley','Continental GT','كونتيننتال جي تي'),('Bentley','Bentayga','بنتايجا'),
  ('Bentley','Flying Spur','فلاينج سبير'),
  ('Rolls-Royce','Phantom','فانتوم'),('Rolls-Royce','Ghost','جوست'),('Rolls-Royce','Cullinan','كولينان'),
  ('Rolls-Royce','Wraith','رايث'),('Rolls-Royce','Dawn','دون'),('Rolls-Royce','Spectre','سبكتر'),
  ('Ferrari','488','488'),('Ferrari','F8','إف 8'),('Ferrari','SF90','إس إف 90'),
  ('Ferrari','Roma','روما'),('Ferrari','Portofino','بورتوفينو'),('Ferrari','Purosangue','بوروسانجوي'),
  ('Lamborghini','Huracan','هوراكان'),('Lamborghini','Aventador','أفنتادور'),('Lamborghini','Urus','أوروس'),
  ('Lamborghini','Revuelto','ريفويلتو'),
  ('Maserati','Ghibli','غيبلي'),('Maserati','Quattroporte','كواتروبورتي'),('Maserati','Levante','ليفانتي'),
  ('Maserati','MC20','إم سي 20'),('Maserati','Grecale','جريكالي'),
  ('Aston Martin','DB11','دي بي 11'),('Aston Martin','DBX','دي بي إكس'),('Aston Martin','Vantage','فانتاج'),
  ('McLaren','720S','720 إس'),('McLaren','GT','جي تي'),('McLaren','Artura','أرتورا')
) AS x(make, model, model_ar) ON x.make = m.name
ON CONFLICT DO NOTHING;

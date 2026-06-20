-- إضافة حالة "ملغي" لمطالبات التأمين
ALTER TYPE public.claim_status ADD VALUE IF NOT EXISTS 'cancelled';
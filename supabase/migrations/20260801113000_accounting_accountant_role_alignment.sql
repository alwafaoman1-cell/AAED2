-- Align the database role enum with the existing frontend/accounting role model.
-- This is additive and does not grant permissions or modify any user.
alter type public.app_role add value if not exists 'accountant';

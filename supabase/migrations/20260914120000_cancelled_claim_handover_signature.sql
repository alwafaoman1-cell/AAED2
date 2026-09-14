-- Electronic signature evidence for cancelled-claim vehicle handover.
-- Existing claims remain unchanged; the columns are populated only when the handover is prepared.

alter table public.insurance_claims
  add column if not exists cancelled_handover_signature_data_url text null,
  add column if not exists cancelled_handover_signed_at timestamptz null;

alter table public.insurance_claims
  drop constraint if exists insurance_claims_cancelled_handover_signature_format_check;

alter table public.insurance_claims
  add constraint insurance_claims_cancelled_handover_signature_format_check
  check (
    cancelled_handover_signature_data_url is null
    or (
      cancelled_handover_signature_data_url like 'data:image/png;base64,%'
      and char_length(cancelled_handover_signature_data_url) <= 500000
    )
  );

comment on column public.insurance_claims.cancelled_handover_signature_data_url
  is 'Receiver electronic signature captured for a cancelled-claim vehicle handover.';

comment on column public.insurance_claims.cancelled_handover_signed_at
  is 'Database-recorded timestamp associated with the latest cancelled-claim handover signature.';

create or replace function public.set_cancelled_claim_handover_signed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cancelled_handover_signature_data_url is null then
    new.cancelled_handover_signed_at := null;
  elsif new.cancelled_handover_signature_data_url is distinct from old.cancelled_handover_signature_data_url then
    new.cancelled_handover_signed_at := now();
  else
    new.cancelled_handover_signed_at := old.cancelled_handover_signed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cancelled_claim_handover_signed_at on public.insurance_claims;
create trigger trg_cancelled_claim_handover_signed_at
before update of cancelled_handover_signature_data_url, cancelled_handover_signed_at on public.insurance_claims
for each row execute function public.set_cancelled_claim_handover_signed_at();

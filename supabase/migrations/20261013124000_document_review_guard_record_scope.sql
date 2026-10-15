-- PL/pgSQL trigger RECORD fields must be accessed only in their table-specific branch.
create or replace function public.document_review_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_setting('temo.document_review_rpc', true) = 'on' then return new; end if;
  if tg_table_name = 'document_extraction_fields' then
    if (new.review_status, new.reviewed_value) is distinct from
       (old.review_status, old.reviewed_value) then
      raise exception 'DOCUMENT_REVIEW_RPC_ONLY';
    end if;
  elsif tg_table_name = 'document_extractions' then
    if new.status = 'verified' and old.status <> 'verified' then
      raise exception 'DOCUMENT_REVIEW_RPC_ONLY';
    end if;
  end if;
  return new;
end $$;

-- Follow-up to the applied Development review RPC: clients cannot bypass atomic review.
alter function public.document_verify_review(uuid, jsonb) rename to document_verify_review_internal;
revoke all on function public.document_verify_review_internal(uuid, jsonb) from public, anon, authenticated;

create function public.document_verify_review(p_extraction_id uuid, p_reviews jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform set_config('temo.document_review_rpc', 'on', true);
  perform public.document_verify_review_internal(p_extraction_id, p_reviews);
end $$;
revoke all on function public.document_verify_review(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.document_verify_review(uuid, jsonb) to authenticated;

create function public.document_review_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_setting('temo.document_review_rpc', true) = 'on' then return new; end if;
  if tg_table_name = 'document_extraction_fields' and
     (new.review_status, new.reviewed_value) is distinct from
     (old.review_status, old.reviewed_value) then
    raise exception 'DOCUMENT_REVIEW_RPC_ONLY';
  end if;
  if tg_table_name = 'document_extractions' and new.status = 'verified' and old.status <> 'verified' then
    raise exception 'DOCUMENT_REVIEW_RPC_ONLY';
  end if;
  return new;
end $$;
create trigger document_field_review_guard_trigger before update on public.document_extraction_fields
for each row execute function public.document_review_write_guard();
create trigger document_extraction_review_guard_trigger before update on public.document_extractions
for each row execute function public.document_review_write_guard();
revoke all on function public.document_review_write_guard() from public, anon, authenticated;
revoke update on public.document_extraction_fields from authenticated;

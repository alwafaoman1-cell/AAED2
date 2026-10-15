-- Development-only follow-up. Keep verification and every field review in one transaction.
create or replace function public.document_verify_review(
  p_extraction_id uuid,
  p_reviews jsonb
)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_extraction public.document_extractions%rowtype;
  v_file public.document_files%rowtype;
  v_item jsonb;
  v_field public.document_extraction_fields%rowtype;
  v_total integer;
  v_unique integer;
  v_expected integer;
  v_status text;
  v_value text;
begin
  if auth.uid() is null or public.get_user_tenant_id() is null then
    raise exception 'DOCUMENT_ACCESS_DENIED';
  end if;
  select * into v_extraction from public.document_extractions
    where id = p_extraction_id and tenant_id = public.get_user_tenant_id() for update;
  if not found then raise exception 'DOCUMENT_ACCESS_DENIED'; end if;
  select * into v_file from public.document_files
    where id = v_extraction.file_id and tenant_id = v_extraction.tenant_id;
  if not found or not public.document_access_allowed(v_file.access_scope) then
    raise exception 'DOCUMENT_ACCESS_DENIED';
  end if;
  if v_extraction.status <> 'needs_review' then
    raise exception 'DOCUMENT_REVIEW_STATE_INVALID';
  end if;
  if p_reviews is null or jsonb_typeof(p_reviews) <> 'array' or jsonb_array_length(p_reviews) > 100 then
    raise exception 'DOCUMENT_REVIEWS_INVALID';
  end if;
  select count(*), count(distinct item->>'key') into v_total, v_unique
    from jsonb_array_elements(p_reviews) as item;
  select count(*) into v_expected from public.document_extraction_fields
    where tenant_id = v_extraction.tenant_id and extraction_id = p_extraction_id;
  if v_total <> v_expected or v_unique <> v_expected then
    raise exception 'DOCUMENT_REVIEWS_INCOMPLETE';
  end if;
  for v_item in select value from jsonb_array_elements(p_reviews) loop
    v_status := v_item->>'status';
    v_value := v_item->>'value';
    if v_status not in ('accepted', 'corrected', 'rejected') or
       nullif(v_item->>'key', '') is null then
      raise exception 'DOCUMENT_REVIEW_VALUE_INVALID';
    end if;
    select * into v_field from public.document_extraction_fields
      where tenant_id = v_extraction.tenant_id and extraction_id = p_extraction_id
        and field_key = v_item->>'key' for update;
    if not found then raise exception 'DOCUMENT_REVIEW_FIELD_UNKNOWN'; end if;
    if v_status = 'accepted' and
       (v_field.validation_status <> 'valid' or v_value is distinct from v_field.normalized_value) then
      raise exception 'DOCUMENT_REVIEW_ACCEPTED_VALUE_INVALID';
    end if;
    if v_status = 'corrected' and (nullif(btrim(v_value), '') is null or char_length(v_value) > 4000) then
      raise exception 'DOCUMENT_REVIEW_CORRECTED_VALUE_INVALID';
    end if;
    if v_status = 'rejected' and v_value is not null then
      raise exception 'DOCUMENT_REVIEW_REJECTED_VALUE_INVALID';
    end if;
    update public.document_extraction_fields
      set review_status = v_status,
          reviewed_value = case when v_status = 'corrected' then v_value else null end
      where id = v_field.id;
  end loop;
  update public.document_extractions set status = 'verified' where id = p_extraction_id;
end $$;

revoke all on function public.document_verify_review(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.document_verify_review(uuid, jsonb) to authenticated;

-- Preserve still-valid, unsigned links issued before revision tracking existed.
-- Bind only unchanged legacy revision 1; never renew a token/expiry, carry ink
-- forward, reactivate revoked/consumed links, or authorize a newer revision.
update public.vehicle_entry_signature_links l
set intake_revision = e.intake_revision
from public.vehicle_entries e
where e.id = l.vehicle_entry_id and e.tenant_id = l.tenant_id
  and e.deleted_at is null and e.status <> 'Cancelled'
  and e.custody_receipt_required = false and e.intake_revision = 1
  and l.intake_revision is null and l.revoked_at is null
  and l.consumed_at is null and l.expires_at > clock_timestamp()
  and not exists (
    select 1 from public.vehicle_entry_signatures s
    where s.tenant_id = e.tenant_id and s.vehicle_entry_id = e.id
      and s.signature_role = 'delivered_by'
  );

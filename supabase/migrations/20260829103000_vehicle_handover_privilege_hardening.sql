-- Least-privilege hardening for Vehicle Exit & Handover SSOT.
-- Finalized/cancelled records are immutable and must never be deleted directly.

revoke all on table public.vehicle_handover_records from anon, authenticated;
grant select, insert, update on table public.vehicle_handover_records to authenticated;

revoke all on table public.vehicle_handover_sequences from anon, authenticated;
grant select on table public.vehicle_handover_sequences to authenticated;

revoke all on function public.guard_vehicle_handover_immutability()
  from public, anon, authenticated;


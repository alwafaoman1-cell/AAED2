-- Follow-up to the temporary inspection release migration. The two trigger
-- functions are not public RPCs; their default EXECUTE grants are unnecessary.
revoke all on function public.protect_signed_inspection_media() from public, anon, authenticated;
revoke all on function public.protect_signed_inspection_entry() from public, anon, authenticated;

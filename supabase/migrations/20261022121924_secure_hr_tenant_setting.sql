-- HR salaries, IDs, bank details and personnel documents live in this legacy
-- tenant setting. Tenant membership alone must never authorize their access.
-- Keep the existing rules for every other setting unchanged.
alter policy tenant_settings_select on public.tenant_settings
  using (
    tenant_id = (select public.get_user_tenant_id())
    and (
      key <> 'alwafa_hr_v1'
      or (select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
    )
  );

alter policy tenant_settings_insert on public.tenant_settings
  with check (
    tenant_id = (select public.get_user_tenant_id())
    and (
      key <> 'alwafa_hr_v1'
      or (select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
    )
  );

alter policy tenant_settings_update on public.tenant_settings
  using (
    tenant_id = (select public.get_user_tenant_id())
    and (
      key <> 'alwafa_hr_v1'
      or (select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
    )
  )
  with check (
    tenant_id = (select public.get_user_tenant_id())
    and (
      key <> 'alwafa_hr_v1'
      or (select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
    )
  );

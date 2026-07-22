-- 103_dispatch_qc_role.sql
-- Enable the `dispatch_qc` user role on existing databases.
-- The role list was added to old migrations (028/029/073) which never re-run on a
-- live DB, so this migration applies the change idempotently to production.

-- 1) Allow `dispatch_qc` on the users table.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (
    role IN (
      'super_admin',
      'admin',
      'manager',
      'team_member',
      'team_lead',
      'sales',
      'floor_manager',
      'procurement',
      'qc',
      'dispatch',
      'warehouse',
      'accounts',
      'support_lead',
      'support_tech',
      'dispatch_qc',
      'customer',
      'vendor',
      'technician'
    )
  );

-- 2) Give `dispatch_qc` the same RBAC section permissions as the `qc` role.
INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT 'dispatch_qc', section, can_view, can_create, can_edit, can_delete
FROM public.role_permissions
WHERE role = 'qc'
ON CONFLICT (role, section) DO NOTHING;

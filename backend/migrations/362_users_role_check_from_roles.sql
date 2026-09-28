-- 362: users_role_check follows the roles table (Control, 27 Sep 2026).
--
-- The constraint was a hardcoded list re-added at every boot by the replay of
-- 028 / 029 / 207 and ensureUsersRoleCheck, which left out support_agent,
-- support_manager and every role created in Settings → Roles, so those roles
-- could not be assigned. The boot replay of 028/029/207 is removed in the same
-- change and services/userRoleCheck.js now rebuilds the list at boot and after
-- a role is created. This migration does the same rebuild once, so the fix is
-- live without waiting for a restart.
--
-- Allowed = built-in list ∪ roles.name ∪ every role a user already holds (so
-- the new constraint can never fail validation against existing rows).
-- Role names are restricted to [a-z0-9_] before being quoted into the CHECK.
-- Idempotent. Touches only the constraint; no rows change.

DO $$
DECLARE
  allowed TEXT[];
  list TEXT;
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT r FROM (
      SELECT unnest(ARRAY[
        'super_admin', 'admin', 'manager', 'team_member', 'team_lead', 'sales',
        'floor_manager', 'procurement', 'qc', 'dispatch', 'warehouse', 'accounts',
        'support_lead', 'support_tech', 'dispatch_qc', 'customer', 'vendor',
        'technician', 'guard', 'support_agent', 'support_manager'
      ]) AS r
      UNION SELECT name FROM public.roles
      UNION SELECT DISTINCT role FROM public.users WHERE role IS NOT NULL
    ) x
    WHERE r ~ '^[a-z0-9_]{1,50}$'
    ORDER BY r
  ) INTO allowed;

  SELECT string_agg(quote_literal(r), ', ') INTO list FROM unnest(allowed) AS r;

  ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
  EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (%s))', list);
END $$;

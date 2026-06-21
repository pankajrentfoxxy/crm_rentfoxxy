-- Allow support module roles on users.role (CHECK constraint or enum).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

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
      'customer',
      'vendor',
      'technician'
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    BEGIN
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'support_lead';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'support_tech';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

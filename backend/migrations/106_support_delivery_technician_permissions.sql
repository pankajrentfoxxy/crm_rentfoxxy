-- ============================================================
-- Migration 106: Support technicians → Delivery technician access
--   - Grant support_tech / support_lead technician_bucket (My Deliveries)
--   - Link active support/dispatch CRM users to delivery_technicians
-- Idempotent.
-- ============================================================

UPDATE permission_sections
SET description = 'Delivery Technician (bucket & field deliveries)', sort_order = 177
WHERE section = 'technician_bucket';

UPDATE permission_sections
SET description = 'Support Technician (field view)', sort_order = 321
WHERE section = 'support_technician';

-- Delivery technician bucket: support staff can view assigned DCs and mark deliveries
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_tech',  'technician_bucket', true, false, true, false),
  ('support_lead',  'technician_bucket', true, false, true, false),
  ('support_tech',  'support_technician', true, false, true, false),
  ('support_lead',  'support_technician', true, true, true, true)
ON CONFLICT (role, section) DO UPDATE SET
  can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view),
  can_create = GREATEST(role_permissions.can_create, EXCLUDED.can_create),
  can_edit = GREATEST(role_permissions.can_edit, EXCLUDED.can_edit),
  can_delete = GREATEST(role_permissions.can_delete, EXCLUDED.can_delete);

-- Link CRM support/dispatch users into delivery_technicians for DC assignment dropdown
INSERT INTO delivery_technicians (user_id, first_name, last_name, phone, email, country_code, is_active)
SELECT
  u.user_id,
  COALESCE(NULLIF(split_part(trim(u.name), ' ', 1), ''), 'Field'),
  COALESCE(
    NULLIF(trim(substring(trim(u.name) from position(' ' in trim(u.name)) + 1)), ''),
    'Technician'
  ),
  COALESCE(NULLIF(trim(u.mobile_no), ''), '9' || lpad(u.user_id::text, 9, '0')),
  u.email,
  '91',
  true
FROM users u
WHERE u.role IN ('support_tech', 'support_lead', 'dispatch')
  AND u.active = true
  AND COALESCE(u.status, 'active') = 'active'
  AND u.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM delivery_technicians dt
    WHERE dt.user_id = u.user_id OR lower(dt.email) = lower(u.email)
  );

-- Backfill user_id on existing delivery_technician rows matched by email
UPDATE delivery_technicians dt
SET user_id = u.user_id, updated_at = NOW()
FROM users u
WHERE dt.user_id IS NULL
  AND lower(dt.email) = lower(u.email)
  AND u.role IN ('support_tech', 'support_lead', 'dispatch')
  AND u.active = true;

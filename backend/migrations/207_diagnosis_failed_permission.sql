-- Migration: 207_diagnosis_failed_permission.sql
-- Dedicated RBAC so Diagnosis Failed (Out for Repair) can be granted per role/user.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'diagnosis_failed',
  'Diagnosis Failed — select laptops and send Out for Repair to vendor',
  265
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Roles that already processed this screen via hardcoded warehouse roles
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',         'diagnosis_failed', true, true, true, true),
  ('super_admin',   'diagnosis_failed', true, true, true, true),
  ('manager',       'diagnosis_failed', true, true, true, false),
  ('floor_manager', 'diagnosis_failed', true, true, true, false),
  ('warehouse',     'diagnosis_failed', true, true, true, false),
  ('support_lead',  'diagnosis_failed', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Anyone who already saw Floor Pipeline keeps seeing this page (view only)
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT rp.role, 'diagnosis_failed', true, false, false, false
  FROM role_permissions rp
 WHERE rp.section = 'floor_pipeline'
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, 'diagnosis_failed', true, false, false, false
  FROM user_permissions up
 WHERE up.section = 'floor_pipeline'
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;

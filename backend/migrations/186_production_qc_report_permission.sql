-- Migration: 186_production_qc_report_permission.sql
-- Dedicated RBAC section so Production QC Report can be granted to any role/user.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'production_qc_report',
  'Production QC Report (Reports & Analytics)',
  404
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Default grants for common roles
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'production_qc_report', true, false, false, false),
  ('super_admin', 'production_qc_report', true, false, false, false),
  ('manager', 'production_qc_report', true, false, false, false),
  ('floor_manager', 'production_qc_report', true, false, false, false),
  ('qc', 'production_qc_report', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view;

-- Also grant to any role that already has reports or QC view access
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT rp.role, 'production_qc_report', true, false, false, false
  FROM role_permissions rp
 WHERE rp.section IN ('reports_access', 'reports', 'qc_management')
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

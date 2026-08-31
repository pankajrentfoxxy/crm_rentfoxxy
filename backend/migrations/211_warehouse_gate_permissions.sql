-- 211: Warehouse Gate permissions in Role & Permissions.
-- Guard Scanner (existing) + Gate Dashboard (new), labeled like the sidebar.

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  (
    'guard_gate_checking',
    'Guard Scanner — scan and validate warehouse inward/outward laptops',
    172
  ),
  (
    'gate_dashboard',
    'Gate Dashboard — warehouse gate inward/outward summary',
    173
  )
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Admin / super_admin can see both (same as today).
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',       'guard_gate_checking', true, true, true, false),
  ('super_admin', 'guard_gate_checking', true, true, true, true),
  ('admin',       'gate_dashboard',      true, true, true, false),
  ('super_admin', 'gate_dashboard',      true, true, true, true)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Anyone already granted Guard Scanner also gets Gate Dashboard.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'gate_dashboard', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
  FROM role_permissions rp
 WHERE rp.section = 'guard_gate_checking'
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

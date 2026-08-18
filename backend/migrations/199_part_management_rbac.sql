-- Migration: 199_part_management_rbac.sql
-- Granular Part Management permission sections for Role Permissions UI.
-- Backfills grants from existing parts_inventory / parts_procurement / vendor_management where sensible.

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('parts_dashboard',         'Parts Dashboard',                              270),
  ('parts_inventory',         'Parts Inventory',                              271),
  ('parts_approval',          'Parts Approval',                               272),
  ('parts_history',           'Parts Movement History',                       273),
  ('parts_procurement',       'Spare Parts PO',                               274),
  ('part_vendor_repair',      'Part Vendor Repair DC',                        275),
  ('parts_discarded',         'Discarded Parts',                              276),
  ('scrap_challans',          'Scrap Challans',                               277),
  ('parts_detach',            'Part Detach (Attached → Inventory)',           278),
  ('parts_requests',          'Part Requests (Floor)',                        279),
  ('support_part_challan',    'Support Part Queue (Warehouse)',               280),
  ('support_part_requests',   'Technician Parts Bucket (Field)',              281),
  ('parts',                   'Parts (Legacy)',                               282)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Copy full CRUD flags from parts_inventory onto new stock/history/scrap sections
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, s.section, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
  FROM role_permissions rp
  CROSS JOIN (VALUES
    ('parts_dashboard'),
    ('parts_history'),
    ('parts_discarded'),
    ('scrap_challans')
  ) AS s(section)
 WHERE rp.section = 'parts_inventory'
ON CONFLICT (role, section) DO NOTHING;

-- Parts Approval: copy from parts_inventory if missing (179 may already have grants)
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'parts_approval', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
  FROM role_permissions rp
 WHERE rp.section = 'parts_inventory'
ON CONFLICT (role, section) DO NOTHING;

-- Spare Parts PO: grant to roles that already view vendor_management or parts_inventory (if missing)
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT ON (rp.role)
       rp.role, 'parts_procurement', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
  FROM role_permissions rp
 WHERE rp.section IN ('vendor_management', 'parts_inventory')
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

-- Explicit defaults for common ops roles (idempotent upsert for core set)
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',       'parts_dashboard', true, true, true, true),
  ('manager',     'parts_dashboard', true, true, true, false),
  ('warehouse',   'parts_dashboard', true, false, false, false),
  ('super_admin', 'parts_dashboard', true, true, true, true),

  ('admin',       'parts_history', true, false, false, false),
  ('manager',     'parts_history', true, false, false, false),
  ('warehouse',   'parts_history', true, false, false, false),
  ('super_admin', 'parts_history', true, true, true, true),

  ('admin',       'parts_discarded', true, true, true, false),
  ('manager',     'parts_discarded', true, true, true, false),
  ('warehouse',   'parts_discarded', true, true, true, false),
  ('super_admin', 'parts_discarded', true, true, true, true),

  ('admin',       'scrap_challans', true, true, true, false),
  ('manager',     'scrap_challans', true, true, true, false),
  ('warehouse',   'scrap_challans', true, true, true, false),
  ('super_admin', 'scrap_challans', true, true, true, true)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- User-level overrides: mirror parts_inventory viewers onto new sections
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, s.section, true, false, false, false
  FROM user_permissions up
  CROSS JOIN (VALUES
    ('parts_dashboard'),
    ('parts_approval'),
    ('parts_history'),
    ('parts_discarded'),
    ('scrap_challans')
  ) AS s(section)
 WHERE up.section = 'parts_inventory'
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;

INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, 'parts_procurement', true, false, false, false
  FROM user_permissions up
 WHERE up.section IN ('parts_inventory', 'vendor_management', 'parts_procurement')
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;

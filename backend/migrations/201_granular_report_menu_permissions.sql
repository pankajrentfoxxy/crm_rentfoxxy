-- Granular Reports & Analytics sidebar permissions (Role Permissions / User Overrides).
-- Users with reports_access still see all reports (alias in permissionService).

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('report_revenue', 'Report — Revenue', 403),
  ('report_inventory', 'Report — Inventory Utilisation', 404),
  ('report_lead_conversion', 'Report — Lead Conversion', 405),
  ('report_salesperson', 'Report — Salesperson', 406),
  ('report_collections', 'Report — Collections', 407),
  ('report_vendor_spend', 'Report — Vendor Spend', 408),
  ('report_laptop', 'Report — Technician / Laptop', 409),
  ('report_warehouse_laptops', 'Report — Warehouse Laptops', 410),
  ('report_sales_order', 'Report — Sales Order', 411),
  ('report_support_daily', 'Report — Daily Support Summary', 412),
  ('report_inward_outward', 'Report — Inward & Outward Summary', 413)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Grant each report to roles that already have umbrella reports access
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT rp.role, v.section, true, false, false, false
  FROM role_permissions rp
 CROSS JOIN (VALUES
    ('report_revenue'),
    ('report_inventory'),
    ('report_lead_conversion'),
    ('report_salesperson'),
    ('report_collections'),
    ('report_vendor_spend'),
    ('report_laptop'),
    ('report_warehouse_laptops'),
    ('report_sales_order'),
    ('report_support_daily'),
    ('report_inward_outward')
  ) AS v(section)
 WHERE rp.section IN ('reports_access', 'reports')
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

-- Default admin / manager / accounts (mirror production_qc_report pattern)
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT r.role, v.section, true, false, false, false
  FROM (VALUES ('admin'), ('super_admin'), ('manager'), ('accounts'), ('floor_manager')) AS r(role)
 CROSS JOIN (VALUES
    ('report_revenue'),
    ('report_inventory'),
    ('report_lead_conversion'),
    ('report_salesperson'),
    ('report_collections'),
    ('report_vendor_spend'),
    ('report_laptop'),
    ('report_warehouse_laptops'),
    ('report_sales_order'),
    ('report_support_daily'),
    ('report_inward_outward')
  ) AS v(section)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view);

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('analytics_dashboard', 'Analytics & KPI Dashboard', 400),
  ('reports_export',      'Export Reports to Excel',   401)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',   'analytics_dashboard', TRUE, FALSE, FALSE, FALSE),
  ('manager', 'analytics_dashboard', TRUE, FALSE, FALSE, FALSE),
  ('admin',   'reports_export',      TRUE, TRUE,  FALSE, FALSE),
  ('manager', 'reports_export',      TRUE, TRUE,  FALSE, FALSE),
  ('accounts','reports_export',      TRUE, TRUE,  FALSE, FALSE),
  ('sales',   'analytics_dashboard', TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, section) DO NOTHING;

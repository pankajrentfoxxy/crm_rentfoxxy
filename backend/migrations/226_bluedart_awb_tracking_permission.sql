-- BlueDart AWB tracking portal (manual AWB lookup + DC-linked AWBs).
BEGIN;

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'bluedart_awb_tracking',
  'BlueDart AWB Tracking — track courier shipments by AWB (manual or from DC)',
  46
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'bluedart_awb_tracking', true, true, true, false),
  ('manager', 'bluedart_awb_tracking', true, true, true, false),
  ('dispatch', 'bluedart_awb_tracking', true, true, true, false),
  ('warehouse', 'bluedart_awb_tracking', true, false, false, false),
  ('floor_manager', 'bluedart_awb_tracking', true, false, false, false),
  ('procurement', 'bluedart_awb_tracking', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;

COMMIT;

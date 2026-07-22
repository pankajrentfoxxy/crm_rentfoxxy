-- Granular permission: bulk asset movement between inventory buckets (QC Pending, QC Process, Ready, Dead).
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('inventory_asset_movement', 'Inventory — Asset Movement (bulk)', 177)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Default: super_admin only (grant to other roles via Settings → Role Permissions).
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('super_admin', 'inventory_asset_movement', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view),
      can_create = GREATEST(role_permissions.can_create, EXCLUDED.can_create),
      can_edit = GREATEST(role_permissions.can_edit, EXCLUDED.can_edit);

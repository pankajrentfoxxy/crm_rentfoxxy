-- Allow dispatch login to run Dispatch QC pass/fail on floor tickets.

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('dispatch', 'dispatch_qc', true, false, true, false),
  ('dispatch', 'floor_tickets', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view),
      can_edit = GREATEST(role_permissions.can_edit, EXCLUDED.can_edit);

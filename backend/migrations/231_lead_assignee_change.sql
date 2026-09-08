-- Change lead assignee to Admin or Pradeep (sales) from Lead CRM list.
INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'lead_assignee_change',
  'Lead CRM — change assignee (Admin / Pradeep sales)',
  21
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('super_admin', 'lead_assignee_change', true, false, true, false),
  ('admin',         'lead_assignee_change', true, false, true, false),
  ('manager',       'lead_assignee_change', true, false, true, false),
  ('sales',         'lead_assignee_change', false, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;

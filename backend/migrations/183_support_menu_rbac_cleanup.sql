-- Support menu RBAC cleanup (bugs 6/7/8):
--  - Split Sales Pipeline delivery menu items onto sections Support does not hold
--  - Revoke Customers + Inventory sections from Support roles
-- Support keeps technician_bucket for SupportShell → My Deliveries.

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('delivery_technicians', 'Delivery Technicians master data', 177),
  ('delivery_my_deliveries', 'My Deliveries (Sales Pipeline menu)', 178)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Copy grants from technician_bucket → new sections for every non-support role.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope)
SELECT
  rp.role,
  'delivery_technicians',
  rp.can_view,
  rp.can_create,
  rp.can_edit,
  rp.can_delete,
  COALESCE(rp.data_scope, 'all')
FROM role_permissions rp
WHERE rp.section = 'technician_bucket'
  AND rp.role NOT IN ('support_lead', 'support_tech')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope)
SELECT
  rp.role,
  'delivery_my_deliveries',
  rp.can_view,
  rp.can_create,
  rp.can_edit,
  rp.can_delete,
  COALESCE(rp.data_scope, 'all')
FROM role_permissions rp
WHERE rp.section = 'technician_bucket'
  AND rp.role NOT IN ('support_lead', 'support_tech')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Ensure Technician Bucket list section is granted to the same non-support roles.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope)
SELECT
  rp.role,
  'technicians_bucket_list',
  TRUE,
  FALSE,
  FALSE,
  FALSE,
  COALESCE(rp.data_scope, 'all')
FROM role_permissions rp
WHERE rp.section = 'technician_bucket'
  AND rp.role NOT IN ('support_lead', 'support_tech')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = TRUE;

-- Bug 7: hide Master Data → Customers for Support
UPDATE role_permissions
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
 WHERE role IN ('support_lead', 'support_tech')
   AND section = 'customers';

-- Bug 8: hide Inventory accordion for Support (Deployed Fleet / TTSPL History / IM)
UPDATE role_permissions
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
 WHERE role IN ('support_lead', 'support_tech')
   AND section IN ('customer_inventory', 'ttspl_history', 'inventory_management', 'inventory');

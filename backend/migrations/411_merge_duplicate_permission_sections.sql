-- 411: merge duplicate permission sections (2 Oct 2026).
--
-- Each pair below gated the same screens under two names, so the Roles &
-- Permissions matrix showed two rows for one thing. Old -> kept:
--
--   customer_management     -> customers
--   customer_inventory      -> customer_assets
--   follow_ups              -> lead_follow_ups
--   delivery_technicians    -> technician_bucket
--   delivery_my_deliveries  -> technician_bucket
--   tickets                 -> floor_tickets
--   procurement             -> vendor_management
--   inventory               -> inventory_management
--
-- Only VIEW is copied onto the kept section: the old names are checked for
-- view only (create/edit/delete on them gate nothing), and copying those would
-- hand out kept-section powers nobody chose (customer_assets edit = rent rate
-- edit). Only a TRUE is ever copied, so an explicit "no" on the old name never
-- revokes what the kept section already gives. procurement copies nothing: it
-- guards only the retired /procurement page, every role holding it already
-- holds vendor_management, and copying would give one user PO access.
--
-- The old rows are then removed (backed up in rbac_merge_411_backup first) so a
-- hidden old grant cannot keep someone in after the kept grant is revoked. The
-- code aliases each old name to its kept section (permissionCatalog
-- MERGED_SECTIONS / SECTION_ALIASES). Not replayed at boot; safe to re-run.

BEGIN;

CREATE TEMP TABLE merge_411 (old_section varchar(100) PRIMARY KEY, kept_section varchar(100) NOT NULL, copy_view boolean NOT NULL)
  ON COMMIT DROP;
INSERT INTO merge_411 VALUES
  ('customer_management', 'customers', true),
  ('customer_inventory', 'customer_assets', true),
  ('follow_ups', 'lead_follow_ups', true),
  ('delivery_technicians', 'technician_bucket', true),
  ('delivery_my_deliveries', 'technician_bucket', true),
  ('tickets', 'floor_tickets', true),
  ('procurement', 'vendor_management', false),
  ('inventory', 'inventory_management', true);

CREATE TABLE IF NOT EXISTS rbac_merge_411_backup (
  source        varchar(20)  NOT NULL,   -- 'role' | 'user'
  role          varchar(100),
  user_id       integer,
  section       varchar(100) NOT NULL,
  can_view      boolean, can_create boolean, can_edit boolean, can_delete boolean,
  data_scope    varchar(50), customer_access varchar(50), inventory_tag_access varchar(50),
  backed_up_at  timestamptz  NOT NULL DEFAULT NOW()
);

INSERT INTO rbac_merge_411_backup (source, role, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access)
SELECT 'role', rp.role, rp.section, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete, rp.data_scope, rp.customer_access, rp.inventory_tag_access
  FROM role_permissions rp JOIN merge_411 m ON m.old_section = rp.section;

INSERT INTO rbac_merge_411_backup (source, user_id, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access)
SELECT 'user', up.user_id, up.section, up.can_view, up.can_create, up.can_edit, up.can_delete, up.data_scope, up.customer_access, up.inventory_tag_access
  FROM user_permissions up JOIN merge_411 m ON m.old_section = up.section;

-- Role defaults: view on the old name -> view on the kept one. A new kept row
-- carries the old row's scope values; an existing kept row keeps its own.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope, customer_access, inventory_tag_access)
SELECT DISTINCT ON (rp.role, m.kept_section)
       rp.role, m.kept_section, true, false, false, false, rp.data_scope, rp.customer_access, rp.inventory_tag_access
  FROM role_permissions rp
  JOIN merge_411 m ON m.old_section = rp.section AND m.copy_view
 WHERE rp.can_view IS TRUE
 ORDER BY rp.role, m.kept_section
ON CONFLICT (role, section) DO UPDATE SET can_view = true;

-- User overrides: only a TRUE view is carried; a new kept row inherits
-- everything else from the role (NULL).
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_at)
SELECT DISTINCT ON (up.user_id, m.kept_section)
       up.user_id, m.kept_section, true, NULL, NULL, NULL, NOW()
  FROM user_permissions up
  JOIN merge_411 m ON m.old_section = up.section AND m.copy_view
 WHERE up.can_view IS TRUE
 ORDER BY up.user_id, m.kept_section
ON CONFLICT (user_id, section) DO UPDATE SET can_view = true;

DELETE FROM role_permissions rp USING merge_411 m WHERE rp.section = m.old_section;
DELETE FROM user_permissions up USING merge_411 m WHERE up.section = m.old_section;

UPDATE permission_sections ps
   SET hidden = true, section_group = '_hidden',
       description = 'Merged into ' || m.kept_section || ' (migration 411)'
  FROM merge_411 m
 WHERE ps.section = m.old_section;

UPDATE permission_sections
   SET description = 'Laptops with customers — view the list (Stock → With Customers); edit rent rate / export'
 WHERE section = 'customer_assets';

COMMIT;

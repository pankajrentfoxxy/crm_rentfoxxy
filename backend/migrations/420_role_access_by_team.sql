-- 420: role-wise access by team (user, 15 Oct 2026).
--
-- "Give role wise access to team with proper access, so others can't see
-- access which is not required for them." Two parts:
--
--  A. Role defaults: each team's role keeps what its job needs, loses what
--     belongs to another team, and gains what the whole team needed but only
--     had through personal grants. admin / super_admin / manager untouched.
--  B. Per-user extras reset (user's choice "Reset to role"): a user_permissions
--     row that GRANTS anything their role does not give is deleted, so each
--     person gets exactly their team's access. Per-user restrictions (rows
--     that only take access away) are kept. An admin can re-grant anyone
--     deliberately afterwards.
--
-- Everything changed is copied first to rbac_420_role_backup and
-- rbac_420_user_backup; restoring is two INSERT ... SELECTs from them.
-- Hardcoded role lists in routes/sales.js, warehouse.js and procurement.js
-- are not governed by this matrix (see CLAUDE.md) and are unchanged.

CREATE TABLE IF NOT EXISTS rbac_420_role_backup AS
  SELECT rp.*, NOW() AS backed_up_at FROM role_permissions rp WHERE FALSE;
CREATE TABLE IF NOT EXISTS rbac_420_user_backup AS
  SELECT up.*, NOW() AS backed_up_at FROM user_permissions up WHERE FALSE;

INSERT INTO rbac_420_role_backup
SELECT rp.*, NOW() FROM role_permissions rp
 WHERE rp.role IN ('floor_manager', 'team_lead', 'team_member', 'qc', 'warehouse', 'dispatch', 'sales', 'accounts', 'support_lead')
   AND NOT EXISTS (SELECT 1 FROM rbac_420_role_backup b WHERE b.role = rp.role AND b.section = rp.section);

-- ── A1. Remove: belongs to another team ───────────────────────────────────
UPDATE role_permissions rp
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
  FROM (VALUES
    -- Floor manager: the floor, not dispatch / gate / deliveries / stock moves.
    ('floor_manager', 'dispatch'), ('floor_manager', 'warehouse'),
    ('floor_manager', 'gate_dashboard'), ('floor_manager', 'guard_gate_checking'),
    ('floor_manager', 'damage_charges'), ('floor_manager', 'bluedart_awb_tracking'),
    ('floor_manager', 'delivery_register_otp'), ('floor_manager', 'ready_to_rent_location'),
    ('floor_manager', 'dispatch_charger_warehouse'), ('floor_manager', 'part_vendor_repair'),
    ('floor_manager', 'vendor_repair_dc_dispatch'),
    ('floor_manager', 'report_lead_conversion'), ('floor_manager', 'report_support_daily'),
    ('floor_manager', 'inventory'), ('floor_manager', 'customer_inventory'),
    -- Floor team lead: the floor and its parts requests, not warehouse parts work.
    ('team_lead', 'parts_approval'), ('team_lead', 'parts_approval_export'),
    ('team_lead', 'parts_procurement'), ('team_lead', 'scrap_challans'),
    ('team_lead', 'parts_discarded'), ('team_lead', 'physical_dead_parts'),
    ('team_lead', 'part_vendor_repair'), ('team_lead', 'parts_history'),
    ('team_lead', 'vendor_repair_dc'),
    -- Floor technicians: their stages; QC is someone else's job (PD2).
    ('team_member', 'qc_management'), ('team_member', 'production_qc_report'),
    -- QC: inspection, not vendor repair challans.
    ('qc', 'vendor_repair_dc'),
    -- Dispatch: no sales or money reports.
    ('dispatch', 'report_revenue'), ('dispatch', 'report_collections'),
    ('dispatch', 'report_vendor_spend'), ('dispatch', 'report_salesperson'),
    ('dispatch', 'report_lead_conversion')
  ) AS v(role, section)
 WHERE rp.role = v.role AND rp.section = v.section;

-- ── A2. Add: the whole team needs it (most had it only as a personal grant) ─
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT v.role, v.section, v.cv, v.cc, v.ce, v.cd
  FROM (VALUES
    -- QC does Dispatch QC, whose first step is the charger; QC report is theirs.
    ('qc', 'dispatch_charger', TRUE, TRUE, TRUE, FALSE),
    ('qc', 'production_qc_report', TRUE, FALSE, FALSE, FALSE),
    ('qc', 'dashboard', TRUE, FALSE, FALSE, FALSE),
    -- Warehouse receives customer returns and hands laptops to/from the floor.
    ('warehouse', 'return_dc', TRUE, TRUE, TRUE, FALSE),
    ('warehouse', 'floor_tickets', TRUE, FALSE, FALSE, FALSE),
    ('warehouse', 'floor_pipeline', TRUE, FALSE, FALSE, FALSE),
    ('warehouse', 'parts', TRUE, TRUE, TRUE, FALSE),
    ('warehouse', 'delivery_register_management', TRUE, FALSE, FALSE, FALSE),
    -- Dispatch handles return challans on the inward side too.
    ('dispatch', 'return_dc', TRUE, TRUE, TRUE, FALSE),
    -- Sales follow their orders to the customer.
    ('sales', 'delivery_challans', TRUE, FALSE, FALSE, FALSE),
    ('sales', 'bluedart_awb_tracking', TRUE, FALSE, FALSE, FALSE),
    -- Accounts bill against orders, returns and POs (view only).
    ('accounts', 'sales_orders_rental', TRUE, FALSE, FALSE, FALSE),
    ('accounts', 'sales_orders_sale', TRUE, FALSE, FALSE, FALSE),
    ('accounts', 'return_dc', TRUE, FALSE, FALSE, FALSE),
    ('accounts', 'vendor_management', TRUE, FALSE, FALSE, FALSE),
    -- Support lead tracks courier pickups and replacements.
    ('support_lead', 'bluedart_awb_tracking', TRUE, FALSE, FALSE, FALSE)
  ) AS v(role, section, cv, cc, ce, cd)
 WHERE EXISTS (SELECT 1 FROM permission_sections ps WHERE ps.section = v.section)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = role_permissions.can_view OR EXCLUDED.can_view,
      can_create = role_permissions.can_create OR EXCLUDED.can_create,
      can_edit = role_permissions.can_edit OR EXCLUDED.can_edit,
      can_delete = role_permissions.can_delete OR EXCLUDED.can_delete;

-- ── B. Per-user extras reset ──────────────────────────────────────────────
-- A row is an "extra" when it grants any action the person's role does not.
-- admin / super_admin users are left alone (their role already has all).
INSERT INTO rbac_420_user_backup
SELECT up.*, NOW()
  FROM user_permissions up
  JOIN users u ON u.user_id = up.user_id
  LEFT JOIN role_permissions rp ON rp.role = u.role AND rp.section = up.section
 WHERE u.role NOT IN ('admin', 'super_admin')
   AND ((up.can_view   AND NOT COALESCE(rp.can_view, FALSE))
     OR (up.can_create AND NOT COALESCE(rp.can_create, FALSE))
     OR (up.can_edit   AND NOT COALESCE(rp.can_edit, FALSE))
     OR (up.can_delete AND NOT COALESCE(rp.can_delete, FALSE)))
   AND NOT EXISTS (SELECT 1 FROM rbac_420_user_backup b WHERE b.user_id = up.user_id AND b.section = up.section);

-- Run once (schema_migrations): re-running would also remove grants an admin
-- deliberately added after it.
DELETE FROM user_permissions up
 USING users u
 WHERE u.user_id = up.user_id
   AND u.role NOT IN ('admin', 'super_admin')
   AND ((up.can_view   AND NOT COALESCE((SELECT rp.can_view   FROM role_permissions rp WHERE rp.role = u.role AND rp.section = up.section), FALSE))
     OR (up.can_create AND NOT COALESCE((SELECT rp.can_create FROM role_permissions rp WHERE rp.role = u.role AND rp.section = up.section), FALSE))
     OR (up.can_edit   AND NOT COALESCE((SELECT rp.can_edit   FROM role_permissions rp WHERE rp.role = u.role AND rp.section = up.section), FALSE))
     OR (up.can_delete AND NOT COALESCE((SELECT rp.can_delete FROM role_permissions rp WHERE rp.role = u.role AND rp.section = up.section), FALSE)));

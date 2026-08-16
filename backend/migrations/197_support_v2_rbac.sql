-- ============================================================
-- Migration 197: Support revamp — RBAC sections + default role matrix
--   20 granular sections so access can be granted flow by flow.
--   Number is 197 (not 192) because 192–196 already exist on this branch.
-- Idempotent: safe to re-run.
-- ============================================================

-- Demo-seed tag so seed-support-demo.js can wipe only its own users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_seed BOOLEAN NOT NULL DEFAULT FALSE;

-- Widen users.role CHECK. Copied verbatim from 103_dispatch_qc_role.sql, then
-- support_agent and support_manager appended. Do not guess this list.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
    CHECK (
      role IN (
        'super_admin',
        'admin',
        'manager',
        'team_member',
        'team_lead',
        'sales',
        'floor_manager',
        'procurement',
        'qc',
        'dispatch',
        'warehouse',
        'accounts',
        'support_lead',
        'support_tech',
        'dispatch_qc',
        'customer',
        'vendor',
        'technician',
        'support_agent',
        'support_manager'
      )
    );

INSERT INTO public.roles (name, display_name, description, is_system_role) VALUES
  ('support_agent',   'Support Agent',   'Raise and classify tickets. Cannot assign field jobs or approve charges.', false),
  ('support_manager', 'Support Manager', 'Full support operations: assign, approve, administer SLA and taxonomy.', false)
ON CONFLICT (name) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description,
      is_system_role = EXCLUDED.is_system_role;

INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('support_tickets',         'Support — Ticket queue & detail',              300),
  ('support_dashboard',       'Support — Command centre',                     301),
  ('support_triage',          'Support — Triage & classification',            302),
  ('support_work_orders',     'Support — Work orders (all types)',            303),
  ('support_pickup_repair',   'Support — Repair pickup & service return',     304),
  ('support_pickup_return',   'Support — Return pickup',                      305),
  ('support_replacement',     'Support — Replacement',                        306),
  ('support_field_visit',     'Support — Field visit & remote fix',           307),
  ('support_parts_request',   'Support — Raise part requests',                308),
  ('support_parts_approve',   'Support — Approve & issue parts (warehouse)',  309),
  ('support_bucket',          'Support — My technician bucket',               310),
  ('support_dispatch',        'Support — Dispatch board & assignment',        311),
  ('support_approvals',       'Support — Approvals inbox',                    312),
  ('support_charges',         'Support — Chargeable lines & liability',       313),
  ('support_sla_admin',       'Support — SLA policies & calendars',           314),
  ('support_taxonomy',        'Support — Issue taxonomy & codes',             315),
  ('support_groups',          'Support — Groups, zones, skills, shifts',      316),
  ('support_reports',         'Support — Reports & breach register',          317),
  ('support_settings',        'Support — Module settings & templates',        318),
  ('support_customer_portal', 'Support — Customer portal administration',     319)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- Role matrix from MASTER §7.1. Every granted row is written out explicitly.
-- Blank cells in the matrix are omitted (no access).
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  -- support_tickets
  ('super_admin',      'support_tickets', true,  true,  true,  true ),
  ('admin',            'support_tickets', true,  true,  true,  true ),
  ('support_manager',  'support_tickets', true,  true,  true,  true ),
  ('support_lead',     'support_tickets', true,  true,  true,  true ),
  ('support_agent',    'support_tickets', true,  true,  true,  false),
  ('warehouse',        'support_tickets', true,  false, false, false),
  ('dispatch',         'support_tickets', true,  false, false, false),
  ('accounts',         'support_tickets', true,  false, false, false),

  -- support_dashboard
  ('super_admin',      'support_dashboard', true,  false, false, false),
  ('admin',            'support_dashboard', true,  false, false, false),
  ('support_manager',  'support_dashboard', true,  false, false, false),
  ('support_lead',     'support_dashboard', true,  false, false, false),
  ('support_agent',    'support_dashboard', true,  false, false, false),
  ('dispatch',         'support_dashboard', true,  false, false, false),

  -- support_triage
  ('super_admin',      'support_triage', true,  false, true,  false),
  ('admin',            'support_triage', true,  false, true,  false),
  ('support_manager',  'support_triage', true,  false, true,  false),
  ('support_lead',     'support_triage', true,  false, true,  false),
  ('support_agent',    'support_triage', true,  false, false, false),

  -- support_work_orders
  ('super_admin',      'support_work_orders', true,  true,  true,  true ),
  ('admin',            'support_work_orders', true,  true,  true,  true ),
  ('support_manager',  'support_work_orders', true,  true,  true,  true ),
  ('support_lead',     'support_work_orders', true,  true,  true,  true ),
  ('support_agent',    'support_work_orders', true,  false, false, false),
  ('support_tech',     'support_work_orders', true,  false, false, false),
  ('warehouse',        'support_work_orders', true,  false, false, false),
  ('dispatch',         'support_work_orders', true,  true,  true,  false),

  -- support_pickup_repair
  ('super_admin',      'support_pickup_repair', true,  true,  true,  true ),
  ('admin',            'support_pickup_repair', true,  true,  true,  true ),
  ('support_manager',  'support_pickup_repair', true,  true,  true,  true ),
  ('support_lead',     'support_pickup_repair', true,  true,  true,  false),
  ('support_agent',    'support_pickup_repair', true,  false, false, false),
  ('support_tech',     'support_pickup_repair', true,  false, true,  false),
  ('warehouse',        'support_pickup_repair', true,  false, true,  false),
  ('dispatch',         'support_pickup_repair', true,  false, true,  false),

  -- support_pickup_return
  ('super_admin',      'support_pickup_return', true,  true,  true,  true ),
  ('admin',            'support_pickup_return', true,  true,  true,  true ),
  ('support_manager',  'support_pickup_return', true,  true,  true,  true ),
  ('support_lead',     'support_pickup_return', true,  true,  true,  false),
  ('support_agent',    'support_pickup_return', true,  false, false, false),
  ('support_tech',     'support_pickup_return', true,  false, true,  false),
  ('warehouse',        'support_pickup_return', true,  false, true,  false),
  ('dispatch',         'support_pickup_return', true,  false, true,  false),

  -- support_replacement
  ('super_admin',      'support_replacement', true,  true,  true,  true ),
  ('admin',            'support_replacement', true,  true,  true,  true ),
  ('support_manager',  'support_replacement', true,  true,  true,  true ),
  ('support_lead',     'support_replacement', true,  true,  false, false),
  ('support_agent',    'support_replacement', true,  false, false, false),
  ('support_tech',     'support_replacement', true,  false, true,  false),
  ('warehouse',        'support_replacement', true,  false, false, false),
  ('dispatch',         'support_replacement', true,  false, true,  false),

  -- support_field_visit
  ('super_admin',      'support_field_visit', true,  true,  true,  true ),
  ('admin',            'support_field_visit', true,  true,  true,  true ),
  ('support_manager',  'support_field_visit', true,  true,  true,  true ),
  ('support_lead',     'support_field_visit', true,  true,  true,  false),
  ('support_agent',    'support_field_visit', true,  true,  false, false),
  ('support_tech',     'support_field_visit', true,  false, true,  false),
  ('dispatch',         'support_field_visit', true,  false, true,  false),

  -- support_parts_request
  ('super_admin',      'support_parts_request', true,  true,  true,  true ),
  ('admin',            'support_parts_request', true,  true,  true,  true ),
  ('support_manager',  'support_parts_request', true,  true,  true,  false),
  ('support_lead',     'support_parts_request', true,  true,  true,  false),
  ('support_agent',    'support_parts_request', true,  true,  false, false),
  ('support_tech',     'support_parts_request', true,  true,  false, false),
  ('warehouse',        'support_parts_request', true,  true,  true,  false),

  -- support_parts_approve
  ('super_admin',      'support_parts_approve', true,  false, true,  false),
  ('admin',            'support_parts_approve', true,  false, true,  false),
  ('support_manager',  'support_parts_approve', true,  false, true,  false),
  ('support_lead',     'support_parts_approve', true,  false, true,  false),
  ('warehouse',        'support_parts_approve', true,  false, true,  false),

  -- support_bucket
  ('super_admin',      'support_bucket', true,  false, true,  false),
  ('admin',            'support_bucket', true,  false, true,  false),
  ('support_manager',  'support_bucket', true,  false, false, false),
  ('support_lead',     'support_bucket', true,  false, false, false),
  ('support_tech',     'support_bucket', true,  false, true,  false),
  ('warehouse',        'support_bucket', true,  false, true,  false),
  ('dispatch',         'support_bucket', true,  false, false, false),

  -- support_dispatch
  ('super_admin',      'support_dispatch', true,  false, true,  false),
  ('admin',            'support_dispatch', true,  false, true,  false),
  ('support_manager',  'support_dispatch', true,  false, true,  false),
  ('support_lead',     'support_dispatch', true,  false, true,  false),
  ('dispatch',         'support_dispatch', true,  false, true,  false),

  -- support_approvals
  ('super_admin',      'support_approvals', true,  false, true,  false),
  ('admin',            'support_approvals', true,  false, true,  false),
  ('support_manager',  'support_approvals', true,  false, true,  false),
  ('support_lead',     'support_approvals', true,  false, true,  false),
  ('accounts',         'support_approvals', true,  false, false, false),

  -- support_charges
  ('super_admin',      'support_charges', true,  true,  true,  false),
  ('admin',            'support_charges', true,  true,  true,  false),
  ('support_manager',  'support_charges', true,  true,  true,  false),
  ('support_lead',     'support_charges', true,  true,  false, false),
  ('support_tech',     'support_charges', false, true,  false, false),
  ('accounts',         'support_charges', true,  false, true,  false),

  -- support_sla_admin
  ('super_admin',      'support_sla_admin', true,  true,  true,  true ),
  ('admin',            'support_sla_admin', true,  true,  true,  true ),
  ('support_manager',  'support_sla_admin', true,  false, true,  false),
  ('support_lead',     'support_sla_admin', true,  false, false, false),

  -- support_taxonomy
  ('super_admin',      'support_taxonomy', true,  true,  true,  true ),
  ('admin',            'support_taxonomy', true,  true,  true,  true ),
  ('support_manager',  'support_taxonomy', true,  true,  true,  false),
  ('support_lead',     'support_taxonomy', true,  false, false, false),
  ('support_agent',    'support_taxonomy', true,  false, false, false),
  ('support_tech',     'support_taxonomy', true,  false, false, false),
  ('warehouse',        'support_taxonomy', true,  false, false, false),
  ('dispatch',         'support_taxonomy', true,  false, false, false),

  -- support_groups
  ('super_admin',      'support_groups', true,  true,  true,  true ),
  ('admin',            'support_groups', true,  true,  true,  true ),
  ('support_manager',  'support_groups', true,  true,  true,  false),
  ('support_lead',     'support_groups', true,  false, false, false),
  ('dispatch',         'support_groups', true,  false, false, false),

  -- support_reports
  ('super_admin',      'support_reports', true,  false, false, false),
  ('admin',            'support_reports', true,  false, false, false),
  ('support_manager',  'support_reports', true,  false, false, false),
  ('support_lead',     'support_reports', true,  false, false, false),
  ('support_agent',    'support_reports', true,  false, false, false),
  ('dispatch',         'support_reports', true,  false, false, false),
  ('accounts',         'support_reports', true,  false, false, false),

  -- support_settings
  ('super_admin',      'support_settings', true,  false, true,  false),
  ('admin',            'support_settings', true,  false, true,  false),
  ('support_manager',  'support_settings', true,  false, false, false),

  -- support_customer_portal
  ('super_admin',      'support_customer_portal', true,  false, true,  false),
  ('admin',            'support_customer_portal', true,  false, true,  false),
  ('support_manager',  'support_customer_portal', true,  false, true,  false),
  ('support_lead',     'support_customer_portal', true,  false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;

-- Anyone who can currently view support_tickets keeps equivalent view access
-- in the new sections so nobody loses the module on deploy day.
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, s.section, true, false, false, false
  FROM user_permissions up
  CROSS JOIN (VALUES
    ('support_dashboard'),
    ('support_triage'),
    ('support_work_orders'),
    ('support_pickup_repair'),
    ('support_pickup_return'),
    ('support_replacement'),
    ('support_field_visit'),
    ('support_reports')
  ) AS s(section)
 WHERE up.section = 'support_tickets' AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;

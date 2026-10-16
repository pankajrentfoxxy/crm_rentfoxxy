-- 431: Who may read a support visit / pickup OTP (16 Oct 2026).
--
-- Only Super Admin and Support Lead by default. Anyone else needs this section
-- granted (Roles & Permissions, or a per-user extra) — e.g. a stand-in who
-- shares the OTP when the lead is busy. Replaces the old rule (admin, manager
-- and any "support ticket assignee" could read it). Warehouse OTPs unchanged.
-- Additive only.

INSERT INTO permission_sections (section, description, sort_order, section_group) VALUES
  ('support_ticket_otp', 'Support — see the customer OTP on a visit or pickup (to share it when needed)', 214, 'support')
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('super_admin',  'support_ticket_otp', TRUE, FALSE, FALSE, FALSE),
  ('support_lead', 'support_ticket_otp', TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, section) DO NOTHING;

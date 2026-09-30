-- 258_dispatch_charger_reset_permission.sql
-- Granular permission: undo a "charger already with customer" choice at Dispatch QC so a
-- charger can be requested instead. No role gets it by default; super_admin always has it.
-- Grant it per user from Roles & Permissions.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'dispatch_charger_reset',
  'Dispatch QC — cancel "charger already with customer" choice',
  170
)
ON CONFLICT (section) DO NOTHING;

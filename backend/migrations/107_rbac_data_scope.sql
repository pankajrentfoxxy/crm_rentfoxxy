-- Per-module data scope: all records vs assigned-only (user overrides + role defaults)
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS data_scope VARCHAR(16) NOT NULL DEFAULT 'all'
    CHECK (data_scope IN ('all', 'assigned'));

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS data_scope VARCHAR(16) DEFAULT NULL
    CHECK (data_scope IS NULL OR data_scope IN ('all', 'assigned'));

UPDATE role_permissions SET data_scope = 'all' WHERE data_scope IS NULL;

-- Default assigned-only for operator roles; managers/admins see all data
UPDATE role_permissions
   SET data_scope = 'assigned'
 WHERE role IN (
   'technician', 'team_member', 'team_lead', 'qc', 'dispatch_qc',
   'support_tech', 'warehouse', 'sales', 'dispatch', 'procurement', 'accounts'
 );

UPDATE role_permissions
   SET data_scope = 'all'
 WHERE role IN ('admin', 'manager', 'floor_manager', 'support_lead');

COMMENT ON COLUMN role_permissions.data_scope IS 'all = all records allowed by RBAC; assigned = only records assigned to the user';
COMMENT ON COLUMN user_permissions.data_scope IS 'Override role data_scope; NULL inherits from role_permissions';

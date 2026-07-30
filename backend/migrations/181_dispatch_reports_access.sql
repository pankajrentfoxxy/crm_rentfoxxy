-- Grant dispatch team access to Reports (incl. Sales Order Report) with full data scope.

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope)
VALUES
  ('dispatch', 'reports_access', true, false, false, false, 'all'),
  ('dispatch', 'reports', true, false, false, false, 'all'),
  ('dispatch', 'reports_export', true, false, false, false, 'all')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view),
      can_edit = GREATEST(role_permissions.can_edit, EXCLUDED.can_edit),
      data_scope = CASE
        WHEN EXCLUDED.data_scope = 'all' THEN 'all'
        ELSE role_permissions.data_scope
      END;

-- dispatch_1@rentfoxxy.com — explicit full reports access (overrides assigned scope on reports).
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, data_scope, granted_at)
SELECT u.user_id, v.section, true, false, false, false, 'all', NOW()
  FROM users u
 CROSS JOIN (VALUES ('reports_access'), ('reports'), ('reports_export')) AS v(section)
 WHERE LOWER(u.email) = 'dispatch_1@rentfoxxy.com'
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = true,
      data_scope = 'all',
      granted_at = NOW();

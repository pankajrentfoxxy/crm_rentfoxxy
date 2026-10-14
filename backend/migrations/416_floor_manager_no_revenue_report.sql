-- 416: floor managers no longer see the Revenue report (user, 15 Oct 2026).
--
-- Migration 201 gave floor_manager every granular report, Revenue included;
-- the "Old UI" button then landed floor managers on revenue figures. Only the
-- role default changes: a user-level grant (user_permissions) still wins, as
-- everywhere else. Idempotent; 201 does not replay on boot.
UPDATE role_permissions
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
 WHERE role = 'floor_manager'
   AND section = 'report_revenue';

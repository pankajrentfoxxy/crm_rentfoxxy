-- 418: floor managers no longer see the Salesperson report (user, 15 Oct 2026;
-- follows 416 Revenue and 417 Collections / Vendor Spend).
--
-- Migration 201 granted floor_manager every granular report. Only the role
-- default changes: a user-level grant (user_permissions) still wins.
-- Idempotent; 201 does not replay on boot.
UPDATE role_permissions
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
 WHERE role = 'floor_manager'
   AND section = 'report_salesperson';

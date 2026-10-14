-- 417: floor managers no longer see the Collections and Vendor Spend reports
-- (user, 15 Oct 2026; Revenue went in 416).
--
-- Migration 201 granted floor_manager every granular report. Only the role
-- default changes: a user-level grant (user_permissions) still wins.
-- Idempotent; 201 does not replay on boot.
UPDATE role_permissions
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
 WHERE role = 'floor_manager'
   AND section IN ('report_collections', 'report_vendor_spend');

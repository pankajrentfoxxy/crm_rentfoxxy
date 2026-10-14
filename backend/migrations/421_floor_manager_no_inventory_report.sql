-- 421: floor managers no longer see the Inventory (utilisation) report
-- (user, 15 Oct 2026; it shows each rental customer's monthly value).
-- Follows 416-419. Only the role default changes; a user-level grant still
-- wins. Idempotent; 201 does not replay on boot.
UPDATE role_permissions
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
 WHERE role = 'floor_manager'
   AND section = 'report_inventory';

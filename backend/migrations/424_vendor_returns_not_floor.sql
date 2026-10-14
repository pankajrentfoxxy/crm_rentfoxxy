-- 424: Vendor Returns (Procurement → Vendor returns: return to vendor, return
-- requests, repair challans) is the vendor / warehouse team's page, not the
-- floor's (user, 15 Oct 2026). The page and /api/vendor-repair no longer
-- accept floor_pipeline / diagnosis_failed (code change, same commit); this
-- takes the vendor sections off the roles that are not the vendor team.
-- The floor keeps marking laptops diagnosis-failed, and a floor manager's
-- "Send back to vendor" on a floor ticket uses floor permissions, so both
-- are unaffected. User-level grants still win. Idempotent.
UPDATE role_permissions
   SET can_view = FALSE, can_create = FALSE, can_edit = FALSE, can_delete = FALSE
 WHERE (role, section) IN (
   ('floor_manager', 'vendor_repair_dc'),
   ('floor_manager', 'vendor_return_ticket'),
   ('technician',    'vendor_repair_dc'),
   ('dispatch_qc',   'vendor_repair_dc')
 );

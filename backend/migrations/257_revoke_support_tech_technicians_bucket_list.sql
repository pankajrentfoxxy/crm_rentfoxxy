-- Revoke admin "Technicians Bucket (all techs)" from support_tech.
-- Field techs keep technician_bucket → My Deliveries (assigned only).
-- Without this, support_tech could open /sales-pipeline/technician-bucket
-- and see every technician's in-house deliveries.

UPDATE role_permissions
   SET can_view = FALSE,
       can_create = FALSE,
       can_edit = FALSE,
       can_delete = FALSE,
       data_scope = 'assigned'
 WHERE role = 'support_tech'
   AND section = 'technicians_bucket_list';

-- Clear any user overrides that re-granted the admin bucket list to support techs.
DELETE FROM user_permissions
 WHERE section = 'technicians_bucket_list'
   AND user_id IN (SELECT user_id FROM users WHERE role = 'support_tech');

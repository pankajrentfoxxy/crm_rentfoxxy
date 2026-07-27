-- 172_dispatch_sale_dc_compliance_upload.sql
-- Allow Dispatch team to upload E-Invoice / E-Way Bill on sale DCs.

UPDATE role_permissions
   SET can_create = TRUE,
       can_edit = TRUE
 WHERE role = 'dispatch'
   AND section = 'einvoice_ewb';

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT 'dispatch', 'einvoice_ewb', TRUE, TRUE, TRUE, FALSE
 WHERE NOT EXISTS (
   SELECT 1 FROM role_permissions WHERE role = 'dispatch' AND section = 'einvoice_ewb'
 );

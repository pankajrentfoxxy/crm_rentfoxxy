-- Allow admin to edit customer-held asset specs from Customer → Assets tab.
UPDATE role_permissions
   SET can_edit = true
 WHERE section = 'customer_assets'
   AND role IN ('admin', 'super_admin');

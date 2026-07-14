-- Granular permission: view delivery / warehouse-return OTP codes in Delivery Register.
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('delivery_register_otp', 'Delivery Register — View OTP', 176)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Default grants for roles that historically saw OTP codes.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('super_admin', 'delivery_register_otp', true, false, false, false),
  ('admin',       'delivery_register_otp', true, false, false, false),
  ('manager',     'delivery_register_otp', true, false, false, false),
  ('warehouse',   'delivery_register_otp', true, false, false, false),
  ('support_lead','delivery_register_otp', true, false, false, false),
  ('floor_manager','delivery_register_otp', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view);

-- Anyone with Delivery Register view also gets OTP view unless explicitly overridden.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'delivery_register_otp', true, false, false, false
  FROM role_permissions rp
 WHERE rp.section = 'delivery_register_management'
   AND rp.can_view = true
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view);

-- User-level overrides: Delivery Register view => OTP view (e.g. custom grants like warehouse staff).
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, data_scope, granted_at)
SELECT up.user_id, 'delivery_register_otp', true, false, false, false, up.data_scope, NOW()
  FROM user_permissions up
 WHERE up.section = 'delivery_register_management'
   AND up.can_view = true
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = GREATEST(user_permissions.can_view, EXCLUDED.can_view);

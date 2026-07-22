-- Dispatch Pending Orders: dispatch team only (not sales/manager/admin queue viewers).

DELETE FROM role_permissions
 WHERE section = 'dispatch_pending_orders'
   AND role IN ('admin', 'manager');

-- Dispatch can open assigned SO detail after acceptance (read-only doc access).
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES ('dispatch', 'sales_orders_doc', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view);

# RENTFOXXY CRM — PHASE 10 BUILD PROMPT
## Complete User Management + Role & Permission System
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- Existing RBAC backend is solid — extend, do NOT rewrite.
- Existing backend endpoints already working:
  POST /api/auth/register          — create user (admin/manager only)
  GET  /api/auth/users             — list all users
  DELETE /api/auth/users/:id       — delete user
  GET  /api/roles                  — list roles
  POST /api/roles                  — create role
  PUT  /api/roles/:id              — update role
  GET  /api/role-permissions/:role — get role permissions
  PUT  /api/role-permissions/:role — save role permissions
  GET  /api/user-permissions/:id   — get user-level overrides
  PUT  /api/user-permissions/:id   — save user-level overrides
  GET  /api/users/by-role/:role    — users filtered by role
- Missing backend endpoints: user status (activate/deactivate/block),
  user update (name, email, mobile, role, team), reset password
- RBAC sections in frontend/src/constants/sections.js are incomplete
  — missing all Phase 2-9 sections
- Design system: Primary #2563EB, same as all phases

---

## SECTION 1 — COMPLETE ROLES IN THE SYSTEM

These are ALL roles that exist (from MANAGEABLE_ROLES in authController.js
plus super_admin from roles table):

| Role | Display Name | Description |
|---|---|---|
| super_admin | Super Admin | Full unrestricted access. Can manage admins. |
| admin | Admin | Full access except super_admin actions |
| manager | Manager | Approve POs, view all leads, reports, billing overview |
| sales | Sales | Leads, quotations, sales orders, own customers |
| floor_manager | Floor Manager | Assign tickets, all floor pipeline, inventory |
| team_member | Technician (Floor) | Own assigned tickets only, parts requests |
| team_lead | Senior Technician | Own + team tickets, can log parts |
| qc | QC Inspector | QC1/QC2 stages only |
| procurement | Procurement | Purchase orders, GRN, vendor management |
| warehouse | Warehouse | GRN receive, inventory, DC attachment |
| dispatch | Dispatch | Delivery challans, dispatch, delivery register |
| accounts | Accounts | Billing, invoices, e-invoice, credit/debit notes |
| support_lead | Support Lead | All support tickets, manage support team |
| support_tech | Support Technician | Own assigned support tickets |

Note: 'vendor' and 'customer' roles are portal-only users
(vendor.rentfoxxy.com and customer.rentfoxxy.com) — they do NOT
appear as CRM users. The vendor portal auth is separate.

---

## SECTION 2 — COMPLETE PERMISSION SECTIONS MATRIX

These are ALL sections that should exist in the permission system.
Update frontend/src/constants/sections.js to include every one:

```javascript
export const APPLICATION_SECTIONS = [
  // ─── CORE ───────────────────────────────────────────
  'dashboard',
  'analytics_dashboard',

  // ─── LEAD & SALES CRM ───────────────────────────────
  'leads',
  'lead_follow_ups',
  'lead_conversion',
  'customers',
  'customer_documents',
  'sales_quotations',
  'sales_orders_doc',
  'delivery_challans',
  'return_dc',
  'delivery_register_management',
  'payment_records',

  // ─── VENDOR & PROCUREMENT ───────────────────────────
  'vendor_management',
  'procurement',
  'sales_pipeline',

  // ─── FLOOR & QUALITY ────────────────────────────────
  'floor_pipeline',
  'floor_tickets',
  'chip_level_repair',
  'qc_management',
  'tickets',

  // ─── INVENTORY & PARTS ──────────────────────────────
  'inventory',
  'inventory_management',
  'parts',
  'parts_inventory',
  'customer_inventory',
  'ttspl_history',

  // ─── WAREHOUSE & DISPATCH ───────────────────────────
  'warehouse',
  'dispatch',
  'dispatch_ops',

  // ─── FINANCE & BILLING ──────────────────────────────
  'customer_billing',
  'vendor_billing_mgmt',
  'credit_notes',
  'debit_notes',
  'security_deposits',
  'billing_dashboard',
  'einvoice_ewb',

  // ─── SUPPORT ────────────────────────────────────────
  'support_tickets',
  'support_settings',

  // ─── REPORTS & ANALYTICS ────────────────────────────
  'reports',
  'reports_access',
  'reports_export',
  'manager_dashboard',

  // ─── SETTINGS & ADMIN ───────────────────────────────
  'users',
  'teams',
  'roles',
  'role_permissions',
  'user_permissions',
];

export const SECTION_LABELS = {
  // Core
  dashboard:                  'Dashboard',
  analytics_dashboard:        'Analytics Dashboard',
  // Lead & Sales
  leads:                      'Leads',
  lead_follow_ups:            'Follow-ups',
  lead_conversion:            'Lead Conversion',
  customers:                  'Customers',
  customer_documents:         'Customer Documents',
  sales_quotations:           'Quotations',
  sales_orders_doc:           'Sales Orders',
  delivery_challans:          'Delivery Challans',
  return_dc:                  'Return DC',
  delivery_register_management: 'Delivery Register',
  payment_records:            'Payment Records',
  // Vendor & Procurement
  vendor_management:          'Vendor Management',
  procurement:                'Procurement',
  sales_pipeline:             'Sales Pipeline',
  // Floor & Quality
  floor_pipeline:             'Floor Pipeline',
  floor_tickets:              'Floor Tickets',
  chip_level_repair:          'Chip Level Repair',
  qc_management:              'QC Management',
  tickets:                    'Tickets (Legacy)',
  // Inventory & Parts
  inventory:                  'Inventory',
  inventory_management:       'Inventory Management',
  parts:                      'Parts (Legacy)',
  parts_inventory:            'Parts Inventory',
  customer_inventory:         'Customer Inventory',
  ttspl_history:              'TTSPL History',
  // Warehouse & Dispatch
  warehouse:                  'Warehouse',
  dispatch:                   'Dispatch',
  dispatch_ops:               'Dispatch Operations',
  // Finance
  customer_billing:           'Customer Billing',
  vendor_billing_mgmt:        'Vendor Billing',
  credit_notes:               'Credit Notes',
  debit_notes:                'Debit Notes',
  security_deposits:          'Security Deposits',
  billing_dashboard:          'Billing Dashboard',
  einvoice_ewb:               'E-Invoice & E-Way Bill',
  // Support
  support_tickets:            'Support Tickets',
  support_settings:           'Support Settings',
  // Reports
  reports:                    'Reports',
  reports_access:             'Reports Access',
  reports_export:             'Export Reports',
  manager_dashboard:          'Manager Dashboard',
  // Settings
  users:                      'User Management',
  teams:                      'Team Management',
  roles:                      'Role Management',
  role_permissions:           'Role Permissions',
  user_permissions:           'User Permissions',
};
```

Also add section grouping for the permission matrix UI:
```javascript
export const SECTION_GROUPS = {
  'Core': ['dashboard', 'analytics_dashboard'],
  'Lead & Sales CRM': ['leads','lead_follow_ups','lead_conversion','customers',
    'customer_documents','sales_quotations','sales_orders_doc',
    'delivery_challans','return_dc','delivery_register_management','payment_records'],
  'Vendor & Procurement': ['vendor_management','procurement','sales_pipeline'],
  'Floor & Quality': ['floor_pipeline','floor_tickets','chip_level_repair','qc_management','tickets'],
  'Inventory & Parts': ['inventory','inventory_management','parts_inventory',
    'customer_inventory','ttspl_history'],
  'Warehouse & Dispatch': ['warehouse','dispatch','dispatch_ops'],
  'Finance & Billing': ['customer_billing','vendor_billing_mgmt','credit_notes',
    'debit_notes','security_deposits','billing_dashboard','einvoice_ewb'],
  'Support': ['support_tickets','support_settings'],
  'Reports & Analytics': ['reports','reports_access','reports_export','manager_dashboard'],
  'Settings & Admin': ['users','teams','roles','role_permissions','user_permissions'],
};
```

---

## SECTION 3 — DATABASE MIGRATIONS

### Migration 072_phase10_user_role_management.sql

```sql
-- Phase 10: Complete user management enhancements

-- 1. Add missing columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS deactivated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url  TEXT,
  ADD COLUMN IF NOT EXISTS designation        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS department         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS employee_id        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS joining_date       DATE,
  ADD COLUMN IF NOT EXISTS notes              TEXT;

-- 2. Update users.status CHECK to include 'inactive'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active','pending_approval','rejected','blocked','inactive'));

-- 3. Add all missing permission sections
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('analytics_dashboard',   'Analytics Dashboard',     11),
  ('lead_follow_ups',        'Follow-ups',              41),
  ('lead_conversion',        'Lead Conversion',         45),
  ('customer_documents',     'Customer Documents',       85),
  ('delivery_register_management','Delivery Register',  175),
  ('payment_records',        'Payment Records',         176),
  ('floor_pipeline',         'Floor Pipeline',           25),
  ('floor_tickets',          'Floor Tickets',            26),
  ('chip_level_repair',      'Chip Level Repair',        27),
  ('parts_inventory',        'Parts Inventory',          28),
  ('ttspl_history',          'TTSPL History',            29),
  ('dispatch_ops',           'Dispatch Operations',     175),
  ('customer_billing',       'Customer Billing',        200),
  ('vendor_billing_mgmt',    'Vendor Billing',          201),
  ('credit_notes',           'Credit Notes',            202),
  ('debit_notes',            'Debit Notes',             203),
  ('security_deposits',      'Security Deposits',       204),
  ('billing_dashboard',      'Billing Dashboard',       205),
  ('einvoice_ewb',           'E-Invoice & E-Way Bill',  206),
  ('support_settings',       'Support Settings',        301),
  ('reports_access',         'Reports Access',          402),
  ('reports_export',         'Export Reports',          403),
  ('sales_pipeline',         'Sales Pipeline',           55),
  ('users',                  'User Management',         350)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- 4. Add all roles to the roles table that are missing
INSERT INTO roles (name, display_name, description, is_system_role)
VALUES
  ('super_admin',   'Super Admin',         'Full unrestricted access',              true),
  ('admin',         'Admin',               'Full CRM access',                       true),
  ('manager',       'Manager',             'Approvals, reports, team oversight',    true),
  ('sales',         'Sales',               'Leads, quotations, sales orders',       false),
  ('floor_manager', 'Floor Manager',       'Assign tickets, floor oversight',       false),
  ('team_member',   'Technician (Floor)',  'Assigned tickets, parts requests',      false),
  ('team_lead',     'Senior Technician',   'Team tickets, parts management',        false),
  ('qc',            'QC Inspector',        'QC1/QC2 stages only',                   false),
  ('procurement',   'Procurement',         'Purchase orders, GRN, vendors',         false),
  ('warehouse',     'Warehouse',           'GRN, inventory, DC attachment',         false),
  ('dispatch',      'Dispatch',            'Delivery challans, dispatch',           false),
  ('accounts',      'Accounts',            'Billing, invoices, finance',            false),
  ('support_lead',  'Support Lead',        'All support tickets, team management',  false),
  ('support_tech',  'Support Technician',  'Own assigned support tickets',          false)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description;

-- 5. Seed comprehensive default permissions per role
-- (Only insert, don't overwrite existing customisations)

-- super_admin: everything
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT 'super_admin', section, true, true, true, true
FROM permission_sections
ON CONFLICT (role, section) DO NOTHING;

-- admin: everything except delete on financial records
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT 'admin', section, true, true, true,
  CASE WHEN section IN ('customer_billing','vendor_billing_mgmt','credit_notes',
       'debit_notes','security_deposits') THEN false ELSE true END
FROM permission_sections
ON CONFLICT (role, section) DO NOTHING;

-- manager: view+create+edit most, no delete, no user management
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('manager','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('manager','analytics_dashboard',TRUE,FALSE,FALSE,FALSE),
  ('manager','leads',TRUE,TRUE,TRUE,FALSE),
  ('manager','lead_follow_ups',TRUE,TRUE,TRUE,FALSE),
  ('manager','lead_conversion',TRUE,TRUE,TRUE,FALSE),
  ('manager','customers',TRUE,TRUE,TRUE,FALSE),
  ('manager','customer_documents',TRUE,TRUE,TRUE,FALSE),
  ('manager','sales_quotations',TRUE,TRUE,TRUE,FALSE),
  ('manager','sales_orders_doc',TRUE,TRUE,TRUE,FALSE),
  ('manager','delivery_challans',TRUE,TRUE,TRUE,FALSE),
  ('manager','return_dc',TRUE,FALSE,TRUE,FALSE),
  ('manager','delivery_register_management',TRUE,FALSE,TRUE,FALSE),
  ('manager','payment_records',TRUE,TRUE,TRUE,FALSE),
  ('manager','vendor_management',TRUE,TRUE,TRUE,FALSE),
  ('manager','procurement',TRUE,TRUE,TRUE,FALSE),
  ('manager','sales_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('manager','floor_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('manager','floor_tickets',TRUE,FALSE,TRUE,FALSE),
  ('manager','chip_level_repair',TRUE,FALSE,TRUE,FALSE),
  ('manager','qc_management',TRUE,FALSE,TRUE,FALSE),
  ('manager','inventory',TRUE,FALSE,TRUE,FALSE),
  ('manager','inventory_management',TRUE,FALSE,TRUE,FALSE),
  ('manager','parts_inventory',TRUE,TRUE,TRUE,FALSE),
  ('manager','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('manager','warehouse',TRUE,FALSE,TRUE,FALSE),
  ('manager','dispatch',TRUE,FALSE,TRUE,FALSE),
  ('manager','dispatch_ops',TRUE,FALSE,TRUE,FALSE),
  ('manager','customer_billing',TRUE,TRUE,TRUE,FALSE),
  ('manager','vendor_billing_mgmt',TRUE,TRUE,TRUE,FALSE),
  ('manager','credit_notes',TRUE,TRUE,TRUE,FALSE),
  ('manager','debit_notes',TRUE,TRUE,TRUE,FALSE),
  ('manager','security_deposits',TRUE,TRUE,TRUE,FALSE),
  ('manager','billing_dashboard',TRUE,FALSE,FALSE,FALSE),
  ('manager','einvoice_ewb',TRUE,TRUE,FALSE,FALSE),
  ('manager','support_tickets',TRUE,TRUE,TRUE,FALSE),
  ('manager','reports',TRUE,FALSE,FALSE,FALSE),
  ('manager','reports_access',TRUE,FALSE,FALSE,FALSE),
  ('manager','reports_export',TRUE,TRUE,FALSE,FALSE),
  ('manager','analytics_dashboard',TRUE,FALSE,FALSE,FALSE),
  ('manager','users',TRUE,TRUE,TRUE,FALSE),
  ('manager','teams',TRUE,TRUE,TRUE,FALSE),
  ('manager','roles',TRUE,FALSE,FALSE,FALSE),
  ('manager','role_permissions',TRUE,FALSE,TRUE,FALSE),
  ('manager','user_permissions',TRUE,FALSE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- sales: leads, customers, quotations, SOs, basic inventory view
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('sales','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('sales','leads',TRUE,TRUE,TRUE,FALSE),
  ('sales','lead_follow_ups',TRUE,TRUE,TRUE,FALSE),
  ('sales','lead_conversion',TRUE,TRUE,FALSE,FALSE),
  ('sales','customers',TRUE,TRUE,TRUE,FALSE),
  ('sales','customer_documents',TRUE,TRUE,FALSE,FALSE),
  ('sales','sales_quotations',TRUE,TRUE,FALSE,FALSE),
  ('sales','sales_orders_doc',TRUE,TRUE,FALSE,FALSE),
  ('sales','delivery_challans',TRUE,FALSE,FALSE,FALSE),
  ('sales','inventory',TRUE,FALSE,FALSE,FALSE),
  ('sales','inventory_management',TRUE,FALSE,FALSE,FALSE),
  ('sales','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('sales','support_tickets',TRUE,FALSE,FALSE,FALSE),
  ('sales','reports_access',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- floor_manager: full floor + inventory + vendor view
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('floor_manager','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','floor_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','floor_tickets',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','chip_level_repair',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','qc_management',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','inventory',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','inventory_management',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','parts_inventory',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','warehouse',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','vendor_management',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','reports_access',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','support_tickets',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- team_member (technician): own tickets, parts
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('team_member','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('team_member','floor_pipeline',TRUE,FALSE,TRUE,FALSE),
  ('team_member','floor_tickets',TRUE,FALSE,TRUE,FALSE),
  ('team_member','chip_level_repair',TRUE,FALSE,TRUE,FALSE),
  ('team_member','parts_inventory',TRUE,FALSE,FALSE,FALSE),
  ('team_member','ttspl_history',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- team_lead: same as team_member + create
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('team_lead','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('team_lead','floor_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('team_lead','floor_tickets',TRUE,TRUE,TRUE,FALSE),
  ('team_lead','chip_level_repair',TRUE,TRUE,TRUE,FALSE),
  ('team_lead','parts_inventory',TRUE,FALSE,FALSE,FALSE),
  ('team_lead','ttspl_history',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- qc: QC stages only
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('qc','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('qc','floor_pipeline',TRUE,FALSE,TRUE,FALSE),
  ('qc','floor_tickets',TRUE,FALSE,TRUE,FALSE),
  ('qc','qc_management',TRUE,FALSE,TRUE,FALSE),
  ('qc','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('qc','inventory_management',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- procurement: vendors, POs, GRN
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('procurement','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('procurement','vendor_management',TRUE,TRUE,TRUE,FALSE),
  ('procurement','procurement',TRUE,TRUE,TRUE,FALSE),
  ('procurement','inventory_management',TRUE,FALSE,FALSE,FALSE),
  ('procurement','parts_inventory',TRUE,TRUE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- warehouse: GRN, inventory, DC attach
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('warehouse','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('warehouse','warehouse',TRUE,TRUE,TRUE,FALSE),
  ('warehouse','inventory',TRUE,FALSE,TRUE,FALSE),
  ('warehouse','inventory_management',TRUE,FALSE,TRUE,FALSE),
  ('warehouse','parts_inventory',TRUE,TRUE,TRUE,FALSE),
  ('warehouse','delivery_challans',TRUE,FALSE,TRUE,FALSE),
  ('warehouse','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('warehouse','vendor_management',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- dispatch: DCs, delivery register
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('dispatch','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('dispatch','dispatch',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','dispatch_ops',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','delivery_challans',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','delivery_register_management',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','einvoice_ewb',TRUE,FALSE,FALSE,FALSE),
  ('dispatch','customers',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- accounts: billing only
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('accounts','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('accounts','customer_billing',TRUE,TRUE,TRUE,FALSE),
  ('accounts','vendor_billing_mgmt',TRUE,TRUE,TRUE,FALSE),
  ('accounts','credit_notes',TRUE,TRUE,FALSE,FALSE),
  ('accounts','debit_notes',TRUE,TRUE,FALSE,FALSE),
  ('accounts','security_deposits',TRUE,TRUE,TRUE,FALSE),
  ('accounts','billing_dashboard',TRUE,FALSE,FALSE,FALSE),
  ('accounts','einvoice_ewb',TRUE,TRUE,FALSE,FALSE),
  ('accounts','reports_access',TRUE,FALSE,FALSE,FALSE),
  ('accounts','reports_export',TRUE,TRUE,FALSE,FALSE),
  ('accounts','customers',TRUE,FALSE,FALSE,FALSE),
  ('accounts','delivery_challans',TRUE,FALSE,FALSE,FALSE),
  ('accounts','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('accounts','payment_records',TRUE,TRUE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- support_lead: full support
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_lead','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('support_lead','support_tickets',TRUE,TRUE,TRUE,FALSE),
  ('support_lead','support_settings',TRUE,FALSE,TRUE,FALSE),
  ('support_lead','customers',TRUE,FALSE,FALSE,FALSE),
  ('support_lead','customer_inventory',TRUE,FALSE,FALSE,FALSE),
  ('support_lead','ttspl_history',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

-- support_tech: own tickets
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_tech','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('support_tech','support_tickets',TRUE,TRUE,TRUE,FALSE),
  ('support_tech','customers',TRUE,FALSE,FALSE,FALSE),
  ('support_tech','customer_inventory',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 4 — BACKEND: USER MANAGEMENT ENDPOINTS

### 4.1 Add to `backend/controllers/authController.js`

**`exports.updateUser`**
PUT /api/auth/users/:id
Roles: admin, manager (manager can only edit non-admin/manager users)

Body: { name, email, mobile_no, role, team_id, designation,
        department, employee_id, joining_date, notes }

```javascript
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const target = await pool.query('SELECT * FROM users WHERE user_id=$1',[id]);
  if (!target.rows.length) return res.status(404).json({ message: 'User not found' });
  if (!canManageTargetUser(req.user, target.rows[0]))
    return res.status(403).json({ message: 'Cannot edit this user' });

  const { name, email, mobile_no, role, team_id, designation,
          department, employee_id, joining_date, notes } = req.body;

  // Validate role if changing
  if (role && !MANAGEABLE_ROLES.includes(role))
    return res.status(400).json({ message: 'Invalid role' });

  await pool.query(
    `UPDATE users SET
       name = COALESCE($1, name),
       email = COALESCE($2, email),
       mobile_no = COALESCE($3, mobile_no),
       role = COALESCE($4, role),
       team_id = COALESCE($5::int, team_id),
       designation = COALESCE($6, designation),
       department = COALESCE($7, department),
       employee_id = COALESCE($8, employee_id),
       joining_date = COALESCE($9::date, joining_date),
       notes = COALESCE($10, notes),
       updated_at = NOW()
     WHERE user_id = $11`,
    [name, email, mobile_no, role, team_id, designation,
     department, employee_id, joining_date, notes, id]
  );
  res.json({ success: true, message: 'User updated' });
};
```

**`exports.updateUserStatus`**
PATCH /api/auth/users/:id/status
Roles: admin only (for deactivate/block), manager (deactivate only, non-admin/manager)

Body: { status: 'active'|'inactive'|'blocked', reason? }

```javascript
exports.updateUserStatus = async (req, res) => {
  const { status, reason } = req.body;
  const VALID = ['active','inactive','blocked'];
  if (!VALID.includes(status))
    return res.status(400).json({ message: 'Invalid status' });

  const target = await pool.query('SELECT * FROM users WHERE user_id=$1',[req.params.id]);
  if (!target.rows.length) return res.status(404).json({ message: 'Not found' });
  if (!canManageTargetUser(req.user, target.rows[0]))
    return res.status(403).json({ message: 'Cannot modify this user' });

  await pool.query(
    `UPDATE users SET
       status = $1,
       active = ($1 = 'active'),
       deactivated_at = CASE WHEN $1 != 'active' THEN NOW() ELSE NULL END,
       deactivated_by = CASE WHEN $1 != 'active' THEN $2 ELSE NULL END,
       deactivation_reason = CASE WHEN $1 != 'active' THEN $3 ELSE NULL END
     WHERE user_id = $4`,
    [status, req.user.user_id, reason || null, req.params.id]
  );
  res.json({ success: true, status });
};
```

**`exports.resetUserPassword`**
POST /api/auth/users/:id/reset-password
Roles: admin only

Body: { new_password? } — if omitted, generates random 10-char password

```javascript
exports.resetUserPassword = async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin')
    return res.status(403).json({ message: 'Admin only' });

  const { new_password } = req.body;
  const plain = new_password || generatePassword(); // same func as portal
  const hash = await bcrypt.hash(plain, 10);

  await pool.query(
    'UPDATE users SET password = $1 WHERE user_id = $2',
    [hash, req.params.id]
  );
  res.json({ success: true, new_password: plain,
    message: 'Password reset. Share the new password with the user.' });
};
```

**Update `exports.getAllUsers`** to support:
- `?include_inactive=true` (admin only)
- `?role=sales` filter
- `?search=name/email` filter
- `?status=active|inactive|blocked` filter
- Pagination: `?page=1&limit=25`
- Returns: name, email, role, status, active, mobile_no, team_name,
  designation, department, last_login, created_at

### 4.2 Add routes to `backend/routes/auth.js`

```javascript
router.put('/users/:id',              authMiddleware, exports.updateUser);
router.patch('/users/:id/status',     authMiddleware, exports.updateUserStatus);
router.post('/users/:id/reset-password', authMiddleware, exports.resetUserPassword);
```

Also add `?include_inactive` support to GET /users route.

---

## SECTION 5 — FRONTEND: SETTINGS PAGES

### 5.1 New file: `frontend/src/pages/admin/settings/UserManagementPage.jsx`

Route: `/settings/users`
Section guard: `users`

**HEADER:**
Title "Users" | Subtitle "Manage CRM team members and their access"
Stats row: Total Users | Active | Inactive | Pending Approval
Right: [+ Add User] button (blue)

**FILTER BAR:**
Search (name, email) | Role dropdown (all roles) |
Status: All | Active | Inactive | Blocked |
Department dropdown | [Clear]

**TABLE:**
Columns: User | Role | Department | Team | Status | Last Login | Created | Actions

User cell: avatar (initials circle) + Name bold + Email gray
Role cell: RoleBadge component
Status cell:
  active → green dot "Active"
  inactive → gray dot "Inactive"
  blocked → red dot "Blocked"
  pending_approval → amber dot "Pending"
Last Login: relative time or "Never"
Actions: Edit (pencil) | Status toggle (power icon) | Reset Password (key icon)
  All 3 in icon buttons, gray, hover:blue

**ADD/EDIT USER DRAWER (slide-in, 520px):**
Sticky header: "Add User" or "Edit: [Name]"
Scrollable body:
  Section: Personal Info
    Full Name* | Email* | Phone/WhatsApp
    Profile Photo (optional file upload, shows initials if none)
  Section: Role & Access
    Role* (dropdown with descriptions)
      Each role shown as: [Role Badge] Name — Description
    Team (multi-select, shown for floor roles only)
    Department (text) | Designation (text)
    Employee ID | Joining Date
  Section: Password (Add mode only)
    Password* | Confirm Password*
    OR: [Generate secure password] toggle — auto-generates
  Section: Notes
    Notes (textarea, internal only)

Save → POST /api/auth/register (add) or PUT /api/auth/users/:id (edit)

**STATUS CHANGE MODAL:**
Title: "Deactivate [Name]" or "Block [Name]"
Reason*: textarea (required for deactivate/block)
[Cancel] [Confirm]
On confirm: PATCH /api/auth/users/:id/status

**RESET PASSWORD MODAL:**
"Reset password for [Name]"
Option A: [Generate Random Password] (default)
Option B: Enter new password (toggle)
[Cancel] [Reset Password]
On success: shows new password in modal with copy button
"Share this password with [Name]"

**DEACTIVATION BADGE on user row:**
When inactive/blocked: show reason tooltip on hover

### 5.2 Rebuild `frontend/src/pages/admin/settings/RolePermissionsPage.jsx`

The current page works but needs:
1. Grouped sections (using SECTION_GROUPS)
2. Role descriptions shown
3. "Apply defaults" button per role
4. Side-by-side comparison mode (optional, for admin)

**NEW LAYOUT:**

```
Title: "Role Permissions"
Subtitle: "Define what each role can access across all modules"

Left sidebar (240px):
  List of all roles as cards:
  [Role Badge] Role Name
  Description (1 line)
  Active users: N
  
  Click → loads that role's permissions on the right

Right panel (fills remaining):
  Selected role header: [Badge] Manager
  Description: "Approvals, reports, team oversight"
  Active users: 5 users
  
  [Apply Role Defaults] button (resets to migration defaults, with confirm dialog)
  [Save Changes] button (blue, sticky at bottom)
  
  Sections grouped by SECTION_GROUPS:
  
  ── LEAD & SALES CRM ──────────────────────────────
  Module                View  Create  Edit  Delete
  Leads                  ☑     ☑      ☑     □
  Follow-ups             ☑     ☑      ☑     □
  Lead Conversion        ☑     ☑      ☑     □
  Customers              ☑     ☑      ☑     □
  ...
  
  ── FLOOR & QUALITY ───────────────────────────────
  Floor Pipeline         ☑     ☑      ☑     □
  ...
  
  (each group is a collapsible accordion, expanded by default)
```

**Group header styling:**
  Section group header: text-xs uppercase tracking-widest font-semibold
  color-coded: Lead=blue, Floor=indigo, Finance=amber, Support=pink, etc.

**Checkbox behavior:**
  ☑ can_view: blue
  ☑ can_create: green
  ☑ can_edit: amber
  ☑ can_delete: red
  
  Rule: if can_create/edit/delete is checked, can_view auto-checks
  Rule: if can_view is unchecked, all others auto-uncheck

**Changes indicator:**
  Modified sections show amber "Modified" chip
  Save button shows count: "Save (12 changes)"

### 5.3 Update `frontend/src/pages/admin/settings/UserPermissionsPage.jsx`

Current page allows setting individual user overrides (above/below their role defaults).
Rename tab title to "User Permission Overrides" for clarity.

Add to the page:
  Info banner: "These are per-user overrides. A user's effective permissions =
  their role defaults + these overrides. Leave as 'Role Default' to inherit."

**Change the role filter** from just ['admin','technician','vendor'] to all roles:
  Replace USER_PERM_ROLES with all roles from the MANAGEABLE_ROLES list.

### 5.4 Update `frontend/src/routes/settingsRoutes.jsx`

Add user management route:
```javascript
import UserManagementPage from '../pages/admin/settings/UserManagementPage';

{ path: '/settings/users',
  element: guard('users', 'view', withLayout(<UserManagementPage />)) },
```

### 5.5 Update sidebar `frontend/src/config/menuConfig.js`

In the Settings section (bottom of sidebar), add Users Management:

```javascript
export const settingsAccordionChildren = [
  { label: 'Users',              path: '/settings/users',            section: 'users' },
  { label: 'Role Permissions',   path: '/settings/role-permissions', section: 'role_permissions' },
  { label: 'User Overrides',     path: '/settings/user-permissions', section: 'user_permissions' },
  { label: 'Teams',              path: '/settings/teams',            section: 'teams' },
  { label: 'Roles',              path: '/settings/roles',            section: 'roles' },
];
```

---

## SECTION 6 — ROLE QUICK REFERENCE CARD

Add a "Role Reference" page at `/settings/role-reference` (no guard needed for internal users):

Simple read-only table showing what each role can do at a glance:

```
Role            | Key Access Areas                               | Cannot Access
────────────────────────────────────────────────────────────────────────────────
Super Admin     | Everything                                     | —
Admin           | Everything except billing delete               | —
Manager         | Approvals, all views, reports, team mgmt       | Delete financial
Sales           | Leads, customers, quotations, SOs              | Floor, billing, vendors
Floor Manager   | All tickets, assign, floor dashboard           | Finance, sales, vendors
Technician      | Own tickets only, parts use                    | Most everything else
Senior Tech     | Team tickets, parts management                 | Finance, sales
QC Inspector    | QC1/QC2 stages only                            | Everything else
Procurement     | POs, GRN, vendor management, parts             | Sales, billing, floor
Warehouse       | GRN, inventory, DC attach                      | Sales, billing, finance
Dispatch        | DCs, delivery register, send                   | Sales, billing, floor
Accounts        | All billing, invoices, e-invoice               | Floor, sales, vendors
Support Lead    | All support tickets, team mgmt                 | Billing, floor, sales
Support Tech    | Own support tickets                            | Everything else
```

---

## SECTION 7 — BUILD ORDER

1. Run migration 072_phase10_user_role_management.sql
2. Add updateUser, updateUserStatus, resetUserPassword to authController.js
3. Update getAllUsers to support filters + pagination + include_inactive
4. Add 3 new routes to backend/routes/auth.js
5. Update frontend/src/constants/sections.js — full section list + SECTION_GROUPS
6. Update frontend/src/components/ui/RoleBadge.jsx — add all 14 roles with colors
7. Build frontend/src/pages/admin/settings/UserManagementPage.jsx
8. Rebuild frontend/src/pages/admin/settings/RolePermissionsPage.jsx with grouping
9. Update frontend/src/pages/admin/settings/UserPermissionsPage.jsx — all roles
10. Add /settings/users route to settingsRoutes.jsx
11. Update sidebar menuConfig.js — Settings accordion with Users
12. Update rbacApi.js — add updateUser, updateUserStatus, resetUserPassword

---

## SECTION 8 — QUALITY CHECKLIST

Database:
  [ ] Migration 072 runs clean
  [ ] All 14 roles in roles table
  [ ] All permission sections in permission_sections table
  [ ] Comprehensive default permissions for all 14 roles seeded

Backend:
  [ ] PUT /api/auth/users/:id — updates user fields
  [ ] PATCH /api/auth/users/:id/status — active/inactive/blocked with reason
  [ ] POST /api/auth/users/:id/reset-password — generates/sets password
  [ ] GET /api/auth/users — supports ?role, ?status, ?search, ?include_inactive, pagination
  [ ] canManageTargetUser: manager cannot edit admin/super_admin/other managers

Frontend — User Management:
  [ ] /settings/users loads all users with stats cards
  [ ] Search/filter by role, status, department works
  [ ] Add User drawer: all sections, role dropdown shows descriptions
  [ ] Role selection: shows team field for floor roles, hides for others
  [ ] Edit User drawer: pre-fills all existing data
  [ ] Status change (deactivate/block): requires reason, confirmation dialog
  [ ] Inactive users show in list (grayed out) with reason tooltip
  [ ] Reset password: shows generated password with copy button
  [ ] Only admin can block; manager can only deactivate non-admin

Frontend — Role Permissions:
  [ ] Left sidebar shows all 14 roles with description + user count
  [ ] Sections grouped under collapsible headers
  [ ] Section groups color-coded
  [ ] can_view auto-checks when any action is checked
  [ ] can_view uncheck auto-unchecks all other actions
  [ ] "Apply Defaults" resets to migration defaults with confirmation
  [ ] Save button shows change count
  [ ] Changes saved and refreshed correctly

Frontend — User Overrides:
  [ ] All roles shown in dropdown (not just admin/technician/vendor)
  [ ] Info banner explains override system

Sidebar:
  [ ] Settings accordion shows: Users | Role Permissions | User Overrides | Teams | Roles
  [ ] /settings/users accessible to admin, manager (role guard)

---

## SECTION 9 — ROLE COLOR REFERENCE

Update RoleBadge.jsx with these colors:

| Role | Background | Text |
|---|---|---|
| super_admin | bg-purple-100 | text-purple-700 |
| admin | bg-blue-100 | text-blue-700 |
| manager | bg-indigo-100 | text-indigo-700 |
| sales | bg-green-100 | text-green-700 |
| floor_manager | bg-orange-100 | text-orange-700 |
| team_member | bg-teal-100 | text-teal-700 |
| team_lead | bg-cyan-100 | text-cyan-700 |
| qc | bg-violet-100 | text-violet-700 |
| procurement | bg-amber-100 | text-amber-700 |
| warehouse | bg-lime-100 | text-lime-700 |
| dispatch | bg-sky-100 | text-sky-700 |
| accounts | bg-rose-100 | text-rose-700 |
| support_lead | bg-fuchsia-100 | text-fuchsia-700 |
| support_tech | bg-pink-100 | text-pink-700 |

---

End of Phase 10 prompt.
After Phase 10, the CRM is fully complete.
Remaining: production deployment guide.

# RENTFOXXY CRM — PHASE 6 BUILD PROMPT
## Support Module (CRM) + Customer Portal + Vendor Portal Enhancements
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- Extend existing code only. Do NOT rewrite working code.
- Support module backend already exists at `/api/support` with a comprehensive
  controller (`supportController.js`). Phase 6 is about:
  1. Wiring support into the main CRM sidebar + new design
  2. Building the customer portal (`customer-portal/` React app)
  3. Enhancing the vendor portal with Phase 5 billing data
- The existing support frontend lives at
  `frontend/src/components/support/` — these components exist and work.
  Phase 6 moves them into the proper feature folder structure and adds
  missing pieces.
- Customer portal does NOT exist yet — build from scratch at `customer-portal/`
- Vendor portal EXISTS at `vendor-portal/` — only enhance it with billing
  data from Phase 5 tables
- Naming:
  - Feature folder: `frontend/src/features/support-module/`
  - Customer portal: `customer-portal/` (root level, port 3002)
  - Permission sections: `support_tickets`, `support_settings`
    (already exist from earlier migrations — verify before inserting)
  - Support ticket types: `complaint`, `replacement`, `pickup`, `loan`
  - Support ticket statuses: `open`, `progress`, `replacement`,
    `closed`, `cancelled`
- Design system: same as all previous phases

---

## SECTION 1 — DATABASE MIGRATIONS

### Migration `068_phase6_support_customer_portal.sql`

```sql
-- Phase 6: Support module enhancements + customer portal sessions

-- 1. Customer portal sessions
CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  session_id  SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_customer
  ON customer_portal_sessions (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_expires
  ON customer_portal_sessions (expires_at);

-- 2. Add portal credentials to customers table
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_password_hash  TEXT,
  ADD COLUMN IF NOT EXISTS portal_last_login      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_enabled         BOOLEAN DEFAULT FALSE;

-- 3. Support ticket enhancements (link to TTSPL and DC)
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS ttspl_id        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dc_number       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sales_order_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS customer_portal_ticket BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS portal_customer_id INT REFERENCES customers(customer_id);

-- 4. Ensure permission sections exist for support
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('support_tickets',  'Support Ticket Management',  300),
  ('support_settings', 'Support Module Settings',    301)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- 5. Seed role permissions for support
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',   'support_tickets',  TRUE,TRUE,TRUE,TRUE),
  ('manager', 'support_tickets',  TRUE,TRUE,TRUE,FALSE),
  ('support', 'support_tickets',  TRUE,TRUE,TRUE,FALSE),
  ('sales',   'support_tickets',  TRUE,FALSE,FALSE,FALSE),
  ('accounts','support_tickets',  TRUE,FALSE,FALSE,FALSE),
  ('admin',   'support_settings', TRUE,TRUE,TRUE,TRUE),
  ('manager', 'support_settings', TRUE,FALSE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 2 — BACKEND: CUSTOMER PORTAL

### 2.1 Create `backend/controllers/customerPortalController.js`

Build this controller completely with these exported functions:

```
login          POST /api/customer-portal/login
  body: { email, password }
  Checks customers table WHERE email = ? AND portal_enabled = true
  Verifies bcryptjs password against portal_password_hash
  Creates customer_portal_sessions record with 24h expiry
  Returns: { token, customer: { customer_id, name, company_name, email } }

logout         POST /api/customer-portal/logout
  Deletes session from customer_portal_sessions
  Returns: { success: true }

me             GET  /api/customer-portal/me
  Returns customer profile from token
  Returns: { customer_id, name, company_name, email, phone, gst_no,
             billing_address, billing_city, billing_state, kyc_verified,
             portal_last_login }

listLaptops    GET  /api/customer-portal/laptops
  Returns all active rental/purchased laptops for this customer
  Query: delivery_challan_lines WHERE customer_id = ? AND status = 'delivered'
  Joined with vendor_serial_numbers for TTSPL ID and config
  Returns: [{ ttspl_id, brand, model, config, dispatch_date,
              monthly_rate, dc_number, status }]

listOrders     GET  /api/customer-portal/orders
  Returns sales orders for this customer
  Query: sales_order_lines grouped by sales_order_number
  Returns: [{ sales_order_number, date, type, laptops, total_value, status }]

listInvoices   GET  /api/customer-portal/invoices
  Returns customer_invoices WHERE customer_id = ?
  status filter: ?status=paid|sent|draft
  Returns: [{ invoice_number, month, year, grand_total, status,
              irn, qr_code_url, pdf_path, sent_at, paid_at }]

downloadInvoicePdf GET /api/customer-portal/invoices/:invoiceId/pdf
  Returns PDF file for the invoice
  Only for invoices belonging to this customer

listCreditNotes GET /api/customer-portal/credit-notes
  Returns customer_credit_notes WHERE customer_id = ?

listDeliveries  GET  /api/customer-portal/deliveries
  Returns delivery status for all their DCs:
  [{ dc_number, so_number, dispatch_date, dispatch_mode,
     status, delivered_at, awb_number, courier_name }]

raiseTicket    POST /api/customer-portal/tickets
  body: { subject, description, ticket_type, ttspl_id?, photos: [] }
  Creates support ticket linked to this customer
  Sets customer_portal_ticket = true
  Sets portal_customer_id = customer_id
  Returns: { ticket_id, ticket_number }

listTickets    GET  /api/customer-portal/tickets
  Returns support tickets raised by this customer
  Returns: [{ ticket_id, subject, type, status, created_at, updated_at }]
```

### 2.2 Create `backend/middleware/customerPortalAuth.js`

```javascript
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function customerPortalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.slice(7);

  try {
    // Check session exists and is not expired
    const sessionRes = await pool.query(
      `SELECT s.*, c.customer_id, c.name, c.company_name, c.email,
              c.portal_enabled
       FROM customer_portal_sessions s
       JOIN customers c ON c.customer_id = s.customer_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (!sessionRes.rows.length) {
      return res.status(401).json({ success: false, message: 'Session expired or invalid' });
    }

    const session = sessionRes.rows[0];
    if (!session.portal_enabled) {
      return res.status(403).json({ success: false, message: 'Portal access disabled' });
    }

    req.customer = {
      customer_id:  session.customer_id,
      name:         session.name,
      company_name: session.company_name,
      email:        session.email,
    };
    next();
  } catch (err) {
    console.error('customerPortalAuth:', err);
    res.status(500).json({ success: false, message: 'Auth error' });
  }
}

module.exports = { customerPortalAuth };
```

### 2.3 Create `backend/routes/customerPortal.js`

```javascript
const router = require('express').Router();
const ctrl = require('../controllers/customerPortalController');
const { customerPortalAuth } = require('../middleware/customerPortalAuth');

// Public
router.post('/login',  ctrl.login);
router.post('/logout', customerPortalAuth, ctrl.logout);

// Protected
router.use(customerPortalAuth);
router.get('/me',                  ctrl.me);
router.get('/laptops',             ctrl.listLaptops);
router.get('/orders',              ctrl.listOrders);
router.get('/invoices',            ctrl.listInvoices);
router.get('/invoices/:id/pdf',    ctrl.downloadInvoicePdf);
router.get('/credit-notes',        ctrl.listCreditNotes);
router.get('/deliveries',          ctrl.listDeliveries);
router.post('/tickets',            ctrl.raiseTicket);
router.get('/tickets',             ctrl.listTickets);

module.exports = router;
```

### 2.4 Mount in `backend/server.js`

Add:
```javascript
app.use('/api/customer-portal', require('./routes/customerPortal'));
```

### 2.5 Add customer portal access management to `customerManagementController.js`

Add these exports:

```
enableCustomerPortal   PATCH /api/customer-management/customers/:id/portal-access
  body: { enabled: boolean }
  If enabling for first time with no password set: generate random 10-char password,
  bcrypt hash it, save to portal_password_hash, return plain text password in response
  body: { reset_password: boolean } → same: generate new password, return it
  Updates portal_enabled = true/false
  Returns: { enabled, new_password? }
```

Add route to `backend/routes/customerManagement.js`:
```javascript
router.patch('/customers/:id/portal-access',
  checkRole('admin','manager'),
  ctrl.enableCustomerPortal
);
```

---

## SECTION 3 — FRONTEND: SUPPORT MODULE IN CRM

### 3.1 Move support into feature folder

The existing support components at `frontend/src/components/support/` work
but are not integrated into the new CRM sidebar properly.

Create `frontend/src/features/support-module/SupportModuleApp.jsx`:

```javascript
// Wrap the existing SupportShell component in the new routing
import { Routes, Route, Navigate } from 'react-router-dom';
import SupportShell from '../../components/support/SupportShell';
// SupportShell already handles its own internal routing
export default function SupportModuleApp() {
  return <SupportShell />;
}
```

Add route to `frontend/src/routes/index.jsx`:
```javascript
import SupportModuleApp from '../features/support-module/SupportModuleApp';

{
  path: '/support/*',
  element: (
    <ProtectedRoute section="support_tickets" action="view">
      <Layout><SupportModuleApp /></Layout>
    </ProtectedRoute>
  )
}
```

### 3.2 Add Support to sidebar in `frontend/src/config/menuConfig.js`

Add Support section AFTER Finance, BEFORE Reports:

```javascript
// Add to MENU_GROUPS:
{
  type: 'direct',
  label: 'Support',
  icon: HeadphonesIcon,   // from lucide-react: Headphones
  path: '/support',
  section: 'support_tickets',
  countKey: 'support_open'
}
```

The count badge shows open support tickets count.

Also add `support_open` to the counts API.
Update `backend/controllers/financeOverviewController.js` `getCounts`
OR create a separate `GET /api/support/nav-badges` endpoint
(which already exists: `getNavBadges` in supportController.js).

In the sidebar Layout component, fetch support count from
`GET /api/support/nav-badges` and use it for the Support sidebar badge.

### 3.3 Verify support creates tickets linked to TTSPL

In `supportController.js` `createTicket`, add handling for
`ttspl_id` and `dc_number` in the request body — save them to
the new columns added in migration 068 (if the ticket comes from
the customer portal, also set `customer_portal_ticket = true`).

This is a minor update — the existing create ticket logic is solid,
just add the 3 new fields to the INSERT.

---

## SECTION 4 — FRONTEND: CUSTOMER PORTAL (`customer-portal/`)

Build a complete React app at the root level `customer-portal/`.

### 4.1 Setup

```bash
# At repo root:
mkdir customer-portal
cd customer-portal
npx create-react-app . --template cra-template
npm install axios react-router-dom react-hot-toast lucide-react date-fns tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Structure:
```
customer-portal/
  package.json       (port 3002)
  tailwind.config.js (teal primary: #0D9488)
  src/
    App.jsx
    index.css
    context/
      AuthContext.jsx
    utils/
      api.js         (axios instance → /api/customer-portal)
    pages/
      LoginPage.jsx
      DashboardPage.jsx
      LaptopsPage.jsx
      OrdersPage.jsx
      InvoicesPage.jsx
      InvoiceDetailPage.jsx
      DeliveriesPage.jsx
      SupportPage.jsx
      ProfilePage.jsx
    components/
      Layout.jsx       (sidebar + header)
      ProtectedRoute.jsx
```

`package.json` proxy:
```json
"proxy": "http://localhost:5000"
```

Port 3002:
```json
"scripts": {
  "start": "PORT=3002 react-scripts start",
  ...
}
```

### 4.2 `context/AuthContext.jsx`

```javascript
// Stores: customer object + token
// login(email, password) → POST /api/customer-portal/login → store token in localStorage
// logout() → POST /api/customer-portal/logout → clear localStorage
// isAuthenticated: boolean
// loading: boolean (checking token on mount)
```

### 4.3 `utils/api.js`

```javascript
import axios from 'axios';

const api = axios.create({ baseURL: '/api/customer-portal' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('cp_token');
      localStorage.removeItem('cp_customer');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
```

### 4.4 `components/Layout.jsx`

Color scheme: Teal primary (`#0D9488`), white sidebar.

```
Header:
  Left: Rentfoxxy logo + "Customer Portal"
  Right: Customer company name + Logout button

Sidebar nav items:
  Dashboard          /dashboard
  My Laptops         /laptops
  Orders             /orders
  Invoices           /invoices
  Deliveries         /deliveries
  Support            /support
  Profile            /profile
```

Mobile-responsive: hamburger menu on < 768px.

### 4.5 `pages/LoginPage.jsx`

```
Full-page centered card with Rentfoxxy branding (teal).

Title: "Customer Portal"
Subtitle: "Access your rental details, invoices, and support"

Form:
  Email address*
  Password*
  [Login] button (teal, full width)

Error handling:
  "Invalid credentials" → show red error below form
  "Portal access disabled" → show "Contact Rentfoxxy to enable portal access"

No "Forgot password" link (password reset done by CRM admin).
Show: "Powered by Rentfoxxy" at bottom.
```

### 4.6 `pages/DashboardPage.jsx`

```
Header: "Welcome back, [Company Name]"

4 summary cards:
  Active Rentals     → count from /laptops
  Current Month Bill → latest invoice grand_total or ₹0 if no invoice
  Next Invoice Date  → "1st [next month]"
  Open Support Tickets → count from /tickets WHERE status != closed

Quick links row:
  [View Invoices] [Raise Support Ticket] [View Laptops]

Recent Activity (last 5 deliveries + support tickets):
  Each item: icon + description + date
  e.g. "💻 Dell i5 delivered on 10 Jun 2026"
       "🔧 Support ticket #T-123 opened"

Current invoice card (if sent/draft invoice exists for current month):
  Month | Amount | Status badge | [Download PDF] [View Details]
```

### 4.7 `pages/LaptopsPage.jsx`

```
Title: "My Laptops"
Subtitle: "[N] active rentals"

Grid of laptop cards (2 cols desktop, 1 col mobile):

Each card:
  ┌─────────────────────────────┐
  │ 💻 TTSPL001                 │
  │ Dell Latitude 3510           │
  │ i5 10th Gen | 8GB | 256 SSD │
  │ Dispatched: 10 Jun 2026      │
  │ Monthly Rate: ₹3,500/month   │
  │ DC: DC-0025                  │
  │ Status: [Active badge]       │
  │ [Raise Support Ticket]       │
  └─────────────────────────────┘

Clicking "Raise Support Ticket" on a laptop card:
  Pre-fills the TTSPL ID in the support ticket form
  Navigates to /support with ?ttspl=TTSPL001
```

### 4.8 `pages/OrdersPage.jsx`

```
Title: "My Orders"

Table:
  SO # | Date | Type | Laptops | Amount | Status

Clicking a row: expands to show line items (brand, config, qty)
Status badge: Pending / Processing / Completed
```

### 4.9 `pages/InvoicesPage.jsx`

```
Title: "My Invoices"

Filter tabs: All | Draft | Sent | Paid

Table:
  Invoice # | Month/Year | Period | Amount | GST | Total | Status | Actions

Actions per row:
  [Download PDF] → GET /api/customer-portal/invoices/:id/pdf
  [View Details] → navigate to /invoices/:id

Overdue invoices: red row highlight + "OVERDUE" badge

Summary bar at top:
  Total Paid (last 12 months) | Outstanding Amount | Next Invoice
```

### 4.10 `pages/InvoiceDetailPage.jsx`

```
Route: /invoices/:id

Header: Invoice number | Period | Status badge

Rentfoxxy invoice layout:
  From: Rentfoxxy Technologies Pvt Ltd
        [Address] | GSTIN: [company_gstin]
  To:   [Customer Company Name]
        [Billing Address] | GSTIN: [customer_gst]

Line items table:
  TTSPL ID | Brand | Config | Days | Daily Rate | Amount

Summary:
  Subtotal | GST 18% | Credit Adjustment | Total

E-Invoice section (if IRN exists):
  IRN: [value]
  QR Code: [image]

[Download PDF] button (full width, teal)
```

### 4.11 `pages/DeliveriesPage.jsx`

```
Title: "Delivery Status"

Table:
  DC # | SO # | Laptops | Dispatch Date | Mode | Status | Actions

Status badges:
  pending: gray | in_transit: amber | delivered: green | rejected: red

For in_transit: show courier name + AWB number + ETA
For delivered: show delivered date

No actions needed (read-only tracking view)
```

### 4.12 `pages/SupportPage.jsx`

```
Title: "Support"

Two sections:

Section 1: Raise a Ticket
  Form (always visible at top):
    Subject*: text input
    Issue Type*: dropdown
      Laptop Not Working | Display Issue | Keyboard Issue |
      Battery Issue | Software Issue | Replacement Request |
      Return Request | Other
    Which Laptop: dropdown (from /laptops list, shows TTSPL IDs)
      Pre-filled if ?ttspl= query param exists
    Description*: textarea (min 20 chars)
    Photos: file upload (optional, max 3 images)
    [Submit Ticket] button (teal)

Section 2: My Tickets
  Table:
    Ticket # | Subject | Laptop | Status | Created | Updated

  Status badges:
    open: blue | progress: amber | replacement: purple |
    closed: green | cancelled: gray

  Click row → shows ticket detail (expand inline or modal):
    Full description, all comments/updates,
    Resolution notes if closed
```

### 4.13 `pages/ProfilePage.jsx`

```
Title: "My Profile"

Read-only view of customer profile:
  Company Name | Contact Name | Email | Phone | WhatsApp
  GST Number | PAN Number
  Billing Address (full)
  Shipping Address (if different)

Change Password section:
  Current Password | New Password | Confirm Password
  [Update Password] → calls POST /api/customer-portal/change-password
  (Add this endpoint to customerPortalController.js)
```

### 4.14 Add `change-password` endpoint to `customerPortalController.js`

```
changePassword  POST /api/customer-portal/change-password
  body: { current_password, new_password }
  Verifies current_password against portal_password_hash
  Hashes new_password with bcryptjs (rounds: 10)
  Updates portal_password_hash in customers table
  Returns: { success: true }
```

Add route to `backend/routes/customerPortal.js`:
```javascript
router.post('/change-password', customerPortalAuth, ctrl.changePassword);
```

---

## SECTION 5 — VENDOR PORTAL ENHANCEMENTS

The vendor portal at `vendor-portal/` already has these pages:
Dashboard, Purchase Orders, PO Detail, My Laptops (Serials), Returns,
Bills, Profile.

Phase 5 built the `vendor_monthly_bills` and `vendor_debit_notes` tables.
The vendor portal `BillsPage.jsx` already queries these. Now enhance it.

### 5.1 Update `vendor-portal/src/pages/BillsPage.jsx`

Add a bill detail view (expandable row or modal):

```
When user clicks a bill row, show:
  Bill number | Month/Year | Period
  
  Line items table:
    TTSPL ID | Brand | Config | Received Date | Return Date | Days | Rate | Amount
  
  Summary:
    Subtotal | GST | Debit Note Adjustment | Total Payable
  
  Status: generated / approved / paid
  If paid: Payment Date + Reference

  [Download Bill PDF] button (calls backend PDF endpoint)
```

Add backend endpoint to `backend/controllers/vendorPortalController.js`:
```
getBillDetail  GET /api/vendor-portal/bills/:billId
  Returns full bill with line_items parsed from JSONB
  Validates bill belongs to this vendor
```

Add route to `backend/routes/vendorPortal.js`:
```javascript
router.get('/bills/:billId', authenticate, listVendorBillDetail);
```

### 5.2 Update `vendor-portal/src/pages/DashboardPage.jsx`

The dashboard currently shows `pending_bills: 0` hardcoded.
Fix to use real data from `vendor_monthly_bills`:

Update `dashboardStats` in `vendorPortalController.js`:
```javascript
// pending_bills = count WHERE vendor_id = ? AND status IN ('generated','approved')
// total_outstanding = SUM(total_payable) WHERE status NOT IN ('paid','cancelled')
// laptops_with_rentfoxxy = count of serial_numbers WHERE vendor_id = ? 
//   AND inventory_status NOT IN ('returned')
```

In `DashboardPage.jsx`, show:
- Active Laptops with Rentfoxxy (count)
- Pending Bills (count + total amount)
- Active POs (count)
- Total Outstanding (₹)

### 5.3 Update vendor portal navigation `Layout.jsx`

Add "Debit Notes" nav item (read-only view of debit notes raised against them):

```javascript
const nav = [
  { to: '/',              label: 'Dashboard',       icon: LayoutDashboard, end: true },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: FileText },
  { to: '/laptops',       label: 'My Laptops',      icon: Laptop },
  { to: '/returns',       label: 'Returns',          icon: RotateCcw },
  { to: '/bills',         label: 'My Bills',         icon: Receipt },
  { to: '/debit-notes',   label: 'Debit Notes',      icon: AlertCircle },
  { to: '/profile',       label: 'Profile',          icon: User },
];
```

### 5.4 Create `vendor-portal/src/pages/DebitNotesPage.jsx`

```
Title: "Debit Notes"
Subtitle: "Adjustments applied to your bills"

Table:
  DN # | Date | Related PO | Reason | Amount | Status | Bill Applied In

Status badge:
  pending: amber | approved: blue | adjusted: green | cancelled: red

Read-only — vendor cannot dispute here (disputes handled via support)

Empty state: "No debit notes raised against you."
```

Add backend endpoint:
In `vendorPortalController.js`:
```
listVendorDebitNotes  GET /api/vendor-portal/debit-notes
  Returns vendor_debit_notes WHERE vendor_id = ? ORDER BY created_at DESC
```

Add route in `vendorPortal.js`:
```javascript
router.get('/debit-notes', authenticate, listVendorDebitNotes);
```

---

## SECTION 6 — CRM: CUSTOMER PORTAL MANAGEMENT

In the CRM (internal), accounts/admin team needs to manage customer portal access.

### 6.1 Update `CustomerDetailPage.jsx` Portal Access tab

The Portal Access tab already exists but only shows a toggle.
Enhance it:

```
Portal Access Tab:

Status: [Enabled / Disabled] toggle

If Enabled:
  Last Login: [datetime or "Never"]
  
  [Reset Password] button
  → Calls PATCH /api/customer-management/customers/:id/portal-access
    with { reset_password: true }
  → Response includes new_password (plain text)
  → Show new_password in a modal with copy button:
    "New password: XXXXXX — Share this with the customer"
  
  [Disable Portal] button (red)

If Disabled:
  [Enable Portal Access] button (green)
  → Calls PATCH with { enabled: true }
  → If first time: response includes new_password
  → Show new_password in modal with copy button

Email credentials button:
  [Send Login Email] → sends email to customer with portal URL + their email
  Email template: "Your customer portal is now active. 
    URL: https://customer.rentfoxxy.com
    Email: [customer.email]
    Password: [new_password if just reset]"
  (Only show if portal just enabled or password just reset — don't show password in email unless fresh reset)
```

### 6.2 Add portal welcome email function

In `backend/services/emailQueueService.js` (or create a new template):
```javascript
async function sendCustomerPortalWelcome({ customerEmail, customerName,
  portalUrl, tempPassword }) {
  // Subject: "Your Rentfoxxy Customer Portal is Ready"
  // Body: Name, portal URL, email, temp password, "please change your password after first login"
}
```

---

## SECTION 7 — ROUTING & MENU UPDATES

### 7.1 Add support to sidebar `menuConfig.js`

Support was identified as missing from the sidebar in the screenshot.
Add it now:

```javascript
// Add to MENU_GROUPS after Finance, before Reports:
{
  type: 'direct',
  icon: Headphones,    // from lucide-react
  label: 'Support',
  path: '/support',
  section: 'support_tickets',
}
```

### 7.2 Routes already in place

The support route `/support/*` → `SupportModuleApp` wrapping `SupportShell`
should be added to the main routes file if not already there.

Check `frontend/src/routes/index.jsx` — if `/support` route doesn't exist,
add it. The SupportShell already handles its own sub-routing internally.

### 7.3 Customer portal `App.jsx` routes

```javascript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
// ... all pages

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard"   element={<DashboardPage />} />
                  <Route path="laptops"     element={<LaptopsPage />} />
                  <Route path="orders"      element={<OrdersPage />} />
                  <Route path="invoices"    element={<InvoicesPage />} />
                  <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                  <Route path="deliveries"  element={<DeliveriesPage />} />
                  <Route path="support"     element={<SupportPage />} />
                  <Route path="profile"     element={<ProfilePage />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

---

## SECTION 8 — ENV VARIABLES

Add to `backend/.env.example`:
```bash
CUSTOMER_PORTAL_URL=http://localhost:3002
# Production: https://customer.rentfoxxy.com
```

---

## SECTION 9 — BUILD ORDER

Build in this exact order:

1. Run migration `068_phase6_support_customer_portal.sql`
2. Create `backend/middleware/customerPortalAuth.js`
3. Create `backend/controllers/customerPortalController.js`
4. Create `backend/routes/customerPortal.js`
5. Add `enableCustomerPortal` to `backend/controllers/customerManagementController.js`
6. Add portal-access route to `backend/routes/customerManagement.js`
7. Update `backend/controllers/supportController.js` — add ttspl_id, dc_number fields to createTicket
8. Update `backend/server.js` — mount `/api/customer-portal`
9. Create `frontend/src/features/support-module/SupportModuleApp.jsx`
10. Add support route to `frontend/src/routes/index.jsx`
11. Add Support to sidebar in `frontend/src/config/menuConfig.js`
12. Update `CustomerDetailPage.jsx` Portal Access tab
13. Add `changePassword` to `customerPortalController.js`
14. Add customer-portal to `backend/routes/customerPortal.js`
15. Bootstrap `customer-portal/` React app
16. Build all customer portal pages (Login → Dashboard → Laptops →
    Orders → Invoices → Deliveries → Support → Profile)
17. Update `vendor-portal/` — BillsPage detail, Dashboard stats,
    DebitNotesPage, Layout nav
18. Add vendor portal backend endpoints (getBillDetail, listVendorDebitNotes,
    enhanced dashboardStats)

---

## SECTION 10 — QUALITY CHECKLIST

**Database:**
- [ ] Migration 068 runs clean
- [ ] `customer_portal_sessions` table created
- [ ] `portal_password_hash`, `portal_enabled`, `portal_last_login`
      added to customers table
- [ ] Support ticket new columns added (ttspl_id, dc_number, customer_portal_ticket)
- [ ] `support_tickets` and `support_settings` sections in Role Permissions

**Customer Portal Backend:**
- [ ] POST /api/customer-portal/login — verifies password, creates session
- [ ] GET /api/customer-portal/me — returns customer from token
- [ ] GET /api/customer-portal/laptops — returns active rental laptops
- [ ] GET /api/customer-portal/invoices — returns customer invoices
- [ ] GET /api/customer-portal/invoices/:id/pdf — returns PDF (only own invoices)
- [ ] POST /api/customer-portal/tickets — creates support ticket
- [ ] POST /api/customer-portal/change-password — updates hash
- [ ] Expired sessions rejected (401)
- [ ] Disabled portal rejected (403)

**CRM Updates:**
- [ ] Support appears in sidebar
- [ ] `/support` route renders existing SupportShell correctly
- [ ] Customer Detail → Portal Access tab shows enable/disable toggle
- [ ] Reset password returns new_password in modal with copy button
- [ ] Send Login Email works (if SMTP configured)

**Customer Portal Frontend:**
- [ ] Login page: invalid credentials shows error
- [ ] Login page: disabled portal shows correct message
- [ ] Dashboard: shows real counts (not hardcoded)
- [ ] Laptops page: shows TTSPL IDs, config, monthly rate
- [ ] Laptops page: "Raise Support Ticket" pre-fills TTSPL
- [ ] Invoices page: download PDF works
- [ ] Invoice detail: shows line items, IRN + QR if available
- [ ] Support page: raise ticket form submits and shows in ticket list
- [ ] Support page: pre-fills TTSPL from ?ttspl= query param
- [ ] Profile page: change password works
- [ ] Mobile responsive at 375px
- [ ] Logout clears localStorage and redirects to /login

**Vendor Portal Enhancements:**
- [ ] Bills page: click row shows bill detail with line items
- [ ] Dashboard: shows real counts from vendor_monthly_bills
- [ ] Debit Notes nav item appears
- [ ] DebitNotesPage shows vendor_debit_notes data
- [ ] All vendor portal pages still work (regression test)

---

## SECTION 11 — NAMING REFERENCE

| Concept | Correct | Wrong |
|---|---|---|
| Customer portal app | `customer-portal/` | customerPortal, customer_portal |
| Customer portal port | `3002` | 3001 (vendor), 3000 (CRM) |
| Auth header key | `cp_token` in localStorage | token, auth_token |
| Feature folder | `support-module` | support, supportModule |
| Portal auth middleware | `customerPortalAuth` | portalAuth, cpAuth |
| Portal route prefix | `/api/customer-portal` | /api/portal, /api/cp |
| Support ticket type | `complaint`/`replacement`/`pickup`/`loan` | issue, repair |
| Support ticket status | `open`/`progress`/`replacement`/`closed`/`cancelled` | active |
| Permission section | `support_tickets` | support, tickets |
| Vendor bill detail | `/api/vendor-portal/bills/:billId` | /bills/:id/detail |
| Debit notes endpoint | `/api/vendor-portal/debit-notes` | /debit_notes |

---

*End of Phase 6 prompt. Build Sections 1–8 in the order given in Section 9.*
*After completion, verify Section 10 checklist before moving to Phase 7 (Reporting).*
*Phase 7 will cover Manager Reports, Sales Reports, Technician Reports,
and the complete Analytics dashboard.*

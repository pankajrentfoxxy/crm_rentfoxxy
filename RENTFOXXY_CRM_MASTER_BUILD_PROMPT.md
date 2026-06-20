# RENTFOXXY CRM — COMPLETE BUILD PROMPT
### For Claude Code / Cursor — Full System Implementation

---

## READ THIS FIRST — RULES FOR THE AI AGENT

You are building a **production-grade CRM system** for two business lines:
- **Rentfoxxy** — B2B laptop rental company
- **gorefurbo** — laptop refurbishment and sales

This is an existing codebase on branch `revemp_backend`. You must **extend, not replace** existing working code unless explicitly told otherwise. Every feature must be complete — no stubs, no TODOs, no placeholder UI. Build as if this is going live tomorrow.

**Tech stack (do not change):**
- Backend: Node.js + Express, PostgreSQL (`pg` pool + Prisma), JWT auth, Nodemailer, PDFKit, Multer
- Frontend: React 18, React Router v6, Tailwind CSS, Axios, Lucide React icons, react-hot-toast
- New dependencies allowed: `node-cron` (billing scheduler), `qrcode` (e-invoice QR), `xlsx` (report exports), `date-fns` (date math), `react-select` (dropdowns), `recharts` (charts/analytics), `@react-pdf/renderer` (PDF previews)
- Three separate React apps: `frontend/` (CRM), `vendor-portal/` (new), `customer-portal/` (new)

---

## SECTION 1 — REPOSITORY CONTEXT

**Repo:** `https://github.com/pankajrentfoxxy/crm_rentfoxxy.git`
**Branch:** `revemp_backend`

### What already exists (DO NOT break these):
- `backend/server.js` — Express app, all route mounts, background service starts
- `backend/config/db.js` — PostgreSQL pool with SSL logic
- `backend/prisma/schema.prisma` — Prisma models: User, Lead, LeadActivity, LeadAssignment, LeadCompanyResearch, LeadOrder, Customer, Order, OrderItem, ProcurementRequest
- `backend/middleware/auth.js` — `authMiddleware`, `checkRole`, `checkPermission`, `checkRoleOrPermission`
- `backend/migrations/000–051_*.sql` — 52 migration files already applied
- `backend/controllers/vendorManagement/` — vendors, purchaseOrders, sparePartsOrders, serialNumbers, billing, replacedProducts
- `backend/controllers/salesManagementController.js` — quotations (EST-*), sales orders (SO-*), delivery challans (DC-*), return DC (RDC*)
- `backend/controllers/customerManagementController.js` — customer CRUD, portal auth
- `backend/services/salesManagementService.js` and `salesManagementPdfService.js`
- `backend/routes/salesManagement.js`, `vendorManagement.js`, `customerManagement.js`
- `backend/constants/leadStages.js` — lead status/stage definitions
- `frontend/src/` — existing React CRM with all current components

### Existing lead statuses (from `constants/leadStages.js`):
```
Statuses: Pending, Cold, Warm, Hot, Deal, Demo, Call Back, Hold, Gone, Rejected
Stages per status: Cold→[Proposal Shared, In Follow Up, Nurturing]
  Warm→[Price Agreed, Gst Shared, Price Negotiation]
  Hot→[Agreement Sent, Agreement Review, Asked For GST Challan]
  Gone→[Taken From Another Vendor, Plan Cancelled, Need New Laptops]
  Hold→[Plan On Hold]
  Rejected→[17 rejection reasons]
```

### Existing document number sequences (migration 042):
- `EST-` = Quotation, `SO-` = Sales Order, `DC-` = Delivery Challan, `RDC` = Return DC
- `TTSPL` prefix = internal laptop serial IDs (e.g. TTSPL002)

### Key existing DB tables:
`users`, `leads`, `lead_activities`, `lead_assignments`, `lead_company_research`, `lead_orders`, `customers`, `customer_addresses`, `orders`, `order_items`, `procurement_requests`, `vendors`, `vendor_purchase_orders`, `vendor_serial_numbers`, `vendor_shops`, `tickets`, `stages`, `teams`, `parts`, `inventory`, `sales_quotations`, `sales_order_lines`, `delivery_challan_lines`, `sm_document_sequences`, `sm_courier_details`, `delivery_technicians`, `role_permissions`, `user_permissions`, `permission_sections`

---

## SECTION 2 — COMPLETE BUSINESS LOGIC

### Business Model
Rentfoxxy rents refurbished laptops to B2B customers. gorefurbo sells/refurbishes them. Both run from the same CRM. Every laptop has a unique `TTSPL` ID tracking its entire life: procurement → refurbishment → QC → rental/sale → support → return.

### Three Applications
1. `crm.rentfoxxy.com` → `frontend/` (internal CRM, 11 user roles)
2. `vendor.rentfoxxy.com` → `vendor-portal/` (new React app)
3. `customer.rentfoxxy.com` → `customer-portal/` (new React app)

All three share the same backend API (`backend/`).

---

## SECTION 3 — DATABASE MIGRATIONS (create as `052_` onwards)

### Migration 052 — Vendor enhancements
```sql
-- Extend vendors table
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS vendor_portal_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS vendor_portal_last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_payment_terms VARCHAR(50) DEFAULT 'postpaid_monthly',
  ADD COLUMN IF NOT EXISTS credit_days INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS msme_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contact_person_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_person_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pincode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Vendor debit notes
CREATE TABLE IF NOT EXISTS vendor_debit_notes (
  debit_note_id SERIAL PRIMARY KEY,
  debit_note_number VARCHAR(50) NOT NULL UNIQUE,
  vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
  po_id INT REFERENCES vendor_purchase_orders(po_id),
  reason VARCHAR(255) NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INT DEFAULT 0,
  unit_rate NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','adjusted','cancelled')),
  adjusted_in_bill_id INT,
  created_by INT REFERENCES users(user_id),
  approved_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendor monthly bills
CREATE TABLE IF NOT EXISTS vendor_monthly_bills (
  bill_id SERIAL PRIMARY KEY,
  bill_number VARCHAR(50) NOT NULL UNIQUE,
  vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
  bill_month INT NOT NULL,
  bill_year INT NOT NULL,
  bill_date DATE NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  gst_amount NUMERIC(12,2) DEFAULT 0,
  debit_note_adjustment NUMERIC(12,2) DEFAULT 0,
  total_payable NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'generated' CHECK (status IN ('generated','approved','paid','disputed')),
  payment_date DATE,
  payment_reference VARCHAR(100),
  notes TEXT,
  generated_by INT REFERENCES users(user_id),
  approved_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_id, bill_month, bill_year)
);

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('vendor_bill', 0, 'VB-'), ('vendor_debit_note', 0, 'DN-')
ON CONFLICT (doc_type) DO NOTHING;
```

### Migration 053 — Customer billing engine
```sql
-- Customer monthly invoices
CREATE TABLE IF NOT EXISTS customer_invoices (
  invoice_id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  invoice_month INT NOT NULL,
  invoice_year INT NOT NULL,
  invoice_date DATE NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  gst_percent NUMERIC(5,2) DEFAULT 18,
  gst_amount NUMERIC(12,2) DEFAULT 0,
  credit_note_adjustment NUMERIC(12,2) DEFAULT 0,
  security_deposit NUMERIC(12,2) DEFAULT 0,
  grand_total NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  irn VARCHAR(100),
  irn_generated_at TIMESTAMPTZ,
  qr_code_url TEXT,
  eway_bill_number VARCHAR(50),
  eway_bill_generated_at TIMESTAMPTZ,
  eway_bill_valid_till TIMESTAMPTZ,
  pdf_path TEXT,
  sent_at TIMESTAMPTZ,
  sent_by INT REFERENCES users(user_id),
  paid_at TIMESTAMPTZ,
  payment_reference VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, invoice_month, invoice_year)
);

-- Customer credit notes
CREATE TABLE IF NOT EXISTS customer_credit_notes (
  credit_note_id SERIAL PRIMARY KEY,
  credit_note_number VARCHAR(50) NOT NULL UNIQUE,
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  invoice_id INT REFERENCES customer_invoices(invoice_id),
  reason VARCHAR(255) NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INT DEFAULT 0,
  unit_rate NUMERIC(12,2) DEFAULT 0,
  from_date DATE,
  to_date DATE,
  ttspl_ids JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','applied','cancelled')),
  applied_in_invoice_id INT REFERENCES customer_invoices(invoice_id),
  created_by INT REFERENCES users(user_id),
  approved_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Security deposits
CREATE TABLE IF NOT EXISTS customer_security_deposits (
  deposit_id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  order_id INT REFERENCES orders(order_id),
  amount NUMERIC(12,2) NOT NULL,
  received_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'held' CHECK (status IN ('held','partially_refunded','refunded','adjusted')),
  refund_amount NUMERIC(12,2) DEFAULT 0,
  refund_date DATE,
  refund_reference VARCHAR(100),
  notes TEXT,
  created_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('customer_invoice', 0, 'INV-'), ('credit_note', 0, 'CN-')
ON CONFLICT (doc_type) DO NOTHING;
```

### Migration 054 — Zoho GSP integration tracking
```sql
CREATE TABLE IF NOT EXISTS einvoice_records (
  record_id SERIAL PRIMARY KEY,
  dc_number VARCHAR(50) NOT NULL,
  customer_id INT REFERENCES customers(customer_id),
  invoice_number VARCHAR(50),
  irn VARCHAR(100) UNIQUE,
  ack_number VARCHAR(100),
  ack_date TIMESTAMPTZ,
  signed_invoice TEXT,
  signed_qr_code TEXT,
  qr_code_image_url TEXT,
  status VARCHAR(20) DEFAULT 'generated' CHECK (status IN ('generated','cancelled')),
  cancelled_at TIMESTAMPTZ,
  cancel_reason VARCHAR(255),
  zoho_response JSONB,
  generated_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eway_bill_records (
  record_id SERIAL PRIMARY KEY,
  dc_number VARCHAR(50) NOT NULL,
  ewb_number VARCHAR(50) UNIQUE,
  ewb_date TIMESTAMPTZ,
  valid_upto TIMESTAMPTZ,
  transporter_id VARCHAR(50),
  transporter_name VARCHAR(100),
  vehicle_number VARCHAR(20),
  mode_of_transport VARCHAR(20),
  distance_km INT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','extended','cancelled')),
  zoho_response JSONB,
  generated_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Migration 055 — Portal sessions
```sql
-- Vendor portal sessions
CREATE TABLE IF NOT EXISTS vendor_portal_sessions (
  session_id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer portal sessions
CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  session_id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer portal credentials (separate from CRM users)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS portal_last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT FALSE;
```

---

## SECTION 4 — BACKEND: NEW SERVICES & CONTROLLERS

### 4.1 Zoho GSP Service (`backend/services/zohoGspService.js`)

Build a complete service with these exported functions:

```javascript
// E-Invoice
async function generateEInvoice({ dcNumber, customerId, invoiceData })
// Returns: { irn, ackNumber, ackDate, signedQrCode, qrCodeImageUrl }

async function cancelEInvoice({ irn, cancelReason })

// E-Way Bill  
async function generateEWayBill({ dcNumber, transportDetails, distanceKm })
// Returns: { ewbNumber, ewbDate, validUpto }

async function extendEWayBill({ ewbNumber, vehicleNumber, extendReason })
async function cancelEWayBill({ ewbNumber, cancelReason })
```

**Zoho GSP API details:**
- Base URL: `https://gsp.zoho.com/in/einvoice/v1/` (sandbox: `https://gsp-sandbox.zoho.com/...`)
- Auth: OAuth2 with `client_id`, `client_secret` from env vars `ZOHO_GSP_CLIENT_ID`, `ZOHO_GSP_CLIENT_SECRET`
- GSTIN from env var `COMPANY_GSTIN`
- Token refresh: cache access token in memory, refresh when expired
- E-invoice payload must include: SellerDtls (our GSTIN/address), BuyerDtls (customer GSTIN/address), ItemList (HSN code, quantity, rate, GST %), ValDtls (total, tax breakdown)
- Store all responses in `einvoice_records` and `eway_bill_records` tables
- PDF generation: embed IRN + QR code image into existing DC PDF using PDFKit

**Env vars needed:**
```
ZOHO_GSP_CLIENT_ID=
ZOHO_GSP_CLIENT_SECRET=
ZOHO_GSP_USERNAME=
ZOHO_GSP_PASSWORD=
COMPANY_GSTIN=
COMPANY_NAME=Rentfoxxy Technologies Pvt Ltd
COMPANY_ADDRESS=
COMPANY_STATE_CODE=
ZOHO_GSP_SANDBOX=true  # set false for production
```

### 4.2 Billing Scheduler (`backend/services/billingSchedulerService.js`)

```javascript
const cron = require('node-cron');

// Runs at 00:01 on 1st of every month
// For each active customer with rental laptops:
//   1. Query all order_items WHERE status='Dispatched' and order type='Rental'
//   2. Calculate: units × days × daily_rate (prorated for mid-month additions)
//   3. Subtract any approved credit notes not yet applied
//   4. Generate customer_invoices record with status='draft'
//   5. Log in console: "Generated invoice INV-XXXX for customer YYYY"
// Does NOT send emails — accounts team triggers send manually

// Runs at 23:59 on last day of every month  
// For each vendor with active Rental/Rent-to-Own POs:
//   1. Query vendor_serial_numbers WHERE status='dispatched' or 'received'
//   2. Calculate per-unit: from MAX(received_date, month_start) to MIN(return_date, month_end)
//   3. Apply approved debit notes
//   4. Generate vendor_monthly_bills record with status='generated'

function startBillingScheduler() { ... }
module.exports = { startBillingScheduler };
```

### 4.3 Vendor Portal Auth (`backend/routes/vendorPortal.js`)

```
POST /api/vendor-portal/login      — email + password → JWT (24h)
POST /api/vendor-portal/logout
GET  /api/vendor-portal/me         — own vendor profile
GET  /api/vendor-portal/purchase-orders        — their POs
GET  /api/vendor-portal/purchase-orders/:poId  — PO detail with serial numbers
POST /api/vendor-portal/purchase-orders/:poId/accept   — vendor accepts PO
POST /api/vendor-portal/purchase-orders/:poId/reject   — vendor rejects PO
GET  /api/vendor-portal/serial-numbers          — all their TTSPL serials, config, status
GET  /api/vendor-portal/returns                 — DCs returned to them (RDC)
GET  /api/vendor-portal/bills                   — their monthly bills
GET  /api/vendor-portal/bills/:billId           — bill detail with line items
GET  /api/vendor-portal/debit-notes            — debit notes raised against them
POST /api/vendor-portal/bills/:billId/upload-invoice — vendor uploads their invoice PDF
```

### 4.4 Customer Portal Auth (`backend/routes/customerPortal.js`)

```
POST /api/customer-portal/login      — email + password → JWT (24h)
POST /api/customer-portal/logout
GET  /api/customer-portal/me         — own customer profile
GET  /api/customer-portal/laptops    — their active rental/purchased laptops with TTSPL IDs and config
GET  /api/customer-portal/orders     — order history (rental + sales)
GET  /api/customer-portal/invoices   — all invoices
GET  /api/customer-portal/invoices/:invoiceId — invoice detail + download PDF
GET  /api/customer-portal/credit-notes
GET  /api/customer-portal/deliveries — delivery tracking by order
POST /api/customer-portal/support-tickets — raise support ticket
GET  /api/customer-portal/support-tickets — their tickets
```

### 4.5 Customer Billing Controller (`backend/controllers/customerBillingController.js`)

```
GET  /api/customer-billing/invoices              — list all customer invoices (accounts team)
GET  /api/customer-billing/invoices/:id          — invoice detail
POST /api/customer-billing/invoices/generate     — manual invoice generation for one customer
POST /api/customer-billing/invoices/:id/send     — send invoice email to customer + CC
POST /api/customer-billing/invoices/:id/generate-einvoice  — call Zoho GSP, store IRN
POST /api/customer-billing/invoices/:id/generate-ewb      — generate e-way bill if needed
GET  /api/customer-billing/credit-notes          — list credit notes
POST /api/customer-billing/credit-notes          — create credit note
PATCH /api/customer-billing/credit-notes/:id/approve
POST /api/customer-billing/security-deposits     — record security received
PATCH /api/customer-billing/security-deposits/:id/refund
```

### 4.6 Vendor Billing Controller (`backend/controllers/vendorBillingController.js`)

```
GET  /api/vendor-billing/monthly-bills           — list vendor bills
GET  /api/vendor-billing/monthly-bills/:id       — bill detail
POST /api/vendor-billing/monthly-bills/generate  — manually generate for one vendor+month
PATCH /api/vendor-billing/monthly-bills/:id/approve
PATCH /api/vendor-billing/monthly-bills/:id/mark-paid — record payment
GET  /api/vendor-billing/debit-notes             — list debit notes
POST /api/vendor-billing/debit-notes             — create debit note
PATCH /api/vendor-billing/debit-notes/:id/approve
```

---

## SECTION 5 — FRONTEND: CRM (`frontend/src/`)

### Design System Rules (apply everywhere)
- **Colors:** Primary blue `#2563EB`, success green `#16A34A`, warning amber `#D97706`, danger red `#DC2626`, neutral grays
- **Sidebar:** Fixed left sidebar, 240px wide, collapsible to 60px (icon-only mode)
- **Typography:** Inter font, sidebar items 13px, page titles 20px bold, table headers 12px uppercase gray
- **Cards:** White bg, `rounded-xl`, `shadow-sm`, `border border-gray-100`
- **Tables:** Zebra striping (`bg-gray-50` on odd rows), sticky headers, row hover highlight
- **Buttons:** Primary = blue filled, Secondary = white with border, Danger = red filled, all `rounded-lg`
- **Status badges:** Pill shape, color-coded, e.g. `bg-green-100 text-green-700`
- **Empty states:** Centered icon + message + CTA button
- **Loading:** Skeleton loaders (not spinners) for tables and cards
- **Forms:** Label above input, red asterisk for required, inline validation errors
- **Modals:** Centered overlay, max-w-2xl for forms, backdrop blur
- **Toasts:** react-hot-toast, top-right, 4.5s duration

### 5.1 App Shell & Navigation (`src/components/Layout/`)

**Sidebar sections by role** (show only what the user's role can access):

```
DASHBOARD
  • Dashboard (all roles)

PROCUREMENT & VENDORS
  • Vendors
  • Purchase Orders
  • Goods Received (GRN)
  • Vendor Billing
  • Debit Notes

FLOOR & QUALITY
  • Floor Tickets
  • QC Management
  • Chip Level Repair
  • Parts & Inventory

INVENTORY
  • Stock Management
  • Inventory Movements

SALES & LEADS
  • Leads Pipeline
  • Customers
  • Quotations
  • Sales Orders
  • Delivery Challans
  • Delivery Register

OPERATIONS
  • Warehouse
  • Dispatch

FINANCE
  • Customer Billing
  • Credit Notes
  • Security Deposits
  • E-Invoice / E-Way Bill

SUPPORT
  • Support Tickets

SETTINGS (admin/super_admin only)
  • Team Management
  • User Management
  • Roles & Permissions
  • System Settings
```

### 5.2 Dashboard (`src/components/Dashboard/`)

Build role-specific dashboards. Everyone sees a dashboard but the widgets differ:

**Super Admin / Manager Dashboard:**
- KPI row: Total active rentals | Monthly revenue (current month) | Open leads | Pending QC tickets | Overdue invoices
- Revenue chart: Line chart (last 6 months, Rentfoxxy vs gorefurbo)
- Lead funnel: Horizontal bar chart by stage
- Inventory health: Pie chart (QC Passed Available | Rented | Sold | In QC | In Repair)
- Recent activities feed (last 20 system events)
- Alerts section: Overdue invoices | POs pending approval | Bills awaiting payment

**Sales Dashboard:**
- My leads by status (kanban-style count cards)
- My follow-ups today + this week
- My quotations: pending / approved / rejected
- Monthly target vs achieved (simple progress bar)

**Warehouse / Floor Dashboard:**
- Tickets assigned to team (count by stage)
- GRN pending QC tickets
- Inventory received today

**Accounts Dashboard:**
- Invoices draft (not sent): count + total value
- Invoices sent but unpaid: count + total value + oldest overdue
- Vendor bills to approve this month
- E-invoice queue (DCs without IRN)

### 5.3 Vendor Module (`src/components/Vendors/`)

#### VendorList.jsx
- Search bar (name, GSTIN, phone)
- Filter: status (approved/pending/suspended)
- Table columns: Vendor ID | Business Name | Contact | GSTIN | PAN | City | State | Active POs | Status | Actions
- Actions: View | Edit | Create PO | Manage Portal Access
- Add Vendor button → opens VendorForm modal

#### VendorForm.jsx (Add/Edit modal)
**All fields:**
```
Section: Business Details
  - Business Name* | First Name* | Last Name | Business Type* (dropdown: Proprietorship/Partnership/Pvt Ltd/LLP)
  - GSTIN* | PAN Number | MSME Number
  - Registration Date* | State* | City | Pincode
  - Address* | Notes

Section: Contact Details
  - Primary Email* | Phone* | Alternate Phone
  - Contact Person Name | Contact Person Phone

Section: Bank Details
  - Bank Name* | Account Number* | IFSC Code* | Account Holder Name*

Section: PO Settings
  - PO Payment Terms (postpaid_monthly / net30 / net15 / advance)
  - Credit Days (number)

Section: Documents (file upload)
  - Logo | Business License | GST Certificate
```

#### VendorDetail.jsx
- Tabs: Overview | Purchase Orders | Serials | Bills | Debit Notes | Portal Access
- Overview: all fields + edit button
- Portal Access tab: toggle portal on/off, reset password, last login timestamp

### 5.4 Purchase Orders (`src/components/PurchaseOrders/`)

#### POList.jsx
- Tabs: All | Draft | Pending Approval | Approved | Sent | GRN Pending | Completed
- Table: PO Number | Date | Vendor | Type | Laptops | Amount | Status | Actions
- PO Type badge: color-coded (Rent-to-Own = purple, Direct = blue, Rental = teal)
- Filter by vendor, date range, type

#### POForm.jsx (Create PO)
**PO Types:**
- **Direct Purchase**: One-time buy, invoice on GRN
- **Rental Purchase**: Ongoing rental from vendor, postpaid monthly billing
- **Rent-to-Own**: Fixed tenure (months), monthly rent → ownership at end

**Form sections:**
```
PO Details:
  - PO Type* (dropdown with description of each type)
  - Vendor* (searchable dropdown with GSTIN autofill)
  - PO Date* | Expected Delivery Date
  - PO State (company branch state for GST)
  - Remarks/Terms

Line Items (dynamic add/remove rows):
  - Brand | Model | Processor | Generation | RAM | Storage | GPU | Screen Size
  - Quantity* | Unit Rate* | GST %
  - [For Rental/Rent-to-Own]: Monthly Rental Amount | Tenure (months) | Rental Start Date

For Rent-to-Own:
  - Total tenure months | Ownership transfer date (auto-calculated)
  - Total rental amount = monthly × months (shown)

Financial Summary:
  - Subtotal | GST Amount | Grand Total (auto-calculated)
```

**Manager Approval Flow:**
- PO saved as `draft` by procurement team
- Manager sees notification badge in sidebar
- Manager approval page: shows PO details + `Approve` (green) + `Reject` (red with reason field)
- On approve: status → `approved`, auto-email to vendor's registered email with PDF attachment
- Email subject: `Purchase Order [PO-XXXX] from Rentfoxxy — Action Required`

#### GRNForm.jsx (Goods Received Note)
Triggered from PO detail page. For each line item in the PO:
```
Per laptop being received:
  - Serial Number (vendor's serial)*
  - TTSPL ID: auto-generated (TTSPL + 3-digit sequence, e.g. TTSPL123) — shown, not editable
  - Brand | Processor | Generation | RAM | Storage (pre-filled from PO, editable)
  - GPU | Screen Size | OS (Windows/Ubuntu/None)
  - Condition on arrival (Good/Minor scratches/Major damage/Functional issue)
  - Notes

Bill Status:
  - Radio: "Bill received" (upload PDF/image) OR "Bill pending" (system shows BILL PENDING badge)
  - If pending: warehouse can upload bill later from GRN record

On submit:
  - Creates vendor_serial_numbers records with TTSPL IDs
  - Creates QC ticket automatically (ticket_type='GRN_QC', linked to vendor_serial_id)
  - Shows success with list of TTSPL IDs generated
```

### 5.5 Floor & QC (`src/components/Floor/`)

#### FloorTicketList.jsx
- View: Kanban board (stages as columns) OR Table view (toggle)
- Kanban columns: Assigned | Diagnosing | Assembly & Software | Final Testing | Chip Repair | Body & Paint | QC1 | QC2 | Completed | Failed
- Each card: TTSPL ID | Brand+Config | Assigned technician | Stage duration | Priority badge
- Priority: `Sales Order` (red), `GRN QC` (blue), `Normal` (gray)
- Filter: assigned to me | my team | all | by priority | by stage
- Floor Manager view: sees all tickets, can reassign, can mark QC Failed

#### TicketDetail.jsx (most complex component)
**Tabs:**
1. **Overview**: TTSPL ID | Current stage | Assigned tech | Created date | Priority | Linked PO/SO number
2. **Stage Timeline**: Visual timeline showing every stage with entry time, exit time, duration, technician name
3. **Diagnosis**: Form fields — Issue found (multi-select: None/Display/Battery/Keyboard/Trackpad/Hinge/Motherboard/Storage/RAM/Charging/Software/OS/Cosmetic), Detailed notes, Photos upload
4. **Work Log**: Chronological feed of all work done. Each entry: datetime | tech name | stage | action taken | parts used
5. **Parts Used**: Table of parts attached: Part Name | Part Number | Quantity | Unit Cost | Total Cost | Added by
6. **Config History**: Track every config change — before/after table (RAM 8GB→16GB, Storage 256→512, etc.)
7. **QC Checklist** (QC1 + QC2):
   ```
   Hardware Checks:
   □ Display working, no dead pixels
   □ Keyboard all keys functional
   □ Trackpad responsive
   □ All USB ports working
   □ HDMI/display port working
   □ Audio jack working
   □ Camera working
   □ Battery charging + holds charge
   □ RAM verified (matches config)
   □ Storage verified (matches config)
   □ Processor verified
   □ WiFi + Bluetooth working
   □ Hinge smooth, no damage
   □ Body condition (pass/acceptable/fail)
   
   Software Checks:
   □ OS installed and activated
   □ All drivers installed
   □ No viruses/malware (scan result)
   □ Benchmark score (enter score)
   □ Battery health % (enter %)
   ```
8. **Actions panel** (role-based):
   - Technician: Move stage forward | Add parts | Log issue | Mark chip repair | Mark body & paint
   - QC Tech: Pass / Fail with mandatory reason on fail
   - Floor Manager: Reassign | Mark QC Failed (return to vendor) | Override stage

**Stage transition rules (enforce in both backend + frontend):**
```
Assigned → Diagnosing (technician starts work)
Diagnosing → Assembly & Software (or → Chip Repair if chip issue found, or → Body & Paint if cosmetic)
Chip Repair → Assembly & Software (after chip repair done)
Body & Paint → Assembly & Software
Assembly & Software → Final Testing
Final Testing → QC1
QC1 Pass → QC2
QC1 Fail → back to Assembly & Software (HIGHLIGHTED - show "QC1 Failed" banner, email tech)
QC2 Pass → Inventory Ready (TTSPL status set to 'qc_passed', available for orders)
QC2 Fail → back to QC1 (HIGHLIGHTED - show "QC2 Failed" banner)
Floor Manager Force Fail → status='qc_failed_return_vendor', triggers return DC flow
```

#### PartsRequest.jsx
When technician marks parts needed:
- Search available parts (from `parts` inventory table)
- If available: select and attach to ticket, quantity deducted from parts inventory
- If not available: raise procurement request (creates `procurement_requests` record linked to ticket)

### 5.6 Inventory (`src/components/Inventory/`)

#### StockManagement.jsx
- Summary cards: Total stock | QC Passed Available | Currently Rented | Sold | In Repair | In QC
- Table: TTSPL ID | Brand | Config (Processor/RAM/Storage) | Condition | Status | Location | Last activity | Actions
- Status filters: all | available | rented | sold | in_qc | in_repair | qc_failed
- Bulk tag: select multiple → mark as Rental stock / Sales stock
- Export to Excel button
- Search by TTSPL ID, serial number, brand, config
- Click row → drawer/modal showing full TTSPL history

#### TTSPL History Drawer
Full life-of-laptop timeline:
```
[icon] Received from Vendor ABC on GRN on 15 Jun 2025 (PO-0012, Rental Purchase)
[icon] QC Ticket created — assigned to Ravi Kumar
[icon] Diagnosed: RAM issue found
[icon] Parts used: RAM 8GB DDR4 × 1 (₹1,200)
[icon] QC1 Passed — Priya Sharma — 17 Jun 2025
[icon] QC2 Passed — QC Manager — 17 Jun 2025
[icon] Marked as Rental stock
[icon] Dispatched on DC-0025 to Customer: TechCorp Pvt Ltd — 20 Jun 2025
[icon] Support ticket raised — keyboard issue — 15 Jul 2025
[icon] Replacement done — returned to warehouse — 20 Jul 2025
```

### 5.7 Lead CRM (`src/components/Leads/`)

#### LeadList.jsx
- Toggle: Kanban view (by status) | Table view
- Table columns: Lead ID | Company | Contact | Phone | Config Required | City | Source | Status | Stage | Assigned To | Last Activity | Follow-up Date | Actions
- Filters: status | assigned to | source | city | date range | follow-up due
- Bulk actions: reassign | export CSV | change status
- Import leads from CSV button
- Add Lead button

#### LeadForm.jsx (Add/Edit — comprehensive)
**Section 1: Basic Info**
```
Company Name* | Brand (company brand, e.g. Tata, Infosys)
Lead Name* | Designation | Email | Phone | WhatsApp Number
City* | State | Source* (Email/Walk-in/Reference/Website/Cold Call/LinkedIn/Other)
```

**Section 2: Requirement**
```
Laptop Brand Preference* (Dell/HP/Lenovo/Apple/Any)
Processor Required* | Generation | RAM | Storage
Quantity Required* | Estimated Monthly Budget (per laptop)
Rental Duration Required (months) | OR Sales inquiry
Use Case (Work From Office / Work From Home / Both)
```

**Section 3: Company Details**
```
Company Type (Pvt Ltd / LLP / Proprietorship / Partnership / Startup / Other)
GST Number | PAN Number
Company Size (employees) | Industry
Annual Revenue (estimated)
```

**Section 4: CRM Fields**
```
Status* (dropdown: Pending/Cold/Warm/Hot/Deal/Demo/Call Back/Hold/Gone/Rejected)
Stage (conditional sub-stages based on status)
Assigned To (user dropdown)
Follow-up Date | Follow-up Time
Personal Remarks (rich text)
```

**Section 5: Address**
```
Billing Address (street, city, state, pincode)
Is shipping same as billing? (toggle)
Shipping Address
```

#### LeadDetail.jsx
- Split layout: Left 60% (activity feed + forms) | Right 40% (lead info sidebar)
- Activity feed: chronological with filters (calls/emails/notes/status changes)
- Quick actions bar: Call | Email | WhatsApp | Add Note | Schedule Follow-up | Convert to Customer
- Status change: inline dropdown with stage picker, remarks field
- Quotation button: opens quotation builder
- Convert to Deal: fills customer form pre-populated from lead data

#### FollowUpView.jsx
- Calendar view (monthly) showing follow-up dots per day
- Today's follow-ups highlighted
- Overdue follow-ups (red badges)
- Quick update: mark done, reschedule, add note

### 5.8 Sales Pipeline (`src/components/Sales/`)

#### QuotationList.jsx + QuotationForm.jsx
- List: Quote Number | Customer | Items | Total | Type | Status | Created | Actions
- Form: Customer search → autofill GST/address | Line items (same fields as lead requirements) | Rate per unit | Lock-in period | Warranty terms | Remarks
- Preview button: renders quotation PDF preview in modal
- Send button: email with PDF attachment, CC field (add multiple emails)
- Status flow: Draft → Sent → Approved (by customer) / Rejected

#### SalesOrderList.jsx + SalesOrderForm.jsx  
- Create from quotation (auto-populate) OR blank form
- Fields: Customer | Items | Delivery address | Payment terms | Notes
- Security deposit section: amount | due date
- Attach to existing quotation or mark "without quotation"

#### DeliveryChallanList.jsx + DCForm.jsx
- Create DC from Sales Order
- Laptop attachment: search QC-passed laptops matching order specs, assign TTSPL IDs to each line
- **Validation**: Cannot submit DC if any attached laptop is NOT in `qc_passed` status → show error
- Dispatch mode: Courier | Porter | Inhouse Technician
  - Courier: Courier partner name | AWB number | Estimated delivery date
  - Porter: Booking ID | Estimated delivery
  - Inhouse: Select technician from delivery_technicians table
- E-invoice button (post-creation): `Generate E-Invoice` → calls Zoho GSP → shows IRN on DC
- E-way bill button: `Generate E-Way Bill` (if applicable) → shows EWB number + validity
- Send E-Invoice button: email to customer with PDF attachment
- Print DC button: PDFKit-generated DC document

### 5.9 Delivery Register (`src/components/DeliveryRegister/`)

**Inhouse Technician Bucket (also in tech mobile view):**
- Assigned deliveries list for logged-in technician
- Each delivery: Customer name | Address | Laptops | DC number | Status
- Actions:
  - `Mark En Route`: updates status + prompts location capture
  - `Send OTP`: triggers OTP SMS/email to customer
  - `Verify OTP + Mark Delivered`: OTP input → confirm → delivery complete
  - `Mark Rejected`: reason field → returns to warehouse bucket
- GPS location captured on each status update (stored as lat/lng on DC line)

### 5.10 Customer Billing (`src/components/CustomerBilling/`)

#### InvoiceList.jsx
- Filter by customer | month | status
- Summary row: total invoiced | total collected | total outstanding
- Actions per invoice: View | Download PDF | Send to Customer | Generate E-Invoice | Generate E-Way Bill | Mark Paid

#### InvoiceDetail.jsx
```
Invoice Header: Customer name | GST | Address | Invoice number | Date | Month covered
Line Items table:
  TTSPL ID | Brand | Config | Dispatch Date | Days in month | Daily Rate | Amount
  (for new mid-month units: shows pro-rata calculation)
  
Summary:
  Subtotal
  GST 18%: ₹XXX
  Credit Note adjustment (if any): -₹XXX  [CN-001: Returned laptop TTSPL045]
  Grand Total: ₹XXX

Payment Status + record payment button
IRN number (if generated) + QR code image
E-Way Bill number (if generated)
```

#### CreditNoteForm.jsx
```
Customer | Related Invoice (optional) | Reason* | Description
TTSPL IDs involved (multi-select from customer's active laptops)
From Date | To Date (period of return)
Amount (auto-calculated if dates + rate provided, or manual override)
```

### 5.11 Vendor Billing (`src/components/VendorBilling/`)

#### VendorBillList.jsx
- Filter by vendor | month | status
- Per bill: Vendor | Month | Units | Subtotal | Debit adjustments | Payable | Status | Actions
- Actions: View Detail | Approve | Mark Paid | Download

#### VendorBillDetail.jsx
Line items per unit:
```
TTSPL ID | Brand | Config | GRN Date | Return Date (if returned) | Days | Rate | Amount
Debit note adjustments listed below
Total Payable
```

#### DebitNoteForm.jsx
```
Vendor | Related PO | Reason* | Description
Number of faulty units | Unit rate | Total amount
TTSPL IDs of affected units (multi-select)
```

### 5.12 Finance Overview (`src/components/Finance/`)

Single page for Accounts team:
- Tabs: Customer Invoices | Vendor Bills | Credit Notes | Debit Notes | Security Deposits | E-Invoice Queue
- E-Invoice Queue: all DCs without IRN → bulk generate button
- Security deposits table: customer | amount | date received | status (held/refunded)

### 5.13 Settings (`src/components/Settings/`)

#### UserManagement.jsx
- Table: Name | Email | Role | Team | Status | Last Login | Actions
- Add user form: Name | Email | Role | Team | Password (auto-generate toggle)
- Roles with descriptions
- Activate/Deactivate toggle

#### RolePermissions.jsx  
Matrix view:
- Rows: all permission_sections (modules)
- Columns: each role (manager/sales/warehouse/qc_tech/floor_tech/dispatch/accounts/support)
- Checkboxes: View | Create | Edit | Delete
- Save changes button

#### TeamManagement.jsx
- Teams list with members
- Create team | Assign users to team

---

## SECTION 6 — VENDOR PORTAL (`vendor-portal/`)

### Setup
Create new React app at root level: `vendor-portal/`
- Same Tailwind config, different color scheme (green primary `#059669`)
- Minimal sidebar: Dashboard | Purchase Orders | My Laptops | Returns | Bills | Profile
- Mobile-responsive (vendors may use phones)

### Pages:

**Login**: Email + Password form, forgot password link

**Dashboard**: 
- Active POs count | Laptops currently with Rentfoxxy | Pending bills | Overdue amount
- Recent activity feed

**Purchase Orders**:
- List with status badges
- Detail: full PO with line items, accept/reject buttons (only if status=sent)
- PDF download of PO

**My Laptops** (vendor_serial_numbers):
- Table: TTSPL ID | Serial Number | Config | GRN Date | Current Status | Return Date
- Status: At Rentfoxxy / Returned / In QC / Faulty
- Filter by status, date

**Returns**:
- DC/RDC documents where laptops were returned to this vendor
- Each: RDC number | Date | Reason | Laptops returned | Acknowledgment

**Bills** (vendor_monthly_bills):
- Month | Period | Units | Amount | Status | Download
- Detail page with full line items
- Upload invoice button (vendor uploads their own invoice PDF for payment processing)

**Profile**: view/edit contact details

---

## SECTION 7 — CUSTOMER PORTAL (`customer-portal/`)

### Setup
Create new React app at root level: `customer-portal/`
- Color scheme: blue primary `#1D4ED8`
- Navigation: Dashboard | My Laptops | Orders | Invoices | Support | Profile

### Pages:

**Login**: Email + Password, forgot password

**Dashboard**:
- My active rentals count | Current month amount due | Next invoice date | Open support tickets

**My Laptops**:
- Grid/list of their rented/purchased laptops
- Each card: TTSPL ID | Brand | Config | Dispatch date | Monthly rate | Status
- Click: show delivery details, support history

**Orders**:
- All their sales orders (Quotation → SO → DC flow)
- Status tracking per order

**Invoices**:
- List by month
- Download PDF button
- Payment status
- Credit notes applied shown inline
- IRN + QR code visible on paid invoices

**Support Tickets**:
- Raise new ticket: select laptop (TTSPL) | issue type | description | photo upload
- View their tickets with status

**Profile**: view details, change password

---

## SECTION 8 — RBAC ENFORCEMENT

### CRM Roles and access (enforce in BOTH backend middleware AND frontend route guards):

```
super_admin: everything
manager: everything except delete in billing + user management
sales: Leads, Customers, Quotations, Sales Orders, view-only Inventory
warehouse: GRN, Inventory, Delivery Challans (attach laptops), view POs
qc_tech: Floor Tickets (QC1/QC2 only), view Inventory
floor_tech: own Floor Tickets only, parts request
dispatch: Delivery Register, Delivery Challans (dispatch actions only)
accounts: Customer Billing, Vendor Billing, Credit/Debit Notes, E-Invoice, E-Way Bill
support: Support Tickets module only
admin: same as manager + user management + role permissions
```

### Frontend route guards:
In `src/router/ProtectedRoute.jsx`, check `user.role` against allowed roles per route. Redirect to `/unauthorized` page if not allowed. Also hide sidebar items for inaccessible modules.

---

## SECTION 9 — EMAIL TEMPLATES (Nodemailer)

All emails sent via `services/emailQueueService.js`. Create HTML templates in `backend/templates/`:

1. **PO Approval Email** (`po-approved.html`): Professional template with Rentfoxxy logo, PO details table, PDF attachment, "Please confirm by replying to this email" CTA
2. **Quotation Email** (`quotation.html`): Quote details, line items, accept link (token-based), validity date, contact info
3. **Invoice Email** (`invoice.html`): Invoice summary, due date, payment details, PDF attachment, IRN if available
4. **Customer Portal Welcome** (`customer-welcome.html`): Login credentials, portal URL, what they can do
5. **Vendor Portal Welcome** (`vendor-welcome.html`): Login credentials, portal URL

All emails: From = `noreply@rentfoxxy.com`, professional HTML layout, Rentfoxxy branding.

---

## SECTION 10 — API PATTERNS (consistency rules)

All API responses must follow this pattern:
```javascript
// Success
{ success: true, data: { ... }, message: "Action completed" }
// List with pagination
{ success: true, data: [...], total: 100, page: 1, limit: 25, totalPages: 4 }
// Error
{ success: false, message: "Descriptive error", errors: [...] }
```

All list endpoints support: `?page=1&limit=25&search=text&sortBy=created_at&sortOrder=desc`

All DB queries use parameterized queries (no string interpolation — SQL injection prevention).

All file uploads: Multer, max 8MB, stored in `uploads/[module-name]/`, served at `/uploads/[module-name]/filename`.

---

## SECTION 11 — ENV VARIABLES (add to `.env.example`)

```bash
# Existing
DATABASE_URL=
DB_HOST=
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_SSL=false
JWT_SECRET=
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Email
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
FROM_EMAIL=noreply@rentfoxxy.com

# Zoho GSP (E-Invoice / E-Way Bill)
ZOHO_GSP_CLIENT_ID=
ZOHO_GSP_CLIENT_SECRET=
ZOHO_GSP_USERNAME=
ZOHO_GSP_PASSWORD=
ZOHO_GSP_SANDBOX=true
COMPANY_GSTIN=
COMPANY_NAME=Rentfoxxy Technologies Pvt Ltd
COMPANY_ADDRESS=
COMPANY_STATE_CODE=
COMPANY_HSN_CODE=84713000

# Portals
VENDOR_PORTAL_URL=https://vendor.rentfoxxy.com
CUSTOMER_PORTAL_URL=https://customer.rentfoxxy.com

# Perplexity (existing - lead research)
PERPLEXITY_API_KEY=
```

---

## SECTION 12 — BUILD ORDER FOR THIS SESSION

Build in this exact order to avoid dependency issues:

1. **Migrations 052–055** — run all SQL migrations first
2. **Zoho GSP service** — `services/zohoGspService.js`
3. **Billing scheduler** — `services/billingSchedulerService.js` (add to server.js startup)
4. **Vendor billing controller + routes** — `/api/vendor-billing/`
5. **Customer billing controller + routes** — `/api/customer-billing/`
6. **Vendor portal auth + routes** — `/api/vendor-portal/`
7. **Customer portal auth + routes** — `/api/customer-portal/`
8. **Update server.js** — mount new routes, start billing scheduler
9. **CRM Frontend: App Shell** — sidebar, layout, role-based nav
10. **CRM Frontend: Dashboard** — role-specific widgets + recharts
11. **CRM Frontend: Vendor module** — VendorList, VendorForm, VendorDetail, POList, POForm, GRNForm
12. **CRM Frontend: Floor & QC** — FloorTicketList (kanban + table), TicketDetail (all tabs), PartsRequest
13. **CRM Frontend: Inventory** — StockManagement, TTSPL History drawer
14. **CRM Frontend: Lead CRM** — LeadList (kanban + table), LeadForm (full), LeadDetail, FollowUpView
15. **CRM Frontend: Sales Pipeline** — Quotations, SalesOrders, DeliveryChallans, DeliveryRegister
16. **CRM Frontend: Customer Billing** — InvoiceList, InvoiceDetail, CreditNoteForm
17. **CRM Frontend: Vendor Billing** — VendorBillList, VendorBillDetail, DebitNoteForm
18. **CRM Frontend: Finance Overview** — Accounts team consolidated view
19. **CRM Frontend: Settings** — UserManagement, RolePermissions, TeamManagement
20. **Vendor Portal** — full `vendor-portal/` React app
21. **Customer Portal** — full `customer-portal/` React app

---

## SECTION 13 — QUALITY CHECKLIST (verify before considering complete)

For every module:
- [ ] Backend: all CRUD endpoints working, parameterized queries, auth middleware applied
- [ ] Backend: validation on all inputs (express-validator), proper error messages
- [ ] Backend: pagination on all list endpoints
- [ ] Frontend: loading skeleton while fetching
- [ ] Frontend: empty state when no data
- [ ] Frontend: form validation with inline errors
- [ ] Frontend: success/error toasts on all actions
- [ ] Frontend: mobile responsive (min 768px width)
- [ ] Frontend: role-based visibility (sidebar items + action buttons)
- [ ] TTSPL history: every status change logged
- [ ] Billing: all calculations tested with edge cases (month start/end, pro-rata)
- [ ] Zoho GSP: handle API errors gracefully, show clear error messages to user

---

## SECTION 14 — REPORTING (BUILD AFTER CORE CRM IS COMPLETE)

**Do not build this section now. It comes after the full CRM is working.**

When it is time to build reporting, here is what is needed:

### Manager Reports
- Revenue report: monthly/quarterly/annual, Rentfoxxy vs gorefurbo, by customer
- Inventory utilization: % of fleet rented vs available vs in-repair, trend over time
- Lead conversion funnel: leads → deal rate, avg time per stage, by salesperson
- Collections report: invoiced vs collected vs outstanding by month
- Vendor spend report: monthly payable per vendor, debit notes applied

### Team Reports (Sales)
- Individual salesperson performance: leads assigned, converted, lost, revenue generated
- Quotation hit rate per salesperson
- Follow-up compliance: scheduled vs completed
- Lead aging: how long in each stage

### Technician Reports (Floor)
- Tickets resolved per technician per week/month
- Average time per stage per technician
- Parts consumed per technician/ticket
- QC pass rate per technician
- Chip repair volume

### All reports: filterable by date range, exportable to Excel (using `xlsx` package)

---

*End of master build prompt. This document contains the complete specification for the Rentfoxxy CRM system. Build Phase 1 through Phase 21 in order. Ask for clarification on any ambiguous point before writing code.*

# test

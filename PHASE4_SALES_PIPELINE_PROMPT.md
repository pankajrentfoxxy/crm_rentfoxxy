# RENTFOXXY CRM — PHASE 4 BUILD PROMPT
## Sales Orders + Delivery Challans + Dispatch Pipeline
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- Extend existing code. DO NOT remove or rewrite working backend endpoints.
- Existing backend is at `/api/sales-management` — all routes in
  `backend/routes/salesManagement.js` already work. Only ADD new routes.
- Existing operation-management frontend components exist in
  `frontend/src/features/operation-management/components/` — REUSE these,
  do not duplicate them.
- Document number prefixes are fixed — do not change:
  `EST-` = Quotation, `SO-` = Sales Order, `DC-` = Delivery Challan,
  `RDC` = Return DC (from `sm_document_sequences` table)
- Business lines: Rentfoxxy (rental) uses `quotation_type = 'rental'`,
  gorefurbo (sales) uses `quotation_type = 'sale'`
- E-invoice and E-way bill are for gorefurbo DCs (sales type) only
- Naming conventions:
  - Feature folder: `frontend/src/features/sales-pipeline/`
  - Permission sections: `sales_quotations`, `sales_orders_doc`,
    `delivery_challans`, `return_dc`, `delivery_register_management`,
    `technicians_bucket_list` (all already exist in DB)
  - DC dispatch modes: `courier`, `porter`, `inhouse`
  - DC line status values: `pending`, `in_transit`, `delivered`, `rejected`
- Design system: Primary `#2563EB`, same as previous phases

---

## SECTION 1 — DATABASE MIGRATIONS

### Migration `058_phase4_sales_pipeline.sql`

```sql
-- Phase 4: Sales pipeline enhancements — QC enforcement on DC,
-- priority QC tickets for Sales Orders, pre-dispatch QC flow,
-- e-invoice tracking, payment tracking, security deposits

-- 1. Enhance delivery_challan_lines with Phase 4 fields
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS dispatch_mode       VARCHAR(20) DEFAULT 'courier'
    CHECK (dispatch_mode IN ('courier','porter','inhouse')),
  ADD COLUMN IF NOT EXISTS porter_booking_id   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS estimated_delivery  DATE,
  ADD COLUMN IF NOT EXISTS pre_dispatch_qc_ticket_id INT REFERENCES tickets(ticket_id),
  ADD COLUMN IF NOT EXISTS pre_dispatch_qc_passed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS irn                 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS irn_generated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_code_url         TEXT,
  ADD COLUMN IF NOT EXISTS eway_bill_number    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS eway_bill_valid_till TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_sent_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS delivered_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by        INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS delivery_location   TEXT,
  ADD COLUMN IF NOT EXISTS delivery_otp        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS delivery_otp_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_image_url       TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason    TEXT;

-- 2. Sales order payment tracking
CREATE TABLE IF NOT EXISTS sales_order_payments (
  payment_id        SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(50) NOT NULL,
  customer_id       INT REFERENCES customers(customer_id),
  payment_type      VARCHAR(30) NOT NULL
    CHECK (payment_type IN ('advance','security_deposit','monthly','partial','final')),
  amount            NUMERIC(12,2) NOT NULL,
  payment_date      DATE NOT NULL,
  payment_mode      VARCHAR(30) DEFAULT 'bank_transfer'
    CHECK (payment_mode IN ('bank_transfer','cheque','upi','cash','other')),
  reference_number  VARCHAR(100),
  notes             TEXT,
  recorded_by       INT REFERENCES users(user_id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_so_payments_so
  ON sales_order_payments (sales_order_number);

-- 3. Pre-dispatch QC ticket link
-- When SO is created and laptops are attached (DC creation), a priority
-- QC ticket is created automatically. This table tracks that link.
CREATE TABLE IF NOT EXISTS dc_qc_tickets (
  id              SERIAL PRIMARY KEY,
  dc_number       VARCHAR(50) NOT NULL,
  sales_order_number VARCHAR(50),
  ticket_id       INT NOT NULL REFERENCES tickets(ticket_id),
  ttspl_id        VARCHAR(50),
  serial_id       INT REFERENCES vendor_serial_numbers(serial_id),
  status          VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','qc_passed','qc_failed')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dc_qc_tickets_dc
  ON dc_qc_tickets (dc_number);

-- 4. Add new permission sections for Phase 4
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('sales_pipeline',    'Sales Pipeline (Quotations, SOs, DCs)', 55),
  ('payment_records',   'Payment Recording',                      56),
  ('einvoice_ewb',      'E-Invoice and E-Way Bill',               57),
  ('dispatch_ops',      'Dispatch Operations',                    175)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- 5. Seed role permissions for Phase 4 sections
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',    'sales_pipeline',  TRUE,TRUE,TRUE,TRUE),
  ('manager',  'sales_pipeline',  TRUE,TRUE,TRUE,FALSE),
  ('sales',    'sales_pipeline',  TRUE,TRUE,FALSE,FALSE),
  ('warehouse','sales_pipeline',  TRUE,FALSE,TRUE,FALSE),
  ('dispatch', 'sales_pipeline',  TRUE,FALSE,TRUE,FALSE),
  ('admin',    'payment_records', TRUE,TRUE,TRUE,TRUE),
  ('manager',  'payment_records', TRUE,TRUE,TRUE,FALSE),
  ('accounts', 'payment_records', TRUE,TRUE,TRUE,FALSE),
  ('admin',    'einvoice_ewb',    TRUE,TRUE,TRUE,FALSE),
  ('accounts', 'einvoice_ewb',    TRUE,TRUE,FALSE,FALSE),
  ('dispatch', 'einvoice_ewb',    TRUE,FALSE,FALSE,FALSE),
  ('admin',    'dispatch_ops',    TRUE,TRUE,TRUE,TRUE),
  ('manager',  'dispatch_ops',    TRUE,FALSE,TRUE,FALSE),
  ('dispatch', 'dispatch_ops',    TRUE,FALSE,TRUE,FALSE),
  ('warehouse','dispatch_ops',    TRUE,FALSE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 2 — BACKEND: NEW & UPDATED ENDPOINTS

### 2.1 Add to `backend/controllers/salesManagementController.js`

**`exports.recordPayment`** — `POST /api/sales-management/sales-orders/:soNumber/payments`
```
Body: { payment_type, amount, payment_date, payment_mode, reference_number, notes }
Inserts into sales_order_payments table.
Returns: { payment_id, message: 'Payment recorded' }
```

**`exports.listPayments`** — `GET /api/sales-management/sales-orders/:soNumber/payments`
```
Returns all payments for a SO with totals:
{ payments: [...], total_paid, total_advance, total_security }
```

**`exports.createPreDispatchQcTicket`** — `POST /api/sales-management/delivery-challans/:dcNumber/qc-ticket`
```
For each serial attached to the DC:
  1. Check each serial's qc_status in vendor_serial_numbers
  2. Create a ticket with:
       ticket_type = 'sales_order_qc'
       priority = 'sales_order'
       vendor_serial_id = serial_id
       ttspl_id from vendor_serial_numbers
       sales_order_number from DC
  3. Inserts into dc_qc_tickets linking DC → ticket
  4. Logs ttspl_audit_log event_type = 'ticket_created' for each
  5. Updates delivery_challan_lines.pre_dispatch_qc_ticket_id
Returns: { tickets_created: number, ticket_ids: [...] }
```

**`exports.getDcQcStatus`** — `GET /api/sales-management/delivery-challans/:dcNumber/qc-status`
```
Returns status of pre-dispatch QC tickets for this DC:
{ all_passed: boolean, tickets: [{ ticket_id, ttspl_id, status }] }
```

**`exports.updateDcDispatch`** — `PATCH /api/sales-management/delivery-challans/:dcNumber/dispatch`
```
Body: { dispatch_mode, courier_name, awb_number, porter_booking_id,
        delivery_person_id, estimated_delivery }
Validation: if any pre_dispatch_qc_ticket exists for this DC and
  any dc_qc_tickets.status != 'qc_passed', return 400:
  "Pre-dispatch QC not completed. All laptops must pass QC before dispatch."
Updates delivery_challan_lines SET dispatch_mode, courier fields
Updates status to 'in_transit'
Logs ttspl_audit_log event_type = 'dispatched' for each TTSPL in DC
```

**`exports.markDcDelivered`** — `PATCH /api/sales-management/delivery-challans/:dcNumber/delivered`
```
Body: { delivery_location, pod_image_url (optional) }
Sets: status = 'delivered', delivered_at = NOW(), delivered_by = req.user.user_id
Updates vendor_serial_numbers.inventory_status = 'dispatched'
Logs ttspl_audit_log event_type = 'dispatched' with customer info
```

**`exports.markDcRejected`** — `PATCH /api/sales-management/delivery-challans/:dcNumber/rejected`
```
Body: { rejection_reason }
Sets: status = 'rejected', rejection_reason
Rolls back serial statuses to 'in_stock'
```

**`exports.getSoWithPayments`** — `GET /api/sales-management/sales-orders/:soNumber/full`
```
Returns full SO with:
  - All line items
  - All payments (from sales_order_payments)
  - Linked DCs
  - Payment summary (total value, total paid, balance due)
```

### 2.2 Add new routes to `backend/routes/salesManagement.js`

```javascript
// Payment tracking
router.get('/sales-orders/:soNumber/payments', checkRole(...roles, 'accounts'), ctrl.listPayments);
router.post('/sales-orders/:soNumber/payments', checkRole('admin','manager','accounts'), ctrl.recordPayment);
router.get('/sales-orders/:soNumber/full', checkRole(...roles, 'accounts'), ctrl.getSoWithPayments);

// Pre-dispatch QC
router.post('/delivery-challans/:dcNumber/qc-ticket', checkRole('admin','manager','warehouse'), ctrl.createPreDispatchQcTicket);
router.get('/delivery-challans/:dcNumber/qc-status', checkRole(...roles, 'warehouse','dispatch'), ctrl.getDcQcStatus);

// Dispatch actions
router.patch('/delivery-challans/:dcNumber/dispatch', checkRole('admin','manager','dispatch','warehouse'), ctrl.updateDcDispatch);
router.patch('/delivery-challans/:dcNumber/delivered', checkRole('admin','manager','dispatch'), ctrl.markDcDelivered);
router.patch('/delivery-challans/:dcNumber/rejected', checkRole('admin','manager','dispatch'), ctrl.markDcRejected);
```

### 2.3 Update `backend/services/grnTicketService.js`

Add a new exported function `createSalesOrderQcTicket`:
```javascript
/**
 * Create a priority QC ticket for a serial being dispatched on a Sales Order.
 * Called from createPreDispatchQcTicket controller.
 */
async function createSalesOrderQcTicket(db, {
  serialId, ttsplId, serialNumber, brand, processor, ram, storage,
  salesOrderNumber, dcNumber, createdByUserId
}) {
  // 1. Find the 'Floor Manager' stage (or first stage)
  // 2. Insert ticket with:
  //    ticket_type = 'sales_order_qc'
  //    priority = 'sales_order'
  //    vendor_serial_id = serialId
  //    ttspl_id = ttsplId
  //    sales_order_number = salesOrderNumber
  //    sales_order_id = null (not linked to legacy orders table)
  //    highlighted = false
  // 3. Log ttspl_audit_log: event_type = 'ticket_created',
  //    description = `Pre-dispatch QC ticket created for SO ${salesOrderNumber}`
  // 4. Return { ticket_id }
}
```

### 2.4 Update `ticketPhase2Controller.js` — handle dc_qc_tickets updates

In `moveToStage`, when `to_stage_name = 'Inventory'` AND `ticket.ticket_type = 'sales_order_qc'`:
```javascript
// Update dc_qc_tickets: SET status = 'qc_passed' WHERE ticket_id = ticket.ticket_id
await db.query(
  `UPDATE dc_qc_tickets SET status = 'qc_passed', updated_at = NOW()
   WHERE ticket_id = $1`,
  [ticket.ticket_id]
);
// Also update delivery_challan_lines.pre_dispatch_qc_passed = TRUE
await db.query(
  `UPDATE delivery_challan_lines
   SET pre_dispatch_qc_passed = TRUE
   WHERE pre_dispatch_qc_ticket_id = $1`,
  [ticket.ticket_id]
);
```

---

## SECTION 3 — FRONTEND: SALES PIPELINE FEATURE

### 3.1 New feature folder: `frontend/src/features/sales-pipeline/`

```
sales-pipeline/
  SalesPipelineApp.jsx        ← router root
  salesPipelineApi.js         ← all API calls
  salesPipelineUtils.js       ← formatters, helpers
  pages/
    QuotationListPage.jsx     ← list all quotations
    QuotationDetailPage.jsx   ← single quotation detail + actions
    SalesOrderListPage.jsx    ← list all SOs
    SalesOrderDetailPage.jsx  ← SO detail with payments + DCs
    DeliveryChallanListPage.jsx
    DeliveryChallanDetailPage.jsx ← DC detail + QC status + dispatch
    ReturnDcListPage.jsx
    DeliveryRegisterPage.jsx  ← replaces old delivery register
  components/
    QuotationForm.jsx         ← create/edit quotation drawer
    SalesOrderForm.jsx        ← create SO drawer
    DCForm.jsx                ← create DC drawer (reuses AssetDetailsForm)
    PaymentModal.jsx          ← record payment modal
    DispatchModal.jsx         ← dispatch mode selector modal
    QcStatusBadge.jsx         ← pre-dispatch QC status widget
    InhouseTechnicianBucket.jsx ← bucket list for inhouse deliveries
    EInvoicePanel.jsx         ← e-invoice + e-way bill actions
```

### 3.2 `salesPipelineApi.js`

```javascript
const base = '/api/sales-management';

// Quotations
export const listQuotations = (p) => api.get(`${base}/quotations`, { params: p });
export const getQuotation = (n) => api.get(`${base}/quotations/${n}`);
export const createQuotation = (d) => api.post(`${base}/quotations`, d);
export const updateQuotationStatus = (n, d) =>
  api.patch(`${base}/quotations/${n}/status`, d);
export const getQuotationMeta = () => api.get(`${base}/quotations/meta/add`);

// Sales Orders
export const listSalesOrders = (p) => api.get(`${base}/sales-orders`, { params: p });
export const getSalesOrder = (n) => api.get(`${base}/sales-orders/${n}`);
export const getSalesOrderFull = (n) => api.get(`${base}/sales-orders/${n}/full`);
export const createSalesOrder = (d) => api.post(`${base}/sales-orders`, d);
export const getSalesOrderMeta = () => api.get(`${base}/sales-orders/meta/add`);
export const listPayments = (n) => api.get(`${base}/sales-orders/${n}/payments`);
export const recordPayment = (n, d) => api.post(`${base}/sales-orders/${n}/payments`, d);

// Delivery Challans
export const listDCs = (p) => api.get(`${base}/delivery-challans`, { params: p });
export const getDC = (n) => api.get(`${base}/delivery-challans/${n}`);
export const createDC = (d) => api.post(`${base}/delivery-challans`, d);
export const getDCMeta = () => api.get(`${base}/delivery-challans/meta/add`);
export const getDcQcStatus = (n) => api.get(`${base}/delivery-challans/${n}/qc-status`);
export const createDcQcTickets = (n) =>
  api.post(`${base}/delivery-challans/${n}/qc-ticket`);
export const dispatchDC = (n, d) =>
  api.patch(`${base}/delivery-challans/${n}/dispatch`, d);
export const markDelivered = (n, d) =>
  api.patch(`${base}/delivery-challans/${n}/delivered`, d);
export const markRejected = (n, d) =>
  api.patch(`${base}/delivery-challans/${n}/rejected`, d);

// Return DC
export const listReturnDCs = (p) => api.get(`${base}/return-dc`, { params: p });

// Delivery register (existing)
export const getDeliveryCounts = () =>
  api.get('/api/delivery-register-management/counts');
export const listByStatus = (status, p) =>
  api.get(`/api/delivery-register-management/${status}`, { params: p });
export const sendDeliveryOtp = (dcNumber) =>
  api.post(`${base}/delivery-challans/${dcNumber}/send-otp`);
export const verifyDeliveryOtp = (dcNumber, d) =>
  api.post(`${base}/delivery-challans/${dcNumber}/verify-otp`, d);
export const getAvailableSerials = (p) =>
  api.get(`${base}/inventory/available-serials`, { params: p });
export const getOperationCounts = () => api.get(`${base}/counts`);
```

### 3.3 `QuotationListPage.jsx`

**Route:** `/sales-pipeline/quotations`

**Header:**
- Title "Quotations" + subtitle "EST-* series"
- Stats: Total | Draft | Sent | Approved | Rejected
- `+ Create Quotation` button

**Status tabs:** All | Draft | Sent | Approved | Rejected

**Table columns:**
Quote # | Date | Customer | Type (Rental/Sales) | Items | Total Value | Status | Actions

- Type badge: Rental = blue, Sales = green
- Status badge: Draft = gray, Sent = amber, Approved = green, Rejected = red
- Actions: View | Edit (if Draft) | Create SO (if Approved) | Send Email (resend)

**Row expand:** Shows line items summary on click

### 3.4 `QuotationForm.jsx` (drawer)

**Slide-in drawer, 600px wide.**

```
Section 1: Header
  Customer* (searchable dropdown from /customer-management/customers)
    → autofills GST, billing address
  Quotation Date* | Validity Date (default: +7 days)
  Type*: Rental / Sale (maps to quotation_type: 'rental' / 'sale')
  Quotation From Quotation: (if creating SO from existing quote, pre-fill)

Section 2: Line Items (dynamic rows via AssetDetailsForm component)
  Reuse: frontend/src/features/operation-management/components/AssetDetailsForm.jsx
  Each row: Brand | Model | Processor | Gen | RAM | Storage | Qty | Rate/unit | Total
  [+ Add Row] | [Remove] buttons

Section 3: Terms & Notes
  Security Amount (₹) | Shipping Charges (₹)
  Supply State (dropdown — Indian states)
  Remarks (textarea)
  Terms & Conditions (textarea with default text pre-filled)
  Warranty notes

Section 4: Send Options (shown when status = 'draft')
  Send to email: [pre-filled from customer.email]
  CC: [text input, comma-separated]
  [Save Draft] | [Save & Send]
```

On save draft: POST /api/sales-management/quotations with status = 'draft'
On save & send: POST then PATCH status to 'sent' + trigger email

### 3.5 `SalesOrderListPage.jsx`

**Route:** `/sales-pipeline/sales-orders`

**Header:**
- Title "Sales Orders" + subtitle "SO-* series"
- Stats: Total | Pending Dispatch | In Transit | Delivered | With DC | Awaiting Payment
- `+ Create Sales Order` button

**Status tabs:** All | Pending | Processing | Completed

**Filter bar:** Customer | Type | Date range | Has DC (yes/no)

**Table columns:**
SO # | Date | Customer | Type | Items | Total Value | Paid | Balance | DC Count | Status | Actions

- Balance column: red if balance > 0, green if fully paid
- DC Count: badge showing how many DCs created for this SO
- Actions: View | Create DC | Record Payment | View Payments

### 3.6 `SalesOrderForm.jsx` (drawer)

```
Section 1: Header
  Create from Quotation? [toggle]
    If YES: Quotation # (searchable, auto-populates everything)
    If NO: manual entry

  Customer* (searchable)
  Sales Order Date*
  Type*: Rental / Sale
  Reference Quotation # (optional if creating without quote)

Section 2: Line Items
  Reuse AssetDetailsForm component
  Same fields as Quotation + Warranty (In Month)
  For Rental type: add "Monthly Rate" column

Section 3: Payment & Terms
  Security Deposit Amount (₹)
  Advance Required? [toggle]
    If YES: Advance Amount (₹) | Due Date
  Shipping Charges (₹)
  Supply State
  Remarks

  Payment summary (auto-calculated):
    Total Order Value: ₹X
    Security Deposit: ₹X
    Advance Required: ₹X
    Total to collect before dispatch: ₹X
```

### 3.7 `SalesOrderDetailPage.jsx`

**Route:** `/sales-pipeline/sales-orders/:soNumber`

**Layout:** Full-width with tabs.

**Header bar:**
- SO number (bold) | Type badge | Status badge | Customer name
- Action buttons: `Create DC` | `Record Payment` | `Back`

**Tabs:**

**Tab 1: Overview**
- Two columns:
  Left: SO details (customer, date, type, supply state, remarks)
  Right: Payment summary card:
    ```
    Total Order Value:    ₹ X,XX,XXX
    Security Deposit:     ₹   XX,XXX
    Total Collected:      ₹   XX,XXX
    Balance Due:          ₹   XX,XXX  ← red if > 0
    ```
- Line items table: Brand | Config | Qty | Rate | Total

**Tab 2: Payments**
- `PaymentModal` trigger button: `+ Record Payment`
- Table of payments:
  Date | Type | Amount | Mode | Reference | Recorded By
- Total row at bottom

**Tab 3: Delivery Challans**
- List of DCs created from this SO:
  DC # | Date | Laptops | Dispatch Mode | Status | QC Status | Actions
- `+ Create DC` button (links to DC form pre-filled with this SO)

**Tab 4: Linked Quotation**
- Shows linked quotation (if any) with all quote details read-only

### 3.8 `PaymentModal.jsx`

```
Modal: "Record Payment"

Payment Type*: dropdown
  advance | security_deposit | monthly | partial | final
Amount (₹)*: number input
Payment Date*: date picker (default: today)
Payment Mode*: dropdown
  bank_transfer | cheque | upi | cash | other
Reference Number: text input (UTR/cheque number)
Notes: textarea

[Cancel] [Record Payment]
```

On submit: POST /api/sales-management/sales-orders/:soNumber/payments
Toast: "Payment of ₹X recorded"

### 3.9 `DeliveryChallanListPage.jsx`

**Route:** `/sales-pipeline/delivery-challans`

**Header:**
- Title "Delivery Challans" + subtitle "DC-* series"
- Stats: Total | Pending Dispatch | In Transit | Delivered | Rejected
- `+ Create DC` button

**Status tabs:** All | Pending | In Transit | Delivered | Rejected

**Filter:** Customer | SO Number | Dispatch Mode | Date range | QC Status

**Table columns:**
DC # | Date | Customer | SO # | Laptops | Dispatch Mode | QC Status | Status | Actions

- QC Status badge:
  - No QC ticket yet: gray "Not Initiated"
  - Pending: amber "QC Pending"
  - All passed: green "QC Passed"
  - Any failed: red "QC Failed"
- Dispatch Mode badge: Courier = blue, Porter = purple, Inhouse = teal
- Actions: View | Dispatch (if pending + QC passed) | Track | Mark Delivered

### 3.10 `DeliveryChallanDetailPage.jsx` ← MOST IMPORTANT COMPONENT

**Route:** `/sales-pipeline/delivery-challans/:dcNumber`

**Layout:** Full-width, two-column on desktop.

**Header:**
- DC number | Customer | SO number (clickable) | Date
- Status badge (large) | QC Status badge
- Action buttons (role-based, see below)

**Left (65%): Main content tabs**

**Tab 1: DC Details**
- Line items table:
  Brand | Config | Qty | Serial Numbers (TTSPL IDs) | Remarks
- Shipping info: Address, mode, courier details
- Security amount, shipping charges
- Financial summary

**Tab 2: Pre-Dispatch QC** ← NEW
```
Title: "Pre-Dispatch Quality Check"
Subtitle: "All laptops must pass QC before dispatch"

If no QC tickets created yet:
  [Initiate Pre-Dispatch QC] button (blue, warehouse/manager role)
  → calls POST /delivery-challans/:dcNumber/qc-ticket
  → creates priority QC ticket for each serial in DC
  Info: "This will create priority QC tickets on the Floor Pipeline"

If QC tickets exist, show status table:
  TTSPL ID | Brand | Config | QC Ticket # | Stage | QC Status
  
  Status per row:
    Pending (amber) — ticket in QC stages
    QC Passed (green ✓) — ticket reached Inventory stage
    QC Failed (red ✗) — ticket marked qc_failed_return_vendor

Overall status:
  All Passed: [green banner] "All laptops have passed QC. Ready to dispatch."
  Pending: [amber banner] "X of Y laptops pending QC."
  Failed: [red banner] "X laptop(s) failed QC. Cannot dispatch until resolved."

[Refresh QC Status] button
Link to each ticket: "View Ticket #XXX" → /floor-pipeline/tickets/:id
```

**Tab 3: Dispatch** ← NEW
```
Title: "Dispatch Information"

If not dispatched yet:
  [Dispatch Now] button → opens DispatchModal
  ⚠ Warning if QC not all passed: "Complete pre-dispatch QC before dispatching"

If dispatched:
  Dispatch Mode: Courier / Porter / Inhouse
  Dispatch Date: [date]
  
  If Courier:
    Courier Name | AWB Number | Estimated Delivery
    [Mark Delivered] button (dispatch team)
    [Mark Rejected] button (dispatch team)
  
  If Porter:
    Booking ID | Estimated Delivery
    [Mark Delivered] button
    [Mark Rejected] button
  
  If Inhouse:
    Delivery Technician: [name]
    OTP Status: Sent / Not Sent
    [Send OTP] button → calls existing sendDeliveryOtp API
    
    [Mark Delivered] button (requires OTP verification first)
    → Opens OTP verify modal → on success marks delivered

Delivered:
  Delivered at: [datetime] by [technician name]
  POD Image: [show if uploaded]
  Delivery Location: [address captured]

Rejected:
  Reason: [text]
  [Re-attempt Delivery] button → opens DispatchModal again
```

**Tab 4: E-Invoice & E-Way Bill** (accounts team)
```
Shows only if quotation_type = 'sale' (gorefurbo)
OR if rental invoice threshold crossed

E-Invoice Section:
  IRN: [value or "Not generated"]
  Generated At: [datetime]
  QR Code: [image if generated]
  
  If not generated:
    [Generate E-Invoice] button (accounts role)
    → Will call Zoho GSP (Phase 5 integration — for now show placeholder)
    → Button shows "E-Invoice will be generated via Zoho GSP (Phase 5)"
  
  If generated:
    [Send E-Invoice to Customer] button
    → Opens email preview modal
    → Sends to customer.email with CC

E-Way Bill Section (optional, if value > ₹50,000):
  EWB Number: [value or "Not generated"]
  Valid Till: [datetime]
  
  [Generate E-Way Bill] button (accounts role)
  → Placeholder for Phase 5 Zoho GSP integration
```

**Right sidebar (35%):**
```
Customer:
  [Company Name]
  [Contact + Phone]
  [GST Number]
  [Billing Address]

Laptops in this DC:
  TTSPL001 — Dell i5 8GB
  TTSPL002 — Dell i5 8GB
  [Click any → TtsplHistoryDrawer]

Linked Documents:
  SO: SO-0025 →
  Quote: EST-0018 →

Payment Status (if SO linked):
  Total: ₹X
  Paid: ₹X
  Balance: ₹X [red if > 0]
```

### 3.11 `DCForm.jsx` (drawer)

**Slide-in drawer, 640px wide.**
Reuses: `AssetDetailsForm`, `CustomerAddressPanels`, `SearchableSelect` from
`operation-management/components/`.

```
Section 1: Header
  Sales Order # (searchable + select)
    → autofills: Customer, type, line items from SO
  OR: Create without SO (toggle)
    → manual customer select

  DC Date* (default: today)
  Type: auto-filled from SO (Rental / Sale)

Section 2: Laptops to Dispatch (one row per line item)
  For each line item from SO:
    Item description | Qty to dispatch | Serial Numbers picker
    
    Serial Numbers picker:
      Search QC-passed serials by brand/config
      Shows: TTSPL ID | Brand | Config | QC Status (must be 'qc_passed')
      Multi-select up to qty
      ⚠ Red warning if selected serial is NOT qc_passed:
        "TTSPL045 is not QC passed (status: in_repair). Remove before proceeding."
      [Select Serials] button → opens serial search modal

Section 3: Dispatch Details
  Ship By*: dropdown [Courier / Porter / Inhouse Technician]
  
  If Courier:
    Courier Name* | AWB Number | Estimated Delivery Date
  If Porter:
    Booking ID | Estimated Delivery Date
  If Inhouse:
    Delivery Technician* (dropdown from delivery_technicians table)
  
  Branch (supply from location)

Section 4: Financial
  Security Amount (₹) | Shipping Charges (₹)
  Supply State* (for GST)

Section 5: Addresses
  Reuse CustomerAddressPanels component
  Billing Address (auto-filled from customer, editable)
  Shipping Address (toggle: same as billing)

[Cancel] [Create DC]
```

**On submit:**
- Validates all selected serials are `qc_passed` (client + server side)
- POST /api/sales-management/delivery-challans
- On success: navigate to `/sales-pipeline/delivery-challans/:dcNumber`
- Toast: "DC created: DC-XXXX"

### 3.12 `DispatchModal.jsx`

```
Modal: "Dispatch DC-XXXX"

⚠ Check: if QC not all passed, show blocking error:
  "Cannot dispatch: Pre-dispatch QC not completed for all laptops."
  [Close] (no dispatch allowed)

If QC passed:
  Dispatch Mode*:
    ◉ Courier   ○ Porter   ○ Inhouse Technician
  
  If Courier:
    Courier Name* | AWB Number* | Estimated Delivery
  If Porter:
    Booking ID* | Estimated Delivery
  If Inhouse:
    Delivery Technician* (dropdown)
  
  [Cancel] [Confirm Dispatch]
```

On submit: PATCH /delivery-challans/:dcNumber/dispatch

### 3.13 `QcStatusBadge.jsx`

Reusable badge component used in tables and headers:
```jsx
// Props: { allPassed, pendingCount, failedCount, totalCount }
// Returns colored badge:
//   gray "QC Not Initiated" — no tickets
//   amber "QC Pending (2/5)" — some pending
//   green "QC Passed" — all passed
//   red "QC Failed (1)" — any failed
```

### 3.14 `DeliveryRegisterPage.jsx`

**Route:** `/sales-pipeline/delivery-register`

Replaces the old delivery register. Shows all DCs with their delivery status.

**Tabs:** In Transit | Delivered | Rejected

**In Transit tab:**
- Table: DC # | Customer | SO # | Laptops | Dispatch Mode | Dispatched Date | ETA | Actions
- Actions: Track | Mark Delivered | Send OTP (if inhouse) | Mark Rejected

**For Inhouse deliveries — Technician Bucket view:**
- Toggle: "Technician Bucket View" (shows deliveries grouped by technician)
- Each technician section: name + active deliveries
- Each delivery: Customer | Address | Laptops | OTP Status | Actions

**OTP Flow (Inhouse):**
1. `Send OTP` → calls POST /delivery-challans/:dcNumber/send-otp
   Toast: "OTP sent to customer"
2. Customer receives OTP
3. `Verify & Deliver` → opens OTP input modal
   → calls POST /delivery-challans/:dcNumber/verify-otp
   → on success → auto-calls markDelivered
   → shows "Delivered ✓"
4. If `Mark Rejected` → reason input → calls markRejected

**Delivered tab:** Historical log with POD images if uploaded.
**Rejected tab:** Rejected deliveries with reasons + re-attempt option.

### 3.15 `ReturnDcListPage.jsx`

**Route:** `/sales-pipeline/return-dc`

Existing return DC functionality wrapped in new UI:
- Table: RDC # | Date | Customer | Original DC | Laptops | Reason | Status
- Filter: Date range | Customer | Status
- Click row: shows return DC detail (uses existing `DeliveryChallanDetailModal`)

### 3.16 `InhouseTechnicianBucket.jsx`

Standalone component used in `DeliveryRegisterPage`:
- Shows per-technician bucket list
- Each item: Customer name | Delivery address | DC number | Status chip
- Quick action buttons: Send OTP | Verify OTP | Mark Rejected
- Empty state per technician: "No pending deliveries"

### 3.17 `EInvoicePanel.jsx`

Used in `DeliveryChallanDetailPage` Tab 4:
- Shows IRN, generated date, QR code image
- `Generate E-Invoice` button → Phase 5 placeholder
  (shows modal: "E-Invoice integration via Zoho GSP will be enabled in Phase 5.
   Your credentials are configured. No action needed now.")
- `Send E-Invoice to Customer` button (if IRN exists):
  → Opens email preview: To | CC | Subject | Message
  → Calls email service to send
- `Generate E-Way Bill` button → Phase 5 placeholder
- Shows EWB number + validity if already generated

---

## SECTION 4 — ROUTING & MENU CONFIG

### 4.1 `SalesPipelineApp.jsx`

```javascript
import { Routes, Route, Navigate } from 'react-router-dom';

export default function SalesPipelineApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="quotations" replace />} />
      <Route path="quotations" element={<QuotationListPage />} />
      <Route path="quotations/:quotationNumber" element={<QuotationDetailPage />} />
      <Route path="sales-orders" element={<SalesOrderListPage />} />
      <Route path="sales-orders/:soNumber" element={<SalesOrderDetailPage />} />
      <Route path="delivery-challans" element={<DeliveryChallanListPage />} />
      <Route path="delivery-challans/:dcNumber" element={<DeliveryChallanDetailPage />} />
      <Route path="return-dc" element={<ReturnDcListPage />} />
      <Route path="delivery-register" element={<DeliveryRegisterPage />} />
    </Routes>
  );
}
```

### 4.2 Add to `frontend/src/routes/index.jsx`

```javascript
import SalesPipelineApp from '../features/sales-pipeline/SalesPipelineApp';

{
  path: '/sales-pipeline/*',
  element: (
    <ProtectedRoute section="sales_pipeline" action="view">
      <Layout><SalesPipelineApp /></Layout>
    </ProtectedRoute>
  )
}
```

### 4.3 Update `frontend/src/config/menuConfig.js`

**Add Sales Pipeline accordion** (after Lead & Sales CRM, before Floor Pipeline):

```javascript
export const salesPipelineAccordionChildren = [
  { label: 'Quotations',          path: '/sales-pipeline/quotations',
    section: 'sales_quotations',  countKey: 'quotations' },
  { label: 'Sales Orders',        path: '/sales-pipeline/sales-orders',
    section: 'sales_orders_doc',  countKey: 'sales_orders' },
  { label: 'Delivery Challans',   path: '/sales-pipeline/delivery-challans',
    section: 'delivery_challans', countKey: 'delivery_challans' },
  { label: 'Delivery Register',   path: '/sales-pipeline/delivery-register',
    section: 'delivery_register_management' },
  { label: 'Return DC',           path: '/sales-pipeline/return-dc',
    section: 'return_dc',         countKey: 'return_dc' },
];
```

In MENU_GROUPS add:
```javascript
{
  type: 'salesPipelineAccordion',
  label: 'Sales Pipeline',
  icon: ShoppingCart,    // from lucide-react
  section: 'sales_pipeline',
  children: salesPipelineAccordionChildren
}
```

**Remove old operation-management entries** from MENU_GROUPS if they point to
the same pages (Quotations, Sales Orders, Delivery Challans, Return DC).
The old `/operation-management/*` routes can stay for backward compatibility
but the sidebar should point to new `/sales-pipeline/*` routes.

---

## SECTION 5 — ROLE-BASED VISIBILITY

| Action                           | Roles Allowed                            |
|----------------------------------|------------------------------------------|
| View quotation list              | sales, manager, admin, accounts          |
| Create quotation                 | sales, manager, admin                    |
| Approve/reject quotation         | manager, admin                           |
| View SO list                     | sales, manager, admin, accounts, dispatch|
| Create SO                        | sales, manager, admin                    |
| Record payment                   | accounts, manager, admin                 |
| View payments                    | accounts, manager, admin                 |
| Create DC                        | warehouse, manager, admin                |
| Initiate pre-dispatch QC         | warehouse, manager, admin                |
| View QC status on DC             | all internal roles                       |
| Dispatch DC (set in_transit)     | dispatch, warehouse, manager, admin      |
| Mark DC delivered                | dispatch, manager, admin                 |
| Mark DC rejected                 | dispatch, manager, admin                 |
| Generate e-invoice               | accounts, admin                          |
| Send e-invoice email             | accounts, admin                          |
| View delivery register           | dispatch, manager, admin, warehouse      |
| Inhouse tech bucket (own only)   | delivery_technician (via tech auth)      |
| View Return DCs                  | all internal roles                       |

Enforce using `<PermissionGate section="..." action="...">` in frontend and
`checkRole(...)` middleware in backend routes.

---

## SECTION 6 — SETTINGS PAGE UPDATES

Migration 058 adds 4 new permission sections:
`sales_pipeline`, `payment_records`, `einvoice_ewb`, `dispatch_ops`

These will **automatically appear** in Settings → Role Permissions matrix
after migration runs (page fetches sections from API dynamically).

No manual settings page changes needed.

---

## SECTION 7 — BUILD ORDER

Build in this exact order:

1. Run migration `058_phase4_sales_pipeline.sql`
2. Add new exports to `backend/controllers/salesManagementController.js`
3. Update `backend/routes/salesManagement.js` — add 8 new routes
4. Update `backend/services/grnTicketService.js` — add `createSalesOrderQcTicket`
5. Update `backend/controllers/ticketPhase2Controller.js` — handle `dc_qc_tickets`
6. Create `frontend/src/features/sales-pipeline/salesPipelineApi.js`
7. Create `frontend/src/features/sales-pipeline/salesPipelineUtils.js`
8. Create components: QcStatusBadge, PaymentModal, DispatchModal, EInvoicePanel,
   InhouseTechnicianBucket
9. Create forms: QuotationForm, SalesOrderForm, DCForm
10. Create pages: QuotationListPage, QuotationDetailPage
11. Create pages: SalesOrderListPage, SalesOrderDetailPage
12. Create pages: DeliveryChallanListPage, DeliveryChallanDetailPage
13. Create pages: ReturnDcListPage, DeliveryRegisterPage
14. Create `SalesPipelineApp.jsx`
15. Update `frontend/src/routes/index.jsx`
16. Update `frontend/src/config/menuConfig.js`
17. Verify old `/operation-management/*` still works (backward compat)

---

## SECTION 8 — QUALITY CHECKLIST

**Database:**
- [ ] Migration 058 runs clean
- [ ] `sales_order_payments` table created
- [ ] `dc_qc_tickets` table created
- [ ] `delivery_challan_lines` has all new columns
- [ ] `sales_pipeline`, `payment_records`, `einvoice_ewb`, `dispatch_ops`
      appear in Settings → Role Permissions

**Backend:**
- [ ] POST /sales-orders/:n/payments — records payment, returns payment_id
- [ ] GET /sales-orders/:n/full — returns SO with payments + DC list
- [ ] POST /delivery-challans/:n/qc-ticket — creates priority tickets per serial
- [ ] GET /delivery-challans/:n/qc-status — returns per-serial QC status
- [ ] PATCH /delivery-challans/:n/dispatch — BLOCKS if QC not all passed
- [ ] PATCH /delivery-challans/:n/delivered — updates serial status to 'dispatched'
- [ ] When QC2 passed on sales_order_qc ticket → dc_qc_tickets updated to 'qc_passed'
- [ ] pre_dispatch_qc_passed set TRUE on DC line when ticket completes

**Frontend:**
- [ ] Quotation list has status tabs, type badges, create button
- [ ] QuotationForm: customer autofill, line items, send options
- [ ] SO list shows balance due column (red if > 0)
- [ ] SalesOrderDetailPage: 4 tabs, payment summary card, record payment
- [ ] DC list shows QC status badge correctly
- [ ] DCForm: serial picker shows only qc_passed serials
- [ ] DCForm: warns if selecting non-qc_passed serial (red warning)
- [ ] DeliveryChallanDetailPage Tab 2 (Pre-Dispatch QC):
      - Shows "Initiate QC" if no tickets
      - Shows per-serial status table if tickets exist
      - Shows correct overall status banner
- [ ] DeliveryChallanDetailPage Tab 3 (Dispatch):
      - DispatchModal blocks if QC not complete
      - OTP flow works for inhouse deliveries
- [ ] DeliveryChallanDetailPage Tab 4 (E-Invoice):
      - Shows Phase 5 placeholder message on generate
      - Send E-Invoice email button works if IRN exists
- [ ] DeliveryRegisterPage shows In Transit / Delivered / Rejected tabs
- [ ] Inhouse technician bucket grouped by technician
- [ ] OTP send + verify flow complete end-to-end
- [ ] TtsplHistoryDrawer opens from DC sidebar laptop list
- [ ] Sales Pipeline menu in sidebar with count badges
- [ ] All pages mobile-responsive at 375px
- [ ] Role enforcement: dispatch team cannot create DCs, sales cannot dispatch

---

## SECTION 9 — NAMING REFERENCE

| Concept                  | Correct Name               | Wrong (do not use)              |
|--------------------------|----------------------------|---------------------------------|
| Feature folder           | `sales-pipeline`           | sales, operation, operations    |
| Route prefix             | `/sales-pipeline/`         | /operations/, /sales/           |
| Quotation prefix         | `EST-`                     | QT-, QUOT-, Q-                  |
| Sales Order prefix       | `SO-`                      | ORD-, SAL-                      |
| Delivery Challan prefix  | `DC-`                      | DEL-, CH-                       |
| Return DC prefix         | `RDC`                      | RET-, RDC-, R-DC-               |
| Dispatch mode            | `courier`/`porter`/`inhouse` | Courier, COURIER               |
| DC line status           | `pending`/`in_transit`/`delivered`/`rejected` | Pending, sent |
| Quotation type           | `rental` / `sale`          | Rental, RENTAL, Sales, SALES    |
| Payment type             | `advance`/`security_deposit`/`monthly`/`partial`/`final` | Advance |
| Pre-dispatch QC ticket   | `ticket_type = 'sales_order_qc'` | predispatch, dispatch_qc   |
| Pre-dispatch priority    | `priority = 'sales_order'` | high, urgent, priority          |
| Permission section       | `sales_pipeline`           | sales_pipeline_mgmt, pipeline   |
| Permission section       | `payment_records`          | payments, billing               |
| Permission section       | `einvoice_ewb`             | einvoice, e_invoice, gsp        |
| Permission section       | `dispatch_ops`             | dispatch, delivery_ops          |

---

*End of Phase 4 prompt. Build Sections 1–5 in the order given in Section 7.*
*After completion, verify Section 8 checklist before moving to Phase 5 (Zoho GSP + Billing Engine).*

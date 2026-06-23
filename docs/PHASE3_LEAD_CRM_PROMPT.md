# RENTFOXXY CRM — PHASE 3 BUILD PROMPT
## Lead CRM — Complete Rebuild
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- Extend existing code. Never remove working endpoints or components.
- Existing lead routes are at `/api/leads` — keep all existing endpoints,
  only ADD new ones.
- Existing lead components: `frontend/src/components/LeadList.jsx`,
  `LeadDetail.jsx`, `FollowUps.jsx` — these will be REPLACED by the new
  feature folder. Keep original files as backup by renaming to `*.legacy.jsx`.
- Lead statuses MUST match exactly (case-sensitive):
  `Pending`, `Cold`, `Warm`, `Hot`, `Deal`, `Demo`, `Call Back`, `Hold`,
  `Gone`, `Rejected`
- Lead stages come from `backend/constants/leadStages.js` — DO NOT hardcode
  them in frontend; always fetch from API.
- Naming conventions:
  - Feature folder: `frontend/src/features/lead-crm/`
  - Permission sections: `leads`, `lead_follow_ups`, `lead_conversion`,
    `customers` (all already exist — no new sections needed for leads)
  - Customer document types: `gst_certificate`, `pan_card`, `agreement`,
    `kyc_id`, `other`
- Design system: same as Phase 1 & 2 (Primary `#2563EB`, cards `rounded-xl
  border border-gray-100 shadow-sm`, badges `rounded-full`)

---

## SECTION 1 — DATABASE MIGRATIONS

### Migration `057_phase3_lead_crm.sql`

```sql
-- Phase 3: Lead CRM enhancements, customer profile enrichment,
-- follow-up improvements, lead conversion tracking

-- 1. Extend leads table with missing fields from the spec
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS whatsapp_number    VARCHAR(32),
  ADD COLUMN IF NOT EXISTS designation        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS quantity_required  INT,
  ADD COLUMN IF NOT EXISTS monthly_budget     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS rental_duration    INT,         -- months
  ADD COLUMN IF NOT EXISTS use_case           VARCHAR(100),-- WFO / WFH / Both
  ADD COLUMN IF NOT EXISTS company_type       VARCHAR(100),-- Pvt Ltd / LLP / etc.
  ADD COLUMN IF NOT EXISTS company_size       INT,         -- employee count
  ADD COLUMN IF NOT EXISTS industry           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS annual_revenue     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pan_number         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gst_number         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS state              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pincode            VARCHAR(10),
  ADD COLUMN IF NOT EXISTS billing_address    TEXT,
  ADD COLUMN IF NOT EXISTS shipping_same_as_billing BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS shipping_address   TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_time     TIME,        -- e.g. 10:30:00
  ADD COLUMN IF NOT EXISTS converted_at       TIMESTAMPTZ, -- when Deal/Demo status set
  ADD COLUMN IF NOT EXISTS converted_by       INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS customer_id        INT REFERENCES customers(customer_id),
  ADD COLUMN IF NOT EXISTS inquiry_type       VARCHAR(50) DEFAULT 'rental'
    CHECK (inquiry_type IN ('rental', 'sales', 'both')),
  ADD COLUMN IF NOT EXISTS last_activity_at   TIMESTAMPTZ DEFAULT NOW();

-- 2. Extend customers table with full profile fields
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pan_number          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS company_type        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_size        INT,
  ADD COLUMN IF NOT EXISTS industry            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_address     TEXT,
  ADD COLUMN IF NOT EXISTS billing_city        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_state       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_pincode     VARCHAR(10),
  ADD COLUMN IF NOT EXISTS shipping_same       BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS shipping_address    TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_state      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_pincode    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS whatsapp_number     VARCHAR(32),
  ADD COLUMN IF NOT EXISTS designation         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_lead_stage   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS onboarded_by        INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS onboarded_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_enabled      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS kyc_verified        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kyc_verified_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS kyc_verified_at     TIMESTAMPTZ;

-- 3. Customer documents table
CREATE TABLE IF NOT EXISTS customer_documents (
  doc_id          SERIAL PRIMARY KEY,
  customer_id     INT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  lead_id         INT REFERENCES leads(lead_id) ON DELETE SET NULL,
  doc_type        VARCHAR(50) NOT NULL
    CHECK (doc_type IN ('gst_certificate','pan_card','agreement','kyc_id','other')),
  doc_label       VARCHAR(255),
  file_path       TEXT NOT NULL,
  file_name       VARCHAR(255),
  file_size_bytes INT,
  uploaded_by     INT REFERENCES users(user_id),
  is_signed       BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_docs_customer
  ON customer_documents(customer_id);

-- 4. Lead import log (for CSV uploads)
CREATE TABLE IF NOT EXISTS lead_import_logs (
  import_id     SERIAL PRIMARY KEY,
  imported_by   INT REFERENCES users(user_id),
  total_rows    INT DEFAULT 0,
  imported      INT DEFAULT 0,
  duplicates    INT DEFAULT 0,
  errors        INT DEFAULT 0,
  error_details JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Update last_activity_at trigger on lead_activities insert
CREATE OR REPLACE FUNCTION update_lead_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads SET last_activity_at = NOW()
  WHERE lead_id = NEW.lead_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_last_activity ON lead_activities;
CREATE TRIGGER trg_lead_last_activity
  AFTER INSERT ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION update_lead_last_activity();

-- 6. Add lead_conversion permission section
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('lead_conversion', 'Lead to Customer Conversion', 45),
  ('customer_documents', 'Customer Documents', 85)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- 7. Seed role permissions for new sections
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',   'lead_conversion',    TRUE,TRUE,TRUE,TRUE),
  ('manager', 'lead_conversion',    TRUE,TRUE,TRUE,FALSE),
  ('sales',   'lead_conversion',    TRUE,TRUE,FALSE,FALSE),
  ('admin',   'customer_documents', TRUE,TRUE,TRUE,TRUE),
  ('manager', 'customer_documents', TRUE,TRUE,TRUE,FALSE),
  ('sales',   'customer_documents', TRUE,TRUE,FALSE,FALSE),
  ('accounts','customer_documents', TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 2 — BACKEND: NEW & UPDATED ENDPOINTS

### 2.1 Update `backend/controllers/leadController.js` — add these exports:

```
exports.getLeadStages          GET  /api/leads/stages
  → Returns STAGES_BY_STATUS from leadStages.js as JSON
  → { status: string, stages: string[] }[]

exports.updateLeadFullProfile  PUT  /api/leads/:id/profile
  → Updates: whatsapp_number, designation, quantity_required, monthly_budget,
    rental_duration, use_case, company_type, company_size, industry,
    annual_revenue, pan_number, gst_number, state, pincode, city,
    billing_address, shipping_same_as_billing, shipping_address,
    inquiry_type, personalRemarks, brand, processor, generation, ram,
    storage, companyBrand, companyName, source
  → Logs activity: action='profile_updated', notes=summary of changed fields

exports.convertToCustomer      POST /api/leads/:id/convert
  → Only allowed if lead.status IN ('Deal', 'Demo')
  → Only allowed by role: admin, manager, sales (with lead_conversion permission)
  → Creates or updates customer record from lead data:
      name = lead.name
      companyName = lead.companyName
      email = lead.email
      phone = lead.phone
      gstNo = lead.gst_number
      pan_number = lead.pan_number
      company_type = lead.company_type
      company_size = lead.company_size
      industry = lead.industry
      billing_address = lead.billing_address
      billing_city = lead.city
      billing_state = lead.state
      billing_pincode = lead.pincode
      whatsapp_number = lead.whatsapp_number
      designation = lead.designation
      source_lead_stage = lead.leadStage
      onboarded_by = req.user.user_id
      onboarded_at = NOW()
  → If customer already exists (sourceLeadId match): update record
  → Sets lead.customer_id = new customer_id
  → Sets lead.converted_at = NOW(), lead.converted_by = req.user.user_id
  → Logs activity: action='converted_to_customer'
  → Returns: { customer_id, is_new: boolean }

exports.getLeadConversionStatus GET /api/leads/:id/conversion
  → Returns: { converted: boolean, customer_id, converted_at, customer_name }
```

### 2.2 Update `backend/routes/leads.js` — add new routes:

```javascript
router.get('/stages', leadController.getLeadStages);
router.put('/:id/profile', checkRole('admin','manager','sales'), leadController.updateLeadFullProfile);
router.post('/:id/convert', checkRole('admin','manager','sales'), leadController.convertToCustomer);
router.get('/:id/conversion', checkRole('admin','manager','sales'), leadController.getLeadConversionStatus);
```

### 2.3 New controller: `backend/controllers/customerDocumentController.js`

```
POST   /api/customer-documents/:customerId/upload
  → Multer upload, max 8MB, types: PDF/JPG/PNG
  → Fields: doc_type (required), doc_label, is_signed (boolean), notes
  → Stores in uploads/customer-documents/:customerId/
  → Inserts into customer_documents table
  → Returns: { doc_id, file_path, doc_type, doc_label, created_at }

GET    /api/customer-documents/:customerId
  → Returns all documents for customer with signed URLs
  → Grouped by doc_type

DELETE /api/customer-documents/:customerId/:docId
  → Soft delete (remove file + DB record)
  → Role check: admin, manager only
```

Add route file: `backend/routes/customerDocuments.js`
Mount in `backend/server.js`:
```javascript
app.use('/api/customer-documents', require('./routes/customerDocuments'));
```

### 2.4 Update Prisma schema — add fields to Lead model:

Add these fields to the Lead model in `backend/prisma/schema.prisma`:
```prisma
whatsappNumber        String?   @map("whatsapp_number")
designation           String?
quantityRequired      Int?      @map("quantity_required")
monthlyBudget         Decimal?  @map("monthly_budget")
rentalDuration        Int?      @map("rental_duration")
useCase               String?   @map("use_case")
companyType           String?   @map("company_type")
companySize           Int?      @map("company_size")
industry              String?
annualRevenue         String?   @map("annual_revenue")
panNumber             String?   @map("pan_number")
gstNumber             String?   @map("gst_number")
state                 String?
pincode               String?
billingAddress        String?   @map("billing_address")
shippingSameAsBilling Boolean   @default(true) @map("shipping_same_as_billing")
shippingAddress       String?   @map("shipping_address")
followUpTime          String?   @map("follow_up_time")
convertedAt           DateTime? @map("converted_at")
convertedBy           Int?      @map("converted_by")
customerId            Int?      @map("customer_id")
inquiryType           String    @default("rental") @map("inquiry_type")
lastActivityAt        DateTime  @default(now()) @map("last_activity_at")
```

---

## SECTION 3 — FRONTEND: LEAD CRM FEATURE

### 3.1 New feature folder: `frontend/src/features/lead-crm/`

```
lead-crm/
  LeadCrmApp.jsx          ← router root
  leadCrmApi.js           ← all API calls
  leadConstants.js        ← statuses, stages, source list, etc. (fetched + cached)
  pages/
    LeadListPage.jsx      ← list view (kanban + table)
    LeadDetailPage.jsx    ← full lead detail
    FollowUpCalendarPage.jsx
    CustomerListPage.jsx  ← customers list (replaces /customers route)
    CustomerDetailPage.jsx
  components/
    LeadCard.jsx          ← kanban card
    LeadFormDrawer.jsx    ← add/edit lead slide-in drawer
    LeadStatusModal.jsx   ← status change modal
    LeadConvertModal.jsx  ← convert to customer modal
    FollowUpWidget.jsx    ← follow-up date+time picker + notes
    ActivityFeed.jsx      ← chronological activity log
    CustomerFormDrawer.jsx← add/edit customer drawer
    CustomerDocuments.jsx ← upload/view documents
    QuotationSendModal.jsx← send quotation email modal (reuses leadQuotationService)
```

### 3.2 `leadCrmApi.js` — all API functions:

```javascript
// Leads
export const getLeads = (params) => api.get('/leads', { params });
export const getLead = (id) => api.get(`/leads/${id}`);
export const createLead = (data) => api.post('/leads', data);
export const updateLeadStatus = (id, data) => api.put(`/leads/${id}/status`, data);
export const updateLeadBasic = (id, data) => api.put(`/leads/${id}/basic`, data);
export const updateLeadProfile = (id, data) => api.put(`/leads/${id}/profile`, data);
export const convertToCustomer = (id) => api.post(`/leads/${id}/convert`);
export const getLeadConversion = (id) => api.get(`/leads/${id}/conversion`);
export const getLeadStages = () => api.get('/leads/stages');
export const addLeadRemark = (id, data) => api.post(`/leads/${id}/remarks`, data);
export const updateFollowUp = (id, data) => api.put(`/leads/${id}/follow-up`, data);
export const sendLeadQuotation = (id, data) => api.post(`/leads/${id}/send-quotation`, data);
export const getLeadAddresses = (id) => api.get(`/leads/${id}/addresses`);
export const addLeadAddress = (id, data) => api.post(`/leads/${id}/addresses`, data);
export const exportLeadsCsv = (params) => api.get('/leads/export-csv', { params, responseType: 'blob' });
export const importLeadsCsv = (formData) => api.post('/leads/upload', formData);
export const assignLeads = (data) => api.post('/leads/assign', data);
export const runResearch = (id) => api.post(`/leads/${id}/research`);

// Follow-ups
export const getFollowUps = (params) => api.get('/leads/follow-ups', { params });

// Customers
export const getCustomers = (params) => api.get('/customer-management/customers', { params });
export const getCustomer = (id) => api.get(`/customer-management/customers/${id}`);
export const createCustomer = (data) => api.post('/customer-management/customers', data);
export const updateCustomer = (id, data) => api.put(`/customer-management/customers/${id}`, data);

// Customer documents
export const getCustomerDocuments = (customerId) =>
  api.get(`/customer-documents/${customerId}`);
export const uploadCustomerDocument = (customerId, formData) =>
  api.post(`/customer-documents/${customerId}/upload`, formData,
    { headers: { 'Content-Type': 'multipart/form-data' } });
export const deleteCustomerDocument = (customerId, docId) =>
  api.delete(`/customer-documents/${customerId}/${docId}`);
```

### 3.3 `leadConstants.js`

```javascript
export const LEAD_STATUSES = [
  'Pending','Cold','Warm','Hot','Deal','Demo','Call Back','Hold','Gone','Rejected'
];

export const STATUS_COLORS = {
  Pending:   { bg: 'bg-gray-100',   text: 'text-gray-700'  },
  Cold:      { bg: 'bg-blue-100',   text: 'text-blue-700'  },
  Warm:      { bg: 'bg-amber-100',  text: 'text-amber-700' },
  Hot:       { bg: 'bg-orange-100', text: 'text-orange-700'},
  Deal:      { bg: 'bg-green-100',  text: 'text-green-700' },
  Demo:      { bg: 'bg-purple-100', text: 'text-purple-700'},
  'Call Back':{ bg: 'bg-cyan-100',  text: 'text-cyan-700'  },
  Hold:      { bg: 'bg-yellow-100', text: 'text-yellow-700'},
  Gone:      { bg: 'bg-red-100',    text: 'text-red-700'   },
  Rejected:  { bg: 'bg-rose-100',   text: 'text-rose-700'  },
};

export const INQUIRY_TYPES = ['rental','sales','both'];

export const LEAD_SOURCES = [
  'Email','Walk-in','Reference','Website','Cold Call','LinkedIn',
  'WhatsApp','Just Dial','IndiaMART','Other'
];

export const USE_CASES = ['Work From Office','Work From Home','Both'];

export const COMPANY_TYPES = [
  'Pvt Ltd','LLP','Proprietorship','Partnership','Startup',
  'NGO','Government','Other'
];

export const LAPTOP_BRANDS = [
  'Dell','HP','Lenovo','Apple','Asus','Acer','MSI','Samsung','Any'
];

export const PROCESSORS = [
  'Intel Core i3','Intel Core i5','Intel Core i7','Intel Core i9',
  'AMD Ryzen 3','AMD Ryzen 5','AMD Ryzen 7','Apple M1','Apple M2','Apple M3'
];

export const GENERATIONS = [
  '6th Gen','7th Gen','8th Gen','9th Gen','10th Gen',
  '11th Gen','12th Gen','13th Gen','14th Gen'
];

export const RAM_OPTIONS  = ['4 GB','8 GB','12 GB','16 GB','24 GB','32 GB'];
export const STORAGE_OPTIONS = ['128 GB SSD','256 GB SSD','512 GB SSD','1 TB SSD','1 TB HDD'];

// Stages fetched from API — use getLeadStages() and cache in context
// DO NOT hardcode stage lists here
```

### 3.4 `LeadListPage.jsx` — Full Spec

**Route:** `/lead-crm/leads`

**Header:**
- Title "Leads" + subtitle "Manage your sales pipeline"
- Stats row (4 cards):
  Total Leads | Active (not Gone/Rejected) | Follow-up Today | Converted (Deal/Demo)
- Right side: `+ Add Lead` (blue) | `Import CSV` (outline) | `Export CSV` (outline)

**View toggle:** Kanban | Table (localStorage preference)

**Filter bar:**
- Search (name, company, phone, email, city)
- Status multi-select dropdown (all statuses)
- Assigned To dropdown (all users — admin/manager sees all, sales sees own)
- Source dropdown
- Inquiry Type (Rental / Sales / Both)
- Date range picker (created_at)
- Follow-up: Today | This Week | Overdue
- `Clear filters` link

**Kanban view:**
- 10 columns — one per status, in order:
  Pending | Cold | Warm | Hot | Deal | Demo | Call Back | Hold | Gone | Rejected
- Each column: status label + count + total quantity badge (sum of quantity_required)
- Columns `Deal` and `Demo` have green header
- Columns `Gone` and `Rejected` have red/rose header
- Cards: `LeadCard` component
- Drag cards between columns to change status (calls updateLeadStatus API)
  Use HTML5 drag-and-drop (no external library needed)
- Columns scroll independently (overflow-y-auto, max-h-[calc(100vh-220px)])

**Table view:**
- Columns: # | Company | Contact | Phone | City | Config Required | Qty |
  Inquiry | Status | Stage | Assigned | Follow-up | Last Activity | Actions
- Config Required: shows `i5 10th | 8GB | 256GB` format
- Follow-up: red if overdue, amber if today, green if future
- Last Activity: relative time ("2h ago", "3 days ago")
- Actions: View | Quick status change | Quick assign
- Sortable columns: Company, Created, Follow-up, Last Activity
- Pagination: 25 per page

**Bulk actions (table view, when rows selected):**
- Assign to user
- Export selected
- Change status (for admin/manager only)

### 3.5 `LeadCard.jsx` — Kanban Card

```
[INQUIRY BADGE: Rental/Sales/Both]        [FOLLOW-UP indicator]
Company Name (bold)
Contact Person · Designation
📞 Phone  📧 Email (truncated)
─────────────────────────────────
Config: i5 10th | 8GB | 256GB
Qty: 5 units · Budget: ₹8,000/mo
─────────────────────────────────
City: Delhi  Source: Email
Stage: [stage badge]
─────────────────────────────────
👤 Assigned: Ravi Kumar
⏰ Follow-up: 12 Jun 2025 10:30 AM   ← red if overdue
🕐 Last activity: 2h ago
```

Click card → navigate to LeadDetailPage.
Drag handle (⠿ icon) on left side for drag-to-reorder.

### 3.6 `LeadDetailPage.jsx`

**Route:** `/lead-crm/leads/:id`

**Layout:** Two-column on desktop (left 60% | right 40%).

**Left side — tabbed:**

**Tab 1: Activity & Remarks**
- Input box at top: "Add remark..." with Post button
- Chronological activity feed (from lead_activities + lead_assignments):
  - Status change: "Status changed from Cold → Warm by Ravi Kumar — 2 days ago"
  - Remark added: avatar + text + time
  - Follow-up set: "Follow-up scheduled for 15 Jun 10:30 AM"
  - Quotation sent: "Quotation EST-0025 sent to contact@company.com"
  - Assignment: "Assigned to Priya Sharma by Manager"
  - Converted: "Converted to customer — Customer ID 45"
- Filter chips: All | Status Changes | Remarks | Follow-ups | Quotations

**Tab 2: Lead Profile** (all editable inline — click to edit)
```
Section: Basic Info
  Company Name | Brand (company brand)
  Contact Name | Designation
  Email | Phone | WhatsApp

Section: Requirement
  Inquiry Type (Rental/Sales/Both)
  Laptop Brand | Processor | Generation
  RAM | Storage | Quantity | Budget/unit
  Rental Duration (months) | Use Case

Section: Company Details
  Company Type | Company Size | Industry
  Annual Revenue | GST Number | PAN Number

Section: Address
  State | City | Pincode
  Billing Address (textarea)
  Shipping same as billing? (toggle)
  Shipping Address (shows if toggle off)

Section: CRM
  Source | Assigned To (dropdown)
  Follow-up Date + Time
```
- Each section has Edit button that makes fields editable
- Save/Cancel buttons appear when editing
- On save: calls PUT /api/leads/:id/profile
- Shows green toast on save

**Tab 3: Follow-ups**
- `FollowUpWidget` — date picker + time picker + notes
- History of past follow-ups with completion status
- Quick reschedule button on overdue items

**Tab 4: Quotations** (reuses existing quotation flow)
- List of quotations sent for this lead
- `Send Quotation` button → opens QuotationSendModal
- Each quotation: EST-number | Date sent | Status (pending/accepted)

**Tab 5: Addresses**
- Existing lead addresses (billing/shipping)
- Add address button

**Right sidebar (sticky):**
```
[STATUS BADGE — large, colored]
[STAGE badge below]

Quick Actions:
  [Change Status] button → opens LeadStatusModal
  [Set Follow-up] button → opens FollowUpWidget inline
  [Send Quotation] button
  [Convert to Customer] button → only if status = Deal or Demo

Lead Info:
  Lead ID: #123
  Created: 10 Jun 2025
  Last Activity: 2h ago
  Assigned To: Ravi Kumar [reassign link]
  Source: Email
  Inquiry: Rental

Requirement Summary:
  Config: i5 10th | 8GB | 256
  Qty: 5 units
  Budget: ₹8,000/mo
  Duration: 12 months

[If converted]:
  ✅ Converted to Customer
  Customer: [name] → link to CustomerDetailPage
  Date: 15 Jun 2025
```

**Back button:** "← Back to Leads"

### 3.7 `LeadStatusModal.jsx`

Triggered from "Change Status" quick action.

```
Modal title: "Update Lead Status"

Current status: [badge]

New Status: [dropdown — all 10 statuses]
Stage: [conditional dropdown — stages for selected status]
  (hidden if status has no stages, e.g. Deal/Demo/Call Back)
Rejection Reason: [dropdown — only if status = Rejected]

Remarks: [textarea — required for all status changes]

[Cancel] [Update Status]
```

On submit:
- Calls PUT /api/leads/:id/status
- On Deal or Demo: shows info banner "This lead is ready to convert to customer"
- Refreshes lead detail page

### 3.8 `LeadFormDrawer.jsx` — Add/Edit Lead

Slide-in drawer from right (560px wide, full screen mobile).
Sticky header (title + close), scrollable body, sticky footer (Cancel + Save).

**Sections:**

**Section 1 — Basic Info** (required)
```
Row 1: Company Name* | Brand (company brand)
Row 2: Contact Name* | Designation
Row 3: Email | Phone* | WhatsApp
Row 4: Source* (dropdown) | Inquiry Type* (Rental/Sales/Both)
Row 5: City* | State | Pincode
```

**Section 2 — Requirement**
```
Row 1: Laptop Brand (dropdown) | Processor (dropdown) | Generation (dropdown)
Row 2: RAM (dropdown) | Storage (dropdown)
Row 3: Quantity Required | Monthly Budget per unit (₹) | Rental Duration (months)
Row 4: Use Case (dropdown: WFO / WFH / Both)
```

**Section 3 — Company Info** (optional but encouraged)
```
Row 1: Company Type | Company Size (employees)
Row 2: Industry | Annual Revenue
Row 3: GST Number | PAN Number
```

**Section 4 — CRM Assignment**
```
Row 1: Assign To (user dropdown — admin/manager sees all users)
Row 2: Follow-up Date | Follow-up Time
Row 3: Initial Remarks (textarea)
```

**Validation:**
- Company Name: required
- Phone: required, 10 digits
- Source: required
- Inquiry Type: required
- Show red border + error message below on blur

**On save (Add mode):**
- POST /api/leads
- Auto-assign if no user selected (backend round-robin)
- Close drawer + show toast "Lead added" + refresh list

**On save (Edit mode):**
- PUT /api/leads/:id/profile (for profile fields)
- PUT /api/leads/:id/basic (for name/phone/email)

### 3.9 `LeadConvertModal.jsx`

Triggered from "Convert to Customer" in LeadDetailPage.

```
Modal: "Convert Lead to Customer"
⚠ Only shown when lead.status is 'Deal' or 'Demo'

Pre-filled from lead data (editable):
  Customer Name: [lead.name]
  Company Name: [lead.companyName]
  Email: [lead.email]
  Phone: [lead.phone]
  GST No: [lead.gst_number]
  PAN No: [lead.pan_number]

Billing Address Section:
  Address* | City* | State* | Pincode*

Shipping same as billing? [toggle]
  If no: Shipping Address | City | State | Pincode

[Cancel] [Convert to Customer]
```

On submit:
- Calls POST /api/leads/:id/convert
- On success: navigate to `/lead-crm/customers/:customer_id`
- Show toast "Customer profile created successfully"

### 3.10 `FollowUpCalendarPage.jsx`

**Route:** `/lead-crm/follow-ups`

**Layout:** Two panels — Calendar left (60%) | Today's list right (40%)

**Calendar panel:**
- Monthly calendar (build with date-fns, no external calendar library)
- Each day shows dot(s) for follow-ups on that day:
  - Red dot: overdue (follow_up_date < today)
  - Amber dot: today
  - Blue dot: future
- Click day → shows leads with follow-ups that day in right panel

**Right panel (default: Today):**
- Title: "Follow-ups — [selected date]"
- List of leads with follow-up on selected date:
  Each item: Company | Contact | Phone | Status badge | Time | Quick actions
  Quick actions: Mark Done (reschedule) | Call | WhatsApp link
- Overdue section (separate, red-bordered): leads with follow_up_date < today
- Count badges on panel header: "Today (5) | Overdue (3)"

**Mark Done flow:**
- Opens small modal: "Reschedule follow-up OR mark as done"
  - Reschedule: new date + time picker + notes → updates follow-up
  - Mark done: add remark + optionally change status

### 3.11 `CustomerListPage.jsx`

**Route:** `/lead-crm/customers`

**Header:**
- Title "Customers"
- Stats: Total | Active (with active orders) | KYC Verified | Portal Enabled
- `+ Add Customer` (blue) | `Export` (outline)

**Filter bar:** Search | Status | KYC Status | Source | City | Date range

**Table columns:**
Customer ID | Company | Contact | Phone | Email | GST | City | Active Laptops |
Portal | KYC | Actions

- Active Laptops: count badge (from vendor_serial_numbers dispatched to this customer)
- Portal: green dot "Enabled" / gray dot "Disabled"
- KYC: green "Verified" / amber "Pending"
- Actions: View | Edit | Portal Access | Verify KYC

### 3.12 `CustomerDetailPage.jsx`

**Route:** `/lead-crm/customers/:id`

**Tabs:**

**Tab 1: Profile**
- All customer fields editable inline
- Company info, GST, PAN, addresses (billing + shipping)

**Tab 2: Documents** (`CustomerDocuments` component)
Upload/view section with grouped document types:
```
[+ Upload Document] button → opens file picker
  Fields: Document Type* (dropdown) | Label | Signed Agreement? (toggle) | Notes

Documents grouped by type:
  📄 GST Certificate: [filename] [download] [delete]
  📄 PAN Card: [filename] [download] [delete]
  📋 Agreement: [filename] [Signed badge] [download] [delete]
  🪪 KYC ID: [filename] [download] [delete]
```
[Verify KYC] button at top right — marks kyc_verified = true,
only accessible by admin/manager.

**Tab 3: Laptops** (their active rental/purchased laptops)
- Table: TTSPL ID | Brand | Config | Dispatch Date | Monthly Rate | Status
- Clicking TTSPL ID → opens TtsplHistoryDrawer (imported from floor-pipeline)

**Tab 4: Orders**
- All orders for this customer (from orders table)
- Link to SO/DC numbers

**Tab 5: Lead Origin**
- If customer was converted from lead: shows lead details, conversion date, by whom
- If added directly: shows creation date

**Tab 6: Portal Access**
- Toggle portal_enabled
- Send welcome email button
- Last login timestamp

### 3.13 `QuotationSendModal.jsx`

Triggered from Lead Detail → Quotations tab → "Send Quotation" button.
Reuses existing `leadQuotationService` on backend.

```
Modal: "Send Quotation"

Customer Email: [pre-filled from lead.email, editable]
CC: [multi-email input — add sender + manager auto-CC]
Subject: [pre-filled: "Laptop Rental Quotation — [CompanyName]"]

Line Items (dynamic rows):
  Brand | Processor | Gen | RAM | Storage | Qty | Rate/unit/month | Total
  [+ Add Row] button

Quotation Notes (textarea)
Validity: [date picker] (default: 7 days from today)
Terms: [textarea with default text]

[Cancel] [Preview PDF] [Send Quotation]
```

On Send:
- Calls POST /api/leads/:id/send-quotation
- Shows EST-XXXX number in success toast
- Adds to Quotations tab list

---

## SECTION 4 — ROUTING & MENU CONFIG

### 4.1 Add to `frontend/src/routes/index.jsx`:

```javascript
import LeadCrmApp from '../features/lead-crm/LeadCrmApp';

// Add to appRoutes:
{
  path: '/lead-crm/*',
  element: (
    <ProtectedRoute section="leads" action="view">
      <Layout><LeadCrmApp /></Layout>
    </ProtectedRoute>
  )
}
```

### 4.2 `LeadCrmApp.jsx`:

```javascript
import { Routes, Route, Navigate } from 'react-router-dom';
import LeadListPage from './pages/LeadListPage';
import LeadDetailPage from './pages/LeadDetailPage';
import FollowUpCalendarPage from './pages/FollowUpCalendarPage';
import CustomerListPage from './pages/CustomerListPage';
import CustomerDetailPage from './pages/CustomerDetailPage';

export default function LeadCrmApp() {
  return (
    <Routes>
      <Route index element={<Navigate to="leads" replace />} />
      <Route path="leads" element={<LeadListPage />} />
      <Route path="leads/:id" element={<LeadDetailPage />} />
      <Route path="follow-ups" element={<FollowUpCalendarPage />} />
      <Route path="customers" element={<CustomerListPage />} />
      <Route path="customers/:id" element={<CustomerDetailPage />} />
    </Routes>
  );
}
```

### 4.3 Update `frontend/src/config/menuConfig.js`:

**Replace existing lead/customer entries** with Lead CRM accordion:

```javascript
export const leadCrmAccordionChildren = [
  { label: 'Leads Pipeline',   path: '/lead-crm/leads',       section: 'leads',
    countKey: 'active_leads' },
  { label: 'Follow-ups',       path: '/lead-crm/follow-ups',  section: 'lead_follow_ups',
    countKey: 'followups_today' },
  { label: 'Customers',        path: '/lead-crm/customers',   section: 'customers' },
];
```

In MENU_GROUPS, replace old Leads + Customers entries with:
```javascript
{
  type: 'leadCrmAccordion',
  label: 'Lead & Sales CRM',
  icon: Users,                   // lucide-react
  section: 'leads',
  children: leadCrmAccordionChildren
}
```

Add count badges to sidebar:
- "Leads Pipeline" shows count of active leads (non-Gone/Rejected)
- "Follow-ups" shows today's follow-up count

---

## SECTION 5 — ROLE-BASED VISIBILITY RULES

Enforce in both backend (checkRole middleware) and frontend (PermissionGate):

| Action                            | Roles Allowed                   |
|-----------------------------------|---------------------------------|
| View lead list (own leads)        | sales, manager, admin           |
| View all leads                    | manager, admin                  |
| Add lead                          | sales, manager, admin           |
| Change status                     | sales (own), manager, admin     |
| Convert to customer               | sales (own), manager, admin     |
| Delete lead                       | manager, admin                  |
| Bulk assign                       | manager, admin                  |
| Upload customer documents         | sales, manager, admin, accounts |
| Delete customer documents         | manager, admin                  |
| Verify KYC                        | manager, admin                  |
| Toggle customer portal            | admin, manager                  |
| View customer list                | sales, manager, admin, accounts |
| Edit customer profile             | sales (own conversion), manager, admin |

**Frontend enforcement:**
- Sales role: `getLeads` API called with `?assigned_to=me` automatically
- "Convert to Customer" button hidden unless status = Deal/Demo
- "Delete" buttons wrapped in `<PermissionGate section="leads" action="delete">`
- "Verify KYC" button wrapped in `<PermissionGate section="customer_documents" action="edit">`
- Import CSV, Bulk Assign: `<PermissionGate section="leads" action="create">`

---

## SECTION 6 — SETTINGS PAGE UPDATES

Migration 057 adds 2 new permission sections:
`lead_conversion` and `customer_documents`.

These will **automatically appear** in Settings → Role Permissions matrix
after the migration runs (the page fetches sections from API dynamically).

No additional settings page changes needed for Phase 3.

---

## SECTION 7 — BUILD ORDER

Build in this exact order:

1. Run migration `057_phase3_lead_crm.sql`
2. Update `backend/prisma/schema.prisma` — add Lead model fields
3. Run `npx prisma generate` in backend/
4. Update `backend/controllers/leadController.js` — add new exports
5. Update `backend/routes/leads.js` — add new routes
6. Create `backend/controllers/customerDocumentController.js`
7. Create `backend/routes/customerDocuments.js`
8. Mount new route in `backend/server.js`
9. Create `frontend/src/features/lead-crm/leadConstants.js`
10. Create `frontend/src/features/lead-crm/leadCrmApi.js`
11. Create all components (LeadCard, LeadFormDrawer, LeadStatusModal,
    LeadConvertModal, FollowUpWidget, ActivityFeed, CustomerFormDrawer,
    CustomerDocuments, QuotationSendModal)
12. Create all pages (LeadListPage, LeadDetailPage, FollowUpCalendarPage,
    CustomerListPage, CustomerDetailPage)
13. Create `LeadCrmApp.jsx`
14. Update `frontend/src/routes/index.jsx`
15. Update `frontend/src/config/menuConfig.js`
16. Verify all role-based visibility works

---

## SECTION 8 — QUALITY CHECKLIST

**Database:**
- [ ] Migration 057 runs clean
- [ ] All new lead columns exist on `leads` table
- [ ] All new customer columns exist on `customers` table
- [ ] `customer_documents` table created
- [ ] `lead_conversion` and `customer_documents` sections in Settings → Role Permissions

**Backend:**
- [ ] `GET /api/leads/stages` returns stages grouped by status
- [ ] `PUT /api/leads/:id/profile` saves all new fields and logs activity
- [ ] `POST /api/leads/:id/convert` creates customer, links to lead, returns customer_id
- [ ] `POST /api/leads/:id/convert` blocked if status not Deal/Demo
- [ ] `POST /api/customer-documents/:id/upload` stores file + DB record
- [ ] `GET /api/customer-documents/:id` returns grouped documents
- [ ] Sales role: GET /api/leads returns only own leads (unless manager/admin)

**Frontend:**
- [ ] Kanban board shows all 10 status columns
- [ ] Drag-and-drop between kanban columns works and calls API
- [ ] Table view with all 14 columns, pagination, sort
- [ ] LeadFormDrawer has all 4 sections, validation works
- [ ] Status change logs activity in feed
- [ ] "Convert to Customer" only visible when status = Deal or Demo
- [ ] LeadConvertModal pre-fills from lead, creates customer on submit
- [ ] CustomerDetailPage has all 6 tabs
- [ ] Documents upload, group by type, download works
- [ ] TtsplHistoryDrawer opens correctly from Customer → Laptops tab
- [ ] FollowUpCalendarPage: overdue in red, today in amber, future in blue
- [ ] QuotationSendModal sends email and shows EST number
- [ ] Follow-up date shown in red in table if overdue
- [ ] Lead CRM menu shows count badges for active leads + today's follow-ups
- [ ] All pages mobile-responsive at 375px
- [ ] Sales role only sees own leads in list
- [ ] Settings → Role Permissions shows lead_conversion, customer_documents

---

## SECTION 9 — NAMING REFERENCE

| Concept               | Correct Name                     | Wrong (do not use)           |
|-----------------------|----------------------------------|------------------------------|
| Feature folder        | `lead-crm`                       | leads, lead_crm, leadCRM     |
| Route prefix          | `/lead-crm/`                     | /leads/, /crm/               |
| Lead status           | `Deal` (capital D)               | deal, DEAL, closed           |
| Lead status           | `Call Back` (two words)          | Callback, call_back          |
| Lead status           | `Gone` (not Lost)                | Lost, lost, GONE             |
| Permission section    | `lead_conversion`                | lead_convert, conversion     |
| Permission section    | `customer_documents`             | customer_docs, documents     |
| Customer doc types    | `gst_certificate`, `pan_card`,   | gst, pan, doc, file          |
|                       | `agreement`, `kyc_id`, `other`   |                              |
| Inquiry type          | `rental`, `sales`, `both`        | Rental, RENTAL, rent         |
| Follow-up field       | `follow_up_date` + `follow_up_time` | followup, followUpDate    |
| Conversion action     | `converted_to_customer`          | converted, lead_converted    |
| Activity action       | `profile_updated`                | updated, edit, changed       |
| Status change activity| `status_changed`                 | status_update, changed       |

---

*End of Phase 3 prompt. Build Sections 1–5 in the order given in Section 7.*
*After completion, verify Section 8 checklist before moving to Phase 4 (Sales Orders + Delivery).*

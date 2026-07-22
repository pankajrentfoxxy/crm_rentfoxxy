# RENTFOXXY CRM — PHASE 13 BUILD PROMPT
## Complete End-to-End Delivery Flow
## SO Addresses → DC → Dispatch → Technician Bucket → OTP → POD → Confirmation
### Branch: new_crm_rentfoxxy

---

## AGENT RULES — READ FIRST

- This phase is built on top of the existing working flow:
  SO → serial attachment → Dispatch QC → DC creation.
- All existing tables (delivery_challan_lines, sales_order_serials,
  delivery_technicians, etc.) are extended, not replaced.
- Do NOT change the quotation or billing flows.
- Three separate React apps: CRM (3000), vendor-portal (3001),
  customer-portal (3002). Technician bucket lives in CRM.
- Design system: same as all previous phases.
- OTP is currently admin-visible in Delivery Register. In this phase,
  OTP is also emailed to the SALES email (SMTP_FROM / SMTP_USER).
  Future: OTP to customer email.
- E-sign and POD photo are stored as file uploads (existing multer setup).

---

## SECTION 1 — DATABASE MIGRATIONS

### Migration 086_delivery_flow_complete.sql

```sql
-- ============================================================
-- Migration 086: Complete delivery flow
-- - Per-serial delivery addresses on SO
-- - DC per-serial tracking (one DC = one or more serials,
--   each with its own delivery address)
-- - Porter tracking fields
-- - Technician bucket enhancements
-- - OTP delivery to sales email
-- - POD (Proof of Delivery) — photo upload + e-sign
-- - Technician reached / location capture
-- ============================================================

-- 1. Per-serial delivery addresses on sales_order_serials
ALTER TABLE sales_order_serials
  ADD COLUMN IF NOT EXISTS delivery_address  JSONB,
  ADD COLUMN IF NOT EXISTS delivery_notes    TEXT,
  ADD COLUMN IF NOT EXISTS is_wfh            BOOLEAN DEFAULT FALSE;
-- delivery_address: { name, phone, address, city, state, pincode, landmark }
-- is_wfh: true when technician delivers to employee's home address

-- 2. DC enhancements
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS porter_tracking_id   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS porter_order_id      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS porter_booking_url   TEXT,
  ADD COLUMN IF NOT EXISTS courier_tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS dispatched_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reached_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tech_latitude        VARCHAR(64),
  ADD COLUMN IF NOT EXISTS tech_longitude       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS serial_verified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS serial_verified_no   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS otp_code             VARCHAR(10),
  ADD COLUMN IF NOT EXISTS otp_sent_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_photo_url        TEXT,
  ADD COLUMN IF NOT EXISTS esign_url            TEXT,
  ADD COLUMN IF NOT EXISTS pod_submitted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_submitted_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS delivery_notes       TEXT;

-- 3. Update DC status to include full lifecycle
ALTER TABLE delivery_challan_lines
  DROP CONSTRAINT IF EXISTS delivery_challan_lines_status_check;
ALTER TABLE delivery_challan_lines
  ADD CONSTRAINT delivery_challan_lines_status_check
  CHECK (status IN (
    'pending',      -- DC created, not dispatched
    'processing',   -- being prepared / QC passed
    'shipped',      -- courier/porter dispatched
    'in_transit',   -- inhouse tech picked up
    'reached',      -- tech marked as reached at location
    'delivered',    -- OTP verified + POD submitted
    'rejected',     -- delivery rejected by customer
    'cancelled'
  ));

-- 4. Technician bucket view permissions
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('technician_bucket', 'Delivery Technician Bucket', 176)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',    'technician_bucket', true, false, true, false),
  ('manager',  'technician_bucket', true, false, true, false),
  ('sales',    'technician_bucket', true, false, false, false),
  ('dispatch', 'technician_bucket', true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;

-- 5. Document sequences
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('delivery_challan', 0, 'DC-')
ON CONFLICT (doc_type) DO NOTHING;
```

---

## SECTION 2 — FLOW OVERVIEW

```
QUOTATION (EST-XXXX)
  → SALES ORDER (SO-XXXX)
       ↓
       Warehouse attaches laptops (sales_order_serials)
       Each serial gets a delivery_address (billing / saved / WFH manual)
       ↓
       Dispatch QC ticket auto-created per serial
       ↓
       Dispatch QC PASS → serial.qc_status = 'passed'
       ↓
DELIVERY CHALLAN (DC-XXXX)
  Created from QC-passed serials
  ONE DC = ONE or MORE serials going to SAME address on SAME day
  (For 10 laptops to 10 addresses → 10 DCs)
  Each DC has:
    - Dispatch mode: Courier | Porter | Inhouse Technician
    - Courier: courier_name + awb_number + tracking URL
    - Porter: booking_id + order_id + booking URL
    - Inhouse: delivery_technician_id (from delivery_technicians table)
  ↓
DISPATCH
  Courier/Porter: status → 'shipped', dispatched_at = NOW()
  Inhouse: status → 'in_transit', goes to technician bucket
  ↓
TECHNICIAN BUCKET (inhouse only)
  Tech logs in → sees their assigned DCs:
    Customer name | Address | Phone | Laptop details (TTSPL, Brand, Config)
  Tech clicks "Mark as Reached":
    → Captures lat/lng (browser geolocation)
    → Status → 'reached'
  Tech enters serial number of laptop they are delivering:
    → Backend validates serial against DC
  OTP generated → shown in Delivery Register for admin
  OTP emailed to SMTP_FROM sales email
  (Future: emailed to customer)
  Tech enters OTP customer gives verbally:
    → OTP verified
  Tech uploads POD photo OR customer e-signs on screen:
    → pod_photo_url or esign_url stored
  Tech clicks "Confirm Delivery":
    → Status → 'delivered', delivered_at = NOW()
    → vendor_serial_numbers.inventory_status → 'out_stock'
    → billing rent_start_date updated
  ↓
DELIVERY REGISTER
  Admin/Sales sees all DCs with status timeline
  OTP visible in register (for verbal confirmation)
  POD photo/e-sign viewable
  Can manually override status if needed
```

---

## SECTION 3 — SALES ORDER: PER-SERIAL DELIVERY ADDRESSES

### 3A — Backend: Add delivery address endpoints

In `backend/controllers/salesManagementController.js`:

**`exports.updateSoSerialAddress`**
`PATCH /api/sales-management/so-serials/:allocationId/address`
Role: sales, manager, admin, warehouse

```javascript
// Body: { delivery_address, is_wfh, delivery_notes }
// delivery_address: { name, phone, address, city, state, pincode, landmark? }
// Updates sales_order_serials.delivery_address, .is_wfh, .delivery_notes
// Returns: { success: true, allocation_id, delivery_address }
```

**`exports.bulkUpdateSoSerialAddresses`**
`PATCH /api/sales-management/sales-orders/:soNumber/serial-addresses`
Role: sales, manager, admin, warehouse

```javascript
// Body: { addresses: [{ allocation_id, delivery_address, is_wfh, delivery_notes }] }
// Bulk update multiple serials at once
// Used when "Same address for all" or pasting addresses
// Returns: { success: true, updated: N }
```

Add routes to `backend/routes/salesManagement.js`:
```javascript
router.patch('/so-serials/:allocationId/address', authMiddleware, ctrl.updateSoSerialAddress);
router.patch('/sales-orders/:soNumber/serial-addresses', authMiddleware, ctrl.bulkUpdateSoSerialAddresses);
```

### 3B — Frontend: SalesOrderDetailPage — Serial Address Panel

In `frontend/src/features/sales-pipeline/pages/SalesOrderDetailPage.jsx`,
add a new tab: **"Delivery Addresses"** (shown after laptops are attached).

This tab shows a table of attached serials and their delivery addresses:

```
DELIVERY ADDRESSES FOR SO-0001

[Same Address for All] button — sets all serials to billing address
[WFH — Enter per laptop] button — shows individual inputs

Table:
TTSPL ID | Brand/Config | Delivery Address | WFH? | Actions

Each row:
  TTSPL0012 | Dell i5 16GB | B-204 DLF Cyber City, Gurgaon | No | [Edit]
  TTSPL0013 | Dell i5 16GB | 12 Sector 7, HSR Layout       | Yes| [Edit]

Edit opens a small drawer:
  Delivery Contact Name*: (pre-fills customer name)
  Phone*: (pre-fills customer phone)
  Address*: textarea
  City* | State* | Pincode*
  Landmark: optional
  Is WFH delivery?: toggle
    Yes → shows: Employee Name | Employee Phone
  Notes: (e.g. "Call before arriving", "Gate no. 3")
  [Save Address]

"Same Address for All" → sets delivery_address to customer_shipping_address
for ALL unassigned serials for this SO.

"Copy Billing Address" → per-serial option in edit drawer.
```

### 3C — Show delivery address on DCForm

When creating a DC from attached serials, the DCForm must show the
delivery address that was set on each serial.

In `frontend/src/features/sales-pipeline/components/DCForm.jsx`:

When `use_attached` mode is true (serials already attached), show for each
serial its `delivery_address` from `sales_order_serials`.

If all serials in the DC have the same delivery_address → show once.
If different → warn: "These serials have different delivery addresses.
Consider creating separate DCs for each address."

Pass `delivery_address` from the first serial as the DC's shipping address.

---

## SECTION 4 — DELIVERY CHALLAN: DISPATCH FLOW

### 4A — Backend: DC dispatch endpoint

Update `exports.dispatchDc` in `salesManagementController.js`:

```javascript
// PATCH /api/sales-management/delivery-challans/:dcNumber/dispatch
// Body:
//   ship_by: 'by_courier' | 'by_porter' | 'by_hand'
//   For courier: { courier_name, awb_number, courier_tracking_url? }
//   For porter: { porter_tracking_id, porter_order_id, porter_booking_url? }
//   For inhouse: { delivery_person_id }  (delivery_technicians.technician_id)
//
// Actions:
//   Courier → status='shipped', dispatched_at=NOW()
//   Porter  → status='shipped', dispatched_at=NOW()
//   Inhouse → status='in_transit', dispatched_at=NOW()
//   In all cases: update vendor_serial_numbers.inventory_status='out_stock'
//                 update sales_order_serials.status='dispatched'
//                 log to ttspl_audit_log: event='dispatched'
```

### 4B — Backend: Technician reached endpoint

New: `exports.markTechReached`
`PATCH /api/sales-management/delivery-challans/:dcNumber/reached`
Role: dispatch (technician), admin, manager

```javascript
// Body: { latitude, longitude }
// Actions:
//   status='reached', reached_at=NOW()
//   tech_latitude=latitude, tech_longitude=longitude
//   Log to activities: 'technician_reached'
// Returns: { success: true, otp_generated: false }
// (OTP is generated in next step after serial verification)
```

### 4C — Backend: Serial verification + OTP generation

New: `exports.verifySerialAndGenerateOtp`
`POST /api/sales-management/delivery-challans/:dcNumber/verify-serial`
Role: dispatch, admin

```javascript
// Body: { serial_number }  — serial number OR ttspl_id of the laptop
// Validates serial_number matches one of the DC's serial_number JSONB
// If valid:
//   otp_code = 6-digit random number
//   otp_sent_at = NOW()
//   serial_verified_at = NOW()
//   serial_verified_no = serial_number
//   UPDATE delivery_challan_lines SET otp_code=$1, otp_sent_at=NOW(), ...
//   Send email: to SMTP_FROM (sales email), subject: "Delivery OTP for DC-XXXX"
//     Body: "DC: DC-XXXX | Customer: [name] | Address: [address]
//            Laptop: TTSPL-XXXX [brand] [config]
//            OTP: XXXXXX
//            (Share this OTP verbally with the customer at delivery)"
//   Returns: { success: true, otp_visible: otp_code }
//   NOTE: Return otp_code only to admin/manager role, not to dispatch role
//   For dispatch role: { success: true, message: 'OTP sent. Ask customer for OTP.' }
```

### 4D — Backend: OTP verification + POD submission

Update `exports.submitDeliveryWithPod`:
`POST /api/sales-management/delivery-challans/:dcNumber/deliver`
Role: dispatch, admin
Multipart form (multer for file upload):

```javascript
// Body (multipart):
//   otp: string (OTP entered by technician after customer gives it)
//   pod_type: 'photo' | 'esign' | 'none'
//   pod_photo: file (if pod_type='photo')
//   esign_data: base64 string (if pod_type='esign', from signature pad)
//   notes: string (optional delivery notes)
//
// Validation:
//   Verify otp matches otp_code
//   If otp invalid: return 400 { message: 'Invalid OTP' }
//
// If valid:
//   status='delivered', delivered_at=NOW()
//   otp_verified_at=NOW()
//   pod_photo_url (if photo uploaded)
//   esign_url (if esign provided — save base64 as PNG file)
//   pod_submitted_at=NOW(), pod_submitted_by=req.user.user_id
//   delivery_notes=notes
//
//   Update vendor_serial_numbers for each serial in DC:
//     inventory_status='out_stock', rent_start_date=CURRENT_DATE
//
//   Update sales_order_serials for each serial:
//     status='dispatched', dc_number=dcNumber
//
//   Log ttspl_audit_log: event='delivered'
//
//   Send confirmation email to SMTP_FROM:
//     "Delivery confirmed for DC-XXXX | Customer: [name]
//      Delivered at: [datetime] | POD: [link if available]"
//
// Returns: { success: true, message: 'Delivery confirmed' }
```

### 4E — Backend: Manual admin override

`PATCH /api/sales-management/delivery-challans/:dcNumber/admin-deliver`
Role: admin, manager only

```javascript
// For cases where OTP flow is skipped (admin override)
// Body: { notes, reason }
// Does the same as deliver but without OTP check
// Marks pod_type='admin_override'
```

---

## SECTION 5 — BACKEND: FILE UPLOAD FOR POD

In `backend/routes/salesManagement.js`, add multer middleware for POD route:

```javascript
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const podStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/pod');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `pod_${req.params.dcNumber}_${Date.now()}${ext}`);
  }
});
const uploadPod = multer({
  storage: podStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files allowed'));
    }
    cb(null, true);
  }
});

// Route:
router.post('/delivery-challans/:dcNumber/deliver',
  authMiddleware,
  uploadPod.single('pod_photo'),
  ctrl.submitDeliveryWithPod
);
```

Also serve the uploads folder statically in server.js:
```javascript
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
```

---

## SECTION 6 — FRONTEND: DCForm UPDATES

File: `frontend/src/features/sales-pipeline/components/DCForm.jsx`

### 6A — Porter mode fields

Add Porter as a complete dispatch mode. Currently `by_porter` exists in the
select but has no fields. Add:

```jsx
{shipBy === 'by_porter' && (
  <div className="space-y-3 mt-3">
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        Porter Tracking ID / Booking ID*
      </label>
      <input
        className="w-full border rounded-lg px-3 py-2 text-sm"
        placeholder="e.g. PRT-2025060001"
        value={porterTrackingId}
        onChange={(e) => setPorterTrackingId(e.target.value)}
      />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        Porter Order ID (optional)
      </label>
      <input
        className="w-full border rounded-lg px-3 py-2 text-sm"
        placeholder="Porter platform order ID"
        value={porterOrderId}
        onChange={(e) => setPorterOrderId(e.target.value)}
      />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        Booking URL / Tracking Link (optional)
      </label>
      <input
        className="w-full border rounded-lg px-3 py-2 text-sm"
        placeholder="https://porter.in/track/..."
        value={porterBookingUrl}
        onChange={(e) => setPorterBookingUrl(e.target.value)}
      />
    </div>
  </div>
)}
```

### 6B — Inhouse Technician — only show delivery_technicians

Currently DCForm shows all users. Change it to only show users who have a
record in `delivery_technicians` table:

In `getDCMeta` backend endpoint, ensure `delivery_technicians` is returned
(already done via `meta.delivery_persons || meta.delivery_technicians`).

The select should show: `[First Name Last Name] — [Phone]`

```jsx
{shipBy === 'by_hand' && (
  <div className="mt-3">
    <label className="block text-xs font-medium text-gray-600 mb-1">
      Assign to Delivery Technician*
    </label>
    <select
      className="w-full border rounded-lg px-3 py-2 text-sm"
      value={deliveryPersonId}
      onChange={(e) => setDeliveryPersonId(e.target.value)}
    >
      <option value="">Select technician…</option>
      {(meta.delivery_technicians || [])
        .filter((t) => t.is_active)
        .map((t) => (
          <option key={t.technician_id} value={t.technician_id}>
            {t.first_name} {t.last_name} {t.phone ? `— ${t.phone}` : ''}
          </option>
        ))}
    </select>
    {!(meta.delivery_technicians || []).length && (
      <p className="text-xs text-amber-600 mt-1">
        No delivery technicians registered. Add via Settings → Delivery Technicians.
      </p>
    )}
  </div>
)}
```

### 6C — Show delivery address from attached serials

In the DC creation form, after the dispatch mode section, show:

```jsx
<div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
  <h4 className="text-xs font-semibold text-blue-900 uppercase mb-2">
    Delivery Address
  </h4>
  {deliveryAddress ? (
    <div className="text-sm text-blue-800">
      <p className="font-medium">{deliveryAddress.name}</p>
      <p>{deliveryAddress.phone}</p>
      <p>{deliveryAddress.address}</p>
      <p>{deliveryAddress.city}, {deliveryAddress.state} {deliveryAddress.pincode}</p>
      {deliveryAddress.landmark && <p className="text-xs text-blue-600">📍 {deliveryAddress.landmark}</p>}
    </div>
  ) : (
    <p className="text-xs text-amber-700">No delivery address set. Using billing address.</p>
  )}
</div>
```

---

## SECTION 7 — FRONTEND: TECHNICIAN BUCKET (CRM)

### 7A — New page: TechnicianBucketPage.jsx

File: `frontend/src/features/delivery-register-management/pages/TechnicianBucketPage.jsx`

**Route:** `/delivery-register/technician-bucket`

This page is visible to admin, manager, sales, dispatch roles.
It shows in-transit deliveries grouped by technician.

```
TECHNICIAN DELIVERY BUCKET

Filter: [All Technicians ▾] [Date Range] [Status: In Transit ▾]

── AMIT KAUR (3 active deliveries) ───────────────────────────────
  ┌─────────────────────────────────────────────────────────────┐
  │ DC-0025 • TechCorp Solutions                                │
  │ 📍 B-204 DLF Cyber City, Gurugram 122002                   │
  │ 📞 Amit Sharma — 9876500001                                 │
  │ 💻 TTSPL0012 | Dell Latitude | i5 10th | 16GB | 256GB      │
  │ Status: [In Transit 🔵] Since: 2h 15m ago                  │
  │ [Send OTP] [View OTP] [Mark Delivered] [Track Location]     │
  └─────────────────────────────────────────────────────────────┘

── RAHUL DAS (1 active delivery) ──────────────────────────────────
  [similar card]
```

**"View OTP" button** (admin/manager only):
Opens small modal showing: `OTP: 482913`
And the sent-at time.

**"Track Location" button** (if tech_latitude set):
Opens Google Maps link: `https://www.google.com/maps?q={lat},{lng}`

**"Mark Delivered" (admin override)**:
Opens modal: reason + notes → calls admin-deliver endpoint.

### 7B — Enhance DeliveryRegisterPage.jsx

Add OTP column to the in-transit tab:

```
DC # | Customer | Tech | Dispatch Mode | Dispatched | Status | OTP | Actions
```

OTP column:
- Not sent: `[Send OTP]` button
- Sent (pending): `482913` (visible to admin/manager) + timestamp
- Verified: `✓ Verified` green badge

Add "Porter" tab alongside Courier and Inhouse tabs:
```
[All] [Inhouse] [Courier] [Porter] [Delivered]
```

Porter rows show: Porter Tracking ID + booking URL link.

---

## SECTION 8 — FRONTEND: DELIVERY TECHNICIAN MOBILE VIEW

This is a dedicated view for delivery technicians when they log in.
It should appear in the Support section of the CRM sidebar (as specified).

### 8A — New page: MyDeliveriesPage.jsx

File: `frontend/src/features/delivery-register-management/pages/MyDeliveriesPage.jsx`

**Route:** `/delivery-register/my-deliveries`

**Access:** dispatch role (delivery technician)

When a dispatch user logs in, the dashboard redirects them here.
Update `frontend/src/pages/Dashboard.jsx` role redirect:

```javascript
const ROLE_REDIRECTS = {
  admin:   '/reports/manager-dashboard',
  manager: '/reports/manager-dashboard',
  dispatch: '/delivery-register/my-deliveries',  // ADD THIS
};
```

Page design (mobile-first, large touch targets):

```
MY DELIVERIES

[Today: 3] [All Active: 5]

── PENDING PICKUP ──────────────────────────────────────────────
  ┌──────────────────────────────────────────────────────────────┐
  │  DC-0025                                   [In Transit 🔵]  │
  │  ─────────────────────────────────────────────────────────  │
  │  👤 Amit Sharma — TechCorp Solutions                        │
  │  📞 9876500001                                              │
  │  📍 B-204, DLF Cyber City, Phase 2                          │
  │     Gurugram, Haryana 122002                                 │
  │                                                              │
  │  💻 Dell Latitude 3510                                      │
  │     TTSPL0012 | i5 10th | 16GB RAM | 256GB SSD             │
  │                                                              │
  │  [📍 Mark as Reached]    [🗺 Open in Maps]                 │
  └──────────────────────────────────────────────────────────────┘

── REACHED ─────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────────────────┐
  │  DC-0024                                   [Reached 🟡]     │
  │  ─────────────────────────────────────────────────────────  │
  │  👤 Sunita Reddy                                            │
  │  📞 9876500002                                              │
  │  📍 401, Jubilee Hills                                      │
  │                                                              │
  │  Step 1: Enter Laptop Serial                                 │
  │  ┌─────────────────────────────────┐ [Verify]              │
  │  │ Serial number / TTSPL ID        │                        │
  │  └─────────────────────────────────┘                        │
  │                                                              │
  │  (After verify → OTP sent to admin email)                   │
  │                                                              │
  │  Step 2: Enter OTP from Customer                            │
  │  ┌─────────────────────────────────┐ [Verify OTP]          │
  │  │ 6-digit OTP                     │                        │
  │  └─────────────────────────────────┘                        │
  └──────────────────────────────────────────────────────────────┘

── OTP VERIFIED (ready for POD) ────────────────────────────────
  ┌──────────────────────────────────────────────────────────────┐
  │  DC-0023                                  [OTP Verified 🟢] │
  │                                                              │
  │  Proof of Delivery:                                          │
  │  ○ 📷 Take Photo (laptop photo at customer site)            │
  │  ○ ✍ Customer E-Sign on screen                             │
  │  ○ Skip POD (no POD available)                              │
  │                                                              │
  │  [📷 Capture Photo]                                         │
  │  — OR —                                                      │
  │  [✍ Open Signature Pad]                                     │
  │                                                              │
  │  Notes: [optional delivery notes                        ]   │
  │                                                              │
  │  [✅ Confirm Delivery]                                      │
  └──────────────────────────────────────────────────────────────┘
```

### 8B — Mark as Reached flow

When tech clicks "Mark as Reached":

```javascript
const handleReached = async (dcNumber) => {
  // 1. Request geolocation
  if (!navigator.geolocation) {
    toast.error('Geolocation not available on this device');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        await markReached(dcNumber, { latitude: String(latitude), longitude: String(longitude) });
        toast.success('Marked as reached. Please verify the laptop serial next.');
        reload();
      } catch (e) {
        toast.error(e.response?.data?.message || 'Failed to mark reached');
      }
    },
    (err) => {
      // If geolocation denied, still mark reached without location
      markReached(dcNumber, { latitude: null, longitude: null })
        .then(() => { toast.success('Marked as reached (location unavailable)'); reload(); })
        .catch(() => toast.error('Failed'));
    },
    { timeout: 10000, maximumAge: 60000 }
  );
};
```

### 8C — E-Signature component

File: `frontend/src/features/delivery-register-management/components/SignaturePad.jsx`

Use the `signature_pad` npm library (install: `npm install signature_pad`).

```jsx
import SignaturePad from 'signature_pad';
import { useEffect, useRef } from 'react';

export default function SignaturePadComponent({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current) {
      padRef.current = new SignaturePad(canvasRef.current, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: 'rgb(0,0,0)',
      });
    }
  }, []);

  const handleSave = () => {
    if (padRef.current?.isEmpty()) {
      toast.error('Please sign before saving');
      return;
    }
    const dataUrl = padRef.current.toDataURL('image/png');
    // dataUrl is base64 PNG — send to backend
    onSave(dataUrl);
  };

  return (
    <div className="border-2 border-dashed border-gray-300 rounded-xl p-2">
      <p className="text-xs text-gray-500 mb-2 text-center">
        Ask customer to sign below using finger or stylus
      </p>
      <canvas
        ref={canvasRef}
        width={500}
        height={200}
        className="w-full touch-none rounded-lg bg-white border"
      />
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={() => padRef.current?.clear()}
          className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
          Clear
        </button>
        <button type="button" onClick={onCancel}
          className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
          Cancel
        </button>
        <button type="button" onClick={handleSave}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold">
          Save Signature
        </button>
      </div>
    </div>
  );
}
```

### 8D — POD photo capture

For photo capture, use the device camera via `<input type="file" accept="image/*" capture="environment">`:

```jsx
const handlePhotoCapture = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // Preview the photo
  const reader = new FileReader();
  reader.onload = (ev) => setPhotoPreview(ev.target.result);
  reader.readAsDataURL(file);
  setPodFile(file);
};

// Render:
<label className="cursor-pointer block">
  <input
    type="file"
    accept="image/*"
    capture="environment"
    className="hidden"
    onChange={handlePhotoCapture}
  />
  <div className="border-2 border-dashed border-blue-200 rounded-xl p-6 text-center bg-blue-50">
    {photoPreview ? (
      <img src={photoPreview} alt="POD" className="max-h-48 mx-auto rounded-lg" />
    ) : (
      <>
        <Camera className="w-10 h-10 text-blue-400 mx-auto mb-2" />
        <p className="text-sm text-blue-700 font-medium">Tap to take photo</p>
        <p className="text-xs text-blue-500">Photo of delivered laptop at customer site</p>
      </>
    )}
  </div>
</label>
```

---

## SECTION 9 — FRONTEND API ADDITIONS

Add to `frontend/src/features/sales-pipeline/salesPipelineApi.js`:

```javascript
// Delivery address per serial
export const updateSoSerialAddress = (allocationId, data) =>
  api.patch(`/api/sales-management/so-serials/${allocationId}/address`, data);

export const bulkUpdateSoSerialAddresses = (soNumber, data) =>
  api.patch(`/api/sales-management/sales-orders/${soNumber}/serial-addresses`, data);

// Delivery flow
export const markReached = (dcNumber, data) =>
  api.patch(`/api/sales-management/delivery-challans/${dcNumber}/reached`, data);

export const verifySerialAndGenerateOtp = (dcNumber, data) =>
  api.post(`/api/sales-management/delivery-challans/${dcNumber}/verify-serial`, data);

export const submitDeliveryWithPod = (dcNumber, formData) =>
  api.post(`/api/sales-management/delivery-challans/${dcNumber}/deliver`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

export const adminDeliverOverride = (dcNumber, data) =>
  api.patch(`/api/sales-management/delivery-challans/${dcNumber}/admin-deliver`, data);

// Technician's own deliveries
export const getMyDeliveries = () =>
  api.get('/api/sales-management/my-deliveries');
```

Add `getMyDeliveries` backend endpoint:
`GET /api/sales-management/my-deliveries`
Auth: dispatch role, uses `req.user.user_id` to find their `delivery_technician_id`
via JOIN users → delivery_technicians, then returns DCs where
`delivery_person_id = technician_id AND status IN ('in_transit','reached')`

---

## SECTION 10 — SIDEBAR & ROUTES

### 10A — Add new routes

In `frontend/src/routes/salesRoutes.jsx` or delivery-register routes:

```javascript
import TechnicianBucketPage from '../features/delivery-register-management/pages/TechnicianBucketPage';
import MyDeliveriesPage from '../features/delivery-register-management/pages/MyDeliveriesPage';

{ path: '/delivery-register/technician-bucket',
  element: guard('technician_bucket', 'view', withLayout(<TechnicianBucketPage />)) },
{ path: '/delivery-register/my-deliveries',
  element: guard('technician_bucket', 'view', withLayout(<MyDeliveriesPage />)) },
```

### 10B — Sidebar menuConfig.js

In the Sales Pipeline accordion (or Delivery Register section), add:

```javascript
{ label: 'Technician Bucket',
  path: '/delivery-register/technician-bucket',
  section: 'technician_bucket',
  icon: Truck },
{ label: 'My Deliveries',
  path: '/delivery-register/my-deliveries',
  section: 'technician_bucket',
  icon: PackageCheck },
```

### 10C — Dashboard redirect for dispatch role

In `frontend/src/pages/Dashboard.jsx`, add dispatch redirect:
```javascript
const ROLE_REDIRECTS = {
  admin:    '/reports/manager-dashboard',
  manager:  '/reports/manager-dashboard',
  dispatch: '/delivery-register/my-deliveries',
};
```

---

## SECTION 11 — npm DEPENDENCY

```bash
cd frontend && npm install signature_pad
```

---

## SECTION 12 — BUILD ORDER

1. Run migration `086_delivery_flow_complete.sql`
2. Backend: `updateSoSerialAddress` + `bulkUpdateSoSerialAddresses`
3. Backend: Update `dispatchDc` with Porter fields + vendor_serial update
4. Backend: `markTechReached` endpoint
5. Backend: `verifySerialAndGenerateOtp` endpoint (OTP email)
6. Backend: `submitDeliveryWithPod` endpoint (multer + e-sign)
7. Backend: `adminDeliverOverride` endpoint
8. Backend: `getMyDeliveries` endpoint
9. Add all routes to `backend/routes/salesManagement.js`
10. Frontend: `npm install signature_pad`
11. Frontend: Update `salesPipelineApi.js` — add 7 new functions
12. Frontend: `SalesOrderDetailPage` — Delivery Addresses tab
13. Frontend: `DCForm` — Porter fields + inhouse from delivery_technicians only
14. Frontend: `DCForm` — Show delivery address from serials
15. Frontend: `SignaturePad.jsx` component
16. Frontend: `MyDeliveriesPage.jsx` — technician mobile view
17. Frontend: `TechnicianBucketPage.jsx` — admin bucket view
18. Frontend: `DeliveryRegisterPage.jsx` — Porter tab + OTP column
19. Frontend: Add routes to route files
20. Frontend: Update `menuConfig.js` sidebar
21. Frontend: Update `Dashboard.jsx` dispatch redirect

---

## SECTION 13 — QUALITY CHECKLIST

Database:
  [ ] Migration 086 runs clean
  [ ] `sales_order_serials` has delivery_address, is_wfh columns
  [ ] `delivery_challan_lines` has all new columns (porter_tracking, otp_code,
      pod_photo_url, esign_url, reached_at, tech_latitude, tech_longitude)
  [ ] DC status allows: pending/shipped/in_transit/reached/delivered/rejected/cancelled

SO Address Management:
  [ ] "Delivery Addresses" tab appears on SO detail when serials are attached
  [ ] "Same Address for All" sets billing address on all serials
  [ ] Per-serial address edit drawer works with all fields
  [ ] WFH toggle shows employee name/phone fields
  [ ] Address saved and shown correctly

DCForm:
  [ ] Porter mode: shows Tracking ID, Order ID, Booking URL fields
  [ ] Inhouse mode: only shows delivery_technicians (not all users)
  [ ] Delivery address shown from attached serial (or billing address fallback)
  [ ] Warning shown when serials have different addresses

Dispatch Flow:
  [ ] Courier dispatch: status→shipped, dispatched_at set
  [ ] Porter dispatch: status→shipped + porter fields saved
  [ ] Inhouse dispatch: status→in_transit + delivery_person_id saved
  [ ] After dispatch: vendor_serial_numbers.inventory_status='out_stock'
  [ ] After dispatch: sales_order_serials.status='dispatched'

Technician Bucket (admin view):
  [ ] Shows all in-transit DCs grouped by technician
  [ ] Customer name, address, phone visible per DC
  [ ] Laptop details (TTSPL, brand, config) visible
  [ ] "Send OTP" generates OTP + emails to SMTP_FROM (sales email)
  [ ] OTP visible to admin/manager in the register
  [ ] "View OTP" shows the 6-digit code
  [ ] "Track Location" opens Google Maps with tech coordinates
  [ ] "Mark Delivered" admin override works

My Deliveries (dispatch role view):
  [ ] Dispatch user sees ONLY their own assigned DCs
  [ ] Mobile-friendly card layout with large touch targets
  [ ] "Mark as Reached" captures lat/lng via browser geolocation
  [ ] If geolocation denied: marks reached without coords + toast warning
  [ ] Serial number input verifies against DC serials
  [ ] After serial verify: OTP generated + emailed to sales email
  [ ] OTP input field appears after serial verified
  [ ] After OTP verified: POD section appears
  [ ] Photo capture: uses device camera (`capture="environment"`)
  [ ] Photo preview shown after capture
  [ ] Signature pad: touch-enabled, clear button works
  [ ] "Confirm Delivery" with POD → marks delivered
  [ ] After delivery: DC removed from My Deliveries list
  [ ] Dashboard for dispatch role redirects to My Deliveries

Delivery Register:
  [ ] Porter tab shows porter-dispatched DCs
  [ ] OTP column shows code (admin/manager) or "Sent" badge
  [ ] POD photo viewable by clicking thumbnail
  [ ] E-sign image viewable

Email:
  [ ] OTP email sent to SMTP_FROM when serial verified
  [ ] Email subject: "Delivery OTP — DC-XXXX — [Customer Name]"
  [ ] Email body includes: DC number, customer name, address, laptop TTSPL + config, OTP
  [ ] Delivery confirmation email sent after POD submitted

---

## SECTION 14 — NAMING REFERENCE

| Concept | Correct |
|---|---|
| DC status for tech pickup | `in_transit` |
| DC status for tech at location | `reached` |
| DC status after OTP + POD | `delivered` |
| Porter field | `porter_tracking_id` |
| POD photo column | `pod_photo_url` |
| E-sign column | `esign_url` |
| Delivery address per serial | `delivery_address` JSONB on `sales_order_serials` |
| WFH flag | `is_wfh` BOOLEAN on `sales_order_serials` |
| OTP column (DC table) | `otp_code` |
| Tech location | `tech_latitude`, `tech_longitude` |
| Reached timestamp | `reached_at` |
| Serial verified column | `serial_verified_no`, `serial_verified_at` |
| Route: tech bucket (admin) | `/delivery-register/technician-bucket` |
| Route: tech own view | `/delivery-register/my-deliveries` |
| Permission section | `technician_bucket` |
| npm package | `signature_pad` |
| multer dest | `uploads/pod/` |
| E-sign save format | base64 → PNG file → `uploads/pod/esign_*.png` |

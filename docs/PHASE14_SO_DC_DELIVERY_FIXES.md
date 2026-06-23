# RENTFOXXY CRM — PHASE 14 BUILD PROMPT
## SO/DC Bugs + Address Before Attach + Laptop Config Matching + POD Fixes
### Branch: new_crm_rentfoxxy

---

## AGENT RULES

- Fix existing bugs precisely. Do not rewrite working code.
- All changes are surgical. Read the context before editing.
- Design system: same as all previous phases.
- No new migrations needed unless noted.

---

## BUG 1 — Sales Order shows Qty=0, Total=0

### Root Cause
When a serial is attached to a SO via `attachSoSerial`, the backend runs:
```sql
UPDATE sales_order_lines SET quantity = GREATEST(0, quantity - 1) …
```
So `quantity` gets decremented to 0 (remaining unattached). The SO detail
page reads `l.quantity` for display, showing 0.

The column `main_qty` holds the ORIGINAL ordered quantity and is never
decremented.

### Fix A — SalesOrderDetailPage.jsx

In the Overview tab line items table, replace `l.quantity` with
`l.main_qty || l.quantity` in every display context:

```jsx
// FIND (line ~135):
<td className="px-4 py-2 text-right">{l.quantity}</td>
<td className="px-4 py-2 text-right">{formatCurrency(l.rate)}</td>

// REPLACE WITH:
<td className="px-4 py-2 text-right">{l.main_qty || l.quantity}</td>
<td className="px-4 py-2 text-right">{formatCurrency(l.rate)}</td>
<td className="px-4 py-2 text-right">
  {formatCurrency((l.main_qty || l.quantity) * l.rate)}
</td>
```

Also fix the total calculation:
```jsx
// Total Order Value — use main_qty:
const totalOrderValue = lines.reduce(
  (sum, l) => sum + (l.main_qty || l.quantity || 0) * (l.rate || 0), 0
);
```

And in the summary card:
```jsx
// FIND (line ~222):
<p>{l.brand} {formatConfig(l)} ×{l.quantity} @ {formatCurrency(l.rate)}</p>

// REPLACE:
<p>
  {l.brand} {formatConfig(l)} ×{l.main_qty || l.quantity}
  @ {formatCurrency(l.rate)}/month
</p>
```

Also add the TOTAL column header in the table if missing:
```jsx
<th>QTY</th><th>RATE</th><th>TOTAL</th>
```

### Fix B — DC security amount showing ₹4000 instead of ₹2000

The DC form reads `security_amount` from the SO. The SO was created with
`security_type = 'one_month_rental'` which auto-computes: 2 laptops × ₹2000
= ₹4000 total security. But when ONE DC is for ONE laptop, the DC should
split the security proportionally.

In `backend/controllers/salesManagementController.js`, in `storeDc` / DC
creation, add pro-rata security calculation:

```javascript
// When creating DC, compute security per DC based on laptops in this DC
// vs total laptops in the SO.
// totalAttached = count of sales_order_serials for this SO
// thisDcCount = count of serials in this DC
// securityPerLaptop = SO.security_amount / totalAttached

const soSecurityRes = await pool.query(
  `SELECT sol.security_amount, COUNT(sos.allocation_id) AS total_attached
   FROM sales_order_lines sol
   LEFT JOIN sales_order_serials sos ON sos.sales_order_number = sol.sales_order_number
     AND sos.status != 'removed'
   WHERE sol.sales_order_number = $1
   GROUP BY sol.security_amount
   LIMIT 1`,
  [salesOrderNumber]
);
const totalSecurity = Number(soSecurityRes.rows[0]?.security_amount || 0);
const totalAttached = Number(soSecurityRes.rows[0]?.total_attached || 1);
const thisDcSerialCount = selectedSerials.length; // serials being put in this DC
const dcSecurity = totalAttached > 0
  ? Math.round((totalSecurity / totalAttached) * thisDcSerialCount * 100) / 100
  : 0;

// Use dcSecurity instead of body.security_amount when inserting DC
```

Also update `DeliveryChallanDetailPage.jsx` to show the pro-rata note:
```jsx
<p className="text-xs text-gray-400">
  Security per laptop: {formatCurrency(head.security_amount / (head.quantity || 1))}
</p>
```

---

## BUG 2 — DC Detail showing "Courier: — AWB: —" for Inhouse deliveries

### Root Cause
Line 211 in `DeliveryChallanDetailPage.jsx` always renders:
```jsx
<p>Courier: {head.courier_name || '—'} · AWB: {head.awb_number || '—'}</p>
```
regardless of `ship_by` / `dispatch_mode`.

Also, `getDeliveryChallanLines` does `SELECT *` from `delivery_challan_lines`
but does NOT join `delivery_technicians` — so `delivery_person_name` is not
returned for the detail page (only the list page has the users JOIN).

### Fix A — DeliveryChallanDetailPage.jsx line ~211

Replace the always-visible courier line with conditional rendering:

```jsx
// REMOVE:
<p>Courier: {head.courier_name || '—'} · AWB: {head.awb_number || '—'}</p>

// ADD:
{(head.ship_by === 'by_courier' || head.dispatch_mode === 'courier') && (
  <p>
    Courier: <strong>{head.courier_name || '—'}</strong>
    {' · '}AWB: <strong>{head.awb_number || '—'}</strong>
    {head.courier_tracking_url && (
      <> · <a href={head.courier_tracking_url} target="_blank"
        rel="noopener noreferrer" className="text-blue-600 underline text-xs ml-1">
        Track
      </a></>
    )}
  </p>
)}
{(head.ship_by === 'by_porter' || head.dispatch_mode === 'porter') && (
  <p>
    Porter ID: <strong>{head.porter_tracking_id || '—'}</strong>
    {head.porter_order_id && <> · Order: <strong>{head.porter_order_id}</strong></>}
    {head.porter_booking_url && (
      <> · <a href={head.porter_booking_url} target="_blank"
        rel="noopener noreferrer" className="text-blue-600 underline text-xs ml-1">
        Track
      </a></>
    )}
  </p>
)}
{(head.ship_by === 'by_hand' || head.dispatch_mode === 'inhouse') && (
  <p>
    Delivery Technician:{' '}
    <strong>
      {head.delivery_person_name || head.technician_name || 'Not assigned'}
    </strong>
    {head.delivery_person_phone && <> · {head.delivery_person_phone}</>}
  </p>
)}
```

### Fix B — getDeliveryChallanLines service — join delivery_technicians

In `backend/services/salesManagementService.js`, update `getDeliveryChallanLines`:

```javascript
// CURRENT:
async function getDeliveryChallanLines(dcNumber) {
  const result = await pool.query(
    `SELECT * FROM delivery_challan_lines WHERE dc_number = $1 ORDER BY id ASC`,
    [dcNumber]
  );
  return result.rows;
}

// REPLACE WITH:
async function getDeliveryChallanLines(dcNumber) {
  const result = await pool.query(
    `SELECT dcl.*,
       COALESCE(dt.first_name || ' ' || COALESCE(dt.last_name,''), u.name) AS delivery_person_name,
       COALESCE(dt.phone, u.email) AS delivery_person_phone,
       dt.email AS delivery_person_email
     FROM delivery_challan_lines dcl
     LEFT JOIN delivery_technicians dt ON dt.technician_id = dcl.delivery_person_id
     LEFT JOIN users u ON u.user_id = dt.user_id
     WHERE dcl.dc_number = $1
     ORDER BY dcl.id ASC`,
    [dcNumber]
  );
  return result.rows;
}
```

---

## BUG 3 — E-Sign not updating DC as POD + Admin must upload POD

### Bug 3A — E-sign updates DC as POD

The delivery register page collects e-sign but doesn't link it back to the
DC's `esign_url` and `pod_submitted_at`.

In `backend/controllers/salesManagementController.js`, find
`submitDeliveryRegister` (or `submitDeliveryWithPod`).

Add e-sign handling:

```javascript
exports.submitDeliveryWithPod = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const { otp, esign_data, notes, pod_type } = req.body;
    const podFile = req.file; // from multer

    // Verify OTP
    if (otp) {
      const otpRes = await pool.query(
        `SELECT d_otp, otp_code FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
        [dcNumber]
      );
      const stored = otpRes.rows[0]?.otp_code || otpRes.rows[0]?.d_otp;
      if (!stored || stored !== String(otp)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
      }
    }

    let podPhotoUrl = null;
    let esignUrl = null;

    // Handle photo upload
    if (podFile) {
      podPhotoUrl = `/uploads/pod/${podFile.filename}`;
    }

    // Handle e-sign (base64 PNG)
    if (esign_data && esign_data.startsWith('data:image')) {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(__dirname, '../uploads/pod');
      fs.mkdirSync(dir, { recursive: true });
      const filename = `esign_${dcNumber}_${Date.now()}.png`;
      const base64 = esign_data.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, 'base64'));
      esignUrl = `/uploads/pod/${filename}`;
    }

    const hasProof = podPhotoUrl || esignUrl;

    await pool.query(
      `UPDATE delivery_challan_lines SET
         status = 'delivered',
         delivered_at = NOW(),
         otp_verified_at = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE otp_verified_at END,
         pod_photo_url  = COALESCE($2, pod_photo_url),
         esign_url      = COALESCE($3, esign_url),
         pod_submitted_at = NOW(),
         pod_submitted_by = $4,
         delivery_notes = COALESCE($5, delivery_notes),
         delivery_completed_at = NOW(),
         updated_at = NOW()
       WHERE dc_number = $6`,
      [otp || null, podPhotoUrl, esignUrl, req.user?.user_id, notes || null, dcNumber]
    );

    // Update serial statuses
    const dcRes = await pool.query(
      `SELECT serial_number, customer_id FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
      [dcNumber]
    );
    if (dcRes.rows.length) {
      const serials = parseJsonSafe(dcRes.rows[0].serial_number, []);
      for (const sn of serials) {
        await pool.query(
          `UPDATE vendor_serial_numbers
           SET inventory_status = 'out_stock', rent_start_date = CURRENT_DATE, updated_at = NOW()
           WHERE serial_number = $1 OR inventory_asset_code = $1`,
          [sn]
        );
        await pool.query(
          `UPDATE sales_order_serials SET status = 'dispatched', updated_at = NOW()
           WHERE dc_number = $1 AND (serial_number = $2 OR ttspl_id = $2)`,
          [dcNumber, sn]
        );
      }
    }

    res.json({
      success: true,
      message: 'Delivery confirmed',
      pod_photo_url: podPhotoUrl,
      esign_url: esignUrl,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
```

### Bug 3B — Admin cannot mark delivery without POD

Update `adminDeliverOverride` endpoint:

```javascript
exports.adminDeliverOverride = async (req, res) => {
  try {
    const { dcNumber } = req.params;
    const podFile = req.file; // admin MUST upload photo
    const { notes, reason } = req.body;

    // Admin MUST provide POD photo
    if (!podFile) {
      return res.status(400).json({
        success: false,
        message: 'POD photo is required. Please upload a photo of the delivered laptop.'
      });
    }

    const podPhotoUrl = `/uploads/pod/${podFile.filename}`;

    await pool.query(
      `UPDATE delivery_challan_lines SET
         status = 'delivered',
         delivered_at = NOW(),
         pod_photo_url = $1,
         pod_submitted_at = NOW(),
         pod_submitted_by = $2,
         delivery_notes = COALESCE($3, delivery_notes),
         delivery_completed_at = NOW(),
         updated_at = NOW()
       WHERE dc_number = $4`,
      [podPhotoUrl, req.user?.user_id, `Admin override: ${reason || notes || ''}`, dcNumber]
    );

    res.json({ success: true, message: 'Delivery marked by admin. POD saved.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
```

### Bug 3C — Delivery Register admin "Mark Delivered" button — enforce POD

In `frontend/src/features/sales-pipeline/pages/DeliveryRegisterPage.jsx` AND
`frontend/src/features/delivery-register-management/pages/TechnicianBucketPage.jsx`:

Replace the plain "Mark Delivered" admin override button with a modal that
requires photo upload:

```jsx
// AdminDeliverModal component (create inline or as separate file)
function AdminDeliverModal({ dc, onClose, onDelivered }) {
  const [podFile, setPodFile] = useState(null);
  const [podPreview, setPodPreview] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setPodFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setPodPreview(ev.target.result);
    reader.readAsDataURL(f);
  };

  const handleSubmit = async () => {
    if (!podFile) { toast.error('Please upload a POD photo first'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('pod_photo', podFile);
      fd.append('notes', notes);
      fd.append('reason', 'Admin override delivery');
      await adminDeliverOverride(dc.dc_number, fd);
      toast.success('Delivery marked with POD');
      onDelivered();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="font-semibold text-gray-900 mb-1">Mark as Delivered — {dc?.dc_number}</h3>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4">
          Admin override. A POD photo is required.
        </p>

        <label className="block mb-3">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            POD Photo* <span className="text-red-500">(required)</span>
          </span>
          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="admin-pod" />
          <label htmlFor="admin-pod" className="cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 text-center block hover:border-blue-300">
            {podPreview
              ? <img src={podPreview} alt="POD" className="max-h-40 mx-auto rounded-lg" />
              : <><Upload className="w-8 h-8 text-gray-300 mx-auto mb-1"/><p className="text-sm text-gray-500">Click to upload POD photo</p></>
            }
          </label>
        </label>

        <label className="block mb-4">
          <span className="text-sm font-medium text-gray-700 block mb-1">Notes</span>
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2}
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Why marking without OTP?" />
        </label>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving || !podFile}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Confirm Delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Also add `adminDeliverOverride` to `salesPipelineApi.js` if not present:
```javascript
export const adminDeliverOverride = (dcNumber, formData) =>
  api.post(
    `/api/sales-management/delivery-challans/${dcNumber}/admin-deliver`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
```

Also add route in `backend/routes/salesManagement.js`:
```javascript
router.post('/delivery-challans/:dcNumber/admin-deliver',
  authMiddleware, checkRole('admin','manager'),
  uploadPod.single('pod_photo'),
  ctrl.adminDeliverOverride
);
```

---

## FEATURE 1 — Delivery Addresses BEFORE Serial Attachment

### Current behaviour
`SoDeliveryAddressPanel.jsx` shows message:
"Attach laptops to this sales order first. Delivery addresses can be set
once units are attached." (line 219)

This blocks address entry until serials are attached.

### New behaviour
Addresses should be editable immediately after SO creation.
Before serials are attached, the address panel shows one entry PER
ORDER LINE (using brand/config to identify which laptop goes where).
After serials are attached, it shows per-TTSPL with same address pre-filled.

### Fix — SoDeliveryAddressPanel.jsx

Replace the "attach laptops first" block with:

```jsx
// NEW LOGIC:
// 1. Fetch SO lines (brand/config/main_qty) to show line-level address entry
// 2. If serials attached, show per-serial with pre-filled addresses
// 3. Merge: when serial is attached to a line, inherit the line's address

const [soLines, setSoLines] = useState([]);
const [serialRows, setSerialRows] = useState([]);
const [lineAddresses, setLineAddresses] = useState({}); // keyed by line.id

useEffect(() => {
  // Load SO lines for pre-attach address planning
  getSalesOrderFull(soNumber).then(res => {
    setSoLines(res.data?.lines || []);
  });
  // Load attached serials
  listSoSerials(soNumber).then(res => {
    setSerialRows(res.data?.serials || []);
  });
}, [soNumber]);

// PRE-ATTACH VIEW: show one address row per SO line (by brand/config)
// POST-ATTACH VIEW: show per-serial rows with inherited address
const hasSerials = serialRows.length > 0;
```

For the pre-attach view, show a card per SO line:
```jsx
{!hasSerials && soLines.map((line) => (
  <div key={line.id} className="border rounded-xl p-4 bg-white">
    <div className="flex items-start justify-between">
      <div>
        <p className="font-medium text-sm">
          {line.brand} — {line.model_name || formatConfig(line)}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {line.main_qty || line.quantity} unit(s) · ₹{line.rate}/month
        </p>
      </div>
      <button type="button"
        onClick={() => openEditForLine(line)}
        className="text-xs text-blue-600 border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-50">
        {lineAddresses[line.id] ? 'Edit Address' : 'Set Address'}
      </button>
    </div>

    {lineAddresses[line.id] ? (
      <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-2">
        <p className="font-medium">{lineAddresses[line.id].name}</p>
        <p>{lineAddresses[line.id].address}, {lineAddresses[line.id].city}</p>
        <p>{lineAddresses[line.id].state} — {lineAddresses[line.id].pincode}</p>
        {lineAddresses[line.id].is_wfh && (
          <span className="inline-block mt-1 px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-[10px] font-medium">
            🏠 WFH Delivery
          </span>
        )}
      </div>
    ) : (
      <p className="mt-2 text-xs text-amber-600">
        ⚠ No address set. This will default to customer billing address.
      </p>
    )}
  </div>
))}
```

### Backend: Store line-level addresses

Add new endpoint in `backend/controllers/salesManagementController.js`:

```javascript
exports.updateSoLineAddress = async (req, res) => {
  // PATCH /api/sales-management/so-lines/:lineId/address
  // Body: { delivery_address: {...}, is_wfh, delivery_notes }
  // Stores address on sales_order_lines (add column if not exists)
  // AND propagates to all sales_order_serials for this line
  try {
    const { lineId } = req.params;
    const { delivery_address, is_wfh, delivery_notes } = req.body;

    // Upsert address on the line
    await pool.query(
      `UPDATE sales_order_lines
       SET delivery_address = $1::jsonb,
           is_wfh = $2,
           delivery_notes = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(delivery_address), is_wfh || false, delivery_notes || null, lineId]
    );

    // If serials are already attached to this line, propagate
    await pool.query(
      `UPDATE sales_order_serials
       SET delivery_address = $1::jsonb,
           is_wfh = $2,
           delivery_notes = $3,
           updated_at = NOW()
       WHERE line_id = $4 AND status != 'removed'`,
      [JSON.stringify(delivery_address), is_wfh || false, delivery_notes || null, lineId]
    );

    res.json({ success: true, message: 'Address saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
```

Migration for new columns on `sales_order_lines`:
```sql
-- In migration 087 or inline:
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS delivery_address JSONB,
  ADD COLUMN IF NOT EXISTS is_wfh BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;
```

Add route:
```javascript
router.patch('/so-lines/:lineId/address', authMiddleware, ctrl.updateSoLineAddress);
```

Add to `salesPipelineApi.js`:
```javascript
export const updateSoLineAddress = (lineId, data) =>
  api.patch(`/api/sales-management/so-lines/${lineId}/address`, data);
```

### When serial is attached — inherit line address

In `backend/controllers/salesManagementController.js`, `attachSoSerial`:

After the INSERT into `sales_order_serials`, add:
```javascript
// Inherit delivery_address from the parent line if set
await client.query(
  `UPDATE sales_order_serials sos
   SET delivery_address = sol.delivery_address,
       is_wfh = sol.is_wfh,
       delivery_notes = sol.delivery_notes,
       updated_at = NOW()
   FROM sales_order_lines sol
   WHERE sos.allocation_id = $1
     AND sol.id = sos.line_id
     AND sol.delivery_address IS NOT NULL`,
  [newAllocationId]
);
```

---

## FEATURE 2 — Laptop Matching by Processor + Generation + RAM + Storage

### Current behaviour
`filterSpecRows` matches by model_name + processor + generation only.
RAM and Storage are NOT used for matching.

The attach panel in `SalesOrderDetailPage` (Laptops & QC tab) searches
by `model_name` (required), brand, processor, generation.

### Fix A — filterSpecRows in salesManagementService.js

```javascript
function filterSpecRows(rows, { model_name, processor, generation,
  ram, storage, isSale }) {
  const model = model_name?.trim();
  // model is NOT required anymore — match by specs even without model
  const matchFn = isSale ? partialSpecMatch : exactSpecMatch;

  return rows.filter((row) => {
    // Model match (optional — if model provided, must match)
    if (model) {
      const pdModel = row.pd_model || row.product_model_name || '';
      if (!matchFn(pdModel, model) && !matchFn(row.product_model_name, model)) return false;
    }
    // Processor match
    if (processor && !matchFn(row.processor, processor)) return false;
    // Generation match
    if (generation && !matchFn(row.generation, generation)) return false;
    // RAM match (new)
    if (ram && !matchFn(row.ram, ram)) return false;
    // Storage match (new)
    if (storage && !matchFn(row.storage, storage)) return false;
    return true;
  });
}
```

### Fix B — getAvailableSerials to accept ram and storage params

```javascript
exports.getAvailableSerials = async (req, res) => {
  try {
    const serials = await searchAvailableInventory({
      brand:          req.query.brand,
      model_name:     req.query.model_name || req.query.model,
      processor:      req.query.processor,
      generation:     req.query.generation,
      ram:            req.query.ram,      // NEW
      storage:        req.query.storage,  // NEW
      quotation_type: req.query.quotation_type,
      search:         req.query.search,
      limit:          req.query.limit,
    });
    res.json({ success: true, serials });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
```

### Fix C — searchAvailableInventory: remove mandatory model check

```javascript
async function searchAvailableInventory({
  brand, model_name, processor, generation, ram, storage,
  quotation_type, search, limit = 200,
}) {
  // REMOVE this early return:
  // const model = model_name?.trim();
  // if (!model) return [];

  // Keep the rest but pass ram + storage to filterSpecRows:
  let rows = filterSpecRows(result.rows, {
    model_name: model_name?.trim(),
    processor, generation,
    ram, storage,        // ADD THESE
    isSale
  });
  // ...
}
```

### Fix D — Frontend: SoSerialPanel (attach laptop UI)

The Laptops & QC tab uses a search panel to find and attach serials.
Update `frontend/src/features/sales-pipeline/pages/SalesOrderDetailPage.jsx`
or the attach panel component.

When the "Attach" search box opens for a line item, automatically pre-fill
and search using the line's specs (processor, generation, ram, storage):

```javascript
// When user clicks "Attach" for a line, auto-search with line's specs:
const handleOpenAttach = (line) => {
  setAttachLine(line);
  // Auto-fetch matching laptops immediately
  fetchMatchingSerials({
    brand: line.brand,
    model_name: line.model_name,
    processor: line.processor,
    generation: line.generation,
    ram: line.ram,
    storage: line.storage,
    quotation_type: head.quotation_type || 'rental',
  });
};
```

Show the matching laptops in a table with columns:
```
TTSPL ID | Serial Number | Processor | Gen | RAM | Storage | Status
```

Each row has an [Attach] button.

Add filter chips above the results to allow manual filtering:
```jsx
<div className="flex flex-wrap gap-2 mb-3">
  {[
    { label: 'Processor', value: line.processor },
    { label: 'Gen', value: line.generation },
    { label: 'RAM', value: line.ram },
    { label: 'Storage', value: line.storage },
  ].filter(f => f.value).map(f => (
    <span key={f.label}
      className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
      {f.label}: {f.value}
    </span>
  ))}
  <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs">
    {matchingSerials.length} laptop(s) match
  </span>
</div>
```

Also show a "No laptops match" state with explanation:
```jsx
{matchingSerials.length === 0 && !loadingSerials && (
  <div className="text-center py-6 text-amber-700 bg-amber-50 rounded-xl">
    <Package className="w-8 h-8 mx-auto mb-2 text-amber-400" />
    <p className="text-sm font-medium">No matching laptops in inventory</p>
    <p className="text-xs mt-1">
      Looking for: {line.processor} · {line.generation} · {line.ram} · {line.storage}
    </p>
    <p className="text-xs text-gray-400 mt-1">
      Ensure laptops matching this spec have passed QC.
    </p>
  </div>
)}
```

---

## MIGRATION 087 (new columns needed)

Create `backend/migrations/087_so_line_delivery_address.sql`:

```sql
-- Add delivery address planning fields to sales_order_lines
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS delivery_address JSONB,
  ADD COLUMN IF NOT EXISTS is_wfh BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- Index for address lookups by line
CREATE INDEX IF NOT EXISTS idx_sol_delivery_address
  ON sales_order_lines (id) WHERE delivery_address IS NOT NULL;
```

---

## BUILD ORDER

1. Run migration `087_so_line_delivery_address.sql`
2. Backend: Fix `getDeliveryChallanLines` JOIN to delivery_technicians (Bug 2B)
3. Backend: Fix `adminDeliverOverride` to require POD (Bug 3B)
4. Backend: Fix `submitDeliveryWithPod` to save esign_url properly (Bug 3A)
5. Backend: Add `updateSoLineAddress` endpoint + route (Feature 1)
6. Backend: Fix `getAvailableSerials` to accept ram + storage (Feature 2B)
7. Backend: Fix `filterSpecRows` to match on ram + storage, model optional (Feature 2A/C)
8. Backend: Fix `searchAvailableInventory` to remove mandatory model (Feature 2C)
9. Backend: In `attachSoSerial` — inherit line's delivery_address (Feature 1)
10. Frontend: Fix `SalesOrderDetailPage` to show main_qty + Total column (Bug 1A)
11. Frontend: Fix `DeliveryChallanDetailPage` dispatch info conditional (Bug 2A)
12. Frontend: Fix `SoDeliveryAddressPanel` — show pre-attach address entry (Feature 1)
13. Frontend: Add `AdminDeliverModal` requiring POD photo (Bug 3C)
14. Frontend: Update attach panel — auto-search by spec + show match chips (Feature 2D)
15. Frontend: Add `updateSoLineAddress` to `salesPipelineApi.js`

---

## QUALITY CHECKLIST

Bug 1 — SO Quantity:
  [ ] SO-000031 detail shows Qty=2 (not 0) on Overview tab
  [ ] Total column shows ₹4,000 (2 × ₹2,000)
  [ ] DC security shows ₹2,000 for 1-laptop DC (half of ₹4,000)

Bug 2 — DC dispatch info:
  [ ] DC with ship_by='by_hand': shows "Delivery Technician: Amit Kaur"
  [ ] DC with ship_by='by_courier': shows "Courier: Name · AWB: number"
  [ ] DC with ship_by='by_porter': shows "Porter ID: xxx"
  [ ] Courier: — AWB: — no longer appears for inhouse deliveries

Bug 3 — E-sign + POD:
  [ ] E-sign saved as PNG file to uploads/pod/esign_*.png
  [ ] esign_url stored in delivery_challan_lines.esign_url
  [ ] DC detail page shows e-sign image if esign_url is set
  [ ] Admin "Mark Delivered" modal requires photo upload
  [ ] Clicking confirm without photo shows "POD photo required" error
  [ ] After admin deliver: pod_photo_url stored, status='delivered'

Feature 1 — Addresses before attach:
  [ ] SO detail Delivery Addresses tab is visible immediately after SO creation
  [ ] Tab shows one card per SO line (brand, config, quantity, rate)
  [ ] Each card has "Set Address" button
  [ ] Address edit drawer: name, phone, address, city, state, pincode, landmark, WFH toggle
  [ ] After setting address, card shows address summary
  [ ] When serial is attached to a line, delivery_address is inherited from line
  [ ] After serials attached, tab switches to per-TTSPL view with pre-filled addresses
  [ ] Addresses saved via PATCH /api/sales-management/so-lines/:lineId/address

Feature 2 — Laptop config matching:
  [ ] Opening attach panel for a line auto-fetches matching laptops immediately
  [ ] Matching uses processor + generation + RAM + storage (not model)
  [ ] Filter chips show: Processor, Gen, RAM, Storage values
  [ ] Count badge shows "N laptop(s) match"
  [ ] No-match state shows which spec was searched and explanation
  [ ] Model name is OPTIONAL in filterSpecRows (not a hard requirement)
  [ ] getAvailableSerials accepts ?ram=8+GB&storage=256+GB+SSD params
  [ ] Partial match for "8 GB" matches "8GB" and "8 gb RAM" (existing partialSpecMatch)
  [ ] Exact match for rental quotation_type still applies

---

## NAMING REFERENCE

  New column on sales_order_lines:  delivery_address JSONB
  New column on sales_order_lines:  is_wfh BOOLEAN
  New column on sales_order_lines:  delivery_notes TEXT
  New endpoint:  PATCH /api/sales-management/so-lines/:lineId/address
  Filter params: ?ram=&storage= (added to getAvailableSerials)
  POD path:      /uploads/pod/ (already used)
  E-sign file:   esign_DC-XXXX_timestamp.png
  DC detail fix: delivery_person_name from delivery_technicians JOIN
  SO display:    main_qty (original) not quantity (remaining)

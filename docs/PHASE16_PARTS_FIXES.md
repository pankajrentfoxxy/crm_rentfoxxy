# RENTFOXXY CRM — PHASE 16 PARTS FIXES
## Fix 5 Issues: SPO Form / Parts Inventory / Ticket Blocking / Escalation / Approve Bug
### Branch: new_crm_rentfoxxy

---

## ROOT CAUSE ANALYSIS (read this first)

### Bug 5 (Approve error) — THE MOST CRITICAL
`approvePartRequest` queries `part_instances` table for `status='in_stock'`.
`parts.quantity = 10` exists, but `part_instances` has ZERO rows.
Why? `createPartInstances` (which creates PRT-IDs) is only called during
SPO GRN receive IF the SPO line has `parts_catalog_id` set.
But the SPO form sends `part_id` from `vendor_spare_parts_catalog`
(a DIFFERENT table with DIFFERENT IDs than `parts`).
The two tables are disconnected → instances are never created → approve always fails.

### Bug 1 (SPO Brand dropdown shows laptop brands)
`formMeta` queries `laptop_catalog` for brands (Dell, HP, etc.)
Parts don't belong to laptop brands. The SPO parts catalog should have
its own category system (RAM, Storage, Battery, Keyboard etc.)

### Bug 4 (No "Create SPO" button in Escalated tab)
PartsApprovalPage shows "Awaiting procurement SPO" text with no action.
Procurement has no visible queue to act on. No navigation to create SPO.

### Ticket blocking (Issue 3)
The blocking code exists but buttons are just `disabled` — not clearly
showing WHY they're blocked. The UX should be stronger.

---

## FIX 1 — CONNECT parts TABLE TO vendor_spare_parts_catalog

The fundamental fix is to link the two catalogs.

### Migration 089_parts_catalog_link.sql

```sql
-- ============================================================
-- Migration 089: Connect SPO catalog to floor parts inventory
-- ============================================================

-- 1. Add floor_part_id to vendor_spare_parts_catalog
--    This creates a ONE-TO-ONE link between a spare parts catalog entry
--    and its corresponding floor inventory part.
ALTER TABLE vendor_spare_parts_catalog
  ADD COLUMN IF NOT EXISTS floor_part_id INT REFERENCES parts(part_id),
  ADD COLUMN IF NOT EXISTS category VARCHAR(50),
  ADD COLUMN IF NOT EXISTS specifications TEXT,   -- free-text: "DDR4, 2666MHz, SODIMM"
  ADD COLUMN IF NOT EXISTS compatible_brands TEXT[];  -- ['Dell','HP','Lenovo']

-- 2. Add parts_catalog_id to vendor_spare_parts_purchase_orders line_items
--    This is already handled as a JSONB key — no schema change needed.
--    But we add it as a column for quick lookup:
ALTER TABLE vendor_spare_parts_purchase_orders
  ADD COLUMN IF NOT EXISTS has_floor_parts BOOLEAN DEFAULT FALSE;

-- 3. Add part_sequences for ordered document numbers
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('spare_po', 0, 'SP-PO-')
ON CONFLICT (doc_type) DO NOTHING;

-- 4. Seed catalog entries linking vendor_spare_parts_catalog to parts
--    For existing parts in the `parts` table, create corresponding
--    vendor_spare_parts_catalog entries and link them:

-- Step A: Insert into vendor_spare_parts_catalog for each part in `parts`
INSERT INTO vendor_spare_parts_catalog (name, active, floor_part_id, category)
SELECT part_name, true, part_id, category
FROM parts p
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_spare_parts_catalog v WHERE v.floor_part_id = p.part_id
)
ON CONFLICT DO NOTHING;

-- Step B: Link back (vendor_spare_parts_catalog → parts)
-- (Already done above via floor_part_id)
```

---

## FIX 2 — SPO FORM MODAL: Part selection links to floor parts

### File: `frontend/src/features/vendor-management/components/SparePartsPoFormModal.jsx`

#### 2A — Fix formMeta to return parts with floor_part_id + category + specs

In `backend/controllers/vendorManagement/sparePartsOrders.controller.js`,
update `formMeta` function:

```javascript
async function formMeta(req, res) {
  // ...existing vendor query...

  // REPLACE the brands query (laptop_catalog) with parts categories:
  const categories = [
    { value: 'ram',         label: 'RAM' },
    { value: 'storage',     label: 'Storage / SSD' },
    { value: 'display',     label: 'Display' },
    { value: 'battery',     label: 'Battery' },
    { value: 'keyboard',    label: 'Keyboard' },
    { value: 'motherboard', label: 'Motherboard / Chip Level' },
    { value: 'cooling',     label: 'Cooling / Thermal' },
    { value: 'power',       label: 'Power / Charger' },
    { value: 'body',        label: 'Body / Casing' },
    { value: 'general',     label: 'General / Other' },
  ];

  // REPLACE parts query to include floor_part_id and specs:
  let parts = [];
  try {
    const pr = await pool.query(
      `SELECT v.part_id AS id, v.name, v.category, v.specifications,
              v.floor_part_id, p.quantity AS stock_qty, p.cost AS unit_cost,
              p.location_code, p.compatible_brands
       FROM vendor_spare_parts_catalog v
       LEFT JOIN parts p ON p.part_id = v.floor_part_id
       WHERE v.active = TRUE
       ORDER BY v.category ASC, v.name ASC
       LIMIT 1000`
    );
    parts = pr.rows;
  } catch (e) {
    console.warn('[sparePo formMeta] parts catalog:', e.message || e);
  }

  res.json({
    success: true,
    purchase_order_number,
    categories,   // RENAMED from brands → categories
    parts,
    vendors: vendors.rows.map(/* existing */),
  });
}
```

#### 2B — Update SPO form line items in buildLinePayloads

```javascript
function buildLinePayloads(lines, partsCatalog) {
  return lines.map((ln, idx) => {
    let part_id = ln.part_id && ln.part_id !== '__custom__' ? Number(ln.part_id) : null;
    let spare_part_name = '';
    let floor_part_id = null;  // NEW: link to floor parts inventory

    if (part_id != null && Number.isFinite(part_id)) {
      const row = partsCatalog.find((p) => Number(p.id) === part_id);
      spare_part_name = row?.name ? String(row.name) : '';
      floor_part_id = row?.floor_part_id || null;  // NEW
    }
    if (ln.part_id === '__custom__' || !spare_part_name) {
      spare_part_name = ln.part_custom.trim();
      part_id = null;
      floor_part_id = null;
    }

    // ...validation...

    return {
      category: ln.category || '',     // RENAMED from brand_name
      category_label: ln.category_label || '',
      spare_part_name,
      part_id,
      floor_part_id,          // NEW — links to parts table
      parts_catalog_id: floor_part_id,  // NEW — used by GRN receive bridge
      specifications: ln.specifications || '',  // NEW
      warranty_months: Number(ln.warranty_months) || 12,
      quantity: Number(ln.quantity),
      unit_price: Number(ln.rate),
      subtotal: Number(ln.quantity) * Number(ln.rate),
    };
  });
}
```

#### 2C — Update the line items UI in SparePartsPoFormModal.jsx

Replace the "Brand" dropdown with "Category" and add Specifications field:

```jsx
// CHANGE: Rename brandOptions → categoriesFromMeta
const [categoriesFromMeta, setCategoriesFromMeta] = useState([]);
// in useEffect:
setCategoriesFromMeta(Array.isArray(data.categories) ? data.categories : []);

// CHANGE empty line shape:
const emptyLine = () => ({
  category: '',
  category_label: '',
  part_id: '',
  part_custom: '',
  specifications: '',
  warranty_months: 12,
  quantity: '',
  rate: '',
});

// IN THE LINE UI — replace the Brand* dropdown:
// --- BEFORE ---
// <select label="Brand*" options={brands} />

// --- AFTER ---
<div className="mb-3">
  <label className="block text-sm font-medium mb-1">
    Category <span className="text-red-500">*</span>
  </label>
  <select
    value={ln.category}
    onChange={(e) => {
      const opt = categoriesFromMeta.find((c) => c.value === e.target.value);
      updateLine(idx, { category: e.target.value, category_label: opt?.label || '' });
    }}
    className="w-full border rounded-lg px-3 py-2 text-sm"
  >
    <option value="">Select category…</option>
    {categoriesFromMeta.map((c) => (
      <option key={c.value} value={c.value}>{c.label}</option>
    ))}
  </select>
</div>

// Part selector (unchanged but now shows category-filtered results):
<div className="mb-3">
  <label className="block text-sm font-medium mb-1">Part Name</label>
  <select
    value={ln.part_id}
    onChange={(e) => updateLine(idx, { part_id: e.target.value })}
    className="w-full border rounded-lg px-3 py-2 text-sm"
  >
    <option value="">Choose from catalog…</option>
    {partsCatalog
      .filter((p) => !ln.category || p.category === ln.category)
      .map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.stock_qty !== undefined ? ` (Stock: ${p.stock_qty})` : ''}
        </option>
      ))}
    <option value="__custom__">+ Other (type manually)</option>
  </select>
</div>

// Show stock if linked to floor parts:
{(() => {
  const sel = partsCatalog.find((p) => Number(p.id) === Number(ln.part_id));
  if (!sel?.floor_part_id) return null;
  return (
    <p className="text-xs text-gray-500 mt-1">
      Floor stock: {sel.stock_qty || 0} units · ₹{sel.unit_cost || 0}/unit
      {sel.location_code && ` · ${sel.location_code}`}
    </p>
  );
})()}

// Custom part name input (shown when part_id = '__custom__' or ''):
{(ln.part_id === '__custom__' || !ln.part_id) && (
  <div className="mb-3">
    <label className="block text-sm font-medium mb-1">
      Part name {(ln.part_id === '__custom__') && <span className="text-red-500">*</span>}
    </label>
    <input
      value={ln.part_custom || ''}
      onChange={(e) => updateLine(idx, { part_custom: e.target.value })}
      className="w-full border rounded-lg px-3 py-2 text-sm"
      placeholder="e.g. RAM 8GB DDR4 2666MHz SODIMM"
    />
  </div>
)}

// NEW: Specifications field
<div className="mb-3">
  <label className="block text-sm font-medium mb-1">
    Specifications <span className="text-gray-400 font-normal">(optional)</span>
  </label>
  <input
    value={ln.specifications || ''}
    onChange={(e) => updateLine(idx, { specifications: e.target.value })}
    className="w-full border rounded-lg px-3 py-2 text-sm"
    placeholder="e.g. DDR4, 2666MHz, SODIMM — for RAM"
  />
</div>

// Warranty | Qty | Rate (unchanged layout)
```

---

## FIX 3 — SPO GRN RECEIVE: ALWAYS CREATE PART INSTANCES

The GRN receive bridge only fires when `parts_catalog_id` is set.
Now that SPO lines carry `floor_part_id`, always create instances:

In `backend/controllers/vendorManagement/sparePartsOrders.controller.js`,
in `receiveSpareLineSerial`, find the "Parts-management bridge" block and
update the condition:

```javascript
// BEFORE:
const partsCatalogId = line.parts_catalog_id ?? line.floor_part_id ?? null;
if (partsCatalogId != null && String(partsCatalogId).trim() !== '') {

// AFTER — also check if we can find a floor part by name matching:
let partsCatalogId = line.parts_catalog_id ?? line.floor_part_id ?? null;

// If not set, try to find by name match from vendor_spare_parts_catalog
if (!partsCatalogId && line.part_id) {
  try {
    const catRow = await pool.query(
      `SELECT floor_part_id FROM vendor_spare_parts_catalog
       WHERE part_id = $1 AND floor_part_id IS NOT NULL LIMIT 1`,
      [Number(line.part_id)]
    );
    if (catRow.rows[0]?.floor_part_id) {
      partsCatalogId = catRow.rows[0].floor_part_id;
    }
  } catch { /* ignore */ }
}

// Also try by spare_part_name → parts.part_name match
if (!partsCatalogId && line.spare_part_name) {
  try {
    const nameRow = await pool.query(
      `SELECT part_id FROM parts WHERE LOWER(part_name) = LOWER($1) LIMIT 1`,
      [String(line.spare_part_name).trim()]
    );
    if (nameRow.rows[0]?.part_id) {
      partsCatalogId = nameRow.rows[0].part_id;
    }
  } catch { /* ignore */ }
}

if (partsCatalogId != null && String(partsCatalogId).trim() !== '') {
  // ... existing createPartInstances call ...
  // ALSO update parts.quantity (the bridge currently relies on createPartInstances
  // to do this, but verify it does):
  const { createPartInstances } = require('../../services/partIdService');
  const qty = Math.max(1, Number(line.quantity || 1));
  // createPartInstances already calls UPDATE parts SET quantity = quantity + N
  const instances = await createPartInstances({
    partId: Number(partsCatalogId),
    quantity: qty,  // FIXED: was hardcoded to 1
    unitCost: Number(line.unit_price ?? line.rate ?? 0),
    locationCode: line.location_code || null,
    spoId,
    grnId: finalGrnId,
    batchNumber: line.batch_number || null,
    receivedBy: req.user?.user_id || null,
  });
  // ... link to part_requests ...
}
```

### Also fix createPartInstances service to NOT double-update quantity

In `backend/services/partIdService.js`, check if `createPartInstances`
updates `parts.quantity`. If yes, ensure the SPO GRN receive does NOT
also separately update quantity to avoid double-counting.

---

## FIX 4 — APPROVE BUG: FALLBACK TO parts.quantity

The immediate fix: when `auto_select=true` but no `part_instances` row exists
(legacy stock added before Phase 16), create an instance on-the-fly:

In `backend/controllers/partRequestController.js`, `approvePartRequest`:

```javascript
exports.approvePartRequest = async (req, res) => {
  const { requestId } = req.params;
  const { instance_id, auto_select } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Load request + part
    const reqRes = await client.query(
      `SELECT pr.*, p.part_name, p.quantity AS stock_qty, p.cost
       FROM part_requests pr
       JOIN parts p ON p.part_id = pr.part_id
       WHERE pr.request_id = $1 FOR UPDATE`,
      [requestId]
    );
    if (!reqRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    const request = reqRes.rows[0];

    let instance = null;

    if (instance_id) {
      // Specific instance requested
      const iRes = await client.query(
        `SELECT * FROM part_instances
         WHERE instance_id = $1 AND part_id = $2 FOR UPDATE`,
        [instance_id, request.part_id]
      );
      if (!iRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Instance not found' });
      }
      instance = iRes.rows[0];
      if (instance.status !== 'in_stock') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Instance ${instance.prt_id} is '${instance.status}', not available`
        });
      }
    } else if (auto_select) {
      // Try to find existing instance
      const iRes = await client.query(
        `SELECT * FROM part_instances
         WHERE part_id = $1 AND status = 'in_stock'
         ORDER BY received_at ASC, instance_id ASC
         LIMIT 1 FOR UPDATE`,
        [request.part_id]
      );

      if (iRes.rows.length) {
        instance = iRes.rows[0];
      } else if (Number(request.stock_qty) > 0) {
        // ── FALLBACK: Legacy stock exists in parts.quantity but no part_instances rows
        // Create a PRT instance on-the-fly to represent existing stock
        const { generatePrtId } = require('../services/partIdService');
        const prtId = await generatePrtId(new Date());
        const newInst = await client.query(
          `INSERT INTO part_instances
             (prt_id, part_id, unit_cost, status, location_code,
              notes, received_at)
           VALUES ($1, $2, $3, 'in_stock', $4,
             'Auto-created from legacy stock on approval', NOW())
           RETURNING *`,
          [
            prtId,
            request.part_id,
            Number(request.cost || 0),
            null,
          ]
        );
        instance = newInst.rows[0];
        // DO NOT decrement parts.quantity here — it will be done on attach
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Part "${request.part_name}" is out of stock (0 available). Escalate to procurement.`
        });
      }
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Provide instance_id or set auto_select: true'
      });
    }

    // Reserve the instance
    await client.query(
      `UPDATE part_instances SET status = 'reserved', updated_at = NOW()
       WHERE instance_id = $1`,
      [instance.instance_id]
    );

    // Update request
    await client.query(
      `UPDATE part_requests SET
         status = 'approved',
         instance_id = $1,
         approved_by = $2,
         approved_at = NOW(),
         updated_at = NOW()
       WHERE request_id = $3`,
      [instance.instance_id, req.user.user_id, requestId]
    );

    // Log
    await client.query(
      `INSERT INTO ttspl_audit_log
         (ttspl_id, event_type, description, metadata, actor_user_id, actor_name)
       SELECT t.ttspl_id, 'part_approved',
         'Part approved: ' || $1 || ' (' || $2 || ')',
         $3::jsonb, $4, $5
       FROM part_requests pr
       JOIN tickets t ON t.ticket_id = pr.ticket_id
       WHERE pr.request_id = $6`,
      [
        request.part_name, instance.prt_id,
        JSON.stringify({ request_id: Number(requestId), instance_id: instance.instance_id, prt_id: instance.prt_id }),
        req.user.user_id, req.user.name,
        requestId,
      ]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      instance_id: instance.instance_id,
      prt_id: instance.prt_id,
      location_code: instance.location_code,
      message: `Part reserved: ${instance.prt_id}`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('approvePartRequest:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};
```

---

## FIX 5 — PARTS APPROVAL PAGE: Escalated tab with "Create SPO" action

### Updated `frontend/src/features/inventory-management/pages/PartsApprovalPage.jsx`

Replace the entire file with the improved version:

```jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, ArrowUpRight, ShoppingCart, RefreshCw, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  approvePartRequest, rejectPartRequest, escalatePartRequest
} from '../../floor-pipeline/floorPipelineApi';

const TABS = [
  { id: 'pending',   label: 'Pending Approval',    statuses: ['pending'] },
  { id: 'escalated', label: 'Escalated',            statuses: ['escalated', 'ordered'] },
  { id: 'done',      label: 'Ordered / Received',   statuses: ['received', 'approved'] },
];

const STATUS_COLORS = {
  pending:   'bg-amber-100 text-amber-800',
  approved:  'bg-green-100 text-green-800',
  escalated: 'bg-purple-100 text-purple-800',
  ordered:   'bg-blue-100 text-blue-800',
  received:  'bg-teal-100 text-teal-800',
  rejected:  'bg-red-100 text-red-800',
};

const REJECT_REASONS = [
  'Wrong part specified',
  'Part not needed — issue resolved differently',
  'Duplicate request',
  'Other',
];

export default function PartsApprovalPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectModal, setRejectModal] = useState(null); // { req, reason }

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await import('../../floor-pipeline/floorPipelineApi').then(
        (m) => m.getWarehouseQueue()
      );
      setRequests(data.requests || []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visibleRequests = requests.filter((r) =>
    TABS.find((t) => t.id === tab)?.statuses.includes(r.status)
  );

  const tabCount = (id) =>
    requests.filter((r) => TABS.find((t) => t.id === id)?.statuses.includes(r.status)).length;

  const approve = async (req) => {
    setBusy(true);
    try {
      const { data } = await approvePartRequest(req.request_id, { auto_select: true });
      toast.success(`Approved — ${data.prt_id || 'PRT assigned'}`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Approve failed');
    } finally { setBusy(false); }
  };

  const reject = async (reason) => {
    if (!rejectModal) return;
    setBusy(true);
    try {
      await rejectPartRequest(rejectModal.request_id, { reason });
      toast.success('Request rejected');
      setRejectModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Reject failed');
    } finally { setBusy(false); }
  };

  const escalate = async (req) => {
    setBusy(true);
    try {
      await escalatePartRequest(req.request_id, {});
      toast.success('Escalated to procurement');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Escalate failed');
    } finally { setBusy(false); }
  };

  // Navigate to SPO creation with pre-filled part info
  const createSpoForRequest = (req) => {
    navigate('/vendor-management/spare-parts-orders', {
      state: {
        openForm: true,
        prefill: {
          part_name: req.part_name,
          category: req.category || req.part_type,
          quantity: req.quantity || 1,
          request_id: req.request_id,
          request_number: req.request_number,
          ttspl_id: req.ttspl_id,
        },
      },
    });
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" />
            Parts Approval Queue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Approve, reject, or escalate floor part requests to procurement
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-5">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
            {tabCount(t.id) > 0 && (
              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                t.id === 'pending' ? 'bg-amber-100 text-amber-800' :
                t.id === 'escalated' ? 'bg-purple-100 text-purple-800' :
                'bg-gray-100 text-gray-600'
              }`}>
                {tabCount(t.id)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : visibleRequests.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400">
            {tab === 'pending' ? 'No pending part requests' :
             tab === 'escalated' ? 'No requests awaiting procurement' :
             'No ordered/received requests'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRequests.map((req) => {
            const outOfStock = Number(req.stock_qty || 0) <= 0;
            const isEscalated = ['escalated', 'ordered'].includes(req.status);

            return (
              <div key={req.request_id}
                className="bg-white border rounded-xl p-4 shadow-sm">
                {/* Request header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-blue-700 font-medium">
                        {req.request_number}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize
                        ${req.request_type === 'upgrade' ? 'bg-blue-100 text-blue-800' :
                          'bg-orange-100 text-orange-800'}`}>
                        {req.request_type}
                      </span>
                      {req.ttspl_id && (
                        <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          {req.ttspl_id}
                        </span>
                      )}
                      <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-600'}`}>
                        {req.status}
                      </span>
                    </div>

                    <p className="font-semibold text-gray-900 mt-1 text-base">{req.part_name}</p>

                    {req.request_type === 'upgrade' && req.config_field && (
                      <p className="text-sm text-blue-700 mt-0.5">
                        ⬆ {req.config_field}: {req.old_value} → {req.new_value}
                      </p>
                    )}

                    <p className="text-sm text-gray-500 mt-1">
                      Requested by {req.requester_name}
                      {req.stage_name && ` · Stage: ${req.stage_name}`}
                      {req.brand && ` · ${req.brand} ${req.model || ''}`}
                    </p>

                    {req.description && (
                      <p className="text-xs text-gray-400 mt-1 italic">"{req.description}"</p>
                    )}
                  </div>
                </div>

                {/* Stock info */}
                <div className="flex items-center gap-3 mt-3">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    outOfStock ? 'bg-red-50 text-red-700 border border-red-100' :
                    Number(req.stock_qty) <= 5 ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                    'bg-green-50 text-green-700 border border-green-100'
                  }`}>
                    {outOfStock ? '⚠ Out of stock' : `In Stock: ${req.stock_qty}`}
                  </span>
                  {!outOfStock && (
                    <span className="text-xs text-gray-500">₹{req.unit_cost || 0}/unit</span>
                  )}
                  {req.location_code && (
                    <span className="text-xs text-gray-400">📍 {req.location_code}</span>
                  )}
                </div>

                {/* ACTION BUTTONS */}
                <div className="mt-3 pt-3 border-t flex flex-wrap gap-2">

                  {/* PENDING tab actions */}
                  {req.status === 'pending' && (
                    <>
                      <button type="button" disabled={busy || outOfStock}
                        onClick={() => approve(req)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50 hover:bg-green-700">
                        <Check className="w-4 h-4" />
                        {outOfStock ? 'Cannot approve (out of stock)' : 'Approve'}
                      </button>

                      <button type="button" disabled={busy}
                        onClick={() => setRejectModal(req)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-50 disabled:opacity-50">
                        <X className="w-4 h-4" /> Reject
                      </button>

                      {/* Escalate always available (warehouse can choose to escalate even if in stock) */}
                      <button type="button" disabled={busy}
                        onClick={() => escalate(req)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-purple-200 text-purple-700 text-sm font-semibold hover:bg-purple-50 disabled:opacity-50">
                        <ArrowUpRight className="w-4 h-4" />
                        {outOfStock ? 'Send to Procurement' : 'Escalate to Procurement'}
                      </button>
                    </>
                  )}

                  {/* ESCALATED tab actions */}
                  {isEscalated && (
                    <>
                      {req.spo_id ? (
                        <div className="flex items-center gap-3 w-full">
                          <span className="text-sm text-purple-700 font-medium">
                            Linked to SPO #{req.spo_id}
                          </span>
                          <span className="text-xs text-gray-400">
                            Will auto-approve when received
                          </span>
                        </div>
                      ) : (
                        <>
                          <button type="button"
                            onClick={() => createSpoForRequest(req)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                            <ShoppingCart className="w-4 h-4" />
                            Create Spare Parts PO
                          </button>
                          <span className="text-xs text-gray-400 self-center">
                            or wait for procurement to raise one
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <RejectModal
          request={rejectModal}
          onReject={reject}
          onClose={() => setRejectModal(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

function RejectModal({ request, onReject, onClose, busy }) {
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [custom, setCustom] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl">
        <h3 className="font-semibold text-gray-900 mb-1">Reject Part Request</h3>
        <p className="text-sm text-gray-500 mb-4">
          {request.request_number} · {request.part_name}
        </p>
        <div className="space-y-2 mb-4">
          {REJECT_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="reason" value={r}
                checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
          {reason === 'Other' && (
            <textarea value={custom} onChange={(e) => setCustom(e.target.value)}
              rows={2} placeholder="Describe the reason…"
              className="w-full border rounded-lg px-3 py-2 text-sm mt-2" />
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" disabled={busy}
            onClick={() => onReject(reason === 'Other' ? custom || reason : reason)}
            className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? 'Rejecting…' : 'Confirm Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## FIX 6 — SPO PAGE: Handle prefill from Parts Approval

In `frontend/src/features/vendor-management/pages/SparePartsPoPage.jsx`:

```jsx
import { useLocation } from 'react-router-dom';

export default function SparePartsPoPage() {
  const location = useLocation();
  const [formOpen, setFormOpen] = useState(false);
  const [formPrefill, setFormPrefill] = useState(null);

  // Open form with prefill if navigated from Parts Approval
  useEffect(() => {
    if (location.state?.openForm) {
      setFormPrefill(location.state.prefill || null);
      setFormOpen(true);
      // Clear state
      window.history.replaceState({}, document.title);
    }
  }, []);

  // Pass prefill to SparePartsPoFormModal:
  return (
    <>
      {/* existing list render */}
      <SparePartsPoFormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setFormPrefill(null); }}
        onSaved={() => { setFormOpen(false); setFormPrefill(null); reload(); }}
        prefill={formPrefill}  // NEW PROP
      />
    </>
  );
}
```

In `SparePartsPoFormModal.jsx`, accept and use prefill:

```jsx
export default function SparePartsPoFormModal({ open, onClose, onSaved, prefill }) {
  // On open with prefill, pre-fill first line:
  useEffect(() => {
    if (open && prefill) {
      setLines([{
        ...emptyLine(),
        category: prefill.category || '',
        part_custom: prefill.part_name || '',
        part_id: '',
        quantity: String(prefill.quantity || 1),
        specifications: prefill.specifications || '',
      }]);
      // Show a banner linking back to the part request
    }
  }, [open, prefill]);

  // Show info banner when prefilled from a part request:
  // {prefill?.request_number && (
  //   <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm">
  //     <p className="font-medium text-blue-900">
  //       Creating SPO to fulfil part request {prefill.request_number}
  //     </p>
  //     <p className="text-blue-700 text-xs mt-0.5">
  //       Laptop: {prefill.ttspl_id} · Part: {prefill.part_name}
  //     </p>
  //   </div>
  // )}
}
```

---

## FIX 7 — PARTS INVENTORY PAGE: Full redesign

### Updated `frontend/src/features/inventory-management/pages/PartsPage.jsx`

The page currently shows a simple table. Rebuild with tabs and instance tracking:

**Two tabs:**

**Tab 1: Parts Catalog** (existing enhanced)
- Table: Part Name | Category | Specifications | Compatible Brands | In Stock | PRT Instances | Min Threshold | Unit Cost | Total Value | Actions
- Filters: Category dropdown | Stock Status | Search
- Add Part form: includes Specifications, Compatible Brands, SKU, is_consumable
- Low stock banner

**Tab 2: Part Instances** (new — shows individual PRT units)
- Table: PRT-ID | Part Name | Category | Status | Location | Unit Cost | Installed On | Installed At
- Filters: Status (in_stock / reserved / installed / defective / returned) | Category | Part
- Shows the full lifecycle of each physical unit

```jsx
// TABS:
const [tab, setTab] = useState('catalog');

// In Tab 2 fetch:
// GET /api/part-instances  (new endpoint)

// Tab 2 table:
const INSTANCE_STATUS_COLORS = {
  in_stock:  'bg-green-100 text-green-700',
  reserved:  'bg-blue-100 text-blue-700',
  installed: 'bg-teal-100 text-teal-700',
  defective: 'bg-red-100 text-red-700',
  returned:  'bg-amber-100 text-amber-700',
  discarded: 'bg-gray-100 text-gray-600',
};
```

**Add Part form enhanced:**
```jsx
// New fields in add/edit part drawer:
<input placeholder="Specifications (e.g. DDR4, 2666MHz, SODIMM)" />
<input placeholder="Part SKU (optional)" />
<input placeholder="Compatible brands (comma-separated: Dell, HP, Lenovo)" />
<input type="number" placeholder="Warranty months" defaultValue={0} />
<label><input type="checkbox" /> Consumable (paste, screws, cables)</label>
```

### Add `/api/part-instances` endpoint

In `backend/controllers/partRequestController.js`:
```javascript
exports.listPartInstances = async (req, res) => {
  const { status, part_id, limit = 200 } = req.query;
  const conditions = [];
  const params = [];
  if (status) { conditions.push(`pi.status = $${params.length+1}`); params.push(status); }
  if (part_id) { conditions.push(`pi.part_id = $${params.length+1}`); params.push(part_id); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const res2 = await pool.query(
    `SELECT pi.*, p.part_name, p.category, p.part_type
     FROM part_instances pi
     JOIN parts p ON p.part_id = pi.part_id
     ${where}
     ORDER BY pi.created_at DESC
     LIMIT $${params.length+1}`,
    [...params, Number(limit)]
  );
  res.json({ success: true, instances: res2.rows });
};
```

Add route:
```javascript
router.get('/instances', authMiddleware, ctrl.listPartInstances);
// (in partRequests.js as GET /api/part-requests/instances)
```

---

## FIX 8 — TICKET BLOCKING UX

The current implementation has `disabled` buttons — improve the UX:

In `frontend/src/features/floor-pipeline/pages/TicketDetailPage.jsx`,
in the sidebar STAGE ACTIONS section:

```jsx
{hasOpenPartRequest ? (
  <div className="space-y-2">
    {/* Block banner */}
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-amber-600 text-lg">⛔</span>
        <p className="font-semibold text-amber-900 text-sm">
          {ticket.open_part_requests} Part Request(s) Pending
        </p>
      </div>
      <p className="text-xs text-amber-700">
        Attach all requested parts before moving to the next stage.
      </p>
      <button type="button" onClick={() => setTab('parts')}
        className="mt-2 w-full py-1.5 text-xs text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100">
        View Part Requests →
      </button>
    </div>

    {/* Reassign still available even when blocked */}
    {(fm || privileged) && (
      <button type="button" onClick={() => setAssignOpen(true)}
        className="w-full py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
        Reassign Technician
      </button>
    )}
  </div>
) : (
  // Normal stage buttons
  <div className="space-y-2">
    {stageButtons.map((btn, i) => (
      <button key={i} type="button"
        onClick={btn.action}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold border transition-colors
          ${btn.success ? 'bg-green-600 text-white hover:bg-green-700 border-green-600' :
            btn.danger  ? 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200' :
            btn.muted   ? 'text-gray-500 border-gray-200 hover:bg-gray-50' :
            'bg-blue-600 text-white hover:bg-blue-700 border-blue-600'
          }`}>
        {btn.label}
      </button>
    ))}
  </div>
)}
```

---

## BUILD ORDER

1. Run migration `089_parts_catalog_link.sql`
2. Update `sparePartsOrders.controller.js` formMeta (categories, not brands)
3. Update `sparePartsOrders.controller.js` GRN receive bridge (fix qty=1, add name lookup)
4. Update `partRequestController.js` approvePartRequest (legacy stock fallback)
5. Add `listPartInstances` to `partRequestController.js` + route
6. Update `SparePartsPoFormModal.jsx` — category instead of brand, specs field, prefill support
7. Update `SparePartsPoPage.jsx` — handle location.state prefill, open form
8. Replace `PartsApprovalPage.jsx` — full rewrite with Create SPO button
9. Update `PartsPage.jsx` — add instances tab, enhanced add form
10. Update `TicketDetailPage.jsx` — stronger blocking UX

---

## QUALITY CHECKLIST

  [ ] SPO form: Brand dropdown replaced with Category dropdown (RAM/Storage/Battery etc.)
  [ ] SPO form: Part selector filters by selected category
  [ ] SPO form: Shows floor stock count next to each part name
  [ ] SPO form: Specifications field visible per line
  [ ] SPO form: Custom part entry still works when catalog part not found

  [ ] GRN receive: creates part_instances for each unit received
  [ ] GRN receive: quantity = line.quantity (not hardcoded 1)
  [ ] GRN receive: links to part_requests if pending procurement

  [ ] Approve (stock=10, instances=0): creates legacy PRT instance on-the-fly, succeeds
  [ ] Approve (stock=0): returns "out of stock" error clearly
  [ ] Approve (instances exist): picks oldest in_stock instance, no error
  [ ] After approve: PartsApprovalPage refreshes, item moves to correct status

  [ ] Escalated tab: shows "Create Spare Parts PO" button
  [ ] "Create Spare Parts PO" → navigates to SPO page → form opens pre-filled
  [ ] SPO pre-filled with: part name, category, quantity from request
  [ ] Info banner shows request number and TTSPL on SPO form

  [ ] Parts Catalog tab: shows Specifications, Compatible Brands, SKU columns
  [ ] Parts Instances tab: shows all PRT-IDs with status, location, TTSPL installed on
  [ ] Add Part drawer: includes Specs, SKU, Compatible Brands, Consumable toggle

  [ ] Ticket with open_part_requests > 0: stage buttons HIDDEN (not just disabled)
  [ ] Amber block panel shown with count + "View Part Requests" link
  [ ] Reassign button still visible even when blocked
  [ ] After part attached: open_part_requests-- → stage buttons reappear

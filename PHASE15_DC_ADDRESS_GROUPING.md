# RENTFOXXY CRM — PHASE 15 BUILD PROMPT
## DC Creation: One DC Per Address — Complete Address-to-DC Flow
### Branch: new_crm_rentfoxxy

---

## THE RULE (carved in stone — never break this)

```
ONE DC = ONE delivery address = ONE shipment
A delivery challan is a physical shipping document.
It cannot have multiple delivery addresses.

For N laptops going to N different addresses → N DCs must be created.
For N laptops going to same address → 1 DC with all N laptops.
```

---

## COMPLETE SCENARIO MATRIX

| Scenario | Laptops | Addresses | Result |
|---|---|---|---|
| S1: All same address | 5 | 1 (office) | 1 DC · 5 serials |
| S2: All different | 5 | 5 (WFH) | 5 DCs · 1 serial each |
| S3: Mixed | 6 | 3 distinct | 3 DCs · 2 serials each |
| S4: No address set | 5 | 0 (fallback) | 1 DC · all serials · billing address |
| S5: Partial dispatch | 10 QC-passed | user picks 4 | 1 DC for those 4 · rest later |
| S6: Different dispatch modes | 4 | courier 2, inhouse 2 | 2 DCs per mode group |
| S7: Partial QC-passed | 3 of 5 passed | — | only 3 selectable, 2 blocked |
| S8: Single SO, multi-line | 2 configs, mixed addr | 3 | 3 DCs grouped by address |

---

## ROOT CAUSE (existing code)

### DCForm.jsx (frontend)
The `submit()` function sends ALL attached serials in ONE `createDC` call.
`customer_shipping_address` is set to `deliveryAddress` which takes
`attached[0].delivery_address` — just the FIRST serial's address.

### storeDeliveryChallan (backend)
Uses ONE `dc_number` for the entire submission.
ONE `customer_shipping_address` inserted per DC row.
All serials from all lines → same DC → same address.

### The fix
The DCForm must:
1. Group QC-passed attached serials by their `delivery_address`
2. Confirm with the user: "This will create N DC(s)" 
3. Call `createDC` once per address-group
4. Each call creates one DC with one address and its specific serials

---

## SECTION 1 — BACKEND: createMultipleDcs endpoint

### 1A — New endpoint in salesManagementController.js

```javascript
/**
 * POST /api/sales-management/create-dcs-by-address
 * Creates one DC per delivery-address group from QC-passed attached serials.
 *
 * Body:
 * {
 *   sales_order_number: 'SO-000031',
 *   ship_by: 'by_courier' | 'by_porter' | 'by_hand',
 *   courier_name: '...',       // if courier
 *   awb_number: '...',         // if courier (per DC or same for all)
 *   courier_tracking_url: '...',
 *   porter_tracking_id: '...',
 *   porter_order_id: '...',
 *   porter_booking_url: '...',
 *   delivery_person_id: N,     // if inhouse
 *   dc_groups: [               // one entry per DC to create
 *     {
 *       delivery_address: { name, phone, address, city, state, pincode, ... },
 *       allocation_ids: [1, 2, 3],   // sales_order_serials.allocation_id
 *       // per-DC overrides (courier can be different per DC):
 *       awb_number?: '...',
 *       delivery_person_id?: N,
 *     }
 *   ]
 * }
 *
 * Response:
 * {
 *   success: true,
 *   dc_numbers: ['DC-000014', 'DC-000015'],
 *   dcs_created: 2,
 *   first_dc: 'DC-000014'
 * }
 */
exports.createDcsByAddress = async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body;
    const { sales_order_number, ship_by, dc_groups } = body;

    if (!sales_order_number) {
      return res.status(400).json({ success: false, message: 'sales_order_number required' });
    }
    if (!Array.isArray(dc_groups) || !dc_groups.length) {
      return res.status(400).json({ success: false, message: 'dc_groups required' });
    }
    if (!ship_by) {
      return res.status(400).json({ success: false, message: 'ship_by required' });
    }

    // Validate all allocation_ids exist and are QC-passed for this SO
    const allAllocationIds = dc_groups.flatMap((g) => g.allocation_ids || []);
    if (!allAllocationIds.length) {
      return res.status(400).json({ success: false, message: 'No laptops selected' });
    }

    const allocRes = await pool.query(
      `SELECT sos.*, 
              vsn.serial_number AS vsn_serial, vsn.inventory_asset_code AS ttspl_id_vsn,
              COALESCE(vsn.extra->>'brand', '') AS brand,
              COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', '') AS model,
              COALESCE(vsn.extra->>'processor', '') AS processor,
              COALESCE(vsn.extra->>'generation', '') AS generation,
              COALESCE(vsn.extra->>'ram', '') AS ram,
              COALESCE(vsn.extra->>'storage', '') AS storage,
              vsn.serial_id
       FROM sales_order_serials sos
       LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
       WHERE sos.allocation_id = ANY($1::int[])
         AND sos.sales_order_number = $2
         AND sos.status = 'attached'`,
      [allAllocationIds, sales_order_number]
    );

    if (allocRes.rows.length !== allAllocationIds.length) {
      const found = allocRes.rows.map((r) => r.allocation_id);
      const missing = allAllocationIds.filter((id) => !found.includes(id));
      return res.status(400).json({
        success: false,
        message: `Some laptops are not attached or already dispatched: ${missing.join(', ')}`
      });
    }

    const notPassed = allocRes.rows.filter((r) => r.qc_status !== 'passed');
    if (notPassed.length) {
      return res.status(400).json({
        success: false,
        message: `Laptops must pass Dispatch QC before DC creation: ${notPassed.map((r) => r.ttspl_id || r.serial_number).join(', ')}`
      });
    }

    // Get SO meta for common fields
    const soLines = await getSalesOrderLines(sales_order_number);
    if (!soLines.length) {
      return res.status(404).json({ success: false, message: 'Sales order not found' });
    }
    const soHead = soLines[0];
    const entityCode = entityForQuotationType(soHead.quotation_type || 'rental');
    const dispatchMode = ship_by === 'by_hand' ? 'inhouse'
      : ship_by === 'by_porter' ? 'porter' : 'courier';

    // Get billing address
    let billing = parseJsonSafe(soHead.customer_billing_address);
    if ((!billing || !billing.address) && soHead.customer_id) {
      const cRes = await pool.query(
        `SELECT billing_address, billing_city, billing_state, billing_pincode, 
                name, company_name, phone, gst_no
         FROM customers WHERE customer_id = $1`, [soHead.customer_id]
      );
      if (cRes.rows.length) {
        const c = cRes.rows[0];
        billing = {
          name: c.company_name || c.name,
          phone: c.phone,
          address: c.billing_address,
          city: c.billing_city,
          state: c.billing_state,
          pincode: c.billing_pincode,
          gst_number: c.gst_no,
        };
      }
    }

    // Build lookup: allocation_id → serial row
    const allocMap = {};
    allocRes.rows.forEach((r) => { allocMap[r.allocation_id] = r; });

    const createdDcNumbers = [];

    await client.query('BEGIN');

    for (const group of dc_groups) {
      if (!group.allocation_ids?.length) continue;

      const dcNumber = await nextDocumentNumber(
        entityDocType('delivery_challan', entityCode)
      );

      const groupSerials = group.allocation_ids.map((id) => allocMap[id]).filter(Boolean);
      const deliveryAddress = group.delivery_address || parseJsonSafe(soHead.customer_shipping_address) || billing;

      // Pro-rata security: group size / total attached
      const totalAttached = allAllocationIds.length;
      const groupSize = group.allocation_ids.length;
      const totalSecurity = Number(soHead.security_amount || 0);
      const groupSecurity = totalAttached > 0
        ? Math.round((totalSecurity / totalAttached) * groupSize * 100) / 100
        : 0;

      // Per-DC dispatch details (awb_number can differ per DC for courier)
      const groupAwb = group.awb_number || body.awb_number || null;
      const groupDeliveryPersonId = group.delivery_person_id || body.delivery_person_id || null;

      // Build serial list: "serialId|serialNumber|ttsplId"
      const serialTokens = groupSerials.map((s) =>
        `${s.serial_id || ''}|${s.serial_number || s.vsn_serial || ''}|${s.ttspl_id || s.ttspl_id_vsn || ''}`
      );

      // Insert ONE delivery_challan_lines row per DC
      await client.query(
        `INSERT INTO delivery_challan_lines (
          dc_number, sales_order_number, quotation_number, customer_id, customer_name,
          email, gst_number, supply_state, security_amount, shiping_charges, branch,
          entity_code, customer_billing_address, customer_shipping_address,
          brand, model_name, quantity, main_qty, serial_number,
          ship_by, courier_name, awb_number, courier_tracking_url,
          porter_tracking_id, porter_order_id, porter_booking_url,
          delivery_person_id, dispatch_mode,
          status, created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
          $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
          'in_transit',$29
        )`,
        [
          dcNumber,
          sales_order_number,
          soHead.quotation_number,
          soHead.customer_id || null,
          soHead.customer_name,
          soHead.customer_email,
          soHead.gst_number,
          soHead.supply_state,
          groupSecurity,
          0, // shiping_charges
          entityCode,
          entityCode,
          billing ? JSON.stringify(billing) : null,
          JSON.stringify(deliveryAddress),
          groupSerials[0]?.brand || '',
          groupSerials[0]?.model || '',
          groupSize,
          groupSize,
          JSON.stringify(serialTokens),
          ship_by,
          body.courier_name || null,
          groupAwb,
          body.courier_tracking_url || null,
          body.porter_tracking_id || null,
          body.porter_order_id || null,
          body.porter_booking_url || null,
          groupDeliveryPersonId ? Number(groupDeliveryPersonId) : null,
          dispatchMode,
          req.user?.user_id,
        ]
      );

      // Mark each serial as dispatched in sales_order_serials
      await client.query(
        `UPDATE sales_order_serials
         SET status = 'dispatched', dc_number = $1, updated_at = NOW()
         WHERE allocation_id = ANY($2::int[])`,
        [dcNumber, group.allocation_ids]
      );

      // Update vendor_serial_numbers inventory status
      const serialIds = groupSerials.map((s) => s.serial_id).filter(Boolean);
      if (serialIds.length) {
        await client.query(
          `UPDATE vendor_serial_numbers
           SET inventory_status = 'in_transit', current_dc_number = $1,
               dispatch_mode = $2, dispatched_at = NOW(), updated_at = NOW()
           WHERE serial_id = ANY($3::int[])`,
          [dcNumber, dispatchMode, serialIds]
        );
      }

      // Mirror QC into dc_qc_tickets
      await client.query(
        `INSERT INTO dc_qc_tickets (dc_number, sales_order_number, ticket_id, ttspl_id, serial_id, status)
         SELECT $1, sos.sales_order_number, sos.qc_ticket_id, sos.ttspl_id, sos.serial_id, 'qc_passed'
         FROM sales_order_serials sos
         WHERE sos.allocation_id = ANY($2::int[])
           AND NOT EXISTS (
             SELECT 1 FROM dc_qc_tickets d WHERE d.dc_number = $1 AND d.serial_id = sos.serial_id
           )`,
        [dcNumber, group.allocation_ids]
      );

      createdDcNumbers.push(dcNumber);
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      dc_numbers: createdDcNumbers,
      dcs_created: createdDcNumbers.length,
      first_dc: createdDcNumbers[0],
      message: `${createdDcNumbers.length} DC(s) created: ${createdDcNumbers.join(', ')}`,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createDcsByAddress:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};
```

### 1B — Add route to backend/routes/salesManagement.js

```javascript
router.post('/create-dcs-by-address',
  authMiddleware,
  checkRole('admin','manager','sales','dispatch','warehouse'),
  ctrl.createDcsByAddress
);
```

### 1C — Add to salesPipelineApi.js

```javascript
export const createDcsByAddress = (data) =>
  api.post('/api/sales-management/create-dcs-by-address', data);
```

---

## SECTION 2 — FRONTEND: DCForm complete rebuild

### Overview of the new DCForm flow

```
STEP 1: Select Sales Order
  ↓
STEP 2: Review QC-passed laptops grouped by delivery address
  Each group = proposed DC
  User can: split, merge, edit address, deselect laptops
  ↓
STEP 3: Select dispatch mode (per group OR global)
  ↓
STEP 4: Preview "N DC(s) will be created" + confirm
  ↓
STEP 5: createDcsByAddress() → N DCs created
```

### Complete new DCForm.jsx

Replace the entire content of
`frontend/src/features/sales-pipeline/components/DCForm.jsx`:

```jsx
/**
 * DCForm — Create Delivery Challan(s)
 *
 * Business rule: ONE DC = ONE delivery address.
 * When a SO has laptops going to different addresses,
 * multiple DCs are created automatically (one per address group).
 *
 * Steps:
 *  1. Select SO
 *  2. Review/edit address groups (each group = one DC)
 *  3. Choose dispatch mode
 *  4. Confirm + Create
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Package, MapPin, Truck, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Plus, Minus, Edit2
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  createDcsByAddress, getDCMeta, listSalesOrders
} from '../salesPipelineApi';
import { BillingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Stable key for comparing addresses */
const addrKey = (addr) => {
  if (!addr) return '__NO_ADDRESS__';
  const a = typeof addr === 'string' ? JSON.parse(addr) : addr;
  return `${(a.address||'').trim().toLowerCase()}|${(a.pincode||a.zip_code||'').trim()}|${(a.city||'').trim().toLowerCase()}`;
};

/** Short display of address */
const addrLine = (addr) => {
  if (!addr) return 'No address set';
  const a = typeof addr === 'string' ? JSON.parse(addr) : addr;
  return [a.address, a.city, a.state, a.pincode || a.zip_code].filter(Boolean).join(', ');
};

/** Format currency */
const inr = (n) => `₹${Number(n||0).toLocaleString('en-IN')}`;

// ── AddressEditDrawer ─────────────────────────────────────────────────────────

function AddressEditDrawer({ address, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '', phone: '', address: '', city: '',
    state: '', pincode: '', landmark: '',
    ...address,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Edit Delivery Address</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          {[
            ['Contact Name',   'name',     'text', false],
            ['Phone',          'phone',    'tel',  false],
            ['Address*',       'address',  'text', true],
            ['City*',          'city',     'text', false],
            ['State*',         'state',    'text', false],
            ['Pincode*',       'pincode',  'text', false],
            ['Landmark',       'landmark', 'text', false],
          ].map(([label, key, type]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input type={type} value={form[key] || ''} onChange={set(key)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          <button type="button"
            onClick={() => {
              if (!form.address?.trim() || !form.city?.trim() || !form.state?.trim()) {
                toast.error('Address, city and state are required');
                return;
              }
              onSave(form);
              onClose();
            }}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
            Save Address
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DispatchFields ────────────────────────────────────────────────────────────

function DispatchFields({ shipBy, fields, onChange, deliveryTechnicians = [] }) {
  const set = (k) => (e) => onChange({ ...fields, [k]: e.target.value });
  if (shipBy === 'by_courier') return (
    <div className="space-y-2 mt-2">
      <div className="grid grid-cols-2 gap-2">
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Courier Name*"
          value={fields.courier_name || ''} onChange={set('courier_name')} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="AWB Number"
          value={fields.awb_number || ''} onChange={set('awb_number')} />
      </div>
      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Tracking URL (optional)"
        value={fields.courier_tracking_url || ''} onChange={set('courier_tracking_url')} />
    </div>
  );
  if (shipBy === 'by_porter') return (
    <div className="space-y-2 mt-2">
      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Booking/Tracking ID*"
        value={fields.porter_tracking_id || ''} onChange={set('porter_tracking_id')} />
      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Porter Order ID (optional)"
        value={fields.porter_order_id || ''} onChange={set('porter_order_id')} />
      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Booking URL (optional)"
        value={fields.porter_booking_url || ''} onChange={set('porter_booking_url')} />
    </div>
  );
  if (shipBy === 'by_hand') return (
    <div className="mt-2">
      <select className="w-full border rounded-lg px-3 py-2 text-sm"
        value={fields.delivery_person_id || ''} onChange={set('delivery_person_id')}>
        <option value="">Select delivery technician*</option>
        {deliveryTechnicians.filter((t) => t.is_active).map((t) => (
          <option key={t.technician_id} value={t.technician_id}>
            {t.first_name} {t.last_name || ''}{t.phone ? ` — ${t.phone}` : ''}
          </option>
        ))}
      </select>
      {!deliveryTechnicians.length && (
        <p className="text-xs text-amber-600 mt-1">
          No delivery technicians found. Add via Delivery Register → Technicians.
        </p>
      )}
    </div>
  );
  return null;
}

// ── DcGroup card ─────────────────────────────────────────────────────────────

function DcGroupCard({
  groupIndex, group, meta, shipBy, dispatchFields, onDispatchChange,
  onAddressEdit, onToggleSerial, onSplitGroup, isOnly,
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingAddress, setEditingAddress] = useState(false);

  const allPassed = group.serials.every((s) => s.qc_status === 'passed');
  const someNotPassed = group.serials.some((s) => s.qc_status !== 'passed');

  return (
    <div className="border rounded-xl overflow-hidden bg-white">
      {/* Group header */}
      <div className={`px-4 py-3 flex items-start justify-between
        ${allPassed ? 'bg-emerald-50 border-b border-emerald-100' : 'bg-amber-50 border-b border-amber-100'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className={`w-4 h-4 flex-shrink-0 ${allPassed ? 'text-emerald-600' : 'text-amber-500'}`} />
            <span className="text-sm font-semibold text-gray-900">
              DC #{groupIndex + 1}
              {group.is_wfh && (
                <span className="ml-2 px-1.5 py-0.5 bg-teal-100 text-teal-700 rounded text-[10px] font-medium">🏠 WFH</span>
              )}
            </span>
            <span className="ml-auto text-xs text-gray-500">{group.serials.length} laptop(s)</span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5 ml-6 truncate">{addrLine(group.address)}</p>
          {group.address?.name && (
            <p className="text-xs font-medium text-gray-700 mt-0.5 ml-6">{group.address.name}</p>
          )}
          {group.address?.phone && (
            <p className="text-xs text-gray-500 ml-6">📞 {group.address.phone}</p>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          <button type="button" onClick={() => setEditingAddress(true)}
            className="p-1.5 rounded hover:bg-white/60 text-gray-500" title="Edit address">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => setExpanded((e) => !e)}
            className="p-1.5 rounded hover:bg-white/60 text-gray-500">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Laptops in this group */}
      {expanded && (
        <div className="divide-y">
          {group.serials.map((s) => (
            <div key={s.allocation_id}
              className={`flex items-center justify-between px-4 py-2 ${
                s.qc_status !== 'passed' ? 'bg-red-50' : ''
              }`}>
              <div className="flex items-center gap-3">
                {/* Checkbox to include/exclude from this DC */}
                <input type="checkbox" checked={s.selected !== false}
                  onChange={() => onToggleSerial(groupIndex, s.allocation_id)}
                  className="rounded" />
                <div>
                  <p className="font-mono text-xs text-blue-700 font-medium">{s.ttspl_id || s.serial_number}</p>
                  <p className="text-[11px] text-gray-500">
                    {[s.brand, s.model, s.processor, s.generation, s.ram, s.storage]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  s.qc_status === 'passed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {s.qc_status === 'passed' ? '✓ QC Passed' : `⚠ QC ${s.qc_status}`}
                </span>
              </div>
            </div>
          ))}

          {someNotPassed && (
            <div className="px-4 py-2 bg-red-50">
              <p className="text-xs text-red-700">
                ⚠ Laptops that haven't passed QC cannot be dispatched and will be skipped.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Dispatch details for this group */}
      {expanded && (
        <div className="px-4 py-3 border-t bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Dispatch Details</p>
          <DispatchFields
            shipBy={shipBy}
            fields={dispatchFields}
            onChange={onDispatchChange}
            deliveryTechnicians={meta?.delivery_technicians || []}
          />
        </div>
      )}

      {editingAddress && (
        <AddressEditDrawer
          address={group.address}
          onSave={(addr) => { onAddressEdit(groupIndex, addr); setEditingAddress(false); }}
          onClose={() => setEditingAddress(false)}
        />
      )}
    </div>
  );
}

// ── Main DCForm ───────────────────────────────────────────────────────────────

export default function DCForm({ open, onClose, prefillSo }) {
  const navigate = useNavigate();

  // Step 1: SO selection
  const [salesOrders, setSalesOrders] = useState([]);
  const [soNumber, setSoNumber] = useState(prefillSo || '');

  // Step 2: meta + groups
  const [meta, setMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  // DC groups: each group → one DC
  const [dcGroups, setDcGroups] = useState([]);

  // Step 3: dispatch mode (global — same for all DCs)
  const [shipBy, setShipBy] = useState('');
  // Per-group dispatch fields (awb can differ per DC for courier)
  const [groupDispatch, setGroupDispatch] = useState({});

  // UI
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1); // 1=select SO, 2=groups, 3=confirm

  // ── Load SOs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    listSalesOrders({ limit: 200, status: 'processing' })
      .then((res) => setSalesOrders(res.data?.sales_orders || []))
      .catch(() => {});
  }, [open]);

  // ── Load meta + build groups when SO selected ─────────────────────────────
  useEffect(() => {
    if (!open || !soNumber) return;
    setLoadingMeta(true);
    setMeta(null);
    setDcGroups([]);
    setStep(1);

    getDCMeta(soNumber)
      .then((res) => {
        const data = res.data;
        setMeta(data);
        buildGroups(data);
        setStep(2);
      })
      .catch(() => toast.error('Failed to load SO data'))
      .finally(() => setLoadingMeta(false));
  }, [open, soNumber]);

  useEffect(() => {
    if (prefillSo && open) setSoNumber(prefillSo);
  }, [prefillSo, open]);

  // ── Build address groups from attached serials ────────────────────────────
  const buildGroups = (data) => {
    const attached = (data.attached_serials || []);

    if (!attached.length) {
      // No serials attached yet — show empty state
      setDcGroups([]);
      return;
    }

    // Group by delivery_address key
    const groupMap = new Map();

    for (const serial of attached) {
      const addr = serial.delivery_address
        ? (typeof serial.delivery_address === 'string'
            ? JSON.parse(serial.delivery_address)
            : serial.delivery_address)
        : null;

      const key = addrKey(addr);

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          address: addr || data.shipping_address || null,
          is_wfh: serial.is_wfh || false,
          serials: [],
        });
      }
      groupMap.get(key).serials.push({
        ...serial,
        selected: true, // all selected by default
      });
    }

    const groups = Array.from(groupMap.values());

    // If NO addresses were set on serials, put everything in one group
    // using the SO shipping address
    if (groups.length === 1 && groups[0].key === '__NO_ADDRESS__') {
      groups[0].address = data.shipping_address
        || data.billing_address
        || null;
    }

    setDcGroups(groups);

    // Initialize per-group dispatch state
    const initDispatch = {};
    groups.forEach((_, i) => { initDispatch[i] = {}; });
    setGroupDispatch(initDispatch);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleToggleSerial = (groupIndex, allocationId) => {
    setDcGroups((prev) => prev.map((g, i) =>
      i !== groupIndex ? g : {
        ...g,
        serials: g.serials.map((s) =>
          s.allocation_id === allocationId ? { ...s, selected: !s.selected } : s
        ),
      }
    ));
  };

  const handleAddressEdit = (groupIndex, newAddress) => {
    setDcGroups((prev) => prev.map((g, i) =>
      i !== groupIndex ? g : { ...g, address: newAddress }
    ));
  };

  const handleGroupDispatchChange = (groupIndex, fields) => {
    setGroupDispatch((prev) => ({ ...prev, [groupIndex]: fields }));
  };

  // Validation summary
  const validation = useMemo(() => {
    const errors = [];
    const warnings = [];

    if (!dcGroups.length) {
      errors.push('No laptops attached to this SO yet.');
      return { errors, warnings, valid: false, dcCount: 0, totalLaptops: 0 };
    }

    const activeDcGroups = dcGroups.filter((g) =>
      g.serials.some((s) => s.selected && s.qc_status === 'passed')
    );

    if (!activeDcGroups.length) {
      errors.push('No QC-passed laptops selected.');
    }

    if (!shipBy) {
      errors.push('Select dispatch mode (Courier / Porter / Inhouse).');
    }

    // Validate dispatch fields per group
    activeDcGroups.forEach((g, i) => {
      const gd = groupDispatch[dcGroups.indexOf(g)] || {};
      if (shipBy === 'by_courier' && !gd.courier_name?.trim()) {
        errors.push(`DC #${i + 1}: Courier name is required.`);
      }
      if (shipBy === 'by_porter' && !gd.porter_tracking_id?.trim()) {
        errors.push(`DC #${i + 1}: Porter tracking ID is required.`);
      }
      if (shipBy === 'by_hand' && !gd.delivery_person_id) {
        errors.push(`DC #${i + 1}: Select a delivery technician.`);
      }
    });

    // Address warnings
    activeDcGroups.forEach((g, i) => {
      if (!g.address) {
        warnings.push(`DC #${i + 1}: No delivery address set — will use billing address.`);
      }
    });

    const notPassed = dcGroups.flatMap((g) =>
      g.serials.filter((s) => s.selected && s.qc_status !== 'passed')
    );
    if (notPassed.length) {
      warnings.push(`${notPassed.length} laptop(s) haven't passed QC — they will be skipped.`);
    }

    const totalLaptops = activeDcGroups.reduce(
      (sum, g) => sum + g.serials.filter((s) => s.selected && s.qc_status === 'passed').length, 0
    );

    return {
      errors,
      warnings,
      valid: errors.length === 0,
      dcCount: activeDcGroups.length,
      totalLaptops,
    };
  }, [dcGroups, shipBy, groupDispatch]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!validation.valid) {
      validation.errors.forEach((e) => toast.error(e));
      return;
    }

    setSaving(true);
    try {
      // Build dc_groups payload
      const groups = dcGroups
        .map((g, i) => {
          const passedSelected = g.serials.filter(
            (s) => s.selected && s.qc_status === 'passed'
          );
          if (!passedSelected.length) return null;
          return {
            delivery_address: g.address || meta?.billing_address,
            is_wfh: g.is_wfh,
            allocation_ids: passedSelected.map((s) => s.allocation_id),
            ...groupDispatch[i],
          };
        })
        .filter(Boolean);

      const res = await createDcsByAddress({
        sales_order_number: soNumber,
        ship_by: shipBy,
        dc_groups: groups,
      });

      const { dc_numbers, dcs_created, first_dc } = res.data;

      if (dcs_created === 1) {
        toast.success(`DC created: ${first_dc}`);
      } else {
        toast.success(`${dcs_created} DCs created: ${dc_numbers.join(', ')}`);
      }

      onClose();
      if (first_dc) navigate(`/sales-pipeline/delivery-challans/${first_dc}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[640px] bg-white shadow-xl flex flex-col max-h-full overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-gray-900">Create Delivery Challan</h2>
            <p className="text-xs text-gray-400 mt-0.5">One DC per delivery address</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* SO selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sales Order</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={soNumber} onChange={(e) => { setSoNumber(e.target.value); setStep(1); }}>
              <option value="">Select Sales Order…</option>
              {salesOrders.map((so) => (
                <option key={so.sales_order_number} value={so.sales_order_number}>
                  {so.sales_order_number} — {so.customer_name}
                </option>
              ))}
            </select>
          </div>

          {loadingMeta && (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-500">Loading order details…</p>
            </div>
          )}

          {meta && !dcGroups.length && (
            <div className="text-center py-8 bg-amber-50 rounded-xl border border-amber-100">
              <Package className="w-10 h-10 text-amber-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-amber-800">No laptops attached to this SO yet</p>
              <p className="text-xs text-amber-600 mt-1">
                Go to Sales Order → Laptops & QC to attach and pass QC first.
              </p>
            </div>
          )}

          {dcGroups.length > 0 && (
            <>
              {/* Summary banner */}
              <div className={`rounded-xl px-4 py-3 border text-sm ${
                validation.valid
                  ? 'bg-blue-50 border-blue-100 text-blue-800'
                  : 'bg-amber-50 border-amber-100 text-amber-800'
              }`}>
                <p className="font-semibold">
                  {validation.dcCount} DC(s) will be created · {validation.totalLaptops} laptop(s)
                </p>
                {dcGroups.length > 1 && (
                  <p className="text-xs mt-0.5">
                    Laptops have {dcGroups.length} different delivery addresses →
                    {dcGroups.length} separate DCs.
                  </p>
                )}
              </div>

              {/* Global dispatch mode */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Dispatch Mode* <span className="text-gray-400">(applies to all DCs)</span>
                </label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  value={shipBy} onChange={(e) => {
                    setShipBy(e.target.value);
                    // Reset per-group dispatch fields when mode changes
                    const init = {};
                    dcGroups.forEach((_, i) => { init[i] = {}; });
                    setGroupDispatch(init);
                  }}>
                  <option value="">Select dispatch mode…</option>
                  <option value="by_courier">🚚 Courier (Bluedart, Delhivery etc.)</option>
                  <option value="by_porter">🛵 Porter / Last-mile service</option>
                  <option value="by_hand">👤 Inhouse Delivery Technician</option>
                </select>
              </div>

              {/* DC Group Cards */}
              <div className="space-y-3">
                {dcGroups.map((group, i) => (
                  <DcGroupCard
                    key={group.key}
                    groupIndex={i}
                    group={group}
                    meta={meta}
                    shipBy={shipBy}
                    dispatchFields={groupDispatch[i] || {}}
                    onDispatchChange={(fields) => handleGroupDispatchChange(i, fields)}
                    onAddressEdit={handleAddressEdit}
                    onToggleSerial={handleToggleSerial}
                    isOnly={dcGroups.length === 1}
                  />
                ))}
              </div>

              {/* Billing address (always shown) */}
              {meta?.billing_address && (
                <BillingAddressPanel
                  billing={meta.billing_address}
                  gstNumber={meta.gst_number}
                />
              )}

              {/* Validation errors */}
              {validation.errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
                  {validation.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-700 flex items-start gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{e}
                    </p>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {validation.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1">
                  {validation.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 flex items-start gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{w}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            {validation.dcCount > 0 && `${validation.dcCount} DC(s) · ${validation.totalLaptops} laptop(s)`}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !validation.valid || !dcGroups.length}
              onClick={submit}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving
                ? 'Creating…'
                : validation.dcCount > 1
                  ? `Create ${validation.dcCount} DCs`
                  : 'Create DC'
              }
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
```

---

## SECTION 3 — VALIDATION RULES (backend)

In `createDcsByAddress`, enforce these rules strictly:

```javascript
// Rule 1: Each group must have a distinct address
// (Already enforced by frontend grouping, but verify server-side)

// Rule 2: One serial cannot appear in two groups
const seen = new Set();
for (const g of dc_groups) {
  for (const id of (g.allocation_ids || [])) {
    if (seen.has(id)) {
      return res.status(400).json({
        success: false,
        message: `Laptop allocation ${id} appears in multiple DC groups. Each laptop can only be in one DC.`
      });
    }
    seen.add(id);
  }
}

// Rule 3: All serials must be QC-passed (status = 'passed')
// Already checked above

// Rule 4: All serials must be 'attached' to this SO (not dispatched/removed)
// Already checked above

// Rule 5: Dispatch mode required and valid
if (!['by_courier','by_porter','by_hand'].includes(ship_by)) {
  return res.status(400).json({ success: false, message: 'Invalid ship_by value' });
}
```

---

## SECTION 4 — SCENARIO HANDLING MATRIX

| Scenario | How handled |
|---|---|
| All same address | buildGroups() creates 1 group → 1 DC |
| All different addresses (WFH) | buildGroups() creates N groups → N DCs |
| Mixed (some same, some different) | buildGroups() groups by address key → M DCs |
| No addresses set on serials | 1 group with SO shipping address → 1 DC |
| Some not QC-passed | Warning shown, skipped in submit |
| User deselects a laptop | Checkbox removes from group, excluded from DC |
| User wants different courier per DC | DispatchFields per group → different AWB per DC |
| User wants different technician per DC | DispatchFields per group → different delivery_person_id |
| Wrong address on a group | Edit button → AddressEditDrawer → address updated in group state |
| 10 WFH + 1 office | 11 groups → 11 DCs (10 WFH, 1 office) |
| Partial dispatch (3 of 5 now) | User unchecks 2 → submit creates DC for 3, rest remain attached |
| No serials attached | Empty state with link to Laptops & QC tab |
| DC already exists for some serials | Backend rejects: status != 'attached' |

---

## SECTION 5 — BUILD ORDER

1. Backend: Add `createDcsByAddress` to `salesManagementController.js`
2. Backend: Add route `POST /api/sales-management/create-dcs-by-address`
3. Frontend: Add `createDcsByAddress` to `salesPipelineApi.js`
4. Frontend: Replace entire `DCForm.jsx` with the new version above
5. Test all 8 scenarios from the matrix

---

## SECTION 6 — QUALITY CHECKLIST

  [ ] SO with 2 laptops, 2 different addresses → Submit creates 2 DCs
  [ ] SO with 2 laptops, same address → Submit creates 1 DC
  [ ] SO with 10 WFH laptops → 10 groups shown → "Create 10 DCs" button
  [ ] Each DC group card shows: address, contact name, phone, laptop list
  [ ] QC-not-passed laptops shown in group card but unchecked / disabled
  [ ] Warning: "N laptops haven't passed QC — skipped"
  [ ] User can uncheck individual laptop → excluded from DC
  [ ] User can edit address per group → AddressEditDrawer opens
  [ ] Global dispatch mode applies to all DCs
  [ ] For courier: AWB field per DC group (different AWB per shipment)
  [ ] For inhouse: different technician selectable per DC group
  [ ] "No laptops attached" empty state shown when no serials on SO
  [ ] Backend rejects if same allocation_id in two groups
  [ ] Backend rejects if laptop not QC-passed
  [ ] Backend rejects if laptop not 'attached' to this SO
  [ ] Security amount split proportionally across DCs
  [ ] After creation: toast shows "N DCs created: DC-X, DC-Y, ..."
  [ ] After creation: navigates to first DC's detail page
  [ ] Old `createDC` API still works for legacy/manual DC creation without SO

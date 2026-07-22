# RENTFOXXY CRM — PHASE 20 BUILD PROMPT
## Complete Pickup Flow Redesign — Return DC + Technician Laptop Bucket
### Branch: new_crm_rentfoxxy

---

## WHAT EXISTS (verified from codebase)

- `generateReturnDc` in `salesManagementController.js` — creates `delivery_challan_lines`
  row with `movement_type='return'` — WORKS, just not exposed cleanly
- `support_ticket_items` has: `pickup_method`, `pickup_assigned_to`,
  `pickup_courier_name`, `pickup_awb`, `warehouse_otp_code`, `pod_image_path`
- `delivery_challan_lines` has: `movement_type`, `dispatch_mode`, `support_ticket_id`
- `support_tickets` has: `return_dc_number`, `pickup_address`
- `getItemStepperV3Pickup` → Assigned → Pickup → POD → Warehouse OTP → Closed
- `logLoanMachine` and `schedulePickup` — REMOVE from frontend (loan concept deleted)

## WHAT NEEDS CHANGING

1. Add `pickup_type` column: `'repair'` | `'return'` (missing)
2. Remove loan machine section from pickup UI entirely
3. Redesign pickup creation flow: type selection → dispatch assignment → Return DC auto-created
4. Technician bucket laptop section (currently only parts exist)
5. Pickup flow: Reached → POD photo → Customer OTP → Warehouse delivery → Warehouse OTP/e-sign
6. Warehouse delivery confirmation via e-sign (same as parts challan)

---

## SECTION 1 — DATABASE MIGRATION 099

```sql
-- ============================================================
-- Migration 099: Pickup flow redesign
-- ============================================================

-- 1. Pickup type on support_ticket_items
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS pickup_type VARCHAR(20)
    CHECK (pickup_type IS NULL OR pickup_type IN ('repair', 'return')),
  ADD COLUMN IF NOT EXISTS customer_otp_code       VARCHAR(6),
  ADD COLUMN IF NOT EXISTS customer_otp_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_otp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_received_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_esign_url     TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_esign_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_esign_by      INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS porter_tracking_id      VARCHAR(200),
  ADD COLUMN IF NOT EXISTS porter_order_id         VARCHAR(200),
  ADD COLUMN IF NOT EXISTS return_dc_number        VARCHAR(50);

-- Backfill: if pickup_awb is set but pickup_type is NULL → assume 'return'
UPDATE support_ticket_items
SET pickup_type = 'return'
WHERE item_type = 'pickup' AND pickup_type IS NULL AND pickup_awb IS NOT NULL;

-- Default remaining to 'repair'
UPDATE support_ticket_items
SET pickup_type = 'repair'
WHERE item_type = 'pickup' AND pickup_type IS NULL;

-- 2. Support technician bucket — laptop section
--    (parts bucket already exists as support_part_requests with status='issued')
--    Laptop bucket = support_ticket_items with item_type='pickup' AND
--    pickup_method='technician' AND status NOT IN ('resolved','closed')
--    No new table needed — query existing tables

-- 3. Step current_step values for the new pickup flow
-- New steps for pickup items:
--   unassigned → assigned → in_transit → reached → pod_uploaded →
--   customer_otp → warehouse_received → warehouse_confirmed → closed

-- 4. Remove loan fields from UI (columns kept in DB for backward compat)
-- loan_machine_serial, loan_delivered_at, pickup_scheduled_at remain in DB
-- but are deprecated from all new frontend flows
```

---

## SECTION 2 — PICKUP CREATION FLOW (Support Lead)

### New pickup creation modal — replaces the current `addWorkflowPhaseItems` call for pickups

When support lead opens "Add Pickup" on a ticket:

**STEP 1: Select Pickup Type**
```
What type of pickup is this?

[ 🔧 Repair Pickup ]    [ 🔄 Return Pickup ]
  Laptop is damaged.      Customer is returning
  Take it to warehouse    the laptop (end of
  for repair.             rental / replacement)
```

**STEP 2: Pickup address**
- Pre-fill from the customer's service address on the complaint item
- Allow override (for WFH or different location)

**STEP 3: Select dispatch method**
```
How will the laptop be picked up?

[ 👤 Assign Technician ]  [ 🚚 Courier ]  [ 🛵 Porter ]
```

Based on selection:
- Technician: dropdown of `delivery_technicians` (active only)
- Courier: courier_name + AWB + tracking URL
- Porter: porter_tracking_id + porter_order_id + booking_url

**STEP 4: Preview + Confirm**
```
Creating Return DC: RDC-000015
Pickup type: Repair
Laptop: TTSPL0023 (Dell Latitude 5430)
Dispatch: Technician — Amit Kaur
Pickup address: B-204 DLF Cyber City, Gurugram

[Confirm — Create Return DC]
```

On confirm:
1. Create `support_ticket_items` row (`item_type='pickup'`, `pickup_type=...`)
2. Call `generateReturnDc` → creates `delivery_challan_lines` row
3. Store `return_dc_number` on the pickup item
4. If technician → appears in their laptop bucket

---

## SECTION 3 — BACKEND: PICKUP CONTROLLER UPDATES

### 3A — Updated `addWorkflowPhaseItems` — handle pickup_type

In `supportController.js`, update `insertTicketItem` to accept `pickup_type`:

```javascript
// In insertTicketItem function, add pickup_type to INSERT:
await client.query(
  `INSERT INTO support_ticket_items
     (...existing fields..., pickup_type)
   VALUES (..., $N)`,
  [...existing params, item.pickup_type || null]
);
```

### 3B — New endpoint: `exports.createPickupWithReturnDc`
`POST /support/tickets/:ticketId/pickup`
Role: support_lead, admin

```javascript
exports.createPickupWithReturnDc = async (req, res) => {
  if (!isSupportLead(req.user))
    return res.status(403).json({ success: false, message: 'Support lead only' });

  const ticketId = parseInt(req.params.ticketId, 10);
  const {
    source_item_id,        // the complaint/replacement item being picked up
    pickup_type,           // 'repair' | 'return'
    pickup_address,        // { name, phone, address, city, state, pincode }
    dispatch_mode,         // 'technician' | 'courier' | 'porter'
    technician_user_id,    // if dispatch_mode='technician'
    courier_name, awb_number, courier_tracking_url,
    porter_tracking_id, porter_order_id, porter_booking_url,
  } = req.body;

  if (!['repair','return'].includes(pickup_type))
    return res.status(400).json({ success: false, message: 'pickup_type must be repair or return' });
  if (!['technician','courier','porter'].includes(dispatch_mode))
    return res.status(400).json({ success: false, message: 'Invalid dispatch_mode' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticketRes = await client.query(
      'SELECT * FROM support_tickets WHERE id = $1', [ticketId]
    );
    if (!ticketRes.rows.length)
      throw Object.assign(new Error('Ticket not found'), { status: 404 });
    const ticket = ticketRes.rows[0];

    if (ticket.return_dc_number)
      throw new Error(`Return DC already exists: ${ticket.return_dc_number}`);

    // Get laptop details from source item
    let serial = null, ttsplId = null, brand = null, model = null;
    let ram = null, storage = null, generation = null, custInvId = null;
    if (source_item_id) {
      const srcRes = await client.query(
        'SELECT * FROM support_ticket_items WHERE id=$1 AND ticket_id=$2',
        [source_item_id, ticketId]
      );
      if (srcRes.rows.length) {
        const src = srcRes.rows[0];
        serial = src.serial_number;
        ttsplId = src.ttspl_id || src.unique_serial_number;
        brand = src.brand; model = src.model;
        ram = src.ram; storage = src.storage; generation = src.generation;
        custInvId = src.customer_inventory_id;
      }
    }

    // Generate customer OTP
    const customerOtp = String(Math.floor(100000 + Math.random() * 900000));

    // Build pickup method fields
    let pickupMethod = dispatch_mode;
    let pickupAssignedTo = null;
    let courierName = null, awb = null, porterTrackingId = null, porterOrderId = null;

    if (dispatch_mode === 'technician') {
      pickupAssignedTo = technician_user_id ? parseInt(technician_user_id, 10) : null;
    } else if (dispatch_mode === 'courier') {
      courierName = courier_name || null;
      awb = awb_number || null;
    } else if (dispatch_mode === 'porter') {
      porterTrackingId = porter_tracking_id || null;
      porterOrderId = porter_order_id || null;
    }

    // Create pickup item
    const insertRes = await client.query(
      `INSERT INTO support_ticket_items
         (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
          ttspl_id, brand, model, ram, storage, generation,
          item_type, pickup_type, status, source_item_id,
          pickup_method, pickup_assigned_to, pickup_courier_name, pickup_awb,
          porter_tracking_id, porter_order_id,
          customer_otp_code, customer_otp_sent_at,
          effective_current_step)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               'pickup',$11,'assigned',$12,
               $13,$14,$15,$16,$17,$18,$19,NOW(),'assigned')
       RETURNING id`,
      [
        ticketId, custInvId, serial, ttsplId, ttsplId,
        brand, model, ram, storage, generation,
        pickup_type, source_item_id || null,
        pickupMethod, pickupAssignedTo, courierName, awb,
        porterTrackingId, porterOrderId, customerOtp,
      ]
    );
    const pickupItemId = insertRes.rows[0].id;

    // Save pickup_address on ticket
    if (pickup_address) {
      await client.query(
        `UPDATE support_tickets SET pickup_address = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(pickup_address), ticketId]
      );
    }

    // Generate Return DC via existing generateReturnDc logic
    const rdc = await nextDocumentNumber('return_dc');
    const pickupAddr = pickup_address || {};
    const deliveryPersonId = dispatch_mode === 'technician' && technician_user_id
      ? parseInt(technician_user_id, 10) : null;

    // Build serial entries for return DC
    const serialCode = ttsplId || serial;
    let entries = [];
    if (serialCode) {
      const vsnRes = await client.query(
        `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
         WHERE (inventory_asset_code = $1 OR serial_number = $1) AND deleted_at IS NULL LIMIT 1`,
        [serialCode]
      );
      const vsn = vsnRes.rows[0];
      entries = vsn
        ? [`${vsn.serial_id}|${vsn.serial_number}|${vsn.inventory_asset_code || serialCode}`]
        : [`||${serialCode}`];
    }

    await client.query(
      `INSERT INTO delivery_challan_lines
         (dc_number, movement_type, support_ticket_id, customer_id, customer_name,
          customer_shipping_address, brand, model_name, quantity, serial_number,
          dispatch_mode, delivery_person_id,
          courier_name, awb_number, porter_tracking_id, porter_order_id,
          status, dispatched_at, created_by, created_at, updated_at)
       VALUES ($1,'return',$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,
               $12,$13,$14,$15,'in_transit',NOW(),$16,NOW(),NOW())`,
      [
        rdc, ticketId, ticket.customer_id, ticket.customer_name,
        JSON.stringify(pickupAddr), brand, model, Math.max(1, entries.length),
        JSON.stringify(entries), dispatch_mode === 'technician' ? 'inhouse' : dispatch_mode,
        deliveryPersonId, courierName, awb, porterTrackingId, porterOrderId,
        req.user.user_id,
      ]
    );

    // Update support_ticket_items and support_tickets with the Return DC number
    await client.query(
      `UPDATE support_ticket_items SET return_dc_number = $1, updated_at = NOW() WHERE id = $2`,
      [rdc, pickupItemId]
    );
    await client.query(
      `UPDATE support_tickets SET
         return_dc_number = $1,
         status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
         updated_at = NOW()
       WHERE id = $2`,
      [rdc, ticketId]
    );

    await logAudit(client, {
      itemId: pickupItemId, ticketId, userId: req.user.user_id,
      action: 'pickup_created',
      detail: { pickup_type, dispatch_mode, return_dc_number: rdc, ttspl_id: ttsplId }
    });
    await bumpTicketActivity(client, ticketId);
    await client.query('COMMIT');

    const data = await getTicketWithItems(ticketId, req.user);
    res.status(201).json({
      success: true,
      pickup_item_id: pickupItemId,
      return_dc_number: rdc,
      dispatch_mode,
      message: `Pickup created. Return DC: ${rdc}. OTP sent.`,
      customer_otp_visible: customerOtp,  // shown ONLY to admin/lead in ticket
      ...data,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('createPickupWithReturnDc:', e);
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};
```

### 3C — New endpoint: `exports.markPickupReached`
`POST /support/items/:itemId/pickup-reached`
Captures GPS, transitions to 'reached' step

```javascript
exports.markPickupReached = async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const { latitude, longitude } = req.body || {};

  const item = await pool.query('SELECT * FROM support_ticket_items WHERE id=$1', [itemId]);
  if (!item.rows.length)
    return res.status(404).json({ success: false, message: 'Item not found' });
  const it = item.rows[0];

  if (it.item_type !== 'pickup')
    return res.status(400).json({ success: false, message: 'Only for pickup items' });
  if (it.assigned_to !== req.user.user_id && it.pickup_assigned_to !== req.user.user_id && !isSupportLead(req.user))
    return res.status(403).json({ success: false, message: 'Not assigned to this pickup' });

  await pool.query(
    `UPDATE support_ticket_items SET
       visited_at = NOW(), visited_lat = $2, visited_lng = $3,
       effective_current_step = 'reached', status = 'visited',
       updated_at = NOW()
     WHERE id = $1`,
    [itemId, latitude ? String(latitude) : null, longitude ? String(longitude) : null]
  );

  await logAudit(pool, { itemId, ticketId: it.ticket_id, userId: req.user.user_id,
    action: 'pickup_reached', detail: { latitude, longitude } });

  const data = await getTicketWithItems(it.ticket_id, req.user);
  res.json({ success: true, message: 'Marked as reached', ...data });
};
```

### 3D — New endpoint: `exports.verifyPickupCustomerOtp`
`POST /support/items/:itemId/verify-pickup-otp`

```javascript
exports.verifyPickupCustomerOtp = async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const { otp } = req.body || {};

  const item = await pool.query('SELECT * FROM support_ticket_items WHERE id=$1', [itemId]);
  if (!item.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const it = item.rows[0];

  if (!it.pod_image_path && !it.proof_of_completion_path)
    return res.status(400).json({ success: false, message: 'Upload POD photo first before verifying OTP' });

  const stored = it.customer_otp_code;
  if (!stored || String(otp).trim() !== stored)
    return res.status(400).json({ success: false, message: 'Invalid OTP. Ask the customer for the correct OTP.' });

  await pool.query(
    `UPDATE support_ticket_items SET
       customer_otp_verified_at = NOW(),
       effective_current_step = 'customer_otp',
       status = 'picked_up',
       picked_up_at = NOW(),
       updated_at = NOW()
     WHERE id = $1`,
    [itemId]
  );

  const data = await getTicketWithItems(it.ticket_id, req.user);
  res.json({ success: true, message: 'OTP verified. Laptop picked up successfully.', ...data });
};
```

### 3E — New endpoint: `exports.confirmWarehouseReceipt`
`POST /support/items/:itemId/warehouse-confirm`
Role: warehouse, admin, support_lead
Body: `{ esign_data: 'data:image/png;base64,...', signer_name: '...' }`

```javascript
exports.confirmWarehouseReceipt = async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const { esign_data, signer_name } = req.body || {};

  if (!['warehouse','admin','support_lead','manager'].includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Warehouse access required' });
  if (!esign_data?.startsWith('data:image'))
    return res.status(400).json({ success: false, message: 'Warehouse e-sign required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const item = await client.query('SELECT * FROM support_ticket_items WHERE id=$1', [itemId]);
    if (!item.rows.length) throw Object.assign(new Error('Not found'), { status: 404 });
    const it = item.rows[0];

    if (it.item_type !== 'pickup')
      throw new Error('Only for pickup items');
    if (it.customer_otp_verified_at == null)
      throw new Error('Customer OTP must be verified before warehouse can confirm receipt');

    // Save e-sign
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../uploads/support-pickups');
    fs.mkdirSync(dir, { recursive: true });
    const fname = `wh_esign_${it.id}_${Date.now()}.png`;
    const b64 = esign_data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(dir, fname), Buffer.from(b64, 'base64'));
    const esignUrl = `uploads/support-pickups/${fname}`;

    await client.query(
      `UPDATE support_ticket_items SET
         warehouse_received_at = NOW(),
         warehouse_esign_url = $2,
         warehouse_esign_at = NOW(),
         warehouse_esign_by = $3,
         effective_current_step = 'warehouse_confirmed',
         status = 'inventory_updated',
         resolved_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [itemId, esignUrl, req.user.user_id]
    );

    // If repair pickup → create floor QC ticket automatically
    if (it.pickup_type === 'repair') {
      const stageRes = await client.query(
        `SELECT stage_id FROM stages WHERE stage_name='Floor Manager' LIMIT 1`
      );
      const stageId = stageRes.rows[0]?.stage_id;
      if (stageId) {
        const code = it.ttspl_id || it.unique_serial_number || it.serial_number;
        const vsnRes = await client.query(
          `SELECT serial_id, inventory_asset_code FROM vendor_serial_numbers
           WHERE (inventory_asset_code=$1 OR serial_number=$1) AND deleted_at IS NULL LIMIT 1`,
          [code]
        );
        const vsn = vsnRes.rows[0];
        const ftRes = await client.query(
          `INSERT INTO tickets
             (serial_number, ttspl_id, brand, model, ram, storage, generation,
              status, priority, ticket_type, current_stage_id, vendor_serial_id,
              initial_condition)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'in_progress','normal','grn_qc',$8,$9,
             'Returned from customer via support pickup for repair')
           RETURNING ticket_id`,
          [it.serial_number, it.ttspl_id || it.unique_serial_number,
           it.brand, it.model, it.ram, it.storage, it.generation,
           stageId, vsn?.serial_id || null]
        );
        const floorTicketId = ftRes.rows[0]?.ticket_id;

        await client.query(
          `UPDATE support_ticket_items SET floor_ticket_id=$1 WHERE id=$2`,
          [floorTicketId, itemId]
        );

        // Update vendor_serial inventory_status
        if (vsn?.serial_id) {
          await client.query(
            `UPDATE vendor_serial_numbers SET
               inventory_status='returned', current_customer_id=NULL,
               status_changed_at=NOW(), updated_at=NOW()
             WHERE serial_id=$1`,
            [vsn.serial_id]
          );
        }
      }
    }

    // If return pickup → update customer inventory to passivated
    if (it.pickup_type === 'return' && it.customer_inventory_id) {
      await client.query(
        `UPDATE customer_inventory SET
           status='returned', passivated_at=NOW(),
           passivated_reason='Returned by customer via support pickup'
         WHERE id=$1`,
        [it.customer_inventory_id]
      );
    }

    // Update return DC status to delivered
    if (it.return_dc_number) {
      await client.query(
        `UPDATE delivery_challan_lines SET
           status='delivered', delivered_at=NOW(), updated_at=NOW()
         WHERE dc_number=$1 AND movement_type='return'`,
        [it.return_dc_number]
      );
    }

    await logAudit(client, {
      itemId, ticketId: it.ticket_id, userId: req.user.user_id,
      action: 'warehouse_receipt_confirmed',
      detail: { pickup_type: it.pickup_type, floor_ticket_created: it.pickup_type === 'repair' }
    });
    await bumpTicketActivity(client, it.ticket_id);
    await recomputeTicketStatus(client, it.ticket_id);
    await client.query('COMMIT');

    const data = await getTicketWithItems(it.ticket_id, req.user);
    res.json({ success: true, message: 'Warehouse receipt confirmed.', ...data });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally { client.release(); }
};
```

### 3F — Update routes in `backend/routes/support.js`

```javascript
// REMOVE old pickup routes:
// router.post('/items/:itemId/loan-machine', logLoanMachine);
// router.post('/items/:itemId/schedule-pickup', schedulePickup);
// (keep functions in controller for backward compat but remove routes)

// ADD new pickup routes:
router.post('/tickets/:ticketId/pickup',           requireSupportLead, createPickupWithReturnDc);
router.post('/items/:itemId/pickup-reached',       markPickupReached);
router.post('/items/:itemId/verify-pickup-otp',    markPickupReached); // reuse reached handler
router.post('/items/:itemId/verify-pickup-otp',    verifyPickupCustomerOtp);
router.post('/items/:itemId/warehouse-confirm',    confirmWarehouseReceipt);
```

---

## SECTION 4 — PICKUP STEPPER: NEW STEPS

### Update `getItemStepperV3Pickup` in `utils.js`

```javascript
export const getItemStepperV3Pickup = (item) => {
  const es = item.effective_current_step || (item.pickup_assigned_to ? 'assigned' : 'unassigned');

  const steps = [
    { key: 'assigned',            label: 'Assigned' },
    { key: 'reached',             label: 'Reached' },
    { key: 'pod',                 label: 'POD Photo' },
    { key: 'customer_otp',        label: 'Customer OTP' },
    { key: 'warehouse_confirmed', label: 'Warehouse' },
    { key: 'closed',              label: 'Done' },
  ];

  const idxMap = {
    unassigned:          0,
    assigned:            0,
    in_transit:          0,    // legacy
    reached:             1,
    visited:             1,    // legacy alias
    pod_uploaded:        2,
    fixed_pending_pod:   2,    // legacy alias
    customer_otp:        3,
    picked_up:           3,    // legacy alias
    warehouse_confirmed: 4,
    inventory_updated:   5,
    resolved:            5,
    closed:              5,
  };

  let currentIndex = idxMap[es] ?? 0;
  if (isClosed(item)) currentIndex = steps.length - 1;
  return {
    steps,
    currentIndex,
    completedThrough: Math.max(0, currentIndex - 1)
  };
};
```

---

## SECTION 5 — FRONTEND: PICKUP ITEM CARD (complete rewrite)

### New `PickupItemCard` component

Replace the old pickup section in `SupportTicketDetail.jsx` with this:

```jsx
/**
 * PickupItemCard — step-by-step pickup flow for technician
 * Used inside SupportTicketDetail for item_type='pickup'
 */
function PickupItemCard({ item, ticket, user, onUpdated, api }) {
  const [esignOpen, setEsignOpen] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); onUpdated?.(); }
    catch (e) { toast.error(e.response?.data?.message || 'Action failed'); }
    finally { setBusy(false); }
  };

  const isTech   = ['support_tech'].includes(user?.role);
  const isLead   = ['support_lead','admin','manager'].includes(user?.role);
  const isWH     = ['warehouse','admin','support_lead','manager'].includes(user?.role);
  const isMyPickup = item.pickup_assigned_to === user?.user_id ||
                     item.assigned_to === user?.user_id;
  const canActTech = isTech && isMyPickup;

  const es = item.effective_current_step || 'assigned';
  const isCourier = item.pickup_method === 'courier';
  const isPorter  = item.pickup_method === 'porter';
  const isInhouse = item.pickup_method === 'technician' || item.pickup_method === 'inhouse';

  // Dispatch badge
  const dispatchBadge = isCourier
    ? `🚚 Courier${item.pickup_courier_name ? ` — ${item.pickup_courier_name}` : ''}`
    : isPorter
    ? `🛵 Porter${item.porter_tracking_id ? ` — ${item.porter_tracking_id}` : ''}`
    : `👤 Technician`;

  const pickupTypeBadge = item.pickup_type === 'repair'
    ? '🔧 Repair Pickup'
    : '🔄 Return Pickup';

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    run(async () => {
      const fd = new FormData();
      fd.append('pod', file);
      await api.post(`/support/items/${item.id}/pod`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
    });
  };

  const handleReached = () => {
    setBusy(true);
    const doMark = (lat, lng) => {
      api.post(`/support/items/${item.id}/pickup-reached`, {
        latitude: lat, longitude: lng
      })
        .then(() => onUpdated?.())
        .catch((e) => toast.error(e.response?.data?.message || 'Failed'))
        .finally(() => setBusy(false));
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => doMark(p.coords.latitude, p.coords.longitude),
        () => { toast('Location unavailable', { icon: '⚠️' }); doMark(null, null); },
        { timeout: 10000 }
      );
    } else { doMark(null, null); }
  };

  const handleVerifyOtp = () => run(async () => {
    await api.post(`/support/items/${item.id}/verify-pickup-otp`, { otp: otpInput.trim() });
    toast.success('OTP verified! Laptop picked up.');
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-orange-700 p-4 text-white">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{pickupTypeBadge}</span>
              <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{dispatchBadge}</span>
            </div>
            <p className="font-bold text-lg mt-1.5">{item.brand} {item.model}</p>
            <p className="text-sm text-orange-100 font-mono">
              {item.ttspl_id || item.unique_serial_number || item.serial_number}
            </p>
          </div>
          {item.return_dc_number && (
            <a href={`/sales-pipeline/delivery-challans/${item.return_dc_number}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs bg-white/10 px-2 py-1 rounded-lg text-orange-100 hover:bg-white/20">
              {item.return_dc_number} ↗
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[item.generation, item.ram, item.storage].filter(Boolean).map((v) => (
            <span key={v} className="px-2 py-0.5 bg-white/10 rounded-full text-xs">{v}</span>
          ))}
        </div>
      </div>

      {/* Customer OTP — visible to admin/lead only */}
      {(isLead || isWH) && item.customer_otp_code && !item.customer_otp_verified_at && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-amber-700 font-semibold uppercase tracking-wide mb-1">
            Customer OTP (Admin/Lead only)
          </p>
          <p className="font-mono text-2xl font-bold text-amber-900 tracking-widest">
            {item.customer_otp_code}
          </p>
          <p className="text-xs text-amber-600 mt-1">
            Share this OTP verbally with technician after laptop is picked up.
            Or ask customer to keep it for technician to enter.
          </p>
        </div>
      )}

      {/* Pickup address */}
      {ticket?.pickup_address && (
        <div className="mx-4 mt-3 p-3 bg-gray-50 rounded-xl text-sm">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">
            Pickup Address
          </p>
          <p className="font-medium text-gray-800">{ticket.pickup_address.name}</p>
          <p className="text-gray-600">{ticket.pickup_address.phone}</p>
          <p className="text-gray-600">{ticket.pickup_address.address}</p>
          <p className="text-gray-500 text-xs">
            {ticket.pickup_address.city}, {ticket.pickup_address.state} {ticket.pickup_address.pincode}
          </p>
          {ticket.pickup_address.city && (
            <a href={`https://www.google.com/maps/search/${encodeURIComponent(
              `${ticket.pickup_address.address}, ${ticket.pickup_address.city}`
            )}`} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 mt-1 inline-block">🗺 Open in Maps</a>
          )}
        </div>
      )}

      {/* Dispatch tracking info */}
      {(isCourier || isPorter) && (
        <div className="mx-4 mt-3 p-3 bg-blue-50 rounded-xl text-xs text-blue-800 space-y-0.5">
          {isCourier && item.pickup_courier_name && (
            <p><strong>Courier:</strong> {item.pickup_courier_name}</p>
          )}
          {isCourier && item.pickup_awb && (
            <p><strong>AWB:</strong> {item.pickup_awb}</p>
          )}
          {isPorter && item.porter_tracking_id && (
            <p><strong>Porter ID:</strong> {item.porter_tracking_id}</p>
          )}
        </div>
      )}

      {/* ── STEP WIZARD (inhouse technician only) ── */}
      {isInhouse && (
        <div className="p-4 space-y-3">

          {/* STEP: Mark Reached */}
          {(es === 'assigned' || es === 'in_transit') && (canActTech || isLead) && (
            <button type="button" disabled={busy} onClick={handleReached}
              className="w-full py-4 bg-orange-600 text-white rounded-2xl font-bold text-base
                active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2">
              <MapPin className="w-5 h-5" />
              {busy ? 'Getting location…' : 'I have reached the pickup location'}
            </button>
          )}

          {/* STEP: Upload POD */}
          {['reached','visited'].includes(es) && (canActTech || isLead) && (
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2">
                📷 Take Photo of Laptop (at customer site)
              </p>
              {item.pod_image_path || item.proof_of_completion_path ? (
                <div className="rounded-xl overflow-hidden border border-green-200">
                  <img
                    src={`/uploads/${item.proof_of_completion_path || item.pod_image_path}`}
                    alt="POD" className="w-full max-h-40 object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div className="bg-green-50 px-3 py-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-xs text-green-700 font-medium">Photo uploaded</span>
                  </div>
                </div>
              ) : (
                <label className="cursor-pointer block">
                  <input type="file" accept="image/*" capture="environment"
                    className="hidden" onChange={handlePhotoUpload} />
                  <div className={`w-full py-6 rounded-2xl border-2 border-dashed text-center
                    ${busy ? 'border-blue-200 bg-blue-50' : 'border-orange-200 bg-orange-50'}`}>
                    {busy
                      ? <div><div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" /><p className="text-sm text-orange-600">Uploading…</p></div>
                      : <div><Camera className="w-10 h-10 text-orange-300 mx-auto mb-2" /><p className="text-sm font-semibold text-orange-700">Tap to photo laptop</p><p className="text-xs text-orange-500 mt-1">Take photo before picking up</p></div>
                    }
                  </div>
                </label>
              )}
            </div>
          )}

          {/* STEP: Customer OTP */}
          {(item.pod_image_path || item.proof_of_completion_path) &&
           !item.customer_otp_verified_at && (canActTech || isLead) && (
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-1">Enter Customer OTP</p>
              <p className="text-xs text-gray-500 mb-2">
                Ask the customer for their OTP to confirm laptop handover.
              </p>
              <div className="flex gap-2">
                <input
                  type="tel" inputMode="numeric" maxLength={6}
                  value={otpInput} onChange={(e) => setOtpInput(e.target.value.replace(/\D/,''))}
                  placeholder="6-digit OTP"
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-center
                    text-2xl font-mono font-bold tracking-widest focus:ring-2 focus:ring-orange-500"
                  autoComplete="one-time-code"
                />
                <button type="button" disabled={busy || otpInput.length < 6} onClick={handleVerifyOtp}
                  className="px-5 py-3 bg-orange-600 text-white rounded-xl font-semibold disabled:opacity-50">
                  Verify
                </button>
              </div>
            </div>
          )}

          {/* STEP: Verified + now going to warehouse */}
          {item.customer_otp_verified_at && !item.warehouse_received_at && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <p className="font-semibold text-sm">OTP verified — laptop picked up</p>
              </div>
              <p className="text-xs text-green-600 mt-1">
                Carry the laptop to the warehouse.
                Warehouse team will e-sign to confirm receipt.
              </p>
            </div>
          )}

          {/* WAREHOUSE CONFIRMS (warehouse/lead action) */}
          {item.customer_otp_verified_at && !item.warehouse_received_at && isWH && (
            <button type="button" onClick={() => setEsignOpen(true)}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-sm
                active:scale-[0.98] transition flex items-center justify-center gap-2">
              ✍️ Warehouse Confirm Receipt (E-Sign)
            </button>
          )}

          {/* STEP: Warehouse confirmed */}
          {item.warehouse_received_at && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center gap-2 text-green-800 mb-2">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <p className="font-bold">Received at warehouse!</p>
              </div>
              {item.pickup_type === 'repair' && item.floor_ticket_id && (
                <p className="text-xs text-green-600">
                  🔧 Floor repair ticket #{item.floor_ticket_id} created automatically
                </p>
              )}
              {item.pickup_type === 'return' && (
                <p className="text-xs text-green-600">
                  ✓ Customer inventory updated — laptop marked as returned
                </p>
              )}
              {item.warehouse_esign_url && (
                <img src={`/${item.warehouse_esign_url}`} alt="WH sign"
                  className="mt-2 h-10 object-contain" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Courier / Porter: lead manages from delivery register */}
      {(isCourier || isPorter) && isLead && (
        <div className="p-4 text-sm text-gray-500 text-center">
          Track pickup via the <strong>Delivery Register</strong> → Return DCs.
          <br />
          <a href={`/delivery-register/return-dcs`} className="text-blue-600 text-xs mt-1 inline-block">
            Open Return DC register →
          </a>
        </div>
      )}

      {/* E-Sign modal for warehouse */}
      {esignOpen && (
        <WarehouseReceiptSignModal
          item={item}
          onSigned={() => { setEsignOpen(false); onUpdated?.(); }}
          onClose={() => setEsignOpen(false)}
          api={api}
        />
      )}
    </div>
  );
}

function WarehouseReceiptSignModal({ item, onSigned, onClose, api }) {
  const canvasRef = useRef(null);
  const padRef    = useRef(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    import('signature_pad').then(({ default: SP }) => {
      if (canvasRef.current) {
        padRef.current = new SP(canvasRef.current, {
          backgroundColor: 'rgb(255,255,255)', penColor: '#1A1A2E',
          minWidth: 1.5, maxWidth: 3,
        });
      }
    });
  }, []);

  const handleSave = async () => {
    if (!padRef.current || padRef.current.isEmpty()) { toast.error('Please sign'); return; }
    if (!name.trim()) { toast.error('Enter your name'); return; }
    setSaving(true);
    try {
      await api.post(`/support/items/${item.id}/warehouse-confirm`, {
        esign_data: padRef.current.toDataURL('image/png'),
        signer_name: name.trim(),
      });
      toast.success('Receipt confirmed. Laptop back in warehouse.');
      onSigned();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50">
      <div className="bg-white rounded-t-3xl w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-gray-900">✍️ Warehouse Receipt Confirmation</p>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Laptop: <strong>{item.ttspl_id || item.unique_serial_number}</strong>
          {' · '}{item.pickup_type === 'repair' ? 'Repair pickup' : 'Return pickup'}
        </p>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Warehouse staff name*"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3
            focus:ring-2 focus:ring-blue-500 outline-none" />
        <div className="border-2 border-gray-200 rounded-xl overflow-hidden mb-3">
          <p className="text-xs text-gray-400 px-3 pt-2 text-center">
            Sign to confirm you have received the laptop
          </p>
          <canvas ref={canvasRef} width={500} height={140}
            className="w-full touch-none bg-white block" style={{ touchAction: 'none' }} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => padRef.current?.clear()}
            className="flex-1 py-3 border rounded-xl text-sm">Clear</button>
          <button type="button" onClick={onClose}
            className="flex-1 py-3 border rounded-xl text-sm">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {saving ? 'Confirming…' : 'Confirm Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## SECTION 6 — SUPPORT LEAD: CREATE PICKUP MODAL

### New `CreatePickupModal.jsx`

```jsx
// Shown when lead clicks "Add Pickup" on a ticket
function CreatePickupModal({ ticket, items, onCreated, onClose }) {
  const [pickupType, setPickupType] = useState('');      // 'repair' | 'return'
  const [dispatchMode, setDispatchMode] = useState('');  // 'technician' | 'courier' | 'porter'
  const [sourceItemId, setSourceItemId] = useState('');
  const [pickupAddress, setPickupAddress] = useState({
    name: '', phone: '', address: '', city: '', state: '', pincode: ''
  });
  const [technicianId, setTechnicianId] = useState('');
  const [courierId, setCourierId] = useState({ name: '', awb: '' });
  const [porterId, setPorterId] = useState({ tracking_id: '', order_id: '' });
  const [technicians, setTechnicians] = useState([]);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    // Load delivery technicians
    fetch('/api/support/technicians', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTechnicians(d.technicians || []));
    // Pre-fill address from ticket
    if (ticket?.customer_name) {
      setPickupAddress(a => ({
        ...a,
        name: ticket.customer_name,
        phone: ticket.customer_phone || '',
      }));
    }
  }, []);

  // Complaint items available for pickup source
  const complaintItems = items.filter(i =>
    i.item_type === 'complaint' && ['resolved','visited'].includes(i.status)
  );

  const submit = async () => {
    setSaving(true);
    try {
      await fetch(`/api/support/tickets/${ticket.id}/pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pickup_type: pickupType,
          source_item_id: sourceItemId || null,
          pickup_address: pickupAddress,
          dispatch_mode: dispatchMode,
          technician_user_id: dispatchMode === 'technician' ? technicianId : null,
          courier_name: dispatchMode === 'courier' ? courierId.name : null,
          awb_number: dispatchMode === 'courier' ? courierId.awb : null,
          porter_tracking_id: dispatchMode === 'porter' ? porterId.tracking_id : null,
          porter_order_id: dispatchMode === 'porter' ? porterId.order_id : null,
        })
      }).then(r => r.json());
      toast.success('Pickup created with Return DC');
      onCreated();
      onClose();
    } catch (e) { toast.error('Failed to create pickup'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-gray-900">Create Pickup</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">✕</button>
        </div>

        <div className="p-4 space-y-5">
          {/* STEP 1: Type */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-2">
              Pickup Type*
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'repair', icon: '🔧', label: 'Repair Pickup', desc: 'Take to warehouse for repair' },
                { value: 'return', icon: '🔄', label: 'Return Pickup', desc: 'Customer returning laptop' },
              ].map((opt) => (
                <button key={opt.value} type="button"
                  onClick={() => setPickupType(opt.value)}
                  className={`p-3 border-2 rounded-xl text-left transition ${
                    pickupType === opt.value
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <p className="text-xl mb-1">{opt.icon}</p>
                  <p className="font-semibold text-sm">{opt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Source complaint item */}
          {complaintItems.length > 0 && (
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Linked Complaint (optional)
              </label>
              <select value={sourceItemId} onChange={(e) => setSourceItemId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
                <option value="">Not linked to a specific complaint</option>
                {complaintItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.ttspl_id || i.serial_number} — {i.brand} {i.model} ({i.issue_category_label || i.remarks?.slice(0,30)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Pickup address */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-2">
              Pickup Address*
            </label>
            <div className="space-y-2">
              {[
                ['Contact Name', 'name', 'text'],
                ['Phone', 'phone', 'tel'],
                ['Address', 'address', 'text'],
              ].map(([label, key, type]) => (
                <input key={key} type={type}
                  value={pickupAddress[key]}
                  onChange={(e) => setPickupAddress(a => ({ ...a, [key]: e.target.value }))}
                  placeholder={label}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
              ))}
              <div className="grid grid-cols-3 gap-2">
                {[['City','city'],['State','state'],['Pincode','pincode']].map(([label, key]) => (
                  <input key={key} value={pickupAddress[key]}
                    onChange={(e) => setPickupAddress(a => ({ ...a, [key]: e.target.value }))}
                    placeholder={label}
                    className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
                ))}
              </div>
            </div>
          </div>

          {/* Dispatch mode */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-2">
              Dispatch Method*
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'technician', icon: '👤', label: 'Technician' },
                { value: 'courier',   icon: '🚚', label: 'Courier' },
                { value: 'porter',    icon: '🛵', label: 'Porter' },
              ].map((opt) => (
                <button key={opt.value} type="button"
                  onClick={() => setDispatchMode(opt.value)}
                  className={`p-3 border-2 rounded-xl text-center transition ${
                    dispatchMode === opt.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <p className="text-xl mb-1">{opt.icon}</p>
                  <p className="font-semibold text-xs">{opt.label}</p>
                </button>
              ))}
            </div>

            {/* Technician select */}
            {dispatchMode === 'technician' && (
              <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mt-2">
                <option value="">Select technician…</option>
                {technicians.filter(t => t.is_active !== false).map((t) => (
                  <option key={t.user_id || t.id} value={t.user_id || t.id}>
                    {t.name}{t.phone ? ` — ${t.phone}` : ''}
                  </option>
                ))}
              </select>
            )}

            {/* Courier fields */}
            {dispatchMode === 'courier' && (
              <div className="space-y-2 mt-2">
                <input value={courierId.name} onChange={(e) => setCourierId(c => ({...c, name: e.target.value}))}
                  placeholder="Courier name" className="w-full border rounded-xl px-3 py-2.5 text-sm" />
                <input value={courierId.awb} onChange={(e) => setCourierId(c => ({...c, awb: e.target.value}))}
                  placeholder="AWB number" className="w-full border rounded-xl px-3 py-2.5 text-sm" />
              </div>
            )}

            {/* Porter fields */}
            {dispatchMode === 'porter' && (
              <div className="space-y-2 mt-2">
                <input value={porterId.tracking_id} onChange={(e) => setPorterId(p => ({...p, tracking_id: e.target.value}))}
                  placeholder="Porter tracking ID" className="w-full border rounded-xl px-3 py-2.5 text-sm" />
                <input value={porterId.order_id} onChange={(e) => setPorterId(p => ({...p, order_id: e.target.value}))}
                  placeholder="Porter order ID (optional)" className="w-full border rounded-xl px-3 py-2.5 text-sm" />
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t sticky bottom-0 bg-white">
          <button type="button"
            disabled={!pickupType || !dispatchMode || !pickupAddress.address || saving}
            onClick={submit}
            className="w-full py-4 bg-orange-600 text-white rounded-2xl font-bold text-base
              disabled:opacity-50 active:scale-[0.98]">
            {saving ? 'Creating…' : 'Create Pickup + Return DC'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## SECTION 7 — TECHNICIAN BUCKET: LAPTOP SECTION

### Update `TechBucketPage.jsx` — add Laptop tab

The existing bucket has Parts. Add Laptops tab:

```jsx
// Two tabs:
const TABS = [
  { id: 'laptops', label: 'Laptops', icon: Laptop },
  { id: 'parts',   label: 'Parts',   icon: Package },
];

// Laptop bucket = support_ticket_items with:
//   item_type='pickup'
//   pickup_method='technician' OR pickup_method='inhouse'
//   pickup_assigned_to = current user (for tech) OR any (for lead/manager)
//   status NOT IN ('resolved','closed','inventory_updated')

// New API:
// GET /api/support/tech-bucket/laptops

// Laptop card in bucket:
function LaptopBucketCard({ item }) {
  return (
    <div className="bg-white rounded-2xl border p-4">
      <div className="flex items-start justify-between">
        <div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            item.pickup_type === 'repair' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
          }`}>
            {item.pickup_type === 'repair' ? '🔧 Repair' : '🔄 Return'}
          </span>
          <p className="font-mono font-bold text-blue-700 mt-1">
            {item.ttspl_id || item.unique_serial_number}
          </p>
          <p className="text-sm text-gray-700">{item.brand} {item.model}</p>
          <p className="text-xs text-gray-500">{item.ram} · {item.storage}</p>
        </div>
        <div className="text-right">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            item.customer_otp_verified_at ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {item.customer_otp_verified_at ? '✓ Picked Up' : 'In Progress'}
          </span>
          {item.return_dc_number && (
            <p className="text-xs text-gray-400 mt-1 font-mono">{item.return_dc_number}</p>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-gray-500">
        <span>Ticket #{item.ticket_id}</span>
        <span>{item.customer_name}</span>
        {item.visited_lat && item.visited_lng && (
          <a href={`https://www.google.com/maps?q=${item.visited_lat},${item.visited_lng}`}
            target="_blank" rel="noopener noreferrer" className="text-blue-600">
            🗺 Location
          </a>
        )}
      </div>
    </div>
  );
}
```

### Add backend endpoint: `GET /api/support/tech-bucket/laptops`

In `supportController.js`:
```javascript
exports.getTechnicianLaptopBucket = async (req, res) => {
  const isTech = req.user.role === 'support_tech';
  const techFilter = isTech
    ? `AND (sti.pickup_assigned_to = ${req.user.user_id} OR sti.assigned_to = ${req.user.user_id})`
    : '';

  const { rows } = await pool.query(`
    SELECT sti.*, st.customer_name, st.ticket_number, st.customer_phone
    FROM support_ticket_items sti
    JOIN support_tickets st ON st.id = sti.ticket_id
    WHERE sti.item_type = 'pickup'
      AND sti.pickup_method IN ('technician','inhouse')
      AND sti.status NOT IN ('resolved','closed','inventory_updated')
      ${techFilter}
    ORDER BY sti.created_at DESC
  `);

  const grouped = {};
  rows.forEach((r) => {
    const key = r.pickup_assigned_to || r.assigned_to;
    if (!grouped[key]) grouped[key] = { tech_id: key, laptops: [] };
    grouped[key].laptops.push(r);
  });

  res.json({ success: true, bucket: Object.values(grouped), total: rows.length });
};
```

Add route:
```javascript
router.get('/tech-bucket/laptops', authMiddleware, getTechnicianLaptopBucket);
```

---

## SECTION 8 — REMOVE LOAN MACHINE FROM UI

In `SupportTicketDetail.jsx`, remove these sections entirely:
- `[loanSerial, setLoanSerial]` state
- `[loanAt, setLoanAt]` state  
- `[pickupAt, setPickupAt]` state
- `pickupMinScheduleDate` import
- The entire "Loan (optional)" section (lines ~419-435)
- The "Log loan machine delivery" button
- The "Proceed to mark pickup without loan" button
- The "Schedule pickup" datetime + button
- The `wait_72h` step reference
- The pickup notice block showing loan_machine_serial

These are replaced by the new `PickupItemCard` component.

Keep in DB (backward compat): `loan_machine_serial`, `loan_delivered_at`, `pickup_scheduled_at`
Remove from all new frontend: completely gone.

---

## SECTION 9 — BUILD ORDER

1. Run migration `099_pickup_flow_redesign.sql`
2. Backend: `supportController.js`
   - Add `createPickupWithReturnDc` endpoint
   - Add `markPickupReached` endpoint
   - Add `verifyPickupCustomerOtp` endpoint
   - Add `confirmWarehouseReceipt` endpoint
   - Add `getTechnicianLaptopBucket` endpoint
   - Add `pickup_type` to `insertTicketItem`
3. Backend: update routes in `support.js` — add new, remove loan/schedule
4. Frontend: update `getItemStepperV3Pickup` in `utils.js`
5. Frontend: create `CreatePickupModal.jsx`
6. Frontend: create `PickupItemCard.jsx` (with WarehouseReceiptSignModal)
7. Frontend: update `SupportTicketDetail.jsx`
   - Remove loan machine section
   - Replace old pickup content with new `PickupItemCard`
   - Add "Add Pickup" → opens `CreatePickupModal`
   - Show Customer OTP box (admin/lead only) on pickup items
8. Frontend: update `TechBucketPage.jsx` — add Laptops tab + LaptopBucketCard
9. Frontend: serve `uploads/support-pickups` statically in `server.js`

---

## SECTION 10 — QUALITY CHECKLIST

Pickup creation:
  [ ] "Add Pickup" button opens CreatePickupModal (support lead only)
  [ ] Two type options: Repair Pickup / Return Pickup
  [ ] Pickup address pre-fills from customer data
  [ ] Three dispatch methods: Technician / Courier / Porter
  [ ] Technician dropdown shows active delivery technicians only
  [ ] Courier fields: name + AWB
  [ ] Porter fields: tracking ID + order ID
  [ ] Return DC auto-created on confirm (RDC-XXXXXX)
  [ ] Customer OTP auto-generated + stored
  [ ] Pickup item + return DC linked via return_dc_number

Technician flow (inhouse):
  [ ] Step 1 (Assigned): "Mark as Reached" button — captures GPS
  [ ] Step 2 (Reached): "Take Photo of Laptop" camera input
  [ ] Photo uploads with multipart/form-data header — no Action Failed
  [ ] Step 3 (POD uploaded): Enter 6-digit OTP from customer
  [ ] Customer OTP visible to admin/lead in amber box at top of item card
  [ ] OTP input: tel type, numeric, 6-digit, prominent size
  [ ] Step 4 (OTP verified): "Carry to warehouse" message shown
  [ ] Warehouse staff button (E-Sign) visible to warehouse/admin/lead
  [ ] E-Sign modal: name input + canvas + clear + confirm
  [ ] On warehouse confirm: e-sign saved as PNG
  [ ] Repair pickup → floor QC ticket created automatically
  [ ] Return pickup → customer_inventory marked returned
  [ ] Return DC status → 'delivered' on warehouse confirm

Courier / Porter:
  [ ] Tracking info shown in card (courier name, AWB, porter ID)
  [ ] Lead instructed to track in Delivery Register → Return DCs
  [ ] Return DC row visible in delivery_challan_lines with movement_type='return'

Technician Bucket:
  [ ] Two tabs: Laptops | Parts
  [ ] Laptops tab shows all inhouse pickup items for tech
  [ ] Laptop card: TTSPL, brand, type badge, status, ticket ref, customer
  [ ] Lead/manager sees all technicians' laptops grouped
  [ ] Tech sees only own laptops

Removed (confirmed gone from UI):
  [ ] No loan machine serial input
  [ ] No "Proceed to mark pickup without loan" button
  [ ] No schedule pickup datetime picker
  [ ] No "72-hour wait" message
  [ ] No loan_delivered_at display
  [ ] No pickupMinScheduleDate logic in UI

OTP visibility:
  [ ] Customer OTP shown ONLY to admin/manager/support_lead in ticket detail
  [ ] Technician does NOT see the OTP — they type what customer says
  [ ] OTP box in amber / warning style with "Admin/Lead only" label

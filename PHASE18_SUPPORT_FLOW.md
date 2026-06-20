# RENTFOXXY CRM — PHASE 18 BUILD PROMPT
## Support Module: Complete Technician Flow + Replacement + Mobile UX
### Branch: new_crm_rentfoxxy

---

## EXISTING STATE (understand before changing anything)

- `support_tickets` — master ticket (customer-level)
- `support_ticket_items` — individual items: type = complaint/pickup/replacement
- `support_replacement_orders` — replacement tracking table (exists)
- `logVisit` → sets `visited_at`, `status='visited'` — NO lat/lng capture
- `setOutcome` → sets `outcome` = fixed/working/replacement_required
- `uploadPod` → saves to `uploads/support/`, field name `pod`
- Frontend sends `fd.append('pod', file)` → multer `upload.single('pod')` ✅ (match)
- **POD "Action Failed" bug**: The error comes from `markWorkDone` being called BEFORE
  `uploadPod` succeeds. `markWorkDone` requires `visited_at` to be set AND
  `item.item_type === 'complaint'` AND status not already terminal.
  The frontend's `run()` wrapper may fail silently if the API returns 400/500.
  Root cause: `markWorkDone` and `uploadPod` are separate calls — if either fails,
  the UI shows "Action Failed".
- `initiateReplacement` — support lead picks from `customer_inventory` (existing stock)
  but **does NOT** integrate with the SO/DC/delivery flow
- No TTSPL verify step in support technician flow
- No geolocation on visit
- CSS: has `@media (max-width: 1023px)` breakpoint but many sections not responsive

---

## SECTION 1 — DATABASE MIGRATION 090

```sql
-- ============================================================
-- Migration 090: Support module enhancements
-- ============================================================

-- 1. Geolocation on visit
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS visited_lat       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS visited_lng       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS ttspl_verified    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ttspl_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ttspl_verified_by INT REFERENCES users(user_id),

  -- Pickup warehouse tracking
  ADD COLUMN IF NOT EXISTS reached_warehouse_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_received_by  INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS floor_ticket_id        INT REFERENCES tickets(ticket_id),

  -- POD rename: pod_image_path → proof_of_completion_path (alias)
  ADD COLUMN IF NOT EXISTS proof_of_completion_path TEXT;

-- Migrate existing pod_image_path to proof_of_completion_path
UPDATE support_ticket_items
SET proof_of_completion_path = pod_image_path
WHERE pod_image_path IS NOT NULL
  AND proof_of_completion_path IS NULL;

-- 2. Replacement orders — link to sales flow
ALTER TABLE support_replacement_orders
  ADD COLUMN IF NOT EXISTS sales_order_number   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dc_number            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pickup_item_id       INT REFERENCES support_ticket_items(id),
  ADD COLUMN IF NOT EXISTS delivery_person_id   INT,
  ADD COLUMN IF NOT EXISTS pickup_assigned_to   INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS pickup_completed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_pod_path      TEXT,
  ADD COLUMN IF NOT EXISTS new_dc_number        VARCHAR(50);

-- 3. Permission section for support technician bucket
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('support_technician', 'Support Technician (field view)', 320)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_tech', 'support_technician', true, false, true, false),
  ('support_lead', 'support_technician', true, true, true, true),
  ('admin',        'support_technician', true, true, true, true),
  ('manager',      'support_technician', true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;
```

---

## SECTION 2 — BACKEND FIXES AND NEW ENDPOINTS

### 2A — Fix: `logVisit` — capture geolocation

In `backend/controllers/supportController.js`, update `exports.logVisit`:

```javascript
exports.logVisit = async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const { latitude, longitude } = req.body || {};

  const itemRes = await pool.query(
    'SELECT * FROM support_ticket_items WHERE id = $1', [itemId]
  );
  if (!itemRes.rows.length)
    return res.status(404).json({ success: false, message: 'Item not found' });
  const item = itemRes.rows[0];

  if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user))
    return res.status(403).json({ success: false, message: 'Not assigned to this item' });

  // Require TTSPL verified before marking visited
  if (!item.ttspl_verified && item.ttspl_id) {
    return res.status(400).json({
      success: false,
      message: 'Verify the TTSPL ID first before marking as reached'
    });
  }

  await pool.query(
    `UPDATE support_ticket_items SET
       visited_at = CURRENT_TIMESTAMP,
       status = 'visited',
       visited_lat = $2,
       visited_lng = $3,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [itemId, latitude ? String(latitude) : null, longitude ? String(longitude) : null]
  );

  await logAudit(pool, {
    itemId, ticketId: item.ticket_id, userId: req.user.user_id,
    action: 'tech_reached',
    detail: { latitude, longitude, address: req.body.address || null }
  });

  const data = await getTicketWithItems(item.ticket_id, req.user);
  res.json({ success: true, ...data });
};
```

### 2B — New endpoint: Verify TTSPL

```javascript
// POST /support/items/:itemId/verify-ttspl
exports.verifyTtspl = async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const { ttspl_input } = req.body || {};

  if (!ttspl_input?.trim())
    return res.status(400).json({ success: false, message: 'Enter TTSPL ID or serial number' });

  const itemRes = await pool.query(
    'SELECT * FROM support_ticket_items WHERE id = $1', [itemId]
  );
  if (!itemRes.rows.length)
    return res.status(404).json({ success: false, message: 'Item not found' });
  const item = itemRes.rows[0];

  if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user))
    return res.status(403).json({ success: false, message: 'Not assigned' });

  // Match against unique_serial_number (TTSPL ID) OR serial_number
  const expected_ttspl = (item.ttspl_id || item.unique_serial_number || '').trim().toUpperCase();
  const expected_serial = (item.serial_number || '').trim().toUpperCase();
  const input = ttspl_input.trim().toUpperCase();

  if (input !== expected_ttspl && input !== expected_serial) {
    return res.status(400).json({
      success: false,
      message: `TTSPL ID does not match this ticket. Expected ${expected_ttspl || expected_serial}.`
    });
  }

  await pool.query(
    `UPDATE support_ticket_items SET
       ttspl_verified = TRUE,
       ttspl_verified_at = CURRENT_TIMESTAMP,
       ttspl_verified_by = $2,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [itemId, req.user.user_id]
  );

  const data = await getTicketWithItems(item.ticket_id, req.user);
  res.json({ success: true, message: 'TTSPL verified', ...data });
};
```

### 2C — Fix: `uploadPod` — fix field name + rename to "Proof of Completion"

The route uses `upload.single('pod')` but the controller's internal comment
says "POD". No field name mismatch — the bug is something else.

**Actual bug**: The frontend calls:
```javascript
fd.append('pod', e.target.files[0]);
return api.post(`/support/items/${item.id}/pod`, fd);
```
This is correct. The real issue is that `api.post` uses the default Content-Type
from axios which may not set `multipart/form-data` correctly if the axios
instance has a default `Content-Type: application/json` header.

**Fix in frontend** — explicitly set multipart header:
```javascript
return api.post(
  `/support/items/${item.id}/pod`,
  fd,
  { headers: { 'Content-Type': 'multipart/form-data' } }
);
```

Also update the backend to save path to BOTH `pod_image_path` AND
`proof_of_completion_path`:

```javascript
await client.query(
  `UPDATE support_ticket_items SET
     pod_image_path = $2,
     proof_of_completion_path = $2,
     pod_uploaded_at = CURRENT_TIMESTAMP,
     updated_at = CURRENT_TIMESTAMP
   WHERE id = $1`,
  [itemId, relPath]
);
```

### 2D — New: Pickup flow when laptop is NOT repairable at site

When technician selects outcome = `replacement_required` AND picks up the laptop:

```javascript
// POST /support/items/:itemId/submit-for-pickup
// Body: { pickup_reason: 'Cannot repair onsite', carry_to_warehouse: true }
exports.submitForPickup = async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const { pickup_reason } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSupportTicketItemV3Columns(client);

    const itemRes = await client.query(
      'SELECT * FROM support_ticket_items WHERE id = $1', [itemId]
    );
    if (!itemRes.rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
    const item = itemRes.rows[0];

    if (item.assigned_to !== req.user.user_id && !isSupportLead(req.user))
      throw Object.assign(new Error('Not assigned'), { status: 403 });

    // Update item: mark as picked up, add pickup type
    await client.query(
      `UPDATE support_ticket_items SET
         status = 'picked_up',
         picked_up_at = CURRENT_TIMESTAMP,
         pickup_method = 'self_carry',
         outcome = 'repair_required',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [itemId]
    );

    // Create a pickup item on the same ticket to track the return journey
    await client.query(
      `INSERT INTO support_ticket_items
         (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
          brand, model, ram, storage, generation, ttspl_id,
          item_type, remarks, status, assigned_to, source_item_id)
       SELECT ticket_id, customer_inventory_id, serial_number, unique_serial_number,
              brand, model, ram, storage, generation, ttspl_id,
              'pickup', $2, 'in_transit', assigned_to, $1
       FROM support_ticket_items WHERE id = $1`,
      [itemId, pickup_reason || 'Laptop picked up for warehouse repair']
    );

    await logAudit(client, {
      itemId, ticketId: item.ticket_id, userId: req.user.user_id,
      action: 'laptop_picked_up',
      detail: { pickup_reason, method: 'self_carry' }
    });
    await bumpTicketActivity(client, item.ticket_id);
    await client.query('COMMIT');

    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({ success: true, ...data });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};
```

### 2E — New: Warehouse receives returned laptop → floor ticket

```javascript
// POST /support/items/:itemId/warehouse-received
// Role: warehouse, admin, support_lead
// Body: { notes? }
exports.warehouseReceivedPickup = async (req, res) => {
  const itemId = parseInt(req.params.itemId, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query(
      'SELECT * FROM support_ticket_items WHERE id = $1', [itemId]
    );
    if (!itemRes.rows.length) throw new Error('Item not found');
    const item = itemRes.rows[0];

    if (item.item_type !== 'pickup')
      throw new Error('Only pickup items can be received at warehouse');

    // Create a floor QC ticket for this laptop
    const stageRes = await client.query(
      `SELECT stage_id FROM stages WHERE stage_name = 'Floor Manager' LIMIT 1`
    );
    const stageId = stageRes.rows[0]?.stage_id;

    let floorTicketId = null;
    if (stageId) {
      // Get serial_id from vendor_serial_numbers
      const vsnRes = await client.query(
        `SELECT serial_id, inventory_asset_code FROM vendor_serial_numbers
         WHERE (inventory_asset_code = $1 OR serial_number = $1)
           AND deleted_at IS NULL LIMIT 1`,
        [item.unique_serial_number || item.serial_number]
      );
      const vsn = vsnRes.rows[0];

      if (vsn) {
        const ftRes = await client.query(
          `INSERT INTO tickets
             (serial_number, ttspl_id, brand, model, processor, ram, storage,
              status, priority, ticket_type, current_stage_id,
              vendor_serial_id, initial_condition)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'in_progress','normal','grn_qc',$8,$9,$10)
           RETURNING ticket_id`,
          [
            item.serial_number,
            item.ttspl_id || item.unique_serial_number,
            item.brand, item.model,
            null, item.ram, item.storage,
            stageId,
            vsn.serial_id,
            `Returned from customer via support ticket. Reason: ${item.remarks || 'repair'}`
          ]
        );
        floorTicketId = ftRes.rows[0]?.ticket_id;

        // Update serial status
        await client.query(
          `UPDATE vendor_serial_numbers SET
             inventory_status = 'returned',
             current_customer_id = NULL,
             status_changed_at = NOW(),
             updated_at = NOW()
           WHERE serial_id = $1`,
          [vsn.serial_id]
        );
      }
    }

    // Update the pickup item
    await client.query(
      `UPDATE support_ticket_items SET
         status = 'inventory_updated',
         reached_warehouse_at = CURRENT_TIMESTAMP,
         warehouse_received_by = $2,
         floor_ticket_id = $3,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [itemId, req.user.user_id, floorTicketId]
    );

    // Update customer_inventory: mark as returned
    if (item.customer_inventory_id) {
      await client.query(
        `UPDATE customer_inventory SET
           status = 'returned',
           passivated_at = NOW(),
           passivated_reason = 'Returned via support ticket for repair',
           updated_at = NOW()
         WHERE id = $1`,
        [item.customer_inventory_id]
      );
    }

    await bumpTicketActivity(client, item.ticket_id);
    await client.query('COMMIT');

    const data = await getTicketWithItems(item.ticket_id, req.user);
    res.json({
      success: true,
      floor_ticket_id: floorTicketId,
      message: floorTicketId
        ? `Received. Floor repair ticket #${floorTicketId} created.`
        : 'Received at warehouse.',
      ...data
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};
```

### 2F — Update: initiateReplacement — integrate with Sales Order flow

The current `initiateReplacement` picks from `customer_inventory` (existing customer stock).
**The new flow**: Support lead creates a replacement Sales Order (type='replacement'),
warehouse attaches a QC-passed laptop, dispatch QC, then DC to same technician.

```javascript
// Updated initiateReplacement — now creates a proper SO + tracks through DC flow
// POST /support/tickets/:ticketId/replacements
exports.initiateReplacement = async (req, res) => {
  if (!isSupportLead(req.user))
    return res.status(403).json({ success: false, message: 'Only team lead can initiate replacement' });

  const ticketId = parseInt(req.params.ticketId, 10);
  const {
    source_item_id,
    reason,
    replacement_laptop_config,  // { brand, processor, generation, ram, storage }
    // OPTION A: pick from existing available inventory (TTSPL ID)
    selected_ttspl_id,
    // OPTION B: let warehouse find matching laptop
    auto_assign_from_inventory,
  } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const srcRes = await client.query(
      'SELECT * FROM support_ticket_items WHERE id = $1 AND ticket_id = $2',
      [source_item_id, ticketId]
    );
    if (!srcRes.rows.length) throw new Error('Source item not found');
    const src = srcRes.rows[0];

    const ticketRes = await client.query(
      'SELECT * FROM support_tickets WHERE id = $1', [ticketId]
    );
    const ticket = ticketRes.rows[0];

    // Create replacement item in support_ticket_items
    const replacementItemRes = await client.query(
      `INSERT INTO support_ticket_items
         (ticket_id, customer_inventory_id, serial_number, unique_serial_number,
          brand, model, ram, storage, generation, ttspl_id,
          item_type, remarks, status, source_item_id)
       VALUES ($1, NULL, NULL, NULL, $2, $3, $4, $5, $6, NULL,
               'replacement', $7, 'order_placed', $8)
       RETURNING id`,
      [
        ticketId,
        replacement_laptop_config?.brand || src.brand,
        replacement_laptop_config?.model || src.model,
        replacement_laptop_config?.ram || src.ram,
        replacement_laptop_config?.storage || src.storage,
        replacement_laptop_config?.generation || src.generation,
        reason || src.replacement_flag_reason || 'Replacement required',
        source_item_id,
      ]
    );
    const replacementItemId = replacementItemRes.rows[0].id;

    // Create support_replacement_orders record
    await client.query(
      `INSERT INTO support_replacement_orders
         (ticket_id, item_id, source_item_id, old_customer_inventory_id,
          old_machine_serial, status, created_by, notes)
       VALUES ($1,$2,$3,$4,$5,'placed',$6,$7)`,
      [
        ticketId, replacementItemId, source_item_id,
        src.customer_inventory_id,
        src.unique_serial_number || src.serial_number,
        req.user.user_id,
        reason || src.replacement_flag_reason,
      ]
    );

    // Mark source item as replacement approved
    await client.query(
      `UPDATE support_ticket_items SET
         replacement_approved_by = $2,
         replacement_approved_at = CURRENT_TIMESTAMP,
         status = 'replacement_initiated',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [source_item_id, req.user.user_id]
    );

    await logAudit(client, {
      itemId: replacementItemId, ticketId,
      userId: req.user.user_id,
      action: 'replacement_initiated',
      detail: { source_item_id, replacement_laptop_config }
    });
    await bumpTicketActivity(client, ticketId);
    await client.query('COMMIT');

    const data = await getTicketWithItems(ticketId, req.user);
    res.json({
      success: true,
      replacement_item_id: replacementItemId,
      message: 'Replacement order placed. Warehouse will attach a laptop and create DC.',
      ...data
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};
```

### 2G — New: deliverReplacement — update inventory on both sides

Update `exports.deliverReplacement` to properly update vendor_serial_numbers:

```javascript
exports.deliverReplacement = async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      'SELECT * FROM support_replacement_orders WHERE id = $1', [orderId]
    );
    if (!orderRes.rows.length) throw new Error('Order not found');
    const order = orderRes.rows[0];

    const ticketRes = await client.query(
      'SELECT customer_id FROM support_tickets WHERE id = $1', [order.ticket_id]
    );
    const customerId = ticketRes.rows[0]?.customer_id;

    // 1. Passivate OLD laptop in customer_inventory
    if (order.old_customer_inventory_id) {
      await client.query(
        `UPDATE customer_inventory SET
           status = 'returned',
           passivated_at = NOW(),
           passivated_reason = 'Replaced via support ticket'
         WHERE id = $1`,
        [order.old_customer_inventory_id]
      );
    }

    // 2. Update OLD laptop in vendor_serial_numbers → 'returned'
    if (order.old_machine_serial) {
      await client.query(
        `UPDATE vendor_serial_numbers SET
           inventory_status = 'returned',
           current_customer_id = NULL,
           status_changed_at = NOW(),
           updated_at = NOW()
         WHERE (inventory_asset_code = $1 OR serial_number = $1)
           AND deleted_at IS NULL`,
        [order.old_machine_serial]
      );
    }

    // 3. Activate NEW laptop in customer_inventory
    if (order.new_customer_inventory_id) {
      await client.query(
        `UPDATE customer_inventory SET
           status = 'active',
           customer_id = $2,
           updated_at = NOW()
         WHERE id = $1`,
        [order.new_customer_inventory_id, customerId]
      );
    }

    // 4. Update NEW laptop in vendor_serial_numbers → 'out_stock'
    if (order.new_machine_serial) {
      await client.query(
        `UPDATE vendor_serial_numbers SET
           inventory_status = 'out_stock',
           current_customer_id = $2,
           rent_start_date = CURRENT_DATE,
           status_changed_at = NOW(),
           updated_at = NOW()
         WHERE (inventory_asset_code = $1 OR serial_number = $1)
           AND deleted_at IS NULL`,
        [order.new_machine_serial, customerId]
      );
    }

    // 5. Update replacement order
    await client.query(
      `UPDATE support_replacement_orders SET
         status = 'delivered',
         delivered_at = NOW(),
         inventory_updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    // 6. Update replacement item status
    await client.query(
      `UPDATE support_ticket_items SET
         status = 'inventory_updated',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [order.item_id]
    );

    await bumpTicketActivity(client, order.ticket_id);
    await client.query('COMMIT');

    const data = await getTicketWithItems(order.ticket_id, req.user);
    res.json({ success: true, message: 'Replacement delivered. Inventory updated.', ...data });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
};
```

### 2H — Add new routes to support.js

```javascript
router.post('/items/:itemId/verify-ttspl', verifyTtspl);
router.post('/items/:itemId/submit-pickup', submitForPickup);
router.post('/items/:itemId/warehouse-received',
  requireSupportLead,  // warehouse/support_lead/admin
  warehouseReceivedPickup
);
```

---

## SECTION 3 — FRONTEND: MOBILE-FIRST TECHNICIAN VIEW

### 3A — Complete rewrite of SupportTicketDetail.jsx technician flow

The technician sees a step-by-step wizard UI for each complaint item.
Steps are sequential — each step unlocks the next.

```
STEP 1: VERIFY TTSPL (locked until done)
STEP 2: MARK AS REACHED (captures GPS)
STEP 3: OUTCOME (Fixed / Not Fixed / Need Replacement)
STEP 4: PROOF OF COMPLETION (photo upload)
```

For REPLACEMENT REQUIRED outcome, additional options appear:
```
SUB-OPTION A: Pick up laptop (carry to warehouse)
SUB-OPTION B: Raise replacement request (support lead takes over)
```

**Full new component for the technician item card**:

```jsx
// SupportTechItemCard.jsx — Mobile-first technician view per item
// Each "step" is a large card with prominent action button

function StepIndicator({ steps, currentStep }) {
  return (
    <div className="flex items-center gap-0 mb-4">
      {steps.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <React.Fragment key={step}>
            <div className={`flex flex-col items-center`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                ${done ? 'bg-green-500 text-white' :
                  active ? 'bg-blue-600 text-white ring-4 ring-blue-100' :
                  'bg-gray-100 text-gray-400'}`}>
                {done ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] mt-1 text-center max-w-[60px] leading-tight
                ${active ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4
                ${i < currentStep ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function SupportTechItemCard({ item, onUpdated, api }) {
  const [verifyInput, setVerifyInput] = useState('');
  const [outcome, setOutcome] = useState('');
  const [outcomeComment, setOutcomeComment] = useState('');
  const [showPickupOptions, setShowPickupOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileRef = useRef(null);

  const steps = ['Verify', 'Reached', 'Outcome', 'POC'];
  const getCurrentStep = () => {
    if (!item.ttspl_verified) return 0;
    if (!item.visited_at) return 1;
    if (!item.outcome) return 2;
    return 3;
  };
  const currentStep = getCurrentStep();

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); onUpdated?.(); }
    catch (e) { toast.error(e.response?.data?.message || 'Action failed'); }
    finally { setBusy(false); }
  };

  // STEP 1: Verify TTSPL
  const handleVerify = () => run(async () => {
    await api.post(`/support/items/${item.id}/verify-ttspl`, { ttspl_input: verifyInput });
  });

  // STEP 2: Mark as Reached — capture GPS
  const handleReached = () => {
    setBusy(true);
    const doMark = (lat, lng) => {
      api.post(`/support/items/${item.id}/visit`, {
        latitude: lat ? String(lat) : null,
        longitude: lng ? String(lng) : null,
      })
        .then(() => onUpdated?.())
        .catch((e) => toast.error(e.response?.data?.message || 'Failed to mark reached'))
        .finally(() => setBusy(false));
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => doMark(pos.coords.latitude, pos.coords.longitude),
        () => {
          toast('Location unavailable — marking reached without GPS', { icon: '⚠️' });
          doMark(null, null);
        },
        { timeout: 10000 }
      );
    } else {
      doMark(null, null);
    }
  };

  // STEP 3: Set outcome
  const handleOutcome = (value) => run(async () => {
    await api.post(`/support/items/${item.id}/set-outcome`, {
      outcome: value,
      comment: outcomeComment,
    });
    setOutcome(value);
  });

  // STEP 4: Upload proof of completion
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    run(async () => {
      const fd = new FormData();
      fd.append('pod', file);
      await api.post(`/support/items/${item.id}/pod`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    });
  };

  // Pickup flow
  const handlePickup = () => run(async () => {
    await api.post(`/support/items/${item.id}/submit-pickup`, {
      pickup_reason: outcomeComment || 'Cannot repair onsite — picking up for warehouse repair'
    });
  });

  const isComplaint = item.item_type === 'complaint';
  const ttsplId = item.ttspl_id || item.unique_serial_number;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Item header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-200 uppercase tracking-wide">{item.item_type}</p>
            <p className="font-bold text-lg mt-0.5">{item.brand} {item.model}</p>
            <p className="text-sm text-blue-100">{ttsplId}</p>
          </div>
          <div className={`px-2 py-1 rounded-lg text-xs font-semibold capitalize
            ${item.status === 'resolved' || item.status === 'inventory_updated'
              ? 'bg-green-400 text-green-900'
              : 'bg-blue-500 text-white'}`}>
            {item.status?.replace(/_/g, ' ')}
          </div>
        </div>

        {/* Config chips */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[item.generation, item.ram, item.storage].filter(Boolean).map((v) => (
            <span key={v} className="px-2 py-0.5 bg-white/10 rounded-full text-xs">
              {v}
            </span>
          ))}
        </div>
      </div>

      {/* Issue + address */}
      <div className="p-4 border-b">
        {item.issue_category_label && (
          <p className="text-xs text-gray-500 mb-1">Issue: <strong>{item.issue_category_label}</strong></p>
        )}
        {item.remarks && (
          <p className="text-sm text-gray-600">{item.remarks}</p>
        )}
        {item.service_address && (
          <div className="mt-2 flex items-start gap-2 text-sm text-gray-600">
            <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <span>{item.service_address}</span>
          </div>
        )}
      </div>

      {/* STEP WIZARD */}
      {isComplaint && (
        <div className="p-4">
          <StepIndicator steps={steps} currentStep={currentStep} />

          {/* ── STEP 1: Verify TTSPL ── */}
          {currentStep === 0 && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">
                  Verify Laptop TTSPL ID
                </p>
                <p className="text-xs text-gray-500 mb-3">
                  Enter the TTSPL ID or serial number from the laptop label to confirm
                  you are working on the correct machine.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={verifyInput}
                    onChange={(e) => setVerifyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                    placeholder={`Enter ${ttsplId || 'TTSPL ID or serial'}`}
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    autoCapitalize="characters"
                  />
                  <button type="button" disabled={busy || !verifyInput.trim()}
                    onClick={handleVerify}
                    className="px-5 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 min-w-[72px]">
                    {busy ? '…' : 'Verify'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Mark as Reached ── */}
          {currentStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-900">Mark as Reached</p>
              <p className="text-xs text-gray-500">
                Press the button when you arrive at the customer location.
                Your GPS location will be recorded.
              </p>
              <button type="button" disabled={busy} onClick={handleReached}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl text-base font-bold
                  shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50
                  flex items-center justify-center gap-2">
                <MapPin className="w-5 h-5" />
                {busy ? 'Getting location…' : 'I have reached the location'}
              </button>
            </div>
          )}

          {/* ── STEP 3: Outcome ── */}
          {currentStep === 2 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-900">What happened?</p>

              <textarea
                value={outcomeComment}
                onChange={(e) => setOutcomeComment(e.target.value)}
                placeholder="Describe what you found / what you did (optional)"
                rows={2}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                  focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />

              <div className="grid grid-cols-1 gap-2">
                {/* Fixed */}
                <button type="button" disabled={busy}
                  onClick={() => handleOutcome('fixed')}
                  className="w-full py-4 rounded-2xl bg-green-50 border-2 border-green-200
                    text-green-800 font-semibold text-sm active:scale-[0.98] transition
                    flex items-center gap-3 px-4">
                  <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Fixed ✓</p>
                    <p className="text-xs text-green-600 font-normal">Issue resolved at site</p>
                  </div>
                </button>

                {/* Still working */}
                <button type="button" disabled={busy}
                  onClick={() => handleOutcome('working')}
                  className="w-full py-4 rounded-2xl bg-amber-50 border-2 border-amber-200
                    text-amber-800 font-semibold text-sm active:scale-[0.98] transition
                    flex items-center gap-3 px-4">
                  <Clock className="w-6 h-6 text-amber-500 flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Working Fine</p>
                    <p className="text-xs text-amber-600 font-normal">No issue found</p>
                  </div>
                </button>

                {/* Replacement required */}
                <button type="button" disabled={busy}
                  onClick={() => handleOutcome('replacement_required')}
                  className="w-full py-4 rounded-2xl bg-red-50 border-2 border-red-200
                    text-red-800 font-semibold text-sm active:scale-[0.98] transition
                    flex items-center gap-3 px-4">
                  <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Cannot Fix / Needs Replacement</p>
                    <p className="text-xs text-red-600 font-normal">
                      Not repairable at site
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ── REPLACEMENT REQUIRED sub-flow ── */}
          {item.outcome === 'replacement_required' && currentStep === 3 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-900 text-red-700">
                Laptop cannot be repaired at site
              </p>
              <p className="text-xs text-gray-500">Choose how to proceed:</p>

              <div className="space-y-2">
                {/* Option A: Pick up */}
                <button type="button" disabled={busy}
                  onClick={handlePickup}
                  className="w-full py-4 rounded-2xl bg-orange-50 border-2 border-orange-200
                    text-orange-800 font-semibold text-sm active:scale-[0.98] transition
                    flex items-center gap-3 px-4">
                  <Package className="w-6 h-6 text-orange-500 flex-shrink-0" />
                  <div className="text-left">
                    <p className="font-bold">Pick Up Laptop</p>
                    <p className="text-xs text-orange-600 font-normal">
                      Carry to warehouse for repair
                    </p>
                  </div>
                </button>

                {/* Option B: Leave — request replacement */}
                <div className="w-full py-4 rounded-2xl bg-purple-50 border-2 border-purple-100 px-4">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="w-6 h-6 text-purple-500 flex-shrink-0" />
                    <div>
                      <p className="font-bold text-purple-800 text-sm">Request Replacement</p>
                      <p className="text-xs text-purple-600 font-normal">
                        Leave laptop with customer, support lead will arrange replacement
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-purple-600 mt-2 ml-9">
                    ✓ Support lead has been notified
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 4: Proof of Completion ── */}
          {currentStep === 3 && item.outcome !== 'replacement_required' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-900">Proof of Completion</p>
              <p className="text-xs text-gray-500">
                Take a photo of the laptop at the customer site to confirm completion.
              </p>

              {item.pod_image_path || item.proof_of_completion_path ? (
                <div className="rounded-xl overflow-hidden border border-green-200">
                  <img
                    src={`/uploads/${item.proof_of_completion_path || item.pod_image_path}`}
                    alt="Proof of completion"
                    className="w-full max-h-48 object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div className="bg-green-50 px-3 py-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-xs text-green-700 font-medium">Proof uploaded</span>
                  </div>
                </div>
              ) : (
                <label className="block cursor-pointer">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handlePhotoChange}
                  />
                  <div className={`w-full py-6 rounded-2xl border-2 border-dashed
                    text-center transition-all active:scale-[0.98]
                    ${busy ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50'}`}>
                    {busy ? (
                      <div>
                        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-sm text-blue-600">Uploading…</p>
                      </div>
                    ) : (
                      <div>
                        <Camera className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm font-semibold text-gray-600">Tap to take photo</p>
                        <p className="text-xs text-gray-400 mt-1">or upload from gallery</p>
                      </div>
                    )}
                  </div>
                </label>
              )}
            </div>
          )}

          {/* Completed state */}
          {item.pod_uploaded_at && (
            <div className="mt-3 flex items-center gap-2 text-green-700 bg-green-50
              rounded-xl px-4 py-3">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <p className="text-sm font-semibold">Visit complete!</p>
            </div>
          )}
        </div>
      )}

      {/* Pickup item view */}
      {item.item_type === 'pickup' && (
        <PickupItemCard item={item} onUpdated={onUpdated} api={api} busy={busy} />
      )}

      {/* Replacement item view */}
      {item.item_type === 'replacement' && (
        <ReplacementStatusCard item={item} />
      )}
    </div>
  );
}
```

### 3B — PickupItemCard — for tracking the laptop return to warehouse

```jsx
function PickupItemCard({ item, onUpdated, api, busy }) {
  const steps = ['In Transit', 'Reached Warehouse', 'Done'];
  const currentStep = item.reached_warehouse_at ? 2 :
    item.picked_up_at ? 1 : 0;

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-5 h-5 text-orange-500" />
        <p className="font-semibold text-sm text-gray-900">Return to Warehouse</p>
      </div>

      <StepIndicator
        steps={steps}
        currentStep={currentStep}
      />

      {currentStep === 0 && (
        <div className="bg-orange-50 rounded-xl p-4 text-center">
          <p className="text-sm text-orange-800 font-medium">Laptop picked up</p>
          <p className="text-xs text-orange-600 mt-1">
            Please carry the laptop to the warehouse
          </p>
        </div>
      )}

      {currentStep === 1 && !item.reached_warehouse_at && (
        <button type="button" disabled={busy}
          onClick={() => {/* warehouse_received handled by warehouse user */}}
          className="w-full py-4 bg-orange-600 text-white rounded-2xl font-bold text-sm">
          Arrived at Warehouse (Warehouse staff confirms)
        </button>
      )}

      {item.reached_warehouse_at && (
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-1" />
          <p className="text-sm font-semibold text-green-800">Received at Warehouse</p>
          {item.floor_ticket_id && (
            <p className="text-xs text-green-600 mt-1">
              Floor repair ticket #{item.floor_ticket_id} created
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## SECTION 4 — SUPPORT LEAD VIEW: REPLACEMENT MANAGEMENT

### 4A — In SupportTicketDetail — add replacement initiation for leads

When a complaint item has `outcome = 'replacement_required'`:

```jsx
// In the lead-only section of SupportTicketDetail:
{item.outcome === 'replacement_required' && lead && !replacementOrder && (
  <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
    <p className="text-sm font-semibold text-purple-900 mb-2">
      🔄 Replacement Required
    </p>
    <p className="text-xs text-gray-500 mb-3">
      Flagged by {item.assigned_to_name}:
      <em> {item.replacement_flag_reason}</em>
    </p>

    {/* Config of laptop being replaced */}
    <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
      <div className="bg-white rounded-lg p-2 text-center">
        <p className="text-gray-400">Brand</p>
        <p className="font-semibold">{item.brand}</p>
      </div>
      <div className="bg-white rounded-lg p-2 text-center">
        <p className="text-gray-400">Config</p>
        <p className="font-semibold">{item.ram} · {item.storage}</p>
      </div>
      <div className="bg-white rounded-lg p-2 text-center">
        <p className="text-gray-400">Gen</p>
        <p className="font-semibold">{item.generation}</p>
      </div>
    </div>

    {/* Replacement options */}
    <div className="space-y-2">
      <button type="button" onClick={() => setShowReplacementModal(true)}
        className="w-full py-3 bg-purple-600 text-white rounded-xl text-sm font-semibold">
        Initiate Replacement Order
      </button>
    </div>
  </div>
)}

{/* Replacement order status */}
{replacementOrder && (
  <ReplacementOrderStatus
    order={replacementOrder}
    item={item}
    lead={lead}
    onAction={handleReplacementAction}
  />
)}
```

### 4B — ReplacementOrderStatus component

```jsx
function ReplacementOrderStatus({ order, item, lead, onAction }) {
  const STATUS_STEPS = [
    { key: 'placed',      label: 'Order Placed' },
    { key: 'dispatched',  label: 'Dispatched' },
    { key: 'delivered',   label: 'Delivered' },
    { key: 'inventory_updated', label: 'Done' },
  ];

  const currentIdx = STATUS_STEPS.findIndex((s) => s.key === order.status);

  return (
    <div className="bg-white rounded-xl border border-purple-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-sm text-purple-900">Replacement Order</p>
        <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800 font-medium capitalize">
          {order.status}
        </span>
      </div>

      {/* New laptop details */}
      {order.new_machine_serial && (
        <div className="bg-purple-50 rounded-lg p-2 mb-3 text-xs">
          <p className="text-purple-500">Replacement laptop:</p>
          <p className="font-mono font-semibold text-purple-900">{order.new_machine_serial}</p>
        </div>
      )}

      {/* Progress steps */}
      <div className="flex items-center gap-1 mb-4">
        {STATUS_STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              i <= currentIdx ? 'bg-purple-600' : 'bg-gray-200'
            }`} />
            {i < STATUS_STEPS.length - 1 && (
              <div className={`flex-1 h-px ${
                i < currentIdx ? 'bg-purple-400' : 'bg-gray-200'
              }`} />
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mb-3">
        {STATUS_STEPS.map((s) => <span key={s.key}>{s.label}</span>)}
      </div>

      {/* Lead actions */}
      {lead && (
        <div className="space-y-2">
          {order.status === 'placed' && (
            <button type="button" onClick={() => onAction('dispatch')}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold">
              Mark as Dispatched
            </button>
          )}
          {order.status === 'dispatched' && (
            <button type="button" onClick={() => onAction('deliver')}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold">
              Mark as Delivered + Update Inventory
            </button>
          )}
          {order.status === 'delivered' && (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">Replacement delivered. Inventory updated.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## SECTION 5 — MOBILE CSS FIXES

### Update `support.css`

```css
/* === MOBILE-FIRST OVERRIDES === */

/* Base: all support UI uses full width on mobile */
.support-container {
  max-width: 100%;
  padding: 0;
}

/* Ticket cards: full-bleed on mobile */
@media (max-width: 640px) {
  .support-ticket-card,
  .support-item-card {
    border-radius: 16px;
    border-left: none;
    border-right: none;
    margin-left: -16px;
    margin-right: -16px;
  }

  /* Buttons: minimum 48px touch target */
  .support-btn-primary,
  .support-btn-secondary,
  button[class*="support-btn"] {
    min-height: 48px;
    font-size: 16px; /* prevents iOS zoom */
    border-radius: 14px;
    padding: 0 20px;
  }

  /* Outcome buttons: full width, stacked */
  .support-v3-outcome-row {
    flex-direction: column;
    gap: 12px;
  }
  .support-v3-outcome-row > button {
    width: 100%;
    min-height: 64px;
    justify-content: flex-start;
    padding: 0 16px;
    font-size: 15px;
  }

  /* Item stepper: compact on mobile */
  .support-stepper-dots {
    gap: 4px;
  }

  /* Form inputs: prevent iOS zoom */
  input, textarea, select {
    font-size: 16px !important;
  }

  /* Ticket list: tighter padding */
  .support-ticket-list-item {
    padding: 12px 16px;
  }

  /* Navigation header: compact */
  .support-nav {
    height: 52px;
    padding: 0 12px;
  }
}

/* Safe area for phones with notches */
.support-layout-body {
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}
```

---

## SECTION 6 — SUPPORT LEAD DASHBOARD: Full Visibility

Update `SupportOverviewPage.jsx` to show full ticket context:

```jsx
// In each ticket row for support lead:
// Show: Customer | Items count | Status | Technician assigned | Location (if visited)

// Add location map link for visited items:
{item.visited_lat && item.visited_lng && (
  <a
    href={`https://www.google.com/maps?q=${item.visited_lat},${item.visited_lng}`}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
    <MapPin className="w-3 h-3" />
    View location
  </a>
)}
```

Add a "Replacement Orders" tab to SupportOverviewPage:
- Lists all `support_replacement_orders` across tickets
- Columns: Ticket | Customer | Old Laptop | New Laptop | Status | Created | Actions

---

## SECTION 7 — BUILD ORDER

1. Run migration `090_support_enhancements.sql`
2. Backend: update `logVisit` — accept lat/lng, add TTSPL verification check
3. Backend: add `verifyTtspl` endpoint + route
4. Backend: add `submitForPickup` endpoint + route
5. Backend: add `warehouseReceivedPickup` endpoint + route
6. Backend: update `initiateReplacement` — new SO-linked flow
7. Backend: update `deliverReplacement` — update vendor_serial_numbers both sides
8. Backend: fix `uploadPod` — save to `proof_of_completion_path` as well
9. Frontend: create `SupportTechItemCard.jsx` — full mobile step wizard
10. Frontend: create `PickupItemCard.jsx` — pickup tracking card
11. Frontend: create `ReplacementOrderStatus.jsx` — replacement status card
12. Frontend: update `SupportTicketDetail.jsx` — use new tech card + lead panels
13. Frontend: fix `uploadPod` axios call — add `Content-Type: multipart/form-data`
14. Frontend: update `support.css` — mobile-first CSS overrides
15. Frontend: update `SupportOverviewPage.jsx` — location links + replacement tab

---

## SECTION 8 — QUALITY CHECKLIST

TTSPL Verify:
  [ ] Technician sees TTSPL input before any other action
  [ ] Wrong TTSPL → "does not match" error shown clearly
  [ ] Correct TTSPL → verified, next step unlocked
  [ ] Step 1 locked/grayed until TTSPL verified

Geolocation:
  [ ] "Mark as Reached" button captures GPS coordinates
  [ ] If GPS denied → marks reached without coords + shows warning
  [ ] Support lead can click "View location" → opens Google Maps
  [ ] lat/lng stored in `visited_lat`, `visited_lng`

Outcome flow:
  [ ] 3 large touch-friendly buttons: Fixed / Working Fine / Cannot Fix
  [ ] Optional comment textarea above outcome buttons
  [ ] After selecting outcome → step 3 complete

Proof of Completion:
  [ ] Camera opens on mobile (`capture="environment"`)
  [ ] Photo preview shown before upload
  [ ] Loading spinner shown during upload
  [ ] "Action Failed" bug fixed — axios header set correctly
  [ ] After upload → green "Visit complete" banner shown
  [ ] Label says "Proof of Completion" not "Proof of Delivery"

Replacement Required sub-flow:
  [ ] Two clear options: "Pick Up Laptop" vs "Request Replacement"
  [ ] Pick Up → item status = 'picked_up', new pickup item created on same ticket
  [ ] Support lead sees notification when replacement flagged
  [ ] Lead sees replacement modal with original laptop config
  [ ] Lead clicks "Initiate Replacement Order" → SO + replacement item created

Warehouse receives laptop:
  [ ] Pickup item shows "In Transit" status for technician
  [ ] Warehouse confirms receipt → floor QC ticket created automatically
  [ ] Old laptop inventory_status → 'returned'
  [ ] Customer inventory record marked as 'returned'
  [ ] Floor ticket appears in technician bucket for repair

Replacement delivery (new laptop):
  [ ] Lead marks replacement as Dispatched
  [ ] Lead marks as Delivered → runs inventory update
  [ ] Old laptop inventory_status → 'returned'
  [ ] New laptop inventory_status → 'out_stock'
  [ ] New laptop linked to customer in customer_inventory

Mobile UX:
  [ ] All buttons minimum 48px tall
  [ ] No text smaller than 12px
  [ ] Input font-size 16px (prevents iOS zoom)
  [ ] Photo upload uses rear camera (`capture="environment"`)
  [ ] Step wizard visible and usable on 375px wide screen
  [ ] Support lead view shows full ticket with replacement management
  [ ] Geolocation works on Chrome mobile and Safari iOS

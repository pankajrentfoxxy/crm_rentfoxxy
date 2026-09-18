/**
 * Sale in Place — a customer keeps a laptop they hold on rent.
 *
 * Covers three reasons: the unit is `lost`, `damaged` beyond repair, or the
 * customer simply wants to `buyout` the unit they are renting. In all three the
 * goods never move, so **no Delivery Challan and no e-way bill is produced** — a
 * DC is a statutory record of a movement, and issuing one for a movement that
 * never happened is worse than having no document at all.
 *
 * Shape of the flow:
 *   1. report()            -> stops customer rent + vendor rent, raises the credit note
 *   2. recordVendorBuyout()-> (vendor-rented units only) we now own it
 *   3. sale order created with fulfillment_mode='in_place', serials attached
 *   4. confirmSale()       -> rented -> sold, in place, no DC
 *   5. accounts attach the Zoho invoice against the SO
 *
 * createInPlaceSale() runs steps 1, 3 and 4 as ONE transaction from the customer's
 * Assets tab, so the team never has to raise the SO by hand. Owned units are sold
 * on the spot; vendor-rented units stay attached to the SO until their buyout is
 * recorded, and recordVendorBuyout() then confirms them automatically.
 *
 * VENDOR-RENTED UNITS — read this before changing anything here.
 * `purchase_order_type` lives on vendor_purchase_orders and is shared by every
 * serial on that PO (PO-0009 carries 451). It must NEVER be flipped to convert a
 * single laptop: generateVendorBill selects on it, so that would silently drop
 * every other rented serial out of the vendor's monthly bill. Ownership is
 * recorded per serial via vendor_serial_numbers.acquisition_type instead.
 * Stopping the vendor rent is a separate, independent lever:
 * vendor_serial_numbers.vendor_rent_end_date, which the bill query already
 * honours per serial.
 */
const pool = require('../config/db');
const inventorySM = require('./inventoryStateMachine');
const { createReturnCreditNote } = require('./billingSchedulerService');
const { createNotificationsForUsers } = require('./notificationService');
const { logTtsplEvent } = require('./ttsplAuditService');

const REASONS = Object.freeze(['lost', 'damaged', 'buyout']);
const VENDOR_RENTAL_PO_TYPES = Object.freeze(['rental_purchase', 'rent_to_own']);
/** Roles told to chase the vendor buyout bill. */
const PROCUREMENT_ROLES = Object.freeze(['procurement', 'admin', 'super_admin']);

class SaleInPlaceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const toYmd = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Effective acquisition type: the per-serial override shadows the shared PO. */
const EFFECTIVE_ACQ_SQL = `COALESCE(vsn.acquisition_type, vpo.purchase_order_type)`;

/** True when this serial has a sale-in-place case that has not reached an SO yet. */
async function hasOpenSaleInPlaceEvent(db, serialId) {
  const r = await (db || pool).query(
    `SELECT 1 FROM sale_in_place_events
      WHERE serial_id = $1 AND sales_order_number IS NULL LIMIT 1`,
    [serialId]
  );
  return r.rows.length > 0;
}

/** The open case row for a serial, or null. */
async function getOpenEvent(db, serialId) {
  const r = await (db || pool).query(
    `SELECT * FROM sale_in_place_events
      WHERE serial_id = $1 AND sales_order_number IS NULL LIMIT 1`,
    [serialId]
  );
  return r.rows[0] || null;
}

function validateReason(reason) {
  if (!REASONS.includes(String(reason))) {
    throw new SaleInPlaceError(`reason must be one of: ${REASONS.join(', ')}`);
  }
}

function validateReportedOn(reportedOn) {
  const ymd = toYmd(reportedOn);
  if (!ymd) throw new SaleInPlaceError('reported_on is required (YYYY-MM-DD)');
  if (new Date(`${ymd}T00:00:00`) > new Date()) {
    throw new SaleInPlaceError('reported_on cannot be in the future');
  }
  return ymd;
}

function normalizeIds(serialIds) {
  const ids = [...new Set((serialIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new SaleInPlaceError('At least one serial is required');
  return ids;
}

/**
 * Lock the serials and return their rows, in serial_id order. Every write path
 * takes these locks first so a concurrent attach / return cannot race it.
 */
async function lockSerials(client, ids) {
  const sr = await client.query(
    `SELECT vsn.serial_id, vsn.inventory_status, vsn.current_customer_id,
            vsn.rent_start_date, vsn.rent_monthly_rate, vsn.current_dc_number,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            ${EFFECTIVE_ACQ_SQL} AS effective_acq_type,
            vpo.vendor_id
       FROM vendor_serial_numbers vsn
       LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE vsn.serial_id = ANY($1::int[]) AND vsn.deleted_at IS NULL
      ORDER BY vsn.serial_id
      FOR UPDATE OF vsn`,
    [ids]
  );
  if (sr.rows.length !== ids.length) {
    throw new SaleInPlaceError('One or more serials were not found', 404);
  }
  return sr.rows;
}

/** A unit can only be sold in place while it is on rent with this very customer. */
function assertRentedToCustomer(s, customerId) {
  const label = s.ttspl_id || `serial ${s.serial_id}`;
  if (String(s.inventory_status) !== 'rented') {
    throw new SaleInPlaceError(
      `${label} is not on rent (status: ${s.inventory_status || 'none'}) — only rented units can be sold in place`
    );
  }
  if (Number(s.current_customer_id) !== Number(customerId)) {
    throw new SaleInPlaceError(`${label} is not currently with this customer`);
  }
}

/**
 * Stop rent on already-locked, already-validated serials. Runs inside the
 * caller's transaction. Returns the per-serial results plus the vendor units
 * Procurement must be told about once the caller commits.
 */
async function stopRentInTx(client, { customerId, serials, reason, ymd, notes, actorUserId }) {
  const results = [];
  const vendorChases = [];
  for (const s of serials) {
    // (a) Stop customer rent. Status stays 'rented' until the sale is confirmed.
    await client.query(
      `UPDATE vendor_serial_numbers
          SET rent_end_date = $2::date, updated_at = NOW()
        WHERE serial_id = $1`,
      [s.serial_id, ymd]
    );

    // (b) Vendor leg — stop the vendor clock for THIS SERIAL ONLY.
    //     Never touch vendor_purchase_orders.purchase_order_type here.
    const vendorRented = VENDOR_RENTAL_PO_TYPES.includes(String(s.effective_acq_type));
    if (vendorRented) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET vendor_rent_end_date = $2::date, updated_at = NOW()
          WHERE serial_id = $1`,
        [s.serial_id, ymd]
      );
      vendorChases.push({ serialId: s.serial_id, ttsplId: s.ttspl_id, vendorId: s.vendor_id });
    }

    // (c) The case record.
    const ev = await client.query(
      `INSERT INTO sale_in_place_events
         (serial_id, customer_id, reason, reported_on, rent_stopped_on,
          vendor_id, vendor_settled, notes, created_by)
       VALUES ($1,$2,$3,$4::date,$4::date,$5,$6,$7,$8)
       RETURNING *`,
      [s.serial_id, customerId, reason, ymd,
        vendorRented ? s.vendor_id : null, !vendorRented, notes, actorUserId]
    );

    // (d) Credit the unused prepaid days.
    //     createMissingReturnCreditNotes only finds units with a physical return
    //     pickup (support_ticket_items.warehouse_received_at), which a lost unit
    //     never has — so the credit MUST be raised explicitly here. The callee
    //     carries its own duplicate guard and consolidates per customer.
    let creditNote = null;
    try {
      creditNote = await createReturnCreditNote(client, {
        serialId: s.serial_id,
        returnDate: ymd,
        customerId,
        source: 'sale_in_place',
        actorUserId,
      });
    } catch (err) {
      // A credit-note failure must not strand the rent stop, but it must be loud.
      throw new SaleInPlaceError(
        `${s.ttspl_id || s.serial_id}: could not raise the credit note — ${err.message}`,
        500
      );
    }
    if (creditNote?.credit_note_id) {
      await client.query(
        `UPDATE sale_in_place_events SET credit_note_id = $2, updated_at = NOW()
          WHERE event_id = $1`,
        [ev.rows[0].event_id, creditNote.credit_note_id]
      );
    }

    results.push({
      serial_id: s.serial_id,
      ttspl_id: s.ttspl_id,
      event_id: ev.rows[0].event_id,
      rent_stopped_on: ymd,
      vendor_settlement_required: vendorRented,
      vendor_id: vendorRented ? s.vendor_id : null,
      credit_note_number: creditNote?.credit_note_number || null,
      credit_note_id: creditNote?.credit_note_id || null,
    });
  }
  return { results, vendorChases };
}

/** Post-commit, best-effort: audit trail + chase Procurement for the buyout bill. */
function afterRentStopped({ results, vendorChases, reason, ymd, actorUserId }) {
  for (const r of results) {
    logTtsplEvent({
      ttsplId: r.ttspl_id,
      vendorSerialId: r.serial_id,
      eventType: 'sale_in_place_reported',
      description: `Reported ${reason} at customer — rent stopped ${ymd}`,
      actorUserId,
    }).catch((e) => console.error('[saleInPlace] ttspl audit:', e.message));
  }
  if (vendorChases.length) {
    notifyProcurementOfBuyout(vendorChases, reason)
      .catch((e) => console.error('[saleInPlace] procurement notify:', e.message));
  }
}

/**
 * Step 1 — report a unit as lost / damaged / bought out.
 *
 * Stops both meters (customer rent and, where applicable, vendor rent) and
 * raises the credit note for the unused prepaid days. Deliberately leaves
 * inventory_status = 'rented' so the unit stays attachable and visible while the
 * sale is being priced; it only becomes 'sold' at confirmSale().
 */
async function report({ customerId, serialIds, reason, reportedOn, notes = null, actorUserId = null }) {
  validateReason(reason);
  const ymd = validateReportedOn(reportedOn);
  const ids = normalizeIds(serialIds);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const serials = await lockSerials(client, ids);

    // Validate the whole batch before writing anything.
    for (const s of serials) {
      const label = s.ttspl_id || `serial ${s.serial_id}`;
      assertRentedToCustomer(s, customerId);
      if (s.rent_start_date && ymd < toYmd(s.rent_start_date)) {
        throw new SaleInPlaceError(
          `${label}: reported_on (${ymd}) is before the rent started (${toYmd(s.rent_start_date)})`
        );
      }
      if (await hasOpenSaleInPlaceEvent(client, s.serial_id)) {
        throw new SaleInPlaceError(`${label} already has an open sale-in-place case`);
      }
    }

    const { results, vendorChases } = await stopRentInTx(client, {
      customerId, serials, reason, ymd, notes, actorUserId,
    });
    await client.query('COMMIT');
    afterRentStopped({ results, vendorChases, reason, ymd, actorUserId });

    return { reported: results.length, reason, rent_stopped_on: ymd, items: results };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function notifyProcurementOfBuyout(chases, reason) {
  const u = await pool.query(
    `SELECT user_id FROM users
      WHERE role = ANY($1::text[]) AND active = TRUE AND COALESCE(status,'active') = 'active'`,
    [PROCUREMENT_ROLES]
  );
  const codes = chases.map((c) => c.ttsplId || c.serialId).join(', ');
  await createNotificationsForUsers(u.rows.map((r) => r.user_id), 'sale_in_place_buyout', {
    title: 'Vendor buyout needed',
    body: `${chases.length} vendor-rented laptop(s) reported ${reason} at a customer and are being sold in place: ${codes}. `
      + 'Vendor rent has been stopped. Obtain the vendor buyout bill, then record it against the serial.',
  });
}

/**
 * Step 2 — record that we have bought a vendor-rented unit out.
 *
 * Sets the PER-SERIAL ownership override. Does not, and must not, modify the
 * purchase order: it is shared with hundreds of other serials.
 *
 * If the unit is already attached to a sale-in-place order, that order is
 * confirmed for every unit that is now settled, so the laptop moves to the
 * customer's Purchased bucket without a second trip to the SO screen.
 */
async function recordVendorBuyout({ serialId, vendorBillNo, amount, actorUserId = null, actorName = null }) {
  const id = Number(serialId);
  if (!Number.isInteger(id) || id <= 0) throw new SaleInPlaceError('A valid serial_id is required');
  if (!String(vendorBillNo || '').trim()) throw new SaleInPlaceError('vendor_bill_no is required');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new SaleInPlaceError('amount must be greater than zero');

  const client = await pool.connect();
  let ttsplId = null;
  try {
    await client.query('BEGIN');
    const sr = await client.query(
      `SELECT serial_id, COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id
         FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    if (!sr.rows.length) throw new SaleInPlaceError('Serial not found', 404);
    ttsplId = sr.rows[0].ttspl_id;

    const ev = await getOpenEvent(client, id);
    if (!ev) throw new SaleInPlaceError('This serial has no open sale-in-place case', 409);
    if (!ev.vendor_id) throw new SaleInPlaceError('This unit is already owned — no vendor buyout is needed', 409);
    if (ev.vendor_settled) throw new SaleInPlaceError('The vendor buyout for this unit is already recorded', 409);

    await client.query(
      `UPDATE vendor_serial_numbers
          SET acquisition_type = 'direct_purchase',
              vendor_buyout_bill_no = $2, vendor_buyout_amount = $3,
              vendor_buyout_at = NOW(), vendor_buyout_by = $4, updated_at = NOW()
        WHERE serial_id = $1`,
      [id, String(vendorBillNo).trim(), amt, actorUserId]
    );
    await client.query(
      `UPDATE sale_in_place_events SET vendor_settled = TRUE, updated_at = NOW()
        WHERE event_id = $1`,
      [ev.event_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  logTtsplEvent({
    ttsplId,
    vendorSerialId: id,
    eventType: 'vendor_buyout_recorded',
    description: `Bought out from vendor — bill ${vendorBillNo}, amount ${amt}. Now direct_purchase.`,
    actorUserId,
  }).catch((e) => console.error('[saleInPlace] ttspl audit:', e.message));

  // The buyout is committed on its own: a failed confirmation must never undo it.
  let saleConfirmation = null;
  const so = await findOpenInPlaceOrderForSerial(pool, id);
  if (so) {
    try {
      saleConfirmation = await confirmSale({
        salesOrderNumber: so, actorUserId, actorName, partial: true,
      });
    } catch (err) {
      saleConfirmation = { sales_order_number: so, error: err.message };
    }
  }

  return {
    serial_id: id,
    acquisition_type: 'direct_purchase',
    vendor_settled: true,
    sales_order_number: so,
    sale_confirmation: saleConfirmation,
  };
}

/** The in-place SO a serial is attached to (not yet sold), or null. */
async function findOpenInPlaceOrderForSerial(db, serialId) {
  const r = await (db || pool).query(
    `SELECT sos.sales_order_number
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
      WHERE sos.serial_id = $1
        AND sos.status = 'attached'
        AND sol.fulfillment_mode = 'in_place'
        AND LOWER(COALESCE(sol.status, 'pending')) <> 'cancelled'
      ORDER BY sos.allocation_id DESC
      LIMIT 1`,
    [serialId]
  );
  return r.rows[0]?.sales_order_number || null;
}

/**
 * Confirm the sale inside the caller's transaction: rented -> sold, in place,
 * no DC. With `partial` a unit still awaiting its vendor buyout is skipped (it
 * stays attached and is confirmed when the buyout lands); without it the whole
 * order is refused until every vendor unit is settled.
 */
async function confirmInTx(client, { salesOrderNumber, partial = false, actorUserId = null, actorName = null }) {
  const so = String(salesOrderNumber || '').trim();
  if (!so) throw new SaleInPlaceError('sales_order_number is required');

  const lines = await client.query(
    `SELECT id, fulfillment_mode, quantity, main_qty, rate, status, customer_id, entity_code
       FROM sales_order_lines WHERE sales_order_number = $1 FOR UPDATE`,
    [so]
  );
  if (!lines.rows.length) throw new SaleInPlaceError('Sales order not found', 404);

  const live = lines.rows.filter((l) => String(l.status || '').toLowerCase() !== 'cancelled');
  if (!live.length) throw new SaleInPlaceError('Every line on this sales order is cancelled', 409);
  if (!live.every((l) => l.fulfillment_mode === 'in_place')) {
    throw new SaleInPlaceError('This is not a sale-in-place order — use the normal dispatch flow', 409);
  }
  const unpriced = live.find((l) => !(Number(l.rate) > 0));
  if (unpriced) throw new SaleInPlaceError('Every line needs a sale price greater than zero before confirming');

  const ordered = live.reduce((n, l) => n + Math.max(0, Number(l.main_qty ?? l.quantity ?? 0)), 0);
  // 'dispatched' = already sold in place by an earlier (partial) confirmation.
  const alloc = await client.query(
    `SELECT sos.allocation_id, sos.serial_id, sos.status,
            COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
            vsn.inventory_status, vsn.rent_end_date, vsn.delivered_at
       FROM sales_order_serials sos
       JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
      WHERE sos.sales_order_number = $1 AND sos.status IN ('attached', 'dispatched')
      FOR UPDATE OF sos, vsn`,
    [so]
  );
  if (alloc.rows.length !== ordered) {
    throw new SaleInPlaceError(
      `All ${ordered} unit(s) must be attached before confirming (currently ${alloc.rows.length})`,
      409
    );
  }
  const pending = alloc.rows.filter((a) => a.status === 'attached');
  if (!pending.length) {
    if (partial) return { sales_order_number: so, sold_count: 0, items: [], awaiting_vendor_buyout: [] };
    throw new SaleInPlaceError('Every laptop on this order is already sold', 409);
  }

  // Every vendor-rented unit must be bought out first — we cannot pass title on
  // a laptop we are still renting from a vendor.
  const unsettled = await client.query(
    `SELECT e.serial_id, COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id
       FROM sale_in_place_events e
       JOIN vendor_serial_numbers vsn ON vsn.serial_id = e.serial_id
      WHERE e.serial_id = ANY($1::int[])
        AND e.sales_order_number IS NULL
        AND e.vendor_id IS NOT NULL
        AND e.vendor_settled = FALSE`,
    [pending.map((a) => a.serial_id)]
  );
  if (unsettled.rows.length && !partial) {
    throw new SaleInPlaceError(
      `Vendor buyout not yet recorded for: ${unsettled.rows.map((r) => r.ttspl_id).join(', ')}`,
      409
    );
  }
  const waiting = new Set(unsettled.rows.map((r) => Number(r.serial_id)));

  const customerId = live[0].customer_id;
  const entityCode = live[0].entity_code || null;
  const sold = [];
  for (const a of pending) {
    if (waiting.has(Number(a.serial_id))) continue;
    const ev = await getOpenEvent(client, a.serial_id);
    if (!ev) {
      throw new SaleInPlaceError(
        `${a.ttspl_id || a.serial_id} has no open sale-in-place case — it cannot be sold in place`,
        409
      );
    }

    await inventorySM.markSoldInPlace(client, a.serial_id, {
      salesOrderNumber: so,
      customerId,
      entityCode,
      reason: ev.reason,
      rentEndDate: a.rent_end_date || ev.rent_stopped_on,
      // Keep the original delivery date: the unit reached the customer then, not today.
      deliveredAt: a.delivered_at || null,
      actorUserId,
      actorName,
    });

    // Fulfilled without a movement: no DC number, deliberately.
    await client.query(
      `UPDATE sales_order_serials
          SET status = 'dispatched', dc_number = NULL, updated_at = NOW()
        WHERE allocation_id = $1`,
      [a.allocation_id]
    );
    await client.query(
      `UPDATE sale_in_place_events
          SET sales_order_number = $2, updated_at = NOW()
        WHERE event_id = $1`,
      [ev.event_id, so]
    );
    sold.push({ serial_id: a.serial_id, ttspl_id: a.ttspl_id, reason: ev.reason });
  }

  return {
    sales_order_number: so,
    sold_count: sold.length,
    items: sold,
    awaiting_vendor_buyout: unsettled.rows.map((r) => ({ serial_id: r.serial_id, ttspl_id: r.ttspl_id })),
  };
}

/**
 * Step 4 — confirm the sale. Replaces dispatch + delivery for an in-place SO.
 * No DC is created and no e-way bill is required.
 */
async function confirmSale({ salesOrderNumber, actorUserId = null, actorName = null, partial = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await confirmInTx(client, { salesOrderNumber, partial, actorUserId, actorName });
    await client.query('COMMIT');
    if (result.sold_count) await regenerateSalesOrderPdf(result.sales_order_number);
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Best-effort: rebuild the SO PDF so the customer copy matches the current state. */
async function regenerateSalesOrderPdf(salesOrderNumber) {
  try {
    const { getSalesOrderLines } = require('./salesManagementService');
    const { generateDocumentPdf } = require('./salesManagementPdfService');
    const lines = await getSalesOrderLines(salesOrderNumber);
    if (!lines.length) return null;
    const pdfPath = await generateDocumentPdf({
      docType: 'sales_order',
      docNumber: salesOrderNumber,
      header: lines[0],
      lines,
    });
    await pool.query(
      `UPDATE sales_order_lines SET pdf_path = $1 WHERE sales_order_number = $2`,
      [pdfPath, salesOrderNumber]
    );
    return pdfPath;
  } catch (e) {
    console.error('[saleInPlace] SO pdf:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// One-step flow from the customer's Assets tab: stop rent + raise the SO.
// ---------------------------------------------------------------------------

const REASON_LABELS = Object.freeze({
  lost: 'Lost by customer',
  damaged: 'Damaged beyond repair',
  buyout: 'Customer buyout',
});

/** Laptop config, same source precedence the SO attach uses. */
const SERIAL_SPEC_SQL = `
  SELECT vsn.serial_id, vsn.serial_number,
         COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
         vsn.inventory_status, vsn.current_customer_id, vsn.current_dc_number,
         vsn.rent_monthly_rate, vsn.rent_start_date, vsn.rent_end_date, vsn.rent_billed_until,
         vsn.delivered_at,
         ${EFFECTIVE_ACQ_SQL} AS effective_acq_type,
         vpo.vendor_id,
         COALESCE(v.business_name, NULLIF(TRIM(CONCAT_WS(' ', v.first_name, v.last_name)), '')) AS vendor_name,
         COALESCE(NULLIF(TRIM(vsn.extra->>'brand'), ''), NULLIF(TRIM(vsn.grn_received_config->>'brand'), ''),
                  NULLIF(TRIM(vpd.brand), '')) AS brand,
         COALESCE(NULLIF(TRIM(vsn.extra->>'model'), ''), NULLIF(TRIM(vsn.extra->>'model_name'), ''),
                  NULLIF(TRIM(vsn.grn_received_config->>'model'), ''), NULLIF(TRIM(vpd.model), '')) AS model_name,
         COALESCE(NULLIF(TRIM(vsn.extra->>'processor'), ''), NULLIF(TRIM(vsn.grn_received_config->>'processor'), ''),
                  NULLIF(TRIM(vpd.processor), '')) AS processor,
         COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), NULLIF(TRIM(vsn.grn_received_config->>'generation'), ''),
                  NULLIF(TRIM(vpd.generation), '')) AS generation,
         COALESCE(NULLIF(TRIM(vsn.extra->>'ram'), ''), NULLIF(TRIM(vsn.grn_received_config->>'ram'), ''),
                  NULLIF(TRIM(vpd.ram), '')) AS ram,
         COALESCE(NULLIF(TRIM(vsn.extra->>'storage'), ''), NULLIF(TRIM(vsn.extra->>'ssd'), ''),
                  NULLIF(TRIM(vsn.grn_received_config->>'storage'), ''), NULLIF(TRIM(vpd.storage), '')) AS storage,
         COALESCE(NULLIF(TRIM(vsn.extra->>'gpu'), ''), NULLIF(TRIM(vsn.grn_received_config->>'gpu'), ''),
                  NULLIF(TRIM(vpd.gpu), '')) AS gpu,
         COALESCE(NULLIF(TRIM(vsn.extra->>'screen_size'), ''), NULLIF(TRIM(vsn.grn_received_config->>'screen_size'), ''),
                  NULLIF(TRIM(vpd.screen_size), '')) AS screen_size,
         dc.customer_shipping_address AS dc_shipping_address
    FROM vendor_serial_numbers vsn
    LEFT JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
    LEFT JOIN vendors v ON v.vendor_id = vpo.vendor_id
    LEFT JOIN vendor_product_details vpd
      ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
    LEFT JOIN LATERAL (
      SELECT dcl.customer_shipping_address
        FROM delivery_challan_lines dcl
       WHERE dcl.dc_number = vsn.current_dc_number
         AND COALESCE(dcl.movement_type, 'outbound') = 'outbound'
       ORDER BY dcl.id DESC
       LIMIT 1
    ) dc ON TRUE
   WHERE vsn.serial_id = ANY($1::int[]) AND vsn.deleted_at IS NULL
   ORDER BY vsn.serial_id`;

/** ERP-migrated DC addresses carry placeholder city/state values; never trust them for GST. */
const PLACEHOLDER_ADDRESS_PARTS = new Set(['ujjain', 'uttar pradesh']);
const isPlaceholderPart = (v) => PLACEHOLDER_ADDRESS_PARTS.has(
  String(v || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
);

/** Normalise a stored address into the SO address shape. */
function toSoAddress(raw) {
  const { normalizeDeliveryAddress } = require('../utils/deliveryAddressUtils');
  const a = normalizeDeliveryAddress(raw);
  if (!a || !String(a.address || '').trim()) return null;
  return {
    name: String(a.name || a.company || '').trim(),
    phone: String(a.phone || a.mobile || '').trim(),
    country: 'India',
    address: String(a.address).trim(),
    city: isPlaceholderPart(a.city) ? '' : String(a.city || '').trim(),
    state: isPlaceholderPart(a.state) ? '' : String(a.state || '').trim(),
    zip_code: String(a.zip_code || a.pincode || '').trim(),
  };
}

function customerBillingAddress(c) {
  const details = c.details && typeof c.details === 'object' ? c.details : {};
  const displayName = c.company_name || c.name || '';
  const fromDetails = details.billing_address && typeof details.billing_address === 'object'
    ? details.billing_address
    : null;
  const base = fromDetails || {
    phone: c.phone || '',
    address: typeof c.billing_address === 'string' ? c.billing_address : '',
    city: c.billing_city || '',
    state: c.billing_state || '',
    zip_code: c.billing_pincode || '',
  };
  return {
    name: displayName,
    phone: String(base.phone || c.phone || '').trim(),
    country: 'India',
    address: String(base.address || '').trim(),
    city: String(base.city || '').trim(),
    state: String(base.state || '').trim(),
    zip_code: String(base.zip_code || base.pincode || '').trim(),
    gst_number: String(base.gst_number || c.gst_no || '').trim(),
  };
}

const addressKey = (a) => [a.address, a.zip_code].map((x) => String(x || '').trim().toLowerCase()).join('|');

/**
 * Everything the "stop rent + create sale order" screen needs to prefill: the
 * customer's billing address, each laptop's config / rent / ownership, and the
 * address each laptop was delivered to.
 */
async function getSalePrefill({ customerId, serialIds }) {
  const ids = normalizeIds(serialIds);
  const cr = await pool.query(
    `SELECT customer_id, name, company_name, email, phone, gst_no, status, customer_type,
            billing_address, billing_city, billing_state, billing_pincode, details
       FROM customers WHERE customer_id = $1`,
    [customerId]
  );
  const c = cr.rows[0];
  if (!c) throw new SaleInPlaceError('Customer not found', 404);

  const sr = await pool.query(SERIAL_SPEC_SQL, [ids]);
  const openEvents = await pool.query(
    `SELECT * FROM sale_in_place_events WHERE serial_id = ANY($1::int[]) AND sales_order_number IS NULL`,
    [ids]
  );
  const eventBySerial = new Map(openEvents.rows.map((e) => [Number(e.serial_id), e]));
  const attached = await pool.query(
    `SELECT serial_id, sales_order_number FROM sales_order_serials
      WHERE serial_id = ANY($1::int[]) AND status = 'attached'`,
    [ids]
  );
  const soBySerial = new Map(attached.rows.map((a) => [Number(a.serial_id), a.sales_order_number]));

  const billing = customerBillingAddress(c);
  const shippingOptions = [];
  const seen = new Set();
  const addOption = (label, address, source) => {
    if (!address) return;
    const k = addressKey(address);
    if (seen.has(k)) return;
    seen.add(k);
    shippingOptions.push({ key: `opt_${shippingOptions.length}`, label, source, address });
  };

  const laptops = sr.rows.map((s) => {
    const ev = eventBySerial.get(Number(s.serial_id)) || null;
    const deliveredTo = toSoAddress(s.dc_shipping_address);
    if (deliveredTo) addOption(`Delivered address (${s.current_dc_number || 'DC'})`, deliveredTo, 'dc');
    let blocker = null;
    if (String(s.inventory_status) !== 'rented') blocker = `Not on rent (status: ${s.inventory_status || 'none'})`;
    else if (Number(s.current_customer_id) !== Number(customerId)) blocker = 'Not with this customer';
    else if (soBySerial.has(Number(s.serial_id))) blocker = `Already on sales order ${soBySerial.get(Number(s.serial_id))}`;
    return {
      serial_id: s.serial_id,
      ttspl_id: s.ttspl_id,
      serial_number: s.serial_number,
      brand: s.brand,
      model_name: s.model_name,
      processor: s.processor,
      generation: s.generation,
      ram: s.ram,
      storage: s.storage,
      gpu: s.gpu,
      screen_size: s.screen_size,
      rent_monthly_rate: s.rent_monthly_rate,
      rent_billed_until: toYmd(s.rent_billed_until),
      delivered_at: s.delivered_at,
      dc_number: s.current_dc_number,
      delivered_address: deliveredTo,
      vendor_rented: VENDOR_RENTAL_PO_TYPES.includes(String(s.effective_acq_type)),
      vendor_name: s.vendor_name || null,
      open_case: ev ? {
        event_id: ev.event_id,
        reason: ev.reason,
        rent_stopped_on: toYmd(ev.rent_stopped_on),
        vendor_settled: ev.vendor_settled,
        vendor_pending: Boolean(ev.vendor_id) && !ev.vendor_settled,
      } : null,
      blocker,
    };
  });
  addOption('Billing address', billing.address ? billing : null, 'billing');

  return {
    customer: {
      customer_id: c.customer_id,
      name: c.company_name || c.name,
      email: c.email,
      phone: c.phone,
      gst_number: billing.gst_number || c.gst_no || '',
      customer_type: c.customer_type,
      active: Number(c.status ?? 1) === 1,
    },
    billing_address: billing,
    shipping_options: shippingOptions,
    laptops,
  };
}

function cleanAddress(raw, label) {
  if (!raw || typeof raw !== 'object') throw new SaleInPlaceError(`${label} is required`);
  const a = {
    name: String(raw.name || '').trim(),
    phone: String(raw.phone || '').trim(),
    country: 'India',
    address: String(raw.address || '').trim(),
    city: String(raw.city || '').trim(),
    state: String(raw.state || '').trim(),
    zip_code: String(raw.zip_code || raw.pincode || '').trim(),
  };
  if (!a.address) throw new SaleInPlaceError(`${label}: address is required`);
  if (!a.state) throw new SaleInPlaceError(`${label}: state is required (it decides CGST+SGST vs IGST)`);
  if (a.zip_code && !/^\d{6}$/.test(a.zip_code)) throw new SaleInPlaceError(`${label}: pincode must be 6 digits`);
  return a;
}

/**
 * One transaction, from the customer's Assets tab:
 *   1. stop rent (skipped for units whose rent was already stopped by report())
 *   2. raise a Sale SO (gorefurbo, fulfillment_mode='in_place'), one line per
 *      laptop so each carries its own price, config and delivered address
 *   3. attach every laptop to its line
 *   4. confirm the sale for every unit we own; vendor-rented units stay attached
 *      until recordVendorBuyout() settles them
 *
 * The customer may be Rental-only: they are buying a laptop they already rent
 * from us, which is exactly the case this flow exists for.
 */
async function createInPlaceSale({
  customerId, serialIds, reason, reportedOn, notes = null, prices = {},
  billingAddress, shippingAddress, gstNumber = null, customerEmail = null, customerMobile = null,
  remark = null, actorUserId = null, actorName = null, actorRole = null,
}) {
  validateReason(reason);
  const ymd = validateReportedOn(reportedOn);
  const ids = normalizeIds(serialIds);
  const priceOf = (id) => Number(prices?.[id] ?? prices?.[String(id)]);
  for (const id of ids) {
    const p = priceOf(id);
    if (!Number.isFinite(p) || p <= 0) {
      throw new SaleInPlaceError('Enter a sale price greater than zero for every laptop');
    }
  }
  const billing = cleanAddress(billingAddress, 'Billing address');
  const shipping = cleanAddress(shippingAddress, 'Shipping address');

  const {
    nextFinancialYearNumber, resolveSupplyStateFromAddress, generateToken,
  } = require('./salesManagementService');
  const { resolveHsnForPersist } = require('../constants/hsnDefaults');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cr = await client.query(
      `SELECT customer_id, name, company_name, email, phone, gst_no, status
         FROM customers WHERE customer_id = $1`,
      [customerId]
    );
    const cust = cr.rows[0];
    if (!cust) throw new SaleInPlaceError('Customer not found', 404);
    if (Number(cust.status ?? 1) !== 1) {
      throw new SaleInPlaceError('This customer is inactive. Activate the customer first.', 409);
    }

    const serials = await lockSerials(client, ids);
    const toReport = [];
    const reused = [];
    for (const s of serials) {
      const label = s.ttspl_id || `serial ${s.serial_id}`;
      assertRentedToCustomer(s, customerId);
      const onSo = await client.query(
        `SELECT sales_order_number FROM sales_order_serials
          WHERE serial_id = $1 AND status = 'attached' LIMIT 1`,
        [s.serial_id]
      );
      if (onSo.rows.length) {
        throw new SaleInPlaceError(`${label} is already on sales order ${onSo.rows[0].sales_order_number}`, 409);
      }
      const open = await getOpenEvent(client, s.serial_id);
      if (open) {
        // Rent was already stopped by an earlier report: keep that case and its credit note.
        reused.push({ serial_id: s.serial_id, ttspl_id: s.ttspl_id, event: open });
        continue;
      }
      if (s.rent_start_date && ymd < toYmd(s.rent_start_date)) {
        throw new SaleInPlaceError(
          `${label}: rent stop date (${ymd}) is before the rent started (${toYmd(s.rent_start_date)})`
        );
      }
      toReport.push(s);
    }

    const { results, vendorChases } = toReport.length
      ? await stopRentInTx(client, { customerId, serials: toReport, reason, ymd, notes, actorUserId })
      : { results: [], vendorChases: [] };

    const specs = await client.query(SERIAL_SPEC_SQL, [ids]);
    const soNumber = await nextFinancialYearNumber('sales_order', client);
    const supplyState = resolveSupplyStateFromAddress(shipping);
    const hsn = resolveHsnForPersist({ quotationType: 'sale', role: actorRole });
    const customerName = cust.company_name || cust.name;
    const billingJson = JSON.stringify({ ...billing, name: customerName, gst_number: gstNumber || cust.gst_no || '' });
    const shippingJson = JSON.stringify(shipping);
    const reasonByserial = new Map(reused.map((r) => [Number(r.serial_id), r.event.reason]));

    for (const s of specs.rows) {
      const unitReason = reasonByserial.get(Number(s.serial_id)) || reason;
      const lineRemark = [
        `${REASON_LABELS[unitReason] || unitReason} — sale in place of ${s.ttspl_id || s.serial_number}`,
        remark ? String(remark).trim() : null,
      ].filter(Boolean).join('. ');
      const lineAddress = toSoAddress(s.dc_shipping_address) || shipping;

      const line = await client.query(
        `INSERT INTO sales_order_lines (
           sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile,
           customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount,
           shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage,
           gpu, screen_size, quantity, main_qty, rate, remark, status, token, created_by, hsn_code,
           is_wfh, delivery_address, entity_code, fulfillment_mode, security_type
         ) VALUES ($1,'N/A',$2,$3,$4,$5,$6,$7,$8,$9,0,0,'sale','gorefurbo',$10,$11,$12,$13,$14,$15,$16,$17,
                   1,1,$18,$19,'pending',$20,$21,$22,FALSE,$23::jsonb,'gorefurbo','in_place','none')
         RETURNING id`,
        [
          soNumber, customerId, customerName,
          customerEmail || cust.email || null, customerMobile || cust.phone || null,
          shippingJson, billingJson, gstNumber || cust.gst_no || null, supplyState,
          s.brand, s.model_name, s.processor, s.generation, s.ram, s.storage, s.gpu, s.screen_size,
          +priceOf(s.serial_id).toFixed(2), lineRemark, generateToken(), actorUserId, hsn,
          JSON.stringify(lineAddress),
        ]
      );

      await client.query(
        `INSERT INTO sales_order_serials
           (sales_order_number, line_id, serial_id, ttspl_id, serial_number,
            qc_ticket_id, qc_status, status, entity_code, created_by, delivery_address)
         VALUES ($1,$2,$3,$4,$5,NULL,'passed','attached','gorefurbo',$6,$7::jsonb)`,
        [soNumber, line.rows[0].id, s.serial_id, s.ttspl_id, s.serial_number, actorUserId,
          JSON.stringify(lineAddress)]
      );
    }

    const confirmation = await confirmInTx(client, {
      salesOrderNumber: soNumber, partial: true, actorUserId, actorName,
    });

    await client.query('COMMIT');
    afterRentStopped({ results, vendorChases, reason, ymd, actorUserId });

    return {
      sales_order_number: soNumber,
      reason,
      rent_stopped_on: ymd,
      rent_stopped: results,
      already_stopped: reused.map((r) => ({
        serial_id: r.serial_id,
        ttspl_id: r.ttspl_id,
        rent_stopped_on: toYmd(r.event.rent_stopped_on),
      })),
      sold: confirmation.items,
      awaiting_vendor_buyout: confirmation.awaiting_vendor_buyout,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  REASONS,
  VENDOR_RENTAL_PO_TYPES,
  SaleInPlaceError,
  EFFECTIVE_ACQ_SQL,
  hasOpenSaleInPlaceEvent,
  getOpenEvent,
  report,
  recordVendorBuyout,
  confirmSale,
  regenerateSalesOrderPdf,
  getSalePrefill,
  createInPlaceSale,
  findOpenInPlaceOrderForSerial,
  toSoAddress,
};

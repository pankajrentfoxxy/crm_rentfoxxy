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

/**
 * Step 1 — report a unit as lost / damaged / bought out.
 *
 * Stops both meters (customer rent and, where applicable, vendor rent) and
 * raises the credit note for the unused prepaid days. Deliberately leaves
 * inventory_status = 'rented' so the unit stays attachable and visible while the
 * sale is being priced; it only becomes 'sold' at confirmSale().
 */
async function report({ customerId, serialIds, reason, reportedOn, notes = null, actorUserId = null }) {
  if (!REASONS.includes(String(reason))) {
    throw new SaleInPlaceError(`reason must be one of: ${REASONS.join(', ')}`);
  }
  const ymd = toYmd(reportedOn);
  if (!ymd) throw new SaleInPlaceError('reported_on is required (YYYY-MM-DD)');
  if (new Date(`${ymd}T00:00:00`) > new Date()) {
    throw new SaleInPlaceError('reported_on cannot be in the future');
  }
  const ids = [...new Set((serialIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw new SaleInPlaceError('At least one serial is required');

  const client = await pool.connect();
  const vendorChases = [];
  try {
    await client.query('BEGIN');

    // Lock every serial up front so a concurrent attach/return cannot race us.
    const sr = await client.query(
      `SELECT vsn.serial_id, vsn.inventory_status, vsn.current_customer_id,
              vsn.rent_start_date, vsn.rent_monthly_rate,
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

    // Validate the whole batch before writing anything.
    for (const s of sr.rows) {
      const label = s.ttspl_id || `serial ${s.serial_id}`;
      if (String(s.inventory_status) !== 'rented') {
        throw new SaleInPlaceError(
          `${label} is not on rent (status: ${s.inventory_status || 'none'}) — only rented units can be sold in place`
        );
      }
      if (Number(s.current_customer_id) !== Number(customerId)) {
        throw new SaleInPlaceError(`${label} is not currently with this customer`);
      }
      if (s.rent_start_date && ymd < toYmd(s.rent_start_date)) {
        throw new SaleInPlaceError(
          `${label}: reported_on (${ymd}) is before the rent started (${toYmd(s.rent_start_date)})`
        );
      }
      if (await hasOpenSaleInPlaceEvent(client, s.serial_id)) {
        throw new SaleInPlaceError(`${label} already has an open sale-in-place case`);
      }
    }

    const results = [];
    for (const s of sr.rows) {
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

    await client.query('COMMIT');

    // Post-commit, best-effort: audit trail + chase Procurement for the buyout bill.
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
 */
async function recordVendorBuyout({ serialId, vendorBillNo, amount, actorUserId = null }) {
  const id = Number(serialId);
  if (!Number.isInteger(id) || id <= 0) throw new SaleInPlaceError('A valid serial_id is required');
  if (!String(vendorBillNo || '').trim()) throw new SaleInPlaceError('vendor_bill_no is required');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new SaleInPlaceError('amount must be greater than zero');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sr = await client.query(
      `SELECT serial_id, COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl_id
         FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    if (!sr.rows.length) throw new SaleInPlaceError('Serial not found', 404);

    const ev = await getOpenEvent(client, id);
    if (!ev) throw new SaleInPlaceError('This serial has no open sale-in-place case', 409);
    if (!ev.vendor_id) throw new SaleInPlaceError('This unit is already owned — no vendor buyout is needed', 409);

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

    logTtsplEvent({
      ttsplId: sr.rows[0].ttspl_id,
      vendorSerialId: id,
      eventType: 'vendor_buyout_recorded',
      description: `Bought out from vendor — bill ${vendorBillNo}, amount ${amt}. Now direct_purchase.`,
      actorUserId,
    }).catch((e) => console.error('[saleInPlace] ttspl audit:', e.message));

    return { serial_id: id, acquisition_type: 'direct_purchase', vendor_settled: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Step 4 — confirm the sale. Replaces dispatch + delivery for an in-place SO.
 * No DC is created and no e-way bill is required.
 */
async function confirmSale({ salesOrderNumber, actorUserId = null, actorName = null }) {
  const so = String(salesOrderNumber || '').trim();
  if (!so) throw new SaleInPlaceError('sales_order_number is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
    const alloc = await client.query(
      `SELECT sos.allocation_id, sos.serial_id, sos.status,
              COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
              vsn.inventory_status, vsn.rent_end_date
         FROM sales_order_serials sos
         JOIN vendor_serial_numbers vsn ON vsn.serial_id = sos.serial_id
        WHERE sos.sales_order_number = $1 AND sos.status = 'attached'
        FOR UPDATE OF sos, vsn`,
      [so]
    );
    if (alloc.rows.length !== ordered) {
      throw new SaleInPlaceError(
        `All ${ordered} unit(s) must be attached before confirming (currently ${alloc.rows.length})`,
        409
      );
    }

    // Every vendor-rented unit must be bought out first — we cannot pass title on
    // a laptop we are still renting from a vendor.
    const unsettled = await client.query(
      `SELECT COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id
         FROM sale_in_place_events e
         JOIN vendor_serial_numbers vsn ON vsn.serial_id = e.serial_id
        WHERE e.serial_id = ANY($1::int[])
          AND e.sales_order_number IS NULL
          AND e.vendor_id IS NOT NULL
          AND e.vendor_settled = FALSE`,
      [alloc.rows.map((a) => a.serial_id)]
    );
    if (unsettled.rows.length) {
      throw new SaleInPlaceError(
        `Vendor buyout not yet recorded for: ${unsettled.rows.map((r) => r.ttspl_id).join(', ')}`,
        409
      );
    }

    const customerId = live[0].customer_id;
    const entityCode = live[0].entity_code || null;
    const sold = [];
    for (const a of alloc.rows) {
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

    await client.query('COMMIT');
    return { sales_order_number: so, sold_count: sold.length, items: sold };
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
};

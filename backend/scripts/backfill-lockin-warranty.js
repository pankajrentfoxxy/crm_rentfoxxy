#!/usr/bin/env node
/**
 * One-time: stamp lock-in (rented) and warranty (sold) dates on laptops that
 * are already with customers (migration 350; claude/carret-lockin-warranty.md).
 *
 *   node scripts/backfill-lockin-warranty.js            → dry run, rolls back
 *   node scripts/backfill-lockin-warranty.js --commit   → keeps it
 *
 * Rented: lock-in end = rent start + the SO line's locking_period months.
 * Sold:   warranty end = delivery day (in-place sale: the SO day) + technical /
 *         battery months.
 * A laptop that arrived as a support replacement runs out the ORIGINAL laptop's
 * dates: the chain of replacements is followed back to the first laptop, whose
 * start is when it went to rented / sold for this customer.
 * Only NULL dates are filled; a laptop already stamped is left alone.
 * Open replacement orders get the old laptop's dates copied on.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { addMonths, toDateStr } = require('../services/lockInWarrantyService');

async function lineTermsBefore(c, serialId, before) {
  const r = await c.query(
    `SELECT sol.locking_period, sol.technical_warranty, sol.battery_charger_warranty,
            sol.quotation_type, sol.fulfillment_mode, sol.created_at AS so_created_at
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
      WHERE sos.serial_id = $1 AND ($2::timestamptz IS NULL OR sos.created_at <= $2)
      ORDER BY (COALESCE(sos.status, '') <> 'removed') DESC, sos.created_at DESC
      LIMIT 1`,
    [serialId, before]
  );
  return r.rows[0] || null;
}

/**
 * When this laptop went to rented / sold for the customer, best source first:
 * its own rent start (kept on the row after a return), the delivery challan it
 * went out on, then the status history (ignoring rented -> rented corrections;
 * ERP-imported laptops have little history).
 */
async function wentTo(c, serialId, status, customerId, before) {
  const own = await c.query(
    'SELECT rent_start_date, delivered_at FROM vendor_serial_numbers WHERE serial_id = $1',
    [serialId]
  );
  const ownDate = status === 'rented' ? own.rows[0]?.rent_start_date : null;
  if (ownDate && (!before || new Date(ownDate) <= new Date(before))) return ownDate;

  const dc = await c.query(
    `SELECT COALESCE(dcl.delivered_at, dcl.delivery_completed_at, dcl.dispatched_at) AS at
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
       JOIN delivery_challan_lines dcl ON dcl.dc_number = sos.dc_number AND dcl.movement_type = 'outbound'
      WHERE sos.serial_id = $1 AND sos.dc_number IS NOT NULL
        AND LOWER(COALESCE(sol.quotation_type, '')) LIKE $2
        AND ($3::timestamptz IS NULL OR sos.created_at <= $3)
        AND COALESCE(dcl.delivered_at, dcl.delivery_completed_at, dcl.dispatched_at) IS NOT NULL
      ORDER BY sos.created_at DESC LIMIT 1`,
    [serialId, status === 'sold' ? 'sale%' : 'rent%', before]
  );
  if (dc.rows[0]?.at) return dc.rows[0].at;

  const r = await c.query(
    `SELECT created_at FROM inventory_status_transitions
      WHERE serial_id = $1 AND to_status = $2
        AND COALESCE(from_status, '') <> $2
        AND ($3::int IS NULL OR customer_id IS NULL OR customer_id = $3)
        AND ($4::timestamptz IS NULL OR created_at <= $4)
      ORDER BY created_at DESC LIMIT 1`,
    [serialId, status, customerId, before]
  );
  return r.rows[0]?.created_at || null;
}

/** The replacement order that brought this laptop to the customer, if any. */
async function replacementThatDelivered(c, serialId) {
  const r = await c.query(
    `SELECT ro.old_serial_id, ro.created_at, t.customer_id
       FROM support_replacement_orders ro
       LEFT JOIN support_tickets t ON t.id = ro.ticket_id
      WHERE ro.new_serial_id = $1 AND ro.old_serial_id IS NOT NULL
        AND ro.status IN ('delivered', 'completed')
      ORDER BY ro.id DESC LIMIT 1`,
    [serialId]
  );
  return r.rows[0] || null;
}

/**
 * Where this laptop's terms really start: follow replacements back to the
 * first laptop. Returns { start, terms, via } or null.
 */
async function originOf(c, serialId, status, customerId, before, depth = 0) {
  if (depth > 6) return null;
  const ro = await replacementThatDelivered(c, serialId);
  if (ro && ro.old_serial_id !== serialId) {
    const up = await originOf(c, ro.old_serial_id, status, ro.customer_id || customerId, ro.created_at, depth + 1);
    if (up) return { ...up, via: [serialId, ...(up.via || [])] };
  }
  const terms = await lineTermsBefore(c, serialId, before);
  const at = await wentTo(c, serialId, status, customerId, before);
  return at ? { start: toDateStr(at), terms, via: [serialId] } : (terms ? { start: null, terms, via: [serialId] } : null);
}

(async () => {
  const commit = process.argv.includes('--commit');
  const c = await pool.connect();
  const out = { rented: { stamped: 0, with_lock_in: 0, active_today: 0, via_replacement: 0, no_start: 0 },
    sold: { stamped: 0, with_warranty: 0, in_warranty_today: 0, via_replacement: 0 }, open_replacements: 0, samples: [] };
  const backup = [];
  try {
    await c.query('BEGIN');
    const today = toDateStr(new Date());

    const rented = await c.query(
      `SELECT serial_id, rent_start_date, current_customer_id, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND inventory_status = 'rented' AND lock_in_end_date IS NULL AND lock_in_start_date IS NULL`
    );
    for (const u of rented.rows) {
      let start = toDateStr(u.rent_start_date);
      let terms = await lineTermsBefore(c, u.serial_id, null);
      const ro = await replacementThatDelivered(c, u.serial_id);
      if (ro) {
        const o = await originOf(c, ro.old_serial_id, 'rented', ro.customer_id || u.current_customer_id, ro.created_at);
        if (o?.start) { start = o.start; terms = o.terms; out.rented.via_replacement += 1; }
      }
      if (!start) { out.rented.no_start += 1; continue; }
      const end = addMonths(start, terms?.locking_period);
      await c.query(
        'UPDATE vendor_serial_numbers SET lock_in_start_date = $2, lock_in_end_date = $3 WHERE serial_id = $1',
        [u.serial_id, start, end]
      );
      backup.push({ serial_id: u.serial_id, kind: 'rented', start, end });
      out.rented.stamped += 1;
      if (end) out.rented.with_lock_in += 1;
      if (end && end > today) {
        out.rented.active_today += 1;
        if (out.samples.length < 8) out.samples.push({ ttspl: u.inventory_asset_code, start, months: terms?.locking_period, end, replacement: !!ro });
      }
    }

    const sold = await c.query(
      `SELECT serial_id, delivered_at, current_customer_id, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL AND inventory_status = 'sold' AND warranty_start_date IS NULL`
    );
    for (const u of sold.rows) {
      let terms = await lineTermsBefore(c, u.serial_id, null);
      let start = terms?.fulfillment_mode === 'in_place' ? toDateStr(terms.so_created_at) : toDateStr(u.delivered_at);
      const ro = await replacementThatDelivered(c, u.serial_id);
      if (ro) {
        const o = await originOf(c, ro.old_serial_id, 'sold', ro.customer_id || u.current_customer_id, ro.created_at);
        if (o?.start) { start = o.start; terms = o.terms || terms; out.sold.via_replacement += 1; }
      }
      if (!start) continue;
      const end = addMonths(start, terms?.technical_warranty);
      const bEnd = addMonths(start, terms?.battery_charger_warranty);
      await c.query(
        `UPDATE vendor_serial_numbers
            SET warranty_start_date = $2, warranty_end_date = $3, battery_warranty_end_date = $4
          WHERE serial_id = $1`,
        [u.serial_id, start, end, bEnd]
      );
      backup.push({ serial_id: u.serial_id, kind: 'sold', start, end, bEnd });
      out.sold.stamped += 1;
      if (end || bEnd) out.sold.with_warranty += 1;
      if ((end && end > today) || (bEnd && bEnd > today)) out.sold.in_warranty_today += 1;
    }

    const ro = await c.query(
      `UPDATE support_replacement_orders ro
          SET old_lock_in_end_date = v.lock_in_end_date,
              old_warranty_end_date = v.warranty_end_date,
              old_battery_warranty_end_date = v.battery_warranty_end_date
         FROM vendor_serial_numbers v
        WHERE v.serial_id = ro.old_serial_id
          AND ro.status NOT IN ('completed', 'cancelled')
          AND ro.old_lock_in_end_date IS NULL AND ro.old_warranty_end_date IS NULL
          AND ro.old_battery_warranty_end_date IS NULL
          AND (v.lock_in_end_date IS NOT NULL OR v.warranty_end_date IS NOT NULL OR v.battery_warranty_end_date IS NOT NULL)`
    );
    out.open_replacements = ro.rowCount;

    console.log(JSON.stringify(out, null, 2));
    if (commit) {
      const dir = path.join(__dirname, '..', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `lockin-warranty-backfill-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(backup));
      await c.query('COMMIT');
      console.log(`COMMITTED (list of stamped laptops: ${file})`);
    } else {
      await c.query('ROLLBACK');
      console.log('Dry run — ROLLED BACK. Add --commit to keep it.');
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();

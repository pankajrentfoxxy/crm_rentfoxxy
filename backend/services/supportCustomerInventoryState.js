'use strict';

/** Soft customer-side state. Does not change inventory_status or current_customer_id. */
async function setCustomerInventoryState(client, serialId, state) {
  await client.query(
    `UPDATE vendor_serial_numbers
        SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('support_inventory_state', $2::text),
            updated_at = NOW()
      WHERE serial_id = $1`,
    [serialId, state]
  );
}

async function startBillingHold(client, { serialId, customerId, ticketId, lineId, woId, reason, from }) {
  const existing = await client.query(
    `SELECT hold_id FROM asset_billing_holds
      WHERE serial_id = $1 AND hold_to IS NULL
      LIMIT 1`,
    [serialId]
  );
  if (existing.rows[0]) return existing.rows[0];
  const r = await client.query(
    `INSERT INTO asset_billing_holds (
       ticket_id, line_id, wo_id, serial_id, customer_id, hold_from, reason
     ) VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7)
     RETURNING *`,
    [ticketId || null, lineId || null, woId || null, serialId, customerId || null, from || null, reason || 'UNDER_REPAIR']
  );
  return r.rows[0];
}

async function endBillingHold(client, { serialId, freeRepairDays = 3 }) {
  const open = await client.query(
    `SELECT * FROM asset_billing_holds
      WHERE serial_id = $1 AND hold_to IS NULL
      ORDER BY hold_id DESC LIMIT 1`,
    [serialId]
  );
  const hold = open.rows[0];
  if (!hold) return null;
  const days = await client.query(
    `SELECT (CURRENT_DATE - hold_from)::int AS n FROM asset_billing_holds WHERE hold_id = $1`,
    [hold.hold_id]
  );
  const heldDays = Number(days.rows[0]?.n || 0);
  const waive = heldDays > Number(freeRepairDays);
  await client.query(
    `UPDATE asset_billing_holds
        SET hold_to = CURRENT_DATE, waive_rent = $2, updated_at = NOW()
      WHERE hold_id = $1`,
    [hold.hold_id, waive]
  );
  return { ...hold, hold_to: new Date(), waive_rent: waive, held_days: heldDays };
}

async function freeRepairDays(db) {
  try {
    const { getNumber } = require('./supportSettingsService');
    const n = await getNumber(db, 'free_repair_days', 3);
    return n > 0 ? n : 3;
  } catch {
    return 3;
  }
}

/** Soft customer-side state. Does not change inventory_status. */
async function removeFromCustomerInventory(client, serialId, { reason, woId } = {}) {
  await setCustomerInventoryState(client, serialId, 'PASSIVE');
  await client.query(
    `UPDATE vendor_serial_numbers
        SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
              'support_return_reason', $2::text,
              'support_return_wo_id', $3::text
            ),
            updated_at = NOW()
      WHERE serial_id = $1`,
    [serialId, reason || 'Returned by customer', woId ? String(woId) : null]
  );
}

async function recordBillingStop(client, { serialId, customerId, stopDate, woId }) {
  const day = stopDate || new Date().toISOString().slice(0, 10);
  if (woId) {
    await client.query(
      `UPDATE support_work_orders SET billing_stop_date = $2::date, updated_at = NOW() WHERE wo_id = $1`,
      [woId, day]
    );
  }
  await client.query(
    `UPDATE vendor_serial_numbers
        SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
              'billing_stop_date', $2::text,
              'billing_stop_wo_id', $3::text,
              'billing_stop_customer_id', $4::text
            ),
            updated_at = NOW()
      WHERE serial_id = $1`,
    [serialId, day, woId ? String(woId) : null, customerId ? String(customerId) : null]
  );
  return { serial_id: serialId, stop_date: day, wo_id: woId || null };
}

/** Clear customer holding after the return credit note is raised. Does not touch inventory_status. */
async function clearCustomerHolding(client, serialId) {
  await client.query(
    `UPDATE vendor_serial_numbers
        SET current_customer_id = NULL, updated_at = NOW()
      WHERE serial_id = $1`,
    [serialId]
  );
}

module.exports = {
  setCustomerInventoryState,
  startBillingHold,
  endBillingHold,
  freeRepairDays,
  removeFromCustomerInventory,
  recordBillingStop,
  clearCustomerHolding,
};

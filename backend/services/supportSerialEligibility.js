/**
 * Rules for which customer-held laptops Support can open tickets against.
 *
 * Complaint / Pickup / Replacement require the unit to be physically delivered
 * to the customer — not reserved on a DC or still in outbound transit.
 */
const { STATUS } = require('./inventoryStateMachine');

/** Statuses where the laptop is with the customer and support actions are allowed. */
const SUPPORT_TICKET_ELIGIBLE_STATUSES = Object.freeze([
  STATUS.RENTED,
  STATUS.ON_DEMO,
  STATUS.SOLD,
  'out_stock', // ERP legacy — treated as deployed rental
]);

const OUTBOUND_UNDELIVERED_DC_STATUSES = Object.freeze([
  'pending',
  'processing',
  'shipped',
  'in_transit',
  'reached',
]);

function serialCodeFromItem(item = {}) {
  return String(
    item.ttspl_id || item.unique_serial_number || item.serial_number || ''
  ).trim() || null;
}

async function loadSerialForSupport(client, customerId, item) {
  const code = serialCodeFromItem(item);
  const invId = item.customer_inventory_id ? parseInt(item.customer_inventory_id, 10) : null;

  if (invId) {
    const r = await client.query(
      `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code,
              vsn.inventory_status, vsn.current_customer_id, vsn.delivered_at,
              vsn.current_dc_number
         FROM customer_inventory ci
         JOIN vendor_serial_numbers vsn ON vsn.deleted_at IS NULL
           AND (
             vsn.inventory_asset_code = ci.unique_serial_number
             OR vsn.serial_number = ci.serial_number
             OR vsn.inventory_asset_code = ci.serial_number
             OR vsn.extra->>'ttspl_id' = ci.unique_serial_number
           )
        WHERE ci.id = $1
        LIMIT 1`,
      [invId]
    );
    if (r.rows.length) {
      return {
        ...r.rows[0],
        code: r.rows[0].inventory_asset_code || r.rows[0].serial_number || code,
      };
    }
  }

  if (!code) return null;

  const r = await client.query(
    `SELECT serial_id, serial_number, inventory_asset_code, inventory_status,
            current_customer_id, delivered_at, current_dc_number
       FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (
          inventory_asset_code = $1
          OR serial_number = $1
          OR extra->>'ttspl_id' = $1
        )
      ORDER BY
        CASE WHEN inventory_asset_code = $1 THEN 0 ELSE 1 END,
        serial_id ASC
      LIMIT 1`,
    [code]
  );
  if (!r.rows.length) return null;
  return { ...r.rows[0], code: r.rows[0].inventory_asset_code || code };
}

async function findUndeliveredOutboundDc(client, customerId, code) {
  if (!code) return null;
  const r = await client.query(
    `SELECT dc_number, status, delivered_at
       FROM delivery_challan_lines
      WHERE movement_type = 'outbound'
        AND customer_id = $1
        AND COALESCE(status, '') = ANY($2::text[])
        AND serial_number::text ILIKE '%' || $3 || '%'
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1`,
    [customerId, OUTBOUND_UNDELIVERED_DC_STATUSES, code]
  );
  return r.rows[0] || null;
}

function eligibilityMessage({ serial, outboundDc, ticketCategory = 'ticket' }) {
  const label = serial?.code || serial?.inventory_asset_code || serial?.serial_number || 'Laptop';
  const st = String(serial?.inventory_status || '').toLowerCase();

  if (st === STATUS.IN_TRANSIT) {
    return `${label} is in transit and has not been delivered to the customer yet. Cannot create a ${ticketCategory}.`;
  }
  if (st === STATUS.RESERVED) {
    return `${label} is reserved on a delivery challan but not yet delivered to the customer. Cannot create a ${ticketCategory}.`;
  }
  if (!SUPPORT_TICKET_ELIGIBLE_STATUSES.includes(st)) {
    return `${label} is not deployed with the customer (status: ${st || 'unknown'}). Cannot create a ${ticketCategory}.`;
  }
  if (!serial.delivered_at) {
    return `${label} has not been marked delivered to the customer yet. Cannot create a ${ticketCategory}.`;
  }
  if (Number(serial.current_customer_id) !== Number(serial._customerId)) {
    return `${label} is not assigned to this customer. Cannot create a ${ticketCategory}.`;
  }
  if (outboundDc) {
    return `${label} has an undelivered outbound DC (${outboundDc.dc_number}). Wait until delivery is confirmed before creating a ${ticketCategory}.`;
  }
  return null;
}

/**
 * Returns { ok: true } or { ok: false, message, code, serial }.
 */
async function checkSerialEligibleForSupportTicket(client, customerId, item, opts = {}) {
  const ticketCategory = opts.ticketCategory || 'ticket';
  const serial = await loadSerialForSupport(client, customerId, item);

  if (!serial) {
    const code = serialCodeFromItem(item);
    return {
      ok: false,
      message: code
        ? `Laptop ${code} was not found for this customer.`
        : 'Select a valid laptop for this customer.',
      code: 'serial_not_found',
    };
  }

  serial._customerId = customerId;
  const outboundDc = await findUndeliveredOutboundDc(client, customerId, serial.code);
  const message = eligibilityMessage({ serial, outboundDc, ticketCategory });

  if (message) {
    return {
      ok: false,
      message,
      code: 'serial_not_eligible',
      serial,
      inventory_status: serial.inventory_status,
    };
  }

  return { ok: true, serial };
}

async function assertSerialEligibleForSupportTicket(client, customerId, item, opts = {}) {
  const result = await checkSerialEligibleForSupportTicket(client, customerId, item, opts);
  if (!result.ok) {
    const err = new Error(result.message);
    err.status = 400;
    err.code = result.code;
    err.inventory_status = result.inventory_status;
    throw err;
  }
  return result.serial;
}

async function assertMachinesEligibleForSupport(client, customerId, items, opts = {}) {
  for (const item of items || []) {
    await assertSerialEligibleForSupportTicket(client, customerId, item, opts);
  }
}

module.exports = {
  SUPPORT_TICKET_ELIGIBLE_STATUSES,
  OUTBOUND_UNDELIVERED_DC_STATUSES,
  serialCodeFromItem,
  loadSerialForSupport,
  checkSerialEligibleForSupportTicket,
  assertSerialEligibleForSupportTicket,
  assertMachinesEligibleForSupport,
};

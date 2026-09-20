/**
 * Protects a billed laptop from being silently dropped out of a customer's
 * asset list.
 *
 * Eight different code paths clear vendor_serial_numbers.current_customer_id,
 * which is the column every customer-asset view and the billing engine read. A
 * genuine permanent return SHOULD clear it — but several paths infer the return
 * from the presence of a DC, and the ERP/Excel imports left units with billing
 * history and no DC or SO at all, only dates. 22 laptops are in exactly that
 * state right now: billed, with a customer, no outbound DC. Those must not be
 * detached by logic that assumes a DC would exist if the laptop were really
 * theirs.
 *
 * The rule: if a unit has been invoiced to this customer and there is NO
 * evidence of a return, refuse to detach it. Real returns always carry
 * evidence — a return DC line or a pickup item that reached the warehouse — so
 * they pass through untouched.
 *
 * CUSTOMER_ASSET_GUARD:
 *   enforce (default) — refuse the detach and log
 *   warn              — log only, allow it (use if a legitimate flow is blocked)
 *   off               — no checking
 */

const mode = () => String(process.env.CUSTOMER_ASSET_GUARD || 'enforce').toLowerCase();

/**
 * @returns {{safe: boolean, reason: string}} safe=false means do NOT detach.
 */
async function checkSafeToDetach(db, serialId, { context = 'unknown' } = {}) {
  if (mode() === 'off') return { safe: true, reason: 'guard off' };
  if (!serialId) return { safe: true, reason: 'no serial' };

  const { rows } = await db.query(
    `SELECT
       v.inventory_asset_code AS ttspl,
       v.current_customer_id,
       EXISTS (
         SELECT 1 FROM customer_invoice_lines cil
          WHERE cil.serial_id = v.serial_id
       ) AS billed,
       EXISTS (
         SELECT 1 FROM delivery_challan_lines d
          WHERE d.movement_type = 'return'
            AND COALESCE(d.status, '') NOT IN ('cancelled')
            AND d.serial_number::text ILIKE '%' || v.inventory_asset_code || '%'
       ) AS has_return_dc,
       EXISTS (
         SELECT 1 FROM support_ticket_items sti
          WHERE sti.item_type = 'pickup'
            AND sti.warehouse_received_at IS NOT NULL
            AND (sti.ttspl_id = v.inventory_asset_code
                 OR sti.unique_serial_number = v.inventory_asset_code
                 OR sti.serial_number = v.serial_number)
       ) AS has_pickup
     FROM vendor_serial_numbers v
    WHERE v.serial_id = $1`,
    [serialId]
  );

  const row = rows[0];
  if (!row) return { safe: true, reason: 'serial not found' };
  if (!row.current_customer_id) return { safe: true, reason: 'already detached' };
  if (!row.billed) return { safe: true, reason: 'never billed' };
  if (row.has_return_dc || row.has_pickup) return { safe: true, reason: 'return evidence exists' };

  const msg = `[customerAssetGuard] refusing to detach ${row.ttspl || `serial ${serialId}`}`
    + ` from customer ${row.current_customer_id} (${context}): it has been invoiced and there is`
    + ' no return DC and no warehouse pickup. Likely an ERP/Excel import with no DC.';
  if (mode() === 'warn') {
    console.warn(msg.replace('refusing to detach', 'WOULD refuse to detach'));
    return { safe: true, reason: 'warn mode' };
  }
  console.warn(msg);
  return { safe: false, reason: 'billed with no return evidence' };
}

module.exports = { checkSafeToDetach };

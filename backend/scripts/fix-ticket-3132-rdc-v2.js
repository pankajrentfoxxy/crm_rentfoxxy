/**
 * Ticket 3132 — RDC002160: return pickup today = TTSPL6977 + TTSPL7030.
 * TTSPL6511 stays with customer until tomorrow (off this RDC).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const { preserveCustomerAssetsOnCancel } = require('../services/supportCancelInventoryService');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
const replacementFlow = require('../services/supportReplacementFlowService');

const TICKET_ID = 3132;
const RDC = 'RDC002160';
const TODAY_IDS = [3452, 3453]; // 6977, 7030
const DEFER_ID = 3451; // 6511 — tomorrow

async function buildRdcEntries(client, pickupRows) {
  const entries = [];
  for (const row of pickupRows) {
    const serialCode = row.ttspl_id || row.unique_serial_number || row.serial_number;
    if (!serialCode) continue;
    const vsnRes = await client.query(
      `SELECT serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
        LIMIT 1`,
      [serialCode]
    );
    const vsn = vsnRes.rows[0];
    entries.push(vsn
      ? `|${vsn.serial_number}|${vsn.inventory_asset_code || serialCode}`
      : `|${serialCode}|${serialCode}`);
  }
  return entries;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticket = (await client.query('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [TICKET_ID])).rows[0];
    if (!ticket) throw new Error('Ticket not found');

    const deferRes = await client.query('SELECT * FROM support_ticket_items WHERE id = $1 FOR UPDATE', [DEFER_ID]);
    const deferRow = deferRes.rows[0];
    if (!deferRow) throw new Error('Defer item 6511 not found');

    await preserveCustomerAssetsOnCancel(client, {
      ticketId: TICKET_ID,
      customerId: ticket.customer_id,
      items: [deferRow],
      actorUserId: null,
      actorName: 'fix-ticket-3132-rdc-v2',
    });

    await client.query(
      `UPDATE support_ticket_items SET
          status = 'pending_dispatch',
          return_dc_number = NULL,
          picked_up_at = NULL,
          customer_otp_verified_at = NULL,
          technician_esign_at = NULL,
          technician_esign_url = NULL,
          technician_esign_by = NULL,
          visited_at = NULL,
          gate_inward_at = NULL,
          pod_image_path = NULL,
          proof_of_completion_path = NULL,
          updated_at = NOW()
        WHERE id = $1`,
      [DEFER_ID]
    );

    const ref = (await client.query('SELECT * FROM support_ticket_items WHERE id = $1', [TODAY_IDS[0]])).rows[0];
    await client.query(
      `UPDATE support_ticket_items sti SET
          status = 'picked_up',
          return_dc_number = $2,
          pickup_method = COALESCE(sti.pickup_method, ref.pickup_method),
          pickup_assigned_to = COALESCE(sti.pickup_assigned_to, ref.pickup_assigned_to),
          assigned_to = COALESCE(sti.assigned_to, ref.assigned_to),
          customer_otp_verified_at = COALESCE(sti.customer_otp_verified_at, ref.customer_otp_verified_at),
          picked_up_at = COALESCE(sti.picked_up_at, ref.picked_up_at),
          technician_esign_at = COALESCE(sti.technician_esign_at, ref.technician_esign_at),
          technician_esign_url = COALESCE(sti.technician_esign_url, ref.technician_esign_url),
          technician_esign_by = COALESCE(sti.technician_esign_by, ref.technician_esign_by),
          customer_otp_code = COALESCE(sti.customer_otp_code, ref.customer_otp_code),
          otp_code = COALESCE(sti.otp_code, ref.otp_code),
          customer_otp_sent_at = COALESCE(sti.customer_otp_sent_at, ref.customer_otp_sent_at),
          visited_at = COALESCE(sti.visited_at, ref.visited_at),
          gate_inward_at = NULL,
          updated_at = NOW()
        FROM support_ticket_items ref
       WHERE sti.id = $1 AND ref.id = $3`,
      [TODAY_IDS[1], RDC, TODAY_IDS[0]]
    );

    await client.query(
      `UPDATE support_ticket_items SET
          return_dc_number = $2,
          gate_inward_at = NULL,
          updated_at = NOW()
        WHERE id = $1`,
      [TODAY_IDS[0], RDC]
    );

    const keeping = (await client.query(
      'SELECT * FROM support_ticket_items WHERE id = ANY($1::int[]) ORDER BY id',
      [TODAY_IDS]
    )).rows;
    const entries = await buildRdcEntries(client, keeping);

    const dcl = (await client.query(
      `SELECT dc_purpose, remarks FROM delivery_challan_lines
        WHERE dc_number = $1 AND movement_type = 'return' FOR UPDATE`,
      [RDC]
    )).rows[0];

    let remarks = dcl.remarks;
    if (String(dcl.dc_purpose || '') === 'replacement') {
      remarks = replacementFlow.buildReplacementRdcRemarks(keeping.map((r) => ({
        ttspl_id: r.ttspl_id || r.unique_serial_number,
        unique_serial_number: r.unique_serial_number || r.ttspl_id,
        serial_number: r.serial_number,
        brand: r.brand,
        model: r.model,
      })));
    }

    await client.query(
      `UPDATE delivery_challan_lines
          SET serial_number = $2::jsonb,
              quantity = $3,
              remarks = COALESCE($4, remarks),
              updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [RDC, JSON.stringify(entries), entries.length, remarks]
    );

    await client.query('COMMIT');
    await regenerateReturnDcPdfByRdc(pool, RDC);

    const check = await pool.query(
      `SELECT id, ttspl_id, status, return_dc_number FROM support_ticket_items
        WHERE ticket_id = $1 AND item_type = 'pickup' ORDER BY id`,
      [TICKET_ID]
    );
    const rdc = await pool.query(
      'SELECT quantity, serial_number FROM delivery_challan_lines WHERE dc_number = $1',
      [RDC]
    );
    console.log('Pickup items:', check.rows.map((r) => `${r.ttspl_id} ${r.status} rdc=${r.return_dc_number || '-'}`).join('; '));
    console.log('RDC quantity:', rdc.rows[0]?.quantity, 'serials:', rdc.rows[0]?.serial_number);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

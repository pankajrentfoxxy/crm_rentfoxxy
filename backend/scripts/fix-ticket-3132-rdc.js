/**
 * One-off: RDC002160 on ticket 3132 — restore TTSPL6511, defer TTSPL7030, regen PDF (2 laptops).
 * Run: node backend/scripts/fix-ticket-3132-rdc.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const { preserveCustomerAssetsOnCancel } = require('../services/supportCancelInventoryService');
const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
const replacementFlow = require('../services/supportReplacementFlowService');

const TICKET_ID = 3132;
const RDC = 'RDC002160';
const KEEP_IDS = [3451, 3452];
const DEFER_ID = 3453;

async function buildRdcEntries(client, pickupRows) {
  const entries = [];
  for (const row of pickupRows) {
    const serialCode = row.ttspl_id || row.unique_serial_number || row.serial_number;
    if (!serialCode) continue;
    const vsnRes = await client.query(
      `SELECT serial_id, serial_number, inventory_asset_code
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND (inventory_asset_code = $1 OR serial_number = $1 OR extra->>'ttspl_id' = $1)
        LIMIT 1`,
      [serialCode]
    );
    const vsn = vsnRes.rows[0];
    if (vsn) {
      entries.push(`|${vsn.serial_number}|${vsn.inventory_asset_code || serialCode}`);
    } else {
      entries.push(`|${serialCode}|${serialCode}`);
    }
  }
  return entries;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketRes = await client.query('SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE', [TICKET_ID]);
    const ticket = ticketRes.rows[0];
    if (!ticket) throw new Error('Ticket not found');

    // Restore 6511 pickup row from sibling 6977 (wrongly cancelled by partial edit).
    await client.query(
      `UPDATE support_ticket_items sti SET
          status = ref.status,
          return_dc_number = $3,
          pickup_method = ref.pickup_method,
          pickup_assigned_to = ref.pickup_assigned_to,
          assigned_to = ref.assigned_to,
          customer_otp_verified_at = ref.customer_otp_verified_at,
          picked_up_at = ref.picked_up_at,
          technician_esign_at = ref.technician_esign_at,
          technician_esign_url = ref.technician_esign_url,
          technician_esign_by = ref.technician_esign_by,
          customer_otp_code = ref.customer_otp_code,
          otp_code = ref.otp_code,
          customer_otp_sent_at = ref.customer_otp_sent_at,
          visited_at = ref.visited_at,
          updated_at = NOW()
        FROM support_ticket_items ref
       WHERE sti.id = $1 AND ref.id = $2`,
      [KEEP_IDS[0], KEEP_IDS[1], RDC]
    );

    const deferRes = await client.query(
      'SELECT * FROM support_ticket_items WHERE id = $1 FOR UPDATE',
      [DEFER_ID]
    );
    const deferRow = deferRes.rows[0];
    if (!deferRow) throw new Error('Defer item not found');

    await preserveCustomerAssetsOnCancel(client, {
      ticketId: TICKET_ID,
      customerId: ticket.customer_id,
      items: [deferRow],
      actorUserId: null,
      actorName: 'fix-ticket-3132-rdc',
    });

    await client.query(
      `UPDATE support_ticket_items SET
          status = 'cancelled',
          return_dc_number = NULL,
          assigned_to = NULL,
          pickup_assigned_to = NULL,
          pickup_method = NULL,
          otp_code = NULL,
          customer_otp_code = NULL,
          customer_otp_sent_at = NULL,
          picked_up_at = NULL,
          customer_otp_verified_at = NULL,
          technician_esign_at = NULL,
          visited_at = NULL,
          gate_inward_at = NULL,
          pod_image_path = NULL,
          proof_of_completion_path = NULL,
          updated_at = NOW()
        WHERE id = $1`,
      [DEFER_ID]
    );

    // Clear stale RDC link on any other cancelled pickups.
    await client.query(
      `UPDATE support_ticket_items SET return_dc_number = NULL, updated_at = NOW()
        WHERE ticket_id = $1 AND item_type = 'pickup' AND status = 'cancelled' AND return_dc_number = $2`,
      [TICKET_ID, RDC]
    );

    const keepRes = await client.query(
      `SELECT * FROM support_ticket_items WHERE id = ANY($1::int[]) ORDER BY id`,
      [KEEP_IDS]
    );
    const keeping = keepRes.rows;
    const entries = await buildRdcEntries(client, keeping);

    const dclRes = await client.query(
      `SELECT dc_number, dc_purpose, remarks FROM delivery_challan_lines
        WHERE dc_number = $1 AND movement_type = 'return' FOR UPDATE`,
      [RDC]
    );
    const dcl = dclRes.rows[0];
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

    const firstKeep = keeping[0];
    await client.query(
      `UPDATE delivery_challan_lines
          SET serial_number = $2::jsonb,
              quantity = $3,
              brand = COALESCE($4, brand),
              model_name = COALESCE($5, model_name),
              remarks = COALESCE($6, remarks),
              updated_at = NOW()
        WHERE dc_number = $1 AND movement_type = 'return'`,
      [RDC, JSON.stringify(entries), entries.length, firstKeep.brand, firstKeep.model, remarks]
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

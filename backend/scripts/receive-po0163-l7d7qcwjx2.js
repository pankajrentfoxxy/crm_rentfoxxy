#!/usr/bin/env node
/**
 * Receive PO-0163 / serial L7D7QCWJX2 into GRN + QC Process (floor ticket).
 *
 *   node scripts/receive-po0163-l7d7qcwjx2.js           (dry-run)
 *   node scripts/receive-po0163-l7d7qcwjx2.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { allocateTtsplCodes } = require('../services/vendorInventoryAssetCodeService');
const { freezeAcceptedReceiveConfig } = require('../services/grnReceivedConfigService');
const { resolveSerialForGrnIntake } = require('../services/serialReintakeService');
const { createTicketFromGrnReceive } = require('../services/grnTicketService');
const { logGrnReceive } = require('../services/ttsplAuditService');

const COMMIT = process.argv.includes('--commit');

const PO_ID = 162;
const LINE_INDEX = 0;
const SERIAL = 'L7D7QCWJX2';

function buildConfigExtraFromLine(line) {
  if (!line || typeof line !== 'object') return {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = line[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const config = {
    brand: pick('brand', 'brand_name'),
    model: pick('model', 'model_name', 'product_name'),
    processor: pick('processor'),
    generation: pick('generation'),
    ram: pick('ram'),
    storage: pick('storage'),
    gpu: pick('gpu'),
    screen_size: pick('screen_size', 'screen'),
  };
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
}

async function syncPoReceiveProgressStatus(poId) {
  const r = await pool.query(
    `SELECT line_items FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`,
    [poId]
  );
  if (!r.rows.length) return;
  const lines = Array.isArray(r.rows[0].line_items) ? r.rows[0].line_items : [];
  const orderQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const recv = await pool.query(
    `SELECT COUNT(*)::int AS n FROM vendor_serial_numbers WHERE po_id = $1 AND deleted_at IS NULL`,
    [poId]
  );
  const receivedQty = recv.rows[0]?.n || 0;
  const nextStatus = receivedQty >= orderQty && orderQty > 0 ? 'completed' : 'processing';
  await pool.query(
    `UPDATE vendor_purchase_orders SET status = $2, updated_at = NOW() WHERE po_id = $1`,
    [poId, nextStatus]
  );
}

async function main() {
  const existing = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, qc_status, inventory_status, grn_id
       FROM vendor_serial_numbers
      WHERE UPPER(serial_number) = $1 AND deleted_at IS NULL`,
    [SERIAL.toUpperCase()]
  );
  if (existing.rows.length) {
    const row = existing.rows[0];
    console.log('Serial already exists:', row);
    if (row.qc_status === 'pending' && row.grn_id) {
      const ticket = await createTicketFromGrnReceive(pool, {
        serialId: row.serial_id,
        serialNumber: row.serial_number,
        inventoryAssetCode: row.inventory_asset_code,
        po: { po_id: PO_ID, purchase_order_number: 'PO-0163' },
        line: (await pool.query('SELECT line_items FROM vendor_purchase_orders WHERE po_id=$1', [PO_ID])).rows[0]?.line_items?.[0],
        actorUserId: null,
      });
      console.log('Ticket ensure:', ticket);
    }
    await pool.end();
    return;
  }

  const poRes = await pool.query(
    `SELECT * FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`,
    [PO_ID]
  );
  if (!poRes.rows.length) throw new Error('PO-0163 not found');
  const po = poRes.rows[0];
  const lines = Array.isArray(po.line_items) ? po.line_items : [];
  const line = lines[LINE_INDEX];
  if (!line) throw new Error('Line 0 not found on PO');

  console.log('PO:', po.purchase_order_number, 'status:', po.status);
  console.log('Line:', line.brand, line.model_name || line.model);
  console.log('Serial:', SERIAL);
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (!COMMIT) {
    console.log('\nWould create GRN, TTSPL, vendor_serial_numbers (qc pending), floor ticket.');
    await pool.end();
    return;
  }

  const pd = line.product_detail_id ?? line.product_id ?? line.pro_id ?? line.id;
  const configExtra = buildConfigExtraFromLine(line);

  const client = await pool.connect();
  let serialId;
  let grnId;
  let ttspl;
  try {
    await client.query('BEGIN');

    const insG = await client.query(
      `INSERT INTO vendor_goods_received_notes (po_id, meta) VALUES ($1, '{}'::jsonb) RETURNING grn_id`,
      [PO_ID]
    );
    grnId = insG.rows[0].grn_id;

    const reintake = await resolveSerialForGrnIntake(client, SERIAL, {
      reason: 'grn_receive_script_po0163',
      actorUserId: null,
      actorName: 'receive-po0163-script',
      newPoId: PO_ID,
      newGrnId: grnId,
    });
    if (!reintake.ok) throw new Error(reintake.message);

    [ttspl] = await allocateTtsplCodes(client, 1);
    const extra = {
      line_index: LINE_INDEX,
      unique_product_serial: ttspl,
      status: 'pending',
      ...configExtra,
    };
    if (pd != null) extra.product_detail_id = String(pd);

    const insS = await client.query(
      `INSERT INTO vendor_serial_numbers (
         po_id, grn_id, serial_number, inventory_asset_code,
         qc_status, inventory_status, extra
       ) VALUES ($1,$2,$3,$4,'pending','in_stock',$5::jsonb)
       RETURNING serial_id`,
      [PO_ID, grnId, SERIAL.toUpperCase(), ttspl, JSON.stringify(extra)]
    );
    serialId = insS.rows[0].serial_id;

    await freezeAcceptedReceiveConfig(client, {
      serialId,
      grnId,
      productDetailId: pd,
      config: configExtra,
    });

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  await logGrnReceive({
    ttsplId: ttspl,
    vendorSerialId: serialId,
    serialNumber: SERIAL.toUpperCase(),
    poLabel: po.purchase_order_number,
    actorUserId: null,
  }).catch(() => {});

  await syncPoReceiveProgressStatus(PO_ID);

  const ticketResult = await createTicketFromGrnReceive(pool, {
    serialId,
    serialNumber: SERIAL.toUpperCase(),
    inventoryAssetCode: ttspl,
    po,
    line,
    actorUserId: null,
    grnId,
  });

  const verify = await pool.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.qc_status,
            vsn.inventory_status, vsn.grn_id, vsn.po_id,
            tk.ticket_id, tk.status AS ticket_status, tk.current_stage_id
       FROM vendor_serial_numbers vsn
       LEFT JOIN tickets tk ON tk.vendor_serial_id = vsn.serial_id
          AND tk.status IN ('in_progress', 'on_hold')
      WHERE vsn.serial_id = $1`,
    [serialId]
  );

  console.log('\nDone.');
  console.log('GRN ID:', grnId, `(GRN-${String(grnId).padStart(4, '0')})`);
  console.log('TTSPL:', ttspl);
  console.log('Serial row:', verify.rows[0]);
  console.log('Floor ticket:', ticketResult);

  await pool.end();
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});

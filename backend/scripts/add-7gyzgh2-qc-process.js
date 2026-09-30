#!/usr/bin/env node
/**
 * 7GYZGH2 (Dell Latitude 7490) — add to QC Process with a floor ticket, no new PO.
 *
 * A laptop must hang off a PO + GRN (vendor_serial_po_or_spo_chk, grn_id NOT NULL), so the
 * unit goes on the existing zero-value RENTFOXXY SELF PO-0207 / GRN 9268 as a new Rs 0 line.
 * The floor manager assigns it; the Rental / Sale tag is chosen at QC2 (direct_purchase PO,
 * no inventory_tag_override).
 *
 *   node scripts/add-7gyzgh2-qc-process.js           (dry-run, rolled back)
 *   node scripts/add-7gyzgh2-qc-process.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const { allocateTtsplCodes } = require('../services/vendorInventoryAssetCodeService');
const { freezeAcceptedReceiveConfig } = require('../services/grnReceivedConfigService');
const { logGrnReceive } = require('../services/ttsplAuditService');
const { ensureFloorTicketForQcSerial } = require('../services/qcProcessIntakeService');
const { invalidateInventoryListCachesFireAndForget } = require('../services/inventoryListCache');

const COMMIT = process.argv.includes('--commit');
const SERIAL_NUMBER = '7GYZGH2';
const PO_NUMBER = 'PO-0207';
const ACTOR_USER_ID = 44;
const INTAKE_SOURCE = 'qc_process_backend_add';

const SPECS = {
  brand: 'Dell',
  model: 'Latitude 7490',
  model_name: 'Latitude 7490',
  processor: 'I5',
  generation: '8TH',
  ram: '16GB',
  storage: '256 GB SSD',
  gpu: 'Integrated',
  screen_size: '14"',
};

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT serial_id FROM vendor_serial_numbers WHERE deleted_at IS NULL AND LOWER(serial_number) = LOWER($1)
       UNION ALL SELECT ticket_id FROM tickets WHERE LOWER(serial_number) = LOWER($1)`,
      [SERIAL_NUMBER]
    );
    if (dup.rows.length) throw new Error(`${SERIAL_NUMBER} already exists`);

    const poRes = await client.query(
      `SELECT po_id, purchase_order_number, purchase_order_type, vendor_id, line_items
         FROM vendor_purchase_orders
        WHERE purchase_order_number = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [PO_NUMBER]
    );
    const po = poRes.rows[0];
    if (!po) throw new Error(`${PO_NUMBER} not found`);
    const grnRes = await client.query(
      `SELECT grn_id FROM vendor_goods_received_notes WHERE po_id = $1 AND deleted_at IS NULL ORDER BY grn_id LIMIT 1`,
      [po.po_id]
    );
    const grnId = grnRes.rows[0]?.grn_id;
    if (!grnId) throw new Error(`${PO_NUMBER} has no GRN`);

    const line = {
      brand: SPECS.brand,
      model: SPECS.model,
      product_name: SPECS.model,
      processor: SPECS.processor,
      generation: SPECS.generation,
      ram: SPECS.ram,
      storage: SPECS.storage,
      gpu: SPECS.gpu,
      screen_size: SPECS.screen_size,
      quantity: 1,
      receivedQty: 1,
      unit_price: 0,
      price: 0,
      warranty_months: 12,
      remarks: 'Backend QC Process add — no purchase',
    };
    const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
    const lineIndex = lineItems.length;
    await client.query(
      `UPDATE vendor_purchase_orders SET line_items = $2::jsonb, updated_at = NOW() WHERE po_id = $1`,
      [po.po_id, JSON.stringify([...lineItems, line])]
    );

    const [ttspl] = await allocateTtsplCodes(client, 1);
    const today = new Date().toISOString().slice(0, 10);
    const extra = {
      line_index: lineIndex,
      rental_start_date: today,
      unique_product_serial: ttspl,
      intake_source: INTAKE_SOURCE,
      ...SPECS,
    };
    const serialIns = await client.query(
      `INSERT INTO vendor_serial_numbers (
         po_id, grn_id, serial_number, inventory_asset_code, rental_start_date,
         qc_status, inventory_status, extra
       ) VALUES ($1, $2, $3, $4, $5::date, 'pending', 'in_stock', $6::jsonb)
       RETURNING serial_id`,
      [po.po_id, grnId, SERIAL_NUMBER, ttspl, today, JSON.stringify(extra)]
    );
    const serialId = serialIns.rows[0].serial_id;

    await freezeAcceptedReceiveConfig(client, { serialId, grnId, productDetailId: null, config: SPECS });
    await logGrnReceive({
      ttsplId: ttspl,
      vendorSerialId: serialId,
      serialNumber: SERIAL_NUMBER,
      poLabel: po.purchase_order_number,
      actorUserId: ACTOR_USER_ID,
      db: client,
    });

    const tk = await ensureFloorTicketForQcSerial(client, {
      serialId,
      serialNumber: SERIAL_NUMBER,
      inventoryAssetCode: ttspl,
      po: {
        po_id: po.po_id,
        purchase_order_number: po.purchase_order_number,
        purchase_order_type: po.purchase_order_type,
        vendor_id: po.vendor_id,
      },
      line,
      actorUserId: ACTOR_USER_ID,
      sourceNote: 'QC Process — added from backend (no purchase)',
    });
    if (!tk.ok || !tk.ticket_id) throw new Error(`Floor ticket not created: ${JSON.stringify(tk)}`);

    const check = await client.query(
      `SELECT t.ticket_id, t.status, s.stage_name, u.name AS assignee,
              pa.production_asset_id, pa.status AS pa_status,
              vsn.qc_status, vsn.inventory_status, vsn.grn_received_config
         FROM tickets t
         JOIN stages s ON s.stage_id = t.current_stage_id
         LEFT JOIN users u ON u.user_id = t.assigned_user_id
         LEFT JOIN production_assets pa ON pa.ticket_id = t.ticket_id
         JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id
        WHERE t.ticket_id = $1`,
      [tk.ticket_id]
    );
    const row = check.rows[0];
    if (!row?.production_asset_id) throw new Error('Production asset row was not created');

    console.log(JSON.stringify({
      ttspl,
      serial_id: serialId,
      po: `${po.purchase_order_number} line ${lineIndex}`,
      grn_id: grnId,
      ticket: row,
    }, null, 2));

    if (COMMIT) {
      await client.query('COMMIT');
      invalidateInventoryListCachesFireAndForget();
      console.log('COMMITTED');
    } else {
      await client.query('ROLLBACK');
      console.log('DRY RUN — rolled back');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED, rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

main();

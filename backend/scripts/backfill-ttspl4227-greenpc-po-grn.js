#!/usr/bin/env node
/**
 * TTSPL4227 / 4LX8S73 — backfill direct_purchase PO from GREEN PC WORLD (vendor #20)
 * dated 6 Mar 2025, GRN receive, floor QC ticket.
 *
 * Unit was wrongly imported as a spare part (SP-PO / GRN-7398). This script:
 *   1. Creates approved/completed direct_purchase PO (vendor 20, 2025-03-06)
 *   2. Creates GRN + links existing TTSPL4227 row (fixes serial → 4LX8S73)
 *   3. Clears spare-part + mistaken customer assignment
 *   4. Sends to QC Process (floor ticket)
 *
 *   node scripts/backfill-ttspl4227-greenpc-po-grn.js           (dry-run)
 *   node scripts/backfill-ttspl4227-greenpc-po-grn.js --commit
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { getTotalAmountOfPurchaseOrder } = require('../utils/purchaseOrderGst');
const { allocatePurchaseOrderNumber } = require('../services/vendorNumberService');
const { freezeAcceptedReceiveConfig } = require('../services/grnReceivedConfigService');
const { createTicketFromGrnReceive } = require('../services/grnTicketService');
const { logGrnReceive } = require('../services/ttsplAuditService');
const { invalidateInventoryListCachesFireAndForget } = require('../services/inventoryListCache');

const COMMIT = process.argv.includes('--commit');

const VENDOR_ID = 20;
const SERIAL_ID = 6729;
const TTSPL = 'TTSPL4227';
const SERIAL_NUMBER = '4LX8S73';
const PO_DATE = '2025-03-06';
const GRN_AT = '2025-03-06T11:00:00+05:30';
const IMPORT_REMARK = 'Historical direct purchase backfill — TTSPL4227 from GREEN PC WORLD (6 Mar 2025)';

/** PO line specs — update at QC if needed. */
const SPECS = {
  brand: 'Dell',
  model: 'Laptop',
  model_name: 'Laptop',
  product_name: 'Laptop',
  processor: 'NA',
  generation: 'NA',
  ram: 'NA',
  storage: 'NA',
  gpu: 'Intel UHD Graphics',
  screen_size: '14-inch',
  quantity: 1,
  unit_price: 0,
  price: 0,
  warranty_months: 12,
};

function buildLineItem() {
  return { ...SPECS };
}

async function main() {
  const vendorRes = await pool.query(
    `SELECT vendor_id, business_name, state FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`,
    [VENDOR_ID]
  );
  if (!vendorRes.rows.length) throw new Error(`Vendor #${VENDOR_ID} not found`);
  const vendor = vendorRes.rows[0];

  const vsnRes = await pool.query(
    `SELECT * FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
    [SERIAL_ID]
  );
  if (!vsnRes.rows.length) throw new Error(`${TTSPL} (serial_id ${SERIAL_ID}) not found`);
  const vsn = vsnRes.rows[0];
  if (vsn.inventory_asset_code !== TTSPL) {
    throw new Error(`Expected ${TTSPL}, got ${vsn.inventory_asset_code}`);
  }

  const dup = await pool.query(
    `SELECT serial_id FROM vendor_serial_numbers
      WHERE UPPER(TRIM(serial_number)) = $1 AND serial_id <> $2 AND deleted_at IS NULL`,
    [SERIAL_NUMBER.toUpperCase(), SERIAL_ID]
  );
  if (dup.rows.length) {
    throw new Error(`Serial ${SERIAL_NUMBER} already used by serial_id ${dup.rows[0].serial_id}`);
  }

  const existingPo = await pool.query(
    `SELECT po_id, purchase_order_number FROM vendor_purchase_orders
      WHERE vendor_id = $1 AND deleted_at IS NULL
        AND purchase_order_date = $2::date
        AND remarks ILIKE '%TTSPL4227%'
      LIMIT 1`,
    [VENDOR_ID, PO_DATE]
  );

  console.log('Vendor:', vendor.business_name, `(#${vendor.vendor_id})`);
  console.log('Unit:', TTSPL, 'current serial:', vsn.serial_number);
  console.log('  status:', vsn.inventory_status, 'qc:', vsn.qc_status);
  console.log('  po_id:', vsn.po_id, 'grn_id:', vsn.grn_id, 'spo_id:', vsn.spo_id);
  console.log('  customer_id:', vsn.current_customer_id);
  console.log('Target serial:', SERIAL_NUMBER, 'PO date:', PO_DATE);
  if (existingPo.rows.length) {
    console.log('Existing backfill PO:', existingPo.rows[0].purchase_order_number);
  }
  console.log('Mode:', COMMIT ? 'COMMIT' : 'DRY-RUN');

  if (vsn.po_id && vsn.grn_id && vsn.qc_status === 'pending' && vsn.inventory_status === 'in_stock') {
    const tk = await pool.query(
      `SELECT ticket_id, status FROM tickets WHERE vendor_serial_id = $1 AND status IN ('in_progress','on_hold')`,
      [SERIAL_ID]
    );
    if (tk.rows.length && String(vsn.serial_number).toUpperCase() === SERIAL_NUMBER.toUpperCase()) {
      console.log('Already backfilled with open floor ticket:', tk.rows[0].ticket_id);
      await pool.end();
      return;
    }
  }

  if (!COMMIT) {
    console.log('\nWould:');
    console.log('  1. Create direct_purchase PO (vendor 20, 2025-03-06, completed)');
    console.log('  2. Create GRN + link TTSPL4227, serial →', SERIAL_NUMBER);
    console.log('  3. Clear spare-part link + customer 163 assignment → in_stock / qc pending');
    console.log('  4. Create floor GRN QC ticket');
    console.log('Run with --commit to apply.');
    await pool.end();
    return;
  }

  const line = buildLineItem();
  const subTotal = 0;
  const totalAmount = getTotalAmountOfPurchaseOrder(subTotal, true);
  const poState = String(vendor.state || 'haryana').toLowerCase();

  const client = await pool.connect();
  let poId;
  let poNumber;
  let grnId;
  try {
    await client.query('BEGIN');

    if (existingPo.rows.length) {
      poId = existingPo.rows[0].po_id;
      poNumber = existingPo.rows[0].purchase_order_number;
      const g = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes
          WHERE po_id = $1 AND deleted_at IS NULL ORDER BY grn_id DESC LIMIT 1`,
        [poId]
      );
      grnId = g.rows[0]?.grn_id;
      if (!grnId) {
        const insG = await client.query(
          `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status, created_at, updated_at)
           VALUES ($1, $2::jsonb, 'received', $3::timestamptz, $3::timestamptz)
           RETURNING grn_id`,
          [poId, JSON.stringify({ backfill: 'ttspl4227', received_at: PO_DATE }), GRN_AT]
        );
        grnId = insG.rows[0].grn_id;
      }
    } else {
      poNumber = await allocatePurchaseOrderNumber(client, null);
      const poIns = await client.query(
        `INSERT INTO vendor_purchase_orders (
           purchase_order_number, purchase_order_date, purchase_order_type, vendor_id,
           po_state, is_same_state, sub_total_amount, total_amount,
           line_items, assets_details, product_details_legacy_ids, remarks,
           status, invoice_created, approved_at, sent_to_vendor_at,
           status_updated_by_name, created_at, updated_at
         ) VALUES (
           $1, $2::date, 'direct_purchase', $3, $4, TRUE, $5, $6,
           $7::jsonb, $8::jsonb, '[]'::jsonb, $9,
           'completed', TRUE, $10::timestamptz, $10::timestamptz,
           $11, $10::timestamptz, $10::timestamptz
         )
         RETURNING po_id`,
        [
          poNumber,
          PO_DATE,
          VENDOR_ID,
          poState,
          subTotal,
          totalAmount,
          JSON.stringify([line]),
          JSON.stringify({ backfill: true, source: 'ttspl4227_greenpc', lines: [line] }),
          IMPORT_REMARK,
          GRN_AT,
          'backfill-ttspl4227-greenpc-po-grn',
        ]
      );
      poId = poIns.rows[0].po_id;

      const grnIns = await client.query(
        `INSERT INTO vendor_goods_received_notes (po_id, meta, bill_status, created_at, updated_at)
         VALUES ($1, $2::jsonb, 'received', $3::timestamptz, $3::timestamptz)
         RETURNING grn_id`,
        [
          poId,
          JSON.stringify({
            backfill: 'ttspl4227',
            received_at: PO_DATE,
            vendor_id: VENDOR_ID,
            notes: IMPORT_REMARK,
          }),
          GRN_AT,
        ]
      );
      grnId = grnIns.rows[0].grn_id;
    }

    const extra = {
      line_index: 0,
      rental_start_date: PO_DATE,
      unique_product_serial: TTSPL,
      status: 'pending',
      backfill_source: 'greenpc_direct_purchase_2025-03-06',
      previous_serial_number: vsn.serial_number,
      previous_grn_id: vsn.grn_id,
      previous_spo_id: vsn.spo_id,
      brand: line.brand,
      model: line.model,
      model_name: line.model_name,
      processor: line.processor,
      generation: line.generation,
      ram: line.ram,
      storage: line.storage,
      gpu: line.gpu,
      screen_size: line.screen_size,
    };

    await client.query(
      `UPDATE vendor_serial_numbers SET
          po_id = $1,
          grn_id = $2,
          spo_id = NULL,
          serial_number = $3,
          qc_status = 'pending',
          inventory_status = 'in_stock',
          current_customer_id = NULL,
          current_dc_number = NULL,
          current_entity = NULL,
          dispatch_mode = NULL,
          dispatched_at = NULL,
          delivered_at = NULL,
          rent_start_date = NULL,
          rent_end_date = NULL,
          rent_billed_until = NULL,
          rent_monthly_rate = NULL,
          rental_start_date = $4::date,
          extra = $5::jsonb,
          received_condition = 'on',
          missing_parts = '[]'::jsonb,
          updated_at = NOW()
        WHERE serial_id = $6`,
      [poId, grnId, SERIAL_NUMBER.toUpperCase(), PO_DATE, JSON.stringify(extra), SERIAL_ID]
    );

    await freezeAcceptedReceiveConfig(client, {
      serialId: SERIAL_ID,
      grnId,
      productDetailId: null,
      config: {
        brand: line.brand,
        model: line.model,
        processor: line.processor,
        generation: line.generation,
        ram: line.ram,
        storage: line.storage,
        gpu: line.gpu,
        screen_size: line.screen_size,
      },
    });

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  await logGrnReceive({
    ttsplId: TTSPL,
    vendorSerialId: SERIAL_ID,
    serialNumber: SERIAL_NUMBER.toUpperCase(),
    poLabel: poNumber,
    actorUserId: null,
  }).catch(() => {});

  const poRow = await pool.query(
    `SELECT po_id, purchase_order_number, purchase_order_date, vendor_id, line_items
       FROM vendor_purchase_orders WHERE po_id = $1`,
    [poId]
  );
  const po = poRow.rows[0];
  const poLine = Array.isArray(po.line_items) ? po.line_items[0] : line;

  const ticketResult = await createTicketFromGrnReceive(pool, {
    serialId: SERIAL_ID,
    serialNumber: SERIAL_NUMBER.toUpperCase(),
    inventoryAssetCode: TTSPL,
    po,
    line: poLine,
    actorUserId: null,
    grnId,
    receivedCondition: 'on',
    missingParts: [],
  });

  invalidateInventoryListCachesFireAndForget();

  const verify = await pool.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.po_id, vsn.grn_id,
            vsn.spo_id, vsn.qc_status, vsn.inventory_status, vsn.current_customer_id,
            p.purchase_order_number, p.purchase_order_date, p.vendor_id,
            tk.ticket_id, tk.status AS ticket_status
       FROM vendor_serial_numbers vsn
       LEFT JOIN vendor_purchase_orders p ON p.po_id = vsn.po_id
       LEFT JOIN tickets tk ON tk.vendor_serial_id = vsn.serial_id
          AND tk.status IN ('in_progress', 'on_hold')
      WHERE vsn.serial_id = $1`,
    [SERIAL_ID]
  );

  console.log('\nDone.');
  console.log('PO:', verify.rows[0]?.purchase_order_number, 'date:', verify.rows[0]?.purchase_order_date);
  console.log('GRN ID:', grnId);
  console.log('Serial row:', verify.rows[0]);
  console.log('Floor ticket:', ticketResult);

  await pool.end();
}

main().catch((e) => {
  console.error('Failed:', e.message || e);
  process.exit(1);
});

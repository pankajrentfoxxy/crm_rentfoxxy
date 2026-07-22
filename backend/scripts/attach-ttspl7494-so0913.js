/**
 * One-off: attach TTSPL7494 to SO/26-27/0913
 * Usage: node backend/scripts/attach-ttspl7494-so0913.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const inventorySM = require('../services/inventoryStateMachine');
const { createSalesOrderQcTicket } = require('../services/grnTicketService');
const { entityForQuotationType } = require('../services/salesManagementService');
const { serialMatchesSoLine, configMismatchMessage } = require('../utils/soInventorySpecMatch');

const SO_NUMBER = 'SO/26-27/0913';
const LINE_ID = 4837;
const TTSPL = 'TTSPL7494';
const ACTOR_USER_ID = 2;

const SPEC_SELECT = `
  SELECT vsn.serial_id, vsn.serial_number, vsn.inventory_asset_code, vsn.qc_status, vsn.inventory_status,
         COALESCE(vsn.extra->>'brand', vpd.brand) AS brand,
         COALESCE(vsn.extra->>'model', vsn.extra->>'model_name', vpd.model) AS model,
         COALESCE(vsn.extra->>'processor', vpd.processor) AS processor,
         COALESCE(vsn.extra->>'generation', vpd.generation) AS generation,
         COALESCE(vsn.extra->>'ram', vpd.ram) AS ram,
         COALESCE(NULLIF(vsn.extra->>'storage', ''), NULLIF(vsn.extra->>'ssd', ''), vpd.storage) AS storage,
         COALESCE(vsn.extra->>'gpu', vpd.gpu) AS gpu,
         COALESCE(vsn.extra->>'screen_size', vpd.screen_size) AS screen_size
  FROM vendor_serial_numbers vsn
  LEFT JOIN vendor_product_details vpd
    ON vpd.product_detail_id = NULLIF(vsn.extra->>'product_detail_id', '')::int
  WHERE vsn.deleted_at IS NULL
`;

async function getSoHeader(soNumber) {
  const r = await pool.query(
    `SELECT sales_order_number, customer_id, quotation_type, entity_code
       FROM sales_order_lines WHERE sales_order_number = $1 ORDER BY id ASC LIMIT 1`,
    [soNumber]
  );
  return r.rows[0] || null;
}

async function main() {
  const client = await pool.connect();
  try {
    const header = await getSoHeader(SO_NUMBER);
    if (!header) throw new Error('SO not found');

    const sr = await client.query(`${SPEC_SELECT} AND vsn.inventory_asset_code = $1 LIMIT 1`, [TTSPL]);
    const serial = sr.rows[0];
    if (!serial) throw new Error(`${TTSPL} not found`);

    const dup = await client.query(
      `SELECT allocation_id, sales_order_number FROM sales_order_serials WHERE serial_id = $1 AND status = 'attached'`,
      [serial.serial_id]
    );
    if (dup.rows.length) {
      console.log('Already attached to', dup.rows[0].sales_order_number);
      return;
    }

    const lineRes = await client.query(
      `SELECT id AS line_id, brand, model_name, processor, generation, ram, storage
         FROM sales_order_lines WHERE sales_order_number = $1 AND id = $2`,
      [SO_NUMBER, LINE_ID]
    );
    const line = lineRes.rows[0];
    if (!line) throw new Error('Line not found');
    if (!serialMatchesSoLine(line, serial)) {
      throw new Error(configMismatchMessage(line, serial));
    }

    const entityCode = header.entity_code || entityForQuotationType(header.quotation_type);
    await client.query('BEGIN');

    await inventorySM.transitionAsset(client, {
      serialId: serial.serial_id,
      toStatus: inventorySM.STATUS.RESERVED,
      customerId: header.customer_id || null,
      entityCode,
      reason: `Attached to ${SO_NUMBER}`,
      actorUserId: ACTOR_USER_ID,
      actorName: 'Script attach',
    });

    const ticket = await createSalesOrderQcTicket(client, {
      serialId: serial.serial_id,
      ttsplId: serial.inventory_asset_code,
      serialNumber: serial.serial_number,
      brand: serial.brand,
      model: serial.model,
      processor: serial.processor,
      generation: serial.generation,
      ram: serial.ram,
      storage: serial.storage,
      salesOrderNumber: SO_NUMBER,
      dcNumber: null,
      createdByUserId: ACTOR_USER_ID,
    });

    const ins = await client.query(
      `INSERT INTO sales_order_serials
         (sales_order_number, line_id, serial_id, ttspl_id, serial_number,
          qc_ticket_id, qc_status, status, entity_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending','attached',$7,$8)
       RETURNING allocation_id`,
      [
        SO_NUMBER, line.line_id, serial.serial_id, serial.inventory_asset_code, serial.serial_number,
        ticket.ok ? ticket.ticket_id : null, entityCode, ACTOR_USER_ID,
      ]
    );

    await client.query('COMMIT');
    console.log('Attached', TTSPL, 'allocation_id=', ins.rows[0].allocation_id, 'qc_ticket_id=', ticket.ticket_id);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

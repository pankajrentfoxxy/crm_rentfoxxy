#!/usr/bin/env node
/**
 * Move specific Carrum Delhi laptops from HR (#207) to DL entity (#988).
 * Updates vendor_serial_numbers (rented only), sales_order_lines, delivery_challan_lines,
 * and support return tickets where customer is HR so returned units appear in DL's return bucket.
 * Generates flow report CSV.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const HR_ID = 207;
const DL_ID = 988;
const DL_NAME = 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED(DL)';
const STATE = 'delhi';

const TTSPLS = [
  'TTSPL6067', 'TTSPL6782', 'TTSPL6345', 'TTSPL6543', 'TTSPL6242', 'TTSPL6486',
  'TTSPL6165', 'TTSPL6911', 'TTSPL6115', 'TTSPL6493', 'TTSPL6501', 'TTSPL6233',
  'TTSPL6446', 'TTSPL2987',
];

const REPORT_PATH = path.join(__dirname, '..', '..', 'reports', 'carrum-delhi-laptop-flow.csv');

async function fetchFlow(ttspl) {
  const vsn = await pool.query(`
    SELECT serial_id, inventory_asset_code, serial_number, inventory_status,
           current_customer_id, current_dc_number, rent_monthly_rate, rent_start_date
    FROM vendor_serial_numbers
    WHERE UPPER(inventory_asset_code) = UPPER($1) AND deleted_at IS NULL
  `, [ttspl]);

  const sos = await pool.query(`
    SELECT sos.sales_order_number, sos.line_id, sos.dc_number, sos.status,
           sol.customer_id, sol.customer_name, sol.supply_state
    FROM sales_order_serials sos
    JOIN sales_order_lines sol ON sol.id = sos.line_id
    WHERE UPPER(sos.ttspl_id) = UPPER($1) AND sos.status <> 'removed'
    ORDER BY sos.allocation_id DESC LIMIT 1
  `, [ttspl]);

  const dcs = await pool.query(`
    SELECT dcl.dc_number, dcl.customer_id, dcl.customer_name, dcl.status,
           dcl.movement_type, dcl.supply_state, dcl.delivered_at, dcl.sales_order_number
    FROM delivery_challan_lines dcl,
         jsonb_array_elements_text(
           CASE jsonb_typeof(COALESCE(dcl.delivered_serial_numbers, dcl.serial_number, '[]'::jsonb))
             WHEN 'array' THEN COALESCE(dcl.delivered_serial_numbers, dcl.serial_number)
             ELSE '[]'::jsonb END
         ) elem
    WHERE UPPER(split_part(elem, '|', 3)) = UPPER($1)
    ORDER BY dcl.delivered_at DESC NULLS LAST
  `, [ttspl]);

  return { vsn: vsn.rows[0], so: sos.rows[0], dcs: dcs.rows };
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const client = await pool.connect();
  const updated = { vsn: 0, soLines: new Set(), dcs: new Set(), tickets: new Set() };

  try {
    await client.query('BEGIN');

    for (const ttspl of TTSPLS) {
      const vsn = await client.query(`
        SELECT inventory_status, current_customer_id FROM vendor_serial_numbers
        WHERE UPPER(inventory_asset_code) = UPPER($1) AND deleted_at IS NULL
      `, [ttspl]);
      if (!vsn.rows[0]) {
        console.warn(`Skip ${ttspl}: not found`);
        continue;
      }

      if (vsn.rows[0].inventory_status === 'rented' && Number(vsn.rows[0].current_customer_id) === HR_ID) {
        await client.query(`
          UPDATE vendor_serial_numbers
          SET current_customer_id = $2,
              extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object(
                'carrum_delhi_remap_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'carrum_delhi_remap_from', $3::text
              ),
              updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(inventory_asset_code) = UPPER($1)
        `, [ttspl, DL_ID, String(HR_ID)]);
        updated.vsn += 1;
      }

      const sos = await client.query(`
        SELECT sos.line_id FROM sales_order_serials sos
        WHERE UPPER(sos.ttspl_id) = UPPER($1) AND sos.status <> 'removed'
        ORDER BY sos.allocation_id DESC LIMIT 1
      `, [ttspl]);

      if (sos.rows[0]?.line_id) {
        const r = await client.query(`
          UPDATE sales_order_lines
          SET customer_id = $1, customer_name = $2, supply_state = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 AND customer_id = $5
          RETURNING id
        `, [DL_ID, DL_NAME, STATE, sos.rows[0].line_id, HR_ID]);
        if (r.rowCount) updated.soLines.add(sos.rows[0].line_id);
      }

      const dcs = await client.query(`
        SELECT DISTINCT dcl.dc_number, dcl.movement_type
        FROM delivery_challan_lines dcl,
             jsonb_array_elements_text(
               CASE jsonb_typeof(COALESCE(dcl.delivered_serial_numbers, dcl.serial_number, '[]'::jsonb))
                 WHEN 'array' THEN COALESCE(dcl.delivered_serial_numbers, dcl.serial_number)
                 ELSE '[]'::jsonb END
             ) elem
        WHERE UPPER(split_part(elem, '|', 3)) = UPPER($1) AND dcl.customer_id = $2
      `, [ttspl, HR_ID]);

      for (const { dc_number } of dcs.rows) {
        const r = await client.query(`
          UPDATE delivery_challan_lines
          SET customer_id = $1, customer_name = $2,
              supply_state = CASE WHEN movement_type = 'outbound' THEN $3 ELSE supply_state END,
              updated_at = CURRENT_TIMESTAMP
          WHERE dc_number = $4 AND customer_id = $5
          RETURNING dc_number
        `, [DL_ID, DL_NAME, STATE, dc_number, HR_ID]);
        if (r.rowCount) updated.dcs.add(dc_number);
      }

      // Return bucket uses delivery_challan_lines.customer_id on return DCs; also align pickup tickets.
      const returnDcs = await client.query(`
        SELECT DISTINCT dcl.dc_number
        FROM delivery_challan_lines dcl,
             jsonb_array_elements_text(
               CASE jsonb_typeof(COALESCE(dcl.delivered_serial_numbers, dcl.serial_number, '[]'::jsonb))
                 WHEN 'array' THEN COALESCE(dcl.delivered_serial_numbers, dcl.serial_number)
                 ELSE '[]'::jsonb END
             ) elem
        WHERE UPPER(split_part(elem, '|', 3)) = UPPER($1)
          AND dcl.movement_type = 'return'
          AND dcl.customer_id = $2
      `, [ttspl, DL_ID]);

      for (const { dc_number } of returnDcs.rows) {
        const tickets = await client.query(`
          UPDATE support_tickets st
          SET customer_id = $1, customer_name = $2, updated_at = CURRENT_TIMESTAMP
          FROM support_ticket_items sti
          WHERE sti.ticket_id = st.id
            AND sti.item_type = 'pickup'
            AND sti.return_dc_number = $3
            AND st.customer_id = $4
          RETURNING st.id
        `, [DL_ID, DL_NAME, dc_number, HR_ID]);
        tickets.rows.forEach(({ id }) => updated.tickets.add(id));
      }
    }

    await client.query('COMMIT');
    console.log(`Updated ${updated.vsn} rented asset(s), ${updated.soLines.size} SO line(s), ${updated.dcs.size} DC(s), ${updated.tickets.size} return ticket(s).`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const rows = [];
  const header = [
    'TTSPL', 'Serial', 'InventoryStatus', 'CurrentCustomerId', 'RentStart', 'MonthlyRate',
    'SO', 'SOLineId', 'SOCustomerId', 'SOSupplyState',
    'OutboundDC', 'OutboundDelivered', 'ReturnDC', 'ReturnDelivered',
  ];
  rows.push(header.join(','));

  for (const ttspl of TTSPLS) {
    const { vsn, so, dcs } = await fetchFlow(ttspl);
    const outbound = dcs.find((d) => d.movement_type === 'outbound');
    const ret = dcs.find((d) => d.movement_type === 'return' && Number(d.customer_id) === DL_ID)
      || dcs.find((d) => d.movement_type === 'return');
    rows.push([
      ttspl,
      vsn?.serial_number,
      vsn?.inventory_status,
      vsn?.current_customer_id,
      vsn?.rent_start_date ? vsn.rent_start_date.toISOString().slice(0, 10) : '',
      vsn?.rent_monthly_rate,
      so?.sales_order_number,
      so?.line_id,
      so?.customer_id,
      so?.supply_state,
      outbound?.dc_number,
      outbound?.delivered_at ? outbound.delivered_at.toISOString().slice(0, 10) : '',
      ret?.dc_number,
      ret?.delivered_at ? ret.delivered_at.toISOString().slice(0, 10) : '',
    ].map(csvEscape).join(','));
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, rows.join('\n') + '\n');
  console.log(`Flow report: ${REPORT_PATH}`);

  const { queryCustomerReturnedAssets, queryCustomerActiveAssets } = require('../controllers/customerManagementController');
  const [ret, active] = await Promise.all([
    queryCustomerReturnedAssets(DL_ID, { limit: 500 }),
    queryCustomerActiveAssets(DL_ID, { limit: 500 }),
  ]);
  const inReturned = TTSPLS.filter((t) => ret.rows.some((r) => r.ttspl_id === t));
  const inActive = TTSPLS.filter((t) => active.rows.some((r) => r.ttspl_id === t));
  console.log(`DL return bucket: ${inReturned.length} of ${TTSPLS.length - inActive.length} returned unit(s)`);
  console.log(`DL active bucket: ${inActive.length} rented unit(s)`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

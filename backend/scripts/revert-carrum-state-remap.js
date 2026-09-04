#!/usr/bin/env node
/** Revert remap-carrum-laptops-by-state.js — restore all Carrum laptops to HR (#207). */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const HR_ID = 207;
const HR_NAME = 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED(HR)';
const CARRUM_IDS = [207, 985, 986, 987, 988];
const PLAN_CSV = path.join(__dirname, '..', '..', 'reports', 'carrum-state-remap-plan.csv');

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur);
    const row = {};
    header.forEach((h, i) => { row[h.trim()] = (cols[i] || '').trim(); });
    return row;
  });
}

async function main() {
  const plan = parseCsv(fs.readFileSync(PLAN_CSV, 'utf8'));
  const changed = plan.filter((r) => r.Changed === 'YES');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of changed) {
      const ttspl = row.TTSPL;
      await client.query(`
        UPDATE vendor_serial_numbers
        SET current_customer_id = $2,
            extra = COALESCE(extra, '{}'::jsonb)
              - 'master_customer_id'
              - 'state_entity_code'
              - 'state_entity_customer_id'
              - 'carrum_remap_at'
              - 'carrum_remap_source',
            updated_at = CURRENT_TIMESTAMP
        WHERE UPPER(inventory_asset_code) = UPPER($1)
      `, [ttspl, HR_ID]);

      const sos = await client.query(`
        SELECT sos.line_id, sos.sales_order_number
        FROM sales_order_serials sos
        WHERE UPPER(sos.ttspl_id) = UPPER($1) AND sos.status <> 'removed'
        ORDER BY sos.allocation_id DESC LIMIT 1
      `, [ttspl]);
      if (sos.rows[0]?.line_id) {
        await client.query(`
          UPDATE sales_order_lines
          SET customer_id = $1, customer_name = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [HR_ID, HR_NAME, sos.rows[0].line_id]);
      }

      if (row.DC) {
        await client.query(`
          UPDATE delivery_challan_lines
          SET customer_id = $1, customer_name = $2, updated_at = CURRENT_TIMESTAMP
          WHERE dc_number = $3 AND customer_id = ANY($4::int[])
        `, [HR_ID, HR_NAME, row.DC, CARRUM_IDS]);
      }
    }

    // Strip remap metadata from any remaining Carrum units.
    await client.query(`
      UPDATE vendor_serial_numbers
      SET extra = COALESCE(extra, '{}'::jsonb)
        - 'master_customer_id'
        - 'state_entity_code'
        - 'state_entity_customer_id'
        - 'carrum_remap_at'
        - 'carrum_remap_source',
          updated_at = CURRENT_TIMESTAMP
      WHERE current_customer_id = ANY($1::int[])
        AND (
          extra ? 'master_customer_id'
          OR extra ? 'state_entity_code'
          OR extra ? 'carrum_remap_at'
        )
    `, [CARRUM_IDS]);

    await client.query('COMMIT');
    console.log(`Reverted ${changed.length} laptop assignment(s) to HR #207.`);

    const verify = await pool.query(`
      SELECT current_customer_id, COUNT(*)::int c
      FROM vendor_serial_numbers
      WHERE current_customer_id = ANY($1::int[]) AND deleted_at IS NULL AND inventory_status = 'rented'
      GROUP BY current_customer_id ORDER BY 1
    `, [CARRUM_IDS]);
    console.log('Rented counts:', verify.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

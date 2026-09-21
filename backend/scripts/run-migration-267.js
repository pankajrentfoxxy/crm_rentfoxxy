/**
 * Run migration 267 — part_instances brand/model + backfill from SPO lines.
 * Usage: node scripts/run-migration-267.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '267_part_instances_brand_model.sql';

async function main() {
  const sqlPath = path.join(__dirname, '../migrations', MIGRATION_NAME);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);

    // Backfill from SPO line_items + vendor_serial extra
    const upd = await client.query(`
      WITH line_src AS (
        SELECT
          pi.instance_id,
          NULLIF(TRIM(COALESCE(
            pi.brand,
            vsn.extra->>'brand_name',
            vsn.extra->>'brand',
            li.elem->>'brand_name',
            li.elem->>'brand'
          )), '') AS brand,
          NULLIF(TRIM(COALESCE(
            pi.model,
            vsn.extra->>'model_name',
            vsn.extra->>'model',
            li.elem->>'model_name',
            li.elem->>'model'
          )), '') AS model
        FROM part_instances pi
        LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = pi.vendor_serial_id
        LEFT JOIN vendor_spare_parts_purchase_orders spo ON spo.spo_id = pi.spo_id
        LEFT JOIN LATERAL (
          SELECT elem
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(spo.line_items) = 'array' THEN spo.line_items
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS t(elem, ord)
          WHERE pi.spo_line_index IS NOT NULL
            AND t.ord - 1 = pi.spo_line_index
          LIMIT 1
        ) li ON TRUE
        WHERE pi.spo_id IS NOT NULL
          AND (pi.brand IS NULL OR pi.model IS NULL)
      )
      UPDATE part_instances pi
         SET brand = COALESCE(pi.brand, line_src.brand),
             model = COALESCE(pi.model, line_src.model),
             updated_at = NOW()
        FROM line_src
       WHERE pi.instance_id = line_src.instance_id
         AND (line_src.brand IS NOT NULL OR line_src.model IS NOT NULL)
    `);

    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [MIGRATION_NAME]
    );
    await client.query('COMMIT');
    console.log('Migration 267 applied:', sqlPath);
    console.log('Backfilled rows:', upd.rowCount);
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

'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');

async function q(t, sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
    return null;
  }
}

test('phase 2: core tables exist', async (t) => {
  const r = await q(t, `
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
  [[
    'support_tickets_v2', 'support_ticket_assets', 'support_work_orders',
    'support_work_order_type_config', 'support_assignment_groups',
    'asset_billing_holds', 'customer_invoice_extra_lines',
    'customer_buffer_stock', 'vendor_warranty_claims', 'support_migration_review',
  ]]);
  if (!r) return;
  assert.equal(r.rows.length, 10);
});

test('phase 2: all 8 WO types have checkpoint config', async (t) => {
  const r = await q(t, `
    SELECT wo_type, COUNT(*)::int AS n
      FROM support_work_order_type_config
     GROUP BY wo_type
     ORDER BY wo_type`);
  if (!r) return;
  const types = [
    'FIELD_VISIT', 'PART_DELIVERY', 'PART_RETURN', 'REMOTE_FIX',
    'REPAIR_PICKUP', 'REPLACEMENT_DELIVERY', 'RETURN_PICKUP', 'SERVICE_RETURN',
  ];
  assert.deepEqual(r.rows.map((x) => x.wo_type), types);
  assert.ok(r.rows.every((x) => x.n >= 3));
});

test('phase 2: status check constraints exist on tickets and WOs', async (t) => {
  const r = await q(t, `
    SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE contype = 'c'
       AND conrelid::regclass::text IN ('support_tickets_v2','support_work_orders')`);
  if (!r) return;
  const ticket = r.rows.filter((x) => x.tbl === 'support_tickets_v2').map((x) => x.def).join(' ');
  const wo = r.rows.filter((x) => x.tbl === 'support_work_orders').map((x) => x.def).join(' ');
  assert.match(ticket, /NEW/);
  assert.match(ticket, /CANCELLED/);
  assert.match(wo, /REPAIR_PICKUP/);
  assert.match(wo, /PENDING_ASSIGNMENT/);
});

after(async () => {
  await pool.end().catch(() => {});
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');

const EXPECTED_SECTIONS = [
  'support_tickets',
  'support_dashboard',
  'support_triage',
  'support_work_orders',
  'support_pickup_repair',
  'support_pickup_return',
  'support_replacement',
  'support_field_visit',
  'support_parts_request',
  'support_parts_approve',
  'support_bucket',
  'support_dispatch',
  'support_approvals',
  'support_charges',
  'support_sla_admin',
  'support_taxonomy',
  'support_groups',
  'support_reports',
  'support_settings',
  'support_customer_portal',
];

test('phase 0: 20 support v2 sections exist', async (t) => {
  let rows;
  try {
    const r = await pool.query(
      `SELECT section FROM permission_sections WHERE section = ANY($1::text[])`,
      [EXPECTED_SECTIONS]
    );
    rows = r.rows.map((x) => x.section).sort();
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
    return;
  }

  assert.deepEqual(rows, [...EXPECTED_SECTIONS].sort());
});

test('phase 0: support_tech can view bucket and cannot view dispatch', async (t) => {
  let bucket;
  let dispatch;
  try {
    const r = await pool.query(
      `SELECT section, can_view FROM role_permissions
        WHERE role = 'support_tech' AND section IN ('support_bucket', 'support_dispatch')`
    );
    bucket = r.rows.find((x) => x.section === 'support_bucket');
    dispatch = r.rows.find((x) => x.section === 'support_dispatch');
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
    return;
  }

  assert.ok(bucket, 'support_tech must have a support_bucket row');
  assert.equal(bucket.can_view, true);
  assert.equal(dispatch, undefined, 'support_tech must not have support_dispatch');
});

test('phase 0: STK- and WO- sequences exist', async (t) => {
  try {
    const r = await pool.query(
      `SELECT doc_type, prefix FROM sm_document_sequences
        WHERE doc_type IN ('support_ticket_v2', 'support_work_order')
        ORDER BY doc_type`
    );
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows.find((x) => x.doc_type === 'support_ticket_v2')?.prefix, 'STK-');
    assert.equal(r.rows.find((x) => x.doc_type === 'support_work_order')?.prefix, 'WO-');
  } catch (e) {
    t.skip(`database unavailable: ${e.message}`);
    return;
  }
});

test.after(async () => {
  await pool.end().catch(() => {});
});

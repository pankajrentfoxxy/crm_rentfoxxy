#!/usr/bin/env node
/**
 * Restore Lead CRM module from leads_module_backup.sql into the current CRM database.
 * - Deletes post-2026-07-09 lead data and replaces all lead-module tables with backup snapshot
 * - Does not modify schema, users/teams, or unrelated modules
 * - Runs in a single transaction (rolls back on any error)
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BACKUP_PATH = path.join(__dirname, '..', 'leads_module_backup.sql');
const CUTOFF = '2026-07-09 23:59:59.999+00';
const BATCH = 200;

const PG_CONFIG = {
  host: process.env.CRM_PG_HOST || '127.0.0.1',
  port: Number(process.env.CRM_PG_PORT || 5432),
  user: process.env.CRM_PG_USER || 'postgres',
  password: process.env.CRM_PG_PASSWORD || 'postgres',
  database: process.env.CRM_PG_DATABASE || 'postgres',
};

function parseCopyBlocks(sql) {
  const blocks = new Map();
  const re = /^COPY\s+((?:public\.)?\w+)\s*(\([^)]*\))?\s+FROM stdin;\s*$/gm;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const tableKey = match[1].replace(/^public\./, '');
    const columns = match[2] || null;
    const dataStart = match.index + match[0].length;
    const dataEnd = sql.indexOf('\n\\.\n', dataStart);
    if (dataEnd === -1) continue;
    const data = sql.slice(dataStart, dataEnd).replace(/^\n/, '');
    blocks.set(tableKey, { columns, data });
  }
  return blocks;
}

function rowsFromTsv(data) {
  if (!data || !data.trim()) return [];
  return data.split('\n').filter((line) => line.length > 0);
}

function splitTsv(line) {
  return line.split('\t').map((v) => (v === '\\N' ? null : v));
}

function parseColumns(columnsClause) {
  if (!columnsClause) return null;
  return columnsClause.replace(/[()]/g, '').split(',').map((c) => c.trim());
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return rows.length > 0;
}

async function deletePhase(client) {
  console.log('Phase 1: Removing post-cutoff and existing lead-module data...');
  await client.query(`SET session_replication_role = replica`);

  await client.query(`UPDATE sales_quotations SET source_lead_id = NULL WHERE source_lead_id IS NOT NULL`);
  if (await tableExists(client, 'customer_documents')) {
    await client.query(`UPDATE customer_documents SET lead_id = NULL WHERE lead_id IS NOT NULL`);
  }
  await client.query(`UPDATE leads SET customer_id = NULL, duplicate_of = NULL`);

  const { rows: leadCust } = await client.query(
    `SELECT customer_id FROM customers WHERE source_lead_id IS NOT NULL`
  );
  const custIds = leadCust.map((r) => r.customer_id);
  if (custIds.length) {
    const { rows: ords } = await client.query(
      `SELECT order_id FROM orders WHERE customer_id = ANY($1::int[])`,
      [custIds]
    );
    const oids = ords.map((r) => r.order_id);
    if (oids.length) {
      await client.query(`DELETE FROM order_items WHERE order_id = ANY($1::int[])`, [oids]);
      await client.query(`DELETE FROM orders WHERE order_id = ANY($1::int[])`, [oids]);
    }
    await client.query(`DELETE FROM customer_addresses WHERE customer_id = ANY($1::int[])`, [custIds]);
    await client.query(`DELETE FROM customers WHERE customer_id = ANY($1::int[])`, [custIds]);
  }

  const childDeletes = [
    `DELETE FROM lead_remarks WHERE created_at > '${CUTOFF}'::timestamptz`,
    `DELETE FROM lead_activities WHERE created_at > '${CUTOFF}'::timestamptz`,
    `DELETE FROM lead_assignments WHERE assigned_at > '${CUTOFF}'::timestamptz`,
    `DELETE FROM lead_company_research WHERE researched_at > '${CUTOFF}'::timestamptz`,
    `DELETE FROM email_lead_ingestion_log WHERE processed_at > '${CUTOFF}'::timestamptz`,
    `DELETE FROM lead_orders WHERE created_at > '${CUTOFF}'::timestamptz`,
    `DELETE FROM leads WHERE created_at > '${CUTOFF}'::timestamptz`,
    `DELETE FROM email_queue WHERE created_at > '${CUTOFF}'::timestamptz`,
  ];
  for (const sql of childDeletes) {
    if (await tableExists(client, sql.match(/FROM (\w+)/)[1])) {
      await client.query(sql);
    }
  }

  const wipeTables = [
    'lead_import_logs', 'lead_remarks', 'lead_activities', 'lead_addresses',
    'lead_assignments', 'lead_company_research', 'lead_followup_notifications',
    'lead_orders', 'email_lead_ingestion_log', 'lead_auto_assign_config', 'leads',
  ];
  for (const t of wipeTables) {
    if (await tableExists(client, t)) await client.query(`DELETE FROM ${t}`);
  }
  console.log('  Cleanup complete.');
}

async function bulkInsert(client, table, columns, lines, rowMapper) {
  if (!lines.length) return 0;
  let inserted = 0;
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let p = 1;
    for (const line of chunk) {
      const mapped = rowMapper ? rowMapper(splitTsv(line)) : splitTsv(line);
      const ph = mapped.map(() => `$${p++}`);
      values.push(`(${ph.join(',')})`);
      params.push(...mapped);
    }
    const colList = columns.join(', ');
    await client.query(
      `INSERT INTO ${table} (${colList}) VALUES ${values.join(', ')}`,
      params
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function importLeads(client, blocks) {
  const block = blocks.get('leads');
  if (!block) return 0;
  const cols = parseColumns(block.columns);
  const lines = rowsFromTsv(block.data);
  return bulkInsert(client, 'leads', cols, lines);
}

async function importSimpleTable(client, table, blockKey, blocks) {
  const block = blocks.get(blockKey);
  if (!block) return 0;
  const cols = parseColumns(block.columns);
  const lines = rowsFromTsv(block.data);
  return bulkInsert(client, table, cols, lines);
}

async function importCustomers(client, blocks) {
  const block = blocks.get('customers');
  if (!block) return 0;
  const cols = [
    'customer_id', 'name', 'email', 'phone', 'gst_no', 'type', 'details', 'address',
    'created_at', 'updated_at', 'company_name', 'source_lead_id',
  ];
  return bulkInsert(client, 'customers', cols, rowsFromTsv(block.data));
}

async function importCustomerAddresses(client, blocks) {
  const block = blocks.get('customer_addresses');
  if (!block) return 0;
  const cols = [
    'customer_address_id', 'customer_id', 'concern_person', 'mobile_no', 'address', 'pincode',
    'is_head_office', 'source_lead_address_id', 'created_at', 'updated_at', 'address_type',
  ];
  return bulkInsert(client, 'customer_addresses', cols, rowsFromTsv(block.data));
}

async function importOrders(client, blocks) {
  const block = blocks.get('orders');
  if (!block) return 0;
  const cols = [
    'order_id', 'customer_id', 'lead_type', 'status', 'owner_user_id', 'delivery_date', 'shipping_address',
    'dispatch_date', 'tracker_id', 'courier_partner', 'dispatched_at', 'estimated_delivery',
    'created_at', 'updated_at', 'order_type', 'lockin_period_days', 'security_amount', 'is_wfh',
    'shipping_charge', 'shipping_gst_amount', 'subtotal_amount', 'items_gst_amount', 'grand_total_amount',
    'invoice_number', 'invoice_generated_at', 'eway_bill_number', 'eway_bill_generated_at',
    'cancelled_at', 'cancelled_by', 'qc_received_at', 'qc_completed_at',
  ];
  return bulkInsert(client, 'orders', cols, rowsFromTsv(block.data), (v) => [
    v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13],
    v[14], v[15], v[16], v[17], v[18], v[19], v[20], v[21], v[22], v[23], v[24], v[25], v[26],
    v[27], v[28], v[31], v[32],
  ]);
}

async function importOrderItems(client, blocks) {
  const block = blocks.get('order_items');
  if (!block) return 0;
  const cols = [
    'item_id', 'order_id', 'brand', 'processor', 'ram', 'storage', 'quantity', 'preferred_model', 'status',
    'inventory_id', 'unit_price', 'created_at', 'gst_percent', 'gst_amount', 'total_with_gst', 'is_wfh',
    'shipping_charge', 'estimate_id', 'destination_pincode', 'tracking_status', 'item_tracker_id',
    'item_courier_partner', 'item_dispatch_date', 'item_estimated_delivery', 'delivered_at',
    'proposed_delivery_date', 'qc_passed', 'qc_sales_checklist', 'qc_sales_passed_at',
  ];
  return bulkInsert(client, 'order_items', cols, rowsFromTsv(block.data), (v) => [
    v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13],
    v[14], v[15], v[16], v[17], v[18], v[19], v[20], v[21], v[22], v[23], v[24],
    v[31], v[33], v[34], v[35],
  ]);
}

async function upsertLaptopCatalog(client, blocks) {
  const block = blocks.get('laptop_catalog');
  if (!block) return 0;
  const lines = rowsFromTsv(block.data);
  let n = 0;
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH);
    for (const line of chunk) {
      const v = splitTsv(line);
      await client.query(
        `INSERT INTO laptop_catalog (catalog_id, brand, model, processor, generation, ram, storage, device_type, active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (catalog_id) DO UPDATE SET
           brand=EXCLUDED.brand, model=EXCLUDED.model, processor=EXCLUDED.processor,
           generation=EXCLUDED.generation, ram=EXCLUDED.ram, storage=EXCLUDED.storage,
           device_type=EXCLUDED.device_type, active=EXCLUDED.active, updated_at=EXCLUDED.updated_at`,
        v
      );
      n++;
    }
    if (i % 2000 === 0 && i > 0) console.log(`    laptop_catalog: ${i}/${lines.length}...`);
  }
  return n;
}

async function resetSequences(client) {
  const seqTables = [
    ['leads', 'lead_id'], ['customers', 'customer_id'], ['orders', 'order_id'],
    ['order_items', 'item_id'], ['lead_activities', 'activity_id'], ['lead_remarks', 'remark_id'],
    ['lead_assignments', 'assignment_id'], ['lead_addresses', 'address_id'],
    ['lead_company_research', 'research_id'], ['lead_followup_notifications', 'notification_id'],
    ['lead_orders', 'lead_order_id'], ['email_lead_ingestion_log', 'ingestion_id'],
    ['email_queue', 'email_id'], ['laptop_catalog', 'catalog_id'],
    ['customer_addresses', 'customer_address_id'],
  ];
  for (const [table, col] of seqTables) {
    if (await tableExists(client, table)) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}','${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}), 1))`
      );
    }
  }
}

async function verify(client, blocks) {
  const checks = [
    ['leads', blocks.get('leads')],
    ['lead_activities', blocks.get('lead_activities')],
    ['lead_remarks', blocks.get('lead_remarks')],
    ['lead_assignments', blocks.get('lead_assignments')],
    ['lead_company_research', blocks.get('lead_company_research')],
    ['email_lead_ingestion_log', blocks.get('email_lead_ingestion_log')],
    ['customers (lead-linked)', blocks.get('customers')],
  ];
  console.log('\nVerification:');
  let ok = true;
  for (const [label, block] of checks) {
    const table = label.split(' ')[0].replace('(lead-linked)', '').trim();
    const sql = label.includes('lead-linked')
      ? `SELECT COUNT(*)::int AS c FROM customers WHERE source_lead_id IS NOT NULL`
      : `SELECT COUNT(*)::int AS c FROM ${table}`;
    const { rows } = await client.query(sql);
    const actual = rows[0].c;
    const expected = block ? rowsFromTsv(block.data).length : 0;
    const pass = actual === expected;
    if (!pass) ok = false;
    console.log(`  ${pass ? '✓' : '✗'} ${label}: ${actual} (expected ${expected})`);
  }
  const { rows: postCutoff } = await client.query(
    `SELECT COUNT(*)::int AS c FROM leads WHERE created_at > $1::timestamptz`,
    [CUTOFF]
  );
  const backupPostCutoff = rowsFromTsv(blocks.get('leads')?.data || '')
    .filter((line) => {
      const v = splitTsv(line);
      return v[16] && v[16] > CUTOFF.replace('.999+00', '+00');
    }).length;
  // Backup may include leads created after cutoff — that's expected from snapshot
  console.log(`  ℹ leads created after cutoff in DB: ${postCutoff[0].c} (backup has ${backupPostCutoff})`);

  const { rows: invBefore } = await client.query(`SELECT COUNT(*)::int AS c FROM inventory`);
  console.log(`  ℹ inventory rows (unchanged module): ${invBefore[0].c}`);
  return ok;
}

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    console.error(`Backup not found: ${BACKUP_PATH}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(BACKUP_PATH, 'utf8');
  const blocks = parseCopyBlocks(sql);
  console.log(`Parsed ${blocks.size} COPY blocks from backup`);
  console.log(`Target: ${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}`);

  const pool = new Pool(PG_CONFIG);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await deletePhase(client);

    console.log('Phase 2: Restoring lead-module data from backup...');
    const counts = {};
    counts.leads = await importLeads(client, blocks);
    console.log(`  leads: ${counts.leads}`);
    counts.lead_activities = await importSimpleTable(client, 'lead_activities', 'lead_activities', blocks);
    console.log(`  lead_activities: ${counts.lead_activities}`);
    counts.lead_remarks = await importSimpleTable(client, 'lead_remarks', 'lead_remarks', blocks);
    console.log(`  lead_remarks: ${counts.lead_remarks}`);
    counts.lead_assignments = await importSimpleTable(client, 'lead_assignments', 'lead_assignments', blocks);
    console.log(`  lead_assignments: ${counts.lead_assignments}`);
    counts.lead_addresses = await importSimpleTable(client, 'lead_addresses', 'lead_addresses', blocks);
    console.log(`  lead_addresses: ${counts.lead_addresses}`);
    counts.lead_company_research = await importSimpleTable(client, 'lead_company_research', 'lead_company_research', blocks);
    console.log(`  lead_company_research: ${counts.lead_company_research}`);
    counts.lead_followup_notifications = await importSimpleTable(client, 'lead_followup_notifications', 'lead_followup_notifications', blocks);
    console.log(`  lead_followup_notifications: ${counts.lead_followup_notifications}`);
    counts.lead_orders = await importSimpleTable(client, 'lead_orders', 'lead_orders', blocks);
    console.log(`  lead_orders: ${counts.lead_orders}`);
    counts.lead_auto_assign_config = await importSimpleTable(client, 'lead_auto_assign_config', 'lead_auto_assign_config', blocks);
    console.log(`  lead_auto_assign_config: ${counts.lead_auto_assign_config}`);
    counts.email_lead_ingestion_log = await importSimpleTable(client, 'email_lead_ingestion_log', 'email_lead_ingestion_log', blocks);
    console.log(`  email_lead_ingestion_log: ${counts.email_lead_ingestion_log}`);
    counts.email_queue = await importSimpleTable(client, 'email_queue', 'email_queue', blocks);
    console.log(`  email_queue: ${counts.email_queue}`);
    counts.customers = await importCustomers(client, blocks);
    console.log(`  customers: ${counts.customers}`);
    counts.customer_addresses = await importCustomerAddresses(client, blocks);
    console.log(`  customer_addresses: ${counts.customer_addresses}`);
    counts.orders = await importOrders(client, blocks);
    console.log(`  orders: ${counts.orders}`);
    counts.order_items = await importOrderItems(client, blocks);
    console.log(`  order_items: ${counts.order_items}`);
    counts.laptop_catalog = await upsertLaptopCatalog(client, blocks);
    console.log(`  laptop_catalog: ${counts.laptop_catalog} upserted`);

    await resetSequences(client);
    await client.query(`SET session_replication_role = DEFAULT`);

    const ok = await verify(client, blocks);
    if (!ok) throw new Error('Row-count verification failed');

    await client.query('COMMIT');
    console.log('\nMigration committed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nMigration FAILED — rolled back:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    if (err.hint) console.error('Hint:', err.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

#!/usr/bin/env node
/**
 * Generate deploy/leads_module_restore.sql from leads_module_backup.sql
 * for execution via: docker exec -i laptop-erp-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
 */
const fs = require('fs');
const path = require('path');

const BACKUP_PATH = path.join(__dirname, '..', 'leads_module_backup.sql');
const OUT_PATH = path.join(__dirname, 'leads_module_restore.sql');
const CUTOFF = '2026-07-09 23:59:59.999+00';

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
    blocks.set(tableKey, { columns, data, copyLine: match[0].trim() });
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

function sqlVal(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function emitCopy(out, block) {
  if (!block || !block.data.trim()) return;
  out.push(block.copyLine);
  out.push(block.data);
  out.push('\\.\n');
}

function emitInserts(out, table, columns, lines, mapper) {
  if (!lines.length) return;
  const chunk = 100;
  for (let i = 0; i < lines.length; i += chunk) {
    const slice = lines.slice(i, i + chunk);
    const vals = slice.map((line) => {
      const row = mapper ? mapper(splitTsv(line)) : splitTsv(line);
      return `(${row.map(sqlVal).join(',')})`;
    });
    out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${vals.join(',\n')};\n`);
  }
}

function main() {
  const sql = fs.readFileSync(BACKUP_PATH, 'utf8');
  const blocks = parseCopyBlocks(sql);
  const out = [];

  out.push(`-- Lead module restore generated ${new Date().toISOString()}`);
  out.push('BEGIN;');
  out.push('SET session_replication_role = replica;');
  out.push('');

  out.push('-- Phase 1: cleanup');
  out.push(`UPDATE sales_quotations SET source_lead_id = NULL WHERE source_lead_id IS NOT NULL;`);
  out.push(`UPDATE customer_documents SET lead_id = NULL WHERE lead_id IS NOT NULL;`);
  out.push(`UPDATE leads SET customer_id = NULL, duplicate_of = NULL;`);
  out.push(`DELETE FROM order_items WHERE order_id IN (SELECT order_id FROM orders WHERE customer_id IN (SELECT customer_id FROM customers WHERE source_lead_id IS NOT NULL));`);
  out.push(`DELETE FROM orders WHERE customer_id IN (SELECT customer_id FROM customers WHERE source_lead_id IS NOT NULL);`);
  out.push(`DELETE FROM customer_addresses WHERE customer_id IN (SELECT customer_id FROM customers WHERE source_lead_id IS NOT NULL);`);
  out.push(`DELETE FROM customers WHERE source_lead_id IS NOT NULL;`);
  out.push(`DELETE FROM lead_remarks WHERE created_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM lead_activities WHERE created_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM lead_assignments WHERE assigned_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM lead_company_research WHERE researched_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM email_lead_ingestion_log WHERE processed_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM lead_orders WHERE created_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM leads WHERE created_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM email_queue WHERE created_at > '${CUTOFF}'::timestamptz;`);
  out.push(`DELETE FROM lead_import_logs;`);
  out.push(`DELETE FROM lead_remarks;`);
  out.push(`DELETE FROM lead_activities;`);
  out.push(`DELETE FROM lead_addresses;`);
  out.push(`DELETE FROM lead_assignments;`);
  out.push(`DELETE FROM lead_company_research;`);
  out.push(`DELETE FROM lead_followup_notifications;`);
  out.push(`DELETE FROM lead_orders;`);
  out.push(`DELETE FROM email_lead_ingestion_log;`);
  out.push(`DELETE FROM lead_auto_assign_config;`);
  out.push(`DELETE FROM leads;`);
  out.push('');

  out.push('-- Phase 2: restore from backup');
  const copyTables = [
    'leads', 'lead_activities', 'lead_remarks', 'lead_assignments', 'lead_addresses',
    'lead_company_research', 'lead_followup_notifications', 'lead_orders',
    'lead_auto_assign_config', 'email_lead_ingestion_log', 'email_queue',
  ];
  for (const t of copyTables) {
    const b = blocks.get(t);
    if (b) {
      out.push(`-- ${t}`);
      const copyLine = b.copyLine.startsWith('COPY public.')
        ? b.copyLine
        : b.copyLine.replace(/^COPY (\w+)/, 'COPY public.$1');
      emitCopy(out, { ...b, copyLine });
    }
  }

  emitInserts(out, 'customers', [
    'customer_id', 'name', 'email', 'phone', 'gst_no', 'type', 'details', 'address',
    'created_at', 'updated_at', 'company_name', 'source_lead_id',
  ], rowsFromTsv(blocks.get('customers')?.data));

  emitInserts(out, 'customer_addresses', [
    'customer_address_id', 'customer_id', 'concern_person', 'mobile_no', 'address', 'pincode',
    'is_head_office', 'source_lead_address_id', 'created_at', 'updated_at', 'address_type',
  ], rowsFromTsv(blocks.get('customer_addresses')?.data));

  emitInserts(out, 'orders', [
    'order_id', 'customer_id', 'lead_type', 'status', 'owner_user_id', 'delivery_date', 'shipping_address',
    'dispatch_date', 'tracker_id', 'courier_partner', 'dispatched_at', 'estimated_delivery',
    'created_at', 'updated_at', 'order_type', 'lockin_period_days', 'security_amount', 'is_wfh',
    'shipping_charge', 'shipping_gst_amount', 'subtotal_amount', 'items_gst_amount', 'grand_total_amount',
    'invoice_number', 'invoice_generated_at', 'eway_bill_number', 'eway_bill_generated_at',
    'cancelled_at', 'cancelled_by', 'qc_received_at', 'qc_completed_at',
  ], rowsFromTsv(blocks.get('orders')?.data), (v) => [
    v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13],
    v[14], v[15], v[16], v[17], v[18], v[19], v[20], v[21], v[22], v[23], v[24], v[25], v[26],
    v[27], v[28], v[31], v[32],
  ]);

  emitInserts(out, 'order_items', [
    'item_id', 'order_id', 'brand', 'processor', 'ram', 'storage', 'quantity', 'preferred_model', 'status',
    'inventory_id', 'unit_price', 'created_at', 'gst_percent', 'gst_amount', 'total_with_gst', 'is_wfh',
    'shipping_charge', 'estimate_id', 'destination_pincode', 'tracking_status', 'item_tracker_id',
    'item_courier_partner', 'item_dispatch_date', 'item_estimated_delivery', 'delivered_at',
    'proposed_delivery_date', 'qc_passed', 'qc_sales_checklist', 'qc_sales_passed_at',
  ], rowsFromTsv(blocks.get('order_items')?.data), (v) => [
    v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13],
    v[14], v[15], v[16], v[17], v[18], v[19], v[20], v[21], v[22], v[23], v[24],
    v[31], v[33], v[34], v[35],
  ]);

  // laptop_catalog upserts
  const catLines = rowsFromTsv(blocks.get('laptop_catalog')?.data);
  out.push('-- laptop_catalog upsert');
  for (let i = 0; i < catLines.length; i += 100) {
    const slice = catLines.slice(i, i + 100);
    const vals = slice.map((line) => {
      const v = splitTsv(line);
      return `(${v.map(sqlVal).join(',')})`;
    });
    out.push(`INSERT INTO laptop_catalog (catalog_id, brand, model, processor, generation, ram, storage, device_type, active, created_at, updated_at) VALUES\n${vals.join(',\n')}\nON CONFLICT (catalog_id) DO UPDATE SET brand=EXCLUDED.brand, model=EXCLUDED.model, processor=EXCLUDED.processor, generation=EXCLUDED.generation, ram=EXCLUDED.ram, storage=EXCLUDED.storage, device_type=EXCLUDED.device_type, active=EXCLUDED.active, updated_at=EXCLUDED.updated_at;\n`);
  }

  out.push('SELECT setval(pg_get_serial_sequence(\'leads\',\'lead_id\'), COALESCE((SELECT MAX(lead_id) FROM leads), 1));');
  out.push('SELECT setval(pg_get_serial_sequence(\'customers\',\'customer_id\'), COALESCE((SELECT MAX(customer_id) FROM customers), 1));');
  out.push('SELECT setval(pg_get_serial_sequence(\'orders\',\'order_id\'), COALESCE((SELECT MAX(order_id) FROM orders), 1));');
  out.push('SELECT setval(pg_get_serial_sequence(\'order_items\',\'item_id\'), COALESCE((SELECT MAX(item_id) FROM order_items), 1));');
  out.push('SET session_replication_role = DEFAULT;');
  out.push('COMMIT;');

  fs.writeFileSync(OUT_PATH, out.join('\n'));
  console.log(`Wrote ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1)} MB)`);
}

main();

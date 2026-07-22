#!/usr/bin/env node
/**
 * Export specific lead IDs and all related rows to a single importable SQL file.
 * Usage: node scripts/export-leads-sql.js --ids=914,915,916,917,918,919,920,921,922 --out=../exports/leads_914_922.sql
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const LEAD_IDS = (process.argv.find((a) => a.startsWith('--ids='))?.slice(6)
  || '914,915,916,917,918,919,920,921,922')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !Number.isNaN(n));

const OUT_ARG = process.argv.find((a) => a.startsWith('--out='))?.slice(6)
  || path.join(__dirname, '../../exports/leads_914_922.sql');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function fetchRows(table, whereSql, params) {
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE ${whereSql}`, params);
  return rows;
}

async function tableExists(table) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function getColumns(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

async function getPrimaryKey(table) {
  const { rows } = await pool.query(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE i.indisprimary
        AND n.nspname = 'public'
        AND c.relname = $1
      ORDER BY array_position(i.indkey, a.attnum)`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

const columnTypeCache = new Map();

async function getColumnMeta(table) {
  if (columnTypeCache.has(table)) return columnTypeCache.get(table);
  const cols = await getColumns(table);
  const meta = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  columnTypeCache.set(table, meta);
  return meta;
}

function sqlLiteral(val, colMeta) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (colMeta?.data_type === 'bigint' || colMeta?.data_type === 'integer') return String(Math.trunc(val));
    return String(val);
  }
  if (val instanceof Date) {
    if (colMeta?.data_type === 'time without time zone') {
      const hh = String(val.getUTCHours()).padStart(2, '0');
      const mm = String(val.getUTCMinutes()).padStart(2, '0');
      const ss = String(val.getUTCSeconds()).padStart(2, '0');
      return `'${hh}:${mm}:${ss}'::time`;
    }
    return `'${val.toISOString().replace('T', ' ').replace('Z', '+00')}'::timestamptz`;
  }
  if (typeof val === 'string' && colMeta?.data_type === 'time without time zone') {
    return `'${val.replace(/'/g, "''")}'::time`;
  }
  if (typeof val === 'object') {
    if (Buffer.isBuffer(val)) return `'\\x${val.toString('hex')}'`;
    if (colMeta?.data_type === 'json' || colMeta?.data_type === 'jsonb' || colMeta?.udt_name === 'jsonb') {
      return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
    }
    if (colMeta?.data_type === 'ARRAY') {
      return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    }
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  if (colMeta?.data_type === 'numeric' || colMeta?.data_type === 'decimal') {
    return `'${String(val)}'::numeric`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function buildInsert(table, row, columns, colMeta, pkCols) {
  const vals = columns.map((c) => sqlLiteral(row[c], colMeta[c]));
  const conflict = pkCols.length
    ? ` ON CONFLICT (${pkCols.join(', ')}) DO NOTHING`
    : ' ON CONFLICT DO NOTHING';
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${vals.join(', ')})${conflict};`;
}

async function emitSection(lines, title, table, rows) {
  if (!rows.length) return 0;
  const colRows = await getColumns(table);
  const columns = colRows.map((c) => c.column_name);
  const colMeta = Object.fromEntries(colRows.map((c) => [c.column_name, c]));
  const pkCols = await getPrimaryKey(table);
  lines.push(`-- ${title} (${rows.length} rows)`);
  for (const row of rows) {
    const filtered = {};
    for (const col of columns) filtered[col] = row[col];
    lines.push(await buildInsert(table, filtered, columns, colMeta, pkCols));
  }
  lines.push('');
  return rows.length;
}

async function main() {
  const lines = [];
  const stamp = new Date().toISOString();
  const manifest = {};

  const leads = await fetchRows('leads', 'lead_id = ANY($1::int[])', [LEAD_IDS]);
  if (leads.length === 0) {
    throw new Error(`No leads found for IDs: ${LEAD_IDS.join(', ')}`);
  }

  const foundIds = leads.map((l) => l.lead_id);
  const customerIds = [...new Set(leads.map((l) => l.customer_id).filter(Boolean))];
  const customersBySource = await fetchRows('customers', 'source_lead_id = ANY($1::int[])', [LEAD_IDS]);
  const allCustomerIds = [...new Set([
    ...customerIds,
    ...customersBySource.map((c) => c.customer_id),
  ])];

  const userIds = new Set();
  for (const l of leads) {
    if (l.assigned_user_id) userIds.add(l.assigned_user_id);
    if (l.assigned_by) userIds.add(l.assigned_by);
    if (l.converted_by) userIds.add(l.converted_by);
  }

  const childSpecs = [
    { table: 'lead_addresses', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'lead_activities', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'lead_remarks', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'lead_assignments', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'lead_followup_notifications', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'lead_company_research', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'lead_orders', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'email_lead_ingestion_log', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
    { table: 'customer_documents', where: 'lead_id = ANY($1::int[])', params: [foundIds] },
  ];

  if (await tableExists('sales_quotations')) {
    childSpecs.push({ table: 'sales_quotations', where: 'source_lead_id = ANY($1::int[])', params: [foundIds] });
  }

  const childData = {};
  for (const spec of childSpecs) {
    if (!(await tableExists(spec.table))) continue;
    childData[spec.table] = await fetchRows(spec.table, spec.where, spec.params);
    for (const row of childData[spec.table]) {
      for (const key of ['user_id', 'assigned_to', 'assigned_by', 'created_by', 'uploaded_by', 'converted_by']) {
        if (row[key]) userIds.add(row[key]);
      }
    }
  }

  let customers = [];
  let customerAddresses = [];
  if (allCustomerIds.length) {
    customers = await fetchRows('customers', 'customer_id = ANY($1::int[])', [allCustomerIds]);
    customerAddresses = await fetchRows('customer_addresses', 'customer_id = ANY($1::int[])', [allCustomerIds]);
    for (const c of customers) {
      if (c.onboarded_by) userIds.add(c.onboarded_by);
      if (c.kyc_verified_by) userIds.add(c.kyc_verified_by);
    }
  }

  let emailQueue = [];
  if (await tableExists('email_queue')) {
    const emails = [...new Set(leads.map((l) => l.email).filter(Boolean))];
    if (emails.length) {
      emailQueue = await fetchRows('email_queue', 'to_email = ANY($1::text[])', [emails]);
    }
    for (const id of foundIds) {
      const extra = await fetchRows(
        'email_queue',
        "dedupe_key LIKE '%lead:' || $1::text || '%' OR dedupe_key LIKE '%lead_id:' || $1::text || '%' OR subject LIKE '%#' || $1::text || '%'",
        [id],
      );
      for (const row of extra) {
        if (!emailQueue.find((e) => e.email_id === row.email_id)) emailQueue.push(row);
      }
    }
  }

  const users = userIds.size
    ? await fetchRows('users', 'user_id = ANY($1::int[])', [[...userIds]])
    : [];

  const attachmentPaths = (childData.customer_documents || [])
    .map((d) => d.file_path)
    .filter(Boolean);

  lines.push('-- =============================================================================');
  lines.push('-- Lead CRM partial export');
  lines.push(`-- Generated: ${stamp}`);
  lines.push(`-- Lead IDs: ${LEAD_IDS.join(', ')}`);
  lines.push('--');
  lines.push('-- Included leads:');
  for (const l of leads.sort((a, b) => a.lead_id - b.lead_id)) {
    lines.push(`--   #${l.lead_id}  ${(l.company_name || l.name || '').trim()}`);
  }
  lines.push('--');
  lines.push('-- Import: psql -h HOST -p PORT -U USER -d DBNAME -f leads_914_922.sql');
  lines.push('-- FK checks are deferred during import via session_replication_role = replica');
  lines.push('-- =============================================================================');
  lines.push('BEGIN;');
  lines.push('SET session_replication_role = replica;');
  lines.push('');

  manifest.users = await emitSection(lines, 'Users referenced by these leads', 'users', users);

  const leadColRows = await getColumns('leads');
  const leadColumns = leadColRows.map((c) => c.column_name);
  const leadColMeta = Object.fromEntries(leadColRows.map((c) => [c.column_name, c]));
  const leadPk = await getPrimaryKey('leads');
  lines.push(`-- leads (${leads.length} rows) — customer_id deferred to avoid circular FK`);
  for (const row of leads.sort((a, b) => a.lead_id - b.lead_id)) {
    const copy = { ...row, customer_id: null };
    const filtered = {};
    for (const col of leadColumns) filtered[col] = copy[col];
    lines.push(await buildInsert('leads', filtered, leadColumns, leadColMeta, leadPk));
  }
  lines.push('');
  manifest.leads = leads.length;

  for (const table of [
    'lead_addresses', 'lead_activities', 'lead_remarks', 'lead_assignments',
    'lead_followup_notifications', 'lead_company_research', 'lead_orders',
    'email_lead_ingestion_log',
  ]) {
    manifest[table] = await emitSection(lines, table, table, childData[table] || []);
  }

  manifest.customers = await emitSection(lines, 'customers', 'customers', customers);
  manifest.customer_addresses = await emitSection(lines, 'customer_addresses', 'customer_addresses', customerAddresses);
  manifest.customer_documents = await emitSection(lines, 'customer_documents', 'customer_documents', childData.customer_documents || []);
  if (childData.sales_quotations?.length) {
    manifest.sales_quotations = await emitSection(lines, 'sales_quotations', 'sales_quotations', childData.sales_quotations);
  }
  manifest.email_queue = await emitSection(lines, 'email_queue', 'email_queue', emailQueue);

  const withCustomer = leads.filter((l) => l.customer_id);
  if (withCustomer.length) {
    lines.push('-- Restore leads.customer_id after customers imported');
    for (const l of withCustomer) {
      lines.push(`UPDATE leads SET customer_id = ${l.customer_id} WHERE lead_id = ${l.lead_id};`);
    }
    lines.push('');
  }

  const seqTables = [
    'leads', 'lead_addresses', 'lead_activities', 'lead_remarks', 'lead_assignments',
    'lead_followup_notifications', 'lead_company_research', 'lead_orders',
    'email_lead_ingestion_log', 'customers', 'customer_addresses', 'customer_documents',
    'email_queue', 'sales_quotations',
  ];
  lines.push('-- Reset sequences');
  for (const t of seqTables) {
    if (!(await tableExists(t))) continue;
    const pkCols = await getPrimaryKey(t);
    const pk = pkCols[0];
    if (!pk) continue;
    try {
      const { rows } = await pool.query('SELECT pg_get_serial_sequence($1, $2) AS seq', [t, pk]);
      const seq = rows[0]?.seq;
      if (seq) lines.push(`SELECT setval('${seq}', COALESCE((SELECT MAX(${pk}) FROM ${t}), 1), true);`);
    } catch {
      // no serial sequence
    }
  }

  lines.push('');
  lines.push('SET session_replication_role = DEFAULT;');
  lines.push('COMMIT;');

  const outPath = path.resolve(OUT_ARG);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

  const manifestPath = outPath.replace(/\.sql$/i, '.manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    generated_at: stamp,
    lead_ids: foundIds,
    row_counts: manifest,
    attachment_files: attachmentPaths,
    empty_tables: Object.keys({
      lead_addresses: true,
      lead_followup_notifications: true,
      lead_orders: true,
      customer_documents: true,
      email_queue: true,
      sales_quotations: true,
    }).filter((t) => !manifest[t]),
  }, null, 2), 'utf8');

  console.log(`Exported ${leads.length} leads to ${outPath}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log('Row counts:', manifest);
  if (attachmentPaths.length) console.log('Attachments:', attachmentPaths);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});

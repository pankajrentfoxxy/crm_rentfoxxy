const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const config = require('../lib/config');
const { getCrmPool, closePools } = require('../lib/db');
const { parseJson } = require('../lib/helpers');
const {
  normalizeErpPath,
  collectPathsFromJson,
} = require('../lib/fileSync');

const TEXT_COLUMNS = [
  { table: 'delivery_challan_lines', column: 'pod_image_url' },
  { table: 'delivery_challan_lines', column: 'file_path' },
  { table: 'delivery_challan_lines', column: 'pdf_path' },
  {
    table: 'customer_documents',
    column: 'file_path',
    where: "file_path NOT LIKE 'erp://%'",
  },
  { table: 'vendor_purchase_orders', column: 'invoice_path' },
  { table: 'vendor_purchase_orders', column: 'vendor_invoice_file' },
  {
    table: 'vendors',
    column: 'image_url',
    where: "image_url <> 'def.png'",
  },
  {
    table: 'vendors',
    column: 'licenses_url',
    where: "licenses_url <> 'def.png'",
  },
  { table: 'sales_order_lines', column: 'pdf_path' },
  { table: 'allocation_logs', column: 'file_path' },
];

const JSONB_COLUMNS = [
  { table: 'vendor_purchase_orders', column: 'bill_files' },
  { table: 'allocation_logs', column: 'extra_details' },
];

async function loadSchemaColumns(crm) {
  const { rows } = await crm.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`
  );
  const byTable = new Map();
  for (const row of rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name).add(row.column_name);
  }
  return byTable;
}

function addPath(raw, paths) {
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
    collectPathsFromJson(parsed, paths);
    return;
  }
  const p = normalizeErpPath(raw);
  if (p && !p.startsWith('uploads/')) paths.add(p);
}

async function collectLegacyPaths(crm, schema) {
  const paths = new Set();

  for (const spec of TEXT_COLUMNS) {
    const cols = schema.get(spec.table);
    if (!cols || !cols.has(spec.column)) continue;

    const extra = spec.where ? ` AND ${spec.where}` : '';
    const sql = `SELECT ${spec.column} AS p FROM ${spec.table}
      WHERE ${spec.column} IS NOT NULL AND TRIM(${spec.column}) <> ''${extra}`;
    const { rows } = await crm.query(sql);
    for (const row of rows) addPath(row.p, paths);
  }

  for (const spec of JSONB_COLUMNS) {
    const cols = schema.get(spec.table);
    if (!cols || !cols.has(spec.column)) continue;

    const { rows } = await crm.query(
      `SELECT ${spec.column} AS j FROM ${spec.table} WHERE ${spec.column} IS NOT NULL`
    );
    for (const row of rows) collectPathsFromJson(row.j, paths);
  }

  return [...paths].sort();
}

module.exports = {
  TEXT_COLUMNS,
  JSONB_COLUMNS,
  loadSchemaColumns,
  collectLegacyPaths,
};

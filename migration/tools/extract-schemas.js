#!/usr/bin/env node
/**
 * Parse erp_rentfoxxy_db.sql (MySQL) and crm_backup.sql (PostgreSQL)
 * into migration/_schema_extract.json for documentation generation.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ERP_SQL = path.join(ROOT, 'erp_rentfoxxy_db.sql');
const CRM_SQL = path.join(ROOT, 'crm_backup.sql');
const OUT = path.join(ROOT, 'migration', '_schema_extract.json');

function parseMySQLDump(file) {
  const sql = fs.readFileSync(file, 'utf8');
  const tables = {};
  const re = /CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\)\s*ENGINE/g;
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1];
    const body = m[2];
    const cols = [];
    const indexes = [];
    const fks = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('--')) continue;
      if (t.startsWith('PRIMARY KEY') || t.startsWith('UNIQUE KEY') || t.startsWith('KEY ')) {
        indexes.push(t.replace(/,$/, ''));
      } else if (t.startsWith('CONSTRAINT') || t.startsWith('FOREIGN KEY')) {
        fks.push(t.replace(/,$/, ''));
      } else if (t.startsWith('`')) {
        const cm = t.match(/^`([^`]+)`\s+([^,]+)/);
        if (cm) cols.push({ name: cm[1], def: cm[2].trim() });
      }
    }
    const softDelete = cols.some((c) => /deleted_at/i.test(c.name));
    tables[name] = { cols, indexes, fks, softDelete };
  }

  const insertCounts = {};
  const insRe = /INSERT INTO `([^`]+)`/g;
  let im;
  while ((im = insRe.exec(sql))) {
    insertCounts[im[1]] = (insertCounts[im[1]] || 0) + 1;
  }

  // Estimate row counts from INSERT value groups (rough)
  const rowEstimates = {};
  const insertBlockRe = /INSERT INTO `([^`]+)`[^;]+;/g;
  while ((m = insertBlockRe.exec(sql))) {
    const tbl = m[1];
    const block = m[0];
    const rows = (block.match(/\),\(/g) || []).length + 1;
    rowEstimates[tbl] = (rowEstimates[tbl] || 0) + rows;
  }

  return { tables, insertStatements: insertCounts, rowEstimates };
}

function parsePgDump(file) {
  const sql = fs.readFileSync(file, 'utf8');
  const tables = {};
  const re = /CREATE TABLE (public|auth)\.([a-z_0-9]+)\s*\(([\s\S]*?)\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const schema = m[1];
    const name = m[2];
    const body = m[3];
    const cols = [];
    const constraints = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('--')) continue;
      if (
        t.startsWith('CONSTRAINT') ||
        t.startsWith('PRIMARY KEY') ||
        t.startsWith('UNIQUE') ||
        t.startsWith('FOREIGN KEY') ||
        t.startsWith('CHECK')
      ) {
        constraints.push(t.replace(/,$/, ''));
      } else {
        const cm = t.match(/^([a-z_0-9]+)\s+(.+)/i);
        if (cm && !cm[1].startsWith('CONSTRAINT')) {
          cols.push({ name: cm[1], def: cm[2].replace(/,$/, '').trim() });
        }
      }
    }
    const softDelete = cols.some((c) => /deleted_at/i.test(c.name));
    const notNull = cols.filter((c) => /\bNOT NULL\b/i.test(c.def) && !/\bDEFAULT\b/i.test(c.def));
    tables[`${schema}.${name}`] = { schema, name, cols, constraints, softDelete, requiredCols: notNull.map((c) => c.name) };
  }

  const copyCounts = {};
  const copyRe = /COPY (public|auth)\.([a-z_0-9]+)[^\n]*\n([\s\S]*?)\n\\./g;
  while ((m = copyRe.exec(sql))) {
    const key = `${m[1]}.${m[2]}`;
    const lines = m[3].trim().split('\n').filter(Boolean);
    copyCounts[key] = lines.length;
  }

  return { tables, copyCounts };
}

function classifyErpTables(tables) {
  const masters = [];
  const transactions = [];
  const audit = [];
  const cms = [];
  const skip = [];

  const masterPatterns = /^(brands|categories|attributes|colors|issue_types|courier_details|currencies|delivery_men|admin_roles|new_modules|sellers|vendors|items|products|product_details|rent_devices|bundle_management|help_topics|business_settings|last_unique_number)$/i;
  const auditPatterns = /audit|history|log|wallet_hist/i;
  const cmsPatterns = /banner|blog|slider|deal|flash|coupon|cart|chat|contact|notification|oauth|cache|failed_jobs|jobs|password|phone_or_email|about_|help_topics/i;
  const txPatterns = /customer|inventory|purchase|delivery|quotation|order|complaint|ticket|grn|goods_received|inward|outward|qc|invoice|credit|billing|allocation|pod|rent_report|assigned_asset|npa|product_stock|refund|paytabs/i;

  for (const t of Object.keys(tables)) {
    if (cmsPatterns.test(t)) cms.push(t);
    else if (auditPatterns.test(t)) audit.push(t);
    else if (masterPatterns.test(t)) masters.push(t);
    else if (txPatterns.test(t)) transactions.push(t);
    else if (/backup|update|insert_|old_|data_table|migrations|personal_access|customers_update|customers_backup/i.test(t)) skip.push(t);
    else transactions.push(t);
  }
  return { masters, transactions, audit, cms, skip };
}

const erp = parseMySQLDump(ERP_SQL);
const crm = parsePgDump(CRM_SQL);
const erpClass = classifyErpTables(erp.tables);

const payload = {
  generatedAt: new Date().toISOString(),
  erp: {
    tableCount: Object.keys(erp.tables).length,
    tables: erp.tables,
    rowEstimates: erp.rowEstimates,
    classification: erpClass,
  },
  crm: {
    tableCount: Object.keys(crm.tables).length,
    publicTableCount: Object.values(crm.tables).filter((t) => t.schema === 'public').length,
    authTableCount: Object.values(crm.tables).filter((t) => t.schema === 'auth').length,
    tables: crm.tables,
    copyCounts: crm.copyCounts,
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`ERP: ${payload.erp.tableCount} tables`);
console.log(`CRM: ${payload.crm.tableCount} tables (${payload.crm.publicTableCount} public, ${payload.crm.authTableCount} auth)`);
console.log(`Written ${OUT}`);

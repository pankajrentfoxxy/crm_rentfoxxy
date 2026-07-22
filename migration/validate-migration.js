#!/usr/bin/env node
/**
 * Post-migration validation.
 *
 * Usage:
 *   node validate-migration.js              # full validation
 *   node validate-migration.js --baseline   # save pre-migration counts
 */
const fs = require('fs');
const path = require('path');
const { getErpPool, getCrmPool, closePools } = require('./lib/db');
const { writeLog } = require('./lib/logger');

const BASELINE = path.join(__dirname, 'migration-validation-baseline.json');
const REPORT_JSON = path.join(__dirname, 'migration-validation-report.json');
const REPORT_MD = path.join(__dirname, 'migration-validation-report.md');

const RBAC_BASELINE_CHECKS = [
  { entity: 'users', sql: 'SELECT COUNT(*) AS cnt FROM users' },
  { entity: 'roles', sql: 'SELECT COUNT(*) AS cnt FROM roles' },
  { entity: 'role_permissions', sql: 'SELECT COUNT(*) AS cnt FROM role_permissions' },
  { entity: 'user_permissions', sql: 'SELECT COUNT(*) AS cnt FROM user_permissions' },
  { entity: 'teams', sql: 'SELECT COUNT(*) AS cnt FROM teams' },
  { entity: 'user_teams', sql: 'SELECT COUNT(*) AS cnt FROM user_teams' },
  { entity: 'permission_sections', sql: 'SELECT COUNT(*) AS cnt FROM permission_sections' },
];

const ENTITY_CHECKS = [
  { entity: 'users', erp: 'SELECT COUNT(*) AS cnt FROM admins', crm: 'SELECT COUNT(*) AS cnt FROM users' },
  { entity: 'vendors', erp: 'SELECT COUNT(*) AS cnt FROM sellers', crm: 'SELECT COUNT(*) AS cnt FROM vendors' },
  { entity: 'customers', erp: 'SELECT COUNT(*) AS cnt FROM customers', crm: 'SELECT COUNT(*) AS cnt FROM customers' },
  { entity: 'inventory', erp: 'SELECT COUNT(*) AS cnt FROM inventory', crm: 'SELECT COUNT(*) AS cnt FROM inventory' },
  { entity: 'purchase_orders', erp: 'SELECT COUNT(*) AS cnt FROM purchase_orders', crm: 'SELECT COUNT(*) AS cnt FROM vendor_purchase_orders' },
  { entity: 'serial_numbers', erp: 'SELECT COUNT(*) AS cnt FROM serial_numbers', crm: 'SELECT COUNT(*) AS cnt FROM vendor_serial_numbers' },
  { entity: 'sales_orders', erp: 'SELECT COUNT(*) AS cnt FROM sales_orders', crm: 'SELECT COUNT(*) AS cnt FROM sales_order_lines' },
  { entity: 'delivery_challans', erp: 'SELECT COUNT(*) AS cnt FROM delivery_challans', crm: 'SELECT COUNT(*) AS cnt FROM delivery_challan_lines' },
  { entity: 'support_tickets', erp: 'SELECT COUNT(*) AS cnt FROM complaints_ticket', crm: 'SELECT COUNT(*) AS cnt FROM support_tickets' },
  { entity: 'allocation_logs', erp: 'SELECT COUNT(*) AS cnt FROM allocation_logs', crm: 'SELECT COUNT(*) AS cnt FROM allocation_logs' },
];

const FK_CHECKS = [
  {
    name: 'vendor_purchase_orders.vendor_id → vendors',
    sql: `SELECT COUNT(*) AS cnt FROM vendor_purchase_orders po
          LEFT JOIN vendors v ON v.vendor_id = po.vendor_id
          WHERE v.vendor_id IS NULL`,
  },
  {
    name: 'sales_order_lines.customer_id → customers',
    sql: `SELECT COUNT(*) AS cnt FROM sales_order_lines sol
          LEFT JOIN customers c ON c.customer_id = sol.customer_id
          WHERE sol.customer_id IS NOT NULL AND c.customer_id IS NULL`,
  },
  {
    name: 'vendor_serial_numbers missing serial',
    sql: `SELECT COUNT(*) AS cnt FROM vendor_serial_numbers WHERE serial_number IS NULL OR serial_number = ''`,
  },
  {
    name: 'customers missing name',
    sql: `SELECT COUNT(*) AS cnt FROM customers WHERE name IS NULL OR TRIM(name) = ''`,
  },
];

const ID_MAP_CHECKS = [
  {
    name: 'erp_id_map orphans (users)',
    sql: `SELECT COUNT(*) AS cnt FROM erp_id_map m
          LEFT JOIN users u ON u.user_id = m.crm_id
          WHERE m.entity = 'users' AND u.user_id IS NULL`,
  },
];

async function countQuery(pool, sql, isMysql) {
  if (isMysql) {
    const [rows] = await pool.query(sql);
    return Number(rows[0].cnt);
  }
  const { rows } = await pool.query(sql);
  return Number(rows[0].cnt);
}

async function main() {
  const baseline = process.argv.includes('--baseline');
  const erp = await getErpPool();
  const crm = getCrmPool();

  const report = {
    generatedAt: new Date().toISOString(),
    recordCounts: [],
    foreignKeys: [],
    idMap: [],
    duplicates: [],
    errors: [],
    passed: true,
  };

  try {
    report.rbacBaseline = [];
    for (const check of RBAC_BASELINE_CHECKS) {
      try {
        const crmCount = await countQuery(crm, check.sql, false);
        const entry = { entity: check.entity, crmCount, status: 'RECORDED' };
        if (baseline) {
          entry.status = 'BASELINE';
        } else if (report.baseline?.rbacBaseline) {
          const prev = report.baseline.rbacBaseline.find((r) => r.entity === check.entity);
          if (prev && crmCount < prev.crmCount) {
            entry.status = 'DECREASED';
            report.passed = false;
          } else {
            entry.status = 'OK';
          }
          entry.baselineCount = prev?.crmCount;
        }
        report.rbacBaseline.push(entry);
      } catch (err) {
        report.rbacBaseline.push({ entity: check.entity, error: err.message, status: 'ERROR' });
      }
    }

    for (const check of ENTITY_CHECKS) {
      try {
        const erpCount = await countQuery(erp, check.erp, true);
        const crmCount = await countQuery(crm, check.crm, false);
        const delta = crmCount - erpCount;
        const ok = crmCount >= erpCount;
        if (!ok) report.passed = false;
        report.recordCounts.push({
          entity: check.entity,
          erpCount,
          crmCount,
          delta,
          status: ok ? 'OK' : 'UNDER_MIGRATED',
        });
      } catch (err) {
        report.errors.push({ check: check.entity, error: err.message });
        report.passed = false;
      }
    }

    if (baseline) {
      fs.writeFileSync(BASELINE, JSON.stringify(report, null, 2));
      writeLog('migration', `Baseline saved to ${BASELINE}`);
      return;
    }

    for (const fk of FK_CHECKS) {
      try {
        const cnt = await countQuery(crm, fk.sql, false);
        const ok = cnt === 0;
        if (!ok) report.passed = false;
        report.foreignKeys.push({ name: fk.name, violations: cnt, status: ok ? 'OK' : 'FAIL' });
      } catch (err) {
        report.foreignKeys.push({ name: fk.name, error: err.message, status: 'ERROR' });
        report.passed = false;
      }
    }

    for (const im of ID_MAP_CHECKS) {
      try {
        const cnt = await countQuery(crm, im.sql, false);
        const ok = cnt === 0;
        if (!ok) report.passed = false;
        report.idMap.push({ name: im.name, violations: cnt, status: ok ? 'OK' : 'FAIL' });
      } catch (err) {
        report.idMap.push({ name: im.name, error: err.message, status: 'SKIP' });
      }
    }

    // Duplicate serial check
    try {
      const dupSql = `SELECT COUNT(*) AS cnt FROM (
        SELECT serial_number FROM vendor_serial_numbers
        GROUP BY serial_number HAVING COUNT(*) > 1
      ) d`;
      const dupCnt = await countQuery(crm, dupSql, false);
      report.duplicates.push({ name: 'vendor_serial_numbers.serial_number', duplicateGroups: dupCnt, status: dupCnt === 0 ? 'OK' : 'FAIL' });
      if (dupCnt > 0) report.passed = false;
    } catch (err) {
      report.duplicates.push({ error: err.message });
    }

    if (fs.existsSync(BASELINE)) {
      report.baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    }

    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

    let md = `# Migration Validation Report\n\n`;
    md += `> Generated: ${report.generatedAt}\n\n`;
    md += `**Overall:** ${report.passed ? 'PASSED' : 'FAILED'}\n\n`;
    md += `## Record Counts\n\n| Entity | ERP | CRM | Delta | Status |\n| --- | --- | --- | --- | --- |\n`;
    for (const r of report.recordCounts) {
      md += `| ${r.entity} | ${r.erpCount} | ${r.crmCount} | ${r.delta} | ${r.status} |\n`;
    }
    md += `\n## Foreign Key Integrity\n\n| Check | Violations | Status |\n| --- | --- | --- |\n`;
    for (const f of report.foreignKeys) {
      md += `| ${f.name} | ${f.violations ?? f.error ?? '—'} | ${f.status} |\n`;
    }
    md += `\n## RBAC / Auth Baseline\n\n| Entity | CRM Count | Baseline | Status |\n| --- | --- | --- | --- |\n`;
    for (const r of report.rbacBaseline || []) {
      md += `| ${r.entity} | ${r.crmCount ?? '—'} | ${r.baselineCount ?? '—'} | ${r.status} |\n`;
    }

    writeLog('migration', `Validation report: ${REPORT_MD}`);
    writeLog('migration', `Overall: ${report.passed ? 'PASSED' : 'FAILED'}`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await closePools();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

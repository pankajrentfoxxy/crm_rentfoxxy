/**
 * Read ERP table rows from mysqldump (no live MySQL required).
 * Used when ERP_SQL_DUMP_PATH is set in migration/.env
 */
const fs = require('fs');
const path = require('path');

function unquoteSqlValue(v) {
  const t = v.trim();
  if (t === 'NULL') return null;
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function splitSqlTuple(inner) {
  const fields = [];
  let cur = '';
  let inString = false;
  let escape = false;
  let depth = 0;

  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (escape) {
      cur += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escape = true;
        cur += c;
        continue;
      }
      if (c === "'") {
        if (inner[i + 1] === "'") {
          cur += "''";
          i += 1;
          continue;
        }
        inString = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === '(') {
      depth += 1;
      cur += c;
      continue;
    }
    if (c === ')') {
      depth -= 1;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      fields.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) fields.push(cur.trim());
  return fields.map(unquoteSqlValue);
}

function extractSqlRows(valuesSection) {
  const rows = [];
  let i = 0;
  while (i < valuesSection.length) {
    while (i < valuesSection.length && valuesSection[i] !== '(') i += 1;
    if (i >= valuesSection.length) break;
    i += 1;
    let depth = 1;
    const start = i;
    let inString = false;
    let escape = false;
    while (i < valuesSection.length && depth > 0) {
      const c = valuesSection[i];
      if (escape) {
        escape = false;
        i += 1;
        continue;
      }
      if (inString) {
        if (c === '\\') escape = true;
        else if (c === "'") {
          if (valuesSection[i + 1] === "'") i += 1;
          else inString = false;
        }
        i += 1;
        continue;
      }
      if (c === "'") {
        inString = true;
        i += 1;
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    rows.push(valuesSection.slice(start, i - 1));
    while (i < valuesSection.length && (valuesSection[i] === ',' || valuesSection[i] === '\n' || valuesSection[i] === '\r')) {
      i += 1;
    }
  }
  return rows;
}

function parseInsertBlocks(sql, tableName) {
  const re = new RegExp(`INSERT INTO \`${tableName}\`\\s*\\(([^)]+)\\)\\s*VALUES`, 'gi');
  const columnsByBlock = [];
  const blocks = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    const cols = m[1].split(',').map((c) => c.trim().replace(/`/g, ''));
    columnsByBlock.push(cols);
    const start = m.index + m[0].length;
    const end = sql.indexOf(';', start);
    blocks.push(sql.slice(start, end));
  }
  return { columnsByBlock, blocks };
}

function loadTableFromDump(sql, tableName) {
  const { columnsByBlock, blocks } = parseInsertBlocks(sql, tableName);
  const out = [];
  blocks.forEach((section, bi) => {
    const cols = columnsByBlock[bi];
    for (const inner of extractSqlRows(section)) {
      const vals = splitSqlTuple(inner);
      const row = {};
      cols.forEach((col, idx) => {
        row[col] = vals[idx] ?? null;
      });
      out.push(row);
    }
  });
  return out;
}

class ErpSqlDumpSource {
  constructor(filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    if (!fs.existsSync(abs)) throw new Error(`ERP SQL dump not found: ${abs}`);
    this.filePath = abs;
    this._sql = null;
    this._cache = new Map();
  }

  _loadSql() {
    if (!this._sql) this._sql = fs.readFileSync(this.filePath, 'utf8');
    return this._sql;
  }

  getTableRows(tableName) {
    if (!this._cache.has(tableName)) {
      this._cache.set(tableName, loadTableFromDump(this._loadSql(), tableName));
    }
    return this._cache.get(tableName);
  }

  /** Minimal mysql2-compatible query for migration scripts. */
  async query(sql, params = []) {
    const raw = String(sql);
    const normalized = raw.replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

    const tableFrom = (s) => {
      const m = s.match(/from ([a-z0-9_]+)/i);
      return m ? m[1] : null;
    };

    const filterRows = (rows, s) => {
      let out = rows;
      const fullRow = s.includes('customer_id') || s.includes('vendor_id') || s.includes('select *');
      if (s.includes("status = 'pending'")) {
        out = out.filter((r) => String(r.status || '').toLowerCase() === 'pending');
      } else if (s.includes("status = 'passed'")) {
        out = out.filter((r) => String(r.status || '').toLowerCase() === 'passed');
      } else if (s.includes("status <> 'passed'") || s.includes("status != 'passed'")) {
        out = out.filter((r) => String(r.status || '').toLowerCase() !== 'passed');
      } else if (s.includes("status2 = 'replace'") || s.includes("status = 'replace'")) {
        out = out.filter((r) => r.status2 === 'replace' || r.status === 'replace');
      }
      if (s.includes('where id =')) {
        const id = params[0] ?? params[0];
        out = out.filter((r) => String(r.id) === String(id));
      }
      if (s.includes('distinct dc_number') && s.includes("status = 'pending'")) {
        out = out.filter((r) => String(r.status || '').toLowerCase() === 'pending');
        const seen = new Set();
        return out.filter((r) => {
          if (!r.dc_number || seen.has(r.dc_number)) return false;
          seen.add(r.dc_number);
          return true;
        }).map((r) => ({ dc_number: r.dc_number }));
      }
      if (s.includes('distinct dc_number') && s.includes("status = 'delivered'")) {
        out = out.filter((r) => String(r.status || '').toLowerCase() === 'delivered');
        const seen = new Set();
        return out.filter((r) => {
          if (!r.dc_number || seen.has(r.dc_number)) return false;
          seen.add(r.dc_number);
          return true;
        }).map((r) => ({ dc_number: r.dc_number }));
      }
      if (s.includes('distinct sales_order_number')) {
        const seen = new Set();
        return out
          .filter((r) => r.sales_order_number && String(r.sales_order_number).trim())
          .filter((r) => {
            if (seen.has(r.sales_order_number)) return false;
            seen.add(r.sales_order_number);
            return true;
          })
          .map((r) => ({ sales_order_number: r.sales_order_number }));
      }
      if (s.includes('select id from') && !s.includes('where') && !s.includes('customer_id')) {
        return out.map((r) => ({ id: r.id }));
      }
      if (/select id,\s*sales_order_number from/.test(s) && !s.includes('customer_id')) {
        return out.map((r) => ({ id: r.id, sales_order_number: r.sales_order_number }));
      }
      if (s.includes('where id =') && s.includes('vendor_id')) {
        return out.map((r) => ({
          id: r.id,
          vendor_id: r.vendor_id,
          purchase_order_number: r.purchase_order_number,
        }));
      }
      if (s.includes('where id =') && s.includes('customer_id') && s.includes('sales_order_number')) {
        return out.map((r) => ({
          id: r.id,
          customer_id: r.customer_id,
          sales_order_number: r.sales_order_number,
        }));
      }
      if (s.includes('where id =') && s.includes('dc_number')) {
        return out.map((r) => ({ id: r.id, customer_id: r.customer_id, dc_number: r.dc_number }));
      }
      if (!fullRow && s.includes('select id from') && !s.includes('where')) {
        return out.map((r) => ({ id: r.id }));
      }
      if (!fullRow && /select id,\s*sales_order_number from/.test(s)) {
        return out.map((r) => ({ id: r.id, sales_order_number: r.sales_order_number }));
      }
      return out;
    };

    if (normalized.includes('count(')) {
      const tbl = tableFrom(normalized);
      if (tbl && ['purchase_orders', 'sales_orders', 'delivery_challans', 'serial_numbers', 'complaints_ticket', 'pod_submissions'].includes(tbl)) {
        let rows = this.getTableRows(tbl);
        rows = filterRows(rows, normalized);
        const key = normalized.includes('count(distinct') ? 'c' : 'cnt';
        if (Array.isArray(rows) && rows[0]?.dc_number) {
          return [[{ [key]: rows.length }]];
        }
        if (Array.isArray(rows) && rows[0]?.sales_order_number && normalized.includes('distinct')) {
          return [[{ [key]: rows.length }]];
        }
        return [[{ cnt: rows.length, c: rows.length }]];
      }
      if (normalized.includes('serial_numbers')) {
        let rows = this.getTableRows('serial_numbers');
        rows = filterRows(rows, normalized);
        return [[{ cnt: rows.length, c: rows.length }]];
      }
      if (normalized.includes('spare_parts_po')) {
        return [[{ cnt: this.getTableRows('spare_parts_po').length }]];
      }
      if (normalized.includes('spare_parts') && !normalized.includes('spare_parts_po')) {
        return [[{ cnt: this.getTableRows('spare_parts').length }]];
      }
      if (normalized.includes('serial_number_parts')) {
        return [[{ cnt: this.getTableRows('serial_number_parts').length }]];
      }
      if (normalized.includes('goods_received_notes_parts')) {
        return [[{ cnt: this.getTableRows('goods_received_notes_parts').length }]];
      }
    }

    if (normalized.includes('from complaints_ticket') && normalized.includes('pod_submissions')) {
      const tickets = this.getTableRows('complaints_ticket');
      const pods = this.getTableRows('pod_submissions');
      const podByPickup = new Map();
      for (const p of pods) {
        if (p.pickup_id != null) podByPickup.set(Number(p.pickup_id), p);
      }
      const out = tickets
        .filter((ct) => String(ct.complaint_type || '').toLowerCase() === 'pickup')
        .filter((ct) => String(ct.status || '').toLowerCase() === 'close')
        .map((ct) => {
          const ps = podByPickup.get(Number(ct.id));
          return {
            id: ct.id,
            return_dc_number: ct.return_dc_number,
            serial_number: ct.serial_number,
            unique_number: ct.unique_number,
            pod_closed_at: ps?.pod_closed_at ?? null,
          };
        })
        .filter((r) => r.pod_closed_at);
      return [out];
    }

    if (normalized.includes('distinct dc_number') && normalized.includes('delivery_challans')) {
      let rows = this.getTableRows('delivery_challans');
      rows = filterRows(rows, normalized);
      if (normalized.includes('delivery_person_id is not null')) {
        rows = rows.filter((r) => r.delivery_person_id != null);
        rows = rows.filter((r) => {
          const rej = r.rejected_serial_numbers;
          const ret = r.returned_serial_numbers;
          const pic = r.pickuped_serial_numbers;
          const hasJson = (v) => {
            if (!v) return false;
            try {
              const p = typeof v === 'string' ? JSON.parse(v) : v;
              return Array.isArray(p) && p.length > 0;
            } catch { return false; }
          };
          return hasJson(rej) || hasJson(ret) || hasJson(pic) || String(r.status || '').toLowerCase() === 'pending';
        });
        const seen = new Set();
        const distinct = [];
        for (const r of rows) {
          if (r.dc_number && !seen.has(r.dc_number)) {
            seen.add(r.dc_number);
            distinct.push({ dc_number: r.dc_number });
          }
        }
        return [distinct];
      }
      return [rows];
    }

    const tbl = tableFrom(normalized);
    if (tbl && ['purchase_orders', 'sales_orders', 'delivery_challans', 'serial_numbers'].includes(tbl)) {
      let rows = this.getTableRows(tbl);
      rows = filterRows(rows, normalized);
      // Full-table migration SELECTs must retain all columns.
      if (normalized.includes('customer_id') || normalized.includes('select *')) {
        return [rows];
      }
      return [rows];
    }

    if (normalized.includes('from serial_numbers')) {
      return [filterRows(this.getTableRows('serial_numbers'), normalized)];
    }
    if (normalized.includes('from spare_parts_po')) {
      return [this.getTableRows('spare_parts_po')];
    }
    if (normalized.includes('from spare_parts') && !normalized.includes('spare_parts_po')) {
      return [this.getTableRows('spare_parts')];
    }
    if (normalized.includes('from serial_number_parts')) {
      return [this.getTableRows('serial_number_parts')];
    }
    if (normalized.includes('from goods_received_notes_parts')) {
      return [this.getTableRows('goods_received_notes_parts')];
    }
    if (normalized.includes('from brands')) {
      return [this.getTableRows('brands')];
    }

    throw new Error(`SqlDumpErpSource: unsupported query: ${sql.slice(0, 120)}…`);
  }

  async end() {
    this._cache.clear();
    this._sql = null;
  }
}

function resolveDumpPath() {
  const env = process.env.ERP_SQL_DUMP_PATH;
  if (env) return env;
  return path.join(__dirname, '..', '..', 'erp_rentfoxxy_db.sql');
}

module.exports = { ErpSqlDumpSource, loadTableFromDump, resolveDumpPath };

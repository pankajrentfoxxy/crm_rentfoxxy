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
  async query(sql) {
    const normalized = String(sql).replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes('count(')) {
      if (normalized.includes('serial_numbers')) {
        let rows = this.getTableRows('serial_numbers');
        if (normalized.includes("status = 'pending'")) {
          rows = rows.filter((r) => String(r.status || '').toLowerCase() === 'pending');
        } else if (normalized.includes("status <> 'passed'") || normalized.includes("status != 'passed'")) {
          rows = rows.filter((r) => String(r.status || '').toLowerCase() !== 'passed');
        } else if (normalized.includes("status2 = 'replace'") || normalized.includes("status = 'replace'")) {
          rows = rows.filter((r) => r.status2 === 'replace' || r.status === 'replace');
        }
        return [[{ cnt: rows.length }]];
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

    if (normalized.includes('from serial_numbers')) {
      return [this.getTableRows('serial_numbers')];
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

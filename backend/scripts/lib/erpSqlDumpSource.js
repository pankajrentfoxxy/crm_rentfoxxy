/**
 * Read ERP attribute-management data from a mysqldump .sql file (no live MySQL needed).
 */
const fs = require('fs');

const SALES_ORDER_COLS = [
  'id', 'sales_order_number', 'quotation_number', 'supply_state', 'customer_id',
  'customer_name', 'customer_email', 'customer_mobile', 'customer_shipping_address',
  'customer_billing_address', 'contact_person_name', 'contact_person_mobile', 'gst_number',
  'brand', 'model_name', 'processor', 'generation', 'ram', 'storage', 'gpu', 'screen_size',
];

function norm(s) {
  return String(s || '').trim();
}

function inferBrandFromModel(modelName, brandNames) {
  const m = norm(modelName).toLowerCase();
  if (!m) return null;
  const sorted = [...brandNames].sort((a, b) => b.length - a.length);
  for (const b of sorted) {
    const bn = norm(b).toLowerCase();
    if (bn && m.startsWith(bn)) return norm(b);
  }
  return null;
}

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
  return t;
}

/** Split one SQL VALUES tuple: (a, 'b', NULL, ...) */
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

/** Extract top-level (...) row bodies from INSERT VALUES section. */
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
    const inner = valuesSection.slice(start, i - 1);
    rows.push(inner);
    while (i < valuesSection.length && (valuesSection[i] === ',' || valuesSection[i] === '\n' || valuesSection[i] === '\r')) i += 1;
  }
  return rows;
}

function extractInsertBlock(sql, tableName) {
  const re = new RegExp(
    `INSERT INTO \`${tableName}\`[^;]+;`,
    'gs'
  );
  const blocks = sql.match(re) || [];
  const rows = [];
  for (const block of blocks) {
    const valuesIdx = block.toUpperCase().indexOf('VALUES');
    if (valuesIdx < 0) continue;
    const section = block.slice(valuesIdx + 6, block.lastIndexOf(';'));
    for (const inner of extractSqlRows(section)) {
      rows.push(splitSqlTuple(inner));
    }
  }
  return rows;
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw.map(norm).filter(Boolean);
  if (raw == null || raw === '') return [];
  let s = String(raw).trim();
  s = s.replace(/^\s*"\s*|\s*"\s*$/g, '');
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(norm).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} filePath absolute or relative path to erp_rentfoxxy_db.sql
 */
function loadFromSqlDump(filePath) {
  const abs = filePath;
  if (!fs.existsSync(abs)) {
    throw new Error(`SQL dump not found: ${abs}`);
  }
  const sql = fs.readFileSync(abs, 'utf8');

  const attrRows = extractInsertBlock(sql, 'attributes')
    .filter((fields) => String(fields[5] ?? fields[fields.length - 1]) === '1' || fields[5] === 1)
    .map((fields) => ({
      name: fields[1],
      attributes: fields[4],
    }));

  const brands = extractInsertBlock(sql, 'brands')
    .filter((fields) => String(fields[3]) === '1' || fields[3] === 1)
    .map((fields) => norm(fields[1]))
    .filter(Boolean);

  const brandModels = new Map();
  const procGens = new Map();

  const soRows = extractInsertBlock(sql, 'sales_orders');
  for (const fields of soRows) {
    const row = {};
    SALES_ORDER_COLS.forEach((col, idx) => {
      row[col] = fields[idx] ?? null;
    });
    let brand = norm(row.brand);
    const model = norm(row.model_name);
    const processor = norm(row.processor);
    const generation = norm(row.generation);
    if (!brand && model) brand = inferBrandFromModel(model, brands) || '';
    if (brand && model) {
      brandModels.set(`${brand.toLowerCase()}|${model.toLowerCase()}`, { brand, model });
    }
    if (processor && generation) {
      procGens.set(`${processor.toLowerCase()}|${generation.toLowerCase()}`, { processor, generation });
    }
  }

  return {
    attributes: attrRows,
    brands: [...new Set(brands)],
    brandModels: [...brandModels.values()],
    procGens: [...procGens.values()],
  };
}

module.exports = { loadFromSqlDump };

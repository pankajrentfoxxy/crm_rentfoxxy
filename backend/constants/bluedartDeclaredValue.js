/**
 * BlueDart declared-value matrix — DB-backed (bluedart_declared_value_matrix).
 * Lookup logic unchanged: match processor category + generation/Apple grade → amount.
 */
const pool = require('../config/db');

const FALLBACK_MATRIX = [
  { category: 'i5', grade: '5th', amount: 14000 },
  { category: 'i5', grade: '6th', amount: 16000 },
  { category: 'i5', grade: '7th', amount: 18000 },
  { category: 'i5', grade: '8th', amount: 20000 },
  { category: 'i5', grade: '10th', amount: 22000 },
  { category: 'i5', grade: '11th', amount: 25000 },
  { category: 'i5', grade: '12th', amount: 35000 },
  { category: 'i5', grade: '13th', amount: 40000 },
  { category: 'i5', grade: '14th', amount: 45000 },
  { category: 'i7', grade: '4th', amount: 14000 },
  { category: 'i7', grade: '5th', amount: 15000 },
  { category: 'i7', grade: '6th', amount: 18000 },
  { category: 'i7', grade: '7th', amount: 19000 },
  { category: 'i7', grade: '8th', amount: 22000 },
  { category: 'i7', grade: '10th', amount: 24000 },
  { category: 'i7', grade: '11th', amount: 28000 },
  { category: 'i7', grade: '12th', amount: 35000 },
  { category: 'i7', grade: '13th', amount: 40000 },
  { category: 'i7', grade: '14th', amount: 45000 },
  { category: 'i7', grade: 'u7', amount: 50000 },
  { category: 'R7', grade: 'ALL', amount: 60000 },
  { category: 'APPLE', grade: 'm1-air', amount: 60000 },
  { category: 'APPLE', grade: 'm1-pro', amount: 70000 },
  { category: 'APPLE', grade: 'm2-pro', amount: 80000 },
  { category: 'APPLE', grade: 'm3', amount: 100000 },
  { category: 'APPLE', grade: 'm4', amount: 190000 },
  { category: 'APPLE', grade: 'm5', amount: 230000 },
];

let cache = { at: 0, rows: null };
const CACHE_TTL_MS = 60_000;

function normalizeCategory(processor) {
  const raw = String(processor || '').trim();
  if (!raw) return null;
  const p = raw.toLowerCase().replace(/\s+/g, '');

  if (/\bm\s*[1-5]\b/i.test(raw) || /\bm[1-5]\b/i.test(raw) || /apple\s*m[1-5]/i.test(raw)) {
    return 'APPLE';
  }
  if (/\br7\b|ryzen7|ryzen.?7|amd.?r7/.test(raw.toLowerCase()) || p.includes('ryzen7') || /(^|[^a-z])r7([^a-z]|$)/i.test(raw)) {
    return 'R7';
  }
  if (/\bi7\b|core.?i7|intel.?i7/.test(raw.toLowerCase()) || p.includes('i7')) {
    return 'i7';
  }
  if (/\bi5\b|core.?i5|intel.?i5/.test(raw.toLowerCase()) || p.includes('i5')) {
    return 'i5';
  }
  return null;
}

function normalizeGrade(generation) {
  const raw = String(generation || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^u7$|ultra\s*7|u-?series\s*7/.test(raw) || raw === 'u7') return 'u7';
  const m = raw.match(/(\d{1,2})\s*(st|nd|rd|th)?/i);
  if (m) {
    return `${m[1]}th`;
  }
  return raw;
}

function resolveAppleGrade(processor, generation, model) {
  const hay = `${processor || ''} ${generation || ''} ${model || ''}`.toLowerCase();
  if (!hay.trim()) return null;

  const chip = hay.match(/\bm\s*([1-5])\b/) || hay.match(/\bm([1-5])(?:\s|$|pro|max|air)/);
  if (!chip) return null;
  const n = chip[1];

  if (n === '1') {
    if (/\bpro\b|\bmax\b/.test(hay)) return 'm1-pro';
    if (/\bair\b/.test(hay)) return 'm1-air';
    return 'm1-air';
  }
  if (n === '2') return 'm2-pro';
  if (n === '3') return 'm3';
  if (n === '4') return 'm4';
  if (n === '5') return 'm5';
  return null;
}

function mapRow(r) {
  return {
    id: r.id,
    category: r.category,
    grade: r.grade,
    amount: Number(r.amount),
    label: r.label || `${r.category} · ${r.grade}`,
    sort_order: r.sort_order,
    active: r.active !== false,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function invalidateDeclaredValueCache() {
  cache = { at: 0, rows: null };
}

async function loadActiveMatrix({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.rows && now - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, category, grade, amount, label, sort_order, active, created_at, updated_at
         FROM bluedart_declared_value_matrix
        WHERE active = TRUE
        ORDER BY sort_order ASC, category ASC, grade ASC`
    );
    const mapped = rows.map(mapRow);
    cache = { at: now, rows: mapped.length ? mapped : FALLBACK_MATRIX.map((r, i) => ({ ...r, id: null, label: `${r.category} · ${r.grade}`, sort_order: i, active: true })) };
    return cache.rows;
  } catch (e) {
    console.warn('bluedartDeclaredValue: DB load failed, using fallback', e.message);
    cache = { at: now, rows: FALLBACK_MATRIX.map((r, i) => ({ ...r, id: null, label: `${r.category} · ${r.grade}`, sort_order: i, active: true })) };
    return cache.rows;
  }
}

function lookupInMatrix(matrix, processor, generation, model) {
  const rows = Array.isArray(matrix) ? matrix : [];
  const appleGrade = resolveAppleGrade(processor, generation, model);
  if (appleGrade) {
    const row = rows.find((r) => r.category === 'APPLE' && String(r.grade).toLowerCase() === appleGrade);
    return row ? Number(row.amount) : null;
  }

  const category = normalizeCategory(processor);
  if (!category) return null;

  if (category === 'APPLE') {
    const grade = resolveAppleGrade(processor, generation, model) || 'm1-air';
    const row = rows.find((r) => r.category === 'APPLE' && String(r.grade).toLowerCase() === grade);
    return row ? Number(row.amount) : null;
  }

  if (category === 'R7') {
    const row = rows.find((r) => r.category === 'R7');
    return row ? Number(row.amount) : 60000;
  }

  const grade = normalizeGrade(generation);
  if (!grade) return null;

  const row = rows.find(
    (r) => String(r.category).toLowerCase() === category.toLowerCase()
      && String(r.grade).toLowerCase() === grade.toLowerCase()
  );
  return row ? Number(row.amount) : null;
}

async function lookupDeclaredValueForUnit(processor, generation, model) {
  const matrix = await loadActiveMatrix();
  return lookupInMatrix(matrix, processor, generation, model);
}

async function sumDeclaredValueForUnits(units = []) {
  const matrix = await loadActiveMatrix();
  let total = 0;
  let matched = 0;
  for (const u of units) {
    const amount = lookupInMatrix(matrix, u?.processor, u?.generation, u?.model || u?.model_name);
    if (amount != null) {
      total += amount;
      matched += 1;
    }
  }
  if (!matched) return null;
  return total;
}

async function listDeclaredValueRows({ includeInactive = true } = {}) {
  const { rows } = await pool.query(
    `SELECT id, category, grade, amount, label, sort_order, active, created_at, updated_at
       FROM bluedart_declared_value_matrix
      ${includeInactive ? '' : 'WHERE active = TRUE'}
      ORDER BY sort_order ASC, category ASC, grade ASC`
  );
  return rows.map(mapRow);
}

async function createDeclaredValueRow({ category, grade, amount, label, sort_order, active = true }) {
  const cat = String(category || '').trim();
  const gr = String(grade || '').trim();
  const amt = Number(amount);
  if (!cat || !gr) {
    const err = new Error('category and grade are required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(amt) || amt <= 0) {
    const err = new Error('amount must be a positive number');
    err.status = 400;
    throw err;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO bluedart_declared_value_matrix (category, grade, amount, label, sort_order, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, category, grade, amount, label, sort_order, active, created_at, updated_at`,
      [
        cat,
        gr,
        amt,
        label != null && String(label).trim() ? String(label).trim() : `${cat} · ${gr}`,
        Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0,
        active !== false,
      ]
    );
    invalidateDeclaredValueCache();
    return mapRow(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('A row with this category and grade already exists');
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

async function updateDeclaredValueRow(id, patch = {}) {
  const rowId = parseInt(id, 10);
  if (!Number.isInteger(rowId)) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }
  const fields = [];
  const params = [];
  const set = (col, val) => {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  };
  if (patch.category != null) set('category', String(patch.category).trim());
  if (patch.grade != null) set('grade', String(patch.grade).trim());
  if (patch.amount != null) {
    const amt = Number(patch.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      const err = new Error('amount must be a positive number');
      err.status = 400;
      throw err;
    }
    set('amount', amt);
  }
  if (patch.label != null) set('label', String(patch.label).trim() || null);
  if (patch.sort_order != null) set('sort_order', Number(patch.sort_order) || 0);
  if (patch.active != null) set('active', patch.active !== false && patch.active !== 'false');
  if (!fields.length) {
    const err = new Error('No fields to update');
    err.status = 400;
    throw err;
  }
  fields.push('updated_at = NOW()');
  params.push(rowId);
  const { rows } = await pool.query(
    `UPDATE bluedart_declared_value_matrix
        SET ${fields.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, category, grade, amount, label, sort_order, active, created_at, updated_at`,
    params
  );
  if (!rows.length) {
    const err = new Error('Row not found');
    err.status = 404;
    throw err;
  }
  invalidateDeclaredValueCache();
  return mapRow(rows[0]);
}

async function deleteDeclaredValueRow(id) {
  const rowId = parseInt(id, 10);
  const { rowCount } = await pool.query(
    `DELETE FROM bluedart_declared_value_matrix WHERE id = $1`,
    [rowId]
  );
  if (!rowCount) {
    const err = new Error('Row not found');
    err.status = 404;
    throw err;
  }
  invalidateDeclaredValueCache();
  return true;
}

module.exports = {
  FALLBACK_MATRIX,
  BLUEDART_DECLARED_VALUE_MATRIX: FALLBACK_MATRIX, // legacy alias
  normalizeCategory,
  normalizeGrade,
  resolveAppleGrade,
  lookupInMatrix,
  loadActiveMatrix,
  invalidateDeclaredValueCache,
  lookupDeclaredValueForUnit,
  sumDeclaredValueForUnits,
  listDeclaredValueRows,
  createDeclaredValueRow,
  updateDeclaredValueRow,
  deleteDeclaredValueRow,
};

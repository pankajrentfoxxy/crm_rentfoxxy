/**
 * BlueDart declared-value matrix — loaded from API (not hardcoded amounts).
 * Lookup logic: processor category + generation / Apple grade → amount.
 */
import api from '../../utils/api';

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

/** @deprecated use getDeclaredValueMatrix() — kept for rare direct imports */
export let BLUEDART_DECLARED_VALUE_MATRIX = FALLBACK_MATRIX.slice();

let cache = { at: 0, rows: FALLBACK_MATRIX.slice(), loaded: false };
let inflight = null;
const CACHE_TTL_MS = 60_000;

export function invalidateDeclaredValueMatrixCache() {
  cache = { at: 0, rows: FALLBACK_MATRIX.slice(), loaded: false };
  BLUEDART_DECLARED_VALUE_MATRIX = cache.rows;
  inflight = null;
}

export function getDeclaredValueMatrix() {
  return cache.rows;
}

/** Fetch active matrix from API; sync lookups use the cached result. */
export async function ensureDeclaredValueMatrixLoaded({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.loaded && now - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await api.get('/asset-configuration/bluedart-declared-values/active', {
        params: force ? { refresh: '1' } : undefined,
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length) {
        cache = {
          at: Date.now(),
          rows: items.map((r) => ({
            category: r.category,
            grade: r.grade,
            amount: Number(r.amount),
            label: r.label,
          })),
          loaded: true,
        };
        BLUEDART_DECLARED_VALUE_MATRIX = cache.rows;
      } else {
        cache = { at: Date.now(), rows: FALLBACK_MATRIX.slice(), loaded: true };
        BLUEDART_DECLARED_VALUE_MATRIX = cache.rows;
      }
      return cache.rows;
    } catch {
      cache = { at: Date.now(), rows: FALLBACK_MATRIX.slice(), loaded: true };
      BLUEDART_DECLARED_VALUE_MATRIX = cache.rows;
      return cache.rows;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function normalizeCategory(processor) {
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

export function normalizeGrade(generation) {
  const raw = String(generation || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^u7$|ultra\s*7|u-?series\s*7/.test(raw) || raw === 'u7') return 'u7';
  const m = raw.match(/(\d{1,2})\s*(st|nd|rd|th)?/i);
  if (m) {
    return `${m[1]}th`;
  }
  return raw;
}

/** M1 Air · M1 Pro · M2 Pro · M3 · M4 · M5 */
export function resolveAppleGrade(processor, generation, model) {
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

/** Amount for one laptop, or null if no matrix match. Uses cached matrix. */
export function lookupDeclaredValueForUnit(processor, generation, model) {
  return lookupInMatrix(cache.rows, processor, generation, model);
}

/**
 * Sum declared values for units ({ processor, generation, model / model_name }).
 * Returns null if nothing matched.
 */
export function sumDeclaredValueForUnits(units = []) {
  let total = 0;
  let matched = 0;
  for (const u of units) {
    const amount = lookupDeclaredValueForUnit(
      u?.processor,
      u?.generation,
      u?.model || u?.model_name
    );
    if (amount != null) {
      total += amount;
      matched += 1;
    }
  }
  if (!matched) return null;
  return total;
}

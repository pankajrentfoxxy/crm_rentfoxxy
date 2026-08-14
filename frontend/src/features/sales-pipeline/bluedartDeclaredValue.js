/**
 * BlueDart declared-value matrix by processor category + generation (grade).
 * Autofills GenerateWayBill Declared Value (₹) from laptop config.
 */

export const BLUEDART_DECLARED_VALUE_MATRIX = [
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

  // Apple Silicon MacBook
  { category: 'APPLE', grade: 'm1-air', amount: 60000 },
  { category: 'APPLE', grade: 'm1-pro', amount: 70000 },
  { category: 'APPLE', grade: 'm2-pro', amount: 80000 },
  { category: 'APPLE', grade: 'm3', amount: 100000 },
  { category: 'APPLE', grade: 'm4', amount: 190000 },
  { category: 'APPLE', grade: 'm5', amount: 230000 },
];

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

/** M1 Air 60k · M1 Pro 70k · M2 Pro 80k · M3 100k · M4 190k · M5 230k */
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

/** Amount for one laptop, or null if no matrix match. */
export function lookupDeclaredValueForUnit(processor, generation, model) {
  const appleGrade = resolveAppleGrade(processor, generation, model);
  if (appleGrade) {
    const row = BLUEDART_DECLARED_VALUE_MATRIX.find(
      (r) => r.category === 'APPLE' && r.grade === appleGrade
    );
    return row ? row.amount : null;
  }

  const category = normalizeCategory(processor);
  if (!category) return null;

  if (category === 'APPLE') {
    const grade = resolveAppleGrade(processor, generation, model) || 'm1-air';
    const row = BLUEDART_DECLARED_VALUE_MATRIX.find(
      (r) => r.category === 'APPLE' && r.grade === grade
    );
    return row ? row.amount : null;
  }

  if (category === 'R7') {
    const row = BLUEDART_DECLARED_VALUE_MATRIX.find((r) => r.category === 'R7');
    return row ? row.amount : 60000;
  }

  const grade = normalizeGrade(generation);
  if (!grade) return null;

  const row = BLUEDART_DECLARED_VALUE_MATRIX.find(
    (r) => r.category.toLowerCase() === category.toLowerCase()
      && r.grade.toLowerCase() === grade.toLowerCase()
  );
  return row ? row.amount : null;
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

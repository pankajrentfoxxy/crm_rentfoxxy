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
];

export function normalizeCategory(processor) {
  const raw = String(processor || '').trim();
  if (!raw) return null;
  const p = raw.toLowerCase().replace(/\s+/g, '');

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

/** Amount for one laptop, or null if no matrix match. */
export function lookupDeclaredValueForUnit(processor, generation) {
  const category = normalizeCategory(processor);
  if (!category) return null;

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
 * Sum declared values for units ({ processor, generation }).
 * Returns null if nothing matched.
 */
export function sumDeclaredValueForUnits(units = []) {
  let total = 0;
  let matched = 0;
  for (const u of units) {
    const amount = lookupDeclaredValueForUnit(u?.processor, u?.generation);
    if (amount != null) {
      total += amount;
      matched += 1;
    }
  }
  if (!matched) return null;
  return total;
}

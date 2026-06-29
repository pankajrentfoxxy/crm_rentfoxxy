/**
 * Canonical normalization for CRM Settings → Asset Configuration.
 * Used on create/update and by scripts/normalize-asset-configuration.js.
 */

function trim(s) {
  return String(s || '').trim();
}

function collapseSpaces(s) {
  return trim(s).replace(/\s+/g, ' ');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}

function ordinal(n) {
  return `${n}${ordinalSuffix(n)}`;
}

/** Trim + collapse whitespace. */
function normalizeBrand(name) {
  return collapseSpaces(name);
}

/** Remove brand prefix and common noise from model when brand is stored separately. */
function stripBrandFromModel(brand, model) {
  let m = collapseSpaces(model);
  if (!m) return m;

  const b = trim(brand);
  if (b) {
    const re = new RegExp(`^${escapeRegex(b)}\\s*[-–—]?\\s*`, 'i');
    m = m.replace(re, '');
  }

  m = m.replace(/^(laptop|notebook computer|desktop|computer|notebook)\s+/i, '');

  if (b) {
    const re2 = new RegExp(`^${escapeRegex(b)}\\s*[-–—]?\\s*`, 'i');
    m = m.replace(re2, '');
  }

  return collapseSpaces(m) || collapseSpaces(model);
}

function normalizeModel(name, brandName = '') {
  return stripBrandFromModel(brandName, name);
}

/**
 * 8TH, 8th, 8th Gen, 10th Generation → 8th Gen
 * Non-numeric values (Apple M1 Series, -) are trimmed only.
 */
function normalizeGeneration(name) {
  const s = collapseSpaces(name);
  if (!s || s === '-') return s || '-';

  const bare = s.match(/^(\d{1,2})\s*(st|nd|rd|th)?$/i);
  if (bare) return `${ordinal(parseInt(bare[1], 10))} Gen`;

  const withGen = s.match(/^(\d{1,2})\s*(st|nd|rd|th)?\s*(?:gen(?:eration)?)?(?:\s*\([^)]*\))?$/i);
  if (withGen) return `${ordinal(parseInt(withGen[1], 10))} Gen`;

  const already = s.match(/^(\d{1,2})(st|nd|rd|th)\s+gen(?:eration)?$/i);
  if (already) return `${parseInt(already[1], 10)}${already[2].toLowerCase()} Gen`;

  return s;
}

/** 16GB, 16 GB, 16gb ram → 16GB RAM */
function normalizeRam(name) {
  let s = collapseSpaces(name).replace(/\bram\b/gi, '').trim();
  const m = s.match(/^(\d+)\s*(gb|tb)?$/i);
  if (m) {
    const unit = (m[2] || 'GB').toUpperCase();
    return `${m[1]}${unit} RAM`;
  }
  return collapseSpaces(name);
}

function normalizeStorageSegment(part) {
  let s = collapseSpaces(part);
  if (!s) return s;

  const nvme = s.match(/^(\d+)\s*(gb|tb)?\s*nvme\s*ssd$/i);
  if (nvme) return `${nvme[1]}${(nvme[2] || 'GB').toUpperCase()} NVMe SSD`;

  const hdd = s.match(/^(\d+)\s*(gb|tb)?\s*hdd$/i);
  if (hdd) return `${hdd[1]}${(hdd[2] || 'GB').toUpperCase()} HDD`;

  const ssdBare = s.match(/^(\d+)\s*ssd$/i);
  if (ssdBare) return `${ssdBare[1]}GB SSD`;

  const ssd = s.match(/^(\d+)\s*(gb|tb)?\s*ssd$/i);
  if (ssd) return `${ssd[1]}${(ssd[2] || 'GB').toUpperCase()} SSD`;

  const sizeOnly = s.match(/^(\d+)\s*(gb|tb)$/i);
  if (sizeOnly) return `${sizeOnly[1]}${sizeOnly[2].toUpperCase()} SSD`;

  const bareNum = s.match(/^(\d+)$/);
  if (bareNum) return `${bareNum[1]}GB SSD`;

  return s;
}

/** 512GB, 512 GB SSD, 512gb ssd → 512GB SSD */
function normalizeStorage(name) {
  const s = collapseSpaces(name);
  if (!s) return s;

  if (/\+/.test(s)) {
    return s.split('+').map((p) => normalizeStorageSegment(p)).join(' + ');
  }

  return normalizeStorageSegment(s);
}

/** Intel i5 / I5 → Intel Core i5; M1 → Apple M1 */
function normalizeProcessor(name) {
  let s = collapseSpaces(name);
  if (!s) return s;

  const intelShort = s.match(/^I([3579])$/i);
  if (intelShort) return `Intel Core i${intelShort[1]}`;

  const intelPartial = s.match(/^Intel\s+i([3579])$/i);
  if (intelPartial) return `Intel Core i${intelPartial[1]}`;

  const intelCore = s.match(/^Intel\s+Core\s+i([3579])(?:\s+Extreme)?$/i);
  if (intelCore) {
    return s.toLowerCase().includes('extreme')
      ? `Intel Core i${intelCore[1]} Extreme`
      : `Intel Core i${intelCore[1]}`;
  }

  // Verbose CPU strings from GRN/extra: Intel(R) Core(TM) i5-8365U CPU @ 1.60GHz
  const intelVerbose = s.match(/intel(?:\([^)]*\))?\s*core(?:\([^)]*\))?\s*i([3579])(?:-\d+[a-z0-9]*)?/i);
  if (intelVerbose) {
    return s.toLowerCase().includes('extreme')
      ? `Intel Core i${intelVerbose[1]} Extreme`
      : `Intel Core i${intelVerbose[1]}`;
  }

  if (/intel/i.test(s)) {
    const intelChip = s.match(/\bi([3579])(?:-\d+[a-z0-9]*)?\b/i);
    if (intelChip) return `Intel Core i${intelChip[1]}`;
  }

  const amdRyzen = s.match(/amd\s+ryzen\s*([3579])\b/i);
  if (amdRyzen) return `AMD Ryzen ${amdRyzen[1]}`;

  if (/^M[1-5](?:\s+(Pro|Max|PRO|MAX))?$/i.test(s) && !/^Apple/i.test(s)) {
    return `Apple ${s.replace(/^m/i, 'M').replace(/\bPRO\b/i, 'Pro').replace(/\bMAX\b/i, 'Max')}`;
  }

  if (/^Apple\s+M[1-5]/i.test(s)) {
    return s
      .replace(/^Apple\s+M/i, 'Apple M')
      .replace(/\bPRO\b/i, 'Pro')
      .replace(/\bMAX\b/i, 'Max');
  }

  return s;
}

function normalizeGpu(name) {
  return collapseSpaces(name);
}

/** 14-inch, 14 inch → 14" */
function normalizeScreenSize(name) {
  const s = collapseSpaces(name);
  if (!s) return s;

  const inch = s.match(/^(\d+(?:\.\d+)?)\s*-?\s*inch(?:es)?(?:\s+.*)?$/i);
  if (inch) return `${inch[1]}"`;

  const quoted = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (quoted) return `${quoted[1]}"`;

  return s;
}

const NORMALIZERS = {
  brands: normalizeBrand,
  models: normalizeModel,
  processors: normalizeProcessor,
  generations: normalizeGeneration,
  ram: normalizeRam,
  storage: normalizeStorage,
  gpus: normalizeGpu,
  'screen-sizes': normalizeScreenSize,
};

function normalizeEntityName(entityKey, name, context = {}) {
  const fn = NORMALIZERS[entityKey];
  if (!fn) return collapseSpaces(name);
  if (entityKey === 'models') return fn(name, context.brandName || '');
  return fn(name);
}

function compareKey(entityKey, name, context = {}) {
  return normalizeEntityName(entityKey, name, context).toLowerCase();
}

module.exports = {
  normalizeBrand,
  normalizeModel,
  stripBrandFromModel,
  normalizeGeneration,
  normalizeRam,
  normalizeStorage,
  normalizeProcessor,
  normalizeGpu,
  normalizeScreenSize,
  normalizeEntityName,
  compareKey,
  collapseSpaces,
};

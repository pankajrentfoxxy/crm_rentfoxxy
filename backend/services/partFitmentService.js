/**
 * Part Fitment — single matching rule for spare units vs laptop brand/model.
 *
 * Authority lives on part_instances (fitment / fits_laptop_brand / fits_laptop_models).
 * parts.default_fitment + compatible_brands/models are GRN defaults only.
 *
 * Do NOT confuse with part_instances.brand / parts.default_brand — those are the
 * SPARE vendor brand, not the laptop.
 */
const pool = require('../config/db');

const FITMENT = Object.freeze({
  UNSET: 'unset',
  UNIVERSAL: 'universal',
  SPECIFIC: 'specific',
});

const STAGES = Object.freeze(['filter', 'warn', 'block']);

class FitmentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FitmentValidationError';
    this.status = 400;
    this.code = 'FITMENT_INVALID';
  }
}

/**
 * Brand/model text from tickets, support items and the asset master is dirty:
 * "Dell Inc." vs "Dell", "HP HP Elitebook 840 G8" vs "Elitebook 840 G8",
 * "HP ProBook 640 G5 Notebook PC" vs "Probook 640 G5". Matching on the raw
 * strings marks a fitting unit `unfit` and hides it from the pick list, so both
 * sides go through the same normaliser before they are compared.
 */

/** Lower-case, drop punctuation, collapse whitespace. */
function normalise(s) {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/[-_/.,()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Company-form words that carry no identity: "Dell Inc." === "Dell".
const COMPANY_WORD_RE = /\b(inc|incorporated|corp|corporation|ltd|limited|pvt|private|gmbh|technologies|technology)\b/g;

// Spellings that mean the same manufacturer.
const BRAND_ALIASES = Object.freeze({
  'hewlett packard': 'hp',
  'lenovo group': 'lenovo',
  xiomi: 'xiaomi',
  mi: 'xiaomi',
});

// Master rows that name no real manufacturer — never inferred from a model string.
const GENERIC_BRANDS = new Set(['', '-', 'other', 'any brand', 'compatible', 'dummy brand', 'oem']);

// Marketing suffixes on a model: "ProBook 640 G5 Notebook PC" -> "probook 640 g5".
const MODEL_SUFFIX_RE = /\s+(notebook pc|notebook|laptop)$/;

/** Normalise a brand: punctuation, company words, alias. */
function normaliseBrand(s) {
  const v = normalise(s).replace(COMPANY_WORD_RE, '').replace(/\s+/g, ' ').trim();
  return BRAND_ALIASES[v] || v;
}

/** Normalise a model, before any brand prefix is stripped. */
function normaliseModel(s) {
  let v = normalise(s);
  let prev;
  do {
    prev = v;
    v = v.replace(MODEL_SUFFIX_RE, '').trim();
  } while (v !== prev);
  return v;
}

let knownBrands = [];
let knownBrandsAt = 0;
const KNOWN_BRANDS_TTL_MS = 60_000;

/** Longest-first so "western digital" is tried before "wd". */
function sortBrands(list) {
  return [...new Set(list.map(normaliseBrand))]
    .filter((b) => b.length > 1 && !GENERIC_BRANDS.has(b))
    .sort((a, b) => b.length - a.length);
}

/**
 * Cache the laptop brand master so resolveLaptopIdentity() can stay synchronous
 * (it has ~20 call sites inside loops). Callers prime it with `await
 * loadKnownBrands()` before a batch; an empty cache only degrades inference,
 * it never changes a fit into an unfit.
 */
async function loadKnownBrands(db = pool) {
  const now = Date.now();
  if (knownBrands.length && now - knownBrandsAt < KNOWN_BRANDS_TTL_MS) return knownBrands;
  try {
    const r = await db.query('SELECT name FROM asset_config_brands');
    knownBrands = sortBrands(r.rows.map((x) => x.name).filter(Boolean));
  } catch {
    // leave whatever is cached; inference degrades, matching still works
  }
  knownBrandsAt = now;
  return knownBrands;
}

function setKnownBrands(list) {
  knownBrands = sortBrands(Array.isArray(list) ? list : []);
  knownBrandsAt = Date.now();
}

function clearKnownBrandsCache() {
  knownBrands = [];
  knownBrandsAt = 0;
}

/**
 * Resolve a (brand, model) pair to the canonical pair used for comparison.
 *
 * `tickets.brand` is unreliable — 1 in 6 staging tickets carries a brand that
 * contradicts its own model ("Dell" / "Dell Lenovo Thinkpad X-13"). The model
 * string is the better witness, so leading brand tokens are stripped one at a
 * time and the last one stripped wins.
 */
function resolveLaptopIdentity(brand, model, brandsOverride) {
  const known = Array.isArray(brandsOverride) ? sortBrands(brandsOverride) : knownBrands;
  let b = normaliseBrand(brand);
  let m = normaliseModel(model);

  for (let i = 0; i < 4; i += 1) {
    const hit = known.find((c) => m === c || m.startsWith(`${c} `));
    if (!hit) break;
    b = hit;
    m = m === hit ? '' : m.slice(hit.length + 1).trim();
  }

  // Company words left behind by a strip: "Dell Inc. Latitude 7440".
  m = m.replace(/^(?:(?:inc|incorporated|corp|corporation|ltd|limited|pvt|private|gmbh)\s+)+/, '').trim();

  if (GENERIC_BRANDS.has(b)) b = '';
  return { brand: b, model: m };
}

/** The unit's own tag, resolved the same way (master rows carry prefixes too). */
function resolveUnitIdentity(unit) {
  const brand = normaliseBrand(unit?.fits_laptop_brand);
  const models = Array.isArray(unit?.fits_laptop_models) ? unit.fits_laptop_models : [];
  return {
    brand,
    models: models
      .map((m) => resolveLaptopIdentity(unit?.fits_laptop_brand, m).model)
      .filter(Boolean),
  };
}

function emptyModels(models) {
  if (!Array.isArray(models)) return true;
  return models.map((m) => normalise(m)).filter(Boolean).length === 0;
}

/**
 * @param {{ fitment?: string, fits_laptop_brand?: string|null, fits_laptop_models?: string[]|null }} unit
 * @param {string|null|undefined} laptopBrand
 * @param {string|null|undefined} laptopModel
 * @returns {'fit'|'unfit'|'unknown'}
 */
function fits(unit, laptopBrand, laptopModel) {
  const fitment = String(unit?.fitment || FITMENT.UNSET).toLowerCase();
  if (fitment === FITMENT.UNSET) return 'unknown';
  if (fitment === FITMENT.UNIVERSAL) return 'fit';

  const laptop = resolveLaptopIdentity(laptopBrand, laptopModel);
  if (!laptop.brand) return 'unknown';

  const tag = resolveUnitIdentity(unit);
  if (!tag.brand || tag.brand !== laptop.brand) return 'unfit';

  if (!tag.models.length) return 'fit';
  if (!laptop.model) return 'unknown';

  return tag.models.includes(laptop.model) ? 'fit' : 'unfit';
}

/**
 * Partition a list of candidate units for a laptop: fitting units first, then
 * untagged ones, with the mismatches last so a picker can still see them.
 */
function rankByFit(units, laptopBrand, laptopModel) {
  const order = { fit: 0, unknown: 1, unfit: 2 };
  return units
    .map((u) => ({ unit: u, fit_status: fits(u, laptopBrand, laptopModel) }))
    .sort((a, b) => order[a.fit_status] - order[b.fit_status]);
}

function validateFitment({ fitment, fits_laptop_brand, fits_laptop_models }) {
  const f = String(fitment || FITMENT.UNSET).toLowerCase();
  if (![FITMENT.UNSET, FITMENT.UNIVERSAL, FITMENT.SPECIFIC].includes(f)) {
    throw new FitmentValidationError(`Invalid fitment: ${fitment}`);
  }

  let brand = fits_laptop_brand != null && String(fits_laptop_brand).trim()
    ? String(fits_laptop_brand).trim()
    : null;
  let models = Array.isArray(fits_laptop_models)
    ? fits_laptop_models.map((m) => String(m).trim()).filter(Boolean)
    : [];

  if (f === FITMENT.UNIVERSAL) {
    brand = null;
    models = [];
  } else if (f === FITMENT.UNSET) {
    brand = null;
    models = [];
  } else if (f === FITMENT.SPECIFIC) {
    if (!brand) {
      throw new FitmentValidationError('fits_laptop_brand is required when fitment=specific');
    }
  }

  return {
    fitment: f,
    fits_laptop_brand: brand,
    fits_laptop_models: models.length ? models : null,
  };
}

let cachedStage = null;
let cachedAt = 0;
const STAGE_TTL_MS = 5000;

async function getEnforcementStage(db = pool) {
  const now = Date.now();
  if (cachedStage && now - cachedAt < STAGE_TTL_MS) return cachedStage;
  try {
    const r = await db.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'parts_fitment_enforcement'`
    );
    let v = r.rows[0]?.setting_value;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { /* already string */ }
    }
    // JSONB string comes back as a JS string already from node-pg
    const stage = typeof v === 'string' ? v.replace(/^"|"$/g, '') : String(v || 'filter');
    cachedStage = STAGES.includes(stage) ? stage : 'filter';
  } catch {
    cachedStage = 'filter';
  }
  cachedAt = now;
  return cachedStage;
}

function clearEnforcementCache() {
  cachedStage = null;
  cachedAt = 0;
}

async function setEnforcementStage(stage, { updatedBy, db = pool } = {}) {
  if (!STAGES.includes(stage)) {
    throw new FitmentValidationError(`Invalid stage: ${stage}`);
  }
  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES ('parts_fitment_enforcement', to_jsonb($1::text), $2, NOW())
     ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [stage, updatedBy != null ? Number(updatedBy) : null]
  );
  clearEnforcementCache();
  return stage;
}

/**
 * Resolve catalog defaults into unit fitment fields.
 */
function defaultsFromPart(partRow) {
  const fitment = String(partRow?.default_fitment || FITMENT.UNSET).toLowerCase();
  if (fitment === FITMENT.UNIVERSAL) {
    return { fitment: FITMENT.UNIVERSAL, fits_laptop_brand: null, fits_laptop_models: null };
  }
  if (fitment === FITMENT.SPECIFIC) {
    const brands = Array.isArray(partRow?.compatible_brands) ? partRow.compatible_brands : [];
    const brand = brands[0] ? String(brands[0]).trim() : null;
    const models = Array.isArray(partRow?.compatible_models)
      ? partRow.compatible_models.map((m) => String(m).trim()).filter(Boolean)
      : [];
    if (!brand) {
      return { fitment: FITMENT.UNSET, fits_laptop_brand: null, fits_laptop_models: null };
    }
    return {
      fitment: FITMENT.SPECIFIC,
      fits_laptop_brand: brand,
      fits_laptop_models: models.length ? models : null,
    };
  }
  return { fitment: FITMENT.UNSET, fits_laptop_brand: null, fits_laptop_models: null };
}

/**
 * Gate an assignment of `unit` to a laptop. Returns { ok, status, stage, message? }.
 * unset/unknown always ok. unfit blocked only at stage=block (or warn without reason).
 */
async function assertAssignmentAllowed({
  unit,
  laptopBrand,
  laptopModel,
  stage: stageOverride,
  mismatchReason,
  db = pool,
} = {}) {
  const stage = stageOverride || (await getEnforcementStage(db));
  await loadKnownBrands(db);
  const status = fits(unit, laptopBrand, laptopModel);
  if (status !== 'unfit') {
    return { ok: true, status, stage };
  }

  const tag = unit.fitment === 'specific'
    ? `${unit.fits_laptop_brand || '?'}${
        Array.isArray(unit.fits_laptop_models) && unit.fits_laptop_models.length
          ? ` · ${unit.fits_laptop_models.join(', ')}`
          : ''
      }`
    : unit.fitment;
  const laptop = `${laptopBrand || '?'}${laptopModel ? ` · ${laptopModel}` : ''}`;
  const baseMsg = `Part does not fit this laptop (unit: ${tag}; laptop: ${laptop}). Retag the unit if the tag is wrong.`;

  if (stage === 'block') {
    return {
      ok: false,
      status,
      stage,
      code: 'FITMENT_BLOCKED',
      message: baseMsg,
    };
  }
  if (stage === 'warn') {
    const reason = mismatchReason != null ? String(mismatchReason).trim() : '';
    if (reason.length < 10) {
      return {
        ok: false,
        status,
        stage,
        code: 'FITMENT_WARN_REASON',
        message: `${baseMsg} Provide a reason (min 10 characters) to proceed.`,
      };
    }
  }
  return { ok: true, status, stage, allowedMismatch: true, reason: mismatchReason || null };
}

module.exports = {
  FITMENT,
  STAGES,
  FitmentValidationError,
  normalise,
  normaliseBrand,
  normaliseModel,
  resolveLaptopIdentity,
  resolveUnitIdentity,
  loadKnownBrands,
  setKnownBrands,
  clearKnownBrandsCache,
  fits,
  rankByFit,
  validateFitment,
  getEnforcementStage,
  setEnforcementStage,
  clearEnforcementCache,
  defaultsFromPart,
  assertAssignmentAllowed,
};

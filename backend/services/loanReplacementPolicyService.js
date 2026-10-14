/**
 * Loan laptop replacement policy — which loan laptop may stand in for a
 * customer's laptop while it is repaired, and whether Accounts must approve it.
 *
 * Nothing about processors is hardcoded here. Rules live in
 * loan_replacement_policy_rules (first active match by priority wins) and the
 * performance tier of each processor family lives in loan_cpu_tiers. A laptop's
 * family and generation are read with the same parsers GRN/QC use
 * (grnConfigService.cpuType / genFromActual).
 */
const { cpuType, genFromActual } = require('./grnConfigService');

const DECISIONS = Object.freeze(['allowed', 'approval_required', 'not_allowed']);
const TIER_RELATIONS = Object.freeze(['any', 'same', 'higher', 'lower', 'same_or_lower']);
const FALLBACK_DECISION = 'approval_required';

function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Family + generation + tier for one laptop spec. Unknown parts come back null. */
function classifySpec(spec, tierByFamily) {
  const processor = String(spec?.processor || '').trim();
  const generationText = String(spec?.generation || '').trim();
  const rawFamily = processor ? cpuType(processor) : '';
  const family = rawFamily && tierByFamily.has(rawFamily) ? rawFamily : null;
  const generation = processor || generationText
    ? genFromActual({ processor, generation: generationText })
    : null;
  return {
    processor: processor || null,
    generation_text: generationText || null,
    family,
    family_raw: rawFamily || null,
    tier: family ? tierByFamily.get(family) : null,
    generation: Number.isFinite(generation) ? generation : null,
  };
}

function tierRelationHolds(relation, original, loan) {
  if (!relation || relation === 'any') return true;
  if (original.tier == null || loan.tier == null) return false;
  if (relation === 'same') return loan.tier === original.tier;
  if (relation === 'higher') return loan.tier > original.tier;
  if (relation === 'lower') return loan.tier < original.tier;
  if (relation === 'same_or_lower') return loan.tier <= original.tier;
  return false;
}

function withinRange(value, min, max) {
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function ruleMatches(rule, original, loan) {
  if (rule.original_cpu_family && rule.original_cpu_family !== original.family) return false;
  if (rule.loan_cpu_family && rule.loan_cpu_family !== loan.family) return false;
  if (!withinRange(original.generation, intOrNull(rule.original_gen_min), intOrNull(rule.original_gen_max))) return false;
  if (!withinRange(loan.generation, intOrNull(rule.loan_gen_min), intOrNull(rule.loan_gen_max))) return false;
  if (!tierRelationHolds(rule.tier_relation, original, loan)) return false;
  const upMin = intOrNull(rule.gen_uplift_min);
  const upMax = intOrNull(rule.gen_uplift_max);
  if (upMin != null || upMax != null) {
    if (original.generation == null || loan.generation == null) return false;
    if (!withinRange(loan.generation - original.generation, upMin, upMax)) return false;
  }
  return true;
}

function describeRelation(original, loan) {
  if (original.tier == null || loan.tier == null) return 'unknown';
  if (loan.tier > original.tier) return 'higher';
  if (loan.tier < original.tier) return 'lower';
  return 'same';
}

/**
 * Pure evaluation. rules: rows of loan_replacement_policy_rules; tiers: rows of
 * loan_cpu_tiers. Returns the decision plus everything needed to explain it.
 */
function evaluatePolicy({ originalSpec, loanSpec, rules = [], tiers = [] }) {
  const tierByFamily = new Map(tiers.map((t) => [String(t.cpu_family), Number(t.tier_rank)]));
  const original = classifySpec(originalSpec, tierByFamily);
  const loan = classifySpec(loanSpec, tierByFamily);
  const ordered = rules
    .filter((r) => r.is_active !== false)
    .sort((a, b) => (Number(a.priority) - Number(b.priority)) || (Number(a.id) - Number(b.id)));
  const rule = ordered.find((r) => ruleMatches(r, original, loan)) || null;
  const decision = rule && DECISIONS.includes(rule.decision) ? rule.decision : FALLBACK_DECISION;
  const genUplift = original.generation != null && loan.generation != null
    ? loan.generation - original.generation
    : null;
  return {
    decision,
    approval_required: decision === 'approval_required',
    allowed: decision !== 'not_allowed',
    rule_id: rule ? rule.id : null,
    rule_name: rule ? rule.name : null,
    reason: rule
      ? rule.name
      : 'No replacement rule matched this pair — Accounts approval required',
    original,
    loan,
    tier_relation: describeRelation(original, loan),
    gen_uplift: genUplift,
  };
}

async function loadPolicy(db) {
  const [rules, tiers] = await Promise.all([
    db.query(`SELECT * FROM loan_replacement_policy_rules ORDER BY priority ASC, id ASC`),
    db.query(`SELECT cpu_family, tier_rank, label FROM loan_cpu_tiers ORDER BY tier_rank ASC, cpu_family ASC`),
  ]);
  return { rules: rules.rows, tiers: tiers.rows };
}

async function evaluateForSpecs(db, originalSpec, loanSpec, policy = null) {
  const p = policy || await loadPolicy(db);
  return evaluatePolicy({ originalSpec, loanSpec, rules: p.rules, tiers: p.tiers });
}

// ── Rule / tier maintenance ─────────────────────────────────────────────────

class PolicyValidationError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function cleanFamily(v) {
  const s = String(v || '').trim().toLowerCase();
  return s || null;
}

function normalizeRuleInput(body = {}) {
  const name = String(body.name || '').trim();
  if (!name) throw new PolicyValidationError('Rule name is required');
  const decision = String(body.decision || '').trim();
  if (!DECISIONS.includes(decision)) {
    throw new PolicyValidationError(`decision must be one of ${DECISIONS.join(', ')}`);
  }
  const tierRelation = String(body.tier_relation || 'any').trim();
  if (!TIER_RELATIONS.includes(tierRelation)) {
    throw new PolicyValidationError(`tier_relation must be one of ${TIER_RELATIONS.join(', ')}`);
  }
  const out = {
    name: name.slice(0, 160),
    priority: intOrNull(body.priority) ?? 100,
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
    original_cpu_family: cleanFamily(body.original_cpu_family),
    loan_cpu_family: cleanFamily(body.loan_cpu_family),
    original_gen_min: intOrNull(body.original_gen_min),
    original_gen_max: intOrNull(body.original_gen_max),
    loan_gen_min: intOrNull(body.loan_gen_min),
    loan_gen_max: intOrNull(body.loan_gen_max),
    tier_relation: tierRelation,
    gen_uplift_min: intOrNull(body.gen_uplift_min),
    gen_uplift_max: intOrNull(body.gen_uplift_max),
    decision,
    notes: body.notes ? String(body.notes).slice(0, 2000) : null,
  };
  const pairs = [
    ['original_gen_min', 'original_gen_max'],
    ['loan_gen_min', 'loan_gen_max'],
    ['gen_uplift_min', 'gen_uplift_max'],
  ];
  for (const [lo, hi] of pairs) {
    if (out[lo] != null && out[hi] != null && out[lo] > out[hi]) {
      throw new PolicyValidationError(`${lo} cannot be greater than ${hi}`);
    }
  }
  return out;
}

const RULE_COLUMNS = [
  'name', 'priority', 'is_active', 'original_cpu_family', 'loan_cpu_family',
  'original_gen_min', 'original_gen_max', 'loan_gen_min', 'loan_gen_max',
  'tier_relation', 'gen_uplift_min', 'gen_uplift_max', 'decision', 'notes',
];

async function createRule(db, body, actorUserId) {
  const r = normalizeRuleInput(body);
  const values = RULE_COLUMNS.map((c) => r[c]);
  const placeholders = RULE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `INSERT INTO loan_replacement_policy_rules (${RULE_COLUMNS.join(', ')}, created_by, updated_by)
     VALUES (${placeholders}, $${RULE_COLUMNS.length + 1}, $${RULE_COLUMNS.length + 1})
     RETURNING *`,
    [...values, actorUserId || null]
  );
  return rows[0];
}

async function updateRule(db, id, body, actorUserId) {
  const r = normalizeRuleInput(body);
  const sets = RULE_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await db.query(
    `UPDATE loan_replacement_policy_rules
        SET ${sets}, updated_by = $${RULE_COLUMNS.length + 2}, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, ...RULE_COLUMNS.map((c) => r[c]), actorUserId || null]
  );
  if (!rows[0]) throw Object.assign(new Error('Rule not found'), { status: 404 });
  return rows[0];
}

async function deleteRule(db, id) {
  const { rowCount } = await db.query(`DELETE FROM loan_replacement_policy_rules WHERE id = $1`, [id]);
  if (!rowCount) throw Object.assign(new Error('Rule not found'), { status: 404 });
  return { deleted: true };
}

async function upsertTier(db, body, actorUserId) {
  const family = cleanFamily(body.cpu_family);
  if (!family || !/^[a-z0-9_]{1,30}$/.test(family)) {
    throw new PolicyValidationError('cpu_family must be a short code such as i5, ryzen7, ultra5, m2');
  }
  const rank = intOrNull(body.tier_rank);
  if (rank == null) throw new PolicyValidationError('tier_rank is required');
  const { rows } = await db.query(
    `INSERT INTO loan_cpu_tiers (cpu_family, tier_rank, label, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (cpu_family) DO UPDATE
        SET tier_rank = EXCLUDED.tier_rank,
            label = EXCLUDED.label,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
     RETURNING *`,
    [family, rank, body.label ? String(body.label).slice(0, 60) : null, actorUserId || null]
  );
  return rows[0];
}

async function deleteTier(db, family) {
  const { rowCount } = await db.query(`DELETE FROM loan_cpu_tiers WHERE cpu_family = $1`, [cleanFamily(family)]);
  if (!rowCount) throw Object.assign(new Error('Tier not found'), { status: 404 });
  return { deleted: true };
}

module.exports = {
  DECISIONS,
  TIER_RELATIONS,
  FALLBACK_DECISION,
  classifySpec,
  evaluatePolicy,
  loadPolicy,
  evaluateForSpecs,
  normalizeRuleInput,
  createRule,
  updateRule,
  deleteRule,
  upsertTier,
  deleteTier,
  PolicyValidationError,
};

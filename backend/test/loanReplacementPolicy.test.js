const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluatePolicy,
  classifySpec,
  normalizeRuleInput,
} = require('../services/loanReplacementPolicyService');

// Mirrors the seed in migrations/262_loan_laptop_workflow.sql.
const TIERS = [
  { cpu_family: 'i3', tier_rank: 30 },
  { cpu_family: 'i5', tier_rank: 50 },
  { cpu_family: 'ryzen5', tier_rank: 50 },
  { cpu_family: 'i7', tier_rank: 70 },
  { cpu_family: 'm1', tier_rank: 55 },
];
const RULES = [
  { id: 1, priority: 10, name: 'higher tier', tier_relation: 'higher', decision: 'approval_required' },
  { id: 2, priority: 20, name: '13th gen+', tier_relation: 'any', loan_gen_min: 13, decision: 'approval_required' },
  { id: 3, priority: 30, name: 'same tier +0..2', tier_relation: 'same', gen_uplift_min: 0, gen_uplift_max: 2, decision: 'allowed' },
  { id: 4, priority: 40, name: 'same tier +3', tier_relation: 'same', gen_uplift_min: 3, decision: 'approval_required' },
  { id: 5, priority: 50, name: 'same tier older', tier_relation: 'same', gen_uplift_max: -1, decision: 'allowed' },
  { id: 6, priority: 60, name: 'lower tier', tier_relation: 'lower', decision: 'allowed' },
  { id: 7, priority: 1000, name: 'fallback', tier_relation: 'any', decision: 'approval_required' },
];

const evalPair = (originalSpec, loanSpec, rules = RULES) =>
  evaluatePolicy({ originalSpec, loanSpec, rules, tiers: TIERS });

describe('loan replacement policy', () => {
  it('reads family and generation from the processor text or the generation field', () => {
    const tierMap = new Map(TIERS.map((t) => [t.cpu_family, t.tier_rank]));
    assert.deepEqual(
      (({ family, generation, tier }) => ({ family, generation, tier }))(
        classifySpec({ processor: 'Intel Core i5-10210U' }, tierMap)
      ),
      { family: 'i5', generation: 10, tier: 50 }
    );
    const viaField = classifySpec({ processor: 'Intel Core i7', generation: '12th Gen' }, tierMap);
    assert.equal(viaField.family, 'i7');
    assert.equal(viaField.generation, 12);
  });

  it('i5 replaced with i7 needs Accounts approval (higher tier)', () => {
    const r = evalPair({ processor: 'Intel Core i5', generation: '10th Gen' }, { processor: 'Intel Core i7', generation: '10th Gen' });
    assert.equal(r.decision, 'approval_required');
    assert.equal(r.rule_id, 1);
    assert.equal(r.tier_relation, 'higher');
  });

  it('i5 10th Gen replaced with i5 11th or 12th Gen is allowed by policy', () => {
    for (const gen of ['11th Gen', '12th Gen']) {
      const r = evalPair({ processor: 'Intel Core i5', generation: '10th Gen' }, { processor: 'Intel Core i5', generation: gen });
      assert.equal(r.decision, 'allowed', gen);
      assert.equal(r.rule_id, 3);
      assert.equal(r.approval_required, false);
    }
  });

  it('13th Gen loan needs approval even on the same tier', () => {
    const r = evalPair({ processor: 'Intel Core i5', generation: '12th Gen' }, { processor: 'Intel Core i5-1335U' });
    assert.equal(r.loan.generation, 13);
    assert.equal(r.decision, 'approval_required');
    assert.equal(r.rule_id, 2);
  });

  it('same tier three generations newer needs approval', () => {
    const r = evalPair({ processor: 'Intel Core i5', generation: '8th Gen' }, { processor: 'Intel Core i5', generation: '11th Gen' });
    assert.equal(r.gen_uplift, 3);
    assert.equal(r.rule_id, 4);
    assert.equal(r.decision, 'approval_required');
  });

  it('a lower tier or an older generation is allowed', () => {
    assert.equal(evalPair({ processor: 'i7', generation: '10th Gen' }, { processor: 'i5', generation: '11th Gen' }).decision, 'allowed');
    assert.equal(evalPair({ processor: 'i5', generation: '11th Gen' }, { processor: 'i5', generation: '8th Gen' }).rule_id, 5);
  });

  it('an unreadable configuration falls through to approval', () => {
    const r = evalPair({ processor: 'Intel Core i5', generation: '10th Gen' }, { processor: 'Some Unknown CPU' });
    assert.equal(r.loan.family, null);
    assert.equal(r.decision, 'approval_required');
    assert.equal(r.rule_id, 7);
  });

  it('with no rules at all the safe default is approval', () => {
    const r = evalPair({ processor: 'i5', generation: '10th Gen' }, { processor: 'i5', generation: '10th Gen' }, []);
    assert.equal(r.decision, 'approval_required');
    assert.equal(r.rule_id, null);
  });

  it('honours priority order, inactive rules and not_allowed exceptions', () => {
    const rules = [
      ...RULES,
      { id: 9, priority: 5, name: 'never loan Apple to Windows users', original_cpu_family: 'i5', loan_cpu_family: 'm1', tier_relation: 'any', decision: 'not_allowed' },
      { id: 10, priority: 1, name: 'disabled override', tier_relation: 'any', decision: 'allowed', is_active: false },
    ];
    const apple = evalPair({ processor: 'Intel Core i5', generation: '10th Gen' }, { processor: 'Apple M1' }, rules);
    assert.equal(apple.decision, 'not_allowed');
    assert.equal(apple.allowed, false);
    const i7 = evalPair({ processor: 'i5', generation: '10th Gen' }, { processor: 'i7', generation: '10th Gen' }, rules);
    assert.equal(i7.rule_id, 1, 'inactive rule is skipped');
  });

  it('validates rule input', () => {
    assert.throws(() => normalizeRuleInput({ name: 'x', decision: 'maybe' }), /decision must be/);
    assert.throws(() => normalizeRuleInput({ name: 'x', decision: 'allowed', gen_uplift_min: 3, gen_uplift_max: 1 }), /cannot be greater/);
    const ok = normalizeRuleInput({ name: ' i5 → i5 ', decision: 'allowed', original_cpu_family: ' I5 ', priority: '15' });
    assert.equal(ok.original_cpu_family, 'i5');
    assert.equal(ok.priority, 15);
    assert.equal(ok.tier_relation, 'any');
  });
});

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Notice, Section, Select,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import {
  createRule, deleteRule, deleteTier, evaluatePolicy, getPolicy, updateRule, upsertTier,
} from '../../../loan-laptops/loanLaptopApi';
import { errMsg } from '../serveShared';
import { PolicyChip } from './loanShared';

/**
 * Serve → Loan laptops → Replacement policy.
 *
 * Which in-stock laptop may be lent against which customer laptop. The first
 * active rule (lowest priority number) that matches decides; nothing matching
 * means Accounts approval. Rules and CPU tiers are data, edited here
 * (loan_laptop_policy), and the same /policy endpoints as the old page.
 */
const RELATIONS = [
  { value: 'any', label: 'Any tier' },
  { value: 'same', label: 'Same tier' },
  { value: 'higher', label: 'Higher tier' },
  { value: 'lower', label: 'Lower tier' },
  { value: 'same_or_lower', label: 'Same or lower tier' },
];
const DECISIONS = [
  { value: 'allowed', label: 'Allowed' },
  { value: 'approval_required', label: 'Accounts approval' },
  { value: 'not_allowed', label: 'Not allowed' },
];
const EMPTY_RULE = {
  name: '', priority: 100, is_active: true, original_cpu_family: '', loan_cpu_family: '',
  original_gen_min: '', original_gen_max: '', loan_gen_min: '', loan_gen_max: '',
  tier_relation: 'any', gen_uplift_min: '', gen_uplift_max: '', decision: 'approval_required', notes: '',
};

function range(min, max) {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? `${min}` : `${min}–${max}`;
  return min != null ? `≥ ${min}` : `≤ ${max}`;
}

function describe(r) {
  const parts = [RELATIONS.find((x) => x.value === r.tier_relation)?.label || r.tier_relation];
  if (r.original_cpu_family) parts.push(`theirs ${r.original_cpu_family}`);
  if (range(r.original_gen_min, r.original_gen_max)) parts.push(`their gen ${range(r.original_gen_min, r.original_gen_max)}`);
  if (r.loan_cpu_family) parts.push(`loan ${r.loan_cpu_family}`);
  if (range(r.loan_gen_min, r.loan_gen_max)) parts.push(`loan gen ${range(r.loan_gen_min, r.loan_gen_max)}`);
  if (range(r.gen_uplift_min, r.gen_uplift_max)) parts.push(`gen change ${range(r.gen_uplift_min, r.gen_uplift_max)}`);
  return parts.join(' · ');
}

export default function LoanPolicyPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('loan_laptop_policy', 'edit');
  const canDelete = hasPermission('loan_laptop_policy', 'delete');
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [rule, setRule] = useState(null); // the rule being edited, {} for new
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState({ cpu_family: '', tier_rank: '', label: '' });
  const [trial, setTrial] = useState({ op: 'Intel Core i5', og: '10th Gen', lp: 'Intel Core i7', lg: '11th Gen' });
  const [verdict, setVerdict] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, action }

  const load = useCallback(() => getPolicy()
    .then(({ data }) => { setPolicy(data.data); setError(''); })
    .catch((e) => setError(errMsg(e, 'Could not load the policy'))), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(false); }
  };

  const openRule = (r) => {
    const base = { ...EMPTY_RULE, ...r };
    Object.keys(base).forEach((k) => { if (base[k] === null) base[k] = ''; });
    setRule(base);
  };
  const setR = (k) => (e) => setRule((p) => ({ ...p, [k]: e.target.value }));

  if (error) return <DeskShell title="Replacement policy" breadcrumb="Support / Loan laptops"><Notice tone="crit" title="Could not load">{error}</Notice></DeskShell>;
  if (!policy) return <DeskShell title="Replacement policy" breadcrumb="Support / Loan laptops"><EmptyState title="Loading…" /></DeskShell>;

  const families = (policy.tiers || []).map((t) => ({ value: t.cpu_family, label: `${t.cpu_family}${t.label ? ` — ${t.label}` : ''}` }));
  const num = (k, label) => <Field label={label}><Input type="number" placeholder="any" value={rule[k]} onChange={setR(k)} /></Field>;

  return (
    <DeskShell
      title="Replacement policy"
      breadcrumb="Support / Loan laptops"
      subtitle="Which laptop may be lent against which. The first active rule that matches (lowest priority number) decides; no match needs Accounts approval."
      actions={(
        <>
          <Button onClick={() => navigate('/carret/serve/loans')}>Loan laptops</Button>
          {canEdit && <Button variant="primary" onClick={() => openRule({})}>Add rule</Button>}
        </>
      )}
    >
      <div className="c-stack">
        <Section title={`Rules · ${(policy.rules || []).length}`}>
          <DataTable
            columns={[
              { key: 'p', header: 'Order', numeric: true, render: (r) => r.priority },
              { key: 'n', header: 'Rule', render: (r) => (r.is_active ? r.name : <span className="text-ink-3">{r.name} (off)</span>), sub: (r) => r.notes || null },
              { key: 'm', header: 'Matches', render: (r) => describe(r) },
              { key: 'd', header: 'Decision', render: (r) => <PolicyChip decision={r.decision} /> },
              {
                key: 'x',
                header: '',
                render: (r) => (canDelete ? (
                  <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setConfirm({ title: `Delete rule "${r.name}"?`, action: () => run(() => deleteRule(r.id), 'Rule deleted') }); }}>Delete</Button>
                ) : null),
              },
            ]}
            rows={policy.rules || []}
            rowKey={(r) => r.id}
            onRowClick={canEdit ? (r) => openRule(r) : undefined}
            empty={<EmptyState title="No rules" body="Every loan then needs Accounts approval." />}
          />
        </Section>

        <div className="c-split">
          <Section title="Processor tiers">
            <p className="text-ink-3" style={{ marginBottom: '8px' }}>Higher rank = higher tier. The family is read from the processor text (i5, ryzen7, ultra5, m2…).</p>
            <DataTable
              columns={[
                { key: 'f', header: 'Family', render: (t) => <span className="font-mono">{t.cpu_family}</span>, sub: (t) => t.label || null },
                { key: 'r', header: 'Rank', numeric: true, render: (t) => t.tier_rank },
                {
                  key: 'x',
                  header: '',
                  render: (t) => (
                    <div className="flex" style={{ gap: '6px' }}>
                      {canEdit && <Button variant="quiet" onClick={() => setTier({ cpu_family: t.cpu_family, tier_rank: String(t.tier_rank), label: t.label || '' })}>Edit</Button>}
                      {canDelete && <Button variant="quiet" onClick={() => setConfirm({ title: `Delete tier ${t.cpu_family}?`, action: () => run(() => deleteTier(t.cpu_family), 'Tier deleted') })}>Delete</Button>}
                    </div>
                  ),
                },
              ]}
              rows={policy.tiers || []}
              rowKey={(t) => t.cpu_family}
            />
            {canEdit && (
              <FormGrid cols={3} className="mt-3">
                <Field label="Family"><Input value={tier.cpu_family} onChange={(e) => setTier({ ...tier, cpu_family: e.target.value })} /></Field>
                <Field label="Rank"><Input type="number" value={tier.tier_rank} onChange={(e) => setTier({ ...tier, tier_rank: e.target.value })} /></Field>
                <Field label="Label"><Input value={tier.label} onChange={(e) => setTier({ ...tier, label: e.target.value })} /></Field>
                <div>
                  <Button
                    disabled={busy || !tier.cpu_family.trim() || tier.tier_rank === ''}
                    onClick={async () => { if (await run(() => upsertTier({ ...tier, tier_rank: Number(tier.tier_rank) }), 'Tier saved')) setTier({ cpu_family: '', tier_rank: '', label: '' }); }}
                  >
                    Save tier
                  </Button>
                </div>
              </FormGrid>
            )}
          </Section>

          <Section title="Try a pair">
            <FormGrid cols={2}>
              <Field label="Their processor"><Input value={trial.op} onChange={(e) => setTrial({ ...trial, op: e.target.value })} /></Field>
              <Field label="Their generation"><Input value={trial.og} onChange={(e) => setTrial({ ...trial, og: e.target.value })} /></Field>
              <Field label="Loan processor"><Input value={trial.lp} onChange={(e) => setTrial({ ...trial, lp: e.target.value })} /></Field>
              <Field label="Loan generation"><Input value={trial.lg} onChange={(e) => setTrial({ ...trial, lg: e.target.value })} /></Field>
            </FormGrid>
            <div style={{ marginTop: '8px' }}>
              <Button onClick={() => evaluatePolicy({
                original_spec: { processor: trial.op, generation: trial.og },
                loan_spec: { processor: trial.lp, generation: trial.lg },
              }).then(({ data }) => setVerdict(data.data)).catch((e) => toast.error(errMsg(e)))}
              >
                Check
              </Button>
            </div>
            {verdict && (
              <div className="c-stack" style={{ marginTop: '12px' }}>
                <PolicyChip decision={verdict.decision} />
                <p>{verdict.reason}</p>
                <KeyValue cols={2} items={[
                  { label: 'Theirs', value: `${verdict.original?.family || 'unknown'} gen ${verdict.original?.generation ?? '?'} (tier ${verdict.original?.tier ?? '?'})` },
                  { label: 'Loan', value: `${verdict.loan?.family || 'unknown'} gen ${verdict.loan?.generation ?? '?'} (tier ${verdict.loan?.tier ?? '?'})` },
                ]}
                />
              </div>
            )}
          </Section>
        </div>
      </div>

      <Drawer
        open={Boolean(rule)}
        onClose={() => setRule(null)}
        width="40rem"
        title={rule?.id ? 'Edit rule' : 'New rule'}
        footer={(
          <Button
            variant="primary"
            disabled={busy || !rule?.name?.trim()}
            onClick={async () => { if (await run(() => (rule.id ? updateRule(rule.id, rule) : createRule(rule)), 'Rule saved')) setRule(null); }}
          >
            Save rule
          </Button>
        )}
      >
        {rule && (
          <FormGrid cols={2}>
            <Field label="Rule name" required span={2}><Input value={rule.name} onChange={setR('name')} /></Field>
            {num('priority', 'Order (lower runs first)')}
            <Field label="Decision"><Select value={rule.decision} onChange={setR('decision')} options={DECISIONS} /></Field>
            <Field label="Loan tier vs theirs" span={2}><Select value={rule.tier_relation} onChange={setR('tier_relation')} options={RELATIONS} /></Field>
            <Field label="Their processor"><Select value={rule.original_cpu_family} onChange={setR('original_cpu_family')} placeholder="Any" options={families} /></Field>
            <Field label="Loan processor"><Select value={rule.loan_cpu_family} onChange={setR('loan_cpu_family')} placeholder="Any" options={families} /></Field>
            {num('original_gen_min', 'Their generation from')}
            {num('original_gen_max', 'Their generation to')}
            {num('loan_gen_min', 'Loan generation from')}
            {num('loan_gen_max', 'Loan generation to')}
            {num('gen_uplift_min', 'Generation change from (loan − theirs)')}
            {num('gen_uplift_max', 'Generation change to')}
            <Field label="Notes" span={2}><Input value={rule.notes} onChange={setR('notes')} /></Field>
            <Checkbox label="Active" checked={Boolean(rule.is_active)} onChange={(e) => setRule((p) => ({ ...p, is_active: e.target.checked }))} />
          </FormGrid>
        )}
      </Drawer>
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => { confirm?.action(); setConfirm(null); }}
        title={confirm?.title}
        body="This cannot be undone."
        confirmLabel="Delete"
      />
    </DeskShell>
  );
}

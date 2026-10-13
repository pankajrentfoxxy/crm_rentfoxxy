import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Settings2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { usePermission } from '../../../hooks/usePermission';
import { PageHeader, Button, Card, SectionLoader } from '../../../components/ui/primitives';
import { PolicyBadge } from '../components/LoanStatusBadge';
import {
  getPolicy, createRule, updateRule, deleteRule, upsertTier, deleteTier, evaluatePolicy, errorMessage,
} from '../loanLaptopApi';

const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[44px]';
const label = 'block text-xs font-semibold text-slate-600 mb-1';
const RELATION_LABELS = {
  any: 'Any tier',
  same: 'Same tier',
  higher: 'Higher tier',
  lower: 'Lower tier',
  same_or_lower: 'Same or lower tier',
};
const EMPTY_RULE = {
  name: '', priority: 100, is_active: true, original_cpu_family: '', loan_cpu_family: '',
  original_gen_min: '', original_gen_max: '', loan_gen_min: '', loan_gen_max: '',
  tier_relation: 'any', gen_uplift_min: '', gen_uplift_max: '', decision: 'approval_required', notes: '',
};

function range(min, max, unit = '') {
  if (min == null && max == null) return 'any';
  if (min != null && max != null) return min === max ? `${min}${unit}` : `${min}–${max}${unit}`;
  return min != null ? `≥ ${min}${unit}` : `≤ ${max}${unit}`;
}

function describe(rule) {
  const parts = [RELATION_LABELS[rule.tier_relation] || rule.tier_relation];
  if (rule.original_cpu_family) parts.push(`original ${rule.original_cpu_family}`);
  if (rule.original_gen_min != null || rule.original_gen_max != null) parts.push(`original gen ${range(rule.original_gen_min, rule.original_gen_max)}`);
  if (rule.loan_cpu_family) parts.push(`loan ${rule.loan_cpu_family}`);
  if (rule.loan_gen_min != null || rule.loan_gen_max != null) parts.push(`loan gen ${range(rule.loan_gen_min, rule.loan_gen_max)}`);
  if (rule.gen_uplift_min != null || rule.gen_uplift_max != null) parts.push(`gen change ${range(rule.gen_uplift_min, rule.gen_uplift_max)}`);
  return parts.join(' · ');
}

function RuleForm({ rule, families, onSave, onCancel, saving }) {
  const [r, setR] = useState(() => {
    const base = { ...EMPTY_RULE, ...rule };
    Object.keys(base).forEach((k) => { if (base[k] === null) base[k] = ''; });
    return base;
  });
  const set = (patch) => setR((prev) => ({ ...prev, ...patch }));
  const numField = (key, text) => (
    <div>
      <label className={label}>{text}</label>
      <input className={input} type="number" value={r[key]} onChange={(e) => set({ [key]: e.target.value })} placeholder="any" />
    </div>
  );
  const familySelect = (key, text) => (
    <div>
      <label className={label}>{text}</label>
      <select className={input} value={r[key]} onChange={(e) => set({ [key]: e.target.value })}>
        <option value="">Any</option>
        {families.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>
  );
  return (
    <Card className="p-4 border-blue-200">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="sm:col-span-3">
          <label className={label}>Rule name</label>
          <input className={input} value={r.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        {numField('priority', 'Priority (lower runs first)')}
        <div>
          <label className={label}>Tier relation (loan vs original)</label>
          <select className={input} value={r.tier_relation} onChange={(e) => set({ tier_relation: e.target.value })}>
            {Object.entries(RELATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {familySelect('original_cpu_family', 'Original processor')}
        {familySelect('loan_cpu_family', 'Loan processor')}
        <div>
          <label className={label}>Decision</label>
          <select className={input} value={r.decision} onChange={(e) => set({ decision: e.target.value })}>
            <option value="allowed">Allowed</option>
            <option value="approval_required">Accounts approval required</option>
            <option value="not_allowed">Not allowed</option>
          </select>
        </div>
        {numField('original_gen_min', 'Original gen from')}
        {numField('original_gen_max', 'Original gen to')}
        {numField('loan_gen_min', 'Loan gen from')}
        {numField('loan_gen_max', 'Loan gen to')}
        {numField('gen_uplift_min', 'Generation change from (loan − original)')}
        {numField('gen_uplift_max', 'Generation change to')}
        <div className="sm:col-span-2">
          <label className={label}>Notes</label>
          <input className={input} value={r.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 mt-3">
        <input type="checkbox" checked={Boolean(r.is_active)} onChange={(e) => set({ is_active: e.target.checked })} /> Active
      </label>
      <div className="flex gap-2 mt-4">
        <Button loading={saving} disabled={!r.name.trim()} onClick={() => onSave(r)}>Save rule</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

export default function LoanPolicyPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('loan_laptop_policy', 'edit');
  const canDelete = hasPermission('loan_laptop_policy', 'delete');
  const [policy, setPolicy] = useState(null);
  const [editing, setEditing] = useState(null); // rule object or {} for new
  const [saving, setSaving] = useState(false);
  const [tierDraft, setTierDraft] = useState({ cpu_family: '', tier_rank: '', label: '' });
  const [trial, setTrial] = useState({ op: 'Intel Core i5', og: '10th Gen', lp: 'Intel Core i7', lg: '11th Gen' });
  const [verdict, setVerdict] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getPolicy();
      setPolicy(data.data);
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load policy'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveRule = async (r) => {
    setSaving(true);
    try {
      if (r.id) await updateRule(r.id, r); else await createRule(r);
      toast.success('Rule saved');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const tryPair = async () => {
    try {
      const { data } = await evaluatePolicy({
        original_spec: { processor: trial.op, generation: trial.og },
        loan_spec: { processor: trial.lp, generation: trial.lg },
      });
      setVerdict(data.data);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!policy) return <div className="p-4"><SectionLoader /></div>;
  const families = policy.tiers.map((t) => t.cpu_family);

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <Link to="/loan-laptops" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" /> Loan laptops
      </Link>
      <PageHeader
        title="Loan Replacement Policy"
        subtitle="The first active rule that matches (lowest priority number) decides. If none matches, Accounts approval is required."
        icon={Settings2}
        actions={canEdit && !editing ? <Button icon={Plus} onClick={() => setEditing({})}>Add rule</Button> : null}
      />

      {editing && <RuleForm rule={editing} families={families} onSave={saveRule} onCancel={() => setEditing(null)} saving={saving} />}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">Rule</th>
              <th className="px-4 py-3 text-left">Matches</th>
              <th className="px-4 py-3 text-left">Decision</th>
              <th className="px-4 py-3 text-left" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {policy.rules.map((rule) => (
              <tr key={rule.id} className={rule.is_active ? '' : 'opacity-50'}>
                <td className="px-4 py-3 text-slate-500">{rule.priority}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{rule.name}</p>
                  {rule.notes && <p className="text-xs text-slate-500">{rule.notes}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600 min-w-[200px]">{describe(rule)}</td>
                <td className="px-4 py-3"><PolicyBadge decision={rule.decision} /></td>
                <td className="px-4 py-3 whitespace-nowrap text-right">
                  {canEdit && <button type="button" className="text-blue-700 text-xs font-semibold mr-3" onClick={() => setEditing(rule)}>Edit</button>}
                  {canDelete && (
                    <button type="button" className="text-red-600" aria-label="Delete rule" onClick={async () => {
                      if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
                      try { await deleteRule(rule.id); toast.success('Rule deleted'); load(); } catch (e) { toast.error(errorMessage(e)); }
                    }}><Trash2 className="w-4 h-4 inline" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Processor performance tiers</h3>
          <p className="text-xs text-slate-500 mb-3">Higher rank = higher tier. Family codes come from the processor text (i5, ryzen7, ultra5, m2…).</p>
          <div className="divide-y divide-slate-100">
            {policy.tiers.map((t) => (
              <div key={t.cpu_family} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><span className="font-mono font-semibold">{t.cpu_family}</span> <span className="text-slate-500">{t.label}</span></span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-700">{t.tier_rank}</span>
                  {canEdit && <button type="button" className="text-blue-700 text-xs font-semibold" onClick={() => setTierDraft({ cpu_family: t.cpu_family, tier_rank: String(t.tier_rank), label: t.label || '' })}>Edit</button>}
                  {canDelete && (
                    <button type="button" className="text-red-600" aria-label="Delete tier" onClick={async () => {
                      if (!window.confirm(`Delete tier ${t.cpu_family}?`)) return;
                      try { await deleteTier(t.cpu_family); load(); } catch (e) { toast.error(errorMessage(e)); }
                    }}><Trash2 className="w-4 h-4" /></button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              <input className={input} placeholder="family" value={tierDraft.cpu_family} onChange={(e) => setTierDraft({ ...tierDraft, cpu_family: e.target.value })} />
              <input className={input} placeholder="rank" type="number" value={tierDraft.tier_rank} onChange={(e) => setTierDraft({ ...tierDraft, tier_rank: e.target.value })} />
              <input className={input} placeholder="label" value={tierDraft.label} onChange={(e) => setTierDraft({ ...tierDraft, label: e.target.value })} />
              <Button className="col-span-3" variant="secondary" disabled={!tierDraft.cpu_family || tierDraft.tier_rank === ''} onClick={async () => {
                try {
                  await upsertTier({ ...tierDraft, tier_rank: Number(tierDraft.tier_rank) });
                  setTierDraft({ cpu_family: '', tier_rank: '', label: '' });
                  toast.success('Tier saved');
                  load();
                } catch (e) { toast.error(errorMessage(e)); }
              }}>Save tier</Button>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Try a pair</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={label}>Original processor</label><input className={input} value={trial.op} onChange={(e) => setTrial({ ...trial, op: e.target.value })} /></div>
            <div><label className={label}>Original generation</label><input className={input} value={trial.og} onChange={(e) => setTrial({ ...trial, og: e.target.value })} /></div>
            <div><label className={label}>Loan processor</label><input className={input} value={trial.lp} onChange={(e) => setTrial({ ...trial, lp: e.target.value })} /></div>
            <div><label className={label}>Loan generation</label><input className={input} value={trial.lg} onChange={(e) => setTrial({ ...trial, lg: e.target.value })} /></div>
          </div>
          <Button className="mt-3" variant="secondary" onClick={tryPair}>Check</Button>
          {verdict && (
            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
              <PolicyBadge decision={verdict.decision} />
              <p className="text-slate-800">{verdict.reason}</p>
              <p className="text-xs text-slate-500">
                Original: {verdict.original.family || 'unknown'} gen {verdict.original.generation ?? '?'} (tier {verdict.original.tier ?? '?'}) ·
                Loan: {verdict.loan.family || 'unknown'} gen {verdict.loan.generation ?? '?'} (tier {verdict.loan.tier ?? '?'})
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

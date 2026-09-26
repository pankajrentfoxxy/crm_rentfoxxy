import React, { useEffect, useState } from 'react';
import { Field, FormGrid, Select, Textarea } from '../../../components/carret';
import { fetchIssueCatalog } from './serveApi';

/**
 * Support issue process (claude/carret-support.md rework A+B).
 *
 * useIssueCatalog() loads Type > Subtype > Issue with the root causes and
 * fixes once per page. <IssuePicker> is the three cascading dropdowns;
 * <FindingFields> is what the technician records before a job finishes:
 * what was actually wrong, why (root cause) and what fixed it.
 */
let cached = null;
export function useIssueCatalog() {
  const [cat, setCat] = useState(cached);
  useEffect(() => {
    if (cached) return;
    fetchIssueCatalog().then(({ data }) => { cached = data; setCat(data); }).catch(() => setCat({ types: [], root_causes: [], resolutions: [], resolutions_for: {} }));
  }, []);
  return cat;
}

export const emptyIssue = () => ({ type_id: '', subtype_id: '', issue_id: '' });

/** "Hardware › Display › Flickering" from ids, or '' */
export function issueLabel(cat, v) {
  const t = cat?.types.find((x) => String(x.id) === String(v?.type_id));
  const s = t?.subtypes.find((x) => String(x.id) === String(v?.subtype_id));
  const i = s?.issues.find((x) => String(x.id) === String(v?.issue_id));
  return [t?.name, s?.name, i?.name].filter(Boolean).join(' › ');
}

export function issueComplete(v) {
  return Boolean(v?.type_id && v?.subtype_id && v?.issue_id);
}

export function IssuePicker({ catalog, value, onChange, label = 'Issue', required = true, cols = 3, idPrefix = 'issue' }) {
  const types = catalog?.types || [];
  const type = types.find((t) => String(t.id) === String(value.type_id));
  const sub = type?.subtypes.find((s) => String(s.id) === String(value.subtype_id));
  return (
    <FormGrid cols={cols}>
      <Field label={`${label} — type`} required={required}>
        <Select
          id={`${idPrefix}-type`}
          value={String(value.type_id || '')}
          onChange={(e) => onChange({ type_id: e.target.value, subtype_id: '', issue_id: '' })}
          placeholder={catalog ? 'Choose…' : 'Loading…'}
          options={types.map((t) => ({ value: String(t.id), label: t.name }))}
        />
      </Field>
      <Field label="Subtype" required={required}>
        <Select
          id={`${idPrefix}-subtype`}
          value={String(value.subtype_id || '')}
          disabled={!type}
          onChange={(e) => onChange({ ...value, subtype_id: e.target.value, issue_id: '' })}
          placeholder={type ? 'Choose…' : 'Pick the type first'}
          options={(type?.subtypes || []).map((s) => ({ value: String(s.id), label: s.name }))}
        />
      </Field>
      <Field label="Issue" required={required}>
        <Select
          id={`${idPrefix}-issue`}
          value={String(value.issue_id || '')}
          disabled={!sub}
          onChange={(e) => onChange({ ...value, issue_id: e.target.value })}
          placeholder={sub ? 'Choose…' : 'Pick the subtype first'}
          options={(sub?.issues || []).map((i) => ({ value: String(i.id), label: i.name }))}
        />
      </Field>
    </FormGrid>
  );
}

/**
 * finish: 'fixed' | 'working' | 'replacement_required' | 'workshop'.
 * value: { found: {type_id, subtype_id, issue_id}, root_cause_id, resolution_code, resolution_notes }
 */
export function emptyFinding(reported) {
  return {
    found: reported?.issue_id ? { type_id: String(reported.type_id), subtype_id: String(reported.subtype_id), issue_id: String(reported.issue_id) } : emptyIssue(),
    root_cause_id: '',
    resolution_code: '',
    resolution_notes: '',
  };
}

export function findingError(finish, v, catalog) {
  if (!issueComplete(v.found)) return 'Say what was actually wrong (type, subtype, issue)';
  if (finish === 'working') return null;
  if (!v.root_cause_id) return 'Choose why it happened';
  const fixes = catalog?.resolutions_for?.[finish] || [];
  if (fixes.length > 1 && !v.resolution_code) return 'Choose what fixed it';
  return null;
}

export function findingBody(finish, v, catalog) {
  const fixes = catalog?.resolutions_for?.[finish] || [];
  return {
    found_type_id: Number(v.found.type_id),
    found_subtype_id: Number(v.found.subtype_id),
    found_issue_id: Number(v.found.issue_id),
    root_cause_id: v.root_cause_id ? Number(v.root_cause_id) : undefined,
    resolution_code: v.resolution_code || (fixes.length === 1 ? fixes[0] : undefined),
    resolution_notes: v.resolution_notes.trim() || undefined,
  };
}

const CUSTOMER_FAULT = new Set(['CUSTOMER_CHARGEABLE']);

export function FindingFields({ catalog, finish, value, onChange, idPrefix = 'finding' }) {
  const fixes = (catalog?.resolutions || []).filter((r) => (catalog?.resolutions_for?.[finish] || []).includes(r.code));
  const cause = (catalog?.root_causes || []).find((c) => String(c.id) === String(value.root_cause_id));
  return (
    <div className="c-stack">
      <IssuePicker catalog={catalog} value={value.found} onChange={(found) => onChange({ ...value, found })} label="What was actually wrong" cols={1} idPrefix={idPrefix} />
      {finish !== 'working' && (
        <Field label="Why it happened" required hint={cause && CUSTOMER_FAULT.has(cause.default_liability) ? 'Customer-caused — tell the lead; a part may be charged' : undefined}>
          <Select
            id={`${idPrefix}-cause`}
            value={String(value.root_cause_id || '')}
            onChange={(e) => onChange({ ...value, root_cause_id: e.target.value })}
            placeholder="Choose…"
            options={(catalog?.root_causes || []).map((c) => ({ value: String(c.id), label: c.name }))}
          />
        </Field>
      )}
      {fixes.length > 1 && (
        <Field label="What fixed it" required>
          <Select
            id={`${idPrefix}-fix`}
            value={value.resolution_code}
            onChange={(e) => onChange({ ...value, resolution_code: e.target.value })}
            placeholder="Choose…"
            options={fixes.map((r) => ({ value: r.code, label: r.name }))}
          />
        </Field>
      )}
      <Field label="Notes (optional)">
        <Textarea rows={2} value={value.resolution_notes} onChange={(e) => onChange({ ...value, resolution_notes: e.target.value })} placeholder="What you checked or changed" />
      </Field>
    </div>
  );
}

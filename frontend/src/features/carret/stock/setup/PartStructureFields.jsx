import React from 'react';
import {
  Checkbox, Field, FormGrid, Input, Select,
} from '../../../../components/carret';
import FitmentPicker from './FitmentPicker';
import { PART_CATEGORIES } from './partsApi';
import { categorySchema, fitsRule, kindSchema } from '../../../../constants/partNaming';

/** Spec values that still fit a kind's fields, with its defaults filled in. */
export function specsForKind(category, kind, specs = {}) {
  const k = kindSchema(category, kind);
  const out = {};
  if (specs._was) out._was = specs._was;
  for (const f of k?.fields || []) {
    const v = specs[f.key];
    if (v && (!f.options || f.options.includes(v))) out[f.key] = v;
    else if (f.default) out[f.key] = f.default;
  }
  return out;
}

function SpecField({ field, value, onChange }) {
  const label = field.label;
  if (field.options) {
    return (
      <Field label={label} required={field.required}>
        <Select value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={field.required ? 'Choose…' : '— not set —'} options={field.options} />
      </Field>
    );
  }
  return (
    <Field label={label} required={field.required}>
      <Input value={value || ''} maxLength={60} placeholder={field.placeholder || ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/**
 * Category → kind → the kind's details → which laptops it fits → the name.
 * `value` = { category, kind, specs, fitment (FitmentPicker shape),
 * name_override, own_name }; `generated` is the name those make.
 * "Part type" is gone: the kind is chosen from a fixed list and stored in
 * parts.part_type by the backend.
 */
export default function PartStructureFields({ value, onChange, generated }) {
  const cat = categorySchema(value.category);
  const kind = kindSchema(value.category, value.kind);
  const rule = fitsRule(value.category, value.kind);
  const patch = (p) => onChange({ ...value, ...p });

  const pickCategory = (c) => {
    const kinds = categorySchema(c)?.kinds || [];
    const k = kinds.length === 1 ? kinds[0].value : '';
    patch({ category: c, kind: k, specs: specsForKind(c, k, value.specs) });
  };
  const pickKind = (k) => patch({ kind: k, specs: specsForKind(value.category, k, value.specs) });
  const setSpec = (key) => (v) => patch({ specs: { ...value.specs, [key]: v } });

  return (
    <div className="c-stack">
      <FormGrid cols={2}>
        <Field label="Category" required>
          <Select value={value.category || ''} onChange={(e) => pickCategory(e.target.value)} placeholder="Choose…" options={PART_CATEGORIES} />
        </Field>
        <Field label="What is it" required hint={cat ? undefined : 'Choose the category first'}>
          <Select
            value={value.kind || ''}
            disabled={!cat}
            onChange={(e) => pickKind(e.target.value)}
            placeholder="Choose…"
            options={(cat?.kinds || []).map((k) => ({ value: k.value, label: k.label }))}
          />
        </Field>
        {(kind?.fields || []).map((f) => (
          <SpecField key={f.key} field={f} value={value.specs?.[f.key]} onChange={setSpec(f.key)} />
        ))}
      </FormGrid>

      {kind && rule !== 'none' && (
        <FitmentPicker
          label={rule === 'required' ? 'Fits laptops (required — a brand and model, or Universal)' : 'Fits laptops (pre-fills at GRN and when units are added)'}
          allowUnset={rule !== 'required'}
          value={value.fitment}
          onChange={(v) => patch({ fitment: v })}
        />
      )}

      <Field label="Part name" hint={value.name_override ? 'Your own name — the details above still decide whether it is a duplicate.' : 'Made from the details above, so the same part always has the same name.'}>
        {value.name_override
          ? <Input value={value.own_name || ''} maxLength={100} onChange={(e) => patch({ own_name: e.target.value })} placeholder={generated || 'Type the part name'} />
          : <div className="c-input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)', color: generated ? 'var(--ink)' : 'var(--ink-4)' }}>{generated || 'Choose the category, what it is and its details'}</div>}
      </Field>
      <Checkbox
        label="Use my own name instead"
        checked={Boolean(value.name_override)}
        onChange={(e) => patch({ name_override: e.target.checked, own_name: e.target.checked ? (value.own_name || generated || '') : value.own_name })}
      />
    </div>
  );
}

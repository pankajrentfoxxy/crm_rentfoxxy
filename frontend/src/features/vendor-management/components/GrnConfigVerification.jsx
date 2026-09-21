import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldOff, ChevronDown } from 'lucide-react';

/**
 * Part 5.1 (finding P5) — the stored GRN configuration verification, on screen.
 *
 * grn_config_verifications has been written on every capture since migration 092
 * and read by nothing. The comparison happened, the result was stored, and no
 * screen could show it — so from the GRN you could not tell a laptop whose
 * hardware was read and matched from one typed in blind.
 *
 * Four states, and the last two matter as much as the first:
 *
 *   matched    the laptop reported its own configuration and it agreed with the PO line
 *   mismatched it reported, and it disagreed — with the fields, so the buyer can argue
 *   waived     it could not be read (a unit that will not power on), with who said so
 *   none       nothing on record, which is what every unit received before this looks like
 */

const STATES = {
  matched: {
    Icon: ShieldCheck,
    label: 'Configuration verified',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    iconTone: 'text-emerald-600',
  },
  mismatched: {
    Icon: ShieldAlert,
    label: 'Configuration did not match',
    tone: 'border-rose-200 bg-rose-50 text-rose-900',
    iconTone: 'text-rose-600',
  },
  waived: {
    Icon: ShieldOff,
    label: 'Verification skipped',
    tone: 'border-amber-200 bg-amber-50 text-amber-900',
    iconTone: 'text-amber-600',
  },
  captured_without_verification: {
    Icon: ShieldQuestion,
    label: 'Captured, no comparison on record',
    tone: 'border-slate-200 bg-slate-50 text-slate-700',
    iconTone: 'text-slate-500',
  },
  none: {
    Icon: ShieldQuestion,
    label: 'No verification on record',
    tone: 'border-slate-200 bg-slate-50 text-slate-600',
    iconTone: 'text-slate-400',
  },
};

const FIELD_LABELS = {
  brand: 'Brand',
  model: 'Model',
  processor: 'Processor',
  generation: 'Generation',
  ram: 'RAM',
  ssd: 'SSD',
  gpu: 'GPU',
};

function fieldLabel(f) {
  return FIELD_LABELS[f] || f;
}

export default function GrnConfigVerification({ verification }) {
  const [open, setOpen] = useState(false);
  const v = verification || { state: 'none' };
  const spec = STATES[v.state] || STATES.none;
  const { Icon } = spec;

  const mismatches = Array.isArray(v.mismatched_fields) ? v.mismatched_fields : [];
  const required = mismatches.filter((m) => m.required !== false);
  const matched = Array.isArray(v.matched_fields) ? v.matched_fields : [];
  const expandable = v.state === 'matched' || v.state === 'mismatched';

  return (
    <div className={`mt-2 rounded-lg border px-2.5 py-2 text-xs ${spec.tone}`}>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        disabled={!expandable}
        className="flex w-full items-start gap-1.5 text-left disabled:cursor-default"
      >
        <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${spec.iconTone}`} />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{spec.label}</span>
          {v.state === 'mismatched' && required.length ? (
            <span>
              {' — '}
              {required.map((m) => fieldLabel(m.field)).join(', ')}
            </span>
          ) : null}
          {v.state === 'waived' && v.reason ? <span className="block font-normal">{v.reason}</span> : null}
          {v.state === 'none' ? (
            <span className="block font-normal">
              Received before configuration verification was recorded against the unit.
            </span>
          ) : null}
        </span>
        {expandable ? (
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 mt-px transition-transform ${open ? 'rotate-180' : ''}`} />
        ) : null}
      </button>

      {open && expandable ? (
        <div className="mt-2 space-y-1.5 border-t border-current/10 pt-2">
          {mismatches.length ? (
            <div>
              <p className="m-0 font-semibold">Differences</p>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                {mismatches.map((m) => (
                  <li key={m.field} className="flex flex-wrap gap-1">
                    <span className="font-medium">{fieldLabel(m.field)}:</span>
                    <span>ordered “{m.expected || '—'}”</span>
                    <span>·</span>
                    <span>received “{m.actual || '—'}”</span>
                    {m.required === false ? <span className="opacity-70">(informational)</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {matched.length ? (
            <p className="m-0">
              <span className="font-semibold">Matched:</span> {matched.map(fieldLabel).join(', ')}
            </p>
          ) : null}
          {v.verified_at ? (
            <p className="m-0 opacity-70">
              Read from the laptop on {new Date(v.verified_at).toLocaleString('en-IN')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

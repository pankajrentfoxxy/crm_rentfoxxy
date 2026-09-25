import React, { useId } from 'react';

/**
 * Form primitives for the working screens (create, edit, approve, dispatch).
 *
 * A Field owns its label, hint and error so every form in Carret reads the
 * same way: the label above, the control, then the one line that says what is
 * wrong. The error replaces the hint rather than stacking under it, so a form
 * with problems does not grow taller than the one without.
 *
 * Every size reads a density token, so the same form works at desk and at the
 * floor-density gate.
 */
export function Field({ label, hint, error, required, children, className = '', span }) {
  const id = useId();
  const control = React.isValidElement(children)
    ? React.cloneElement(children, {
      id: children.props.id || id,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error || hint ? `${id}-note` : undefined,
    })
    : children;
  return (
    <div className={`c-field ${className}`} style={span ? { gridColumn: `span ${span}` } : undefined}>
      {label && (
        <label htmlFor={children?.props?.id || id} className="c-label">
          {label}{required && <span className="c-req" aria-hidden="true"> *</span>}
        </label>
      )}
      {control}
      {(error || hint) && (
        <div id={`${id}-note`} className={error ? 'c-note is-error' : 'c-note'}>{error || hint}</div>
      )}
    </div>
  );
}

export const Input = React.forwardRef(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`c-input ${className}`} {...rest} />;
});

export function Select({ options = [], placeholder, className = '', ...rest }) {
  return (
    <select className={`c-input c-select-full ${className}`} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  );
}

export function Textarea({ className = '', rows = 3, ...rest }) {
  return <textarea rows={rows} className={`c-input c-textarea ${className}`} {...rest} />;
}

export function Checkbox({ label, className = '', ...rest }) {
  return (
    <label className={`c-check ${className}`}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/** Responsive grid for fields: `cols` on desk, one column on a phone. */
export function FormGrid({ cols = 3, children, className = '' }) {
  return (
    <div className={`c-form-grid ${className}`} style={{ '--c-cols': cols }}>
      {children}
    </div>
  );
}

/** A titled block inside a form or record page. */
export function Section({ title, actions, children, className = '' }) {
  return (
    <section className={`c-card ${className}`}>
      {(title || actions) && (
        <div className="c-card-h">
          {title && <h3>{title}</h3>}
          {actions && <div className="flex items-center flex-wrap" style={{ gap: '8px' }}>{actions}</div>}
        </div>
      )}
      <div className="c-card-b">{children}</div>
    </section>
  );
}

/**
 * An inline message. Tone is one of good | warn | serious | crit | info, and
 * it always carries a glyph and words — never colour alone.
 */
const NOTICE_GLYPH = { good: '✓', warn: '⚠', serious: '!', crit: '✕', info: 'i' };
export function Notice({ tone = 'info', title, children, action, className = '' }) {
  return (
    <div className={`c-notice is-${tone} ${className}`} role={tone === 'crit' ? 'alert' : 'status'}>
      <span className="c-notice-g" aria-hidden="true">{NOTICE_GLYPH[tone] || 'i'}</span>
      <div className="min-w-0" style={{ flex: 1 }}>
        {title && <div className="c-notice-t">{title}</div>}
        {children && <div className="c-notice-b">{children}</div>}
      </div>
      {action && <div style={{ flex: 'none' }}>{action}</div>}
    </div>
  );
}

/** Label/value pairs for record pages. items: [{ label, value }] */
export function KeyValue({ items = [], cols = 3, className = '' }) {
  return (
    <dl className={`c-kv ${className}`} style={{ '--c-cols': cols }}>
      {items.filter(Boolean).map((m) => (
        <div key={m.label} className="min-w-0">
          <dt>{m.label}</dt>
          <dd>{m.value === undefined || m.value === null || m.value === '' ? '—' : m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** tabs: [{ key, label, count? }] */
export function Tabs({ tabs = [], value, onChange, className = '' }) {
  return (
    <div className={`c-tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className={value === t.key ? 'is-on' : ''}
          onClick={() => onChange?.(t.key)}
        >
          {t.label}
          {t.count != null && <span className="c-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Where a document sits in its flow — Quotation → Order → Challan → Gate →
 * Delivered. steps: [{ key, label, state: 'done'|'current'|'todo'|'blocked', sub?, onClick? }]
 */
const STEP_GLYPH = { done: '✓', current: '●', todo: '○', blocked: '!' };
export function FlowSteps({ steps = [], className = '' }) {
  return (
    <ol className={`c-flow ${className}`}>
      {steps.map((s, i) => (
        <li key={s.key || i} className={`is-${s.state || 'todo'}`}>
          <button type="button" onClick={s.onClick} disabled={!s.onClick} className="c-flow-b">
            <span className="c-flow-g" aria-hidden="true">{STEP_GLYPH[s.state] || '○'}</span>
            <span className="min-w-0">
              <span className="c-flow-l">{s.label}</span>
              {s.sub && <span className="c-flow-s">{s.sub}</span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

import React from 'react';

/**
 * One primary action per screen, in accent. Accent is interaction only — it
 * never encodes state — so a Button never takes a lifecycle family.
 */
const VARIANTS = {
  primary: 'c-btn--primary',
  secondary: '',
  quiet: 'c-btn--quiet',
};

export default function Button({ variant = 'secondary', children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`c-btn ${VARIANTS[variant] ?? ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * One choice from a few (Book: Both / RentFoxxy / Gorefurbo). A row of
 * primary/secondary buttons says "several actions"; this says "one setting".
 * options: [{ value, label, icon? }]
 */
export function Segmented({ options = [], value, onChange, label }) {
  return (
    <div className="c-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={value === o.value ? 'is-on' : ''}
          onClick={() => onChange?.(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

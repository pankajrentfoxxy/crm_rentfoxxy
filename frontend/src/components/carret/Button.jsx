import React from 'react';

/**
 * One primary action per screen, in accent. Accent is interaction only — it
 * never encodes state — so a Button never takes a lifecycle family.
 */
const VARIANTS = {
  primary:  { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-ink)' },
  secondary:{ background: 'var(--surface-2)', borderColor: 'var(--rule)', color: 'var(--ink)' },
  quiet:    { background: 'transparent', borderColor: 'transparent', color: 'var(--accent)' },
};

export default function Button({ variant = 'secondary', children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`font-ui border inline-flex items-center justify-center cursor-pointer ${className}`}
      style={{
        ...VARIANTS[variant] || VARIANTS.secondary,
        padding: 'var(--d-pad-y) var(--d-pad-x)',
        minHeight: 'var(--d-tap)',
        borderRadius: 'var(--d-radius)',
        fontSize: 'var(--d-base)',
        gap: 'var(--d-gap)',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

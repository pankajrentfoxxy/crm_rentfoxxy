import React from 'react';
import { resolveEntity } from '../../config/entities';

/**
 * The 4px left edge that says which book a record belongs to.
 *
 * It is neither accent nor lifecycle: it never encodes state and it never
 * recolours a surface. The label is read from config/entities.js, never
 * hardcoded — the sale book's brand name is not settled and renaming it must
 * cost one string.
 */
export default function EntityEdge({ entity, children, showLabel = false, className = '' }) {
  const meta = resolveEntity(entity);
  if (!meta) return <div className={className}>{children}</div>;

  return (
    <div
      className={`border-l-4 ${className}`}
      style={{ borderLeftColor: `var(${meta.edgeVar})`, paddingLeft: 'var(--d-pad-x)' }}
      data-entity={meta.key}
    >
      {showLabel && (
        <div
          className="font-ui uppercase tracking-wide text-ink-3"
          style={{ fontSize: 'var(--d-sm)', marginBottom: 'var(--d-gap)' }}
        >
          {meta.label}
        </div>
      )}
      {children}
    </div>
  );
}

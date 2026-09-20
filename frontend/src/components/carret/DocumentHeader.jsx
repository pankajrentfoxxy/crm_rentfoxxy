import React from 'react';
import DocNumber from './DocNumber';
import StatusChip from './StatusChip';
import { resolveEntity } from '../../config/entities';

/**
 * One header for every document screen — DC, SO, GRN, invoice, ticket.
 *
 * It is one component so a challan and an invoice cannot drift apart. Today
 * each screen draws its own, which is why the same document number sits in a
 * different place on every page.
 */
export default function DocumentHeader({
  docNumber, type, entity, status, actions, meta = [], className = '',
}) {
  const ent = resolveEntity(entity);
  return (
    <header
      className={`bg-surface border border-rule ${className}`}
      style={{
        borderRadius: 'var(--d-radius)',
        borderLeft: ent ? `4px solid var(${ent.edgeVar})` : undefined,
        padding: 'var(--d-pad-x)',
      }}
      data-entity={ent?.key || ''}
    >
      <div className="flex flex-wrap items-baseline" style={{ gap: 'var(--d-pad-x)' }}>
        <div className="min-w-0">
          <div className="text-ink-3 font-ui uppercase tracking-wide" style={{ fontSize: 'var(--d-sm)' }}>
            {type}{ent ? ` · ${ent.label}` : ''}
          </div>
          <div className="text-ink" style={{ fontSize: 'var(--d-lg)', fontWeight: 600, marginTop: 'var(--d-gap)' }}>
            <DocNumber value={docNumber} />
          </div>
        </div>
        {status && <StatusChip status={status} />}
        {actions && <div className="ml-auto flex flex-wrap items-center" style={{ gap: 'var(--d-gap)' }}>{actions}</div>}
      </div>

      {meta.length > 0 && (
        <dl
          className="grid border-t border-rule"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 'var(--d-pad-x)',
            marginTop: 'var(--d-pad-x)',
            paddingTop: 'var(--d-pad-x)',
          }}
        >
          {meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{m.label}</dt>
              <dd className="text-ink font-ui m-0 break-words" style={{ fontSize: 'var(--d-base)' }}>{m.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

import React, { useMemo } from 'react';
import { formatDate } from './DateTime';
import EmptyState from './EmptyState';

/**
 * The component this ERP most needs and cannot currently render for any entity.
 *
 * A laptop's life crosses PO, GRN, production, QC, sales order, DC, gate,
 * delivery, support, return and billing. Today that history is spread across
 * ttspl_audit_log and inventory_status_transitions, which disagree with each
 * other (finding I15), plus three partial trails and no trail at all for
 * billing or DC status.
 *
 * Part 1 renders it from a fixture. Part 2.1 builds the single append-only
 * events table and wires this to it unchanged — the shape below IS that table's
 * row: occurred_at, actor_name, event_type, from_state, to_state, entity_ref.
 *
 * Grouped by day, and no pagination: a 200-event history is a normal laptop and
 * paginating it hides exactly the pattern you opened the timeline to find.
 */
export default function Timeline({ events = [], className = '' }) {
  const days = useMemo(() => {
    const byDay = new Map();
    [...events]
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
      .forEach((e) => {
        const key = formatDate(e.occurred_at, 'long');
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(e);
      });
    return [...byDay.entries()];
  }, [events]);

  if (!events.length) {
    return <EmptyState title="No history yet" body="Events appear here as the asset moves." />;
  }

  return (
    <div className={`font-ui ${className}`} style={{ fontSize: 'var(--d-base)' }}>
      {days.map(([day, items]) => (
        <section key={day} style={{ marginBottom: 'calc(var(--d-gap) * 4)' }}>
          <h3
            className="text-ink-3 uppercase tracking-wide border-b border-rule"
            style={{ fontSize: 'var(--d-sm)', fontWeight: 600, paddingBottom: 'var(--d-gap)', marginBottom: 'var(--d-gap)' }}
          >
            {day}
          </h3>
          <ol className="list-none p-0 m-0">
            {items.map((e, i) => (
              <li
                key={e.event_id ?? `${day}-${i}`}
                className="flex items-baseline border-l-2 border-rule-2"
                style={{ gap: 'var(--d-pad-x)', padding: 'var(--d-pad-y) var(--d-pad-x)' }}
              >
                <time className="font-mono tabular-nums text-ink-3 whitespace-nowrap" style={{ fontSize: 'var(--d-sm)' }}>
                  {formatDate(e.occurred_at, 'datetime').split(', ')[1] || '--:--'}
                </time>
                <div className="min-w-0 flex-1">
                  <div className="text-ink">
                    {e.event_type}
                    {e.from_state && e.to_state && (
                      <span className="text-ink-2"> · {e.from_state} → {e.to_state}</span>
                    )}
                  </div>
                  <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
                    {e.actor_name || 'system'}
                    {e.entity_ref ? ` · ${e.entity_ref}` : ''}
                    {e.source ? ` · ${e.source}` : ''}
                  </div>
                  {e.note && <div className="text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>{e.note}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

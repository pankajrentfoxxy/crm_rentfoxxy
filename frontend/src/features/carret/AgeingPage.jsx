import React, { useMemo, useState, useCallback } from 'react';
import DeskShell from '../../shells/DeskShell';
import {
  DataTable, EmptyState, Button, Money, StatTile,
} from '../../components/carret';
import { useAgeing, runOverdueSweep } from './useMoney';

/**
 * Ageing & Outstanding (Part 6.4).
 *
 * This screen could not have been built before Part 6.2, because the two facts
 * it rests on did not exist. Invoices had no due date, so there was nothing to
 * be overdue against; and nothing ever moved an invoice from sent to overdue
 * (BL9), so the overdue figure on the old finance screen was permanently zero.
 *
 * The buckets are the standard five. The one that matters is 90+: money that
 * old is usually money in dispute or money gone, and until now nothing in this
 * system could tell you it existed.
 */

const BUCKETS = [
  { key: 'not_due', label: 'Not due' },
  { key: 'days_1_30', label: '1–30 days' },
  { key: 'days_31_60', label: '31–60' },
  { key: 'days_61_90', label: '61–90' },
  { key: 'days_90_plus', label: '90+' },
];

export default function AgeingPage() {
  const { loading, error, rows, totals, refresh } = useAgeing({});
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState('');

  const onSweep = useCallback(async () => {
    setSweeping(true);
    setSweepNote('');
    try {
      const { data } = await runOverdueSweep();
      setSweepNote(data?.message || 'Sweep complete');
      refresh();
    } catch (err) {
      setSweepNote(err?.response?.data?.message || 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  }, [refresh]);

  const columns = useMemo(() => [
    { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}` },
    { key: 'invoice_count', header: 'Invoices', numeric: true },
    ...BUCKETS.map((b) => ({
      key: b.key,
      header: b.label,
      numeric: true,
      render: (r) => {
        const v = Number(r[b.key] || 0);
        if (!v) return <span className="text-ink-3">—</span>;
        const severe = b.key === 'days_90_plus';
        const warn = b.key === 'days_61_90';
        return (
          <span style={{ color: severe ? 'var(--alert-crit)' : warn ? 'var(--alert-serious)' : undefined }}>
            <Money value={v} showZero={false} />
          </span>
        );
      },
    })),
    {
      key: 'outstanding',
      header: 'Outstanding',
      numeric: true,
      render: (r) => <strong><Money value={r.outstanding} /></strong>,
    },
  ], []);

  return (
    <DeskShell
      title="Ageing & Outstanding"
      breadcrumb="Money"
      actions={(
        <Button variant="secondary" onClick={onSweep} disabled={sweeping}>
          {sweeping ? 'Running…' : 'Run overdue sweep'}
        </Button>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--d-pad-x)' }}>
        <div
          style={{
            display: 'grid',
            gap: 'var(--d-gap)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          }}
        >
          <StatTile
            label="Total outstanding"
            value={loading ? null : <Money value={totals.outstanding || 0} />}
          />
          {BUCKETS.map((b) => (
            <StatTile
              key={b.key}
              label={b.label}
              value={loading ? null : <Money value={totals[b.key] || 0} showZero />}
              family={b.key === 'days_90_plus' && Number(totals[b.key] || 0) > 0 ? 'offcycle' : undefined}
            />
          ))}
        </div>

        {sweepNote ? (
          <p className="font-ui text-ink-2 m-0" style={{ fontSize: 'var(--d-sm)' }}>{sweepNote}</p>
        ) : null}

        {loading && <EmptyState title="Loading…" />}
        {error && <EmptyState title="Could not load ageing" body={error} />}
        {!loading && !error && (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.customer_id}
            empty={(
              <EmptyState
                title="Nothing outstanding"
                body={
                  'Only issued invoices age. An invoice still in draft has not been sent to '
                  + 'anybody, so it is not owed — and drafts are excluded here deliberately.'
                }
              />
            )}
          />
        )}
      </div>
    </DeskShell>
  );
}

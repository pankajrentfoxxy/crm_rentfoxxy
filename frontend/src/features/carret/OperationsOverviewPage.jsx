import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import { StatTile, EmptyState, Button } from '../../components/carret';
import { useFleetCounts } from './useAssets';

/**
 * The Operations overview (Part 2.7).
 *
 * Part 2 puts this here rather than in Part 1 for one reason: 2.6 is what makes
 * its numbers true. Before that, "Ready stock" filtered on qc_status='qc_passed'
 * and "Currently rented" on inventory_status='out_stock' — values NO code
 * writes — so both tiles read 0 against a real fleet of 1,693 available and
 * 3,132 rented. The plan says to build this only after 2.6's hand-verification,
 * and that is the order it was built in.
 *
 * Every tile drills to the list behind it. A number nobody can open is a number
 * nobody can check.
 */
const FAMILY_BY_TILE = {
  available: 'idle',
  rented: 'earning',
  moving: 'moving',
  offcycle: 'offcycle',
  closed: 'closed',
};

export default function OperationsOverviewPage() {
  const navigate = useNavigate();
  const { loading, error, counts } = useFleetCounts();

  const tiles = useMemo(() => {
    if (!counts) return [];
    const n = (...keys) => keys.reduce((sum, k) => sum + (Number(counts[k]) || 0), 0);

    return [
      {
        label: 'Ready to rent or sell', value: n('passed', 'available', 'in_stock'),
        family: FAMILY_BY_TILE.available, to: '/carret/stock/assets?segment=passed',
        note: 'One predicate, shared with order attach',
      },
      {
        label: 'With customers', value: n('rented', 'out_stock', 'on_demo'),
        family: FAMILY_BY_TILE.rented, to: '/carret/stock/assets?segment=rented',
        note: 'Rented and on demo',
      },
      {
        label: 'Moving', value: n('reserved', 'dispatch_ready', 'in_transit'),
        family: FAMILY_BY_TILE.moving, to: '/carret/stock/assets?segment=moving',
        note: 'Reserved, on a challan, or in transit',
      },
      {
        label: 'Off cycle', value: n('returned', 'in_repair', 'qc_failed'),
        family: FAMILY_BY_TILE.offcycle, to: '/carret/stock/assets?segment=qc_pending',
        note: 'Back in the building, on the bench, or failed QC',
      },
      {
        label: 'Closed', value: n('sold', 'scrapped', 'dead_laptops'),
        family: FAMILY_BY_TILE.closed, to: '/carret/stock/assets?segment=dead_laptops',
        note: 'Sold or scrapped — terminal',
      },
      {
        // The bucket that was counted nowhere. Decision D1: 1,345 real laptops
        // with a TTSPL and a serial that never went through GRN, and which until
        // Part 2.5 every availability query read as in_stock.
        label: 'Awaiting GRN', value: n('awaiting_grn', 'null_status'),
        family: null, to: '/carret/stock/assets?segment=awaiting_grn',
        note: 'Has a code and a serial, never inspected',
      },
    ];
  }, [counts]);

  return (
    <DeskShell title="Operations" breadcrumb="Overview">
      {loading && <EmptyState title="Loading…" />}
      {error && <EmptyState title="Could not load the fleet" body={error} />}

      {!loading && !error && (
        <div style={{ display: 'grid', gap: 'var(--d-pad-x)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--d-pad-x)' }}>
            {tiles.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => navigate(t.to)}
                className="text-left bg-transparent border-0 p-0 cursor-pointer"
              >
                <StatTile label={t.label} value={t.value} family={t.family} delta={t.note} />
              </button>
            ))}
          </div>

          <p className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)', maxWidth: '72ch' }}>
            Every figure above counts a canonical lifecycle status or the single availability
            predicate, so each one traces to a value some code actually writes. Tiles that had no
            real source have been removed rather than left showing zero.
          </p>

          <div>
            <Button variant="secondary" onClick={() => navigate('/carret/stock/assets')}>
              Open the asset list
            </Button>
          </div>
        </div>
      )}
    </DeskShell>
  );
}

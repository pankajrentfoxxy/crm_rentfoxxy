import React, { useState, useCallback } from 'react';
import GateShell from '../../shells/GateShell';
import { ScanPanel, DocNumber, EmptyState, Button, DateTime } from '../../components/carret';
import { useChallans, useGatePreflight } from './useDeliveryChallans';

/**
 * The Guard Gate (Part 3.7, Decision 4).
 *
 * This is the load-bearing screen of Part 3. Decision 4 makes the gate *the*
 * gate: a laptop stays Dispatch Ready until the guard scans it out, and that
 * scan is what means it left the warehouse — it starts the rent clock.
 *
 * Floor density, scan-first, two modes and nothing else. Every control that is
 * not the scanner is a control that can steal its focus, and a guard with a
 * wedge scanner has no keyboard and no mouse.
 *
 * The pre-flight panel is the part that changes the job. Before Part 3.2 the
 * gate checked only that the challan was not cancelled; now the guard is told
 * which check failed and can see it BEFORE scanning twelve units, rather than
 * after submitting them.
 */
export default function GuardGatePage() {
  const [mode, setMode] = useState('outward');
  const [selected, setSelected] = useState(null);

  const { loading, error, rows } = useChallans({
    status: mode === 'outward' ? 'dispatch_ready' : 'in_transit',
    movement: mode === 'outward' ? 'outbound' : 'return',
  });

  const preflight = useGatePreflight(mode === 'outward' ? selected : null);

  const onScan = useCallback(({ code, result }) => {
    // Audible confirmation matters more than visual on a loading bay.
    if (result !== 'matched' && typeof window !== 'undefined' && window.navigator?.vibrate) {
      window.navigator.vibrate(200);
    }
  }, []);

  const expected = (rows || [])
    .filter((r) => !selected || r.dc_number === selected)
    .map((r) => ({
      code: r.inventory_asset_code || r.ttspl_id || r.serial_number,
      label: [r.brand, r.model].filter(Boolean).join(' ') || r.dc_number,
    }))
    .filter((e) => e.code);

  return (
    <GateShell
      mode={mode}
      onModeChange={(m) => { setMode(m); setSelected(null); }}
      title={mode === 'outward' ? 'Gate — going out' : 'Gate — coming in'}
    >
      <div style={{ display: 'grid', gap: 'var(--d-pad-x)' }}>
        {loading && <EmptyState title="Loading…" />}
        {error && <EmptyState title="Could not load challans" body={error} />}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            title={mode === 'outward' ? 'Nothing waiting to go out' : 'Nothing expected in'}
            body={mode === 'outward'
              ? 'Challans appear here once they reach dispatch ready.'
              : 'Units in transit appear here when they arrive.'}
          />
        )}

        {rows.length > 0 && (
          <section>
            <h2 className="font-ui text-ink" style={{ fontSize: 'var(--d-lg)', fontWeight: 700, marginBottom: 'var(--d-gap)' }}>
              {mode === 'outward' ? 'Waiting to leave' : 'Expected to arrive'}
            </h2>
            <div className="flex flex-wrap" style={{ gap: 'var(--d-gap)' }}>
              {[...new Set(rows.map((r) => r.dc_number))].filter(Boolean).map((dc) => (
                <Button
                  key={dc}
                  variant={selected === dc ? 'primary' : 'secondary'}
                  onClick={() => setSelected(selected === dc ? null : dc)}
                >
                  {dc}
                </Button>
              ))}
            </div>
          </section>
        )}

        {/* The pre-flight. Decision 4 turns the gate from a scan that confirms
            into a checklist that can refuse, and this is where the guard sees
            it — with the challan still at dispatch_ready. */}
        {mode === 'outward' && selected && (
          <section
            className="border"
            style={{
              padding: 'var(--d-pad-x)',
              borderRadius: 'var(--d-radius)',
              borderColor: preflight.ok === false ? 'var(--alert-crit)' : 'var(--rule)',
            }}
          >
            <div className="flex items-baseline" style={{ gap: 'var(--d-pad-x)' }}>
              <h3 className="font-ui text-ink m-0" style={{ fontSize: 'var(--d-base)', fontWeight: 700 }}>
                Pre-flight — <DocNumber value={selected} />
              </h3>
              {preflight.loading && <span className="font-ui text-ink-3">checking…</span>}
              {preflight.ok === true && (
                <span className="font-ui" style={{ color: 'var(--alert-good)' }}>✓ clear to go out</span>
              )}
            </div>

            {preflight.ok === false && (
              <ul className="list-none p-0" style={{ marginTop: 'var(--d-gap)' }}>
                {preflight.failures.map((f) => (
                  <li
                    key={f.code}
                    className="font-ui"
                    style={{ color: 'var(--alert-crit)', padding: 'var(--d-pad-y) 0', fontSize: 'var(--d-base)' }}
                  >
                    ✕ {f.message}
                  </li>
                ))}
                <li className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)', paddingTop: 'var(--d-gap)' }}>
                  This challan stays at dispatch ready. Nothing has been scanned out.
                </li>
              </ul>
            )}
          </section>
        )}

        {/* Scanning is only offered once the challan is clear. Letting a guard
            scan a consignment that cannot leave is how the old gate wasted
            their time and then refused at the end. */}
        {selected && (mode === 'inward' || preflight.ok === true) && (
          <ScanPanel
            expected={expected}
            onScan={onScan}
            title={mode === 'outward' ? 'Scan each unit out' : 'Scan each unit in'}
          />
        )}

        {mode === 'inward' && selected && (
          <p className="font-ui text-ink-2" style={{ fontSize: 'var(--d-base)', maxWidth: '60ch' }}>
            Confirming inward puts these units <strong>at the gate</strong>, in your custody.
            Inventory collects them from you as a separate step — that second step is what
            makes custody recordable.
          </p>
        )}
      </div>
    </GateShell>
  );
}

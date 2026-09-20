import React from 'react';
import DensityProvider from './DensityProvider';

/**
 * The guard. Floor density, scan-first.
 *
 * No sidebar, no breadcrumb, no search — a guard has one job in one of two
 * directions, and every control that is not the scanner is a control that can
 * steal its focus.
 *
 * Two modes only, Outward and Inward, switched by a single control. Decision 4
 * makes this shell load-bearing: the gate scan is what means a laptop left the
 * warehouse, and inward custody is the thing that cannot be recorded today.
 */
export default function GateShell({ mode = 'outward', onModeChange, title, children }) {
  return (
    <DensityProvider density="floor">
      <div className="flex flex-col min-h-screen">
        <header
          className="bg-surface border-b-2 border-rule-2 flex items-center flex-wrap"
          style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', gap: 'var(--d-pad-x)' }}
        >
          <h1 className="text-ink font-ui m-0" style={{ fontSize: 'var(--d-lg)', fontWeight: 700 }}>
            {title || 'Guard gate'}
          </h1>

          <div
            role="radiogroup"
            aria-label="Direction"
            className="ml-auto flex border border-rule-2"
            style={{ borderRadius: 'var(--d-radius)' }}
          >
            {['outward', 'inward'].map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onModeChange?.(m)}
                  className="font-ui cursor-pointer border-0"
                  style={{
                    padding: 'var(--d-pad-y) var(--d-pad-x)',
                    minHeight: 'var(--d-tap)',
                    fontSize: 'var(--d-base)',
                    textTransform: 'capitalize',
                    background: on ? 'var(--accent)' : 'transparent',
                    color: on ? 'var(--accent-ink)' : 'var(--ink-2)',
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden" style={{ padding: 'var(--d-pad-x)' }}>{children}</main>
      </div>
    </DensityProvider>
  );
}

import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import DensityProvider from './DensityProvider';

/**
 * Support technician, tablet. One task per screen, back always visible, bottom
 * tabs rather than a sidebar — a thumb reaches the bottom of a tablet and not
 * the left edge of it.
 *
 * Offline-tolerant by contract: `pending` is the count of writes queued locally
 * and not yet acknowledged. It is shown always, not only when non-zero is
 * convenient, because a technician needs to know before walking out of signal
 * whether their work has actually left the device.
 */
export default function FieldShell({ title, tabs = [], pending = 0, onBack, children }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <DensityProvider density="field">
      <div className="flex flex-col min-h-screen">
        <header
          className="bg-surface border-b border-rule flex items-center sticky top-0 z-20"
          style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', gap: 'var(--d-pad-x)' }}
        >
          <button
            type="button"
            onClick={onBack || (() => navigate(-1))}
            aria-label="Back"
            className="bg-transparent border-0 text-ink-2 cursor-pointer font-ui"
            style={{ minHeight: 'var(--d-tap)', minWidth: 'var(--d-tap)', fontSize: 'var(--d-lg)' }}
          >
            {'‹'}
          </button>
          <h1 className="text-ink font-ui m-0 truncate" style={{ fontSize: 'var(--d-lg)', fontWeight: 600 }}>{title}</h1>
          <span
            className="ml-auto font-mono tabular-nums"
            title={pending ? `${pending} change(s) waiting to sync` : 'All changes synced'}
            style={{ fontSize: 'var(--d-sm)', color: pending ? 'var(--alert-warn)' : 'var(--ink-3)' }}
          >
            {pending ? `● ${pending} pending` : '✓ synced'}
          </span>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden" style={{ padding: 'var(--d-pad-x)' }}>{children}</main>

        {tabs.length > 0 && (
          <nav
            aria-label="Sections"
            className="bg-surface border-t border-rule flex sticky bottom-0 z-20"
          >
            {tabs.map((t) => {
              const active = pathname.startsWith(t.to);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`flex-1 text-center font-ui ${active ? 'text-accent' : 'text-ink-3'}`}
                  style={{ padding: 'var(--d-pad-y)', minHeight: 'var(--d-tap)', fontSize: 'var(--d-sm)' }}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </DensityProvider>
  );
}

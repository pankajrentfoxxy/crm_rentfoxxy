import React, { useState, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import DensityProvider from './DensityProvider';
import ThemeToggle from './ThemeToggle';
import { SECTIONS } from '../config/navigation';
import { usePermission } from '../hooks/usePermission';

/**
 * Replaces Layout.jsx — 1,605 lines, three dead renderers, a non-collapsible
 * w-64 sidebar and a static topbar title.
 *
 * ONE openSection state, not thirteen booleans. Thirteen independent flags is
 * why sections could only ever be open one at a time by accident rather than by
 * design; making it one value makes that behaviour deliberate and removes
 * twelve chances to get it wrong.
 *
 * Visibility comes from usePermission — the existing hook, which reads the same
 * matrix the backend enforces. Nothing here reads user.role (finding X6), and
 * no route-prefix helper exists (isPartsManagementRoute and its eight hardcoded
 * prefixes are not carried over).
 */
export default function DeskShell({ title, breadcrumb, actions, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const { hasPermission } = usePermission();

  const [openSection, setOpenSection] = useState(() => {
    const match = SECTIONS.find((s) => s.items.some((i) => here.startsWith(i.to.split('?')[0])));
    return match?.key || SECTIONS[0].key;
  });

  // A section with no visible children does not render at all — an empty
  // accordion that opens onto nothing is worse than an absent one.
  // A section may declare `groups` (Move does: Outward / Inward / Gate). Items
  // keep their flat order; the groups are a rendering concern, so a section
  // without them renders exactly as before under a single unnamed group.
  const visible = useMemo(
    () => SECTIONS
      .map((s) => {
        const items = s.items.filter((i) => hasPermission(i.section, i.action));
        const names = s.groups || [];
        const groups = names.length
          ? names
              .map((name) => ({ name, items: items.filter((i) => i.group === name) }))
              .filter((g) => g.items.length > 0)
          : [{ name: null, items }];
        // anything with an unrecognised or missing group still renders
        const grouped = new Set(groups.flatMap((g) => g.items));
        const rest = items.filter((i) => !grouped.has(i));
        if (rest.length) groups.push({ name: null, items: rest });
        return { ...s, items, groups };
      })
      .filter((s) => s.items.length > 0),
    [hasPermission]
  );

  const toggle = useCallback((key) => setOpenSection((k) => (k === key ? null : key)), []);

  return (
    <DensityProvider density="desk">
      <div className="flex min-h-screen">
        <nav
          aria-label="Main"
          className="shrink-0 bg-surface border-r border-rule flex flex-col"
          style={{ width: collapsed ? 'calc(var(--d-tap) + var(--d-pad-x))' : '15rem', transition: 'width .15s' }}
        >
          <div className="flex items-center border-b border-rule" style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', gap: 'var(--d-gap)' }}>
            {!collapsed && <span className="font-ui text-ink" style={{ fontWeight: 700 }}>Carret</span>}
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-expanded={!collapsed}
              className="ml-auto bg-transparent border-0 text-ink-2 cursor-pointer font-ui"
              style={{ minHeight: 'var(--d-tap)', minWidth: 'var(--d-tap)' }}
            >
              {collapsed ? '»' : '«'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visible.map((s) => {
              const open = openSection === s.key;
              return (
                <div key={s.key}>
                  <button
                    type="button"
                    onClick={() => toggle(s.key)}
                    aria-expanded={open}
                    title={collapsed ? s.label : undefined}
                    className="w-full flex items-center bg-transparent border-0 text-ink-2 cursor-pointer font-ui text-left hover:bg-surface-2"
                    style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'var(--d-tap)', fontSize: 'var(--d-sm)', gap: 'var(--d-gap)' }}
                  >
                    <span className="uppercase tracking-wide truncate">{collapsed ? s.label.slice(0, 2) : s.label}</span>
                    {!collapsed && <span className="ml-auto text-ink-3" aria-hidden="true">{open ? '−' : '+'}</span>}
                  </button>

                  {open && !collapsed && (
                    <ul className="list-none m-0 p-0">
                      {s.groups.map((g) => (
                        <React.Fragment key={g.name || '_'}>
                          {g.name && (
                            <li
                              className="text-ink-3 uppercase tracking-wide font-ui"
                              style={{
                                padding: 'var(--d-pad-y) var(--d-pad-x)',
                                paddingLeft: 'calc(var(--d-pad-x) * 2)',
                                fontSize: 'var(--d-xs, var(--d-sm))',
                              }}
                            >
                              {g.name}
                            </li>
                          )}
                          {g.items.map((i) => {
                            const active = here.startsWith(i.to.split('?')[0]);
                            return (
                              <li key={i.to}>
                                <Link
                                  to={i.to}
                                  className={`block font-ui truncate ${active ? 'text-accent bg-accent-soft' : 'text-ink-2 hover:bg-surface-2'}`}
                                  style={{
                                    padding: 'var(--d-pad-y) var(--d-pad-x)',
                                    paddingLeft: g.name
                                      ? 'calc(var(--d-pad-x) * 3)'
                                      : 'calc(var(--d-pad-x) * 2)',
                                    minHeight: 'var(--d-tap)',
                                    fontSize: 'var(--d-base)',
                                    lineHeight: 'var(--d-tap)',
                                  }}
                                >
                                  {i.label}
                                </Link>
                              </li>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          <header
            className="bg-surface border-b border-rule flex items-center flex-wrap"
            style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', gap: 'var(--d-pad-x)' }}
          >
            <div className="min-w-0">
              {breadcrumb && <div className="text-ink-3 font-ui truncate" style={{ fontSize: 'var(--d-sm)' }}>{breadcrumb}</div>}
              {/* The actual page title. The legacy topbar shows a constant. */}
              <h1 className="text-ink font-ui m-0 truncate" style={{ fontSize: 'var(--d-lg)', fontWeight: 600 }}>{title}</h1>
            </div>
            <div className="ml-auto flex items-center" style={{ gap: 'var(--d-gap)' }}>
              {actions}
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 min-w-0 overflow-x-hidden" style={{ padding: 'var(--d-pad-x)' }}>
            {children}
          </main>
        </div>
      </div>
    </DensityProvider>
  );
}

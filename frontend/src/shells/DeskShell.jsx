import React, { useState, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ShoppingCart, Factory, Package, Tag, Truck, Headphones, Wallet, ShieldCheck,
  ChevronRight, Menu, LayoutGrid,
} from 'lucide-react';
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
 * matrix the backend enforces. Nothing here reads user.role (finding X6) for
 * access; the role is only printed in the footer. No route-prefix helper exists
 * (isPartsManagementRoute and its eight hardcoded prefixes are not carried over).
 */
const SECTION_ICONS = {
  procure: ShoppingCart,
  produce: Factory,
  stock: Package,
  sell: Tag,
  move: Truck,
  serve: Headphones,
  money: Wallet,
  control: ShieldCheck,
};

const humanise = (s) => String(s || '')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

const initialsOf = (name) => String(name || '?')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function DeskShell({ title, subtitle, breadcrumb, actions, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const { hasPermission, user } = usePermission();

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

  // In the collapsed rail a section icon has nowhere to open into, so clicking
  // one expands the rail as well.
  const toggle = useCallback((key) => {
    setCollapsed(false);
    setOpenSection((k) => (k === key ? null : key));
  }, []);

  // One button, two jobs: below 960px the rail is an overlay; above it, it
  // collapses to icons.
  const onMenu = useCallback(() => {
    if (window.matchMedia('(max-width: 960px)').matches) setMobileOpen((o) => !o);
    else setCollapsed((c) => !c);
  }, []);

  const crumbs = breadcrumb ? String(breadcrumb).split('/').map((c) => c.trim()).filter(Boolean) : [];
  const displayName = user?.name || user?.email || 'Signed in';

  return (
    <DensityProvider density="desk">
      <div className={`c-app ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <nav aria-label="Main" className="c-side">
          <div className="c-brand">
            <span className="c-brand-mark" aria-hidden="true">RF</span>
            {!collapsed && (
              <div className="min-w-0">
                <b>Rentfoxxy</b>
                <span>Operations CRM</span>
              </div>
            )}
          </div>

          <div className="c-side-scroll">
            {!collapsed && <div className="c-nav-label">Workspace</div>}
            {visible.map((s) => {
              const open = openSection === s.key;
              const isHere = s.items.some((i) => here.startsWith(i.to.split('?')[0]));
              const Icon = SECTION_ICONS[s.key] || LayoutGrid;
              return (
                <div key={s.key}>
                  <button
                    type="button"
                    onClick={() => toggle(s.key)}
                    aria-expanded={open && !collapsed}
                    title={collapsed ? s.label : undefined}
                    className={`c-nav-h ${open && !collapsed ? 'is-open' : ''} ${isHere ? 'is-here' : ''}`}
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    {!collapsed && <span className="truncate">{s.label}</span>}
                    {!collapsed && <ChevronRight size={16} className="c-chev" aria-hidden="true" />}
                  </button>

                  {open && !collapsed && (
                    <ul className="c-nav-sub">
                      {s.groups.map((g) => (
                        <React.Fragment key={g.name || '_'}>
                          {g.name && <li className="c-nav-group">{g.name}</li>}
                          {g.items.map((i) => {
                            const active = here.startsWith(i.to.split('?')[0]);
                            return (
                              <li key={i.to}>
                                <Link
                                  to={i.to}
                                  onClick={() => setMobileOpen(false)}
                                  aria-current={active ? 'page' : undefined}
                                  className={`c-nav-s ${active ? 'is-current' : ''}`}
                                  title={i.label}
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

          <div className="c-side-foot">
            <span className="c-avatar" aria-hidden="true">{initialsOf(displayName)}</span>
            {!collapsed && (
              <div className="min-w-0">
                <b>{displayName}</b>
                {user?.role && <span>{humanise(user.role)}</span>}
              </div>
            )}
          </div>
        </nav>

        <div className="c-main">
          <header className="c-top">
            <button
              type="button"
              className="c-icon-btn"
              onClick={onMenu}
              aria-label={collapsed ? 'Expand navigation' : 'Toggle navigation'}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            <div className="ml-auto flex items-center" style={{ gap: '8px' }}>
              <ThemeToggle />
            </div>
          </header>

          <main className="c-content">
            {crumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="c-crumbs">
                {crumbs.map((c) => (
                  <React.Fragment key={c}>
                    <span>{c}</span>
                    <span className="c-sep" aria-hidden="true">/</span>
                  </React.Fragment>
                ))}
                <span className="c-crumb-here">{title}</span>
              </nav>
            )}

            <div className="c-ph">
              <div className="min-w-0">
                {/* The actual page title. The legacy topbar shows a constant. */}
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
              {actions && <div className="c-ph-actions">{actions}</div>}
            </div>

            {children}
          </main>
        </div>
      </div>
    </DensityProvider>
  );
}

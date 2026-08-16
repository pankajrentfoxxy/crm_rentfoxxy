import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  BarChart3,
  Boxes,
  CalendarRange,
  CheckCircle2,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Network,
  Package,
  Plus,
  Settings,
  ScanLine,
  Smartphone,
  Timer,
} from 'lucide-react';
import usePermission from '../../hooks/usePermission';
import { fetchSupportV2Badges } from './supportV2Api';

const NAV = [
  {
    group: 'Work',
    items: [
      { to: 'dashboard', label: 'Command centre', icon: LayoutDashboard, section: 'support_dashboard' },
      { to: 'queue', label: 'Ticket queue', icon: ListChecks, section: 'support_tickets', countKey: 'open_tickets' },
      { to: 'dispatch', label: 'Dispatch board', icon: CalendarRange, section: 'support_dispatch', countKey: 'unassigned_wos', danger: true },
      { to: 'parts', label: 'Parts queue', icon: Boxes, section: 'support_parts_approve', countKey: 'parts_pending' },
      { to: 'approvals', label: 'Approvals', icon: CheckCircle2, section: 'support_approvals', countKey: 'approvals_pending', danger: true },
    ],
  },
  {
    group: 'Create',
    items: [
      { to: 'tickets/new', label: 'New ticket', icon: Plus, section: 'support_tickets', action: 'create' },
      { to: 'returns/bulk', label: 'Bulk return', icon: Package, section: 'support_pickup_return', action: 'create' },
    ],
  },
  {
    group: 'Field',
    items: [
      { to: 'bucket', label: 'My bucket', icon: Smartphone, section: 'support_bucket' },
      { to: 'returns/receipt', label: 'Warehouse receipt', icon: ScanLine, section: 'support_pickup_return' },
    ],
  },
  {
    group: 'Manage',
    items: [
      { to: 'sla', label: 'SLA & breaches', icon: Timer, section: 'support_sla_admin' },
      { to: 'taxonomy', label: 'Issue taxonomy', icon: Network, section: 'support_taxonomy' },
      { to: 'reports', label: 'Reports', icon: BarChart3, section: 'support_reports' },
      { to: 'settings', label: 'Settings', icon: Settings, section: 'support_settings' },
      { to: 'foundation', label: 'Design system', icon: LifeBuoy, section: 'support_settings' },
    ],
  },
];

function NavItem({ to, icon: Icon, label, badge, danger }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12.5px] font-medium min-h-[40px] transition-colors
        ${isActive
          ? 'bg-sup-accentSoft text-sup-accent'
          : 'text-sup-ink2 hover:bg-sup-canvas2'}`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 ? (
        <span className={`font-mono tabular-nums text-[10.5px] font-semibold px-1.5 rounded-full
          ${danger ? 'bg-pri1-bg text-pri1' : 'bg-sup-canvas2 text-sup-muted'}`}>
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export default function SupportV2Shell() {
  const { hasPermission } = usePermission();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [badges, setBadges] = useState({});

  useEffect(() => {
    fetchSupportV2Badges()
      .then((r) => setBadges(r.data?.badges || {}))
      .catch(() => setBadges({}));
  }, [location.pathname]);

  const visible = NAV
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => hasPermission(i.section, i.action || 'view')),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-sup-canvas flex">
      <aside className="hidden md:flex w-[232px] shrink-0 flex-col border-r border-sup-lineSoft bg-white">
        <div className="flex items-center gap-2 px-3.5 py-3.5 border-b border-sup-lineSoft">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-sup-accentSoft text-sup-accent">
            <LifeBuoy className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-sup-ink leading-tight">Support</div>
            <Link to="/" className="text-[10px] uppercase tracking-[0.1em] text-sup-faint font-semibold hover:text-sup-accent">
              ← Back to CRM
            </Link>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
          {visible.map((g) => (
            <div key={g.group}>
              <div className="px-2.5 mb-1 text-[9.5px] uppercase tracking-[0.12em] text-sup-faint font-semibold">
                {g.group}
              </div>
              <div className="space-y-0.5">
                {g.items.map((i) => (
                  <NavItem
                    key={i.to}
                    to={i.to}
                    icon={i.icon}
                    label={i.label}
                    badge={i.countKey ? badges[i.countKey] : 0}
                    danger={i.danger}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-sup-lineSoft px-3 py-3">
          <div className="text-[12px] font-semibold text-sup-ink truncate">{user?.name}</div>
          <div className="text-[10px] text-sup-faint uppercase tracking-wide">{user?.role}</div>
          <button
            type="button"
            onClick={() => { logout(); navigate('/login'); }}
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-pri1"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-10 bg-white border-b border-sup-lineSoft px-3 py-2">
          <div className="flex items-center justify-between mb-2">
            <Link to="/" className="text-[11px] font-semibold text-sup-accent">← Back to CRM</Link>
            <span className="text-[11px] text-sup-muted truncate max-w-[50%]">{user?.name}</span>
          </div>
          <div className="flex gap-1.5 min-w-max overflow-x-auto">
            {visible.flatMap((g) => g.items).map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full text-[12px] font-semibold border
                  ${isActive ? 'bg-sup-accent text-white border-sup-accent' : 'bg-white text-sup-ink2 border-sup-line'}`
                }
              >
                {i.label}
              </NavLink>
            ))}
          </div>
        </div>
        <Outlet />
      </div>
    </div>
  );
}

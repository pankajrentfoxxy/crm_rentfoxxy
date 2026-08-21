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
      { to: 'attendance', label: 'Attendance', icon: CheckCircle2, section: 'support_dispatch', action: 'edit' },
      { to: 'parts', label: 'Parts queue', icon: Boxes, section: 'support_parts_approve', countKey: 'parts_pending' },
      { to: 'approvals', label: 'Approvals', icon: CheckCircle2, section: 'support_approvals', countKey: 'approvals_pending', danger: true },
      { to: 'charges', label: 'Charges', icon: CheckCircle2, section: 'support_charges_billing' },
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
      { to: 'bucket', label: 'My jobs', icon: Smartphone, section: 'support_bucket' },
      { to: 'my-parts', label: 'My parts', icon: Package, section: 'support_parts_request' },
      { to: 'warehouse/receipts', label: 'Warehouse receipt', icon: ScanLine, section: 'support_warehouse_receipt' },
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
        `flex items-center gap-2.5 px-2 py-[6.5px] rounded-md text-[12.5px] w-full transition-colors
         ${isActive ? 'bg-sup-accent2 text-white font-medium' : 'text-[#C0C8D4] hover:bg-white/[0.06] hover:text-white'}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="w-[15px] h-[15px] shrink-0 opacity-85" />
          <span className="flex-1 truncate">{label}</span>
          {badge > 0 && (
            <span className={`font-mono tabular-nums text-[10.5px] px-1.5 rounded-[9px]
              ${danger ? 'bg-pri1 text-white' : isActive ? 'bg-black/[0.22] text-white' : 'bg-white/[0.12] text-white'}`}>
              {badge}
            </span>
          )}
        </>
      )}
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
      <aside className="hidden md:flex w-[216px] shrink-0 flex-col bg-sup-ink text-[#C9D0DA] sticky top-0 h-screen overflow-y-auto">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3.5 border-b border-white/[0.08]">
          <span className="grid place-items-center w-6 h-6 rounded-[5px] bg-sup-accent2 text-white text-[12px] font-bold shrink-0">R</span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white tracking-[-0.01em] leading-none">Rentfoxxy</div>
            <div className="text-[10px] uppercase tracking-[0.06em] text-[#7C8798] mt-[3px]">Support console</div>
            <Link to="/" className="text-[10px] text-[#7C8798] hover:text-white">← Back to CRM</Link>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2.5">
          {visible.map((g) => (
            <div key={g.group}>
              <div className="px-2 pt-3 pb-1.5 text-[9.5px] uppercase tracking-[0.1em] text-[#69748A] font-semibold">
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

        <div className="border-t border-white/[0.08] px-4 py-3">
          <div className="text-[12px] font-semibold text-white truncate">{user?.name}</div>
          <div className="text-[10px] uppercase tracking-wide text-[#7C8798]">{user?.role}</div>
          <button
            type="button"
            onClick={() => { logout(); navigate('/login'); }}
            className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#C0C8D4] hover:text-white"
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

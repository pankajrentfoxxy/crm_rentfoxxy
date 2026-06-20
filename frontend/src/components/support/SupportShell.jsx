import React, { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Headphones, LayoutDashboard, Ticket, UserCog, Clock, Truck, MessageSquare,
  Users, Package, Settings, ClipboardList, CheckCircle2, Plus, BarChart2
} from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { canAccessCustomerInventory, isSupportLead, isSupportTechnician } from '../../utils/supportAccess';
import { initials } from './utils';
import './support.css';

const titles = {
  overview: 'Overview',
  stats: 'Stats & Reports',
  dashboard: 'Dashboard',
  tickets: 'All tickets',
  'pending-assign': 'Pending assign',
  overdue: 'Overdue',
  pickups: 'Pickups',
  'pickup-bucket': 'Pickup Bucket',
  'my-pickups': 'My Pickups',
  complaints: 'Complaints',
  'my-tickets': 'My tickets',
  'my-resolved': 'Resolved by me',
  technicians: 'Technicians',
  'tech-bucket': 'Parts bucket',
  'parts-queue': 'Part queue',
  settings: 'Settings',
  new: 'New ticket'
};

function NavItem({ to, icon: Icon, label, badge, badgeDanger }) {
  return (
    <NavLink to={to} className={({ isActive }) => `support-nav-link${isActive ? ' active' : ''}`}>
      <Icon className="w-5 h-5 shrink-0" />
      <span>{label}</span>
      {badge > 0 && <span className={`support-badge${badgeDanger ? ' danger' : ''}`}>{badge}</span>}
    </NavLink>
  );
}

export default function SupportShell() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [badges, setBadges] = useState({});
  const techOnly = isSupportTechnician(user) && !isSupportLead(user);
  const canCreate = isSupportLead(user);

  useEffect(() => {
    api.get('/support/badges').then((r) => setBadges(r.data.badges || {})).catch(() => setBadges({}));
  }, [location.pathname]);

  const pageTitle = useMemo(() => {
    const path = location.pathname.replace(/^\/support\/?/, '');
    if (path.startsWith('tickets/new')) return titles.new;
    if (path.startsWith('tickets/')) return 'Ticket detail';
    if (path.startsWith('challans/')) return 'Challan';
    const key = path.split('/')[0] || 'dashboard';
    return titles[key] || 'Support';
  }, [location.pathname]);

  const roleLabel = user?.role?.replace(/_/g, ' ') || 'User';

  return (
    <div className="support-crm">
      <header className="support-topbar">
        <h1 className="text-lg font-semibold m-0">{pageTitle}</h1>
        <div className="flex items-center gap-3">
          {canCreate && (
            <button type="button" className="support-btn-primary hidden sm:inline-flex items-center gap-2" onClick={() => navigate('/support/tickets/new')}>
              <Plus className="w-4 h-4" /> New ticket
            </button>
          )}
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#534AB7] text-white text-xs font-semibold">
              {initials(user?.name)}
            </span>
            <span className="hidden sm:inline capitalize">{roleLabel}</span>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="support-sidebar hidden md:block">
          <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-200">
            <Headphones className="w-6 h-6 text-[#534AB7]" />
            <span className="font-bold">Support CRM</span>
          </div>

          {techOnly ? (
            <nav>
              <div className="support-nav-label">Work</div>
              <NavItem to="/support/my-tickets" icon={ClipboardList} label="My tickets" badge={badges.my_open} badgeDanger />
              <NavItem to="/support/my-pickups" icon={Truck} label="My pickups" />
              <NavItem to="/support/tech-bucket" icon={Package} label="My parts" />
              <NavItem to="/support/my-resolved" icon={CheckCircle2} label="Resolved by me" badge={badges.my_resolved} />
            </nav>
          ) : (
            <nav>
              <div className="support-nav-label">Overview</div>
              <NavItem to="/support/overview" icon={LayoutDashboard} label="Overview" badge={badges.open_tickets} />
              <NavItem to="/support/tickets" icon={Ticket} label="All tickets" />
              <NavItem to="/support/my-tickets" icon={ClipboardList} label="My tickets" badge={badges.my_open} badgeDanger />

              <div className="support-nav-label">Work</div>
              <NavItem to="/support/pending-assign" icon={UserCog} label="Pending assign" badge={badges.pending_assign} badgeDanger />
              <NavItem to="/support/overdue" icon={Clock} label="Overdue" badge={badges.overdue_tickets} badgeDanger />
              <NavItem to="/support/pickups" icon={Truck} label="Pickups" />
              <NavItem to="/support/pickup-bucket" icon={Package} label="Pickup bucket" />
              <NavItem to="/support/my-pickups" icon={Truck} label="My pickups" />
              <NavItem to="/support/complaints" icon={MessageSquare} label="Complaints" />
              <NavItem to="/support/my-resolved" icon={CheckCircle2} label="My resolved" badge={badges.my_resolved} />

              <div className="support-nav-label">Parts</div>
              <NavItem to="/support/parts-queue" icon={ClipboardList} label="Part queue" badge={badges.support_part_requests} badgeDanger />
              <NavItem to="/support/tech-bucket" icon={Package} label="Parts bucket" />

              <div className="support-nav-label">Manage</div>
              {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'support_lead') && (
                <NavItem to="/support/stats" icon={BarChart2} label="Stats & Reports" />
              )}
              <NavItem to="/support/technicians" icon={Users} label="Technicians" />
              {canAccessCustomerInventory(user) && (
                <Link to="/customer-inventory" className="support-nav-link">
                  <Package className="w-5 h-5" /> Customer inventory
                </Link>
              )}
              {user?.role === 'admin' && <NavItem to="/support/settings" icon={Settings} label="Settings" />}
            </nav>
          )}
        </aside>

        <main className="support-main flex-1">
          <Outlet />
        </main>
      </div>

      <nav className="support-bottom-nav md:hidden">
        {techOnly ? (
          <>
            <NavLink to="/support/my-tickets" className={({ isActive }) => (isActive ? 'active' : '')}>
              <ClipboardList className="w-5 h-5" /> My tickets
            </NavLink>
            <NavLink to="/support/my-resolved" className={({ isActive }) => (isActive ? 'active' : '')}>
              <CheckCircle2 className="w-5 h-5" /> Resolved
            </NavLink>
          </>
        ) : (
          <>
            <NavLink to="/support/overview" className={({ isActive }) => (isActive ? 'active' : '')}>
              <LayoutDashboard className="w-5 h-5" /> Home
            </NavLink>
            <NavLink to="/support/tickets" className={({ isActive }) => (isActive ? 'active' : '')}>
              <Ticket className="w-5 h-5" /> Tickets
            </NavLink>
            {canCreate && (
              <NavLink to="/support/tickets/new" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Plus className="w-5 h-5" /> New
              </NavLink>
            )}
            <NavLink to="/support/overdue" className={({ isActive }) => (isActive ? 'active' : '')}>
              <Clock className="w-5 h-5" /> Overdue
            </NavLink>
          </>
        )}
      </nav>
    </div>
  );
}

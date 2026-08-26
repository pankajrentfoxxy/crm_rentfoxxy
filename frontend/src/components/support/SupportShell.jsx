import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Headphones, LayoutDashboard, Ticket, UserCog, Clock, Truck, MessageSquare,
  Users, Package, Settings, ClipboardList, CheckCircle2, Plus, BarChart2
} from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { canAccessCustomerInventory, canCancelSupportTicket, isAssignedTicketsOnly, isSupportLead } from '../../utils/supportAccess';
import usePermission from '../../hooks/usePermission';
import './support.css';

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
  const { user, isAssignedDataOnly } = useAuth();
  const { canView } = usePermission();
  const location = useLocation();
  const [badges, setBadges] = useState({});
  const techOnly = isAssignedTicketsOnly(user, isAssignedDataOnly);
  const canCreate = isSupportLead(user);
  const showMyDeliveries = canView('technician_bucket');

  useEffect(() => {
    api.get('/support/badges').then((r) => setBadges(r.data.badges || {})).catch(() => setBadges({}));
  }, [location.pathname]);

  return (
    <div className="support-crm">
      <div className="support-crm-body">
        <aside className="support-sidebar hidden md:block">
          <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-200">
            <Headphones className="w-6 h-6 text-[#534AB7]" />
            <span className="font-bold">Support CRM</span>
          </div>

          {techOnly ? (
            <nav>
              <div className="support-nav-label">Work</div>
              <NavItem to="/support/my-tickets" icon={ClipboardList} label="My tickets" badge={badges.my_open} badgeDanger />
              {showMyDeliveries && (
                <NavItem to="/sales-pipeline/my-deliveries" icon={Truck} label="My deliveries" />
              )}
              <NavItem to="/support/my-pickups" icon={Truck} label="My pickups" />
              <NavItem to="/support/tech-bucket" icon={Package} label="My parts" />
              <NavItem to="/support/my-resolved" icon={CheckCircle2} label="Resolved by me" badge={badges.my_resolved} />
            </nav>
          ) : (
            <nav>
              <div className="support-nav-label">Overview</div>
              <NavItem to="/support/overview" icon={LayoutDashboard} label="Overview" badge={badges.open_tickets} />
              <NavItem to="/support/tickets" icon={Ticket} label="All tickets" />
              <NavItem to="/support/requests" icon={ClipboardList} label="Support Requests" badge={badges.support_requests} badgeDanger />
              <NavItem to="/support/my-tickets" icon={ClipboardList} label="My tickets" badge={badges.my_open} badgeDanger />

              <div className="support-nav-label">Work</div>
              <NavItem to="/support/pending-assign" icon={UserCog} label="Pending assign" badge={badges.pending_assign} badgeDanger />
              <NavItem to="/support/overdue" icon={Clock} label="Overdue" badge={badges.overdue_tickets} badgeDanger />
              <NavItem to="/support/pickups" icon={Truck} label="Pickups" />
              <NavItem to="/support/pickup-bucket" icon={Package} label="Pickup bucket" />
              <NavItem to="/support/my-pickups" icon={Truck} label="My pickups" />
              <NavItem to="/support/complaints" icon={MessageSquare} label="Complaints" />
              {canCancelSupportTicket(user) && (
                <NavItem to="/support/cancelled-tickets" icon={Ticket} label="Cancelled tickets" />
              )}
              <NavItem to="/support/my-resolved" icon={CheckCircle2} label="My resolved" badge={badges.my_resolved} />

              <div className="support-nav-label">Parts</div>
              <NavItem to="/support/parts-queue" icon={ClipboardList} label="Part queue" badge={badges.support_part_requests} badgeDanger />
              <NavItem to="/support/tech-bucket" icon={Package} label="Parts bucket" />

              <div className="support-nav-label">Manage</div>
              {isSupportLead(user) && (
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

        <main className="support-main">
          <Outlet />
        </main>
      </div>

      <nav className="support-bottom-nav md:hidden">
        {techOnly ? (
          <>
            <NavLink to="/support/my-tickets" className={({ isActive }) => (isActive ? 'active' : '')}>
              <ClipboardList className="w-5 h-5" /> My tickets
            </NavLink>
            {showMyDeliveries && (
              <NavLink to="/sales-pipeline/my-deliveries" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Truck className="w-5 h-5" /> Deliveries
              </NavLink>
            )}
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

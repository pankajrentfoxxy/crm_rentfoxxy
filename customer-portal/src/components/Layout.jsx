import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Laptop, FileText, Receipt, ScrollText, Truck, Headphones, User, LogOut, Menu, X, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/laptops', label: 'My Laptops', icon: Laptop },
  { to: '/orders', label: 'Orders', icon: FileText },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/credit-notes', label: 'Credit Notes', icon: ScrollText },
  { to: '/deliveries', label: 'Deliveries', icon: Truck },
  // Create-ticket lives at /support/new, so match the whole /support area.
  { to: '/support/tickets', label: 'Support Tickets', icon: Headphones, activePrefix: '/support' },
  { to: '/profile', label: 'Profile', icon: User },
];

export default function Layout() {
  const { customer, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <nav className="flex-1 p-3 space-y-1">
      {nav.map(({ to, label, icon: Icon, end, activePrefix }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) => {
            const active = isActive || (activePrefix && location.pathname.startsWith(activePrefix));
            return `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active ? 'bg-teal-50 text-brand-dark' : 'text-slate-600 hover:bg-slate-50'
            }`;
          }}
        >
          <Icon className="w-4 h-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {customer?.impersonated && (
        <div className="bg-amber-500 text-white px-4 py-2 text-sm flex items-center gap-2 sticky top-0 z-40">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="min-w-0">
            <strong>Admin preview</strong> — you are viewing this portal as{' '}
            {customer.company_name || customer.name}. Read-only: tickets and password changes are blocked.
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="ml-auto shrink-0 underline underline-offset-2 hover:no-underline"
          >
            End preview
          </button>
        </div>
      )}

      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button type="button" className="md:hidden p-2" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div>
            <p className="font-bold text-brand">Rentfoxxy</p>
            <p className="text-xs text-slate-500">Customer Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600 hidden sm:inline">{customer?.company_name || customer?.name}</span>
          <button type="button" onClick={handleLogout} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-red-600">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden md:flex w-60 bg-white border-r border-slate-200 flex-col shrink-0">
          {sidebar}
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
            <aside className="relative w-64 h-full bg-white flex flex-col shadow-xl">
              <div className="flex justify-end p-3">
                <button type="button" onClick={() => setMobileOpen(false)}><X className="w-5 h-5" /></button>
              </div>
              {sidebar}
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

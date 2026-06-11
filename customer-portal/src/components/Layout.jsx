import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Laptop, FileText, Receipt, Truck, Headphones, User, LogOut, Menu, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/laptops', label: 'My Laptops', icon: Laptop },
  { to: '/orders', label: 'Orders', icon: FileText },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/deliveries', label: 'Deliveries', icon: Truck },
  { to: '/support', label: 'Support', icon: Headphones },
  { to: '/profile', label: 'Profile', icon: User },
];

export default function Layout() {
  const { customer, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <nav className="flex-1 p-3 space-y-1">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive ? 'bg-teal-50 text-brand-dark' : 'text-slate-600 hover:bg-slate-50'
            }`
          }
        >
          <Icon className="w-4 h-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
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

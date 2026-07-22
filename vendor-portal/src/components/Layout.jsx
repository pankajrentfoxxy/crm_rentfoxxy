import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FileText, Laptop, LayoutDashboard, LogOut, Receipt, RotateCcw, User, AlertCircle, Menu, X } from 'lucide-react';
import { useVendorAuth } from '../context/VendorAuthContext';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: FileText },
  { to: '/laptops', label: 'My Laptops', icon: Laptop },
  { to: '/bills', label: 'My Bills', icon: Receipt },
  { to: '/debit-notes', label: 'Debit Notes', icon: AlertCircle },
  { to: '/returns', label: 'Returns', icon: RotateCcw },
  { to: '/profile', label: 'Profile', icon: User }
];

export default function Layout() {
  const { vendor, logout } = useVendorAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <>
      <div className="px-5 py-5 border-b border-slate-100">
        <p className="text-lg font-bold text-brand">Rentfoxxy</p>
        <p className="text-xs text-slate-500 mt-0.5">Vendor Portal</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-emerald-50 text-brand-dark' : 'text-slate-600 hover:bg-slate-50'
              }`
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-100">
        <p className="text-xs text-slate-500 truncate">{vendor?.business_name || vendor?.email}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-2 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-red-600"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50">
      {/* Mobile top bar */}
      <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button type="button" className="p-2" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div>
            <p className="font-bold text-brand">Rentfoxxy</p>
            <p className="text-xs text-slate-500">Vendor Portal</p>
          </div>
        </div>
        <button type="button" onClick={handleLogout} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-red-600">
          <LogOut className="w-4 h-4" /> Logout
        </button>
      </header>

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
  );
}

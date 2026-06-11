import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FileText, Laptop, LayoutDashboard, LogOut, User } from 'lucide-react';
import { useVendorAuth } from '../context/VendorAuthContext';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: FileText },
  { to: '/laptops', label: 'My Laptops', icon: Laptop },
  { to: '/profile', label: 'Profile', icon: User }
];

export default function Layout() {
  const { vendor, logout } = useVendorAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
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
      </aside>
      <main className="flex-1 min-w-0 p-6">
        <Outlet />
      </main>
    </div>
  );
}

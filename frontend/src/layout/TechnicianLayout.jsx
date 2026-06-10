import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Menu, Truck, User, X } from 'lucide-react';
import { useTechnicianAuth } from '../context/TechnicianAuthContext';
import { getBackendOrigin } from '../utils/api';

function profileImageUrl(filename) {
  if (!filename) return null;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/uploads/delivery-man/${filename.replace(/^\//, '')}`;
}

export default function TechnicianLayout({ children }) {
  const { technician, logout } = useTechnicianAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const fullName = [technician?.first_name, technician?.last_name].filter(Boolean).join(' ') || 'Technician';
  const avatar = profileImageUrl(technician?.image);

  const handleLogout = () => {
    logout();
    navigate('/technician/login');
  };

  const navItems = [
    { to: '/technician/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/technician/profile', label: 'Profile', icon: User },
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      {sidebarOpen ? (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Truck className="w-6 h-6 text-cyan-400" />
            <span className="font-semibold text-sm">Technician Portal</span>
          </div>
          <button type="button" className="lg:hidden text-slate-400" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            {avatar ? (
              <img src={avatar} alt={fullName} className="w-10 h-10 rounded-full object-cover border border-slate-600" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                <User className="w-5 h-5 text-slate-300" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{fullName}</p>
              <p className="text-xs text-slate-400 truncate">{technician?.email}</p>
            </div>
          </div>
          {technician?.technician_impersonation ? (
            <p className="mt-2 text-[10px] uppercase tracking-wide text-amber-400 bg-amber-400/10 rounded px-2 py-1">
              Admin impersonation session
            </p>
          ) : null}
        </div>

        <nav className="p-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-700">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 h-14 flex items-center px-4 gap-3">
          <button type="button" className="lg:hidden p-2 text-slate-600" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <p className="text-sm text-slate-600">
            Rentfoxxy · <span className="font-medium text-slate-900">Field Technician</span>
          </p>
          <Link to="/technician/dashboard" className="ml-auto text-xs text-cyan-700 hover:underline lg:hidden">
            Dashboard
          </Link>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

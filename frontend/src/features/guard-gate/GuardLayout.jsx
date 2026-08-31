import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, ScanLine, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import usePermission from '../../hooks/usePermission';

export default function GuardLayout({ children }) {
  const { user, logout } = useAuth();
  const { canView } = usePermission();
  const canScanner = canView('guard_gate_checking');
  const canDashboard = canView('gate_dashboard');
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="sticky top-0 z-30 bg-slate-900 text-white">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="w-5 h-5 text-teal-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">Warehouse Gate</p>
              <p className="text-[11px] text-slate-400 truncate">{user?.name || 'Guard'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-2 py-1.5 rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
        <nav className="max-w-lg mx-auto px-4 pb-2 flex gap-2">
          {canDashboard && (
            <NavLink
              to="/guard"
              end
              className={({ isActive }) =>
                `flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium ${
                  isActive ? 'bg-teal-500 text-white' : 'bg-slate-800 text-slate-300'
                }`
              }
            >
              <LayoutDashboard className="w-4 h-4" />
              Today
            </NavLink>
          )}
          {canScanner && (
            <NavLink
              to="/guard/scanner"
              className={({ isActive }) =>
                `flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium ${
                  isActive ? 'bg-teal-500 text-white' : 'bg-slate-800 text-slate-300'
                }`
              }
            >
              <ScanLine className="w-4 h-4" />
              Scanner
            </NavLink>
          )}
        </nav>
      </header>
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 pb-8">
        {children}
      </main>
    </div>
  );
}

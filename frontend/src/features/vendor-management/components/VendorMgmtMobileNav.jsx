import React from 'react';
import { NavLink } from 'react-router-dom';
import { Building2, FileText, Package, Receipt, Users } from 'lucide-react';

const TABS = [
  { to: '/vendor-management/vendors', label: 'Vendors', icon: Users, end: false },
  { to: '/vendor-management/purchase-orders', label: 'POs', icon: FileText, end: false },
  { to: '/vendor-management/serial-numbers', label: 'Serials', icon: Package, end: false },
  { to: '/vendor-management/billing/vendor-overview', label: 'Billing', icon: Receipt, end: false },
  { to: '/vendor-management', label: 'Home', icon: Building2, end: true }
];

/** Bottom tab bar for vendor management on mobile (< md) */
export default function VendorMgmtMobileNav() {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]"
      aria-label="Vendor management navigation"
    >
      <div className="flex items-stretch justify-around">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 px-1 text-[10px] font-medium transition-colors ${
                isActive ? 'text-blue-600 bg-blue-50/80' : 'text-gray-500 hover:text-gray-800'
              }`
            }
          >
            <Icon className="w-5 h-5 shrink-0" strokeWidth={2} />
            <span className="truncate max-w-full">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

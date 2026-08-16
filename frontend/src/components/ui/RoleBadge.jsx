import React from 'react';
import { ROLE_DISPLAY_NAMES } from '../../constants/roles';

const ROLE_STYLES = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  manager: 'bg-indigo-100 text-indigo-700',
  sales: 'bg-green-100 text-green-700',
  floor_manager: 'bg-orange-100 text-orange-700',
  team_member: 'bg-teal-100 text-teal-700',
  team_lead: 'bg-cyan-100 text-cyan-700',
  qc: 'bg-violet-100 text-violet-700',
  procurement: 'bg-amber-100 text-amber-700',
  warehouse: 'bg-lime-100 text-lime-700',
  dispatch: 'bg-sky-100 text-sky-700',
  accounts: 'bg-rose-100 text-rose-700',
  support_lead: 'bg-fuchsia-100 text-fuchsia-700',
  support_tech: 'bg-pink-100 text-pink-700',
  support_agent: 'bg-rose-100 text-rose-800',
  support_manager: 'bg-fuchsia-200 text-fuchsia-900',
  technician: 'bg-teal-100 text-teal-700',
  vendor: 'bg-orange-100 text-orange-700',
  customer: 'bg-amber-100 text-amber-700',
  default: 'bg-gray-100 text-gray-600',
};

export default function RoleBadge({ role, className = '' }) {
  const label = ROLE_DISPLAY_NAMES[role] || role?.replace(/_/g, ' ') || 'Unknown';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        ROLE_STYLES[role] || ROLE_STYLES.default
      } ${className}`}
    >
      {label}
    </span>
  );
}

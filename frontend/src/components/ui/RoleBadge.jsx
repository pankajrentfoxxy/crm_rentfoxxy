import React from 'react';

const ROLE_STYLES = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  technician: 'bg-teal-100 text-teal-700',
  vendor: 'bg-orange-100 text-orange-700',
  customer: 'bg-amber-100 text-amber-700',
  default: 'bg-gray-100 text-gray-600',
};

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  technician: 'Technician',
  vendor: 'Vendor',
  customer: 'Customer',
};

export default function RoleBadge({ role }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLES[role] || ROLE_STYLES.default}`}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

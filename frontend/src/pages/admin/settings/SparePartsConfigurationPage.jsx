import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import SparePartsCatalogPanel from '../../../features/vendor-management/components/SparePartsCatalogPanel';

const SECTION_LINKS = [
  { to: '/asset-configuration/laptop', label: 'Laptop' },
  { to: '/asset-configuration/spare-parts', label: 'Spare Parts' },
];

export default function SparePartsConfigurationPage() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Asset Configuration · Spare Parts</h1>
          <p className="text-gray-500 text-sm">
            Manage spare part catalog masters independently from laptop configuration.
          </p>
        </div>
        <div className="inline-flex p-1 bg-gray-100 rounded-lg">
          {SECTION_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `px-3 py-1.5 text-sm font-medium rounded-md transition ${
                isActive ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </div>

      <SparePartsCatalogPanel />

      <p className="text-xs text-gray-400 mt-6">
        Spare parts PO workflow remains under{' '}
        <Link to="/vendor-management/spare-parts-po" className="text-blue-600 hover:underline">
          Vendor Management → Spare Parts PO
        </Link>.
      </p>
    </div>
  );
}

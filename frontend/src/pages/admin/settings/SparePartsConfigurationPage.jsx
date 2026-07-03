import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import ConfigEntityPanel from './components/ConfigEntityPanel';
import SparePartsCatalogPanel from '../../../features/vendor-management/components/SparePartsCatalogPanel';
import {
  listSpareBrands,
  createSpareBrand,
  updateSpareBrand,
  deleteSpareBrand,
  setSpareBrandStatus,
} from '../../../utils/assetConfigurationApi';

const SECTION_LINKS = [
  { to: '/asset-configuration/laptop', label: 'Laptop' },
  { to: '/asset-configuration/spare-parts', label: 'Spare Parts' },
];

const ENTITY_TABS = [
  {
    id: 'brands',
    label: 'Brand',
    labelSingular: 'Spare Part Brand',
    listFn: listSpareBrands,
    createFn: createSpareBrand,
    updateFn: updateSpareBrand,
    deleteFn: deleteSpareBrand,
    setStatusFn: setSpareBrandStatus,
  },
  { id: 'catalog', label: 'Catalog' },
];

export default function SparePartsConfigurationPage() {
  const [tab, setTab] = useState('brands');
  const entityTab = ENTITY_TABS.find((t) => t.id === tab && t.listFn);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Asset Configuration · Spare Parts</h1>
          <p className="text-gray-500 text-sm">
            Manage spare part brands and catalog masters independently from laptop configuration.
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

      <div className="flex gap-1 flex-wrap mb-6 border-b border-gray-200 pb-px">
        {ENTITY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition ${
              tab === t.id
                ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {entityTab ? (
        <ConfigEntityPanel
          key={entityTab.id}
          label={entityTab.labelSingular}
          listFn={entityTab.listFn}
          createFn={entityTab.createFn}
          updateFn={entityTab.updateFn}
          deleteFn={entityTab.deleteFn}
          setStatusFn={entityTab.setStatusFn}
        />
      ) : (
        <SparePartsCatalogPanel />
      )}

      <p className="text-xs text-gray-400 mt-6">
        Spare parts PO workflow remains under{' '}
        <Link to="/vendor-management/spare-parts-po" className="text-blue-600 hover:underline">
          Vendor Management → Spare Parts PO
        </Link>.
      </p>
    </div>
  );
}

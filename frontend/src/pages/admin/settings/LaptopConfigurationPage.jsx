import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import ConfigEntityPanel from './components/ConfigEntityPanel';
import LaptopMappingPanel from './components/LaptopMappingPanel';
import BluedartDeclaredValuePanel from './components/BluedartDeclaredValuePanel';
import {
  listBrands, createBrand, updateBrand, deleteBrand, setBrandStatus,
  listModels, createModel, updateModel, deleteModel, setModelStatus,
  listProcessors, createProcessor, updateProcessor, deleteProcessor, setProcessorStatus,
  listGenerations, createGeneration, updateGeneration, deleteGeneration, setGenerationStatus,
  listRam, createRam, updateRam, deleteRam, setRamStatus,
  listStorage, createStorage, updateStorage, deleteStorage, setStorageStatus,
  listGpus, createGpu, updateGpu, deleteGpu, setGpuStatus,
  listScreenSizes, createScreenSize, updateScreenSize, deleteScreenSize, setScreenSizeStatus,
} from '../../../utils/assetConfigurationApi';

const ENTITY_TABS = [
  {
    id: 'brands',
    label: 'Brand',
    labelSingular: 'Brand',
    listFn: listBrands,
    createFn: createBrand,
    updateFn: updateBrand,
    deleteFn: deleteBrand,
    setStatusFn: setBrandStatus,
  },
  {
    id: 'models',
    label: 'Model',
    labelSingular: 'Model',
    listFn: listModels,
    createFn: createModel,
    updateFn: updateModel,
    deleteFn: deleteModel,
    setStatusFn: setModelStatus,
  },
  {
    id: 'processors',
    label: 'Processor',
    labelSingular: 'Processor',
    listFn: listProcessors,
    createFn: createProcessor,
    updateFn: updateProcessor,
    deleteFn: deleteProcessor,
    setStatusFn: setProcessorStatus,
  },
  {
    id: 'generations',
    label: 'Generation',
    labelSingular: 'Generation',
    listFn: listGenerations,
    createFn: createGeneration,
    updateFn: updateGeneration,
    deleteFn: deleteGeneration,
    setStatusFn: setGenerationStatus,
  },
  {
    id: 'ram',
    label: 'RAM',
    labelSingular: 'RAM',
    listFn: listRam,
    createFn: createRam,
    updateFn: updateRam,
    deleteFn: deleteRam,
    setStatusFn: setRamStatus,
  },
  {
    id: 'storage',
    label: 'SSD',
    labelSingular: 'SSD',
    listFn: listStorage,
    createFn: createStorage,
    updateFn: updateStorage,
    deleteFn: deleteStorage,
    setStatusFn: setStorageStatus,
  },
  {
    id: 'screen-sizes',
    label: 'Screen Size',
    labelSingular: 'Screen Size',
    listFn: listScreenSizes,
    createFn: createScreenSize,
    updateFn: updateScreenSize,
    deleteFn: deleteScreenSize,
    setStatusFn: setScreenSizeStatus,
  },
  {
    id: 'gpus',
    label: 'Graphics',
    labelSingular: 'Graphics',
    listFn: listGpus,
    createFn: createGpu,
    updateFn: updateGpu,
    deleteFn: deleteGpu,
    setStatusFn: setGpuStatus,
  },
  { id: 'mapping', label: 'Mapping' },
  { id: 'bluedart-value', label: 'BlueDart Value' },
];

const SECTION_LINKS = [
  { to: '/asset-configuration/laptop', label: 'Laptop' },
  { to: '/asset-configuration/spare-parts', label: 'Spare Parts' },
];

export default function LaptopConfigurationPage() {
  const [tab, setTab] = useState('brands');
  const entityTab = ENTITY_TABS.find((t) => t.id === tab && t.listFn);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Asset Configuration · Laptop</h1>
          <p className="text-gray-500 text-sm">
            Manage laptop brands, models, processors, generations, RAM, SSD, screen size, and graphics.
            Use Mapping to assign models, processors, and generations per brand.
            Use BlueDart Value for AWB declared amounts.
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
          parentEntity={entityTab.parentEntity}
          parentKey={entityTab.parentKey}
          parentLabel={entityTab.parentLabel}
          listFn={entityTab.listFn}
          createFn={entityTab.createFn}
          updateFn={entityTab.updateFn}
          deleteFn={entityTab.deleteFn}
          setStatusFn={entityTab.setStatusFn}
        />
      ) : tab === 'bluedart-value' ? (
        <BluedartDeclaredValuePanel />
      ) : (
        <LaptopMappingPanel />
      )}

      <p className="text-xs text-gray-400 mt-6">
        Legacy settings URL: <Link to="/settings/asset-configuration" className="text-blue-600 hover:underline">/settings/asset-configuration</Link> redirects here.
      </p>
    </div>
  );
}

import React, { useState } from 'react';
import ConfigEntityPanel from './components/ConfigEntityPanel';
import AssetMappingPanel from './components/AssetMappingPanel';
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
    parentEntity: 'models',
    parentKey: 'brand_id',
    parentLabel: 'Brand',
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
    parentEntity: 'generations',
    parentKey: 'processor_id',
    parentLabel: 'Processor',
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
    label: 'Storage',
    labelSingular: 'Storage',
    listFn: listStorage,
    createFn: createStorage,
    updateFn: updateStorage,
    deleteFn: deleteStorage,
    setStatusFn: setStorageStatus,
  },
  {
    id: 'gpus',
    label: 'GPU',
    labelSingular: 'GPU',
    listFn: listGpus,
    createFn: createGpu,
    updateFn: updateGpu,
    deleteFn: deleteGpu,
    setStatusFn: setGpuStatus,
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
];

const TABS = [
  ...ENTITY_TABS,
  { id: 'mapping', label: 'Mapping' },
];

function MappingTab() {
  const [sub, setSub] = useState('brand-models');
  const subs = [
    { id: 'brand-models', label: 'Brand → Models', type: 'brand-models', parentLabel: 'Brand', childLabel: 'Model' },
    { id: 'processor-generations', label: 'Processor → Generations', type: 'processor-generations', parentLabel: 'Processor', childLabel: 'Generation' },
  ];
  const active = subs.find((s) => s.id === sub) || subs[0];
  return (
    <div>
      <div className="inline-flex p-1 bg-gray-100 rounded-lg mb-4">
        {subs.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSub(s.id)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              sub === s.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <AssetMappingPanel
        key={active.type}
        type={active.type}
        parentLabel={active.parentLabel}
        childLabel={active.childLabel}
      />
    </div>
  );
}

export default function AssetConfigurationPage() {
  const [tab, setTab] = useState('brands');
  const entityTab = ENTITY_TABS.find((t) => t.id === tab);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Asset Configuration</h1>
      <p className="text-gray-500 text-sm mb-6">
        Manage dropdown values used in quotation, sales order, and delivery challan asset details.
        Brand filters models; processor filters generations.
      </p>

      <div className="flex gap-1 flex-wrap mb-6 border-b border-gray-200 pb-px">
        {TABS.map((t) => (
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
      ) : (
        <MappingTab key="mapping" />
      )}
    </div>
  );
}

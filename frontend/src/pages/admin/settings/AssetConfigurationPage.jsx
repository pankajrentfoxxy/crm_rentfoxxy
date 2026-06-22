import React, { useState } from 'react';
import ConfigEntityPanel from './components/ConfigEntityPanel';
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

const TABS = [
  {
    id: 'brands',
    label: 'Brand',
    panel: (
      <ConfigEntityPanel
        label="Brand"
        listFn={listBrands}
        createFn={createBrand}
        updateFn={updateBrand}
        deleteFn={deleteBrand}
        setStatusFn={setBrandStatus}
      />
    ),
  },
  {
    id: 'models',
    label: 'Model',
    panel: (
      <ConfigEntityPanel
        label="Model"
        parentEntity="models"
        parentKey="brand_id"
        parentLabel="Brand"
        listFn={listModels}
        createFn={createModel}
        updateFn={updateModel}
        deleteFn={deleteModel}
        setStatusFn={setModelStatus}
      />
    ),
  },
  {
    id: 'processors',
    label: 'Processor',
    panel: (
      <ConfigEntityPanel
        label="Processor"
        listFn={listProcessors}
        createFn={createProcessor}
        updateFn={updateProcessor}
        deleteFn={deleteProcessor}
        setStatusFn={setProcessorStatus}
      />
    ),
  },
  {
    id: 'generations',
    label: 'Generation',
    panel: (
      <ConfigEntityPanel
        label="Generation"
        parentEntity="generations"
        parentKey="processor_id"
        parentLabel="Processor"
        listFn={listGenerations}
        createFn={createGeneration}
        updateFn={updateGeneration}
        deleteFn={deleteGeneration}
        setStatusFn={setGenerationStatus}
      />
    ),
  },
  {
    id: 'ram',
    label: 'RAM',
    panel: (
      <ConfigEntityPanel
        label="RAM"
        listFn={listRam}
        createFn={createRam}
        updateFn={updateRam}
        deleteFn={deleteRam}
        setStatusFn={setRamStatus}
      />
    ),
  },
  {
    id: 'storage',
    label: 'Storage',
    panel: (
      <ConfigEntityPanel
        label="Storage"
        listFn={listStorage}
        createFn={createStorage}
        updateFn={updateStorage}
        deleteFn={deleteStorage}
        setStatusFn={setStorageStatus}
      />
    ),
  },
  {
    id: 'gpus',
    label: 'GPU',
    panel: (
      <ConfigEntityPanel
        label="GPU"
        listFn={listGpus}
        createFn={createGpu}
        updateFn={updateGpu}
        deleteFn={deleteGpu}
        setStatusFn={setGpuStatus}
      />
    ),
  },
  {
    id: 'screen-sizes',
    label: 'Screen Size',
    panel: (
      <ConfigEntityPanel
        label="Screen Size"
        listFn={listScreenSizes}
        createFn={createScreenSize}
        updateFn={updateScreenSize}
        deleteFn={deleteScreenSize}
        setStatusFn={setScreenSizeStatus}
      />
    ),
  },
];

export default function AssetConfigurationPage() {
  const [tab, setTab] = useState('brands');
  const active = TABS.find((t) => t.id === tab) || TABS[0];

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

      {active.panel}
    </div>
  );
}

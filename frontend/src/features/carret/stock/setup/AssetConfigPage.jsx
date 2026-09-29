import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import DeskShell from '../../../../shells/DeskShell';
import { Segmented, Tabs } from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import * as ac from '../../../../utils/assetConfigurationApi';
import AssetConfigEntityPanel from './AssetConfigEntityPanel';
import AssetConfigMappingPanel from './AssetConfigMappingPanel';
import AssetConfigBluedartPanel from './AssetConfigBluedartPanel';
import AssetConfigSpareCatalogPanel from './AssetConfigSpareCatalogPanel';

/**
 * Stock → Setup → Asset configuration. One page for what were two old screens
 * (/asset-configuration/laptop and /spare-parts): the pick-lists every laptop
 * form uses (brand, model, processor, generation, RAM, SSD, screen, graphics),
 * which models / processors / generations each brand offers, the BlueDart
 * declared-value matrix, spare-part brands and the spare-parts catalog.
 *
 * Same API as before (routes/assetConfiguration.js, section asset_configuration;
 * the catalog is /vendor-management/spare-parts-catalog, sections
 * parts_procurement / vendor_management). The server standardises every name and
 * refuses a duplicate in another spelling, so this page never adds a value that
 * `npm run normalize:asset-config` would later have to merge.
 *
 * ?tab= deep-links a tab.
 */
const entityApi = (list, create, update, remove, setStatus) => ({ list, create, update, remove, setStatus });

const ENTITY_TABS = {
  brands: { label: 'Brand', api: entityApi(ac.listBrands, ac.createBrand, ac.updateBrand, ac.deleteBrand, ac.setBrandStatus) },
  models: { label: 'Model', api: entityApi(ac.listModels, ac.createModel, ac.updateModel, ac.deleteModel, ac.setModelStatus), hint: 'Map a model to its brand on the Brand mapping tab.' },
  processors: { label: 'Processor', api: entityApi(ac.listProcessors, ac.createProcessor, ac.updateProcessor, ac.deleteProcessor, ac.setProcessorStatus) },
  generations: { label: 'Generation', api: entityApi(ac.listGenerations, ac.createGeneration, ac.updateGeneration, ac.deleteGeneration, ac.setGenerationStatus) },
  ram: { label: 'RAM', api: entityApi(ac.listRam, ac.createRam, ac.updateRam, ac.deleteRam, ac.setRamStatus) },
  storage: { label: 'SSD', api: entityApi(ac.listStorage, ac.createStorage, ac.updateStorage, ac.deleteStorage, ac.setStorageStatus) },
  'screen-sizes': { label: 'Screen size', api: entityApi(ac.listScreenSizes, ac.createScreenSize, ac.updateScreenSize, ac.deleteScreenSize, ac.setScreenSizeStatus) },
  gpus: { label: 'Graphics', api: entityApi(ac.listGpus, ac.createGpu, ac.updateGpu, ac.deleteGpu, ac.setGpuStatus) },
  'spare-brands': { label: 'Spare part brand', api: entityApi(ac.listSpareBrands, ac.createSpareBrand, ac.updateSpareBrand, ac.deleteSpareBrand, ac.setSpareBrandStatus) },
};

const LAPTOP_TABS = [
  { key: 'brands', label: 'Brands' },
  { key: 'models', label: 'Models' },
  { key: 'processors', label: 'Processors' },
  { key: 'generations', label: 'Generations' },
  { key: 'ram', label: 'RAM' },
  { key: 'storage', label: 'SSD' },
  { key: 'screen-sizes', label: 'Screen sizes' },
  { key: 'gpus', label: 'Graphics' },
  { key: 'mapping', label: 'Brand mapping' },
  { key: 'bluedart', label: 'BlueDart value' },
];
const SPARE_TABS = [
  { key: 'spare-brands', label: 'Spare brands' },
  { key: 'spare-catalog', label: 'Spare parts catalog' },
];
const CATALOG_SECTIONS = ['parts_procurement', 'vendor_management'];

export default function AssetConfigPage() {
  const { hasPermission } = usePermission();
  const [params, setParams] = useSearchParams();
  const canCreate = hasPermission('asset_configuration', 'create');
  const canEdit = hasPermission('asset_configuration', 'edit');
  const canDelete = hasPermission('asset_configuration', 'delete');
  const catalog = {
    view: CATALOG_SECTIONS.some((s) => hasPermission(s, 'view')),
    create: CATALOG_SECTIONS.some((s) => hasPermission(s, 'create')),
    edit: CATALOG_SECTIONS.some((s) => hasPermission(s, 'edit')),
  };

  const spareTabs = useMemo(
    () => SPARE_TABS.filter((t) => t.key !== 'spare-catalog' || catalog.view),
    [catalog.view]
  );
  const all = [...LAPTOP_TABS, ...spareTabs];
  const tab = all.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'brands';
  const group = spareTabs.some((t) => t.key === tab) ? 'spare' : 'laptop';
  const setTab = (key) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', key); return n; }, { replace: true });

  const entity = ENTITY_TABS[tab];
  return (
    <DeskShell
      title="Asset configuration"
      breadcrumb="Stock · Setup"
      subtitle="The pick-lists every laptop and spare-part form uses, which values each brand offers, and the BlueDart declared values."
    >
      <div className="c-stack">
        <Segmented
          label="Configuration for"
          value={group}
          onChange={(g) => setTab(g === 'spare' ? spareTabs[0].key : 'brands')}
          options={[{ value: 'laptop', label: 'Laptops' }, { value: 'spare', label: 'Spare parts' }]}
        />
        <Tabs tabs={group === 'spare' ? spareTabs : LAPTOP_TABS} value={tab} onChange={setTab} />
        {entity && (
          <AssetConfigEntityPanel
            key={tab}
            label={entity.label}
            hint={entity.hint}
            api={entity.api}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}
        {tab === 'mapping' && <AssetConfigMappingPanel canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'bluedart' && <AssetConfigBluedartPanel canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'spare-catalog' && <AssetConfigSpareCatalogPanel canCreate={catalog.create} canEdit={catalog.edit} />}
      </div>
    </DeskShell>
  );
}

import React, { useEffect } from 'react';
import {
  modelsForBrand,
  processorsForBrand,
  generationsForBrand,
  generationsForBrandProcessor,
  EMPTY_ASSET_CATALOG,
} from '../../../utils/assetCatalogUtils';
import useAssetCascadeCatalog from '../../../hooks/useAssetCascadeCatalog';
import { emptyLineItem, lineItemsToPayload } from './DocumentLineItemsForm';
import SearchableSelect from './SearchableSelect';
import { matchConfigOption } from '../../../utils/configOptionMatch';

export { emptyLineItem, lineItemsToPayload };

const CATALOG_FIELDS = ['brand', 'model_name', 'processor', 'generation', 'ram', 'storage'];

function catalogFieldKey(field) {
  if (field === 'model_name') return 'model';
  return field;
}

function filterCatalogRows(catalogRows, line, upToField) {
  let rows = catalogRows || [];
  for (const field of CATALOG_FIELDS) {
    if (field === upToField) break;
    const value = line[field];
    if (!value) continue;
    const key = catalogFieldKey(field);
    rows = rows.filter((row) => row[key] === value);
  }
  return rows;
}

function optionsForField(catalogRows, line, field) {
  const rows = filterCatalogRows(catalogRows, line, field);
  const key = catalogFieldKey(field);
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function matchCatalogRow(catalogRows, line) {
  if (!catalogRows?.length) return null;
  return catalogRows.find((row) =>
    (!line.brand || row.brand === line.brand)
    && (!line.model_name || row.model === line.model_name)
    && (!line.processor || row.processor === line.processor)
    && (!line.generation || row.generation === line.generation)
    && (!line.ram || row.ram === line.ram)
    && (!line.storage || row.storage === line.storage)
  ) || null;
}

function dependentFieldsAfter(field) {
  const index = CATALOG_FIELDS.indexOf(field);
  if (index < 0) return [];
  return CATALOG_FIELDS.slice(index + 1);
}

function pickOptions(catalogRows, line, field, fallback = []) {
  const filtered = optionsForField(catalogRows, line, field);
  return filtered.length ? filtered : fallback;
}

const DEFAULT_REQUIRED_FIELDS = [
  'brand', 'model_name', 'processor', 'generation', 'ram', 'storage', 'gpu', 'screen_size', 'quantity', 'rate',
];

export default function AssetDetailsForm({
  lines,
  onChange,
  catalog,
  quotationType,
  requiredFields = DEFAULT_REQUIRED_FIELDS,
  useCascadeApi,
  hideCommercialFields = false,
  hideAddLine = false,
  reconcileValues = false,
}) {
  const required = new Set(requiredFields);
  const isRequired = (field) => required.has(field);
  const showRentalFields = quotationType === 'rental' || quotationType === 'demo';
  const cascadeMode = useCascadeApi ?? !catalog?.brands?.length;
  const {
    brands: cascadeBrands,
    specMasters,
    modelsByBrand,
    processorsByBrand,
    generationsByBrand,
    loadBrandData,
    prefetchLine,
  } = useAssetCascadeCatalog(cascadeMode);
  const cfg = cascadeMode
    ? {
      from_asset_config: true,
      brands: cascadeBrands,
      rams: specMasters.rams,
      storages: specMasters.storages,
      gpus: specMasters.gpus,
      screen_sizes: specMasters.screen_sizes,
    }
    : (catalog?.brands?.length ? catalog : EMPTY_ASSET_CATALOG);
  const catalogRows = cfg.catalog_rows || [];
  const useConfig = cascadeMode || cfg.from_asset_config !== false;

  useEffect(() => {
    if (!cascadeMode) return;
    lines.forEach((line) => prefetchLine(line));
  }, [cascadeMode, lines, prefetchLine]);

  // When editing an existing config, the stored values (e.g. "I5", "16",
  // "512 SSD") often don't exactly match catalog option strings, so the
  // dropdowns render blank. Snap each value to the matching option once the
  // relevant option list has loaded. Only snaps to options that exist, so it is
  // a no-op once values are canonical (prevents render loops).
  useEffect(() => {
    if (!reconcileValues || !cascadeMode) return;
    let changed = false;
    const next = lines.map((line) => {
      const updated = { ...line };
      const snap = (field, options) => {
        const cur = updated[field];
        if (!cur || !options?.length) return;
        if (options.includes(cur)) return;
        const match = matchConfigOption(cur, options, field);
        if (match && match !== cur) {
          updated[field] = match;
          changed = true;
        }
      };
      snap('brand', cascadeBrands);
      snap('model_name', modelsByBrand[updated.brand] || []);
      snap('processor', processorsByBrand[updated.brand] || []);
      snap('generation', generationsByBrand[updated.brand] || []);
      snap('ram', specMasters.rams);
      snap('storage', specMasters.storages);
      snap('gpu', specMasters.gpus);
      snap('screen_size', specMasters.screen_sizes);
      return updated;
    });
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reconcileValues, cascadeMode, lines, cascadeBrands,
    modelsByBrand, processorsByBrand, generationsByBrand, specMasters,
  ]);

  const updateLine = (index, field, value) => {
    if (cascadeMode && field === 'brand' && value) {
      loadBrandData(value);
    }

    const next = lines.map((row, i) => {
      if (i !== index) return row;
      const updated = { ...row, [field]: value };

      if (!useConfig && CATALOG_FIELDS.includes(field)) {
        dependentFieldsAfter(field).forEach((depField) => {
          const options = optionsForField(catalogRows, updated, depField);
          if (updated[depField] && !options.includes(updated[depField])) {
            updated[depField] = '';
          }
        });
      }

      if (field === 'brand' && value) {
        updated.model_name = '';
        if (!useConfig) {
          updated.processor = '';
          updated.generation = '';
          updated.ram = '';
          updated.storage = '';
        } else {
          updated.processor = '';
          updated.generation = '';
        }
      }

      if (field === 'processor' && value && !useConfig) {
        updated.generation = '';
      }

      if (field === 'model_name' && value && !useConfig) {
        const modelRow = catalogRows.find(
          (row) => row.model === value && (!updated.brand || row.brand === updated.brand)
        ) || catalogRows.find((row) => row.model === value);
        if (modelRow) updated.brand = modelRow.brand || updated.brand;
      }

      if (!useConfig) {
        const match = matchCatalogRow(catalogRows, updated);
        if (match) {
          updated.model_name = match.model || updated.model_name;
          updated.brand = match.brand || updated.brand;
        }
      }

      return updated;
    });
    onChange(next);
  };

  const addLine = () => onChange([...lines, emptyLineItem()]);
  const removeLine = (index) => onChange(lines.filter((_, i) => i !== index));

  return (
    <div className="space-y-4">
      {lines.map((line, index) => {
        const brandOptions = cascadeMode
          ? cascadeBrands
          : (useConfig
            ? (cfg.brands || [])
            : pickOptions(catalogRows, line, 'brand', cfg.brands));
        const modelOptions = cascadeMode
          ? (modelsByBrand[line.brand] || [])
          : (useConfig
            ? modelsForBrand(line.brand, cfg)
            : pickOptions(catalogRows, line, 'model_name', modelsForBrand(line.brand, cfg)));
        const processorOptions = cascadeMode
          ? (processorsByBrand[line.brand] || [])
          : (useConfig
            ? processorsForBrand(line.brand, cfg)
            : pickOptions(catalogRows, line, 'processor', cfg.processors));
        const generationOptions = cascadeMode
          ? (generationsByBrand[line.brand] || [])
          : (useConfig
            ? generationsForBrand(line.brand, cfg)
            : pickOptions(catalogRows, line, 'generation', generationsForBrandProcessor(line.brand, line.processor, cfg)));
        const ramOptions = useConfig
          ? (cfg.rams || [])
          : pickOptions(catalogRows, line, 'ram', cfg.rams);
        const storageOptions = useConfig
          ? (cfg.storages || [])
          : pickOptions(catalogRows, line, 'storage', cfg.storages);

        return (
        <div key={index} className={`bg-white border border-gray-200 rounded-xl shadow-sm ${hideCommercialFields ? 'overflow-visible' : 'overflow-hidden'}`}>
          {!hideCommercialFields ? (
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <span aria-hidden>💻</span>
              Assets details
              {lines.length > 1 ? <span className="text-gray-400 font-normal">#{index + 1}</span> : null}
            </h3>
            {lines.length > 1 ? (
              <button type="button" onClick={() => removeLine(index)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            ) : null}
          </div>
          ) : null}
          <div className={`p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${hideCommercialFields ? '' : ''}`}>
            <SearchableSelect
              id={`asset-brand-${index}`}
              label="Brand"
              required={isRequired('brand')}
              value={line.brand}
              onChange={(v) => updateLine(index, 'brand', v)}
              options={brandOptions}
            />
            <SearchableSelect
              id={`asset-model-${index}`}
              label="Model"
              required={isRequired('model_name')}
              value={line.model_name}
              onChange={(v) => updateLine(index, 'model_name', v)}
              options={modelOptions}
              disabled={useConfig && !line.brand}
            />
            <SearchableSelect
              id={`asset-processor-${index}`}
              label="Processor"
              required={isRequired('processor')}
              value={line.processor}
              onChange={(v) => updateLine(index, 'processor', v)}
              options={processorOptions}
              disabled={useConfig && (!line.brand || (cascadeMode && !processorOptions.length && line.brand))}
            />
            <SearchableSelect
              id={`asset-generation-${index}`}
              label="Generation"
              required={isRequired('generation')}
              value={line.generation}
              onChange={(v) => updateLine(index, 'generation', v)}
              options={generationOptions}
              disabled={useConfig && (cascadeMode ? !line.brand : !line.processor)}
            />
            <SearchableSelect
              id={`asset-ram-${index}`}
              label="Ram"
              required={isRequired('ram')}
              value={line.ram}
              onChange={(v) => updateLine(index, 'ram', v)}
              options={ramOptions}
            />
            <SearchableSelect
              id={`asset-storage-${index}`}
              label="Storage"
              required={isRequired('storage')}
              value={line.storage}
              onChange={(v) => updateLine(index, 'storage', v)}
              options={storageOptions}
            />
            <SearchableSelect
              id={`asset-gpu-${index}`}
              label="Gpu"
              required={isRequired('gpu')}
              value={line.gpu}
              onChange={(v) => updateLine(index, 'gpu', v)}
              options={cfg.gpus || []}
            />
            <SearchableSelect
              id={`asset-screen-${index}`}
              label="Screen Size"
              required={isRequired('screen_size')}
              value={line.screen_size}
              onChange={(v) => updateLine(index, 'screen_size', v)}
              options={cfg.screen_sizes || []}
            />
            {!hideCommercialFields ? (
            <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Quantity
                {isRequired('quantity') ? <span className="text-red-500 ml-0.5">*</span> : null}
              </label>
              <input
                type="number"
                min="1"
                required={isRequired('quantity')}
                placeholder="Enter quantity"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={line.quantity}
                onChange={(e) => updateLine(index, 'quantity', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Rate
                {isRequired('rate') ? <span className="text-red-500 ml-0.5">*</span> : null}
              </label>
              <input
                type="number"
                min="0"
                required={isRequired('rate')}
                placeholder="Enter rate"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={line.rate}
                onChange={(e) => updateLine(index, 'rate', e.target.value)}
              />
            </div>
            {showRentalFields ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Locking Period (In Month)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Enter Value in Month"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={line.locking_period}
                  onChange={(e) => updateLine(index, 'locking_period', e.target.value)}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Technical Warranty (in month)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Enter Technical Warranty"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={line.technical_warranty}
                    onChange={(e) => updateLine(index, 'technical_warranty', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Battery/Charger Warranty (in month)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Enter Battery Charger Warranty"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={line.battery_charger_warranty}
                    onChange={(e) => updateLine(index, 'battery_charger_warranty', e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="sm:col-span-2 lg:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Remarks</label>
              <textarea
                rows={2}
                placeholder="Enter remarks"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={line.remark}
                onChange={(e) => updateLine(index, 'remark', e.target.value)}
              />
            </div>
            </>
            ) : null}
          </div>
        </div>
        );
      })}
      {!hideAddLine ? (
      <button
        type="button"
        onClick={addLine}
        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 border border-gray-300 hover:bg-gray-100"
      >
        Add
        <span aria-hidden className="text-base leading-none">⊕</span>
      </button>
      ) : null}
    </div>
  );
}

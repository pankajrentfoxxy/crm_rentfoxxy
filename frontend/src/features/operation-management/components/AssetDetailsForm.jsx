import React from 'react';
import { emptyLineItem, lineItemsToPayload } from './DocumentLineItemsForm';
import SearchableSelect from './SearchableSelect';

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

export default function AssetDetailsForm({ lines, onChange, catalog, quotationType }) {
  const showRentalFields = quotationType === 'rental' || quotationType === 'demo';
  const catalogRows = catalog?.catalog_rows || [];
  const globalOptions = {
    gpu: catalog?.gpus || [],
    screen_size: catalog?.screen_sizes || [],
  };

  const updateLine = (index, field, value) => {
    const next = lines.map((row, i) => {
      if (i !== index) return row;
      const updated = { ...row, [field]: value };

      if (CATALOG_FIELDS.includes(field)) {
        dependentFieldsAfter(field).forEach((depField) => {
          const options = optionsForField(catalogRows, updated, depField);
          if (updated[depField] && !options.includes(updated[depField])) {
            updated[depField] = '';
          }
        });
      }

      if (field === 'brand' && value) {
        updated.model_name = '';
        updated.processor = '';
        updated.generation = '';
        updated.ram = '';
        updated.storage = '';
      }

      if (field === 'model_name' && value) {
        const modelRow = catalogRows.find(
          (row) => row.model === value && (!updated.brand || row.brand === updated.brand)
        ) || catalogRows.find((row) => row.model === value);
        if (modelRow) updated.brand = modelRow.brand || updated.brand;
      }

      const match = matchCatalogRow(catalogRows, updated);
      if (match) {
        updated.model_name = match.model || updated.model_name;
        updated.brand = match.brand || updated.brand;
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
        const brandOptions = pickOptions(catalogRows, line, 'brand', catalog?.brands || []);
        const modelOptions = pickOptions(catalogRows, line, 'model_name', catalog?.models || []);
        const processorOptions = pickOptions(catalogRows, line, 'processor', catalog?.processors || []);
        const generationOptions = pickOptions(catalogRows, line, 'generation', catalog?.generations || []);
        const ramOptions = pickOptions(catalogRows, line, 'ram', catalog?.rams || []);
        const storageOptions = pickOptions(catalogRows, line, 'storage', catalog?.storages || []);

        return (
        <div key={index} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
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
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SearchableSelect
              id={`asset-brand-${index}`}
              label="Brand"
              required
              value={line.brand}
              onChange={(v) => updateLine(index, 'brand', v)}
              options={brandOptions}
            />
            <SearchableSelect
              id={`asset-model-${index}`}
              label="Model"
              required
              value={line.model_name}
              onChange={(v) => updateLine(index, 'model_name', v)}
              options={modelOptions}
            />
            <SearchableSelect
              id={`asset-processor-${index}`}
              label="Processor"
              required
              value={line.processor}
              onChange={(v) => updateLine(index, 'processor', v)}
              options={processorOptions}
            />
            <SearchableSelect
              id={`asset-generation-${index}`}
              label="Generation"
              required
              value={line.generation}
              onChange={(v) => updateLine(index, 'generation', v)}
              options={generationOptions}
            />
            <SearchableSelect
              id={`asset-ram-${index}`}
              label="Ram"
              required
              value={line.ram}
              onChange={(v) => updateLine(index, 'ram', v)}
              options={ramOptions}
            />
            <SearchableSelect
              id={`asset-storage-${index}`}
              label="Storage"
              required
              value={line.storage}
              onChange={(v) => updateLine(index, 'storage', v)}
              options={storageOptions}
            />
            <SearchableSelect
              id={`asset-gpu-${index}`}
              label="Gpu"
              required
              value={line.gpu}
              onChange={(v) => updateLine(index, 'gpu', v)}
              options={globalOptions.gpu}
            />
            <SearchableSelect
              id={`asset-screen-${index}`}
              label="Screen Size"
              required
              value={line.screen_size}
              onChange={(v) => updateLine(index, 'screen_size', v)}
              options={globalOptions.screen_size}
            />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Quantity
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                placeholder="Enter quantity"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={line.quantity}
                onChange={(e) => updateLine(index, 'quantity', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Rate
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="number"
                min="0"
                required
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
          </div>
        </div>
        );
      })}
      <button
        type="button"
        onClick={addLine}
        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-50 border border-gray-300 hover:bg-gray-100"
      >
        Add
        <span aria-hidden className="text-base leading-none">⊕</span>
      </button>
    </div>
  );
}

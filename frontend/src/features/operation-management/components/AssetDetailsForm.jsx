import React from 'react';
import { emptyLineItem, lineItemsToPayload } from './DocumentLineItemsForm';

export { emptyLineItem, lineItemsToPayload };

function SelectField({ label, required, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      <select
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">Please Select</option>
        {(options || []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function matchCatalogRow(catalogRows, line) {
  if (!catalogRows?.length) return null;
  return catalogRows.find((row) =>
    (!line.processor || row.processor === line.processor)
    && (!line.generation || row.generation === line.generation)
    && (!line.ram || row.ram === line.ram)
    && (!line.storage || row.storage === line.storage)
  ) || null;
}

export default function AssetDetailsForm({ lines, onChange, catalog, quotationType }) {
  const showRentalFields = quotationType === 'rental' || quotationType === 'demo';
  const attributeOptions = {
    processor: catalog?.processors || [],
    generation: catalog?.generations || [],
    ram: catalog?.rams || [],
    storage: catalog?.storages || [],
    gpu: catalog?.gpus || [],
    screen_size: catalog?.screen_sizes || [],
  };

  const updateLine = (index, field, value) => {
    const next = lines.map((row, i) => {
      if (i !== index) return row;
      const updated = { ...row, [field]: value };
      const match = matchCatalogRow(catalog?.catalog_rows, updated);
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
      {lines.map((line, index) => (
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
            <SelectField label="Processor" required value={line.processor} onChange={(v) => updateLine(index, 'processor', v)} options={attributeOptions.processor} />
            <SelectField label="Generation" required value={line.generation} onChange={(v) => updateLine(index, 'generation', v)} options={attributeOptions.generation} />
            <SelectField label="Ram" required value={line.ram} onChange={(v) => updateLine(index, 'ram', v)} options={attributeOptions.ram} />
            <SelectField label="Storage" required value={line.storage} onChange={(v) => updateLine(index, 'storage', v)} options={attributeOptions.storage} />
            <SelectField label="Gpu" required value={line.gpu} onChange={(v) => updateLine(index, 'gpu', v)} options={attributeOptions.gpu} />
            <SelectField label="Screen Size" required value={line.screen_size} onChange={(v) => updateLine(index, 'screen_size', v)} options={attributeOptions.screen_size} />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantity<span className="text-red-500 ml-0.5">*</span></label>
              <input type="number" min="1" required placeholder="Enter quantity" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rate<span className="text-red-500 ml-0.5">*</span></label>
              <input type="number" min="0" required placeholder="Enter rate" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={line.rate} onChange={(e) => updateLine(index, 'rate', e.target.value)} />
            </div>
            {showRentalFields ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Locking Period (In Month)</label>
                <input type="number" placeholder="Enter Value in Month" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  value={line.locking_period} onChange={(e) => updateLine(index, 'locking_period', e.target.value)} />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Technical Warranty (in month)</label>
                  <input type="number" placeholder="Enter Technical Warranty" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={line.technical_warranty} onChange={(e) => updateLine(index, 'technical_warranty', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Battery/Charger Warranty (in month)</label>
                  <input type="number" placeholder="Enter Battery Charger Warranty" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    value={line.battery_charger_warranty} onChange={(e) => updateLine(index, 'battery_charger_warranty', e.target.value)} />
                </div>
              </>
            )}
            <div className="sm:col-span-2 lg:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Remarks<span className="text-red-500 ml-0.5">*</span></label>
              <textarea required rows={2} placeholder="Enter remarks" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={line.remark} onChange={(e) => updateLine(index, 'remark', e.target.value)} />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addLine}
        className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-medium text-cyan-700 bg-cyan-50 border border-cyan-200 hover:bg-cyan-100"
      >
        Add +
      </button>
    </div>
  );
}

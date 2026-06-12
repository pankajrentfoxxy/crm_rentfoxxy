import React from 'react';

export const emptyLineItem = () => ({
  brand: '',
  model_name: '',
  processor: '',
  generation: '',
  ram: '',
  storage: '',
  gpu: '',
  screen_size: '',
  quantity: 1,
  rate: 0,
  locking_period: '',
  technical_warranty: '',
  battery_charger_warranty: '',
  remark: '',
});

export function lineItemsToPayload(lines) {
  return {
    brand: lines.map((l) => l.brand),
    Model: lines.map((l) => l.model_name),
    Processor: lines.map((l) => l.processor),
    Generation: lines.map((l) => l.generation),
    RAM: lines.map((l) => l.ram),
    Storage: lines.map((l) => l.storage),
    GPU: lines.map((l) => l.gpu),
    Screen_size: lines.map((l) => l.screen_size),
    quantity: lines.map((l) => Number(l.quantity) || 1),
    rate: lines.map((l) => Number(l.rate) || 0),
    locking_period: lines.map((l) => l.locking_period || ''),
    technical_warranty: lines.map((l) => l.technical_warranty || ''),
    battery_charger_warranty: lines.map((l) => l.battery_charger_warranty || ''),
    remarks: lines.map((l) => l.remark || ''),
  };
}

export default function DocumentLineItemsForm({ lines, onChange, showRentalFields = true }) {
  const updateLine = (index, field, value) => {
    const next = lines.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    onChange(next);
  };

  const addLine = () => onChange([...lines, emptyLineItem()]);
  const removeLine = (index) => onChange(lines.filter((_, i) => i !== index));

  return (
    <div className="space-y-4">
      {lines.map((line, index) => (
        <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Line item {index + 1}</h3>
            {lines.length > 1 ? (
              <button type="button" onClick={() => removeLine(index)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['brand', 'Brand'],
              ['model_name', 'Model'],
              ['processor', 'Processor'],
              ['generation', 'Generation'],
              ['ram', 'RAM'],
              ['storage', 'Storage'],
              ['gpu', 'GPU'],
              ['screen_size', 'Screen size'],
            ].map(([field, label]) => (
              <div key={field}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  className="w-full px-2 py-1.5 border rounded text-sm"
                  value={line[field]}
                  onChange={(e) => updateLine(index, field, e.target.value)}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Quantity</label>
              <input type="number" min="1" className="w-full px-2 py-1.5 border rounded text-sm" value={line.quantity}
                onChange={(e) => updateLine(index, 'quantity', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Rate</label>
              <input type="number" min="0" className="w-full px-2 py-1.5 border rounded text-sm" value={line.rate}
                onChange={(e) => updateLine(index, 'rate', e.target.value)} />
            </div>
            {showRentalFields ? (
              <>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Locking period</label>
                  <input className="w-full px-2 py-1.5 border rounded text-sm" value={line.locking_period}
                    onChange={(e) => updateLine(index, 'locking_period', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Tech warranty</label>
                  <input className="w-full px-2 py-1.5 border rounded text-sm" value={line.technical_warranty}
                    onChange={(e) => updateLine(index, 'technical_warranty', e.target.value)} />
                </div>
              </>
            ) : null}
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Remark</label>
              <input className="w-full px-2 py-1.5 border rounded text-sm" value={line.remark}
                onChange={(e) => updateLine(index, 'remark', e.target.value)} />
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:underline">
        + Add line item
      </button>
    </div>
  );
}

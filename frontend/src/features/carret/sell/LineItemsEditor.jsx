import React, { useEffect } from 'react';
import { Trash2, Plus } from 'lucide-react';
import useAssetCascadeCatalog from '../../../hooks/useAssetCascadeCatalog';
import { Field, Input, Select, FormGrid, Money, Button } from '../../../components/carret';

/**
 * Laptop line items for a quotation or a sales order.
 *
 * The options come from the same asset-configuration catalog the old forms use
 * (useAssetCascadeCatalog), so a quotation raised here and one raised on the
 * old screen hold identical strings — the SO attach step matches laptops on
 * exactly these values.
 *
 * Rental and demo lines carry a lock-in; sale lines carry the two warranties.
 * `required` lists the fields the caller insists on (the SO needs processor,
 * generation, RAM and storage to match stock).
 */
export const emptyLine = () => ({
  brand: '', model_name: '', processor: '', generation: '', ram: '', storage: '',
  gpu: '', screen_size: '', quantity: 1, rate: '', locking_period: '',
  technical_warranty: '', battery_charger_warranty: '', remark: '',
});

export const lineAmount = (l) => (Number(l.quantity) || 0) * (Number(l.rate) || 0);
export const linesTotal = (lines) => lines.reduce((s, l) => s + lineAmount(l), 0);

/** Old payload shape: parallel arrays, keys exactly as the backend reads them. */
export function linesToPayload(lines) {
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
    line_id: lines.map((l) => l.line_id || l.id || null),
  };
}

/** Plain-text config, e.g. "Dell Latitude 5420 · i5 · 11th · 16GB · 512GB SSD". */
export function configText(l) {
  const head = [l.brand, l.model_name].filter(Boolean).join(' ');
  return [head, l.processor, l.generation, l.ram, l.storage, l.gpu, l.screen_size]
    .filter((v) => v && String(v).trim())
    .join(' · ');
}

/** Returns { index, field } for the first missing required value, or null. */
export function firstMissing(lines, required = []) {
  for (let i = 0; i < lines.length; i += 1) {
    for (const f of required) {
      if (!String(lines[i][f] ?? '').trim()) return { index: i, field: f };
    }
    if (!(Number(lines[i].quantity) >= 1)) return { index: i, field: 'quantity' };
    if (!(Number(lines[i].rate) > 0)) return { index: i, field: 'rate' };
  }
  return null;
}

const LABELS = {
  brand: 'Brand', model_name: 'Model', processor: 'Processor', generation: 'Generation',
  ram: 'RAM', storage: 'Storage', gpu: 'GPU', screen_size: 'Screen size',
  quantity: 'Quantity', rate: 'Rate',
};
export const fieldLabel = (f) => LABELS[f] || f;

// Keep a stored value visible even when the catalog spells it differently.
const withCurrent = (options, current) => {
  const list = Array.isArray(options) ? options : [];
  return current && !list.includes(current) ? [current, ...list] : list;
};

export default function LineItemsEditor({
  lines, onChange, quotationType = 'rental', required = [], errors = null, disabled = false,
}) {
  const catalog = useAssetCascadeCatalog(true);
  const isSale = quotationType === 'sale' || quotationType === 'sales';

  useEffect(() => { lines.forEach((l) => catalog.prefetchLine(l)); }, [lines, catalog]);

  const set = (i, patch) => {
    const next = lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    onChange(next);
  };
  const setBrand = (i, brand) => {
    catalog.loadBrandData(brand);
    set(i, { brand, model_name: '', processor: '', generation: '' });
  };
  const remove = (i) => onChange(lines.filter((_, idx) => idx !== i));
  const add = () => onChange([...lines, emptyLine()]);

  const req = (f) => required.includes(f);
  const err = (i, f) => (errors && errors.index === i && errors.field === f ? `${fieldLabel(f)} is required` : null);

  return (
    <div className="c-stack">
      {lines.map((l, i) => (
        <div
          key={l.line_id || l.id || i}
          className="c-line"
        >
          <div className="c-line-h">
            <span className="c-line-n">Line {i + 1}</span>
            <span className="c-line-cfg">{configText(l) || 'Choose a configuration'}</span>
            <span className="c-line-amt"><Money value={lineAmount(l)} /></span>
            {!disabled && lines.length > 1 && (
              <button type="button" className="c-icon-btn" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>

          <FormGrid cols={4}>
            <Field label="Brand" required={req('brand')} error={err(i, 'brand')}>
              <Select
                value={l.brand}
                onChange={(e) => setBrand(i, e.target.value)}
                placeholder={catalog.loadingBase ? 'Loading…' : 'Choose brand'}
                options={withCurrent(catalog.brands, l.brand)}
                disabled={disabled}
              />
            </Field>
            <Field label="Model" required={req('model_name')} error={err(i, 'model_name')}>
              <Select
                value={l.model_name}
                onChange={(e) => set(i, { model_name: e.target.value })}
                placeholder={l.brand ? 'Choose model' : 'Choose a brand first'}
                options={withCurrent(catalog.modelsByBrand[l.brand], l.model_name)}
                disabled={disabled || !l.brand}
              />
            </Field>
            <Field label="Processor" required={req('processor')} error={err(i, 'processor')}>
              <Select
                value={l.processor}
                onChange={(e) => set(i, { processor: e.target.value })}
                placeholder="Choose processor"
                options={withCurrent(catalog.processorsByBrand[l.brand], l.processor)}
                disabled={disabled || !l.brand}
              />
            </Field>
            <Field label="Generation" required={req('generation')} error={err(i, 'generation')}>
              <Select
                value={l.generation}
                onChange={(e) => set(i, { generation: e.target.value })}
                placeholder="Choose generation"
                options={withCurrent(catalog.generationsByBrand[l.brand], l.generation)}
                disabled={disabled || !l.brand}
              />
            </Field>
            <Field label="RAM" required={req('ram')} error={err(i, 'ram')}>
              <Select
                value={l.ram}
                onChange={(e) => set(i, { ram: e.target.value })}
                placeholder="Choose RAM"
                options={withCurrent(catalog.specMasters.rams, l.ram)}
                disabled={disabled}
              />
            </Field>
            <Field label="Storage" required={req('storage')} error={err(i, 'storage')}>
              <Select
                value={l.storage}
                onChange={(e) => set(i, { storage: e.target.value })}
                placeholder="Choose storage"
                options={withCurrent(catalog.specMasters.storages, l.storage)}
                disabled={disabled}
              />
            </Field>
            <Field label="GPU">
              <Select
                value={l.gpu}
                onChange={(e) => set(i, { gpu: e.target.value })}
                placeholder="None"
                options={withCurrent(catalog.specMasters.gpus, l.gpu)}
                disabled={disabled}
              />
            </Field>
            <Field label="Screen size">
              <Select
                value={l.screen_size}
                onChange={(e) => set(i, { screen_size: e.target.value })}
                placeholder="Any"
                options={withCurrent(catalog.specMasters.screen_sizes, l.screen_size)}
                disabled={disabled}
              />
            </Field>

            <Field label="Quantity" required error={err(i, 'quantity') && 'At least 1'}>
              <Input
                type="number" min="1" inputMode="numeric"
                value={l.quantity}
                onChange={(e) => set(i, { quantity: e.target.value })}
                disabled={disabled}
              />
            </Field>
            <Field
              label={isSale ? 'Price per laptop (₹)' : 'Monthly rent per laptop (₹)'}
              required
              error={err(i, 'rate') && 'Enter a rate above 0'}
            >
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={l.rate}
                onChange={(e) => set(i, { rate: e.target.value })}
                disabled={disabled}
              />
            </Field>
            {isSale ? (
              <>
                <Field label="Technical warranty (months)">
                  <Input
                    type="number" min="0" inputMode="numeric"
                    value={l.technical_warranty}
                    onChange={(e) => set(i, { technical_warranty: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Battery / charger warranty (months)">
                  <Input
                    type="number" min="0" inputMode="numeric"
                    value={l.battery_charger_warranty}
                    onChange={(e) => set(i, { battery_charger_warranty: e.target.value })}
                    disabled={disabled}
                  />
                </Field>
              </>
            ) : (
              <Field label="Lock-in period (months)">
                <Input
                  type="number" min="0" inputMode="numeric"
                  value={l.locking_period}
                  onChange={(e) => set(i, { locking_period: e.target.value })}
                  disabled={disabled}
                />
              </Field>
            )}
            <Field label="Line remark" span={isSale ? 4 : 1}>
              <Input
                value={l.remark}
                onChange={(e) => set(i, { remark: e.target.value })}
                placeholder="Optional"
                disabled={disabled}
              />
            </Field>
          </FormGrid>
        </div>
      ))}

      {!disabled && (
        <div>
          <Button onClick={add}><Plus size={16} aria-hidden="true" /> Add another configuration</Button>
        </div>
      )}
    </div>
  );
}

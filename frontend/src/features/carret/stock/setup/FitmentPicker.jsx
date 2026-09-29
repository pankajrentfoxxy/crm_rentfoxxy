import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, Field, Input, SearchSelect, Segmented } from '../../../../components/carret';
import { fetchCascadeBrands, fetchCascadeModels } from './partsApi';

/**
 * Which laptops a spare fits — Unset / Universal / Specific (a laptop brand,
 * optionally some of its models; no models = all of the brand). Brands and
 * models come from the laptop master (Asset configuration), same as the old
 * FitmentControls. A ticked model that is not in the master stays listed so a
 * search never hides a selection.
 */
export default function FitmentPicker({ value, onChange, allowUnset = true, label = 'Fits laptops' }) {
  const fitment = value?.fitment || 'unset';
  const brand = value?.fits_laptop_brand || '';
  const models = useMemo(() => (Array.isArray(value?.fits_laptop_models) ? value.fits_laptop_models : []), [value]);
  const [brands, setBrands] = useState([]);
  const [modelOpts, setModelOpts] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    fetchCascadeBrands()
      .then(({ data }) => { if (alive) setBrands((data?.brands || []).map((r) => r.name).filter(Boolean)); })
      .catch(() => { if (alive) setBrands([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setQ('');
    if (!brand) { setModelOpts([]); return undefined; }
    let alive = true;
    fetchCascadeModels(brand)
      .then(({ data }) => {
        if (alive) setModelOpts((data?.models || []).map((m) => (typeof m === 'string' ? m : m.name)).filter(Boolean));
      })
      .catch(() => { if (alive) setModelOpts([]); });
    return () => { alive = false; };
  }, [brand]);

  const visible = useMemo(() => {
    const all = [...modelOpts, ...models.filter((m) => !modelOpts.includes(m))];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((m) => models.includes(m) || m.toLowerCase().includes(needle)) : all;
  }, [modelOpts, models, q]);

  const set = (next) => onChange?.({ fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [], ...value, ...next });
  const pick = (f) => {
    if (f === 'specific') set({ fitment: 'specific' });
    else set({ fitment: f, fits_laptop_brand: null, fits_laptop_models: [] });
  };
  const toggle = (m) => {
    const s = new Set(models);
    if (s.has(m)) s.delete(m); else s.add(m);
    set({ fitment: 'specific', fits_laptop_models: [...s] });
  };

  const options = [
    ...(allowUnset ? [{ value: 'unset', label: 'Not tagged' }] : []),
    { value: 'universal', label: 'Universal' },
    { value: 'specific', label: 'Specific laptops' },
  ];
  const brandOptions = brand && !brands.includes(brand) ? [brand, ...brands] : brands;

  return (
    <div className="c-stack">
      <Field label={label}>
        <Segmented label={label} value={fitment} onChange={pick} options={options} />
      </Field>
      {fitment === 'specific' && (
        <>
          <Field label="Laptop brand" required>
            <SearchSelect
              value={brand}
              options={brandOptions}
              placeholder="Choose a brand…"
              onChange={(e) => set({ fitment: 'specific', fits_laptop_brand: e.target.value || null, fits_laptop_models: [] })}
            />
          </Field>
          {brand && (
            <Field label="Models" hint={models.length ? `${models.length} chosen` : 'None chosen = every model of this brand'}>
              <div className="c-stack">
                <Input type="search" placeholder={`Search ${modelOpts.length} models`} value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="border border-rule" style={{ maxHeight: '12rem', overflowY: 'auto', padding: 'var(--d-pad-y)', borderRadius: 'var(--d-radius)' }}>
                  {visible.length === 0
                    ? <span className="text-ink-3">{modelOpts.length ? 'No model matches' : 'No models on record for this brand'}</span>
                    : visible.map((m) => (
                      <Checkbox
                        key={m}
                        label={modelOpts.includes(m) ? m : `${m} (not in the model list)`}
                        checked={models.includes(m)}
                        onChange={() => toggle(m)}
                      />
                    ))}
                </div>
              </div>
            </Field>
          )}
        </>
      )}
    </div>
  );
}

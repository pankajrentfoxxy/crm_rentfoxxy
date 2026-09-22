import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { fetchCascadeBrands, fetchCascadeModels } from '../../../utils/assetConfigurationApi';

export const FITMENT = Object.freeze({
  UNSET: 'unset',
  UNIVERSAL: 'universal',
  SPECIFIC: 'specific',
});

export function emptyFitment() {
  return { fitment: FITMENT.UNSET, fits_laptop_brand: null, fits_laptop_models: [] };
}

/** Map catalog part defaults → instance-shaped fitment value. */
export function fitmentFromCatalogPart(part) {
  const f = String(part?.default_fitment || FITMENT.UNSET).toLowerCase();
  if (f === FITMENT.UNIVERSAL) {
    return { fitment: FITMENT.UNIVERSAL, fits_laptop_brand: null, fits_laptop_models: [] };
  }
  if (f === FITMENT.SPECIFIC) {
    const brands = Array.isArray(part?.compatible_brands) ? part.compatible_brands : [];
    const brand = brands[0] ? String(brands[0]).trim() : null;
    const models = Array.isArray(part?.compatible_models)
      ? part.compatible_models.map((m) => String(m).trim()).filter(Boolean)
      : [];
    if (!brand) return emptyFitment();
    return {
      fitment: FITMENT.SPECIFIC,
      fits_laptop_brand: brand,
      fits_laptop_models: models,
    };
  }
  return emptyFitment();
}

/** Map FitmentControls value → parts catalog payload fields. */
export function catalogFieldsFromFitment(value) {
  const f = String(value?.fitment || FITMENT.UNSET).toLowerCase();
  if (f === FITMENT.UNIVERSAL) {
    return { default_fitment: FITMENT.UNIVERSAL, compatible_brands: [], compatible_models: [] };
  }
  if (f === FITMENT.SPECIFIC) {
    const brand = value?.fits_laptop_brand ? String(value.fits_laptop_brand).trim() : '';
    const models = Array.isArray(value?.fits_laptop_models)
      ? value.fits_laptop_models.map((m) => String(m).trim()).filter(Boolean)
      : [];
    return {
      default_fitment: FITMENT.SPECIFIC,
      compatible_brands: brand ? [brand] : [],
      compatible_models: models,
    };
  }
  return { default_fitment: FITMENT.UNSET, compatible_brands: [], compatible_models: [] };
}

export function formatFitmentSummary(value) {
  const f = String(value?.fitment || FITMENT.UNSET).toLowerCase();
  if (f === FITMENT.UNIVERSAL) return 'Universal';
  if (f === FITMENT.SPECIFIC) {
    const brand = value?.fits_laptop_brand || '';
    const models = Array.isArray(value?.fits_laptop_models) ? value.fits_laptop_models.filter(Boolean) : [];
    if (!brand) return 'Specific';
    if (!models.length) return `${brand} (all models)`;
    if (models.length <= 2) return `${brand}: ${models.join(', ')}`;
    return `${brand}: ${models.slice(0, 2).join(', ')} +${models.length - 2}`;
  }
  return 'Not tagged';
}

function norm(s) {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/[-_/.,()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mirrors services/partFitmentService.js — keep the two in step.
const COMPANY_WORD_RE = /\b(inc|incorporated|corp|corporation|ltd|limited|pvt|private|gmbh|technologies|technology)\b/g;
const BRAND_ALIASES = { 'hewlett packard': 'hp', 'lenovo group': 'lenovo', xiomi: 'xiaomi', mi: 'xiaomi' };
const MODEL_SUFFIX_RE = /\s+(notebook pc|notebook|laptop)$/;

function normBrand(s) {
  const v = norm(s).replace(COMPANY_WORD_RE, '').replace(/\s+/g, ' ').trim();
  return BRAND_ALIASES[v] || v;
}

function normModel(s, brand) {
  let v = norm(s);
  let prev;
  do { prev = v; v = v.replace(MODEL_SUFFIX_RE, '').trim(); } while (v !== prev);
  const b = normBrand(brand);
  if (b) {
    for (let i = 0; i < 4 && (v === b || v.startsWith(`${b} `)); i += 1) {
      v = v === b ? '' : v.slice(b.length + 1).trim();
    }
  }
  return v.replace(/^(?:(?:inc|incorporated|corp|corporation|ltd|limited|pvt|private|gmbh)\s+)+/, '').trim();
}

/**
 * Client-side mirror of backend fits() when the API omits fit_status.
 *
 * The server knows the laptop brand master and can tell that "Dell / HP Probook
 * 640 G5" is really an HP; the browser cannot, so it only strips a brand prefix
 * that matches the brand it was given. Prefer the server's fit_status.
 */
export function computeFitStatus(unit, laptopBrand, laptopModel) {
  if (unit?.fit_status) return unit.fit_status;
  const fitment = String(unit?.fitment || FITMENT.UNSET).toLowerCase();
  if (fitment === FITMENT.UNSET) return 'unknown';
  if (fitment === FITMENT.UNIVERSAL) return 'fit';
  const lb = normBrand(laptopBrand);
  if (!lb) return 'unknown';
  const ub = normBrand(unit?.fits_laptop_brand);
  if (!ub || ub !== lb) return 'unfit';
  const models = Array.isArray(unit?.fits_laptop_models)
    ? unit.fits_laptop_models.map((m) => normModel(m, unit?.fits_laptop_brand)).filter(Boolean)
    : [];
  if (!models.length) return 'fit';
  const lm = normModel(laptopModel, laptopBrand);
  if (!lm) return 'unknown';
  return models.includes(lm) ? 'fit' : 'unfit';
}

const CHIP = {
  fit: { label: 'Fits', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  unfit: { label: 'Does not fit', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
  unknown: { label: 'Not tagged', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export function FitmentChip({ status, className = '' }) {
  const key = status === 'fit' || status === 'unfit' ? status : 'unknown';
  const cfg = CHIP[key];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.cls} ${className}`}>
      {cfg.label}
    </span>
  );
}

/**
 * Laptop fitment editor (not spare vendor brand/model).
 * Brands/models come from asset_config laptop cascade APIs.
 */
export default function FitmentControls({
  value,
  onChange,
  readOnly = false,
  compact = false,
  laptopHint,
  label,
  allowUnset = true,
}) {
  const fitment = String(value?.fitment || FITMENT.UNSET).toLowerCase();
  const brand = value?.fits_laptop_brand || '';
  const models = Array.isArray(value?.fits_laptop_models) ? value.fits_laptop_models : [];

  const [brands, setBrands] = useState([]);
  const [modelOpts, setModelOpts] = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelQuery, setModelQuery] = useState('');

  useEffect(() => {
    let alive = true;
    setLoadingBrands(true);
    fetchCascadeBrands()
      .then(({ data }) => {
        if (!alive) return;
        setBrands((data?.brands || []).map((r) => r.name).filter(Boolean));
      })
      .catch(() => { if (alive) setBrands([]); })
      .finally(() => { if (alive) setLoadingBrands(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setModelQuery('');
    if (!brand) {
      setModelOpts([]);
      return undefined;
    }
    let alive = true;
    setLoadingModels(true);
    fetchCascadeModels(brand)
      .then(({ data }) => {
        if (!alive) return;
        const list = (data?.models || []).map((m) => (typeof m === 'string' ? m : m.name)).filter(Boolean);
        setModelOpts(list);
      })
      .catch(() => { if (alive) setModelOpts([]); })
      .finally(() => { if (alive) setLoadingModels(false); });
    return () => { alive = false; };
  }, [brand]);

  // A brand can carry 60+ models, so the list is searchable. Ticked models stay
  // visible whatever the query, otherwise a search silently hides a selection.
  const visibleModels = useMemo(() => {
    const q = norm(modelQuery);
    const extras = models.filter((m) => !modelOpts.includes(m));
    const all = [...modelOpts, ...extras];
    if (!q) return all;
    return all.filter((m) => models.includes(m) || norm(m).includes(q));
  }, [modelOpts, models, modelQuery]);

  const segments = useMemo(() => {
    const list = [
      { id: FITMENT.UNIVERSAL, label: 'Universal' },
      { id: FITMENT.SPECIFIC, label: 'Specific' },
    ];
    if (allowUnset) list.unshift({ id: FITMENT.UNSET, label: 'Unset' });
    return list;
  }, [allowUnset]);

  const patch = (next) => {
    if (readOnly || !onChange) return;
    onChange({
      fitment: FITMENT.UNSET,
      fits_laptop_brand: null,
      fits_laptop_models: [],
      ...value,
      ...next,
    });
  };

  const setFitment = (f) => {
    if (f === FITMENT.UNIVERSAL || f === FITMENT.UNSET) {
      patch({ fitment: f, fits_laptop_brand: null, fits_laptop_models: [] });
      return;
    }
    patch({
      fitment: FITMENT.SPECIFIC,
      fits_laptop_brand: brand || laptopHint?.brand || null,
      fits_laptop_models: models.length ? models : (laptopHint?.model ? [laptopHint.model] : []),
    });
  };

  const toggleModel = (name) => {
    const set = new Set(models);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    patch({ fitment: FITMENT.SPECIFIC, fits_laptop_models: [...set] });
  };

  const pad = compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';

  return (
    <div className={`space-y-2 ${compact ? '' : ''}`}>
      {label ? (
        <span className="block text-gray-600 text-sm">{label}</span>
      ) : null}

      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 overflow-hidden bg-white">
        {segments.map((s) => {
          const isActive = fitment === s.id;
          return (
            <button
              key={s.id}
              type="button"
              disabled={readOnly}
              onClick={() => setFitment(s.id)}
              className={`${pad} font-semibold border-r border-slate-200 last:border-r-0 disabled:opacity-60 ${
                isActive ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {!readOnly && laptopHint?.brand && fitment === FITMENT.SPECIFIC ? (
        <button
          type="button"
          className="text-[11px] text-blue-700 hover:underline font-medium"
          onClick={() => patch({
            fitment: FITMENT.SPECIFIC,
            fits_laptop_brand: laptopHint.brand,
            fits_laptop_models: laptopHint.model ? [laptopHint.model] : [],
          })}
        >
          Prefill from laptop ({laptopHint.brand}{laptopHint.model ? ` ${laptopHint.model}` : ''})
        </button>
      ) : null}

      {fitment === FITMENT.SPECIFIC ? (
        <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
          <label className="block text-sm">
            <span className="text-xs text-slate-500">Laptop brand</span>
            <div className="relative mt-1">
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
                value={brand}
                disabled={readOnly || loadingBrands}
                onChange={(e) => patch({
                  fitment: FITMENT.SPECIFIC,
                  fits_laptop_brand: e.target.value || null,
                  fits_laptop_models: [],
                })}
              >
                <option value="">{loadingBrands ? 'Loading…' : 'Select brand…'}</option>
                {brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                {brand && !brands.includes(brand) ? (
                  <option value={brand}>{brand}</option>
                ) : null}
              </select>
              {loadingBrands ? (
                <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-slate-400" />
              ) : null}
            </div>
          </label>

          <div className="block text-sm">
            <span className="text-xs text-slate-500">
              Laptop models {loadingModels ? '(loading…)' : '(optional — empty = all models)'}
            </span>
            {brand && !readOnly ? (
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  className="w-full rounded-lg border border-slate-200 pl-8 pr-2 py-1.5 text-xs"
                  placeholder={`Search ${modelOpts.length || ''} model${modelOpts.length === 1 ? '' : 's'}…`.replace('  ', ' ')}
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  aria-label="Search laptop models"
                />
              </div>
            ) : null}
            <div className="mt-1 max-h-28 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-50">
              {!brand ? (
                <p className="px-3 py-2 text-[11px] text-slate-400 m-0">Pick a brand first</p>
              ) : modelOpts.length === 0 && !loadingModels && !visibleModels.length ? (
                <p className="px-3 py-2 text-[11px] text-slate-400 m-0">No models for this brand</p>
              ) : !visibleModels.length ? (
                <p className="px-3 py-2 text-[11px] text-slate-400 m-0">
                  No model matches “{modelQuery}”
                </p>
              ) : (
                visibleModels.map((m) => {
                  const isExtra = !modelOpts.includes(m);
                  return (
                    <label
                      key={m}
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${isExtra ? 'bg-amber-50' : ''} ${
                        readOnly ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50'
                      }`}
                      title={isExtra ? 'Not in the laptop model master' : undefined}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={models.includes(m)}
                        disabled={readOnly}
                        onChange={() => toggleModel(m)}
                      />
                      <span className="truncate">{m}</span>
                    </label>
                  );
                })
              )}
            </div>
            {models.length ? (
              <p className="mt-1 text-[11px] text-slate-500 m-0">
                {models.length} model{models.length === 1 ? '' : 's'} selected
                {!readOnly ? (
                  <button
                    type="button"
                    className="ml-2 text-blue-700 hover:underline font-medium"
                    onClick={() => patch({ fitment: FITMENT.SPECIFIC, fits_laptop_models: [] })}
                  >
                    clear
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {readOnly ? (
        <p className="text-xs text-slate-600 m-0">{formatFitmentSummary(value)}</p>
      ) : null}
    </div>
  );
}

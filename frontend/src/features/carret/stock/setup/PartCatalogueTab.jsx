import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  DataTable, EmptyState, Field, FilterBar, Money, Notice, Panel, Section, Select, StatTile,
} from '../../../../components/carret';
import {
  CATEGORY_LABEL, PART_CATEGORIES, errMsg, fetchFitmentSettings, fitsSummary, partCategory, saveFitmentSettings,
} from './partsApi';

/** Stock of a part: tracked parts count their in-stock units; consumables their count. */
export const partStock = (p) => (p.is_consumable ? Number(p.quantity) || 0 : Number(p.in_stock_count) || 0);
const threshold = (p) => (p.min_threshold ?? 5);

const ENFORCEMENT = [
  { value: 'filter', label: 'Filter — hide units that do not fit (warehouse can show all)' },
  { value: 'warn', label: 'Warn — show them with a warning, approval allowed' },
  { value: 'block', label: 'Block — no approving a unit that does not fit' },
];

function FitmentEnforcement() {
  const [stage, setStage] = useState(null);
  const [untagged, setUntagged] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchFitmentSettings()
      .then(({ data }) => { setStage(data.enforcement || 'filter'); setUntagged(data.untagged_units); })
      .catch(() => setStage('filter'));
  }, []);
  const save = async (v) => {
    setBusy(true);
    try { await saveFitmentSettings(v); setStage(v); toast.success('Fitment rule saved'); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Section title="Fitment rule at parts approval">
      <Field label="When a unit does not fit the laptop" hint={untagged != null ? `${untagged} unit(s) still untagged — they are offered for every laptop` : undefined}>
        <Select value={stage || ''} disabled={busy || stage === null} onChange={(e) => save(e.target.value)} options={ENFORCEMENT} />
      </Field>
    </Section>
  );
}

/**
 * The part master: one row per catalogue part with its stock, minimum and
 * value. Click a row for its units and actions.
 */
export default function PartCatalogueTab({ parts, loading, onOpenPart, canEditPart }) {
  const [filters, setFilters] = useState({});
  const onFilter = useCallback((k, v) => setFilters((f) => (k === 'brand' ? { ...f, brand: v, model: '' } : { ...f, [k]: v })), []);

  const live = useMemo(() => (parts || []).filter((p) => !p.archived), [parts]);
  const brands = useMemo(() => [...new Set(live.map((p) => p.default_brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [live]);
  const models = useMemo(() => [...new Set(live.filter((p) => !filters.brand || p.default_brand === filters.brand).map((p) => p.default_model).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [live, filters.brand]);

  const low = live.filter((p) => partStock(p) > 0 && partStock(p) < threshold(p));
  const out = live.filter((p) => partStock(p) === 0);
  const value = live.reduce((s, p) => s + partStock(p) * (Number(p.cost) || 0), 0);

  const rows = useMemo(() => {
    const q = (filters.search || '').trim().toLowerCase();
    return live.filter((p) => {
      const st = partStock(p);
      if (q && ![p.part_name, p.default_brand, p.default_model, p.model_number, p.part_sku, p.description, p.pin_size]
        .some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (filters.category && partCategory(p) !== filters.category) return false;
      if (filters.brand && p.default_brand !== filters.brand) return false;
      if (filters.model && p.default_model !== filters.model) return false;
      if (filters.stock === 'ok' && st < threshold(p)) return false;
      if (filters.stock === 'low' && !(st > 0 && st < threshold(p))) return false;
      if (filters.stock === 'out' && st !== 0) return false;
      return true;
    });
  }, [live, filters]);

  const filterDefs = [
    { key: 'search', type: 'search', label: 'Search', placeholder: 'Part, model number, SKU, brand, pin size' },
    { key: 'category', label: 'Category', options: PART_CATEGORIES },
    { key: 'brand', label: 'Brand', options: brands.map((b) => ({ value: b, label: b })) },
    { key: 'model', label: 'Model', options: models.map((m) => ({ value: m, label: m })) },
    { key: 'stock', label: 'Stock', options: [{ value: 'ok', label: 'At or above minimum' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }] },
  ];

  const cols = [
    { key: 'n', header: 'Part', render: (p) => p.part_name, sub: (p) => [p.model_number, p.pin_size, p.description].filter(Boolean).join(' · ') || null },
    { key: 'c', header: 'Category', render: (p) => CATEGORY_LABEL[partCategory(p)] || p.category, sub: (p) => (p.part_type && p.part_type !== partCategory(p) ? p.part_type : null) },
    { key: 'b', header: 'Brand / model', render: (p) => [p.default_brand, p.default_model].filter(Boolean).join(' · ') || '—' },
    { key: 'f', header: 'Default fitment', render: (p) => fitsSummary(p) },
    {
      key: 's',
      header: 'In stock',
      numeric: true,
      render: (p) => {
        const st = partStock(p);
        if (st === 0) return <span style={{ color: 'var(--alert-crit)' }}>✕ Out</span>;
        if (st < threshold(p)) return <span style={{ color: 'var(--alert-warn)' }}>⚠ {st}</span>;
        return st;
      },
      sub: (p) => (p.reserved_count ? `${p.reserved_count} reserved` : null),
    },
    { key: 'm', header: 'Min', numeric: true, render: (p) => threshold(p) },
    { key: 'u', header: 'Unit cost', numeric: true, render: (p) => <Money value={p.cost} showZero={false} /> },
    { key: 'v', header: 'Stock value', numeric: true, render: (p) => <Money value={partStock(p) * (Number(p.cost) || 0)} showZero={false} /> },
    { key: 'l', header: 'Shelf', render: (p) => p.location_code || '—', sub: (p) => p.part_sku || null },
  ];

  return (
    <div className="c-stack">
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <StatTile label="Parts" value={loading ? null : live.length} />
        <StatTile label="Low stock" value={loading ? null : low.length} family={low.length ? 'offcycle' : undefined} />
        <StatTile label="Out of stock" value={loading ? null : out.length} family={out.length ? 'offcycle' : undefined} />
        <StatTile label="Stock value" value={loading ? null : `₹${Math.round(value).toLocaleString('en-IN')}`} />
      </div>
      {low.length > 0 && filters.stock !== 'low' && (
        <Notice tone="warn" title={`${low.length} part${low.length === 1 ? ' is' : 's are'} below the minimum`} action={<button type="button" className="c-btn c-btn--quiet" onClick={() => onFilter('stock', 'low')}>Show them</button>} />
      )}
      {canEditPart && <FitmentEnforcement />}
      <Panel toolbar={<FilterBar filters={filterDefs} values={filters} onChange={onFilter} onClear={() => setFilters({})} count={`${rows.length} parts`} />}>
        {loading ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(p) => p.part_id}
            onRowClick={(p) => onOpenPart(p.part_id)}
            empty={<EmptyState title="No parts match" />}
          />
        )}
      </Panel>
    </div>
  );
}

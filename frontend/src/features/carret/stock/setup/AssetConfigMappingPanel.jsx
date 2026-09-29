import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, EmptyState, Field, Input, Notice, SearchSelect, Section,
} from '../../../../components/carret';
import {
  bulkAddBrandGenerations, bulkAddBrandModels, bulkAddBrandProcessors,
  bulkDeleteBrandGenerations, bulkDeleteBrandModels, bulkDeleteBrandProcessors,
  bulkStatusBrandGenerations, bulkStatusBrandModels, bulkStatusBrandProcessors,
  fetchLaptopSpecMapping, listGenerations, listModels, listProcessors,
} from '../../../../utils/assetConfigurationApi';
import { ActiveChip } from './AssetConfigEntityPanel';

/**
 * Brand → models / processors / generations. Ticking a value maps it to the
 * brand (the laptop forms then offer it under that brand); unticking removes
 * the mapping. A mapping can also be switched off without removing it.
 * RAM, SSD, screen size and graphics are global and are not mapped.
 */
const errMsg = (e, fallback) => e?.response?.data?.message || e?.message || fallback;

// The list endpoints cap a page at 100 rows; a brand can carry 150+ models.
async function fetchAllActive(listFn) {
  const first = await listFn({ page: 1, limit: 100, active_only: true });
  let items = first.data?.items || [];
  const totalPages = first.data?.pagination?.totalPages || 1;
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => listFn({ page: i + 2, limit: 100, active_only: true }))
    );
    rest.forEach((r) => { items = items.concat(r.data?.items || []); });
  }
  return items.filter((i) => i.status === 'active');
}

const KINDS = [
  { key: 'models', label: 'Models', idKey: 'model_id', add: bulkAddBrandModels, del: bulkDeleteBrandModels, status: bulkStatusBrandModels },
  { key: 'processors', label: 'Processors', idKey: 'processor_id', add: bulkAddBrandProcessors, del: bulkDeleteBrandProcessors, status: bulkStatusBrandProcessors },
  { key: 'generations', label: 'Generations', idKey: 'generation_id', add: bulkAddBrandGenerations, del: bulkDeleteBrandGenerations, status: bulkStatusBrandGenerations },
];

function MappingColumn({ kind, brandName, master, mapped, busy, canCreate, canEdit, canDelete, onRun }) {
  const [q, setQ] = useState('');
  const byId = useMemo(() => new Map(mapped.map((m) => [m[kind.idKey], m])), [mapped, kind.idKey]);
  const shown = useMemo(() => {
    // A value mapped to the brand but switched off in its master list still shows, so it can be unticked.
    const known = new Set(master.map((m) => m.id));
    const all = [...master, ...mapped.filter((m) => !known.has(m[kind.idKey])).map((m) => ({ id: m[kind.idKey], name: m.name }))];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length ? all.filter((m) => words.every((w) => m.name.toLowerCase().includes(w))) : all;
    // Mapped first, so what the brand already has is visible without scrolling.
    return [...list].sort((a, b) => Number(byId.has(b.id)) - Number(byId.has(a.id)) || a.name.localeCompare(b.name));
  }, [master, mapped, kind.idKey, q, byId]);

  const toggle = (item) => {
    const row = byId.get(item.id);
    if (row) {
      if (!canDelete) return;
      onRun(() => kind.del([row.id]), `${item.name} removed from ${brandName}`);
    } else {
      if (!canCreate) return;
      onRun(() => kind.add(null, [item.id]), `${item.name} mapped to ${brandName}`);
    }
  };

  return (
    <Section title={`${kind.label} · ${mapped.length} mapped`}>
      <div className="c-stack">
        <Input type="search" placeholder={`Search ${master.length} ${kind.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ maxHeight: '26rem', overflowY: 'auto' }}>
          {shown.length === 0 ? <EmptyState title="Nothing matches" /> : shown.map((item) => {
            const row = byId.get(item.id);
            return (
              <div key={item.id} className="flex items-center" style={{ gap: '8px', padding: '4px 0' }}>
                <label className="c-check" style={{ flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row)}
                    disabled={busy || (row ? !canDelete : !canCreate)}
                    onChange={() => toggle(item)}
                  />
                  <span className="truncate">{item.name}</span>
                </label>
                {row && row.status !== 'active' && <ActiveChip active={false} />}
                {row && canEdit && (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => onRun(() => kind.status([row.id], row.status === 'active' ? 'inactive' : 'active'), row.status === 'active' ? 'Mapping switched off' : 'Mapping switched on')}
                  >
                    {row.status === 'active' ? 'Switch off' : 'Switch on'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

export default function AssetConfigMappingPanel({ canCreate, canEdit, canDelete }) {
  const [tree, setTree] = useState(null);
  const [master, setMaster] = useState({ models: [], processors: [], generations: [] });
  const [brandId, setBrandId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mapRes, models, processors, generations] = await Promise.all([
        fetchLaptopSpecMapping(), fetchAllActive(listModels), fetchAllActive(listProcessors), fetchAllActive(listGenerations),
      ]);
      const brands = mapRes.data?.brands || [];
      setTree(brands);
      setMaster({ models, processors, generations });
      setBrandId((prev) => (prev && brands.some((b) => String(b.id) === String(prev)) ? prev : String(brands[0]?.id || '')));
    } catch (e) {
      setTree([]);
      toast.error(errMsg(e, 'Could not load the brand mapping'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const brand = (tree || []).find((b) => String(b.id) === String(brandId)) || null;

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) { toast.error(errMsg(e, 'That did not work')); } finally { setBusy(false); }
  };

  if (tree === null) return <EmptyState title="Loading…" />;
  return (
    <div className="c-stack">
      <Notice tone="info">
        Tick a model, processor or generation to offer it under the brand on laptop forms; untick to remove it.
        RAM, SSD, screen size and graphics are global lists and are not mapped.
      </Notice>
      <div style={{ maxWidth: '24rem' }}>
        <Field label="Brand">
          <SearchSelect
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            options={tree.map((b) => ({
              value: String(b.id),
              label: `${b.name} — ${b.models.length} models · ${b.processors.length} processors · ${b.generations.length} generations${b.status !== 'active' ? ' (inactive)' : ''}`,
            }))}
            placeholder="Choose a brand…"
          />
        </Field>
      </div>
      {!brand ? <EmptyState title="Choose a brand" /> : (
        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))' }}>
          {KINDS.map((kind) => (
            <MappingColumn
              key={`${brand.id}-${kind.key}`}
              kind={{ ...kind, add: (_b, ids) => kind.add(brand.id, ids) }}
              brandName={brand.name}
              master={master[kind.key]}
              mapped={brand[kind.key] || []}
              busy={busy}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              onRun={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}

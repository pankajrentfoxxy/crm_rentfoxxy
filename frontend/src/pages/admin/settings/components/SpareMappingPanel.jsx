import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  bulkAddSpareBrandModels,
  bulkDeleteSpareBrandModels,
  fetchSpareSpecMapping,
  listSpareModels,
} from '../../../../utils/assetConfigurationApi';

function MappingCheckboxColumn({
  title,
  allItems,
  mappedItems,
  entityIdKey,
  onToggle,
  busy,
  emptyLabel,
}) {
  const [search, setSearch] = useState('');

  const mappedByEntityId = useMemo(() => {
    const map = new Map();
    mappedItems.forEach((row) => map.set(row[entityIdKey], row));
    return map;
  }, [mappedItems, entityIdKey]);

  const filteredItems = useMemo(() => {
    const active = allItems.filter((item) => item.status === 'active');
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter((item) => item.name.toLowerCase().includes(q));
  }, [allItems, search]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 min-w-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-gray-800 truncate">{title}</h3>
        <span className="text-xs text-gray-400 shrink-0">{mappedItems.length} selected</span>
      </div>
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
      </div>
      <div className="border rounded-lg divide-y max-h-[420px] overflow-y-auto flex-1">
        {filteredItems.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">{emptyLabel}</div>
        ) : filteredItems.map((item) => {
          const mapped = mappedByEntityId.get(item.id);
          const checked = Boolean(mapped);
          return (
            <label
              key={item.id}
              className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${
                checked ? 'bg-blue-50/40' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={busy}
                onChange={() => onToggle(item.id, mapped)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium flex-1 truncate">{item.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

async function fetchAllEntity(listFn) {
  const limit = 100;
  const first = await listFn({ page: 1, limit, active_only: true });
  let items = first.data?.items || [];
  const totalPages = first.data?.pagination?.totalPages || 1;
  if (totalPages > 1) {
    const reqs = [];
    for (let page = 2; page <= totalPages; page += 1) {
      reqs.push(listFn({ page, limit, active_only: true }));
    }
    const rest = await Promise.all(reqs);
    rest.forEach((r) => { items = items.concat(r.data?.items || []); });
  }
  return items;
}

export default function SpareMappingPanel() {
  const [brands, setBrands] = useState([]);
  const [allModels, setAllModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [brandId, setBrandId] = useState(null);
  const [brandSearch, setBrandSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mapRes, modelItems] = await Promise.all([
        fetchSpareSpecMapping(),
        fetchAllEntity(listSpareModels),
      ]);
      const rows = mapRes.data?.brands || [];
      setBrands(rows);
      setAllModels(modelItems);
      setBrandId((prev) => (prev && rows.some((b) => b.id === prev) ? prev : rows[0]?.id || null));
    } catch {
      toast.error('Failed to load spare brand → model mapping');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedBrand = useMemo(() => brands.find((b) => b.id === brandId) || null, [brands, brandId]);
  const models = selectedBrand?.models || [];

  const filteredBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => b.name.toLowerCase().includes(q));
  }, [brands, brandSearch]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleModel = (entityId, mappedRow) => {
    if (!brandId) return;
    if (mappedRow) {
      run(() => bulkDeleteSpareBrandModels([mappedRow.id]), 'Model removed');
    } else {
      run(() => bulkAddSpareBrandModels(brandId, [entityId]), 'Model mapped');
    }
  };

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Map spare part models to each brand. Only mapped models appear when raising a spare PO or editing the catalog.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-[220px_1fr] gap-4">
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
                placeholder="Search brand…"
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
            ) : filteredBrands.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">No spare brands yet</div>
            ) : filteredBrands.map((brand) => (
              <button
                key={brand.id}
                type="button"
                onClick={() => setBrandId(brand.id)}
                className={`w-full flex flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm border-b border-gray-50 last:border-0 ${
                  brand.id === brandId ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50'
                }`}
              >
                <span className="truncate font-medium w-full">{brand.name}</span>
                <span className="text-[10px] text-gray-400">{brand.models?.length || 0} models</span>
              </button>
            ))}
          </div>
        </div>

        {!selectedBrand ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
            Select a spare brand
          </div>
        ) : (
          <MappingCheckboxColumn
            title={`Models · ${selectedBrand.name}`}
            allItems={allModels}
            mappedItems={models}
            entityIdKey="model_id"
            busy={busy}
            emptyLabel="Add spare models in the Model tab first"
            onToggle={toggleModel}
          />
        )}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, X } from 'lucide-react';
import SearchableSelect from '../../operation-management/components/SearchableSelect';
import useAssetCascadeCatalog from '../../../hooks/useAssetCascadeCatalog';
import { updateInventoryItemDescription } from '../inventoryManagementApi';

const EMPTY_FORM = {
  brand: '',
  model: '',
  processor: '',
  generation: '',
  ram: '',
  storage: '',
  gpu: '',
  screen_size: '',
};

function formFromItem(item = {}) {
  return {
    brand: item.brand || '',
    model: item.model || '',
    processor: item.processor || '',
    generation: item.generation || '',
    ram: item.ram || '',
    storage: item.storage || '',
    gpu: item.gpu || '',
    screen_size: item.screen_size || '',
  };
}

/** Include current value when legacy data is not yet in asset configuration. */
function withCurrentValue(options, current) {
  const list = options || [];
  if (!current || list.includes(current)) return list;
  return [current, ...list];
}

export default function ItemDescriptionEditModal({ open, row, onClose, onSaved }) {
  const item = row?.item_description || {};
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const {
    loadingBase,
    brands,
    specMasters,
    modelsByBrand,
    processorsByBrand,
    generationsByBrand,
    loadBrandData,
  } = useAssetCascadeCatalog(open);

  useEffect(() => {
    if (!open) return;
    setForm(formFromItem(item));
  }, [
    open,
    item.brand,
    item.model,
    item.processor,
    item.generation,
    item.ram,
    item.storage,
    item.gpu,
    item.screen_size,
  ]);

  useEffect(() => {
    if (!open || !form.brand) return;
    loadBrandData(form.brand);
  }, [open, form.brand, loadBrandData]);

  const setField = useCallback((field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'brand') {
        next.model = '';
        next.processor = '';
        next.generation = '';
        if (value) loadBrandData(value);
      }
      return next;
    });
  }, [loadBrandData]);

  const brandOptions = useMemo(
    () => withCurrentValue(brands, form.brand),
    [brands, form.brand],
  );
  const modelOptions = useMemo(
    () => withCurrentValue(modelsByBrand[form.brand] || [], form.model),
    [modelsByBrand, form.brand, form.model],
  );
  const processorOptions = useMemo(
    () => withCurrentValue(processorsByBrand[form.brand] || [], form.processor),
    [processorsByBrand, form.brand, form.processor],
  );
  const generationOptions = useMemo(
    () => withCurrentValue(generationsByBrand[form.brand] || [], form.generation),
    [generationsByBrand, form.brand, form.generation],
  );
  const ramOptions = useMemo(
    () => withCurrentValue(specMasters.rams, form.ram),
    [specMasters.rams, form.ram],
  );
  const storageOptions = useMemo(
    () => withCurrentValue(specMasters.storages, form.storage),
    [specMasters.storages, form.storage],
  );
  const gpuOptions = useMemo(
    () => withCurrentValue(specMasters.gpus, form.gpu),
    [specMasters.gpus, form.gpu],
  );
  const screenSizeOptions = useMemo(
    () => withCurrentValue(specMasters.screen_sizes, form.screen_size),
    [specMasters.screen_sizes, form.screen_size],
  );

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await updateInventoryItemDescription(row.serial_id, form);
      if (data.success) {
        toast.success(data.message || 'Item description updated');
        onClose?.();
        onSaved?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">Edit item description</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              {row.unique_product_serial || row.serial_number}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Values are from Asset Configuration</p>
          </div>
          <button type="button" className="p-2 rounded-lg hover:bg-slate-100" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {loadingBase ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading configuration…
          </div>
        ) : (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
            <SearchableSelect
              id="item-desc-brand"
              label="Brand"
              value={form.brand}
              onChange={(v) => setField('brand', v)}
              options={brandOptions}
            />
            <SearchableSelect
              id="item-desc-model"
              label="Model"
              value={form.model}
              onChange={(v) => setField('model', v)}
              options={modelOptions}
              disabled={!form.brand}
            />
            <SearchableSelect
              id="item-desc-processor"
              label="Processor"
              value={form.processor}
              onChange={(v) => setField('processor', v)}
              options={processorOptions}
              disabled={!form.brand}
            />
            <SearchableSelect
              id="item-desc-generation"
              label="Generation"
              value={form.generation}
              onChange={(v) => setField('generation', v)}
              options={generationOptions}
              disabled={!form.brand}
            />
            <SearchableSelect
              id="item-desc-ram"
              label="RAM"
              value={form.ram}
              onChange={(v) => setField('ram', v)}
              options={ramOptions}
            />
            <SearchableSelect
              id="item-desc-storage"
              label="Storage"
              value={form.storage}
              onChange={(v) => setField('storage', v)}
              options={storageOptions}
            />
            <SearchableSelect
              id="item-desc-gpu"
              label="GPU"
              value={form.gpu}
              onChange={(v) => setField('gpu', v)}
              options={gpuOptions}
            />
            <SearchableSelect
              id="item-desc-screen"
              label="Screen size"
              value={form.screen_size}
              onChange={(v) => setField('screen_size', v)}
              options={screenSizeOptions}
            />
          </div>
        )}

        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button
            type="button"
            className="flex-1 rounded-lg border border-slate-200 py-2 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-teal-700 text-white py-2 text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            onClick={save}
            disabled={saving || loadingBase}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

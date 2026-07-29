import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, PackagePlus, Wrench, X, Camera, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { addPartWithConfig, searchParts } from '../floorPipelineApi';
import { createPartRequest, attachPartToRequest, cancelPartRequest, uploadPartRequestPhotos } from '../partRequestsApi';
import { getBackendOrigin } from '../../../utils/api';
import { PART_CATEGORIES } from '../../../constants/laptopConditions';

const CONFIG_FIELDS = ['RAM', 'Storage', 'Processor', 'GPU', 'Screen', 'OS', 'Other'];
const STATUS_ORDER = ['pending', 'escalated', 'ordered', 'received', 'approved', 'attached'];
const statusOrder = (s) => {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? 0 : i;
};

function isBatteryPart(part) {
  if (!part) return false;
  const cat = String(part.category || part.part_type || '').toLowerCase().trim();
  const name = String(part.part_name || '').toLowerCase();
  return cat === 'battery' || cat.includes('battery') || name.includes('battery');
}

function photoUrl(p) {
  if (!p) return null;
  if (String(p).startsWith('http') || String(p).startsWith('blob:')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${String(p).replace(/^\//, '')}`;
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    escalated: 'bg-purple-100 text-purple-800',
    ordered: 'bg-blue-100 text-blue-800',
    received: 'bg-cyan-100 text-cyan-800',
    approved: 'bg-emerald-100 text-emerald-800',
    attached: 'bg-green-600 text-white',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${map[status] || 'bg-slate-100 text-slate-700'}`}>
      {status}
    </span>
  );
}

function AttachPartModal({ request, onAttached, onClose }) {
  // Inventory declared at approval whether this laptop even has an old part.
  const noOldPartExpected = request.old_part_expected === 'not_available';
  const [oldPartReturned, setOldPartReturned] = useState(!noOldPartExpected);
  const [oldPartCondition, setOldPartCondition] = useState('defective');
  const [oldPartCategory, setOldPartCategory] = useState(
    request.old_part_category || request.old_part_catalog_category || request.category || ''
  );
  const [oldPartName, setOldPartName] = useState(
    request.old_part_catalog_name || request.old_part_name || request.part_name || ''
  );
  const [oldPartSerial, setOldPartSerial] = useState('');
  const [oldPartNotes, setOldPartNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const canConfirm = noOldPartExpected || oldPartReturned;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-sm p-5 shadow-xl my-8">
        <h3 className="font-semibold mb-1">Attach Part: {request.part_name}</h3>
        {request.prt_id && (
          <p className="font-mono text-xs text-blue-700 mb-3">Part ID: {request.prt_id}</p>
        )}

        {request.request_type === 'upgrade' && (
          <div className="bg-blue-50 rounded-lg p-3 mb-3 text-sm">
            <p className="font-medium text-blue-900">Config will be updated:</p>
            <p className="text-blue-700 capitalize">
              {request.config_field}: {request.old_value || '—'} → {request.new_value}
            </p>
          </div>
        )}

        {noOldPartExpected ? (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3 text-xs text-slate-700">
            Inventory recorded that this laptop has no old part to return. Tick the box below if one
            does come out after all.
          </div>
        ) : null}

        <div className="space-y-3 mb-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={oldPartReturned}
              onChange={(e) => setOldPartReturned(e.target.checked)}
            />
            <span>I am returning the {request.request_type === 'replacement' ? 'defective part' : 'old part'} to warehouse</span>
          </label>

          {oldPartReturned && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Category</label>
                  <select
                    value={oldPartCategory}
                    onChange={(e) => setOldPartCategory(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {PART_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Condition</label>
                  <select
                    value={oldPartCondition}
                    onChange={(e) => setOldPartCondition(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 text-sm"
                  >
                    <option value="defective">Defective</option>
                    <option value="worn">Worn</option>
                    <option value="good">Good (reusable)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Part name</label>
                <input
                  value={oldPartName}
                  onChange={(e) => setOldPartName(e.target.value)}
                  placeholder="e.g. Samsung 8GB DDR4"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Old part serial <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  value={oldPartSerial}
                  onChange={(e) => setOldPartSerial(e.target.value)}
                  placeholder="If the old part has one"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <textarea value={oldPartNotes} onChange={(e) => setOldPartNotes(e.target.value)} rows={2}
                placeholder="Notes about the old part (optional)"
                className="w-full border rounded-lg px-3 py-2 text-sm" />
              <p className="text-[11px] text-gray-500 m-0">
                The old part gets its own Part ID and QR label so it can be tracked, repaired or written off.
              </p>
            </>
          )}
        </div>

        {!canConfirm && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 mb-3 text-xs text-amber-800">
            You must return the old/defective part to warehouse. Ticket will not be unblocked until this is done.
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm">Cancel</button>
          <button type="button" disabled={saving || !canConfirm}
            onClick={async () => {
              setSaving(true);
              try {
                const { data } = await attachPartToRequest(request.request_id, {
                  old_part_returned: oldPartReturned,
                  old_part_condition: oldPartCondition,
                  old_part_notes: oldPartNotes,
                  old_part_category: oldPartCategory || undefined,
                  old_part_name: oldPartName || undefined,
                  old_part_serial: oldPartSerial || undefined,
                });
                toast.success(data?.message || 'Part attached! Ticket unblocked.');
                onAttached();
                onClose();
              } catch (e) {
                toast.error(e.response?.data?.message || 'Failed');
              } finally { setSaving(false); }
            }}
            className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Attaching…' : 'Confirm Attachment'}
          </button>
        </div>
      </div>
    </div>
  );
}

const REQUEST_TYPE_OPTIONS = [
  { value: 'replacement', label: 'Replace Defective' },
  { value: 'upgrade', label: 'Upgrade' },
  { value: 'consumable', label: 'Consumable' },
];

const UPGRADE_FIELD_OPTIONS = [
  { value: '', label: 'What are you upgrading?' },
  { value: 'ram', label: 'RAM' },
  { value: 'storage', label: 'Storage / SSD' },
  { value: 'display', label: 'Display' },
  { value: 'battery', label: 'Battery' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'gpu', label: 'GPU' },
  { value: 'other', label: 'Other' },
];

/** One editable row in the multi-part request cart. */
function RequestItemRow({ item, ticket, onChange, onRemove, onUploadBattery, onRemovePhoto, uploading }) {
  const battery = isBatteryPart(item.part);
  const qty = item.part.quantity || 0;

  const setConfigField = (value) => {
    const auto = {
      ram: ticket?.ram, storage: ticket?.storage, display: ticket?.screen_size,
      processor: ticket?.processor, gpu: ticket?.gpu,
    }[value] || '';
    onChange(item.key, { config_field: value, old_value: auto });
  };

  return (
    <div className="rounded-lg border border-blue-100 bg-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-slate-900 truncate">{item.part.part_name}</p>
          <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
            qty > 5 ? 'bg-green-100 text-green-700' : qty > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
          }`}>
            {qty > 0 ? `In Stock: ${qty}` : 'Out of Stock — Procurement'}
          </span>
        </div>
        <button type="button" onClick={() => onRemove(item.key)} className="shrink-0 p-1 rounded hover:bg-red-50 text-red-500" title="Remove">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-slate-600">
          Type
          <select
            value={item.request_type}
            onChange={(e) => onChange(item.key, { request_type: e.target.value })}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          >
            {REQUEST_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Quantity
          <input type="number" min={1} value={item.quantity}
            onChange={(e) => onChange(item.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
      </div>

      {item.request_type === 'upgrade' && (
        <div className="space-y-2 bg-blue-50 rounded-lg p-2 border border-blue-100">
          <select value={item.config_field} onChange={(e) => setConfigField(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm">
            {UPGRADE_FIELD_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">Current (old)</label>
              <input value={item.old_value} onChange={(e) => onChange(item.key, { old_value: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 8 GB" />
            </div>
            <div>
              <label className="text-xs text-gray-500">After upgrade (new)*</label>
              <input value={item.new_value} onChange={(e) => onChange(item.key, { new_value: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 16 GB" />
            </div>
          </div>
        </div>
      )}

      {battery && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 space-y-2">
          <p className="text-xs font-semibold text-amber-900">Battery details (required)</p>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            value={item.battery_model_number}
            onChange={(e) => onChange(item.key, { battery_model_number: e.target.value })}
            placeholder="Battery Model Number * e.g. L19C3PD4"
          />
          <label className="flex items-center justify-center gap-2 border border-dashed rounded-lg px-3 py-3 text-sm text-slate-600 cursor-pointer hover:bg-white">
            <Camera className="w-4 h-4" />
            {uploading ? 'Uploading…' : 'Upload battery photos *'}
            <input type="file" accept="image/*" multiple className="hidden" disabled={uploading}
              onChange={(e) => { const f = e.target.files; onUploadBattery(item.key, f); e.target.value = ''; }} />
          </label>
          {item.battery_photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.battery_photos.map((url, idx) => (
                <div key={`${url}-${idx}`} className="relative w-14 h-14 rounded border overflow-hidden bg-white">
                  <img src={photoUrl(item.battery_previews[idx] || url)} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => onRemovePhoto(item.key, idx)}
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <textarea value={item.description} onChange={(e) => onChange(item.key, { description: e.target.value })} rows={2}
        placeholder="Why is this part needed? (optional)" className="w-full border rounded-lg px-3 py-2 text-sm" />

      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={item.blocks_stage}
          onChange={(e) => onChange(item.key, { blocks_stage: e.target.checked })} />
        Block ticket until this part is attached
      </label>
    </div>
  );
}

export default function PartsConfigPanel({ ticket, parts = [], configHistory = [], partRequests = [], onUpdated }) {
  const [mode, setMode] = useState('request');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [requestType, setRequestType] = useState('replacement'); // default type applied to newly added items
  const [items, setItems] = useState([]); // multi-part request cart
  const itemKey = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [attachModal, setAttachModal] = useState(null);

  const [batteryModelNumber, setBatteryModelNumber] = useState('');
  const [batteryPhotos, setBatteryPhotos] = useState([]);
  const [batteryPhotoPreviews, setBatteryPhotoPreviews] = useState([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [dQuantity, setDQuantity] = useState(1);
  const [dIsUpgrade, setDIsUpgrade] = useState(false);
  const [dConfigField, setDConfigField] = useState('RAM');
  const [dOldValue, setDOldValue] = useState('');
  const [dNewValue, setDNewValue] = useState('');
  const [dNotes, setDNotes] = useState('');

  const currentConfig = useMemo(() => ({
    processor: ticket?.processor || '—',
    ram: ticket?.ram || '—',
    storage: ticket?.storage || '—',
    gpu: ticket?.gpu || '—',
    os: ticket?.os || '—',
  }), [ticket]);

  const selectedIsBattery = isBatteryPart(selected);

  const search = useCallback(async (q) => {
    setSearching(true);
    try {
      const { data } = await searchParts(q || '', 100);
      setResults(data.parts || []);
    } catch { setResults([]); } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    if (selected) return undefined;
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search, selected]);

  useEffect(() => {
    if (!dIsUpgrade || !dConfigField) return;
    const map = { RAM: 'ram', Storage: 'storage', Processor: 'processor', GPU: 'gpu', OS: 'os' };
    const key = map[dConfigField];
    if (key && ticket?.[key]) setDOldValue(ticket[key]);
  }, [dIsUpgrade, dConfigField, ticket]);

  const partsTotal = useMemo(
    () => parts.reduce((s, p) => s + (parseFloat(p.total_part_cost) || 0), 0),
    [parts]
  );

  const activeRequests = useMemo(
    () => (partRequests || []).filter((r) => !['cancelled'].includes(r.status)),
    [partRequests]
  );

  const resetBattery = () => {
    setBatteryModelNumber('');
    setBatteryPhotos([]);
    setBatteryPhotoPreviews((prev) => {
      prev.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) { /* ignore */ } });
      return [];
    });
    setFieldErrors({});
  };

  const resetSelection = () => {
    setSelected(null);
    setQuery('');
    setResults([]);
    setDropdownOpen(false);
    resetBattery();
  };

  const selectPart = (p) => {
    setSelected(p);
    setQuery(p.part_name);
    setResults([]);
    setDropdownOpen(false);
    resetBattery();
    setFieldErrors({});
  };

  // ── Multi-part request cart ────────────────────────────────────────────────
  const addItem = (p) => {
    setItems((prev) => {
      if (prev.some((it) => it.part.part_id === p.part_id)) {
        toast.error(`${p.part_name} is already added`);
        return prev;
      }
      itemKey.current += 1;
      return [...prev, {
        key: itemKey.current,
        part: p,
        request_type: requestType,
        quantity: 1,
        description: '',
        blocks_stage: true,
        config_field: '',
        old_value: '',
        new_value: '',
        battery_model_number: '',
        battery_photos: [],
        battery_previews: [],
      }];
    });
    setQuery('');
    setResults([]);
    setDropdownOpen(false);
  };

  const updateItem = (key, patch) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const removeItem = (key) => setItems((prev) => prev.filter((it) => it.key !== key));

  const handleItemBatteryFiles = async (key, fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type?.startsWith('image/'));
    if (!files.length) { toast.error('Select image files only'); return; }
    setUploadingPhotos(true);
    try {
      const { data } = await uploadPartRequestPhotos(files);
      const urls = data.urls || [];
      const previews = files.map((f) => URL.createObjectURL(f));
      setItems((prev) => prev.map((it) => (it.key === key
        ? {
          ...it,
          battery_photos: [...it.battery_photos, ...urls],
          battery_previews: [...it.battery_previews, ...previews],
        }
        : it)));
      toast.success(`${urls.length} photo(s) uploaded`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Photo upload failed');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const removeItemBatteryPhoto = (key, idx) => {
    setItems((prev) => prev.map((it) => {
      if (it.key !== key) return it;
      const previews = [...it.battery_previews];
      const [removed] = previews.splice(idx, 1);
      if (removed) { try { URL.revokeObjectURL(removed); } catch (_) { /* ignore */ } }
      return {
        ...it,
        battery_photos: it.battery_photos.filter((_, i) => i !== idx),
        battery_previews: previews,
      };
    }));
  };

  const handleSubmitAll = async () => {
    if (!items.length) { toast.error('Add at least one part'); return; }
    for (const it of items) {
      if (isBatteryPart(it.part)) {
        if (!String(it.battery_model_number || '').trim()) {
          toast.error(`Battery Model Number required for ${it.part.part_name}`); return;
        }
        if (!it.battery_photos.length) {
          toast.error(`At least one battery photo required for ${it.part.part_name}`); return;
        }
      }
      if (it.request_type === 'upgrade' && (!it.config_field || !String(it.new_value || '').trim())) {
        toast.error(`Upgrade needs a config field and new value for ${it.part.part_name}`); return;
      }
    }
    setSubmitting(true);
    let ok = 0;
    const failed = [];
    for (const it of items) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await createPartRequest({
          ticket_id: ticket.ticket_id,
          request_type: it.request_type,
          part_id: it.part.part_id,
          quantity: it.quantity,
          description: it.description.trim() || undefined,
          blocks_stage: it.blocks_stage,
          config_field: it.request_type === 'upgrade' ? it.config_field : undefined,
          old_value: it.request_type === 'upgrade' ? it.old_value : undefined,
          new_value: it.request_type === 'upgrade' ? it.new_value : undefined,
          battery_model_number: isBatteryPart(it.part) ? it.battery_model_number.trim() : undefined,
          battery_photos: isBatteryPart(it.part) ? it.battery_photos : undefined,
        });
        ok += 1;
      } catch (e) {
        failed.push(it.part.part_name);
      }
    }
    setSubmitting(false);
    if (ok) toast.success(`${ok} part request(s) submitted`);
    if (failed.length) toast.error(`Failed: ${failed.join(', ')}`);
    if (ok) {
      setItems([]);
      resetSelection();
      onUpdated?.();
    }
  };

  const handleBatteryFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type?.startsWith('image/'));
    if (!files.length) {
      toast.error('Select image files only');
      return;
    }
    setUploadingPhotos(true);
    try {
      const { data } = await uploadPartRequestPhotos(files);
      const urls = data.urls || [];
      setBatteryPhotos((prev) => [...prev, ...urls]);
      setBatteryPhotoPreviews((prev) => [
        ...prev,
        ...files.map((f) => URL.createObjectURL(f)),
      ]);
      setFieldErrors((e) => ({ ...e, batteryPhotos: undefined }));
      toast.success(`${urls.length} photo(s) uploaded`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Photo upload failed');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const removeBatteryPhoto = (idx) => {
    setBatteryPhotos((prev) => prev.filter((_, i) => i !== idx));
    setBatteryPhotoPreviews((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed) {
        try { URL.revokeObjectURL(removed); } catch (_) { /* ignore */ }
      }
      return next;
    });
  };

  const validateBattery = () => {
    if (!selectedIsBattery) return true;
    const errs = {};
    if (!String(batteryModelNumber || '').trim()) {
      errs.batteryModel = 'Battery Model Number is required';
    }
    if (!batteryPhotos.length) {
      errs.batteryPhotos = 'At least one battery photo is required';
    }
    setFieldErrors(errs);
    if (errs.batteryModel || errs.batteryPhotos) {
      toast.error(errs.batteryModel || errs.batteryPhotos);
      return false;
    }
    return true;
  };

  const handleDirectAttach = async () => {
    if (!selected?.part_id) { toast.error('Select a part from the catalog dropdown'); return; }
    const max = selected.quantity || 0;
    if (dQuantity < 1 || dQuantity > max) { toast.error(`Quantity must be 1–${max}`); return; }
    if (dIsUpgrade && !dNewValue.trim()) { toast.error('New value required for upgrades'); return; }
    if (!validateBattery()) return;
    setSubmitting(true);
    try {
      const { data } = await addPartWithConfig(ticket.ticket_id, {
        part_id: selected.part_id,
        quantity: dQuantity,
        notes: dNotes.trim() || undefined,
        is_upgrade: dIsUpgrade,
        config_field: dIsUpgrade ? dConfigField : undefined,
        old_value: dIsUpgrade ? dOldValue : undefined,
        new_value: dIsUpgrade ? dNewValue : undefined,
      });
      if (data.success) {
        toast.success(data.message || 'Part attached');
        resetSelection(); setDQuantity(1); setDIsUpgrade(false); setDNotes('');
        onUpdated?.();
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to attach part');
    } finally { setSubmitting(false); }
  };

  const handleCancel = async (req) => {
    if (!window.confirm(`Cancel request ${req.request_number}?`)) return;
    try {
      await cancelPartRequest(req.request_id);
      toast.success('Request cancelled');
      onUpdated?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to cancel');
    }
  };

  const stockBadge = (qty) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
      qty > 5 ? 'bg-green-100 text-green-700' : qty > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
    }`}>
      {qty > 0 ? `In Stock: ${qty}` : 'Out of Stock — goes to Procurement'}
    </span>
  );

  const partDetailsCard = selected ? (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm grid sm:grid-cols-3 gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">Part Name</p>
        <p className="font-medium text-slate-900">{selected.part_name}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">Model Number</p>
        <p className="font-mono text-slate-800">{selected.model_number || '—'}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase text-slate-500">Pin Size</p>
        <p className="font-mono text-slate-800">{selected.pin_size || '—'}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Reference only</p>
      </div>
    </div>
  ) : null;

  const batteryFields = selectedIsBattery ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
      <p className="text-xs font-semibold text-amber-900">Battery details (required)</p>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Battery Model Number *</label>
        <input
          className={`w-full border rounded-lg px-3 py-2 text-sm font-mono ${fieldErrors.batteryModel ? 'border-red-400' : ''}`}
          value={batteryModelNumber}
          onChange={(e) => {
            setBatteryModelNumber(e.target.value);
            setFieldErrors((err) => ({ ...err, batteryModel: undefined }));
          }}
          placeholder="e.g. L19C3PD4"
        />
        {fieldErrors.batteryModel ? (
          <p className="text-xs text-red-600 mt-1">{fieldErrors.batteryModel}</p>
        ) : null}
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Battery Photos *</label>
        <label className="flex items-center justify-center gap-2 border border-dashed rounded-lg px-3 py-4 text-sm text-slate-600 cursor-pointer hover:bg-white">
          <Camera className="w-4 h-4" />
          {uploadingPhotos ? 'Uploading…' : 'Upload photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploadingPhotos}
            onChange={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const files = e.target.files;
              handleBatteryFiles(files);
              e.target.value = '';
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
        {fieldErrors.batteryPhotos ? (
          <p className="text-xs text-red-600 mt-1">{fieldErrors.batteryPhotos}</p>
        ) : (
          <p className="text-[11px] text-slate-500 mt-1">At least one photo of the installed battery is required.</p>
        )}
        {batteryPhotos.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {batteryPhotos.map((url, idx) => (
              <div key={`${url}-${idx}`} className="relative w-16 h-16 rounded border overflow-hidden bg-white">
                <img src={photoUrl(batteryPhotoPreviews[idx] || url)} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeBatteryPhoto(idx)}
                  className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {activeRequests.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-500">Active Part Requests</h4>
          {activeRequests.map((req) => (
            <div key={req.request_id} className="border rounded-lg p-3 bg-white">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-xs text-blue-700">{req.request_number}</span>
                  <p className="font-medium text-sm mt-0.5">{req.part_name}</p>
                  {req.battery_model_number ? (
                    <p className="text-xs text-amber-800 mt-0.5">Battery model: <span className="font-mono">{req.battery_model_number}</span></p>
                  ) : null}
                  {req.request_type === 'upgrade' && (
                    <p className="text-xs text-blue-600 capitalize">
                      ⬆ {req.config_field}: {req.old_value || '—'} → {req.new_value}
                    </p>
                  )}
                  {req.prt_id && <p className="font-mono text-[11px] text-emerald-700 mt-0.5">{req.prt_id}{req.location_code ? ` · ${req.location_code}` : ''}</p>}
                </div>
                <StatusBadge status={req.status} />
              </div>

              <div className="flex items-center gap-1 mt-2">
                {['pending', 'approved', 'attached'].map((s, i) => (
                  <React.Fragment key={s}>
                    <div className={`w-2 h-2 rounded-full ${
                      req.status === s ? 'bg-blue-600' : statusOrder(req.status) > statusOrder(s) ? 'bg-green-500' : 'bg-gray-200'
                    }`} />
                    {i < 2 && <div className="flex-1 h-px bg-gray-200" />}
                  </React.Fragment>
                ))}
              </div>

              {req.status === 'rejected' && req.rejection_reason && (
                <p className="text-xs text-red-600 mt-2">Rejected: {req.rejection_reason}</p>
              )}

              {req.status === 'approved' && (
                <div className="mt-2 pt-2 border-t">
                  <p className="text-xs text-green-700 mb-2">
                    ✓ Approved by warehouse. PRT-ID: {req.prt_id || 'assigned'}
                  </p>
                  <button type="button" onClick={() => setAttachModal(req)}
                    className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">
                    Attach Part + Return Old Part
                  </button>
                </div>
              )}

              {req.blocks_stage && !['attached', 'cancelled', 'rejected'].includes(req.status) && (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-amber-700">⛔ Ticket blocked until part is attached</span>
                  <button type="button" onClick={() => handleCancel(req)} className="text-slate-500 underline">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
        <div className="flex gap-2">
          <button type="button" onClick={() => { setMode('request'); resetSelection(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
              mode === 'request' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
            <PackagePlus className="w-4 h-4" /> Request Part
          </button>
          <button type="button" onClick={() => { setMode('direct'); resetSelection(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
              mode === 'direct' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
            <Wrench className="w-4 h-4" /> Direct Attach
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {mode === 'request'
            ? 'Raise a part request — warehouse approval (or procurement) required before attaching.'
            : 'For consumables / minor items: attach immediately without approval.'}
        </p>

        {mode === 'request' && (
          <div className="space-y-1">
          <p className="text-[11px] text-slate-400">Default type for parts you add (change per part below)</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'replacement', label: 'Replace Defective', desc: 'Swap broken part' },
              { value: 'upgrade', label: 'Upgrade', desc: 'Improve specification' },
              { value: 'consumable', label: 'Consumable', desc: 'Paste, screws, etc.' },
            ].map((opt) => (
              <button key={opt.value} type="button" onClick={() => setRequestType(opt.value)}
                className={`p-2 border rounded-lg text-left text-xs ${
                  requestType === opt.value ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-200 hover:border-gray-300'}`}>
                <p className="font-semibold">{opt.label}</p>
                <p className="text-gray-500 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
          </div>
        )}

        <div className="relative">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            {mode === 'request' ? 'Add parts from catalog (select multiple) *' : 'Select part from catalog *'}
          </label>
          <Search className="absolute left-3 top-[34px] w-4 h-4 text-slate-400" />
          <input
            className="w-full rounded-lg border pl-9 pr-20 py-2 text-sm"
            placeholder="Search by part name…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
              setDropdownOpen(true);
              resetBattery();
            }}
            onFocus={() => {
              setDropdownOpen(true);
              if (!results.length) search(query);
            }}
            autoComplete="off"
            readOnly={Boolean(selected)}
          />
          {selected ? (
            <button
              type="button"
              onClick={resetSelection}
              className="absolute right-2 top-[30px] text-xs text-slate-500 underline"
            >
              Change
            </button>
          ) : null}
          {dropdownOpen && !selected && (
            <ul className="absolute z-20 mt-1 w-full border rounded-lg bg-white shadow-lg divide-y max-h-48 overflow-y-auto text-sm">
              {searching ? (
                <li className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></li>
              ) : results.length ? (
                results.map((p) => {
                  const added = mode === 'request' && items.some((it) => it.part.part_id === p.part_id);
                  return (
                  <li key={p.part_id}>
                    <button type="button" disabled={added}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${added ? 'opacity-50 cursor-not-allowed' : ''}`}
                      onClick={() => (mode === 'request' ? addItem(p) : selectPart(p))}>
                      <span className="font-medium">{p.part_name}</span>
                      {added ? <span className="text-[11px] text-green-600 ml-2">Added</span> : null}
                      <span className="text-xs text-slate-500 ml-2">
                        {p.category || p.part_type}
                        {p.model_number ? ` · ${p.model_number}` : ''}
                        {' · '}Available: {p.quantity}
                      </span>
                    </button>
                  </li>
                  );
                })
              ) : (
                <li className="p-3 text-sm text-slate-500">No matching parts — choose from catalog only</li>
              )}
            </ul>
          )}
        </div>

        {mode === 'request' && (
          items.length === 0 ? (
            <p className="text-xs text-slate-500">
              Search and add one or more parts above. Each part becomes its own request.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase text-slate-500">
                {items.length} part{items.length > 1 ? 's' : ''} to request
              </p>
              {items.map((it) => (
                <RequestItemRow
                  key={it.key}
                  item={it}
                  ticket={ticket}
                  onChange={updateItem}
                  onRemove={removeItem}
                  onUploadBattery={handleItemBatteryFiles}
                  onRemovePhoto={removeItemBatteryPhoto}
                  uploading={uploadingPhotos}
                />
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={() => setItems([])} className="px-3 py-1.5 rounded border text-xs">
                  Clear all
                </button>
                <button type="button" disabled={submitting || uploadingPhotos} onClick={handleSubmitAll}
                  className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
                  {submitting ? 'Submitting…' : `Submit ${items.length} request${items.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          )
        )}

        {mode === 'direct' && selected && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{selected.part_name}</p>
              {stockBadge(selected.quantity || 0)}
            </div>
            {partDetailsCard}
            {batteryFields}

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-xs">
                Quantity*
                <input type="number" min={1} max={selected.quantity} value={dQuantity} onChange={(e) => setDQuantity(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" />
              </label>
              <label className="flex items-center gap-2 text-xs pt-5">
                <input type="checkbox" checked={dIsUpgrade} onChange={(e) => setDIsUpgrade(e.target.checked)} /> Is this an upgrade?
              </label>
            </div>
            {dIsUpgrade && (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-xs">Config field*
                  <select value={dConfigField} onChange={(e) => setDConfigField(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5">
                    {CONFIG_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="block text-xs">Old value
                  <input value={dOldValue} onChange={(e) => setDOldValue(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5" />
                </label>
                <label className="block text-xs sm:col-span-2">New value*
                  <input value={dNewValue} onChange={(e) => setDNewValue(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5" />
                </label>
              </div>
            )}
            <label className="block text-xs">Notes
              <textarea value={dNotes} onChange={(e) => setDNotes(e.target.value)} className="mt-1 w-full rounded border px-2 py-1.5 min-h-[60px]" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={resetSelection} className="px-3 py-1.5 rounded border text-xs">Clear</button>
              <button type="button" disabled={submitting || uploadingPhotos} onClick={handleDirectAttach}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
                {submitting ? 'Attaching…' : 'Attach Part'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border overflow-hidden">
        <h3 className="font-semibold text-slate-900 px-4 py-3 bg-slate-50 border-b text-sm">Config History</h3>
        {configHistory.length ? (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Field</th>
                <th className="px-3 py-2 text-left">Before → After</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {configHistory.map((h) => (
                <tr key={h.history_id} className="border-t">
                  <td className="px-3 py-2 text-xs">{new Date(h.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 capitalize">{h.field_name}</td>
                  <td className="px-3 py-2">{h.old_value || '—'} → <strong>{h.new_value}</strong></td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      h.change_type === 'upgrade' ? 'bg-green-100 text-green-800' : h.change_type === 'replacement' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}>{h.change_type}</span>
                  </td>
                  <td className="px-3 py-2 text-right">₹{parseFloat(h.part_cost || 0).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500 p-4">No config changes recorded</p>
        )}
        <div className="border-t bg-slate-50 px-4 py-3 text-xs grid sm:grid-cols-2 gap-2">
          <p><span className="text-slate-500">Processor:</span> {currentConfig.processor}</p>
          <p><span className="text-slate-500">RAM:</span> {currentConfig.ram}</p>
          <p><span className="text-slate-500">Storage:</span> {currentConfig.storage}</p>
          <p><span className="text-slate-500">GPU:</span> {currentConfig.gpu}</p>
          <p><span className="text-slate-500">OS:</span> {currentConfig.os}</p>
        </div>
      </section>

      <section className="rounded-xl border overflow-hidden">
        <h3 className="font-semibold text-slate-900 px-4 py-3 bg-slate-50 border-b text-sm">Parts Used on This Ticket</h3>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Part</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2 text-right">Unit</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Upgrade</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id || p.part_id} className="border-t">
                <td className="px-3 py-2">{p.part_name}</td>
                <td className="px-3 py-2 text-center">{p.quantity_used}</td>
                <td className="px-3 py-2 text-right">₹{parseFloat(p.unit_cost || 0).toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-medium">₹{parseFloat(p.total_part_cost || 0).toFixed(0)}</td>
                <td className="px-3 py-2 text-center">{p.is_upgrade ? <span className="text-green-700 text-xs font-semibold">✓ Upgrade</span> : '—'}</td>
              </tr>
            ))}
            {!parts.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No parts attached yet</td></tr>}
          </tbody>
          {parts.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold text-sm">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right">Total parts cost</td>
                <td className="px-3 py-2 text-right">₹{partsTotal.toFixed(0)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      {attachModal && (
        <AttachPartModal request={attachModal} onAttached={onUpdated} onClose={() => setAttachModal(null)} />
      )}
    </div>
  );
}

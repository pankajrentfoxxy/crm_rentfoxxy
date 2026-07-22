import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, PlusCircle, Trash2, X } from 'lucide-react';
import { createSparePartsOrder, fetchSparePartsFormMeta } from '../vendorManagementApi';

/** Laravel purchase-order-form state slugs */
const RAW_INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal'
];

const STATE_OPTIONS = RAW_INDIAN_STATES.map((name) => ({
  label: name,
  value: name.toLowerCase().replace(/\s+/g, '_')
}));

function slugState(s) {
  if (!s || !String(s).trim()) return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

const emptyLine = () => ({
  brand: '',
  category: '',
  category_label: '',
  part_id: '',
  part_custom: '',
  part_type: '',
  specifications: '',
  warranty_months: '12',
  quantity: '',
  rate: ''
});

/** Mirror Laravel assets_details array shape loosely (nested keys grouped by field). */
function buildAssetsDetails(linePayloads) {
  return {
    brand: linePayloads.map((l) => l.brand_name || ''),
    parts: linePayloads.map((l) => l.spare_part_name),
    warranty_in_month: linePayloads.map((l) => l.warranty_months),
    quantity: linePayloads.map((l) => l.quantity),
    rate: linePayloads.map((l) => l.rate)
  };
}

function poStateMatchesVendor(poStateSlug, vendorStateRaw) {
  if (!poStateSlug || vendorStateRaw == null || String(vendorStateRaw).trim() === '') return false;
  const slug = String(poStateSlug).trim().toLowerCase();
  const vs = String(vendorStateRaw).trim();
  const vsSlug = vs.toLowerCase().replace(/\s+/g, '_');
  if (slug === vsSlug) return true;
  const opt = STATE_OPTIONS.find((o) => o.label.toLowerCase() === vs.toLowerCase());
  return opt?.value === slug;
}

/** @throws {Error} validation message */
function buildLinePayloads(lines, partsCatalog) {
  const payloads = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const ln = lines[idx];
    const category = (ln.category || '').trim();
    const category_label = ln.category_label || '';
    const brand_name = (ln.brand || '').trim();

    let part_id = ln.part_id && ln.part_id !== '__custom__' ? Number(ln.part_id) : null;
    let spare_part_name = '';
    let floor_part_id = null;
    let part_type = (ln.part_type || '').trim();
    if (part_id != null && Number.isFinite(part_id)) {
      const row = partsCatalog.find((p) => Number(p.id) === part_id);
      spare_part_name = row?.name ? String(row.name) : '';
      floor_part_id = row?.floor_part_id != null ? Number(row.floor_part_id) : null;
      if (!part_type && row?.part_type) part_type = String(row.part_type);
    }
    if (ln.part_id === '__custom__' || !spare_part_name) {
      spare_part_name = (ln.part_custom || '').trim();
      part_id = null;
      floor_part_id = null;
    }

    const qty = Number(ln.quantity);
    const rate = Number(ln.rate);
    const w = Number(ln.warranty_months);

    if (!category) {
      throw new Error(`Line ${idx + 1}: category is required`);
    }
    if (!brand_name) {
      throw new Error(`Line ${idx + 1}: brand is required`);
    }
    if (!spare_part_name) {
      throw new Error(`Line ${idx + 1}: part is required`);
    }
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`Line ${idx + 1}: warranty (months) is required`);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Line ${idx + 1}: quantity must be greater than zero`);
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Line ${idx + 1}: rate must be greater than zero`);
    }

    payloads.push({
      category,
      category_label,
      brand_name,
      brand_id: null,
      part_type: part_type || null,
      part_id,
      floor_part_id,
      parts_catalog_id: floor_part_id,
      spare_part_name,
      specifications: (ln.specifications || '').trim(),
      warranty_months: Math.round(w),
      quantity: qty,
      rate
    });
  }
  return payloads;
}

export default function SparePartsPoFormModal({ open, onClose, onSaved, prefill }) {
  const [metaLoading, setMetaLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [purchase_order_number, setPurchaseOrderNumber] = useState('');
  const [purchase_order_date, setPurchaseOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vendor_id, setVendorId] = useState('');
  const [po_state, setPoState] = useState('');
  const [remarks, setRemarks] = useState('');

  const [vendorOptions, setVendorOptions] = useState([]);
  const [categoriesFromMeta, setCategoriesFromMeta] = useState([]);
  const [brandOptions, setBrandOptions] = useState([]);
  const [partsCatalog, setPartsCatalog] = useState([]);
  const [lines, setLines] = useState([emptyLine()]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const resetForm = useCallback(() => {
    setPurchaseOrderDate(new Date().toISOString().slice(0, 10));
    setVendorId('');
    setPoState('');
    setRemarks('');
    setLines([emptyLine()]);
  }, []);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const { data } = await fetchSparePartsFormMeta();
      if (!data.success) throw new Error(data.message || 'Failed to load form');
      setPurchaseOrderNumber(data.purchase_order_number || '');
      setVendorOptions(Array.isArray(data.vendors) ? data.vendors : []);
      setCategoriesFromMeta(Array.isArray(data.categories) ? data.categories : []);
      setBrandOptions(Array.isArray(data.brands) ? data.brands : []);
      setPartsCatalog(Array.isArray(data.parts) ? data.parts : []);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Could not load spare PO form');
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
    loadMeta();
  }, [open, loadMeta, resetForm]);

  useEffect(() => {
    if (!open) setPreviewOpen(false);
  }, [open]);

  // Pre-fill the first line when navigated here from a part request.
  useEffect(() => {
    if (!open || !prefill) return;
    const match = partsCatalog.find(
      (p) => prefill.part_name && String(p.name).toLowerCase() === String(prefill.part_name).toLowerCase()
    );
    const category = prefill.category || match?.category || '';
    const catOpt = categoriesFromMeta.find((c) => c.value === category);
    setLines([
      {
        ...emptyLine(),
        category,
        category_label: catOpt?.label || '',
        part_id: match ? String(match.id) : '__custom__',
        part_custom: match ? '' : prefill.part_name || '',
        quantity: String(prefill.quantity || 1),
        specifications: prefill.specifications || ''
      }
    ]);
  }, [open, prefill, partsCatalog, categoriesFromMeta]);

  const selectedVendor = useMemo(
    () => vendorOptions.find((v) => String(v.id) === String(vendor_id)),
    [vendorOptions, vendor_id]
  );

  useEffect(() => {
    if (!selectedVendor?.state || !STATE_OPTIONS.length) return;
    const slug = slugState(selectedVendor.state);
    const exists = STATE_OPTIONS.some((o) => o.value === slug);
    if (exists && !po_state) setPoState(slug);
  }, [selectedVendor, po_state]);

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  const previewPayloads = useMemo(() => {
    try {
      return buildLinePayloads(lines, partsCatalog);
    } catch {
      return null;
    }
  }, [lines, partsCatalog]);

  const previewGstFooter = useMemo(() => {
    if (!previewPayloads?.length) return null;
    const sub = previewPayloads.reduce((acc, r) => acc + Number(r.quantity) * Number(r.rate), 0);
    if (!Number.isFinite(sub) || sub <= 0) return null;
    const same = poStateMatchesVendor(po_state, selectedVendor?.state);
    if (same) {
      const sgst = (sub * 9) / 100;
      const cgst = (sub * 9) / 100;
      return { mode: 'intra', sub, sgst, cgst, tot: sub + sgst + cgst, sameState: true };
    }
    const igst = (sub * 18) / 100;
    return { mode: 'inter', sub, igst, tot: sub + igst, sameState: false };
  }, [previewPayloads, po_state, selectedVendor?.state]);

  useEffect(() => {
    if (previewOpen && previewPayloads === null) setPreviewOpen(false);
  }, [previewOpen, previewPayloads]);

  function openDraftPreview() {
    if (!Number(vendor_id)) {
      toast.error('Please select a vendor');
      return;
    }
    if (!po_state) {
      toast.error('State of supply is required');
      return;
    }
    try {
      buildLinePayloads(lines, partsCatalog);
      setPreviewOpen(true);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    const vid = Number(vendor_id);
    if (!vid) {
      toast.error('Please select a vendor');
      return;
    }
    if (!po_state) {
      toast.error('State of supply is required');
      return;
    }

    let payloads;
    try {
      payloads = buildLinePayloads(lines, partsCatalog);
    } catch (err) {
      toast.error(err.message);
      return;
    }

    setSaving(true);
    try {
      const body = {
        purchase_order_number,
        purchase_order_date,
        vendor_id: vid,
        po_state,
        remarks: remarks.trim(),
        line_items: payloads,
        assets_details: buildAssetsDetails(payloads),
        status: 'draft'
      };
      const { data } = await createSparePartsOrder(body);
      if (!data.success) throw new Error(data.message || data.errors?.[0]?.msg || 'Save failed');
      toast.success(data.message || 'Spare parts PO saved');
      onSaved?.();
      onClose?.();
    } catch (err) {
      const msg = err.response?.data?.errors?.[0]?.msg;
      toast.error(msg || err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
        onClick={(e) => {
          if (e.target === e.currentTarget && !previewOpen) onClose?.();
        }}
        role="presentation"
      >
      <div className="relative w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add spare parts purchase order</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Category / part / warranty / quantity / rate rows; parts link to floor inventory. GST uses the vendor
              state and supply state fields.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
            onClick={() => onClose?.()}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {metaLoading ? (
          <div className="p-12 text-center text-slate-500 text-sm animate-pulse">Loading form…</div>
        ) : (
          <form onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-5">
            {prefill?.request_number ? (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm">
                <p className="font-semibold text-blue-900">
                  Creating spare PO to fulfil part request {prefill.request_number}
                </p>
                <p className="text-blue-700 text-xs mt-0.5">
                  {prefill.ttspl_id ? `Laptop: ${prefill.ttspl_id} · ` : ''}
                  Part: {prefill.part_name}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                  Purchase order number <span className="text-red-500">*</span>
                </label>
                <input
                  readOnly
                  required
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50"
                  value={purchase_order_number}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                  Purchase order date <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="date"
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={purchase_order_date}
                  onChange={(e) => setPurchaseOrderDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                  Select vendor <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={vendor_id}
                  onChange={(e) => setVendorId(e.target.value)}
                >
                  <option value="">Please select</option>
                  {vendorOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                  State of supply <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={po_state}
                  onChange={(e) => setPoState(e.target.value)}
                >
                  <option value="">Select a state</option>
                  {STATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {vendorOptions.length === 0 && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No approved vendors found. Approve vendors in CRM before raising a spare PO.
              </p>
            )}

            {selectedVendor && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                <p className="font-bold text-sm text-slate-900">{selectedVendor.label}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {selectedVendor.email && <span>{selectedVendor.email}</span>}
                  {selectedVendor.phone && <span>{selectedVendor.phone}</span>}
                </div>
                {selectedVendor.address && <p className="text-slate-600">{selectedVendor.address}</p>}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <h3 className="text-sm font-bold text-slate-900">Parts order details</h3>
                <span className="text-[11px] text-slate-500 ml-auto">Brand, category, part, type — add rows</span>
              </div>

              <div className="space-y-4">
                {lines.map((ln, idx) => (
                  <div key={`line-${idx}`} className="rounded-lg border border-slate-100 p-3 space-y-3 bg-slate-50/70">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500">Line {idx + 1}</span>
                      <div className="flex-1" />
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-red-600 font-semibold disabled:opacity-30"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 1}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Brand*</label>
                        <select
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
                          value={ln.brand}
                          onChange={(e) => updateLine(idx, { brand: e.target.value })}
                        >
                          <option value="">Select brand…</option>
                          {brandOptions.map((b) => (
                            <option key={b.id} value={b.name}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Category*</label>
                        <select
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
                          value={ln.category}
                          onChange={(e) => {
                            const opt = categoriesFromMeta.find((c) => c.value === e.target.value);
                            updateLine(idx, {
                              category: e.target.value,
                              category_label: opt?.label || '',
                              part_id: '',
                              part_custom: '',
                              part_type: '',
                            });
                          }}
                        >
                          <option value="">Select category…</option>
                          {categoriesFromMeta.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Part*</label>
                        <select
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white"
                          value={ln.part_id}
                          onChange={(e) => {
                            const val = e.target.value;
                            const sel = partsCatalog.find((p) => String(p.id) === val);
                            const catOpt = categoriesFromMeta.find((c) => c.value === sel?.category);
                            updateLine(idx, {
                              part_id: val,
                              part_custom: '',
                              part_type: sel?.part_type || '',
                              specifications: sel?.specifications || '',
                              category: sel?.category || ln.category,
                              category_label: catOpt?.label || ln.category_label,
                              brand: sel?.default_brand || ln.brand,
                            });
                          }}
                        >
                          <option value="">Choose from catalog…</option>
                          {partsCatalog
                            .filter((p) => !ln.category || p.category === ln.category)
                            .map((p) => (
                              <option key={p.id} value={String(p.id)}>
                                {p.name}
                                {p.part_type ? ` (${p.part_type})` : ''}
                                {p.stock_qty !== undefined && p.stock_qty !== null
                                  ? ` · Stock ${p.stock_qty}`
                                  : ''}
                              </option>
                            ))}
                          <option value="__custom__">+ Other (type manually)</option>
                        </select>
                        {(() => {
                          const sel = partsCatalog.find((p) => Number(p.id) === Number(ln.part_id));
                          if (!sel?.floor_part_id) return null;
                          return (
                            <p className="text-[11px] text-slate-500 mt-1">
                              Floor stock: {sel.stock_qty || 0} units · ₹{sel.unit_cost || 0}/unit
                              {sel.location_code ? ` · ${sel.location_code}` : ''}
                            </p>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Type</label>
                        <input
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          value={ln.part_type}
                          placeholder="DDR4, NVMe, 65W…"
                          onChange={(e) => updateLine(idx, { part_type: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">
                          Specifications <span className="text-slate-400 font-normal">(optional)</span>
                        </label>
                        <input
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          value={ln.specifications}
                          placeholder="Capacity, connector, compatible models…"
                          onChange={(e) => updateLine(idx, { specifications: e.target.value })}
                        />
                      </div>
                    </div>

                    {(ln.part_id === '__custom__' || ln.part_id === '') && (
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">
                          Part name {ln.part_id === '__custom__' && <span className="text-red-500">*</span>}
                        </label>
                        <input
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          value={ln.part_custom}
                          placeholder={
                            ln.part_id === '__custom__'
                              ? 'e.g. RAM 8GB DDR4 2666MHz SODIMM'
                              : 'Optional if catalog selected'
                          }
                          onChange={(e) => updateLine(idx, { part_custom: e.target.value })}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Warranty (months)*</label>
                        <input
                          required
                          type="number"
                          min={0}
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          value={ln.warranty_months}
                          onChange={(e) => updateLine(idx, { warranty_months: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Quantity*</label>
                        <input
                          required
                          type="number"
                          min={1}
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          value={ln.quantity}
                          onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600">Rate*</label>
                        <input
                          required
                          type="number"
                          min={1}
                          step="0.01"
                          className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm"
                          value={ln.rate}
                          onChange={(e) => updateLine(idx, { rate: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                <PlusCircle className="w-4 h-4" />
                Add line
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600">Remarks</label>
              <textarea
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[5rem]"
                value={remarks}
                placeholder="Notes for this spare PO…"
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 bg-white pt-2 border-t">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => onClose?.()}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={metaLoading || saving}
                onClick={openDraftPreview}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                <Eye className="w-4 h-4 shrink-0" />
                Preview
              </button>
              <button
                disabled={saving}
                type="submit"
                className="px-5 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold shadow-sm hover:bg-orange-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save spare PO'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>

      {previewOpen && !metaLoading && previewPayloads ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/55"
          role="dialog"
          aria-modal="true"
          aria-labelledby="spare-po-draft-preview-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreviewOpen(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50 gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Draft</p>
                <h2 id="spare-po-draft-preview-title" className="text-lg font-bold text-slate-900">
                  Spare PO preview
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-white bg-slate-100/80"
                >
                  Back to form
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-200"
                  aria-label="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 m-0">
                Not saved yet. Use <strong>Save spare PO</strong> on the form when you are ready.
              </p>

              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-500">Purchase order number</p>
                    <p className="font-bold text-slate-900">{purchase_order_number || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Date</p>
                    <p className="font-semibold text-slate-800">{purchase_order_date || '—'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-slate-500">State of supply</p>
                    <p className="text-slate-800">
                      {STATE_OPTIONS.find((o) => o.value === po_state)?.label || po_state || '—'}
                    </p>
                  </div>
                  {remarks.trim() ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-slate-500">Remarks</p>
                      <p className="text-slate-700 whitespace-pre-wrap">{remarks.trim()}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              {selectedVendor ? (
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                  <p className="font-bold text-slate-900">{selectedVendor.label}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-slate-600 text-xs">
                    {selectedVendor.email && <span>{selectedVendor.email}</span>}
                    {selectedVendor.phone && <span>{selectedVendor.phone}</span>}
                  </div>
                  {selectedVendor.address && <p className="text-slate-600 text-xs mt-1">{selectedVendor.address}</p>}
                  <p className="text-[11px] text-slate-500 mt-2">
                    GST estimate:{' '}
                    {selectedVendor.state
                      ? previewGstFooter?.sameState
                        ? 'SGST + CGST (same state)'
                        : 'IGST (other state)'
                      : 'Set vendor address state for intra/inter match'}
                  </p>
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="p-2">#</th>
                      <th className="p-2">Brand</th>
                      <th className="p-2">Part</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Warranty (mo)</th>
                      <th className="p-2 tabular-nums">Qty</th>
                      <th className="p-2 tabular-nums">Rate (₹)</th>
                      <th className="p-2 tabular-nums">Line (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewPayloads.map((row, idx) => {
                      const lineTot = Number(row.quantity) * Number(row.rate);
                      return (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{idx + 1}</td>
                          <td className="p-2 font-medium text-slate-900">{row.brand_name}</td>
                          <td className="p-2 text-slate-800">{row.spare_part_name}</td>
                          <td className="p-2 text-slate-600">{row.part_type || '—'}</td>
                          <td className="p-2 tabular-nums">{row.warranty_months}</td>
                          <td className="p-2 tabular-nums">{row.quantity}</td>
                          <td className="p-2 tabular-nums font-mono">{Number(row.rate).toFixed(2)}</td>
                          <td className="p-2 tabular-nums font-mono">{lineTot.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {previewGstFooter && previewPayloads.length > 0 && (
                    <tfoot className="bg-slate-50 font-semibold text-slate-800 text-sm">
                      {previewGstFooter.mode === 'intra' ? (
                        <>
                          <tr>
                            <td colSpan={7} className="p-2 text-right">
                              Sub total
                            </td>
                            <td className="p-2 font-mono">₹{previewGstFooter.sub.toFixed(2)}</td>
                          </tr>
                          <tr className="font-normal text-slate-600">
                            <td colSpan={7} className="p-2 text-right">
                              SGST (9%)
                            </td>
                            <td className="p-2 font-mono">₹{previewGstFooter.sgst.toFixed(2)}</td>
                          </tr>
                          <tr className="font-normal text-slate-600">
                            <td colSpan={7} className="p-2 text-right">
                              CGST (9%)
                            </td>
                            <td className="p-2 font-mono">₹{previewGstFooter.cgst.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td colSpan={7} className="p-2 text-right">
                              Total
                            </td>
                            <td className="p-2 font-mono">₹{previewGstFooter.tot.toFixed(2)}</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td colSpan={7} className="p-2 text-right">
                              Sub total
                            </td>
                            <td className="p-2 font-mono">₹{previewGstFooter.sub.toFixed(2)}</td>
                          </tr>
                          <tr className="font-normal text-slate-600">
                            <td colSpan={7} className="p-2 text-right">
                              IGST (18%)
                            </td>
                            <td className="p-2 font-mono">₹{previewGstFooter.igst.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td colSpan={7} className="p-2 text-right">
                              Total
                            </td>
                            <td className="p-2 font-mono">₹{previewGstFooter.tot.toFixed(2)}</td>
                          </tr>
                        </>
                      )}
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

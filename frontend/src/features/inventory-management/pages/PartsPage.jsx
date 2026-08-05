import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, AlertTriangle, Package, Boxes, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import PartLabelPrintModal from '../components/PartLabelPrintModal';
import MetricCard from '../../reporting/components/MetricCard';
import DataTable from '../../reporting/components/DataTable';
import { inr } from '../../reporting/reportingUtils';
import { listPartInstances, addPartInstances } from '../../floor-pipeline/partRequestsApi';
import PartSerialsDrawer from '../components/PartSerialsDrawer';

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'ram', label: 'RAM' },
  { value: 'storage', label: 'Storage / SSD' },
  { value: 'display', label: 'Display' },
  { value: 'battery', label: 'Battery' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'motherboard', label: 'Motherboard / Chip Level' },
  { value: 'cooling', label: 'Cooling / Thermal' },
  { value: 'power', label: 'Power / Charger' },
  { value: 'body', label: 'Body / Casing' },
  { value: 'general', label: 'General / Other' },
];

const CAT_LABEL = Object.fromEntries(CATEGORIES.filter((c) => c.value).map((c) => [c.value, c.label]));

const INSTANCE_STATUS_COLORS = {
  in_stock: 'bg-green-100 text-green-700',
  reserved: 'bg-blue-100 text-blue-700',
  installed: 'bg-teal-100 text-teal-700',
  defective: 'bg-red-100 text-red-700',
  returned: 'bg-amber-100 text-amber-700',
  discarded: 'bg-gray-100 text-gray-600',
  sold: 'bg-purple-100 text-purple-700',
};

const partCategory = (p) => (p.category || String(p.part_type || '').toLowerCase() || 'general');

function stockBadge(qty, threshold = 5) {
  if (qty <= 0) return { label: 'OUT', cls: 'bg-red-100 text-red-700' };
  if (qty < threshold) return { label: String(qty), cls: 'bg-red-100 text-red-700' };
  if (qty <= 10) return { label: String(qty), cls: 'bg-amber-100 text-amber-800' };
  return { label: String(qty), cls: 'bg-green-100 text-green-800' };
}

function AddPartDrawer({ open, onClose, onSave, initial }) {
  const blank = {
    part_name: '', category: 'general', description: '', quantity: 0,
    min_threshold: 5, cost: '', location_code: '', vendor: '',
    part_sku: '', compatible_brands: '', warranty_months: 0, is_consumable: false, notes: '',
  };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        part_name: initial.part_name || '',
        category: partCategory(initial),
        description: initial.description || '',
        quantity: initial.quantity || 0,
        min_threshold: initial.min_threshold ?? 5,
        cost: initial.cost || '',
        location_code: initial.location_code || '',
        vendor: initial.vendor || '',
        part_sku: initial.part_sku || '',
        compatible_brands: Array.isArray(initial.compatible_brands)
          ? initial.compatible_brands.join(', ')
          : initial.compatible_brands || '',
        warranty_months: initial.warranty_months || 0,
        is_consumable: !!initial.is_consumable,
        notes: initial.notes || '',
      });
    } else {
      setForm(blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white h-full shadow-xl overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold">{initial ? 'Edit Part' : 'Add Part'}</h2>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 text-sm">
          <label className="block">
            <span className="text-gray-600">Part Name *</span>
            <input required className="mt-1 w-full border rounded-lg px-3 py-2" value={form.part_name} onChange={(e) => setForm({ ...form, part_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-gray-600">Category *</span>
            <select className="mt-1 w-full border rounded-lg px-3 py-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.filter((c) => c.value).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-gray-600">Specifications</span>
            <input className="mt-1 w-full border rounded-lg px-3 py-2" placeholder="e.g. DDR4, 2666MHz, SODIMM" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-gray-600">Part SKU</span>
            <input className="mt-1 w-full border rounded-lg px-3 py-2 font-mono" placeholder="optional" value={form.part_sku} onChange={(e) => setForm({ ...form, part_sku: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-gray-600">Compatible Brands</span>
            <input className="mt-1 w-full border rounded-lg px-3 py-2" placeholder="Dell, HP, Lenovo" value={form.compatible_brands} onChange={(e) => setForm({ ...form, compatible_brands: e.target.value })} />
          </label>
          {!initial && (
            <label className="block">
              <span className="text-gray-600">Initial Quantity</span>
              <input type="number" min={0} className="mt-1 w-full border rounded-lg px-3 py-2" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-gray-600">Min Threshold</span>
              <input type="number" min={0} className="mt-1 w-full border rounded-lg px-3 py-2" value={form.min_threshold} onChange={(e) => setForm({ ...form, min_threshold: Number(e.target.value) })} />
            </label>
            <label className="block">
              <span className="text-gray-600">Warranty (months)</span>
              <input type="number" min={0} className="mt-1 w-full border rounded-lg px-3 py-2" value={form.warranty_months} onChange={(e) => setForm({ ...form, warranty_months: Number(e.target.value) })} />
            </label>
          </div>
          <label className="block">
            <span className="text-gray-600">Unit Cost (₹)</span>
            <input type="number" min={0} step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-gray-600">Location Code</span>
            <input className="mt-1 w-full border rounded-lg px-3 py-2 font-mono" placeholder="Shelf A-3" value={form.location_code} onChange={(e) => setForm({ ...form, location_code: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-gray-600">Vendor / Supplier</span>
            <input className="mt-1 w-full border rounded-lg px-3 py-2" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.is_consumable} onChange={(e) => setForm({ ...form, is_consumable: e.target.checked })} />
            <span className="text-gray-600">Consumable (paste, screws, cables)</span>
          </label>
          <label className="block">
            <span className="text-gray-600">Notes</span>
            <textarea className="mt-1 w-full border rounded-lg px-3 py-2" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border rounded-lg py-2">Cancel</button>
            <button type="submit" disabled={busy} className="flex-1 bg-blue-600 text-white rounded-lg py-2 disabled:opacity-60">{busy ? 'Saving…' : initial ? 'Save' : 'Add Part'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function availableStock(part) {
  return part.in_stock_count ?? part.quantity ?? 0;
}

function AdjustStockModal({ part, onClose, onSave }) {
  const [mode, setMode] = useState('add');
  const [qty, setQty] = useState('');
  const [serials, setSerials] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!part) return null;

  const submit = async (e) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) return toast.error('Enter a valid quantity');
    if ((mode === 'consume' || mode === 'set') && !reason.trim()) return toast.error('Reason is required');
    let delta = n;
    if (mode === 'consume') delta = -n;
    if (mode === 'set') delta = n - availableStock(part);
    const serialList = serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (mode === 'add' && serialList.length > 1 && serialList.length !== n) {
      return toast.error('Serial count must match quantity, or leave serials blank');
    }
    setBusy(true);
    try {
      if (mode === 'add') {
        await onSave(part.part_id, {
          mode: 'add',
          quantity: serialList.length || n,
          serial_numbers: serialList.length ? serialList : undefined,
        });
      } else {
        await onSave(part.part_id, { mode, delta });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={submit} className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-semibold">Adjust Stock</h3>
        <p className="text-sm text-gray-600">Part: <strong>{part.part_name}</strong></p>
        <p className="text-sm">
          Available on shelf: <strong>{availableStock(part)}</strong>
          {part.reserved_count ? <span className="text-amber-700"> · {part.reserved_count} reserved</span> : null}
        </p>
        <div className="flex gap-2 flex-wrap">
          {['add', 'consume', 'set'].map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg text-sm border ${mode === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200'}`}>
              {m === 'add' ? '+ Add' : m === 'consume' ? '− Consume' : '= Set Exact'}
            </button>
          ))}
        </div>
        <input type="number" min={1} required className="w-full border rounded-lg px-3 py-2" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Quantity" />
        {mode === 'add' && (
          <label className="block space-y-1">
            <span className="text-sm text-gray-600">Serial numbers (optional — one per line or comma-separated)</span>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono min-h-[88px]"
              value={serials}
              onChange={(e) => setSerials(e.target.value)}
              placeholder={'SN12345\nSN67890'}
            />
            <span className="text-xs text-gray-500">Creates tracked PRT units so Serials view matches this count.</span>
          </label>
        )}
        {(mode === 'consume' || mode === 'set') && (
          <input required className="w-full border rounded-lg px-3 py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason *" />
        )}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 border rounded-lg py-2">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 bg-blue-600 text-white rounded-lg py-2">Adjust</button>
        </div>
      </form>
    </div>
  );
}

function UsageModal({ part, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!part) return;
    setLoading(true);
    api.get(`/parts/${part.part_id}/usage`)
      .then((r) => setRows(r.data.usage || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [part]);

  if (!part) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Usage history — {part.part_name}</h3>
        {loading ? <p className="text-gray-500 text-sm">Loading…</p> : rows.length ? (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-gray-500"><th className="p-2">Date</th><th className="p-2">Ticket #</th><th className="p-2">TTSPL / Serial</th><th className="p-2">Technician</th><th className="p-2">Qty</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="p-2">{r.added_at ? new Date(r.added_at).toLocaleDateString() : '—'}</td>
                  <td className="p-2">#{r.ticket_id}</td>
                  <td className="p-2 font-mono text-blue-600">{r.serial_number || r.machine_number || '—'}</td>
                  <td className="p-2">{r.technician_name || '—'}</td>
                  <td className="p-2">{r.quantity_used}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-gray-500 text-sm">No usage recorded yet.</p>}
        <button type="button" onClick={onClose} className="mt-4 border rounded-lg px-4 py-2 text-sm">Close</button>
      </div>
    </div>
  );
}

function InstancesTab() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [labelFor, setLabelFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 500 };
      if (status) params.status = status;
      if (category) params.category = category;
      const { data } = await listPartInstances(params);
      setInstances(data.instances || []);
    } catch {
      toast.error('Failed to load part instances');
    } finally {
      setLoading(false);
    }
  }, [status, category]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return instances.filter((r) => {
      if (!q) return true;
      return (
        String(r.prt_id || '').toLowerCase().includes(q) ||
        String(r.serial_number || '').toLowerCase().includes(q) ||
        String(r.part_name || '').toLowerCase().includes(q) ||
        String(r.installed_ttspl_id || '').toLowerCase().includes(q) ||
        String(r.asset_code || '').toLowerCase().includes(q) ||
        String(r.purchase_order_number || '').toLowerCase().includes(q) ||
        String(r.vendor_name || '').toLowerCase().includes(q)
      );
    });
  }, [instances, search]);

  const labelUnits = useMemo(
    () => (labelFor ? [{
      code: labelFor.prt_id,
      title: labelFor.part_name,
      subtitle: labelFor.serial_number ? `Serial ${labelFor.serial_number}` : 'No serial',
      poNumber: labelFor.purchase_order_number || '',
    }] : []),
    [labelFor]
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm flex-1 min-w-[180px]">
          <span className="block text-gray-500 text-xs mb-1">Search</span>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Serial, PRT-ID, part, TTSPL, PO no., vendor" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Status</span>
          <select className="border rounded-lg px-3 py-2 text-sm min-w-[140px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {Object.keys(INSTANCE_STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Category</span>
          <select className="border rounded-lg px-3 py-2 text-sm min-w-[140px]" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value || 'all'} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        {loading ? (
          <p className="p-6 text-sm text-gray-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No part instances found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="p-3">PRT-ID</th>
                <th className="p-3">Serial No.</th>
                <th className="p-3">Part Name</th>
                <th className="p-3">Category</th>
                <th className="p-3">Status</th>
                <th className="p-3">PO No.</th>
                <th className="p-3">Vendor</th>
                <th className="p-3">Received</th>
                <th className="p-3">Location</th>
                <th className="p-3">Unit Cost</th>
                <th className="p-3">Installed On</th>
                <th className="p-3">Installed At</th>
                <th className="p-3 text-right">Label</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.instance_id} className="border-t border-gray-50">
                  <td className="p-3 font-mono text-blue-600 whitespace-nowrap">{r.prt_id}</td>
                  <td className="p-3 font-mono">{r.serial_number || '—'}</td>
                  <td className="p-3">{r.part_name}</td>
                  <td className="p-3">{CAT_LABEL[partCategory(r)] || r.category || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INSTANCE_STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {r.spo_id ? (
                      <Link
                        to={`/vendor-management/spare-parts-po/${r.spo_id}/grn-detail`}
                        className="font-mono text-blue-600 hover:text-blue-800 hover:underline"
                        title="Open the purchase order this unit came from"
                      >
                        {r.purchase_order_number || `SPO-${r.spo_id}`}
                      </Link>
                    ) : (
                      <span className="text-gray-400">
                        {r.source === 'defective_return' ? 'From laptop' : '—'}
                      </span>
                    )}
                  </td>
                  <td className="p-3">{r.vendor_name || '—'}</td>
                  <td className="p-3 whitespace-nowrap">{r.received_at ? new Date(r.received_at).toLocaleDateString() : '—'}</td>
                  <td className="p-3 font-mono">{r.location_code || '—'}</td>
                  <td className="p-3">{inr(r.unit_cost)}</td>
                  <td className="p-3 font-mono text-teal-700">{r.installed_ttspl_id || '—'}</td>
                  <td className="p-3 whitespace-nowrap">{r.installed_at ? new Date(r.installed_at).toLocaleDateString() : '—'}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => setLabelFor(r)}
                      disabled={!r.prt_id}
                      className="inline-grid place-items-center w-9 h-9 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                      aria-label={`Print QR label for ${r.prt_id}`}
                      title="Print QR label"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PartLabelPrintModal
        open={Boolean(labelFor)}
        units={labelUnits}
        onClose={() => setLabelFor(null)}
        title="Reprint QR label"
      />
    </div>
  );
}

export default function PartsPage() {
  const [tab, setTab] = useState('catalog');
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editPart, setEditPart] = useState(null);
  const [adjustPart, setAdjustPart] = useState(null);
  const [usagePart, setUsagePart] = useState(null);
  const [serialsPart, setSerialsPart] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/parts');
      setParts(data.parts || []);
    } catch {
      toast.error('Failed to load parts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const getThreshold = (p) => p.min_threshold ?? 5;

  const enriched = useMemo(() => parts
    .filter((p) => !p.archived)
    .map((p) => {
      const stock = availableStock(p);
      return {
        ...p,
        cat: partCategory(p),
        total_value: stock * parseFloat(p.cost || 0),
        category_label: CAT_LABEL[partCategory(p)] || p.part_type,
      };
    }), [parts]);

  const filtered = useMemo(() => enriched.filter((p) => {
    const q = search.toLowerCase();
    const stock = availableStock(p);
    if (q && !p.part_name.toLowerCase().includes(q)) return false;
    if (category && p.cat !== category) return false;
    if (stockFilter === 'in_stock' && stock <= 10) return false;
    if (stockFilter === 'low' && (stock >= getThreshold(p) || stock === 0)) return false;
    if (stockFilter === 'out' && stock !== 0) return false;
    return true;
  }), [enriched, search, category, stockFilter]);

  const lowCount = enriched.filter((p) => {
    const stock = availableStock(p);
    return stock > 0 && stock < getThreshold(p);
  }).length;
  const outCount = enriched.filter((p) => availableStock(p) === 0).length;
  const totalValue = enriched.reduce((s, p) => s + p.total_value, 0);

  const savePart = async (form) => {
    const payload = {
      part_name: form.part_name,
      part_type: form.category,
      category: form.category,
      description: form.description,
      quantity: form.quantity,
      vendor: form.vendor,
      cost: form.cost,
      location_code: form.location_code,
      part_sku: form.part_sku,
      compatible_brands: form.compatible_brands,
      is_consumable: form.is_consumable,
      warranty_months: form.warranty_months,
      notes: form.notes,
      min_threshold: form.min_threshold,
    };
    try {
      if (editPart) {
        await api.put(`/parts/${editPart.part_id}`, payload);
      } else {
        await api.post('/parts', payload);
      }
      toast.success('Part saved');
      load();
      setEditPart(null);
    } catch {
      toast.error('Failed to save part');
    }
  };

  const adjustStock = async (id, payload) => {
    try {
      if (payload.mode === 'add') {
        await addPartInstances({
          part_id: id,
          quantity: payload.quantity,
          serial_numbers: payload.serial_numbers,
        });
        toast.success('Stock added with PRT tracking');
      } else {
        await api.put(`/parts/${id}/quantity`, { quantity: payload.delta });
        toast.success('Stock updated');
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to adjust stock');
    }
  };

  const columns = [
    { key: 'part_name', label: 'Part Name', sortable: true },
    { key: 'category_label', label: 'Category' },
    { key: 'description', label: 'Specifications', render: (r) => r.description || '—' },
    {
      key: 'compatible_brands',
      label: 'Compatible',
      render: (r) => (Array.isArray(r.compatible_brands) && r.compatible_brands.length ? r.compatible_brands.join(', ') : '—'),
    },
    {
      key: 'quantity',
      label: 'In Stock',
      render: (r) => {
        const stock = availableStock(r);
        const b = stockBadge(stock, getThreshold(r));
        return (
          <span className="inline-flex flex-col gap-0.5">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${b.cls}`}>{b.label}</span>
            {r.reserved_count ? <span className="text-[10px] text-amber-700">{r.reserved_count} reserved</span> : null}
          </span>
        );
      },
    },
    { key: 'part_sku', label: 'SKU', render: (r) => r.part_sku || '—' },
    { key: 'min_threshold', label: 'Min', render: (r) => getThreshold(r) },
    { key: 'cost', label: 'Unit Cost', render: (r) => inr(r.cost) },
    { key: 'total_value', label: 'Total Value', render: (r) => inr(r.total_value), sortable: true },
    { key: 'location_code', label: 'Location', render: (r) => r.location_code || '—' },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" className="text-blue-600 hover:underline" onClick={() => { setEditPart(r); setDrawerOpen(true); }}>Edit</button>
          <button type="button" className="text-blue-600 hover:underline font-semibold" onClick={() => setSerialsPart(r)}>Serials</button>
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setAdjustPart(r)}>Adjust</button>
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setUsagePart(r)}>Usage</button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Parts Inventory</h1>
          <p className="text-sm text-gray-500">Track spare parts, RAM, storage, consumables, and individual PRT units</p>
        </div>
        {tab === 'catalog' && (
          <div className="flex gap-2">
            <button type="button" onClick={() => { setEditPart(null); setDrawerOpen(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Add Part
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b">
        <button type="button" onClick={() => setTab('catalog')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 flex items-center gap-2 ${tab === 'catalog' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Package className="w-4 h-4" /> Parts Catalog
        </button>
        <button type="button" onClick={() => setTab('instances')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 flex items-center gap-2 ${tab === 'instances' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Boxes className="w-4 h-4" /> Part Instances
        </button>
      </div>

      {tab === 'catalog' ? (
        <>
          {lowCount > 0 && (
            <button
              type="button"
              onClick={() => setStockFilter('low')}
              className="w-full flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm hover:bg-amber-100"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {lowCount} part{lowCount !== 1 ? 's are' : ' is'} running low on stock. View low stock items
            </button>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Total Parts" value={enriched.length} color="blue" subtitle="part types" />
            <MetricCard title="Low Stock" value={lowCount} color="amber" />
            <MetricCard title="Out of Stock" value={outCount} color="red" />
            <MetricCard title="Total Stock Value" value={inr(totalValue)} color="green" />
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
            <label className="text-sm flex-1 min-w-[180px]">
              <span className="block text-gray-500 text-xs mb-1">Search</span>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Part name" />
            </label>
            <label className="text-sm">
              <span className="block text-gray-500 text-xs mb-1">Category</span>
              <select className="border rounded-lg px-3 py-2 text-sm min-w-[140px]" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.value || 'all'} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-gray-500 text-xs mb-1">Stock status</span>
              <select className="border rounded-lg px-3 py-2 text-sm min-w-[140px]" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
                <option value="">All</option>
                <option value="in_stock">In Stock</option>
                <option value="low">Low Stock</option>
                <option value="out">Out of Stock</option>
              </select>
            </label>
            <button type="button" onClick={() => { setSearch(''); setCategory(''); setStockFilter(''); }} className="text-sm text-blue-600 hover:underline pb-2">
              Clear filters
            </button>
          </div>

          <DataTable columns={columns} rows={filtered} loading={loading} emptyText="No parts match your filters" />
        </>
      ) : (
        <InstancesTab />
      )}

      <AddPartDrawer open={drawerOpen} onClose={() => { setDrawerOpen(false); setEditPart(null); }} onSave={savePart} initial={editPart} />
      <AdjustStockModal part={adjustPart} onClose={() => setAdjustPart(null)} onSave={adjustStock} />
      <UsageModal part={usagePart} onClose={() => setUsagePart(null)} />
      <PartSerialsDrawer open={!!serialsPart} part={serialsPart} onClose={() => setSerialsPart(null)} onChanged={load} />
    </div>
  );
}

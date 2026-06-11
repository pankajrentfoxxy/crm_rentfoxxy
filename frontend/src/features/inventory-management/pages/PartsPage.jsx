import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import MetricCard from '../../reporting/components/MetricCard';
import DataTable from '../../reporting/components/DataTable';
import { inr } from '../../reporting/reportingUtils';

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'memory', label: 'RAM' },
  { value: 'storage', label: 'Storage' },
  { value: 'display', label: 'Display' },
  { value: 'battery', label: 'Battery' },
  { value: 'keyboard', label: 'Keyboard' },
  { value: 'motherboard', label: 'Motherboard' },
  { value: 'cooling', label: 'Cooling' },
  { value: 'power', label: 'Power' },
  { value: 'body', label: 'Body' },
  { value: 'general', label: 'General' },
  { value: 'other', label: 'Other' },
];

const CAT_LABEL = Object.fromEntries(CATEGORIES.filter((c) => c.value).map((c) => [c.value, c.label]));

const THRESH_KEY = 'parts_min_thresholds';
const ARCHIVE_KEY = 'parts_archived_ids';

function loadThresholds() {
  try {
    return JSON.parse(localStorage.getItem(THRESH_KEY) || '{}');
  } catch {
    return {};
  }
}

function loadArchived() {
  try {
    return new Set(JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function stockBadge(qty) {
  if (qty <= 0) return { label: 'OUT', cls: 'bg-red-100 text-red-700' };
  if (qty <= 1) return { label: 'LOW', cls: 'bg-red-100 text-red-700' };
  if (qty <= 10) return { label: String(qty), cls: 'bg-amber-100 text-amber-800' };
  return { label: String(qty), cls: 'bg-green-100 text-green-800' };
}

function AddPartDrawer({ open, onClose, onSave, initial }) {
  const [form, setForm] = useState({
    part_name: '', part_type: 'general', description: '', quantity: 0,
    min_threshold: 5, cost: '', location_code: '', vendor: '', notes: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        part_name: initial.part_name || '',
        part_type: initial.part_type || 'general',
        description: '',
        quantity: initial.quantity || 0,
        min_threshold: 5,
        cost: initial.cost || '',
        location_code: initial.location_code || '',
        vendor: initial.vendor || '',
        notes: '',
      });
    } else {
      setForm({
        part_name: '', part_type: 'general', description: '', quantity: 0,
        min_threshold: 5, cost: '', location_code: '', vendor: '', notes: '',
      });
    }
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
            <select className="mt-1 w-full border rounded-lg px-3 py-2" value={form.part_type} onChange={(e) => setForm({ ...form, part_type: e.target.value })}>
              {CATEGORIES.filter((c) => c.value).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-gray-600">Description</span>
            <textarea className="mt-1 w-full border rounded-lg px-3 py-2" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          {!initial && (
            <label className="block">
              <span className="text-gray-600">Initial Quantity</span>
              <input type="number" min={0} className="mt-1 w-full border rounded-lg px-3 py-2" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </label>
          )}
          <label className="block">
            <span className="text-gray-600">Min Threshold</span>
            <input type="number" min={0} className="mt-1 w-full border rounded-lg px-3 py-2" value={form.min_threshold} onChange={(e) => setForm({ ...form, min_threshold: Number(e.target.value) })} />
          </label>
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

function AdjustStockModal({ part, onClose, onSave }) {
  const [mode, setMode] = useState('add');
  const [qty, setQty] = useState('');
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
    if (mode === 'set') delta = n - (part.quantity || 0);
    setBusy(true);
    try {
      await onSave(part.part_id, delta);
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
        <p className="text-sm">Current stock: <strong>{part.quantity}</strong></p>
        <div className="flex gap-2 flex-wrap">
          {['add', 'consume', 'set'].map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg text-sm border ${mode === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200'}`}>
              {m === 'add' ? '+ Add' : m === 'consume' ? '− Consume' : '= Set Exact'}
            </button>
          ))}
        </div>
        <input type="number" min={0} required className="w-full border rounded-lg px-3 py-2" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Quantity" />
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

export default function PartsPage() {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [thresholds, setThresholds] = useState(loadThresholds);
  const [archived, setArchived] = useState(loadArchived);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editPart, setEditPart] = useState(null);
  const [adjustPart, setAdjustPart] = useState(null);
  const [usagePart, setUsagePart] = useState(null);

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

  const getThreshold = (p) => thresholds[p.part_id] ?? 5;

  const enriched = useMemo(() => parts
    .filter((p) => !archived.has(p.part_id))
    .map((p) => ({
      ...p,
      min_threshold: getThreshold(p),
      total_value: (p.quantity || 0) * parseFloat(p.cost || 0),
      category_label: CAT_LABEL[p.part_type] || p.part_type,
    })), [parts, thresholds, archived]);

  const filtered = useMemo(() => enriched.filter((p) => {
    const q = search.toLowerCase();
    if (q && !p.part_name.toLowerCase().includes(q)) return false;
    if (category && p.part_type !== category) return false;
    if (stockFilter === 'in_stock' && p.quantity <= 10) return false;
    if (stockFilter === 'low' && (p.quantity >= 5 || p.quantity === 0)) return false;
    if (stockFilter === 'out' && p.quantity !== 0) return false;
    return true;
  }), [enriched, search, category, stockFilter]);

  const lowCount = enriched.filter((p) => p.quantity > 0 && p.quantity < getThreshold(p)).length;
  const outCount = enriched.filter((p) => p.quantity === 0).length;
  const totalValue = enriched.reduce((s, p) => s + p.total_value, 0);

  const savePart = async (form) => {
    const payload = {
      part_name: form.part_name,
      part_type: form.part_type,
      quantity: form.quantity,
      vendor: form.vendor,
      cost: form.cost,
      location_code: form.location_code,
    };
    try {
      if (editPart) {
        await api.put(`/parts/${editPart.part_id}`, payload);
      } else {
        const res = await api.post('/parts', payload);
        const id = res.data.part?.part_id;
        if (id && form.min_threshold !== 5) {
          const next = { ...thresholds, [id]: form.min_threshold };
          setThresholds(next);
          localStorage.setItem(THRESH_KEY, JSON.stringify(next));
        }
      }
      toast.success('Part saved');
      load();
      setEditPart(null);
    } catch {
      toast.error('Failed to save part');
    }
  };

  const adjustStock = async (id, delta) => {
    try {
      await api.put(`/parts/${id}/quantity`, { quantity: delta });
      toast.success('Stock updated');
      load();
    } catch {
      toast.error('Failed to adjust stock');
    }
  };

  const setThreshold = (partId, val) => {
    const next = { ...thresholds, [partId]: Number(val) || 5 };
    setThresholds(next);
    localStorage.setItem(THRESH_KEY, JSON.stringify(next));
  };

  const archivePart = (partId) => {
    const next = new Set(archived);
    next.add(partId);
    setArchived(next);
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify([...next]));
    toast.success('Part archived');
  };

  const columns = [
    { key: 'part_name', label: 'Part Name', sortable: true },
    { key: 'category_label', label: 'Category' },
    {
      key: 'quantity',
      label: 'In Stock',
      render: (r) => {
        const b = stockBadge(r.quantity);
        return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${b.cls}`}>{b.label}</span>;
      },
    },
    {
      key: 'min_threshold',
      label: 'Min Threshold',
      render: (r) => (
        <input
          type="number"
          min={0}
          className="w-16 border rounded px-1 py-0.5 text-sm"
          value={getThreshold(r)}
          onChange={(e) => setThreshold(r.part_id, e.target.value)}
        />
      ),
    },
    { key: 'cost', label: 'Unit Cost', render: (r) => inr(r.cost) },
    { key: 'total_value', label: 'Total Value', render: (r) => inr(r.total_value), sortable: true },
    { key: 'location_code', label: 'Location', render: (r) => r.location_code || '—' },
    { key: 'vendor', label: 'Vendor', render: (r) => r.vendor || '—' },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" className="text-blue-600 hover:underline" onClick={() => { setEditPart(r); setDrawerOpen(true); }}>Edit</button>
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setAdjustPart(r)}>Adjust</button>
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setUsagePart(r)}>Usage</button>
          <button type="button" className="text-gray-500 hover:underline" onClick={() => archivePart(r.part_id)}>Archive</button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Parts Inventory</h1>
          <p className="text-sm text-gray-500">Track spare parts, RAM, storage, and consumables</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setEditPart(null); setDrawerOpen(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Part
          </button>
          <button type="button" onClick={() => setAdjustPart(enriched[0] || null)} className="border border-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-50" disabled={!enriched.length}>
            Adjust Stock
          </button>
        </div>
      </div>

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
            <option value="low">Low Stock (&lt; 5)</option>
            <option value="out">Out of Stock</option>
          </select>
        </label>
        <button type="button" onClick={() => { setSearch(''); setCategory(''); setStockFilter(''); }} className="text-sm text-blue-600 hover:underline pb-2">
          Clear filters
        </button>
      </div>

      <DataTable columns={columns} rows={filtered} loading={loading} emptyText="No parts match your filters" />

      <AddPartDrawer open={drawerOpen} onClose={() => { setDrawerOpen(false); setEditPart(null); }} onSave={savePart} initial={editPart} />
      <AdjustStockModal part={adjustPart} onClose={() => setAdjustPart(null)} onSave={adjustStock} />
      <UsageModal part={usagePart} onClose={() => setUsagePart(null)} />
    </div>
  );
}

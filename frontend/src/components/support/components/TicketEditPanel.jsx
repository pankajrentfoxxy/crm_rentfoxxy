import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../../utils/api';
import { formatAddress, itemAllowsTechnicianAssign } from '../utils';

const emptyRow = () => ({
  key: `new-${Date.now()}-${Math.random()}`,
  customer_inventory_id: '',
  serial_number: '',
  unique_serial_number: '',
  brand: '',
  model: '',
  ram: '',
  storage: '',
  generation: '',
  item_type: 'complaint',
  issue_category_id: '',
  remarks: '',
  assigned_to: ''
});

export default function TicketEditPanel({ ticket, items, customerAddresses, technicians, categories, onSave, onCancel }) {
  const [form, setForm] = useState({
    ticket_phone_override: ticket.ticket_phone_override || ticket.customer_phone || '',
    ticket_alt_phone: ticket.ticket_alt_phone || '',
    ticket_email: ticket.ticket_email || '',
    ticket_address: ticket.ticket_address || '',
    priority: ticket.priority || 'normal',
    top_level_remarks: ticket.top_level_remarks || ''
  });
  const [itemRows, setItemRows] = useState(items.map((i) => ({
    id: i.id,
    assigned_to: i.assigned_to || '',
    remarks: i.remarks || '',
    status: i.status,
    item_type: i.item_type,
    pickup_method: i.pickup_method,
    serial: i.unique_serial_number || i.serial_number,
    canRemove: !i.assigned_to && i.status === 'open'
  })));
  const [newRows, setNewRows] = useState([]);
  const [removedIds, setRemovedIds] = useState([]);
  const [assets, setAssets] = useState([]);
  const [saving, setSaving] = useState(false);

  const addressOptions = useMemo(() => {
    const opts = [];
    (customerAddresses || []).forEach((addr, idx) => {
      opts.push({ value: formatAddress(addr), label: formatAddress(addr) || `Address ${idx + 1}` });
    });
    if (ticket.ticket_address && !opts.some((o) => o.value === ticket.ticket_address)) {
      const lbl = formatAddress(ticket.ticket_address);
      opts.push({ value: lbl, label: lbl });
    }
    return opts;
  }, [customerAddresses, ticket.ticket_address]);

  useEffect(() => {
    api.get(`/support/customers/${ticket.customer_id}/assets`).then((r) => setAssets(r.data.assets || []));
  }, [ticket.customer_id]);

  const updateNewRow = (key, patch) => {
    setNewRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const onAssetPick = (key, assetId) => {
    const asset = assets.find((a) => String(a.id) === String(assetId));
    if (!asset) return;
    updateNewRow(key, {
      customer_inventory_id: asset.id,
      serial_number: asset.serial_number,
      unique_serial_number: asset.unique_serial_number,
      model: asset.model_name,
      brand: asset.model_name?.split(' ')[0] || '',
      ram: asset.ram,
      storage: asset.storage,
      generation: asset.generation
    });
  };

  const removeExisting = (id) => {
    if (!window.confirm('Remove this machine from the ticket?')) return;
    setRemovedIds((prev) => [...prev, id]);
    setItemRows((prev) => prev.filter((r) => r.id !== id));
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        ...form,
        items: itemRows.map((r) => ({
          id: r.id,
          assigned_to: r.assigned_to ? Number(r.assigned_to) : null,
          remarks: r.remarks
        })),
        new_items: newRows.map((r) => ({
          customer_inventory_id: r.customer_inventory_id || null,
          serial_number: r.serial_number,
          unique_serial_number: r.unique_serial_number,
          brand: r.brand,
          model: r.model,
          ram: r.ram,
          storage: r.storage,
          generation: r.generation,
          item_type: r.item_type,
          issue_category_id: r.issue_category_id ? Number(r.issue_category_id) : null,
          remarks: r.remarks,
          assigned_to: r.assigned_to ? Number(r.assigned_to) : null
        })),
        remove_item_ids: removedIds
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-[#534AB7]/30 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Edit ticket</h2>
        <span className="text-xs text-amber-700">Unsaved changes</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">Phone
          <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={form.ticket_phone_override} onChange={(e) => setForm((f) => ({ ...f, ticket_phone_override: e.target.value }))} />
        </label>
        <label className="block text-sm">Alt phone
          <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={form.ticket_alt_phone} onChange={(e) => setForm((f) => ({ ...f, ticket_alt_phone: e.target.value }))} />
        </label>
        <label className="block text-sm">Email
          <input className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={form.ticket_email} onChange={(e) => setForm((f) => ({ ...f, ticket_email: e.target.value }))} />
        </label>
        <label className="block text-sm">Address
          <select className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={form.ticket_address} onChange={(e) => setForm((f) => ({ ...f, ticket_address: e.target.value }))}>
            <option value="">Select address</option>
            {addressOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">Priority
          <select className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="block text-sm md:col-span-2">Top-level remarks
          <textarea className="w-full border rounded-lg p-3 min-h-[72px] text-base mt-1" value={form.top_level_remarks} onChange={(e) => setForm((f) => ({ ...f, top_level_remarks: e.target.value }))} />
        </label>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Machines on ticket</h3>
        {itemRows.map((row) => (
          <article key={row.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="flex justify-between gap-2">
              <span className="text-sm font-medium">{row.serial || `Item ${row.id}`}</span>
              {row.canRemove && (
                <button type="button" className="text-red-700 text-sm min-h-[44px] px-2" onClick={() => removeExisting(row.id)}>Remove</button>
              )}
            </div>
            {itemAllowsTechnicianAssign(row) ? (
            <select className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base" value={row.assigned_to} onChange={(e) => setItemRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, assigned_to: e.target.value } : r)))}>
              <option value="">Assign technician</option>
              {technicians.map((t) => (
                <option key={t.user_id} value={t.user_id}>{t.name} ({t.open_ticket_count || 0})</option>
              ))}
            </select>
            ) : (
              <p className="text-sm text-slate-500">
                {row.pickup_method === 'courier' || row.pickup_method === 'porter'
                  ? 'Technician assignment is not available for courier/porter handling.'
                  : 'Assign handling method before assigning a technician.'}
              </p>
            )}
            <textarea className="w-full border rounded-lg p-3 min-h-[64px] text-base" placeholder="Remarks" value={row.remarks} onChange={(e) => setItemRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, remarks: e.target.value } : r)))} />
          </article>
        ))}
      </div>

      {newRows.map((row, idx) => (
        <article key={row.key} className="border border-slate-200 rounded-lg p-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-sm font-medium">New machine {idx + 1}</span>
            <button type="button" onClick={() => setNewRows((prev) => prev.filter((r) => r.key !== row.key))} className="min-h-[44px] min-w-[44px]"><Trash2 className="w-4 h-4 text-red-600" /></button>
          </div>
          <select className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base" value={row.customer_inventory_id} onChange={(e) => onAssetPick(row.key, e.target.value)}>
            <option value="">Select serial</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.unique_serial_number || a.serial_number} · {a.model_name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            {['complaint', 'pickup', 'replacement'].map((type) => (
              <button key={type} type="button" className={`support-filter-chip flex-1${row.item_type === type ? ' active' : ''}`} onClick={() => updateNewRow(row.key, { item_type: type })}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
          <select className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base" value={row.issue_category_id} onChange={(e) => updateNewRow(row.key, { issue_category_id: e.target.value })}>
            <option value="">Issue category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <textarea className="w-full border rounded-lg p-3 min-h-[64px] text-base" placeholder="Remarks" value={row.remarks} onChange={(e) => updateNewRow(row.key, { remarks: e.target.value })} />
        </article>
      ))}

      <button type="button" className="support-btn-outline inline-flex items-center gap-2" onClick={() => setNewRows((prev) => [...prev, emptyRow()])}>
        <Plus className="w-4 h-4" /> Add machine
      </button>

      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" className="support-btn-primary" disabled={saving} onClick={submit}>Save changes</button>
        <button type="button" className="support-btn-outline" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

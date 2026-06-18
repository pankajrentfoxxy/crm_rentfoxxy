import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MapPin, X } from 'lucide-react';
import {
  listSoSerials, getDCMeta, updateSoSerialAddress, bulkUpdateSoSerialAddresses,
} from '../salesPipelineApi';

const emptyAddress = {
  name: '', phone: '', address: '', city: '', state: '', pincode: '', landmark: '',
  employee_name: '', employee_phone: '',
};

function addressLine(a) {
  if (!a) return null;
  return [a.address, a.city, a.state, a.pincode].filter(Boolean).join(', ');
}

function EditDrawer({ row, customer, onClose, onSaved }) {
  const [form, setForm] = useState({
    ...emptyAddress,
    ...(row.delivery_address || {}),
  });
  const [isWfh, setIsWfh] = useState(Boolean(row.is_wfh));
  const [notes, setNotes] = useState(row.delivery_notes || '');
  const [saving, setSaving] = useState(false);

  // Pre-fill contact from customer when blank.
  useEffect(() => {
    setForm((f) => ({
      ...f,
      name: f.name || customer?.name || '',
      phone: f.phone || customer?.phone || '',
    }));
  }, [customer]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const copyBilling = () => {
    const b = customer?.billing || {};
    setForm((f) => ({
      ...f,
      name: b.name || f.name,
      phone: b.phone || f.phone,
      address: b.address || '',
      city: b.city || '',
      state: b.state || '',
      pincode: b.pincode || b.zip_code || '',
    }));
  };

  const save = async () => {
    if (!form.name || !form.phone || !form.address || !form.city || !form.state || !form.pincode) {
      toast.error('Name, phone, address, city, state and pincode are required');
      return;
    }
    setSaving(true);
    try {
      await updateSoSerialAddress(row.allocation_id, {
        delivery_address: form,
        is_wfh: isWfh,
        delivery_notes: notes,
      });
      toast.success('Delivery address saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-md bg-white shadow-xl flex flex-col max-h-full">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold text-gray-900 text-sm">
            Delivery Address — {row.ttspl_id || row.serial_number}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          <button type="button" onClick={copyBilling} className="text-xs text-blue-600 hover:underline">
            Copy Billing Address
          </button>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact Name*" value={form.name} onChange={(v) => set('name', v)} />
            <Field label="Phone*" value={form.phone} onChange={(v) => set('phone', v)} />
          </div>
          <Field label="Address*" textarea value={form.address} onChange={(v) => set('address', v)} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="City*" value={form.city} onChange={(v) => set('city', v)} />
            <Field label="State*" value={form.state} onChange={(v) => set('state', v)} />
            <Field label="Pincode*" value={form.pincode} onChange={(v) => set('pincode', v)} />
          </div>
          <Field label="Landmark" value={form.landmark} onChange={(v) => set('landmark', v)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isWfh} onChange={(e) => setIsWfh(e.target.checked)} />
            Is this a Work-From-Home (employee) delivery?
          </label>
          {isWfh && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee Name" value={form.employee_name} onChange={(v) => set('employee_name', v)} />
              <Field label="Employee Phone" value={form.employee_phone} onChange={(v) => set('employee_phone', v)} />
            </div>
          )}
          <Field label="Notes (e.g. Call before arriving, Gate no. 3)" textarea value={notes} onChange={setNotes} />
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" disabled={saving} onClick={save} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">Save Address</button>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value, onChange, textarea }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {textarea ? (
        <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2}
          value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="w-full border rounded-lg px-3 py-2 text-sm"
          value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export default function SoDeliveryAddressPanel({ soNumber }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listSoSerials(soNumber);
      const flat = [];
      (r.data?.lines || []).forEach((line) => {
        (line.allocations || []).forEach((a) => {
          flat.push({
            ...a,
            brand: line.brand,
            model_name: line.model_name,
            processor: line.processor,
            ram: line.ram,
            storage: line.storage,
          });
        });
      });
      setRows(flat);
    } catch {
      toast.error('Failed to load attached laptops');
    } finally {
      setLoading(false);
    }
  }, [soNumber]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getDCMeta(soNumber).then((res) => {
      const d = res.data || {};
      const billing = d.billing_address || {};
      const shipping = d.shipping_address || {};
      setCustomer({
        name: d.customer_name || billing.name || '',
        phone: d.customer_mobile || billing.phone || '',
        billing: {
          name: billing.name, phone: billing.phone, address: billing.address,
          city: billing.city, state: billing.state, pincode: billing.zip_code || billing.pincode,
        },
        shipping,
      });
    }).catch(() => {});
  }, [soNumber]);

  const sameForAll = async () => {
    const b = customer?.billing;
    if (!b || !b.address) {
      toast.error('No billing address available to apply');
      return;
    }
    if (!window.confirm('Set the billing address as the delivery address for ALL laptops?')) return;
    setBusy(true);
    try {
      await bulkUpdateSoSerialAddresses(soNumber, {
        addresses: rows.map((row) => ({
          allocation_id: row.allocation_id,
          delivery_address: {
            name: b.name || customer.name, phone: b.phone || customer.phone,
            address: b.address, city: b.city, state: b.state, pincode: b.pincode,
          },
          is_wfh: false,
        })),
      });
      toast.success('Applied billing address to all laptops');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Bulk update failed');
    } finally {
      setBusy(false);
    }
  };

  const assignedCount = useMemo(() => rows.filter((r) => r.delivery_address?.address).length, [rows]);

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>;
  if (!rows.length) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
        Attach laptops to this sales order first (Laptops &amp; QC tab). Delivery addresses can be set once units are attached.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {assignedCount}/{rows.length} laptops have a delivery address.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={sameForAll} disabled={busy}
            className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Same Address for All (Billing)
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500 text-left">
            <tr>
              <th className="px-4 py-2">TTSPL ID</th>
              <th className="px-4 py-2">Brand / Config</th>
              <th className="px-4 py-2">Delivery Address</th>
              <th className="px-4 py-2">WFH?</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.allocation_id}>
                <td className="px-4 py-2 font-mono text-xs text-blue-700">{row.ttspl_id || row.serial_number}</td>
                <td className="px-4 py-2 text-gray-600">
                  {[row.brand, row.model_name, row.processor, row.ram, row.storage].filter(Boolean).join(' · ')}
                </td>
                <td className="px-4 py-2">
                  {addressLine(row.delivery_address) ? (
                    <span className="text-gray-800">{addressLine(row.delivery_address)}</span>
                  ) : (
                    <span className="text-amber-600 text-xs">Not set</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {row.is_wfh ? <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">WFH</span> : 'No'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => setEditRow(row)}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <MapPin className="w-3.5 h-3.5" /> {addressLine(row.delivery_address) ? 'Edit' : 'Set'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editRow && (
        <EditDrawer
          row={editRow}
          customer={customer}
          onClose={() => setEditRow(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

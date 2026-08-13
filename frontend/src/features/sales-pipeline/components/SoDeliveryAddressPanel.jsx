import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MapPin, X } from 'lucide-react';
import {
  listSoSerials, getSalesOrderFull, getDCMeta,
  updateSoSerialAddress, updateSoLineAddress, bulkUpdateSoSerialAddresses,
  getCustomerDetail, getCustomerAddresses,
} from '../salesPipelineApi';
import { parseDeliveryAddress } from '../salesPipelineUtils';
import { INDIAN_STATES, resolveStateSelectValue } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';

const emptyAddress = {
  name: '', phone: '', address: '', city: '', state: '', pincode: '', landmark: '',
  employee_name: '', employee_phone: '',
};

function getField(obj, snake, camel) {
  if (!obj) return '';
  const val = obj[snake] ?? obj[camel];
  if (val && typeof val === 'object' && val.address) return val.address;
  return val || '';
}

function mapToDeliveryForm(addr, fallback = {}) {
  const parsed = parseDeliveryAddress(addr) || addr || {};
  return {
    name: parsed.name || parsed.concern_person || fallback.name || '',
    phone: parsed.phone || parsed.mobile_no || fallback.phone || '',
    address: parsed.address || '',
    city: parsed.city || '',
    state: parsed.state || '',
    pincode: parsed.pincode || parsed.zip_code || '',
    landmark: parsed.landmark || '',
  };
}

function buildShippingAddressOptions({ customer, savedAddresses = [], soShipping }) {
  const options = [];
  const seen = new Set();
  const fallbackName = customer?.company_name || customer?.name || customer?.customer_name || '';
  const fallbackPhone = customer?.phone || customer?.customer_number || '';

  const addOption = (value, label, rawAddr) => {
    const mapped = mapToDeliveryForm(rawAddr, { name: fallbackName, phone: fallbackPhone });
    if (!mapped.address?.trim()) return;
    const key = [mapped.address, mapped.pincode].join('|').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ value, label, address: mapped });
  };

  if (soShipping) {
    addOption('so_shipping', 'Sales order shipping address', soShipping);
  }

  const shippingSame = customer?.shipping_same ?? customer?.shippingSame ?? true;
  if (customer && !shippingSame && getField(customer, 'shipping_address', 'shippingAddress')) {
    addOption('customer_shipping', 'Customer shipping address', {
      name: fallbackName,
      phone: fallbackPhone,
      address: getField(customer, 'shipping_address', 'shippingAddress'),
      city: getField(customer, 'shipping_city', 'shippingCity'),
      state: getField(customer, 'shipping_state', 'shippingState'),
      pincode: getField(customer, 'shipping_pincode', 'shippingPincode'),
    });
  }

  const detailShipping = customer?.shipping_addresses || [];
  (Array.isArray(detailShipping) ? detailShipping : []).forEach((addr, index) => {
    const label = addr.label || addr.name || `Shipping address ${index + 1}`;
    addOption(`detail_${index}`, label, addr);
  });

  savedAddresses
    .filter((addr) => !addr.address_type || String(addr.address_type).toLowerCase() === 'shipping')
    .forEach((addr) => {
      const label = `${addr.concern_person || 'Shipping'} — ${addr.address}${addr.pincode ? `, ${addr.pincode}` : ''}`;
      addOption(`saved_${addr.customer_address_id}`, label, {
        name: addr.concern_person || fallbackName,
        phone: addr.mobile_no || fallbackPhone,
        address: addr.address,
        pincode: addr.pincode,
      });
    });

  return options;
}

function addressLine(a) {
  if (!a) return null;
  return [a.address, a.city, a.state, a.pincode].filter(Boolean).join(', ');
}

function EditDrawer({ title, subtitle, initial, customer, shippingOptions, onClose, onSave }) {
  const [form, setForm] = useState({ ...emptyAddress, ...(initial.delivery_address || {}) });
  const [isWfh, setIsWfh] = useState(Boolean(initial.is_wfh));
  const [notes, setNotes] = useState(initial.delivery_notes || '');
  const [saving, setSaving] = useState(false);
  const [pinLookingUp, setPinLookingUp] = useState(false);
  const [selectedShipping, setSelectedShipping] = useState('');

  useEffect(() => {
    setForm((f) => ({
      ...f,
      name: f.name || customer?.name || '',
      phone: f.phone || customer?.phone || '',
    }));
  }, [customer]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handlePincodeChange = async (value) => {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
    set('pincode', digits);
    if (digits.length !== 6) return;
    setPinLookingUp(true);
    try {
      const { info } = await applyPincodeAutofill(digits, setForm, {
        pinKey: 'pincode',
        cityKey: 'city',
        stateKey: 'state',
        addressKey: 'address',
        fillAddressIfEmpty: true,
      });
      if (info?.city || info?.state) {
        toast.success(`Location filled: ${[info.city, info.state].filter(Boolean).join(', ')}`);
      } else {
        toast.error('No city/state found for this pincode');
      }
    } finally {
      setPinLookingUp(false);
    }
  };

  const applyShippingOption = (value) => {
    setSelectedShipping(value);
    if (!value) return;
    const opt = shippingOptions.find((o) => o.value === value);
    if (!opt?.address) return;
    setForm((f) => ({
      ...f,
      ...opt.address,
      employee_name: f.employee_name,
      employee_phone: f.employee_phone,
    }));
  };

  const copyBilling = () => {
    setSelectedShipping('');
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
      await onSave({ delivery_address: form, is_wfh: isWfh, delivery_notes: notes });
      toast.success('Delivery address saved');
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
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
          {shippingOptions.length > 0 && (
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Select customer shipping address</span>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                value={selectedShipping}
                onChange={(e) => applyShippingOption(e.target.value)}
              >
                <option value="">Choose a shipping address…</option>
                {shippingOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Fields below can still be edited after selection.</p>
            </label>
          )}
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
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">State*</span>
              <select className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                value={resolveStateSelectValue(form.state)}
                onChange={(e) => set('state', e.target.value)}>
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">
                Pincode*{pinLookingUp ? ' · looking up…' : ''}
              </span>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.pincode}
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit pincode"
                onChange={(e) => handlePincodeChange(e.target.value)}
                onBlur={(e) => handlePincodeChange(e.target.value)}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Enter 6 digits to auto-fill city, state and locality address
              </p>
            </label>
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

function Field({ label, value, onChange, onBlur, textarea }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {textarea ? (
        <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2}
          value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="w-full border rounded-lg px-3 py-2 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined} />
      )}
    </label>
  );
}

function configStr(o) {
  return [o.brand, o.model_name, o.processor, o.generation, o.ram, o.storage].filter(Boolean).join(' · ');
}

export default function SoDeliveryAddressPanel({ soNumber }) {
  const [serialRows, setSerialRows] = useState([]);
  const [soLines, setSoLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editSerial, setEditSerial] = useState(null);
  const [editLine, setEditLine] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [shippingOptions, setShippingOptions] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [serialRes, soRes] = await Promise.all([
        listSoSerials(soNumber),
        getSalesOrderFull(soNumber).catch(() => ({ data: {} })),
      ]);
      const flat = [];
      (serialRes.data?.lines || []).forEach((line) => {
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
      setSerialRows(flat);
      setSoLines(soRes.data?.lines || []);
    } catch {
      toast.error('Failed to load delivery addresses');
    } finally {
      setLoading(false);
    }
  }, [soNumber]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getDCMeta(soNumber).then(async (res) => {
      const d = res.data || {};
      const billing = d.billing_address || {};
      const shipping = parseDeliveryAddress(d.shipping_address) || d.shipping_address || {};
      setCustomer({
        name: d.customer_name || billing.name || '',
        phone: d.customer_mobile || billing.phone || '',
        billing: {
          name: billing.name, phone: billing.phone, address: billing.address,
          city: billing.city, state: billing.state, pincode: billing.zip_code || billing.pincode,
        },
        soShipping: shipping,
      });

      if (!d.customer_id) {
        setShippingOptions(buildShippingAddressOptions({ soShipping: shipping }));
        return;
      }

      try {
        const [custRes, addrRes] = await Promise.all([
          getCustomerDetail(d.customer_id),
          getCustomerAddresses(d.customer_id),
        ]);
        const cust = custRes.data?.customer || custRes.data;
        const saved = addrRes.data?.addresses || cust?.saved_addresses || [];
        setShippingOptions(buildShippingAddressOptions({
          customer: cust,
          savedAddresses: saved,
          soShipping: shipping,
        }));
      } catch {
        setShippingOptions(buildShippingAddressOptions({ soShipping: shipping }));
      }
    }).catch(() => {});
  }, [soNumber]);

  const hasSerials = serialRows.length > 0;

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
        addresses: serialRows.map((row) => ({
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

  const assignedCount = useMemo(
    () => serialRows.filter((r) => r.delivery_address?.address).length,
    [serialRows],
  );

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>;

  // PRE-ATTACH VIEW — plan addresses per order line before laptops are attached.
  if (!hasSerials) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-100 text-blue-800 rounded-lg p-3 text-sm">
          Set a delivery address per laptop configuration now. When the warehouse attaches
          serials, each unit inherits its line's address (you can fine-tune per-TTSPL later).
        </div>
        {soLines.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
            This sales order has no line items.
          </div>
        ) : soLines.map((line) => (
          <div key={line.id} className="border rounded-xl p-4 bg-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-sm">{configStr(line) || line.brand || '—'}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {(line.main_qty || line.quantity || 0)} unit(s)
                  {line.rate ? ` · ₹${Number(line.rate).toLocaleString('en-IN')}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setEditLine(line)}
                className="text-xs text-blue-600 border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-50 whitespace-nowrap">
                {line.delivery_address ? 'Edit Address' : 'Set Address'}
              </button>
            </div>
            {line.delivery_address ? (
              <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-2">
                <p className="font-medium">{line.delivery_address.name}</p>
                <p>{addressLine(line.delivery_address)}</p>
                {line.is_wfh && (
                  <span className="inline-block mt-1 px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-[10px] font-medium">
                    🏠 WFH Delivery
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-600">
                ⚠ No address set. This will default to the customer billing address.
              </p>
            )}
          </div>
        ))}

        {editLine && (
          <EditDrawer
            title={`Delivery Address — ${configStr(editLine) || editLine.brand}`}
            subtitle={`${editLine.main_qty || editLine.quantity || 0} unit(s) on this line`}
            initial={editLine}
            customer={customer}
            shippingOptions={shippingOptions}
            onClose={() => setEditLine(null)}
            onSave={async (payload) => {
              await updateSoLineAddress(editLine.id, payload);
              await load();
            }}
          />
        )}
      </div>
    );
  }

  // POST-ATTACH VIEW — per-TTSPL addresses (pre-filled from line inheritance).
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {assignedCount}/{serialRows.length} laptops have a delivery address.
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
            {serialRows.map((row) => (
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
                  <button type="button" onClick={() => setEditSerial(row)}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <MapPin className="w-3.5 h-3.5" /> {addressLine(row.delivery_address) ? 'Edit' : 'Set'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editSerial && (
        <EditDrawer
          title={`Delivery Address — ${editSerial.ttspl_id || editSerial.serial_number}`}
          initial={editSerial}
          customer={customer}
          shippingOptions={shippingOptions}
          onClose={() => setEditSerial(null)}
          onSave={async (payload) => {
            await updateSoSerialAddress(editSerial.allocation_id, payload);
            await load();
          }}
        />
      )}
    </div>
  );
}

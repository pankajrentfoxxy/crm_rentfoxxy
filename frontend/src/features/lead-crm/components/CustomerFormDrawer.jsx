import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { COMPANY_TYPES } from '../leadConstants';
import {
  addCustomerAddress, createCustomer, deleteCustomerAddress,
  getCustomerAddresses, setDefaultCustomerAddress, updateCustomer,
} from '../leadCrmApi';
import toast from 'react-hot-toast';
import { INDIAN_STATES, resolveStateSelectValue } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\d{10}$/;

const empty = () => ({
  customer_name: '', email: '', customer_number: '', company_name: '',
  gst_number: '', pan_number: '', company_type: '', industry: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '',
  whatsapp_number: '', designation: '', notes: '',
  finance_contact_name: '', finance_contact_email: '', finance_contact_mobile: '',
  spock_person_name: '', spock_person_email: '', spock_person_mobile: '',
});

const emptyAddrForm = () => ({
  address: '', city: '', state: '', pincode: '', concern_person: '', mobile_no: '',
});

export default function CustomerFormDrawer({ open, customer, onClose, onSaved }) {
  const [form, setForm] = useState(empty());
  const [shippingSame, setShippingSame] = useState(true);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [addrForm, setAddrForm] = useState(emptyAddrForm());
  const [addrSaving, setAddrSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const isEdit = !!customer;

  useEffect(() => {
    if (customer) {
      setForm({
        customer_name: customer.customer_name || customer.name || '',
        company_name: customer.company_name || '',
        email: customer.email || '',
        customer_number: customer.customer_number || customer.phone || '',
        gst_number: customer.gst_number || '',
        pan_number: customer.pan_number || customer.pan_card_number || '',
        company_type: customer.company_type || '',
        industry: customer.industry || '',
        billing_address: typeof customer.billing_address === 'string' ? customer.billing_address : customer.billing_address?.address || '',
        billing_city: customer.billing_city || '',
        billing_state: resolveStateSelectValue(customer.billing_state || ''),
        billing_pincode: customer.billing_pincode || '',
        shipping_same: customer.shipping_same !== false,
        shipping_address: customer.shipping_address || '',
        shipping_city: customer.shipping_city || '',
        shipping_state: resolveStateSelectValue(customer.shipping_state || ''),
        shipping_pincode: customer.shipping_pincode || '',
        whatsapp_number: customer.whatsapp_number || '',
        designation: customer.designation || '',
        notes: customer.notes || '',
        finance_contact_name: customer.finance_contact_name || customer.details?.finance_contact_name || '',
        finance_contact_email: customer.finance_contact_email || customer.details?.finance_contact_email || '',
        finance_contact_mobile: customer.finance_contact_mobile || customer.details?.finance_contact_mobile || '',
        spock_person_name: customer.spock_person_name || customer.details?.spock_person_name || customer.expox_person_name || customer.details?.expox_person_name || '',
        spock_person_email: customer.spock_person_email || customer.details?.spock_person_email || customer.expox_person_email || customer.details?.expox_person_email || '',
        spock_person_mobile: customer.spock_person_mobile || customer.details?.spock_person_mobile || customer.expox_person_mobile || customer.details?.expox_person_mobile || '',
      });
      setShippingSame(customer.shipping_same !== false);
      setFieldErrors({});
    } else if (open) {
      setForm(empty());
      setShippingSame(true);
      setSavedAddresses([]);
      setFieldErrors({});
    }
  }, [customer, open]);

  useEffect(() => {
    if (!open || !customer?.customer_id) {
      setSavedAddresses([]);
      return;
    }
    getCustomerAddresses(customer.customer_id)
      .then((res) => setSavedAddresses(res.data?.addresses || []))
      .catch(() => setSavedAddresses([]));
  }, [open, customer?.customer_id]);

  if (!open) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handlePincodeAutofill = (value, cityKey, stateKey, pinKey) =>
    applyPincodeAutofill(value, setForm, { pinKey, cityKey, stateKey });

  const setMobile = (k, v) => {
    set(k, v.replace(/\D/g, '').slice(0, 10));
    setFieldErrors((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const validateForm = () => {
    const errors = {};
    const requiredSpockFields = [
      ['spock_person_name', 'Spock Person Name'],
      ['spock_person_email', 'Spock Person Email'],
      ['spock_person_mobile', 'Spock Person Mobile Number'],
    ];
    const optionalEmailFields = [
      ['email', 'Email'],
      ['finance_contact_email', 'Finance Contact Email'],
    ];
    const optionalMobileFields = [
      ['finance_contact_mobile', 'Finance Contact Mobile Number'],
    ];
    requiredSpockFields.forEach(([key, label]) => {
      const value = String(form[key] || '').trim();
      if (!value) {
        errors[key] = `${label} is required`;
        return;
      }
      if (key.endsWith('_email') && !EMAIL_RE.test(value)) errors[key] = `${label} is invalid`;
      if (key.endsWith('_mobile') && !MOBILE_RE.test(value)) errors[key] = `${label} must be a 10-digit number`;
    });
    optionalEmailFields.forEach(([key, label]) => {
      const value = String(form[key] || '').trim();
      if (value && !EMAIL_RE.test(value)) errors[key] = `${label} is invalid`;
    });
    optionalMobileFields.forEach(([key, label]) => {
      const value = String(form[key] || '').trim();
      if (value && !MOBILE_RE.test(value)) errors[key] = `${label} must be a 10-digit number`;
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const renderField = (key, label, { type = 'text', mobile = false, required = false } = {}) => (
    <div key={key}>
      <label className="text-xs text-gray-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => {
          if (mobile) setMobile(key, e.target.value);
          else {
            set(key, e.target.value);
            setFieldErrors((prev) => {
              if (!prev[key]) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }
        }}
        maxLength={mobile ? 10 : undefined}
        className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${
          fieldErrors[key] ? 'border-red-300' : 'border-gray-200'
        }`}
      />
      {fieldErrors[key] && <p className="mt-1 text-xs text-red-600">{fieldErrors[key]}</p>}
    </div>
  );

  const loadAddresses = async () => {
    if (!customer?.customer_id) return;
    const res = await getCustomerAddresses(customer.customer_id);
    setSavedAddresses(res.data?.addresses || []);
  };

  const handleSaveAddress = async () => {
    if (!customer?.customer_id || !addrForm.address.trim()) {
      toast.error('Address is required');
      return;
    }
    setAddrSaving(true);
    try {
      await addCustomerAddress(customer.customer_id, {
        ...addrForm,
        address_type: 'Shipping',
      });
      toast.success('Shipping address saved');
      setAddrForm(emptyAddrForm());
      setShowAddrForm(false);
      await loadAddresses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save address');
    } finally {
      setAddrSaving(false);
    }
  };

  const handleDeleteAddress = async (addressId) => {
    try {
      await deleteCustomerAddress(customer.customer_id, addressId);
      toast.success('Address deleted');
      await loadAddresses();
    } catch {
      toast.error('Failed to delete address');
    }
  };

  const handleSetDefaultAddress = async (addressId) => {
    try {
      const res = await setDefaultCustomerAddress(customer.customer_id, addressId);
      setSavedAddresses(res.data?.addresses || []);
      toast.success('Default address updated');
    } catch {
      toast.error('Failed to set default');
    }
  };

  const handleSave = async () => {
    if (!validateForm()) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        shipping_same: shippingSame,
        shipping_address: shippingSame ? '' : form.shipping_address,
        shipping_city: shippingSame ? '' : form.shipping_city,
        shipping_state: shippingSame ? '' : form.shipping_state,
        shipping_pincode: shippingSame ? '' : form.shipping_pincode,
      };
      if (isEdit) {
        await updateCustomer(customer.customer_id, payload);
        toast.success('Customer updated');
      } else {
        await createCustomer({
          ...form,
          contact_person_name: form.customer_name,
          contact_person_number: form.customer_number,
          billing_address_1: form.billing_address,
          billing_address_2: '',
          shipping_address_1: form.shipping_address || form.billing_address,
          shipping_address_2: '',
          shipping_state: form.shipping_state || form.billing_state,
          shipping_city: form.shipping_city || form.billing_city,
          shipping_pin_code: form.shipping_pincode || form.billing_pincode,
          billing_pin_code: form.billing_pincode,
          business_type: 'regular',
          password: 'TempPass123',
        });
        toast.success('Customer created');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} role="presentation" />
      <div className="relative w-full max-w-[560px] bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <h2 className="font-semibold">{isEdit ? 'Edit Customer' : 'Add Customer'}</h2>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['customer_name', 'Customer Name'], ['company_name', 'Company'], ['email', 'Email'],
            ['customer_number', 'Phone'], ['whatsapp_number', 'WhatsApp'], ['designation', 'Designation'],
            ['gst_number', 'GST'], ['pan_number', 'PAN'],
          ].map(([k, label]) => (
            <div key={k}>
              <label className="text-xs text-gray-500">{label}</label>
              <input value={form[k]} onChange={(e) => set(k, e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-500">Company Type</label>
            <select value={form.company_type} onChange={(e) => set('company_type', e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Select</option>
              {COMPANY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Industry</label>
            <input value={form.industry} onChange={(e) => set('industry', e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Billing Address</label>
            <textarea value={form.billing_address} onChange={(e) => set('billing_address', e.target.value)} rows={2}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          {['billing_city', 'billing_state', 'billing_pincode'].map((k) => (
            <div key={k}>
              <label className="text-xs text-gray-500 capitalize">{k.replace('billing_', '')}</label>
              {k === 'billing_state' ? (
                <select value={form.billing_state} onChange={(e) => set('billing_state', e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : k === 'billing_pincode' ? (
                <input value={form.billing_pincode}
                  onChange={(e) => handlePincodeAutofill(e.target.value, 'billing_city', 'billing_state', 'billing_pincode')}
                  onBlur={(e) => handlePincodeAutofill(e.target.value, 'billing_city', 'billing_state', 'billing_pincode')}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              ) : (
                <input value={form[k]} onChange={(e) => set(k, e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              )}
            </div>
          ))}

          <div className="sm:col-span-2 pt-2 border-t space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Finance Contact</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {renderField('finance_contact_name', 'Finance Contact Name')}
              {renderField('finance_contact_email', 'Finance Contact Email', { type: 'email' })}
              {renderField('finance_contact_mobile', 'Finance Contact Mobile Number', { mobile: true })}
            </div>
          </div>

          <div className="sm:col-span-2 pt-2 border-t space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Spock Person</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {renderField('spock_person_name', 'Spock Person Name', { required: true })}
              {renderField('spock_person_email', 'Spock Person Email', { type: 'email', required: true })}
              {renderField('spock_person_mobile', 'Spock Person Mobile Number', { mobile: true, required: true })}
            </div>
          </div>

          <div className="sm:col-span-2 pt-2 border-t">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Shipping Address</h3>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={shippingSame}
                onChange={(e) => {
                  setShippingSame(e.target.checked);
                  set('shipping_same', e.target.checked);
                }}
              />
              Shipping address same as billing
            </label>
          </div>
          {!shippingSame && (
            <>
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-500">Shipping Address</label>
                <textarea value={form.shipping_address} onChange={(e) => set('shipping_address', e.target.value)} rows={2}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              {[
                ['shipping_city', 'City'],
                ['shipping_state', 'State'],
                ['shipping_pincode', 'Pincode'],
              ].map(([k, label]) => (
                <div key={k}>
                  <label className="text-xs text-gray-500">{label}</label>
                  {k === 'shipping_state' ? (
                    <select value={form.shipping_state} onChange={(e) => set('shipping_state', e.target.value)}
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Select state</option>
                      {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : k === 'shipping_pincode' ? (
                    <input value={form.shipping_pincode}
                      onChange={(e) => handlePincodeAutofill(e.target.value, 'shipping_city', 'shipping_state', 'shipping_pincode')}
                      onBlur={(e) => handlePincodeAutofill(e.target.value, 'shipping_city', 'shipping_state', 'shipping_pincode')}
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  ) : (
                    <input value={form[k]} onChange={(e) => set(k, e.target.value)}
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  )}
                </div>
              ))}
            </>
          )}

          {isEdit && (
            <div className="sm:col-span-2 pt-2 border-t space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Saved Shipping Addresses (for quotation/DC use)</h3>
              {savedAddresses.length === 0 ? (
                <p className="text-xs text-gray-400">No saved addresses yet</p>
              ) : savedAddresses.map((addr) => (
                <div key={addr.customer_address_id} className="p-3 rounded-lg border border-gray-100 bg-gray-50 text-sm space-y-1">
                  <p>{addr.address}</p>
                  <p className="text-gray-500 text-xs">
                    {[addr.city, addr.pincode].filter(Boolean).join(' · ') || addr.pincode || '—'}
                    {addr.concern_person ? ` · ${addr.concern_person}` : ''}
                    {addr.mobile_no ? ` · ${addr.mobile_no}` : ''}
                  </p>
                  {addr.is_head_office && <span className="text-xs text-green-700">Default</span>}
                  <div className="flex gap-2 pt-1">
                    {!addr.is_head_office && (
                      <button type="button" onClick={() => handleSetDefaultAddress(addr.customer_address_id)}
                        className="text-xs text-blue-600 hover:underline">Set as default</button>
                    )}
                    <button type="button" onClick={() => handleDeleteAddress(addr.customer_address_id)}
                      className="text-xs text-red-600 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
              {showAddrForm ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 border rounded-lg">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-gray-500">Address *</label>
                    <textarea value={addrForm.address} onChange={(e) => setAddrForm((f) => ({ ...f, address: e.target.value }))}
                      rows={2} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  {[
                    ['city', 'City *'], ['state', 'State'], ['pincode', 'Pincode'],
                    ['concern_person', 'Contact Person'], ['mobile_no', 'Mobile No'],
                  ].map(([k, label]) => (
                    <div key={k}>
                      <label className="text-xs text-gray-500">{label}</label>
                      {k === 'state' ? (
                        <select value={addrForm.state} onChange={(e) => setAddrForm((f) => ({ ...f, state: e.target.value }))}
                          className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-white">
                          <option value="">Select state</option>
                          {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : k === 'pincode' ? (
                        <input value={addrForm.pincode}
                          onChange={(e) => applyPincodeAutofill(e.target.value, setAddrForm, {
                            pinKey: 'pincode', cityKey: 'city', stateKey: 'state',
                          })}
                          onBlur={(e) => applyPincodeAutofill(e.target.value, setAddrForm, {
                            pinKey: 'pincode', cityKey: 'city', stateKey: 'state',
                          })}
                          className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
                      ) : (
                        <input value={addrForm[k]} onChange={(e) => setAddrForm((f) => ({ ...f, [k]: e.target.value }))}
                          className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
                      )}
                    </div>
                  ))}
                  <div className="sm:col-span-2 flex gap-2">
                    <button type="button" onClick={handleSaveAddress} disabled={addrSaving}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
                      {addrSaving ? 'Saving...' : 'Save Address'}
                    </button>
                    <button type="button" onClick={() => { setShowAddrForm(false); setAddrForm(emptyAddrForm()); }}
                      className="px-3 py-1.5 text-sm border rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowAddrForm(true)}
                  className="text-sm text-blue-600 hover:underline">+ Add Shipping Address</button>
              )}
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Notes</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex gap-2 justify-end p-4 border-t shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

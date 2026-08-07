import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { COMPANY_TYPES } from '../leadConstants';
import {
  addCustomerAddress, createCustomer, deleteCustomerAddress,
  getCustomerAddresses, setDefaultCustomerAddress, updateCustomer, updateCustomerAddress,
} from '../leadCrmApi';
import toast from 'react-hot-toast';
import { INDIAN_STATES, resolveStateSelectValue } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';
import { createGstinAutofillHandler } from '../../../utils/gstinLookup';
import {
  formatIndianMobileInput,
  indianMobileError,
  normalizeIndianMobile,
} from '../../../utils/phoneValidation';
import {
  CUSTOMER_TYPE_OPTIONS,
  customerTypeLabel,
  normalizeCustomerType,
} from '../../../utils/customerType';
import { useAuth } from '../../../context/AuthContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const empty = () => ({
  customer_name: '', email: '', customer_number: '', company_name: '',
  gst_number: '', pan_number: '', company_type: '', industry: '',
  customer_type: 'both',
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
  const { user } = useAuth();
  const canEditType = user?.role === 'admin' || user?.role === 'super_admin';
  const [form, setForm] = useState(empty());
  const [shippingSame, setShippingSame] = useState(true);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [addrForm, setAddrForm] = useState(emptyAddrForm());
  const [addrSaving, setAddrSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [gstStatus, setGstStatus] = useState(null);
  const isEdit = !!customer;

  const handleGstinChange = useMemo(
    () => createGstinAutofillHandler(
      setForm,
      {
        gstKey: 'gst_number',
        companyKey: 'company_name',
        cityKey: 'billing_city',
        stateKey: 'billing_state',
        pinKey: 'billing_pincode',
        panKey: 'pan_number',
        companyTypeKey: 'company_type',
        addressKey: 'billing_address',
      },
      { onStatus: setGstStatus },
    ),
    [],
  );

  useEffect(() => {
    if (customer) {
      const contactName = customer.contact_person_name || customer.customer_name || customer.name || '';
      const contactPhone = customer.contact_person_number || customer.customer_number || customer.phone || '';
      setForm({
        customer_name: contactName,
        company_name: customer.company_name || '',
        email: customer.email || '',
        customer_number: contactPhone,
        gst_number: customer.gst_number || '',
        pan_number: customer.pan_number || customer.pan_card_number || '',
        company_type: customer.company_type || '',
        industry: customer.industry || '',
        customer_type: normalizeCustomerType(customer.customer_type),
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
      setGstStatus(null);
    } else if (open) {
      setForm(empty());
      setShippingSame(true);
      setSavedAddresses([]);
      setFieldErrors({});
      setGstStatus(null);
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
    set(k, formatIndianMobileInput(v));
    setFieldErrors((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const validateForm = () => {
    const errors = {};
    const requiredText = [
      ['customer_name', 'Contact person'],
      ['company_name', 'Company'],
      ['email', 'Email'],
      ['billing_address', 'Billing address'],
      ['billing_city', 'Billing city'],
      ['billing_state', 'Billing state'],
      ['billing_pincode', 'Billing pincode'],
    ];
    requiredText.forEach(([key, label]) => {
      if (!String(form[key] || '').trim()) errors[key] = `${label} is required`;
    });

    const emailVal = String(form.email || '').trim();
    if (emailVal && !EMAIL_RE.test(emailVal)) errors.email = 'Email is invalid';

    const phoneErr = indianMobileError(form.customer_number, { required: true, label: 'Phone' });
    if (phoneErr) errors.customer_number = phoneErr;
    const whatsappErr = indianMobileError(form.whatsapp_number, { label: 'WhatsApp number' });
    if (whatsappErr) errors.whatsapp_number = whatsappErr;

    if (!shippingSame) {
      [
        ['shipping_address', 'Shipping address'],
        ['shipping_city', 'Shipping city'],
        ['shipping_state', 'Shipping state'],
        ['shipping_pincode', 'Shipping pincode'],
      ].forEach(([key, label]) => {
        if (!String(form[key] || '').trim()) errors[key] = `${label} is required`;
      });
    }

    const requiredSpokeFields = [
      ['spock_person_name', 'Name'],
      ['spock_person_email', 'Email'],
      ['spock_person_mobile', 'Mobile Number'],
    ];
    const optionalEmailFields = [
      ['finance_contact_email', 'Finance Contact Email'],
    ];
    const optionalMobileFields = [
      ['finance_contact_mobile', 'Finance Contact Mobile Number'],
    ];
    requiredSpokeFields.forEach(([key, label]) => {
      const value = String(form[key] || '').trim();
      const errorLabel = `Spoke person ${label.toLowerCase()}`;
      if (!value) {
        errors[key] = `${errorLabel} is required`;
        return;
      }
      if (key.endsWith('_email') && !EMAIL_RE.test(value)) errors[key] = `${errorLabel} is invalid`;
      if (key.endsWith('_mobile')) {
        const err = indianMobileError(value, { required: true, label: errorLabel });
        if (err) errors[key] = err;
      }
    });
    optionalEmailFields.forEach(([key, label]) => {
      const value = String(form[key] || '').trim();
      if (value && !EMAIL_RE.test(value)) errors[key] = `${label} is invalid`;
    });
    optionalMobileFields.forEach(([key, label]) => {
      const err = indianMobileError(form[key], { label });
      if (err) errors[key] = err;
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

  const resetAddrForm = () => {
    setShowAddrForm(false);
    setEditingAddressId(null);
    setAddrForm(emptyAddrForm());
  };

  const handleEditAddress = (addr) => {
    setEditingAddressId(addr.customer_address_id);
    setAddrForm({
      address: addr.address || '',
      city: addr.city || '',
      state: resolveStateSelectValue(addr.state || ''),
      pincode: addr.pincode || '',
      concern_person: addr.concern_person || '',
      mobile_no: addr.mobile_no || '',
    });
    setShowAddrForm(true);
  };

  const handleSaveAddress = async () => {
    if (!customer?.customer_id || !addrForm.address.trim()) {
      toast.error('Address is required');
      return;
    }
    const mobileErr = indianMobileError(addrForm.mobile_no, { label: 'Mobile number' });
    if (mobileErr) {
      toast.error(mobileErr);
      return;
    }
    setAddrSaving(true);
    try {
      const payload = {
        ...addrForm,
        mobile_no: addrForm.mobile_no?.trim() ? normalizeIndianMobile(addrForm.mobile_no) : '',
        address_type: 'Shipping',
      };
      if (editingAddressId) {
        await updateCustomerAddress(customer.customer_id, editingAddressId, payload);
        toast.success('Shipping address updated');
      } else {
        await addCustomerAddress(customer.customer_id, payload);
        toast.success('Shipping address saved');
      }
      resetAddrForm();
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
        customer_number: normalizeIndianMobile(form.customer_number),
        whatsapp_number: form.whatsapp_number?.trim() ? normalizeIndianMobile(form.whatsapp_number) : '',
        shipping_same: shippingSame,
        shipping_address: shippingSame ? '' : form.shipping_address,
        shipping_city: shippingSame ? '' : form.shipping_city,
        shipping_state: shippingSame ? '' : form.shipping_state,
        shipping_pincode: shippingSame ? '' : form.shipping_pincode,
      };
      if (isEdit) {
        await updateCustomer(customer.customer_id, {
          ...payload,
          contact_person_name: payload.customer_name,
          contact_person_number: payload.customer_number,
        });
        toast.success('Customer updated');
      } else {
        await createCustomer({
          ...form,
          shipping_same: shippingSame,
          contact_person_name: form.customer_name,
          contact_person_number: form.customer_number,
          billing_address_1: form.billing_address,
          billing_address_2: '',
          shipping_address_1: shippingSame ? form.billing_address : (form.shipping_address || form.billing_address),
          shipping_address_2: '',
          shipping_state: shippingSame ? form.billing_state : (form.shipping_state || form.billing_state),
          shipping_city: shippingSame ? form.billing_city : (form.shipping_city || form.billing_city),
          shipping_pin_code: shippingSame ? form.billing_pincode : (form.shipping_pincode || form.billing_pincode),
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
            ['customer_name', 'Contact Person', false, true],
            ['company_name', 'Company', false, true],
            ['email', 'Email', false, true],
            ['customer_number', 'Phone', true, true],
            ['whatsapp_number', 'WhatsApp', true, false],
            ['designation', 'Designation', false, false],
          ].map(([k, label, mobile, required]) => (
            <div key={k}>
              <label className="text-xs text-gray-500">
                {label}
                {required ? <span className="text-red-500"> *</span> : null}
              </label>
              <input
                value={form[k]}
                onChange={(e) => (mobile ? setMobile(k, e.target.value) : set(k, e.target.value))}
                maxLength={mobile ? 10 : undefined}
                inputMode={mobile ? 'numeric' : undefined}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${
                  fieldErrors[k] ? 'border-red-300' : 'border-gray-200'
                }`}
              />
              {fieldErrors[k] && <p className="mt-1 text-xs text-red-600">{fieldErrors[k]}</p>}
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-500">GST</label>
            <input
              value={form.gst_number}
              onChange={(e) => handleGstinChange(e.target.value)}
              maxLength={15}
              placeholder="15-digit GSTIN"
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm uppercase ${
                fieldErrors.gst_number ? 'border-red-300' : 'border-gray-200'
              }`}
            />
            {gstStatus?.message ? (
              <p className={`mt-1 text-xs ${
                gstStatus.type === 'error' ? 'text-red-600'
                  : gstStatus.type === 'success' ? 'text-emerald-600'
                    : 'text-blue-600'
              }`}>
                {gstStatus.message}
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">Enter full GSTIN to autofill company &amp; billing address</p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500">PAN</label>
            <input
              value={form.pan_number}
              onChange={(e) => set('pan_number', e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
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
          <div>
            <label className="text-xs text-gray-500">Customer Type</label>
            <select
              value={form.customer_type}
              onChange={(e) => set('customer_type', e.target.value)}
              disabled={!canEditType}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
              title={canEditType ? undefined : 'Only Admin / Super Admin can change Customer Type'}
            >
              {CUSTOMER_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {!canEditType ? (
              <p className="mt-1 text-[11px] text-gray-400">{customerTypeLabel(form.customer_type)} (read-only)</p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Billing Address <span className="text-red-500">*</span></label>
            <textarea value={form.billing_address} onChange={(e) => set('billing_address', e.target.value)} rows={2}
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${fieldErrors.billing_address ? 'border-red-300' : 'border-gray-200'}`} />
            {fieldErrors.billing_address && <p className="mt-1 text-xs text-red-600">{fieldErrors.billing_address}</p>}
          </div>
          {['billing_city', 'billing_state', 'billing_pincode'].map((k) => (
            <div key={k}>
              <label className="text-xs text-gray-500 capitalize">
                {k.replace('billing_', '')}
                <span className="text-red-500"> *</span>
              </label>
              {k === 'billing_state' ? (
                <select value={form.billing_state} onChange={(e) => set('billing_state', e.target.value)}
                  className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-white ${fieldErrors[k] ? 'border-red-300' : 'border-gray-200'}`}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : k === 'billing_pincode' ? (
                <input value={form.billing_pincode}
                  onChange={(e) => handlePincodeAutofill(e.target.value, 'billing_city', 'billing_state', 'billing_pincode')}
                  onBlur={(e) => handlePincodeAutofill(e.target.value, 'billing_city', 'billing_state', 'billing_pincode')}
                  className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${fieldErrors[k] ? 'border-red-300' : 'border-gray-200'}`} />
              ) : (
                <input value={form[k]} onChange={(e) => set(k, e.target.value)}
                  className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${fieldErrors[k] ? 'border-red-300' : 'border-gray-200'}`} />
              )}
              {fieldErrors[k] && <p className="mt-1 text-xs text-red-600">{fieldErrors[k]}</p>}
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
            <h3 className="text-sm font-semibold text-gray-800">Spoke Person</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {renderField('spock_person_name', 'Name', { required: true })}
              {renderField('spock_person_email', 'Email', { type: 'email', required: true })}
              {renderField('spock_person_mobile', 'Mobile Number', { mobile: true, required: true })}
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
                    <button type="button" onClick={() => handleEditAddress(addr)}
                      className="text-xs text-blue-600 hover:underline">Edit</button>
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
                  <p className="sm:col-span-2 text-sm font-medium text-gray-800">
                    {editingAddressId ? 'Edit shipping address' : 'Add shipping address'}
                  </p>
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
                        <input
                          value={addrForm[k]}
                          onChange={(e) => setAddrForm((f) => ({
                            ...f,
                            [k]: k === 'mobile_no' ? formatIndianMobileInput(e.target.value) : e.target.value,
                          }))}
                          maxLength={k === 'mobile_no' ? 10 : undefined}
                          inputMode={k === 'mobile_no' ? 'numeric' : undefined}
                          className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
                        />
                      )}
                    </div>
                  ))}
                  <div className="sm:col-span-2 flex gap-2">
                    <button type="button" onClick={handleSaveAddress} disabled={addrSaving}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">
                      {addrSaving ? 'Saving...' : editingAddressId ? 'Update Address' : 'Save Address'}
                    </button>
                    <button type="button" onClick={resetAddrForm}
                      className="px-3 py-1.5 text-sm border rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => { setEditingAddressId(null); setAddrForm(emptyAddrForm()); setShowAddrForm(true); }}
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

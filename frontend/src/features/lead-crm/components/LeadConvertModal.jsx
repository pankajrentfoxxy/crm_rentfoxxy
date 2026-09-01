import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { convertToCustomer } from '../leadCrmApi';
import toast from 'react-hot-toast';
import { INDIAN_STATES, resolveStateSelectValue } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';
import { createGstinAutofillHandler, isValidGstin, lookupGstin, sanitizeGstin } from '../../../utils/gstinLookup';
import { formatIndianMobileInput, indianMobileError, INDIAN_MOBILE_RE } from '../../../utils/phoneValidation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = INDIAN_MOBILE_RE;

const emptyForm = () => ({
  customer_name: '',
  company_name: '',
  email: '',
  phone: '',
  gst_number: '',
  pan_number: '',
  billing_address: '',
  billing_city: '',
  billing_state: '',
  billing_pincode: '',
  shipping_address: '',
  shipping_city: '',
  shipping_state: '',
  shipping_pincode: '',
  spock_person_name: '',
  spock_person_email: '',
  spock_person_mobile: '',
});

export default function LeadConvertModal({ open, lead, onClose }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm());
  const [shippingSame, setShippingSame] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [gstStatus, setGstStatus] = useState(null);

  const handleGstinChange = useMemo(
    () => createGstinAutofillHandler(
      setForm,
      {
        gstKey: 'gst_number',
        companyKey: 'company_name',
        tradeNameKey: 'trade_name',
        useTradeNameAsCompany: true,
        cityKey: 'billing_city',
        stateKey: 'billing_state',
        pinKey: 'billing_pincode',
        panKey: 'pan_number',
        addressKey: 'billing_address',
      },
      { onStatus: setGstStatus },
    ),
    [],
  );

  useEffect(() => {
    if (!lead || !open) return;

    const gstin = sanitizeGstin(lead.gstNumber || lead.research?.gst || '');
    const initial = {
      customer_name: lead.name || '',
      company_name: lead.companyName || '',
      email: lead.email || '',
      phone: lead.phone || '',
      gst_number: gstin,
      trade_name: '',
      pan_number: lead.panNumber || '',
      billing_address: lead.billingAddress || '',
      billing_city: lead.city || '',
      billing_state: resolveStateSelectValue(lead.state || '') || lead.state || '',
      billing_pincode: lead.pincode || '',
      shipping_address: lead.shippingAddress || '',
      shipping_city: lead.city || '',
      shipping_state: resolveStateSelectValue(lead.state || '') || lead.state || '',
      shipping_pincode: lead.pincode || '',
      spock_person_name: '',
      spock_person_email: '',
      spock_person_mobile: '',
    };
    setForm(initial);
    setShippingSame(lead.shippingSameAsBilling !== false);
    setFieldErrors({});
    setGstStatus(null);

    // Lead edit GST autofill used to skip address — backfill on convert if needed.
    if (isValidGstin(gstin) && !String(initial.billing_address || '').trim()) {
      setGstStatus({ type: 'loading', message: 'Looking up GSTIN for billing address…' });
      lookupGstin(gstin)
        .then((info) => {
          if (!info) {
            setGstStatus({ type: 'error', message: 'No GST details found' });
            return;
          }
          setForm((f) => ({
            ...f,
            company_name: info.trade_name || info.company_name || f.company_name,
            trade_name: info.trade_name || f.trade_name,
            billing_address: info.address || f.billing_address,
            billing_city: info.city || f.billing_city,
            billing_state: info.stateSelect || info.state || f.billing_state,
            billing_pincode: info.pincode || f.billing_pincode,
            pan_number: info.pan_number || f.pan_number,
          }));
          setGstStatus({ type: 'success', message: info.company_name || 'GST details filled' });
        })
        .catch((err) => {
          setGstStatus({
            type: 'error',
            message: err.response?.data?.message || err.message || 'GSTIN lookup failed',
          });
        });
    }
  }, [lead, open]);

  if (!open || !lead) return null;

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setMobile = (key, value) => set(key, formatIndianMobileInput(value));

  const validateForm = () => {
    const errors = {};
    [
      ['customer_name', 'Contact name'],
      ['company_name', 'Company'],
      ['email', 'Email'],
      ['billing_address', 'Billing address'],
      ['billing_city', 'Billing city'],
      ['billing_state', 'Billing state'],
      ['billing_pincode', 'Billing pincode'],
    ].forEach(([key, label]) => {
      if (!String(form[key] || '').trim()) errors[key] = `${label} is required`;
    });
    const emailVal = String(form.email || '').trim();
    if (emailVal && !EMAIL_RE.test(emailVal)) errors.email = 'Email is invalid';
    const phoneErr = indianMobileError(form.phone, { required: true, label: 'Phone' });
    if (phoneErr) errors.phone = phoneErr;
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
    requiredSpokeFields.forEach(([key, label]) => {
      const value = String(form[key] || '').trim();
      const errorLabel = `Spoke person ${label.toLowerCase()}`;
      if (!value) {
        errors[key] = `${errorLabel} is required`;
        return;
      }
      if (key.endsWith('_email') && !EMAIL_RE.test(value)) errors[key] = `${errorLabel} is invalid`;
      if (key.endsWith('_mobile') && !MOBILE_RE.test(value)) errors[key] = `${errorLabel} must be a 10-digit number`;
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const renderField = (field, label, { type = 'text', mobile = false, required = false } = {}) => (
    <div key={field}>
      <label className="text-xs text-gray-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={form[field] || ''}
        onChange={(e) => (mobile ? setMobile(field, e.target.value) : set(field, e.target.value))}
        maxLength={mobile ? 10 : undefined}
        className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${
          fieldErrors[field] ? 'border-red-300' : 'border-gray-200'
        }`}
      />
      {fieldErrors[field] && <p className="mt-1 text-xs text-red-600">{fieldErrors[field]}</p>}
    </div>
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error('Please fill all required Spoke Person fields');
      return;
    }
    setSaving(true);
    try {
      const res = await convertToCustomer(lead.leadId, {
        ...form,
        shipping_same_as_billing: shippingSame,
      });
      toast.success('Customer profile created successfully');
      onClose();
      navigate(`/lead-crm/customers/${res.data.customer_id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Conversion failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Convert Lead to Customer</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {['customer_name', 'company_name', 'email', 'phone', 'pan_number'].map((field) => (
            <div key={field}>
              <label className="text-xs text-gray-500 capitalize">
                {field.replace(/_/g, ' ')}
                {['customer_name', 'company_name', 'email', 'phone'].includes(field) ? ' *' : ''}
              </label>
              <input
                value={form[field] || ''}
                onChange={(e) => (field === 'phone' ? setMobile(field, e.target.value) : set(field, e.target.value))}
                maxLength={field === 'phone' ? 10 : undefined}
                inputMode={field === 'phone' ? 'numeric' : undefined}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${fieldErrors[field] ? 'border-red-300' : 'border-gray-200'}`}
              />
              {fieldErrors[field] && <p className="mt-1 text-xs text-red-600">{fieldErrors[field]}</p>}
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-500">GST number</label>
            <input
              value={form.gst_number || ''}
              onChange={(e) => handleGstinChange(e.target.value)}
              maxLength={15}
              placeholder="15-digit GSTIN"
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase"
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
          <p className="text-sm font-medium text-gray-700 pt-2">Billing Address</p>
          {['billing_address', 'billing_city', 'billing_state', 'billing_pincode'].map((field) => (
            <div key={field}>
              <label className="text-xs text-gray-500 capitalize">{field.replace(/billing_/, '')} *</label>
              {field === 'billing_state' ? (
                <select value={form.billing_state || ''} onChange={(e) => set('billing_state', e.target.value)} required
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : field === 'billing_pincode' ? (
                <input value={form.billing_pincode || ''} required
                  onChange={(e) => applyPincodeAutofill(e.target.value, setForm, {
                    pinKey: 'billing_pincode', cityKey: 'billing_city', stateKey: 'billing_state',
                  })}
                  onBlur={(e) => applyPincodeAutofill(e.target.value, setForm, {
                    pinKey: 'billing_pincode', cityKey: 'billing_city', stateKey: 'billing_state',
                  })}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              ) : field === 'billing_address' ? (
                <textarea
                  value={form.billing_address || ''}
                  onChange={(e) => set('billing_address', e.target.value)}
                  required
                  rows={3}
                  className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${fieldErrors.billing_address ? 'border-red-300' : 'border-gray-200'}`}
                />
              ) : (
                <input value={form[field] || ''} onChange={(e) => set(field, e.target.value)} required
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              )}
              {fieldErrors[field] && <p className="mt-1 text-xs text-red-600">{fieldErrors[field]}</p>}
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shippingSame} onChange={(e) => setShippingSame(e.target.checked)} />
            Shipping same as billing?
          </label>
          {!shippingSame && (
            <>
              <p className="text-sm font-medium text-gray-700">Shipping Address</p>
              {['shipping_address', 'shipping_city', 'shipping_state', 'shipping_pincode'].map((field) => (
                <div key={field}>
                  <label className="text-xs text-gray-500 capitalize">{field.replace(/shipping_/, '')}</label>
                  {field === 'shipping_state' ? (
                    <select value={form.shipping_state || ''} onChange={(e) => set('shipping_state', e.target.value)}
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Select state</option>
                      {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : field === 'shipping_pincode' ? (
                    <input value={form.shipping_pincode || ''}
                      onChange={(e) => applyPincodeAutofill(e.target.value, setForm, {
                        pinKey: 'shipping_pincode', cityKey: 'shipping_city', stateKey: 'shipping_state',
                      })}
                      onBlur={(e) => applyPincodeAutofill(e.target.value, setForm, {
                        pinKey: 'shipping_pincode', cityKey: 'shipping_city', stateKey: 'shipping_state',
                      })}
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  ) : (
                    <input value={form[field] || ''} onChange={(e) => set(field, e.target.value)}
                      className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  )}
                </div>
              ))}
            </>
          )}
          <div className="pt-2 border-t space-y-3">
            <p className="text-sm font-medium text-gray-700">Spoke Person</p>
            {renderField('spock_person_name', 'Name', { required: true })}
            {renderField('spock_person_email', 'Email', { type: 'email', required: true })}
            {renderField('spock_person_mobile', 'Mobile Number', { mobile: true, required: true })}
          </div>
          <div className="flex gap-2 justify-end pt-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Converting...' : 'Convert to Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

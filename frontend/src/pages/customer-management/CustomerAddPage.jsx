import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { INDIAN_STATES, slugifyState } from '../../constants/indianStates';
import { applyPincodeAutofill } from '../../utils/pincodeLookup';
import { createCustomerManagement, fetchCustomerManagementMeta } from '../../utils/customerManagementApi';
import { formatIndianMobileInput, indianMobileError, normalizeIndianMobile } from '../../utils/phoneValidation';

const emptyForm = {
  customer_name: '',
  customer_number: '',
  email: '',
  contact_person_name: '',
  contact_person_number: '',
  password: '',
  billing_state: '',
  billing_city: '',
  billing_pin_code: '',
  billing_address_1: '',
  billing_address_2: '',
  shipping_state: '',
  shipping_city: '',
  shipping_pin_code: '',
  shipping_address_1: '',
  shipping_address_2: '',
  business_type: '',
  gst_number: '',
  pan_card_number: '',
};

export default function CustomerAddPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [uploadDocs, setUploadDocs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profilePreview, setProfilePreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCustomerManagementMeta()
      .then((data) => setForm((prev) => ({ ...prev, password: data.generated_password || '' })))
      .catch(() => setError('Failed to load form'));
  }, []);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handlePincodeChange = (field, cityField, stateField, value) =>
    applyPincodeAutofill(value, setForm, { pinKey: field, cityKey: cityField, stateKey: stateField });

  const onProfileChange = (e) => {
    const file = e.target.files?.[0];
    setProfile(file || null);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setProfilePreview(ev.target?.result || '');
      reader.readAsDataURL(file);
    } else {
      setProfilePreview('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const phoneErr = indianMobileError(form.customer_number, { required: true, label: 'Customer number' });
    const contactErr = indianMobileError(form.contact_person_number, { required: true, label: 'Contact number' });
    if (phoneErr || contactErr) {
      setError(phoneErr || contactErr);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key.includes('_state')) {
          payload.append(key, slugifyState(value));
        } else if (key === 'customer_number' || key === 'contact_person_number') {
          payload.append(key, normalizeIndianMobile(value));
        } else {
          payload.append(key, value ?? '');
        }
      });
      uploadDocs.forEach((file) => payload.append('upload_docs', file));
      if (profile) payload.append('profile', profile);

      await createCustomerManagement(payload);
      navigate('/customer-management/customers');
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-800">Customer Details Form</h1>
        <Link to="/customer-management/customers" className="text-sm text-cyan-700 hover:underline">Back to list</Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold border-b pb-3 mb-4">Customer Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Customer Name" required>
              <input required className="field-input" value={form.customer_name} onChange={(e) => update('customer_name', e.target.value)} placeholder="Customer name" />
            </Field>
            <Field label="Customer Number" required>
              <input required type="tel" maxLength={10} className="field-input" value={form.customer_number}
                onChange={(e) => update('customer_number', formatIndianMobileInput(e.target.value))} placeholder="Customer number" />
            </Field>
            <Field label="Customer Email" required>
              <input required type="email" className="field-input" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="Email" />
            </Field>
            <Field label="Contact Person Name" required>
              <input required className="field-input" value={form.contact_person_name} onChange={(e) => update('contact_person_name', e.target.value)} />
            </Field>
            <Field label="Contact Person Number" required>
              <input required type="tel" maxLength={10} className="field-input" value={form.contact_person_number}
                onChange={(e) => update('contact_person_number', formatIndianMobileInput(e.target.value))} />
            </Field>
            <Field label="Password" required>
              <input required readOnly className="field-input bg-gray-50" value={form.password} />
            </Field>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold border-b pb-3 mb-4">Billing & Shipping</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Billing Country" required>
              <input readOnly className="field-input bg-gray-50" value="India" />
            </Field>
            <Field label="Billing State" required>
              <select required className="field-input" value={form.billing_state} onChange={(e) => update('billing_state', e.target.value)}>
                <option value="">Select a State</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Billing City" required>
              <input required className="field-input" value={form.billing_city} onChange={(e) => update('billing_city', e.target.value)} />
            </Field>
            <Field label="Billing Pin Code" required>
              <input required className="field-input" value={form.billing_pin_code}
                onChange={(e) => handlePincodeChange('billing_pin_code', 'billing_city', 'billing_state', e.target.value)}
                onBlur={(e) => handlePincodeChange('billing_pin_code', 'billing_city', 'billing_state', e.target.value)} />
            </Field>
            <Field label="Billing Address 1" required>
              <textarea required rows={2} className="field-input" value={form.billing_address_1} onChange={(e) => update('billing_address_1', e.target.value)} />
            </Field>
            <Field label="Billing Address 2" required>
              <textarea required rows={2} className="field-input" value={form.billing_address_2} onChange={(e) => update('billing_address_2', e.target.value)} />
            </Field>

            <Field label="Shipping Country" required>
              <input readOnly className="field-input bg-gray-50" value="India" />
            </Field>
            <Field label="Shipping State" required>
              <select required className="field-input" value={form.shipping_state} onChange={(e) => update('shipping_state', e.target.value)}>
                <option value="">Select a State</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Shipping City" required>
              <input required className="field-input" value={form.shipping_city} onChange={(e) => update('shipping_city', e.target.value)} />
            </Field>
            <Field label="Shipping Pin Code" required>
              <input required className="field-input" value={form.shipping_pin_code}
                onChange={(e) => handlePincodeChange('shipping_pin_code', 'shipping_city', 'shipping_state', e.target.value)}
                onBlur={(e) => handlePincodeChange('shipping_pin_code', 'shipping_city', 'shipping_state', e.target.value)} />
            </Field>
            <Field label="Shipping Address 1" required>
              <textarea required rows={2} className="field-input" value={form.shipping_address_1} onChange={(e) => update('shipping_address_1', e.target.value)} />
            </Field>
            <Field label="Shipping Address 2" required>
              <textarea required rows={2} className="field-input" value={form.shipping_address_2} onChange={(e) => update('shipping_address_2', e.target.value)} />
            </Field>

            <Field label="Business Type" required>
              <select required className="field-input" value={form.business_type} onChange={(e) => update('business_type', e.target.value)}>
                <option value="">Please Select</option>
                <option value="regular">Regular</option>
                <option value="supplier">Supplier</option>
              </select>
            </Field>
            <Field label="GST Number">
              <input className="field-input uppercase" value={form.gst_number} onChange={(e) => update('gst_number', e.target.value.toUpperCase())} />
            </Field>
            <Field label="PAN Card Number">
              <input className="field-input uppercase" value={form.pan_card_number} onChange={(e) => update('pan_card_number', e.target.value.toUpperCase())} />
            </Field>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold border-b pb-3 mb-4">Upload Docs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-medium text-gray-600">Upload Docs</label>
              <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" className="mt-1 block w-full text-sm"
                onChange={(e) => setUploadDocs(Array.from(e.target.files || []))} />
              {uploadDocs.length > 0 ? (
                <p className="text-xs text-gray-500 mt-1">{uploadDocs.length} file(s) selected</p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Upload Customer Profile</label>
              <input type="file" accept=".jpg,.jpeg,.png" className="mt-1 block w-full text-sm" onChange={onProfileChange} />
              {profilePreview ? (
                <img src={profilePreview} alt="Profile preview" className="mt-2 w-24 h-24 object-cover rounded border" />
              ) : null}
            </div>
          </div>
        </div>

        {error ? <p className="text-red-600 text-sm">{error}</p> : null}

        <div className="flex justify-end gap-3">
          <Link to="/customer-management/customers" className="px-5 py-2 border rounded-lg text-sm">Cancel</Link>
          <button type="submit" disabled={saving} className="px-5 py-2 bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50">
            {saving ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </form>

      <style>{`
        .field-input {
          width: 100%;
          margin-top: 0.25rem;
          padding: 0.5rem 0.75rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      {children}
    </div>
  );
}

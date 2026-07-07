import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { INDIAN_STATES, resolveStateSelectValue } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';
import {
  addCustomerAddress,
  deleteCustomerAddress,
  setDefaultCustomerAddress,
  updateCustomer,
  updateCustomerAddress,
} from '../leadCrmApi';

const emptySavedForm = () => ({
  address: '',
  city: '',
  state: '',
  pincode: '',
  concern_person: '',
  mobile_no: '',
});

function customerField(customer, key) {
  if (!customer) return '';
  return customer[key] || customer.details?.[key] || '';
}

export default function CustomerAddressModal({
  open,
  mode = 'add',
  kind = 'saved',
  customer,
  addressId = null,
  initial = null,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(emptySavedForm());
  const [shippingSame, setShippingSame] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isSaved = kind === 'saved';
  const isBilling = kind === 'profile-billing';
  const isShipping = kind === 'profile-shipping';
  const isEdit = mode === 'edit';

  useEffect(() => {
    if (!open) return;
    if (isBilling) {
      const billingStreet = typeof customer?.billing_address === 'object'
        ? customer.billing_address?.address
        : customer?.billing_address;
      setForm({
        address: initial?.address || billingStreet || '',
        city: initial?.city || customer?.billing_city || '',
        state: resolveStateSelectValue(initial?.state || customer?.billing_state || ''),
        pincode: initial?.pincode || customer?.billing_pincode || '',
        concern_person: '',
        mobile_no: '',
      });
      setShippingSame(customer?.shipping_same !== false);
    } else if (isShipping) {
      setForm({
        address: initial?.address || customer?.shipping_address || '',
        city: initial?.city || customer?.shipping_city || '',
        state: resolveStateSelectValue(initial?.state || customer?.shipping_state || ''),
        pincode: initial?.pincode || customer?.shipping_pincode || '',
        concern_person: '',
        mobile_no: '',
      });
      setShippingSame(false);
    } else {
      setForm({
        address: initial?.address || '',
        city: initial?.city || '',
        state: resolveStateSelectValue(initial?.state || ''),
        pincode: initial?.pincode || '',
        concern_person: initial?.concern_person || '',
        mobile_no: initial?.mobile_no || '',
      });
    }
  }, [open, kind, initial, customer, isBilling, isShipping]);

  if (!open || !customer?.customer_id) return null;

  const title = (() => {
    if (isSaved) return isEdit ? 'Edit shipping address' : 'Add shipping address';
    if (isBilling) return 'Edit billing address';
    return 'Edit profile shipping address';
  })();

  const handlePincodeAutofill = (value) => {
    applyPincodeAutofill(value, setForm, {
      pinKey: 'pincode',
      cityKey: 'city',
      stateKey: 'state',
    });
  };

  const buildProfilePayload = () => {
    const payload = {
      spock_person_name: customerField(customer, 'spock_person_name'),
      spock_person_email: customerField(customer, 'spock_person_email'),
      spock_person_mobile: customerField(customer, 'spock_person_mobile'),
      finance_contact_name: customerField(customer, 'finance_contact_name'),
      finance_contact_email: customerField(customer, 'finance_contact_email'),
      finance_contact_mobile: customerField(customer, 'finance_contact_mobile'),
    };
    if (isBilling) {
      payload.billing_address = form.address.trim();
      payload.billing_city = form.city.trim();
      payload.billing_state = form.state;
      payload.billing_pincode = form.pincode.trim();
      if (shippingSame) {
        payload.shipping_same = true;
        payload.shipping_address = '';
        payload.shipping_city = '';
        payload.shipping_state = '';
        payload.shipping_pincode = '';
      }
    } else if (isShipping) {
      payload.shipping_same = false;
      payload.shipping_address = form.address.trim();
      payload.shipping_city = form.city.trim();
      payload.shipping_state = form.state;
      payload.shipping_pincode = form.pincode.trim();
    }
    return payload;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.address.trim()) {
      toast.error('Address is required');
      return;
    }
    setSaving(true);
    try {
      if (isSaved) {
        const payload = {
          address: form.address.trim(),
          city: form.city.trim() || null,
          state: form.state || null,
          pincode: form.pincode.trim() || null,
          concern_person: form.concern_person.trim() || null,
          mobile_no: form.mobile_no.trim() || null,
          address_type: 'Shipping',
        };
        if (isEdit && addressId) {
          await updateCustomerAddress(customer.customer_id, addressId, payload);
          toast.success('Address updated');
        } else {
          await addCustomerAddress(customer.customer_id, payload);
          toast.success('Address added');
        }
      } else {
        await updateCustomer(customer.customer_id, buildProfilePayload());
        toast.success('Address updated');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save address');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!addressId || !window.confirm('Delete this saved address?')) return;
    setDeleting(true);
    try {
      await deleteCustomerAddress(customer.customer_id, addressId);
      toast.success('Address deleted');
      onSaved?.();
      onClose();
    } catch {
      toast.error('Failed to delete address');
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefault = async () => {
    if (!addressId) return;
    setSaving(true);
    try {
      await setDefaultCustomerAddress(customer.customer_id, addressId);
      toast.success('Default address updated');
      onSaved?.();
      onClose();
    } catch {
      toast.error('Failed to set default');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{customer.company_name || customer.customer_name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form id="customer-address-form" onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500">Address <span className="text-red-500">*</span></label>
            <textarea
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              rows={3}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">City</label>
              <input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">State</label>
              <select
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Pincode</label>
              <input
                value={form.pincode}
                onChange={(e) => handlePincodeAutofill(e.target.value)}
                onBlur={(e) => handlePincodeAutofill(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {isSaved && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs text-gray-500">Contact person</label>
                <input
                  value={form.concern_person}
                  onChange={(e) => setForm((f) => ({ ...f, concern_person: e.target.value }))}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Mobile no</label>
                <input
                  value={form.mobile_no}
                  onChange={(e) => setForm((f) => ({ ...f, mobile_no: e.target.value.replace(/\D/g, '').slice(0, 15) }))}
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {isBilling && (
            <label className="flex items-center gap-2 text-sm text-gray-700 pt-1">
              <input
                type="checkbox"
                checked={shippingSame}
                onChange={(e) => setShippingSame(e.target.checked)}
              />
              Shipping address same as billing
            </label>
          )}
        </form>

        <div className="border-t p-4 shrink-0 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="customer-address-form"
              disabled={saving || deleting}
              className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'Update' : 'Add address'}
            </button>
          </div>

          {isSaved && isEdit && addressId && (
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
              {!initial?.isDefault && (
                <button
                  type="button"
                  onClick={handleSetDefault}
                  disabled={saving || deleting}
                  className="text-blue-600 hover:underline disabled:opacity-50"
                >
                  Set as default
                </button>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving || deleting}
                className="text-red-600 hover:underline disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete address'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

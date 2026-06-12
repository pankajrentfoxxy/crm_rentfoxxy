import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AssetDetailsForm, { emptyLineItem, lineItemsToPayload } from '../../features/operation-management/components/AssetDetailsForm';
import { BillingAddressPanel, ShippingAddressPanel } from '../../features/operation-management/components/CustomerAddressPanels';
import ShippingAddressModal from '../../features/operation-management/components/ShippingAddressModal';
import { branchForQuotationType } from '../../features/operation-management/utils/quotationHelpers';
import { INDIAN_STATES, slugifyState } from '../../constants/indianStates';
import { createQuotation, fetchQuotationMeta, saveCustomerShippingAddress } from '../../utils/salesManagementApi';

export default function QuotationAddPage() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [lines, setLines] = useState([emptyLineItem()]);
  const [shippingIndex, setShippingIndex] = useState(-1);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [savingShipping, setSavingShipping] = useState(false);
  const [form, setForm] = useState({
    customer_id: '',
    supply_state: slugifyState('Haryana'),
    quotation_type: '',
    branch: '',
    security_amount: '',
    shiping_charges: '',
    GST_number: '',
    customer_mobile: '',
    email: '',
    customer_name: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchQuotationMeta()
      .then((data) => {
        setMeta(data);
        setCustomers(data.customers || []);
      })
      .catch(() => setError('Failed to load form data'));
  }, []);

  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.customer_id) === String(form.customer_id)),
    [customers, form.customer_id]
  );

  const selectedShipping = shippingIndex >= 0 ? selectedCustomer?.shipping_addresses?.[shippingIndex] : null;

  const onQuotationTypeChange = (quotationType) => {
    setForm((prev) => ({
      ...prev,
      quotation_type: quotationType,
      branch: branchForQuotationType(quotationType),
      customer_id: quotationType ? prev.customer_id : '',
    }));
    if (!quotationType) {
      setShippingIndex(-1);
    }
  };

  const onCustomerChange = (customerId) => {
    const customer = customers.find((c) => String(c.customer_id) === String(customerId));
    const addresses = customer?.shipping_addresses || [];
    setForm((prev) => ({
      ...prev,
      customer_id: customerId,
      customer_name: customer?.name || '',
      email: customer?.email || '',
      customer_mobile: customer?.phone || '',
      GST_number: customer?.gst_no || '',
    }));
    setShippingIndex(addresses.length ? addresses.length - 1 : -1);
  };

  const handleSaveShipping = async (payload) => {
    if (!form.customer_id) throw new Error('Select a customer first');
    setSavingShipping(true);
    try {
      const result = await saveCustomerShippingAddress(form.customer_id, payload);
      const updated = result.customer;
      setCustomers((prev) => prev.map((c) => (c.customer_id === updated.customer_id ? updated : c)));
      const newIndex = (updated.shipping_addresses?.length || 1) - 1;
      setShippingIndex(newIndex);
    } finally {
      setSavingShipping(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedShipping) {
      setError('Please select a shipping address');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createQuotation({
        quotation_number: meta?.quotation_number,
        ...form,
        ...lineItemsToPayload(lines),
        customer_shipping_address: selectedShipping,
        customer_billing_address: selectedCustomer?.billing_address || { address: selectedCustomer?.address || '' },
      });
      navigate('/operation-management/quotations');
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const customerEnabled = Boolean(form.quotation_type);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-800">Add Quotation</h1>
        <Link to="/operation-management/quotations" className="text-sm text-cyan-700 hover:underline">Back to list</Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Quotation Number<span className="text-red-500">*</span></label>
              <input readOnly className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={meta?.quotation_number || 'EST-XXXXXX'} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Supply State<span className="text-red-500">*</span></label>
              <select className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" value={form.supply_state} required
                onChange={(e) => setForm({ ...form, supply_state: slugifyState(e.target.value) })}>
                {INDIAN_STATES.map((s) => <option key={s} value={slugifyState(s)}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Quotation Type<span className="text-red-500">*</span></label>
              <select className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" value={form.quotation_type} required
                onChange={(e) => onQuotationTypeChange(e.target.value)}>
                <option value="">Please Select</option>
                <option value="sale">Sale</option>
                <option value="rental">Rental</option>
                <option value="demo">Demo</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Branch<span className="text-red-500">*</span></label>
              <select className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50" value={form.branch} disabled required>
                <option value="">Please Select</option>
                <option value="gorefurbo">Gorefurbo</option>
                <option value="rentfoxxy">Rentfoxxy</option>
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="text-xs font-medium text-gray-600">Customer Name<span className="text-red-500">*</span></label>
              <select className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100" value={form.customer_id}
                onChange={(e) => onCustomerChange(e.target.value)} required disabled={!customerEnabled}>
                <option value="">Please Select</option>
                {customers.map((c) => (
                  <option key={c.customer_id} value={c.customer_id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Security Amount</label>
              <input type="number" placeholder="Security amount" className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={form.security_amount} onChange={(e) => setForm({ ...form, security_amount: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Shipping Charges</label>
              <input type="number" placeholder="Shipping charges" className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                value={form.shiping_charges} onChange={(e) => setForm({ ...form, shiping_charges: e.target.value })} />
            </div>
          </div>

          {selectedCustomer ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
              <BillingAddressPanel billing={selectedCustomer.billing_address} gstNumber={form.GST_number} />
              <ShippingAddressPanel
                shippingAddresses={selectedCustomer.shipping_addresses}
                selectedIndex={shippingIndex}
                onSelectIndex={setShippingIndex}
                onAddClick={() => setShowShippingModal(true)}
                selectedAddress={selectedShipping}
              />
            </div>
          ) : null}
        </div>

        {form.customer_id ? (
          <AssetDetailsForm
            lines={lines}
            onChange={setLines}
            catalog={meta?.catalog}
            quotationType={form.quotation_type}
          />
        ) : null}

        {error ? <p className="text-red-600 text-sm">{error}</p> : null}

        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap justify-end gap-3">
          <Link to="/operation-management/quotations" className="px-5 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </Link>
          <button type="submit" disabled={saving || !form.customer_id} className="px-5 py-2 bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50 hover:bg-teal-800">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>

      <ShippingAddressModal
        open={showShippingModal}
        onClose={() => setShowShippingModal(false)}
        onSubmit={handleSaveShipping}
        saving={savingShipping}
      />
    </div>
  );
}

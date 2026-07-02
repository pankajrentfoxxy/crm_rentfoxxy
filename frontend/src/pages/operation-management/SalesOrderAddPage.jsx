import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AssetDetailsForm, { emptyLineItem, lineItemsToPayload } from '../../features/operation-management/components/AssetDetailsForm';
import { BillingAddressPanel, ShippingAddressPanel } from '../../features/operation-management/components/CustomerAddressPanels';
import ShippingAddressModal from '../../features/operation-management/components/ShippingAddressModal';
import { branchForQuotationType } from '../../features/operation-management/utils/quotationHelpers';
import { INDIAN_STATES, slugifyState } from '../../constants/indianStates';
import { createSalesOrder, fetchSalesOrderMeta, saveCustomerShippingAddress } from '../../utils/salesManagementApi';

function parseJsonField(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function lineToAssetItem(line) {
  return {
    brand: line.brand || '',
    model_name: line.model_name || '',
    processor: line.processor || '',
    generation: line.generation || '',
    ram: line.ram || '',
    storage: line.storage || '',
    gpu: line.gpu || '',
    screen_size: line.screen_size || '',
    quantity: line.quantity || 1,
    rate: line.rate || 0,
    locking_period: line.locking_period || '',
    technical_warranty: line.technical_warranty || '',
    battery_charger_warranty: line.battery_charger_warranty || '',
    remark: line.remark || '',
  };
}

export default function SalesOrderAddPage() {
  const [params] = useSearchParams();
  const quotationNumber = params.get('quotation_number');
  const isWithoutQuotation = !quotationNumber;
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [lines, setLines] = useState([emptyLineItem()]);
  const [shippingIndex, setShippingIndex] = useState(-1);
  const [quotationShipping, setQuotationShipping] = useState(null);
  const [quotationBilling, setQuotationBilling] = useState(null);
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
    fetchSalesOrderMeta({ quotation_number: quotationNumber || undefined })
      .then((data) => {
        setMeta(data);
        setCustomers(data.customers || []);

        if (data.quotation_lines?.length) {
          const header = data.quotation_lines[0];
          setLines(data.quotation_lines.map(lineToAssetItem));
          setForm({
            customer_id: header.customer_id || '',
            customer_name: header.customer_name || '',
            email: header.customer_email || '',
            customer_mobile: header.customer_mobile || '',
            GST_number: header.gst_number || '',
            supply_state: header.supply_state || slugifyState('Haryana'),
            security_amount: header.security_amount ?? '',
            shiping_charges: header.shiping_charges ?? '',
            quotation_type: header.quotation_type || 'rental',
            branch: branchForQuotationType(header.quotation_type || 'rental'),
          });
          setQuotationShipping(parseJsonField(header.customer_shipping_address));
          setQuotationBilling(parseJsonField(header.customer_billing_address));
        }
      })
      .catch(() => setError('Failed to load form data'));
  }, [quotationNumber]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.customer_id) === String(form.customer_id)),
    [customers, form.customer_id]
  );

  const billingAddress = isWithoutQuotation
    ? selectedCustomer?.billing_address
    : (quotationBilling || selectedCustomer?.billing_address);

  const shippingAddresses = isWithoutQuotation
    ? (selectedCustomer?.shipping_addresses || [])
    : (quotationShipping ? [quotationShipping] : (selectedCustomer?.shipping_addresses || []));

  const selectedShipping = isWithoutQuotation
    ? (shippingIndex >= 0 ? shippingAddresses[shippingIndex] : null)
    : quotationShipping;

  const onQuotationTypeChange = (quotationType) => {
    setForm((prev) => ({
      ...prev,
      quotation_type: quotationType,
      branch: branchForQuotationType(quotationType),
      customer_id: quotationType ? prev.customer_id : '',
    }));
    if (!quotationType) setShippingIndex(-1);
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
      setShippingIndex((updated.shipping_addresses?.length || 1) - 1);
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
      await createSalesOrder({
        sales_order_number: meta?.sales_order_number,
        quotation_number: quotationNumber,
        is_without_quotation: isWithoutQuotation,
        ...form,
        ...lineItemsToPayload(lines),
        customer_shipping_address: selectedShipping,
        customer_billing_address: billingAddress || { address: selectedCustomer?.address || '' },
      });
      navigate('/operation-management/sales-orders');
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const customerEnabled = Boolean(form.quotation_type) && isWithoutQuotation;
  const showAssets = Boolean(form.customer_id);
  const pageTitle = isWithoutQuotation ? 'Sales Order Form' : 'Sales Order from Quotation';

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-800">{pageTitle}</h1>
        <Link to="/operation-management/sales-orders" className="text-sm text-cyan-700 hover:underline">Back to list</Link>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800 border-b pb-3 mb-4 flex items-center gap-2">
            <span aria-hidden>📄</span> Sales Order Form
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Sales Order No.<span className="text-red-500">*</span></label>
              <input readOnly className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={meta?.sales_order_number || 'SO-XXXXXX'} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Supply State<span className="text-red-500">*</span></label>
              <select
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100"
                value={form.supply_state}
                required
                disabled={!isWithoutQuotation}
                onChange={(e) => setForm({ ...form, supply_state: slugifyState(e.target.value) })}
              >
                {INDIAN_STATES.map((s) => <option key={s} value={slugifyState(s)}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Quotation Type<span className="text-red-500">*</span></label>
              <select
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100"
                value={form.quotation_type}
                required
                disabled={!isWithoutQuotation}
                onChange={(e) => onQuotationTypeChange(e.target.value)}
              >
                <option value="">Please Select</option>
                <option value="sale">Sale</option>
                <option value="rental">Rental</option>
                <option value="demo">Demo</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Branch</label>
              <input
                readOnly
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm capitalize"
                value={form.branch}
                placeholder="Branch"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="text-xs font-medium text-gray-600">Customer Name<span className="text-red-500">*</span></label>
              {isWithoutQuotation ? (
                <select
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100"
                  value={form.customer_id}
                  onChange={(e) => onCustomerChange(e.target.value)}
                  required
                  disabled={!customerEnabled}
                >
                  <option value="">Please Select</option>
                  {customers.map((c) => (
                    <option key={c.customer_id} value={c.customer_id}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <input readOnly className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={form.customer_name} />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Security Amount</label>
              <input
                type="number"
                placeholder="Security amount"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100"
                value={form.security_amount}
                disabled={!isWithoutQuotation}
                onChange={(e) => setForm({ ...form, security_amount: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Shipping Charges</label>
              <input
                type="number"
                placeholder="Shipping charges"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-100"
                value={form.shiping_charges}
                disabled={!isWithoutQuotation}
                onChange={(e) => setForm({ ...form, shiping_charges: e.target.value })}
              />
            </div>
            {!isWithoutQuotation ? (
              <div className="lg:col-span-2">
                <label className="text-xs font-medium text-gray-600">Quotation Number</label>
                <input readOnly className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm" value={quotationNumber} />
              </div>
            ) : null}
          </div>

          {form.customer_id ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5">
              <BillingAddressPanel billing={billingAddress} gstNumber={form.GST_number} />
              {isWithoutQuotation ? (
                <ShippingAddressPanel
                  shippingAddresses={shippingAddresses}
                  selectedIndex={shippingIndex}
                  onSelectIndex={setShippingIndex}
                  onAddClick={() => setShowShippingModal(true)}
                  selectedAddress={selectedShipping}
                />
              ) : (
                <ShippingAddressPanel
                  shippingAddresses={shippingAddresses}
                  selectedIndex={0}
                  onSelectIndex={() => {}}
                  onAddClick={() => {}}
                  selectedAddress={selectedShipping}
                  readOnly
                />
              )}
            </div>
          ) : null}
        </div>

        {showAssets ? (
          <AssetDetailsForm
            lines={lines}
            onChange={setLines}
            quotationType={form.quotation_type}
            useCascadeApi
          />
        ) : null}

        {error ? <p className="text-red-600 text-sm">{error}</p> : null}

        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap justify-end gap-3">
          <Link to="/operation-management/sales-orders" className="px-5 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || !form.customer_id}
            className="px-5 py-2 bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50 hover:bg-teal-800"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>

      {isWithoutQuotation ? (
        <ShippingAddressModal
          open={showShippingModal}
          onClose={() => setShowShippingModal(false)}
          onSubmit={handleSaveShipping}
          saving={savingShipping}
        />
      ) : null}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import AssetDetailsForm, { emptyLineItem, lineItemsToPayload } from '../../operation-management/components/AssetDetailsForm';
import { BillingAddressPanel, ShippingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';
import { branchForQuotationType } from '../../operation-management/utils/quotationHelpers';
import { INDIAN_STATES, slugifyState } from '../../../constants/indianStates';
import {
  createQuotation, getCustomerAddresses, getCustomerDetail, getQuotationMeta, updateQuotationStatus,
} from '../salesPipelineApi';
import { formatCurrency, sumLines } from '../salesPipelineUtils';

const DEFAULT_TERMS = 'Payment terms as agreed. Goods remain property of Rentfoxxy until full payment.';

function getField(obj, snake, camel) {
  if (!obj) return '';
  const val = obj[snake] ?? obj[camel];
  if (val && typeof val === 'object' && val.address) return val.address;
  return val || '';
}

function buildBillingAddress(customer) {
  if (!customer) return null;
  if (customer.billing_address && typeof customer.billing_address === 'object') {
    return {
      ...customer.billing_address,
      gst_number: customer.billing_address.gst_number
        || getField(customer, 'gst_no', 'gstNo')
        || getField(customer, 'gst_number', 'gstNumber'),
    };
  }
  return {
    name: customer.name || customer.company_name || customer.companyName || 'N/A',
    phone: customer.phone || customer.customer_number || 'N/A',
    country: 'India',
    state: getField(customer, 'billing_state', 'billingState') || 'N/A',
    city: getField(customer, 'billing_city', 'billingCity') || 'N/A',
    zip_code: getField(customer, 'billing_pincode', 'billingPincode') || 'N/A',
    gst_number: getField(customer, 'gst_no', 'gstNo') || getField(customer, 'gst_number', 'gstNumber') || 'N/A',
    address: getField(customer, 'billing_address', 'billingAddress') || 'N/A',
  };
}

const emptyManualShipping = () => ({
  name: '', phone: '', country: 'India', state: '', city: '', zip_code: '', address: '',
});

export default function QuotationForm({ open, onClose, onSaved, initialCustomerId, prefill = {} }) {
  const [meta, setMeta] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [billingAddress, setBillingAddress] = useState(null);
  const [shippingOptions, setShippingOptions] = useState([]);
  const [selectedShippingValue, setSelectedShippingValue] = useState('');
  const [manualShipping, setManualShipping] = useState(emptyManualShipping());
  const [lines, setLines] = useState([emptyLineItem()]);
  const [saving, setSaving] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [form, setForm] = useState({
    customer_id: '', supply_state: slugifyState('Haryana'), quotation_type: 'rental',
    branch: 'rentfoxxy', security_type: 'none', security_amount: '', shiping_charges: '', GST_number: '',
    customer_mobile: '', email: '', customer_name: '', remarks: '', terms: DEFAULT_TERMS,
    validity_date: '', source_lead_id: '',
  });

  useEffect(() => {
    if (!open) return;
    getQuotationMeta().then((res) => {
      const data = res.data;
      setMeta(data);
      setCustomers(data.customers || []);
      const valid = new Date(); valid.setDate(valid.getDate() + 7);
      setForm((f) => ({ ...f, validity_date: valid.toISOString().slice(0, 10), customer_id: initialCustomerId || f.customer_id }));
    }).catch(() => toast.error('Failed to load form'));
  }, [open, initialCustomerId]);

  const loadCustomerDetail = async (customerId) => {
    if (!customerId) {
      setCustomerDetail(null);
      setBillingAddress(null);
      setShippingOptions([]);
      setSelectedShippingValue('');
      return;
    }
    try {
      const [custRes, addrRes] = await Promise.all([
        getCustomerDetail(customerId),
        getCustomerAddresses(customerId),
      ]);
      const customer = custRes.data?.customer || custRes.data;
      const billing = buildBillingAddress(customer);
      const savedAddresses = addrRes.data?.addresses || customer.saved_addresses || [];
      const options = [];

      options.push({
        label: 'Same as billing address',
        value: 'billing',
        address: billing,
      });

      const shippingSame = customer.shipping_same ?? customer.shippingSame ?? true;
      if (!shippingSame && getField(customer, 'shipping_address', 'shippingAddress')) {
        options.push({
          label: 'Customer shipping address',
          value: 'customer_shipping',
          address: {
            name: customer.name || customer.customer_name,
            phone: customer.phone || customer.customer_number,
            country: 'India',
            state: getField(customer, 'shipping_state', 'shippingState'),
            city: getField(customer, 'shipping_city', 'shippingCity'),
            zip_code: getField(customer, 'shipping_pincode', 'shippingPincode'),
            address: getField(customer, 'shipping_address', 'shippingAddress'),
          },
        });
      }

      savedAddresses.forEach((addr, i) => {
        options.push({
          label: `${addr.concern_person || 'Address'} — ${addr.address}, ${addr.pincode || ''}`,
          value: `saved_${addr.customer_address_id || i}`,
          address: {
            name: addr.concern_person || customer.name || customer.customer_name,
            phone: addr.mobile_no || customer.phone,
            country: 'India',
            state: addr.state || '',
            city: addr.city || '',
            zip_code: addr.pincode || '',
            address: addr.address || '',
          },
        });
      });

      options.push({
        label: '+ Enter address manually',
        value: 'manual',
        address: null,
      });

      setCustomerDetail(customer);
      setBillingAddress(billing);
      setShippingOptions(options);
      setSelectedShippingValue('billing');
      setManualShipping({
        name: customer.name || customer.customer_name || '',
        phone: customer.phone || customer.customer_number || '',
        country: 'India',
        state: '',
        city: '',
        zip_code: '',
        address: '',
      });
    } catch {
      toast.error('Failed to load customer addresses');
    }
  };

  const onCustomerChange = async (customerId) => {
    const customer = customers.find((c) => String(c.customer_id) === String(customerId));
    setForm((prev) => ({
      ...prev,
      customer_id: customerId,
      customer_name: customer?.company_name || customer?.name || '',
      email: customer?.email || '',
      customer_mobile: customer?.phone || '',
      GST_number: customer?.gst_no || '',
    }));
    setSendEmail(customer?.email || '');
    await loadCustomerDetail(customerId);
  };

  const selectedShippingAddress = useMemo(() => {
    if (selectedShippingValue === 'manual') {
      if (!manualShipping.address?.trim()) return null;
      return manualShipping;
    }
    const opt = shippingOptions.find((o) => o.value === selectedShippingValue);
    return opt?.address || null;
  }, [selectedShippingValue, shippingOptions, manualShipping]);

  useEffect(() => {
    if (initialCustomerId && customers.length) onCustomerChange(initialCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId, customers.length]);

  useEffect(() => {
    if (!open || !prefill || !Object.keys(prefill).length) return;
    if (prefill.customer_id) {
      setForm((f) => ({ ...f, customer_id: String(prefill.customer_id) }));
    }
    if (prefill.quotation_type) {
      setForm((f) => ({
        ...f,
        quotation_type: prefill.quotation_type,
        branch: branchForQuotationType(prefill.quotation_type),
      }));
    }
    if (prefill.lead_id) {
      setForm((f) => ({ ...f, source_lead_id: prefill.lead_id }));
    }
    if (prefill.email) setForm((f) => ({ ...f, email: prefill.email }));
    if (prefill.customer_name) setForm((f) => ({ ...f, customer_name: prefill.customer_name }));
    if (prefill.line_items?.length) {
      setLines(prefill.line_items.map((item) => ({
        ...emptyLineItem(),
        ...item,
        model_name: item.model_name || item.model || '',
      })));
    }
  }, [open, prefill]);

  useEffect(() => {
    if (prefill?.customer_id && customers.length) {
      onCustomerChange(String(prefill.customer_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.customer_id, customers.length]);

  const onTypeChange = (quotationType) => {
    setForm((prev) => ({
      ...prev,
      quotation_type: quotationType,
      branch: branchForQuotationType(quotationType),
    }));
  };

  const totalValue = sumLines(lines);
  const security = form.security_type === 'one_month_rental' ? totalValue : (Number(form.security_amount) || 0);
  const isSaleType = form.quotation_type === 'sale' || form.quotation_type === 'sales';

  const submit = async (andSend) => {
    if (!selectedShippingAddress) {
      toast.error('Select a shipping address');
      return;
    }
    if (!billingAddress) {
      toast.error('Billing address is missing');
      return;
    }
    setSaving(true);
    try {
      const res = await createQuotation({
        quotation_number: meta?.quotation_number,
        ...form,
        security_amount: security,
        source_lead_id: form.source_lead_id || prefill.lead_id || null,
        ...lineItemsToPayload(lines),
        customer_shipping_address: selectedShippingAddress,
        customer_billing_address: billingAddress,
      });
      const qn = res.data?.quotation_number || meta?.quotation_number;
      if (andSend && qn) {
        await updateQuotationStatus(qn, { status: 'sent', email: sendEmail, cc: ccEmail });
        toast.success('Quotation saved and sent');
      } else {
        toast.success('Quotation saved as draft');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-[600px] bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold text-gray-900">Create Quotation</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Customer *</label>
              <select className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.customer_id} onChange={(e) => onCustomerChange(e.target.value)}>
                <option value="">Select customer</option>
                {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.company_name || c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Type *</label>
              <select className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.quotation_type} onChange={(e) => onTypeChange(e.target.value)}>
                <option value="rental">Rental</option>
                <option value="sale">Sale</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Validity Date</label>
              <input type="date" className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.validity_date} onChange={(e) => setForm((f) => ({ ...f, validity_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Supply State</label>
              <select className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.supply_state} onChange={(e) => setForm((f) => ({ ...f, supply_state: e.target.value }))}>
                {INDIAN_STATES.map((s) => <option key={s} value={slugifyState(s)}>{s}</option>)}
              </select>
            </div>
          </div>

          <AssetDetailsForm lines={lines} onChange={setLines} catalog={meta?.catalog} quotationType={form.quotation_type} />

          {!isSaleType && (
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Security Deposit</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="qsec" checked={form.security_type === 'none'}
                  onChange={() => setForm((f) => ({ ...f, security_type: 'none' }))} />
                No Security
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="qsec" checked={form.security_type === 'one_month_rental'}
                  onChange={() => setForm((f) => ({ ...f, security_type: 'one_month_rental' }))} />
                1 Month Rental as Security
                {form.security_type === 'one_month_rental' && (
                  <span className="ml-auto font-semibold text-blue-700">{formatCurrency(security)}</span>
                )}
              </label>
              <p className="text-[11px] text-gray-400">Auto-calculated from each laptop&apos;s monthly rate × quantity.</p>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-600">Shipping Charges (₹)</label>
            <input type="number" className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.shiping_charges} onChange={(e) => setForm((f) => ({ ...f, shiping_charges: e.target.value }))} />
          </div>
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Remarks" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} placeholder="Terms & Conditions" value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} />

          {customerDetail && billingAddress && (
            <div className="grid grid-cols-1 gap-3">
              <BillingAddressPanel billing={billingAddress} gstNumber={form.GST_number || billingAddress.gst_number} />
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="p-2 border-b bg-gray-50">
                  <label className="text-xs font-medium text-gray-600">Shipping Address *</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                    value={selectedShippingValue}
                    onChange={(e) => setSelectedShippingValue(e.target.value)}
                  >
                    <option value="">Please Select</option>
                    {shippingOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {selectedShippingValue === 'manual' && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-b bg-gray-50/50">
                    {[
                      ['name', 'Name'], ['phone', 'Phone'], ['city', 'City'],
                      ['state', 'State'], ['zip_code', 'Pincode'],
                    ].map(([k, label]) => (
                      <div key={k}>
                        <label className="text-xs text-gray-500">{label}</label>
                        <input
                          className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
                          value={manualShipping[k]}
                          onChange={(e) => setManualShipping((m) => ({ ...m, [k]: e.target.value }))}
                        />
                      </div>
                    ))}
                    <div className="sm:col-span-2">
                      <label className="text-xs text-gray-500">Address</label>
                      <textarea
                        className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
                        rows={2}
                        value={manualShipping.address}
                        onChange={(e) => setManualShipping((m) => ({ ...m, address: e.target.value }))}
                      />
                    </div>
                  </div>
                )}
                <div className="p-4">
                  <ShippingAddressPanel
                    readOnly
                    selectedAddress={selectedShippingAddress}
                    shippingAddresses={[]}
                    selectedIndex={-1}
                    onSelectIndex={() => {}}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="border-t pt-4 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Send Options</p>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Send to email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="CC (comma-separated)" value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} />
          </div>
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50">Cancel</button>
          <button type="button" disabled={saving} onClick={() => submit(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Draft
          </button>
          <button type="button" disabled={saving} onClick={() => submit(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save & Send'}
          </button>
        </div>
      </aside>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import AssetDetailsForm, { emptyLineItem, lineItemsToPayload } from '../../operation-management/components/AssetDetailsForm';
import { BillingAddressPanel, ShippingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';
import { branchForQuotationType } from '../../operation-management/utils/quotationHelpers';
import { INDIAN_STATES, slugifyState } from '../../../constants/indianStates';
import {
  createSalesOrder, getCustomerAddresses, getCustomerDetail, getQuotation, getSalesOrderMeta, listQuotations,
} from '../salesPipelineApi';
import { formatCurrency, sumLines } from '../salesPipelineUtils';

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

function parseAddress(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function linesFromQuote(quoteLines) {
  return (quoteLines || []).map((l) => ({
    brand: l.brand || '',
    model_name: l.model_name || l.model || '',
    processor: l.processor || '',
    generation: l.generation || '',
    ram: l.ram || '',
    storage: l.storage || '',
    gpu: l.gpu || '',
    screen_size: l.screen_size || '',
    quantity: l.quantity || 1,
    rate: l.rate || '',
    locking_period: l.locking_period || '',
    technical_warranty: l.technical_warranty || '',
    battery_charger_warranty: l.battery_charger_warranty || '',
  }));
}

export default function SalesOrderForm({ open, onClose, onSaved, prefillQuotation }) {
  const [meta, setMeta] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [fromQuote, setFromQuote] = useState(Boolean(prefillQuotation));
  const [lines, setLines] = useState([emptyLineItem()]);
  const [saving, setSaving] = useState(false);
  const [advanceRequired, setAdvanceRequired] = useState(false);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [billingAddress, setBillingAddress] = useState(null);
  const [shippingOptions, setShippingOptions] = useState([]);
  const [selectedShippingValue, setSelectedShippingValue] = useState('');
  const [manualShipping, setManualShipping] = useState(emptyManualShipping());
  const [form, setForm] = useState({
    customer_id: '', quotation_number: prefillQuotation || '', quotation_type: 'rental',
    branch: 'rentfoxxy', supply_state: slugifyState('Haryana'),
    security_type: 'none', security_amount: '', shiping_charges: '', remarks: '',
    advance_amount: '', advance_due_date: '', GST_number: '',
  });

  useEffect(() => {
    if (!open) return;
    getSalesOrderMeta().then((res) => {
      const data = res.data;
      setMeta(data);
      setCustomers(data.customers || []);
    });
    listQuotations({ status: 'approved', limit: 100 }).then((res) => {
      setQuotations(res.data?.quotations || []);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!prefillQuotation || !open) return;
    loadQuotation(prefillQuotation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQuotation, open]);

  const loadCustomerDetail = async (customerId, presetShipping = null) => {
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

      options.push({ label: 'Same as billing address', value: 'billing', address: billing });

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

      options.push({ label: '+ Enter address manually', value: 'manual', address: null });

      setCustomerDetail(customer);
      setBillingAddress(billing);
      setShippingOptions(options);

      if (presetShipping && presetShipping.address) {
        setManualShipping({ ...emptyManualShipping(), ...presetShipping });
        setSelectedShippingValue('manual');
      } else {
        setSelectedShippingValue('billing');
        setManualShipping({
          name: customer.name || customer.customer_name || '',
          phone: customer.phone || customer.customer_number || '',
          country: 'India', state: '', city: '', zip_code: '', address: '',
        });
      }
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
    await loadCustomerDetail(customerId);
  };

  const loadQuotation = async (qn) => {
    try {
      const res = await getQuotation(qn);
      const quoteLines = res.data?.lines || [];
      const head = quoteLines[0] || {};
      setLines(quoteLines.length ? linesFromQuote(quoteLines) : [emptyLineItem()]);
      setForm((f) => ({
        ...f,
        quotation_number: qn,
        customer_id: head.customer_id || f.customer_id,
        customer_name: head.customer_name || f.customer_name,
        quotation_type: head.quotation_type || 'rental',
        branch: head.branch || branchForQuotationType(head.quotation_type),
        supply_state: head.supply_state || f.supply_state,
        security_type: head.security_type || (Number(head.security_amount) > 0 ? 'one_month_rental' : 'none'),
        security_amount: head.security_amount || '',
        shiping_charges: head.shiping_charges || '',
        GST_number: head.gst_number || f.GST_number,
      }));
      if (head.customer_id) {
        await loadCustomerDetail(head.customer_id, parseAddress(head.customer_shipping_address));
      }
    } catch {
      toast.error('Failed to load quotation');
    }
  };

  const selectedShippingAddress = useMemo(() => {
    if (selectedShippingValue === 'manual') {
      if (!manualShipping.address?.trim()) return null;
      return manualShipping;
    }
    const opt = shippingOptions.find((o) => o.value === selectedShippingValue);
    return opt?.address || null;
  }, [selectedShippingValue, shippingOptions, manualShipping]);

  const totalValue = useMemo(() => sumLines(lines), [lines]);
  // '1 month rental' security = sum of each line's monthly rate x qty.
  const security = form.security_type === 'one_month_rental'
    ? totalValue
    : (Number(form.security_amount) || 0);
  const isSaleType = form.quotation_type === 'sale' || form.quotation_type === 'sales';
  const advance = advanceRequired ? (Number(form.advance_amount) || 0) : 0;
  const collectBeforeDispatch = totalValue + security + advance;

  const submit = async () => {
    if (!form.customer_id) {
      toast.error('Select a customer');
      return;
    }
    if (!selectedShippingAddress) {
      toast.error('Select a delivery (shipping) address');
      return;
    }
    setSaving(true);
    try {
      await createSalesOrder({
        sales_order_number: meta?.sales_order_number,
        ...form,
        security_amount: security,
        customer_shipping_address: selectedShippingAddress,
        customer_billing_address: billingAddress,
        ...lineItemsToPayload(lines),
      });
      toast.success('Sales order created');
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
          <h2 className="font-semibold text-gray-900">Create Sales Order</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fromQuote} onChange={(e) => setFromQuote(e.target.checked)} />
            Create from Quotation?
          </label>
          {fromQuote ? (
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.quotation_number}
              onChange={(e) => { setForm((f) => ({ ...f, quotation_number: e.target.value })); loadQuotation(e.target.value); }}
            >
              <option value="">Select quotation</option>
              {quotations.map((q) => <option key={q.quotation_number} value={q.quotation_number}>{q.quotation_number} — {q.customer_name}</option>)}
            </select>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Customer *</label>
              <select className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.customer_id} onChange={(e) => onCustomerChange(e.target.value)}>
                <option value="">Select</option>
                {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.company_name || c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Type *</label>
              <select className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.quotation_type} onChange={(e) => setForm((f) => ({ ...f, quotation_type: e.target.value, branch: branchForQuotationType(e.target.value) }))}>
                <option value="rental">Rental</option>
                <option value="sale">Sale</option>
              </select>
            </div>
          </div>
          <AssetDetailsForm lines={lines} onChange={setLines} catalog={meta?.catalog} quotationType={form.quotation_type} />
          {!isSaleType && (
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Security Deposit</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="sec" checked={form.security_type === 'none'}
                  onChange={() => setForm((f) => ({ ...f, security_type: 'none' }))} />
                No Security
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="sec" checked={form.security_type === 'one_month_rental'}
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
            <input type="number" placeholder="Shipping Charges (₹)" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.shiping_charges} onChange={(e) => setForm((f) => ({ ...f, shiping_charges: e.target.value }))} />
          </div>
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.supply_state} onChange={(e) => setForm((f) => ({ ...f, supply_state: e.target.value }))}>
            {INDIAN_STATES.map((s) => <option key={s} value={slugifyState(s)}>{s}</option>)}
          </select>

          {customerDetail && billingAddress && (
            <div className="grid grid-cols-1 gap-3">
              <BillingAddressPanel billing={billingAddress} gstNumber={form.GST_number || billingAddress.gst_number} />
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="p-2 border-b bg-gray-50">
                  <label className="text-xs font-medium text-gray-600">Delivery / Shipping Address *</label>
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

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={advanceRequired} onChange={(e) => setAdvanceRequired(e.target.checked)} />
            Advance Required?
          </label>
          {advanceRequired && (
            <div className="grid grid-cols-2 gap-3">
              <input type="number" placeholder="Advance Amount" className="border rounded-lg px-3 py-2 text-sm" value={form.advance_amount} onChange={(e) => setForm((f) => ({ ...f, advance_amount: e.target.value }))} />
              <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={form.advance_due_date} onChange={(e) => setForm((f) => ({ ...f, advance_due_date: e.target.value }))} />
            </div>
          )}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm space-y-1">
            <p>Total Order Value: <strong>{formatCurrency(totalValue)}</strong></p>
            <p>Security Deposit: <strong>{formatCurrency(security)}</strong></p>
            {advanceRequired && <p>Advance Required: <strong>{formatCurrency(advance)}</strong></p>}
            <p className="text-blue-800 font-medium">Total to collect before dispatch: {formatCurrency(collectBeforeDispatch)}</p>
          </div>
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" disabled={saving} onClick={submit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create SO</button>
        </div>
      </aside>
    </div>
  );
}

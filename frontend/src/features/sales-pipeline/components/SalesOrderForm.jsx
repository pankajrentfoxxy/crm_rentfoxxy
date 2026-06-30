import React, { useEffect, useMemo, useState } from 'react';
import { X, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import AssetDetailsForm, { emptyLineItem, lineItemsToPayload } from '../../operation-management/components/AssetDetailsForm';
import { BillingAddressPanel, ShippingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';
import { branchForQuotationType } from '../../operation-management/utils/quotationHelpers';
import {
  createSalesOrder, getCustomerAddresses, getCustomerDetail, getQuotation, getSalesOrderMeta, listQuotations,
} from '../salesPipelineApi';
import {
  formatCurrency, sumLines, formatConfig, lineTotal, typeLabel, countLaptops,
  computeGstBreakdown, resolveSupplyStateFromShipping, formatSupplyStateLabel,
} from '../salesPipelineUtils';

function getField(obj, snake, camel) {
  if (!obj) return '';
  const val = obj[snake] ?? obj[camel];
  if (val && typeof val === 'object' && val.address) return val.address;
  return val || '';
}

function customerDisplayName(customer) {
  if (!customer) return 'N/A';
  return customer.company_name || customer.companyName || customer.name || customer.customer_name || 'N/A';
}

function buildBillingAddress(customer) {
  if (!customer) return null;
  const displayName = customerDisplayName(customer);
  if (customer.billing_address && typeof customer.billing_address === 'object') {
    return {
      ...customer.billing_address,
      name: displayName,
      gst_number: customer.billing_address.gst_number
        || getField(customer, 'gst_no', 'gstNo')
        || getField(customer, 'gst_number', 'gstNumber'),
    };
  }
  return {
    name: displayName,
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

const SO_ASSET_REQUIRED_FIELDS = ['processor', 'generation', 'ram', 'storage'];

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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [advanceRequired, setAdvanceRequired] = useState(false);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [billingAddress, setBillingAddress] = useState(null);
  const [shippingOptions, setShippingOptions] = useState([]);
  const [selectedShippingValue, setSelectedShippingValue] = useState('');
  const [manualShipping, setManualShipping] = useState(emptyManualShipping());
  const [form, setForm] = useState({
    customer_id: '', customer_name: '', quotation_number: prefillQuotation || '', quotation_type: 'rental',
    branch: 'rentfoxxy',
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
  const shippingCharges = Number(form.shiping_charges) || 0;
  // '1 month rental' security = sum of each line's monthly rate x qty.
  const security = form.security_type === 'one_month_rental'
    ? totalValue
    : (Number(form.security_amount) || 0);
  const supplyState = useMemo(
    () => resolveSupplyStateFromShipping(selectedShippingAddress),
    [selectedShippingAddress]
  );
  const gstTotals = useMemo(() => computeGstBreakdown({
    subtotal: totalValue,
    shipping: shippingCharges,
    security,
    supplyState,
  }), [totalValue, shippingCharges, security, supplyState]);
  const isSaleType = form.quotation_type === 'sale' || form.quotation_type === 'sales';
  const advance = advanceRequired ? (Number(form.advance_amount) || 0) : 0;
  const collectBeforeDispatch = gstTotals.grand_total + (advanceRequired ? advance : 0);

  const submit = async () => {
    if (!form.customer_id) {
      toast.error('Select a customer');
      return;
    }
    if (!selectedShippingAddress) {
      toast.error('Select a delivery (shipping) address');
      return;
    }
    const invalidLine = lines.find((line) =>
      SO_ASSET_REQUIRED_FIELDS.some((field) => !String(line[field] || '').trim())
    );
    if (invalidLine) {
      toast.error('Each asset line requires processor, generation, RAM, and storage');
      return;
    }
    setSaving(true);
    try {
      await createSalesOrder({
        sales_order_number: meta?.sales_order_number,
        ...form,
        supply_state: supplyState,
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
                <option value="demo">Demo</option>
                <option value="sale">Sale</option>
              </select>
            </div>
          </div>
          <AssetDetailsForm
            lines={lines}
            onChange={setLines}
            catalog={meta?.catalog}
            quotationType={form.quotation_type}
            requiredFields={SO_ASSET_REQUIRED_FIELDS}
          />
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
            <p>Subtotal: <strong>{formatCurrency(gstTotals.subtotal)}</strong></p>
            {gstTotals.gst_type === 'inter' ? (
              <p>IGST ({gstTotals.gst_rate}%): <strong>{formatCurrency(gstTotals.igst)}</strong></p>
            ) : (
              <>
                <p>CGST ({gstTotals.gst_rate / 2}%): <strong>{formatCurrency(gstTotals.cgst)}</strong></p>
                <p>SGST ({gstTotals.gst_rate / 2}%): <strong>{formatCurrency(gstTotals.sgst)}</strong></p>
              </>
            )}
            {shippingCharges > 0 && <p>Shipping: <strong>{formatCurrency(shippingCharges)}</strong></p>}
            <p>Security Deposit: <strong>{formatCurrency(security)}</strong></p>
            {advanceRequired && <p>Advance Required: <strong>{formatCurrency(advance)}</strong></p>}
            <p className="text-blue-800 font-medium">Grand Total: {formatCurrency(gstTotals.grand_total + (advanceRequired ? advance : 0))}</p>
            {selectedShippingAddress?.state ? (
              <p className="text-[11px] text-gray-500 pt-1">
                GST for shipping state: {formatSupplyStateLabel(supplyState)}
                {gstTotals.gst_type === 'inter' ? ' (IGST 18%)' : ' (CGST 9% + SGST 9%)'}
              </p>
            ) : (
              <p className="text-[11px] text-amber-700 pt-1">Select a shipping address to apply GST.</p>
            )}
          </div>
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="px-4 py-2 text-sm border rounded-lg disabled:opacity-50">Cancel</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setPreviewOpen(true)}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Eye className="w-4 h-4" /> Preview
          </button>
          <button type="button" disabled={saving} onClick={submit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Create SO</button>
        </div>
      </aside>

      {previewOpen && (
        <SalesOrderPreview
          onClose={() => setPreviewOpen(false)}
          soNumber={meta?.sales_order_number}
          form={form}
          lines={lines}
          billingAddress={billingAddress}
          shippingAddress={selectedShippingAddress}
          security={security}
          advance={advance}
          advanceRequired={advanceRequired}
          collectBeforeDispatch={collectBeforeDispatch}
          gstTotals={gstTotals}
          supplyState={supplyState}
          fromQuote={fromQuote}
          isSaleType={isSaleType}
        />
      )}
    </div>
  );
}

function PreviewAddress({ title, addr, gstNumber }) {
  return (
    <div className="border rounded-lg p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</p>
      {addr ? (
        <div className="text-sm text-gray-700 space-y-0.5">
          {addr.name ? <p className="font-medium text-gray-900">{addr.name}</p> : null}
          {addr.address ? <p>{addr.address}</p> : null}
          <p>
            {[addr.city, addr.state, addr.zip_code].filter(Boolean).join(', ')}
            {addr.country ? `, ${addr.country}` : ''}
          </p>
          {addr.phone ? <p>Phone: {addr.phone}</p> : null}
          {gstNumber || addr.gst_number ? <p>GSTIN: {gstNumber || addr.gst_number}</p> : null}
        </div>
      ) : (
        <p className="text-sm text-gray-400">Not selected</p>
      )}
    </div>
  );
}

function SalesOrderPreview({
  onClose, soNumber, form, lines, billingAddress, shippingAddress, security, advance,
  advanceRequired, collectBeforeDispatch, gstTotals, supplyState, fromQuote, isSaleType,
}) {
  const subtotal = sumLines(lines);
  const shipping = Number(form.shiping_charges) || 0;
  const showSecurity = !isSaleType && security > 0;
  const validLines = (lines || []).filter((l) => l.brand || l.model_name || l.model || Number(l.quantity) > 0);
  const totals = gstTotals || computeGstBreakdown({
    subtotal, shipping, security, supplyState: resolveSupplyStateFromShipping(shippingAddress),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close preview" />
      <div className="relative bg-white w-full max-w-3xl max-h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3 shrink-0">
          <h3 className="font-semibold text-gray-900">Sales Order Preview</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Rentfoxxy</h2>
              <p className="text-xs text-gray-500 mt-0.5">{typeLabel(form.quotation_type)} Sales Order</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold text-gray-900">{soNumber || 'Draft'}</p>
              {fromQuote && form.quotation_number ? (
                <p className="text-gray-500">From: {form.quotation_number}</p>
              ) : null}
              <p className="text-gray-500">Supply state: {formatSupplyStateLabel(supplyState || resolveSupplyStateFromShipping(shippingAddress))}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PreviewAddress
              title="Bill To"
              addr={billingAddress ? { ...billingAddress, name: form.customer_name || billingAddress.name } : null}
              gstNumber={form.GST_number}
            />
            <PreviewAddress title="Ship To" addr={shippingAddress} />
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">#</th>
                  <th className="text-left px-3 py-2 font-semibold">Configuration</th>
                  <th className="text-right px-3 py-2 font-semibold">Qty</th>
                  <th className="text-right px-3 py-2 font-semibold">{isSaleType ? 'Unit Price' : 'Monthly Rate'}</th>
                  <th className="text-right px-3 py-2 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {validLines.length ? validLines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2 text-gray-800">{formatConfig(l) || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity) || 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.rate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(lineTotal(l))}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No items added</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full sm:w-72 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal{isSaleType ? '' : ' (monthly)'}</span>
                <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
              </div>
              {totals.gst_type === 'inter' ? (
                <div className="flex justify-between">
                  <span className="text-gray-600">IGST ({totals.gst_rate}%)</span>
                  <span className="tabular-nums">{formatCurrency(totals.igst)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">CGST ({totals.gst_rate / 2}%)</span>
                    <span className="tabular-nums">{formatCurrency(totals.cgst)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">SGST ({totals.gst_rate / 2}%)</span>
                    <span className="tabular-nums">{formatCurrency(totals.sgst)}</span>
                  </div>
                </>
              )}
              {showSecurity ? (
                <div className="flex justify-between">
                  <span className="text-gray-600">Security Deposit</span>
                  <span className="tabular-nums">{formatCurrency(security)}</span>
                </div>
              ) : null}
              {advanceRequired && advance > 0 ? (
                <div className="flex justify-between">
                  <span className="text-gray-600">Advance Required</span>
                  <span className="tabular-nums">{formatCurrency(advance)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-gray-600">Shipping Charges</span>
                <span className="tabular-nums">{formatCurrency(shipping)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold text-blue-800">
                <span>Grand Total</span>
                <span className="tabular-nums">{formatCurrency(totals.grand_total + (advanceRequired ? advance : 0))}</span>
              </div>
              <p className="text-[11px] text-gray-400 pt-1">
                {countLaptops(lines)} unit(s){isSaleType ? '' : ' · monthly rental + security & advance as applicable'}.
                GST based on shipping state{shippingAddress?.state ? `: ${shippingAddress.state}` : ''}.
              </p>
            </div>
          </div>

          {form.remarks ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Remarks</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.remarks}</p>
            </div>
          ) : null}
        </div>

        <div className="border-t px-5 py-3 shrink-0 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}

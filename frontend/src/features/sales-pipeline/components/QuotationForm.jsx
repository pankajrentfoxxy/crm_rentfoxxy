import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import AssetDetailsForm, { emptyLineItem, lineItemsToPayload } from '../../operation-management/components/AssetDetailsForm';
import { BillingAddressPanel, ShippingAddressPanel } from '../../operation-management/components/CustomerAddressPanels';
import ShippingAddressModal from '../../operation-management/components/ShippingAddressModal';
import { branchForQuotationType } from '../../operation-management/utils/quotationHelpers';
import { INDIAN_STATES, slugifyState } from '../../../constants/indianStates';
import { createQuotation, getQuotationMeta, saveCustomerShippingAddress, updateQuotationStatus } from '../salesPipelineApi';

const DEFAULT_TERMS = 'Payment terms as agreed. Goods remain property of Rentfoxxy until full payment.';

export default function QuotationForm({ open, onClose, onSaved, initialCustomerId }) {
  const [meta, setMeta] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [lines, setLines] = useState([emptyLineItem()]);
  const [shippingIndex, setShippingIndex] = useState(-1);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [savingShipping, setSavingShipping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [form, setForm] = useState({
    customer_id: '', supply_state: slugifyState('Haryana'), quotation_type: 'rental',
    branch: 'rentfoxxy', security_amount: '', shiping_charges: '', GST_number: '',
    customer_mobile: '', email: '', customer_name: '', remarks: '', terms: DEFAULT_TERMS,
    validity_date: '',
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

  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.customer_id) === String(form.customer_id)),
    [customers, form.customer_id]
  );

  const selectedShipping = shippingIndex >= 0 ? selectedCustomer?.shipping_addresses?.[shippingIndex] : null;

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
    setSendEmail(customer?.email || '');
    setShippingIndex(addresses.length ? addresses.length - 1 : -1);
  };

  useEffect(() => {
    if (initialCustomerId && customers.length) onCustomerChange(initialCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerId, customers.length]);

  const onTypeChange = (quotationType) => {
    setForm((prev) => ({
      ...prev,
      quotation_type: quotationType,
      branch: branchForQuotationType(quotationType),
    }));
  };

  const handleSaveShipping = async (payload) => {
    if (!form.customer_id) throw new Error('Select a customer first');
    setSavingShipping(true);
    try {
      const result = await saveCustomerShippingAddress(form.customer_id, payload);
      const updated = result.data?.customer || result.data;
      setCustomers((prev) => prev.map((c) => (c.customer_id === updated.customer_id ? updated : c)));
      setShippingIndex((updated.shipping_addresses?.length || 1) - 1);
    } finally {
      setSavingShipping(false);
    }
  };

  const submit = async (andSend) => {
    if (!selectedShipping) {
      toast.error('Select a shipping address');
      return;
    }
    setSaving(true);
    try {
      const res = await createQuotation({
        quotation_number: meta?.quotation_number,
        ...form,
        ...lineItemsToPayload(lines),
        customer_shipping_address: selectedShipping,
        customer_billing_address: selectedCustomer?.billing_address || { address: selectedCustomer?.address || '' },
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
                {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}
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

          <AssetDetailsForm lines={lines} onChange={setLines} catalog={meta} quotationType={form.quotation_type} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Security Amount (₹)</label>
              <input type="number" className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.security_amount} onChange={(e) => setForm((f) => ({ ...f, security_amount: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Shipping Charges (₹)</label>
              <input type="number" className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.shiping_charges} onChange={(e) => setForm((f) => ({ ...f, shiping_charges: e.target.value }))} />
            </div>
          </div>
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Remarks" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} placeholder="Terms & Conditions" value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} />

          {selectedCustomer && (
            <div className="grid grid-cols-1 gap-3">
              <BillingAddressPanel address={selectedCustomer.billing_address || { address: selectedCustomer.address }} />
              <ShippingAddressPanel
                addresses={selectedCustomer.shipping_addresses || []}
                selectedIndex={shippingIndex}
                onSelect={setShippingIndex}
                onAdd={() => setShowShippingModal(true)}
              />
            </div>
          )}

          <div className="border-t pt-4 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Send Options</p>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Send to email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="CC (comma-separated)" value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} />
          </div>
        </div>
        <div className="border-t p-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button type="button" disabled={saving} onClick={() => submit(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Save Draft</button>
          <button type="button" disabled={saving} onClick={() => submit(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save & Send</button>
        </div>
        {showShippingModal && (
          <ShippingAddressModal onClose={() => setShowShippingModal(false)} onSave={handleSaveShipping} saving={savingShipping} />
        )}
      </aside>
    </div>
  );
}

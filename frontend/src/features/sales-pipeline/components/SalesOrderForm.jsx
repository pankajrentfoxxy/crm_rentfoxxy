import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import AssetDetailsForm, { emptyLineItem, lineItemsToPayload } from '../../operation-management/components/AssetDetailsForm';
import { branchForQuotationType } from '../../operation-management/utils/quotationHelpers';
import { INDIAN_STATES, slugifyState } from '../../../constants/indianStates';
import { createSalesOrder, getQuotation, getSalesOrderMeta, listQuotations } from '../salesPipelineApi';
import { formatCurrency, sumLines } from '../salesPipelineUtils';

function linesFromQuote(quoteLines) {
  return (quoteLines || []).map((l) => ({
    brand: l.brand || '',
    model_name: l.model_name || l.model || '',
    processor: l.processor || '',
    generation: l.generation || '',
    ram: l.ram || '',
    storage: l.storage || '',
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
  const [form, setForm] = useState({
    customer_id: '', quotation_number: prefillQuotation || '', quotation_type: 'rental',
    branch: 'rentfoxxy', supply_state: slugifyState('Haryana'),
    security_amount: '', shiping_charges: '', remarks: '',
    advance_amount: '', advance_due_date: '',
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
        quotation_type: head.quotation_type || 'rental',
        branch: head.branch || branchForQuotationType(head.quotation_type),
        supply_state: head.supply_state || f.supply_state,
        security_amount: head.security_amount || '',
        shiping_charges: head.shiping_charges || '',
      }));
    } catch {
      toast.error('Failed to load quotation');
    }
  };

  const totalValue = useMemo(() => sumLines(lines), [lines]);
  const security = Number(form.security_amount) || 0;
  const advance = advanceRequired ? (Number(form.advance_amount) || 0) : 0;
  const collectBeforeDispatch = totalValue + security + advance;

  const submit = async () => {
    if (!form.customer_id) {
      toast.error('Select a customer');
      return;
    }
    setSaving(true);
    try {
      await createSalesOrder({
        sales_order_number: meta?.sales_order_number,
        ...form,
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
              <select className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}>
                <option value="">Select</option>
                {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}
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
          <AssetDetailsForm lines={lines} onChange={setLines} catalog={meta} quotationType={form.quotation_type} />
          <div className="grid grid-cols-2 gap-3">
            <input type="number" placeholder="Security Deposit (₹)" className="border rounded-lg px-3 py-2 text-sm" value={form.security_amount} onChange={(e) => setForm((f) => ({ ...f, security_amount: e.target.value }))} />
            <input type="number" placeholder="Shipping Charges (₹)" className="border rounded-lg px-3 py-2 text-sm" value={form.shiping_charges} onChange={(e) => setForm((f) => ({ ...f, shiping_charges: e.target.value }))} />
          </div>
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.supply_state} onChange={(e) => setForm((f) => ({ ...f, supply_state: e.target.value }))}>
            {INDIAN_STATES.map((s) => <option key={s} value={slugifyState(s)}>{s}</option>)}
          </select>
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

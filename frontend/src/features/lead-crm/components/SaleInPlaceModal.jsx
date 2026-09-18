import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, AlertTriangle, Loader2, CheckCircle2, ArrowLeft, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  SALE_IN_PLACE_REASONS, fetchSaleInPlacePrefill, createSaleInPlaceOrder,
} from '../../../utils/saleInPlaceApi';
import { getCustomerLaptops } from '../leadCrmApi';
import { INDIAN_STATES, matchIndianState } from '../../../constants/indianStates';
import { applyPincodeAutofill } from '../../../utils/pincodeLookup';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import {
  computeGstBreakdown, resolveSupplyStateFromShipping, formatSupplyStateLabel,
} from '../../sales-pipeline/salesPipelineUtils';
import { salesOrderDetailPath } from '../../sales-pipeline/salesOrderScope';

/** Local YYYY-MM-DD — never toISOString(), which shifts the day in IST. */
function todayYmd() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const reasonLabel = (r) => SALE_IN_PLACE_REASONS.find((x) => x.value === r)?.label || r;
const configLine = (l) => [l.processor, l.generation, l.ram, l.storage].filter(Boolean).join(' · ');

const emptyAddress = () => ({
  name: '', phone: '', country: 'India', address: '', city: '', state: '', zip_code: '',
});

function withStateName(addr) {
  if (!addr) return emptyAddress();
  return { ...emptyAddress(), ...addr, state: matchIndianState(addr.state) || addr.state || '' };
}

function AddressFields({ title, value, setValue, hint }) {
  const set = (key) => (e) => setValue((a) => ({ ...a, [key]: e.target.value }));
  const onPin = (e) => {
    const raw = e.target.value;
    setValue((a) => ({ ...a, zip_code: raw.replace(/\D/g, '').slice(0, 6) }));
    if (raw.replace(/\D/g, '').length === 6) {
      applyPincodeAutofill(raw, setValue, { pinKey: 'zip_code', cityKey: 'city', stateKey: 'state' });
    }
  };
  const input = 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm';
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block text-xs text-slate-600">Name
          <input className={input} value={value.name} onChange={set('name')} />
        </label>
        <label className="block text-xs text-slate-600">Phone
          <input className={input} value={value.phone} onChange={set('phone')} />
        </label>
      </div>
      <label className="block text-xs text-slate-600">Address *
        <textarea className={input} rows={2} value={value.address} onChange={set('address')} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block text-xs text-slate-600">Pincode
          <input className={input} value={value.zip_code} onChange={onPin} inputMode="numeric" />
        </label>
        <label className="block text-xs text-slate-600">City
          <input className={input} value={value.city} onChange={set('city')} />
        </label>
        <label className="block text-xs text-slate-600">State *
          <select className={input} value={value.state} onChange={set('state')}>
            <option value="">Select…</option>
            {value.state && !INDIAN_STATES.includes(value.state) && (
              <option value={value.state}>{value.state}</option>
            )}
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

/**
 * Customer keeps laptops they hold on rent (lost, damaged or bought out).
 *
 * Step 1 picks the laptops and the date rent stops. Step 2 is the sale order:
 * billing and shipping address (prefilled from the customer and the address each
 * laptop was delivered to) and a sale price per laptop. Submitting stops rent,
 * raises the credit note for unused prepaid days, creates the Sale SO in
 * "sale in place" mode (no DC, no e-way bill) and sells every laptop we own on
 * the spot. Vendor-rented laptops are sold once their vendor buyout is recorded.
 */
export default function SaleInPlaceModal({ open, customerId, canOpenSaleOrder = true, onClose, onDone }) {
  const [step, setStep] = useState('select');
  const [laptops, setLaptops] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);
  const [selected, setSelected] = useState(() => new Map());
  const [reason, setReason] = useState('lost');
  const [reportedOn, setReportedOn] = useState(todayYmd());
  const [notes, setNotes] = useState('');

  const [prefill, setPrefill] = useState(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [billing, setBilling] = useState(emptyAddress());
  const [shipping, setShipping] = useState(emptyAddress());
  const [shipChoice, setShipChoice] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [prices, setPrices] = useState({});
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep('select');
    setSelected(new Map());
    setReason('lost');
    setReportedOn(todayYmd());
    setNotes('');
    setSearchInput('');
    setPrefill(null);
    setPrices({});
    setRemark('');
    setResult(null);
  }, [open]);

  const loadLaptops = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await getCustomerLaptops(customerId, {
        lifecycle: 'active', page: 1, limit: 100, status: 'rented', search: search || undefined,
      });
      setLaptops(res.data?.data || []);
    } catch {
      toast.error('Could not load the laptops on rent');
    } finally {
      setListLoading(false);
    }
  }, [customerId, search]);

  useEffect(() => {
    if (open && step === 'select') loadLaptops();
  }, [open, step, loadLaptops]);

  // A laptop already on a sale-in-place order is finished here; one whose rent was
  // stopped earlier without an order is still selectable and keeps that stop date.
  const rows = useMemo(() => laptops
    .filter((a) => String(a.status || '').toLowerCase() === 'rented')
    .map((a) => ({ ...a, onOrder: a.sale_in_place?.sales_order_number || null })), [laptops]);

  const toggle = (row) => {
    if (row.onOrder) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.serial_id)) next.delete(row.serial_id); else next.set(row.serial_id, row);
      return next;
    });
  };

  const monthlyStopped = [...selected.values()]
    .filter((a) => !a.sale_in_place)
    .reduce((sum, a) => sum + Number(a.rent_monthly_rate || 0), 0);

  const goToDetails = async () => {
    if (!selected.size) { toast.error('Select at least one laptop'); return; }
    if (!reportedOn) { toast.error('Pick the date rent should stop'); return; }
    setPrefillLoading(true);
    try {
      const res = await fetchSaleInPlacePrefill(customerId, [...selected.keys()]);
      const data = res.data;
      const blocked = data.laptops.find((l) => l.blocker);
      if (blocked) {
        toast.error(`${blocked.ttspl_id}: ${blocked.blocker}`);
        return;
      }
      setPrefill(data);
      setBilling(withStateName(data.billing_address));
      const first = data.shipping_options[0];
      setShipChoice(first ? first.key : 'manual');
      setShipping(withStateName(first?.address));
      setGstNumber(data.customer.gst_number || '');
      setEmail(data.customer.email || '');
      setMobile(data.customer.phone || '');
      setStep('details');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load the sale order details');
    } finally {
      setPrefillLoading(false);
    }
  };

  const pickShipping = (key) => {
    setShipChoice(key);
    if (key === 'manual') { setShipping(emptyAddress()); return; }
    const opt = prefill?.shipping_options.find((o) => o.key === key);
    setShipping(withStateName(opt?.address));
  };

  const subtotal = (prefill?.laptops || []).reduce((s, l) => s + (Number(prices[l.serial_id]) || 0), 0);
  const supplyState = resolveSupplyStateFromShipping(shipping);
  const gst = computeGstBreakdown({ subtotal, supplyState });
  const vendorUnits = (prefill?.laptops || []).filter((l) => l.vendor_rented);

  const submit = async () => {
    const missing = prefill.laptops.find((l) => !(Number(prices[l.serial_id]) > 0));
    if (missing) { toast.error(`Enter a sale price for ${missing.ttspl_id}`); return; }
    if (!billing.address.trim() || !billing.state) { toast.error('Billing address and state are required'); return; }
    if (!shipping.address.trim() || !shipping.state) {
      toast.error('Shipping address and state are required — the state decides CGST+SGST vs IGST');
      return;
    }
    const ok = window.confirm(
      `Stop rent and create a sale order for ${prefill.laptops.length} laptop(s), total ${money(gst.grand_total)} incl. GST?\n\n`
      + 'No delivery challan or e-way bill will be produced. Laptops we own become Sold immediately; '
      + 'this cannot be undone from the CRM.'
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await createSaleInPlaceOrder(customerId, {
        serial_ids: prefill.laptops.map((l) => l.serial_id),
        reason,
        reported_on: reportedOn,
        notes: notes.trim() || null,
        prices: Object.fromEntries(prefill.laptops.map((l) => [l.serial_id, Number(prices[l.serial_id])])),
        customer_billing_address: { ...billing, gst_number: gstNumber },
        customer_shipping_address: shipping,
        gst_number: gstNumber || null,
        customer_email: email || null,
        customer_mobile: mobile || null,
        remark: remark.trim() || null,
      });
      toast.success(res.message || 'Sales order created');
      setResult(res.data);
      setStep('done');
      onDone?.(res.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not create the sales order');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const title = step === 'select'
    ? 'Report lost / damaged / buyout'
    : step === 'details' ? 'Sale order for the laptops' : 'Sale order created';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'select' && 'Step 1 of 2 — choose the laptops the customer keeps and when rent stops.'}
              {step === 'details' && 'Step 2 of 2 — addresses and sale price. The laptops stay with the customer.'}
              {step === 'done' && 'Rent stopped and the sale is recorded. No delivery challan, no e-way bill.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {step === 'select' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Reason</span>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {SALE_IN_PLACE_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Stop rent from</span>
                <input
                  type="date"
                  value={reportedOn}
                  max={todayYmd()}
                  onChange={(e) => setReportedOn(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-slate-600">Laptops on rent ({rows.length})</span>
                {selected.size > 0 && (
                  <span className="text-xs text-slate-500">
                    {selected.size} selected{monthlyStopped > 0 ? ` — ${money(monthlyStopped)}/month stops` : ''}
                  </span>
                )}
              </div>
              <div className="relative mb-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search TTSPL, serial, model…"
                  className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-sm"
                />
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {listLoading && (
                  <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                )}
                {!listLoading && rows.length === 0 && (
                  <p className="px-3 py-4 text-sm text-slate-500">No laptops currently on rent with this customer.</p>
                )}
                {!listLoading && rows.map((a) => (
                  <label
                    key={a.serial_id}
                    className={`flex items-center gap-3 px-3 py-2 ${a.onOrder ? 'opacity-60 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(a.serial_id)}
                      disabled={Boolean(a.onOrder)}
                      onChange={() => toggle(a)}
                      className="rounded border-slate-300"
                    />
                    <span className="font-mono text-sm text-slate-800">{a.ttspl_id || a.serial_number}</span>
                    <span className="text-xs text-slate-500 flex-1 truncate">
                      {[a.brand, a.model_name].filter(Boolean).join(' ')} {configLine(a) ? `· ${configLine(a)}` : ''}
                    </span>
                    {a.onOrder ? (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">On {a.onOrder}</span>
                    ) : a.sale_in_place ? (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                        Rent already stopped
                      </span>
                    ) : null}
                    <span className="text-xs text-slate-600 w-24 text-right">{money(a.rent_monthly_rate)}/mo</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                A laptop whose rent was stopped earlier keeps its original stop date and credit note.
              </p>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-slate-600">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Reference, who confirmed it, claim number…"
              />
            </label>
          </div>
        )}

        {step === 'details' && prefill && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="sm:col-span-4 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{prefill.customer.name}</span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-purple-100 text-purple-700">Gorefurbo · Sale in place</span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700">{reasonLabel(reason)}</span>
                <span className="text-[11px] text-slate-500">Rent stops {reportedOn}</span>
              </div>
              <label className="block text-xs text-slate-600">GST number
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono" value={gstNumber} onChange={(e) => setGstNumber(e.target.value.toUpperCase())} />
              </label>
              <label className="block text-xs text-slate-600">Email
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block text-xs text-slate-600 sm:col-span-2">Mobile
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm" value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </label>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <AddressFields title="Billing address" value={billing} setValue={setBilling} hint="From the customer profile." />
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600">Shipping address (place of supply)
                  <select
                    value={shipChoice}
                    onChange={(e) => pickShipping(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {prefill.shipping_options.map((o) => (
                      <option key={o.key} value={o.key}>{o.label} — {o.address.address.slice(0, 60)}</option>
                    ))}
                    <option value="manual">Enter address manually</option>
                  </select>
                </label>
                <AddressFields
                  title="Ship to"
                  value={shipping}
                  setValue={setShipping}
                  hint="Where the laptops were delivered. Each laptop's own delivered address is also kept on its SO line."
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 text-left">
                  <tr>
                    <th className="p-2">TTSPL</th>
                    <th className="p-2">Laptop</th>
                    <th className="p-2">Ownership</th>
                    <th className="p-2">Rent / month</th>
                    <th className="p-2">Rent stops</th>
                    <th className="p-2 w-40">Sale price (₹, ex-GST) *</th>
                  </tr>
                </thead>
                <tbody>
                  {prefill.laptops.map((l) => (
                    <tr key={l.serial_id} className="border-t border-slate-100">
                      <td className="p-2 font-mono text-xs">{l.ttspl_id}</td>
                      <td className="p-2 text-xs">
                        <div className="text-slate-800">{[l.brand, l.model_name].filter(Boolean).join(' ') || '—'}</div>
                        <div className="text-slate-500">{configLine(l) || '—'}</div>
                      </td>
                      <td className="p-2 text-xs">
                        {l.vendor_rented ? (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800" title="We rent this laptop from a vendor">
                            Vendor: {l.vendor_name || 'rented'} — buyout needed
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Owned</span>
                        )}
                      </td>
                      <td className="p-2 text-xs">{money(l.rent_monthly_rate)}</td>
                      <td className="p-2 text-xs">{l.open_case?.rent_stopped_on || reportedOn}</td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={prices[l.serial_id] ?? ''}
                          onChange={(e) => setPrices((p) => ({ ...p, [l.serial_id]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Remark on the sale order (optional)</span>
                <textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <div className="rounded-lg border border-slate-200 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{money(gst.subtotal)}</span></div>
                {gst.gst_type === 'inter' ? (
                  <div className="flex justify-between"><span className="text-slate-500">IGST ({gst.gst_rate}%)</span><span>{money(gst.igst)}</span></div>
                ) : (
                  <>
                    <div className="flex justify-between"><span className="text-slate-500">CGST ({gst.gst_rate / 2}%)</span><span>{money(gst.cgst)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">SGST ({gst.gst_rate / 2}%)</span><span>{money(gst.sgst)}</span></div>
                  </>
                )}
                <div className="flex justify-between font-semibold border-t border-slate-100 pt-1"><span>Total</span><span>{money(gst.grand_total)}</span></div>
                <p className="text-[11px] text-slate-500">Place of supply: {formatSupplyStateLabel(supplyState)}</p>
              </div>
            </div>

            <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 space-y-1">
                <p>
                  On submit: rent stops, a credit note is raised for the unused prepaid days, and a Sale order
                  is created with these laptops attached. No delivery challan and no e-way bill are produced.
                </p>
                <p>Laptops we own become <strong>Sold</strong> immediately and move to the customer&apos;s Purchased tab.</p>
                {vendorUnits.length > 0 && (
                  <p>
                    <strong>{vendorUnits.map((l) => l.ttspl_id).join(', ')}</strong> {vendorUnits.length === 1 ? 'is' : 'are'} rented
                    from a vendor: vendor rent stops now, Procurement is notified, and the sale completes automatically when
                    the vendor buyout bill is recorded.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-semibold">Sales order {result.sales_order_number} created</span>
            </div>
            {result.sold.length > 0 && (
              <p>
                <strong>Sold now</strong> (moved to Purchased): {result.sold.map((i) => i.ttspl_id).join(', ')}
              </p>
            )}
            {result.awaiting_vendor_buyout.length > 0 && (
              <p className="text-amber-800">
                <strong>Waiting for vendor buyout:</strong> {result.awaiting_vendor_buyout.map((i) => i.ttspl_id).join(', ')}.
                {' '}Rent is stopped. Use <em>Record vendor buyout</em> on the Active tab once the vendor&apos;s bill arrives.
              </p>
            )}
            {result.rent_stopped.some((r) => r.credit_note_number) && (
              <p>
                Credit note for unused prepaid rent:{' '}
                {[...new Set(result.rent_stopped.map((r) => r.credit_note_number).filter(Boolean))].join(', ')}
              </p>
            )}
            <p className="text-slate-500 text-xs">
              Next: Accounts raise the invoice in Zoho and attach it under Finance → Sale Invoice Queue.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100">
          <div>
            {step === 'details' && (
              <button type="button" onClick={() => setStep('select')} className="inline-flex items-center gap-1 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step !== 'done' && (
              <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancel
              </button>
            )}
            {step === 'select' && (
              <button
                type="button"
                onClick={goToDetails}
                disabled={prefillLoading || !selected.size}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {prefillLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Stop rent {selected.size ? `for ${selected.size}` : ''} → Sale order
              </button>
            )}
            {step === 'details' && (
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Stop rent &amp; create sale order
              </button>
            )}
            {step === 'done' && result && (
              <>
                {canOpenSaleOrder && (
                  <Link
                    to={salesOrderDetailPath(result.sales_order_number, 'sale')}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    Open sales order
                  </Link>
                )}
                <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white">
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

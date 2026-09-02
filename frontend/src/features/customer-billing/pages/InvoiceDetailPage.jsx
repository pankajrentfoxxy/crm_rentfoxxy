import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarRange, CheckCircle2, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import InvoiceStatusBadge from '../components/InvoiceStatusBadge';
import SendInvoiceModal from '../components/SendInvoiceModal';
import { Button, SearchField, StatCard } from '../../../components/ui/primitives';
import {
  downloadInvoicePdf, generateEWayBill,
  getInvoice, markInvoicePaid,
} from '../customerBillingApi';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatInvoiceDate(d) {
  if (!d) return '—';
  const s = String(d);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const [y, mo, day] = m[1].split('-').map(Number);
    return new Date(y, mo - 1, day).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return s;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isCatchupLine(line) {
  return line?.is_catchup === true || line?.is_catchup === 'true';
}

function isFullBilledLine(line) {
  if (isCatchupLine(line)) return false;
  const days = Number(line?.days_in_month);
  const monthDays = Number(line?.month_days);
  if (!Number.isFinite(days) || !Number.isFinite(monthDays) || monthDays <= 0) return true;
  return days >= monthDays;
}

function formatSpecLine(line) {
  const tidy = (v) => {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    return !s || s === '-' || s === '—' ? '' : s;
  };
  const ramRaw = tidy(line.ram);
  const ram = ramRaw && /^\d+(\.\d+)?$/.test(ramRaw) ? `${ramRaw}GB` : ramRaw;
  return [tidy(line.processor), tidy(line.generation), ram, tidy(line.storage)].filter(Boolean).join(' · ');
}

function itemTitle(line) {
  const brand = String(line.brand || '').trim();
  const model = String(line.model || '').trim();
  if (brand && model && !model.toLowerCase().startsWith(brand.toLowerCase())) {
    return `${brand} ${model}`;
  }
  return model || brand || '—';
}

function lineMatchesSearch(line, q) {
  if (!q) return true;
  const hay = [
    line.ttspl_id,
    line.serial_number,
    line.brand,
    line.model,
    line.processor,
    line.generation,
    line.ram,
    line.storage,
    line.dc_number,
    line.period,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return hay.includes(q);
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [creditNotes, setCreditNotes] = useState([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewbForm, setEwbForm] = useState({ transporter_name: '', vehicle_number: '', distance_km: '', mode_of_transport: 'road' });
  const [lineFilter, setLineFilter] = useState('all'); // all | full | previous
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getInvoice(id);
      setInvoice(res.data?.invoice);
      setCreditNotes(res.data?.credit_notes || []);
    } catch {
      toast.error('Invoice not found');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const lineItems = useMemo(() => {
    if (!invoice) return [];
    const raw = typeof invoice.line_items === 'string'
      ? JSON.parse(invoice.line_items)
      : (invoice.line_items || []);
    return Array.isArray(raw) ? raw : [];
  }, [invoice]);

  const counts = useMemo(() => {
    const fullUnits = new Set();
    const previousUnits = new Set();
    let fullLines = 0;
    let previousLines = 0;
    for (const line of lineItems) {
      const key = line.ttspl_id || line.serial_number || line.serial_id;
      if (isCatchupLine(line)) {
        previousLines += 1;
        if (key) previousUnits.add(String(key));
      } else if (isFullBilledLine(line)) {
        fullLines += 1;
        if (key) fullUnits.add(String(key));
      }
    }
    return {
      allLines: lineItems.length,
      fullUnits: fullUnits.size,
      fullLines,
      previousUnits: previousUnits.size,
      previousLines,
    };
  }, [lineItems]);

  const filteredLines = useMemo(() => {
    return lineItems.filter((line) => {
      if (lineFilter === 'full' && !isFullBilledLine(line)) return false;
      if (lineFilter === 'previous' && !isCatchupLine(line)) return false;
      return lineMatchesSearch(line, searchDebounced);
    });
  }, [lineItems, lineFilter, searchDebounced]);

  const appliedNotes = useMemo(
    () => creditNotes.filter((cn) => String(cn.status || '').toLowerCase() === 'applied'),
    [creditNotes]
  );

  if (!invoice) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }

  const handleDownload = async () => {
    try {
      const res = await downloadInvoicePdf(id, { format: 'laptop_details' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number}-document.pdf`;
      a.click();
    } catch {
      toast.error('PDF download failed');
    }
  };

  const handleMarkPaid = async () => {
    const ref = window.prompt('Payment reference:');
    try {
      await markInvoicePaid(id, { payment_reference: ref || '' });
      toast.success('Marked paid');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  const handleGenerateEwb = async () => {
    const dc = lineItems[0]?.dc_number;
    if (!dc) {
      toast.error('No DC linked to this invoice');
      return;
    }
    try {
      const res = await generateEWayBill(dc, ewbForm);
      toast.success(`EWB: ${res.data.ewbNumber}`);
      setEwbOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'EWB failed');
    }
  };

  const filterHint = lineFilter === 'full'
    ? 'Full-month billed lines'
    : lineFilter === 'previous'
      ? 'Previous-month / catch-up lines'
      : 'All line items';

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link to="/customer-billing/invoices" className="text-sm text-blue-600 hover:underline">← Invoices</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{invoice.invoice_number}</h1>
          <p className="text-sm text-gray-500">{invoice.customer_name} · {formatInvoiceDate(invoice.from_date)} – {formatInvoiceDate(invoice.to_date)}</p>
          <div className="mt-2"><InvoiceStatusBadge status={invoice.status} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PermissionGate section="customer_billing" action="edit">
            <Button onClick={() => setSendOpen(true)}>Send to Customer</Button>
          </PermissionGate>
          <Button variant="secondary" onClick={handleDownload}>Laptop Rental Document PDF</Button>
          <PermissionGate section="customer_billing" action="edit">
            <Button variant="secondary" onClick={handleMarkPaid}>Mark as Paid</Button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="All lines"
          value={counts.allLines}
          hint={lineFilter === 'all' ? 'Showing all' : 'Click to show all'}
          icon={Layers}
          tone={lineFilter === 'all' ? 'blue' : 'gray'}
          onClick={() => setLineFilter('all')}
        />
        <StatCard
          label="Full billed"
          value={counts.fullUnits}
          hint={`${counts.fullLines} line(s) · full month`}
          icon={CheckCircle2}
          tone={lineFilter === 'full' ? 'green' : 'gray'}
          onClick={() => setLineFilter((f) => (f === 'full' ? 'all' : 'full'))}
        />
        <StatCard
          label="Previous month start"
          value={counts.previousUnits}
          hint={`${counts.previousLines} catch-up line(s)`}
          icon={CalendarRange}
          tone={lineFilter === 'previous' ? 'amber' : 'gray'}
          onClick={() => setLineFilter((f) => (f === 'previous' ? 'all' : 'previous'))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search TTSPL, serial, brand, model, specs…"
          className="max-w-lg"
        />
        {lineFilter !== 'all' && (
          <button
            type="button"
            onClick={() => setLineFilter('all')}
            className="text-xs px-3 py-2 border rounded-lg text-slate-600 hover:bg-slate-50"
          >
            Clear filter
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">
          Showing {filteredLines.length} of {lineItems.length} · {filterHint}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid gap-3 sm:hidden">
            {filteredLines.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">No lines match this filter/search.</p>
            ) : filteredLines.map((line, idx) => (
              <div key={`${line.ttspl_id || 'line'}-${line.period || ''}-${idx}`} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{line.ttspl_id || '—'}</span>
                  <span className="font-semibold text-slate-900">{fmt(line.amount)}</span>
                </div>
                {line.serial_number && <p className="text-xs text-slate-500">SN: {line.serial_number}</p>}
                <p className="text-sm text-slate-700">{itemTitle(line)}</p>
                {formatSpecLine(line) && <p className="text-xs text-slate-500">{formatSpecLine(line)}</p>}
                <p className="text-xs text-slate-500">{formatInvoiceDate(line.rent_start)} → {formatInvoiceDate(line.rent_end)}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{line.days_in_month}{line.month_days ? `/${line.month_days}` : ''} days</span>
                  <span>{fmt(line.daily_rate)}/day</span>
                  {isCatchupLine(line) && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">catch-up</span>}
                  {line.returned && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">returned</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">TTSPL / Serial</th>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-right">Days</th>
                  <th className="px-4 py-3 text-right">Daily Rate</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No lines match this filter/search.
                    </td>
                  </tr>
                ) : filteredLines.map((line, idx) => (
                  <tr key={`${line.ttspl_id || 'line'}-${line.period || ''}-${idx}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{line.ttspl_id || '—'}</div>
                      {line.serial_number && (
                        <div className="text-xs text-gray-500">SN: {line.serial_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{itemTitle(line)}</div>
                      {formatSpecLine(line) && (
                        <div className="text-xs text-gray-500 mt-0.5">{formatSpecLine(line)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div>{formatInvoiceDate(line.rent_start)} → {formatInvoiceDate(line.rent_end)}</div>
                      {isCatchupLine(line) && (
                        <span className="inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">catch-up</span>
                      )}
                      {line.returned && (
                        <span className="inline-block mt-0.5 ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">returned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{line.days_in_month}{line.month_days ? `/${line.month_days}` : ''}</td>
                    <td className="px-4 py-3 text-right">{fmt(line.daily_rate)}</td>
                    <td className="px-4 py-3 text-right">{fmt(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm space-y-1 max-w-sm ml-auto">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(invoice.subtotal)}</span></div>
            <div className="flex justify-between"><span>GST {invoice.gst_percent}%</span><span>{fmt(invoice.gst_amount)}</span></div>
            {parseFloat(invoice.credit_note_adjustment) > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Credit Notes{appliedNotes.length ? ` (${appliedNotes.map((c) => c.credit_note_number).join(', ')})` : ''}</span>
                <span>-{fmt(invoice.credit_note_adjustment)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base border-t pt-2"><span>Grand Total</span><span>{fmt(invoice.grand_total)}</span></div>
            {invoice.paid_at && (
              <p className="text-green-700 text-xs pt-2">Paid {invoice.paid_at?.slice(0, 10)} · Ref: {invoice.payment_reference || '—'}</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">Customer</h3>
            <p className="font-medium">{invoice.customer_name}</p>
            <p className="text-gray-500">{invoice.gst_number || 'No GST'}</p>
            <p className="text-gray-500 mt-2">{typeof invoice.billing_address === 'object' ? JSON.stringify(invoice.billing_address) : (invoice.billing_address || '—')}</p>
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">Credit note activity</h3>
            {creditNotes.length ? (
              <ul className="space-y-2">
                {creditNotes.map((cn) => {
                  const status = String(cn.status || '').toLowerCase();
                  const label = status === 'pending' ? 'Draft' : cn.status;
                  const inTotal = status === 'applied';
                  return (
                    <li key={cn.credit_note_number} className="flex justify-between gap-3">
                      <span>
                        <span className="font-medium">{cn.credit_note_number}</span>
                        <span className="text-gray-500"> · {label}</span>
                        {status === 'pending' && (
                          <span className="block text-[11px] text-amber-700">Awaiting approval — not in total</span>
                        )}
                      </span>
                      <span className={inTotal ? 'text-red-600' : 'text-slate-400'}>
                        {inTotal ? '-' : ''}{fmt(cn.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-gray-500">No credit notes on this invoice</p>
            )}
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">E-Invoice</h3>
            <p>IRN: <span className="font-medium">{invoice.irn || 'Not generated'}</span></p>
            {invoice.qr_code_url && <img src={invoice.qr_code_url} alt="QR" className="mt-2 h-24 w-24 border rounded" />}
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">E-Way Bill</h3>
            <p>EWB#: {invoice.eway_bill_number || 'Not generated'}</p>
            {invoice.eway_bill_valid_till && <p className="text-gray-500">Valid till: {invoice.eway_bill_valid_till?.slice(0, 16)}</p>}
            <button type="button" onClick={() => setEwbOpen(true)} className="mt-3 px-3 py-1.5 text-xs border rounded-lg">Generate E-Way Bill</button>
          </div>
        </div>
      </div>

      {sendOpen && (
        <SendInvoiceModal invoice={invoice} onClose={() => setSendOpen(false)} onSent={load} />
      )}

      {ewbOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setEwbOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3 text-sm">
            <h3 className="font-semibold">Generate E-Way Bill</h3>
            <input placeholder="Transporter Name" value={ewbForm.transporter_name} onChange={(e) => setEwbForm((f) => ({ ...f, transporter_name: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Vehicle Number" value={ewbForm.vehicle_number} onChange={(e) => setEwbForm((f) => ({ ...f, vehicle_number: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <input placeholder="Distance (km)" type="number" value={ewbForm.distance_km} onChange={(e) => setEwbForm((f) => ({ ...f, distance_km: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            <select value={ewbForm.mode_of_transport} onChange={(e) => setEwbForm((f) => ({ ...f, mode_of_transport: e.target.value }))} className="w-full border rounded-lg px-3 py-2">
              <option value="road">Road</option>
              <option value="air">Air</option>
              <option value="rail">Rail</option>
              <option value="ship">Ship</option>
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEwbOpen(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="button" onClick={handleGenerateEwb} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Generate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Button, SearchField, StatCard } from '../../../components/ui/primitives';
import { approveCreditNote, creditNotePdfErrorMessage, downloadCreditNotePdf, getCreditNote } from '../customerBillingApi';

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  applied: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function creditNoteStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'Draft';
  if (s === 'approved') return 'Approved';
  if (s === 'applied') return 'Applied';
  if (s === 'cancelled') return 'Cancelled';
  return status || '—';
}

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
    line.return_dc_number,
    line.period,
  ].map((v) => String(v || '').toLowerCase()).join(' ');
  return hay.includes(q);
}

function parseLines(creditNote) {
  const raw = typeof creditNote?.line_items === 'string'
    ? (() => { try { return JSON.parse(creditNote.line_items); } catch { return []; } })()
    : (creditNote?.line_items || []);
  return Array.isArray(raw) ? raw : [];
}

function lineKey(line, idx) {
  const serialId = Number(line?.serial_id);
  if (Number.isFinite(serialId) && serialId > 0) return `s:${serialId}`;
  const ttspl = String(line?.ttspl_id || '').trim();
  if (ttspl) return `t:${ttspl}`;
  return `i:${idx}`;
}

function approvalLineKey(line) {
  const prefix = `${line?.credit_note_id}-`;
  const rowKey = String(line?.row_key || '');
  if (rowKey.startsWith(prefix)) return rowKey.slice(prefix.length);
  return lineKey(line, 0);
}

export default function CreditNoteDetailPage() {
  const { id } = useParams();
  const [creditNote, setCreditNote] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [approving, setApproving] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [approvedNotes, setApprovedNotes] = useState([]);
  const [pendingNotes, setPendingNotes] = useState([]);
  const [tab, setTab] = useState('pending');

  const load = useCallback(async () => {
    try {
      const res = await getCreditNote(id);
      const note = res.data?.credit_note || null;
      const approved = res.data?.approved_credit_notes || [];
      const pending = res.data?.pending_credit_notes || [];
      setCreditNote(note);
      setApprovedNotes(approved);
      setPendingNotes(pending);
      setSelected(new Set());
      const currentStatus = String(note?.status || '').toLowerCase();
      setTab((current) => {
        if (current === 'approved' && approved.length) return 'approved';
        if (currentStatus === 'pending' && pending.length) return 'pending';
        if (approved.length && !pending.length) return 'approved';
        return pending.length ? 'pending' : 'approved';
      });
    } catch {
      toast.error('Credit note not found');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const pendingLines = useMemo(
    () => pendingNotes.flatMap((note) => (
      (note.line_items || parseLines(note)).map((line, idx) => ({
        ...line,
        credit_note_id: note.credit_note_id,
        credit_note_number: note.credit_note_number,
        line_status: 'pending',
        row_key: `${note.credit_note_id}-${lineKey(line, idx)}`,
      }))
    )),
    [pendingNotes]
  );

  const approvedLines = useMemo(
    () => approvedNotes.flatMap((note) => (
      (note.line_items || parseLines(note)).map((line, idx) => ({
        ...line,
        credit_note_id: note.credit_note_id,
        credit_note_number: note.credit_note_number,
        line_status: note.status,
        row_key: `${note.credit_note_id}-${lineKey(line, idx)}`,
      }))
    )),
    [approvedNotes]
  );

  const tabLines = tab === 'approved' ? approvedLines : pendingLines;

  const filteredLines = useMemo(
    () => tabLines.filter((line) => lineMatchesSearch(line, searchDebounced)),
    [tabLines, searchDebounced]
  );

  const laptopCount = useMemo(
    () => pendingLines.length + approvedLines.length,
    [pendingLines, approvedLines]
  );

  const pendingAmount = useMemo(
    () => pendingLines.reduce((n, line) => n + Number(line.amount || 0), 0),
    [pendingLines]
  );

  const approvedAmount = useMemo(
    () => approvedLines.reduce((n, line) => n + Number(line.amount || 0), 0),
    [approvedLines]
  );

  const filteredKeys = useMemo(
    () => filteredLines
      .filter((line) => Number(line.credit_note_id) === Number(id))
      .map((line) => line.row_key),
    [filteredLines, id]
  );

  const selectedLines = useMemo(
    () => pendingLines.filter((line) => selected.has(line.row_key)),
    [pendingLines, selected]
  );

  const selectedAmount = useMemo(
    () => selectedLines.reduce((n, line) => n + Number(line.amount || 0), 0),
    [selectedLines]
  );

  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((key) => selected.has(key));

  const toggleLine = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredKeys.forEach((key) => next.delete(key));
        return next;
      }
      filteredKeys.forEach((key) => next.add(key));
      return next;
    });
  };

  if (!creditNote) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }

  const handleDownload = async (pdfId, pdfName) => {
    try {
      const res = await downloadCreditNotePdf(pdfId, { format: 'laptop_details' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pdfName || 'credit-note'}-document.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await creditNotePdfErrorMessage(err, 'PDF is available only for approved credit notes'));
    }
  };

  const handleApprove = async () => {
    const currentSelected = selectedLines.filter((line) => Number(line.credit_note_id) === Number(id));
    if (!currentSelected.length) {
      toast.error('Select at least one laptop to approve');
      return;
    }
    setApproving(true);
    try {
      const res = await approveCreditNote(id, {
        line_keys: currentSelected.map(approvalLineKey),
      });
      const approvedNumber = res.data?.credit_note?.credit_note_number;
      const leftover = res.data?.leftover_credit_note;
      if (res.data?.split && leftover) {
        toast.success(
          res.data?.applied
            ? `${currentSelected.length} laptop${currentSelected.length === 1 ? '' : 's'} approved as ${approvedNumber} and applied`
            : `${currentSelected.length} laptop${currentSelected.length === 1 ? '' : 's'} approved as ${approvedNumber}`
        );
      } else {
        toast.success(res.data?.applied
          ? 'Approved and applied to the invoice'
          : 'Approved — will apply when the invoice is ready');
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Approve failed');
    } finally {
      setApproving(false);
    }
  };

  const status = String(creditNote.status || '').toLowerCase();
  const canSelect = status === 'pending' && tab === 'pending';
  const billingAddress = typeof creditNote.billing_address === 'object'
    ? JSON.stringify(creditNote.billing_address)
    : (creditNote.billing_address || '—');

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link to="/customer-billing/credit-notes" className="text-sm text-blue-600 hover:underline">← Credit Notes</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{creditNote.credit_note_number}</h1>
          <p className="text-sm text-gray-500">
            {creditNote.customer_name}
            {' · '}
            {formatInvoiceDate(creditNote.from_date)} – {formatInvoiceDate(creditNote.to_date)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Total Quantity : {laptopCount}
            {pendingLines.length ? ` · ${pendingLines.length} pending` : ''}
            {approvedLines.length ? ` · ${approvedLines.length} approved` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-700'}`}>
              {creditNoteStatusLabel(status)}
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
              Credit Note
            </span>
            {creditNote.invoice_number && (
              <span className="text-xs text-slate-500">Applied in {creditNote.invoice_number}</span>
            )}
          </div>
          {creditNote.reason && <p className="text-sm text-slate-600 mt-2">{creditNote.reason}</p>}
          {canSelect && (
            <p className="text-xs text-slate-500 mt-2">
              Select the laptops you want to approve now. The rest stay on this draft.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(status === 'approved' || status === 'applied' || approvedNotes.length > 0) && (
            <Button
              variant="secondary"
              onClick={() => {
                const latest = approvedNotes[0];
                const pdfId = (status === 'approved' || status === 'applied')
                  ? creditNote.credit_note_id
                  : latest?.credit_note_id;
                const pdfName = (status === 'approved' || status === 'applied')
                  ? creditNote.credit_note_number
                  : latest?.credit_note_number;
                if (!pdfId) {
                  toast.error('Approve laptops first. The PDF only includes approved credit notes.');
                  return;
                }
                handleDownload(pdfId, pdfName);
              }}
            >
              Approved laptops PDF
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Pending"
          value={pendingLines.length}
          hint={pendingLines.length ? fmt(pendingAmount) : 'No draft laptops'}
          icon={Clock}
          tone={tab === 'pending' ? 'amber' : 'gray'}
          onClick={() => setTab('pending')}
        />
        <StatCard
          label="Approved"
          value={approvedLines.length}
          hint={approvedLines.length ? fmt(approvedAmount) : 'None approved yet'}
          icon={CheckCircle2}
          tone={tab === 'approved' ? 'green' : 'gray'}
          onClick={() => setTab('approved')}
        />
        {status === 'pending' && tab === 'pending' && (
          <StatCard
            label="Selected"
            value={selected.size}
            hint={selected.size ? fmt(selectedAmount) : 'Tick laptops to approve'}
            icon={Layers}
            tone={selected.size ? 'green' : 'gray'}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          <button
            type="button"
            className={`px-3 py-1.5 ${tab === 'pending' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
            onClick={() => setTab('pending')}
          >
            Pending ({pendingLines.length})
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 ${tab === 'approved' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}
            onClick={() => setTab('approved')}
          >
            Approved ({approvedLines.length})
          </button>
        </div>
        <SearchField
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search TTSPL, serial, brand, model, specs…"
          className="max-w-lg"
        />
        {canSelect && (
          <button
            type="button"
            onClick={toggleAllFiltered}
            className="text-sm text-blue-600 font-semibold hover:underline"
          >
            {allFilteredSelected ? 'Clear visible' : 'Select visible'}
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">
          Showing {filteredLines.length} {tab} laptop{filteredLines.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid gap-3 sm:hidden">
            {filteredLines.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-8">
                {tab === 'approved' ? 'No approved laptops yet.' : 'No pending laptops match this search.'}
              </p>
            ) : filteredLines.map((line) => {
              const key = line.row_key;
              const lineSelectable = canSelect && Number(line.credit_note_id) === Number(id);
              return (
              <div key={key} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 min-w-0">
                    {lineSelectable && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${line.ttspl_id || 'laptop'}`}
                        checked={selected.has(key)}
                        onChange={() => toggleLine(key)}
                      />
                    )}
                    <span className="font-medium text-slate-900">{line.ttspl_id || '—'}</span>
                  </label>
                  <span className="font-semibold text-slate-900">{fmt(line.amount)}</span>
                </div>
                {line.credit_note_number && tab === 'approved' && (
                  <p className="text-xs text-slate-500">{line.credit_note_number}</p>
                )}
                {line.serial_number && <p className="text-xs text-slate-500">SN: {line.serial_number}</p>}
                <p className="text-sm text-slate-700">{itemTitle(line)}</p>
                {formatSpecLine(line) && <p className="text-xs text-slate-500">{formatSpecLine(line)}</p>}
                <p className="text-xs text-slate-500">
                  {formatInvoiceDate(line.rent_start || line.from_date)} → {formatInvoiceDate(line.rent_end || line.to_date)}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{line.days_in_month || line.quantity || '—'}{line.month_days ? `/${line.month_days}` : ''} days</span>
                  <span>{fmt(line.daily_rate || line.unit_rate)}/day</span>
                  {line.returned && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">returned</span>}
                </div>
              </div>
              );
            })}
          </div>
          <div className="hidden sm:block bg-white border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  {canSelect && (
                    <th className="px-4 py-3 text-left w-10">
                      <input
                        type="checkbox"
                        aria-label="Select visible laptops"
                        checked={allFilteredSelected}
                        onChange={toggleAllFiltered}
                      />
                    </th>
                  )}
                  {tab === 'approved' && <th className="px-4 py-3 text-left">CN #</th>}
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
                    <td colSpan={canSelect ? (tab === 'approved' ? 8 : 7) : (tab === 'approved' ? 7 : 6)} className="px-4 py-8 text-center text-gray-500">
                      {tab === 'approved' ? 'No approved laptops yet.' : 'No pending laptops match this search.'}
                    </td>
                  </tr>
                ) : filteredLines.map((line) => {
                  const key = line.row_key;
                  const lineSelectable = canSelect && Number(line.credit_note_id) === Number(id);
                  return (
                  <tr key={key} className={selected.has(key) ? 'bg-blue-50/60' : ''}>
                    {canSelect && (
                      <td className="px-4 py-3">
                        {lineSelectable ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${line.ttspl_id || 'laptop'}`}
                            checked={selected.has(key)}
                            onChange={() => toggleLine(key)}
                          />
                        ) : null}
                      </td>
                    )}
                    {tab === 'approved' && (
                      <td className="px-4 py-3">
                        <Link to={`/customer-billing/credit-notes/${line.credit_note_id}`} className="text-blue-600 hover:underline font-medium">
                          {line.credit_note_number}
                        </Link>
                      </td>
                    )}
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
                      <div>
                        {formatInvoiceDate(line.rent_start || line.from_date)} → {formatInvoiceDate(line.rent_end || line.to_date)}
                      </div>
                      {line.returned && (
                        <span className="inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">returned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{line.days_in_month || line.quantity || '—'}{line.month_days ? `/${line.month_days}` : ''}</td>
                    <td className="px-4 py-3 text-right">{fmt(line.daily_rate || line.unit_rate)}</td>
                    <td className="px-4 py-3 text-right">{fmt(line.amount)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm space-y-1 max-w-sm ml-auto">
            <div className="flex justify-between">
              <span>{tab === 'approved' ? 'Approved subtotal' : 'Pending subtotal'}</span>
              <span>{fmt(tab === 'approved' ? approvedAmount : pendingAmount)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base border-t pt-2">
              <span>{tab === 'approved' ? 'Approved total' : 'Pending total'}</span>
              <span>{fmt(tab === 'approved' ? approvedAmount : pendingAmount)}</span>
            </div>
            <p className="text-xs text-slate-400 pt-1">Amounts exclude GST</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-5 text-sm">
            <h3 className="font-semibold mb-3">Customer</h3>
            <p className="font-medium">{creditNote.customer_name}</p>
            <p className="text-gray-500">{creditNote.gst_number || 'No GST'}</p>
            <p className="text-gray-500 mt-2">{billingAddress}</p>
          </div>
          <div className="bg-white border rounded-xl p-5 text-sm space-y-2">
            <h3 className="font-semibold mb-3">Credit note</h3>
            <p>Status: <span className="font-medium">{creditNoteStatusLabel(status)}</span></p>
            {creditNote.invoice_number && (
              <p>Invoice: <span className="font-medium">{creditNote.invoice_number}</span></p>
            )}
            {creditNote.return_dc_number && (
              <p>
                Return DC:{' '}
                <Link
                  to={`/sales-pipeline/return-dc?search=${encodeURIComponent(creditNote.return_dc_number)}`}
                  className="text-blue-600 hover:underline"
                >
                  {creditNote.return_dc_number}
                </Link>
              </p>
            )}
            {(creditNote.support_ticket_id || creditNote.return_ticket_id) && (
              <p>
                Support:{' '}
                <Link
                  to={`/support/tickets/${creditNote.support_ticket_id || creditNote.return_ticket_id}`}
                  className="text-blue-600 hover:underline"
                >
                  Ticket #{creditNote.support_ticket_id || creditNote.return_ticket_id}
                </Link>
              </p>
            )}
          </div>
          {approvedNotes.length > 0 && (
            <div className="bg-white border rounded-xl p-5 text-sm space-y-2">
              <h3 className="font-semibold mb-3">Approved credit notes</h3>
              <ul className="space-y-2">
                {approvedNotes.map((cn) => (
                  <li key={cn.credit_note_id} className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        to={`/customer-billing/credit-notes/${cn.credit_note_id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {cn.credit_note_number}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {creditNoteStatusLabel(cn.status)}
                        {cn.laptop_count ? ` · ${cn.laptop_count} laptop${cn.laptop_count === 1 ? '' : 's'}` : ''}
                        {' · '}{fmt(cn.amount)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownload(cn.credit_note_id, cn.credit_note_number)}
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      PDF
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {canSelect && selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-lg">
          <div className="text-sm">
            <span className="font-semibold">{selected.size} laptop{selected.size === 1 ? '' : 's'} selected</span>
            <span className="text-slate-300"> · {fmt(selectedAmount)}</span>
            {selected.size < pendingLines.length && (
              <span className="block text-slate-400 text-xs mt-0.5">
                {pendingLines.length - selected.size} will stay pending
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-slate-800 min-h-[40px]"
            >
              Clear selection
            </button>
            <PermissionGate section="credit_notes" action="edit">
              <Button variant="success" size="sm" loading={approving} onClick={handleApprove}>
                Approve selected
              </Button>
            </PermissionGate>
          </div>
        </div>
      )}
    </div>
  );
}

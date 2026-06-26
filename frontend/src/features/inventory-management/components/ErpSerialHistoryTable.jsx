import React, { useState } from 'react';
import { Mail, Phone, User } from 'lucide-react';

function StatusBadge({ type, ticketNumber }) {
  const t = String(type || '').toLowerCase();
  let cls = 'bg-emerald-100 text-emerald-800';
  if (t === 'out_ward' || t === 'pickuped') cls = 'bg-amber-100 text-amber-900';
  else if (t === 'pickup' || (t === 'complain' && ticketNumber)) cls = 'bg-yellow-100 text-yellow-900';
  else if (t === 'complain') cls = 'bg-slate-200 text-slate-800';
  else if (ticketNumber) cls = 'bg-red-100 text-red-800';

  const label = String(type || 'N/A').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${cls}`}>{label}</span>;
}

function PurposeBadge({ purpose }) {
  const p = String(purpose || 'N/A').toLowerCase();
  let cls = 'bg-red-50 text-red-700 border border-red-100';
  if (p === 'ticket closed' || p === 'repared') cls = 'bg-emerald-50 text-emerald-700 border border-emerald-100';
  else if (p === 'repairing') cls = 'bg-green-50 text-green-700 border border-green-100';
  else if (p === 'returned') cls = 'bg-amber-50 text-amber-800 border border-amber-100';

  const label = String(purpose || 'N/A').replace(/\b\w/g, (c) => c.toUpperCase());
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

function PartyCell({ party }) {
  if (!party?.name || party.name === 'NA') return <span className="text-slate-400">—</span>;
  return (
    <div className="text-xs space-y-1">
      <p className="font-semibold text-rose-700 capitalize flex items-center gap-1">
        <User className="w-3.5 h-3.5" />
        {party.name}
      </p>
      {party.email ? (
        <p className="text-slate-600 flex items-center gap-1">
          <Mail className="w-3 h-3" />
          {party.email}
        </p>
      ) : null}
      {party.phone ? (
        <p className="text-slate-600 flex items-center gap-1">
          <Phone className="w-3 h-3" />
          {party.phone}
        </p>
      ) : null}
    </div>
  );
}

function RemarksCell({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="text-slate-400">—</span>;
  const words = String(text).trim().split(/\s+/);
  if (words.length <= 2) return <span className="text-xs text-slate-700">{text}</span>;
  return (
    <div className="text-xs text-slate-700 max-w-[160px]">
      {open ? text : `${words.slice(0, 2).join(' ')}…`}
      <button type="button" onClick={() => setOpen((v) => !v)} className="ml-1 text-sky-600 hover:underline">
        {open ? 'Less' : 'Read More'}
      </button>
    </div>
  );
}

export default function ErpSerialHistoryTable({ rows, emptyMessage }) {
  if (!rows?.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        {emptyMessage || 'No migrated ERP history for this serial.'}
      </p>
    );
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-3 py-3">S.No</th>
            <th className="px-3 py-3">Date</th>
            <th className="px-3 py-3">S/N &amp; U/N</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Purpose</th>
            <th className="px-3 py-3">Vendor / Customer</th>
            <th className="px-3 py-3">Remarks</th>
            <th className="px-3 py-3">SLA</th>
            <th className="px-3 py-3">Ticket No.</th>
            <th className="px-3 py-3">Technician</th>
            <th className="px-3 py-3">Spare Parts S/N</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id || row.sno} className="border-t align-top hover:bg-slate-50/60">
              <td className="px-3 py-3 text-slate-600">{row.sno}</td>
              <td className="px-3 py-3">
                <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-900 whitespace-nowrap">
                  {row.date_display}
                </span>
              </td>
              <td className="px-3 py-3 font-mono text-xs">
                <div className="rounded bg-orange-50 text-orange-900 px-2 py-0.5 inline-block mb-1">{row.serial_number || '—'}</div>
                <div className="rounded bg-sky-50 text-sky-900 px-2 py-0.5 inline-block">{row.unique_number || '—'}</div>
              </td>
              <td className="px-3 py-3">
                <StatusBadge type={row.type} ticketNumber={row.ticket_number} />
              </td>
              <td className="px-3 py-3">
                <PurposeBadge purpose={row.purpose_display || row.purpose} />
              </td>
              <td className="px-3 py-3">
                <PartyCell party={row.party} />
              </td>
              <td className="px-3 py-3">
                <RemarksCell text={row.remarks} />
              </td>
              <td className="px-3 py-3 text-xs text-slate-700 whitespace-nowrap">
                {row.ticket_sla_display || (row.ticket_number ? '—' : 'N/A')}
              </td>
              <td className="px-3 py-3 text-xs font-mono">
                {row.ticket_number ? (
                  <span className="rounded bg-red-50 text-red-800 px-2 py-0.5">{row.ticket_number}</span>
                ) : (
                  'N/A'
                )}
              </td>
              <td className="px-3 py-3">
                {row.technician ? <PartyCell party={{ ...row.technician, kind: 'technician' }} /> : 'N/A'}
              </td>
              <td className="px-3 py-3 text-xs font-mono text-slate-700">
                {row.spare_parts_serials?.length
                  ? row.spare_parts_serials.map((s) => <div key={s}>{s}</div>)
                  : 'N/A'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

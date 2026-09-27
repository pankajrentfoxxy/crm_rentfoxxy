import React, { useMemo, useState } from 'react';
import { Building2, Copy, X, MapPin } from 'lucide-react';
import { formatItemId, formatRelative, formatAddress, initials } from '../utils';

const OTP_DONE = new Set(['resolved', 'closed', 'cancelled']);

export default function DetailSidebar({
  ticket,
  items,
  otpNote,
  mobileOpen,
  onCloseMobile,
  showLeadOtp,
  onPriorityChange
}) {
  const [prio, setPrio] = useState(ticket.priority || 'normal');

  // One OTP per laptop — a multi-laptop ticket used to show only the first one
  // (often an already-resolved unit). Open laptops first.
  const customerOtpItems = useMemo(
    () => items
      .filter((i) => i.item_type === 'complaint' && i.otp_code)
      .sort((a, b) => Number(OTP_DONE.has(a.status)) - Number(OTP_DONE.has(b.status))),
    [items]
  );

  const warehouseOtpItems = useMemo(
    () => items.filter((i) => i.item_type === 'pickup' && i.warehouse_otp_code),
    [items]
  );

  const techByAssignee = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!it.assigned_to) continue;
      const key = it.assigned_to;
      if (!m.has(key)) m.set(key, { name: it.assigned_to_name, items: [] });
      m.get(key).items.push(it);
    }
    return [...m.values()];
  }, [items]);

  const copyOtp = async (code) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(String(code));
    } catch {
      /* ignore */
    }
  };

  const content = (
    <div className="space-y-3 support-v3-sidebar">
      <section className="support-v3-card">
        <div className="flex items-center justify-between gap-2">
          <h3 className="support-v3-section-label"><Building2 className="w-3.5 h-3.5 inline mr-1" /> Customer</h3>
        </div>
        <p className="font-medium" style={{ color: 'var(--color-text-primary, #0f172a)' }}>{ticket.customer_name}</p>
        <p style={{ color: 'var(--color-text-secondary, #475569)' }}>{ticket.display_phone || ticket.customer_phone}</p>
        <p style={{ color: 'var(--color-text-tertiary, #64748b)' }}>{ticket.ticket_alt_phone || '—'}</p>
        <p style={{ color: 'var(--color-text-tertiary, #64748b)' }}>{ticket.ticket_email || '—'}</p>
        <p style={{ color: 'var(--color-text-secondary, #475569)' }}>{formatAddress(ticket.ticket_address)}</p>
      </section>

      {showLeadOtp && customerOtpItems.map((it) => {
        const done = OTP_DONE.has(it.status);
        return (
          <section key={it.id} className={`support-v3-otp-card${done ? ' opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="support-v3-section-label text-amber-900">
                  Customer OTP — {formatItemId(it.id)}{done ? ' · Resolved' : ''}
                </p>
                <p className="text-xs text-amber-900 truncate">
                  <span className="font-mono">{it.ttspl_id || it.unique_serial_number || it.serial_number || '—'}</span>
                  {[it.brand, it.model].filter(Boolean).length ? ` · ${[it.brand, it.model].filter(Boolean).join(' ')}` : ''}
                </p>
              </div>
              <button type="button" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center" onClick={() => copyOtp(it.otp_code)} aria-label={`Copy OTP for ${it.ttspl_id || formatItemId(it.id)}`}>
                <Copy className="w-4 h-4 text-amber-900" />
              </button>
            </div>
            <p className="font-mono text-2xl tracking-widest text-amber-950">{it.otp_code}</p>
            <p className="text-xs text-amber-900 mt-2">Share verbally · {otpNote}</p>
          </section>
        );
      })}

      {showLeadOtp && warehouseOtpItems.map((it) => (
        <section key={it.id} className="support-v3-otp-card support-v3-otp-warehouse">
          <div className="flex items-start justify-between gap-2">
            <p className="support-v3-section-label text-amber-900">Warehouse OTP — {formatItemId(it.id)}</p>
            <button type="button" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center" onClick={() => copyOtp(it.warehouse_otp_code)} aria-label="Copy warehouse OTP">
              <Copy className="w-4 h-4 text-amber-900" />
            </button>
          </div>
          <p className="font-mono text-2xl tracking-widest text-amber-950">{it.warehouse_otp_code}</p>
          <p className="text-xs text-amber-900 mt-2">Give this OTP to the technician when the laptop is received at the warehouse.</p>
        </section>
      ))}

      <section className="support-v3-card">
        <h3 className="support-v3-section-label">Technicians</h3>
        {techByAssignee.length === 0 && <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No assignments yet</p>}
        {techByAssignee.map((row) => (
          <div key={row.name} className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold">{initials(row.name)}</span>
              <span className="font-medium text-sm">{row.name}</span>
            </div>
            <ul className="text-xs space-y-1 pl-10" style={{ color: 'var(--color-text-secondary)' }}>
              {row.items.map((it) => (
                <li key={it.id}>{formatItemId(it.id)} · {it.status.replace(/_/g, ' ')}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="support-v3-card">
        <h3 className="support-v3-section-label">Ticket info</h3>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Created by: {ticket.created_by_name || '—'}</p>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Created: {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '—'}</p>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Updated: {formatRelative(ticket.updated_at)}</p>
        {onPriorityChange && (
          <label className="block mt-2 text-sm">
            <span className="support-v3-section-label !p-0 !mb-1">Priority</span>
            <select
              className="w-full border rounded-lg px-3 py-3 min-h-[44px] text-base mt-1"
              value={prio}
              onChange={(e) => {
                setPrio(e.target.value);
                onPriorityChange(e.target.value);
              }}
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        )}
      </section>

      <section className="support-v3-card">
        <h3 className="support-v3-section-label"><MapPin className="w-3.5 h-3.5 inline mr-1" /> Service area</h3>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{formatAddress(ticket.ticket_address)}</p>
      </section>
    </div>
  );

  return (
    <>
      <aside className="support-detail-sidebar hidden lg:block w-[240px] shrink-0">{content}</aside>
      {mobileOpen && (
        <div className="support-detail-sheet lg:hidden" role="dialog" aria-modal="true">
          <button type="button" className="support-detail-sheet-backdrop" onClick={onCloseMobile} aria-label="Close details" />
          <div className="support-detail-sheet-panel">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h2 className="font-semibold">Details</h2>
              <button type="button" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center" onClick={onCloseMobile}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[70vh]">{content}</div>
          </div>
        </div>
      )}
    </>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, ConfirmDialog, DataTable, DateTime, Drawer, Field, Money, Section, Textarea,
} from '../../../components/carret';
import { cancelPartRequest, fetchTicketParts, markPartChargeable } from './serveApi';
import { errMsg } from './serveShared';
import PartName from '../stock/setup/PartName';

/**
 * Ticket record → Parts (claude/carret-support.md rework F).
 *
 * Every part asked for on this ticket and where it is. Parts are free (the
 * service is ours) unless Support marks one chargeable with a reason; the
 * warehouse then prices it on the Support parts desk and Accounts bills it.
 */
const STATE = {
  pending: 'Waiting for the warehouse',
  approved: 'Approved',
  challan_generated: 'Challan made — technician to sign',
  issued: 'With the technician',
  dispatched: 'Sent to the customer',
  delivered: 'Delivered to the customer',
  used: 'Fitted',
  return_requested: 'Coming back unused',
  returned: 'Returned to stock',
  cancelled: 'Cancelled',
};
const LOCKED = ['cancelled', 'returned'];

export default function TicketPartsPanel({ ticketId, canLead }) {
  const [rows, setRows] = useState(null);
  const [mark, setMark] = useState(null); // { r, reason }
  const [busy, setBusy] = useState(false);
  // One confirm at a time: { title, label, tone, action }.
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    fetchTicketParts(ticketId).then(({ data }) => setRows(data.requests || data.data || [])).catch(() => setRows([]));
  }, [ticketId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.data?.message || ok); setMark(null); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  if (!rows || rows.length === 0) return null;
  const charged = (r) => r.billing_type === 'charge_customer';

  return (
    <Section title={`Parts · ${rows.length}`}>
      <DataTable
        columns={[
          { key: 'p', header: 'Part', render: (r) => <PartName name={r.part_name} category={r.category} suffix={r.quantity > 1 ? ` × ${r.quantity}` : ''} />, sub: (r) => [r.request_number, r.prt_id].filter(Boolean).join(' · ') },
          { key: 'l', header: 'Laptop', render: (r) => <span className="font-mono">{r.ttspl_id || '—'}</span>, sub: (r) => r.tech_name },
          { key: 's', header: 'Where it is', render: (r) => STATE[r.status] || String(r.status).replace(/_/g, ' '), sub: (r) => <DateTime value={r.updated_at || r.created_at} /> },
          {
            key: 'c',
            header: 'Customer pays',
            render: (r) => (charged(r)
              ? (Number(r.charge_amount) > 0 ? <Money value={r.charge_amount} /> : <span style={{ color: 'var(--alert-warn)' }}>Yes — warehouse to price</span>)
              : 'No (free)'),
            sub: (r) => (charged(r) ? r.charge_reason || null : null),
          },
          {
            key: 'a',
            header: '',
            render: (r) => canLead && !LOCKED.includes(r.status) && (
              <div className="flex flex-wrap" style={{ gap: '6px' }}>
                {charged(r)
                  ? <Button variant="quiet" disabled={busy} onClick={() => setConfirm({ title: `Make ${r.part_name} free for the customer?`, label: 'Make free', tone: 'warn', action: () => run(() => markPartChargeable(r.id, false), 'Marked free') })}>Make free</Button>
                  : <Button variant="quiet" onClick={() => setMark({ r, reason: '' })}>Charge the customer</Button>}
                {['pending', 'approved'].includes(r.status) && (
                  <Button variant="quiet" disabled={busy} onClick={() => setConfirm({ title: `Cancel ${r.request_number}?`, label: 'Cancel request', tone: 'crit', action: () => run(() => cancelPartRequest(r.id), 'Request cancelled') })}>Cancel</Button>
                )}
              </div>
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />

      <Drawer
        open={Boolean(mark)}
        onClose={() => setMark(null)}
        title={`Charge the customer — ${mark?.r.part_name || ''}`}
        footer={<Button variant="primary" disabled={busy || (mark?.reason || '').trim().length < 3} onClick={() => run(() => markPartChargeable(mark.r.id, true, mark.reason.trim()), 'Marked chargeable — the warehouse sets the price')}>Mark chargeable</Button>}
      >
        {mark && (
          <div className="c-stack">
            <p className="text-ink-3">Parts are free unless the fault is the customer’s. The warehouse sets the price; Accounts adds it to the customer’s invoice.</p>
            <Field label="Why the customer pays" required>
              <Textarea rows={3} value={mark.reason} onChange={(e) => setMark({ ...mark, reason: e.target.value })} placeholder="e.g. Screen cracked by a fall — customer damage" />
            </Field>
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.action()}
        title={confirm?.title}
        confirmLabel={confirm?.label}
        tone={confirm?.tone}
      />
    </Section>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid, Input,
  KeyValue, Notice, Section, Select, StatusChip, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  cancelVendorReturnTicket, cancelVendorReturnTicketItems, createVendorReturnTicketDc, downloadVendorReturnRequestPdf,
  fetchVendorReturnTicket, fetchVendorReturnTicketPreview, notifyVendorReturnTicket, updateVendorReturnTicket,
} from '../../vendor-management/vendorManagementApi';
import { errMsg } from './procureShared';
import {
  ITEM_STATUS_LABEL, MAX_DAYS_AHEAD, REQUEST_STATUS_LABEL, RETURN_REASONS, addDays, laptopLine, prettyDate, prettyTime,
  specLine, todayIst, validateRequestFields,
} from './returnRequestShared';

/**
 * Procure → Vendor returns → a return request (VRT, D10).
 *
 *   Draft          check the mail and PDF, change the dates, then send it
 *   Vendor told    rent stops from the chosen date; wait for the vendor to
 *                  confirm pickup, then make the return challan
 *   Challan(s)     transport, e-way (₹50,000+), gate, vendor has them
 *
 * Taking laptops off after the vendor was told resumes their rent and mails
 * the vendor.
 */
const enc = encodeURIComponent;
const DC_LABEL = { draft: 'Draft', dispatch_ready: 'At the gate', dispatched: 'Left the gate', completed: 'Vendor has it', cancelled: 'Cancelled' };

export default function ReturnRequestRecordPage() {
  const { ticketNumber: raw } = useParams();
  const ticketNumber = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const sections = ['vendor_return_ticket', 'vendor_return_to_vendor', 'vendor_management'];
  const canEdit = sections.some((s) => hasPermission(s, 'edit'));

  const [t, setT] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({});
  const [cancelFor, setCancelFor] = useState(null); // null | 'all' | serial_id[]
  const [cancelReason, setCancelReason] = useState('');
  const [picked, setPicked] = useState({});
  const [dcOpen, setDcOpen] = useState(false);

  const load = useCallback(() => {
    fetchVendorReturnTicket(ticketNumber)
      .then(({ data }) => {
        setT(data.ticket);
        if (data.ticket.status === 'requested') {
          fetchVendorReturnTicketPreview(ticketNumber).then((r) => setPreview(r.data.preview)).catch(() => setPreview(null));
        } else setPreview(null);
      })
      .catch((e) => setError(errMsg(e, 'Could not load the request.')));
  }, [ticketNumber]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast.success(ok); load(); return r; } catch (e) { toast.error(errMsg(e)); return null; } finally { setBusy(''); }
  };

  if (error) return <DeskShell title={ticketNumber} breadcrumb="Procure / Vendor returns"><EmptyState title="Could not load this request" body={error} action={<Button onClick={() => navigate('/carret/procure/returns')}>Back</Button>} /></DeskShell>;
  if (!t) return <DeskShell title={ticketNumber} breadcrumb="Procure / Vendor returns"><EmptyState title="Loading…" /></DeskShell>;

  const st = t.status;
  const items = t.items || [];
  const live = items.filter((i) => i.item_status !== 'cancelled');
  const waiting = items.filter((i) => i.item_status === 'rental_stopped');
  const cancellable = items.filter((i) => ['requested', 'rental_stopped'].includes(i.item_status));
  const told = Boolean(t.vendor_notified_at);
  const today = todayIst();
  const stopPassed = st === 'requested' && t.rent_stop_date && t.rent_stop_date < today;
  const email = t.vendor_email_live || t.vendor_email;
  const pickup = t.pickup_date ? [prettyDate(t.pickup_date), prettyTime(t.pickup_time)].filter(Boolean).join(' at ') : '—';

  const openEdit = () => {
    setEdit({
      reason_code: t.reason_code || (t.return_reason ? 'other' : ''),
      return_reason: t.reason_code && t.reason_code !== 'other' ? '' : (t.return_reason || ''),
      rent_stop_date: t.rent_stop_date && t.rent_stop_date >= today ? t.rent_stop_date : today,
      pickup_date: t.pickup_date || '',
      pickup_time: t.pickup_time || '11:00',
      remarks: t.remarks || '',
    });
    setEditOpen(true);
  };
  const saveEdit = async () => {
    const err = validateRequestFields(edit);
    if (err) { toast.error(err); return; }
    const r = await run('edit', () => updateVendorReturnTicket(ticketNumber, {
      ...edit,
      return_reason: edit.reason_code === 'other' ? edit.return_reason.trim() : null,
      remarks: edit.remarks.trim() || null,
    }), 'Request updated');
    if (r) setEditOpen(false);
  };

  const send = () => setConfirm({
    title: `Send ${ticketNumber} to ${t.vendor_name}?`,
    body: `Rent on ${live.length} laptop(s) stops from ${prettyDate(t.rent_stop_date || today)} (billed up to ${prettyDate(addDays(t.rent_stop_date || today, -1))}). The mail and PDF go to ${email}, copied to ${preview?.cc || 'accounts and the team'}.`,
    label: 'Send to vendor',
    tone: 'good',
    go: () => run('send', () => notifyVendorReturnTicket(ticketNumber), 'Sent — rent stops from the chosen date'),
  });

  const doCancel = async () => {
    const all = cancelFor === 'all';
    const r = await run('cancel', () => (all
      ? cancelVendorReturnTicket(ticketNumber, { reason: cancelReason.trim() })
      : cancelVendorReturnTicketItems(ticketNumber, { serial_ids: cancelFor, reason: cancelReason.trim() })),
    told ? 'Taken off — rent resumes, and the vendor has been mailed' : 'Taken off the request');
    if (r) { setCancelFor(null); setCancelReason(''); setPicked({}); }
  };

  const makeChallan = async () => {
    const ids = Object.keys(picked).map(Number);
    const r = await run('dc', () => createVendorReturnTicketDc(ticketNumber, { serial_ids: ids }));
    if (r?.data?.dc_number) {
      toast.success(`${r.data.dc_number} made — add values and transport, then send it to the gate`);
      navigate(`/carret/procure/returns/${enc(r.data.dc_number)}`);
    }
  };

  const flow = [
    { key: 'd', label: 'Draft', state: told ? 'done' : 'current' },
    { key: 'n', label: 'Vendor told', sub: told ? <DateTime value={t.vendor_notified_at} /> : null, state: !told ? 'todo' : (st === 'notified' ? 'current' : 'done') },
    { key: 'c', label: 'On a challan', state: ['partially_picked', 'picked', 'completed'].includes(st) ? (st === 'completed' ? 'done' : 'current') : 'todo' },
    { key: 'v', label: 'Vendor has them', state: st === 'completed' ? 'done' : 'todo' },
  ].map((s) => (st === 'cancelled' ? { ...s, state: 'blocked' } : s));

  let next = null;
  if (st === 'requested') {
    next = (
      <Notice
        tone={stopPassed || !email ? 'crit' : 'info'}
        title={stopPassed ? 'The rent stop date has passed' : (!email ? 'The vendor has no email address' : 'Not sent yet')}
        action={canEdit && (
          <div className="flex" style={{ gap: '8px' }}>
            <Button onClick={openEdit}>Change</Button>
            <Button variant="primary" disabled={busy === 'send' || stopPassed || !email || !live.length} onClick={send}>{busy === 'send' ? 'Sending…' : 'Send to vendor'}</Button>
          </div>
        )}
      >
        {stopPassed
          ? 'Change it to today or later before sending — the vendor can’t be told rent stopped on a day that has gone.'
          : (!email ? 'Add it on the vendor record first.' : 'Check the mail below. Sending mails the vendor with the PDF, and rent stops from the date shown.')}
        {t.notify_error && <><br /><strong>Last attempt failed:</strong> {t.notify_error}</>}
      </Notice>
    );
  } else if (st === 'notified' || st === 'partially_picked') {
    next = (
      <Notice
        tone="info"
        title={waiting.length ? `${waiting.length} laptop(s) waiting for pickup` : 'On the way'}
        action={canEdit && waiting.length > 0 && <Button variant="primary" onClick={() => { setPicked(Object.fromEntries(waiting.map((i) => [i.serial_id, true]))); setDcOpen(true); }}>Make return challan</Button>}
      >
        {waiting.length
          ? 'When the vendor confirms and sends someone (or asks us to send them), make the return challan: it takes the transport details, and at ₹50,000 or more Accounts is mailed for the e-way bill.'
          : 'Every laptop is on a return challan.'}
      </Notice>
    );
  } else if (st === 'picked') next = <Notice tone="info" title="Left the gate">Mark each challan received once the vendor has the laptops.</Notice>;
  else if (st === 'completed') next = <Notice tone="good" title="The vendor has them">Completed <DateTime value={t.completed_at} />.</Notice>;
  else next = <Notice tone="serious" title="Cancelled">{t.cancel_reason || 'No reason given.'}{t.cancel_mail_sent_at && <> The vendor was mailed <DateTime value={t.cancel_mail_sent_at} />.</>}</Notice>;

  const itemCols = [
    { key: 'x', header: '', width: '2.5rem', render: (i) => canEdit && ['requested', 'rental_stopped'].includes(i.item_status) && <input type="checkbox" aria-label={`Pick ${i.ttspl_id}`} checked={Boolean(picked[i.serial_id])} onChange={() => setPicked((p) => { const n = { ...p }; if (n[i.serial_id]) delete n[i.serial_id]; else n[i.serial_id] = true; return n; })} /> },
    { key: 't', header: 'Asset', render: (i) => <DocNumber value={i.ttspl_id} />, sub: (i) => i.serial_number },
    { key: 'l', header: 'Laptop', render: laptopLine, sub: specLine },
    { key: 'p', header: 'PO', render: (i) => i.po_number || '—' },
    { key: 's', header: 'Status', render: (i) => <StatusChip status={i.item_status === 'vendor_received' ? 'completed' : i.item_status === 'cancelled' ? 'cancelled' : 'pending'} label={ITEM_STATUS_LABEL[i.item_status] || i.item_status} />, sub: (i) => i.dc_number || (i.item_status === 'cancelled' ? i.remarks : null) },
  ];
  const pickedIds = Object.keys(picked).map(Number).filter((id) => cancellable.some((i) => i.serial_id === id));

  return (
    <DeskShell title={ticketNumber} breadcrumb="Procure / Vendor returns" subtitle={t.vendor_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={ticketNumber}
          type="Return request"
          status={st === 'requested' ? 'draft' : st === 'cancelled' ? 'cancelled' : st === 'completed' ? 'completed' : 'pending'}
          actions={(
            <>
              <Button disabled={busy === 'pdf'} onClick={() => run('pdf', () => downloadVendorReturnRequestPdf(ticketNumber))}>PDF</Button>
              {canEdit && cancellable.length > 0 && st !== 'cancelled' && (
                <Button variant="quiet" onClick={() => setCancelFor('all')}>Cancel request</Button>
              )}
            </>
          )}
          meta={[
            { label: 'Vendor', value: t.vendor_name },
            { label: 'Laptops', value: live.length },
            { label: 'Rent stops from', value: prettyDate(t.rent_stop_date || (told ? null : today)) },
            { label: 'Billed up to', value: t.rent_stop_date ? prettyDate(addDays(t.rent_stop_date, -1)) : '—' },
            { label: 'Pickup', value: pickup },
            { label: 'Status', value: REQUEST_STATUS_LABEL[st] || st },
          ]}
        />
        <FlowSteps steps={flow} />
        {next}

        <Section
          title={`Laptops · ${live.length}`}
          actions={canEdit && pickedIds.length > 0 && (
            <Button variant="quiet" onClick={() => setCancelFor(pickedIds)}>Take {pickedIds.length} off this request</Button>
          )}
        >
          <DataTable columns={itemCols} rows={items} rowKey={(i) => i.id} />
        </Section>

        {preview && (
          <Section title="Mail to the vendor">
            <KeyValue cols={1} items={[
              { label: 'To', value: preview.to || <span style={{ color: 'var(--alert-crit)' }}>No email on the vendor record</span> },
              { label: 'CC', value: preview.cc },
              { label: 'Subject', value: preview.subject },
              { label: 'Attached', value: `Return request PDF — ${ticketNumber}` },
            ]}
            />
            <iframe
              title="Mail preview"
              sandbox=""
              srcDoc={preview.html}
              style={{ width: '100%', height: '560px', border: '1px solid var(--line, #d9dee5)', borderRadius: '8px', marginTop: '12px', background: '#fff' }}
            />
          </Section>
        )}

        {told && (
          <Section title="Sent">
            <KeyValue cols={2} items={[
              { label: 'Sent', value: <DateTime value={t.vendor_notified_at} /> },
              { label: 'To', value: t.notify_to || t.vendor_email },
              { label: 'CC', value: t.notify_cc || '—' },
              { label: 'Reason', value: t.reason_label || t.return_reason },
              { label: 'Note', value: t.remarks },
            ]}
            />
          </Section>
        )}

        {(t.dcs || []).length > 0 && (
          <Section title="Return challans">
            <DataTable
              columns={[
                { key: 'n', header: 'Challan', render: (d) => <DocNumber value={d.dc_number} /> },
                { key: 'c', header: 'Laptops', numeric: true, render: (d) => d.item_count },
                { key: 's', header: 'Status', render: (d) => <StatusChip status={d.status === 'completed' ? 'completed' : d.status === 'cancelled' ? 'cancelled' : 'pending'} label={DC_LABEL[d.status] || d.status} /> },
                { key: 'd', header: 'Made', render: (d) => <DateTime value={d.created_at} />, sub: (d) => (d.dispatched_at ? <>out <DateTime value={d.dispatched_at} /></> : null) },
              ]}
              rows={t.dcs}
              rowKey={(d) => d.dc_number}
              onRowClick={(d) => navigate(`/carret/procure/returns/${enc(d.dc_number)}`)}
            />
          </Section>
        )}
      </div>

      <Drawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Change the request"
        footer={<Button variant="primary" disabled={busy === 'edit'} onClick={saveEdit}>{busy === 'edit' ? 'Saving…' : 'Save'}</Button>}
      >
        <FormGrid cols={1}>
          <Field label="Why they go back" required><Select value={edit.reason_code || ''} onChange={(e) => setEdit((x) => ({ ...x, reason_code: e.target.value }))} placeholder="Choose…" options={RETURN_REASONS} /></Field>
          {edit.reason_code === 'other' && <Field label="The reason" required><Input value={edit.return_reason || ''} onChange={(e) => setEdit((x) => ({ ...x, return_reason: e.target.value }))} /></Field>}
          <Field label="Rent stops from" required hint={edit.rent_stop_date ? `Billed up to ${prettyDate(addDays(edit.rent_stop_date, -1))}.` : null}>
            <Input type="date" min={today} max={addDays(today, MAX_DAYS_AHEAD)} value={edit.rent_stop_date || ''} onChange={(e) => setEdit((x) => ({ ...x, rent_stop_date: e.target.value }))} />
          </Field>
          <Field label="Pickup date" required><Input type="date" min={today} value={edit.pickup_date || ''} onChange={(e) => setEdit((x) => ({ ...x, pickup_date: e.target.value }))} /></Field>
          <Field label="Pickup time" required><Input type="time" value={edit.pickup_time || ''} onChange={(e) => setEdit((x) => ({ ...x, pickup_time: e.target.value }))} /></Field>
          <Field label="Note for the vendor"><Textarea rows={3} value={edit.remarks || ''} onChange={(e) => setEdit((x) => ({ ...x, remarks: e.target.value }))} /></Field>
        </FormGrid>
      </Drawer>

      <Drawer
        open={Boolean(cancelFor)}
        onClose={() => setCancelFor(null)}
        title={cancelFor === 'all' ? `Cancel ${ticketNumber}` : `Take ${Array.isArray(cancelFor) ? cancelFor.length : 0} laptop(s) off`}
        footer={<Button variant="primary" disabled={busy === 'cancel' || (told && cancelReason.trim().length < 3)} onClick={doCancel}>{busy === 'cancel' ? 'Working…' : 'Confirm'}</Button>}
      >
        {told
          ? <Notice tone="warn" title="The vendor has already been told">These laptops stay with us, so their <strong>rent resumes</strong> as if the request never stopped it, and the vendor gets a mail saying the return is off (same CCs). If the mail can’t be sent, nothing changes.</Notice>
          : <p style={{ marginBottom: '12px' }}>The vendor hasn’t been told, so nothing else changes.</p>}
        <Field label="Reason" required={told} hint={told ? 'Included in the mail to the vendor.' : null}><Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
      </Drawer>

      <Drawer
        open={dcOpen}
        onClose={() => setDcOpen(false)}
        title="Make the return challan"
        footer={<Button variant="primary" disabled={busy === 'dc' || !Object.keys(picked).length} onClick={makeChallan}>{busy === 'dc' ? 'Making…' : `Make challan for ${Object.keys(picked).length}`}</Button>}
      >
        <p style={{ marginBottom: '8px' }}>Laptops the vendor is collecting now (the rest stay waiting on this request):</p>
        <div className="c-stack" style={{ gap: '4px' }}>
          {waiting.map((i) => (
            <label key={i.serial_id} className="c-check">
              <input type="checkbox" checked={Boolean(picked[i.serial_id])} onChange={() => setPicked((p) => { const n = { ...p }; if (n[i.serial_id]) delete n[i.serial_id]; else n[i.serial_id] = true; return n; })} />
              <span><span className="font-mono">{i.ttspl_id}</span> — {laptopLine(i)}</span>
            </label>
          ))}
        </div>
        <p className="text-ink-3" style={{ marginTop: '12px' }}>The challan opens next: declared values, how it travels (courier, porter, in-house, vendor pickup), then send it to the gate.</p>
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const go = confirm?.go; setConfirm(null); go?.(); }}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.label}
        tone={confirm?.tone}
      />
    </DeskShell>
  );
}

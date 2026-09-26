import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Notice, Section, Select, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { parseRequestExtra, pickupReasonLabel } from '../../support/pickupReasonTypes';
import {
  convertRequest, fetchRequest, fetchRequests, fetchTechnicians, searchCustomers, updateRequest,
} from './serveApi';
import { IssuePicker, issueComplete, issueLabel, useIssueCatalog } from './IssueFields';
import { errMsg } from './serveShared';

/**
 * Serve → Customer requests (claude/carret-support.md rework E).
 *
 * Requests customers send from the QR page / portal, before they are tickets.
 * The lead checks the customer, confirms the issue (the customer picked the
 * kind of problem and the part; the lead picks the exact issue), then turns it
 * into a ticket — or rejects it with a reason. Pickup requests become a
 * pickup ticket with its Return DC. Same endpoints as the old inbox.
 */
const STATUS_TABS = [
  { key: 'pending', label: 'New' },
  { key: 'reviewed', label: 'Looked at' },
  { key: 'converted', label: 'Turned into tickets' },
  { key: 'dismissed', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const ticketOf = (r) => r.ticket_id || r.linked_ticket_id || null;
const addr = (a) => (a ? [a.name, a.phone, a.address, a.city, a.state, a.pincode].filter(Boolean).join(', ') : '');

export default function RequestsPage() {
  const navigate = useNavigate();
  const { user } = usePermission();
  const canAct = ['super_admin', 'admin', 'manager', 'support_lead'].includes(user?.role);
  const catalog = useIssueCatalog();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [techs, setTechs] = useState([]);
  const [open, setOpen] = useState(null); // request row
  const [conv, setConv] = useState(null); // convert form
  const [reject, setReject] = useState(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState(null);

  const load = useCallback(() => {
    setData(null);
    fetchRequests({ status, q: q.trim() || undefined, limit: 200 })
      .then(({ data: d }) => setData(d))
      .catch((e) => { toast.error(errMsg(e, 'Could not load requests')); setData({ requests: [] }); });
  }, [status, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (canAct) fetchTechnicians().then(({ data: d }) => setTechs((d.technicians || []).filter((t) => t.active !== false))).catch(() => {}); }, [canAct]);

  const openConvert = async (r) => {
    const isPickup = r.request_type === 'pickup';
    setConv({
      r, isPickup, matches: [], search: '', found: [],
      customer_id: r.matched_customer_id ? String(r.matched_customer_id) : '',
      priority: 'normal', assigned_to: '',
      issue: { type_id: r.reported_type_id ? String(r.reported_type_id) : '', subtype_id: r.reported_subtype_id ? String(r.reported_subtype_id) : '', issue_id: '' },
    });
    try {
      const { data: d } = await fetchRequest(r.id);
      setConv((c) => c && ({ ...c, matches: d.customer_matches || [] }));
    } catch { /* the lead can search */ }
  };
  const searchCust = async () => {
    if (conv.search.trim().length < 2) return;
    try {
      const { data: d } = await searchCustomers(conv.search.trim());
      setConv({ ...conv, found: (d.items || []).map((c) => ({ customer_id: c.customer_id, company_name: c.customer_name, name: c.contact_person_name, phone: c.contact_person_number || c.customer_number })) });
    } catch (e) { toast.error(errMsg(e)); }
  };
  const submitConvert = async () => {
    if (!conv.isPickup && !conv.customer_id) { toast.error('Choose the customer'); return; }
    if (!conv.isPickup && !issueComplete(conv.issue)) { toast.error('Choose the issue type, subtype and issue'); return; }
    setBusy(true);
    try {
      const { data: d } = await convertRequest(conv.r.id, {
        customer_id: conv.customer_id ? Number(conv.customer_id) : undefined,
        priority: conv.priority,
        ticket_category: conv.isPickup ? 'pickup' : 'complaint',
        assigned_to: conv.assigned_to ? Number(conv.assigned_to) : undefined,
        ...(conv.isPickup ? {} : { reported_type_id: Number(conv.issue.type_id), reported_subtype_id: Number(conv.issue.subtype_id), reported_issue_id: Number(conv.issue.issue_id) }),
      });
      toast.success(d.message || `Ticket #${d.ticket_id} created`);
      setConv(null); setOpen(null);
      navigate(`/carret/serve/tickets/${d.ticket_id}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not turn it into a ticket'));
    } finally { setBusy(false); }
  };
  const submitReject = async () => {
    setBusy(true);
    try { await updateRequest(reject.id, { status: 'dismissed', notes: reject.notes.trim() }); toast.success('Rejected'); setReject(null); setOpen(null); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const markLooked = async (r) => {
    try { await updateRequest(r.id, { status: 'reviewed' }); toast.success('Marked as looked at'); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const showQr = async () => {
    const url = `${window.location.origin}/support/request`;
    try { setQr({ url, img: await QRCode.toDataURL(url, { width: 320, margin: 2 }) }); } catch (e) { toast.error('Could not make the QR code'); }
  };

  const rows = data?.requests || [];
  const customerOf = (r) => r.crm_customer_display || r.matched_company_name || r.matched_customer_name || null;
  const kindOf = (r) => {
    if (r.request_type === 'pickup') return `Pickup · ${pickupReasonLabel(r.extra) || 'return'}`;
    const t = catalog?.types.find((x) => x.id === r.reported_type_id);
    const s = t?.subtypes.find((x) => x.id === r.reported_subtype_id);
    return [t?.name, s?.name].filter(Boolean).join(' › ') || 'Complaint';
  };

  const cols = [
    { key: 'w', header: 'Received', render: (r) => <DateTime value={r.created_at} />, sub: (r) => `#${r.id}` },
    { key: 'c', header: 'From', render: (r) => r.customer_name, sub: (r) => [r.mobile_number, r.company_name].filter(Boolean).join(' · ') },
    { key: 'm', header: 'Our customer', render: (r) => customerOf(r) || <span style={{ color: 'var(--alert-warn)' }}>Not matched</span> },
    { key: 'l', header: 'Laptop', render: (r) => <span className="font-mono">{r.device_serial || (parseRequestExtra(r.extra).devices || []).join(', ') || '—'}</span> },
    { key: 'k', header: 'Problem', render: (r) => kindOf(r), sub: (r) => (r.issue_description ? String(r.issue_description).slice(0, 80) : null) },
    { key: 's', header: 'Status', render: (r) => (r.status === 'converted' && ticketOf(r) ? <Button variant="quiet" onClick={(e) => { e.stopPropagation(); navigate(`/carret/serve/tickets/${ticketOf(r)}`); }}>Ticket #{ticketOf(r)}</Button> : STATUS_TABS.find((x) => x.key === r.status)?.label || r.status) },
  ];

  const ex = open ? parseRequestExtra(open.extra) : {};
  const actionable = open && ['pending', 'reviewed'].includes(open.status);

  return (
    <DeskShell
      title="Customer requests"
      breadcrumb="Serve"
      subtitle="Requests from the QR page and the customer portal — check, then turn into a ticket."
      actions={<Button variant="quiet" onClick={showQr}>QR code for customers</Button>}
    >
      <div className="c-stack">
        <Tabs tabs={STATUS_TABS.map((t) => ({ ...t, label: t.key === 'pending' && data?.pending_count != null ? `${t.label} · ${data.pending_count}` : t.label }))} value={status} onChange={setStatus} />
        <Section title={`${STATUS_TABS.find((t) => t.key === status)?.label} · ${rows.length}`} actions={<Input type="search" placeholder="Name, phone, company, TTSPL" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '16rem' }} aria-label="Search" />}>
          {data === null ? <EmptyState title="Loading…" /> : (
            <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={setOpen} empty={<EmptyState title="No requests here" />} />
          )}
        </Section>
      </div>

      <Drawer
        open={Boolean(open) && !conv && !reject}
        onClose={() => setOpen(null)}
        title={open ? `Request #${open.id} — ${open.request_type === 'pickup' ? 'pickup' : 'complaint'}` : ''}
        width="40rem"
        footer={open && canAct && actionable && (
          <div className="flex" style={{ gap: '8px' }}>
            <Button variant="primary" onClick={() => openConvert(open)}>Turn into a ticket</Button>
            {open.status === 'pending' && <Button onClick={() => markLooked(open)}>Mark looked at</Button>}
            <Button variant="quiet" onClick={() => setReject({ id: open.id, notes: '' })}>Reject</Button>
          </div>
        )}
      >
        {open && (
          <div className="c-stack">
            <KeyValue cols={2} items={[
              { label: 'From', value: open.customer_name },
              { label: 'Mobile', value: open.mobile_number },
              { label: 'Company (as typed)', value: open.company_name },
              { label: 'Our customer', value: customerOf(open) || 'Not matched yet' },
              { label: 'Laptop', value: open.device_serial || (ex.devices || []).join(', ') },
              { label: 'Problem', value: kindOf(open) },
              { label: open.request_type === 'pickup' ? 'Pickup address' : 'Visit address', value: addr(ex.pickup_address || ex.service_address) },
              { label: 'Preferred visit', value: [ex.preferred_visit_date, ex.preferred_visit_time].filter(Boolean).join(' ') },
            ]}
            />
            {open.issue_description && <Notice tone="info" title="What they wrote">{open.issue_description}</Notice>}
            {open.status === 'dismissed' && open.notes && <Notice tone="warn" title="Rejected">{open.notes}</Notice>}
            {ticketOf(open) && <Button onClick={() => navigate(`/carret/serve/tickets/${ticketOf(open)}`)}>Open ticket #{ticketOf(open)}</Button>}
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(conv)}
        onClose={() => setConv(null)}
        title={conv ? `Turn request #${conv.r.id} into a ${conv.isPickup ? 'pickup' : 'complaint'} ticket` : ''}
        width="42rem"
        footer={<Button variant="primary" disabled={busy} onClick={submitConvert}>{busy ? 'Creating…' : 'Create the ticket'}</Button>}
      >
        {conv && (
          <div className="c-stack">
            {conv.isPickup ? (
              <Notice tone="info">
                Pickup of {(parseRequestExtra(conv.r.extra).devices || [conv.r.device_serial]).filter(Boolean).join(', ')} from {addr(parseRequestExtra(conv.r.extra).pickup_address) || 'the address on the request'}.
                A Return DC is made with the ticket.
              </Notice>
            ) : (
              <>
                <Field label="Customer" required hint="Matched from the phone number; search if it is not here">
                  <Select
                    value={conv.customer_id}
                    onChange={(e) => setConv({ ...conv, customer_id: e.target.value })}
                    placeholder="Choose…"
                    options={[...conv.matches, ...conv.found]
                      .filter((c, i, a) => a.findIndex((x) => x.customer_id === c.customer_id) === i)
                      .map((c) => ({ value: String(c.customer_id), label: [c.company_name, c.name, c.phone].filter(Boolean).join(' · ') }))}
                  />
                </Field>
                <div className="flex" style={{ gap: '8px' }}>
                  <Input value={conv.search} onChange={(e) => setConv({ ...conv, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && searchCust()} placeholder="Search company, phone, customer id" />
                  <Button onClick={searchCust}>Search</Button>
                </div>
                <div>
                  <div className="c-label">Issue {conv.r.reported_subtype_id ? <span className="text-ink-3">— the customer said {kindOf(conv.r)}</span> : null}</div>
                  <IssuePicker catalog={catalog} value={conv.issue} onChange={(v) => setConv({ ...conv, issue: v })} cols={1} idPrefix="convert" />
                  {issueComplete(conv.issue) && <p className="text-ink-3" style={{ marginTop: '4px' }}>{issueLabel(catalog, conv.issue)}</p>}
                </div>
              </>
            )}
            <FormGrid cols={2}>
              <Field label="Priority">
                <Select value={conv.priority} onChange={(e) => setConv({ ...conv, priority: e.target.value })} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} />
              </Field>
              <Field label="Technician (optional)" hint="Least busy first">
                <Select
                  value={conv.assigned_to}
                  onChange={(e) => setConv({ ...conv, assigned_to: e.target.value })}
                  placeholder="Assign later"
                  options={[...techs].sort((a, b) => (a.open_item_count - b.open_item_count)).map((t) => ({ value: String(t.user_id), label: `${t.name} — ${t.open_item_count} open` }))}
                />
              </Field>
            </FormGrid>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(reject)}
        onClose={() => setReject(null)}
        title="Reject the request"
        footer={<Button variant="primary" disabled={busy || (reject?.notes || '').trim().length < 3} onClick={submitReject}>Reject</Button>}
      >
        {reject && (
          <Field label="Why" required hint="Kept on the request">
            <Textarea rows={3} value={reject.notes} onChange={(e) => setReject({ ...reject, notes: e.target.value })} placeholder="e.g. Duplicate of ticket #1234 / not our laptop" />
          </Field>
        )}
      </Drawer>

      <Drawer open={Boolean(qr)} onClose={() => setQr(null)} title="QR code for customers">
        {qr && (
          <div className="c-stack" style={{ alignItems: 'center' }}>
            <img src={qr.img} alt="Support request QR code" style={{ width: '280px', height: '280px' }} />
            <p className="text-ink-3" style={{ wordBreak: 'break-all' }}>{qr.url}</p>
            <a className="c-btn" href={qr.img} download="rentfoxxy-support-qr.png">Download PNG</a>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

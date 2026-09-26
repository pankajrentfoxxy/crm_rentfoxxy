import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Input, KeyValue,
  Money, Notice, Section, StatusChip, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  fetchPurchaseOrders, fetchVendor, fetchVendorLaptops, updateVendor, updateVendorPortalAccess,
} from '../../vendor-management/vendorManagementApi';
import {
  actionLabel, errMsg, fetchVendorActivity, fileUrl, vendorFormData, vendorFormFromRow, vendorName,
} from './procureShared';

/**
 * Procure → Vendor record.
 *
 * Everything about one vendor on one page: who they are and whether we can pay
 * them, what we have ordered, which of their laptops are with us or with
 * customers, their documents, portal access, and what changed.
 *
 * The next step leads, by status: a pending vendor needs approval before any
 * PO; a suspended vendor takes none; an approved vendor with placeholder bank
 * details cannot be paid until someone fixes them.
 */
const LAPTOP_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'With customers' },
  { key: 'in_stock', label: 'In our stock' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'returned', label: 'Returned' },
];

const poQty = (po) => {
  const lines = Array.isArray(po.line_items) ? po.line_items : [];
  return lines.reduce((a, l) => ({
    want: a.want + (Number(l.quantity ?? l.qty) || 0),
    got: a.got + (Number(l.receivedQty) || 0),
  }), { want: 0, got: 0 });
};

export default function VendorRecordPage() {
  const { vendorId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('vendor_management', 'edit');
  const canCreatePo = hasPermission('vendor_management', 'create');

  const [state, setState] = useState({ loading: true, error: null, v: null });
  const [tab, setTab] = useState('overview');
  const [pos, setPos] = useState(null);
  const [laptops, setLaptops] = useState({ rows: null, counts: {}, lifecycle: 'all', search: '' });
  const [activity, setActivity] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [shownPassword, setShownPassword] = useState(null);

  const load = useCallback(() => {
    fetchVendor(vendorId)
      .then(({ data }) => setState({ loading: false, error: null, v: data.data }))
      .catch((e) => setState({ loading: false, error: errMsg(e, 'Could not load the vendor.'), v: null }));
  }, [vendorId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchPurchaseOrders({ vendor_id: vendorId, limit: 200 })
      .then(({ data }) => setPos(data.data || []))
      .catch(() => setPos([]));
  }, [vendorId]);

  useEffect(() => {
    let off = false;
    const t = setTimeout(() => {
      fetchVendorLaptops(vendorId, { lifecycle: laptops.lifecycle, search: laptops.search || undefined, limit: 200 })
        .then(({ data }) => !off && setLaptops((l) => ({ ...l, rows: data.laptops || [], counts: data.counts || {} })))
        .catch(() => !off && setLaptops((l) => ({ ...l, rows: [] })));
    }, laptops.search ? 300 : 0);
    return () => { off = true; clearTimeout(t); };
  }, [vendorId, laptops.lifecycle, laptops.search]);

  useEffect(() => {
    if (tab !== 'activity') return;
    fetchVendorActivity(vendorId).then(({ data }) => setActivity(data.data || [])).catch(() => setActivity([]));
  }, [tab, vendorId]);

  const v = state.v;
  const status = String(v?.status || 'approved');
  const portalOn = v && v.vendor_portal_enabled !== false;

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  const setStatus = (to, ok) => run(to, async () => {
    // The update endpoint takes the whole record; send it back as loaded
    // ("hidden" bank values are kept by the server) with the new status.
    await updateVendor(vendorId, vendorFormData({ ...vendorFormFromRow(v), status: to }));
    toast.success(ok);
  });

  const portal = (key, body, ok) => run(key, async () => {
    const { data } = await updateVendorPortalAccess(vendorId, body);
    if (body.send_invite) {
      if (data.invite_sent) toast.success(`Login emailed to ${v.email}`);
      else { toast.error('The email did not go. Give the vendor this password yourself.'); setShownPassword(data.new_password || null); }
    } else if (data.new_password) {
      setShownPassword(data.new_password);
    } else toast.success(ok);
  });

  let next = null;
  if (v) {
    if (status === 'pending') {
      next = (
        <Notice
          tone="warn"
          title="Waiting for approval"
          action={canEdit && <Button variant="primary" onClick={() => setConfirm({ title: 'Approve this vendor?', body: 'Purchase orders can then be raised for them. Check the GSTIN and bank details first.', label: 'Approve', tone: 'good', go: () => setStatus('approved', 'Vendor approved') })}>Approve vendor</Button>}
        >
          No purchase order can be raised for this vendor until it is approved.
        </Notice>
      );
    } else if (status === 'suspended') {
      next = (
        <Notice tone="serious" title="Suspended" action={canEdit && <Button onClick={() => setStatus('approved', 'Vendor re-activated')}>Re-activate</Button>}>
          No new purchase orders. Laptops already with us and open returns carry on.
        </Notice>
      );
    } else if (!v.bank_details_ok) {
      next = (
        <Notice tone="warn" title="Bank details need fixing" action={canEdit && <Button onClick={() => navigate(`/carret/procure/vendors/${vendorId}/edit`)}>Fix bank details</Button>}>
          The IFSC or account number is missing or a placeholder, so accounts cannot pay this vendor.
        </Notice>
      );
    }
  }

  const actions = v && (
    <>
      {canCreatePo && status === 'approved' && <Button variant="primary" onClick={() => navigate(`/carret/procure/purchase-orders/new?vendor_id=${vendorId}`)}>New purchase order</Button>}
      {canEdit && <Button onClick={() => navigate(`/carret/procure/vendors/${vendorId}/edit`)}>Edit</Button>}
      {canEdit && status === 'approved' && (
        <Button variant="quiet" onClick={() => setConfirm({ title: 'Suspend this vendor?', body: 'No new purchase orders can be raised for them. Nothing already ordered or received changes.', label: 'Suspend', tone: 'crit', go: () => setStatus('suspended', 'Vendor suspended') })}>Suspend</Button>
      )}
    </>
  );

  const poCols = [
    { key: 'no', header: 'PO', render: (p) => <DocNumber value={p.purchase_order_number} /> },
    { key: 'type', header: 'Type', render: (p) => String(p.purchase_order_type || '—').replace(/_/g, ' ') },
    {
      key: 'recv',
      header: 'Received',
      numeric: true,
      render: (p) => {
        const q = poQty(p);
        if (!q.want) return '—';
        return <span style={{ color: q.got >= q.want ? 'var(--alert-good)' : q.got ? 'var(--alert-warn)' : 'var(--ink-3)' }}>{q.got} / {q.want}</span>;
      },
    },
    { key: 'status', header: 'Status', render: (p) => <StatusChip status={p.status} /> },
    { key: 'amt', header: 'Value', numeric: true, render: (p) => <Money value={p.total_amount ?? p.grand_total ?? p.subtotal} showZero={false} /> },
    { key: 'date', header: 'Date', render: (p) => <DateTime value={p.purchase_order_date || p.created_at} /> },
  ];

  const lapCols = [
    { key: 'ttspl', header: 'Asset', render: (l) => (l.ttspl_id ? <DocNumber value={l.ttspl_id} /> : '—'), sub: (l) => l.serial_number || null },
    { key: 'cfg', header: 'Laptop', render: (l) => [l.brand, l.model_name].filter(Boolean).join(' ') || '—', sub: (l) => [l.processor, l.generation, l.ram, l.storage].filter(Boolean).join(' · ') || null },
    { key: 'where', header: 'Where', render: (l) => (l.customer_name ? <>{l.customer_name}{l.current_dc_number && <div className="text-ink-3 font-mono">{l.current_dc_number}</div>}</> : l.rental_status || String(l.inventory_status || '—').replace(/_/g, ' ')) },
    { key: 'status', header: 'Status', render: (l) => <StatusChip status={l.inventory_status} /> },
    { key: 'po', header: 'PO', render: (l) => l.purchase_order_number || '—' },
  ];

  const docs = v ? [
    { label: 'GST certificate', url: v.gst_certificate_url },
    { label: 'Licences and permits', url: v.licenses_url },
    { label: 'Logo or photo', url: v.image_url },
  ] : [];

  const c = laptops.counts || {};
  const open = (pos || []).filter((p) => !['completed', 'cancelled', 'closed', 'rejected'].includes(String(p.status))).length;

  return (
    <DeskShell title={v ? vendorName(v) : 'Vendor'} breadcrumb="Procure / Vendors" subtitle={v?.city || undefined}>
      {state.loading && <EmptyState title="Loading…" />}
      {state.error && <EmptyState title="Could not load this vendor" body={state.error} action={<Button onClick={() => navigate('/carret/procure/vendors')}>Back to vendors</Button>} />}
      {v && (
        <div className="c-stack">
          <DocumentHeader
            docNumber={v.gst_number || `Vendor #${v.vendor_id}`}
            type={`Vendor · ${v.business_type || 'business'}`}
            status={status}
            actions={actions}
            meta={[
              { label: 'Contact', value: v.contact_person_name || v.f_name },
              { label: 'Phone', value: v.phone },
              { label: 'Email', value: v.email },
              { label: 'Open POs', value: pos ? open : '…' },
              { label: 'Laptops with us', value: c.total != null ? `${c.total} (${c.active || 0} with customers)` : '…' },
            ]}
          />
          {next}

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Details' },
              { key: 'pos', label: 'Purchase orders', count: pos ? pos.length : undefined },
              { key: 'laptops', label: 'Laptops', count: c.total },
              { key: 'portal', label: 'Portal' },
              { key: 'activity', label: 'Activity' },
            ]}
          />

          {tab === 'overview' && (
            <div className="c-split">
              <div className="c-stack">
                <Section title="Business">
                  <KeyValue items={[
                    { label: 'Business name', value: v.business_name },
                    { label: 'Type', value: v.business_type },
                    { label: 'Registered', value: v.registration_date ? <DateTime value={v.registration_date} /> : null },
                    { label: 'GSTIN', value: v.gst_number ? <DocNumber value={v.gst_number} /> : 'Not GST-registered' },
                    { label: 'PAN', value: v.pan_number },
                    { label: 'MSME', value: v.msme_number },
                    { label: 'Address', value: [v.address, v.city, v.state, v.pincode].filter(Boolean).join(', ') },
                    { label: 'Ships from', value: v.shipping_same === false ? [v.shipping_address, v.shipping_city, v.shipping_state, v.shipping_pincode].filter(Boolean).join(', ') : 'Same address' },
                    { label: 'Alternate phone', value: v.alternate_phone },
                  ]}
                  />
                </Section>
                <Section title="Bank">
                  {String(v.account_number).toLowerCase() === 'hidden'
                    ? <p className="text-ink-3">Hidden for your role — procurement and accounts can see these.</p>
                    : (
                      <KeyValue cols={2} items={[
                        { label: 'Bank', value: v.bank_name },
                        { label: 'Account holder', value: v.account_holder_name },
                        { label: 'Account number', value: v.account_number && <span className="font-mono">{v.account_number}</span> },
                        { label: 'IFSC', value: v.bank_ifsc_code && <span className="font-mono">{v.bank_ifsc_code}</span> },
                      ]}
                      />
                    )}
                  {!v.bank_details_ok && <p style={{ color: 'var(--alert-warn)', marginTop: '8px' }}>⚠ IFSC or account number is missing or a placeholder.</p>}
                </Section>
              </div>
              <div className="c-stack">
                <Section title="Terms">
                  <KeyValue cols={1} items={[
                    { label: 'Payment terms', value: String(v.po_payment_terms || '').replace(/_/g, ' ') },
                    { label: 'Credit days', value: v.credit_days },
                    { label: 'Notes', value: v.notes },
                  ]}
                  />
                </Section>
                <Section title="Documents">
                  <ul className="c-stack" style={{ gap: '8px', listStyle: 'none', padding: 0, margin: 0 }}>
                    {docs.map((d) => (
                      <li key={d.label} className="flex items-center justify-between">
                        <span>{d.label}</span>
                        {d.url ? <a href={fileUrl(d.url)} target="_blank" rel="noreferrer">Open</a> : <span className="text-ink-3">Not uploaded</span>}
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
            </div>
          )}

          {tab === 'pos' && (
            <Section title="Purchase orders">
              {pos === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  columns={poCols}
                  rows={pos}
                  rowKey={(p) => p.po_id}
                  onRowClick={(p) => navigate(`/carret/procure/purchase-orders/${p.po_id}`)}
                  empty={<EmptyState title="No purchase orders yet" />}
                />
              )}
            </Section>
          )}

          {tab === 'laptops' && (
            <Section
              title="Laptops from this vendor"
              actions={<Input type="search" placeholder="TTSPL, serial or model" value={laptops.search} onChange={(e) => setLaptops((l) => ({ ...l, search: e.target.value }))} aria-label="Search laptops" />}
            >
              <Tabs
                value={laptops.lifecycle}
                onChange={(k) => setLaptops((l) => ({ ...l, lifecycle: k, rows: null }))}
                tabs={LAPTOP_TABS.map((t) => ({ ...t, count: t.key === 'all' ? c.total : c[t.key] }))}
              />
              {laptops.rows === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  columns={lapCols}
                  rows={laptops.rows}
                  rowKey={(l) => l.serial_id}
                  onRowClick={(l) => l.ttspl_id && navigate(`/carret/stock/assets/${encodeURIComponent(l.ttspl_id)}`)}
                  empty={<EmptyState title="No laptops here" />}
                />
              )}
            </Section>
          )}

          {tab === 'portal' && (
            <Section title="Vendor portal">
              <KeyValue cols={3} items={[
                { label: 'Access', value: portalOn ? 'On' : 'Off' },
                { label: 'Signs in with', value: v.email },
                { label: 'Last signed in', value: v.vendor_portal_last_login ? <DateTime value={v.vendor_portal_last_login} /> : 'Never' },
              ]}
              />
              <p className="text-ink-3" style={{ margin: '12px 0' }}>
                On the portal the vendor sees their purchase orders, accepts or declines them, uploads invoices and follows returns.
              </p>
              {canEdit && (
                <div className="flex flex-wrap" style={{ gap: '8px' }}>
                  {portalOn && (
                    <Button variant="primary" disabled={busy === 'invite' || status !== 'approved'} onClick={() => setConfirm({ title: 'Email a new portal login?', body: `A new password is set and emailed to ${v.email}. Any old password stops working.`, label: 'Send login', tone: 'good', go: () => portal('invite', { reset_password: true, send_invite: true }) })}>
                      Email login to vendor
                    </Button>
                  )}
                  {portalOn && (
                    <Button disabled={busy === 'reset'} onClick={() => setConfirm({ title: 'Reset the portal password?', body: 'A new password is shown to you once. Give it to the vendor yourself.', label: 'Reset', tone: 'crit', go: () => portal('reset', { reset_password: true }) })}>
                      Reset password
                    </Button>
                  )}
                  <Button variant="quiet" disabled={busy === 'toggle'} onClick={() => portal('toggle', { portal_enabled: !portalOn }, portalOn ? 'Portal access turned off' : 'Portal access turned on')}>
                    {portalOn ? 'Turn portal off' : 'Turn portal on'}
                  </Button>
                </div>
              )}
              {status !== 'approved' && <p className="text-ink-3" style={{ marginTop: '8px' }}>The vendor can sign in only once approved.</p>}
            </Section>
          )}

          {tab === 'activity' && (
            <Section title="Activity">
              {activity === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  columns={[
                    { key: 'when', header: 'When', render: (a) => <DateTime value={a.created_at} /> },
                    { key: 'what', header: 'What', render: (a) => actionLabel(a.action), sub: (a) => (a.entity_type && a.entity_type !== 'vendor' ? `${a.entity_type.replace(/_/g, ' ')} ${a.entity_id || ''}` : null) },
                    { key: 'who', header: 'Who', render: (a) => a.actor_name || 'system' },
                  ]}
                  rows={activity}
                  rowKey={(a) => a.log_id}
                  empty={<EmptyState title="Nothing recorded yet" />}
                />
              )}
            </Section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const go = confirm?.go; setConfirm(null); go?.(); }}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.label}
        tone={confirm?.tone}
      />
      <Drawer open={Boolean(shownPassword)} onClose={() => setShownPassword(null)} title="New portal password" footer={<Button variant="primary" onClick={() => setShownPassword(null)}>Done</Button>}>
        <p>Give this to the vendor. It is shown only once.</p>
        <p className="font-mono" style={{ fontSize: '1.4rem', margin: '16px 0' }}>{shownPassword}</p>
        <p className="text-ink-3">They sign in at the vendor portal with {v?.email}.</p>
      </Drawer>
    </DeskShell>
  );
}

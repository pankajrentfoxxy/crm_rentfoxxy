import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, KeyValue, Money, Notice, Panel, Select,
  StatTile, StatusChip, Tabs, Textarea,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import api from '../../../../utils/api';
import {
  customerLaptopsExportUrl, errMsg, fetchCustomer, fetchCustomerLaptops, fetchCustomerOrders, fetchCustomerTickets,
  fetchStatement, setCustomerTag, fetchClosureCheck, closeCustomerAccount,
  fetchCustomerProfile, setCustomerStatus, verifyCustomerKyc,
} from './customersApi';
import { TagBadge } from './CustomersListPage';
import { ProfileDrawer, ProfileTab } from './CustomerProfile';
import AddressesTab from './CustomerAddresses';
import DocumentsTab from './CustomerDocuments';
import PortalTab from './CustomerPortal';
import { LaptopActivity, LaptopEditDrawer } from './CustomerLaptopEdit';

/**
 * Sell → Customers → one customer (claude/carret-customers-returns-control.md).
 * Laptops on rent, rental returns and laptops bought (edit a laptop's record,
 * report one lost / bought out), orders, tickets, account — and everything the
 * old /lead-crm/customers/:id page did: profile edit, delivery addresses,
 * documents, portal access, activate / deactivate, KYC verification.
 */
const LAPTOP_TABS = { rented: 'active', returned: 'returned', purchased: 'purchased' };
const LIMIT = 25;
const spec = (r) => [r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ');

function LaptopsTab({ customerId, kind, onCounts, canEdit, canSaleInPlace, onEdit, refreshKey }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    setRes(null);
    fetchCustomerLaptops(customerId, { lifecycle: LAPTOP_TABS[kind], page, limit: LIMIT, search: search || undefined })
      .then(({ data }) => { setRes(data); onCounts?.(data.counts); })
      .catch((e) => { setRes({ data: [] }); toast.error(errMsg(e)); });
  }, [customerId, kind, page, search, onCounts, refreshKey]);

  const exportXlsx = async () => {
    try {
      const r = await api.get(customerLaptopsExportUrl(customerId, LAPTOP_TABS[kind]), { responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.data);
      a.download = `customer-${customerId}-${kind}.xlsx`;
      a.click();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const base = [
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id || r.serial_number} />, sub: (r) => [r.brand, r.model_name].filter(Boolean).join(' ') },
    { key: 'c', header: 'Configuration', render: (r) => spec(r) || '—' },
  ];
  const cols = kind === 'rented' ? [
    ...base,
    { key: 's', header: 'State', render: (r) => <StatusChip status={r.status} />, sub: (r) => (r.sale_in_place ? `Rent stopped · ${r.sale_in_place.reason}` : null) },
    { key: 'r', header: 'Rent / month', numeric: true, render: (r) => <Money value={r.rent_monthly_rate} showZero={false} /> },
    { key: 'd', header: 'Delivered', render: (r) => <DateTime value={r.delivered_at || r.dispatch_date} />, sub: (r) => r.dc_number },
    { key: 'l', header: 'Where', render: (r) => r.delivery_city || '—', sub: (r) => r.delivery_location },
  ] : kind === 'returned' ? [
    ...base,
    { key: 'd', header: 'Rented from', render: (r) => <DateTime value={r.delivered_at} /> },
    { key: 'x', header: 'Returned', render: (r) => <DateTime value={r.returned_at} />, sub: (r) => r.dc_number },
    { key: 'p', header: 'Why', render: (r) => ({ return: 'Return', repair: 'Repair', replacement: 'Replacement' }[r.pickup_type] || r.pickup_type || '—') },
  ] : [
    ...base,
    { key: 'p', header: 'Sale price', numeric: true, render: (r) => <Money value={r.sale_price} showZero={false} /> },
    { key: 'd', header: 'Sold', render: (r) => <DateTime value={r.sold_at || r.delivered_at} />, sub: (r) => r.sales_order_number },
    { key: 'i', header: 'Invoice', render: (r) => r.sale_invoice_number || '—', sub: (r) => (r.sale_type === 'in_place' ? `In place${r.sale_in_place_reason ? ` · ${r.sale_in_place_reason}` : ''}` : null) },
  ];
  const stop = (e) => e.stopPropagation();
  if ((canEdit && kind !== 'purchased') || (canSaleInPlace && kind === 'rented')) {
    cols.push({
      key: 'act',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap" style={{ gap: '6px' }} onClick={stop} role="presentation">
          {canEdit && kind !== 'purchased' && r.serial_id && <Button variant="quiet" onClick={() => onEdit(r)}>Edit</Button>}
          {canSaleInPlace && kind === 'rented' && r.serial_id && !r.sale_in_place && (
            <Link className="c-btn c-btn--quiet" to={`/carret/sell/sale-in-place/new?customer=${customerId}&serial=${r.serial_id}`}>Lost / buyout</Link>
          )}
          {r.sale_in_place?.vendor_pending && <Link className="c-btn c-btn--quiet" to="/carret/sell/sale-in-place">Vendor buyout</Link>}
        </div>
      ),
    });
  }
  const total = res?.pagination?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  return (
    <div className="c-stack">
      <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
        <Input type="search" placeholder="TTSPL, serial or model" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} />
        {kind !== 'purchased' && <Button variant="quiet" onClick={exportXlsx}>Export</Button>}
        <span className="text-ink-3">{res ? `${total} laptop(s)` : ''}</span>
      </div>
      {res === null ? <EmptyState title="Loading…" /> : (
        <DataTable columns={cols} rows={res.data || []} rowKey={(r, i) => `${r.serial_id}-${r.dc_number || i}`} onRowClick={(r) => navigate(`/carret/stock/assets/${encodeURIComponent(r.ttspl_id || r.serial_number)}`)} empty={<EmptyState title="None" />} />
      )}
      {pages > 1 && (
        <div className="flex items-center" style={{ gap: '8px' }}>
          <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-ink-3">Page {page} of {pages}</span>
          <Button variant="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function OrdersTab({ customerId }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  useEffect(() => { fetchCustomerOrders(customerId).then(({ data }) => setRows(data.data || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); }); }, [customerId]);
  const cols = [
    { key: 'n', header: 'Sales order', render: (r) => <DocNumber value={r.sales_order_number} />, sub: (r) => ({ rental: 'Rental', sale: 'Sale', sales: 'Sale', demo: 'Demo' }[String(r.quotation_type || '').toLowerCase()] || r.quotation_type) },
    { key: 'd', header: 'Date', render: (r) => <DateTime value={r.created_at} /> },
    { key: 'q', header: 'Laptops', numeric: true, render: (r) => `${r.laptops} / ${r.qty}` },
    { key: 'v', header: 'Value', numeric: true, render: (r) => <Money value={r.value} />, sub: (r) => (String(r.quotation_type).toLowerCase() === 'rental' ? 'per month' : null) },
    { key: 's', header: 'Status', render: (r) => r.status },
  ];
  return rows === null ? <EmptyState title="Loading…" /> : (
    <DataTable columns={cols} rows={rows} rowKey={(r) => r.sales_order_number} onRowClick={(r) => navigate(`/carret/sell/sales-orders/${encodeURIComponent(r.sales_order_number)}`)} empty={<EmptyState title="No orders" />} />
  );
}

function TicketsTab({ customerId }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetchCustomerTickets(customerId).then(({ data }) => setRows(data.data || data.tickets || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [customerId]);
  const cols = [
    { key: 'n', header: 'Ticket', render: (r) => `#${r.id || r.ticket_id}`, sub: (r) => r.ticket_category || r.complaint_type },
    { key: 's', header: 'Status', render: (r) => String(r.status || '').replace(/_/g, ' ') },
    { key: 'd', header: 'Raised', render: (r) => <DateTime value={r.created_at} /> },
    { key: 'l', header: 'Laptop', render: (r) => r.ttspl_id || r.serial_number || '—' },
  ];
  return rows === null ? <EmptyState title="Loading…" /> : (
    <DataTable columns={cols} rows={rows} rowKey={(r) => r.id || r.ticket_id} onRowClick={(r) => navigate(`/carret/serve/tickets/${r.id || r.ticket_id}`)} empty={<EmptyState title="No tickets" />} />
  );
}

function AccountTab({ customerId }) {
  const [res, setRes] = useState(null);
  useEffect(() => { fetchStatement(customerId).then(({ data }) => setRes(data)).catch((e) => { setRes({ error: errMsg(e) }); }); }, [customerId]);
  if (res === null) return <EmptyState title="Loading…" />;
  if (res.error) return <Notice tone="info">{res.error}</Notice>;
  const rows = res.data?.entries || res.entries || res.data || [];
  const cols = [
    { key: 'd', header: 'Date', render: (r) => <DateTime value={r.date || r.entry_date || r.created_at} /> },
    { key: 't', header: 'Entry', render: (r) => ({ invoice: 'Invoice', credit_note: 'Credit note', payment: 'Payment' }[r.entry_type] || r.entry_type), sub: (r) => r.reference },
    { key: 'dr', header: 'Debit', numeric: true, render: (r) => <Money value={r.debit} showZero={false} /> },
    { key: 'cr', header: 'Credit', numeric: true, render: (r) => <Money value={r.credit} showZero={false} /> },
    { key: 'b', header: 'Balance', numeric: true, render: (r) => <Money value={r.balance ?? r.running_balance} /> },
  ];
  return <DataTable columns={cols} rows={Array.isArray(rows) ? rows : []} rowKey={(r, i) => i} empty={<EmptyState title="No invoices, payments or credit notes yet" />} />;
}

export default function CustomerRecordPage() {
  const { customerId } = useParams();
  const { hasPermission, user } = usePermission();
  const canTag = ['admin', 'super_admin'].includes(user?.role);
  const isSuperAdmin = user?.role === 'super_admin';
  const canAccount = hasPermission('customer_billing', 'view');
  const canEdit = hasPermission('customers', 'edit');
  const canKyc = hasPermission('kyc_management', 'edit');
  const canDocs = hasPermission('customer_documents', 'view');
  const canEditLaptop = hasPermission('customer_assets', 'edit');
  const canSaleInPlace = hasPermission('sale_in_place', 'create');
  const [c, setC] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('rented');
  const [counts, setCounts] = useState(null);
  const [tagEdit, setTagEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(null);
  const [editing, setEditing] = useState(false);
  const [statusAsk, setStatusAsk] = useState(false);
  const [laptopEdit, setLaptopEdit] = useState(null);
  const [laptopRefresh, setLaptopRefresh] = useState(0);
  const canClose = hasPermission('customer_billing', 'edit');
  const openClose = async () => {
    try {
      const { data } = await fetchClosureCheck(customerId);
      setClosing({ check: data.data, note: '', ref: '' });
    } catch (e) { toast.error(errMsg(e)); }
  };
  const confirmClose = async () => {
    setBusy(true);
    try {
      const { data } = await closeCustomerAccount(customerId, { note: closing.note, refund_reference: closing.ref });
      toast.success(data.message);
      setClosing(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const load = useCallback(() => {
    fetchCustomer(customerId).then(({ data }) => setC(data.data)).catch((e) => setC({ error: errMsg(e) }));
    // The full profile (contacts, PAN, shipping, portal) comes from the record API the old page used.
    fetchCustomerProfile(customerId).then(({ data }) => setProfile(data.customer)).catch(() => setProfile(null));
  }, [customerId]);
  useEffect(() => { load(); }, [load]);
  const onCounts = useCallback((x) => { if (x) setCounts(x); }, []);

  const saveTag = async () => {
    setBusy(true);
    try {
      await setCustomerTag(customerId, tagEdit.value, tagEdit.reason);
      toast.success(tagEdit.value === 'auto' ? 'Tag follows their orders again' : 'Tag set');
      setTagEdit(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const toggleStatus = async () => {
    const active = Number(c.status ?? 1) === 1;
    try {
      const { data } = await setCustomerStatus(customerId, active ? 0 : 1);
      toast.success(data?.message || (active ? 'Customer deactivated' : 'Customer activated'));
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const verifyKyc = async () => {
    setBusy(true);
    try { await verifyCustomerKyc(customerId); toast.success('KYC verified'); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  if (!c) return <DeskShell title="Customer" breadcrumb="Sell / Customers"><EmptyState title="Loading…" /></DeskShell>;
  if (c.error) return <DeskShell title="Customer" breadcrumb="Sell / Customers"><EmptyState title="Not available" body={c.error} /></DeskShell>;

  const address = [c.billing_address, c.billing_city, c.billing_state, c.billing_pincode].filter(Boolean).join(', ');
  const tabs = [
    { key: 'rented', label: 'On rent', count: counts?.active ?? (c.rented_count + c.demo_count + c.on_the_way_count) },
    { key: 'returned', label: 'Rental returns', count: counts?.returned },
    { key: 'purchased', label: 'Purchased', count: counts?.purchased ?? c.sold_count },
    { key: 'orders', label: 'Orders', count: c.order_count },
    { key: 'tickets', label: 'Support tickets', count: c.open_tickets || undefined },
    ...(canAccount ? [{ key: 'account', label: 'Account' }] : []),
    { key: 'profile', label: 'Profile' },
    { key: 'addresses', label: 'Addresses' },
    ...(canDocs ? [{ key: 'documents', label: 'Documents' }] : []),
    { key: 'portal', label: 'Portal' },
  ];
  const active = Number(c.status ?? 1) === 1;
  const kycDone = c.kyc_verified || c.kyc_status === 'verified';

  return (
    <DeskShell
      title={c.display_name}
      breadcrumb="Sell / Customers"
      actions={(
        <div className="flex flex-wrap" style={{ gap: '6px' }}>
          {canEdit && <Button disabled={!profile} onClick={() => setEditing(true)}>Edit profile…</Button>}
          {canKyc && !kycDone && <Button disabled={busy} onClick={verifyKyc}>Verify KYC</Button>}
          {canTag && <Button onClick={() => setTagEdit({ value: c.customer_type_source === 'manual' ? c.customer_type : 'auto', reason: '' })}>Tag…</Button>}
          {canEdit && <Button variant="quiet" onClick={() => setStatusAsk(true)}>{active ? 'Deactivate…' : 'Activate…'}</Button>}
          {canClose && !c.closed_at && <Button variant="quiet" onClick={openClose}>Close account…</Button>}
        </div>
      )}
    >
      <div className="c-stack">
        {c.closed_at && <Notice tone="info" title="Account closed">Closed on <DateTime value={c.closed_at} />{c.close_note ? ` — ${c.close_note}` : ''}. The security deposit was settled on closure.</Notice>}
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <TagBadge type={c.customer_type} source={c.customer_type_source} />
          <span className="text-ink-3">#{c.customer_id}{Number(c.status ?? 1) !== 1 ? ' · inactive' : ''}{c.kyc_verified ? ' · KYC verified' : ' · KYC pending'}{c.portal_enabled ? ' · portal on' : ''}</span>
          {c.customer_type_source === 'manual' && <span className="text-ink-3">· tag set by {c.type_set_by_name || 'an admin'}{c.customer_type_reason ? ` — ${c.customer_type_reason}` : ''}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
          <StatTile label="On rent" value={c.rented_count} />
          <StatTile label="Rent / month" value={<Money value={c.monthly_rent} />} />
          <StatTile label="In lock-in" value={c.in_lock_in} />
          <StatTile label="Bought" value={c.sold_count} />
          <StatTile label="Returns" value={c.return_count} />
          <StatTile label="Security held" value={<Money value={c.security_held} />} />
          <StatTile label="Outstanding" value={<Money value={c.outstanding} />} />
        </div>
        <Panel title="Contact">
          <div className="c-card-b">
            <KeyValue
              cols={3}
              items={[
                { label: 'Contact', value: c.details?.contact_person || c.name },
                { label: 'Phone', value: c.phone },
                { label: 'Email', value: c.email },
                { label: 'GST', value: c.gst_no },
                { label: 'Billing address', value: address },
                { label: 'Billing', value: [c.billing_type, c.billing_frequency].filter(Boolean).join(' · ') },
                { label: 'Customer since', value: <DateTime value={c.onboarded_at || c.created_at} /> },
                c.source_lead_id && { label: 'From lead', value: <Link to={`/carret/sell/leads/${c.source_lead_id}`}>Lead #{c.source_lead_id}</Link> },
              ]}
            />
          </div>
        </Panel>
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {LAPTOP_TABS[tab] && (
          <LaptopsTab
            key={tab}
            customerId={c.customer_id}
            kind={tab}
            onCounts={onCounts}
            canEdit={canEditLaptop}
            canSaleInPlace={canSaleInPlace}
            onEdit={setLaptopEdit}
            refreshKey={laptopRefresh}
          />
        )}
        {(tab === 'rented' || tab === 'returned') && <LaptopActivity customerId={c.customer_id} refreshKey={laptopRefresh} />}
        {tab === 'orders' && <OrdersTab customerId={c.customer_id} />}
        {tab === 'tickets' && <TicketsTab customerId={c.customer_id} />}
        {tab === 'account' && <AccountTab customerId={c.customer_id} />}
        {tab === 'profile' && <ProfileTab c={profile} canEdit={canEdit} onEdit={() => setEditing(true)} />}
        {tab === 'addresses' && (profile ? <AddressesTab customer={profile} canEdit={canEdit} onEditProfile={() => setEditing(true)} /> : <EmptyState title="Loading…" />)}
        {tab === 'documents' && (profile ? <DocumentsTab customer={profile} canUpload={hasPermission('customer_documents', 'create')} canDelete={hasPermission('customer_documents', 'delete')} /> : <EmptyState title="Loading…" />)}
        {tab === 'portal' && (profile ? <PortalTab customer={profile} canEdit={canEdit} isSuperAdmin={isSuperAdmin} onChanged={load} /> : <EmptyState title="Loading…" />)}
      </div>

      <ProfileDrawer open={editing} customer={profile} onClose={() => setEditing(false)} onSaved={load} />
      <LaptopEditDrawer
        customerId={c.customer_id}
        laptop={laptopEdit}
        kind={tab}
        onClose={() => setLaptopEdit(null)}
        onSaved={() => setLaptopRefresh((n) => n + 1)}
      />
      <ConfirmDialog
        open={statusAsk}
        onClose={() => setStatusAsk(false)}
        onConfirm={toggleStatus}
        title={active ? 'Deactivate this customer?' : 'Activate this customer?'}
        body={active
          ? 'An inactive customer no longer appears in the quotation, sales order, support and other pickers. Laptops, invoices and history stay as they are.'
          : 'The customer appears in the quotation, sales order and support pickers again.'}
        confirmLabel={active ? 'Deactivate' : 'Activate'}
        tone={active ? 'serious' : 'good'}
      />

      <Drawer open={Boolean(closing)} onClose={() => setClosing(null)} title="Close account" footer={<Button variant="primary" disabled={busy || !closing || closing.check.blockers.length > 0 || closing.note.trim().length < 3} onClick={confirmClose}>Close account and refund</Button>}>
        {closing && (
          <div className="c-stack">
            <p>The security deposit is refunded only when the account closes. Anything the customer owes is kept from it.</p>
            {closing.check.blockers.length > 0
              ? <Notice tone="warn" title="Cannot close yet">{closing.check.blockers.join('; ')}.</Notice>
              : <Notice tone="good" title="Ready to close">No laptops with the customer, no open pickups, charges or damage.</Notice>}
            <KeyValue
              cols={3}
              items={[
                { label: 'Security held', value: <Money value={closing.check.security_held} /> },
                { label: 'Outstanding', value: <Money value={closing.check.outstanding} /> },
                { label: 'To refund', value: <Money value={closing.check.refundable} /> },
              ]}
            />
            <Field label="Refund reference (UTR / cheque)"><Input value={closing.ref} onChange={(e) => setClosing({ ...closing, ref: e.target.value })} /></Field>
            <Field label="Why the account is closing" required><Textarea rows={2} value={closing.note} onChange={(e) => setClosing({ ...closing, note: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer open={Boolean(tagEdit)} onClose={() => setTagEdit(null)} title="Customer tag" footer={<Button variant="primary" disabled={busy || (tagEdit?.value !== 'auto' && (tagEdit?.reason || '').trim().length < 3)} onClick={saveTag}>Save</Button>}>
        {tagEdit && (
          <div className="c-stack">
            <p>The tag normally follows their orders: a rental order makes them Rental, a sale order Sales, both makes them Rental + Sales. Set it by hand only to limit what can be quoted to them.</p>
            <Field label="Tag">
              <Select value={tagEdit.value} onChange={(e) => setTagEdit({ ...tagEdit, value: e.target.value })} options={[{ value: 'auto', label: 'Automatic — follow their orders' }, { value: 'rental', label: 'Rental only' }, { value: 'sales', label: 'Sales only' }, { value: 'both', label: 'Rental + Sales' }]} />
            </Field>
            {tagEdit.value !== 'auto' && <Field label="Why" required><Textarea rows={2} value={tagEdit.reason} onChange={(e) => setTagEdit({ ...tagEdit, reason: e.target.value })} /></Field>}
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

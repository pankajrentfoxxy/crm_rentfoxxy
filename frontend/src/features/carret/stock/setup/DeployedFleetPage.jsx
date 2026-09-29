import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Money, Panel, StatusChip, Tabs,
} from '../../../../components/carret';
import useDebouncedValue from '../../../../hooks/useDebouncedValue';
import { fetchCustomerAssets } from '../../../inventory-management/inventoryManagementApi';
import { errMsg } from './partsApi';

const LIMIT = 50;
const STATES = [
  { key: '', label: 'All' },
  { key: 'reserved', label: 'Allocated' },
  { key: 'dispatch_ready', label: 'Dispatch ready' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'rented', label: 'On rent' },
  { key: 'on_demo', label: 'On demo' },
  { key: 'sold', label: 'Sold' },
  { key: 'out_stock', label: 'Out stock (old)' },
];
const enc = encodeURIComponent;
const stop = (e) => e.stopPropagation();

/**
 * Stock → With customers (old: /inventory-management/customer-assets, the
 * "Deployed fleet"). Every laptop allocated to, on the way to, or with a
 * customer: state tabs with counts, delivered-date range, customer, challan
 * and the order behind it, entity, dispatch / delivery / rent dates and rate.
 *
 * Not folded into Stock → Assets ("With customers" view): that page is
 * inventory_management, this list is customer_inventory — merging would lock
 * out people who have only the fleet — and Assets has no state breakdown,
 * delivered-date filter, entity or dispatch/delivery dates.
 */
export default function DeployedFleetPage() {
  const [params, setParams] = useSearchParams();
  const status = STATES.some((s) => s.key === params.get('status')) ? params.get('status') || '' : '';
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim(), 320);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);

  useEffect(() => { setPage(1); }, [search, status, from, to]);
  useEffect(() => {
    setRes(null);
    fetchCustomerAssets({
      status: status || undefined, search: search || undefined, from: from || undefined, to: to || undefined, page, limit: LIMIT,
    })
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ data: [], counts: {}, pagination: {} }); toast.error(errMsg(e)); });
  }, [status, search, from, to, page]);

  const counts = res?.counts || {};
  const cols = [
    {
      key: 't',
      header: 'Laptop',
      render: (r) => <Link to={`/carret/stock/assets/${enc(r.ttspl_id || r.serial_number)}`} onClick={stop}><DocNumber value={r.ttspl_id || r.serial_number} /></Link>,
      sub: (r) => (r.ttspl_id ? r.serial_number : null),
    },
    { key: 'm', header: 'Model', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—', sub: (r) => [r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ') || null },
    {
      key: 'c',
      header: 'Customer',
      render: (r) => (r.customer_id
        ? <Link to={`/carret/sell/customers/${r.customer_id}`} onClick={stop}>{r.company_name || r.customer_name || `#${r.customer_id}`}</Link>
        : <span className="text-ink-3">none on record</span>),
      sub: (r) => (r.entity_code ? String(r.entity_code) : null),
    },
    { key: 's', header: 'State', render: (r) => <StatusChip status={r.inventory_status} />, sub: (r) => (r.status_changed_at ? <>since <DateTime value={r.status_changed_at} /></> : null) },
    {
      key: 'd',
      header: 'Challan / order',
      render: (r) => (r.dc_number ? <Link to={`/carret/move/challans/${enc(r.dc_number)}`} onClick={stop}><DocNumber value={r.dc_number} /></Link> : '—'),
      sub: (r) => (r.sales_order_number ? <Link to={`/carret/sell/sales-orders/${enc(r.sales_order_number)}`} onClick={stop}>{r.sales_order_number}</Link> : null),
    },
    { key: 'x', header: 'Dispatched', render: (r) => <DateTime value={r.dispatched_at} />, sub: (r) => (r.dispatch_mode ? String(r.dispatch_mode).replace(/_/g, ' ') : null) },
    { key: 'y', header: 'Delivered', render: (r) => <DateTime value={r.delivered_at} />, sub: (r) => (r.rent_start_date ? <>rent from <DateTime value={r.rent_start_date} /></> : null) },
    {
      key: 'r',
      header: 'Rent / month',
      numeric: true,
      render: (r) => (r.purchase_order_type === 'direct_purchase' || r.inventory_status === 'sold'
        ? <span className="text-ink-3">—</span>
        : <Money value={r.rent_monthly_rate} showZero={false} />),
    },
  ];
  const pages = res?.pagination?.totalPages || 1;

  return (
    <DeskShell title="With customers" breadcrumb="Stock" subtitle="Every laptop allocated to, on its way to, or with a customer — live from the asset register.">
      <div className="c-stack">
        <Tabs
          value={status}
          onChange={(k) => setParams(k ? { status: k } : {}, { replace: true })}
          tabs={STATES.map((s) => ({ key: s.key, label: s.label, count: res ? (s.key ? counts[s.key] : counts.all) ?? 0 : null }))}
        />
        <Panel
          toolbar={(
            <div className="c-toolbar">
              <Input type="search" placeholder="TTSPL, serial, customer, model or challan" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '20rem' }} />
              <Input type="date" aria-label="Delivered from" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: '10rem' }} />
              <Input type="date" aria-label="Delivered to" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: '10rem' }} />
              {(from || to) && <Button variant="quiet" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</Button>}
              <span className="text-ink-3">{res ? `${(res.pagination?.total ?? 0).toLocaleString('en-IN')} laptops` : ''}</span>
            </div>
          )}
        >
          {res === null ? <EmptyState title="Loading…" /> : (
            <div className="c-stack">
              <DataTable columns={cols} rows={res.data || []} rowKey={(r) => r.serial_id} empty={<EmptyState title="No laptops with customers match" />} />
              {pages > 1 && (
                <div className="flex items-center" style={{ gap: '8px' }}>
                  <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  <span className="text-ink-3">Page {page} of {pages}</span>
                  <Button variant="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </DeskShell>
  );
}

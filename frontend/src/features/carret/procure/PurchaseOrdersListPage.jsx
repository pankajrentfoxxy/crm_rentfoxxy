import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Money, Panel, SearchSelect, Select, StatTile, StatusChip, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { fetchPurchaseOrders, fetchSpareOrders, fetchVendors } from '../../vendor-management/vendorManagementApi';
import SparePartsPoFormModal from '../../vendor-management/components/SparePartsPoFormModal';
import { errMsg, vendorName } from './procureShared';
import {
  PO_TABS, PO_TYPES, SPO_TABS, poBillInfo, poQty, poStatus, poStatusLabel, poTypeLabel, spoStatusLabel,
} from './poShared';

/**
 * Procure → Purchase orders.
 *
 * Tabs follow the process (draft → approval → with the vendor → receiving →
 * done), so each person opens the tab that is theirs: managers "Waiting
 * approval", the warehouse "With vendor" and "Receiving". The Received column
 * is the real count, not the ordered quantity.
 */
const PAGE = 50;
const KPI_PAGE = 200; // the list API's max page size
const clip = (t, n = 60) => { const x = String(t || '').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };

export default function PurchaseOrdersListPage({ kind = 'laptop' }) {
  const spare = kind === 'spare';
  const TABS = spare ? SPO_TABS : PO_TABS;
  const label = spare ? spoStatusLabel : poStatusLabel;
  const recordPath = spare ? '/carret/procure/spare-parts-orders' : '/carret/procure/purchase-orders';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hasPermission } = usePermission();
  const canCreate = spare
    ? ['vendor_management', 'parts_procurement'].some((s) => hasPermission(s, 'create'))
    : hasPermission('vendor_management', 'create');
  const [newSpare, setNewSpare] = useState(false);
  const [reload, setReload] = useState(0);

  const [tab, setTab] = useState('open');
  const [type, setType] = useState('');
  const [vendorId, setVendorId] = useState(params.get('vendor_id') || '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [vendors, setVendors] = useState([]);
  const [kpi, setKpi] = useState(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: null, rows: [], counts: {}, total: 0, pages: 1 });

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let off = false;
    (async () => {
      const all = [];
      let pg = 1;
      let pages = 1;
      do {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await fetchVendors({ page: pg, limit: 200 });
        all.push(...(data.data || []));
        pages = data.pagination?.totalPages || 1;
        pg += 1;
      } while (!off && pg <= pages && pg <= 20);
      if (!off) setVendors(all);
    })().catch(() => { if (!off) setVendors([]); });
    return () => { off = true; };
  }, []);

  // Filters other than the status tab: the list and the count cards share them.
  const filters = {
    vendor_id: vendorId || undefined,
    ...(spare ? {} : {
      purchase_order_type: type || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    search: q || undefined,
  };
  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let off = false;
    const statuses = TABS.find((t) => t.key === tab)?.statuses || [];
    setState((s) => ({ ...s, loading: true, error: null }));
    (spare ? fetchSpareOrders : fetchPurchaseOrders)({
      ...JSON.parse(filterKey),
      status: statuses.length ? statuses.join(',') : undefined,
      page,
      limit: PAGE,
    })
      .then(({ data }) => !off && setState({
        loading: false, error: null, rows: data.data || [], counts: data.counts || {},
        total: data.pagination?.total || 0, pages: data.pagination?.totalPages || 1,
      }))
      .catch((e) => !off && setState((s) => ({ ...s, loading: false, error: errMsg(e, 'Could not load purchase orders.') })));
    return () => { off = true; };
  }, [tab, filterKey, page, spare, TABS, reload]);

  // Count cards (as the old screen had): laptops ordered / received / pending,
  // POs awaiting approval and completed — over every PO matching the filters,
  // all statuses. The list API's own `counts` ignore the filters, so the rows
  // are walked here, 200 at a time.
  useEffect(() => {
    if (spare) return undefined;
    let off = false;
    setKpi(null);
    (async () => {
      const out = { pos: 0, ordered: 0, received: 0, pending: 0, approval: 0, completed: 0 };
      let pg = 1;
      let pages = 1;
      do {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await fetchPurchaseOrders({ ...JSON.parse(filterKey), page: pg, limit: KPI_PAGE });
        (data.data || []).forEach((r) => {
          const s = poStatus(r);
          const qn = poQty(r);
          out.pos += 1;
          out.ordered += qn.ordered;
          out.received += qn.received;
          // Nothing more is coming on a cancelled or short-closed PO.
          if (!['cancelled', 'closed'].includes(s)) out.pending += Math.max(0, qn.ordered - qn.received);
          if (s === 'pending_approval') out.approval += 1;
          if (s === 'completed') out.completed += 1;
        });
        pages = data.pagination?.totalPages || 1;
        pg += 1;
      } while (!off && pg <= pages);
      if (!off) setKpi(out);
    })().catch(() => { if (!off) setKpi(false); });
    return () => { off = true; };
  }, [spare, filterKey, reload]);

  const count = (t) => (t.statuses.length
    ? t.statuses.reduce((n, s) => n + (state.counts[s] || 0), 0)
    : Object.values(state.counts).reduce((n, c) => n + c, 0));

  const columns = [
    { key: 'no', header: 'PO', render: (r) => <DocNumber value={r.purchase_order_number} />, sub: (r) => (Number(r.amendment_no) > 0 ? `Amendment ${r.amendment_no}` : null) },
    { key: 'vendor', header: 'Vendor', render: (r) => r.vendor_display_name || r.vendor_business_name || '—' },
    spare
      ? { key: 'parts', header: 'Parts', render: (r) => (r.line_items || []).map((l) => l.spare_part_name || l.part_name).filter(Boolean).slice(0, 3).join(', ') || '—' }
      : { key: 'type', header: 'Type', render: (r) => poTypeLabel(r.purchase_order_type) },
    {
      key: 'recv',
      header: 'Received',
      numeric: true,
      render: (r) => {
        const q2 = poQty(r);
        if (!q2.ordered) return '—';
        return <span className="font-mono" style={{ color: q2.received >= q2.ordered ? 'var(--alert-good)' : q2.received ? 'var(--alert-warn)' : 'var(--ink-3)' }}>{q2.received} / {q2.ordered}</span>;
      },
    },
    ...(spare ? [] : [
      {
        key: 'pend',
        header: 'Pending',
        numeric: true,
        render: (r) => {
          const q2 = poQty(r);
          if (!q2.ordered || ['cancelled', 'closed'].includes(poStatus(r))) return <span className="text-ink-3">—</span>;
          const left = Math.max(0, q2.ordered - q2.received);
          return <span style={{ color: left ? 'var(--alert-warn)' : 'var(--ink-3)' }}>{left}</span>;
        },
      },
      {
        key: 'bill',
        header: 'Bill',
        render: (r) => {
          const b = poBillInfo(r);
          return b.name ? b.name : <span className="text-ink-3">pending</span>;
        },
        sub: (r) => {
          const b = poBillInfo(r);
          if (!b.name) return null;
          return [b.files.length ? `${b.files.length} file${b.files.length === 1 ? '' : 's'}` : null, b.source === 'vendor' ? 'vendor portal' : null].filter(Boolean).join(' · ') || null;
        },
      },
      { key: 'remark', header: 'Remark', render: (r) => (r.remarks ? <span title={r.remarks}>{clip(r.remarks)}</span> : <span className="text-ink-3">—</span>) },
    ]),
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={poStatus(r) === 'pending' && spare ? 'pending_approval' : poStatus(r)} label={label(poStatus(r))} /> },
    { key: 'value', header: 'Value', numeric: true, render: (r) => <Money value={r.total_amount} showZero={false} />, sub: (r) => (['rental_purchase', 'rent_to_own'].includes(r.purchase_order_type) ? 'per month' : null) },
    { key: 'date', header: 'Date', render: (r) => <DateTime value={r.purchase_order_date || r.created_at} />, sub: (r) => (r.expected_delivery_date ? <>due <DateTime value={r.expected_delivery_date} /></> : null) },
  ];

  return (
    <DeskShell
      title={spare ? 'Spare-parts orders' : 'Purchase orders'}
      breadcrumb="Procurement"
      subtitle={spare ? 'Parts we buy for the floor and for support, from draft to received.' : 'Laptops we buy or rent from vendors, from draft to received.'}
      actions={canCreate && (
        <Button variant="primary" onClick={() => (spare ? setNewSpare(true) : navigate('/carret/procure/purchase-orders/new'))}>
          {spare ? 'New spare-parts order' : 'New purchase order'}
        </Button>
      )}
    >
      <div className="c-stack">
        {!spare && (
          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <StatTile label="Laptops ordered" value={kpi ? kpi.ordered : (kpi === false ? null : '…')} delta={kpi ? `on ${kpi.pos} PO${kpi.pos === 1 ? '' : 's'}` : undefined} />
            <StatTile label="Laptops received" value={kpi ? kpi.received : (kpi === false ? null : '…')} />
            <StatTile label="Laptops pending" value={kpi ? kpi.pending : (kpi === false ? null : '…')} delta="still to come from vendors" />
            <StatTile label="Awaiting approval" value={kpi ? kpi.approval : (kpi === false ? null : '…')} delta="POs" />
            <StatTile label="Completed" value={kpi ? kpi.completed : (kpi === false ? null : '…')} delta="fully received POs" />
          </div>
        )}
        <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: count(t) }))} value={tab} onChange={(k) => { setTab(k); setPage(1); }} />
        <Panel
          toolbar={(
            <div className="flex items-center flex-wrap" style={{ gap: '12px', width: '100%' }}>
              <Input type="search" placeholder="PO number, vendor or remarks" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: '20rem' }} aria-label="Search purchase orders" />
              {!spare && <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} placeholder="All types" options={PO_TYPES} style={{ maxWidth: '12rem' }} aria-label="Type" />}
              <div style={{ width: '16rem', maxWidth: '100%' }}>
                <SearchSelect
                  value={vendorId}
                  onChange={(e) => { setVendorId(e.target.value); setPage(1); }}
                  placeholder="All vendors"
                  aria-label="Vendor"
                  options={[{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: String(v.vendor_id), label: vendorName(v) }))]}
                />
              </div>
              {!spare && (
                <span className="flex items-center" style={{ gap: '6px' }}>
                  <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} aria-label="PO date from" style={{ width: '10rem' }} />
                  <span className="text-ink-3">to</span>
                  <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} aria-label="PO date to" style={{ width: '10rem' }} />
                  {(dateFrom || dateTo) && <Button variant="quiet" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>Clear dates</Button>}
                </span>
              )}
              <span className="text-ink-3" style={{ marginLeft: 'auto' }}>{state.total} orders</span>
            </div>
          )}
        >
          {state.error && <EmptyState title="Could not load purchase orders" body={state.error} />}
          {!state.error && (
            <DataTable
              columns={columns}
              rows={state.rows}
              rowKey={(r) => r.po_id || r.spo_id}
              onRowClick={(r) => navigate(`${recordPath}/${spare ? r.spo_id : r.po_id}`)}
              empty={<EmptyState title={state.loading ? 'Loading…' : 'No purchase orders here'} />}
            />
          )}
          {state.pages > 1 && (
            <div className="flex items-center justify-end" style={{ gap: '8px', padding: '12px' }}>
              <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-ink-3">Page {page} of {state.pages}</span>
              <Button variant="quiet" disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </Panel>
      </div>
      {spare && (
        <SparePartsPoFormModal
          open={newSpare}
          onClose={() => setNewSpare(false)}
          onSaved={(saved) => { setReload((n) => n + 1); if (saved?.spo_id) navigate(`${recordPath}/${saved.spo_id}`); }}
        />
      )}
    </DeskShell>
  );
}

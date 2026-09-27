import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Money, Segmented, Select, StatusChip,
} from '../../components/carret';
import { ASSET_STATUSES } from '../../config/statuses';
import { errMsg, fetchAssetCounts, fetchAssets, TAG_OPTIONS } from './stock/stockApi';

/**
 * Stock → Assets (claude/carret-stock.md). Every laptop, by TTSPL: where it is,
 * its state, rent/sell tag, carret slot, customer and PO. Search covers TTSPL,
 * serial, PO number, customer and model; filters combine.
 *
 * (It read /inventory-management/lists, which does not exist, so it never loaded.)
 */
const VIEWS = [
  { value: '', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'with_customer', label: 'With customers' },
  { value: 'on_floor', label: 'Not ready yet' },
];
const LIMIT = 50;

export default function AssetsListPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [view, setView] = useState(VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : '');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [counts, setCounts] = useState(null);

  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => { fetchAssetCounts().then(({ data }) => setCounts(data.data)).catch(() => {}); }, []);
  const load = useCallback(() => {
    setRes(null);
    fetchAssets({ view: view || undefined, status: status || undefined, tag: tag || undefined, search: search || undefined, page, limit: LIMIT })
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ data: [], total: 0 }); toast.error(errMsg(e)); });
  }, [view, status, tag, search, page]);
  useEffect(() => { load(); }, [load]);

  const cols = [
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id || r.serial_number} />, sub: (r) => r.model_name },
    { key: 'c', header: 'Configuration', render: (r) => [r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ') || '—' },
    { key: 's', header: 'State', render: (r) => <StatusChip status={r.inventory_status} />, sub: (r) => (r.inventory_status === 'in_stock' ? (r.is_ready ? 'ready' : `QC: ${r.qc_status || '—'}`) : null) },
    { key: 'w', header: 'Where', render: (r) => r.customer_name || r.location || '—', sub: (r) => (r.customer_name ? r.current_dc_number : (r.tag_label ? `for ${r.tag_label.toLowerCase()}` : null)) },
    // Only what it earns now: a laptop back in stock keeps its last customer's
    // rate on the row, which is not rent (the backend blanks it outside rental).
    { key: 'r', header: 'Rent / month', numeric: true, render: (r) => (r.inventory_status === 'sold' ? <span className="text-ink-3">Sold</span> : <Money value={r.rent_monthly_rate} showZero={false} />) },
    { key: 'p', header: 'Bought on', render: (r) => r.purchase_order_number || '—', sub: (r) => r.vendor_name },
    { key: 'u', header: 'Since', render: (r) => <DateTime value={r.status_changed_at || r.updated_at} /> },
  ];

  const pages = res ? Math.max(1, Math.ceil((res.total || 0) / LIMIT)) : 1;
  const by = counts?.by_status || {};
  return (
    <DeskShell title="Assets" breadcrumb="Stock" subtitle="Every laptop by TTSPL — where it is, its state, and what it earns.">
      <div className="c-stack">
        {counts && (
          <p className="text-ink-3">
            {counts.total.toLocaleString('en-IN')} laptops · {counts.with_customer.toLocaleString('en-IN')} with customers ·
            {' '}{counts.ready} ready · {(by.in_stock || 0) - counts.ready} in stock not ready · {by.in_repair || 0} in repair ·
            {' '}{by.returned || 0} returned · {by.scrapped || 0} scrapped
          </p>
        )}
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="View" value={view} onChange={(v) => { setView(v); setPage(1); }} options={VIEWS} />
          <Input type="search" placeholder="TTSPL, serial, PO, customer or model" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '20rem' }} />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="Any state" options={ASSET_STATUSES.map((s) => ({ value: s.value, label: s.label }))} style={{ maxWidth: '12rem' }} />
          <Select value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }} placeholder="Any tag" options={[...TAG_OPTIONS, { value: 'none', label: 'Not tagged' }]} style={{ maxWidth: '10rem' }} />
          <span className="text-ink-3">{res ? `${res.total.toLocaleString('en-IN')} found` : ''}</span>
        </div>
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={res.data || []}
            rowKey={(r) => r.serial_id}
            onRowClick={(r) => navigate(`/carret/stock/assets/${encodeURIComponent(r.ttspl_id || r.serial_number)}`)}
            empty={<EmptyState title="No laptops match" body="Filters combine — clear one to widen the list." />}
          />
        )}
        {pages > 1 && (
          <div className="flex items-center" style={{ gap: '8px' }}>
            <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-ink-3">Page {page} of {pages}</span>
            <Button variant="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>
    </DeskShell>
  );
}

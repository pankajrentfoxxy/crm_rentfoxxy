import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  DataTable, DocNumber, EmptyState, Input, Money, Notice, Segmented, StatTile, StatusChip,
} from '../../../components/carret';
import { errMsg, fetchNotEarning } from './stockApi';

/**
 * Stock → Not earning (claude/carret-stock.md, ST-D1; was "NPA Assets", a
 * placeholder). Laptops not earning rent or sold for more than N days: in
 * stock, in repair, returned waiting for QC, at a vendor, on free demo — or
 * "rented" with no customer, no rate, or not billed. For vendor-rented laptops
 * the cost is the rent we keep paying the vendor.
 */
export default function NotEarningPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState('30');
  const [res, setRes] = useState(null);
  const [reason, setReason] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setRes(null);
    fetchNotEarning(days).then(({ data }) => setRes(data)).catch((e) => { setRes({ data: [], summary: { by_reason: {} } }); toast.error(errMsg(e)); });
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const reasons = Object.entries(res?.summary?.by_reason || {}).sort((a, b) => b[1] - a[1]);
  const rows = useMemo(() => {
    let list = res?.data || [];
    if (reason !== 'all') list = list.filter((r) => r.reason === reason);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((r) => [r.ttspl_id, r.serial_number, r.model_name, r.customer_name, r.vendor_name, r.purchase_order_number].join(' ').toLowerCase().includes(t));
    return list;
  }, [res, reason, q]);

  const cols = [
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id || r.serial_number} />, sub: (r) => r.model_name },
    { key: 'r', header: 'Why not earning', render: (r) => r.reason, sub: (r) => r.customer_name || r.location || null },
    { key: 's', header: 'State', render: (r) => <StatusChip status={r.inventory_status} /> },
    { key: 'd', header: 'Idle', numeric: true, render: (r) => `${r.idle_days} days` },
    { key: 'c', header: 'Cost', numeric: true, render: (r) => (r.cost != null ? <Money value={r.cost} /> : '—'), sub: (r) => (r.cost != null ? (r.cost_type === 'vendor_rent' ? 'vendor rent / month' : 'bought for') : null) },
    { key: 'p', header: 'PO', render: (r) => r.purchase_order_number || '—', sub: (r) => r.vendor_name },
  ];

  const sm = res?.summary || {};
  return (
    <DeskShell title="Not earning" breadcrumb="Stock" subtitle="Laptops that have not earned rent or been sold for a while — and what they cost us.">
      <div className="c-stack">
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Idle for more than" value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]} />
          <Input type="search" placeholder="TTSPL, model, customer, vendor, PO" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} />
        </div>
        {res && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
            <StatTile label="Laptops not earning" value={sm.total ?? 0} />
            <StatTile label="Vendor rent we pay / month" value={<Money value={sm.vendor_rent_per_month} />} />
            <StatTile label="Bought laptops, value" value={<Money value={sm.purchase_value} />} />
          </div>
        )}
        {res && sm.total > 0 && (
          <Notice tone="info">
            “Rented” laptops count here when they have no customer, no rate, or have not been billed for {days} days — those are data problems to fix (see the clean-up list), not idle stock.
          </Notice>
        )}
        {reasons.length > 0 && (
          <Segmented label="Why" value={reason} onChange={setReason} options={[{ value: 'all', label: `All (${sm.total})` }, ...reasons.map(([k, n]) => ({ value: k, label: `${k} (${n})` }))]} />
        )}
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(r) => r.serial_id}
            onRowClick={(r) => navigate(`/carret/stock/assets/${encodeURIComponent(r.ttspl_id || r.serial_number)}`)}
            empty={<EmptyState title="Every laptop is earning" />}
          />
        )}
      </div>
    </DeskShell>
  );
}

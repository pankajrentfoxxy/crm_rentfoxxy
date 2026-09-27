import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, EmptyState, Input, Notice, Segmented, StatTile,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { errMsg, fetchReadyStock, sendToQc } from './stockApi';
import { LocationDrawer, RetagDrawer } from './StockActions';

/**
 * Stock → Ready stock (claude/carret-stock.md, ST-D3). QC-passed laptops that
 * can go on an order. Each must carry a tag (Rent / Sell / Rent or sell) and a
 * carret slot; the warehouse re-tags or moves them with a reason. Laptops
 * missing either are listed first. Replaces "Ready to Rent or Sell" (old view).
 */
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs tag / slot' },
  { value: 'rental', label: 'Rent' },
  { value: 'sale', label: 'Sell' },
  { value: 'both', label: 'Rent or sell' },
];

function toCsv(rows) {
  const head = ['TTSPL', 'Serial', 'Model', 'Processor', 'RAM', 'Storage', 'Use for', 'Slot', 'PO', 'Vendor'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head.join(','), ...rows.map((r) => [r.ttspl_id, r.serial_number, r.model_name, r.processor, r.ram, r.storage, r.tag_label, r.location, r.purchase_order_number, r.vendor_name].map(esc).join(','))].join('\n');
}

export default function ReadyStockPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canWarehouse = hasPermission('ready_to_rent_location', 'edit');
  const canSendToQc = hasPermission('inventory_management', 'edit');
  const [res, setRes] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState({});
  const [tagFor, setTagFor] = useState(null);
  const [slotFor, setSlotFor] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    fetchReadyStock().then(({ data }) => { setRes(data); setPicked({}); }).catch((e) => { setRes({ data: [], summary: {} }); toast.error(errMsg(e)); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    let list = res?.data || [];
    if (filter === 'attention') list = list.filter((r) => !r.tag || !r.warehouse_carret);
    else if (filter !== 'all') list = list.filter((r) => r.tag === filter);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((r) => [r.ttspl_id, r.serial_number, r.model_name, r.processor, r.location].join(' ').toLowerCase().includes(t));
    // Missing tag or slot first.
    return [...list].sort((a, b) => Number(Boolean(a.tag && a.warehouse_carret)) - Number(Boolean(b.tag && b.warehouse_carret)));
  }, [res, filter, q]);
  const chosen = rows.filter((r) => picked[r.serial_id]);

  const qc = async (r) => {
    if (!window.confirm(`Send ${r.ttspl_id} back to QC? It leaves ready stock and its slot is freed.`)) return;
    setBusy(r.serial_id);
    try { await sendToQc(r.serial_id, r.serial_number); toast.success(`${r.ttspl_id} sent to QC`); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ready-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const s = res?.summary || {};
  const cols = [
    ...(canWarehouse ? [{ key: 'x', header: '', width: '2.5rem', render: (r) => <input type="checkbox" aria-label={`Pick ${r.ttspl_id}`} checked={Boolean(picked[r.serial_id])} onChange={() => setPicked({ ...picked, [r.serial_id]: !picked[r.serial_id] })} onClick={(e) => e.stopPropagation()} /> }] : []),
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => r.model_name },
    { key: 'c', header: 'Configuration', render: (r) => [r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ') || '—' },
    { key: 'g', header: 'Use for', render: (r) => r.tag_label || <span style={{ color: 'var(--alert-warn)', fontWeight: 600 }}>Not tagged</span> },
    { key: 'l', header: 'Slot', render: (r) => r.location || <span style={{ color: 'var(--alert-warn)', fontWeight: 600 }}>No slot</span> },
    { key: 'p', header: 'PO', render: (r) => r.purchase_order_number || '—', sub: (r) => r.vendor_name },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <div className="flex" style={{ gap: '4px', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()} role="presentation">
          {canWarehouse && <Button variant="quiet" onClick={() => setTagFor([r])}>Tag</Button>}
          {canWarehouse && <Button variant="quiet" onClick={() => setSlotFor(r)}>{r.location ? 'Move' : 'Slot'}</Button>}
          {canSendToQc && <Button variant="quiet" disabled={busy === r.serial_id} onClick={() => qc(r)}>Send to QC</Button>}
        </div>
      ),
    },
  ];

  return (
    <DeskShell title="Ready stock" breadcrumb="Stock" subtitle="QC-passed laptops that can go on an order — each with a use (rent / sell) and a carret slot.">
      <div className="c-stack">
        {res && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            <StatTile label="Ready" value={s.total ?? 0} />
            <StatTile label="For rent" value={s.rental ?? 0} />
            <StatTile label="For sale" value={s.sale ?? 0} />
            <StatTile label="Rent or sell" value={s.both ?? 0} />
            <StatTile label="Not tagged" value={s.untagged ?? 0} />
            <StatTile label="No slot" value={s.no_slot ?? 0} />
          </div>
        )}
        {(s.untagged > 0 || s.no_slot > 0) && (
          <Notice tone="warn" title="Every ready laptop needs a use and a slot">
            {s.untagged} not tagged, {s.no_slot} without a carret slot. Tag them and give them a slot so sales can see them and the warehouse can find them.
          </Notice>
        )}
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS} />
          <Input type="search" placeholder="TTSPL, serial, model or slot" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} />
          {canWarehouse && chosen.length > 0 && <Button variant="primary" onClick={() => setTagFor(chosen)}>Tag {chosen.length} picked</Button>}
          <Button variant="quiet" onClick={exportCsv} disabled={!rows.length}>Export</Button>
        </div>
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(r) => r.serial_id}
            onRowClick={(r) => navigate(`/carret/stock/assets/${encodeURIComponent(r.ttspl_id || r.serial_number)}`)}
            empty={<EmptyState title="No ready laptops here" />}
          />
        )}
      </div>
      <RetagDrawer laptops={tagFor} onClose={() => setTagFor(null)} onDone={() => { setTagFor(null); load(); }} />
      <LocationDrawer laptop={slotFor} onClose={() => setSlotFor(null)} onDone={() => { setSlotFor(null); load(); }} />
    </DeskShell>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  DataTable, DocNumber, Drawer, EmptyState, Input, Money, Notice, Section, Select, StatTile, StatusChip,
} from '../../../components/carret';
import { fetchVendorRentalLaptops, fetchVendorRentalSummary } from '../../floor-pipeline/vendorRepairApi';
import { errMsg } from './procureShared';

/**
 * Procure → Vendor rentals (claude/carret-vendor-repair.md) — for each vendor,
 * the laptops we rent from them and where each one is now: with customers,
 * in stock, in production, at the vendor for repair (rent stopped), returned,
 * and every replacement with the laptop it replaced.
 */
const BUCKET_LABEL = {
  with_customer: 'With customers',
  going_out: 'Going out',
  in_stock: 'In stock',
  in_production: 'In production / back from customer',
  at_vendor_repair: 'At vendor for repair',
  returned: 'Returned to vendor',
  bought_or_gone: 'Bought out / sold / scrapped',
};
const TILES = [
  ['total', 'Rented from vendor', null],
  ['returned', 'Returned', 'returned'],
  ['replacements', 'Replacements', 'replacements'],
  ['with_customer', 'With customers', 'with_customer'],
  ['in_stock', 'In stock', 'in_stock'],
  ['in_production', 'In production', 'in_production'],
  ['at_vendor_repair', 'At vendor for repair', 'at_vendor_repair'],
  ['billing_now', 'Billing now', null],
];
const pretty = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

export default function VendorRentalsPage() {
  const [rows, setRows] = useState(null);
  const [vendorId, setVendorId] = useState('');
  const [drill, setDrill] = useState(null); // { bucket|'replacements', title }
  const [list, setList] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchVendorRentalSummary()
      .then(({ data }) => setRows(data.data || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load')); });
  }, []);

  const shown = useMemo(() => (rows || []).filter((r) => !vendorId || String(r.vendor_id) === String(vendorId)), [rows, vendorId]);
  const totals = useMemo(() => shown.reduce((acc, r) => {
    for (const [k] of TILES) acc[k] = (acc[k] || 0) + Number(r[k] || 0);
    acc.monthly_rent_now = (acc.monthly_rent_now || 0) + Number(r.monthly_rent_now || 0);
    acc.awaiting_approval = (acc.awaiting_approval || 0) + Number(r.awaiting_approval || 0);
    acc.back_not_received = (acc.back_not_received || 0) + Number(r.back_not_received || 0);
    acc.rent_paused = (acc.rent_paused || 0) + Number(r.rent_paused || 0);
    return acc;
  }, {}), [shown]);

  const loadList = useCallback(() => {
    if (!drill) return;
    setList(null);
    fetchVendorRentalLaptops({
      vendor_id: drill.vendorId || vendorId || undefined,
      bucket: drill.key === 'replacements' ? undefined : drill.key || undefined,
      replacements: drill.key === 'replacements' ? 1 : undefined,
      search: search || undefined,
    })
      .then(({ data }) => setList(data.data || []))
      .catch((e) => { setList([]); toast.error(errMsg(e, 'Could not load')); });
  }, [drill, vendorId, search]);
  useEffect(() => {
    const t = setTimeout(loadList, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadList, search]);

  const open = (key, title, vid) => { setSearch(''); setDrill({ key, title, vendorId: vid }); };

  const vendorCols = [
    { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
    ...[['total', 'Rented'], ['returned', 'Returned'], ['replacements', 'Replacements'], ['with_customer', 'With customers'], ['in_stock', 'In stock'], ['in_production', 'In production'], ['at_vendor_repair', 'At vendor']].map(([k, h]) => ({
      key: k,
      header: h,
      numeric: true,
      render: (r) => (Number(r[k]) ? (
        <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); open(k === 'total' ? '' : k, `${r.vendor_name} — ${h}`, r.vendor_id); }}>{r[k]}</button>
      ) : '0'),
    })),
    { key: 'b', header: 'Billing now', numeric: true, render: (r) => r.billing_now, sub: (r) => (r.rent_paused ? `${r.rent_paused} paused` : null) },
    { key: 'm', header: 'Rent / month now', numeric: true, render: (r) => <Money value={r.monthly_rent_now} /> },
  ];

  const listCols = [
    { key: 't', header: 'Asset', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => r.serial_number },
    { key: 'l', header: 'Laptop', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—', sub: (r) => `${r.vendor_name} · ${r.po_number || ''}` },
    { key: 'w', header: 'Where', render: (r) => BUCKET_LABEL[r.bucket] || r.bucket, sub: (r) => r.customer_name || (r.repair_dc_number ? `${r.repair_dc_number}${r.repair_item_status === 'replacement_pending' ? ' · replacement waiting approval' : ''}` : null) },
    {
      key: 'r',
      header: 'Replacement',
      render: (r) => (r.is_replacement
        ? <span>Replaced <span className="font-mono">{r.replaced_ttspl_id || r.replaced_serial || '—'}</span></span>
        : (r.replaced_by_ttspl ? <span>Replaced by <span className="font-mono">{r.replaced_by_ttspl}</span></span> : '—')),
      sub: (r) => r.replacement_dc_number || null,
    },
    { key: 'd', header: 'Rent', render: (r) => `${pretty(r.rent_from)} → ${r.rent_to ? pretty(r.rent_to) : 'running'}`, sub: (r) => (r.rent_paused_from ? `paused since ${pretty(r.rent_paused_from)}` : null) },
    { key: 'm', header: 'Rent / month', numeric: true, render: (r) => <Money value={r.monthly_rent} showZero={false} />, sub: (r) => (r.billing_now ? null : 'not billing') },
    { key: 's', header: 'Status', render: (r) => <StatusChip status={r.inventory_status} /> },
  ];

  return (
    <DeskShell title="Vendor rentals" breadcrumb="Procure" subtitle="What we rent from each vendor, and where every laptop is today.">
      <div className="c-stack">
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            placeholder="All vendors"
            options={(rows || []).map((r) => ({ value: String(r.vendor_id), label: r.vendor_name }))}
            style={{ maxWidth: '22rem' }}
            aria-label="Vendor"
          />
          <span className="text-ink-3">Rent now: <Money value={totals.monthly_rent_now || 0} /> / month</span>
        </div>
        {(totals.awaiting_approval > 0 || totals.back_not_received > 0) && (
          <Notice tone="warn">
            {totals.awaiting_approval > 0 && <>{totals.awaiting_approval} replacement(s) waiting for approval. </>}
            {totals.back_not_received > 0 && <>{totals.back_not_received} laptop(s) back at the gate but not yet received — their rent resumes from the gate-in date once received; receive them before generating vendor bills.</>}
          </Notice>
        )}
        <div className="c-form-grid" style={{ '--c-cols': 4 }}>
          {TILES.map(([k, label, drillKey]) => (
            <button key={k} type="button" className="text-left" disabled={!drillKey} onClick={() => drillKey && open(drillKey, label)}>
              <StatTile label={label} value={rows === null ? '…' : (totals[k] || 0)} />
            </button>
          ))}
        </div>
        <Section title="By vendor">
          {rows === null ? <EmptyState title="Loading…" /> : (
            <DataTable columns={vendorCols} rows={shown} rowKey={(r) => r.vendor_id} empty={<EmptyState title="No rented laptops" />} />
          )}
        </Section>
        <p className="text-ink-3" style={{ fontSize: '13px' }}>
          Rented = every laptop received on the vendor's rental POs, replacements included. Returned = returned to the vendor (return
          requests, replaced originals, and laptops the vendor kept). Billing now = rent running today (not paused, not ended).
        </p>
      </div>
      <Drawer open={Boolean(drill)} onClose={() => setDrill(null)} title={drill?.title || ''} width="min(68rem, 100vw)">
        <div className="c-stack">
          <Input type="search" placeholder="TTSPL or serial" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          {list === null ? <EmptyState title="Loading…" /> : <DataTable columns={listCols} rows={list} rowKey={(r) => r.serial_id} empty={<EmptyState title="None" />} />}
        </div>
      </Drawer>
    </DeskShell>
  );
}

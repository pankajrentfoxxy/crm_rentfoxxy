import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Notice, Section, Select, StatTile, StatusChip, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { errMsg } from './procureShared';

/**
 * Procure → To buy.
 *
 * Everything procurement has been asked to buy, in one list:
 *   - laptops a sales order is waiting for (no matching stock when it was accepted);
 *   - parts the floor escalated to procurement.
 *
 * Each need is linked to the PO that buys it, so "has anyone ordered this?"
 * has an answer. When a matching laptop is in stock, the order says so and one
 * click hands it back to dispatch — before this, parked orders never moved on
 * by themselves.
 */
const base = '/vendor-management/to-buy';
const cfg = (l) => [l.brand, l.model_name, l.processor, l.generation, l.ram, l.storage].filter(Boolean).join(' · ');
const soPath = (n) => `/carret/sell/sales-orders/${encodeURIComponent(n)}`;
const days = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000)) : null);

export default function ToBuyPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('vendor_management', 'edit');

  const [tab, setTab] = useState('laptops');
  const [state, setState] = useState({ loading: true, error: null, laptops: [], parts: [] });
  const [options, setOptions] = useState(null);
  const [link, setLink] = useState(null); // { kind: 'laptop'|'part', row, value }
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    api.get(base)
      .then(({ data }) => setState({ loading: false, error: null, laptops: data.laptops || [], parts: data.parts || [] }))
      .catch((e) => setState((s) => ({ ...s, loading: false, error: errMsg(e, 'Could not load the queue.') })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openLink = (kind, row) => {
    setLink({ kind, row, value: String((kind === 'laptop' ? row.po_id : row.spo_id) || '') });
    if (!options) api.get(`${base}/link-options`).then(({ data }) => setOptions(data)).catch(() => setOptions({ purchase_orders: [], spare_parts_orders: [] }));
  };

  const saveLink = async () => {
    const { kind, row, value } = link;
    setBusy('link');
    try {
      if (kind === 'laptop') {
        await api.patch(`${base}/laptop-requests/${row.request_id}/link`, { po_id: value || null });
        toast.success(value ? 'Linked to the purchase order' : 'Link removed');
      } else {
        await api.patch(`${base}/part-requests/${row.request_id}/link`, { spo_id: value });
        toast.success('Linked to the spare-parts order');
      }
      setLink(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const moveOn = async (row) => {
    setBusy(row.sales_order_number);
    try {
      const { data } = await api.post(`${base}/move-on`, { sales_order_number: row.sales_order_number });
      toast.success(`${row.sales_order_number} is back with dispatch — ${data.data?.match || 'a laptop'} matches`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const L = state.laptops;
  const ready = L.filter((r) => r.stock_ready);
  const short = L.reduce((n, r) => n + r.short, 0);
  const unlinked = L.filter((r) => !r.po_id).length + state.parts.filter((p) => !p.spo_id).length;

  const laptopCols = useMemo(() => [
    {
      key: 'so',
      header: 'Sales order',
      render: (r) => <DocNumber value={r.sales_order_number} />,
      sub: (r) => r.customer_name,
    },
    {
      key: 'need',
      header: 'Needed',
      render: (r) => (
        <div className="c-stack" style={{ gap: '2px' }}>
          {r.lines.filter((l) => l.short > 0).map((l) => (
            <div key={l.line_id}><strong className="font-mono">{l.short}×</strong> {cfg(l) || 'Laptop'}</div>
          ))}
        </div>
      ),
    },
    { key: 'type', header: 'For', render: (r) => (String(r.order_type).toLowerCase().startsWith('sale') ? 'Sale' : 'Rental') },
    {
      key: 'wait',
      header: 'Waiting',
      render: (r) => {
        const d = days(r.parked_at);
        return <span style={{ color: d > 7 ? 'var(--alert-crit)' : d > 2 ? 'var(--alert-warn)' : undefined }}>{d === 0 ? 'today' : `${d} days`}</span>;
      },
      sub: (r) => <DateTime value={r.parked_at} />,
    },
    {
      key: 'po',
      header: 'Being bought on',
      render: (r) => (r.po_id
        ? <span><DocNumber value={r.purchase_order_number} /> <StatusChip status={r.po_status} /></span>
        : <span style={{ color: 'var(--alert-warn)' }}>⚠ No PO yet</span>),
    },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap justify-end" style={{ gap: '6px' }} onClick={(e) => e.stopPropagation()} role="presentation">
          {r.stock_ready && canEdit && (
            <Button variant="primary" disabled={busy === r.sales_order_number} onClick={() => moveOn(r)} title={`In stock: ${r.stock_match}`}>
              {busy === r.sales_order_number ? 'Moving…' : 'Stock ready — move on'}
            </Button>
          )}
          {canEdit && <Button variant="quiet" onClick={() => openLink('laptop', r)}>{r.po_id ? 'Change PO' : 'Link PO'}</Button>}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy, canEdit]);

  const partCols = useMemo(() => [
    { key: 'no', header: 'Request', render: (p) => <DocNumber value={p.request_number || `#${p.request_id}`} />, sub: (p) => p.requester_name },
    { key: 'part', header: 'Part', render: (p) => <><strong className="font-mono">{p.quantity || 1}×</strong> {p.part_name || '—'}</>, sub: (p) => p.category },
    { key: 'for', header: 'For laptop', render: (p) => (p.ttspl_id ? <DocNumber value={p.ttspl_id} /> : '—'), sub: (p) => p.stage_name },
    { key: 'stock', header: 'In stock', numeric: true, render: (p) => (p.stock_qty ?? '—') },
    { key: 'wait', header: 'Waiting', render: (p) => { const d = days(p.escalated_at || p.created_at); return d === 0 ? 'today' : `${d} days`; } },
    {
      key: 'spo',
      header: 'Being bought on',
      render: (p) => (p.spo_id ? <span><DocNumber value={p.spo_number} /> <StatusChip status={p.spo_status} /></span> : <span style={{ color: 'var(--alert-warn)' }}>⚠ No order yet</span>),
    },
    {
      key: 'act',
      header: '',
      render: (p) => canEdit && <Button variant="quiet" onClick={() => openLink('part', p)}>{p.spo_id ? 'Change order' : 'Link order'}</Button>,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canEdit]);

  const linkOpts = link && options
    ? (link.kind === 'laptop' ? options.purchase_orders : options.spare_parts_orders).map((o) => ({
      value: String(link.kind === 'laptop' ? o.po_id : o.spo_id),
      label: `${o.purchase_order_number} · ${o.vendor_name || 'vendor?'} · ${String(o.status).replace(/_/g, ' ')}`,
    }))
    : [];

  return (
    <DeskShell title="To buy" breadcrumb="Procure" subtitle="Laptops orders are waiting for, and parts the floor asked procurement to buy.">
      <div className="c-stack">
        <div className="c-form-grid" style={{ '--c-cols': 4 }}>
          <StatTile label="Orders waiting" value={state.loading ? null : L.length} />
          <StatTile label="Laptops short" value={state.loading ? null : short} />
          <StatTile label="Stock ready to move on" value={state.loading ? null : ready.length} />
          <StatTile label="Parts waiting" value={state.loading ? null : state.parts.length} />
        </div>

        {ready.length > 0 && (
          <Notice tone="good" title={`${ready.length} order${ready.length > 1 ? 's have' : ' has'} a matching laptop in stock now`}>
            Use “Stock ready — move on” to hand each back to dispatch. It goes to “attaching”, where dispatch picks the laptops.
          </Notice>
        )}
        {unlinked > 0 && !state.loading && (
          <Notice tone="warn" title={`${unlinked} need${unlinked > 1 ? 's have' : ' has'} no purchase order yet`}>
            Link each to the PO that buys it, or raise one. Nothing on this list is bought until it is on a PO.
          </Notice>
        )}

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'laptops', label: 'Laptops for orders', count: L.length },
            { key: 'parts', label: 'Parts for the floor', count: state.parts.length },
          ]}
        />

        {state.error && <EmptyState title="Could not load the queue" body={state.error} />}
        {!state.error && tab === 'laptops' && (
          <Section title="Laptops sales orders are waiting for" actions={canEdit && <Button onClick={() => navigate('/vendor-management/purchase-orders')}>Raise a PO</Button>}>
            {state.loading ? <EmptyState title="Loading…" /> : (
              <DataTable
                columns={laptopCols}
                rows={L}
                rowKey={(r) => r.request_id}
                onRowClick={(r) => navigate(soPath(r.sales_order_number))}
                empty={<EmptyState title="No order is waiting for laptops" />}
              />
            )}
          </Section>
        )}
        {!state.error && tab === 'parts' && (
          <Section title="Parts escalated by the floor" actions={canEdit && <Button onClick={() => navigate('/vendor-management/spare-parts-orders')}>Raise a spare-parts order</Button>}>
            {state.loading ? <EmptyState title="Loading…" /> : (
              <DataTable
                columns={partCols}
                rows={state.parts}
                rowKey={(p) => p.request_id}
                empty={<EmptyState title="No part is waiting for procurement" />}
              />
            )}
            <p className="text-ink-3" style={{ marginTop: '8px' }}>When the part arrives, the warehouse reserves it for the request on the Parts Approval screen.</p>
          </Section>
        )}
      </div>

      <Drawer
        open={Boolean(link)}
        onClose={() => setLink(null)}
        title={link?.kind === 'laptop' ? `Purchase order for ${link?.row.sales_order_number}` : `Spare-parts order for ${link?.row.request_number || ''}`}
        footer={(
          <div className="flex justify-end" style={{ gap: '8px' }}>
            {link?.kind === 'laptop' && link?.row.po_id && <Button variant="quiet" disabled={busy === 'link'} onClick={() => setLink((l) => ({ ...l, value: '' }))}>Clear</Button>}
            <Button variant="primary" disabled={busy === 'link' || (link?.kind === 'part' && !link?.value)} onClick={saveLink}>{busy === 'link' ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      >
        {link && (
          <div className="c-stack">
            {link.kind === 'laptop'
              ? <p>{link.row.lines.filter((l) => l.short > 0).map((l) => `${l.short}× ${cfg(l)}`).join('; ')}</p>
              : <p>{link.row.quantity || 1}× {link.row.part_name}</p>}
            <Field label={link.kind === 'laptop' ? 'Open purchase order' : 'Open spare-parts order'} hint="Only orders that are not cancelled, rejected or completed are listed.">
              {options
                ? <Select value={link.value} onChange={(e) => setLink((l) => ({ ...l, value: e.target.value }))} placeholder={link.kind === 'laptop' ? 'Not linked' : 'Pick an order'} options={linkOpts} />
                : <span className="text-ink-3">Loading…</span>}
            </Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

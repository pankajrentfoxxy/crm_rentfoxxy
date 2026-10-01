import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DateTime, EmptyState, Input, KeyValue, Money, Notice, Panel, StatTile,
  StatusChip, Tabs,
} from '../../../components/carret';
import { errMsg, fetchLifecycle } from './stockApi';
import { fileUrl } from '../procure/procureShared';
import { rememberLifecycleSearch } from './LifecycleSearchPage';

/**
 * Stock → Laptop Lifecycle → one laptop (backend services/assetLifecycleService.js).
 *
 * Header, the money picture (what it cost, what it earned, how the net is
 * worked out), then tabs: the milestone timeline with everything in between
 * one click away, rental periods, configuration + purchase, the charger, and
 * the full activity list. Nothing is invented: a figure without a source says
 * so, and estimated figures are labelled.
 */

/* ------------------------------------------------------------- helpers */

const MILESTONE_LOOK = {
  purchased: { glyph: '₹', family: 'idle' },
  grn_received: { glyph: '↓', family: 'idle' },
  diagnosis_passed: { glyph: '✓', family: 'offcycle' },
  qc2_passed: { glyph: '✓', family: 'offcycle' },
  into_stock: { glyph: '■', family: 'idle' },
  carret_placed: { glyph: '■', family: 'idle' },
  so_attached: { glyph: '+', family: 'moving' },
  dispatch_qc_passed: { glyph: '✓', family: 'moving' },
  dispatch_qc_failed: { glyph: '!', family: 'crit' },
  dc_attached: { glyph: '+', family: 'moving' },
  dispatched: { glyph: '→', family: 'moving' },
  delivered: { glyph: '●', family: 'earning' },
  delivered_demo: { glyph: '●', family: 'earning' },
  sold: { glyph: '₹', family: 'closed' },
  support_ticket: { glyph: '!', family: 'offcycle' },
  return_pickup: { glyph: '←', family: 'offcycle' },
  warehouse_in: { glyph: '↓', family: 'idle' },
  in_repair: { glyph: '⚙', family: 'offcycle' },
  vendor_repair_out: { glyph: '→', family: 'offcycle' },
  vendor_repair_in: { glyph: '←', family: 'offcycle' },
  returned_to_vendor: { glyph: '←', family: 'closed' },
  scrapped: { glyph: '×', family: 'closed' },
};
const familyColor = (f) => (f === 'crit' ? 'var(--alert-crit)' : `var(--lc-${f || 'closed'})`);
const familySoft = (f) => (f === 'crit' ? 'var(--alert-crit-soft)' : `var(--lc-${f || 'closed'}-soft)`);

const OWNERSHIP = { owned: 'Owned', vendor_rented: 'Rented from vendor', bought_out: 'Bought out from vendor' };
const KIND_LABEL = { rental: 'Rental', demo: 'Demo', sale: 'Sale' };
const END_LABEL = {
  returned: 'Returned',
  return_pending: 'Return raised, not back yet',
  next_deployment: 'No return on record — ended at next delivery',
  ongoing: 'Still with customer',
  unknown: 'No return on record',
  sold: 'Sold',
};
const SOURCE_LABEL = {
  transition: 'Status', audit: 'Audit log', events: 'Event log', floor: 'Floor ticket', dc: 'Challan',
  support: 'Support', vendor_repair: 'Vendor repair', vendor_return: 'Vendor return', invoice: 'Invoice', purchase: 'Purchase',
};

/** Where a reference opens in the new UI; null = plain text. */
function refHref(kind, ref, refId, ctx) {
  const enc = (v) => encodeURIComponent(v);
  switch (kind) {
    case 'po': return refId ? `/carret/procure/purchase-orders/${refId}` : (ctx.poId ? `/carret/procure/purchase-orders/${ctx.poId}` : null);
    case 'grn': return ctx.poId && refId ? `/carret/procure/purchase-orders/${ctx.poId}/grns/${refId}` : null;
    case 'dc': return ref ? `/carret/move/challans/${enc(ref)}` : null;
    case 'rdc': return ref ? `/carret/move/return-challans/${enc(ref)}` : null;
    case 'support_ticket': return refId ? `/carret/serve/tickets/${refId}` : null;
    case 'floor_ticket': return refId ? `/carret/produce/tickets/${refId}` : null;
    case 'invoice': return refId ? `/carret/money/invoices/${refId}` : null;
    case 'vrdc': return ref ? `/carret/procure/repairs/${enc(ref)}` : null;
    case 'vrtdc': return ref ? `/carret/procure/returns/${enc(ref)}` : null;
    case 'so': return ref ? `/carret/sell/sales-orders/${enc(ref)}` : null;
    default: return null;
  }
}

function Ref({ kind, value, id, ctx }) {
  if (!value) return <span className="text-ink-3">—</span>;
  const href = refHref(kind, value, id, ctx);
  if (!href) return <span className="tabular-nums">{value}</span>;
  return <Link to={href} className="text-accent tabular-nums" style={{ whiteSpace: 'nowrap' }}>{value}</Link>;
}

function Refs({ row, ctx }) {
  const all = [{ ref: row.ref, ref_kind: row.ref_kind, ref_id: row.ref_id }, ...(row.also || [])].filter((r) => r.ref);
  if (!all.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}>
      {all.map((r) => <Ref key={r.ref} kind={r.ref_kind} value={r.ref} id={r.ref_id} ctx={ctx} />)}
    </span>
  );
}

const fmtDays = (n) => (n == null ? '—' : `${n} day${n === 1 ? '' : 's'}`);
function durationText(days) {
  if (days == null) return '—';
  if (days < 60) return fmtDays(days);
  const months = Math.floor(days / 30);
  const rest = days - months * 30;
  return `${months} month${months === 1 ? '' : 's'}${rest ? ` ${rest} d` : ''} (${days} days)`;
}

/* ---------------------------------------------------------------- page */

export default function LifecyclePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [tab, setTab] = useState('lifecycle');

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    fetchLifecycle(code)
      .then(({ data }) => {
        if (cancelled) return;
        const d = data?.data || null;
        setState({ loading: false, error: null, data: d });
        if (d?.asset) rememberLifecycleSearch({ code: d.asset.ttspl_id || d.asset.serial_number, serial: d.asset.serial_number, model: d.asset.model_name });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ loading: false, error: e?.response?.status === 404 ? `No laptop found for ${code}.` : errMsg(e, 'Could not load this laptop.'), data: null });
      });
    return () => { cancelled = true; };
  }, [code]);

  const d = state.data;
  const a = d?.asset;
  const ctx = useMemo(() => ({ poId: d?.purchase?.po_id || null }), [d]);

  if (state.loading || state.error || !d) {
    return (
      <DeskShell title={code} breadcrumb="Stock / Laptop Lifecycle">
        {state.loading
          ? <EmptyState title="Loading…" body={`Putting together the history of ${code}.`} />
          : <EmptyState title="Not available" body={state.error} action={<Button onClick={() => navigate('/carret/stock/lifecycle')}>Search another laptop</Button>} />}
      </DeskShell>
    );
  }

  const assetCode = a.ttspl_id || a.serial_number;
  const tabs = [
    { key: 'lifecycle', label: 'Lifecycle', count: d.milestones.length },
    { key: 'rentals', label: 'Rentals', count: d.rentals.length },
    { key: 'config', label: 'Configuration & purchase' },
    { key: 'charger', label: 'Charger', count: d.charger.history.length || null },
    { key: 'activity', label: 'All activity', count: d.activity.length },
  ];

  return (
    <DeskShell
      title={assetCode}
      breadcrumb="Stock / Laptop Lifecycle"
      actions={(
        <div className="flex" style={{ gap: '6px', flexWrap: 'wrap' }}>
          <Button onClick={() => navigate(`/carret/stock/assets/${encodeURIComponent(assetCode)}`)}>Asset record</Button>
          <Button variant="quiet" onClick={() => navigate('/carret/stock/lifecycle')}>Search another</Button>
        </div>
      )}
    >
      <div className="c-stack">
        <Header a={a} />
        {d.notes?.test_noise_rows > 0 && (
          <Notice tone="info">{d.notes.test_noise_rows} status rows written by an automated test on this database are hidden.</Notice>
        )}
        <MoneySummary m={d.money} a={a} rentals={d.rentals} notes={d.notes} />
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'lifecycle' && <LifecycleTab milestones={d.milestones} activity={d.activity} ctx={ctx} />}
        {tab === 'rentals' && <RentalsTab rentals={d.rentals} money={d.money} notes={d.notes} ctx={ctx} />}
        {tab === 'config' && <ConfigTab a={a} p={d.purchase} money={d.money} ctx={ctx} />}
        {tab === 'charger' && <ChargerTab charger={d.charger} a={a} ctx={ctx} />}
        {tab === 'activity' && <ActivityTab activity={d.activity} ctx={ctx} />}
      </div>
    </DeskShell>
  );
}

/* -------------------------------------------------------------- header */

function Header({ a }) {
  return (
    <section className="c-card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div className="min-w-0">
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="font-ui" style={{ fontSize: '22px', fontWeight: 650, letterSpacing: '-.01em' }}>{a.ttspl_id || 'No TTSPL'}</span>
            {a.status ? <StatusChip status={a.status} /> : <span className="text-ink-3">No status (not GRN’d)</span>}
            <span
              className="font-ui"
              style={{ fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', border: '1px solid var(--rule)', color: a.ownership === 'vendor_rented' ? 'var(--alert-warn)' : 'var(--ink-3)' }}
            >
              {OWNERSHIP[a.ownership] || a.ownership}
            </span>
          </div>
          <div className="text-ink-3 font-ui" style={{ marginTop: '4px', fontSize: '14px' }}>
            S/N <span style={{ color: 'var(--ink)' }}>{a.serial_number}</span>
            {a.model_name && <> · <span style={{ color: 'var(--ink)' }}>{a.model_name}</span></>}
            {a.config && <> · {a.config}</>}
          </div>
        </div>
        <div className="font-ui" style={{ textAlign: 'right', minWidth: 0 }}>
          <div className="text-ink-3" style={{ fontSize: '12px', fontWeight: 500 }}>Now</div>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>
            {a.customer_id && ['rented', 'on_demo', 'sold', 'in_transit'].includes(a.status)
              ? <Link to={`/carret/sell/customers/${a.customer_id}`} className="text-accent">{a.location}</Link>
              : (a.location || '—')}
          </div>
          {a.current_dc_number && <div className="text-ink-3" style={{ fontSize: '13px' }}>on <Link className="text-accent" to={`/carret/move/challans/${encodeURIComponent(a.current_dc_number)}`}>{a.current_dc_number}</Link></div>}
          {a.rent_monthly_rate != null && ['rented', 'on_demo'].includes(a.status) && (
            <div className="text-ink-3" style={{ fontSize: '13px' }}><Money value={a.rent_monthly_rate} /> / month</div>
          )}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- money */

function MoneySummary({ m, a, rentals, notes }) {
  const [open, setOpen] = useState(false);
  const rented = m.ownership !== 'owned';
  const sold = m.sale_value != null;
  const receivedNote = !m.payments_tracked
    ? 'no payments recorded'
    : (m.received_is_estimated ? 'estimated from part-paid invoices' : 'from paid invoices');
  const tiles = [
    rented
      ? { label: m.ownership === 'bought_out' ? 'Buy-out value' : 'Purchase value', value: m.ownership === 'bought_out' ? <Money value={m.purchase_value} /> : 'Not bought', delta: m.purchase_equivalent?.amount ? <>Would cost about <Money value={m.purchase_equivalent.amount} /></> : 'rented from vendor' }
      : { label: 'Purchase value', value: m.purchase_unresolved ? 'Unknown' : <Money value={m.purchase_value} />, delta: m.purchase_unresolved ? 'no price on the PO line' : 'PO line rate' },
    { label: 'Parts added', value: <Money value={m.parts_value} />, delta: m.parts_credits ? <>less <Money value={m.parts_credits} /> old parts back</> : `${(m.parts || []).filter((p) => p.kind === 'part').length} part(s)` },
    { label: 'Rent invoiced', value: <Money value={m.rent_invoiced_net} />, delta: m.credit_notes ? <>after <Money value={m.credit_notes} /> credit notes</> : (m.rent_invoiced_draft ? <>incl. <Money value={m.rent_invoiced_draft} /> in draft</> : `${fmtDays(m.rental_days)} on rent`) },
    { label: 'Rent received', value: m.payments_tracked ? <Money value={m.rent_received} /> : 'Not recorded', delta: receivedNote },
    rented && { label: 'Vendor rent paid', value: <Money value={m.vendor_rent_paid} />, delta: m.vendor_rent_basis === 'accrued' ? 'estimated: monthly rent × days held' : (m.vendor_rent_basis === 'vendor_bills' ? 'from vendor bills' : 'vendor bills + estimate since') },
    sold && { label: 'Sale value', value: <Money value={m.sale_value} />, delta: 'sales order rate' },
    { label: m.net >= 0 ? 'Net earned' : 'Net (not yet recovered)', value: <Money value={m.net} />, family: m.net >= 0 ? 'earning' : null, delta: m.net_basis === 'invoiced' ? 'on invoiced rent' : 'on received rent' },
  ].filter(Boolean);

  const lines = [
    { sign: '+', label: 'Rent invoiced for this laptop', value: m.rent_invoiced, note: m.rent_invoiced_draft ? 'includes draft invoices' : null },
    m.credit_notes ? { sign: '−', label: 'Credit notes for this laptop', value: m.credit_notes, note: m.credit_notes_estimated ? 'shared notes split evenly' : null } : null,
    m.net_basis === 'received' ? { sign: '', label: `Rent received (used instead of invoiced)`, value: m.rent_received, note: m.received_is_estimated ? 'estimated' : null } : null,
    sold ? { sign: '+', label: 'Sale value', value: m.sale_value } : null,
    m.purchase_value ? { sign: '−', label: m.ownership === 'bought_out' ? 'Vendor buy-out' : 'Purchase value', value: m.purchase_value } : null,
    m.parts_value ? { sign: '−', label: 'Parts fitted (at unit cost)', value: m.parts_value } : null,
    m.parts_credits ? { sign: '+', label: 'Old parts returned to stock', value: m.parts_credits } : null,
    rented ? { sign: '−', label: 'Rent paid to the vendor', value: m.vendor_rent_paid, note: m.vendor_rent_basis !== 'vendor_bills' ? 'estimated' : null } : null,
  ].filter(Boolean);

  return (
    <div className="c-stack" style={{ gap: '8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        {tiles.map((t) => <StatTile key={t.label} label={t.label} value={t.value} delta={t.delta} family={t.family} />)}
      </div>
      <div>
        <button type="button" className="text-accent font-ui" onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
          {open ? 'Hide' : 'How it’s calculated'}
        </button>
      </div>
      {open && (
        <section className="c-card c-card-b font-ui" style={{ fontSize: '14px' }}>
          <table style={{ width: '100%', maxWidth: '40rem', borderCollapse: 'collapse' }}>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <td style={{ width: '1.5rem', color: 'var(--ink-3)' }}>{l.sign}</td>
                  <td style={{ padding: '3px 0' }}>{l.label}{l.note && <span className="text-ink-3"> · {l.note}</span>}</td>
                  <td style={{ textAlign: 'right' }}><Money value={l.value} /></td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--rule)' }}>
                <td />
                <td style={{ padding: '6px 0', fontWeight: 600 }}>Net {m.net_basis === 'invoiced' ? '(on invoiced rent)' : '(on received rent)'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}><Money value={m.net} /></td>
              </tr>
            </tbody>
          </table>
          <ul className="text-ink-3" style={{ margin: '12px 0 0', paddingLeft: '18px', fontSize: '13px', display: 'grid', gap: '4px' }}>
            {notes?.invoices_from
              ? <li>Customer invoices for this laptop start {notes.invoices_from} — rent billed before CRM invoicing is not in these figures.</li>
              : <li>No customer invoice line names this laptop yet.</li>}
            {m.rent_at_rate != null && (
              <li>All rental periods at their monthly rate come to about <Money value={m.rent_at_rate} /> ({fmtDays(m.rental_days)}) — an estimate covering the periods before invoicing too.</li>
            )}
            {!m.payments_tracked && <li>No payment is recorded against this laptop’s invoices, so “received” is not shown and the net uses invoiced rent.</li>}
            {m.unassigned_invoiced > 0 && <li><Money value={m.unassigned_invoiced} /> invoiced does not fall in any delivery period on record.</li>}
            {rented && m.vendor_rent && (
              <li>
                Vendor rent: <Money value={m.vendor_rent.monthly_rate} /> / month from {m.vendor_rent.start || '—'} to {m.vendor_rent.end || '—'}
                {m.vendor_rent.billed_lines ? <> · <Money value={m.vendor_rent.billed} /> on {m.vendor_rent.billed_lines} vendor bill line(s)</> : ' · no vendor bill line names this laptop'}
                {m.vendor_rent.accrued ? <> · <Money value={m.vendor_rent.accrued} /> estimated for {m.vendor_rent.accrued_days} days</> : null}
                {m.vendor_rent.start_fixed_from === 'grn_date' && ' · the recorded rent start was in the future, so the GRN date is used'}
              </li>
            )}
            {rented && m.purchase_equivalent?.amount && (
              <li>Purchase equivalent (not counted): <Money value={m.purchase_equivalent.amount} /> — {m.purchase_equivalent.source === 'same_model_purchases' ? `average we paid for this model on ${m.purchase_equivalent.lines} purchase line(s)` : 'from the PO line'}.</li>
            )}
            {m.purchase_unresolved && <li>The purchase order line has no price for this laptop, so its purchase value is unknown (counted as 0).</li>}
            {a.status === 'sold' && m.sale_value == null && <li>Sold, but no sale order rate was found for it.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- lifecycle */

function ActivityRow({ r, ctx }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '8.5rem minmax(0,1fr)', gap: '10px', padding: '6px 0', borderTop: '1px solid var(--rule)' }}>
      <span className="text-ink-3 tabular-nums" style={{ fontSize: '12.5px' }}><DateTime value={r.at} format="datetime" /></span>
      <span className="min-w-0" style={{ fontSize: '13.5px' }}>
        <span style={{ fontWeight: 500 }}>{r.label}</span>
        {r.by && <span className="text-ink-3"> · {r.by}</span>}
        {(r.ref || r.also) && <span> · <Refs row={r} ctx={ctx} /></span>}
        {r.detail && <span className="block text-ink-3" style={{ fontSize: '12.5px', overflowWrap: 'anywhere' }}>{r.detail}</span>}
      </span>
    </li>
  );
}

function Between({ rows, ctx }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div style={{ margin: '2px 0 10px' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="font-ui text-accent"
        style={{ background: 'none', border: 0, padding: '2px 0', cursor: 'pointer', fontSize: '12.5px', fontWeight: 500 }}
        aria-expanded={open}
      >
        {open ? '▾ Hide' : `▸ ${rows.length} more event${rows.length === 1 ? '' : 's'}`}
      </button>
      {open && <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>{rows.map((r) => <ActivityRow key={r.id} r={r} ctx={ctx} />)}</ul>}
    </div>
  );
}

function LifecycleTab({ milestones, activity, ctx }) {
  const [corrections, setCorrections] = useState(false);
  const keep = (r) => corrections || !r.minor;
  const segment = (from, to) => activity.slice(from, to).filter(keep);
  if (!milestones.length) {
    return (
      <Panel title="Lifecycle">
        <EmptyState title="No milestones recorded" body="See All activity for everything on record." />
      </Panel>
    );
  }
  const first = milestones[0].activity_index;
  return (
    <Panel title="Lifecycle" actions={<Checkbox label="Include data corrections" checked={corrections} onChange={(e) => setCorrections(e.target.checked)} />}>
      <div className="c-card-b">
        <Between rows={segment(0, first)} ctx={ctx} />
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {milestones.map((m, i) => {
            const look = MILESTONE_LOOK[m.key] || { glyph: '●', family: 'closed' };
            const next = milestones[i + 1];
            const between = segment(m.activity_index + 1, next ? next.activity_index : activity.length);
            const isLast = i === milestones.length - 1;
            return (
              <li key={`${m.activity_id}-${m.key}`} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span
                    aria-hidden="true"
                    className="font-ui"
                    style={{
                      width: '28px', height: '28px', borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none',
                      fontSize: '13px', fontWeight: 700, color: familyColor(look.family), background: familySoft(look.family),
                      border: `1.5px solid ${familyColor(look.family)}`,
                    }}
                  >
                    {look.glyph}
                  </span>
                  {!isLast && <span style={{ flex: 1, width: '2px', background: 'var(--rule)', minHeight: '18px' }} />}
                </div>
                <div className="min-w-0" style={{ paddingBottom: isLast ? 0 : '6px' }}>
                  <div style={{ display: 'flex', gap: '8px 14px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <span className="font-ui" style={{ fontWeight: 600, fontSize: '14.5px' }}>{m.label}</span>
                    <span className="text-ink-3 tabular-nums" style={{ fontSize: '13px' }}><DateTime value={m.at} format="datetime" /></span>
                    <span style={{ fontSize: '13px' }}>{m.by ? m.by : <span className="text-ink-3">person not recorded</span>}</span>
                    {(m.ref || m.also) && <span style={{ fontSize: '13px' }}><Refs row={m} ctx={ctx} /></span>}
                  </div>
                  {m.detail && <div className="text-ink-3" style={{ fontSize: '12.5px', marginTop: '2px', overflowWrap: 'anywhere' }}>{m.detail}</div>}
                  <Between rows={between} ctx={ctx} />
                  {!between.length && <div style={{ height: '10px' }} />}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- rentals */

function RentalsTab({ rentals, money, notes, ctx }) {
  const cols = [
    { key: 'k', header: 'Customer', render: (r) => (r.customer_id ? <Link className="text-accent" to={`/carret/sell/customers/${r.customer_id}`}>{r.customer_name || `#${r.customer_id}`}</Link> : (r.customer_name || '—')), sub: (r) => `${KIND_LABEL[r.kind] || r.kind}${r.sales_order_number ? ` · ${r.sales_order_number}` : ''}` },
    { key: 'dc', header: 'Challans', render: (r) => <Ref kind="dc" value={r.dc_number} ctx={ctx} />, sub: (r) => (r.return_dc_number ? <>back on <Ref kind="rdc" value={r.return_dc_number} ctx={ctx} /></> : null) },
    { key: 'from', header: 'Delivered', render: (r) => <DateTime value={r.delivered_on} /> },
    { key: 'to', header: 'Returned', render: (r) => (r.returned_on ? <DateTime value={r.returned_on} /> : (r.ongoing ? 'Ongoing' : '—')), sub: (r) => (r.end_basis && r.end_basis !== 'returned' ? END_LABEL[r.end_basis] : null) },
    { key: 'days', header: 'Days', numeric: true, render: (r) => (r.kind === 'sale' ? '—' : fmtDays(r.days)) },
    { key: 'rate', header: 'Monthly rate', numeric: true, render: (r) => (r.kind === 'sale' ? <Money value={r.sale_amount} /> : <Money value={r.monthly_rate} showZero={false} />), sub: (r) => (r.kind === 'sale' ? 'sale price' : null) },
    { key: 'est', header: 'At rate (est.)', numeric: true, render: (r) => <Money value={r.rent_at_rate} showZero={false} /> },
    { key: 'inv', header: 'Invoiced', numeric: true, render: (r) => (r.kind === 'sale' ? '—' : <Money value={r.invoiced} />), sub: (r) => (r.invoice_lines ? `${r.invoice_lines} line(s)` : null) },
  ];
  const periods = rentals.filter((r) => r.kind !== 'sale');
  return (
    <div className="c-stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
        <StatTile label="Times deployed" value={periods.length} />
        <StatTile label="Total rental period" value={durationText(money.rental_days)} />
        <StatTile label="At rate (estimate)" value={money.rent_at_rate == null ? null : <Money value={money.rent_at_rate} />} delta="rate × days ÷ 30" />
        <StatTile label="Invoiced" value={<Money value={money.rent_invoiced} />} delta={notes?.invoices_from ? `invoices from ${notes.invoices_from}` : 'no invoices yet'} />
      </div>
      <Panel title="Every delivery">
        <DataTable columns={cols} rows={rentals} rowKey={(r) => `${r.dc_number}-${r.delivered_on}`} empty={<EmptyState title="Never delivered to a customer" />} />
      </Panel>
    </div>
  );
}

/* -------------------------------------------------- config & purchase */

function ConfigTab({ a, p, money, ctx }) {
  const g = a.grn_received_config || {};
  const partCols = [
    { key: 'l', header: 'Part', render: (r) => r.label, sub: (r) => r.ref || null },
    { key: 'w', header: 'When', render: (r) => <DateTime value={r.when} /> },
    { key: 'a', header: 'Cost', numeric: true, render: (r) => (r.no_cost ? <span className="text-ink-3">no cost recorded</span> : <Money value={r.amount} />) },
  ];
  return (
    <div className="c-stack">
      <Panel title="Configuration">
        <div className="c-card-b c-stack">
          <KeyValue
            cols={4}
            items={[
              { label: 'Brand', value: a.brand },
              { label: 'Model', value: a.model },
              { label: 'Processor', value: a.processor },
              { label: 'Generation', value: a.generation },
              { label: 'RAM', value: a.ram },
              { label: 'Storage', value: a.storage },
              { label: 'Screen', value: a.screen_size },
              { label: 'Graphics', value: a.gpu },
            ]}
          />
          {(g.processor || g.model) && (
            <p className="text-ink-3" style={{ fontSize: '13px', margin: 0 }}>
              Captured from the laptop at GRN: {[g.brand, g.model, g.processor, g.ram && `${g.ram} RAM`, g.storage].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Purchase">
        {!p ? <EmptyState title="No purchase order on record" /> : (
          <div className="c-card-b">
            <KeyValue
              cols={4}
              items={[
                { label: 'Purchase order', value: <Ref kind="po" value={p.po_number} id={p.po_id} ctx={ctx} /> },
                { label: 'PO date', value: <DateTime value={p.po_date} /> },
                { label: 'Type', value: OWNERSHIP[a.ownership] || p.po_type },
                { label: 'Vendor', value: p.vendor_id ? <Link className="text-accent" to={`/carret/procure/vendors/${p.vendor_id}`}>{p.vendor_name || `#${p.vendor_id}`}</Link> : p.vendor_name },
                { label: 'GRN', value: p.grn_id ? <Ref kind="grn" value={p.grn_number} id={p.grn_id} ctx={ctx} /> : '—' },
                { label: 'Received', value: <DateTime value={p.received_at || p.grn_date} format="datetime" /> },
                { label: p.vendor_monthly_rent != null ? 'Vendor rent / month' : 'Purchase price', value: p.vendor_monthly_rent != null ? <Money value={p.vendor_monthly_rent} /> : (p.purchase_rate ? <Money value={p.purchase_rate} /> : 'No price on the PO line') },
                { label: 'Vendor invoice', value: p.vendor_invoice_number },
                p.vendor_challan_number && { label: 'Vendor challan', value: p.vendor_challan_number },
                { label: 'Condition at receipt', value: p.received_condition === 'on' ? 'Powers on' : (p.received_condition ? String(p.received_condition).replace(/_/g, ' ') : null) },
                Array.isArray(p.missing_parts) && p.missing_parts.length > 0 && { label: 'Missing at receipt', value: p.missing_parts.map((x) => (typeof x === 'string' ? x : x?.name || x?.part)).filter(Boolean).join(', ') },
                a.vendor_buyout && { label: 'Bought out', value: <><Money value={a.vendor_buyout.amount} /> on <DateTime value={a.vendor_buyout.at} /></> },
                a.vendor_rent_end_date && { label: 'Vendor rent ends', value: <DateTime value={a.vendor_rent_end_date} /> },
              ]}
            />
          </div>
        )}
      </Panel>

      <Panel title="Attachments">
        {!p?.attachments?.length ? <EmptyState title="No files attached" body="PO bills, the vendor invoice, GRN bills and delivery proofs appear here when uploaded." /> : (
          <ul className="c-card-b" style={{ listStyle: 'none', margin: 0, display: 'grid', gap: '6px' }}>
            {p.attachments.map((f, i) => (
              <li key={`${f.path}-${i}`} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <a href={fileUrl(f.path)} target="_blank" rel="noopener noreferrer" className="text-accent" style={{ fontWeight: 500 }}>{f.label}</a>
                <span className="text-ink-3" style={{ fontSize: '12.5px', overflowWrap: 'anywhere' }}>{f.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Parts added to this laptop">
        <DataTable columns={partCols} rows={money.parts || []} rowKey={(r, i) => `${r.ref || r.label}-${i}`} empty={<EmptyState title="No parts fitted" />} />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------- charger */

function ChargerTab({ charger, a, ctx }) {
  const c = charger.current;
  const steps = (r) => [
    { label: 'Requested', at: r.requested_at, by: r.requested_by },
    { label: 'Handed over by warehouse', at: r.handed_over_at, by: r.handed_over_by },
    { label: 'Attached', at: r.attached_at, by: r.attached_by },
    { label: `Scanned at dispatch QC${r.qc_scan_matched === false ? ' (mismatch)' : ''}`, at: r.qc_scanned_at, by: r.qc_scanned_by },
    { label: 'Dispatched', at: r.dispatched_at },
    { label: 'Returned', at: r.returned_at },
    { label: 'Cancelled', at: r.cancelled_at, by: r.cancelled_by },
  ].filter((s) => s.at);
  return (
    <div className="c-stack">
      {c ? (
        <Panel title="Charger with the customer">
          <div className="c-card-b c-stack">
            <KeyValue
              cols={4}
              items={[
                { label: 'Charger', value: c.part_name },
                { label: 'Serial', value: c.serial_number },
                { label: 'Part unit', value: c.prt_id },
                { label: 'Asset code', value: c.asset_code },
                { label: 'Request', value: c.request_number },
                { label: 'Challan', value: <Ref kind="dc" value={c.dc_number} ctx={ctx} /> },
                { label: 'Attached', value: c.attached_at ? <><DateTime value={c.attached_at} format="datetime" />{c.attached_by ? ` · ${c.attached_by}` : ''}</> : null },
                { label: 'Unit cost', value: c.cost ? <Money value={c.cost} /> : 'not recorded' },
              ]}
            />
            {c.units?.length > 1 && (
              <p className="text-ink-3" style={{ margin: 0, fontSize: '13px' }}>
                Kit: {c.units.map((u) => `${u.kit_role} ${u.part_name || ''} ${u.serial_number || u.prt_id || ''}`.trim()).join(' · ')}
              </p>
            )}
          </div>
        </Panel>
      ) : (
        <Notice tone="info">
          {['rented', 'on_demo', 'sold', 'in_transit'].includes(a.status)
            ? 'No charger was attached through the dispatch charger flow for this delivery (laptops sent before the flow existed have no record).'
            : 'The laptop is not with a customer, so no charger is out with it.'}
        </Notice>
      )}
      <Panel title="Charger history">
        {!charger.history.length ? <EmptyState title="No charger requests for this laptop" /> : (
          <div className="c-card-b c-stack">
            {charger.history.map((r) => (
              <div key={r.request_id} style={{ borderTop: '1px solid var(--rule)', paddingTop: '10px' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600 }}>{r.request_number}</span>
                  <span className="text-ink-3">{String(r.status || '').replace(/_/g, ' ')}</span>
                  {r.sales_order_number && <Ref kind="so" value={r.sales_order_number} ctx={ctx} />}
                  {r.dc_number && <Ref kind="dc" value={r.dc_number} ctx={ctx} />}
                  <span className="text-ink-3">{[r.part_name, r.serial_number].filter(Boolean).join(' · ')}</span>
                </div>
                <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: '2px', fontSize: '13px' }}>
                  {steps(r).map((s) => (
                    <li key={s.label}><DateTime value={s.at} format="datetime" /> · {s.label}{s.by ? ` · ${s.by}` : ''}</li>
                  ))}
                  {(r.return_scans || []).map((s, i) => (
                    <li key={`ret-${i}`}><DateTime value={s.scanned_at} format="datetime" /> · Scanned on return {s.return_dc_number || ''}{s.matched === false ? ' (mismatch)' : ''}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------ activity */

function ActivityTab({ activity, ctx }) {
  const [q, setQ] = useState('');
  const [corrections, setCorrections] = useState(false);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return activity
      .filter((r) => corrections || !r.minor)
      .filter((r) => !t || [r.label, r.detail, r.by, r.ref, ...(r.also || []).map((x) => x.ref)].join(' ').toLowerCase().includes(t))
      .slice()
      .reverse();
  }, [activity, q, corrections]);
  const cols = [
    { key: 'at', header: 'When', render: (r) => <DateTime value={r.at} format="datetime" /> },
    { key: 'l', header: 'What happened', render: (r) => <span>{r.milestone ? <strong>{r.label}</strong> : r.label}</span>, sub: (r) => r.detail || null },
    { key: 'by', header: 'By', render: (r) => r.by || <span className="text-ink-3">—</span> },
    { key: 'ref', header: 'Reference', render: (r) => <Refs row={r} ctx={ctx} /> },
    { key: 'src', header: 'Recorded in', render: (r) => SOURCE_LABEL[r.source] || r.source },
  ];
  return (
    <Panel
      title="All activity"
      toolbar={(
        <div className="c-card-b" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', paddingTop: 0 }}>
          <Input type="search" placeholder="Search events, people, challans" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '20rem' }} />
          <Checkbox label="Include data corrections" checked={corrections} onChange={(e) => setCorrections(e.target.checked)} />
          <span className="text-ink-3" style={{ fontSize: '13px' }}>{rows.length} of {activity.length}, newest first</span>
        </div>
      )}
    >
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.id} empty={<EmptyState title="Nothing matches" />} />
    </Panel>
  );
}

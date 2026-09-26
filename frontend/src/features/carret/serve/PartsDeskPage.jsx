import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Money, Notice, Section, Select, Tabs,
} from '../../../components/carret';
import SignaturePadComponent from '../../sales-pipeline/components/SignaturePad';
import { usePermission } from '../../../hooks/usePermission';
import {
  acceptPartReturn, approvePartsToCustomer, approvePartsToTechnician, cancelPartRequest, fetchPartDcsAwaitingCourier,
  fetchPartReturnDcsPending, fetchPartUnits, fetchPartsQueue, markPartDcDelivered, receivePartReturnDc, resolvePartMove,
  setPartDcCourier, setPartPrice, signPartChallan,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Serve → Parts desk (warehouse, claude/carret-support.md).
 *
 * The old Support Parts queue on one Carret page, same endpoints:
 *   Requests  — pick the unit for each request, then hand it to the technician
 *               (challan + technician's signature) or send it to the customer
 *               (Part DC). A part Support marked chargeable needs its price first.
 *   Returns   — a technician brings an unused part back; the warehouse signs.
 *   Moves     — a technician asks to move a held part to another ticket.
 *   Part DCs  — courier details / delivered for parts sent to customers, and
 *               old parts coming back on an RPDC.
 */
const toCustomer = (r) => r.fulfillment_mode === 'courier_to_customer';
const chargeable = (r) => r.billing_type === 'charge_customer';
const priced = (r) => Number(r.charge_amount) > 0;

export default function PartsDeskPage() {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('support_part_challan', 'edit');
  const [tab, setTab] = useState('requests');
  const [q, setQ] = useState(null);
  const [dcs, setDcs] = useState({ out: null, back: null });
  const [sel, setSel] = useState(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(() => {
    fetchPartsQueue().then(({ data }) => setQ(data)).catch((e) => { setQ({ pending: [], returns: [], reassigns: [] }); toast.error(errMsg(e, 'Could not load the parts queue')); });
    fetchPartDcsAwaitingCourier().then(({ data }) => setDcs((d) => ({ ...d, out: data.dcs || [] }))).catch(() => setDcs((d) => ({ ...d, out: [] })));
    fetchPartReturnDcsPending().then(({ data }) => setDcs((d) => ({ ...d, back: data.dcs || [] }))).catch(() => setDcs((d) => ({ ...d, back: [] })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.data?.message || ok); load(); return r; } catch (e) { toast.error(errMsg(e)); return null; } finally { setBusy(false); }
  };

  const match = (r) => {
    const s = search.trim().toLowerCase();
    return !s || [r.request_number, r.ticket_number, r.part_name, r.tech_name, r.ttspl_id, r.customer_name, r.from_ticket_number]
      .some((v) => String(v || '').toLowerCase().includes(s));
  };
  const pending = useMemo(() => (q?.pending || []).filter(match), [q, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = (q?.pending || []).filter((r) => sel.has(r.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /* ---------- approve: pick units, then technician challan or customer Part DC ---------- */
  const startApprove = (mode) => {
    if (!chosen.length) return;
    if (new Set(chosen.map((r) => r.support_ticket_id)).size > 1) { toast.error('Pick requests from one ticket at a time'); return; }
    if (mode === 'tech') {
      if (chosen.some(toCustomer)) { toast.error('Some of these go to the customer by courier — use "Send to customer"'); return; }
      if (new Set(chosen.map((r) => r.assigned_to_tech)).size > 1) { toast.error('Pick requests for one technician at a time'); return; }
    } else if (chosen.some((r) => !toCustomer(r))) { toast.error('Only requests marked "send to the customer" go on a Part DC'); return; }
    const unpriced = chosen.filter((r) => chargeable(r) && !priced(r));
    if (unpriced.length) { toast.error(`Set the price first: ${unpriced.map((r) => r.request_number).join(', ')}`); return; }
    setDrawer({ kind: 'approve', mode, units: {}, pick: {}, showAll: {}, mismatch: '', ship_by: 'by_courier', courier_name: '', awb_number: '', later: false, tampered: false });
    chosen.forEach((r) => loadUnits(r, false));
  };
  const loadUnits = (r, showAll) => {
    fetchPartUnits(r, showAll)
      .then(({ data }) => setDrawer((d) => d && ({ ...d, units: { ...d.units, [r.id]: data.instances || [] }, showAll: { ...d.showAll, [r.id]: showAll } })))
      .catch((e) => { toast.error(errMsg(e, 'Could not load the units')); setDrawer((d) => d && ({ ...d, units: { ...d.units, [r.id]: [] } })); });
  };
  const submitApprove = async () => {
    const d = drawer;
    const missing = chosen.filter((r) => !d.pick[r.id]);
    if (missing.length) { toast.error(`Pick the unit for ${missing.map((r) => r.part_name).join(', ')}`); return; }
    const anyShowAll = chosen.some((r) => d.showAll[r.id]);
    if (anyShowAll && d.mismatch.trim().length < 3) { toast.error('Say why a unit not tagged for this laptop is used'); return; }
    const instance_map = Object.fromEntries(chosen.map((r) => [r.id, Number(d.pick[r.id])]));
    const base = { request_ids: chosen.map((r) => r.id), instance_map, fitment_mismatch_reason: anyShowAll ? d.mismatch.trim() : undefined };
    if (d.mode === 'tech') {
      const r = await run(() => approvePartsToTechnician(base), 'Challan made');
      if (r) { setSel(new Set()); setDrawer({ kind: 'sign', challanId: r.data.challan_id, challanNumber: r.data.challan_number, signer: chosen[0]?.tech_name || '', esign: null }); }
      return;
    }
    if (d.ship_by === 'by_courier' && !d.later && !d.courier_name.trim()) { toast.error('Courier name, or "add courier later"'); return; }
    const r = await run(() => approvePartsToCustomer({
      ...base, ship_by: d.ship_by, courier_name: d.courier_name.trim() || undefined, awb_number: d.awb_number.trim() || undefined,
      add_courier_later: d.ship_by === 'by_courier' && d.later, tampered_by_customer: d.tampered, charge_amount: 0,
    }), 'Part DC made');
    if (r) { setSel(new Set()); setDrawer(null); }
  };

  /* ---------- columns ---------- */
  const reqCols = [
    { key: 'x', header: '', width: '2.5rem', render: (r) => <input type="checkbox" aria-label={`Pick ${r.request_number}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} /> },
    { key: 'n', header: 'Request', render: (r) => <DocNumber value={r.request_number} />, sub: (r) => <DateTime value={r.created_at} /> },
    { key: 'p', header: 'Part', render: (r) => `${r.part_name}${r.quantity > 1 ? ` × ${r.quantity}` : ''}`, sub: (r) => `${r.available} in stock${r.location_code ? ` · ${r.location_code}` : ''}` },
    { key: 't', header: 'Ticket / laptop', render: (r) => r.ticket_number, sub: (r) => [r.ttspl_id, r.laptop_brand, r.laptop_model].filter(Boolean).join(' · ') || r.customer_name },
    { key: 'w', header: 'For', render: (r) => r.tech_name, sub: (r) => (toCustomer(r) ? 'Send to the customer' : 'Hand to the technician') },
    {
      key: 'c',
      header: 'Charge',
      render: (r) => (chargeable(r) ? (priced(r) ? <Money value={r.charge_amount} /> : <span style={{ color: 'var(--alert-warn)', fontWeight: 600 }}>Needs price</span>) : 'Free'),
      sub: (r) => (chargeable(r) ? r.charge_reason || null : null),
    },
    {
      key: 'a',
      header: '',
      render: (r) => canEdit && (
        <div className="flex" style={{ gap: '6px' }} onClick={(e) => e.stopPropagation()} role="presentation">
          {chargeable(r) && <Button variant="quiet" onClick={() => setDrawer({ kind: 'price', r, amount: priced(r) ? String(r.charge_amount) : '' })}>{priced(r) ? 'Change price' : 'Set price'}</Button>}
          <Button variant="quiet" onClick={() => { if (window.confirm(`Cancel ${r.request_number}?`)) run(() => cancelPartRequest(r.id), 'Request cancelled'); }}>Cancel</Button>
        </div>
      ),
    },
  ];
  const retCols = [
    { key: 'n', header: 'Request', render: (r) => <DocNumber value={r.request_number} />, sub: (r) => <DateTime value={r.return_requested_at || r.created_at} /> },
    { key: 'p', header: 'Part', render: (r) => r.part_name },
    { key: 'w', header: 'Technician', render: (r) => r.tech_name, sub: (r) => r.ticket_number },
    { key: 'a', header: '', render: (r) => canEdit && <Button onClick={() => setDrawer({ kind: 'return', r, signer: '', esign: null })}>Receive + sign</Button> },
  ];
  const moveCols = [
    { key: 'n', header: 'Request', render: (r) => <DocNumber value={r.request_number} />, sub: (r) => <DateTime value={r.reassign_requested_at} /> },
    { key: 'p', header: 'Part', render: (r) => r.part_name, sub: (r) => r.prt_id || null },
    { key: 'f', header: 'From', render: (r) => r.from_ticket_number, sub: (r) => [r.from_ttspl_id, r.from_customer].filter(Boolean).join(' · ') },
    { key: 't', header: 'To', render: (r) => r.to_ticket_number || '—', sub: (r) => [r.reassign_to_ttspl_id || r.reassign_to_serial, r.to_customer].filter(Boolean).join(' · ') },
    { key: 'w', header: 'Technician', render: (r) => r.tech_name, sub: (r) => r.reassign_reason || null },
    {
      key: 'a',
      header: '',
      render: (r) => canEdit && (
        <div className="flex" style={{ gap: '6px' }}>
          <Button variant="primary" disabled={busy} onClick={() => run(() => resolvePartMove(r.id, 'approve'), 'Move approved')}>Approve</Button>
          <Button variant="quiet" disabled={busy} onClick={() => run(() => resolvePartMove(r.id, 'reject'), 'Move rejected')}>Reject</Button>
        </div>
      ),
    },
  ];
  const dcOutCols = [
    { key: 'n', header: 'Part DC', render: (d) => <DocNumber value={d.dc_number} />, sub: (d) => <DateTime value={d.created_at} /> },
    { key: 'c', header: 'Customer', render: (d) => d.customer_name, sub: (d) => d.ticket_number },
    { key: 'k', header: 'Courier', render: (d) => (d.courier_name ? `${d.courier_name}${d.awb_number ? ` · ${d.awb_number}` : ''}` : <span style={{ color: 'var(--alert-warn)' }}>Not added</span>), sub: (d) => d.ship_by === 'by_hand' ? 'By hand' : null },
    {
      key: 'a',
      header: '',
      render: (d) => canEdit && (
        <div className="flex" style={{ gap: '6px' }}>
          <Button variant="quiet" onClick={() => setDrawer({ kind: 'courier', dc: d.dc_number, courier_name: d.courier_name || '', awb_number: d.awb_number || '' })}>Courier</Button>
          <Button disabled={busy} onClick={() => { if (window.confirm(`Mark ${d.dc_number} delivered?`)) run(() => markPartDcDelivered(d.dc_number), 'Delivered'); }}>Delivered</Button>
        </div>
      ),
    },
  ];
  const dcBackCols = [
    { key: 'n', header: 'Old-part return DC', render: (d) => <DocNumber value={d.dc_number} />, sub: (d) => <DateTime value={d.created_at} /> },
    { key: 'c', header: 'From', render: (d) => d.customer_name, sub: (d) => d.ticket_number },
    { key: 'k', header: 'Courier', render: (d) => (d.courier_name ? `${d.courier_name}${d.awb_number ? ` · ${d.awb_number}` : ''}` : '—') },
    { key: 'a', header: '', render: (d) => canEdit && <Button disabled={busy} onClick={() => { if (window.confirm(`Receive the old parts on ${d.dc_number}?`)) run(() => receivePartReturnDc(d.dc_number), 'Received'); }}>Received</Button> },
  ];

  const count = (a) => (a == null ? '…' : a.length);
  const tabs = [
    { key: 'requests', label: `Requests · ${count(q?.pending)}` },
    { key: 'returns', label: `Returns · ${count(q?.returns)}` },
    { key: 'moves', label: `Moves · ${count(q?.reassigns)}` },
    { key: 'dcs', label: `Part DCs · ${dcs.out == null || dcs.back == null ? '…' : dcs.out.length + dcs.back.length}` },
  ];

  const d = drawer;
  return (
    <DeskShell title="Support parts desk" breadcrumb="Serve" subtitle="Parts the technicians asked for: pick the unit, hand it over or send it, and take unused ones back.">
      <div className="c-stack">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {q === null ? <EmptyState title="Loading…" /> : (
          <>
            {tab === 'requests' && (
              <Section
                title="Waiting for the warehouse"
                actions={(
                  <>
                    <Input type="search" placeholder="Request, ticket, part, TTSPL" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '16rem' }} aria-label="Search" />
                    {canEdit && sel.size > 0 && (
                      <>
                        <Button variant="primary" onClick={() => startApprove('tech')}>Hand to technician · {sel.size}</Button>
                        <Button onClick={() => startApprove('customer')}>Send to customer · {sel.size}</Button>
                      </>
                    )}
                  </>
                )}
              >
                <DataTable columns={reqCols} rows={pending} rowKey={(r) => r.id} onRowClick={(r) => toggle(r.id)} empty={<EmptyState title="No part requests waiting" />} />
              </Section>
            )}
            {tab === 'returns' && (
              <Section title="Unused parts coming back">
                <DataTable columns={retCols} rows={(q.returns || []).filter(match)} rowKey={(r) => r.id} empty={<EmptyState title="Nothing coming back" />} />
              </Section>
            )}
            {tab === 'moves' && (
              <Section title="Move a held part to another ticket">
                <DataTable columns={moveCols} rows={(q.reassigns || []).filter(match)} rowKey={(r) => r.id} empty={<EmptyState title="No move requests" />} />
              </Section>
            )}
            {tab === 'dcs' && (
              <>
                <Section title="Parts sent to customers — not delivered yet">
                  {dcs.out === null ? <EmptyState title="Loading…" /> : <DataTable columns={dcOutCols} rows={dcs.out} rowKey={(x) => x.dc_number} empty={<EmptyState title="None open" />} />}
                </Section>
                <Section title="Old parts coming back (RPDC)">
                  {dcs.back === null ? <EmptyState title="Loading…" /> : <DataTable columns={dcBackCols} rows={dcs.back} rowKey={(x) => x.dc_number} empty={<EmptyState title="None in transit" />} />}
                </Section>
              </>
            )}
          </>
        )}
      </div>

      <Drawer
        open={d?.kind === 'approve'}
        onClose={() => setDrawer(null)}
        title={d?.mode === 'tech' ? 'Hand to the technician' : 'Send to the customer'}
        width="42rem"
        footer={<Button variant="primary" disabled={busy} onClick={submitApprove}>{d?.mode === 'tech' ? 'Make the challan' : 'Make the Part DC'}</Button>}
      >
        {d?.kind === 'approve' && (
          <div className="c-stack">
            {chosen.map((r) => {
              const units = d.units[r.id];
              return (
                <Field key={r.id} label={`${r.request_number} — ${r.part_name}${r.laptop_model ? ` for ${[r.laptop_brand, r.laptop_model].filter(Boolean).join(' ')}` : ''}`} required>
                  {units === undefined ? <p className="text-ink-3">Loading units…</p> : (
                    <>
                      <Select
                        value={String(d.pick[r.id] || '')}
                        onChange={(e) => setDrawer({ ...d, pick: { ...d.pick, [r.id]: e.target.value } })}
                        placeholder={units.length ? 'Pick the unit (serial / PRT-ID)…' : 'No unit in stock fits this laptop'}
                        options={units.map((u) => ({ value: String(u.instance_id), label: `${u.serial_number || 'No serial'} · ${u.prt_id}${u.location_code ? ` · ${u.location_code}` : ''}${u.fitment === 'specific' ? ` · for ${u.fits_laptop_brand || ''} ${(u.fits_laptop_models || []).join('/')}` : ''}` }))}
                      />
                      {!d.showAll[r.id] && <Button variant="quiet" onClick={() => loadUnits(r, true)}>Show every unit of this part</Button>}
                    </>
                  )}
                </Field>
              );
            })}
            {chosen.some((r) => d.showAll[r.id]) && (
              <Field label="Why use a unit not tagged for this laptop" required>
                <Input value={d.mismatch} onChange={(e) => setDrawer({ ...d, mismatch: e.target.value })} />
              </Field>
            )}
            {chosen.some(chargeable) && (
              <Notice tone="info">Chargeable: {chosen.filter(chargeable).map((r) => `${r.part_name} ₹${r.charge_amount}`).join(', ')} — goes to Accounts once used / delivered.</Notice>
            )}
            {d.mode === 'tech' ? <p className="text-ink-3">Next: the technician signs on this screen to take the parts.</p> : (
              <FormGrid cols={2}>
                <Field label="How it goes" span={2}>
                  <Select value={d.ship_by} onChange={(e) => setDrawer({ ...d, ship_by: e.target.value })} options={[{ value: 'by_courier', label: 'Courier' }, { value: 'by_hand', label: 'By hand' }]} />
                </Field>
                {d.ship_by === 'by_courier' && (
                  <>
                    <Field label="Courier"><Input value={d.courier_name} disabled={d.later} onChange={(e) => setDrawer({ ...d, courier_name: e.target.value })} /></Field>
                    <Field label="AWB"><Input value={d.awb_number} disabled={d.later} onChange={(e) => setDrawer({ ...d, awb_number: e.target.value })} /></Field>
                    <Checkbox label="Add courier details later" checked={d.later} onChange={(e) => setDrawer({ ...d, later: e.target.checked })} />
                  </>
                )}
                <Checkbox label="The customer tampered with the laptop" checked={d.tampered} onChange={(e) => setDrawer({ ...d, tampered: e.target.checked })} />
              </FormGrid>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={d?.kind === 'sign'}
        onClose={() => setDrawer(null)}
        title={`Technician signs — ${d?.challanNumber || ''}`}
        footer={d?.kind === 'sign' && <Button variant="primary" disabled={busy || !d.esign || !d.signer.trim()} onClick={async () => { const r = await run(() => signPartChallan(d.challanId, { esign_data: d.esign, signer_name: d.signer.trim() }), 'Parts issued to the technician'); if (r) setDrawer(null); }}>Issue the parts</Button>}
      >
        {d?.kind === 'sign' && (
          <div className="c-stack">
            <p className="text-ink-3">The challan is made. The technician signs to take the parts; you can also close this and they sign later from the old challan screen.</p>
            <Field label="Technician's name" required><Input value={d.signer} onChange={(e) => setDrawer({ ...d, signer: e.target.value })} /></Field>
            {d.esign ? <Button variant="quiet" onClick={() => setDrawer({ ...d, esign: null })}>Sign again</Button>
              : <SignaturePadComponent onSave={(esign) => setDrawer((x) => ({ ...x, esign }))} onCancel={() => setDrawer({ ...d, esign: null })} />}
          </div>
        )}
      </Drawer>

      <Drawer
        open={d?.kind === 'return'}
        onClose={() => setDrawer(null)}
        title={`Receive ${d?.r?.part_name || ''} back`}
        footer={d?.kind === 'return' && <Button variant="primary" disabled={busy || !d.esign || !d.signer.trim()} onClick={async () => { const r = await run(() => acceptPartReturn(d.r.id, { esign_data: d.esign, signer_name: d.signer.trim() }), 'Return accepted — back in stock'); if (r) setDrawer(null); }}>Accept the return</Button>}
      >
        {d?.kind === 'return' && (
          <div className="c-stack">
            <p className="text-ink-3">{d.r.request_number} from {d.r.tech_name}. Check the part, then sign for the warehouse.</p>
            <Field label="Your name" required><Input value={d.signer} onChange={(e) => setDrawer({ ...d, signer: e.target.value })} /></Field>
            {d.esign ? <Button variant="quiet" onClick={() => setDrawer({ ...d, esign: null })}>Sign again</Button>
              : <SignaturePadComponent onSave={(esign) => setDrawer((x) => ({ ...x, esign }))} onCancel={() => setDrawer({ ...d, esign: null })} />}
          </div>
        )}
      </Drawer>

      <Drawer
        open={d?.kind === 'price'}
        onClose={() => setDrawer(null)}
        title={`Price — ${d?.r?.part_name || ''}`}
        footer={d?.kind === 'price' && <Button variant="primary" disabled={busy || !(Number(d.amount) > 0)} onClick={async () => { const r = await run(() => setPartPrice(d.r.id, Number(d.amount)), 'Price set'); if (r) setDrawer(null); }}>Save price</Button>}
      >
        {d?.kind === 'price' && (
          <div className="c-stack">
            <p className="text-ink-3">Support marked this chargeable: {d.r.charge_reason || '—'}. {d.r.unit_cost ? `Our cost ₹${d.r.unit_cost}.` : ''}</p>
            <Field label="Price to the customer (₹, before GST)" required><Input type="number" min="1" step="0.01" value={d.amount} onChange={(e) => setDrawer({ ...d, amount: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={d?.kind === 'courier'}
        onClose={() => setDrawer(null)}
        title={`Courier — ${d?.dc || ''}`}
        footer={d?.kind === 'courier' && <Button variant="primary" disabled={busy || !d.courier_name.trim()} onClick={async () => { const r = await run(() => setPartDcCourier(d.dc, { courier_name: d.courier_name.trim(), awb_number: d.awb_number.trim() || undefined }), 'Courier saved'); if (r) setDrawer(null); }}>Save</Button>}
      >
        {d?.kind === 'courier' && (
          <div className="c-stack">
            <Field label="Courier" required><Input value={d.courier_name} onChange={(e) => setDrawer({ ...d, courier_name: e.target.value })} /></Field>
            <Field label="AWB"><Input value={d.awb_number} onChange={(e) => setDrawer({ ...d, awb_number: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

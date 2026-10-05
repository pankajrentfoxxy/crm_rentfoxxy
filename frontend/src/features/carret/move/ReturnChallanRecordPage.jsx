import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, KeyValue, Money, Notice, Panel, StatusChip,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { SignaturePad as SignaturePadComponent } from '../../../components/carret';
import DamageReportDrawer from '../serve/DamageReportDrawer';
import { fetchDamageCases } from '../serve/serveApi';

/**
 * Movement → Return challans → one RDC (claude/carret-customers-returns-control.md).
 * Each laptop's way back: collected (customer OTP), gate inward, configuration
 * check, warehouse receive. The warehouse receives with a signature — that day
 * is when rent stops (RT1) — and records any damage for the damage-charges flow.
 */
const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';
const tick = (v, label) => (v ? <span style={{ color: 'var(--ok, #15803d)' }}>✓ {label}</span> : <span className="text-ink-3">— {label}</span>);

/** Config check cell: matched, mismatched (what differed), or waiting on the script. */
function configCheck(i) {
  const r = i.return_config_result && typeof i.return_config_result === 'object' ? i.return_config_result : null;
  if (i.return_config_verified_at) return tick(true, 'matched');
  if (r && r.configurationMatched === false) return <span style={{ color: 'var(--alert-crit, #b91c1c)', fontWeight: 600 }}>✗ mismatch</span>;
  return tick(false, 'script');
}
function configCheckNote(i) {
  const r = i.return_config_result && typeof i.return_config_result === 'object' ? i.return_config_result : null;
  const parts = [];
  if (!i.return_config_verified_at && r?.configurationMatched === false) {
    const off = (r.checks || []).filter((c) => c.matched === false).map((c) => `${c.field}: ${c.actual || '—'}`);
    parts.push(off.length ? `laptop has ${off.join(', ')}` : (r.errors || []).join('; '));
  }
  if (r?.edited_by_super_admin) parts.push(`expected config edited by Super Admin${r.edited_by_name ? ` (${r.edited_by_name})` : ''}`);
  if (i.return_laptop_condition) parts.push(i.return_laptop_condition);
  return parts.filter(Boolean).join(' · ') || null;
}

const EDIT_CONFIG_FIELDS = [['brand', 'Brand'], ['model', 'Model'], ['processor', 'Processor'], ['generation', 'Generation'], ['ram', 'RAM'], ['ssd', 'SSD'], ['gpu', 'GPU']];
const EDIT_RESULT = {
  matched: ['good', 'Expected config updated — the laptop now matches and is cleared for warehouse receive'],
  still_mismatch: ['crit', 'Expected config updated — the laptop still does not match'],
  awaiting_script: ['good', 'Expected config updated — run the script on the laptop'],
  already_verified: ['good', 'Expected config updated'],
};
/** The expected config the unit is checked against. */
function initialEditConfig(i) {
  const e = i?.return_capture?.expected_config || {};
  return {
    brand: e.brand || i?.brand || '', model: e.model || i?.model || '', processor: e.processor || i?.processor || '',
    generation: e.generation || i?.generation || '', ram: e.ram || i?.ram || '', ssd: e.ssd || e.storage || i?.storage || '', gpu: e.gpu || '',
  };
}
/** What the laptop reported on its last script run, by field. */
function laptopReadings(i) {
  const out = {};
  for (const c of i?.return_config_result?.checks || []) {
    if (c.actual != null && c.actual !== '') out[c.field] = { value: String(c.actual), matched: c.matched };
  }
  return out;
}

export default function ReturnChallanRecordPage() {
  const { rdcNumber } = useParams();
  const rdc = decodeURIComponent(rdcNumber);
  const { hasPermission, user } = usePermission();
  const isSuper = user?.role === 'super_admin';
  const canReceive = hasPermission('return_dc', 'edit');
  const canDamage = ['damage_charges', 'support_tickets', 'return_dc'].some((s) => hasPermission(s, 'create'));
  const [d, setD] = useState(null);
  const [damage, setDamage] = useState([]);
  const [receive, setReceive] = useState(null);
  const [damageFor, setDamageFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editFor, setEditFor] = useState(null); // { item, form }

  const load = useCallback(() => {
    api.get(`/sales-management/return-dc/${encodeURIComponent(rdc)}/detail`).then(({ data }) => setD(data)).catch((e) => setD({ error: errMsg(e) }));
    fetchDamageCases({ return_dc_number: rdc }).then(({ data }) => setDamage(data.data || [])).catch(() => setDamage([]));
  }, [rdc]);
  useEffect(() => { load(); }, [load]);

  const confirmReceive = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/sales-management/return-dc/${encodeURIComponent(rdc)}/warehouse-confirm`, { esign_data: receive.esign, signer_name: receive.name });
      toast.success(data.message || 'Received at the warehouse');
      setReceive(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const saveConfig = async () => {
    const { item, form } = editFor;
    if (!form.processor.trim() || !form.ram.trim() || !form.ssd.trim()) { toast.error('Processor, RAM and SSD are required'); return; }
    setBusy(true);
    try {
      const { data } = await api.patch(`/sales-management/return-dc/${encodeURIComponent(rdc)}/items/${item.id}/config`, { config: form });
      const [tone, msg] = EDIT_RESULT[data.status] || ['good', 'Expected config updated'];
      if (tone === 'crit') toast.error(msg); else toast.success(msg);
      setEditFor(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const openPdf = async () => {
    try {
      const r = await api.get(`/sales-management/return-dc/${encodeURIComponent(rdc)}/download-pdf`, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data), '_blank');
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!d) return <DeskShell title={rdc} breadcrumb="Movement / Return challans"><EmptyState title="Loading…" /></DeskShell>;
  if (d.error) return <DeskShell title={rdc} breadcrumb="Movement / Return challans"><EmptyState title="Not available" body={d.error} /></DeskShell>;

  const items = d.pickup_items || [];
  const received = items.length > 0 && items.every((i) => i.warehouse_received_at);
  const cols = [
    { key: 't', header: 'Laptop', render: (i) => <Link to={`/carret/stock/assets/${encodeURIComponent(i.ttspl_id || i.serial_number)}`}><DocNumber value={i.ttspl_id || i.serial_number} /></Link>, sub: (i) => [i.brand, i.model, i.ram, i.storage].filter(Boolean).join(' · ') },
    { key: 'p', header: 'Collected', render: (i) => tick(i.customer_otp_verified_at || d.customer_otp_verified_at, 'customer OTP'), sub: (i) => (i.tech_name ? `by ${i.tech_name}` : null) },
    { key: 'g', header: 'Gate', render: (i) => tick(i.gate_inward_at || d.gate_inward_at, 'inward') },
    { key: 'c', header: 'Config check', render: configCheck, sub: configCheckNote },
    { key: 'w', header: 'Warehouse', render: (i) => (i.warehouse_received_at ? <span><DateTime value={i.warehouse_received_at} /></span> : <span className="text-ink-3">not received</span>), sub: (i) => i.warehouse_receiver_name },
    {
      key: 'x',
      header: '',
      render: (i) => (
        <div className="flex flex-wrap" style={{ gap: '6px' }}>
          {isSuper && d.status !== 'cancelled' && !i.warehouse_received_at && (
            <Button variant="quiet" onClick={() => setEditFor({ item: i, form: initialEditConfig(i) })}>Edit config</Button>
          )}
          {canDamage && <Button variant="quiet" onClick={() => setDamageFor(i)}>Record damage</Button>}
        </div>
      ),
    },
  ];
  const damageCols = [
    { key: 'l', header: 'Laptop', render: (c) => <DocNumber value={c.asset_code} /> },
    { key: 'p', header: 'Damage', render: (c) => (c.lines || []).map((l) => `${l.part_name}: ${l.issue}`).join('; ') },
    { key: 's', header: 'Status', render: (c) => ({ reported: 'Waiting for warehouse price', priced: 'Priced — Sales / Accounts to propose', proposed: 'With Accounts', approved: 'Approved', waived: 'Waived', rejected: 'Rejected', cancelled: 'Cancelled', billed: 'Billed' }[c.status] || c.status) },
    { key: 'a', header: 'Amount', numeric: true, render: (c) => (c.status === 'reported' ? '—' : <Money value={c.approved_amount ?? c.total} />) },
  ];

  return (
    <DeskShell
      title={rdc}
      breadcrumb="Movement / Return challans"
      actions={(
        <div className="flex" style={{ gap: '6px' }}>
          <Button variant="quiet" onClick={openPdf}>Challan PDF</Button>
          {canReceive && !received && <Button variant="primary" disabled={!d.can_warehouse_confirm} title={d.warehouse_block_reason || ''} onClick={() => setReceive({ esign: null, name: '' })}>Receive at warehouse</Button>}
        </div>
      )}
    >
      <div className="c-stack">
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <StatusChip status={d.status === 'in_transit' ? 'dispatched' : d.status} label={({ pending: 'To collect', in_transit: 'On the way', shipped: 'On the way', reached: 'Reached', delivered: 'Received', cancelled: 'Cancelled' })[d.status]} />
          {d.ticket_id && <Link to={`/carret/serve/tickets/${d.ticket_id}`}>Ticket #{d.ticket_id}</Link>}
        </div>
        {!received && d.warehouse_block_reason && <Notice tone="warn" title="Not ready for warehouse receive">{d.warehouse_block_reason}</Notice>}
        {!received && <Notice tone="info">Rent keeps running until the warehouse receives the laptops.</Notice>}
        <Panel title="Customer and pickup">
          <div className="c-card-b">
            <KeyValue
              cols={3}
              items={[
                { label: 'Customer', value: d.customer_id ? <Link to={`/carret/sell/customers/${d.customer_id}`}>{d.customer_name || `#${d.customer_id}`}</Link> : d.customer_name },
                { label: 'Phone', value: d.customer_phone },
                { label: 'Pickup address', value: typeof d.pickup_address === 'object' && d.pickup_address ? [d.pickup_address.address, d.pickup_address.city, d.pickup_address.pincode].filter(Boolean).join(', ') : d.pickup_address },
                { label: 'Collected by', value: d.dispatch_mode },
                { label: 'Raised', value: <DateTime value={d.created_at} /> },
                { label: 'Original challan', value: d.original_dc_number ? <DocNumber value={d.original_dc_number} /> : '—' },
                d.can_view_otp && d.customer_otp_code && { label: 'Customer OTP', value: d.customer_otp_code },
                d.esign?.warehouse_at && { label: 'Received by', value: <>{d.esign.warehouse_name || '—'} · <DateTime value={d.esign.warehouse_at} /></> },
              ]}
            />
          </div>
        </Panel>
        <Panel title={`Laptops · ${items.length}`}>
          <DataTable columns={cols} rows={items} rowKey={(i) => i.id} empty={<EmptyState title="No laptops on this challan" />} />
        </Panel>
        {(d.sibling_rdcs || []).length > 0 && (
          <Panel title="Other return challans on this ticket">
            <DataTable
              columns={[
                { key: 'n', header: 'Return DC', render: (x) => <Link to={`/carret/move/return-challans/${encodeURIComponent(x.dc_number)}`}><DocNumber value={x.dc_number} /></Link>, sub: (x) => <DateTime value={x.created_at} /> },
                { key: 'l', header: 'Laptops', render: (x) => x.codes || '—', sub: (x) => `${x.laptops} laptop(s) · ${x.received} received` },
                { key: 's', header: 'Status', render: (x) => <StatusChip status={x.status === 'in_transit' ? 'dispatched' : x.status} label={({ pending: 'To collect', in_transit: 'On the way', shipped: 'On the way', reached: 'Reached', delivered: 'Received', cancelled: 'Cancelled' })[x.status]} /> },
              ]}
              rows={d.sibling_rdcs}
              rowKey={(x) => x.dc_number}
            />
            <p className="text-ink-3" style={{ padding: '8px 12px' }}>A laptop the customer kept is moved to its own Return DC (Collect later); each challan goes through the gate and the warehouse on its own.</p>
          </Panel>
        )}
        {damage.length > 0 && (
          <Panel title="Damage found">
            <DataTable columns={damageCols} rows={damage} rowKey={(c) => c.id} />
            <p className="text-ink-3" style={{ padding: '8px 12px' }}>Priced and approved on <Link to="/carret/serve/damage">Support → Damage charges</Link>.</p>
          </Panel>
        )}
      </div>

      <Drawer open={Boolean(receive)} onClose={() => setReceive(null)} title={`Receive ${rdc} at the warehouse`} footer={<Button variant="primary" disabled={busy || !receive?.esign || !receive?.name?.trim()} onClick={confirmReceive}>Confirm receipt</Button>}>
        {receive && (
          <div className="c-stack">
            <p>Check each laptop against the challan. Record any damage before or after receiving — it goes to the warehouse for pricing. Rent stops today.</p>
            <Field label="Received by" required><Input value={receive.name} onChange={(e) => setReceive({ ...receive, name: e.target.value })} /></Field>
            {receive.esign
              ? <div className="c-stack"><img src={receive.esign} alt="Signature" style={{ height: 80, border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)' }} /><Button variant="quiet" onClick={() => setReceive({ ...receive, esign: null })}>Sign again</Button></div>
              : <SignaturePadComponent onSave={(esign) => setReceive((x) => ({ ...x, esign }))} onCancel={() => setReceive(null)} />}
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(editFor)}
        onClose={() => setEditFor(null)}
        title={editFor ? `Expected config — ${editFor.item.ttspl_id || editFor.item.serial_number}` : ''}
        footer={<Button variant="primary" disabled={busy} onClick={saveConfig}>{busy ? 'Saving…' : 'Save'}</Button>}
      >
        {editFor && (
          <div className="c-stack">
            <p className="text-ink-3">Super Admin only. Saves on the asset. If the laptop&apos;s last script reading matches the new config, the unit is cleared for warehouse receive.</p>
            {EDIT_CONFIG_FIELDS.map(([key, label]) => {
              const reading = laptopReadings(editFor.item)[key];
              return (
                <Field
                  key={key}
                  label={label}
                  required={['processor', 'ram', 'ssd'].includes(key)}
                  hint={reading ? (
                    <span style={reading.matched ? undefined : { color: 'var(--alert-crit, #b91c1c)' }}>
                      Laptop reported: {reading.value}
                      {!reading.matched && (
                        <button type="button" style={{ marginLeft: '8px', fontWeight: 600, color: 'var(--accent)', background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setEditFor((x) => ({ ...x, form: { ...x.form, [key]: reading.value } }))}>Use this</button>
                      )}
                    </span>
                  ) : undefined}
                >
                  <Input value={editFor.form[key]} onChange={(e) => setEditFor((x) => ({ ...x, form: { ...x.form, [key]: e.target.value } }))} maxLength={200} />
                </Field>
              );
            })}
          </div>
        )}
      </Drawer>

      <DamageReportDrawer
        open={Boolean(damageFor)}
        onClose={() => setDamageFor(null)}
        onDone={() => { setDamageFor(null); load(); }}
        laptop={damageFor ? { asset_code: damageFor.ttspl_id || damageFor.serial_number } : null}
        source={damageFor?.warehouse_received_at || received ? 'warehouse_receive' : 'return_pickup'}
        ticketId={d.ticket_id}
        ticketItemId={damageFor?.id}
        returnDcNumber={rdc}
        customerId={d.customer_id}
      />
    </DeskShell>
  );
}

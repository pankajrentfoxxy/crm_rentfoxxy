import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Notice, Section,
  Segmented, Select, StatusChip,
} from '../../../components/carret';
import { createDcsByAddress, getDCMeta, listSalesOrders } from '../../sales-pipeline/salesPipelineApi';
import { AddressFields, AddressText, validateAddress } from '../sell/CustomerAddresses';
import { configText } from '../sell/LineItemsEditor';
import { parseJson } from '../sell/sellShared';

/**
 * Move → New delivery challan (from a sales order).
 *
 * One challan per delivery address: the laptops on the order are grouped by
 * where they ship, exactly as the old form and POST /create-dcs-by-address do.
 * Only laptops that passed Dispatch QC can be ticked — the server refuses the
 * rest — and a challan is created at dispatch_ready, waiting for the gate.
 *
 * BlueDart: leave the AWB empty and the server books the waybill as soon as the
 * challan exists (the old form's per-laptop booking step is not needed).
 */
const MODES = [
  { value: 'by_hand', label: 'By hand (our technician)' },
  { value: 'by_courier', label: 'Courier' },
  { value: 'by_porter', label: 'Porter' },
];

const addrKey = (a) => {
  const x = parseJson(a);
  if (!x) return '__none__';
  return `${(x.address || '').trim().toLowerCase()}|${String(x.pincode || x.zip_code || '').trim()}|${(x.city || '').trim().toLowerCase()}`;
};
const toStored = (a) => (a ? { ...a, pincode: a.pincode || a.zip_code } : null);

function buildGroups(meta) {
  const map = new Map();
  (meta.attached_serials || []).forEach((s) => {
    const k = addrKey(s.delivery_address);
    if (!map.has(k)) map.set(k, { key: k, address: parseJson(s.delivery_address), is_wfh: Boolean(s.is_wfh), serials: [] });
    map.get(k).serials.push({ ...s, selected: s.qc_status === 'passed' });
  });
  const groups = [...map.values()];
  groups.forEach((g) => { if (!g.address) g.address = parseJson(meta.shipping_address) || parseJson(meta.billing_address); });
  return groups.map((g, i) => ({ ...g, idx: i, dispatch: { courier: 'BlueDart' } }));
}

export default function ChallanCreatePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const so = params.get('so') || '';

  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [mode, setMode] = useState('by_hand');
  const [editAddr, setEditAddr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!so) return;
    setMeta(null); setError('');
    getDCMeta(so)
      .then(({ data }) => { setMeta(data); setGroups(buildGroups(data)); })
      .catch((e) => setError(e?.response?.data?.message || 'Could not load the order.'));
  }, [so]);

  const isSale = ['sale', 'sales'].includes(String(meta?.quotation_type || '').toLowerCase());
  const techs = (meta?.delivery_technicians || []).filter((t) => t.is_active !== false);
  const needVehicle = isSale && (mode === 'by_porter' || mode === 'by_hand');

  const setGroup = (i, patch) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const setDispatch = (i, patch) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, dispatch: { ...g.dispatch, ...patch } } : g)));
  const toggle = (i, allocationId) => setGroups((gs) => gs.map((g, j) => (j !== i ? g : {
    ...g, serials: g.serials.map((s) => (s.allocation_id === allocationId ? { ...s, selected: !s.selected } : s)),
  })));

  const chosen = groups.map((g) => g.serials.filter((s) => s.selected && s.qc_status === 'passed'));
  const dcCount = chosen.filter((c) => c.length).length;
  const unitCount = chosen.reduce((n, c) => n + c.length, 0);
  const notPassed = groups.reduce((n, g) => n + g.serials.filter((s) => s.qc_status !== 'passed').length, 0);

  const groupErrors = useCallback((g, i) => {
    if (!chosen[i].length) return [];
    const e = [];
    const d = g.dispatch || {};
    if (mode === 'by_courier' && d.courier === 'Other' && !String(d.courier_name || '').trim()) e.push('Courier name');
    if (mode === 'by_porter' && !String(d.porter_tracking_id || '').trim()) e.push('Porter tracking ID');
    if (mode === 'by_hand' && !d.delivery_person_id) e.push('Delivery technician');
    if (needVehicle && !String(d.vehicle_number || '').trim()) e.push('Vehicle number');
    if (!g.address?.address) e.push('Delivery address');
    return e;
  }, [chosen, mode, needVehicle]);

  const submit = async () => {
    setTried(true);
    if (!unitCount) { toast.error('Tick at least one laptop that passed Dispatch QC'); return; }
    const problems = groups.map((g, i) => groupErrors(g, i)).flat();
    if (problems.length) { toast.error(`Missing: ${[...new Set(problems)].join(', ')}`); return; }

    const dcGroups = groups.map((g, i) => {
      const units = chosen[i];
      if (!units.length) return null;
      const d = g.dispatch || {};
      const courierName = mode === 'by_courier' ? (d.courier === 'Other' ? d.courier_name.trim() : 'BlueDart') : undefined;
      const awbs = mode === 'by_courier' ? String(d.awb_number || '').split(/[\s,]+/).filter(Boolean) : [];
      return {
        delivery_address: toStored(g.address),
        is_wfh: g.is_wfh,
        allocation_ids: units.map((s) => s.allocation_id),
        laptop_shipments: units.map((s, k) => ({
          allocation_id: s.allocation_id,
          serial_id: s.serial_id || null,
          serial_number: s.serial_number || null,
          ttspl_id: s.ttspl_id || null,
          courier_name: courierName || null,
          awb_number: awbs[k] || (awbs.length === 1 ? awbs[0] : null),
          weight: null,
          remarks: null,
        })),
        courier_name: courierName,
        awb_number: awbs.join(',') || null,
        courier_tracking_url: mode === 'by_courier' ? d.courier_tracking_url || null : null,
        porter_tracking_id: mode === 'by_porter' ? d.porter_tracking_id.trim() : null,
        porter_order_id: mode === 'by_porter' ? d.porter_order_id || null : null,
        porter_booking_url: mode === 'by_porter' ? d.porter_booking_url || null : null,
        delivery_person_id: mode === 'by_hand' ? Number(d.delivery_person_id) : null,
        vehicle_number: d.vehicle_number ? d.vehicle_number.trim().toUpperCase() : null,
      };
    }).filter(Boolean);

    setSaving(true);
    try {
      const { data } = await createDcsByAddress({
        sales_order_number: so,
        ship_by: mode,
        courier_name: dcGroups[0]?.courier_name,
        courier_tracking_url: dcGroups[0]?.courier_tracking_url,
        dc_groups: dcGroups,
      });
      toast.success(data?.dcs_created > 1 ? `${data.dcs_created} challans created: ${(data.dc_numbers || []).join(', ')}` : `Challan ${data?.first_dc} created`);
      (data?.bluedart_awbs || []).forEach((r) => (r.error ? toast.error(`BlueDart for ${r.dc_number}: ${r.error}`) : toast.success(`BlueDart AWB ${r.awb_number} booked for ${r.dc_number}`)));
      navigate(`/carret/move/challans/${encodeURIComponent(data?.first_dc)}`);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not create the challan.');
    } finally {
      setSaving(false);
    }
  };

  if (!so) return <PickOrder onPick={(n) => setParams({ so: n })} />;

  return (
    <DeskShell
      title="New delivery challan"
      breadcrumb="Move / Delivery challans"
      subtitle={meta ? `For ${so} · ${meta.customer_name}${meta.dc_number ? ` · next number about ${meta.dc_number}` : ''}` : so}
    >
      {error && <EmptyState title="Could not load this order" body={error} action={<Button onClick={() => setParams({})}>Choose another order</Button>} />}
      {!meta && !error && <EmptyState title="Loading…" />}
      {meta && !groups.length && (
        <EmptyState
          title="No laptop is waiting for a challan on this order"
          body="Attach laptops on the order and get them through Dispatch QC first."
          action={<Button onClick={() => navigate(`/carret/sell/sales-orders/${encodeURIComponent(so)}`)}>Open the order</Button>}
        />
      )}
      {meta && groups.length > 0 && (
        <div className="c-split">
          <div className="c-stack">
            {notPassed > 0 && (
              <Notice tone="warn" title={`${notPassed} laptop${notPassed === 1 ? ' has' : 's have'} not passed Dispatch QC`}>
                They stay on the order and can go on a later challan once they pass.
              </Notice>
            )}

            <Section title="How it goes out">
              <div className="c-stack" style={{ gap: '10px' }}>
                <Segmented label="Dispatch mode" value={mode} onChange={setMode} options={MODES} />
                <p className="font-ui text-ink-3 m-0" style={{ fontSize: 'var(--d-sm)' }}>
                  {mode === 'by_hand' && 'Our delivery technician takes it; the customer’s OTP and a photo or signature close the delivery.'}
                  {mode === 'by_courier' && 'BlueDart is booked automatically after the challan is created, unless you type an AWB. Delivery closes from BlueDart tracking.'}
                  {mode === 'by_porter' && 'Book the Porter first, then enter its tracking ID. The gate checks it.'}
                  {isSale && ' Sale orders: the e-invoice (and an e-way bill above ₹50,000) must be uploaded by Accounts before the challan can leave.'}
                </p>
              </div>
            </Section>

            {groups.map((g, i) => {
              const errs = tried ? groupErrors(g, i) : [];
              const d = g.dispatch || {};
              return (
                <Section
                  key={g.key}
                  title={`Challan ${i + 1} of ${groups.length} · ${chosen[i].length} of ${g.serials.length} laptop${g.serials.length === 1 ? '' : 's'}${g.is_wfh ? ' · work from home' : ''}`}
                  actions={<Button variant="quiet" onClick={() => setEditAddr({ i, address: g.address })}>Change address</Button>}
                >
                  <div className="c-stack" style={{ gap: '14px' }}>
                    <AddressText address={g.address} empty="No address — set one" />
                    <DataTable
                      rows={g.serials}
                      rowKey={(s) => s.allocation_id}
                      columns={[
                        {
                          key: 'pick', header: '', width: '44px',
                          render: (s) => (
                            <input
                              type="checkbox"
                              aria-label={`Include ${s.ttspl_id}`}
                              checked={s.selected && s.qc_status === 'passed'}
                              disabled={s.qc_status !== 'passed'}
                              onChange={() => toggle(i, s.allocation_id)}
                              style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                            />
                          ),
                        },
                        { key: 't', header: 'Laptop', render: (s) => <DocNumber value={s.ttspl_id || s.serial_number} />, sub: (s) => [s.serial_number, configText({ brand: s.brand, model_name: s.model, processor: s.processor, generation: s.generation, ram: s.ram, storage: s.storage })].filter(Boolean).join(' · ') },
                        { key: 'q', header: 'Dispatch QC', render: (s) => (s.qc_status === 'passed' ? <StatusChip status="approved" /> : <StatusChip status={s.qc_status === 'failed' ? 'rejected' : 'pending'} />) },
                      ]}
                    />
                    <FormGrid cols={3}>
                      {mode === 'by_courier' && (
                        <>
                          <Field label="Courier">
                            <Select value={d.courier} onChange={(e) => setDispatch(i, { courier: e.target.value })} options={['BlueDart', 'Other']} />
                          </Field>
                          {d.courier === 'Other' && (
                            <Field label="Courier name" required error={errs.includes('Courier name') ? 'Required' : null}>
                              <Input value={d.courier_name || ''} onChange={(e) => setDispatch(i, { courier_name: e.target.value })} />
                            </Field>
                          )}
                          <Field label="AWB number(s)" hint={d.courier === 'Other' ? 'One per laptop, or one for all.' : 'Leave empty to book BlueDart automatically.'}>
                            <Input value={d.awb_number || ''} onChange={(e) => setDispatch(i, { awb_number: e.target.value })} className="font-mono" />
                          </Field>
                          <Field label="Tracking URL"><Input value={d.courier_tracking_url || ''} onChange={(e) => setDispatch(i, { courier_tracking_url: e.target.value })} /></Field>
                        </>
                      )}
                      {mode === 'by_porter' && (
                        <>
                          <Field label="Porter tracking ID" required error={errs.includes('Porter tracking ID') ? 'Required' : null}>
                            <Input value={d.porter_tracking_id || ''} onChange={(e) => setDispatch(i, { porter_tracking_id: e.target.value })} className="font-mono" />
                          </Field>
                          <Field label="Porter order ID"><Input value={d.porter_order_id || ''} onChange={(e) => setDispatch(i, { porter_order_id: e.target.value })} /></Field>
                          <Field label="Booking URL"><Input value={d.porter_booking_url || ''} onChange={(e) => setDispatch(i, { porter_booking_url: e.target.value })} /></Field>
                        </>
                      )}
                      {mode === 'by_hand' && (
                        <Field label="Delivery technician" required error={errs.includes('Delivery technician') ? 'Required' : null}>
                          <Select
                            value={d.delivery_person_id || ''}
                            onChange={(e) => setDispatch(i, { delivery_person_id: e.target.value })}
                            placeholder={techs.length ? 'Choose' : 'No active delivery technician'}
                            options={techs.map((t) => ({ value: String(t.technician_id), label: `${[t.first_name, t.last_name].filter(Boolean).join(' ')}${t.phone ? ` · ${t.phone}` : ''}` }))}
                          />
                        </Field>
                      )}
                      {(mode === 'by_hand' || mode === 'by_porter') && (
                        <Field
                          label="Vehicle number"
                          required={needVehicle}
                          error={errs.includes('Vehicle number') ? 'Required for a sale' : null}
                          hint={needVehicle ? null : 'Needed when the laptops are worth ₹50,000 or more (e-way bill).'}
                        >
                          <Input value={d.vehicle_number || ''} onChange={(e) => setDispatch(i, { vehicle_number: e.target.value })} className="font-mono" />
                        </Field>
                      )}
                    </FormGrid>
                    {g.is_wfh !== undefined && (
                      <Checkbox label="Work-from-home delivery" checked={g.is_wfh} onChange={(e) => setGroup(i, { is_wfh: e.target.checked })} />
                    )}
                  </div>
                </Section>
              );
            })}
          </div>

          <aside className="c-stack" style={{ position: 'sticky', top: '76px' }}>
            <Section title="Summary">
              <div className="c-totals">
                <div><span>Challans</span><span>{dcCount}</span></div>
                <div><span>Laptops</span><span>{unitCount}</span></div>
                <div><span>Mode</span><span>{MODES.find((m) => m.value === mode)?.label}</span></div>
              </div>
              <p className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)', margin: '10px 0 0' }}>
                Each challan is created ready for the gate. If the laptops are worth ₹50,000 or more, Accounts must add the e-way bill before the guard can let it out.
              </p>
            </Section>
            <Button variant="primary" onClick={submit} disabled={saving || !unitCount}>
              {saving ? 'Creating…' : dcCount > 1 ? `Create ${dcCount} challans` : 'Create challan'}
            </Button>
            <Button variant="quiet" onClick={() => navigate(`/carret/sell/sales-orders/${encodeURIComponent(so)}`)}>Back to the order</Button>
          </aside>
        </div>
      )}

      <Drawer
        open={Boolean(editAddr)}
        onClose={() => setEditAddr(null)}
        title="Deliver this challan to"
        width="40rem"
        footer={(
          <div className="flex justify-end" style={{ gap: '8px' }}>
            <Button variant="quiet" onClick={() => setEditAddr(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const e = validateAddress(editAddr.address);
                if (Object.keys(e).length) { setEditAddr((x) => ({ ...x, errors: e })); return; }
                setGroup(editAddr.i, { address: editAddr.address });
                setEditAddr(null);
              }}
            >
              Use this address
            </Button>
          </div>
        )}
      >
        {editAddr && (
          <AddressFields
            value={editAddr.address ? { ...editAddr.address, zip_code: editAddr.address.zip_code || editAddr.address.pincode || '' } : null}
            onChange={(address) => setEditAddr((x) => ({ ...x, address }))}
            errors={editAddr.errors || {}}
          />
        )}
      </Drawer>
    </DeskShell>
  );
}

/** No order chosen yet: find one with laptops waiting. */
function PickOrder({ onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      listSalesOrders({ search: q, status: 'pending', limit: 25 })
        .then(({ data }) => setRows((data?.sales_orders || []).filter((r) => Number(r.attached_count) > 0)))
        .catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const cols = useMemo(() => [
    { key: 'so', header: 'Order', render: (r) => <DocNumber value={r.sales_order_number} /> },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name },
    { key: 'a', header: 'Waiting', render: (r) => `${r.attached_count} attached of ${r.laptop_qty}` },
  ], []);
  return (
    <DeskShell title="New delivery challan" breadcrumb="Move / Delivery challans" subtitle="Choose the sales order the laptops belong to.">
      <div className="c-card">
        <div className="c-toolbar">
          <label className="c-search"><Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SO number or customer" autoFocus /></label>
        </div>
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable rows={rows} rowKey={(r) => r.sales_order_number} onRowClick={(r) => onPick(r.sales_order_number)} columns={cols}
            empty={<EmptyState title="No open order has attached laptops" body="Attach laptops on a sales order first." />}
          />
        )}
      </div>
    </DeskShell>
  );
}

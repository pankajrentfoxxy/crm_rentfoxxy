import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid, Input,
  KeyValue, Notice, Section, Segmented, Select, Textarea,
} from '../../../components/carret';
import { useAuth } from '../../../context/AuthContext';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { LAPTOP_CONDITIONS, PART_CATEGORIES } from '../../../constants/laptopConditions';
import { isManagerUser } from '../../vendor-management/vendorMgmtUi';
import PartLabelPrintModal from '../../inventory-management/components/PartLabelPrintModal';
import { errMsg } from './procureShared';
import { lineConfig } from './poShared';

/**
 * Procure → Vendor arrivals → receive a delivery (GRN).
 *
 * One laptop at a time, in the order the warehouse actually works:
 *   1. which PO line it is, and its condition;
 *   2. the configuration check — run on the laptop itself (access number on
 *      the laptop's browser), which also reads its serial. Required for every
 *      laptop that powers on (D5); one that won't power on is received with a
 *      reason, and a manager approves that waiver;
 *   3. receive → TTSPL assigned → label printed (D14).
 * A wrong or dead laptop is rejected at the door (D6): it still gets a TTSPL
 * so it can be traced, goes back to the vendor, and is never billed.
 */
const today = () => new Date().toISOString().slice(0, 10);
const NEEDS_CHECK = new Set(['on', 'part_missing']);
const blankUnit = (line) => ({
  line_index: line ?? 0, condition: 'on', missing_parts: [], serial: '', damage: '', waiver: '', rental_start_date: today(),
});

export default function DeliveryReceivePage() {
  const { deliveryId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('vendor_management', 'edit');
  const manager = isManagerUser(user);

  const [d, setD] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [unit, setUnit] = useState(blankUnit());
  const [capture, setCapture] = useState(null); // { token, access_number, capture_url, status, config_verified, config_check, serial_number }
  const [busy, setBusy] = useState('');
  const [reject, setReject] = useState(null); // { reason }
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [invoice, setInvoice] = useState('');
  const [labels, setLabels] = useState([]);
  const [labelOpen, setLabelOpen] = useState(false);

  const load = useCallback(() => {
    api.get(`/vendor-management/deliveries/${deliveryId}`)
      .then(({ data }) => {
        setD(data.data);
        setUnit((u) => {
          const lines = data.data.lines || [];
          const cur = lines[u.line_index];
          if (cur && Number(cur.receivedQty) < Number(cur.quantity)) return u;
          const open = lines.findIndex((l) => Number(l.receivedQty) < Number(l.quantity));
          return { ...u, line_index: open >= 0 ? open : 0 };
        });
      })
      .catch((e) => setLoadError(errMsg(e, 'Could not load the delivery.')));
  }, [deliveryId]);
  useEffect(() => { load(); }, [load]);

  const lines = d?.lines || [];
  const line = lines[unit.line_index];
  const handled = d ? d.received_count + d.rejected_count : 0;
  const open = d && ['arrived', 'receiving'].includes(d.status);
  const full = d && handled >= Number(d.laptop_count);
  const allowed = useMemo(() => {
    const a = Array.isArray(line?.allowed_conditions) && line.allowed_conditions.length ? line.allowed_conditions : ['on'];
    return LAPTOP_CONDITIONS.filter((c) => a.includes(c.value));
  }, [line]);
  const rental = ['rental_purchase', 'rent_to_own'].includes(String(d?.purchase_order_type));

  // Poll the configuration check while it runs on the laptop.
  useEffect(() => {
    if (!capture?.token || ['captured', 'used', 'expired'].includes(capture.status)) return undefined;
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/vendor-management/grn-capture-tokens/${capture.token}`);
        const s = data.data || {};
        setCapture((c) => (c && c.token === s.token ? { ...c, ...s } : c));
        if (s.serial_number) setUnit((u) => ({ ...u, serial: s.serial_number }));
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(t);
  }, [capture?.token, capture?.status]);

  const setU = (k, v) => setUnit((u) => ({ ...u, [k]: v }));
  const changeLineOrCondition = (k, v) => { setCapture(null); setUnit((u) => ({ ...u, [k]: v, serial: k === 'condition' && NEEDS_CHECK.has(v) ? '' : u.serial })); };

  const startCheck = async () => {
    setBusy('check');
    try {
      const { data } = await api.post(`/vendor-management/purchase-orders/${d.po_id}/grn-capture-tokens`, {
        line_index: unit.line_index, unit_index: handled, total_units: Number(d.laptop_count),
      });
      setCapture({ ...data.data, status: 'pending' });
      setU('serial', '');
    } catch (e) {
      toast.error(errMsg(e, 'Could not start the check'));
    } finally {
      setBusy('');
    }
  };

  const verified = capture && ['captured', 'used'].includes(capture.status) && capture.config_verified;
  const mismatched = capture && ['captured', 'used'].includes(capture.status) && !capture.config_verified;
  const checks = capture?.config_check?.checks || [];

  const ready = open && !full && line && unit.serial.trim() && (
    NEEDS_CHECK.has(unit.condition) ? verified : unit.waiver.trim().length >= 5
  ) && (unit.condition !== 'part_missing' || unit.missing_parts.length);

  const submit = async (rejectReason) => {
    setBusy(rejectReason ? 'reject' : 'receive');
    try {
      const body = {
        delivery_id: Number(deliveryId),
        line_index: unit.line_index,
        rental_start_date: unit.rental_start_date,
        serial_number: unit.serial.trim(),
        received_condition: unit.condition,
        missing_parts: unit.condition === 'part_missing' ? unit.missing_parts : [],
        physical_damage_remark: unit.damage || null,
        ...(rejectReason
          ? { reject_at_receipt: true, rejection_reason: rejectReason }
          : { capture_token: NEEDS_CHECK.has(unit.condition) ? capture?.token : null, config_capture_waiver_reason: NEEDS_CHECK.has(unit.condition) ? null : unit.waiver }),
      };
      const { data } = await api.post(`/vendor-management/purchase-orders/${d.po_id}/product-received/receive-unit`, body);
      const c = data.data.created;
      toast.success(data.message);
      if (!rejectReason) {
        setLabels((ls) => [...ls, { code: c.inventory_asset_code, title: lineConfig(line), subtitle: c.serial_number, serialNumber: c.serial_number, poNumber: d.purchase_order_number }]);
      }
      setUnit((u) => ({ ...blankUnit(u.line_index), condition: u.condition, rental_start_date: u.rental_start_date }));
      setCapture(null);
      setReject(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not receive this laptop'));
    } finally {
      setBusy('');
    }
  };

  const approveWaiver = async (u) => {
    setBusy(`w${u.serial_id}`);
    try { await api.post(`/vendor-management/serials/${u.serial_id}/approve-waiver`); toast.success(`${u.ttspl_id}: waiver approved`); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  const saveInvoice = async () => {
    setBusy('inv');
    try { await api.patch(`/vendor-management/deliveries/${deliveryId}/invoice`, { vendor_invoice_no: invoice.trim() }); toast.success('Invoice number saved'); setInvoice(''); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  const closeDelivery = async () => {
    setBusy('close');
    try {
      const { data } = await api.post(`/vendor-management/deliveries/${deliveryId}/complete`, { note: closeNote });
      toast.success(data.data.status === 'cancelled' ? 'Delivery turned away' : 'Delivery closed');
      setCloseOpen(false);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  if (loadError) return <DeskShell title="Delivery" breadcrumb="Procure / Vendor arrivals"><EmptyState title="Could not load this delivery" body={loadError} action={<Button onClick={() => navigate('/carret/procure/arrivals')}>Back</Button>} /></DeskShell>;
  if (!d) return <DeskShell title="Delivery" breadcrumb="Procure / Vendor arrivals"><EmptyState title="Loading…" /></DeskShell>;

  const units = d.units || [];
  const unitCols = [
    { key: 't', header: 'Asset', render: (u) => <DocNumber value={u.ttspl_id} />, sub: (u) => u.serial_number },
    { key: 'c', header: 'Laptop', render: (u) => [u.brand, u.model].filter(Boolean).join(' ') || lineConfig(lines[u.line_index] || {}) || '—', sub: (u) => [u.processor, u.generation, u.ram, u.storage].filter(Boolean).join(' · ') || null },
    { key: 'cond', header: 'Condition', render: (u) => LAPTOP_CONDITIONS.find((c) => c.value === u.received_condition)?.label || u.received_condition || '—' },
    {
      key: 'chk',
      header: 'Check',
      render: (u) => {
        if (u.rejected_at_receipt) return <span style={{ color: 'var(--alert-crit)' }}>✕ Rejected — {u.receipt_rejection_reason}</span>;
        if (u.capture_token_id) return <span style={{ color: u.config_verified ? 'var(--alert-good)' : 'var(--alert-warn)' }}>{u.config_verified ? '✓ Configuration matched' : '⚠ Check not matched'}</span>;
        if (u.config_capture_waived && u.waiver_approved_at) return <span>Waiver approved by {u.waiver_approved_by_name || 'a manager'}</span>;
        if (u.config_capture_waived) {
          return (
            <span style={{ color: 'var(--alert-warn)' }}>
              ⚠ Not checked: {u.config_capture_waiver_reason}
              {manager && canEdit && <> <Button variant="quiet" disabled={busy === `w${u.serial_id}`} onClick={() => approveWaiver(u)}>Approve</Button></>}
            </span>
          );
        }
        return '—';
      },
    },
    { key: 'l', header: '', render: (u) => !u.rejected_at_receipt && <Button variant="quiet" onClick={() => { setLabels([{ code: u.ttspl_id, title: [u.brand, u.model].filter(Boolean).join(' '), subtitle: u.serial_number, serialNumber: u.serial_number, poNumber: d.purchase_order_number }]); setLabelOpen(true); }}>Label</Button> },
  ];

  const flow = [
    { key: 'g', label: 'At the gate', sub: <DateTime value={d.arrived_at} />, state: 'done' },
    { key: 'r', label: 'Receiving', sub: `${handled} / ${d.laptop_count}`, state: open ? 'current' : 'done' },
    { key: 'c', label: d.status === 'cancelled' ? 'Turned away' : 'Received', state: open ? 'todo' : (d.status === 'cancelled' ? 'blocked' : 'done') },
  ];

  return (
    <DeskShell title={d.delivery_number} breadcrumb="Procure / Vendor arrivals" subtitle={d.vendor_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={d.delivery_number}
          type={`Vendor delivery · ${d.purchase_order_number}`}
          status={d.status === 'arrived' ? 'pending' : d.status === 'receiving' ? 'processing' : d.status}
          actions={(
            <>
              {labels.length > 0 && <Button onClick={() => setLabelOpen(true)}>Print {labels.length} label{labels.length > 1 ? 's' : ''}</Button>}
              <Button variant="quiet" onClick={() => navigate(`/carret/procure/purchase-orders/${d.po_id}`)}>Open PO</Button>
              {open && canEdit && <Button variant={full ? 'primary' : 'quiet'} onClick={() => setCloseOpen(true)}>Close delivery</Button>}
            </>
          )}
          meta={[
            { label: 'Vendor', value: d.vendor_name },
            { label: 'Challan', value: d.vendor_challan_no },
            { label: 'Invoice', value: d.vendor_invoice_no || <span style={{ color: 'var(--alert-warn)' }}>not given</span> },
            { label: 'Logged by', value: d.logged_by_name },
            { label: 'Received', value: `${d.received_count} in · ${d.rejected_count} rejected · of ${d.laptop_count}` },
          ]}
        />
        <FlowSteps steps={flow} />

        {d.waiver_pending_count > 0 && (
          <Notice tone="warn" title={`${d.waiver_pending_count} laptop(s) received without the configuration check`}>
            {manager ? 'Approve each below once you agree it could not be checked.' : 'A manager needs to approve each one.'} Diagnosis captures their configuration later.
          </Notice>
        )}
        {!d.vendor_invoice_no && canEdit && (
          <Notice tone="info" title="No vendor invoice number yet" action={(
            <div className="flex" style={{ gap: '8px' }}>
              <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Invoice no." style={{ width: '12rem' }} />
              <Button disabled={!invoice.trim() || busy === 'inv'} onClick={saveInvoice}>Save</Button>
            </div>
          )}
          >
            Needed before the vendor is paid for these laptops.
          </Notice>
        )}
        {!open && <Notice tone={d.status === 'cancelled' ? 'serious' : 'good'} title={d.status === 'cancelled' ? 'Turned away' : 'Delivery closed'}>{d.completion_note || `Closed ${d.completed_by_name ? `by ${d.completed_by_name}` : ''}.`}</Notice>}

        {open && canEdit && !full && (
          <Section title={`Receive laptop ${handled + 1} of ${d.laptop_count}`}>
            <div className="c-stack">
              <FormGrid cols={3}>
                <Field label="PO line" span={2}>
                  <Select
                    value={String(unit.line_index)}
                    onChange={(e) => changeLineOrCondition('line_index', Number(e.target.value))}
                    options={lines.map((l, i) => ({ value: String(i), label: `${lineConfig(l)} — ${l.receivedQty || 0} of ${l.quantity} in`, disabled: Number(l.receivedQty) >= Number(l.quantity) }))}
                  />
                </Field>
                {rental && <Field label="Rent starts"><Input type="date" value={unit.rental_start_date} onChange={(e) => setU('rental_start_date', e.target.value)} /></Field>}
              </FormGrid>
              <Field label="Condition on arrival">
                <Segmented options={allowed.map((c) => ({ value: c.value, label: c.label }))} value={unit.condition} onChange={(v) => changeLineOrCondition('condition', v)} label="Condition" />
              </Field>
              {unit.condition === 'part_missing' && (
                <Field label="What is missing" required>
                  <div className="flex flex-wrap" style={{ gap: '12px' }}>
                    {PART_CATEGORIES.map((p) => (
                      <Checkbox key={p.value} label={p.label} checked={unit.missing_parts.includes(p.value)} onChange={(e) => setU('missing_parts', e.target.checked ? [...unit.missing_parts, p.value] : unit.missing_parts.filter((x) => x !== p.value))} />
                    ))}
                  </div>
                </Field>
              )}

              {NEEDS_CHECK.has(unit.condition) ? (
                <div className="c-card" style={{ padding: '12px' }}>
                  <strong>Configuration check</strong>
                  {!capture && (
                    <p style={{ margin: '8px 0' }}>
                      Switch the laptop on and connect it to the network, then start the check.{' '}
                      <Button variant="primary" disabled={busy === 'check'} onClick={startCheck}>{busy === 'check' ? 'Starting…' : 'Start check'}</Button>
                    </p>
                  )}
                  {capture && capture.status === 'pending' && (
                    <div style={{ margin: '8px 0' }}>
                      <p>On the laptop, open <strong>{String(capture.capture_url || '').replace(/^https?:\/\//, '').split('/')[0]}/access</strong> and enter:</p>
                      <p className="font-mono" style={{ fontSize: '2rem', letterSpacing: '0.2em', margin: '8px 0' }}>{capture.access_number || '—'}</p>
                      <p className="text-ink-3">Waiting for the laptop… this updates by itself.</p>
                    </div>
                  )}
                  {capture?.status === 'expired' && <Notice tone="warn" title="The check link expired" action={<Button onClick={startCheck}>Start again</Button>} />}
                  {(verified || mismatched) && (
                    <div className="c-stack" style={{ marginTop: '8px' }}>
                      {verified
                        ? <Notice tone="good" title={`Matches the PO — serial ${capture.serial_number}`} />
                        : <Notice tone="crit" title={`Does not match the PO — serial ${capture.serial_number}`} action={<Button onClick={() => setReject({ reason: `Configuration does not match PO: ${checks.filter((c) => !c.matched).map((c) => `${c.label} ${c.actual || '?'} (ordered ${c.expected || '?'})`).join(', ')}` })}>Reject at the door</Button>}>Reject it, or call procurement if the PO line is wrong.</Notice>}
                      {checks.length > 0 && (
                        <DataTable
                          rows={checks}
                          rowKey={(c) => c.field}
                          columns={[
                            { key: 'f', header: 'Part', render: (c) => c.label },
                            { key: 'e', header: 'Ordered', render: (c) => c.expected || '—' },
                            { key: 'a', header: 'On the laptop', render: (c) => c.actual || '—' },
                            { key: 'm', header: '', render: (c) => (c.matched ? '✓' : <span style={{ color: 'var(--alert-crit)' }}>✕</span>) },
                          ]}
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <FormGrid cols={2}>
                  <Field label="Serial number" required hint="From the sticker under the laptop"><Input value={unit.serial} onChange={(e) => setU('serial', e.target.value.toUpperCase())} className="font-mono" /></Field>
                  <Field label="Why it can't be checked" required hint="A manager approves this later"><Input value={unit.waiver} onChange={(e) => setU('waiver', e.target.value)} placeholder="No power, no display…" /></Field>
                </FormGrid>
              )}

              <Field label="Physical damage"><Input value={unit.damage} onChange={(e) => setU('damage', e.target.value)} placeholder="Leave empty if none" /></Field>

              <div className="flex flex-wrap items-center justify-end" style={{ gap: '8px' }}>
                <Button variant="quiet" disabled={!unit.serial.trim() || Boolean(busy)} onClick={() => setReject({ reason: '' })}>Reject at the door</Button>
                <Button variant="primary" disabled={!ready || Boolean(busy)} onClick={() => submit(null)}>{busy === 'receive' ? 'Receiving…' : 'Receive and assign TTSPL'}</Button>
              </div>
            </div>
          </Section>
        )}
        {open && full && <Notice tone="good" title="All laptops the guard logged are received">Close the delivery to finish.</Notice>}

        <Section title={`On this delivery · ${units.length}`}>
          <DataTable columns={unitCols} rows={units} rowKey={(u) => u.serial_id} empty={<EmptyState title="Nothing received yet" />} />
        </Section>
        <Section title="Delivery details">
          <KeyValue items={[
            { label: 'Brought by', value: d.carrier_name },
            { label: 'Vehicle', value: d.vehicle_no },
            { label: 'Gate notes', value: d.notes },
          ]}
          />
        </Section>
      </div>

      <Drawer open={Boolean(reject)} onClose={() => setReject(null)} title="Reject at the door" footer={<Button variant="primary" disabled={busy === 'reject' || (reject?.reason || '').trim().length < 5 || !unit.serial.trim()} onClick={() => submit(reject.reason.trim())}>{busy === 'reject' ? 'Saving…' : 'Reject this laptop'}</Button>}>
        <div className="c-stack">
          <p>It gets a TTSPL so it can be traced, goes back to the vendor, and is not billed. The PO line still expects a replacement.</p>
          <Field label="Serial number" required><Input value={unit.serial} onChange={(e) => setU('serial', e.target.value.toUpperCase())} className="font-mono" /></Field>
          <Field label="Why" required><Textarea rows={3} value={reject?.reason || ''} onChange={(e) => setReject({ reason: e.target.value })} placeholder="Wrong model, dead on arrival, broken screen…" /></Field>
        </div>
      </Drawer>

      <Drawer open={closeOpen} onClose={() => setCloseOpen(false)} title="Close this delivery" footer={<Button variant="primary" disabled={busy === 'close'} onClick={closeDelivery}>{handled === 0 ? 'Turn away' : 'Close delivery'}</Button>}>
        <div className="c-stack">
          {handled === Number(d.laptop_count)
            ? <p>All {d.laptop_count} laptops are handled.</p>
            : <Notice tone="warn" title={`The guard logged ${d.laptop_count}; ${handled} were received`}>Say what happened to the difference — it is recorded on the delivery.</Notice>}
          <Field label="Note" required={handled !== Number(d.laptop_count)}><Textarea rows={3} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} /></Field>
        </div>
      </Drawer>

      <PartLabelPrintModal open={labelOpen} units={labels} defaultCopies={1} title="Print TTSPL labels" onClose={() => { setLabelOpen(false); setLabels([]); }} />
    </DeskShell>
  );
}


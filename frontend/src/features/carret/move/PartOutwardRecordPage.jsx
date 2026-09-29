import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid,
  Input, KeyValue, Notice, Section, Textarea,
} from '../../../components/carret';
import SignaturePadComponent from '../../sales-pipeline/components/SignaturePad';
import VrdcDispatchFields, { validateVrdcDispatch } from '../../floor-pipeline/components/VrdcDispatchFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import { usePermission } from '../../../hooks/usePermission';
import {
  PHYSICAL_CONDITIONS, PHYSICAL_RECEIVER_TYPES, cancelDraftPhysicalOutward, dispatchPhysicalOutward,
  downloadPhysicalOutwardPdf, fetchPhysicalOutward,
} from '../../inventory-management/physicalDeadPartApi';
import { physicalPhotoList, physicalUploadUrl } from '../../inventory-management/physicalDeadPartUi';
import { errText } from './chargerShared';
import { OUTWARD_STATUS } from './partOutwardShared';

/**
 * Movement → Dead parts — in & out → outward record (Part DC). Replaces the old
 * /inventory-management/physical-parts/outward/:no page, same endpoints:
 *   draft          → the warehouse approves: how it travels + signature →
 *                    Part DC generated (status dispatch_ready), PDF with gate QR.
 *   draft          → Cancel (reason) — the parts go back to the warehouse.
 *   dispatch_ready → the guard scans the Part DC at the gate (Movement → Gate);
 *                    only then are the parts "gone out".
 * Approve / cancel: a warehouse role or physical_dead_parts edit (the API's
 * requireWarehouse) plus physical_dead_parts create. No e-way bill: these
 * parts carry no declared value (the request has no value field).
 */
const SECTION = 'physical_dead_parts';
const WAREHOUSE_ROLES = ['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead', 'procurement'];
const SHIP_LABEL = { by_hand: 'In-house', by_courier: 'Courier', by_porter: 'Porter', by_vendor_pickup: 'Receiver pickup' };
const EVENT_LABEL = {
  requested: 'Put on the request',
  dc_generated: 'Approved — Part DC generated',
  outward_completed: 'Left through the gate',
  released: 'Back in the warehouse',
  cancelled: 'Request cancelled',
};
const receiverLabel = (v) => PHYSICAL_RECEIVER_TYPES.find((t) => t.value === v)?.label || v || '—';

function transportLine(o) {
  if (o.ship_by === 'by_courier') return [o.courier_name, o.awb_number && `AWB ${o.awb_number}`].filter(Boolean).join(' · ');
  if (o.ship_by === 'by_porter') return [o.porter_tracking_id, o.porter_order_id].filter(Boolean).join(' · ');
  if (o.ship_by === 'by_vendor_pickup') return [o.vendor_pickup_person, o.vendor_pickup_mobile, o.vehicle_number].filter(Boolean).join(' · ');
  return [o.vehicle_number].filter(Boolean).join(' · ');
}

const partCols = [
  { key: 'dp', header: 'Part', render: (p) => <DocNumber value={p.dp_number} />, sub: (p) => [p.part_name, p.serial_number].filter(Boolean).join(' · ') },
  { key: 'c', header: 'Condition', render: (p) => PHYSICAL_CONDITIONS.find((c) => c.value === p.condition)?.label || p.condition || '—' },
  { key: 'in', header: 'Came in', render: (p) => <DocNumber value={p.inward_number} />, sub: (p) => <DateTime value={p.inward_date} /> },
  {
    key: 'ph', header: 'Photos', align: 'right',
    render: (p) => (
      <span className="flex justify-end" style={{ gap: '4px' }}>
        {physicalPhotoList(p).slice(0, 4).map((src) => (
          <a key={src} href={physicalUploadUrl(src)} target="_blank" rel="noreferrer">
            <img src={physicalUploadUrl(src)} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
          </a>
        ))}
      </span>
    ),
  },
];

const moveCols = [
  { key: 't', header: 'When', render: (m) => <DateTime value={m.created_at} format="datetime" /> },
  { key: 'e', header: 'What', render: (m) => EVENT_LABEL[m.event_type] || String(m.event_type || '').replace(/_/g, ' '), sub: (m) => m.remarks || null },
  { key: 'p', header: 'Part', render: (m) => (m.dp_number ? <DocNumber value={m.dp_number} /> : '—') },
  { key: 'b', header: 'By', render: (m) => m.actor_name || '—' },
];

export default function PartOutwardRecordPage() {
  const { outwardNumber: raw } = useParams();
  const no = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const { hasPermission, user } = usePermission();
  const canAct = hasPermission(SECTION, 'create') && (WAREHOUSE_ROLES.includes(user?.role) || hasPermission(SECTION, 'edit'));
  const canGate = hasPermission('guard_gate_checking', 'view');

  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [shipBy, setShipBy] = useState('');
  const [fields, setFields] = useState({});
  const [techs, setTechs] = useState([]);
  const [signer, setSigner] = useState('');
  const [esign, setEsign] = useState(null);
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(() => {
    fetchPhysicalOutward(no)
      .then(({ data }) => {
        setD(data);
        const o = data?.outward || {};
        setShipBy(o.ship_by || '');
        setFields({
          courier_name: o.courier_name || '',
          awb_number: o.awb_number || '',
          courier_tracking_url: o.courier_tracking_url || '',
          porter_tracking_id: o.porter_tracking_id || '',
          porter_order_id: o.porter_order_id || '',
          porter_booking_url: o.porter_booking_url || '',
          delivery_person_id: o.delivery_person_id || '',
          vehicle_number: o.vehicle_number || '',
          vendor_pickup_person: o.vendor_pickup_person || '',
          vendor_pickup_mobile: o.vendor_pickup_mobile || '',
        });
        setSigner((s) => s || o.warehouse_dispatch_signer_name || user?.name || user?.email || '');
        setEsign(null);
      })
      .catch((e) => setError(errText(e, 'Could not load the outward.')));
  }, [no, user?.name, user?.email]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canAct) return;
    fetchDeliveryTechnicians({ limit: 200 }).then((r) => setTechs(Array.isArray(r) ? r : (r?.data || r?.technicians || []))).catch(() => {});
  }, [canAct]);

  const back = <Button onClick={() => navigate('/carret/move/part-inward?tab=outwards')}>Back to dead parts</Button>;
  if (error) return <DeskShell title={no} breadcrumb="Movement / Dead parts"><EmptyState title="Could not load this outward" body={error} action={back} /></DeskShell>;
  if (!d?.outward) return <DeskShell title={no} breadcrumb="Movement / Dead parts"><EmptyState title="Loading…" /></DeskShell>;

  const o = d.outward;
  const st = o.status;
  const parts = st === 'cancelled' ? (d.released_parts || []) : (d.parts || []);
  const outwardPhotos = physicalPhotoList(o, 'photos', 'photo_paths', 'photo_path');

  const pdf = async () => {
    setBusy('pdf');
    try { await downloadPhysicalOutwardPdf(no); } catch (e) { toast.error(errText(e, 'PDF download failed')); } finally { setBusy(''); }
  };
  const checkApprove = () => {
    const err = validateVrdcDispatch(shipBy, fields);
    if (err) { toast.error(err); return; }
    if (!signer.trim()) { toast.error('Enter the warehouse signer’s name'); return; }
    if (!esign && !o.warehouse_dispatch_esign_url) { toast.error('The warehouse signs before approving'); return; }
    setConfirmApprove(true);
  };
  const approve = async () => {
    if (busy) return;
    setBusy('approve');
    try {
      await dispatchPhysicalOutward(no, {
        ship_by: shipBy,
        ...fields,
        delivery_person_id: fields.delivery_person_id || undefined,
        warehouse_esign: esign || undefined,
        warehouse_signer_name: signer.trim(),
      });
      toast.success('Approved — Part DC generated. Print it; the guard scans it at the gate.');
      load();
    } catch (e) { toast.error(errText(e, 'Approval failed')); } finally { setBusy(''); }
  };
  const cancel = async () => {
    if (busy) return;
    setBusy('cancel');
    try {
      await cancelDraftPhysicalOutward(no, cancelReason.trim() || undefined);
      toast.success('Request cancelled — the parts are back in the warehouse');
      setCancelOpen(false);
      load();
    } catch (e) { toast.error(errText(e, 'Cancel failed')); } finally { setBusy(''); }
  };

  const flow = [
    { key: 'r', label: 'Requested', state: 'done' },
    { key: 'a', label: 'Warehouse approved — Part DC', state: st === 'draft' ? 'current' : 'done' },
    { key: 'g', label: 'Guard scanned — gone out', state: st === 'dispatched' ? 'done' : st === 'dispatch_ready' ? 'current' : 'todo' },
  ].map((s) => (st === 'cancelled' && s.key !== 'r' ? { ...s, state: 'blocked' } : s));

  let next;
  if (st === 'draft') {
    next = (
      <Notice tone="info" title="Waiting for warehouse approval">
        {canAct ? 'Choose how it travels and sign below to approve — that generates the Part DC and its gate QR.' : 'Someone in the warehouse approves it; the Part DC and gate QR are generated then.'}
      </Notice>
    );
  } else if (st === 'dispatch_ready') {
    next = (
      <Notice tone="info" title="Part DC ready — waiting at the gate">
        Print the Part DC. The guard scans its QR on outward; the parts count as gone only after that.
        {canGate && <> <Link to={`/carret/move/gate?dir=outward&dc=${encodeURIComponent(no)}`}>Open the gate scanner</Link></>}
      </Notice>
    );
  } else if (st === 'dispatched') {
    next = <Notice tone="good" title="Gone out">Left through the gate <DateTime value={o.gate_confirmed_at || o.dispatched_at} format="datetime" />.</Notice>;
  } else {
    next = <Notice tone="serious" title="Cancelled">{o.cancel_reason ? `${o.cancel_reason}. ` : ''}The parts went back to the warehouse and can go on a new request.</Notice>;
  }

  return (
    <DeskShell title={no} breadcrumb="Movement / Dead parts" subtitle={o.receiver_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={no}
          type="Part DC (dead parts outward)"
          status={OUTWARD_STATUS[st]?.chip || st}
          actions={(
            <>
              {st !== 'draft' && st !== 'cancelled' && <Button disabled={busy === 'pdf'} onClick={pdf}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</Button>}
              {canAct && st === 'draft' && <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel request</Button>}
              <Button variant="quiet" onClick={() => navigate('/carret/move/part-inward?tab=outwards')}>All outwards</Button>
            </>
          )}
          meta={[
            { label: 'Status', value: OUTWARD_STATUS[st]?.label || st },
            { label: 'Going to', value: `${o.receiver_name} (${receiverLabel(o.receiver_type)})` },
            { label: 'Parts', value: parts.length },
            { label: 'Outward date', value: <DateTime value={o.outward_date} /> },
          ]}
        />
        <FlowSteps steps={flow} />
        {next}

        <Section title={st === 'cancelled' ? `Parts that were on it · ${parts.length}` : `Parts · ${parts.length}`}>
          <DataTable columns={partCols} rows={parts} rowKey={(p) => p.part_id} empty={<EmptyState title="No parts" />} />
        </Section>

        {st === 'draft' && canAct && (
          <Section title="Approve and generate the Part DC">
            <div className="c-stack">
              <VrdcDispatchFields shipBy={shipBy} onShipByChange={setShipBy} fields={fields} onFieldsChange={setFields} deliveryTechnicians={techs} />
              <FormGrid cols={2}>
                <Field label="Warehouse signer" required><Input value={signer} onChange={(e) => setSigner(e.target.value)} /></Field>
                <Field label="Warehouse signature" required>
                  {esign || o.warehouse_dispatch_esign_url ? (
                    <div className="flex items-center" style={{ gap: '8px' }}>
                      <img src={esign || physicalUploadUrl(o.warehouse_dispatch_esign_url)} alt="Warehouse signature" style={{ maxHeight: '4rem', background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '4px' }} />
                      <Button variant="quiet" onClick={() => setSigning(true)}>Sign again</Button>
                    </div>
                  ) : <Button onClick={() => setSigning(true)}>Sign</Button>}
                </Field>
              </FormGrid>
              {signing && <SignaturePadComponent onSave={(x) => { setEsign(x); setSigning(false); }} onCancel={() => setSigning(false)} />}
              <div className="flex justify-end">
                <Button variant="primary" disabled={Boolean(busy)} onClick={checkApprove}>{busy === 'approve' ? 'Approving…' : 'Approve — generate Part DC'}</Button>
              </div>
            </div>
          </Section>
        )}

        <Section title="Details">
          <KeyValue
            cols={2}
            items={[
              { label: 'Receiver mobile', value: o.receiver_contact || '—' },
              { label: 'Purpose', value: o.purpose || '—' },
              { label: 'Reference', value: o.reference_number || '—' },
              { label: 'Warehouse', value: o.warehouse || '—' },
              { label: 'Raised by', value: o.created_by_name ? <>{o.created_by_name} · <DateTime value={o.created_at} /></> : '—' },
              { label: 'Remarks', value: o.remarks || '—' },
              ...(st !== 'draft' && st !== 'cancelled' ? [
                { label: 'Approved by', value: o.approved_by_name ? <>{o.approved_by_name}{o.approved_at ? <> · <DateTime value={o.approved_at} format="datetime" /></> : null}</> : '—' },
                { label: 'Transport', value: [SHIP_LABEL[o.ship_by] || o.ship_by, transportLine(o)].filter(Boolean).join(' — ') || '—' },
                { label: 'Signed for the warehouse', value: o.warehouse_dispatch_signer_name || '—' },
                { label: 'Gate', value: o.gate_confirmed_at ? <DateTime value={o.gate_confirmed_at} format="datetime" /> : 'Not scanned yet' },
              ] : []),
              ...(st === 'cancelled' ? [{ label: 'Cancelled', value: o.cancelled_at ? <DateTime value={o.cancelled_at} format="datetime" /> : '—' }] : []),
            ]}
          />
          {outwardPhotos.length > 0 && (
            <span className="flex flex-wrap" style={{ gap: '6px', marginTop: '8px' }}>
              {outwardPhotos.map((src) => (
                <a key={src} href={physicalUploadUrl(src)} target="_blank" rel="noreferrer">
                  <img src={physicalUploadUrl(src)} alt="Outward" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4 }} />
                </a>
              ))}
            </span>
          )}
        </Section>

        {(d.movements || []).length > 0 && (
          <Section title="History">
            <DataTable columns={moveCols} rows={d.movements} rowKey={(m) => m.id} />
          </Section>
        )}
      </div>

      <ConfirmDialog
        open={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        onConfirm={() => { setConfirmApprove(false); approve(); }}
        title="Approve this outward?"
        body={`${parts.length} part(s) to ${o.receiver_name}. The Part DC and gate QR are generated now; the parts leave when the guard scans it.`}
        confirmLabel="Approve"
      />
      <Drawer
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${no}`}
        footer={<Button variant="primary" disabled={busy === 'cancel'} onClick={cancel}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel request'}</Button>}
      >
        <div className="c-stack">
          <p>The record stays (cancelled). Its parts go back to the warehouse and can go on a new request.</p>
          <Field label="Reason"><Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
        </div>
      </Drawer>
    </DeskShell>
  );
}

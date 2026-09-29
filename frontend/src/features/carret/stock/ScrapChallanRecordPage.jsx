import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid, Input, KeyValue, Money, Notice, Section,
  SignaturePad, Textarea,
} from '../../../components/carret';
import VrdcDispatchFields, { validateVrdcDispatch } from './VrdcDispatchFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import { getBackendOrigin } from '../../../utils/api';
import { usePermission } from '../../../hooks/usePermission';
import {
  SCRAP_WAREHOUSE_ROLES, cancelScrapChallan, dispatchScrapChallan, downloadScrapChallanPdf, errMsg, fetchScrapChallan,
} from './stockApi';

/**
 * Stock → Scrap → scrap challan record. Replaces the old
 * /inventory-management/scrap-challans/:no page, same endpoints:
 *   draft      → how it travels, e-way bill (needed above ₹50,000), the
 *                warehouse signs → Dispatch (laptops recorded as handed to the
 *                buyer, parts scrapped).
 *   draft      → Cancel (reason) — the record stays, its laptops / parts go
 *                back to waiting for a challan.
 *   any        → PDF.
 * There is no gate scan for scrap challans (none in the old flow either).
 */
const SHIP_LABEL = { by_hand: 'In-house', by_courier: 'Courier', by_porter: 'Porter', by_vendor_pickup: 'Buyer pickup' };
const EWAY_THRESHOLD = 50000;

const uploadUrl = (p) => {
  if (!p) return null;
  if (/^(https?:|data:)/i.test(p)) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${String(p).replace(/^\/?uploads\//, '')}`;
};

function transportLine(c) {
  if (c.ship_by === 'by_courier') return [c.courier_name, c.awb_number && `AWB ${c.awb_number}`].filter(Boolean).join(' · ');
  if (c.ship_by === 'by_porter') return [c.porter_tracking_id, c.porter_order_id].filter(Boolean).join(' · ');
  if (c.ship_by === 'by_vendor_pickup') return [c.vendor_pickup_person, c.vendor_pickup_mobile].filter(Boolean).join(' · ');
  return c.vehicle_number || '';
}

const itemCols = [
  {
    key: 'i',
    header: 'Item',
    render: (i) => (i.item_kind === 'laptop'
      ? <Link to={`/carret/stock/assets/${encodeURIComponent(i.ttspl_id || '')}`}><DocNumber value={i.ttspl_id || i.serial_number} /></Link>
      : <DocNumber value={i.prt_id} />),
    sub: (i) => (i.item_kind === 'laptop' ? 'Laptop' : i.category || 'Part'),
  },
  { key: 'n', header: 'What', render: (i) => i.part_name || '—', sub: (i) => i.serial_number || null },
  { key: 'c', header: 'Our cost', numeric: true, render: (i) => <Money value={i.unit_cost} showZero={false} /> },
  { key: 'v', header: 'Buyer pays', numeric: true, render: (i) => (i.sale_value != null ? <Money value={i.sale_value} /> : '—') },
  { key: 'r', header: 'Remarks', render: (i) => i.item_remarks || '—' },
];

export default function ScrapChallanRecordPage() {
  const { challanNumber: raw } = useParams();
  const challanNumber = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const { hasPermission, user } = usePermission();
  const canAct = SCRAP_WAREHOUSE_ROLES.includes(user?.role) || hasPermission('scrap_challans', 'edit');

  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [shipBy, setShipBy] = useState('');
  const [fields, setFields] = useState({});
  const [techs, setTechs] = useState([]);
  const [eway, setEway] = useState({ number: '', date: '' });
  const [signer, setSigner] = useState('');
  const [esign, setEsign] = useState(null);
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmDispatch, setConfirmDispatch] = useState(false);

  const load = useCallback(() => {
    fetchScrapChallan(challanNumber)
      .then(({ data }) => {
        const row = data.data;
        setC(row);
        setShipBy(row?.ship_by || '');
        setFields({
          courier_name: row?.courier_name || '',
          awb_number: row?.awb_number || '',
          courier_tracking_url: row?.courier_tracking_url || '',
          porter_tracking_id: row?.porter_tracking_id || '',
          porter_order_id: row?.porter_order_id || '',
          porter_booking_url: row?.porter_booking_url || '',
          delivery_person_id: row?.delivery_person_id || '',
        });
        setEway({ number: row?.eway_bill_number || '', date: row?.eway_bill_date ? String(row.eway_bill_date).slice(0, 10) : '' });
        setSigner((s) => s || row?.warehouse_dispatch_signer_name || user?.name || user?.email || '');
        setEsign(null);
      })
      .catch((e) => setError(errMsg(e, 'Could not load the scrap challan.')));
  }, [challanNumber, user?.name, user?.email]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canAct) return;
    fetchDeliveryTechnicians({ limit: 200 }).then((d) => setTechs(d?.data || d?.technicians || [])).catch(() => {});
  }, [canAct]);

  const back = <Button onClick={() => navigate('/carret/stock/scrap?tab=challans')}>Back to Scrap</Button>;
  if (error) return <DeskShell title={challanNumber} breadcrumb="Stock / Scrap"><EmptyState title="Could not load this scrap challan" body={error} action={back} /></DeskShell>;
  if (!c) return <DeskShell title={challanNumber} breadcrumb="Stock / Scrap"><EmptyState title="Loading…" /></DeskShell>;

  const st = c.status;
  const items = c.items || [];
  const total = items.reduce((n, i) => n + (Number(i.sale_value ?? i.unit_cost) || 0), 0);
  const needsEway = total > EWAY_THRESHOLD;
  const laptops = items.filter((i) => i.item_kind === 'laptop').length;

  const pdf = async () => {
    setBusy('pdf');
    try { await downloadScrapChallanPdf(challanNumber); } catch (e) { toast.error(errMsg(e, 'PDF download failed')); } finally { setBusy(''); }
  };

  const checkDispatch = () => {
    const err = validateVrdcDispatch(shipBy, fields);
    if (err) { toast.error(err); return; }
    if (needsEway && !eway.number.trim()) { toast.error(`Worth over ₹${EWAY_THRESHOLD.toLocaleString('en-IN')} — enter the e-way bill number`); return; }
    if (!signer.trim()) { toast.error('Enter the warehouse signer’s name'); return; }
    if (!esign && !c.warehouse_dispatch_esign_url) { toast.error('The warehouse signs before dispatch'); return; }
    setConfirmDispatch(true);
  };
  const dispatch = async () => {
    setBusy('dispatch');
    try {
      await dispatchScrapChallan(challanNumber, {
        ship_by: shipBy,
        ...fields,
        delivery_person_id: fields.delivery_person_id || undefined,
        warehouse_esign: esign || undefined,
        warehouse_signer_name: signer.trim(),
        eway_bill_number: eway.number.trim() || undefined,
        eway_bill_date: eway.date || undefined,
      });
      toast.success('Scrap challan dispatched');
      load();
    } catch (e) { toast.error(errMsg(e, 'Dispatch failed')); } finally { setBusy(''); }
  };
  const cancel = async () => {
    setBusy('cancel');
    try {
      await cancelScrapChallan(challanNumber, cancelReason.trim());
      toast.success('Scrap challan cancelled — its items wait for a new challan');
      setCancelOpen(false);
      load();
    } catch (e) { toast.error(errMsg(e, 'Cancel failed')); } finally { setBusy(''); }
  };

  const flow = [
    { key: 'd', label: 'Draft', state: st === 'draft' ? 'current' : 'done' },
    { key: 'o', label: 'Handed to the buyer', state: st === 'dispatched' ? 'done' : 'todo' },
  ].map((s) => (st === 'cancelled' ? { ...s, state: 'blocked' } : s));

  let next;
  if (st === 'draft') next = <Notice tone="info" title="Draft">Choose how it travels{needsEway ? ', enter the e-way bill' : ''}, sign for the warehouse, then dispatch. Nothing is scrapped for good until it is dispatched.</Notice>;
  else if (st === 'dispatched') next = <Notice tone="good" title="Dispatched">Left <DateTime value={c.dispatched_at} format="datetime" />. Laptops are recorded as handed to {c.recipient_name}; parts are scrapped.</Notice>;
  else next = <Notice tone="serious" title="Cancelled">{c.cancel_reason ? `${c.cancel_reason}. ` : ''}Its laptops and parts went back to waiting for a scrap challan.</Notice>;

  return (
    <DeskShell title={challanNumber} breadcrumb="Stock / Scrap" subtitle={c.recipient_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={challanNumber}
          type="Scrap challan"
          status={st}
          actions={(
            <>
              <Button disabled={busy === 'pdf'} onClick={pdf}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</Button>
              {canAct && st === 'draft' && <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel</Button>}
            </>
          )}
          meta={[
            { label: 'Buyer', value: c.recipient_vendor_name || c.recipient_name },
            { label: 'Items', value: `${items.length}${laptops ? ` (${laptops} laptop${laptops > 1 ? 's' : ''})` : ''}` },
            { label: 'Buyer pays', value: c.sale_total != null ? <Money value={c.sale_total} /> : '—' },
            { label: 'Created', value: <DateTime value={c.created_at} /> },
          ]}
        />
        <FlowSteps steps={flow} />
        {next}

        <Section title={`Items · ${items.length}`}>
          <DataTable columns={itemCols} rows={items} rowKey={(i) => i.id} empty={<EmptyState title="No items" />} />
        </Section>

        {st === 'draft' && canAct && (
          <Section title="Dispatch">
            <div className="c-stack">
              <VrdcDispatchFields shipBy={shipBy} onShipByChange={setShipBy} fields={fields} onFieldsChange={setFields} deliveryTechnicians={techs} party="buyer" />
              <FormGrid cols={2}>
                <Field label="E-way bill number" required={needsEway} hint={needsEway ? `Needed — worth ₹${total.toLocaleString('en-IN')}` : 'Only needed above ₹50,000'}>
                  <Input value={eway.number} onChange={(e) => setEway({ ...eway, number: e.target.value })} />
                </Field>
                <Field label="E-way bill date"><Input type="date" value={eway.date} onChange={(e) => setEway({ ...eway, date: e.target.value })} /></Field>
                <Field label="Warehouse signer" required><Input value={signer} onChange={(e) => setSigner(e.target.value)} /></Field>
                <Field label="Warehouse signature" required>
                  {esign || c.warehouse_dispatch_esign_url ? (
                    <div className="flex items-center" style={{ gap: '8px' }}>
                      <img src={uploadUrl(esign || c.warehouse_dispatch_esign_url)} alt="Warehouse signature" style={{ maxHeight: '4rem', background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '4px' }} />
                      <Button variant="quiet" onClick={() => setSigning(true)}>Sign again</Button>
                    </div>
                  ) : <Button onClick={() => setSigning(true)}>Sign</Button>}
                </Field>
              </FormGrid>
              {signing && <SignaturePad prompt="Warehouse signs for the handover" onSave={(d) => { setEsign(d); setSigning(false); }} onCancel={() => setSigning(false)} />}
              <div className="flex justify-end">
                <Button variant="primary" disabled={busy === 'dispatch'} onClick={checkDispatch}>{busy === 'dispatch' ? 'Dispatching…' : 'Dispatch scrap challan'}</Button>
              </div>
            </div>
          </Section>
        )}

        <Section title="Details">
          <KeyValue cols={2} items={[
            { label: 'Buyer address', value: <span style={{ whiteSpace: 'pre-line' }}>{c.recipient_address || '—'}</span> },
            { label: 'Billing address', value: <span style={{ whiteSpace: 'pre-line' }}>{c.billing_address || '—'}</span> },
            { label: 'Contact', value: [c.contact_person, c.contact_mobile].filter(Boolean).join(' · ') || '—' },
            { label: 'Remarks', value: c.remarks || '—' },
            ...(st === 'dispatched' ? [
              { label: 'Transport', value: [SHIP_LABEL[c.ship_by] || c.ship_by, transportLine(c)].filter(Boolean).join(' — ') || '—' },
              { label: 'E-way bill', value: c.eway_bill_number ? `${c.eway_bill_number}${c.eway_bill_date ? ` · ${String(c.eway_bill_date).slice(0, 10)}` : ''}` : '—' },
              { label: 'Signed for the warehouse', value: c.warehouse_dispatch_signer_name || '—' },
              { label: 'Warehouse signature', value: c.warehouse_dispatch_esign_url ? <img src={uploadUrl(c.warehouse_dispatch_esign_url)} alt="Warehouse signature" style={{ maxHeight: '4rem' }} /> : '—' },
            ] : []),
            ...(st === 'cancelled' ? [{ label: 'Cancelled', value: <DateTime value={c.cancelled_at} format="datetime" /> }] : []),
          ]}
          />
        </Section>
      </div>

      <ConfirmDialog
        open={confirmDispatch}
        onClose={() => setConfirmDispatch(false)}
        onConfirm={() => { setConfirmDispatch(false); dispatch(); }}
        title="Dispatch this scrap challan?"
        body={`${items.length} item(s) go to ${c.recipient_name}. This is final: parts are scrapped and laptops recorded as handed over.`}
        confirmLabel="Dispatch"
        tone="crit"
      />
      <Drawer
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${challanNumber}`}
        footer={<Button variant="primary" disabled={busy === 'cancel'} onClick={cancel}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel challan'}</Button>}
      >
        <div className="c-stack">
          <p>The record stays (cancelled). Its laptops and parts go back to waiting for a scrap challan.</p>
          <Field label="Reason"><Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
        </div>
      </Drawer>
    </DeskShell>
  );
}

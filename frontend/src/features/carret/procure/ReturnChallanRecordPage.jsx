import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, EmptyState, FlowSteps, Input, KeyValue, Money, Notice, Section,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  cancelReturnToVendorDc, completeReturnToVendorDc, dispatchReturnToVendorDc, downloadReturnToVendorDcPdf, fetchReturnToVendorDc,
} from '../../vendor-management/vendorManagementApi';
import VrtdcTransportFields, { validateVrtdcTransport } from '../../vendor-management/components/VrtdcTransportFields';
import VrtdcEwayPanel from '../../vendor-management/components/VrtdcEwayPanel';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import { errMsg } from './procureShared';

/**
 * Procure → Vendor returns → return challan (VRTDC).
 *
 * Draft: enter each laptop's declared value and how it travels → send to the
 * gate. The e-way bill is needed only above the threshold, and only before the
 * consignment leaves. The guard's scan-out makes the laptops the vendor's
 * again ("returned to vendor", D9) and drafts a debit note for each (D12).
 * Then mark it received by the vendor.
 */
const SHIP_LABEL = { by_hand: 'In-house', by_courier: 'Courier', by_porter: 'Porter', by_vendor_pickup: 'Vendor pickup' };

function transportLine(dc) {
  if (dc.ship_by === 'by_courier') return [dc.courier_name, dc.awb_number && `AWB ${dc.awb_number}`].filter(Boolean).join(' · ');
  if (dc.ship_by === 'by_porter') return [dc.porter_person_name, dc.porter_person_phone, dc.vehicle_number, dc.porter_tracking_id && `booking ${dc.porter_tracking_id}`].filter(Boolean).join(' · ');
  if (dc.ship_by === 'by_vendor_pickup') return [dc.vendor_pickup_person, dc.vendor_pickup_mobile, dc.vehicle_number].filter(Boolean).join(' · ');
  if (dc.ship_by === 'by_hand') return [dc.delivery_person_name, dc.delivery_person_phone, dc.vehicle_number].filter(Boolean).join(' · ');
  return '';
}

export default function ReturnChallanRecordPage() {
  const { dcNumber: raw } = useParams();
  const dcNumber = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = ['vendor_return_to_vendor', 'vendor_management'].some((s) => hasPermission(s, 'edit'));

  const [dc, setDc] = useState(null);
  const [error, setError] = useState(null);
  const [values, setValues] = useState({});
  const [sameValue, setSameValue] = useState('');
  const [shipBy, setShipBy] = useState('');
  const [fields, setFields] = useState({});
  const [techs, setTechs] = useState([]);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    fetchReturnToVendorDc(dcNumber)
      .then(({ data }) => setDc(data.dc))
      .catch((e) => setError(errMsg(e, 'Could not load the challan.')));
  }, [dcNumber]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchDeliveryTechnicians({ limit: 200 }).then((d) => setTechs(d?.data || d?.technicians || [])).catch(() => {});
  }, []);

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  if (error) return <DeskShell title={dcNumber} breadcrumb="Procure / Vendor returns"><EmptyState title="Could not load this challan" body={error} action={<Button onClick={() => navigate('/carret/procure/returns')}>Back</Button>} /></DeskShell>;
  if (!dc) return <DeskShell title={dcNumber} breadcrumb="Procure / Vendor returns"><EmptyState title="Loading…" /></DeskShell>;

  const st = dc.status;
  const items = dc.items || [];
  const live = items.filter((i) => i.item_status !== 'cancelled');
  const valueOf = (i) => values[i.serial_id] ?? (i.declared_value ?? '');
  const total = live.reduce((n, i) => n + (Number(valueOf(i)) || 0), 0);
  const missing = live.filter((i) => !(Number(valueOf(i)) > 0)).length;

  const sendToGate = async () => {
    const err = validateVrtdcTransport(shipBy, fields);
    if (err) { toast.error(err); return; }
    if (missing) { toast.error(`Enter the declared value for ${missing} laptop(s)`); return; }
    setBusy('dispatch');
    try {
      const { data } = await dispatchReturnToVendorDc(dcNumber, {
        ship_by: shipBy,
        ...fields,
        delivery_person_id: fields.delivery_person_id || undefined,
        declared_values: Object.fromEntries(live.map((i) => [i.serial_id, Number(valueOf(i))])),
      });
      const ew = data?.eway_request || {};
      if (ew.required && ew.sent) toast.success('Sent to the gate. Worth ₹50,000 or more — Accounts has been mailed for the e-way bill.');
      else if (ew.required) toast.error(`Sent to the gate, but the e-way mail to Accounts failed: ${ew.error || 'unknown error'}. Use “Send for E-way bill” below.`, { duration: 9000 });
      else toast.success('Sent to the gate — the guard scans it out');
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  let next;
  if (st === 'draft') next = <Notice tone="info" title="Draft">Enter each laptop’s value and how it travels, then send it to the gate.</Notice>;
  else if (st === 'dispatch_ready') {
    next = (
      <Notice tone="warn" title="At the gate">
        The guard scans it out. At ₹50,000 or more it can’t leave until Accounts adds the e-way bill.
        {dc.ship_by === 'by_hand' && ' Once scanned out it appears in the delivery person’s technician bucket.'}
        {dc.eway_auto_mail_error && !dc.accounts_notified_at && <><br /><strong>The automatic mail to Accounts failed:</strong> {dc.eway_auto_mail_error} — use “Send for E-way bill” below.</>}
      </Notice>
    );
  }
  else if (st === 'dispatched') {
    next = (
      <Notice tone="info" title="On its way to the vendor" action={canEdit && <Button variant="primary" disabled={busy === 'complete'} onClick={() => setConfirm({ title: 'The vendor has these laptops?', body: 'Marks the return complete.', label: 'Vendor received', tone: 'good', go: () => run('complete', () => completeReturnToVendorDc(dcNumber), 'Marked received by the vendor') })}>Vendor received</Button>}>
        Left <DateTime value={dc.dispatched_at} />. The laptops are recorded as returned to the vendor, and each has a draft debit note for accounts.
      </Notice>
    );
  } else if (st === 'completed') next = <Notice tone="good" title="The vendor has them">Received <DateTime value={dc.vendor_received_at} />.</Notice>;
  else next = <Notice tone="serious" title="Cancelled">Its laptops are back on the “To send back” list.</Notice>;

  const flow = [
    { key: 'd', label: 'Draft', state: st === 'draft' ? 'current' : 'done' },
    { key: 'g', label: 'At the gate', state: st === 'dispatch_ready' ? 'current' : (['dispatched', 'completed'].includes(st) ? 'done' : 'todo') },
    { key: 'o', label: 'Out', state: st === 'dispatched' ? 'current' : (st === 'completed' ? 'done' : 'todo') },
    { key: 'v', label: 'Vendor has it', state: st === 'completed' ? 'done' : 'todo' },
  ].map((s) => (st === 'cancelled' ? { ...s, state: 'blocked' } : s));

  const cols = [
    { key: 't', header: 'Asset', render: (i) => <DocNumber value={i.ttspl_id} />, sub: (i) => i.serial_number },
    { key: 'c', header: 'Laptop', render: (i) => i.configuration || [i.brand, i.model].filter(Boolean).join(' ') || '—', sub: (i) => i.po_number },
    { key: 'r', header: 'Why', render: (i) => i.return_reason || dc.return_reason || '—' },
    {
      key: 'v',
      header: 'Declared value',
      numeric: true,
      render: (i) => (st === 'draft' && canEdit
        ? <Input type="number" min={0} value={valueOf(i)} onChange={(e) => setValues((v) => ({ ...v, [i.serial_id]: e.target.value }))} style={{ width: '8rem', textAlign: 'right' }} aria-label={`Value of ${i.ttspl_id}`} />
        : <Money value={i.declared_value} />),
    },
    { key: 's', header: '', render: (i) => (i.item_status === 'cancelled' ? 'cancelled' : null) },
  ];

  return (
    <DeskShell title={dcNumber} breadcrumb="Procure / Vendor returns" subtitle={dc.vendor_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={dcNumber}
          type={`Return challan${dc.return_ticket_number ? ` · for ${dc.return_ticket_number}` : ''}`}
          status={st === 'dispatch_ready' ? 'pending' : st}
          actions={(
            <>
              <Button disabled={busy === 'pdf'} onClick={() => run('pdf', () => downloadReturnToVendorDcPdf(dcNumber))}>PDF</Button>
              {canEdit && ['draft', 'dispatch_ready'].includes(st) && (
                <Button variant="quiet" onClick={() => setConfirm({ title: 'Cancel this return challan?', body: 'Its laptops go back to the “To send back” list.', label: 'Cancel challan', tone: 'crit', go: () => run('cancel', () => cancelReturnToVendorDc(dcNumber), 'Challan cancelled') })}>Cancel</Button>
              )}
            </>
          )}
          meta={[
            { label: 'Vendor', value: dc.vendor_name },
            { label: 'Laptops', value: live.length },
            { label: 'Declared value', value: <Money value={total} /> },
            { label: 'Travels by', value: SHIP_LABEL[dc.ship_by] || '—' },
            { label: 'Created', value: <DateTime value={dc.created_at} /> },
          ]}
        />
        <FlowSteps steps={flow} />
        {next}

        <Section
          title={`Laptops · ${live.length}`}
          actions={st === 'draft' && canEdit && (
            <div className="flex items-center" style={{ gap: '8px' }}>
              <Input type="number" min={0} placeholder="Same value for all" value={sameValue} onChange={(e) => setSameValue(e.target.value)} style={{ width: '10rem' }} />
              <Button disabled={!(Number(sameValue) > 0)} onClick={() => setValues(Object.fromEntries(live.map((i) => [i.serial_id, sameValue])))}>Apply</Button>
            </div>
          )}
        >
          <DataTable columns={cols} rows={items} rowKey={(i) => i.id} />
          {st === 'draft' && <p className="text-ink-3" style={{ marginTop: '8px' }}>At ₹50,000 or more in total, Accounts is mailed for the e-way bill automatically when you send it to the gate.</p>}
          {st === 'draft' && missing > 0 && <p style={{ color: 'var(--alert-warn)', marginTop: '8px' }}>⚠ {missing} laptop(s) have no declared value yet.</p>}
        </Section>

        {st === 'draft' && canEdit && (
          <Section title="How it travels">
            <VrtdcTransportFields shipBy={shipBy} onShipByChange={setShipBy} fields={fields} onFieldsChange={setFields} deliveryTechnicians={techs} disabled={busy === 'dispatch'} />
            <div className="flex justify-end" style={{ marginTop: '12px' }}>
              <Button variant="primary" disabled={busy === 'dispatch'} onClick={sendToGate}>{busy === 'dispatch' ? 'Sending…' : 'Send to the gate'}</Button>
            </div>
          </Section>
        )}

        {st !== 'cancelled' && (
          <Section title="E-way bill">
            <VrtdcEwayPanel dcNumber={dcNumber} status={st} onChange={load} />
          </Section>
        )}

        <Section title="Addresses">
          <KeyValue cols={2} items={[
            { label: 'Ship to (vendor)', value: <span style={{ whiteSpace: 'pre-line' }}>{dc.shipping_address}</span> },
            { label: 'From (warehouse)', value: <span style={{ whiteSpace: 'pre-line' }}>{dc.warehouse_address}</span> },
            { label: 'Vendor contact', value: [dc.contact_person, dc.contact_mobile].filter(Boolean).join(' · ') },
            { label: 'Transport', value: [SHIP_LABEL[dc.ship_by], transportLine(dc)].filter(Boolean).join(' — ') || '—' },
          ]}
          />
        </Section>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const go = confirm?.go; setConfirm(null); go?.(); }}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.label}
        tone={confirm?.tone}
      />
    </DeskShell>
  );
}

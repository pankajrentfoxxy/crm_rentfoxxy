import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Money, Notice, Section,
  Select, StatusChip, Textarea, DateTime,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { getBackendOrigin } from '../../../../utils/api';
import { fetchDeliveryTechnicians } from '../../../../utils/deliveryRegisterApi';
import { formatIndianMobileInput } from '../../../../utils/phoneValidation';
import { validateVrdcDispatch } from '../../../floor-pipeline/components/VrdcDispatchFields';
import SignaturePadComponent from '../../../sales-pipeline/components/SignaturePad';
import { RepairDcStatus } from './PartRepairsPage';
import {
  PART_REPAIR_WRITE_ROLES, REPAIR_LINE_STATUS, cancelPartVendorReturnDc, dispatchPartVendorReturnDc,
  downloadPartVendorRepairPdf, errMsg, fetchPartVendorRepairDc, receivePartVendorReturnDc,
} from './partsApi';

const SHIP_OPTIONS = [
  { value: 'by_hand', label: 'Our delivery person' },
  { value: 'by_courier', label: 'Courier' },
  { value: 'by_porter', label: 'Porter' },
  { value: 'by_vendor_pickup', label: 'Vendor collects' },
];

const uploadUrl = (p) => {
  if (!p) return null;
  if (String(p).startsWith('http') || String(p).startsWith('data:')) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${String(p).replace(/^\/?uploads\//, '')}`;
};

function LineStatus({ status }) {
  const s = REPAIR_LINE_STATUS[status];
  return <StatusChip status={s ? s.chip : status} label={s ? s.label : undefined} />;
}

function Signature({ url, onChange, label }) {
  const [drawing, setDrawing] = useState(false);
  if (url && !drawing) {
    return (
      <div className="c-stack">
        <img src={uploadUrl(url)} alt={label} style={{ height: 80, maxWidth: '100%', border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)', background: 'var(--surface)' }} />
        {onChange && <div><Button variant="quiet" onClick={() => setDrawing(true)}>Sign again</Button></div>}
      </div>
    );
  }
  if (!onChange) return <span className="text-ink-3">Not signed</span>;
  return drawing || !url
    ? <SignaturePadComponent onSave={(d) => { onChange(d); setDrawing(false); }} onCancel={() => setDrawing(false)} />
    : null;
}

/** How the parts leave — the same modes and rules as the laptop repair challan. */
function DispatchFields({ shipBy, onShipBy, fields, onFields, technicians }) {
  const set = (k) => (e) => onFields({ ...fields, [k]: e.target.value });
  const vehicle = (e) => onFields({ ...fields, vehicle_number: e.target.value.toUpperCase().replace(/\s+/g, '') });
  return (
    <div className="c-stack">
      <Field label="Send by" required><Select value={shipBy} onChange={(e) => onShipBy(e.target.value)} placeholder="Choose…" options={SHIP_OPTIONS} /></Field>
      {shipBy === 'by_courier' && (
        <FormGrid cols={3}>
          <Field label="Courier" required><Input value={fields.courier_name || ''} onChange={set('courier_name')} /></Field>
          <Field label="AWB number"><Input value={fields.awb_number || ''} onChange={set('awb_number')} /></Field>
          <Field label="Tracking link"><Input value={fields.courier_tracking_url || ''} onChange={set('courier_tracking_url')} /></Field>
        </FormGrid>
      )}
      {shipBy === 'by_porter' && (
        <FormGrid cols={3}>
          <Field label="Porter booking / tracking ID" required><Input value={fields.porter_tracking_id || ''} onChange={set('porter_tracking_id')} /></Field>
          <Field label="Porter order ID"><Input value={fields.porter_order_id || ''} onChange={set('porter_order_id')} /></Field>
          <Field label="Booking link"><Input value={fields.porter_booking_url || ''} onChange={set('porter_booking_url')} /></Field>
        </FormGrid>
      )}
      {shipBy === 'by_hand' && (
        <FormGrid cols={2}>
          <Field label="Delivery person" required hint={technicians.length ? undefined : 'No delivery people on record'}>
            <Select
              value={String(fields.delivery_person_id || '')}
              onChange={set('delivery_person_id')}
              placeholder="Choose…"
              options={technicians.filter((t) => t.is_active !== false).map((t) => ({
                value: String(t.technician_id),
                label: `${[t.first_name, t.last_name].filter(Boolean).join(' ')}${t.phone ? ` — ${t.phone}` : ''}`,
              }))}
            />
          </Field>
          <Field label="Vehicle number" required><Input value={fields.vehicle_number || ''} onChange={vehicle} maxLength={20} /></Field>
        </FormGrid>
      )}
      {shipBy === 'by_vendor_pickup' && (
        <FormGrid cols={3}>
          <Field label="Collector name" required><Input value={fields.vendor_pickup_person || ''} onChange={set('vendor_pickup_person')} /></Field>
          <Field label="Collector mobile" required><Input inputMode="numeric" maxLength={10} value={fields.vendor_pickup_mobile || ''} onChange={(e) => onFields({ ...fields, vendor_pickup_mobile: formatIndianMobileInput(e.target.value) })} /></Field>
          <Field label="Vehicle number" required><Input value={fields.vehicle_number || ''} onChange={vehicle} maxLength={20} /></Field>
        </FormGrid>
      )}
    </div>
  );
}

/**
 * One part repair challan (old: /inventory-management/part-vendor-repair/:dc):
 * draft → sign and send → receive each line back as repaired or replaced
 * (then QC on Part repairs → Waiting for QC). A draft can be cancelled.
 */
export default function PartRepairRecordPage() {
  const { dcNumber: raw } = useParams();
  const dcNumber = decodeURIComponent(raw || '');
  const { hasPermission, user } = usePermission();
  const canWrite = PART_REPAIR_WRITE_ROLES.includes(user?.role)
    || hasPermission('part_vendor_repair', 'edit') || hasPermission('part_vendor_repair', 'create');

  const [dc, setDc] = useState(undefined);
  const [technicians, setTechnicians] = useState([]);
  const [shipBy, setShipBy] = useState('');
  const [fields, setFields] = useState({});
  const [whName, setWhName] = useState('');
  const [whSign, setWhSign] = useState(null);
  const [recv, setRecv] = useState({});
  const [rcvName, setRcvName] = useState('');
  const [rcvSign, setRcvSign] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchPartVendorRepairDc(dcNumber)
      .then(({ data }) => {
        const row = data.data || null;
        setDc(row);
        setShipBy(row?.ship_by || '');
        setFields({
          courier_name: row?.courier_name && row.courier_name !== 'TBD' ? row.courier_name : '',
          awb_number: row?.awb_number || '',
          courier_tracking_url: row?.courier_tracking_url || '',
          porter_tracking_id: row?.porter_tracking_id || '',
          porter_order_id: row?.porter_order_id || '',
          porter_booking_url: row?.porter_booking_url || '',
          delivery_person_id: row?.delivery_person_id || '',
          vehicle_number: row?.vehicle_number || '',
          vendor_pickup_person: row?.vendor_pickup_person || '',
          vendor_pickup_mobile: row?.vendor_pickup_mobile || '',
        });
        setWhName(row?.warehouse_dispatch_signer_name || user?.name || user?.email || '');
        setRcvName(user?.name || user?.email || '');
        setWhSign(null); setRcvSign(null); setRecv({});
      })
      .catch((e) => { setDc(null); toast.error(errMsg(e)); });
  }, [dcNumber, user?.name, user?.email]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canWrite) return;
    fetchDeliveryTechnicians().then((r) => setTechnicians(r.data?.data || r.data || [])).catch(() => {});
  }, [canWrite]);

  const pdf = async () => {
    try { await downloadPartVendorRepairPdf(dcNumber); } catch (e) { toast.error(errMsg(e, 'PDF download failed')); }
  };
  const dispatch = async () => {
    const err = validateVrdcDispatch(shipBy, fields);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      await dispatchPartVendorReturnDc(dcNumber, {
        ship_by: shipBy, ...fields, warehouse_esign: whSign || undefined, warehouse_signer_name: whName.trim(),
      });
      toast.success('Sent to the vendor');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const receive = async () => {
    const items = (dc?.items || [])
      .filter((i) => i.item_status === 'dispatched' && recv[i.instance_id]?.mode)
      .map((i) => ({
        instance_id: i.instance_id,
        receive_mode: recv[i.instance_id].mode,
        replacement_serial: recv[i.instance_id].mode === 'replacement' ? (recv[i.instance_id].serial || '').trim() || undefined : undefined,
        remarks: (recv[i.instance_id].remarks || '').trim() || undefined,
      }));
    setBusy(true);
    try {
      const { data } = await receivePartVendorReturnDc(dcNumber, {
        receive_items: items, warehouse_esign: rcvSign || undefined, warehouse_signer_name: rcvName.trim(),
      });
      toast.success(`${data.received?.length || items.length} part(s) received — waiting for QC on Part repairs`);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const doCancel = async () => {
    setBusy(true);
    try {
      await cancelPartVendorReturnDc(dcNumber, cancel.trim());
      toast.success('Challan cancelled — its parts are back on the defective list');
      setCancel(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  if (dc === undefined) return <DeskShell title={dcNumber} breadcrumb="Stock · Part repairs"><EmptyState title="Loading…" /></DeskShell>;
  if (dc === null) {
    return (
      <DeskShell title={dcNumber} breadcrumb="Stock · Part repairs">
        <EmptyState title="Challan not found" action={<Link to="/carret/stock/part-repairs">All part repairs</Link>} />
      </DeskShell>
    );
  }

  const pending = (dc.items || []).filter((i) => i.item_status === 'dispatched');
  const picked = pending.filter((i) => recv[i.instance_id]?.mode);
  const setLine = (id, patch) => setRecv((r) => ({ ...r, [id]: { ...(r[id] || {}), ...patch } }));
  const declared = (dc.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);

  const cols = [
    { key: 'p', header: 'Part ID', render: (i) => <DocNumber value={i.prt_id} />, sub: (i) => i.serial_number || 'no serial' },
    { key: 'n', header: 'Part', render: (i) => i.part_name || '—', sub: (i) => i.item_remarks || null },
    { key: 'v', header: 'Value', numeric: true, render: (i) => <Money value={i.price} showZero={false} />, sub: (i) => (i.hsn_code ? `HSN ${i.hsn_code}` : null) },
    {
      key: 's',
      header: 'State',
      render: (i) => <LineStatus status={i.item_status} />,
      sub: (i) => (i.replacement_prt_id ? `replaced by ${i.replacement_prt_id}${i.replacement_status ? ` (${i.replacement_status.replace(/_/g, ' ')})` : ''}` : (i.returned_at ? <DateTime value={i.returned_at} /> : null)),
    },
    ...(canWrite && pending.length ? [{
      key: 'r',
      header: 'Receive as',
      render: (i) => (i.item_status === 'dispatched' ? (
        <div className="c-stack" style={{ minWidth: '14rem' }}>
          <Select
            aria-label={`Receive ${i.prt_id} as`}
            value={recv[i.instance_id]?.mode || ''}
            onChange={(e) => setLine(i.instance_id, { mode: e.target.value })}
            placeholder="Not back yet"
            options={[{ value: 'repaired', label: 'Repaired (same unit)' }, { value: 'replacement', label: 'Replacement (new unit)' }]}
          />
          {recv[i.instance_id]?.mode === 'replacement' && (
            <Input placeholder="Replacement serial (optional)" value={recv[i.instance_id]?.serial || ''} onChange={(e) => setLine(i.instance_id, { serial: e.target.value })} />
          )}
          {recv[i.instance_id]?.mode && (
            <Input placeholder="Note (optional)" value={recv[i.instance_id]?.remarks || ''} onChange={(e) => setLine(i.instance_id, { remarks: e.target.value })} />
          )}
        </div>
      ) : null),
    }] : []),
  ];

  return (
    <DeskShell
      title={dc.dc_number}
      breadcrumb="Stock · Part repairs"
      subtitle={`${dc.vendor_name || '—'} · ${(dc.items || []).length} part(s)`}
      actions={(
        <div className="flex flex-wrap" style={{ gap: '8px' }}>
          <Button onClick={pdf}>Challan PDF</Button>
          {canWrite && dc.status === 'draft' && <Button variant="quiet" onClick={() => setCancel('')}>Cancel challan</Button>}
          <Link to="/carret/stock/part-repairs" className="c-btn c-btn--quiet">All part repairs</Link>
        </div>
      )}
    >
      <div className="c-stack">
        <div className="flex items-center" style={{ gap: '8px' }}><RepairDcStatus status={dc.status} />{dc.cancel_reason && <span className="text-ink-3">{dc.cancel_reason}</span>}</div>
        <KeyValue
          cols={3}
          items={[
            { label: 'Vendor', value: dc.vendor_name },
            { label: 'Contact', value: [dc.contact_person, dc.contact_mobile].filter(Boolean).join(' · ') },
            { label: 'From', value: dc.warehouse_name },
            { label: 'Ship to', value: dc.shipping_address || dc.vendor_address },
            { label: 'Raised', value: <DateTime value={dc.created_at} /> },
            { label: 'Expected back', value: dc.expected_return_date ? <DateTime value={dc.expected_return_date} /> : null },
            { label: 'Sent', value: dc.dispatched_at ? <DateTime value={dc.dispatched_at} /> : null },
            { label: 'Sent by', value: dc.status !== 'draft' ? [SHIP_OPTIONS.find((o) => o.value === dc.ship_by)?.label, dc.courier_name, dc.awb_number, dc.porter_tracking_id, dc.vehicle_number].filter(Boolean).join(' · ') : null },
            { label: 'E-way bill', value: [dc.eway_bill_number, dc.eway_bill_date ? String(dc.eway_bill_date).slice(0, 10) : null].filter(Boolean).join(' · ') },
            { label: 'Declared value', value: declared ? <Money value={declared} /> : null },
            { label: 'Remarks', value: dc.remarks },
          ]}
        />

        <Section title="Parts on this challan">
          <DataTable columns={cols} rows={dc.items || []} rowKey={(i) => i.id} empty={<EmptyState title="No lines" />} />
        </Section>

        {canWrite && dc.status === 'draft' && (
          <Section title="Sign and send">
            <div className="c-stack">
              <DispatchFields shipBy={shipBy} onShipBy={setShipBy} fields={fields} onFields={setFields} technicians={technicians} />
              <Field label="Warehouse signer" required><Input value={whName} onChange={(e) => setWhName(e.target.value)} /></Field>
              <Field label="Warehouse signature" required>
                <Signature url={whSign || dc.warehouse_dispatch_esign_url} onChange={setWhSign} label="Warehouse signature" />
              </Field>
              <div>
                <Button variant="primary" disabled={busy || !whName.trim() || !(whSign || dc.warehouse_dispatch_esign_url)} onClick={dispatch}>Sign and send to vendor</Button>
              </div>
            </div>
          </Section>
        )}

        {dc.status !== 'draft' && dc.warehouse_dispatch_esign_url && (
          <Section title="Sent — signed by">
            <div className="c-stack">
              <span>{dc.warehouse_dispatch_signer_name || '—'}</span>
              <Signature url={dc.warehouse_dispatch_esign_url} label="Warehouse dispatch signature" />
            </div>
          </Section>
        )}

        {canWrite && pending.length > 0 && (
          <Section title={`Receive back — ${pending.length} still with the vendor`}>
            <div className="c-stack">
              <Notice tone="info">Choose Repaired or Replacement on each line that came back. They go to Waiting for QC, and count as stock only when QC passes. A replaced unit&apos;s old Part ID is discarded.</Notice>
              <FormGrid cols={2}>
                <Field label="Received by" required><Input value={rcvName} onChange={(e) => setRcvName(e.target.value)} /></Field>
              </FormGrid>
              <Field label="Receiving signature" hint="Optional"><Signature url={rcvSign} onChange={setRcvSign} label="Receiving signature" /></Field>
              <div>
                <Button variant="primary" disabled={busy || !picked.length || !rcvName.trim()} onClick={receive}>
                  {picked.length ? `Receive ${picked.length} part(s)` : 'Choose what came back'}
                </Button>
              </div>
            </div>
          </Section>
        )}
        {['partially_returned', 'returned'].includes(dc.status) && (
          <Notice tone="info" action={<Link to="/carret/stock/part-repairs?tab=qc" className="c-btn c-btn--quiet">Waiting for QC</Link>}>
            Parts received back wait for QC before they are stock.
          </Notice>
        )}
      </div>

      <Drawer
        open={cancel !== null}
        onClose={() => setCancel(null)}
        title={`Cancel ${dc.dc_number}`}
        footer={<Button variant="primary" disabled={busy || (cancel || '').trim().length < 3} onClick={doCancel}>Cancel the challan</Button>}
      >
        <div className="c-stack">
          <p>It has not gone out. Its parts go back to the defective list and can go on another challan.</p>
          <Field label="Why" required><Textarea rows={3} value={cancel || ''} onChange={(e) => setCancel(e.target.value)} /></Field>
        </div>
      </Drawer>
    </DeskShell>
  );
}

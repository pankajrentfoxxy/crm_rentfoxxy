import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FlowSteps, FormGrid, Input,
  KeyValue, Money, Notice, Section, SignaturePad, StatusChip, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  downloadVendorRepairPdf, downloadVendorRepairReceivePdf, fetchVendorRepairDc, markVendorRepairDeliveredToVendor,
  signVendorRepairDispatch, startReplacementCheck, updateVendorRepairCommercialDetails, updateVendorRepairDispatchDetails,
} from '../../floor-pipeline/vendorRepairApi';
import { DEFAULT_BILLING_ADDRESS, formatVrdcProductLines } from '../../floor-pipeline/vendorRepairUi';
import { issueTypeLabel } from '../../floor-pipeline/repairIssueTypes';
import VrtdcTransportFields, { validateVrtdcTransport } from './VrtdcTransportFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import api from '../../../utils/api';
import { errMsg } from './procureShared';
import {
  REPAIR_WAREHOUSE_ROLES, SHIP_LABEL, VRDC_STATUS_LABEL, itemStatusLabel, prettyYmd, readImage, shipByOf, transportFieldsOf,
  transportLine, uploadUrl, vrdcChip, ymdOf,
} from './repairShared';
import {
  EwaySection, ReceiveDrawer, RentMailSection, ReplacementDecisionDrawer, VendorKeptDrawer,
} from './RepairChallanParts';

/**
 * Procurement → Vendor returns → repair challan (VRDC).
 *
 * Everything the old Vendor Repair DC page did, on the same endpoints:
 * mail the vendor (rent pause from the stop date), price / HSN, how it
 * travels, sign and send to the gate (e-way mail to Accounts at Rs 50,000+),
 * guard scan-out, delivered to the vendor, the guard's scan-in, receive back
 * (repaired / replacement, with the vendor-return script), replacement check
 * and approval, vendor keeps it, dispatch / receive / repair-request PDFs,
 * cancel before it leaves. Rent pause and resume stay exactly as the backend
 * does them (memory: vendor-repair decisions).
 */
const enc = encodeURIComponent;

/** One laptop's rent / replacement state in a line or two (was RepairItemRentLines). */
function itemNotes(item) {
  const out = [];
  if (item.issue_type) out.push(`Issue: ${issueTypeLabel(item.issue_type)}`);
  if (item.rent_paused_from && !item.rent_resumed_on && !['vendor_kept', 'replacement_received'].includes(item.item_status)) out.push(`Rent stopped from ${prettyYmd(ymdOf(item.rent_paused_from))}`);
  if (item.rent_resumed_on) out.push(`Rent resumed ${prettyYmd(ymdOf(item.rent_resumed_on))}`);
  if (item.item_status === 'replacement_pending') {
    const p = item.replacement_proposed || {};
    out.push(`Replacement waiting for Accounts — ${[p.brand, p.model].filter(Boolean).join(' ') || '—'} · ${p.serial_number || '—'}`);
  }
  if (item.replacement_approval_status === 'approved' && item.item_status === 'gate_received') out.push('Replacement approved — receive it now');
  if (item.replacement_config_result && item.item_status === 'gate_received' && item.replacement_approval_status !== 'approved') {
    out.push(`Replacement check: ${item.replacement_config_result.configurationMatched ? 'same model & config' : 'different — will need approval'}${item.replacement_captured_serial ? ` · serial ${item.replacement_captured_serial}` : ' · serial not read yet'}`);
  }
  if ((item.replacement_rejections || []).length) out.push(`${item.replacement_rejections.length} replacement(s) not accepted and handed back`);
  if (item.item_status === 'vendor_kept') out.push(`Vendor kept it${item.vendor_kept_reason ? ` — ${item.vendor_kept_reason}` : ''}`);
  if (item.gate_outward_at) out.push('Guard scanned it out');
  if (item.gate_inward_at) out.push('Guard scanned it in');
  if (item.receive_laptop_condition) out.push(item.receive_laptop_condition === 'on' ? 'Received powering on' : 'Received not powering on');
  if (item.returned_at) out.push(`Received ${new Date(item.returned_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}${item.receive_wh_signer_name ? ` by ${item.receive_wh_signer_name}` : ''}`);
  if (item.receive_dc_number) out.push(`Receive challan ${item.receive_dc_number}`);
  if (item.replacement_dc_number) out.push(`Replacement challan ${item.replacement_dc_number}`);
  if (item.replacement_serial_number) out.push(`Replacement ${item.replacement_serial_number} · ${item.replacement_ttspl_id || '—'}`);
  return out;
}

function SignatureImage({ label, path, name }) {
  if (!path) return null;
  return (
    <div className="c-card" style={{ padding: '10px 12px' }}>
      <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{label}{name ? ` — ${name}` : ''}</div>
      <img src={uploadUrl(path)} alt={label} style={{ maxHeight: '96px', width: '100%', objectFit: 'contain', background: 'var(--surface)' }} />
    </div>
  );
}

export default function RepairChallanRecordPage() {
  const { dcNumber: raw } = useParams();
  const dcNumber = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const { user, hasPermission } = usePermission();
  const role = user?.role;
  const isWarehouse = REPAIR_WAREHOUSE_ROLES.has(role);
  // requireVendorRepairDispatch: the dispatch grant (create or edit) OR a warehouse role.
  const canDispatch = isWarehouse || hasPermission('vendor_repair_dc_dispatch', 'create') || hasPermission('vendor_repair_dc_dispatch', 'edit');
  const canHsn = role === 'admin' || role === 'super_admin';
  const canGate = hasPermission('guard_gate_checking', 'view');

  const [dc, setDc] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [prices, setPrices] = useState({});
  const [hsns, setHsns] = useState({});
  const [shipBy, setShipBy] = useState('');
  const [fields, setFields] = useState({});
  const [techs, setTechs] = useState([]);
  const [sign, setSign] = useState({ whName: '', vendorName: '', wh: null, vendor: null, pod: null });
  const [padFor, setPadFor] = useState(null); // 'wh' | 'vendor'
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [keptFor, setKeptFor] = useState(null);
  const [decision, setDecision] = useState(null); // { item, approve }
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(() => {
    fetchVendorRepairDc(dcNumber)
      .then(({ data }) => {
        const d = data.data;
        setDc(d);
        setShipBy(shipByOf(d));
        setFields(transportFieldsOf(d));
        setPrices(Object.fromEntries((d.items || []).map((i) => [i.ticket_id, i.price != null ? String(i.price) : ''])));
        setHsns(Object.fromEntries((d.items || []).map((i) => [i.ticket_id, i.hsn_code || ''])));
        setSign((s) => ({
          ...s,
          whName: d.warehouse_dispatch_signer_name || s.whName || user?.name || user?.email || '',
          vendorName: d.vendor_dispatch_signer_name || s.vendorName,
        }));
      })
      .catch((e) => setError(errMsg(e, 'Could not load the repair challan.')));
  }, [dcNumber, user?.name, user?.email]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchDeliveryTechnicians({ limit: 200 }).then((d) => setTechs(d?.data || d?.technicians || [])).catch(() => {});
  }, []);

  const items = useMemo(() => dc?.items || [], [dc]);
  const waiting = useMemo(() => items.filter((i) => ['dispatched', 'gate_received'].includes(i.item_status || 'dispatched')), [items]);
  const declared = items.reduce((n, i) => n + (Number(prices[i.ticket_id] !== undefined && prices[i.ticket_id] !== '' ? prices[i.ticket_id] : i.price) || 0), 0);

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  if (error) return <DeskShell title={dcNumber} breadcrumb="Procurement / Vendor returns"><EmptyState title="Could not load this repair challan" body={error} action={<Button onClick={() => navigate('/carret/procure/returns?tab=repairs')}>Back</Button>} /></DeskShell>;
  if (!dc) return <DeskShell title={dcNumber} breadcrumb="Procurement / Vendor returns"><EmptyState title="Loading…" /></DeskShell>;

  const st = dc.status;
  const eway = dc.eway_compliance || null;
  const canPdf = eway?.can_download_pdf !== false && dc.can_download_pdf !== false;
  const canCommercial = isWarehouse && st !== 'returned' && st !== 'cancelled';
  const hasReceivePdf = Boolean(dc.receive_dc_number || dc.receive_pdf_path || items.some((i) => i.receive_dc_number));
  const out = ['dispatched', 'partially_returned'].includes(st);

  const saveCommercial = () => run('commercial', () => updateVendorRepairCommercialDetails(dcNumber, {
    item_prices: Object.fromEntries(items.map((i) => [i.ticket_id, prices[i.ticket_id] ?? ''])),
    item_hsn_codes: Object.fromEntries(items.map((i) => [i.ticket_id, hsns[i.ticket_id] ?? ''])),
  }), 'Values and HSN saved — the PDF uses them');

  const saveTransport = () => {
    const err = validateVrtdcTransport(shipBy, fields);
    if (err) { toast.error(err); return; }
    run('transport', () => updateVendorRepairDispatchDetails(dcNumber, { ship_by: shipBy, ...fields }), 'How it travels — saved');
  };

  const sendToGate = async () => {
    if (!sign.wh && !dc.warehouse_dispatch_esign_url) { toast.error('The warehouse signature is required'); return; }
    if (!sign.whName.trim()) { toast.error('Enter the warehouse signer’s name'); return; }
    const err = validateVrtdcTransport(shipBy, fields);
    if (err) { toast.error(err); return; }
    setBusy('gate');
    try {
      const { data } = await signVendorRepairDispatch(dcNumber, {
        ship_by: shipBy,
        ...fields,
        warehouse_esign: sign.wh || undefined,
        vendor_esign: sign.vendor || undefined,
        warehouse_signer_name: sign.whName.trim(),
        vendor_signer_name: sign.vendorName.trim() || undefined,
        dispatch_pod: sign.pod || undefined,
      });
      const ew = data?.eway_request;
      if (ew?.required && ew.sent && !ew.already) toast.success('Sent to the gate. ₹50,000 or more — Accounts has been mailed for the e-way bill.');
      else if (ew?.required && !ew.sent) toast.error(`Sent to the gate, but the e-way mail to Accounts failed: ${ew.error || 'unknown'} — use “Mail Accounts” in the e-way section.`, { duration: 9000 });
      else toast.success('Signed and sent to the gate — the guard scans it out');
      setSign((s) => ({ ...s, wh: null, vendor: null, pod: null }));
      load();
    } catch (e) {
      toast.error(e?.code === 'ECONNABORTED' ? 'It timed out — reload to check whether it went to the gate before trying again' : errMsg(e));
    } finally { setBusy(''); }
  };

  const replacementCheck = async (item) => {
    setBusy(`check-${item.id}`);
    try {
      const { data } = await startReplacementCheck(dcNumber, item.id);
      toast.success(`Boot the replacement and run the vendor-return script with access number ${data.access_number}`, { duration: 12000 });
      load();
    } catch (e) { toast.error(errMsg(e, 'Could not start the check')); } finally { setBusy(''); }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await api.post(`/vendor-repair/dc/${enc(dcNumber)}/cancel`, { reason: cancelReason });
      toast.success('Cancelled — its laptops are back on the “To repair” list');
      setCancelOpen(false); setCancelReason('');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  /* ---- next step ---- */
  let next;
  if (st === 'draft') {
    const needMail = dc.rent_stop_date && !dc.vendor_notified_at;
    next = <Notice tone="info" title="Draft">{needMail ? 'Mail the vendor first (it stops rent from the chosen date), then set how it travels, sign and send it to the gate.' : 'Set how it travels, sign and send it to the gate.'}</Notice>;
  } else if (st === 'dispatch_ready') {
    next = (
      <Notice tone="warn" title="At the gate" action={canGate && <Button variant="primary" onClick={() => navigate(`/carret/move/gate?dir=outward&dc=${enc(dcNumber)}`)}>Open at the gate</Button>}>
        The guard scans it out; that sends the laptops out for repair.{eway?.applies && !eway?.eway_complete ? ' It can’t leave until Accounts adds the e-way bill.' : ''}
      </Notice>
    );
  } else if (out) {
    next = (
      <Notice tone="info" title={dc.vendor_delivered_at ? `With the vendor since ${prettyYmd(ymdOf(dc.vendor_delivered_at))}` : `Left ${prettyYmd(ymdOf(dc.dispatched_at))} — on its way`}>
        {waiting.length} laptop(s) still to come back. When one returns the guard scans it in, then receive it here.
        {dc.expected_return_date ? ` Expected back ${prettyYmd(dc.expected_return_date)}.` : ''}
      </Notice>
    );
  } else if (st === 'returned') next = <Notice tone="good" title="All back">Every laptop on this challan has come back, been replaced or kept by the vendor.</Notice>;
  else next = <Notice tone="serious" title="Cancelled">{dc.cancel_reason || 'Its laptops went back to the “To repair” list.'}</Notice>;

  const flow = [
    { key: 'd', label: 'Draft', state: st === 'draft' ? 'current' : 'done' },
    { key: 'g', label: 'At the gate', state: st === 'dispatch_ready' ? 'current' : (out || st === 'returned' ? 'done' : 'todo') },
    { key: 'o', label: 'With the vendor', state: out ? 'current' : (st === 'returned' ? 'done' : 'todo') },
    { key: 'b', label: 'Back', state: st === 'returned' ? 'done' : 'todo' },
  ].map((s) => (st === 'cancelled' ? { ...s, state: 'blocked' } : s));

  const cols = [
    {
      key: 'p',
      header: 'Laptop',
      render: (i) => {
        const p = formatVrdcProductLines(i);
        return <span>{p.title || '—'}<br /><span className="text-ink-3">{p.specs.join(' · ')}</span></span>;
      },
      sub: (i) => [i.ttspl_id, i.serial_number].filter(Boolean).join(' · '),
    },
    {
      key: 'h',
      header: 'HSN',
      render: (i) => (canCommercial && canHsn
        ? <Input value={hsns[i.ticket_id] ?? ''} onChange={(e) => setHsns((m) => ({ ...m, [i.ticket_id]: e.target.value }))} style={{ width: '6.5rem' }} className="font-mono" aria-label={`HSN of ${i.ttspl_id}`} />
        : <span className="font-mono">{i.hsn_code || '847330'}</span>),
    },
    {
      key: 'v',
      header: 'Declared value',
      numeric: true,
      render: (i) => (canCommercial
        ? <Input type="number" min={0} step="0.01" value={prices[i.ticket_id] ?? ''} onChange={(e) => setPrices((m) => ({ ...m, [i.ticket_id]: e.target.value }))} style={{ width: '8rem', textAlign: 'right' }} aria-label={`Value of ${i.ttspl_id}`} />
        : <Money value={i.price} />),
    },
    {
      key: 's',
      header: 'Where it is',
      render: (i) => (
        <span>
          <StatusChip status={['received', 'replacement_received'].includes(i.item_status) ? 'received' : i.item_status === 'vendor_kept' ? 'closed' : i.item_status === 'replacement_pending' ? 'pending_approval' : i.item_status === 'cancelled' ? 'cancelled' : 'processing'} label={itemStatusLabel(i.item_status)} />
          {i.item_remarks || i.diagnosis_failed_reason ? <><br /><span className="text-ink-3">{i.item_remarks || i.diagnosis_failed_reason}</span></> : null}
          {itemNotes(i).map((n) => <React.Fragment key={n}><br /><span className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{n}</span></React.Fragment>)}
        </span>
      ),
    },
    {
      key: 'a',
      header: '',
      render: (i) => {
        const canCheck = isWarehouse && ['dispatched', 'gate_received'].includes(i.item_status) && i.replacement_approval_status !== 'approved' && !dc.gate_legacy;
        return (
          <div className="flex flex-col" style={{ gap: '4px', alignItems: 'flex-start' }}>
            <Button variant="quiet" onClick={() => navigate(`/carret/produce/tickets/${i.ticket_id}`)}>Floor ticket #{i.ticket_id}</Button>
            {canCheck && (
              <Button
                variant="quiet"
                disabled={busy === `check-${i.id}`}
                onClick={() => (i.item_status === 'dispatched'
                  ? setConfirm({ title: `Has the vendor’s replacement for ${i.ttspl_id} arrived?`, body: 'This records its arrival today — rent on it starts from today.', label: 'It has arrived', tone: 'warn', go: () => replacementCheck(i) })
                  : replacementCheck(i))}
              >
                It’s a replacement
              </Button>
            )}
            {isWarehouse && i.item_status === 'dispatched' && <Button variant="quiet" onClick={() => setKeptFor(i)}>Vendor keeps it</Button>}
            {dc.can_decide_replacement && i.item_status === 'replacement_pending' && (
              <>
                <Button variant="primary" onClick={() => setDecision({ item: i, approve: true })}>Approve replacement</Button>
                <Button variant="quiet" onClick={() => setDecision({ item: i, approve: false })}>Reject</Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const captures = items.filter((i) => i.return_capture?.access_number && i.item_status === 'gate_received' && !i.return_config_verified_at);

  return (
    <DeskShell title={dcNumber} breadcrumb="Procurement / Vendor returns" subtitle={dc.vendor_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={dcNumber}
          type="Repair challan · to vendor"
          status={vrdcChip(st)}
          actions={(
            <>
              <Button disabled={busy === 'pdf' || !canPdf} title={!canPdf ? (eway?.lock_message || 'E-way bill needed first') : undefined} onClick={() => run('pdf', () => downloadVendorRepairPdf(dcNumber))}>Challan PDF</Button>
              {hasReceivePdf && <Button disabled={busy === 'rpdf'} onClick={() => run('rpdf', () => downloadVendorRepairReceivePdf(dcNumber))}>Receive PDF</Button>}
              {canDispatch && out && !dc.vendor_delivered_at && (
                <Button onClick={() => setConfirm({ title: 'Has the vendor got these laptops?', body: 'Records the delivery to the vendor.', label: 'Delivered to vendor', tone: 'good', go: () => run('delivered', () => markVendorRepairDeliveredToVendor(dcNumber), 'Marked delivered to the vendor') })}>Delivered to vendor</Button>
              )}
              {isWarehouse && out && waiting.length > 0 && <Button variant="primary" onClick={() => setReceiveOpen(true)}>Receive back ({waiting.length})</Button>}
              {canDispatch && ['draft', 'dispatch_ready'].includes(st) && <Button variant="quiet" onClick={() => setCancelOpen(true)}>Cancel</Button>}
            </>
          )}
          meta={[
            { label: 'Vendor', value: dc.vendor_name },
            { label: 'Status', value: VRDC_STATUS_LABEL[st] || st },
            { label: 'Back / sent', value: `${dc.items_received_count ?? items.filter((i) => ['received', 'replacement_received'].includes(i.item_status)).length} / ${dc.items_dispatched_count || items.length}` },
            { label: 'Declared value', value: <Money value={declared} /> },
            { label: 'Travels by', value: SHIP_LABEL[shipByOf(dc)] || '—' },
            { label: 'Created', value: <DateTime value={dc.created_at} /> },
          ]}
        />
        <FlowSteps steps={flow} />
        {next}

        <RentMailSection dc={dc} canAct={canDispatch} onReload={load} />

        {(dc.receive_challans || []).length > 0 && (
          <Section title="Coming back — receive challans">
            <DataTable
              columns={[
                { key: 'n', header: 'Receive challan', render: (c) => <DocNumber value={c.receive_dc_number} /> },
                { key: 'c', header: 'Laptops', numeric: true, render: (c) => c.items_count || 0 },
                { key: 'g', header: 'Guard', render: (c) => (c.gate_inward_at ? <StatusChip status="received" label="Scanned in" /> : <StatusChip status="pending" label="Waiting for the scan-in" />) },
                { key: 'a', header: '', render: (c) => canGate && !c.gate_inward_at && <Button variant="quiet" onClick={() => navigate(`/carret/move/gate?dir=inward&dc=${enc(c.receive_dc_number)}`)}>Open at the gate</Button> },
              ]}
              rows={dc.receive_challans}
              rowKey={(c) => c.receive_dc_number}
            />
          </Section>
        )}

        {captures.length > 0 && (
          <Notice tone="info" title="Vendor-return configuration check" action={<Button onClick={() => window.open('/vendor-return-config-match', '_blank', 'noopener')}>Open the capture page</Button>}>
            Boot each laptop that powers on, enter its access number and run the script — it reads the BIOS serial and checks the specs.
            {captures.map((i) => <React.Fragment key={i.id}><br /><span className="font-mono">{i.ttspl_id}</span> — access <strong className="font-mono">{i.return_capture.access_number}</strong> ({i.return_capture.status})</React.Fragment>)}
          </Notice>
        )}

        <EwaySection dcNumber={dcNumber} compliance={eway} onReload={load} />

        <Section title={`Laptops · ${items.length}`} actions={canCommercial && <Button disabled={busy === 'commercial'} onClick={saveCommercial}>{busy === 'commercial' ? 'Saving…' : `Save values${canHsn ? ' / HSN' : ''}`}</Button>}>
          <DataTable columns={cols} rows={items} rowKey={(i) => i.id} />
          {eway && !eway.applies && <p className="text-ink-3" style={{ marginTop: '8px' }}>At ₹{Number(eway.eway_threshold || 50000).toLocaleString('en-IN')} or more in total, Accounts is mailed for the e-way bill when it is signed for dispatch.</p>}
        </Section>

        {st === 'draft' && canDispatch ? (
          <Section title="How it travels">
            <VrtdcTransportFields shipBy={shipBy} onShipByChange={setShipBy} fields={fields} onFieldsChange={setFields} deliveryTechnicians={techs} disabled={busy === 'transport' || busy === 'gate'} />
            <div className="flex justify-end" style={{ marginTop: '12px' }}>
              <Button disabled={busy === 'transport'} onClick={saveTransport}>{busy === 'transport' ? 'Saving…' : 'Save'}</Button>
            </div>
          </Section>
        ) : (
          <Section title="How it travels">
            <KeyValue cols={2} items={[
              { label: 'Mode', value: SHIP_LABEL[shipByOf(dc)] || '—' },
              { label: 'Details', value: transportLine(dc) || '—' },
              { label: 'Tracking', value: dc.courier_tracking_url || dc.porter_booking_url ? <a href={dc.courier_tracking_url || dc.porter_booking_url} target="_blank" rel="noopener noreferrer">Track</a> : '—' },
              { label: 'Delivered to vendor', value: dc.vendor_delivered_at ? prettyYmd(ymdOf(dc.vendor_delivered_at)) : (dc.dispatched_at ? `Left ${prettyYmd(ymdOf(dc.dispatched_at))} — not confirmed yet` : '—') },
            ]}
            />
          </Section>
        )}

        {st === 'draft' && canDispatch && (
          <Section title="Sign and send to the gate">
            <div className="c-stack">
              <FormGrid cols={2}>
                <Field label="Warehouse signer" required><Input value={sign.whName} onChange={(e) => setSign((s) => ({ ...s, whName: e.target.value }))} /></Field>
                <Field label="Vendor signer (optional)"><Input value={sign.vendorName} onChange={(e) => setSign((s) => ({ ...s, vendorName: e.target.value }))} /></Field>
                <Field label="Warehouse signature" required>
                  {sign.wh || dc.warehouse_dispatch_esign_url
                    ? <div className="c-stack"><img src={sign.wh || uploadUrl(dc.warehouse_dispatch_esign_url)} alt="Warehouse signature" style={{ maxHeight: '80px', objectFit: 'contain', background: 'var(--surface)' }} /><div><Button variant="quiet" onClick={() => setPadFor('wh')}>Sign again</Button></div></div>
                    : <Button onClick={() => setPadFor('wh')}>Sign</Button>}
                </Field>
                <Field label="Vendor signature (optional)">
                  {sign.vendor || dc.vendor_dispatch_esign_url
                    ? <div className="c-stack"><img src={sign.vendor || uploadUrl(dc.vendor_dispatch_esign_url)} alt="Vendor signature" style={{ maxHeight: '80px', objectFit: 'contain', background: 'var(--surface)' }} /><div><Button variant="quiet" onClick={() => setPadFor('vendor')}>Sign again</Button></div></div>
                    : <Button onClick={() => setPadFor('vendor')}>Sign</Button>}
                </Field>
                <Field label="Proof of dispatch (optional)" hint="Photo of the handover or courier receipt, under 5 MB">
                  {sign.pod
                    ? <div className="c-stack"><img src={sign.pod} alt="Proof of dispatch" style={{ maxHeight: '120px', objectFit: 'contain' }} /><div><Button variant="quiet" onClick={() => setSign((s) => ({ ...s, pod: null }))}>Remove</Button></div></div>
                    : <Input type="file" accept="image/png,image/jpeg,image/jpg" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; readImage(f).then((pod) => pod && setSign((s) => ({ ...s, pod }))).catch((er) => toast.error(er.message)); }} />}
                </Field>
              </FormGrid>
              <div className="flex justify-end">
                <Button variant="primary" disabled={busy === 'gate' || !shipBy} onClick={sendToGate}>{busy === 'gate' ? 'Sending to the gate…' : 'Sign and send to the gate'}</Button>
              </div>
              {!shipBy && <p className="text-ink-3">Choose how it travels first.</p>}
            </div>
          </Section>
        )}

        {st !== 'draft' && (dc.warehouse_dispatch_esign_url || dc.vendor_dispatch_esign_url || dc.dispatch_pod_path) && (
          <Section title="Signatures">
            <FormGrid cols={3}>
              <SignatureImage label="Warehouse" path={dc.warehouse_dispatch_esign_url} name={dc.warehouse_dispatch_signer_name} />
              <SignatureImage label="Vendor" path={dc.vendor_dispatch_esign_url} name={dc.vendor_dispatch_signer_name} />
              <SignatureImage label="Proof of dispatch" path={dc.dispatch_pod_path} />
            </FormGrid>
          </Section>
        )}

        <Section title="Addresses">
          <KeyValue cols={2} items={[
            { label: 'From (us)', value: <span style={{ whiteSpace: 'pre-line' }}>{DEFAULT_BILLING_ADDRESS}</span> },
            { label: 'Vendor billing', value: <span style={{ whiteSpace: 'pre-line' }}>{dc.vendor_billing_display || dc.vendor_address || dc.vendor_name || '—'}</span> },
            { label: 'Ship to (vendor)', value: <span style={{ whiteSpace: 'pre-line' }}>{dc.vendor_shipping_display || dc.shipping_address || dc.vendor_address || '—'}</span> },
            { label: 'Vendor contact', value: [dc.contact_person, dc.contact_mobile].filter(Boolean).join(' · ') || '—' },
            { label: 'Expected back', value: dc.expected_return_date ? prettyYmd(dc.expected_return_date) : '—' },
            { label: 'Remarks', value: dc.remarks || '—' },
          ]}
          />
        </Section>
      </div>

      <Drawer open={Boolean(padFor)} onClose={() => setPadFor(null)} title={padFor === 'vendor' ? 'Vendor signature' : 'Warehouse signature'}>
        {padFor && (
          <SignaturePad
            prompt={padFor === 'vendor' ? 'The vendor signs in the box' : 'The warehouse signs in the box'}
            onSave={(sig) => { setSign((s) => ({ ...s, [padFor]: sig })); setPadFor(null); }}
            onCancel={() => setPadFor(null)}
          />
        )}
      </Drawer>

      <ReceiveDrawer open={receiveOpen} dc={dc} items={waiting} user={user} onClose={() => setReceiveOpen(false)} onDone={() => { setReceiveOpen(false); load(); }} />
      {keptFor && <VendorKeptDrawer dcNumber={dcNumber} item={keptFor} onClose={() => setKeptFor(null)} onDone={() => { setKeptFor(null); load(); }} />}
      {decision && <ReplacementDecisionDrawer dcNumber={dcNumber} item={decision.item} approve={decision.approve} onClose={() => setDecision(null)} onDone={() => { setDecision(null); load(); }} />}

      <Drawer
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${dcNumber}`}
        footer={<Button variant="primary" disabled={busy === 'cancel' || cancelReason.trim().length < 3} onClick={cancel}>Cancel challan</Button>}
      >
        <div className="c-stack">
          <p>It has not left the building. Its laptops go back to the “To repair” list.{dc.vendor_notified_at ? ' The vendor was mailed, so they get a cancellation mail and rent continues as if it never stopped.' : ''}</p>
          <Field label="Reason" required><Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
        </div>
      </Drawer>

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

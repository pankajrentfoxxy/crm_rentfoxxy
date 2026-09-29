import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Money, Notice, Panel,
  StatusChip, Tabs, Textarea,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import useDebouncedValue from '../../../../hooks/useDebouncedValue';
import {
  PART_REPAIR_WRITE_ROLES, REPAIR_DC_STATUS, createPartVendorReturnDc, downloadPartVendorRepairPdf, errMsg,
  failPartVendorQc, fetchDefectiveEligibleForVendorReturn, fetchPartVendorQcPending, fetchPartVendorRepairDcList,
  passPartVendorQc, repairDcPath,
} from './partsApi';

const PAGE = 25;
const STATUS_OPTIONS = Object.entries(REPAIR_DC_STATUS).map(([value, v]) => ({ value, label: v.label }));

export function RepairDcStatus({ status }) {
  const s = REPAIR_DC_STATUS[status];
  return <StatusChip status={s ? s.chip : status} label={s ? s.label : undefined} />;
}

function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center" style={{ gap: '8px' }}>
      <Button variant="quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-ink-3">Page {page} of {pages}</span>
      <Button variant="quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

/** Defective units that came on a spare PO and are not on a challan: pick → challan. */
function ToSendTab({ canWrite, onCreated }) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim(), 320);
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState({});
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    fetchDefectiveEligibleForVendorReturn({ search: search || undefined, limit: 300 })
      .then(({ data }) => setRows(data.data || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [search]);
  useEffect(() => { load(); setPicked({}); }, [load]);

  const chosen = (rows || []).filter((r) => picked[r.instance_id]);
  const vendors = [...new Set(chosen.map((r) => r.vendor_name || '—'))];
  const total = chosen.reduce((s, r) => s + (Number(r.unit_cost) || 0), 0);

  const openForm = () => {
    const first = chosen.find((r) => r.vendor_name) || chosen[0];
    setForm({
      vendor_name: first?.vendor_name || '',
      vendor_address: first?.vendor_address || '',
      contact_person: first?.vendor_contact_person || '',
      contact_mobile: first?.vendor_contact_mobile || '',
      expected_return_date: '',
      eway_bill_number: '',
      eway_bill_date: '',
      remarks: '',
      lines: Object.fromEntries(chosen.map((r) => [r.instance_id, r.notes || ''])),
    });
  };
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = async () => {
    setBusy(true);
    try {
      const { data } = await createPartVendorReturnDc({
        instance_ids: chosen.map((r) => r.instance_id),
        vendor_id: chosen[0]?.resolved_vendor_id || undefined,
        vendor_name: form.vendor_name.trim(),
        vendor_address: form.vendor_address.trim(),
        vendor_billing_address: form.vendor_address.trim(),
        shipping_address: form.vendor_address.trim(),
        contact_person: form.contact_person.trim() || undefined,
        contact_mobile: form.contact_mobile.trim() || undefined,
        expected_return_date: form.expected_return_date || undefined,
        eway_bill_number: form.eway_bill_number.trim() || undefined,
        eway_bill_date: form.eway_bill_date || undefined,
        remarks: form.remarks.trim(),
        item_remarks: form.lines,
      });
      toast.success(`Part repair challan ${data.dc_number} created (${data.item_count} part(s)) — sign and send it next`);
      setForm(null);
      onCreated(data.dc_number);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const cols = [
    ...(canWrite ? [{
      key: 'x',
      header: '',
      width: '2.5rem',
      render: (r) => <input type="checkbox" aria-label={`Pick ${r.prt_id}`} checked={Boolean(picked[r.instance_id])} onChange={() => setPicked((p) => ({ ...p, [r.instance_id]: !p[r.instance_id] }))} />,
    }] : []),
    { key: 'p', header: 'Part ID', render: (r) => <DocNumber value={r.prt_id} />, sub: (r) => r.serial_number || 'no serial' },
    { key: 'n', header: 'Part', render: (r) => r.part_name, sub: (r) => r.notes || null },
    { key: 'v', header: 'Vendor', render: (r) => r.vendor_name || '—', sub: (r) => r.purchase_order_number },
    { key: 'c', header: 'Cost', numeric: true, render: (r) => <Money value={r.unit_cost} showZero={false} /> },
    { key: 'd', header: 'Marked defective', render: (r) => <DateTime value={r.updated_at} /> },
  ];

  return (
    <div className="c-stack">
      <Notice tone="info">Defective spare units bought on a spare-parts PO and not already on a challan. Pick units of one vendor and raise one challan. Mark a unit defective from the Parts catalogue.</Notice>
      <Panel
        toolbar={(
          <div className="c-toolbar">
            <Input type="search" placeholder="Part ID, serial, part or vendor" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '20rem' }} />
            <span className="text-ink-3">{rows ? `${rows.length} waiting` : ''}</span>
            {canWrite && chosen.length > 0 && (
              <div className="c-toolbar-end">
                <Button variant="primary" disabled={vendors.length > 1} onClick={openForm}>
                  {vendors.length > 1 ? `${vendors.length} vendors picked — one per challan` : `Challan for ${chosen.length} part(s)`}
                </Button>
              </div>
            )}
          </div>
        )}
      >
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={rows} rowKey={(r) => r.instance_id} empty={<EmptyState title="Nothing waiting to go back to a vendor" />} />
        )}
      </Panel>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={`Part repair challan — ${chosen.length} part(s)`}
        width="44rem"
        footer={<Button variant="primary" disabled={busy || !form?.vendor_name?.trim() || !form?.vendor_address?.trim() || (form?.remarks || '').trim().length < 10} onClick={create}>Create draft challan</Button>}
      >
        {form && (
          <div className="c-stack">
            <p className="text-ink-3">Declared value ₹{total.toLocaleString('en-IN')} (unit costs). Back from the vendor, each line is received as repaired or replaced and waits for QC before it is stock again.</p>
            <Field label="Vendor" required><Input value={form.vendor_name} onChange={setF('vendor_name')} /></Field>
            <Field label="Vendor address" required><Textarea rows={2} value={form.vendor_address} onChange={setF('vendor_address')} /></Field>
            <FormGrid cols={2}>
              <Field label="Contact person"><Input value={form.contact_person} onChange={setF('contact_person')} /></Field>
              <Field label="Contact mobile"><Input value={form.contact_mobile} onChange={setF('contact_mobile')} /></Field>
              <Field label="Expected back by"><Input type="date" value={form.expected_return_date} onChange={setF('expected_return_date')} /></Field>
              <Field label="E-way bill number" hint="Needed when the value is over the e-way limit"><Input value={form.eway_bill_number} onChange={setF('eway_bill_number')} /></Field>
              <Field label="E-way bill date"><Input type="date" value={form.eway_bill_date} onChange={setF('eway_bill_date')} /></Field>
            </FormGrid>
            <Field label="Why they are going back" required hint="At least 10 characters"><Textarea rows={2} value={form.remarks} onChange={setF('remarks')} /></Field>
            {chosen.map((r) => (
              <Field key={r.instance_id} label={`${r.prt_id} — ${r.part_name}`} hint="Line note (optional)">
                <Input value={form.lines[r.instance_id] || ''} onChange={(e) => setForm((f) => ({ ...f, lines: { ...f.lines, [r.instance_id]: e.target.value } }))} />
              </Field>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function ChallansTab({ onOpen }) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim(), 320);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null);

  useEffect(() => { setPage(1); }, [search, status, from, to]);
  useEffect(() => {
    setRes(null);
    fetchPartVendorRepairDcList({
      search: search || undefined, status: status || undefined, page, limit: PAGE,
      date_from: from || undefined, date_to: to || undefined,
    })
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ data: [], pagination: {} }); toast.error(errMsg(e)); });
  }, [search, status, from, to, page]);

  const pdf = async (dc) => {
    setPdfBusy(dc);
    try { await downloadPartVendorRepairPdf(dc); } catch (e) { toast.error(errMsg(e, 'PDF download failed')); } finally { setPdfBusy(null); }
  };
  const cols = [
    { key: 'n', header: 'Challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.cancel_reason || null },
    { key: 'v', header: 'Vendor', render: (r) => r.vendor_name || '—', sub: (r) => r.contact_mobile || null },
    { key: 'i', header: 'Back / sent', numeric: true, render: (r) => `${r.received_count || 0} / ${r.item_count || 0}`, sub: (r) => (r.pending_count ? `${r.pending_count} still out` : null) },
    { key: 's', header: 'State', render: (r) => <RepairDcStatus status={r.status} /> },
    { key: 'd', header: 'Raised', render: (r) => <DateTime value={r.created_at} />, sub: (r) => (r.dispatched_at ? <>sent <DateTime value={r.dispatched_at} /></> : null) },
    { key: 'p', header: '', render: (r) => <Button variant="quiet" disabled={pdfBusy === r.dc_number} onClick={(e) => { e.stopPropagation(); pdf(r.dc_number); }}>PDF</Button> },
  ];
  const pages = res?.pagination?.totalPages || 1;
  return (
    <Panel
      toolbar={(
        <div className="c-toolbar">
          <Input type="search" placeholder="Challan, Part ID or vendor" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} />
          <select className={`c-select ${status ? 'is-set' : ''}`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="State">
            <option value="">State: All</option>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>State: {o.label}</option>)}
          </select>
          <Input type="date" aria-label="Raised from" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: '10rem' }} />
          <Input type="date" aria-label="Raised to" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: '10rem' }} />
          <span className="text-ink-3">{res ? `${res.pagination?.total ?? (res.data || []).length} challans` : ''}</span>
        </div>
      )}
    >
      {res === null ? <EmptyState title="Loading…" /> : (
        <div className="c-stack">
          <DataTable columns={cols} rows={res.data || []} rowKey={(r) => r.dc_number} onRowClick={(r) => onOpen(r.dc_number)} empty={<EmptyState title="No part repair challans" />} />
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      )}
    </Panel>
  );
}

/** Back from the vendor (repaired or a replacement): QC decides stock or discard. */
function QcTab({ canWrite, onOpen }) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim(), 320);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [decide, setDecide] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRes(null);
    fetchPartVendorQcPending({ search: search || undefined, page, limit: 50 })
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ data: [], pagination: {} }); toast.error(errMsg(e)); });
  }, [search, page]);
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      if (decide.pass) await passPartVendorQc(decide.row.instance_id, { notes: decide.notes.trim() || undefined });
      else await failPartVendorQc(decide.row.instance_id, { notes: decide.notes.trim() });
      toast.success(decide.pass ? `${decide.row.prt_id} passed — back in stock` : `${decide.row.prt_id} failed — discarded`);
      setDecide(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const cols = [
    { key: 'p', header: 'Part ID', render: (r) => <DocNumber value={r.prt_id} />, sub: (r) => r.serial_number || 'no serial' },
    { key: 'n', header: 'Part', render: (r) => r.part_name },
    {
      key: 'f',
      header: 'Came back on',
      render: (r) => (r.from_dc_number ? <button type="button" className="c-btn c-btn--quiet" onClick={() => onOpen(r.from_dc_number)}>{r.from_dc_number}</button> : '—'),
      sub: (r) => [r.vendor_name, r.receive_mode === 'replacement' ? 'replacement' : r.receive_mode === 'repaired' ? 'repaired' : null].filter(Boolean).join(' · ') || null,
    },
    { key: 'd', header: 'Received', render: (r) => <DateTime value={r.updated_at} /> },
    {
      key: 'x',
      header: '',
      render: (r) => (canWrite ? (
        <div className="flex" style={{ gap: '6px', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={() => setDecide({ row: r, pass: true, notes: '' })}>Pass</Button>
          <Button variant="quiet" onClick={() => setDecide({ row: r, pass: false, notes: '' })}>Fail</Button>
        </div>
      ) : null),
    },
  ];
  const pages = res?.pagination?.totalPages || 1;
  return (
    <div className="c-stack">
      <Notice tone="info">A repaired part or a replacement is checked before it counts as stock. Pass puts it on the shelf; fail discards it.</Notice>
      <Panel toolbar={<div className="c-toolbar"><Input type="search" placeholder="Part ID, serial or part" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} /><span className="text-ink-3">{res ? `${res.pagination?.total ?? 0} waiting` : ''}</span></div>}>
        {res === null ? <EmptyState title="Loading…" /> : (
          <div className="c-stack">
            <DataTable columns={cols} rows={res.data || []} rowKey={(r) => r.instance_id} empty={<EmptyState title="Nothing waiting for QC" />} />
            <Pager page={page} pages={pages} onPage={setPage} />
          </div>
        )}
      </Panel>
      <Drawer
        open={Boolean(decide)}
        onClose={() => setDecide(null)}
        title={decide ? `${decide.pass ? 'Pass' : 'Fail'} QC — ${decide.row.prt_id}` : ''}
        footer={<Button variant="primary" disabled={busy || (!decide?.pass && (decide?.notes || '').trim().length < 3)} onClick={submit}>{decide?.pass ? 'Pass — into stock' : 'Fail — discard'}</Button>}
      >
        {decide && (
          <div className="c-stack">
            <p>{decide.row.part_name}{decide.row.serial_number ? ` · ${decide.row.serial_number}` : ''}</p>
            {!decide.pass && <Notice tone="warn">A failed unit is discarded. It can then go on a scrap challan.</Notice>}
            <Field label="QC note" required={!decide.pass}><Textarea rows={3} value={decide.notes} onChange={(e) => setDecide({ ...decide, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

/**
 * Stock → Part repairs (old: /inventory-management/part-vendor-repair).
 *   To send       — defective spares on a PO, not on a challan: raise a challan.
 *   Challans      — every part repair challan; open one to sign, send, receive, cancel.
 *   Waiting for QC — units back from the vendor; pass (stock) or fail (discard).
 * The QC step existed in the API (receive puts units in qc_pending) but no
 * screen showed it, so received parts could never reach stock.
 */
export default function PartRepairsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = ['send', 'qc'].includes(params.get('tab')) ? params.get('tab') : 'challans';
  const { hasPermission, user } = usePermission();
  const canWrite = PART_REPAIR_WRITE_ROLES.includes(user?.role)
    || hasPermission('part_vendor_repair', 'edit') || hasPermission('part_vendor_repair', 'create');
  const open = useCallback((dc) => navigate(repairDcPath(dc)), [navigate]);
  const tabs = useMemo(() => [
    { key: 'challans', label: 'Challans' },
    { key: 'send', label: 'To send' },
    { key: 'qc', label: 'Waiting for QC' },
  ], []);

  return (
    <DeskShell title="Part repairs" breadcrumb="Stock" subtitle="Defective spare parts sent back to their vendor for repair or replacement, and checked when they return.">
      <div className="c-stack">
        <Tabs value={tab} onChange={(t) => setParams(t === 'challans' ? {} : { tab: t }, { replace: true })} tabs={tabs} />
        {tab === 'challans' && <ChallansTab onOpen={open} />}
        {tab === 'send' && <ToSendTab canWrite={canWrite} onCreated={open} />}
        {tab === 'qc' && <QcTab canWrite={canWrite} onOpen={open} />}
      </div>
    </DeskShell>
  );
}

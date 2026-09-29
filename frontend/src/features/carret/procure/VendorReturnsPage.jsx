import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, Input, Money, Notice, Section, Segmented, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { downloadReturnToVendorDcPdf, fetchVendors } from '../../vendor-management/vendorManagementApi';
import { downloadVendorRepairPdf } from '../../floor-pipeline/vendorRepairApi';
import { errMsg, vendorName } from './procureShared';
import { REPAIR_WAREHOUSE_ROLES, VRDC_STATUS_LABEL, vrdcChip } from './repairShared';

/**
 * Procure → Vendor returns — everything going back to a vendor, in one place
 * (merged 29 Sep 2026: the old Vendor Return DC, Vendor Repair DC, Vendor
 * Repair Receive and Vendor Return Ticket screens all live here now).
 *
 *   To send back     laptops that failed QC on the floor or were rejected at the
 *                    door, grouped by vendor → one return challan per vendor.
 *   Return challans  out through the gate → the vendor has it (D9).
 *   Return requests  rent-stop requests (old "Vendor Return Ticket"): mail the
 *                    vendor, then a challan.
 *   To repair        Floor → Diagnosis Failed → pick → repair challan (VRDC).
 *   Repair challans  out to a vendor for repair; mail (rent pause), sign, gate.
 *   Back from repair repair challans with laptops still to come back → receive.
 *   Debit notes      one drafted for every return (D12).
 *
 * Each tab shows only for the sections its API checks. ?tab= deep-links.
 */
const RETURN_SECTIONS = ['vendor_return_to_vendor', 'vendor_management'];
const REQUEST_SECTIONS = ['vendor_return_ticket', 'vendor_return_to_vendor', 'vendor_management'];
const REPAIR_SECTIONS = ['vendor_repair_dc', 'vendor_repair_dc_dispatch', 'floor_pipeline', 'vendor_management'];
const TO_REPAIR_SECTIONS = ['diagnosis_failed', 'floor_pipeline'];
const TABS = [
  { key: 'send', label: 'To send back', sections: RETURN_SECTIONS },
  { key: 'challans', label: 'Return challans', sections: RETURN_SECTIONS },
  { key: 'tickets', label: 'Return requests', sections: REQUEST_SECTIONS },
  { key: 'to_repair', label: 'To repair', sections: TO_REPAIR_SECTIONS },
  { key: 'repairs', label: 'Repair challans', sections: REPAIR_SECTIONS },
  { key: 'receive', label: 'Back from repair', sections: REPAIR_SECTIONS },
  { key: 'debit', label: 'Debit notes', sections: ['debit_notes'] },
];
const STATUS_FILTERS = {
  challans: [['draft', 'Draft'], ['dispatch_ready', 'At the gate'], ['dispatched', 'With the transporter'], ['completed', 'Vendor has it'], ['cancelled', 'Cancelled']],
  tickets: [['requested', 'Draft — not sent'], ['notified', 'Vendor told'], ['partially_picked', 'Part picked up'], ['picked', 'Picked up'], ['completed', 'Vendor has them'], ['cancelled', 'Cancelled']],
  repairs: Object.entries(VRDC_STATUS_LABEL),
};
const PAGE = 50;
const enc = encodeURIComponent;
const DC_LABEL = { draft: 'Draft', dispatch_ready: 'At the gate', dispatched: 'With the transporter', completed: 'Vendor has it', cancelled: 'Cancelled' };
const VRT_LABEL = { requested: 'Draft — not sent', notified: 'Vendor told — rent stops', partially_picked: 'Part picked up', picked: 'Picked up', completed: 'Vendor has them', cancelled: 'Cancelled' };
const prettyDate = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

const repairChip = (r) => <StatusChip status={vrdcChip(r.status)} label={VRDC_STATUS_LABEL[r.status] || r.status} />;

export default function VendorReturnsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, hasPermission } = usePermission();
  const any = (sections, action = 'view') => sections.some((s) => hasPermission(s, action));
  const canCreate = any(RETURN_SECTIONS, 'create');
  const canRequest = any(REQUEST_SECTIONS, 'create');
  const isWarehouse = REPAIR_WAREHOUSE_ROLES.has(user?.role);
  // Backend requireVendorRepairDispatch (cancel) / requireDiagnosisFailedProcess (create).
  const canRepairDispatch = isWarehouse || hasPermission('vendor_repair_dc_dispatch', 'create') || hasPermission('vendor_repair_dc_dispatch', 'edit');
  const canMakeRepair = isWarehouse || hasPermission('diagnosis_failed', 'create') || hasPermission('diagnosis_failed', 'edit');

  const tabs = useMemo(() => TABS.filter((t) => any(t.sections)), [hasPermission]); // eslint-disable-line react-hooks/exhaustive-deps
  const wantedTab = params.get('tab');
  const tab = tabs.some((t) => t.key === wantedTab) ? wantedTab : (tabs[0]?.key || 'send');
  const setTab = (k) => setParams(k ? { tab: k } : {}, { replace: true });

  const [scope, setScope] = useState('qc_failed');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState(null);
  const [pages, setPages] = useState(1);
  const [picked, setPicked] = useState({}); // serial_id -> row
  const [pickedRepair, setPickedRepair] = useState({}); // ticket_id -> row
  const [createOpen, setCreateOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [vendorId, setVendorId] = useState(''); // return challans: server filter vendor_id
  const [vendors, setVendors] = useState(null);
  const [range, setRange] = useState({ from: '', to: '' }); // repair challans: sent (or made) between
  const [pdfFor, setPdfFor] = useState('');

  useEffect(() => { setStatus(''); setSearch(''); setVendorId(''); setRange({ from: '', to: '' }); setPage(1); setPicked({}); setPickedRepair({}); }, [tab]);
  useEffect(() => { setPage(1); }, [status, search, scope, vendorId, range]);
  // The vendor list for the return-challan filter, fetched the first time it is needed.
  useEffect(() => {
    if (tab !== 'challans' || vendors) return;
    fetchVendors({ page: 1, limit: 200 }).then(({ data }) => setVendors(data.data || [])).catch(() => setVendors([]));
  }, [tab, vendors]);
  useEffect(() => { setPicked({}); }, [scope]);

  const load = useCallback(() => {
    setRows(null);
    const paged = { page, limit: PAGE };
    const get = {
      send: () => api.get('/vendor-management/return-to-vendor/eligible-laptops', { params: { inventory_status: scope, search: search || undefined, limit: 200 } }),
      challans: () => api.get('/vendor-management/return-to-vendor/dc', { params: { ...paged, status: status || undefined, vendor_id: vendorId || undefined } }),
      tickets: () => api.get('/vendor-management/return-ticket', { params: { ...paged, status: status || undefined } }),
      to_repair: () => api.get('/vendor-repair/diagnosis-failed', { params: { search: search || undefined } }),
      repairs: () => api.get('/vendor-repair/dc', {
        params: {
          ...paged, status: status || undefined, search: search || undefined, date_from: range.from || undefined, date_to: range.to || undefined,
        },
      }),
      // Laptops still with the vendor: both "out" statuses, newest first.
      receive: () => Promise.all(['dispatched', 'partially_returned'].map((st) => api.get('/vendor-repair/dc', { params: { status: st, search: search || undefined, limit: 100 } })))
        .then((res) => ({ data: { data: res.flatMap((r) => r.data.data || []).filter((r) => Number(r.pending_count) > 0).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) } })),
      debit: () => api.get('/vendor-billing/debit-notes'),
    }[tab];
    if (!get) { setRows([]); return; }
    get()
      .then(({ data }) => {
        setRows(data.data || data.debit_notes || []);
        setPages(data.pagination?.totalPages || 1);
      })
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load')); });
  }, [tab, scope, search, status, page, vendorId, range]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Lists without a server-side search are filtered here, on the loaded page.
  const shown = useMemo(() => {
    if (!rows) return rows;
    const q = search.trim().toLowerCase();
    if (!q || ['send', 'to_repair', 'repairs', 'receive'].includes(tab)) return rows;
    return rows.filter((r) => [r.dc_number, r.ticket_number, r.vendor_name, r.return_ticket_number, r.debit_note_number, r.description]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, search, tab]);

  const pickedRows = Object.values(picked);
  const pickedVendors = [...new Set(pickedRows.map((r) => r.vendor_id))];
  const pickedRepairRows = Object.values(pickedRepair);

  const toggle = (r) => setPicked((p) => {
    if (r.needs_return_request) return p; // D10: goes back through a return request
    const n = { ...p };
    if (n[r.serial_id]) delete n[r.serial_id]; else n[r.serial_id] = r;
    return n;
  });
  const toggleRepair = (r) => setPickedRepair((p) => {
    const n = { ...p };
    if (n[r.ticket_id]) delete n[r.ticket_id]; else n[r.ticket_id] = r;
    return n;
  });

  const createChallan = async () => {
    if (reason.trim().length < 3) { toast.error('Say why these laptops are going back'); return; }
    setBusy('create');
    try {
      const item_return_reasons = Object.fromEntries(pickedRows.map((r) => [r.serial_id, r.receipt_rejection_reason || r.qc_fail_reason || reason.trim()]));
      const { data } = await api.post('/vendor-management/return-to-vendor/dc', {
        serial_ids: pickedRows.map((r) => r.serial_id), vendor_id: pickedVendors[0], return_reason: reason.trim(), item_return_reasons,
      });
      toast.success(`${data.dc.dc_number} created`);
      navigate(`/carret/procure/returns/${enc(data.dc.dc_number)}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not create the challan'));
    } finally {
      setBusy('');
    }
  };

  const cancelRepair = async () => {
    setBusy('cancel');
    try {
      await api.post(`/vendor-repair/dc/${enc(cancelFor.dc_number)}/cancel`, { reason: cancelReason });
      toast.success(`${cancelFor.dc_number} cancelled — its laptops are back on the “To repair” list`);
      setCancelFor(null); setCancelReason('');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  // Row PDF buttons sit inside a clickable row: stop the click so the row
  // does not also open the record.
  const pdf = async (e, number, fn) => {
    e.stopPropagation();
    setPdfFor(number);
    try { await fn(number); } catch (err) { toast.error(err.message || 'PDF download failed'); } finally { setPdfFor(''); }
  };
  const pdfButton = (number, fn) => (
    <Button variant="quiet" disabled={pdfFor === number} onClick={(e) => pdf(e, number, fn)}>{pdfFor === number ? 'PDF…' : 'PDF'}</Button>
  );

  const columns = useMemo(() => {
    if (tab === 'send') {
      return [
        { key: 'x', header: '', width: '2.5rem', render: (r) => canCreate && <input type="checkbox" aria-label={`Pick ${r.ttspl_id}`} disabled={r.needs_return_request} title={r.needs_return_request ? 'Rented and in good condition — raise a return request' : undefined} checked={Boolean(picked[r.serial_id])} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} /> },
        { key: 't', header: 'Asset', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => r.serial_number },
        { key: 'l', header: 'Laptop', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—', sub: (r) => r.po_number },
        { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
        {
          key: 'why',
          header: 'Why it goes back',
          render: (r) => (r.rejected_at_receipt
            ? <span style={{ color: 'var(--alert-crit)' }}>Rejected at the door — {r.receipt_rejection_reason}</span>
            : r.qc_fail_reason ? <span>QC failed — {r.qc_fail_reason}</span>
              : r.needs_return_request ? <span className="text-ink-3">Rented, in good condition — goes back through a <a href="/carret/procure/return-requests/new" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate('/carret/procure/return-requests/new'); }}>return request</a></span>
                : <StatusChip status={r.inventory_status} />),
        },
        { key: 'rent', header: 'Rent / month', numeric: true, render: (r) => <Money value={r.rent_monthly_rate} showZero={false} /> },
      ];
    }
    if (tab === 'challans') {
      return [
        { key: 'n', header: 'Return challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.return_ticket_number || null },
        { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
        { key: 'c', header: 'Laptops', numeric: true, render: (r) => r.item_count },
        { key: 's', header: 'Status', render: (r) => <StatusChip status={r.status === 'completed' ? 'completed' : r.status === 'dispatch_ready' ? 'pending' : r.status} label={DC_LABEL[r.status] || r.status} /> },
        { key: 'd', header: 'Created', render: (r) => <DateTime value={r.created_at} />, sub: (r) => (r.dispatched_at ? <>out <DateTime value={r.dispatched_at} /></> : null) },
        { key: 'a', header: '', render: (r) => pdfButton(r.dc_number, downloadReturnToVendorDcPdf) },
      ];
    }
    if (tab === 'tickets') {
      return [
        { key: 'n', header: 'Return request', render: (r) => <DocNumber value={r.ticket_number} /> },
        { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
        { key: 'c', header: 'Laptops', numeric: true, render: (r) => r.item_count },
        { key: 's', header: 'Status', render: (r) => <StatusChip status={r.status === 'completed' ? 'completed' : r.status === 'cancelled' ? 'cancelled' : r.status === 'requested' ? 'draft' : 'pending'} label={VRT_LABEL[r.status] || r.status} />, sub: (r) => (r.notify_error ? `Email failed: ${r.notify_error}` : null) },
        { key: 'r', header: 'Rent stops from', render: (r) => prettyDate(r.rent_stop_date || (r.vendor_notified_at ? String(r.vendor_notified_at).slice(0, 10) : null)) },
        { key: 'd', header: 'Vendor told', render: (r) => (r.vendor_notified_at ? <DateTime value={r.vendor_notified_at} /> : '—') },
      ];
    }
    if (tab === 'to_repair') {
      return [
        { key: 'x', header: '', width: '2.5rem', render: (r) => canMakeRepair && <input type="checkbox" aria-label={`Pick ${r.ttspl_id}`} checked={Boolean(pickedRepair[r.ticket_id])} onChange={() => toggleRepair(r)} onClick={(e) => e.stopPropagation()} /> },
        { key: 't', header: 'Asset', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => r.serial_number },
        { key: 'c', header: 'Laptop', render: (r) => r.configuration || '—', sub: (r) => (r.is_vendor_rented ? `rented from ${r.rent_vendor_name || 'a vendor'}` : null) },
        { key: 'w', header: 'Why it failed', render: (r) => r.diagnosis_failed_reason || '—', sub: (r) => [r.previous_stage_name, r.previous_technician_name].filter(Boolean).join(' · ') || null },
        { key: 'l', header: 'Where', render: (r) => r.current_location || '—' },
        { key: 'd', header: 'Failed', render: (r) => <DateTime value={r.diagnosis_failed_at || r.created_at} /> },
        { key: 'o', header: '', render: (r) => <Button variant="quiet" onClick={(e) => { e.stopPropagation(); navigate(`/carret/produce/tickets/${r.ticket_id}`); }}>Ticket #{r.ticket_id}</Button> },
      ];
    }
    if (tab === 'repairs' || tab === 'receive') {
      return [
        { key: 'n', header: 'Repair challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.contact_person || null },
        { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
        { key: 'c', header: 'Back / sent', numeric: true, render: (r) => `${r.received_count ?? 0} / ${r.item_count ?? 0}`, sub: (r) => (Number(r.pending_count) > 0 && r.status !== 'draft' ? `${r.pending_count} to come back` : null) },
        { key: 's', header: 'Status', render: repairChip, sub: (r) => r.cancel_reason || (r.vendor_delivered_at ? 'delivered to vendor' : null) },
        { key: 'o', header: 'Out', render: (r) => (r.out_date || r.dispatched_at ? <DateTime value={r.out_date || r.dispatched_at} /> : '—') },
        { key: 'e', header: 'Expected back', render: (r) => (r.expected_return_date ? prettyDate(r.expected_return_date) : '—') },
        {
          key: 'a',
          header: '',
          render: (r) => (tab === 'repairs' && (
            <div className="flex justify-end" style={{ gap: '6px' }}>
              {pdfButton(r.dc_number, downloadVendorRepairPdf)}
              {canRepairDispatch && ['draft', 'dispatch_ready'].includes(r.status) && (
                <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setCancelFor(r); }}>Cancel</Button>
              )}
            </div>
          )),
        },
      ];
    }
    return [
      { key: 'n', header: 'Debit note', render: (r) => <DocNumber value={r.debit_note_number} />, sub: (r) => ({ floor_qc_fail: 'Floor QC fail', return_challan: 'Return challan', replacement: 'Replacement' }[r.source] || r.reason) },
      { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
      { key: 'd', header: 'What', render: (r) => r.description },
      { key: 'a', header: 'Amount', numeric: true, render: (r) => (Number(r.amount) ? <Money value={r.amount} /> : <span style={{ color: 'var(--alert-warn)' }}>to set</span>) },
      { key: 's', header: 'Status', render: (r) => <StatusChip status={r.status === 'pending' ? 'draft' : r.status} label={r.status === 'pending' ? 'Draft — for accounts' : r.status} /> },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, picked, pickedRepair, canCreate, canRepairDispatch, canMakeRepair, pdfFor]);

  const onRow = {
    send: canCreate ? toggle : undefined,
    to_repair: canMakeRepair ? toggleRepair : undefined,
    challans: (r) => navigate(`/carret/procure/returns/${enc(r.dc_number)}`),
    tickets: (r) => navigate(`/carret/procure/return-requests/${enc(r.ticket_number)}`),
    repairs: (r) => navigate(`/carret/procure/repairs/${enc(r.dc_number)}`),
    receive: (r) => navigate(`/carret/procure/repairs/${enc(r.dc_number)}`),
    debit: (r) => navigate(r.debit_note_id ? `/carret/money/debit-notes/${r.debit_note_id}` : '/carret/money/debit-notes'),
  }[tab];

  const statusOptions = STATUS_FILTERS[tab];
  const filters = [
    ...(tab !== 'send' ? [{ key: 'search', type: 'search', label: 'Search', placeholder: { to_repair: 'TTSPL, serial, reason, location', repairs: 'Challan, vendor, contact', receive: 'Challan, vendor, contact' }[tab] || 'Number or vendor (this page)' }] : []),
    ...(tab === 'challans' ? [{ key: 'vendor', label: 'Vendor', options: (vendors || []).map((v) => ({ value: String(v.vendor_id), label: vendorName(v) })) }] : []),
    ...(statusOptions ? [{ key: 'status', label: 'Status', options: statusOptions.map(([value, label]) => ({ value, label })) }] : []),
  ];
  const setFilter = (k, v) => {
    if (k === 'search') setSearch(v);
    else if (k === 'vendor') setVendorId(v);
    else setStatus(v);
  };
  const dateRange = tab === 'repairs' && (
    <div className="flex flex-wrap items-center" style={{ gap: '6px' }}>
      <span className="text-ink-3">Sent</span>
      <Input type="date" aria-label="Sent from" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={{ width: '10rem' }} />
      <span className="text-ink-3">to</span>
      <Input type="date" aria-label="Sent to" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={{ width: '10rem' }} />
      {(range.from || range.to) && <Button variant="quiet" onClick={() => setRange({ from: '', to: '' })}>Any date</Button>}
    </div>
  );

  if (!tabs.length) {
    return <DeskShell title="Vendor returns" breadcrumb="Procurement"><EmptyState title="Nothing here for your access" /></DeskShell>;
  }

  return (
    <DeskShell title="Vendor returns" breadcrumb="Procurement" subtitle="Laptops going back to vendors — for good, for repair, or when rent stops.">
      <div className="c-stack">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />

        {tab === 'send' && (
          <Notice tone="info">
            Laptops that failed QC on the floor and ones rejected at the door come here automatically. Pick one vendor’s laptops and make a return challan; the guard scans it out, and each laptop gets a draft debit note.
          </Notice>
        )}
        {tab === 'tickets' && (
          <Notice tone="info" action={canRequest && <Button variant="primary" onClick={() => navigate('/carret/procure/return-requests/new')}>New return request</Button>}>
            Returning a rented laptop: pick the vendor and laptops, the date rent stops and the pickup slot. The vendor gets a mail with a PDF; when they confirm, make the return challan.
          </Notice>
        )}
        {tab === 'to_repair' && <Notice tone="info">Laptops the floor could not fix (Diagnosis Failed). Pick the ones going to the same repair vendor and make a repair challan: issue and remarks per laptop, value from the PO, rent stop date for laptops rented from that vendor.</Notice>}
        {tab === 'repairs' && <Notice tone="info">Open a challan to mail the vendor (rent stops from the chosen date), sign it and send it to the gate. One that has not gone out can be cancelled. Repaired laptops go back to the floor, not straight to stock.</Notice>}
        {tab === 'receive' && <Notice tone="info">Repair challans with laptops still at the vendor. When one comes back the guard scans it in; open the challan to run the check and receive it — repaired, or a replacement.</Notice>}

        <Section
          title={tabs.find((t) => t.key === tab)?.label}
          actions={tab === 'send' && (
            <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
              <Segmented options={[{ value: 'qc_failed', label: 'Failed / rejected' }, { value: 'all', label: 'Everything in the warehouse' }]} value={scope} onChange={setScope} label="Which laptops" />
              <Input type="search" placeholder="TTSPL, serial, vendor" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '14rem' }} aria-label="Search" />
            </div>
          )}
        >
          {filters.length > 0 && (
            <FilterBar
              filters={filters}
              values={{ search, status, vendor: vendorId }}
              onChange={setFilter}
              onClear={() => { setSearch(''); setStatus(''); setVendorId(''); setRange({ from: '', to: '' }); }}
              right={dateRange || undefined}
              count={shown ? `${shown.length} shown` : undefined}
            />
          )}
          {shown === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(r, i) => r.serial_id || r.dc_number || r.ticket_number || r.ticket_id || r.debit_note_id || i}
              onRowClick={onRow}
              empty={<EmptyState title={tab === 'send' ? (scope === 'qc_failed' ? 'Nothing waiting to go back' : 'No laptops found') : tab === 'to_repair' ? 'Nothing waiting for a repair vendor' : tab === 'receive' ? 'Nothing out for repair' : 'None yet'} />}
            />
          )}
          {['challans', 'tickets', 'repairs'].includes(tab) && pages > 1 && (
            <div className="flex items-center justify-end" style={{ gap: '8px', marginTop: '8px' }}>
              <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
              <span className="text-ink-3">Page {page} of {pages}</span>
              <Button variant="quiet" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older</Button>
            </div>
          )}
        </Section>
      </div>

      {tab === 'send' && pickedRows.length > 0 && (
        <div className="c-card" style={{ position: 'sticky', bottom: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <strong>{pickedRows.length} picked</strong>
          {pickedVendors.length > 1
            ? <span style={{ color: 'var(--alert-warn)' }}>⚠ These are from {pickedVendors.length} vendors — one challan per vendor.</span>
            : <span className="text-ink-3">{pickedRows[0].vendor_name}</span>}
          <span style={{ marginLeft: 'auto' }} />
          <Button variant="quiet" onClick={() => setPicked({})}>Clear</Button>
          <Button variant="primary" disabled={pickedVendors.length !== 1} onClick={() => setCreateOpen(true)}>Make return challan</Button>
        </div>
      )}

      {tab === 'to_repair' && pickedRepairRows.length > 0 && (
        <div className="c-card" style={{ position: 'sticky', bottom: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <strong>{pickedRepairRows.length} picked</strong>
          <span className="text-ink-3">One challan goes to one repair vendor.</span>
          <span style={{ marginLeft: 'auto' }} />
          <Button variant="quiet" onClick={() => setPickedRepair({})}>Clear</Button>
          <Button variant="primary" onClick={() => navigate(`/carret/procure/repairs/new?tickets=${pickedRepairRows.map((r) => r.ticket_id).join(',')}`)}>Make repair challan</Button>
        </div>
      )}

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Return ${pickedRows.length} laptop(s) to ${pickedRows[0]?.vendor_name || 'vendor'}`}
        footer={<Button variant="primary" disabled={busy === 'create'} onClick={createChallan}>{busy === 'create' ? 'Creating…' : 'Create challan'}</Button>}
      >
        <div className="c-stack">
          <Field label="Why they go back" required hint="Printed on the challan. Each laptop keeps its own QC or rejection reason."><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
            {pickedRows.map((r) => <li key={r.serial_id}><span className="font-mono">{r.ttspl_id}</span> — {[r.brand, r.model].filter(Boolean).join(' ')}</li>)}
          </ul>
          <p className="text-ink-3">The challan opens next, to enter values and send it to the gate.</p>
        </div>
      </Drawer>

      <Drawer
        open={Boolean(cancelFor)}
        onClose={() => setCancelFor(null)}
        title={`Cancel ${cancelFor?.dc_number || ''}`}
        footer={<Button variant="primary" disabled={busy === 'cancel' || cancelReason.trim().length < 3} onClick={cancelRepair}>Cancel challan</Button>}
      >
        <p style={{ marginBottom: '12px' }}>It has not left the building. Its laptops go back to the “To repair” list; if the vendor was mailed they get a cancellation mail and rent continues.</p>
        <Field label="Reason" required><Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
      </Drawer>
    </DeskShell>
  );
}

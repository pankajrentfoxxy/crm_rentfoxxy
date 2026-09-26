import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, Money, Notice, Section, Segmented, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { errMsg } from './procureShared';

/**
 * Procure → Vendor returns — everything going back to a vendor, in one place.
 *
 *   To send back   laptops that failed QC on the floor or were rejected at the
 *                  door (and any other warehouse laptop that must go back),
 *                  grouped by vendor → one return challan per vendor.
 *   Return challans  out through the gate → the vendor has it (D9).
 *   Rental returns   rent-stop tickets (notify the vendor, then a challan).
 *   Repairs          laptops out with a vendor for repair; a challan that has
 *                    not gone out can be cancelled (B23).
 *   Debit notes      one drafted for every return (D12) — accounts sets the
 *                    amount and approves.
 */
const TABS = [
  { key: 'send', label: 'To send back' },
  { key: 'challans', label: 'Return challans' },
  { key: 'tickets', label: 'Rental returns' },
  { key: 'repairs', label: 'Repairs' },
  { key: 'debit', label: 'Debit notes' },
];
const enc = encodeURIComponent;
const DC_LABEL = { draft: 'Draft', dispatch_ready: 'At the gate', dispatched: 'With the transporter', completed: 'Vendor has it', cancelled: 'Cancelled' };
const VRDC_LABEL = { draft: 'Draft', dispatch_ready: 'At the gate', dispatched: 'With vendor', partially_returned: 'Part back', returned: 'Back', cancelled: 'Cancelled' };
const VRT_LABEL = { draft: 'Draft', notified: 'Vendor told — rent stopped', picked: 'On a challan', completed: 'Done', cancelled: 'Cancelled' };

export default function VendorReturnsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = ['vendor_return_to_vendor', 'vendor_management'].some((s) => hasPermission(s, 'edit'));
  const canCreate = ['vendor_return_to_vendor', 'vendor_management'].some((s) => hasPermission(s, 'create'));
  const canRepair = ['vendor_repair_dc_dispatch', 'vendor_repair_dc'].some((s) => hasPermission(s, 'edit') || hasPermission(s, 'create'));

  const [tab, setTab] = useState('send');
  const [scope, setScope] = useState('qc_failed');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState({}); // serial_id -> row
  const [createOpen, setCreateOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(() => {
    setRows(null);
    const get = {
      send: () => api.get('/vendor-management/return-to-vendor/eligible-laptops', { params: { inventory_status: scope, search: search || undefined, limit: 200 } }),
      challans: () => api.get('/vendor-management/return-to-vendor/dc', { params: { limit: 100 } }),
      tickets: () => api.get('/vendor-management/return-ticket', { params: { limit: 100 } }),
      repairs: () => api.get('/vendor-repair/dc', { params: { limit: 100 } }),
      debit: () => api.get('/vendor-billing/debit-notes'),
    }[tab];
    get()
      .then(({ data }) => setRows(data.data || data.debit_notes || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load')); });
  }, [tab, scope, search]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useEffect(() => { setPicked({}); }, [tab, scope]);

  const pickedRows = Object.values(picked);
  const pickedVendors = [...new Set(pickedRows.map((r) => r.vendor_id))];

  const toggle = (r) => setPicked((p) => {
    const n = { ...p };
    if (n[r.serial_id]) delete n[r.serial_id]; else n[r.serial_id] = r;
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
      await api.post(`/vendor-repair/dc/${cancelFor.dc_number}/cancel`, { reason: cancelReason });
      toast.success(`${cancelFor.dc_number} cancelled — its laptops are back on the Diagnosis Failed list`);
      setCancelFor(null); setCancelReason('');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  const columns = useMemo(() => {
    if (tab === 'send') {
      return [
        { key: 'x', header: '', width: '2.5rem', render: (r) => canCreate && <input type="checkbox" aria-label={`Pick ${r.ttspl_id}`} checked={Boolean(picked[r.serial_id])} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} /> },
        { key: 't', header: 'Asset', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => r.serial_number },
        { key: 'l', header: 'Laptop', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—', sub: (r) => r.po_number },
        { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
        {
          key: 'why',
          header: 'Why it goes back',
          render: (r) => (r.rejected_at_receipt
            ? <span style={{ color: 'var(--alert-crit)' }}>Rejected at the door — {r.receipt_rejection_reason}</span>
            : r.qc_fail_reason ? <span>QC failed — {r.qc_fail_reason}</span> : <StatusChip status={r.inventory_status} />),
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
      ];
    }
    if (tab === 'tickets') {
      return [
        { key: 'n', header: 'Return ticket', render: (r) => <DocNumber value={r.ticket_number} /> },
        { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
        { key: 'c', header: 'Laptops', numeric: true, render: (r) => r.item_count },
        { key: 's', header: 'Status', render: (r) => <StatusChip status={r.status === 'completed' ? 'completed' : r.status === 'cancelled' ? 'cancelled' : 'pending'} label={VRT_LABEL[r.status] || r.status} />, sub: (r) => (r.notify_error ? `Email failed: ${r.notify_error}` : null) },
        { key: 'd', header: 'Vendor told', render: (r) => (r.vendor_notified_at ? <DateTime value={r.vendor_notified_at} /> : '—') },
      ];
    }
    if (tab === 'repairs') {
      return [
        { key: 'n', header: 'Repair challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => (r.item_domain === 'part' ? 'Parts' : 'Laptops') },
        { key: 'v', header: 'Vendor', render: (r) => r.vendor_name },
        { key: 'c', header: 'Back / sent', numeric: true, render: (r) => `${r.received_count ?? r.items_received_count ?? 0} / ${r.item_count ?? r.items_dispatched_count ?? 0}` },
        { key: 's', header: 'Status', render: (r) => <StatusChip status={['returned'].includes(r.status) ? 'completed' : r.status === 'cancelled' ? 'cancelled' : 'processing'} label={VRDC_LABEL[r.status] || r.status} />, sub: (r) => r.cancel_reason || null },
        { key: 'e', header: 'Expected back', render: (r) => (r.expected_return_date ? <DateTime value={r.expected_return_date} /> : '—') },
        {
          key: 'a',
          header: '',
          render: (r) => canRepair && ['draft', 'dispatch_ready'].includes(r.status) && (
            <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setCancelFor(r); }}>Cancel</Button>
          ),
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
  }, [tab, picked, canCreate, canRepair]);

  const onRow = {
    challans: (r) => navigate(`/carret/procure/returns/${enc(r.dc_number)}`),
    tickets: (r) => navigate(`/vendor-management/return-ticket/${enc(r.ticket_number)}`),
    repairs: (r) => navigate(r.item_domain === 'part' ? '/inventory-management/part-vendor-repair' : `/vendor-management/vendor-repair-dc/${enc(r.dc_number)}`),
    debit: () => navigate('/vendor-billing/debit-notes'),
  }[tab];

  return (
    <DeskShell title="Vendor returns" breadcrumb="Procure" subtitle="Laptops going back to vendors — for good, for repair, or when rent stops.">
      <div className="c-stack">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />

        {tab === 'send' && (
          <Notice tone="info">
            Laptops that failed QC on the floor and ones rejected at the door come here automatically. Pick one vendor’s laptops and make a return challan; the guard scans it out, and each laptop gets a draft debit note.
          </Notice>
        )}
        {tab === 'tickets' && <Notice tone="info">A rental return tells the vendor to stop the rent, then the laptops go on a challan. Open a ticket to notify the vendor or make its challan (opens the existing screen).</Notice>}
        {tab === 'repairs' && <Notice tone="info">Repairs are raised from the Diagnosis Failed list on the floor. A challan that has not gone out can be cancelled here; open one to sign, dispatch or receive it back (existing screen). Repaired laptops come back to the Floor Manager, not straight to stock.</Notice>}

        <Section
          title={TABS.find((t) => t.key === tab).label}
          actions={tab === 'send' && (
            <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
              <Segmented options={[{ value: 'qc_failed', label: 'Failed / rejected' }, { value: 'all', label: 'Everything in the warehouse' }]} value={scope} onChange={setScope} label="Which laptops" />
              <Input type="search" placeholder="TTSPL, serial, vendor" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '14rem' }} aria-label="Search" />
            </div>
          )}
        >
          {rows === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r, i) => r.serial_id || r.dc_number || r.ticket_number || r.debit_note_id || i}
              onRowClick={tab === 'send' ? (canCreate ? toggle : undefined) : onRow}
              empty={<EmptyState title={tab === 'send' ? (scope === 'qc_failed' ? 'Nothing waiting to go back' : 'No laptops found') : 'None yet'} />}
            />
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
        <p style={{ marginBottom: '12px' }}>It has not left the building. Its laptops go back to the Diagnosis Failed list.</p>
        <Field label="Reason" required><Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
      </Drawer>
    </DeskShell>
  );
}

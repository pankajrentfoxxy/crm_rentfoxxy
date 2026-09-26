import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, Notice, Section, Select, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { errMsg } from './procureShared';

/**
 * Procure → Vendor arrivals (D4).
 *
 * The guard logs every vendor delivery here BEFORE anything is received:
 * which PO, the vendor's challan (and invoice if it came with the laptops),
 * how many laptops came in. The warehouse then opens the delivery and
 * receives against it — its own GRN, capped at the guard's count — so
 * "arrived" and "received" can't drift apart.
 */
const base = '/vendor-management/deliveries';
const TABS = [
  { key: 'open', label: 'To receive', statuses: 'arrived,receiving' },
  { key: 'received', label: 'Received', statuses: 'received' },
  { key: 'cancelled', label: 'Turned away', statuses: 'cancelled' },
];
const blank = { po_id: '', laptop_count: '', vendor_challan_no: '', vendor_invoice_no: '', carrier_name: '', vehicle_no: '', notes: '' };

export default function VendorArrivalsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hasPermission } = usePermission();
  const canLog = ['guard_gate_checking', 'vendor_management'].some((s) => hasPermission(s, 'create'));
  const canReceive = hasPermission('vendor_management', 'edit');

  const [tab, setTab] = useState('open');
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [expected, setExpected] = useState(null);
  const [logOpen, setLogOpen] = useState(Boolean(params.get('po')) && canLog);
  const [form, setForm] = useState({ ...blank, po_id: params.get('po') || '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    api.get(base, { params: { status: TABS.find((t) => t.key === tab).statuses } })
      .then(({ data }) => { setRows(data.data || []); setCounts(data.counts || {}); })
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load deliveries')); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!logOpen || expected) return;
    api.get(`${base}/expected`).then(({ data }) => setExpected(data.data || [])).catch(() => setExpected([]));
  }, [logOpen, expected]);

  const poOptions = useMemo(() => (expected || []).map((p) => ({
    value: String(p.po_id),
    label: `${p.purchase_order_number} · ${p.vendor_name || 'vendor?'} · ${p.remaining} still to come`,
  })), [expected]);
  const picked = (expected || []).find((p) => String(p.po_id) === String(form.po_id));

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); };

  const save = async () => {
    const e = {};
    if (!form.po_id) e.po_id = 'Pick the purchase order on the vendor’s challan';
    if (!(Number(form.laptop_count) > 0)) e.laptop_count = 'Count the laptops';
    if (!form.vendor_challan_no.trim()) e.vendor_challan_no = 'Enter the challan / delivery note number';
    if (picked && Number(form.laptop_count) > picked.remaining) e.laptop_count = `Only ${picked.remaining} are still due on this PO — check with procurement before letting extra laptops in`;
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const { data } = await api.post(base, { ...form, po_id: Number(form.po_id), laptop_count: Number(form.laptop_count) });
      toast.success(data.message || 'Delivery logged');
      setLogOpen(false);
      setForm(blank);
      setExpected(null);
      setTab('open');
      load();
    } catch (err) {
      toast.error(errMsg(err, 'Could not log the delivery'));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'no', header: 'Delivery', render: (d) => <DocNumber value={d.delivery_number} />, sub: (d) => <DateTime value={d.arrived_at} /> },
    { key: 'po', header: 'PO', render: (d) => <DocNumber value={d.purchase_order_number} />, sub: (d) => d.vendor_name },
    { key: 'challan', header: 'Vendor challan', render: (d) => d.vendor_challan_no || '—', sub: (d) => (d.vendor_invoice_no ? `Invoice ${d.vendor_invoice_no}` : 'Invoice not given') },
    {
      key: 'count',
      header: 'Received / logged',
      numeric: true,
      render: (d) => {
        const done = d.received_count + d.rejected_count;
        return <span className="font-mono" style={{ color: done >= d.laptop_count ? 'var(--alert-good)' : done ? 'var(--alert-warn)' : 'var(--ink-3)' }}>{done} / {d.laptop_count}</span>;
      },
      sub: (d) => [d.rejected_count ? `${d.rejected_count} rejected` : null, d.waiver_pending_count ? `${d.waiver_pending_count} waiver to approve` : null].filter(Boolean).join(' · ') || null,
    },
    { key: 'status', header: 'Status', render: (d) => <StatusChip status={d.status === 'arrived' ? 'pending' : d.status === 'receiving' ? 'processing' : d.status} label={{ arrived: 'At the gate', receiving: 'Receiving', received: 'Received', cancelled: 'Turned away' }[d.status]} /> },
    { key: 'by', header: 'Logged by', render: (d) => d.logged_by_name || '—' },
  ];

  return (
    <DeskShell
      title="Vendor arrivals"
      breadcrumb="Procure"
      subtitle="Every vendor delivery is logged at the gate, then received by the warehouse."
      actions={canLog && <Button variant="primary" onClick={() => setLogOpen(true)}>Log a delivery</Button>}
    >
      <div className="c-stack">
        <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: t.statuses.split(',').reduce((n, s) => n + (counts[s] || 0), 0) }))} value={tab} onChange={setTab} />
        <Section title={TABS.find((t) => t.key === tab).label}>
          {rows === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(d) => d.delivery_id}
              onRowClick={canReceive ? (d) => navigate(`/carret/procure/arrivals/${d.delivery_id}`) : undefined}
              empty={<EmptyState title={tab === 'open' ? 'Nothing waiting at the gate' : 'None yet'} />}
            />
          )}
        </Section>
      </div>

      <Drawer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log a vendor delivery"
        width="36rem"
        footer={<Button variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Log delivery'}</Button>}
      >
        <div className="c-stack">
          <Notice tone="info">Log it before the laptops go to the warehouse. The PO number is on the vendor’s challan.</Notice>
          <Field label="Purchase order" required error={errors.po_id} hint={picked ? `${picked.vendor_name} · ${picked.remaining} of ${picked.ordered} still to come${picked.expected_delivery_date ? ' · due ' + String(picked.expected_delivery_date).slice(0, 10) : ''}` : 'Only POs with laptops still due are listed'}>
            {expected === null ? <span className="text-ink-3">Loading…</span> : <Select value={form.po_id} onChange={set('po_id')} placeholder="Pick the PO" options={poOptions} />}
          </Field>
          <FormGrid cols={2}>
            <Field label="Laptops that arrived" required error={errors.laptop_count}><Input type="number" min={1} inputMode="numeric" value={form.laptop_count} onChange={set('laptop_count')} /></Field>
            <Field label="Vendor challan no." required error={errors.vendor_challan_no}><Input value={form.vendor_challan_no} onChange={set('vendor_challan_no')} /></Field>
            <Field label="Vendor invoice no." hint="If the invoice came with the laptops"><Input value={form.vendor_invoice_no} onChange={set('vendor_invoice_no')} /></Field>
            <Field label="Vehicle no."><Input value={form.vehicle_no} onChange={set('vehicle_no')} /></Field>
            <Field label="Brought by" span={2}><Input value={form.carrier_name} onChange={set('carrier_name')} placeholder="Courier or person’s name" /></Field>
          </FormGrid>
          <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Damaged boxes, missing seal…" /></Field>
        </div>
      </Drawer>
    </DeskShell>
  );
}

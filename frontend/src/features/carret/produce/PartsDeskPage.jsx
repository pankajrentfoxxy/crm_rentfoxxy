import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, Notice, Section, Select, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { errMsg } from './produceShared';

/**
 * Production → Parts desk (warehouse).
 *
 * Part requests from the floor: give each one a real unit from the shelf
 * (scan its label, or let the system pick one that fits the laptop), or send
 * it back / on to procurement. A unit reserved for one job can't be given to
 * another, and nothing is invented when the shelf is empty (safety B).
 * "Old parts to collect" is what technicians took off laptops — the warehouse
 * confirms it has each one (PD8).
 */
const PR = '/part-requests';

export default function PartsDeskPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('parts_approval', 'edit');
  const canCollect = ['parts_inventory', 'parts_approval'].some((s) => hasPermission(s, 'edit'));

  const [tab, setTab] = useState('requests');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [act, setAct] = useState(null); // { kind, row }
  const [form, setForm] = useState({});
  const [units, setUnits] = useState([]);

  const load = useCallback(() => {
    setRows(null);
    const url = tab === 'requests' ? `${PR}/warehouse-queue` : `${PR}/old-parts/to-collect`;
    api.get(url)
      .then(({ data }) => setRows(tab === 'requests' ? (data.requests || []).filter((r) => ['pending', 'received', 'approved'].includes(r.status)) : (data.data || [])))
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load')); });
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const open = async (kind, row) => {
    setAct({ kind, row });
    setForm(kind === 'approve' ? { how: 'auto', old: row.request_type === 'upgrade' ? 'yes' : '' } : {});
    if (kind === 'approve') {
      api.get(`${PR}/instances`, { params: { part_id: row.part_id, status: 'in_stock', limit: 50 } })
        .then(({ data }) => setUnits(data.instances || data.data || []))
        .catch(() => setUnits([]));
    }
  };
  const run = async (fn, ok) => {
    setBusy('x');
    try { await fn(); toast.success(ok); setAct(null); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const submit = () => {
    const { kind, row } = act;
    if (kind === 'approve') {
      const body = form.how === 'scan' ? { prt_id: form.prt } : form.how === 'pick' ? { instance_id: Number(form.unit) } : { auto_select: true };
      if (form.old === 'yes') Object.assign(body, { old_part_expected: 'yes', old_part_name: form.oldName, old_part_category: row.category });
      else if (form.old) body.old_part_expected = form.old;
      return run(() => api.patch(`${PR}/${row.request_id}/approve`, body), `${row.request_number}: unit reserved for the technician`);
    }
    if (kind === 'reject') return run(() => api.patch(`${PR}/${row.request_id}/reject`, { reason: form.reason }), 'Sent back');
    if (kind === 'escalate') return run(() => api.patch(`${PR}/${row.request_id}/escalate`, { notes: form.reason }), 'On the To-buy list for procurement');
    return run(() => api.post(`${PR}/old-parts/${row.instance_id}/collect`, { condition: form.condition, location_code: form.loc }), 'Collected');
  };

  const reqCols = [
    { key: 'n', header: 'Request', render: (r) => <DocNumber value={r.request_number} />, sub: (r) => r.requester_name },
    { key: 'p', header: 'Part', render: (r) => `${r.quantity || 1}× ${r.part_name}`, sub: (r) => (r.request_type === 'upgrade' ? `Upgrade ${r.config_field || ''}: ${r.old_value || '?'} → ${r.new_value || '?'}` : r.category) },
    { key: 'l', header: 'For laptop', render: (r) => (r.ttspl_id ? <DocNumber value={r.ttspl_id} /> : '—'), sub: (r) => [r.brand, r.model].filter(Boolean).join(' ') || r.stage_name },
    { key: 's', header: 'On shelf', numeric: true, render: (r) => r.stock_qty ?? '—' },
    { key: 'st', header: 'Status', render: (r) => <StatusChip status={r.status === 'approved' ? 'approved' : 'pending'} label={r.status === 'approved' ? `Reserved ${r.prt_id || ''}` : r.status === 'received' ? 'Arrived — give a unit' : 'Waiting'} /> },
    { key: 'w', header: 'Asked', render: (r) => <DateTime value={r.created_at} /> },
    {
      key: 'a',
      header: '',
      render: (r) => canEdit && r.status !== 'approved' && (
        <div className="flex flex-wrap justify-end" style={{ gap: '6px' }} onClick={(e) => e.stopPropagation()} role="presentation">
          <Button variant="primary" onClick={() => open('approve', r)}>Give a unit</Button>
          <Button variant="quiet" onClick={() => open('escalate', r)}>Buy it</Button>
          <Button variant="quiet" onClick={() => open('reject', r)}>Send back</Button>
        </div>
      ),
    },
  ];
  const oldCols = [
    { key: 'p', header: 'Part', render: (r) => <DocNumber value={r.prt_id} />, sub: (r) => r.part_name },
    { key: 'l', header: 'Off laptop', render: (r) => (r.ttspl_id ? <DocNumber value={r.ttspl_id} /> : '—'), sub: (r) => r.request_number },
    { key: 'c', header: 'Technician said', render: (r) => r.condition_on_removal || r.status },
    { key: 'who', header: 'Technician', render: (r) => r.technician_name || '—' },
    { key: 'd', header: 'Taken off', render: (r) => <DateTime value={r.removed_at} /> },
    { key: 'a', header: '', render: (r) => canCollect && <Button onClick={(e) => { e.stopPropagation(); open('collect', r); }}>Collected</Button> },
  ];

  const title = act && { approve: `Give a unit for ${act.row.request_number}`, reject: 'Send the request back', escalate: 'Ask procurement to buy it', collect: `Collect ${act.row.prt_id}` }[act.kind];

  return (
    <DeskShell title="Parts desk" breadcrumb="Production" subtitle="Part requests from the floor, and old parts coming back.">
      <div className="c-stack">
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'requests', label: 'Requests from the floor' }, { key: 'old', label: 'Old parts to collect' }]} />
        <Section title={tab === 'requests' ? 'Waiting for a part' : 'Taken off laptops — confirm you have them'}>
          {rows === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={tab === 'requests' ? reqCols : oldCols}
              rows={rows}
              rowKey={(r) => r.request_id || r.instance_id}
              onRowClick={tab === 'requests' ? (r) => r.ticket_id && navigate(`/carret/produce/tickets/${r.ticket_id}`) : undefined}
              empty={<EmptyState title={tab === 'requests' ? 'No part is waiting' : 'Nothing to collect'} />}
            />
          )}
          {tab === 'requests' && <p className="text-ink-3" style={{ marginTop: '8px' }}>Parts sent to procurement are on Procure → To buy.</p>}
        </Section>
      </div>

      <Drawer open={Boolean(act)} onClose={() => setAct(null)} title={title} width="34rem" footer={<Button variant="primary" disabled={Boolean(busy)} onClick={submit}>Confirm</Button>}>
        {act?.kind === 'approve' && (
          <div className="c-stack">
            <p>{act.row.quantity || 1}× {act.row.part_name} for <strong>{act.row.ttspl_id}</strong> ({[act.row.brand, act.row.model].filter(Boolean).join(' ') || 'laptop'}).</p>
            <Field label="Which unit">
              <Select value={form.how} onChange={setF('how')} options={[{ value: 'auto', label: 'Pick one that fits for me' }, { value: 'scan', label: 'Scan the unit label' }, { value: 'pick', label: 'Choose from the shelf' }]} />
            </Field>
            {form.how === 'scan' && <Field label="Unit label (PRT)"><Input autoFocus value={form.prt || ''} onChange={setF('prt')} className="font-mono" /></Field>}
            {form.how === 'pick' && (
              <Field label="On the shelf" hint={units.length ? undefined : 'No unit on the shelf — send it to procurement'}>
                <Select value={form.unit || ''} onChange={setF('unit')} placeholder="Pick a unit" options={units.map((u) => ({ value: String(u.instance_id), label: `${u.prt_id}${u.location_code ? ` · ${u.location_code}` : ''}${u.fitment && u.fitment !== 'universal' ? ` · fits ${u.fits_laptop_brand || u.fitment}` : ''}` }))} />
              </Field>
            )}
            <Field label="Is an old part coming back off the laptop?">
              <Select value={form.old || ''} onChange={setF('old')} placeholder="Not sure" options={[{ value: 'yes', label: 'Yes' }, { value: 'not_available', label: 'No' }]} />
            </Field>
            {form.old === 'yes' && <Field label="What comes off" hint="e.g. 8GB DDR4 RAM — on an upgrade it is not the new part"><Input value={form.oldName || ''} onChange={setF('oldName')} /></Field>}
          </div>
        )}
        {['reject', 'escalate'].includes(act?.kind) && (
          <div className="c-stack">
            {act.kind === 'escalate' && <Notice tone="info">It goes on Procure → To buy, where procurement links it to a spare-parts order.</Notice>}
            <Field label={act.kind === 'reject' ? 'Why' : 'Note for procurement'} required={act.kind === 'reject'}><Textarea rows={3} value={form.reason || ''} onChange={setF('reason')} /></Field>
          </div>
        )}
        {act?.kind === 'collect' && (
          <div className="c-stack">
            <p>{act.row.part_name} from {act.row.ttspl_id}. The technician marked it <strong>{act.row.condition_on_removal || act.row.status}</strong>.</p>
            <Field label="Condition you see"><Select value={form.condition || ''} onChange={setF('condition')} placeholder="As the technician said" options={[{ value: 'defective', label: 'Defective' }]} /></Field>
            <Field label="Put in location"><Input value={form.loc || ''} onChange={setF('loc')} placeholder="Bin / shelf" /></Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

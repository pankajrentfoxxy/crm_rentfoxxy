import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Boxes } from 'lucide-react';
import { PageHeader, Button, ResponsiveTable } from '../../../components/ui/primitives';
import { PriorityChip, prioritySpine, SlaChip, Mono, StatusPill, Modal } from '../../../components/ui/supportPrimitives';
import {
  fetchPartsQueue, approvePartRequest, rejectPartRequest, escalatePartRequest, issuePartRequest,
} from '../supportV2Api';

const CHIPS = [
  { id: '', label: 'All open' },
  { id: 'awaiting', label: 'Awaiting approval' },
  { id: 'approved', label: 'Approved, not issued' },
  { id: 'with_tech', label: 'With technician' },
  { id: 'old_return', label: 'Old parts pending return' },
  { id: 'out_of_stock', label: 'Out of stock' },
];

const CONTEXTS = [
  { id: 'ALL', label: 'All' },
  { id: 'FIELD', label: 'Field' },
  { id: 'FLOOR', label: 'Floor' },
];

function stockLabel(r) {
  if (r.status_v2 === 'ESCALATED_TO_PROCUREMENT') return 'Out of stock';
  if (Number(r.stock_qty) > 0) return 'In stock';
  return 'Unknown';
}

export default function PartsQueuePage() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [chip, setChip] = useState('awaiting');
  const [context, setContext] = useState('ALL');
  const [sort, setSort] = useState('priority');
  const [loading, setLoading] = useState(true);
  const [approveRow, setApproveRow] = useState(null);
  const [form, setForm] = useState({
    fulfilment_mode: 'WAREHOUSE_HANDOVER',
    instance_id: '',
    liability: 'COMPANY',
    collect_old_part: false,
    charge_amount: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    fetchPartsQueue({ chip, context, sort: sort === 'oldest' ? 'oldest' : 'priority' })
      .then((r) => setRows(r.data?.rows || []))
      .catch(() => toast.error('Could not load parts queue'))
      .finally(() => setLoading(false));
  }, [chip, context, sort]);

  useEffect(() => { load(); }, [load]);

  const openApprove = (r) => {
    setApproveRow(r);
    setForm({
      fulfilment_mode: r.fulfilment_mode || 'WAREHOUSE_HANDOVER',
      instance_id: r.instance_id || '',
      liability: r.liability || 'COMPANY',
      collect_old_part: Boolean(r.collect_old_part),
      charge_amount: r.charge_amount || '',
    });
  };

  const woPreview = () => {
    const bits = ['PART_DELIVERY for the requesting technician, same day'];
    if (form.collect_old_part) bits.push('PART_RETURN after the part is fitted');
    if (form.fulfilment_mode === 'WAREHOUSE_HANDOVER') bits.push('Warehouse handover challan (SPC-)');
    else bits.push('Courier part DC (PDC-)');
    return bits.join(' · ');
  };

  const columns = useMemo(() => [
    {
      key: 'priority', header: '', className: 'w-[72px]',
      render: (r) => (
        <div className="flex items-center gap-1">
          <PriorityChip priority={r.priority || 4} />
        </div>
      ),
    },
    {
      key: 'request', header: 'Request',
      render: (r) => (
        <div>
          <Mono bold className="text-[12px]">{r.request_number || r.legacy_request_number}</Mono>
          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-sup-canvas2">{r.context}</span>
        </div>
      ),
    },
    {
      key: 'part', header: 'Part & machine',
      render: (r) => (
        <div className="text-[12px]">
          <div className="font-medium">{r.catalog_name || r.part_name}</div>
          <Mono className="text-[11px] text-sup-muted">{r.ttspl_id || r.serial_number || '—'}</Mono>
        </div>
      ),
    },
    {
      key: 'ticket', header: 'Ticket',
      render: (r) => r.support_ticket_id ? (
        <button type="button" className="text-left" onClick={() => nav(`/support/tickets/${r.support_ticket_id}`)}>
          <Mono className="text-[11px]">{r.ticket_number}</Mono>
          {r.sla_resolution_due_at && new Date(r.sla_resolution_due_at) < new Date() && (
            <div className="text-[10px] text-pri1">SLA breached</div>
          )}
        </button>
      ) : <span className="text-[11px] text-sup-faint">Floor</span>,
    },
    {
      key: 'sla', header: 'SLA', className: 'w-[96px]',
      render: (r) => <SlaChip dueAt={r.sla_resolution_due_at} paused={r.sla_paused} />,
    },
    { key: 'stock', header: 'Stock', render: (r) => <span className="text-[11px]">{stockLabel(r)}</span> },
    { key: 'liability', header: 'Liability', render: (r) => <span className="text-[11px]">{r.liability || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status_v2} /> },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {['REQUESTED', 'ESCALATED_TO_PROCUREMENT'].includes(r.status_v2) && (
            <>
              <Button size="sm" onClick={() => openApprove(r)}>Approve</Button>
              <Button size="sm" variant="secondary" onClick={async () => {
                const reason = window.prompt('Reject reason');
                if (!reason) return;
                try { await rejectPartRequest(r.request_id, { reason }); toast.success('Rejected'); load(); }
                catch (e) { toast.error(e.response?.data?.message || 'Reject failed'); }
              }}>Reject</Button>
              {r.status_v2 === 'REQUESTED' && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  try { await escalatePartRequest(r.request_id); toast.success('Escalated'); load(); }
                  catch (e) { toast.error(e.response?.data?.message || 'Escalate failed'); }
                }}>Escalate</Button>
              )}
            </>
          )}
          {['APPROVED', 'RESERVED'].includes(r.status_v2) && (
            <Button size="sm" onClick={async () => {
              const sig = window.prompt('Signature attachment id');
              if (!sig) return;
              try { await issuePartRequest(r.request_id, { signature_attachment_id: Number(sig) }); toast.success('Issued'); load(); }
              catch (e) { toast.error(e.response?.data?.message || 'Issue failed'); }
            }}>Issue</Button>
          )}
        </div>
      ),
    },
  ], [load, nav]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <PageHeader title="Parts queue" subtitle="One queue. Ticket priority first — not warehouse FIFO." icon={Boxes} />

      <div className="mt-4 bg-white border border-sup-line rounded-xl shadow-sup">
        <div className="flex items-center gap-2 flex-wrap px-4 pt-3">
          {CHIPS.map((c) => (
            <button
              key={c.id || 'all'}
              type="button"
              onClick={() => setChip(c.id)}
              className={`h-7 px-2.5 rounded-full text-[11.5px] border
                ${chip === c.id ? 'bg-sup-accent border-sup-accent text-white' : 'bg-white border-sup-line text-sup-ink2'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center px-4 py-3 border-b border-sup-lineSoft">
          {CONTEXTS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setContext(c.id)}
              className={`h-7 px-2.5 rounded-md text-[11.5px] border
                ${context === c.id ? 'bg-sup-canvas2 border-sup-ink2' : 'border-sup-line'}`}
            >
              {c.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-[11px]">
            <span className="text-sup-muted">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-7 border border-sup-line rounded-md px-2 text-[11.5px]">
              <option value="priority">Ticket priority</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
        </div>

        <ResponsiveTable
          columns={columns}
          rows={rows}
          keyField="request_id"
          loading={loading}
          rowClassName={(r) => prioritySpine(r.priority || 4)}
          empty={<p className="p-4 text-[12px] text-sup-muted">No part requests in this chip.</p>}
        />
      </div>

      {approveRow && (
        <Modal
          title="Approve part request"
          subtitle={approveRow.request_number}
          onClose={() => setApproveRow(null)}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setApproveRow(null)}>Cancel</Button>
              <Button onClick={async () => {
                try {
                  await approvePartRequest(approveRow.request_id, {
                    fulfilment_mode: form.fulfilment_mode,
                    instance_id: form.instance_id ? Number(form.instance_id) : undefined,
                    liability: form.liability,
                    collect_old_part: form.collect_old_part,
                    charge_amount: form.charge_amount ? Number(form.charge_amount) : undefined,
                  });
                  toast.success('Approved · delivery job created');
                  setApproveRow(null);
                  load();
                } catch (e) {
                  toast.error(e.response?.data?.message || 'Approve failed');
                }
              }}>Approve & create jobs</Button>
            </>
          )}
        >
          <div className="space-y-2 text-[12px]">
            <div>{approveRow.catalog_name || approveRow.part_name} · {approveRow.ttspl_id || '—'}</div>
            <label className="block">Instance id
              <input className="w-full border rounded px-2 py-1.5 mt-0.5" value={form.instance_id}
                onChange={(e) => setForm((f) => ({ ...f, instance_id: e.target.value }))} />
            </label>
            <label className="block">Fulfilment
              <select className="w-full border rounded px-2 py-1.5 mt-0.5" value={form.fulfilment_mode}
                onChange={(e) => setForm((f) => ({ ...f, fulfilment_mode: e.target.value }))}>
                <option value="WAREHOUSE_HANDOVER">Warehouse handover (SPC-)</option>
                <option value="COURIER_TO_CUSTOMER">Courier to customer (PDC-)</option>
                <option value="COURIER_TO_TECH">Courier to technician (PDC-)</option>
              </select>
            </label>
            <label className="block">Liability
              <select className="w-full border rounded px-2 py-1.5 mt-0.5" value={form.liability}
                onChange={(e) => setForm((f) => ({ ...f, liability: e.target.value }))}>
                <option value="COMPANY">Company</option>
                <option value="CUSTOMER_CHARGEABLE">Customer chargeable</option>
                <option value="VENDOR_WARRANTY">Vendor warranty</option>
                <option value="INSURANCE">Insurance</option>
                <option value="NOT_APPLICABLE">Not applicable</option>
              </select>
            </label>
            {form.liability === 'CUSTOMER_CHARGEABLE' && (
              <label className="block">Charge amount
                <input className="w-full border rounded px-2 py-1.5 mt-0.5" value={form.charge_amount}
                  onChange={(e) => setForm((f) => ({ ...f, charge_amount: e.target.value }))} />
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.collect_old_part}
                onChange={(e) => setForm((f) => ({ ...f, collect_old_part: e.target.checked }))} />
              Collect old part
            </label>
            <div className="bg-sup-canvas2 rounded-md px-2 py-1.5 text-[11px] text-sup-ink2">{woPreview()}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}

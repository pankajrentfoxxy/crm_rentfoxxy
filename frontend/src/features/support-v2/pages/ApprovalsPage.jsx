import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import { PageHeader, Button, ResponsiveTable } from '../../../components/ui/primitives';
import { PriorityChip, prioritySpine, Mono, StatusPill, Modal } from '../../../components/ui/supportPrimitives';
import usePermission from '../../../hooks/usePermission';
import { fetchApprovals, decideApproval } from '../supportV2Api';

const TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'mine', label: 'Decided by me' },
  { id: 'all', label: 'All' },
];

function waitLabel(createdAt) {
  if (!createdAt) return '—';
  const ms = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ApprovalsPage() {
  const nav = useNavigate();
  const { canEdit } = usePermission();
  const editable = canEdit('support_approvals');
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [decide, setDecide] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchApprovals({ tab })
      .then((r) => setRows(r.data?.rows || []))
      .catch(() => toast.error('Could not load approvals'))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const submit = async (decision) => {
    if (!decide) return;
    if (decision === 'REJECTED' && !reason.trim()) {
      toast.error('Reason required to reject');
      return;
    }
    try {
      await decideApproval(decide.approval_id, { decision, reason });
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Rejected');
      setDecide(null);
      setReason('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Decision failed');
    }
  };

  const columns = useMemo(() => [
    {
      key: 'priority', header: '', className: 'w-[72px]',
      render: (r) => <PriorityChip priority={r.priority || 4} />,
    },
    {
      key: 'type', header: 'Type',
      render: (r) => (
        <div>
          <div className="text-[12px] font-semibold">{r.approval_type}</div>
          <div className="text-[11px] text-sup-muted">{r.label || r.customer_name || '—'}</div>
        </div>
      ),
    },
    {
      key: 'amount', header: 'Amount',
      render: (r) => r.amount != null
        ? <Mono bold>₹{Number(r.amount).toLocaleString('en-IN')}</Mono>
        : <span className="text-sup-faint">—</span>,
    },
    {
      key: 'requester', header: 'Requester',
      render: (r) => <span className="text-[12px]">{r.requester_name || '—'}</span>,
    },
    {
      key: 'ticket', header: 'Ticket',
      render: (r) => r.ticket_id ? (
        <button type="button" className="text-left" onClick={() => nav(`/support/tickets/${r.ticket_id}`)}>
          <Mono className="text-[11px]">{r.ticket_number}</Mono>
        </button>
      ) : '—',
    },
    {
      key: 'wait', header: 'Waiting',
      render: (r) => {
        const hours = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
        const hot = r.status === 'PENDING' && Number(r.priority) === 1 && hours >= 4;
        return <span className={hot ? 'text-pri1 font-semibold' : ''}>{waitLabel(r.created_at)}</span>;
      },
    },
    {
      key: 'status', header: 'Status',
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: 'actions', header: '',
      render: (r) => r.status !== 'PENDING' ? (
        <span className="text-[11px] text-sup-faint">{r.decided_by_name || 'Decided'}</span>
      ) : editable ? (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => nav(`/support/tickets/${r.ticket_id}`)}>
            View evidence
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setDecide(r); setReason(''); }}>
            Reject
          </Button>
          <Button size="sm" onClick={() => decideApproval(r.approval_id, { decision: 'APPROVED' })
            .then(() => { toast.success('Approved'); load(); })
            .catch((e) => toast.error(e.response?.data?.message || 'Approve failed'))}>
            Approve
          </Button>
        </div>
      ) : (
        <span className="text-sup-faint text-[11px]">View only</span>
      ),
    },
  ], [editable, load, nav]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">Screen S16</div>
      <PageHeader
        title="Approvals"
        subtitle="Everything waiting on a decision, in one inbox."
        icon={CheckCircle2}
      />
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-9 px-3 rounded-lg text-[12.5px] font-semibold ${
              tab === t.id ? 'bg-sup-ink text-white' : 'bg-white border border-sup-line text-sup-ink2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-sup-lineSoft shadow-sup overflow-hidden">
        <ResponsiveTable
          columns={columns}
          rows={rows}
          keyField="approval_id"
          loading={loading}
          empty={<p className="p-4 text-[12px] text-sup-muted">Nothing in this inbox.</p>}
          rowClassName={(r) => prioritySpine(r.priority)}
        />
      </div>
      {decide && (
        <Modal title={`Reject ${decide.approval_type}`} onClose={() => setDecide(null)}>
          <textarea
            className="w-full min-h-[88px] border border-sup-line rounded-lg p-2 text-[13px]"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="secondary" onClick={() => setDecide(null)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={() => submit('REJECTED')}>Reject</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

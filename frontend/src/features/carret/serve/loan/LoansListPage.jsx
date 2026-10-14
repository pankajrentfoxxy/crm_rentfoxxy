import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Notice, Section, Tabs,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { getLoanCounts, listLoans } from '../../../loan-laptops/loanLaptopApi';
import { errMsg } from '../serveShared';
import { LoanChip, QUEUE_TABS } from './loanShared';

/**
 * Serve → Loan laptops.
 *
 * A free laptop sent to a rental customer while their own is away for repair
 * (production 13 Oct 2026, services/loanLaptopService). Support raises it from
 * the ticket; Accounts approve when the policy asks; warehouse raises the Loan
 * DC; it then goes through the gate and delivery like any challan. When the
 * repair is done the customer either takes their laptop back or keeps the
 * loan one, which Accounts turn into a rental. Nothing bills while on loan.
 */
export default function LoansListPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [params, setParams] = useSearchParams();
  const queue = params.get('queue') ?? (hasPermission('loan_laptop_approval', 'edit') ? 'pending_approval' : 'active');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setRows(null);
    listLoans({ queue: queue || undefined, q: q.trim() || undefined, limit: 200 })
      .then(({ data }) => { setRows(data.data || []); setError(''); })
      .catch((e) => { setRows([]); setError(errMsg(e, 'Could not load loan laptops')); });
    getLoanCounts().then(({ data }) => setCounts(data.data?.queues || {})).catch(() => {});
  }, [queue, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const tabs = QUEUE_TABS.map((t) => ({ ...t, count: t.key && t.key !== 'closed' ? counts[t.key] : undefined }));

  const columns = [
    { key: 'n', header: 'Request', render: (r) => <DocNumber value={r.request_number} />, sub: (r) => `Ticket #${r.ticket_id}` },
    { key: 'c', header: 'Customer', render: (r) => r.customer_name || `#${r.customer_id}` },
    {
      key: 'l',
      header: 'Loan laptop',
      render: (r) => <DocNumber value={r.loan_ttspl_id || '—'} />,
      sub: (r) => `for ${r.original_ttspl_id || 'customer laptop'}`,
    },
    { key: 'dc', header: 'Loan DC', render: (r) => (r.loan_dc_number ? <DocNumber value={r.loan_dc_number} /> : <span className="text-ink-3">not yet</span>) },
    { key: 's', header: 'Where it is', render: (r) => <LoanChip status={r.status} /> },
    { key: 'u', header: 'Updated', render: (r) => <DateTime value={r.updated_at} />, sub: (r) => r.created_by_name || null },
  ];

  return (
    <DeskShell
      title="Loan laptops"
      breadcrumb="Support"
      subtitle="Free laptops with customers while theirs are repaired. Raised from a ticket's repair pickup."
      actions={<Button onClick={() => navigate('/carret/serve/loans/policy')}>Replacement policy</Button>}
    >
      <div className="c-stack">
        {error && <Notice tone="crit" title="Could not load">{error}</Notice>}
        <Section
          title="Loans"
          actions={<Input placeholder="LNR, TTSPL, customer, Loan DC or ticket…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: '16rem' }} />}
        >
          <Tabs tabs={tabs} value={queue} onChange={(v) => setParams(v ? { queue: v } : { queue: '' })} />
          {rows === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/carret/serve/loans/${r.id}`)}
              empty={<EmptyState title="No loans here" body="A loan laptop is raised from a support ticket's repair pickup (Support → Queue → the ticket)." />}
            />
          )}
        </Section>
      </div>
    </DeskShell>
  );
}

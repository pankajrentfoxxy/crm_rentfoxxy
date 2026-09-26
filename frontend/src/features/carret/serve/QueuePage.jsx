import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Input, Notice, Section, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { fetchDeskQueue } from './serveApi';
import { LANES, SLA_TONE, STEP_LABEL, errMsg, slaText, when } from './serveShared';

/**
 * Serve → Queue (the support lead's desk, claude/carret-support.md step 4).
 *
 * Every open ticket in one of four lanes — who acts next — worst SLA first.
 * A row opens the ticket record, where assign, appointment, hold, WFH charge
 * and the rest live. Customer requests from the QR page / portal are counted
 * on top and open their existing screen.
 */
export default function QueuePage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [data, setData] = useState(null);
  const [lane, setLane] = useState('needs_technician');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    fetchDeskQueue().then(({ data: d }) => setData(d)).catch((e) => { setData({ lanes: {}, tickets: [] }); toast.error(errMsg(e, 'Could not load the queue')); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.tickets || []).filter((t) => (lane === 'all' || t.lane === lane)
      && (!q || String(t.id).includes(q) || String(t.customer_name || '').toLowerCase().includes(q)
        || t.laptops.some((l) => String(l.ttspl || '').toLowerCase().includes(q))));
  }, [data, lane, search]);

  const tabs = [...LANES.map((l) => ({ key: l.key, label: `${l.label} · ${data?.lanes?.[l.key] ?? '…'}` })), { key: 'all', label: `All open · ${data?.tickets?.length ?? '…'}` }];

  const columns = [
    { key: 'n', header: 'Ticket', render: (t) => <DocNumber value={`#${t.id}`} />, sub: (t) => t.priority !== 'normal' ? t.priority : (t.ticket_category || null) },
    { key: 'c', header: 'Customer', render: (t) => t.customer_name, sub: (t) => t.phone || null },
    {
      key: 'l',
      header: 'Laptops',
      render: (t) => t.laptops.map((l) => <div key={l.item_id}><span className="font-mono">{l.ttspl || '—'}</span> {l.model}</div>),
    },
    {
      key: 's',
      header: 'Where it is',
      render: (t) => t.laptops.map((l) => <div key={l.item_id}>{STEP_LABEL[l.step] || l.step}{l.assignee ? ` · ${l.assignee}` : ''}</div>),
      sub: (t) => {
        const appt = t.laptops.map((l) => l.appointment).filter(Boolean).sort()[0];
        return appt ? `🗓 ${when(appt)}` : null;
      },
    },
    {
      key: 'a',
      header: 'SLA',
      render: (t) => <span style={{ color: SLA_TONE[t.sla?.resolve?.state] || 'inherit', fontWeight: 600 }}>{slaText(t.sla)}</span>,
      sub: (t) => <>raised <DateTime value={t.created_at} /></>,
    },
  ];

  return (
    <DeskShell
      title="Support queue"
      breadcrumb="Serve"
      subtitle="Every open ticket, by who acts next — the latest first to go late at the top."
      actions={hasPermission('support_tickets', 'create') && <Button variant="primary" onClick={() => navigate('/carret/serve/tickets/new')}>New ticket</Button>}
    >
      <div className="c-stack">
        {data?.requests_pending > 0 && (
          <Notice tone="info" action={<Button onClick={() => navigate('/support/requests')}>Open requests</Button>}>
            {data.requests_pending} request(s) from customers (QR page / portal) are waiting to be turned into tickets.
          </Notice>
        )}
        <Tabs tabs={tabs} value={lane} onChange={setLane} />
        <Section
          title={LANES.find((l) => l.key === lane)?.label || 'All open'}
          actions={<Input type="search" placeholder="Ticket, customer, TTSPL" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '16rem' }} aria-label="Search" />}
        >
          {data === null ? <EmptyState title="Loading…" /> : (
            <DataTable columns={columns} rows={rows} rowKey={(t) => t.id} onRowClick={(t) => navigate(`/carret/serve/tickets/${t.id}`)} empty={<EmptyState title="Nothing here" />} />
          )}
        </Section>
      </div>
    </DeskShell>
  );
}

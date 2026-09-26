import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  DataTable, DateTime, DocNumber, EmptyState, Section, StatTile, Tabs,
} from '../../../components/carret';
import { fetchCsatSummary, fetchSlaBoard, fetchTechnicians } from './serveApi';
import { SLA_TONE, errMsg, slaText } from './serveShared';

/**
 * Serve → SLA & feedback (support lead). The SLA board (open tickets, late
 * first), each technician's open work today, and what customers said.
 */
export default function InsightsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('sla');
  const [board, setBoard] = useState(null);
  const [techs, setTechs] = useState(null);
  const [csat, setCsat] = useState(null);

  useEffect(() => {
    fetchSlaBoard().then(({ data }) => setBoard(data)).catch((e) => { setBoard({ counts: {}, tickets: [] }); toast.error(errMsg(e)); });
    fetchTechnicians().then(({ data }) => setTechs((data.technicians || []).filter((t) => t.assignee_kind === 'technician'))).catch(() => setTechs([]));
    fetchCsatSummary(90).then(({ data }) => setCsat(data)).catch(() => setCsat(null));
  }, []);

  return (
    <DeskShell title="SLA & feedback" breadcrumb="Serve">
      <div className="c-stack">
        <div className="c-form-grid" style={{ '--c-cols': 4 }}>
          <StatTile label="Late" value={board?.counts?.breached ?? '…'} />
          <StatTile label="Due soon" value={board?.counts?.at_risk ?? '…'} />
          <StatTile label="On hold / waiting a part" value={board?.counts?.paused ?? '…'} />
          <StatTile label="Customer score (90 days)" value={csat?.average != null ? `${csat.average} / 5` : '—'} />
        </div>
        <Tabs tabs={[{ key: 'sla', label: 'SLA board' }, { key: 'tech', label: 'Technicians' }, { key: 'csat', label: 'Customer feedback' }]} value={tab} onChange={setTab} />

        {tab === 'sla' && (
          <Section title="Open tickets — late first">
            {board === null ? <EmptyState title="Loading…" /> : (
              <DataTable
                columns={[
                  { key: 'n', header: 'Ticket', render: (t) => <DocNumber value={`#${t.id}`} />, sub: (t) => t.priority },
                  { key: 'c', header: 'Customer', render: (t) => t.customer_name },
                  { key: 'v', header: 'Visit', render: (t) => <span style={{ color: SLA_TONE[t.sla.visit.state] }}>{t.sla.visit.state === 'n/a' ? '—' : t.sla.visit.state.replace('_', ' ')}</span> },
                  { key: 'r', header: 'Resolve', render: (t) => <span style={{ color: SLA_TONE[t.sla.resolve.state], fontWeight: 600 }}>{slaText(t.sla)}</span> },
                  { key: 't', header: 'Technician', render: (t) => t.technicians || '—' },
                  { key: 'd', header: 'Raised', render: (t) => <DateTime value={t.created_at} /> },
                ]}
                rows={board.tickets}
                rowKey={(t) => t.id}
                onRowClick={(t) => navigate(`/carret/serve/tickets/${t.id}`)}
                empty={<EmptyState title="No open tickets" />}
              />
            )}
          </Section>
        )}

        {tab === 'tech' && (
          <Section title="Open work per technician">
            {techs === null ? <EmptyState title="Loading…" /> : (
              <DataTable
                columns={[
                  { key: 'n', header: 'Technician', render: (t) => t.name, sub: (t) => t.mobile_no || null },
                  { key: 'o', header: 'Open laptops', numeric: true, render: (t) => t.open_item_count },
                  { key: 'k', header: 'Open tickets', numeric: true, render: (t) => t.open_ticket_count },
                  { key: 'd', header: 'Visits today', numeric: true, render: (t) => t.today_visits || 0 },
                  { key: 's', header: 'Customer score', numeric: true, render: (t) => { const r = (csat?.by_technician || []).find((x) => x.technician_id === t.user_id); return r ? `${r.average} (${r.answered})` : '—'; } },
                ]}
                rows={[...techs].sort((a, b) => b.open_item_count - a.open_item_count)}
                rowKey={(t) => t.user_id}
              />
            )}
          </Section>
        )}

        {tab === 'csat' && (
          <Section title={csat ? `Last 90 days · ${csat.answered || 0} of ${csat.asked || 0} answered` : 'Customer feedback'}>
            {!csat ? <EmptyState title="Loading…" /> : (
              <DataTable
                columns={[
                  { key: 'r', header: 'Rating', render: (c) => '★'.repeat(c.rating) + '☆'.repeat(5 - c.rating) },
                  { key: 'c', header: 'Customer', render: (c) => c.customer_name, sub: (c) => `#${c.ticket_id}` },
                  { key: 't', header: 'Technician', render: (c) => c.technician || '—' },
                  { key: 'm', header: 'Comment', render: (c) => c.comment || '—' },
                  { key: 'd', header: 'When', render: (c) => <DateTime value={c.submitted_at} /> },
                ]}
                rows={csat.latest || []}
                rowKey={(c) => c.ticket_id}
                onRowClick={(c) => navigate(`/carret/serve/tickets/${c.ticket_id}`)}
                empty={<EmptyState title="No feedback yet" body="Customers get a link by email when their ticket closes." />}
              />
            )}
          </Section>
        )}
      </div>
    </DeskShell>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, EmptyState, Section, Select, StatTile, Tabs,
} from '../../../../components/carret';
import { fetchAssignableUsers, fetchFollowUpBoard } from './leadApi';
import { FollowUpDrawer } from './LeadDrawers';
import { OUTCOMES, STATUS_TONE, istDate, leadErr } from './leadShared';

/**
 * Sell → Follow-ups (claude/carret-lead.md). The calls to make: overdue first,
 * then today, then the next 7 days. "Log" records what happened and the next
 * date without leaving the page. A manager can look at one salesperson.
 */
const outcomeLabel = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label]));

export default function FollowUpsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overdue');
  const [owner, setOwner] = useState('');
  const [users, setUsers] = useState([]);
  const [logFor, setLogFor] = useState(null);

  const load = useCallback(() => {
    fetchFollowUpBoard({ owner: owner || undefined })
      .then(({ data: d }) => { setData(d); if (tab === 'overdue' && !d.overdue.length) setTab(d.today.length ? 'today' : 'upcoming'); })
      .catch((e) => { toast.error(leadErr(e)); setData({ overdue: [], today: [], upcoming: [] }); });
  }, [owner]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchAssignableUsers().then(({ data: d }) => setUsers(d.users || [])).catch(() => {}); }, []);

  const rows = data?.[tab] || [];
  const cols = [
    { key: 'd', header: 'When', render: (r) => `${istDate(r.follow_up_date)}${r.follow_up_time ? ` ${String(r.follow_up_time).slice(0, 5)}` : ''}`, sub: (r) => (r.days_from_today < 0 ? `${-r.days_from_today} day(s) late` : null) },
    { key: 'c', header: 'Lead', render: (r) => r.company_name || r.name, sub: (r) => [r.company_name ? r.name : null, r.phone].filter(Boolean).join(' · ') },
    { key: 'n', header: 'Needs', render: (r) => [r.quantity_required ? `${r.quantity_required} laptops` : null, r.rental_duration ? `${r.rental_duration} months` : null, [r.brand, r.processor, r.ram].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '—' },
    { key: 's', header: 'Status', render: (r) => <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: STATUS_TONE[r.status], marginRight: 6 }} />{r.status}</span>, sub: (r) => (r.last_outcome ? `Last: ${outcomeLabel[r.last_outcome] || r.last_outcome}` : r.lead_stage) },
    { key: 'o', header: 'Owner', render: (r) => r.owner_name || '—' },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <div className="flex" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()} role="presentation">
          {r.phone && <a className="c-btn" href={`tel:${r.phone}`}>Call</a>}
          <Button variant="primary" onClick={() => setLogFor({ leadId: r.lead_id, companyName: r.company_name, name: r.name, status: r.status })}>Log</Button>
        </div>
      ),
    },
  ];

  return (
    <DeskShell
      title="Follow-ups"
      breadcrumb="Sell / Leads"
      subtitle="The calls to make — overdue first."
      actions={users.length > 0 && <Select value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Everyone I can see" options={users.map((u) => ({ value: String(u.user_id), label: u.name }))} aria-label="Owner" />}
    >
      <div className="c-stack">
        <div className="c-form-grid" style={{ '--c-cols': 3 }}>
          <StatTile label="Overdue" value={data ? data.overdue.length : '…'} />
          <StatTile label="Today" value={data ? data.today.length : '…'} />
          <StatTile label="Next 7 days" value={data ? data.upcoming.length : '…'} />
        </div>
        <Tabs tabs={[{ key: 'overdue', label: `Overdue · ${data?.overdue.length ?? '…'}` }, { key: 'today', label: `Today · ${data?.today.length ?? '…'}` }, { key: 'upcoming', label: `Next 7 days · ${data?.upcoming.length ?? '…'}` }]} value={tab} onChange={setTab} />
        <Section title={{ overdue: 'Overdue', today: 'Today', upcoming: 'Next 7 days' }[tab]}>
          {data === null ? <EmptyState title="Loading…" /> : (
            <DataTable columns={cols} rows={rows} rowKey={(r) => r.lead_id} onRowClick={(r) => navigate(`/carret/sell/leads/${r.lead_id}`)} empty={<EmptyState title={tab === 'overdue' ? 'Nothing overdue 👍' : 'Nothing planned'} />} />
          )}
        </Section>
      </div>
      <FollowUpDrawer lead={logFor} open={Boolean(logFor)} onClose={() => setLogFor(null)} onDone={load} />
    </DeskShell>
  );
}

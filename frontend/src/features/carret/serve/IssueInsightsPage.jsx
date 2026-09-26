import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, Drawer, EmptyState, Notice, Section, Select, StatTile, Tabs,
} from '../../../components/carret';
import { fetchIssueInsights } from './serveApi';
import { useIssueCatalog } from './IssueFields';
import { errMsg } from './serveShared';

/**
 * Serve → Issue insights (claude/carret-support.md rework C).
 *
 * Which issues we get most — by type, issue, model, vendor and how soon after
 * delivery — why they happened, and, for faults the floor let through, who
 * prepared and QC'd the laptop so the floor can be coached. Counts only
 * tickets raised under the issue process; older tickets show under "Before".
 */
const PERIODS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
];

function Bar({ value, max }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '10rem' }}>
      <div style={{ flex: 1, height: '8px', background: 'var(--surface-2, #eef2f7)', borderRadius: '4px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent, #0e7490)', borderRadius: '4px' }} />
      </div>
      <strong style={{ minWidth: '2.5rem', textAlign: 'right' }}>{value}</strong>
    </div>
  );
}

const share = (n, total) => (total ? `${Math.round((n / total) * 100)}%` : '—');

export default function IssueInsightsPage() {
  const navigate = useNavigate();
  const catalog = useIssueCatalog();
  const [days, setDays] = useState('90');
  const [typeId, setTypeId] = useState('');
  const [tab, setTab] = useState('issues');
  const [data, setData] = useState(null);
  const [person, setPerson] = useState(null);

  useEffect(() => {
    setData(null);
    fetchIssueInsights({ days, type_id: typeId || undefined })
      .then(({ data: d }) => setData(d))
      .catch((e) => { toast.error(errMsg(e, 'Could not load the insights')); setData({ summary: {}, by_type: [], by_issue: [], by_model: [], by_vendor: [], by_age: [], by_cause: [], by_fix: [], floor: [], older: [] }); });
  }, [days, typeId]);

  const s = data?.summary || {};
  const total = s.laptops || 0;
  const groupTable = (rows, header, withTop = true) => {
    const max = Math.max(0, ...rows.map((r) => r.count));
    return (
      <DataTable
        columns={[
          { key: 'l', header, render: (r) => r.label },
          { key: 'c', header: 'Laptops', render: (r) => <Bar value={r.count} max={max} />, sub: (r) => share(r.count, total) },
          ...(withTop ? [{ key: 't', header: 'Most common issue', render: (r) => (r.top ? `${r.top.label} (${r.top.count})` : '—') }] : []),
        ]}
        rows={rows}
        rowKey={(r) => r.key}
        empty={<EmptyState title="Nothing in this period" />}
      />
    );
  };

  const tabs = [
    { key: 'issues', label: 'Issues' },
    { key: 'models', label: 'Models & vendors' },
    { key: 'causes', label: 'Why it happened' },
    { key: 'floor', label: `Floor feedback${data ? ` · ${data.floor.length}` : ''}` },
    { key: 'before', label: 'Before the issue process' },
  ];

  return (
    <DeskShell
      title="Issue insights"
      breadcrumb="Serve"
      subtitle="Which problems we get, on which laptops, why — and what the floor should fix."
      actions={(
        <div className="flex" style={{ gap: '8px' }}>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} placeholder="All types" options={(catalog?.types || []).map((t) => ({ value: String(t.id), label: t.name }))} aria-label="Type" />
          <Select value={days} onChange={(e) => setDays(e.target.value)} options={PERIODS} aria-label="Period" />
        </div>
      )}
    >
      <div className="c-stack">
        <div className="c-form-grid" style={{ '--c-cols': 5 }}>
          <StatTile label="Laptops with a complaint" value={data ? total : '…'} />
          <StatTile label="Finding recorded" value={data ? `${s.finding_recorded} (${share(s.finding_recorded, total)})` : '…'} />
          <StatTile label="No fault found" value={data ? share(s.no_fault_found, s.finding_recorded) : '…'} />
          <StatTile label="Within 30 days of delivery" value={data ? `${s.early_failures} (${share(s.early_failures, total)})` : '…'} />
          <StatTile label="Faults the floor missed" value={data ? s.floor_cases : '…'} />
        </div>
        {data && total === 0 && (
          <Notice tone="info">
            No tickets under the issue process in this period yet. Every complaint raised from now on records Type › Subtype › Issue and, when finished, what was wrong and why — it shows up here.
          </Notice>
        )}
        <Tabs tabs={tabs} value={tab} onChange={setTab} />

        {!data ? <EmptyState title="Loading…" /> : (
          <>
            {tab === 'issues' && (
              <>
                <Section title="By type">{groupTable(data.by_type, 'Type')}</Section>
                <Section title="Top issues">{groupTable(data.by_issue, 'Type › Subtype › Issue', false)}</Section>
                <Section title="How soon after delivery">{groupTable(data.by_age.map((a) => ({ ...a, key: a.key })), 'Days since delivery', false)}</Section>
              </>
            )}
            {tab === 'models' && (
              <>
                <Section title="By model">{groupTable(data.by_model, 'Model')}</Section>
                <Section title="By vendor">{groupTable(data.by_vendor, 'Vendor')}</Section>
              </>
            )}
            {tab === 'causes' && (
              <>
                <Section title="Root cause (laptops with a finding)">{groupTable(data.by_cause, 'Root cause', false)}</Section>
                <Section title="What fixed it">{groupTable(data.by_fix, 'Fix', false)}</Section>
              </>
            )}
            {tab === 'floor' && (
              <Section title="Who prepared the laptops that failed">
                <p className="text-ink-3" style={{ marginBottom: '8px' }}>
                  Laptops the technician marked “Missed at refurbishment / QC”, plus hardware faults within 30 days of delivery.
                  Each person is named for the stage they did on the laptop’s last floor ticket before the complaint.
                </p>
                <DataTable
                  columns={[
                    { key: 'n', header: 'Person', render: (p) => p.name },
                    { key: 'r', header: 'Stages', render: (p) => p.roles.join(', ') },
                    { key: 'c', header: 'Laptops', render: (p) => <strong>{p.count}</strong> },
                    { key: 'a', header: '', render: (p) => <Button variant="quiet" onClick={() => setPerson(p)}>See laptops</Button> },
                  ]}
                  rows={data.floor}
                  rowKey={(p) => `${p.user_id}-${p.name}`}
                  empty={<EmptyState title="No floor-missed faults in this period" />}
                />
              </Section>
            )}
            {tab === 'before' && (
              <Section title="Tickets raised before the issue process (old labels, as they are)">
                {groupTable(data.older.map((o) => ({ ...o, key: o.label })), 'Old label', false)}
              </Section>
            )}
          </>
        )}
      </div>

      <Drawer open={Boolean(person)} onClose={() => setPerson(null)} title={person ? `${person.name} — ${person.count} laptop(s)` : ''} width="40rem">
        {person && (
          <DataTable
            columns={[
              { key: 't', header: 'Laptop', render: (l) => <span className="font-mono">{l.ttspl}</span>, sub: (l) => l.model },
              { key: 'i', header: 'Issue', render: (l) => l.issue, sub: (l) => [l.cause, l.days != null ? `${l.days} days after delivery` : null].filter(Boolean).join(' · ') },
              { key: 'k', header: '', render: (l) => <Button variant="quiet" onClick={() => navigate(`/carret/serve/tickets/${l.ticket_id}`)}>Ticket #{l.ticket_id}</Button> },
            ]}
            rows={person.laptops}
            rowKey={(l) => l.id}
          />
        )}
      </Drawer>
    </DeskShell>
  );
}

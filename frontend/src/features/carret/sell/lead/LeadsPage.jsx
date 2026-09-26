import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, EmptyState, Input, Notice, Section, Segmented, Select, StatTile,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { assignLeads, fetchAssignableUsers, fetchFollowUpBoard, fetchLeads } from './leadApi';
import {
  COLUMNS, SOURCES, STATUS_HINT, STATUS_TONE, columnOf, istDate, leadErr, need, todayIst,
} from './leadShared';

/**
 * Sell → Leads (claude/carret-lead.md). Every lead as a board (New → Call back
 * → Interested → Proposal / demo → Deal, Lost hidden unless asked for) or a
 * list, with the follow-ups due today and overdue on top. A card opens the
 * lead; status, follow-up, quote and Deal are done there. Filters live in the
 * address bar, so a dashboard link like ?status=Hot works.
 */
function StatusDot({ status }) {
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: STATUS_TONE[status] || '#94a3b8', marginRight: 6 }} />;
}

function followLabel(l) {
  if (!l.followUpDate) return null;
  const d = istDate(l.followUpDate);
  const t = todayIst();
  const when = d === t ? 'Today' : d < t ? `Overdue (${d})` : d;
  return `${when}${l.followUpTime ? ` ${String(l.followUpTime).slice(0, 5)}` : ''}`;
}

function Card({ l, onOpen }) {
  const fu = followLabel(l);
  const overdue = l.followUpDate && istDate(l.followUpDate) < todayIst();
  return (
    <button type="button" className="c-card" onClick={onOpen} style={{ textAlign: 'left', padding: '10px 12px', width: '100%', cursor: 'pointer', display: 'block' }}>
      <div style={{ fontWeight: 600 }}>{l.companyName || l.name}</div>
      <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{[l.companyName ? l.name : null, l.phone].filter(Boolean).join(' · ')}</div>
      {need(l) && <div style={{ fontSize: 'var(--d-sm)', marginTop: 4 }}>{need(l)}</div>}
      <div className="flex items-center" style={{ gap: 6, marginTop: 6, fontSize: 'var(--d-sm)', flexWrap: 'wrap' }}>
        <span><StatusDot status={l.status} />{l.status}{l.leadStage && l.leadStage !== l.status ? ` · ${l.leadStage}` : ''}</span>
        {fu && <span style={{ color: overdue ? 'var(--alert-bad, #b91c1c)' : 'inherit', fontWeight: overdue ? 600 : 400 }}>· 📞 {fu}</span>}
      </div>
      <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: 4 }}>{[l.assignedUser?.name || 'Unassigned', l.source].filter(Boolean).join(' · ')}</div>
    </button>
  );
}

export default function LeadsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasPermission, user } = usePermission();
  const canCreate = hasPermission('leads', 'create');
  const canAssign = hasPermission('lead_assignee_change', 'edit') || (hasPermission('leads', 'edit') && ['super_admin', 'admin', 'manager'].includes(user?.role));
  const view = params.get('view') || 'board';
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const [leads, setLeads] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [users, setUsers] = useState([]);
  const [board, setBoard] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [assignTo, setAssignTo] = useState('');
  const [q, setQ] = useState(params.get('search') || '');

  const load = useCallback(() => {
    setLeads(null);
    fetchLeads({
      search: params.get('search') || undefined,
      status: params.get('status') || undefined,
      source: params.get('source') || undefined,
      assigned_to: params.get('owner') || undefined,
      follow_up: params.get('follow_up') || undefined,
      inquiry_type: params.get('inquiry') || undefined,
      date_from: params.get('from') || undefined,
      date_to: params.get('to') || undefined,
      limit: 2000,
      page: 1,
    }).then(({ data }) => { setLeads(data.leads || []); setTruncated(Boolean(data.truncated) || Number(data.total) > 2000); })
      .catch((e) => { toast.error(leadErr(e, 'Could not load leads')); setLeads([]); });
  }, [params]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchFollowUpBoard().then(({ data }) => setBoard(data)).catch(() => setBoard(null));
    fetchAssignableUsers().then(({ data }) => setUsers(data.users || data.data || [])).catch(() => setUsers([]));
  }, []);
  useEffect(() => { const t = setTimeout(() => { if (q !== (params.get('search') || '')) set('search', q.trim()); }, 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const showLost = params.get('lost') === '1' || /Rejected|Gone/.test(params.get('status') || '');
  const cols = useMemo(() => COLUMNS.filter((c) => c.key !== 'closed' || showLost), [showLost]);
  const byCol = useMemo(() => {
    const m = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));
    for (const l of leads || []) m[columnOf(l.status)].push(l);
    // Follow-up due first, then newest.
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => (a.followUpDate ? 0 : 1) - (b.followUpDate ? 0 : 1) || String(a.followUpDate || '').localeCompare(String(b.followUpDate || '')) || String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    return m;
  }, [leads]);

  const open = (l) => navigate(`/carret/sell/leads/${l.leadId}`);
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doAssign = async () => {
    if (!assignTo || !sel.size) return;
    try { await assignLeads([...sel], Number(assignTo)); toast.success(`${sel.size} lead(s) assigned`); setSel(new Set()); load(); } catch (e) { toast.error(leadErr(e)); }
  };

  const listCols = [
    ...(canAssign ? [{ key: 'x', header: '', width: '2.5rem', render: (l) => <input type="checkbox" aria-label={`Pick lead ${l.leadId}`} checked={sel.has(l.leadId)} onChange={() => toggle(l.leadId)} onClick={(e) => e.stopPropagation()} /> }] : []),
    { key: 'c', header: 'Company', render: (l) => l.companyName || l.name, sub: (l) => [l.companyName ? l.name : null, l.phone].filter(Boolean).join(' · ') },
    { key: 'n', header: 'Needs', render: (l) => need(l) || '—' },
    { key: 's', header: 'Status', render: (l) => <span title={STATUS_HINT[l.status]}><StatusDot status={l.status} />{l.status}</span>, sub: (l) => (l.leadStage && l.leadStage !== l.status ? l.leadStage : null) },
    { key: 'f', header: 'Next follow-up', render: (l) => followLabel(l) || '—' },
    { key: 'o', header: 'Owner', render: (l) => l.assignedUser?.name || <span className="text-ink-3">Unassigned</span>, sub: (l) => l.source },
    { key: 'd', header: 'Came in', render: (l) => <DateTime value={l.createdAt} /> },
  ];

  const statusOptions = [
    { value: '', label: 'Open leads' },
    ...COLUMNS.map((c) => ({ value: c.statuses.join(','), label: c.label })),
    { value: 'Pending,Call Back,Hold,Cold,Warm,Hot,Demo,Deal,Repeat,Rejected,Gone', label: 'Everything' },
  ];
  // "Open leads" = everything but Lost; the list asks the API for it.
  useEffect(() => {
    if (!params.get('status') && !params.get('lost')) set('status', 'Pending,Call Back,Hold,Cold,Warm,Hot,Demo,Deal,Repeat');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DeskShell
      title="Leads"
      breadcrumb="Sell"
      subtitle="Every enquiry until it is a customer — follow-ups first."
      actions={(
        <>
          <Button variant="quiet" onClick={() => navigate('/carret/sell/follow-ups')}>Follow-ups</Button>
          {canCreate && <Button variant="primary" onClick={() => navigate('/carret/sell/leads/new')}>New lead</Button>}
        </>
      )}
    >
      <div className="c-stack">
        <div className="c-form-grid" style={{ '--c-cols': 4 }}>
          <StatTile label="Follow-ups overdue" value={board ? board.overdue.length : '…'} />
          <StatTile label="Follow-ups today" value={board ? board.today.length : '…'} />
          <StatTile label="Next 7 days" value={board ? board.upcoming.length : '…'} />
          <StatTile label="Leads shown" value={leads ? leads.length : '…'} />
        </div>
        {board && board.overdue.length > 0 && (
          <Notice tone="warn" title={`${board.overdue.length} follow-up(s) overdue`} action={<Button onClick={() => navigate('/carret/sell/follow-ups')}>Do them now</Button>}>
            Call them first — the oldest is {board.overdue[0].company_name || board.overdue[0].name}.
          </Notice>
        )}

        <Section
          title="Leads"
          actions={(
            <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
              <Input type="search" placeholder="Name, company, phone, email" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '15rem' }} aria-label="Search" />
              <Select value={params.get('status') || ''} onChange={(e) => set('status', e.target.value)} options={statusOptions} aria-label="Status" />
              <Select value={params.get('source') || ''} onChange={(e) => set('source', e.target.value)} placeholder="All sources" options={SOURCES} aria-label="Source" />
              {users.length > 0 && (
                <Select value={params.get('owner') || ''} onChange={(e) => set('owner', e.target.value)} placeholder="All owners" options={[{ value: 'me', label: 'Mine' }, { value: 'unassigned', label: 'Unassigned' }, ...users.map((u) => ({ value: String(u.user_id), label: u.name }))]} aria-label="Owner" />
              )}
              <Select value={params.get('follow_up') || ''} onChange={(e) => set('follow_up', e.target.value)} placeholder="Any follow-up" options={[{ value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Today' }, { value: 'this_week', label: 'This week' }]} aria-label="Follow-up" />
              <Segmented value={view} onChange={(v) => set('view', v === 'board' ? '' : v)} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
            </div>
          )}
        >
          {truncated && <Notice tone="info">Showing the first {leads?.length} — narrow the filters to see the rest.</Notice>}
          {leads === null ? <EmptyState title="Loading…" /> : view === 'list' ? (
            <>
              {canAssign && sel.size > 0 && (
                <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                  <span>{sel.size} picked — assign to</span>
                  <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder="Choose…" options={users.map((u) => ({ value: String(u.user_id), label: u.name }))} aria-label="Assign to" />
                  <Button variant="primary" disabled={!assignTo} onClick={doAssign}>Assign</Button>
                </div>
              )}
              <DataTable columns={listCols} rows={leads} rowKey={(l) => l.leadId} onRowClick={open} empty={<EmptyState title="No leads match" />} />
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, minmax(15rem, 1fr))`, gap: 12, overflowX: 'auto' }}>
              {cols.map((c) => (
                <div key={c.key} style={{ minWidth: '15rem' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <strong>{c.label}</strong><span className="text-ink-3">{byCol[c.key].length}</span>
                  </div>
                  <div className="c-stack" style={{ gap: 8 }}>
                    {byCol[c.key].slice(0, 60).map((l) => <Card key={l.leadId} l={l} onOpen={() => open(l)} />)}
                    {byCol[c.key].length > 60 && <Button variant="quiet" onClick={() => { set('view', 'list'); set('status', c.statuses.join(',')); }}>{byCol[c.key].length - 60} more — open as a list</Button>}
                    {byCol[c.key].length === 0 && <span className="text-ink-3">—</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!showLost && view === 'board' && <Button variant="quiet" style={{ marginTop: 8 }} onClick={() => set('lost', '1')}>Show lost leads</Button>}
        </Section>
      </div>
    </DeskShell>
  );
}

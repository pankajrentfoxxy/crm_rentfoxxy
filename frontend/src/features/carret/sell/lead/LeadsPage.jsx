import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, EmptyState, FilterBar, Notice, Panel, SearchSelect, Segmented, Select, Tabs,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { assignLeads, fetchAssignableUsers, fetchFollowUpBoard, fetchLead, fetchLeads } from './leadApi';
import {
  COLUMNS, GROUP_TONE, INQUIRY, SOURCES, addDaysIst, columnOf, istDate, leadErr, need, todayIst,
} from './leadShared';
import LeadStatusChip from './LeadStatusChip';
import { StatusDrawer, WinDrawer } from './LeadDrawers';

/**
 * Sell → Leads (claude/carret-lead.md; redesigned 29 Sep 2026).
 *
 * - Pipeline tabs with live counts replace the status dropdown; the board's
 *   columns wear the same colours (theme tokens, dark-mode safe).
 * - One filter row: search, owner, source, enquiry type, follow-up, came in,
 *   sort. Every filter lives in the address bar, so a link like
 *   ?stage=proposal&follow_up=overdue works.
 * - The status pill on a card or row changes the status in place — the same
 *   drawer (and rules: lost reason, Deal/Demo creates the customer) as the
 *   lead record.
 *
 * The API filters owner / source / enquiry / follow-up / dates / search; the
 * pipeline tab and the sort run here, on the loaded set, so each tab can show
 * its count.
 */
const ALL_STATUSES = COLUMNS.flatMap((c) => c.statuses);
const SORTS = [
  { value: 'newest', label: 'Sort: newest first' },
  { value: 'follow_up', label: 'Sort: follow-up due first' },
  { value: 'activity', label: 'Sort: recently active' },
  { value: 'oldest', label: 'Sort: oldest first' },
  { value: 'company', label: 'Sort: company A–Z' },
];
const CAME_IN = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];
const FOLLOW = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'this_week', label: 'Next 7 days' },
  { value: 'none', label: 'Not set' },
];

function followInfo(l) {
  if (!l.followUpDate) return null;
  const d = istDate(l.followUpDate);
  const t = todayIst();
  const time = l.followUpTime ? ` ${String(l.followUpTime).slice(0, 5)}` : '';
  if (d < t) return { text: `Overdue · ${d}${time}`, tone: 'var(--alert-crit)' };
  if (d === t) return { text: `Today${time}`, tone: 'var(--alert-warn)' };
  return { text: `${d}${time}`, tone: 'var(--ink-2)' };
}

const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

function Owner({ user }) {
  if (!user?.name) return <span className="text-ink-3">Unassigned</span>;
  return (
    <span className="inline-flex items-center" style={{ gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          width: 22, height: 22, borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 10, fontWeight: 700,
        }}
      >
        {initials(user.name)}
      </span>
      {user.name}
    </span>
  );
}

function Card({ l, onOpen, onStatus }) {
  const fu = followInfo(l);
  const tone = GROUP_TONE[columnOf(l.status)];
  return (
    <div
      role="button"
      tabIndex={0}
      className="c-card"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      style={{ padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${tone.fg}` }}
    >
      <div className="text-ink" style={{ fontWeight: 600, lineHeight: 1.3 }}>{l.companyName || l.name}</div>
      <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
        {[l.companyName ? l.name : null, l.phone, l.city].filter(Boolean).join(' · ')}
      </div>
      {need(l) && <div className="text-ink-2" style={{ fontSize: 'var(--d-sm)', marginTop: 6 }}>{need(l)}</div>}
      <div className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 8 }}>
        <LeadStatusChip status={l.status} stage={l.leadStage} onClick={onStatus} compact />
        {fu && <span style={{ fontSize: 'var(--d-sm)', color: fu.tone, fontWeight: 600 }}>Call: {fu.text}</span>}
      </div>
      <div className="flex items-center justify-between text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: 8, gap: 8 }}>
        <Owner user={l.assignedUser} />
        <span>{l.source || ''}</span>
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasPermission, user } = usePermission();
  const canCreate = hasPermission('leads', 'create');
  const canEdit = hasPermission('leads', 'edit');
  const canAssign = hasPermission('lead_assignee_change', 'edit') || (canEdit && ['super_admin', 'admin', 'manager'].includes(user?.role));
  const view = params.get('view') || 'list';
  // Older links used ?status=Hot — open the tab that status belongs to.
  const stageTab = params.get('stage') || (params.get('status') ? columnOf(params.get('status').split(',')[0]) : 'open');
  const sort = params.get('sort') || (view === 'board' ? 'follow_up' : 'newest');
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const [leads, setLeads] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [users, setUsers] = useState([]);
  const [board, setBoard] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [assignTo, setAssignTo] = useState('');
  const [q, setQ] = useState(params.get('search') || '');
  const [statusFor, setStatusFor] = useState(null); // lead
  const [win, setWin] = useState(null); // { lead, status }

  const cameIn = params.get('came_in') || '';
  const load = useCallback(() => {
    setLeads(null);
    const from = cameIn === 'today' ? todayIst() : cameIn ? addDaysIst(-Number(cameIn)) : undefined;
    fetchLeads({
      search: params.get('search') || undefined,
      status: ALL_STATUSES.join(','),
      source: params.get('source') || undefined,
      assigned_to: params.get('owner') || undefined,
      follow_up: params.get('follow_up') || undefined,
      inquiry_type: params.get('inquiry') || undefined,
      date_from: from,
      limit: 3000,
      page: 1,
    }).then(({ data }) => { setLeads(data.leads || []); setTruncated(Boolean(data.truncated) || Number(data.total) > 3000); })
      .catch((e) => { toast.error(leadErr(e, 'Could not load leads')); setLeads([]); });
  }, [params, cameIn]);
  useEffect(() => { load(); }, [load]);
  const loadBoard = useCallback(() => fetchFollowUpBoard().then(({ data }) => setBoard(data)).catch(() => setBoard(null)), []);
  useEffect(() => {
    loadBoard();
    fetchAssignableUsers().then(({ data }) => setUsers(data.users || data.data || [])).catch(() => setUsers([]));
  }, [loadBoard]);
  useEffect(() => { const t = setTimeout(() => { if (q !== (params.get('search') || '')) set('search', q.trim()); }, 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts per pipeline group, then the rows for the chosen tab, sorted.
  const counts = useMemo(() => {
    const c = Object.fromEntries(COLUMNS.map((col) => [col.key, 0]));
    for (const l of leads || []) c[columnOf(l.status)] += 1;
    c.open = (leads || []).length - c.closed;
    c.all = (leads || []).length;
    return c;
  }, [leads]);
  const rows = useMemo(() => {
    const list = (leads || []).filter((l) => {
      const g = columnOf(l.status);
      if (stageTab === 'all') return true;
      if (stageTab === 'open') return g !== 'closed';
      return g === stageTab;
    });
    const by = {
      newest: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
      oldest: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)),
      activity: (a, b) => String(b.lastActivityAt || b.updatedAt).localeCompare(String(a.lastActivityAt || a.updatedAt)),
      company: (a, b) => String(a.companyName || a.name || '').localeCompare(String(b.companyName || b.name || ''), 'en', { sensitivity: 'base' }),
      follow_up: (a, b) => (a.followUpDate ? 0 : 1) - (b.followUpDate ? 0 : 1)
        || String(a.followUpDate || '').localeCompare(String(b.followUpDate || ''))
        || String(b.createdAt).localeCompare(String(a.createdAt)),
    };
    return list.sort(by[sort] || by.newest);
  }, [leads, stageTab, sort]);

  const open = (l) => navigate(`/carret/sell/leads/${l.leadId}`);
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = rows.length > 0 && rows.every((l) => sel.has(l.leadId));
  const doAssign = async () => {
    if (!assignTo || !sel.size) return;
    try { await assignLeads([...sel], Number(assignTo)); toast.success(`${sel.size} lead(s) assigned`); setSel(new Set()); setAssignTo(''); load(); } catch (e) { toast.error(leadErr(e)); }
  };
  const changeStatus = canEdit ? (l) => setStatusFor(l) : null;
  const startWin = async (lead, status) => {
    // The customer form needs the full record (addresses, research), not the list row.
    try { const { data } = await fetchLead(lead.leadId); setWin({ lead: data.lead || data.data || data, status }); } catch (e) { toast.error(leadErr(e)); }
  };
  const afterChange = () => { load(); loadBoard(); };

  const listCols = [
    ...(canAssign ? [{
      key: 'x',
      header: <input type="checkbox" aria-label="Pick every lead shown" checked={allPicked} onChange={() => setSel(allPicked ? new Set() : new Set(rows.map((l) => l.leadId)))} />,
      width: '2.5rem',
      render: (l) => <input type="checkbox" aria-label={`Pick lead ${l.leadId}`} checked={sel.has(l.leadId)} onChange={() => toggle(l.leadId)} onClick={(e) => e.stopPropagation()} />,
    }] : []),
    {
      key: 'c', header: 'Lead',
      render: (l) => <span style={{ fontWeight: 600 }}>{l.companyName || l.name}</span>,
      sub: (l) => [l.companyName ? l.name : null, l.phone, l.city].filter(Boolean).join(' · '),
    },
    {
      key: 'n', header: 'Needs',
      render: (l) => need(l) || <span className="text-ink-3">—</span>,
      sub: (l) => [INQUIRY.find((i) => i.value === l.inquiryType)?.label, Number(l.monthlyBudget) > 0 ? `₹${Number(l.monthlyBudget).toLocaleString('en-IN')}/month budget` : null].filter(Boolean).join(' · ') || null,
    },
    { key: 's', header: 'Status', render: (l) => <LeadStatusChip status={l.status} stage={l.leadStage} onClick={changeStatus && (() => changeStatus(l))} /> },
    {
      key: 'f', header: 'Next call',
      render: (l) => { const fu = followInfo(l); return fu ? <span style={{ color: fu.tone, fontWeight: 600 }}>{fu.text}</span> : <span className="text-ink-3">Not set</span>; },
    },
    { key: 'o', header: 'Owner', render: (l) => <Owner user={l.assignedUser} />, sub: (l) => l.source || null },
    { key: 'a', header: 'Last activity', render: (l) => <DateTime value={l.lastActivityAt || l.updatedAt} />, sub: (l) => (l.createdAt ? `Came in ${istDate(l.createdAt)}` : null) },
  ];

  const filtersSet = ['search', 'owner', 'source', 'inquiry', 'follow_up', 'came_in'].some((k) => params.get(k));
  const clearFilters = () => {
    const p = new URLSearchParams();
    ['view', 'stage', 'sort'].forEach((k) => { if (params.get(k)) p.set(k, params.get(k)); });
    setQ('');
    setParams(p, { replace: true });
  };
  const tabs = [
    { key: 'open', label: 'All open', count: counts.open },
    ...COLUMNS.map((c) => ({ key: c.key, label: c.label, count: counts[c.key] })),
    { key: 'all', label: 'Everything', count: counts.all },
  ];
  const boardCols = COLUMNS.filter((c) => (stageTab === 'open' ? c.key !== 'closed' : stageTab === 'all' ? true : c.key === stageTab));
  const tile = (label, value, tone, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className="c-card text-left"
      style={{ padding: '12px 14px', cursor: 'pointer', borderTop: `3px solid ${tone}` }}
    >
      <div className="text-ink-3 font-ui" style={{ fontSize: 'var(--d-sm)' }}>{label}</div>
      <div className="text-ink font-ui" style={{ fontSize: 'var(--d-title)', fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
    </button>
  );

  return (
    <DeskShell
      title="Leads"
      breadcrumb="Sell"
      subtitle="Every enquiry until it is a customer — calls due first."
      actions={(
        <>
          <Button variant="quiet" onClick={() => navigate('/carret/sell/follow-ups')}>Follow-ups</Button>
          {canCreate && <Button variant="primary" onClick={() => navigate('/carret/sell/leads/new')}>New lead</Button>}
        </>
      )}
    >
      <div className="c-stack">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: 12 }}>
          {tile('Calls overdue', board ? board.overdue.length : '…', 'var(--alert-crit)', () => { set('follow_up', 'overdue'); })}
          {tile('Calls due today', board ? board.today.length : '…', 'var(--alert-warn)', () => { set('follow_up', 'today'); })}
          {tile('Next 7 days', board ? board.upcoming.length : '…', 'var(--lc-idle)', () => { set('follow_up', 'this_week'); })}
          {tile('New — not contacted', leads ? counts.new : '…', 'var(--lc-closed)', () => { set('stage', 'new'); })}
          {tile('In proposal / demo', leads ? counts.proposal : '…', 'var(--alert-serious)', () => { set('stage', 'proposal'); })}
          {tile('Deals', leads ? counts.deal : '…', 'var(--lc-earning)', () => { set('stage', 'deal'); })}
        </div>

        {board && board.overdue.length > 0 && params.get('follow_up') !== 'overdue' && (
          <Notice tone="warn" title={`${board.overdue.length} call(s) overdue`} action={<Button onClick={() => navigate('/carret/sell/follow-ups')}>Do them now</Button>}>
            The oldest is {board.overdue[0].company_name || board.overdue[0].name}.
          </Notice>
        )}

        <Panel
          toolbar={(
            <>
              <Tabs tabs={tabs} value={stageTab} onChange={(v) => { set('stage', v === 'open' ? '' : v); setSel(new Set()); }} />
              <FilterBar
                filters={[
                  { key: 'search', label: 'Search', type: 'search', placeholder: 'Name, company, phone, email, city' },
                  ...(users.length ? [{ key: 'owner', label: 'Owner', options: [{ value: 'me', label: 'Mine' }, { value: 'unassigned', label: 'Unassigned' }, ...users.map((u) => ({ value: String(u.user_id), label: u.name }))] }] : []),
                  { key: 'source', label: 'Source', options: SOURCES.map((s) => ({ value: s, label: s })) },
                  { key: 'inquiry', label: 'Enquiry', options: INQUIRY },
                  { key: 'follow_up', label: 'Next call', options: FOLLOW },
                  { key: 'came_in', label: 'Came in', options: CAME_IN },
                ]}
                values={{
                  search: q, owner: params.get('owner') || '', source: params.get('source') || '', inquiry: params.get('inquiry') || '',
                  follow_up: params.get('follow_up') || '', came_in: cameIn,
                }}
                onChange={(k, v) => (k === 'search' ? setQ(v) : set(k, v))}
                onClear={filtersSet ? clearFilters : undefined}
                count={leads ? `${rows.length} lead${rows.length === 1 ? '' : 's'}` : null}
                right={(
                  <span className="inline-flex items-center" style={{ gap: 8 }}>
                    <Select value={sort} onChange={(e) => set('sort', e.target.value)} options={SORTS} aria-label="Sort" />
                    <Segmented value={view} onChange={(v) => set('view', v === 'list' ? '' : v)} options={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} label="View" />
                  </span>
                )}
              />
            </>
          )}
        >
          {truncated && <Notice tone="info">Showing the first {leads?.length} — narrow the filters to see the rest.</Notice>}
          {leads === null ? <EmptyState title="Loading leads…" /> : view === 'list' ? (
            <>
              {canAssign && sel.size > 0 && (
                <div className="flex items-center flex-wrap" style={{ gap: 8, padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 'var(--d-radius)', margin: '8px 0' }}>
                  <strong>{sel.size} picked</strong><span>— assign to</span>
                  <div style={{ minWidth: '14rem' }}>
                    <SearchSelect value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder="Type a name…" options={users.map((u) => ({ value: String(u.user_id), label: u.name }))} aria-label="Assign to" />
                  </div>
                  <Button variant="primary" disabled={!assignTo} onClick={doAssign}>Assign</Button>
                  <Button variant="quiet" onClick={() => setSel(new Set())}>Clear</Button>
                </div>
              )}
              <DataTable
                columns={listCols}
                rows={rows}
                rowKey={(l) => l.leadId}
                onRowClick={open}
                empty={<EmptyState title="No leads match" body={filtersSet ? 'Clear a filter or pick another tab.' : undefined} />}
              />
            </>
          ) : (
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(16rem, 1fr)', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
              {boardCols.map((c) => {
                const colRows = rows.filter((l) => columnOf(l.status) === c.key);
                const tone = GROUP_TONE[c.key];
                return (
                  <section key={c.key} aria-label={c.label} style={{ background: 'var(--surface-2)', borderRadius: 'var(--d-radius-lg)', padding: 8, minWidth: '16rem' }}>
                    <header className="flex items-center justify-between" style={{ padding: '6px 8px', marginBottom: 8, borderRadius: 'var(--d-radius)', background: tone.bg, color: tone.fg }}>
                      <strong className="font-ui">{c.label}</strong>
                      <span className="font-ui" style={{ fontWeight: 700 }}>{colRows.length}</span>
                    </header>
                    <div className="c-stack" style={{ gap: 8 }}>
                      {colRows.slice(0, 60).map((l) => <Card key={l.leadId} l={l} onOpen={() => open(l)} onStatus={changeStatus && (() => changeStatus(l))} />)}
                      {colRows.length > 60 && <Button variant="quiet" onClick={() => { set('view', ''); set('stage', c.key); }}>{colRows.length - 60} more — open as a list</Button>}
                      {colRows.length === 0 && <p className="text-ink-3 font-ui m-0" style={{ padding: 8, fontSize: 'var(--d-sm)' }}>Nothing here</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <StatusDrawer
        lead={statusFor}
        open={Boolean(statusFor)}
        onClose={() => setStatusFor(null)}
        onDone={afterChange}
        onWin={(status) => { const l = statusFor; setStatusFor(null); startWin(l, status); }}
      />
      {win && (
        <WinDrawer lead={win.lead} status={win.status} open onClose={() => setWin(null)} onDone={() => { setWin(null); afterChange(); }} />
      )}
    </DeskShell>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import { Button, EmptyState, Notice, Section } from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { fetchMyWork, fetchTeamWork } from './serveApi';
import { SLA_LABEL, SLA_TONE, TECH_TABS, errMsg, mapsLink, when } from './serveShared';

/**
 * Serve → My work (the support technician's phone, claude/carret-support.md S2/S4).
 *
 * Every support job assigned to me — complaint visits and return pickups — in
 * appointment order, then most urgent. A card shows who, where, when and the
 * one next step; Call and Map are one tap. Deliveries and parts are the other
 * two tabs.
 *
 * A support lead / admin usually has no jobs of their own, so they land on the
 * team view: who holds how many open jobs, how many are late, and how many are
 * waiting for anyone at all. Tapping a technician shows that person's list,
 * read-only (the buttons open the ticket instead of the technician's steps).
 */
const LEAD_ROLES = ['super_admin', 'admin', 'manager', 'support_lead'];
function JobCard({ job, readOnly }) {
  const navigate = useNavigate();
  const sla = job.sla?.state && job.sla.state !== 'n/a' ? job.sla : null;
  const laptop = [job.laptop.brand, job.laptop.model].filter(Boolean).join(' ');
  return (
    <div className="c-card" style={{ padding: '14px 16px', marginBottom: '12px' }}>
      <div className="flex items-start justify-between" style={{ gap: '8px' }}>
        <div className="min-w-0">
          <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
            {job.kind === 'pickup' ? (job.pickup_type === 'repair' ? 'Repair pickup' : 'Return pickup') : 'Visit'} · Ticket #{job.ticket_id}{job.priority !== 'normal' ? ` · ${job.priority}` : ''}
          </div>
          <div className="text-ink" style={{ fontWeight: 600, fontSize: 'var(--d-lg)' }}>{job.customer}</div>
          {job.contact_name && <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>Raised by {job.contact_name}</div>}
        </div>
        {sla && <span style={{ color: SLA_TONE[sla.state], fontWeight: 600, fontSize: 'var(--d-sm)', whiteSpace: 'nowrap' }}>{SLA_LABEL[sla.state] || sla.state}{sla.due_at && sla.state !== 'breached' ? ` · due ${when(sla.due_at)}` : ''}</span>}
      </div>
      <div style={{ marginTop: '8px', fontSize: 'var(--d-sm)' }}>
        <span className="font-mono">{job.laptop.ttspl || job.laptop.serial || '—'}</span>
        {laptop && <span className="text-ink-3"> · {laptop}</span>}
        {job.issue && <span className="text-ink-3"> · {job.issue}</span>}
      </div>
      {job.appointment && <div style={{ marginTop: '4px' }}>🗓 {when(job.appointment)}</div>}
      <div className="text-ink-2" style={{ marginTop: '4px' }}>{job.address || 'No address on the ticket'}</div>
      {job.remarks && <div className="text-ink-2" style={{ marginTop: '4px', fontSize: 'var(--d-sm)' }}>“{job.remarks}”</div>}
      <div className="flex flex-wrap items-center" style={{ gap: '8px', marginTop: '12px' }}>
        {job.phone && <a className="c-btn" href={`tel:${job.phone}`}>Call</a>}
        {job.address && <a className="c-btn" href={mapsLink(job.address, job.customer)} target="_blank" rel="noopener noreferrer">Map</a>}
        {readOnly ? (
          <>
            <span className="text-ink-3" style={{ marginLeft: 'auto', fontSize: 'var(--d-sm)' }}>Next: {job.next.label}</span>
            <Button onClick={() => navigate(`/carret/serve/tickets/${job.ticket_id}`)}>Open ticket ›</Button>
          </>
        ) : (
          <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/carret/serve/job/${job.item_id}`)}>{job.next.label} ›</Button>
        )}
      </div>
    </div>
  );
}

function JobList({ jobs, readOnly, onRefresh, emptyTitle, emptyBody }) {
  const late = jobs.filter((j) => j.sla?.state === 'breached').length;
  return (
    <>
      {late > 0 && <Notice tone="warn" title={`${late} of ${jobs.length} job(s) are late`}>Late jobs come first, after any with a visit slot booked.</Notice>}
      {jobs.length === 0
        ? <EmptyState title={emptyTitle} body={emptyBody} action={<Button onClick={onRefresh}>Refresh</Button>} />
        : jobs.map((j) => <JobCard key={j.item_id} job={j} readOnly={readOnly} />)}
      {jobs.length > 0 && <div style={{ textAlign: 'center', margin: '8px 0 24px' }}><Button variant="quiet" onClick={onRefresh}>Refresh</Button></div>}
    </>
  );
}

function TeamView({ team, mine, onPick }) {
  if (!team) return <EmptyState title="Loading…" />;
  const num = { fontSize: '22px', fontWeight: 600, lineHeight: 1.1 };
  return (
    <div className="c-stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
        <div className="c-card" style={{ padding: '12px' }}><div style={num}>{team.total}</div><div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>open jobs with technicians</div></div>
        <div className="c-card" style={{ padding: '12px' }}><div style={{ ...num, color: team.late ? 'var(--alert-crit)' : undefined }}>{team.late}</div><div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>late</div></div>
        <div className="c-card" style={{ padding: '12px' }}><div style={{ ...num, color: team.unassigned ? 'var(--alert-warn)' : undefined }}>{team.unassigned}</div><div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>waiting for a technician</div></div>
      </div>
      {team.unassigned > 0 && (
        <Notice tone="warn" title={`${team.unassigned} job(s) have no technician`} action={<Link className="c-btn" to="/carret/serve/queue">Assign from the queue</Link>}>
          They are ready to go but nobody is assigned, so they show on no one&apos;s list.
        </Notice>
      )}
      <Section title="Technicians">
        {team.technicians.length === 0 ? <EmptyState title="No open jobs with any technician" /> : (
          <div className="c-stack" style={{ gap: '0' }}>
            {team.technicians.map((t) => (
              <button
                key={t.user_id}
                type="button"
                onClick={() => onPick(t.user_id)}
                className="flex items-center justify-between w-full text-left"
                style={{ gap: '12px', padding: '12px 4px', background: 'none', border: 0, borderBottom: '1px solid var(--rule)', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
              >
                <div className="min-w-0">
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
                    {[t.visits && `${t.visits} visit${t.visits > 1 ? 's' : ''}`, t.pickups && `${t.pickups} pickup${t.pickups > 1 ? 's' : ''}`, t.today && `${t.today} booked today`].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex items-center" style={{ gap: '12px', whiteSpace: 'nowrap' }}>
                  {t.late > 0 && <span style={{ color: 'var(--alert-crit)', fontWeight: 600, fontSize: 'var(--d-sm)' }}>{t.late} late</span>}
                  <span style={{ fontWeight: 600 }}>{t.jobs}</span>
                  <span className="text-ink-3">›</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>
      {mine !== null && mine.length > 0 && (
        <Notice tone="info" title={`You have ${mine.length} job(s) of your own`} action={<Button onClick={() => onPick('me')}>Show mine</Button>} />
      )}
    </div>
  );
}

export default function MyWorkPage() {
  const { user } = usePermission();
  const isLead = LEAD_ROLES.includes(user?.role);
  const [params, setParams] = useSearchParams();
  // Lead: ?tech=<id> is one technician's list, ?tech=me is their own, nothing is the team view.
  const tech = params.get('tech');
  const view = !isLead ? 'me' : (tech || 'team');
  const [jobs, setJobs] = useState(null);
  const [mine, setMine] = useState(null);
  const [team, setTeam] = useState(null);

  const load = useCallback(() => {
    if (view === 'team') {
      setTeam(null);
      fetchTeamWork().then(({ data }) => setTeam(data)).catch((e) => { setTeam({ technicians: [], total: 0, late: 0, unassigned: 0 }); toast.error(errMsg(e, 'Could not load the team')); });
      fetchMyWork().then(({ data }) => setMine(data.jobs || [])).catch(() => setMine([]));
      return;
    }
    setJobs(null);
    fetchMyWork(view === 'me' ? undefined : view)
      .then(({ data }) => setJobs(data.jobs || []))
      .catch((e) => { setJobs([]); toast.error(errMsg(e, 'Could not load the work')); });
  }, [view]);
  useEffect(() => { load(); }, [load]);

  const pick = (id) => setParams(id ? { tech: String(id) } : {});
  const techName = view !== 'team' && view !== 'me' ? (team?.technicians.find((t) => String(t.user_id) === view)?.name || jobs?.[0]?.assignee_name) : null;
  const title = view === 'team' ? 'Team work' : (techName ? `${techName}'s work` : 'My work');

  return (
    <FieldShell title={title} tabs={TECH_TABS} onBack={() => (isLead && view !== 'team' ? pick(null) : window.history.back())}>
      {isLead && view !== 'team' && (
        <div style={{ marginBottom: '12px' }}><Button variant="quiet" onClick={() => pick(null)}>‹ All technicians</Button></div>
      )}
      {view === 'team' ? <TeamView team={team} mine={mine} onPick={pick} /> : (
        jobs === null ? <EmptyState title="Loading…" /> : (
          <JobList
            jobs={jobs}
            readOnly={view !== 'me'}
            onRefresh={load}
            emptyTitle={view === 'me' ? 'Nothing assigned to you' : 'No open jobs'}
            emptyBody={view === 'me' ? 'New jobs appear here as soon as your lead assigns them.' : 'This technician has nothing open right now.'}
          />
        )
      )}
    </FieldShell>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import { Button, EmptyState, Notice } from '../../../components/carret';
import { fetchMyWork } from './serveApi';
import { SLA_LABEL, SLA_TONE, TECH_TABS, errMsg, mapsLink, when } from './serveShared';

/**
 * Serve → My work (the support technician's phone, claude/carret-support.md S2/S4).
 *
 * Every support job assigned to me — complaint visits and return pickups — in
 * appointment order, then most urgent. A card shows who, where, when and the
 * one next step; Call and Map are one tap. Deliveries and parts are the other
 * two tabs.
 */
function JobCard({ job }) {
  const navigate = useNavigate();
  const sla = job.sla?.state && job.sla.state !== 'n/a' ? job.sla : null;
  return (
    <div className="c-card" style={{ padding: '14px 16px', marginBottom: '12px' }}>
      <div className="flex items-start justify-between" style={{ gap: '8px' }}>
        <div className="min-w-0">
          <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
            {job.kind === 'pickup' ? 'Pickup' : 'Visit'} · #{job.ticket_id}{job.priority !== 'normal' ? ` · ${job.priority}` : ''}
          </div>
          <div className="text-ink" style={{ fontWeight: 600, fontSize: 'var(--d-lg)' }}>{job.customer}</div>
        </div>
        {sla && <span style={{ color: SLA_TONE[sla.state], fontWeight: 600, fontSize: 'var(--d-sm)', whiteSpace: 'nowrap' }}>{SLA_LABEL[sla.state] || sla.state}</span>}
      </div>
      {job.appointment && <div style={{ marginTop: '4px' }}>🗓 {when(job.appointment)}</div>}
      <div className="text-ink-2" style={{ marginTop: '4px' }}>{job.address || 'No address on the ticket'}</div>
      <div className="text-ink-3" style={{ marginTop: '4px', fontSize: 'var(--d-sm)' }}>
        {[job.laptop.brand, job.laptop.model].filter(Boolean).join(' ')} · <span className="font-mono">{job.laptop.ttspl || job.laptop.serial || '—'}</span>
        {job.issue ? ` · ${job.issue}` : ''}
      </div>
      {job.remarks && <div className="text-ink-2" style={{ marginTop: '4px', fontSize: 'var(--d-sm)' }}>“{job.remarks}”</div>}
      <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '12px' }}>
        {job.phone && <a className="c-btn" href={`tel:${job.phone}`}>Call</a>}
        {job.address && <a className="c-btn" href={mapsLink(job.address, job.customer)} target="_blank" rel="noopener noreferrer">Map</a>}
        <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => navigate(`/carret/serve/job/${job.item_id}`)}>{job.next.label} ›</Button>
      </div>
    </div>
  );
}

export default function MyWorkPage() {
  const [jobs, setJobs] = useState(null);
  const load = useCallback(() => {
    fetchMyWork().then(({ data }) => setJobs(data.jobs || [])).catch((e) => { setJobs([]); toast.error(errMsg(e, 'Could not load your work')); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const late = (jobs || []).filter((j) => j.sla?.state === 'breached').length;
  return (
    <FieldShell title="My work" tabs={TECH_TABS} onBack={() => window.history.back()}>
      {jobs === null ? <EmptyState title="Loading…" /> : (
        <>
          {late > 0 && <Notice tone="warn" title={`${late} job(s) are late`}>They are at the top where there is no appointment ahead of them.</Notice>}
          {jobs.length === 0
            ? <EmptyState title="Nothing assigned to you" body="New jobs appear here as soon as your lead assigns them." action={<Button onClick={load}>Refresh</Button>} />
            : jobs.map((j) => <JobCard key={j.item_id} job={j} />)}
          {jobs.length > 0 && <div style={{ textAlign: 'center', margin: '8px 0 24px' }}><Button variant="quiet" onClick={load}>Refresh</Button></div>}
        </>
      )}
    </FieldShell>
  );
}

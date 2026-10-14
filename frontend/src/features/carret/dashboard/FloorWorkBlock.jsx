import React from 'react';
import {
  Button, DataTable, EmptyState, Section, StatTile,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';

/**
 * Today page → floor work counts (migration 425).
 *
 *   mine  (floor_my_work)   a technician / QC inspector's own counts
 *   team  (floor_team_work) every floor team member's counts — floor managers
 *
 * "Right now" counts open the floor board on exactly those laptops; the
 * finished-on-the-day counts are figures (the incentive pages explain them).
 */
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const board = (params) => `/carret/produce/floor?${new URLSearchParams(params).toString()}`;

function Tile({ label, value, delta, to, onOpen, family }) {
  const body = <StatTile label={label} value={fmt(value)} delta={delta} family={family} />;
  if (!to) return body;
  return (
    <button type="button" onClick={() => onOpen(to)} className="text-left bg-transparent border-0 p-0 cursor-pointer" style={{ minWidth: 0 }} title={`Open the laptops behind “${label}”`}>
      {body}
    </button>
  );
}

function MyWork({ mine, dayLabel, onOpen }) {
  const { hasPermission } = usePermission();
  if (mine.unavailable) return <Section title="My floor work"><EmptyState title="Could not load" body={mine.unavailable} /></Section>;
  const live = !mine.live_unavailable;
  return (
    <Section
      title="My floor work"
      actions={hasPermission('my_performance', 'view') && <Button variant="quiet" onClick={() => onOpen('/carret/produce/my-performance?period=month')}>My performance →</Button>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
        <Tile label="Assigned to me" value={mine.assigned} delta={live ? 'open laptops with me now' : mine.live_unavailable} to={live ? board({ view: 'mine' }) : null} onOpen={onOpen} />
        <Tile label="Waiting for Start work" value={mine.waiting_start} delta={live ? 'scan the laptop to begin' : mine.live_unavailable} to={live && mine.waiting_start ? board({ view: 'mine' }) : null} onOpen={onOpen} family={mine.waiting_start ? 'moving' : undefined} />
        <Tile label="Timer running" value={mine.timer_running} delta={live ? 'work started, not finished' : mine.live_unavailable} to={live && mine.timer_running ? board({ view: 'mine' }) : null} onOpen={onOpen} />
        <Tile label="Sent back by QC" value={mine.sent_back} delta={live ? 'failed QC — fix and send on' : mine.live_unavailable} to={live && mine.sent_back ? board({ view: 'mine' }) : null} onOpen={onOpen} family={mine.sent_back ? 'offcycle' : undefined} />
        <Tile label={`Stages finished ${dayLabel}`} value={mine.stages_done} delta="Diagnosis, repair, assembly, testing" />
        <Tile label={`Laptops finished ${dayLabel}`} value={mine.laptops_done} delta="Final Testing done — counts for incentive" family={mine.laptops_done ? 'earning' : undefined} />
        {mine.qc_checks > 0 && <Tile label={`QC checks ${dayLabel}`} value={mine.qc_checks} delta="QC1, QC2 and Dispatch QC" />}
      </div>
      {live && mine.by_stage?.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: '8px', marginTop: '12px' }}>
          {mine.by_stage.map((s) => (
            <Button key={s.stage} variant="quiet" onClick={() => onOpen(board({ view: 'mine', stage: s.stage }))}>
              {s.stage} <span className="tabular-nums text-ink-3">{fmt(s.count)}</span>
            </Button>
          ))}
        </div>
      )}
    </Section>
  );
}

function TeamWork({ team, dayLabel, onOpen }) {
  if (team.unavailable) return <Section title="Floor team"><EmptyState title="Could not load" body={team.unavailable} /></Section>;
  const members = team.members || [];
  const live = !members.some((m) => m.live_unavailable);
  const sum = (k) => members.reduce((s, m) => s + (Number(m[k]) || 0), 0);
  return (
    <Section title={`Floor team · ${members.length}`}>
      <p className="text-ink-3" style={{ margin: '0 0 8px', fontSize: '13px' }}>
        {live ? 'Open laptops with each person now, and what they finished ' : 'What each person finished '}{dayLabel}. Click a person to open their laptops on the floor.
      </p>
      <DataTable
        rows={members}
        rowKey={(m) => m.user_id}
        onRowClick={live ? (m) => onOpen(board({ view: 'queue', assignee: m.user_id, who: m.name })) : undefined}
        empty={<EmptyState title="No floor team members" />}
        columns={[
          { key: 'n', header: 'Person', render: (m) => <span style={{ whiteSpace: 'nowrap' }}>{m.name}</span>, sub: (m) => m.role },
          ...(live ? [
            { key: 'a', header: 'Assigned', numeric: true, render: (m) => <b>{fmt(m.assigned)}</b> },
            {
              key: 'st',
              header: 'At stages',
              render: (m) => (m.by_stage?.length
                ? <span style={{ display: 'inline-block', minWidth: '15rem', whiteSpace: 'normal', fontSize: '13px' }}>{m.by_stage.map((s) => `${s.stage.replace(' & Software', '')} ${s.count}`).join(' · ')}</span>
                : <span className="text-ink-3">—</span>),
            },
            { key: 'w', header: 'Waiting start', numeric: true, render: (m) => fmt(m.waiting_start) },
            { key: 't', header: 'Timer running', numeric: true, render: (m) => fmt(m.timer_running) },
            { key: 'b', header: 'Sent back by QC', numeric: true, render: (m) => (m.sent_back ? <b style={{ color: 'var(--alert-crit)' }}>{fmt(m.sent_back)}</b> : 0) },
          ] : []),
          { key: 's', header: `Stages ${dayLabel}`, numeric: true, render: (m) => fmt(m.stages_done) },
          { key: 'l', header: `Laptops ${dayLabel}`, numeric: true, render: (m) => <b>{fmt(m.laptops_done)}</b> },
          { key: 'q', header: `QC checks ${dayLabel}`, numeric: true, render: (m) => fmt(m.qc_checks) },
        ]}
      />
      <p className="text-ink-3" style={{ margin: '8px 0 0', fontSize: '13px' }}>
        Team {dayLabel}: {fmt(sum('stages_done'))} stages, {fmt(sum('laptops_done'))} laptops finished, {fmt(sum('qc_checks'))} QC checks
        {live ? ` · ${fmt(sum('assigned'))} open laptops, ${fmt(sum('sent_back'))} sent back by QC` : ''}.
      </p>
    </Section>
  );
}

export default function FloorWorkBlock({ data, dayLabel, onOpen }) {
  if (!data) return null;
  return (
    <>
      {data.mine && <MyWork mine={data.mine} dayLabel={dayLabel} onOpen={onOpen} />}
      {data.team && <TeamWork team={data.team} dayLabel={dayLabel} onOpen={onOpen} />}
    </>
  );
}

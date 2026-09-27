import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, Drawer, EmptyState, Input, Section, StatTile,
} from '../../../components/carret';
import { fetchTechBucketBoard, fetchTechnicians } from './serveApi';
import { errMsg, when } from './serveShared';

/**
 * Serve → Technician bucket (claude/carret-support.md rework D).
 *
 * What every technician is holding or owes right now: open visits, pickups to
 * collect, laptops collected but not in at the gate, Service DC / replacement
 * deliveries out with them, parts issued, and old parts to bring back — each
 * with how many days it has been sitting. Every support technician is listed
 * (the old Technicians screen), with today's visits. A technician sees only
 * their own.
 */
const LATE = 7; // days before something in hand is flagged

const COLS = [
  { key: 'in_hand', label: 'Laptops in hand' },
  { key: 'old_parts', label: 'Old parts to return' },
  { key: 'to_collect', label: 'To collect' },
  { key: 'deliveries', label: 'Out for delivery' },
  { key: 'parts', label: 'Parts held' },
  { key: 'visits', label: 'Open visits' },
];

function Count({ n, late }) {
  if (!n) return <span className="text-ink-3">—</span>;
  return <strong style={{ color: late ? 'var(--alert-bad, #b91c1c)' : 'inherit' }}>{n}</strong>;
}

const days = (d) => (d == null ? '—' : `${d} day${d === 1 ? '' : 's'}`);

export default function TechBucketPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    Promise.all([
      fetchTechBucketBoard().then(({ data: d }) => d),
      fetchTechnicians().then(({ data: d }) => d.technicians || []).catch(() => []),
    ]).then(([board, list]) => {
      const empty = { visits: [], to_collect: [], in_hand: [], deliveries: [], parts: [], old_parts: [] };
      const rows = [...(board.technicians || [])];
      if (board.supervisor) {
        for (const t of list.filter((x) => x.assignee_kind === 'technician')) {
          if (!rows.some((r) => r.user_id === t.user_id)) {
            rows.push({ user_id: t.user_id, name: t.name, phone: t.mobile_no, ...empty, counts: Object.fromEntries(Object.keys(empty).map((k) => [k, 0])), oldest_days: 0 });
          }
        }
      }
      const today = Object.fromEntries(list.map((t) => [t.user_id, t.today_visits || 0]));
      setData({ ...board, technicians: rows.map((r) => ({ ...r, today: today[r.user_id] || 0 })) });
    }).catch((e) => { toast.error(errMsg(e, 'Could not load the bucket')); setData({ technicians: [] }); });
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.technicians || []).filter((t) => !q || String(t.name || '').toLowerCase().includes(q));
  }, [data, search]);

  const total = (k) => (data?.technicians || []).reduce((n, t) => n + (t.counts[k] || 0), 0);
  const lateIn = (t, k) => (t[k] || []).some((x) => (x.days || 0) > LATE);

  const tech = open && (data?.technicians || []).find((t) => t.user_id === open);
  const toTicket = (id) => navigate(`/carret/serve/tickets/${id}`);
  const ticketBtn = (x) => <Button variant="quiet" onClick={() => toTicket(x.ticket_id)}>#{x.ticket_id}</Button>;
  const ageCol = { key: 'd', header: 'Since', render: (x) => <span style={{ color: (x.days || 0) > LATE ? 'var(--alert-bad, #b91c1c)' : undefined, fontWeight: (x.days || 0) > LATE ? 600 : 400 }}>{days(x.days)}</span>, sub: (x) => (x.since ? <DateTime value={x.since} /> : null) };
  const laptopCol = { key: 'l', header: 'Laptop', render: (x) => <span className="font-mono">{x.ttspl || '—'}</span>, sub: (x) => x.model || x.customer };

  return (
    <DeskShell title="Technician bucket" breadcrumb="Support" subtitle="What each technician is holding or owes — oldest and in-hand first.">
      <div className="c-stack">
        <div className="c-form-grid" style={{ '--c-cols': 6 }}>
          {COLS.map((c) => <StatTile key={c.key} label={c.label} value={data ? total(c.key) : '…'} />)}
        </div>
        <Section title={`Technicians · ${rows.length}`} actions={<Input type="search" placeholder="Technician" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '14rem' }} aria-label="Search" />}>
          {data === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={[
                { key: 'n', header: 'Technician', render: (t) => t.name, sub: (t) => [t.phone, t.today ? `${t.today} visit(s) today` : null].filter(Boolean).join(' · ') || null },
                ...COLS.map((c) => ({ key: c.key, header: c.label, render: (t) => <Count n={t.counts[c.key]} late={lateIn(t, c.key)} /> })),
                { key: 'o', header: 'Oldest', render: (t) => <span style={{ color: t.oldest_days > LATE ? 'var(--alert-bad, #b91c1c)' : undefined }}>{days(t.oldest_days)}</span> },
              ]}
              rows={rows}
              rowKey={(t) => t.user_id}
              onRowClick={(t) => setOpen(t.user_id)}
              empty={<EmptyState title="Nobody is holding anything" />}
            />
          )}
        </Section>
      </div>

      <Drawer open={Boolean(tech)} onClose={() => setOpen(null)} title={tech ? `${tech.name}` : ''} width="48rem">
        {tech && (
          <div className="c-stack">
            {tech.in_hand.length > 0 && (
              <Section title={`Laptops in hand · ${tech.in_hand.length}`}>
                <DataTable columns={[laptopCol, { key: 'k', header: 'Pickup', render: (x) => x.kind, sub: (x) => x.return_dc_number }, ageCol, { key: 't', header: '', render: ticketBtn }]} rows={tech.in_hand} rowKey={(x) => x.item_id} />
              </Section>
            )}
            {tech.old_parts.length > 0 && (
              <Section title={`Old parts to return · ${tech.old_parts.length}`}>
                <DataTable columns={[{ key: 'p', header: 'Part', render: (x) => x.part, sub: (x) => x.prt_id || x.request_number }, laptopCol, ageCol, { key: 't', header: '', render: ticketBtn }]} rows={tech.old_parts} rowKey={(x) => x.request_id} />
              </Section>
            )}
            {tech.to_collect.length > 0 && (
              <Section title={`To collect · ${tech.to_collect.length}`}>
                <DataTable columns={[laptopCol, { key: 'k', header: 'Pickup', render: (x) => x.kind, sub: (x) => x.return_dc_number }, ageCol, { key: 't', header: '', render: ticketBtn }]} rows={tech.to_collect} rowKey={(x) => x.item_id} />
              </Section>
            )}
            {tech.deliveries.length > 0 && (
              <Section title={`Out for delivery · ${tech.deliveries.length}`}>
                <DataTable
                  columns={[
                    { key: 'n', header: 'DC', render: (x) => <span className="font-mono">{x.dc_number}</span>, sub: (x) => x.purpose },
                    { key: 'c', header: 'Customer', render: (x) => x.customer, sub: (x) => `${x.qty} laptop(s) · ${String(x.status || '').replace(/_/g, ' ')}` },
                    ageCol,
                    { key: 'o', header: '', render: (x) => <Button variant="quiet" onClick={() => navigate(`/carret/move/challans/${encodeURIComponent(x.dc_number)}`)}>Open DC</Button> },
                  ]}
                  rows={tech.deliveries}
                  rowKey={(x) => x.dc_number}
                />
              </Section>
            )}
            {tech.parts.length > 0 && (
              <Section title={`Parts held · ${tech.parts.length}`}>
                <DataTable columns={[{ key: 'p', header: 'Part', render: (x) => x.part, sub: (x) => x.prt_id || x.request_number }, laptopCol, { key: 's', header: 'State', render: (x) => x.state }, ageCol, { key: 't', header: '', render: ticketBtn }]} rows={tech.parts} rowKey={(x) => x.request_id} />
              </Section>
            )}
            {tech.visits.length > 0 && (
              <Section title={`Open visits · ${tech.visits.length}`}>
                <DataTable columns={[laptopCol, { key: 's', header: 'Where', render: (x) => x.step, sub: (x) => (x.appointment ? `🗓 ${when(x.appointment)}` : x.customer) }, ageCol, { key: 't', header: '', render: ticketBtn }]} rows={tech.visits} rowKey={(x) => x.item_id} />
              </Section>
            )}
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

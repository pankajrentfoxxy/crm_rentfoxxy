import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  DataTable, DateTime, Drawer, EmptyState, Input, Notice, Segmented, StatTile,
} from '../../../components/carret';
import { fetchRoles, fetchTeamList, fetchTeamMembers } from './controlApi';
import { ACCESS, errMsg, roleLabel, useControlAccess } from './controlShared';

/**
 * Control → Teams. The floor teams, who manages each and who is in it.
 *
 * The old /teams screen only redirected to Users ("assign users to teams from
 * the User edit drawer") — membership is still changed there, so this page
 * lists the teams and their members and links each member to Users. Member
 * counts include people who joined through an extra team (user_teams), the
 * same rule the member list uses.
 */
const ORDER = [
  { value: 'floor', label: 'Floor order' },
  { value: 'newest', label: 'Newest first' },
  { value: 'name', label: 'A–Z' },
];

export default function TeamsPage() {
  const can = useControlAccess();
  const canSeeUsers = can(ACCESS.usersView);
  const canEditUsers = can(ACCESS.usersEdit);
  const [teams, setTeams] = useState(null);
  const [roles, setRoles] = useState([]);
  const [q, setQ] = useState('');
  const [order, setOrder] = useState('floor');
  const [open, setOpen] = useState(null);
  const [members, setMembers] = useState(null);
  const [mq, setMq] = useState('');

  useEffect(() => {
    fetchTeamList()
      .then(({ data }) => setTeams(data.teams || []))
      .catch((e) => { setTeams([]); toast.error(errMsg(e, 'Could not load teams')); });
    // Role names only make the member list readable; fine if not allowed.
    fetchRoles().then(({ data }) => setRoles(data.roles || [])).catch(() => setRoles([]));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setMembers(null);
    setMq('');
    fetchTeamMembers(open.team_id)
      .then(({ data }) => { if (live) setMembers(data.members || []); })
      .catch((e) => { if (live) { setMembers([]); toast.error(errMsg(e, 'Could not load members')); } });
    return () => { live = false; };
  }, [open]);

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = (teams || []).filter((t) => {
      const hay = `${t.team_name || ''} ${t.manager_name || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (order === 'newest') return [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || Number(b.team_id) - Number(a.team_id));
    if (order === 'name') return [...list].sort((a, b) => String(a.team_name).localeCompare(String(b.team_name)));
    return list; // server order = the floor's stage order
  }, [teams, q, order]);

  const shownMembers = useMemo(() => {
    const words = mq.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (members || []).filter((m) => {
      const hay = `${m.name || ''} ${m.email || ''} ${m.role || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [members, mq]);

  const totalMembers = (teams || []).reduce((s, t) => s + Number(t.member_count || 0), 0);
  const empty = (teams || []).filter((t) => Number(t.member_count || 0) === 0).length;

  const cols = [
    { key: 'n', header: 'Team', render: (t) => t.team_name },
    { key: 'm', header: 'Manager', render: (t) => t.manager_name || '—' },
    { key: 'c', header: 'Members', numeric: true, render: (t) => Number(t.member_count || 0) },
    { key: 'd', header: 'Created', render: (t) => (t.created_at ? <DateTime value={t.created_at} /> : '—') },
  ];

  const memberCols = [
    { key: 'n', header: 'Name', render: (m) => m.name, sub: (m) => m.email },
    { key: 'r', header: 'Role', render: (m) => roleLabel(roles, m.role) },
    { key: 'd', header: 'Since', render: (m) => (m.created_at ? <DateTime value={m.created_at} /> : '—') },
  ];

  return (
    <DeskShell title="Teams" breadcrumb="Control" subtitle="Floor teams, their managers and members.">
      <div className="c-stack">
        {teams && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            <StatTile label="Teams" value={teams.length} />
            <StatTile label="Memberships" value={totalMembers} />
            <StatTile label="Teams with nobody" value={empty} family={empty ? 'offcycle' : undefined} />
          </div>
        )}
        <Notice tone="info">
          People join or leave a team from their user record{canSeeUsers ? <> in <Link to="/carret/control/users">Control → Users</Link></> : ' (Control → Users)'}.
          A person can be in more than one team.
        </Notice>
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Order" value={order} onChange={setOrder} options={ORDER} />
          <Input type="search" placeholder="Team or manager" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} aria-label="Search teams" />
        </div>
        {teams === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(t) => t.team_id}
            onRowClick={setOpen}
            empty={<EmptyState title="No teams match" />}
          />
        )}
      </div>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open ? `${open.team_name} — members` : ''} width="36rem">
        {open && (
          <div className="c-stack">
            <p className="text-ink-3">Manager: {open.manager_name || 'none set'}</p>
            <Input type="search" placeholder="Name, email or role" value={mq} onChange={(e) => setMq(e.target.value)} aria-label="Search members" />
            {members === null ? <EmptyState title="Loading…" /> : (
              <DataTable
                columns={memberCols}
                rows={shownMembers}
                rowKey={(m) => m.user_id}
                empty={<EmptyState title="Nobody in this team" />}
              />
            )}
            {canEditUsers && (
              <p className="text-ink-3">To add or remove someone, open <Link to="/carret/control/users">Users</Link>, edit the person and tick the team.</p>
            )}
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

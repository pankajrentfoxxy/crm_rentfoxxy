import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, Drawer, EmptyState, Field, FormGrid, Input, Notice, Segmented, Select, StatTile, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  createUser, fetchAssignableRoles, fetchRoles, fetchTeams, fetchUsers, resetUserPassword, setUserStatus, updateUser,
} from './controlApi';
import { ACCESS, errMsg, roleLabel, useControlAccess } from './controlShared';

/**
 * Control → Users. Everyone who signs in to the CRM: role, teams, status.
 * A role change or a password reset ends the user's sessions — they sign in
 * again and pick up the new access straight away.
 */
const STATUS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'all', label: 'All' },
];
const STATUS_LABEL = { active: 'Active', inactive: 'Inactive', blocked: 'Blocked', pending_approval: 'Pending approval', rejected: 'Rejected' };
const LIMIT = 50;

const emptyForm = {
  name: '', email: '', mobile_no: '', role: '', team_ids: [], designation: '', department: '', employee_id: '', password: '',
};

export default function UsersPage() {
  const can = useControlAccess();
  const { user: me } = usePermission();
  const canCreate = can(ACCESS.usersCreate);
  const canEdit = can(ACCESS.usersEdit);
  const canResetPw = can(ACCESS.usersResetPassword);
  const [res, setRes] = useState(null);
  const [status, setStatus] = useState('active');
  const [role, setRole] = useState('');
  const [teamId, setTeamId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [roles, setRoles] = useState([]);
  const [assignable, setAssignable] = useState([]);
  const [teams, setTeams] = useState([]);
  const [form, setForm] = useState(null);
  const [act, setAct] = useState(null);
  const [shownPassword, setShownPassword] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTeams().then(({ data }) => setTeams(data.teams || [])).catch(() => setTeams([]));
    fetchAssignableRoles().then(({ data }) => setAssignable(data.roles || [])).catch(() => setAssignable([]));
    fetchRoles().then(({ data }) => setRoles(data.roles || [])).catch(() => setRoles([]));
  }, []);

  const load = useCallback(() => {
    const params = {
      page,
      limit: LIMIT,
      role: role || undefined,
      team_id: teamId || undefined,
      search: q.trim() || undefined,
      status: status === 'all' ? undefined : status,
      include_inactive: status === 'active' ? undefined : 'true',
    };
    fetchUsers(params)
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ users: [], stats: {}, pagination: {} }); toast.error(errMsg(e)); });
  }, [page, role, teamId, q, status]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { setPage(1); }, [role, teamId, q, status]);

  const roleOptions = useMemo(() => {
    const list = roles.length ? roles.map((r) => ({ value: r.name, label: r.display_name || r.name })) : assignable.map((r) => ({ value: r.name, label: r.display_name || r.name }));
    return list.filter((o) => !['vendor', 'customer'].includes(o.value));
  }, [roles, assignable]);
  const teamName = (id) => teams.find((t) => Number(t.team_id) === Number(id))?.team_name;
  const assignableFor = (current) => {
    const list = assignable.map((r) => ({ value: r.name, label: r.display_name || r.name }));
    if (current && !list.some((o) => o.value === current)) list.unshift({ value: current, label: `${roleLabel(roles, current)} (current)`, disabled: true });
    return list;
  };

  const openEdit = (u) => setForm({
    user_id: u.user_id,
    originalRole: u.role,
    name: u.name || '',
    email: u.email || '',
    mobile_no: u.mobile_no || '',
    role: u.role || '',
    team_ids: (u.team_ids || []).map(Number),
    designation: u.designation || '',
    department: u.department || '',
    employee_id: u.employee_id || '',
  });

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        email: form.email.trim(),
        mobile_no: form.mobile_no.trim() || undefined,
        role: form.role,
        team_ids: form.team_ids,
        designation: form.designation.trim() || undefined,
        department: form.department.trim() || undefined,
        employee_id: form.employee_id.trim() || undefined,
      };
      if (form.user_id) {
        const { data } = await updateUser(form.user_id, body);
        if (data.sessions_ended || (form.role !== form.originalRole)) {
          toast.success(`${body.name} updated — they must sign in again to get the new role`);
        } else {
          toast.success(`${body.name} updated`);
        }
      } else {
        await createUser({ ...body, password: form.password });
        toast.success(`${body.name} created`);
      }
      setForm(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const submitAct = async () => {
    setBusy(true);
    try {
      if (act.kind === 'status') {
        await setUserStatus(act.user.user_id, act.status, act.reason.trim() || undefined);
        toast.success(`${act.user.name} is now ${STATUS_LABEL[act.status].toLowerCase()}`);
      } else {
        const { data } = await resetUserPassword(act.user.user_id, act.password.trim() || undefined);
        setShownPassword({ name: act.user.name, email: act.user.email, password: data.new_password });
      }
      setAct(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const isSelf = (u) => Number(u.user_id) === Number(me?.user_id);
  const cols = [
    { key: 'n', header: 'User', render: (u) => u.name, sub: (u) => u.email },
    { key: 'r', header: 'Role', render: (u) => roleLabel(roles, u.role), sub: (u) => u.designation || null },
    { key: 't', header: 'Teams', render: (u) => (u.team_ids || []).map(teamName).filter(Boolean).join(', ') || u.team_name || '—' },
    { key: 's', header: 'Status', render: (u) => STATUS_LABEL[u.status] || u.status || (u.active ? 'Active' : 'Inactive'), sub: (u) => (u.status !== 'active' ? u.deactivation_reason : null) },
    { key: 'l', header: 'Last sign-in', render: (u) => (u.last_login ? <DateTime value={u.last_login} /> : '—') },
    {
      key: 'a',
      header: '',
      render: (u) => (
        <div className="flex" style={{ gap: '4px', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()} role="presentation">
          <Link to={`/carret/control/user-permissions/${u.user_id}`}>Permissions</Link>
          {canEdit && <Button variant="quiet" onClick={() => openEdit(u)}>Edit</Button>}
          {canEdit && !isSelf(u) && <Button variant="quiet" onClick={() => setAct({ kind: 'status', user: u, status: u.status === 'active' ? 'inactive' : 'active', reason: '' })}>Status</Button>}
          {canResetPw && <Button variant="quiet" onClick={() => setAct({ kind: 'password', user: u, password: '' })}>Reset password</Button>}
        </div>
      ),
    },
  ];

  const stats = res?.stats || {};
  const pg = res?.pagination || {};
  const needReason = act?.kind === 'status' && act.status !== 'active';
  const formValid = form && form.name.trim() && form.email.trim() && form.role && (form.user_id || form.password.length >= 6);

  return (
    <DeskShell
      title="Users"
      breadcrumb="Control"
      subtitle="Everyone who signs in to the CRM — their role, teams and status."
      actions={canCreate ? <Button variant="primary" onClick={() => setForm({ ...emptyForm })}>New user</Button> : null}
    >
      <div className="c-stack">
        {res && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            <StatTile label="Users" value={stats.total ?? 0} />
            <StatTile label="Active" value={stats.active ?? 0} />
            <StatTile label="Inactive" value={stats.inactive ?? 0} />
            <StatTile label="Blocked" value={stats.blocked ?? 0} />
          </div>
        )}
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Status" value={status} onChange={setStatus} options={STATUS} />
          <Select value={role} placeholder="All roles" options={roleOptions} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }} />
          <Select value={teamId} placeholder="All teams" options={teams.map((t) => ({ value: String(t.team_id), label: t.team_name }))} onChange={(e) => setTeamId(e.target.value)} style={{ width: 'auto' }} />
          <Input type="search" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} />
        </div>
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={res.users || []}
            rowKey={(u) => u.user_id}
            onRowClick={canEdit ? openEdit : undefined}
            empty={<EmptyState title="No users match" />}
          />
        )}
        {(pg.totalPages || 1) > 1 && (
          <div className="flex items-center" style={{ gap: '8px' }}>
            <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-ink-3">Page {pg.page || page} of {pg.totalPages} · {pg.total} users</span>
            <Button variant="quiet" disabled={page >= pg.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.user_id ? `Edit — ${form.name}` : 'New user'}
        width="40rem"
        footer={<Button variant="primary" disabled={busy || !formValid} onClick={submit}>{form?.user_id ? 'Save' : 'Create user'}</Button>}
      >
        {form && (
          <div className="c-stack">
            <FormGrid cols={2}>
              <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Mobile"><Input value={form.mobile_no} onChange={(e) => setForm({ ...form, mobile_no: e.target.value })} /></Field>
              <Field label="Role" required hint="Only the roles you may give are listed.">
                <Select value={form.role} placeholder="Pick a role" options={assignableFor(form.user_id ? form.originalRole : null)} onChange={(e) => setForm({ ...form, role: e.target.value })} />
              </Field>
              <Field label="Designation"><Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
              <Field label="Department"><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field>
              <Field label="Employee ID"><Input value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} /></Field>
              {!form.user_id && (
                <Field label="Password" required hint="At least 6 characters. Share it with the user."><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
              )}
            </FormGrid>
            {form.user_id && form.role !== form.originalRole && (
              <Notice tone="warn" title="Role change ends their sessions">
                {form.name} is signed out everywhere and gets the {roleLabel(roles, form.role)} permissions when they sign in again.
              </Notice>
            )}
            <Field label="Teams" hint="Floor teams (technicians, senior technicians, floor managers, QC).">
              <div className="flex flex-wrap" style={{ gap: '10px' }}>
                {teams.length === 0 && <span className="text-ink-3">No teams</span>}
                {teams.map((t) => {
                  const id = Number(t.team_id);
                  const on = form.team_ids.includes(id);
                  return (
                    <label key={id} className="flex items-center" style={{ gap: '4px' }}>
                      <input type="checkbox" checked={on} onChange={() => setForm({ ...form, team_ids: on ? form.team_ids.filter((x) => x !== id) : [...form.team_ids, id] })} />
                      <span>{t.team_name}</span>
                    </label>
                  );
                })}
              </div>
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(act)}
        onClose={() => setAct(null)}
        title={act?.kind === 'status' ? `Status — ${act?.user.name}` : `Reset password — ${act?.user.name}`}
        footer={(
          <Button variant="primary" disabled={busy || (needReason && !act.reason.trim())} onClick={submitAct}>
            {act?.kind === 'status' ? 'Change status' : 'Reset password'}
          </Button>
        )}
      >
        {act?.kind === 'status' && (
          <div className="c-stack">
            <p>Now: <strong>{STATUS_LABEL[act.user.status] || act.user.status}</strong></p>
            <Field label="New status" required>
              <Select value={act.status} onChange={(e) => setAct({ ...act, status: e.target.value })} options={STATUS.filter((s) => s.value !== 'all')} />
            </Field>
            <Field label="Reason" required={needReason}><Textarea rows={3} value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} /></Field>
            <Notice tone="info">Any status change signs the user out everywhere.</Notice>
          </div>
        )}
        {act?.kind === 'password' && (
          <div className="c-stack">
            <Field label="New password" hint="Leave empty to generate one."><Input type="text" value={act.password} onChange={(e) => setAct({ ...act, password: e.target.value })} /></Field>
            <Notice tone="warn">The user is signed out everywhere. The new password is shown once — copy it and pass it on.</Notice>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(shownPassword)}
        onClose={() => setShownPassword(null)}
        title="New password"
        footer={<Button variant="primary" onClick={() => setShownPassword(null)}>Done</Button>}
      >
        {shownPassword && (
          <div className="c-stack">
            <p>{shownPassword.name} ({shownPassword.email})</p>
            <div className="flex items-center" style={{ gap: '8px' }}>
              <code className="font-mono" style={{ fontSize: '18px', padding: '6px 10px', border: '1px solid var(--rule)', borderRadius: '6px' }}>{shownPassword.password}</code>
              <Button onClick={() => { navigator.clipboard?.writeText(shownPassword.password).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed — select and copy it')); }}>Copy</Button>
            </div>
            <Notice tone="warn">This is the only time it is shown.</Notice>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, Drawer, EmptyState, Field, Input, Notice, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { createRole, deleteRole, fetchRoles, updateRole } from './controlApi';
import { ACCESS, errMsg, useControlAccess } from './controlShared';

/**
 * Control → Roles. The roles people can be given, how many active users hold
 * each, and a way into each role's permissions. System roles cannot be deleted;
 * admin and super admin can be changed only by a super admin.
 */
export default function RolesPage() {
  const navigate = useNavigate();
  const can = useControlAccess();
  const { user } = usePermission();
  const isSuper = user?.role === 'super_admin';
  const canCreate = can(ACCESS.rolesCreate);
  const canEdit = can(ACCESS.rolesEdit);
  const canDelete = can(ACCESS.rolesDelete);
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchRoles({ search: q.trim() || undefined })
      .then(({ data }) => setRows(data.roles || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      if (form.id) {
        await updateRole(form.id, { display_name: form.display_name, description: form.description });
        toast.success('Role updated');
      } else {
        const { data } = await createRole({ name: form.name, display_name: form.display_name, description: form.description });
        toast.success(`Role ${data.role?.display_name || form.name} created — set its permissions next`);
      }
      setForm(null);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async () => {
    try {
      await deleteRole(del.id);
      toast.success(`Role ${del.display_name || del.name} deleted`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const editable = (r) => canEdit && (!r.protected || isSuper);
  const cols = [
    { key: 'n', header: 'Role', render: (r) => r.display_name || r.name, sub: (r) => r.name },
    { key: 'u', header: 'Active users', numeric: true, render: (r) => r.active_users ?? 0 },
    { key: 't', header: 'Type', render: (r) => (r.is_system_role ? 'System' : 'Custom'), sub: (r) => (r.protected ? 'super admin only' : null) },
    { key: 'd', header: 'Defaults', render: (r) => (r.has_defaults ? 'Built-in defaults' : '—') },
    { key: 'x', header: 'Description', render: (r) => r.description || '—' },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <div className="flex" style={{ gap: '4px', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()} role="presentation">
          <Link to={`/carret/control/role-permissions/${encodeURIComponent(r.name)}`}>Permissions</Link>
          {editable(r) && <Button variant="quiet" onClick={() => setForm({ id: r.id, name: r.name, display_name: r.display_name || '', description: r.description || '' })}>Edit</Button>}
          {canDelete && !r.is_system_role && <Button variant="quiet" onClick={() => setDel(r)}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <DeskShell
      title="Roles"
      breadcrumb="Control"
      subtitle="The roles people can hold. A role's permissions decide what its users see and do."
      actions={canCreate ? <Button variant="primary" onClick={() => setForm({ name: '', display_name: '', description: '' })}>New role</Button> : null}
    >
      <div className="c-stack">
        <Input type="search" placeholder="Search roles" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '18rem' }} />
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/carret/control/role-permissions/${encodeURIComponent(r.name)}`)}
            empty={<EmptyState title="No roles" />}
          />
        )}
      </div>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? `Edit role — ${form.name}` : 'New role'}
        footer={<Button variant="primary" disabled={busy || (!form?.id && !form?.name?.trim())} onClick={submit}>{form?.id ? 'Save' : 'Create role'}</Button>}
      >
        {form && (
          <div className="c-stack">
            {!form.id && (
              <Field label="Role key" required hint="Lower case, underscores — e.g. field_sales. Cannot be changed later.">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
            )}
            <Field label="Display name"><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
            <Field label="Description"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            {!form.id && <Notice tone="info">A new role starts with no permissions. Set them on the Role permissions page, or copy them from another role there.</Notice>}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={remove}
        title={`Delete role ${del?.display_name || del?.name}?`}
        body="Its permissions are removed too. A role still held by active users cannot be deleted."
        confirmLabel="Delete"
      />
    </DeskShell>
  );
}

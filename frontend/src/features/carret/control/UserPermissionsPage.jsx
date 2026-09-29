import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, EmptyState, Input, KeyValue, Notice,
} from '../../../components/carret';
import {
  fetchSectionCatalogue, fetchUserPermissions, fetchUsers, resetUserOverrides, saveUserOverrides,
} from './controlApi';
import {
  ACCESS, PermissionMatrix, allSectionKeys, errMsg, rowsEqual, toRow, useControlAccess,
} from './controlShared';

/**
 * Control → User permissions. Pick a user and see what they may do and where
 * each value comes from — their role, or an override on them. Editing changes
 * the effective value; Save stores only the differences from the role (a value
 * equal to the role's goes back to inheriting), in one go.
 */
export default function UserPermissionsPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const can = useControlAccess();
  const [catalogue, setCatalogue] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [res, setRes] = useState(null);
  const [values, setValues] = useState({});
  const [original, setOriginal] = useState({});
  const [showHidden, setShowHidden] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSectionCatalogue().then(({ data }) => setCatalogue(data)).catch((e) => { setCatalogue({ sections: [], groups: [] }); toast.error(errMsg(e)); });
  }, []);

  // User search
  useEffect(() => {
    if (userId) return undefined;
    const t = setTimeout(() => {
      fetchUsers({ search: q.trim() || undefined, limit: 25, include_inactive: 'true' })
        .then(({ data }) => setFound(data.users || []))
        .catch((e) => { setFound([]); toast.error(errMsg(e)); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, userId]);

  const load = useCallback(() => {
    if (!userId || !catalogue) return;
    setRes(null);
    fetchUserPermissions(userId)
      .then(({ data }) => {
        const keys = allSectionKeys(catalogue, Object.keys(data.effective || {}));
        const v = Object.fromEntries(keys.map((k) => [k, toRow(k, data.effective?.[k])]));
        setRes(data);
        setValues(v);
        setOriginal(v);
      })
      .catch((e) => { setRes({ error: true }); toast.error(errMsg(e)); });
  }, [userId, catalogue]);
  useEffect(() => { load(); }, [load]);

  const roleRows = useMemo(
    () => Object.fromEntries((res?.role_permissions || []).map((r) => [r.section, toRow(r.section, r)])),
    [res]
  );
  const dirty = useMemo(
    () => Object.keys(values).filter((k) => !rowsEqual(values[k], original[k])),
    [values, original]
  );
  const overrideCount = (res?.user_permissions || []).length;
  const readOnly = !res || res.error || res.can_edit === false || !can(ACCESS.userPermsEdit);

  // Where a value comes from: unchanged cells show the server's answer; edited
  // cells show what Save will store (differs from the role → override).
  const sourceOf = useCallback((section, field) => {
    const changed = (values[section]?.[field]) !== (original[section]?.[field]);
    if (!changed) return res?.sources?.[section]?.[field] || 'role';
    const roleValue = (roleRows[section] || toRow(section))[field];
    return values[section]?.[field] === roleValue ? 'role' : 'override';
  }, [values, original, res, roleRows]);

  const onChange = (section, field, value) => {
    setValues((prev) => ({ ...prev, [section]: { ...(prev[section] || toRow(section)), [field]: value } }));
  };

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await saveUserOverrides(userId, Object.values(values));
      toast.success(`Saved — ${(data.overrides || []).length} override${(data.overrides || []).length === 1 ? '' : 's'} on this user`);
      load();
    } catch (e) {
      const unknown = e?.response?.data?.unknown_sections;
      toast.error(unknown?.length ? `${errMsg(e)} (${unknown.join(', ')})` : errMsg(e));
    } finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await resetUserOverrides(userId);
      toast.success('Overrides removed — the user now has exactly their role');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const hiddenCount = (catalogue?.groups || []).find((g) => g.key === '_hidden')?.sections.length || 0;
  const u = res?.user;

  if (!userId) {
    const cols = [
      { key: 'n', header: 'User', render: (r) => r.name, sub: (r) => r.email },
      { key: 'r', header: 'Role', render: (r) => r.role },
      { key: 's', header: 'Status', render: (r) => r.status || (r.active ? 'active' : 'inactive') },
    ];
    return (
      <DeskShell title="User permissions" breadcrumb="Control" subtitle="Pick a user to see what they may do, and change it for them alone.">
        <div className="c-stack">
          <Input type="search" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '22rem' }} />
          {found === null ? <EmptyState title="Loading…" /> : (
            <DataTable
              columns={cols}
              rows={found}
              rowKey={(r) => r.user_id}
              onRowClick={(r) => navigate(`/carret/control/user-permissions/${r.user_id}`)}
              empty={<EmptyState title="No users match" />}
            />
          )}
        </div>
      </DeskShell>
    );
  }

  return (
    <DeskShell
      title={u ? `Permissions — ${u.name}` : 'User permissions'}
      breadcrumb="Control / User permissions"
      actions={!readOnly ? (
        <div className="flex" style={{ gap: '8px' }}>
          {overrideCount > 0 && <Button variant="quiet" disabled={busy} onClick={() => setConfirm(true)}>Reset to role</Button>}
          <Button variant="primary" disabled={busy || !dirty.length} onClick={save}>{dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}` : 'Saved'}</Button>
        </div>
      ) : null}
    >
      <div className="c-stack">
        <div className="flex items-center" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={() => { if (!dirty.length) navigate('/carret/control/user-permissions'); else setDiscard(true); }}>← Another user</Button>
          {hiddenCount > 0 && (
            <label className="flex items-center" style={{ gap: '6px', marginLeft: 'auto' }}>
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              <span>Show hidden ({hiddenCount})</span>
            </label>
          )}
        </div>
        {u && (
          <KeyValue items={[
            { label: 'Email', value: u.email },
            { label: 'Role', value: u.role },
            { label: 'Overrides on this user', value: overrideCount ? `${overrideCount} section${overrideCount === 1 ? '' : 's'}` : 'None — exactly the role' },
          ]} />
        )}
        <Notice tone="info">
          A <span style={{ background: 'var(--accent-soft)', padding: '0 4px', borderRadius: '4px' }}>shaded</span> value is an override on this user;
          everything else comes from the role. Setting a value back to the role&apos;s removes the override when you Save.
        </Notice>
        {res && readOnly && !res.error && (
          <Notice tone="info">
            {res.can_edit === false
              ? 'Read only. Only a super admin may change an admin or super admin, and nobody may change their own permissions.'
              : 'Read only — you can see these permissions but not change them.'}
          </Notice>
        )}
        {res === null || catalogue === null ? <EmptyState title="Loading…" /> : (
          res.error ? <EmptyState title="Could not load this user" /> : (
            <PermissionMatrix catalogue={catalogue} values={values} onChange={onChange} readOnly={readOnly} sourceOf={sourceOf} showHidden={showHidden} />
          )
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={reset}
        title="Reset to role?"
        body={`Removes all ${overrideCount} override${overrideCount === 1 ? '' : 's'} on ${u?.name || 'this user'}; they get exactly their role's permissions.`}
        confirmLabel="Reset"
      />
      <ConfirmDialog
        open={discard}
        onClose={() => setDiscard(false)}
        onConfirm={() => navigate('/carret/control/user-permissions')}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        tone="warn"
      />
    </DeskShell>
  );
}

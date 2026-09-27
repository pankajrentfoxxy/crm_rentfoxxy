import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, EmptyState, Field, Notice, Select,
} from '../../../components/carret';
import {
  applyRoleDefaults, fetchRolePermissions, fetchRoles, fetchSectionCatalogue, saveRolePermissions,
} from './controlApi';
import {
  ACCESS, PermissionMatrix, allSectionKeys, errMsg, roleLabel, rowsEqual, toRow, useControlAccess,
} from './controlShared';

/**
 * Control → Role permissions. One role's grants over every enforced section,
 * grouped as the backend serves them, with data scope / customer access /
 * ready-stock access on the sections that honour them. Save is one PUT in one
 * transaction; nothing is written until Save.
 */
export default function RolePermissionsPage() {
  const { role: roleParam } = useParams();
  const navigate = useNavigate();
  const can = useControlAccess();
  const [catalogue, setCatalogue] = useState(null);
  const [roles, setRoles] = useState([]);
  const [res, setRes] = useState(null);
  const [values, setValues] = useState({});
  const [original, setOriginal] = useState({});
  const [showHidden, setShowHidden] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const role = roleParam ? decodeURIComponent(roleParam) : '';

  useEffect(() => {
    fetchSectionCatalogue().then(({ data }) => setCatalogue(data)).catch((e) => { setCatalogue({ sections: [], groups: [] }); toast.error(errMsg(e)); });
    fetchRoles().then(({ data }) => setRoles(data.roles || [])).catch((e) => toast.error(errMsg(e)));
  }, []);

  const fill = useCallback((rows, keys) => {
    const byKey = Object.fromEntries((rows || []).map((r) => [r.section, r]));
    return Object.fromEntries(keys.map((k) => [k, toRow(k, byKey[k])]));
  }, []);

  const load = useCallback(() => {
    if (!role || !catalogue) return;
    setRes(null);
    fetchRolePermissions(role)
      .then(({ data }) => {
        const keys = allSectionKeys(catalogue, (data.permissions || []).map((r) => r.section));
        const v = fill(data.permissions, keys);
        setRes(data);
        setValues(v);
        setOriginal(v);
      })
      .catch((e) => { setRes({ permissions: [], error: true }); toast.error(errMsg(e)); });
  }, [role, catalogue, fill]);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(
    () => Object.keys(values).filter((k) => !rowsEqual(values[k], original[k])),
    [values, original]
  );
  const readOnly = !res || res.error || res.can_edit === false || !can(ACCESS.rolePermsEdit);

  const onChange = (section, field, value) => {
    setValues((prev) => {
      const row = { ...(prev[section] || toRow(section)), [field]: value };
      // Create / edit / delete without view is meaningless; ticking one ticks view.
      if (value === true && field !== 'can_view' && field.startsWith('can_')) row.can_view = true;
      return { ...prev, [section]: row };
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      // Only the changed sections: untouched sections keep their rows as they
      // are (no all-false rows written for sections the role never had).
      await saveRolePermissions(role, dirty.map((k) => values[k]));
      toast.success(`Saved ${roleLabel(roles, role)} permissions`);
      load();
    } catch (e) {
      const unknown = e?.response?.data?.unknown_sections;
      toast.error(unknown?.length ? `${errMsg(e)} (${unknown.join(', ')})` : errMsg(e));
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!copyFrom) return;
    setBusy(true);
    try {
      const { data } = await fetchRolePermissions(copyFrom);
      const keys = allSectionKeys(catalogue, Object.keys(values), (data.permissions || []).map((r) => r.section));
      setValues(fill(data.permissions, keys));
      toast.success(`Loaded ${roleLabel(roles, copyFrom)} into the editor — review, then Save`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const defaults = async () => {
    setBusy(true);
    try {
      const { data } = await applyRoleDefaults(role);
      toast.success(data.message || 'Role defaults applied');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const roleOptions = roles.map((r) => ({ value: r.name, label: `${r.display_name || r.name}${r.active_users != null ? ` (${r.active_users})` : ''}` }));
  const hiddenCount = (catalogue?.groups || []).find((g) => g.key === '_hidden')?.sections.length || 0;

  return (
    <DeskShell
      title="Role permissions"
      breadcrumb="Control"
      subtitle="What each role may view, create, edit and delete — and how much of the data it sees."
      actions={role && !readOnly ? <Button variant="primary" disabled={busy || !dirty.length} onClick={save}>{dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}` : 'Saved'}</Button> : null}
    >
      <div className="c-stack">
        <div className="flex flex-wrap items-end" style={{ gap: '12px' }}>
          <Field label="Role">
            <Select
              value={role}
              placeholder="Pick a role"
              options={roleOptions}
              onChange={(e) => {
                if (dirty.length && !window.confirm('Discard unsaved changes?')) return;
                navigate(e.target.value ? `/carret/control/role-permissions/${encodeURIComponent(e.target.value)}` : '/carret/control/role-permissions');
              }}
            />
          </Field>
          {role && !readOnly && (
            <>
              <Field label="Copy from role">
                <Select value={copyFrom} placeholder="—" options={roleOptions.filter((o) => o.value !== role)} onChange={(e) => setCopyFrom(e.target.value)} />
              </Field>
              <Button disabled={!copyFrom || busy} onClick={copy}>Copy</Button>
              {res?.has_defaults && <Button variant="quiet" disabled={busy} onClick={() => setConfirm(true)}>Apply defaults</Button>}
            </>
          )}
          {hiddenCount > 0 && (
            <label className="flex items-center" style={{ gap: '6px', marginLeft: 'auto' }}>
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              <span>Show hidden ({hiddenCount})</span>
            </label>
          )}
        </div>

        {!role && <EmptyState title="Pick a role" body="Its permissions open here." />}
        {role && res && readOnly && !res.error && (
          <Notice tone="info">
            {res.can_edit === false
              ? 'Read only. Only a super admin may change the admin and super admin roles, and nobody may change their own role.'
              : 'Read only — you can see these permissions but not change them.'}
          </Notice>
        )}
        {role && dirty.length > 0 && (
          <Notice tone="warn" title="Unsaved changes">
            {dirty.length} section{dirty.length === 1 ? '' : 's'} changed. Users on this role get the new permissions on their next request after Save.
          </Notice>
        )}
        {role && (res === null || catalogue === null ? <EmptyState title="Loading…" /> : (
          <PermissionMatrix catalogue={catalogue} values={values} onChange={onChange} readOnly={readOnly} showHidden={showHidden} />
        ))}
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={defaults}
        title={`Apply defaults to ${roleLabel(roles, role)}?`}
        body="This replaces the role's permissions with the built-in defaults. Unsaved edits are lost."
        confirmLabel="Apply defaults"
      />
    </DeskShell>
  );
}

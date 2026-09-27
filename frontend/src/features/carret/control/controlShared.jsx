import React, { useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { usePermission } from '../../../hooks/usePermission';
import { Button, Select } from '../../../components/carret';

export const errMsg = (e, fallback = 'That did not work.') => e?.response?.data?.message || e?.message || fallback;

/**
 * Who may open / change what in Control. Mirrors the backend (decision CT1):
 * a role on the list OR the matching grant in the matrix; super_admin always.
 */
export const ACCESS = {
  usersView: { roles: ['admin', 'manager', 'floor_manager'], sections: ['users'], action: 'view' },
  usersCreate: { roles: ['admin', 'manager'], sections: ['users'], action: 'create' },
  usersEdit: { roles: ['admin', 'manager'], sections: ['users'], action: 'edit' },
  usersResetPassword: { roles: ['admin'], sections: ['users'], action: 'edit' },
  rolesView: { roles: ['admin', 'manager'], sections: ['roles'], action: 'view' },
  rolesCreate: { roles: ['admin'], sections: ['roles'], action: 'create' },
  rolesEdit: { roles: ['admin'], sections: ['roles'], action: 'edit' },
  rolesDelete: { roles: ['admin'], sections: ['roles'], action: 'delete' },
  rolePermsView: { roles: ['admin', 'manager'], sections: ['role_permissions'], action: 'view' },
  rolePermsEdit: { roles: ['admin'], sections: ['role_permissions'], action: 'edit' },
  userPermsView: { roles: ['admin'], sections: ['user_permissions'], action: 'view' },
  userPermsEdit: { roles: ['admin'], sections: ['user_permissions'], action: 'edit' },
  auditView: { roles: ['admin'], sections: ['role_permissions', 'user_permissions'], action: 'view' },
};

/** can(ACCESS.x) → boolean. */
export function useControlAccess() {
  const { user, hasPermission } = usePermission();
  return useCallback((rule) => {
    if (!user || !rule) return false;
    if (user.role === 'super_admin') return true;
    if (rule.roles.includes(user.role)) return true;
    return rule.sections.some((s) => hasPermission(s, rule.action));
  }, [user, hasPermission]);
}

/** Route guard for the Control pages: role OR section, super_admin passes. */
export function ControlGuard({ rule, children }) {
  const { isAuthenticated, loading, user } = useAuth();
  const can = useControlAccess();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!can(rule)) return <Navigate to={user?.role === 'guard' ? '/guard' : '/dashboard'} replace />;
  return children;
}

export const ACTIONS = [
  { key: 'can_view', label: 'View' },
  { key: 'can_create', label: 'Create' },
  { key: 'can_edit', label: 'Edit' },
  { key: 'can_delete', label: 'Delete' },
];
export const SCOPES = [
  { key: 'data_scope', label: 'Data scope' },
  { key: 'customer_access', label: 'Customer access' },
  { key: 'inventory_tag_access', label: 'Ready-stock access' },
];
export const FIELDS = [...ACTIONS.map((a) => a.key), ...SCOPES.map((s) => s.key)];

export const blankRow = (section) => ({
  section, can_view: false, can_create: false, can_edit: false, can_delete: false,
  data_scope: 'all', customer_access: 'all', inventory_tag_access: 'all',
});

/** Normalise a server row (nulls, missing scopes) into a full editor row. */
export const toRow = (section, r) => {
  const b = blankRow(section);
  if (!r) return b;
  return {
    section,
    can_view: r.can_view === true,
    can_create: r.can_create === true,
    can_edit: r.can_edit === true,
    can_delete: r.can_delete === true,
    data_scope: r.data_scope || b.data_scope,
    customer_access: r.customer_access || b.customer_access,
    inventory_tag_access: r.inventory_tag_access || b.inventory_tag_access,
  };
};

export const rowsEqual = (a, b) => FIELDS.every((f) => (a?.[f] ?? null) === (b?.[f] ?? null));

const humanise = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const roleLabel = (roles, name) => roles?.find((r) => r.name === name)?.display_name || humanise(name);

/**
 * The grouped permission matrix shared by Role permissions and User permissions.
 *   catalogue: GET /api/roles/sections payload
 *   values:    { [section]: row }
 *   sourceOf:  optional (section, field) → 'override' | 'role' | ... (user page)
 */
export function PermissionMatrix({ catalogue, values, onChange, readOnly, sourceOf, showHidden }) {
  const [closed, setClosed] = useState({});
  const meta = Object.fromEntries((catalogue?.sections || []).map((s) => [s.section, s]));
  const groups = (catalogue?.groups || []).filter((g) => showHidden || g.key !== '_hidden');
  const opts = catalogue?.scope_values || {};

  const cellStyle = (section, field) => (sourceOf?.(section, field) === 'override'
    ? { background: 'var(--accent-soft, rgba(59,130,246,0.12))', borderRadius: '4px' }
    : undefined);

  const setGroup = (g, field, value) => {
    g.sections.forEach((s) => onChange(s, field, value));
  };

  return (
    <div className="c-stack">
      {groups.map((g) => {
        const isClosed = closed[g.key] ?? g.key === '_hidden';
        const allView = g.sections.length > 0 && g.sections.every((s) => values[s]?.can_view);
        return (
          <section key={g.key} className="c-card">
            <div className="c-card-h">
              <button
                type="button"
                className="bg-transparent border-0 cursor-pointer font-ui text-ink"
                style={{ padding: 0, fontSize: '15px', fontWeight: 600 }}
                onClick={() => setClosed({ ...closed, [g.key]: !isClosed })}
                aria-expanded={!isClosed}
              >
                {isClosed ? '▸' : '▾'} {g.label} <span className="text-ink-3" style={{ fontWeight: 400 }}>({g.sections.length})</span>
              </button>
              {!readOnly && !isClosed && (
                <div className="flex" style={{ gap: '6px' }}>
                  <Button variant="quiet" onClick={() => setGroup(g, 'can_view', !allView)}>{allView ? 'Clear view' : 'View all'}</Button>
                </div>
              )}
            </div>
            {!isClosed && (
              <div className="c-table-wrap">
                <table className="c-table font-ui">
                  <thead>
                    <tr>
                      <th scope="col">Section</th>
                      {ACTIONS.map((a) => <th key={a.key} scope="col" style={{ textAlign: 'center', width: '4.5rem' }}>{a.label}</th>)}
                      <th scope="col">Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.sections.map((s) => {
                      const m = meta[s] || { section: s, scopes: {} };
                      const v = values[s] || blankRow(s);
                      return (
                        <tr key={s}>
                          <td>
                            <div className="text-ink">{m.label || humanise(s)}</div>
                            <div className="font-mono text-ink-3" style={{ fontSize: '12px' }}>{s}{m.description ? ` · ${m.description}` : ''}</div>
                          </td>
                          {ACTIONS.map((a) => (
                            <td key={a.key} style={{ textAlign: 'center' }}>
                              <span style={{ display: 'inline-block', padding: '2px 6px', ...cellStyle(s, a.key) }} title={sourceOf ? `From ${sourceOf(s, a.key)}` : undefined}>
                                <input
                                  type="checkbox"
                                  aria-label={`${a.label} ${m.label || s}`}
                                  checked={Boolean(v[a.key])}
                                  disabled={readOnly}
                                  onChange={(e) => onChange(s, a.key, e.target.checked)}
                                />
                              </span>
                            </td>
                          ))}
                          <td>
                            <div className="flex flex-wrap" style={{ gap: '6px' }}>
                              {SCOPES.filter((sc) => m.scopes?.[sc.key]).map((sc) => (
                                <label key={sc.key} className="flex items-center" style={{ gap: '4px', ...cellStyle(s, sc.key) }} title={sourceOf ? `From ${sourceOf(s, sc.key)}` : undefined}>
                                  <span className="text-ink-3" style={{ fontSize: '12px' }}>{sc.label}</span>
                                  <Select
                                    value={v[sc.key] || 'all'}
                                    disabled={readOnly}
                                    onChange={(e) => onChange(s, sc.key, e.target.value)}
                                    options={opts[sc.key] || [{ value: 'all', label: 'All' }]}
                                    style={{ width: 'auto', minWidth: '8rem' }}
                                  />
                                </label>
                              ))}
                              {!SCOPES.some((sc) => m.scopes?.[sc.key]) && <span className="text-ink-3">—</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Every section the matrix should save: the catalogue plus any row the server already holds. */
export function allSectionKeys(catalogue, ...extra) {
  const keys = new Set((catalogue?.sections || []).map((s) => s.section));
  extra.forEach((list) => (list || []).forEach((k) => k && keys.add(k)));
  return [...keys];
}

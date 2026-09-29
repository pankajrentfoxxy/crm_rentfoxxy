import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, ConfirmDialog, DataTable, DateTime, Drawer, EmptyState, Field, FilterBar, Input, Panel, Select, StatusChip,
} from '../../../../components/carret';
import useDebouncedValue from '../../../../hooks/useDebouncedValue';

/**
 * One master list (brands, models, processors, …) — search, status filter,
 * add / rename, activate / deactivate, delete. The server normalises the name
 * ("16 gb" → "16GB RAM") and refuses a duplicate of an existing value with 409,
 * so the message it returns is shown as it is.
 *
 * `api` = { list, create, update, remove, setStatus } from utils/assetConfigurationApi.
 */
const LIMIT = 50;
const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }];

export function ActiveChip({ active }) {
  return active ? <StatusChip status="active" /> : <StatusChip status="closed" label="Inactive" />;
}

const errMsg = (e, fallback) => e?.response?.data?.message || e?.message || fallback;

export default function AssetConfigEntityPanel({ label, hint, api, canCreate, canEdit, canDelete }) {
  const [filters, setFilters] = useState({});
  const search = useDebouncedValue((filters.search || '').trim(), 320);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [form, setForm] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRes(null);
    api.list({ page, limit: LIMIT, search: search || undefined, status: filters.status || undefined })
      .then(({ data }) => setRes(data))
      .catch((e) => { setRes({ items: [], pagination: { total: 0, totalPages: 1 } }); toast.error(errMsg(e, `Could not load ${label}`)); });
  }, [api, page, search, filters.status, label]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, filters.status]);

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), status: form.status };
      const { data } = form.id ? await api.update(form.id, body) : await api.create(body);
      toast.success(`${label} ${form.id ? 'saved' : 'added'} as “${data?.item?.name || body.name}”`);
      setForm(null);
      load();
    } catch (e) { toast.error(errMsg(e, 'Save failed')); } finally { setBusy(false); }
  };

  const toggle = async (row) => {
    const next = row.status === 'active' ? 'inactive' : 'active';
    try {
      await api.setStatus(row.id, next);
      toast.success(next === 'active' ? 'Activated' : 'Deactivated');
      load();
    } catch (e) { toast.error(errMsg(e, 'Status update failed')); }
  };

  const remove = async (row) => {
    try { await api.remove(row.id); toast.success(`Deleted “${row.name}”`); load(); } catch (e) { toast.error(errMsg(e, 'Delete failed')); }
  };

  const columns = [
    { key: 'name', header: label, render: (r) => r.name },
    { key: 'status', header: 'Status', render: (r) => <ActiveChip active={r.status === 'active'} /> },
    { key: 'updated', header: 'Updated', render: (r) => <DateTime value={r.updated_at || r.created_at} /> },
    {
      key: 'x',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap" style={{ gap: '6px', justifyContent: 'flex-end' }}>
          {canEdit && <Button variant="quiet" onClick={() => setForm({ id: r.id, name: r.name, status: r.status || 'active' })}>Rename</Button>}
          {canEdit && <Button variant="quiet" onClick={() => toggle(r)}>{r.status === 'active' ? 'Deactivate' : 'Activate'}</Button>}
          {canDelete && <Button variant="quiet" onClick={() => setConfirmDelete(r)}>Delete</Button>}
        </div>
      ),
    },
  ];

  const pages = res?.pagination?.totalPages || 1;
  return (
    <div className="c-stack">
      <Panel
        toolbar={(
          <FilterBar
            filters={[
              { key: 'search', label: 'Search', type: 'search', placeholder: `Search ${label.toLowerCase()}` },
              { key: 'status', label: 'Status', options: STATUS_OPTIONS },
            ]}
            values={filters}
            onChange={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
            onClear={() => setFilters({})}
            count={res ? `${res.pagination?.total ?? 0} values` : ''}
            right={canCreate ? <Button variant="primary" onClick={() => setForm({ id: null, name: '', status: 'active' })}>Add {label.toLowerCase()}</Button> : null}
          />
        )}
      >
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable
            columns={columns}
            rows={res.items || []}
            rowKey={(r) => r.id}
            empty={<EmptyState title={`No ${label.toLowerCase()} values`} body={hint} />}
          />
        )}
      </Panel>
      {pages > 1 && (
        <div className="flex items-center" style={{ gap: '8px' }}>
          <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-ink-3">Page {page} of {pages}</span>
          <Button variant="quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? `Rename ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
        footer={<Button variant="primary" disabled={busy || !form?.name?.trim()} onClick={save}>{form?.id ? 'Save' : 'Add'}</Button>}
      >
        {form && (
          <div className="c-stack">
            <Field label="Name" required hint="Spelling is standardised on save (e.g. “16 gb” becomes “16GB RAM”); an existing value in another spelling is refused.">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={STATUS_OPTIONS} />
            </Field>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove(confirmDelete)}
        title={`Delete “${confirmDelete?.name || ''}”?`}
        body="It disappears from every form's pick-list. Laptops already recorded with this value keep it. Deactivate instead if it may come back."
        confirmLabel="Delete"
      />
    </div>
  );
}

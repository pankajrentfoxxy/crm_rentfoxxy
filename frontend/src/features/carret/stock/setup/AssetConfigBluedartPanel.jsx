import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FormGrid, Input, Money, Notice, Panel,
} from '../../../../components/carret';
import {
  createBluedartDeclaredValue, deleteBluedartDeclaredValue, listBluedartDeclaredValues,
  setBluedartDeclaredValueStatus, updateBluedartDeclaredValue,
} from '../../../../utils/assetConfigurationApi';
import { invalidateDeclaredValueMatrixCache } from '../../../sales-pipeline/bluedartDeclaredValue';
import { ActiveChip } from './AssetConfigEntityPanel';

/**
 * BlueDart declared value — the ₹ amount put on an AWB, matched by processor
 * (i5 / i7 / R7 / APPLE) and generation (Intel gen or Apple chip).
 */
const errMsg = (e, fallback) => e?.response?.data?.message || e?.message || fallback;
const blank = () => ({ id: null, category: 'i5', grade: '', amount: '', label: '', active: true, sort_order: 0 });
const PROCESSOR_HINTS = ['i5', 'i7', 'R7', 'APPLE'];

export default function AssetConfigBluedartPanel({ canCreate, canEdit, canDelete }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    listBluedartDeclaredValues({ include_inactive: 'true' })
      .then(({ data }) => setRows(data.items || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load declared values')); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.category.trim() || !form.grade.trim()) { toast.error('Processor and generation are required'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Amount must be a positive number'); return; }
    setBusy(true);
    try {
      const payload = {
        category: form.category.trim(), grade: form.grade.trim(), amount,
        label: form.label.trim() || undefined, sort_order: form.sort_order ?? 0, active: form.active,
      };
      if (form.id) await updateBluedartDeclaredValue(form.id, payload); else await createBluedartDeclaredValue(payload);
      invalidateDeclaredValueMatrixCache();
      toast.success(form.id ? 'Saved' : 'Added');
      setForm(null);
      load();
    } catch (e) { toast.error(errMsg(e, 'Save failed')); } finally { setBusy(false); }
  };

  const toggle = async (row) => {
    try {
      await setBluedartDeclaredValueStatus(row.id, !row.active);
      invalidateDeclaredValueMatrixCache();
      load();
    } catch (e) { toast.error(errMsg(e, 'Status update failed')); }
  };

  const remove = async (row) => {
    try {
      await deleteBluedartDeclaredValue(row.id);
      invalidateDeclaredValueMatrixCache();
      toast.success('Deleted');
      load();
    } catch (e) { toast.error(errMsg(e, 'Delete failed')); }
  };

  const columns = [
    { key: 'c', header: 'Processor', render: (r) => r.category },
    { key: 'g', header: 'Generation', render: (r) => r.grade },
    { key: 'a', header: 'Declared value', numeric: true, render: (r) => <Money value={r.amount} /> },
    { key: 'l', header: 'Label', render: (r) => r.label || <span className="text-ink-3">—</span> },
    { key: 's', header: 'Status', render: (r) => <ActiveChip active={r.active !== false} /> },
    {
      key: 'x',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap" style={{ gap: '6px', justifyContent: 'flex-end' }}>
          {canEdit && (
            <Button
              variant="quiet"
              onClick={() => setForm({
                id: r.id, category: r.category || '', grade: r.grade || '', amount: String(r.amount ?? ''),
                label: r.label || '', active: r.active !== false, sort_order: r.sort_order ?? 0,
              })}
            >
              Edit
            </Button>
          )}
          {canEdit && <Button variant="quiet" onClick={() => toggle(r)}>{r.active ? 'Deactivate' : 'Activate'}</Button>}
          {canDelete && <Button variant="quiet" onClick={() => setConfirmDelete(r)}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="c-stack">
      <Notice tone="info">
        The amount declared on a BlueDart AWB, matched by processor (i5 / i7 / R7 / APPLE) and generation.
        Use generation ALL for R7; Apple chips like m1-air or m4; Intel like 12th.
      </Notice>
      <Panel
        title="BlueDart declared value"
        actions={canCreate ? <Button variant="primary" onClick={() => setForm(blank())}>Add row</Button> : null}
      >
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={<EmptyState title="No rows yet" body="Add the first declared value." />} />
        )}
      </Panel>

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit declared value' : 'Add declared value'}
        footer={<Button variant="primary" disabled={busy} onClick={save}>Save</Button>}
      >
        {form && (
          <div className="c-stack">
            <FormGrid cols={2}>
              <Field label="Processor" required hint={PROCESSOR_HINTS.join(' / ')}>
                <Input list="c-bd-processors" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </Field>
              <Field label="Generation" required hint="12th / ALL / m1-air / u7">
                <Input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
              </Field>
            </FormGrid>
            <datalist id="c-bd-processors">{PROCESSOR_HINTS.map((p) => <option key={p} value={p} />)}</datalist>
            <Field label="Amount (₹)" required>
              <Input type="number" min="1" step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Label">
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </Field>
            <Checkbox label="Active (used for AWB autofill)" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove(confirmDelete)}
        title={`Delete ${confirmDelete?.category || ''} · ${confirmDelete?.grade || ''}?`}
        body="AWBs for this processor and generation will no longer get a declared value automatically."
        confirmLabel="Delete"
      />
    </div>
  );
}

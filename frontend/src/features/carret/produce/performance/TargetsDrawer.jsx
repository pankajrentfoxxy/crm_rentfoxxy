import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, Drawer, EmptyState, Field, Input, Notice,
} from '../../../../components/carret';
import { fetchTargets as fetchTechTargets, saveTargets as saveTechTargets } from './perfShared';

const errMsg = (e) => e?.response?.data?.message || e?.message || 'Could not save';

/**
 * Daily targets: one default for the job's role, and an optional own target
 * for anyone (a trainee, a senior, a floor manager who often steps in).
 * Empty = follow the default. Used for technicians and QC inspectors
 * (`fetch` / `save` / `unitText` decide which).
 */
export default function TargetsDrawer({
  open, technicians = [], onClose, onSaved,
  fetch: fetchTargets = fetchTechTargets, save: saveTargets = saveTechTargets,
  title = 'Daily targets',
  unitText = 'Laptops each technician should finish (Final Testing done) per working day, Monday to Saturday.',
  defaultHint = 'Applies to floor technicians. Anyone else has a target only if you set one below.',
}) {
  const [def, setDef] = useState('');
  const [own, setOwn] = useState({});
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchTargets().then(({ data }) => {
      const d = data.data;
      setDef(String(d.default_daily_target));
      setOwn(Object.fromEntries((d.per_technician || []).map((r) => [r.user_id, String(r.daily_target)])));
      setMeta(d);
    }).catch((e) => toast.error(errMsg(e)));
  }, [open, fetchTargets]);

  const save = async () => {
    setBusy(true);
    try {
      const before = new Set((meta?.per_technician || []).map((r) => Number(r.user_id)));
      const per = technicians.map((t) => {
        const v = String(own[t.user_id] ?? '').trim();
        if (!v && !before.has(Number(t.user_id))) return null;
        return { user_id: t.user_id, daily_target: v === '' ? null : Number(v) };
      }).filter(Boolean);
      await saveTargets({ default_daily_target: Number(def), per_technician: per });
      toast.success('Targets saved');
      onSaved?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const bad = (v) => v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 200);
  const invalid = bad(def) || def === '' || Object.values(own).some(bad);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      width="34rem"
      footer={<Button variant="primary" disabled={busy || invalid} onClick={save}>{busy ? 'Saving…' : 'Save targets'}</Button>}
    >
      <div className="c-stack">
        <p style={{ margin: 0 }}>
          {unitText} A week or month target is this × the working days so far.
        </p>
        <Field label="Default daily target" required hint={[defaultHint, meta?.updated_by ? `Last set by ${meta.updated_by}.` : null].filter(Boolean).join(' ')}>
          <Input type="number" min="0" max="200" value={def} onChange={(e) => setDef(e.target.value)} style={{ maxWidth: '8rem' }} />
        </Field>
        <Notice tone="info" title="Own targets">Leave empty to follow the default.</Notice>
        {!technicians.length ? <EmptyState title="No technicians" /> : (
          <DataTable
            rows={technicians}
            rowKey={(t) => t.user_id}
            columns={[
              { key: 'n', header: 'Person', render: (t) => t.name, sub: (t) => t.role },
              {
                key: 't',
                header: 'Own daily target',
                render: (t) => (
                  <Input
                    type="number"
                    min="0"
                    max="200"
                    placeholder={`default ${def || '—'}`}
                    value={own[t.user_id] ?? ''}
                    onChange={(e) => setOwn((o) => ({ ...o, [t.user_id]: e.target.value }))}
                    style={{ maxWidth: '9rem' }}
                    aria-label={`Own daily target for ${t.name}`}
                  />
                ),
              },
            ]}
          />
        )}
      </div>
    </Drawer>
  );
}

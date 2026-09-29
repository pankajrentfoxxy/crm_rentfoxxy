import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, FormGrid, Input, KeyValue, Notice,
  Panel, Section, Select, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import {
  PHYSICAL_CONDITIONS, PHYSICAL_INWARD_REASONS, createPhysicalInward, fetchPhysicalInward, fetchPhysicalInwards,
  fetchPhysicalPartCounts, fetchPhysicalParts, uploadPhysicalPartPhotos,
} from '../../inventory-management/physicalDeadPartApi';
import { physicalUploadUrl, todayIso } from '../../inventory-management/physicalDeadPartUi';
import { PART_CATEGORIES } from '../../../constants/laptopConditions';
import { usePermission } from '../../../hooks/usePermission';
import { errText } from './chargerShared';

/**
 * Movement → Part inward: dead, damaged or unlabelled parts that are physically
 * in the warehouse with no CRM record. Recording an inward gives each one a DP
 * number and a photo, so it can later leave on an outward (scrap buyer, vendor).
 *
 * Not the spare-parts PO receive (that is Procurement) and not old parts
 * collected from the floor (Parts desk). Same API as the old screen
 * (/physical-parts, section physical_dead_parts). The outward challan still
 * runs on the old screen, linked from here.
 */
const SECTION = 'physical_dead_parts';
const PART_STATUS = {
  available: { chip: 'active', label: 'In warehouse' },
  pending: { chip: 'pending', label: 'On an outward' },
  out: { chip: 'dispatched', label: 'Gone out' },
};
const newLine = () => ({ key: Math.random().toString(36).slice(2), part_name: '', category: 'general', condition: 'dead', quantity: 1, remarks: '', units: [{ serial: '', photos: [] }] });

export default function PartInwardPage() {
  const { hasPermission } = usePermission();
  const canCreate = hasPermission(SECTION, 'create');
  const [tab, setTab] = useState('available');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState({});
  const [state, setState] = useState({ loading: true, rows: [], total: 0, pages: 1, error: null });
  const [recording, setRecording] = useState(false);
  const [openInward, setOpenInward] = useState(null);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fetchPhysicalPartCounts().then(({ data }) => setCounts(data?.counts || {})).catch(() => {});
    const req = tab === 'inwards'
      ? fetchPhysicalInwards({ search: search || undefined, page, limit: 25 }).then(({ data }) => ({ rows: data?.inwards || [], p: data?.pagination }))
      : fetchPhysicalParts({ status: tab === 'all' ? undefined : tab, search: search || undefined, page, limit: 50 }).then(({ data }) => ({ rows: data?.parts || [], p: data?.pagination }));
    return req
      .then(({ rows, p }) => setState({ loading: false, rows, total: p?.total ?? rows.length, pages: p?.totalPages || 1, error: null }))
      .catch((e) => setState({ loading: false, rows: [], total: 0, pages: 1, error: errText(e, 'Could not load parts.') }));
  }, [tab, search, page]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const partColumns = useMemo(() => [
    { key: 'dp', header: 'Part', render: (r) => <DocNumber value={r.dp_number} />, sub: (r) => r.part_name },
    { key: 'c', header: 'Category', render: (r) => PART_CATEGORIES.find((c) => c.value === r.category)?.label || r.category || '—', sub: (r) => r.serial_number || null },
    { key: 'cond', header: 'Condition', render: (r) => PHYSICAL_CONDITIONS.find((c) => c.value === r.condition)?.label || r.condition || '—' },
    { key: 'in', header: 'Came in', render: (r) => <DateTime value={r.inward_date || r.created_at} />, sub: (r) => [r.inward_number, r.inward_user].filter(Boolean).join(' · ') },
    { key: 'st', header: 'Status', render: (r) => <StatusChip status={PART_STATUS[r.status]?.chip || r.status} label={PART_STATUS[r.status]?.label || r.status} />, sub: (r) => [r.outward_number, r.receiver_name].filter(Boolean).join(' · ') || null },
    {
      key: 'ph', header: '', align: 'right',
      render: (r) => (r.inward_photo_path ? <a href={physicalUploadUrl(r.inward_photo_path)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Photo</a> : null),
    },
  ], []);

  const inwardColumns = useMemo(() => [
    { key: 'n', header: 'Inward', render: (r) => <DocNumber value={r.inward_number} />, sub: (r) => r.inward_reason },
    { key: 'd', header: 'Date', render: (r) => <DateTime value={r.inward_date || r.created_at} />, sub: (r) => r.created_by_name || null },
    { key: 'w', header: 'Warehouse', render: (r) => r.warehouse || '—' },
    { key: 'p', header: 'Parts', numeric: true, render: (r) => r.part_count ?? '—' },
  ], []);

  const TABS = [
    { key: 'available', label: 'In warehouse', count: counts.available },
    { key: 'pending', label: 'On an outward', count: counts.pending },
    { key: 'out', label: 'Gone out', count: counts.out },
    { key: 'all', label: 'All parts', count: counts.total },
    { key: 'inwards', label: 'Inwards' },
  ];

  return (
    <DeskShell
      title="Part inward"
      breadcrumb="Movement"
      subtitle="Dead, damaged or unlabelled parts found in the warehouse — recorded with a photo so they can be sent out later."
      actions={canCreate && <Button variant="primary" onClick={() => setRecording(true)}>Record inward</Button>}
    >
      <div className="c-stack">
        <Notice tone="info" title="Sending these parts out">
          Scrap or vendor outward still runs on the <Link to="/inventory-management/physical-parts">parts outward screen</Link>
          {counts.pending_approval ? ` (${counts.pending_approval} awaiting approval)` : ''}.
        </Notice>
        <Panel
          toolbar={(
            <>
              <Tabs tabs={TABS} value={tab} onChange={(v) => { setTab(v); setPage(1); }} />
              <FilterBar
                filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: tab === 'inwards' ? 'Inward no., warehouse or reason' : 'DP no., part, serial, inward or outward' }]}
                values={{ search }}
                onChange={(k, v) => { setSearch(v); setPage(1); }}
                onClear={() => setSearch('')}
                count={`${state.total} ${tab === 'inwards' ? 'inwards' : 'parts'}`}
              />
            </>
          )}
        >
          {state.loading && <EmptyState title="Loading…" />}
          {state.error && <EmptyState title="Could not load" body={state.error} />}
          {!state.loading && !state.error && (
            <>
              <DataTable
                columns={tab === 'inwards' ? inwardColumns : partColumns}
                rows={state.rows}
                rowKey={(r) => r.inward_id || r.dp_number}
                onRowClick={(r) => setOpenInward(r.inward_number)}
                empty={<EmptyState title="Nothing here" />}
              />
              {state.pages > 1 && (
                <div className="flex items-center justify-end" style={{ gap: '8px', padding: '8px' }}>
                  <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>Page {page} of {state.pages}</span>
                  <Button variant="quiet" disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      <InwardDrawer number={openInward} onClose={() => setOpenInward(null)} />
      <RecordInwardDrawer
        open={recording}
        onClose={() => setRecording(false)}
        onSaved={(no) => { setTab('inwards'); setPage(1); load(); setOpenInward(no); }}
      />
    </DeskShell>
  );
}

function InwardDrawer({ number, onClose }) {
  const [d, setD] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    if (!number) return;
    setD({ loading: true, data: null, error: null });
    fetchPhysicalInward(number)
      .then(({ data }) => setD({ loading: false, data, error: null }))
      .catch((e) => setD({ loading: false, data: null, error: errText(e, 'Could not load the inward.') }));
  }, [number]);
  const head = d.data?.inward;
  return (
    <Drawer open={Boolean(number)} onClose={onClose} title={number ? `Inward ${number}` : 'Inward'} width="40rem">
      {d.loading && <EmptyState title="Loading…" />}
      {d.error && <EmptyState title="Cannot open this inward" body={d.error} />}
      {head && (
        <div className="c-stack">
          <KeyValue
            cols={2}
            items={[
              { label: 'Date', value: <DateTime value={head.inward_date || head.created_at} /> },
              { label: 'Recorded by', value: head.created_by_name },
              { label: 'Warehouse', value: head.warehouse },
              { label: 'Reason', value: head.inward_reason },
              { label: 'Remarks', value: head.remarks },
            ]}
          />
          <Section title={`Parts (${d.data.parts.length})`}>
            <DataTable
              rowKey={(r) => r.dp_number}
              rows={d.data.parts}
              columns={[
                { key: 'dp', header: 'Part', render: (r) => <DocNumber value={r.dp_number} />, sub: (r) => [r.part_name, r.serial_number].filter(Boolean).join(' · ') },
                { key: 'cond', header: 'Condition', render: (r) => PHYSICAL_CONDITIONS.find((c) => c.value === r.condition)?.label || r.condition },
                { key: 'st', header: 'Status', render: (r) => <StatusChip status={PART_STATUS[r.status]?.chip || r.status} label={PART_STATUS[r.status]?.label || r.status} />, sub: (r) => r.outward_number || null },
                {
                  key: 'ph', header: 'Photos', align: 'right',
                  render: (r) => (
                    <span className="flex justify-end" style={{ gap: '4px' }}>
                      {(r.inward_photos || []).slice(0, 4).map((p) => (
                        <a key={p} href={physicalUploadUrl(p)} target="_blank" rel="noreferrer">
                          <img src={physicalUploadUrl(p)} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
                        </a>
                      ))}
                    </span>
                  ),
                },
              ]}
            />
          </Section>
        </div>
      )}
    </Drawer>
  );
}

function RecordInwardDrawer({ open, onClose, onSaved }) {
  const [head, setHead] = useState({ warehouse: 'Main Warehouse', inward_date: todayIso(), reason: PHYSICAL_INWARD_REASONS[0], other: '', remarks: '' });
  const [lines, setLines] = useState([newLine()]);
  const [uploading, setUploading] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHead({ warehouse: 'Main Warehouse', inward_date: todayIso(), reason: PHYSICAL_INWARD_REASONS[0], other: '', remarks: '' });
    setLines([newLine()]);
  }, [open]);

  const patchLine = (key, patch) => setLines((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    const next = { ...l, ...patch };
    if (patch.quantity != null) {
      const n = Math.min(Math.max(Number(patch.quantity) || 1, 1), 20);
      next.quantity = n;
      next.units = Array.from({ length: n }, (_, i) => l.units[i] || { serial: '', photos: [] });
    }
    return next;
  }));
  const patchUnit = (key, idx, patch) => setLines((ls) => ls.map((l) => (l.key !== key ? l : { ...l, units: l.units.map((u, i) => (i === idx ? { ...u, ...patch } : u)) })));

  const upload = async (key, idx, files) => {
    if (!files.length) return;
    setUploading(`${key}-${idx}`);
    try {
      const data = await uploadPhysicalPartPhotos(files);
      const paths = data.paths || (data.path ? [data.path] : []);
      setLines((ls) => ls.map((l) => (l.key !== key ? l : { ...l, units: l.units.map((u, i) => (i === idx ? { ...u, photos: [...u.photos, ...paths] } : u)) })));
    } catch (e) {
      toast.error(errText(e, 'Photo upload failed'));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    const reason = head.reason === 'Other' ? head.other.trim() : head.reason;
    if (!head.warehouse.trim()) { toast.error('Warehouse is required'); return; }
    if (!reason) { toast.error('Give the reason'); return; }
    const units = [];
    for (const l of lines) {
      if (!l.part_name.trim()) { toast.error('Every part needs a name'); return; }
      for (let i = 0; i < l.units.length; i += 1) {
        const u = l.units[i];
        if (!u.photos.length) { toast.error(`Add a photo for ${l.part_name} (${i + 1} of ${l.units.length})`); return; }
        units.push({
          part_name: l.part_name.trim(), category: l.category, condition: l.condition,
          serial_number: u.serial.trim() || undefined, remarks: l.remarks.trim() || undefined,
          inward_photo_path: u.photos[0], inward_photo_paths: u.photos,
        });
      }
    }
    setSaving(true);
    try {
      const { data } = await createPhysicalInward({
        warehouse: head.warehouse.trim(), inward_date: head.inward_date, inward_reason: reason,
        remarks: head.remarks.trim() || undefined, units,
      });
      toast.success(`Inward ${data.inward.inward_number} · ${data.parts.length} part${data.parts.length === 1 ? '' : 's'}`);
      onClose?.();
      onSaved?.(data.inward.inward_number);
    } catch (e) {
      toast.error(errText(e, 'Could not record the inward'));
    } finally {
      setSaving(false);
    }
  };

  const total = lines.reduce((n, l) => n + l.units.length, 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record part inward"
      width="44rem"
      footer={<Button variant="primary" onClick={save} disabled={saving || Boolean(uploading)}>{saving ? 'Saving…' : `Record ${total} part${total === 1 ? '' : 's'}`}</Button>}
    >
      <div className="c-stack">
        <FormGrid cols={2}>
          <Field label="Warehouse" required><Input value={head.warehouse} onChange={(e) => setHead((h) => ({ ...h, warehouse: e.target.value }))} /></Field>
          <Field label="Date" required><Input type="date" value={head.inward_date} onChange={(e) => setHead((h) => ({ ...h, inward_date: e.target.value }))} /></Field>
          <Field label="Why is it being recorded" required span={2}>
            <Select options={PHYSICAL_INWARD_REASONS} value={head.reason} onChange={(e) => setHead((h) => ({ ...h, reason: e.target.value }))} />
          </Field>
          {head.reason === 'Other' && (
            <Field label="Reason" required span={2}><Input value={head.other} onChange={(e) => setHead((h) => ({ ...h, other: e.target.value }))} /></Field>
          )}
          <Field label="Remarks" span={2}><Textarea rows={2} value={head.remarks} onChange={(e) => setHead((h) => ({ ...h, remarks: e.target.value }))} /></Field>
        </FormGrid>

        {lines.map((l, n) => (
          <Section
            key={l.key}
            title={`Part ${n + 1}`}
            actions={lines.length > 1 && <Button variant="quiet" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>}
          >
            <FormGrid cols={2}>
              <Field label="Part name" required><Input value={l.part_name} onChange={(e) => patchLine(l.key, { part_name: e.target.value })} placeholder="e.g. 8GB DDR4 RAM" /></Field>
              <Field label="Category"><Select options={PART_CATEGORIES} value={l.category} onChange={(e) => patchLine(l.key, { category: e.target.value })} /></Field>
              <Field label="Condition"><Select options={PHYSICAL_CONDITIONS} value={l.condition} onChange={(e) => patchLine(l.key, { condition: e.target.value })} /></Field>
              <Field label="How many" hint="1 to 20"><Input type="number" min={1} max={20} value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} /></Field>
              <Field label="Remarks" span={2}><Input value={l.remarks} onChange={(e) => patchLine(l.key, { remarks: e.target.value })} /></Field>
            </FormGrid>
            <div className="c-stack" style={{ marginTop: '8px' }}>
              {l.units.map((u, i) => (
                <FormGrid cols={2} key={i}>
                  <Field label={`Serial${l.units.length > 1 ? ` #${i + 1}` : ''}`} hint="If it has one">
                    <Input value={u.serial} onChange={(e) => patchUnit(l.key, i, { serial: e.target.value })} />
                  </Field>
                  <Field label={`Photos${l.units.length > 1 ? ` #${i + 1}` : ''}`} required hint={uploading === `${l.key}-${i}` ? 'Uploading…' : `${u.photos.length} added`}>
                    <input type="file" accept="image/*" multiple onChange={(e) => { upload(l.key, i, Array.from(e.target.files || [])); e.target.value = ''; }} />
                    {u.photos.length > 0 && (
                      <span className="flex flex-wrap" style={{ gap: '4px', marginTop: '4px' }}>
                        {u.photos.map((p) => (
                          <button key={p} type="button" title="Remove" onClick={() => patchUnit(l.key, i, { photos: u.photos.filter((x) => x !== p) })} style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer' }}>
                            <img src={physicalUploadUrl(p)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                          </button>
                        ))}
                      </span>
                    )}
                  </Field>
                </FormGrid>
              ))}
            </div>
          </Section>
        ))}
        <Button variant="quiet" onClick={() => setLines((ls) => [...ls, newLine()])}>Add another part</Button>
      </div>
    </Drawer>
  );
}

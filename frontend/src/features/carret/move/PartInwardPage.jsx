import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, FormGrid, Input, KeyValue, Notice,
  Panel, Section, Segmented, Select, StatusChip, Tabs, Textarea,
} from '../../../components/carret';
import {
  PHYSICAL_CONDITIONS, PHYSICAL_INWARD_REASONS, PHYSICAL_RECEIVER_TYPES, createPhysicalInward, createPhysicalOutward,
  fetchPhysicalInward, fetchPhysicalInwards, fetchPhysicalOutwards, fetchPhysicalPartCounts, fetchPhysicalParts,
  uploadPhysicalPartPhotos,
} from '../../inventory-management/physicalDeadPartApi';
import { digitsOnly, physicalUploadUrl, todayIso } from '../../inventory-management/physicalDeadPartUi';
import { PART_CATEGORIES } from '../../../constants/laptopConditions';
import { usePermission } from '../../../hooks/usePermission';
import { errText } from './chargerShared';
import { OUTWARD_STATUS, outwardRecordPath } from './partOutwardShared';

/**
 * Movement → Dead parts — in & out. One place for dead, damaged or unlabelled
 * parts that are physically in the warehouse with no CRM record:
 *   in   — Record inward gives each one a DP number and a photo.
 *   out  — pick parts in the warehouse → Send out (receiver: scrap buyer,
 *          vendor, technician, warehouse, other; photos) → a request waits for
 *          warehouse approval → approving generates the Part DC (transport +
 *          signature) → the guard scans it at the gate and the parts are out.
 *          A request can be cancelled until it is approved.
 * Same API as the old /inventory-management/physical-parts screens
 * (/physical-parts, section physical_dead_parts; approve / cancel also need a
 * warehouse role or physical_dead_parts edit). Not the spare-parts PO receive
 * (Procurement), not old parts collected from the floor (Parts desk), and not
 * discarded catalogue parts (Stock → Scrap → Discarded parts).
 */
const SECTION = 'physical_dead_parts';
const PART_STATUS = {
  available: { chip: 'active', label: 'In warehouse' },
  pending: { chip: 'pending', label: 'On an outward' },
  out: { chip: 'dispatched', label: 'Gone out' },
};
const PART_TABS = ['available', 'pending', 'out', 'all'];
const TAB_KEYS = [...PART_TABS, 'inwards', 'outwards'];
const newLine = () => ({ key: Math.random().toString(36).slice(2), part_name: '', category: 'general', condition: 'dead', quantity: 1, remarks: '', units: [{ serial: '', photos: [] }] });
const receiverLabel = (v) => PHYSICAL_RECEIVER_TYPES.find((t) => t.value === v)?.label || v || '—';

export default function PartInwardPage() {
  const { hasPermission } = usePermission();
  const canCreate = hasPermission(SECTION, 'create');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TAB_KEYS.includes(params.get('tab')) ? params.get('tab') : 'available';
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const [search, setSearch] = useState('');
  const [outStatus, setOutStatus] = useState('');
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState({});
  const [state, setState] = useState({ loading: true, rows: [], total: 0, pages: 1, error: null });
  const [recording, setRecording] = useState(false);
  const [openInward, setOpenInward] = useState(null);
  const [picked, setPicked] = useState({});
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fetchPhysicalPartCounts().then(({ data }) => setCounts(data?.counts || {})).catch(() => {});
    const q = { search: search || undefined, page };
    let req;
    if (tab === 'inwards') req = fetchPhysicalInwards({ ...q, limit: 25 }).then(({ data }) => ({ rows: data?.inwards || [], p: data?.pagination }));
    else if (tab === 'outwards') req = fetchPhysicalOutwards({ ...q, status: outStatus || undefined, limit: 25 }).then(({ data }) => ({ rows: data?.outwards || [], p: data?.pagination }));
    else req = fetchPhysicalParts({ ...q, status: tab === 'all' ? undefined : tab, limit: 50 }).then(({ data }) => ({ rows: data?.parts || [], p: data?.pagination }));
    return req
      .then(({ rows, p }) => setState({ loading: false, rows, total: p?.total ?? rows.length, pages: p?.totalPages || 1, error: null }))
      .catch((e) => setState({ loading: false, rows: [], total: 0, pages: 1, error: errText(e, 'Could not load parts.') }));
  }, [tab, search, page, outStatus]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const chosen = Object.values(picked);
  const togglePick = (r) => setPicked((p) => {
    const n = { ...p };
    if (n[r.part_id]) delete n[r.part_id]; else n[r.part_id] = r;
    return n;
  });
  const selectable = canCreate && tab === 'available';
  const pageRows = selectable ? state.rows.filter((r) => r.status === 'available') : [];
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => picked[r.part_id]);
  const togglePage = () => setPicked((p) => {
    const n = { ...p };
    pageRows.forEach((r) => { if (allOnPage) delete n[r.part_id]; else n[r.part_id] = r; });
    return n;
  });

  const partColumns = useMemo(() => [
    ...(selectable ? [{
      key: 'x',
      header: <input type="checkbox" aria-label="Pick every part on this page" checked={allOnPage} onChange={togglePage} />,
      width: '2.5rem',
      render: (r) => (r.status === 'available'
        ? <input type="checkbox" aria-label={`Pick ${r.dp_number}`} checked={Boolean(picked[r.part_id])} onClick={(e) => e.stopPropagation()} onChange={() => togglePick(r)} />
        : null),
    }] : []),
    { key: 'dp', header: 'Part', render: (r) => <DocNumber value={r.dp_number} />, sub: (r) => r.part_name },
    { key: 'c', header: 'Category', render: (r) => PART_CATEGORIES.find((c) => c.value === r.category)?.label || r.category || '—', sub: (r) => r.serial_number || null },
    { key: 'cond', header: 'Condition', render: (r) => PHYSICAL_CONDITIONS.find((c) => c.value === r.condition)?.label || r.condition || '—' },
    { key: 'in', header: 'Came in', render: (r) => <DateTime value={r.inward_date || r.created_at} />, sub: (r) => [r.inward_number, r.inward_user].filter(Boolean).join(' · ') },
    { key: 'st', header: 'Status', render: (r) => <StatusChip status={PART_STATUS[r.status]?.chip || r.status} label={PART_STATUS[r.status]?.label || r.status} />, sub: (r) => [r.outward_number, r.receiver_name].filter(Boolean).join(' · ') || null },
    {
      key: 'ph', header: '', align: 'right',
      render: (r) => (r.inward_photo_path ? <a href={physicalUploadUrl(r.inward_photo_path)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Photo</a> : null),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [selectable, picked, allOnPage, state.rows]);

  const inwardColumns = useMemo(() => [
    { key: 'n', header: 'Inward', render: (r) => <DocNumber value={r.inward_number} />, sub: (r) => r.inward_reason },
    { key: 'd', header: 'Date', render: (r) => <DateTime value={r.inward_date || r.created_at} />, sub: (r) => r.created_by_name || null },
    { key: 'w', header: 'Warehouse', render: (r) => r.warehouse || '—' },
    { key: 'p', header: 'Parts', numeric: true, render: (r) => r.part_count ?? '—' },
  ], []);

  const outwardColumns = useMemo(() => [
    { key: 'n', header: 'Outward', render: (r) => <DocNumber value={r.outward_number} />, sub: (r) => r.purpose },
    { key: 'r', header: 'Going to', render: (r) => r.receiver_name, sub: (r) => [receiverLabel(r.receiver_type), r.receiver_contact].filter(Boolean).join(' · ') },
    { key: 'p', header: 'Parts', numeric: true, render: (r) => r.part_count ?? '—' },
    { key: 'd', header: 'Date', render: (r) => <DateTime value={r.outward_date || r.created_at} />, sub: (r) => r.created_by_name || null },
    { key: 's', header: 'Status', render: (r) => <StatusChip status={OUTWARD_STATUS[r.status]?.chip || r.status} label={OUTWARD_STATUS[r.status]?.label || r.status} />, sub: (r) => r.reference_number || null },
  ], []);

  const TABS = [
    { key: 'available', label: 'In warehouse', count: counts.available },
    { key: 'pending', label: 'On an outward', count: counts.pending },
    { key: 'out', label: 'Gone out', count: counts.out },
    { key: 'all', label: 'All parts', count: counts.total },
    { key: 'inwards', label: 'Inwards' },
    { key: 'outwards', label: 'Outwards', count: counts.pending_approval || undefined },
  ];
  const isParts = PART_TABS.includes(tab);
  let columns = partColumns;
  if (tab === 'inwards') columns = inwardColumns;
  if (tab === 'outwards') columns = outwardColumns;
  const placeholder = {
    inwards: 'Inward no., warehouse or reason',
    outwards: 'Outward no., receiver, reference or purpose',
  }[tab] || 'DP no., part, serial, inward or outward';

  return (
    <DeskShell
      title="Dead parts — in & out"
      breadcrumb="Movement"
      subtitle="Dead, damaged or unlabelled parts found in the warehouse — recorded with a photo, then sent out on a Part DC."
      actions={canCreate && (
        <>
          {chosen.length > 0 && <Button variant="primary" onClick={() => setSending(true)}>Send out {chosen.length} part{chosen.length === 1 ? '' : 's'}</Button>}
          <Button variant={chosen.length ? 'secondary' : 'primary'} onClick={() => setRecording(true)}>Record inward</Button>
        </>
      )}
    >
      <div className="c-stack">
        {counts.pending_approval > 0 && tab !== 'outwards' && (
          <Notice tone="info" title={`${counts.pending_approval} outward request${counts.pending_approval === 1 ? '' : 's'} waiting for warehouse approval`}>
            <Button variant="quiet" onClick={() => { setTab('outwards'); setOutStatus('draft'); setPage(1); }}>Open them</Button>
          </Notice>
        )}
        {selectable && chosen.length === 0 && (
          <Notice tone="info">Tick the parts going out, then Send out. They leave on a Part DC after the warehouse approves and the guard scans it.</Notice>
        )}
        <Panel
          toolbar={(
            <>
              <Tabs tabs={TABS} value={tab} onChange={(v) => { setTab(v); setPage(1); }} />
              <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
                {tab === 'outwards' && (
                  <Segmented
                    label="Status"
                    value={outStatus}
                    onChange={(v) => { setOutStatus(v); setPage(1); }}
                    options={[
                      { value: '', label: 'All' },
                      { value: 'draft', label: 'Awaiting approval' },
                      { value: 'dispatch_ready', label: 'At the gate' },
                      { value: 'dispatched', label: 'Gone out' },
                      { value: 'cancelled', label: 'Cancelled' },
                    ]}
                  />
                )}
                <FilterBar
                  filters={[{ key: 'search', label: 'Search', type: 'search', placeholder }]}
                  values={{ search }}
                  onChange={(k, v) => { setSearch(v); setPage(1); }}
                  onClear={() => setSearch('')}
                  count={`${state.total} ${tab === 'inwards' || tab === 'outwards' ? tab : 'parts'}${chosen.length ? ` · ${chosen.length} picked` : ''}`}
                />
              </div>
            </>
          )}
        >
          {state.loading && <EmptyState title="Loading…" />}
          {state.error && <EmptyState title="Could not load" body={state.error} />}
          {!state.loading && !state.error && (
            <>
              <DataTable
                columns={columns}
                rows={state.rows}
                rowKey={(r) => r.outward_id || r.inward_id || r.dp_number}
                onRowClick={(r) => {
                  if (tab === 'outwards') navigate(outwardRecordPath(r.outward_number));
                  else if (isParts && r.status !== 'available' && r.outward_number) navigate(outwardRecordPath(r.outward_number));
                  else setOpenInward(r.inward_number);
                }}
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
      <SendOutDrawer
        open={sending}
        parts={chosen}
        onRemove={(r) => togglePick(r)}
        onClose={() => setSending(false)}
        onSaved={(no) => { setPicked({}); navigate(outwardRecordPath(no)); }}
      />
    </DeskShell>
  );
}

const blankOutward = () => ({
  receiver_type: 'scrap_buyer', receiver_name: '', receiver_contact: '', outward_date: todayIso(),
  purpose: '', reference_number: '', remarks: '', photos: [],
});

function SendOutDrawer({ open, parts, onRemove, onClose, onSaved }) {
  const [f, setF] = useState(blankOutward);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setF(blankOutward()); }, [open]);
  useEffect(() => { if (open && parts.length === 0) onClose?.(); }, [open, parts.length, onClose]);

  const upload = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const data = await uploadPhysicalPartPhotos(files);
      const paths = data.paths || (data.path ? [data.path] : []);
      setF((x) => ({ ...x, photos: [...x.photos, ...paths] }));
    } catch (e) {
      toast.error(errText(e, 'Photo upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (saving) return;
    if (!f.receiver_name.trim()) { toast.error('Who is receiving the parts?'); return; }
    if (f.receiver_contact.length !== 10) { toast.error('Receiver mobile must be 10 digits'); return; }
    if (!f.purpose.trim()) { toast.error('Give the purpose'); return; }
    if (!f.photos.length) { toast.error('Add at least one photo of the parts going out'); return; }
    setSaving(true);
    try {
      const { data } = await createPhysicalOutward({
        part_ids: parts.map((p) => p.part_id),
        receiver_type: f.receiver_type,
        receiver_name: f.receiver_name.trim(),
        receiver_contact: f.receiver_contact,
        outward_date: f.outward_date,
        purpose: f.purpose.trim(),
        photo_path: f.photos[0],
        photo_paths: f.photos,
        reference_number: f.reference_number.trim() || undefined,
        remarks: f.remarks.trim() || undefined,
      });
      toast.success(`Outward ${data.outward.outward_number} raised — waiting for warehouse approval`);
      onClose?.();
      onSaved?.(data.outward.outward_number);
    } catch (e) {
      toast.error(errText(e, 'Could not raise the outward'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Send out ${parts.length} part${parts.length === 1 ? '' : 's'}`}
      width="40rem"
      footer={<Button variant="primary" onClick={save} disabled={saving || uploading}>{saving ? 'Raising…' : 'Raise outward request'}</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">The request waits for warehouse approval. Approving it generates the Part DC with its gate QR; the parts leave when the guard scans it.</Notice>
        <DataTable
          rowKey={(r) => r.part_id}
          rows={parts}
          columns={[
            { key: 'dp', header: 'Part', render: (r) => <DocNumber value={r.dp_number} />, sub: (r) => [r.part_name, r.serial_number].filter(Boolean).join(' · ') },
            { key: 'w', header: 'Warehouse', render: (r) => r.warehouse || '—' },
            { key: 'x', header: '', align: 'right', render: (r) => <Button variant="quiet" onClick={() => onRemove(r)}>Remove</Button> },
          ]}
        />
        <FormGrid cols={2}>
          <Field label="Receiver type" required>
            <Select options={PHYSICAL_RECEIVER_TYPES} value={f.receiver_type} onChange={(e) => setF({ ...f, receiver_type: e.target.value })} />
          </Field>
          <Field label="Receiver name" required><Input value={f.receiver_name} onChange={(e) => setF({ ...f, receiver_name: e.target.value })} /></Field>
          <Field label="Receiver mobile" required hint="10 digits">
            <Input inputMode="numeric" maxLength={10} value={f.receiver_contact} onChange={(e) => setF({ ...f, receiver_contact: digitsOnly(e.target.value) })} />
          </Field>
          <Field label="Outward date" required><Input type="date" value={f.outward_date} onChange={(e) => setF({ ...f, outward_date: e.target.value })} /></Field>
          <Field label="Purpose" required span={2}><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Sold as scrap, returned to vendor" /></Field>
          <Field label="Existing challan / reference" span={2} hint="Optional — SCRAP/…, VRDC/…"><Input value={f.reference_number} onChange={(e) => setF({ ...f, reference_number: e.target.value })} /></Field>
          <Field label="Remarks" span={2}><Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
          <Field label="Photos of the parts going out" required span={2} hint={uploading ? 'Uploading…' : `${f.photos.length} added`}>
            <input type="file" accept="image/*" multiple onChange={(e) => { upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
            {f.photos.length > 0 && (
              <span className="flex flex-wrap" style={{ gap: '4px', marginTop: '4px' }}>
                {f.photos.map((p) => (
                  <button key={p} type="button" title="Remove" onClick={() => setF((x) => ({ ...x, photos: x.photos.filter((y) => y !== p) }))} style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer' }}>
                    <img src={physicalUploadUrl(p)} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
                  </button>
                ))}
              </span>
            )}
          </Field>
        </FormGrid>
      </div>
    </Drawer>
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

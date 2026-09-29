import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input, KeyValue,
  Money, Notice, Section, Segmented, StatusChip, Textarea,
} from '../../../../components/carret';
import FitmentPicker from './FitmentPicker';
import {
  CATEGORY_LABEL, UNIT_STATUS, adjustPartCount, isStructured, partKindLabel, partSpecsText, bulkUpdatePartInstanceFitment, createPartVendorReturnDc, errMsg,
  fetchPartUsage, fitmentFromUnit, fitsSummary, listPartInstances, partCategory, updatePartInstance,
  updatePartInstanceFitment,
} from './partsApi';

/** Only free stock is reclassified by hand; workflow states stay with their flow (API rule). */
const EDITABLE = new Set(['in_stock', 'defective', 'discarded']);

export function UnitStatus({ status }) {
  const s = UNIT_STATUS[status];
  return <StatusChip status={s ? s.chip : status} label={s ? s.label : undefined} />;
}

function UnitEditForm({ unit, onDone, onCancel }) {
  const [serial, setSerial] = useState(unit.serial_number || '');
  const [location, setLocation] = useState(unit.location_code || '');
  const [cost, setCost] = useState(unit.unit_cost != null ? String(unit.unit_cost) : '');
  const [fit, setFit] = useState(() => fitmentFromUnit(unit));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updatePartInstance(unit.instance_id, {
        serial_number: serial.trim() || null,
        location_code: location.trim() || null,
        unit_cost: cost === '' ? undefined : Number(cost),
      });
      const before = fitmentFromUnit(unit);
      if (JSON.stringify(before) !== JSON.stringify(fit)) {
        await updatePartInstanceFitment(unit.instance_id, { ...fit, reason: 'Edited from Parts catalogue' });
      }
      toast.success('Unit saved');
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Section title={`Edit unit ${unit.prt_id}`} actions={<Button variant="quiet" onClick={onCancel}>Cancel</Button>}>
      <div className="c-stack">
        <FormGrid cols={3}>
          <Field label="Serial number"><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
          <Field label="Shelf / location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Unit cost (₹)"><Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        </FormGrid>
        <FitmentPicker value={fit} onChange={setFit} />
        <div><Button variant="primary" disabled={busy || (cost !== '' && !(Number(cost) >= 0)) || (fit.fitment === 'specific' && !fit.fits_laptop_brand)} onClick={save}>Save unit</Button></div>
      </div>
    </Section>
  );
}

function SendToVendorForm({ unit, onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const { data } = await createPartVendorReturnDc({
        instance_ids: [unit.instance_id],
        remarks: reason.trim(),
        item_remarks: { [unit.instance_id]: reason.trim() },
      });
      toast.success(`Part repair challan ${data.dc_number} created — dispatch it from Part repairs`);
      onDone?.(data.dc_number);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Section title={`Send ${unit.prt_id} back to its vendor`} actions={<Button variant="quiet" onClick={onCancel}>Cancel</Button>}>
      <div className="c-stack">
        <p className="text-ink-3">Creates a draft part repair challan to {unit.vendor_name || 'the vendor on its PO'}. Several defective units for one vendor can go on one challan from Part repairs.</p>
        <Field label="Why" required hint="At least 10 characters — defective, DOA, wrong part, warranty…"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div><Button variant="primary" disabled={busy || reason.trim().length < 10} onClick={send}>Create challan</Button></div>
      </div>
    </Section>
  );
}

function BulkFitmentSection({ partId, units, onDone }) {
  const [scope, setScope] = useState('untagged');
  const [fit, setFit] = useState({ fitment: 'universal', fits_laptop_brand: null, fits_laptop_models: [] });
  const [confirm, setConfirm] = useState(false);
  const untagged = units.filter((u) => String(u.fitment || 'unset') === 'unset').length;
  const target = scope === 'untagged' ? untagged : units.length;
  const apply = async () => {
    try {
      const { data } = await bulkUpdatePartInstanceFitment({
        part_id: partId, only_untagged: scope === 'untagged', ...fit, reason: 'Bulk tagged from Parts catalogue',
      });
      toast.success(`${data.updated || 0} unit(s) tagged`);
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Section title="Tag fitment in bulk">
      <div className="c-stack">
        <p className="text-ink-3">An untagged unit is offered for every laptop. Tag a whole part at once.</p>
        <Segmented label="Which units" value={scope} onChange={setScope} options={[{ value: 'untagged', label: `Untagged (${untagged})` }, { value: 'all', label: `All (${units.length})` }]} />
        <FitmentPicker allowUnset={false} label="Fitment to apply" value={fit} onChange={setFit} />
        <div><Button disabled={!target || (fit.fitment === 'specific' && !fit.fits_laptop_brand)} onClick={() => setConfirm(true)}>Apply to {target} unit{target === 1 ? '' : 's'}</Button></div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={apply} tone="warn" title="Tag units" body={`Tag ${target} unit(s) as "${fitsSummary(fit)}"?`} confirmLabel="Tag them" />
    </Section>
  );
}

function UsageSection({ partId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetchPartUsage(partId).then(({ data }) => setRows(data.usage || [])).catch(() => setRows([]));
  }, [partId]);
  const cols = [
    { key: 'd', header: 'Date', render: (r) => <DateTime value={r.added_at} /> },
    { key: 't', header: 'Ticket', render: (r) => <Link to={`/carret/produce/tickets/${r.ticket_id}`}>#{r.ticket_id}</Link> },
    { key: 'l', header: 'Laptop', render: (r) => r.machine_number || r.serial_number || '—' },
    { key: 'w', header: 'Technician', render: (r) => r.technician_name || '—' },
    { key: 'q', header: 'Qty', numeric: true, render: (r) => r.quantity_used },
  ];
  return (
    <Section title="Usage on floor tickets">
      {rows === null ? <EmptyState title="Loading…" /> : <DataTable columns={cols} rows={rows} rowKey={(r, i) => `${r.ticket_id}-${i}`} empty={<EmptyState title="Not used on any ticket yet" />} />}
    </Section>
  );
}

function CountAdjustSection({ part, onDone }) {
  const [mode, setMode] = useState('add');
  const [n, setN] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const current = Number(part.quantity) || 0;
  const num = Number(n);
  const delta = mode === 'add' ? num : mode === 'use' ? -num : num - current;
  const ok = Number.isInteger(num) && num >= 0 && delta !== 0 && current + delta >= 0 && (mode === 'add' || reason.trim());
  const save = async () => {
    setBusy(true);
    try {
      await adjustPartCount(part.part_id, delta, reason.trim() || undefined);
      toast.success('Count updated');
      setN(''); setReason('');
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Section title={`Count on hand: ${current}`}>
      <div className="c-stack">
        <p className="text-ink-3">Consumables are counted, not tracked unit by unit. Every change is logged with its reason.</p>
        <Segmented label="Change" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Add' }, { value: 'use', label: 'Used / removed' }, { value: 'set', label: 'Set exact count' }]} />
        <FormGrid cols={2}>
          <Field label={mode === 'set' ? 'Exact count' : 'Quantity'} required><Input type="number" min="0" value={n} onChange={(e) => setN(e.target.value)} /></Field>
          <Field label="Reason" required={mode !== 'add'}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </FormGrid>
        <div><Button variant="primary" disabled={busy || !ok} onClick={save}>{n ? `Save (${delta > 0 ? '+' : ''}${delta})` : 'Save'}</Button></div>
      </div>
    </Section>
  );
}

/**
 * One catalogue part: its details, every unit with its state, and the unit
 * actions of the old Serials drawer (edit, defective, discard, restore, send
 * back to vendor, labels), bulk fitment tagging, usage history, and the count
 * for consumables.
 */
export default function PartRecordDrawer({
  part, onClose, onChanged, onEdit, onAddUnits, onPrint, canEditPart, canWriteUnits, canSendToVendor,
}) {
  const open = Boolean(part);
  const [units, setUnits] = useState(null);
  const [q, setQ] = useState('');
  const [editUnit, setEditUnit] = useState(null);
  const [sendUnit, setSendUnit] = useState(null);
  const [view, setView] = useState('units');

  const load = useCallback(() => {
    if (!part?.part_id) return;
    setUnits(null);
    listPartInstances({ part_id: part.part_id, limit: 1000 })
      .then(({ data }) => setUnits(data.instances || []))
      .catch((e) => { setUnits([]); toast.error(errMsg(e)); });
  }, [part?.part_id]);
  useEffect(() => { if (open) { setQ(''); setEditUnit(null); setSendUnit(null); setView('units'); load(); } }, [open, load]);

  const changed = useCallback(() => { setEditUnit(null); setSendUnit(null); load(); onChanged?.(); }, [load, onChanged]);
  const setStatus = async (u, status) => {
    try { await updatePartInstance(u.instance_id, { status }); toast.success('Unit updated'); changed(); } catch (e) { toast.error(errMsg(e)); }
  };

  const counts = useMemo(() => (units || []).reduce((c, u) => ({ ...c, [u.status]: (c[u.status] || 0) + 1 }), {}), [units]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return units || [];
    return (units || []).filter((u) => [u.prt_id, u.serial_number, u.location_code, u.status, u.installed_ttspl_id, u.fits_laptop_brand, u.brand_name]
      .some((v) => String(v || '').toLowerCase().includes(n)));
  }, [units, q]);

  if (!open) return null;

  const cols = [
    { key: 'p', header: 'Part ID', render: (u) => <DocNumber value={u.prt_id} />, sub: (u) => u.serial_number || 'no serial' },
    { key: 's', header: 'State', render: (u) => <UnitStatus status={u.status} />, sub: (u) => (u.installed_ttspl_id ? `in ${u.installed_ttspl_id}` : u.vendor_repair_dc_number || null) },
    { key: 'f', header: 'Fits', render: (u) => fitsSummary(u) },
    { key: 'l', header: 'Shelf', render: (u) => u.location_code || '—' },
    { key: 'c', header: 'Cost', numeric: true, render: (u) => <Money value={u.unit_cost} showZero={false} /> },
    { key: 'r', header: 'Received', render: (u) => <DateTime value={u.received_at || u.created_at} /> },
    {
      key: 'x',
      header: '',
      render: (u) => (
        <div className="flex flex-wrap" style={{ gap: '4px', justifyContent: 'flex-end' }}>
          {u.prt_id && <Button variant="quiet" onClick={() => onPrint?.([u], part.part_name)}>Label</Button>}
          {canWriteUnits && EDITABLE.has(u.status) && <Button variant="quiet" onClick={() => { setSendUnit(null); setEditUnit(u); }}>Edit</Button>}
          {canWriteUnits && u.status === 'in_stock' && <Button variant="quiet" onClick={() => setStatus(u, 'defective')}>Defective</Button>}
          {canWriteUnits && u.status === 'in_stock' && <Button variant="quiet" onClick={() => setStatus(u, 'discarded')}>Discard</Button>}
          {canWriteUnits && (u.status === 'defective' || u.status === 'discarded') && <Button variant="quiet" onClick={() => setStatus(u, 'in_stock')}>Back to stock</Button>}
          {canSendToVendor && u.status === 'defective' && u.spo_id && !u.vendor_repair_dc_number && (
            <Button variant="quiet" onClick={() => { setEditUnit(null); setSendUnit(u); }}>Send to vendor…</Button>
          )}
          {u.vendor_repair_dc_number && <Link to={`/carret/stock/part-repairs/${encodeURIComponent(u.vendor_repair_dc_number)}`}>{u.vendor_repair_dc_number}</Link>}
        </div>
      ),
    },
  ];
  const inStockUnits = (units || []).filter((u) => u.status === 'in_stock' && u.prt_id);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={part.part_name}
      width="60rem"
      footer={(
        <div className="flex flex-wrap" style={{ gap: '8px' }}>
          {canWriteUnits && !part.archived && <Button variant="primary" onClick={() => onAddUnits?.(part)}>Add units</Button>}
          {canEditPart && <Button onClick={() => onEdit?.(part)}>Edit part</Button>}
          {inStockUnits.length > 0 && <Button onClick={() => onPrint?.(inStockUnits, part.part_name)}>Labels for {inStockUnits.length} in stock</Button>}
        </div>
      )}
    >
      <div className="c-stack">
        <KeyValue
          cols={4}
          items={[
            { label: 'Category', value: CATEGORY_LABEL[partCategory(part)] || part.category },
            { label: 'What it is', value: partKindLabel(part) || 'Not set (old name)' },
            { label: 'Details', value: partSpecsText(part) || part.description },
            { label: 'Fits laptops', value: fitsSummary(part) },
            { label: 'Part number', value: part.model_number },
            { label: 'Pin / connector', value: part.pin_size },
            { label: 'SKU', value: part.part_sku },
            { label: 'Name', value: part.name_override ? 'Typed by hand' : isStructured(part) ? 'Generated from the details' : null },
            { label: 'Was called', value: part.specs?._was && part.specs._was !== part.part_name ? part.specs._was : null },
            { label: 'Brand / model', value: [part.default_brand, part.default_model].filter(Boolean).join(' · ') },
            { label: 'Unit cost', value: <Money value={part.cost} /> },
            { label: 'Minimum stock', value: part.min_threshold },
            { label: 'Warranty', value: part.warranty_months ? `${part.warranty_months} months` : null },
            { label: 'Shelf', value: part.location_code },
            { label: 'Vendor', value: part.vendor },
            { label: 'Consumable', value: part.is_consumable ? 'Yes' : 'No' },
            { label: 'Notes', value: part.notes },
          ]}
        />
        <p className="text-ink-3">
          {Object.entries(counts).map(([s, n]) => `${UNIT_STATUS[s]?.label || s}: ${n}`).join(' · ') || 'No units yet'}
        </p>
        {editUnit && <UnitEditForm key={editUnit.instance_id} unit={editUnit} onDone={changed} onCancel={() => setEditUnit(null)} />}
        {sendUnit && <SendToVendorForm key={sendUnit.instance_id} unit={sendUnit} onDone={changed} onCancel={() => setSendUnit(null)} />}
        <Segmented
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: 'units', label: `Units (${(units || []).length})` },
            ...(canWriteUnits ? [{ value: 'fitment', label: 'Tag fitment' }] : []),
            { value: 'usage', label: 'Usage' },
            ...(part.is_consumable && canEditPart ? [{ value: 'count', label: 'Count' }] : []),
          ]}
        />
        {view === 'units' && (
          <>
            <Input type="search" placeholder="Part ID, serial, shelf, state, laptop" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '22rem' }} />
            {units === null ? <EmptyState title="Loading…" /> : (
              <DataTable columns={cols} rows={shown} rowKey={(u) => u.instance_id} empty={<EmptyState title={units.length ? 'No unit matches' : 'No units yet'} body={units.length ? undefined : 'Add units, or receive them on a spare-parts PO.'} />} />
            )}
            {part.is_consumable && <Notice tone="info">Consumable: stock is the count on hand ({Number(part.quantity) || 0}); change it under Count.</Notice>}
          </>
        )}
        {view === 'fitment' && <BulkFitmentSection partId={part.part_id} units={units || []} onDone={changed} />}
        {view === 'usage' && <UsageSection partId={part.part_id} />}
        {view === 'count' && <CountAdjustSection part={part} onDone={() => onChanged?.()} />}
      </div>
    </Drawer>
  );
}

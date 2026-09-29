import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, FormGrid, Input, KeyValue,
  Money, Notice, Section, Select, StatTile,
} from '../../../components/carret';
import ScanField from '../../../components/ScanField';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import PartLabelPrintDrawer from '../stock/setup/PartLabelPrintDrawer';
import { invalidateInventoryManagement } from '../../inventory-management/inventoryCountsEvents';
import FitmentPicker from '../stock/setup/FitmentPicker';
import { errMsg } from './procureShared';
import { SPO_BASE, spareLineName, spoStatusLabel } from './poShared';

/**
 * Procure → Spare-parts order → receive parts (replaces the old
 * /vendor-management/spare-parts-po/:id/receive screen, same API).
 *
 *   1. pick the delivery (GRN) — or open a new one with the vendor's challan
 *      and invoice number; the first receipt opens one by itself;
 *   2. on a PO line: how many came → scan each serial (or "no serial") →
 *      which laptops it fits, shelf, note;
 *   3. each unit gets its Part ID (PRT…) → print the QR labels.
 * Partial receipts are normal; the order moves to "Receiving", then
 * "Received" when every line is in. If nothing more is coming, a manager
 * short-closes it on the order record.
 */
const MAX_PER_SUBMIT = 250;
const ordered = (l) => Number(l?.quantity) || 0;
const got = (l) => Number(l?.receivedQty) || 0;
const left = (l) => Math.max(0, ordered(l) - got(l));
const newKey = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);
const grnLabel = (g) => [
  g.grn_number || `GRN-${String(g.grn_id).padStart(4, '0')}`,
  g.vendor_challan_no ? `challan ${g.vendor_challan_no}` : null,
  `${g.received_qty ?? 0} part${Number(g.received_qty) === 1 ? '' : 's'}`,
].filter(Boolean).join(' · ');

/** Warranty on a line, counted from the PO date (months × 30 days, as the old screen). */
function warrantyText(line, poDate) {
  const months = Number(line?.warranty_months ?? line?.warranty ?? line?.warranty_in_month) || 0;
  if (!months) return '—';
  const start = poDate ? new Date(poDate) : new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + Math.round(months * 30));
  const days = Math.round((end.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  return days > 0 ? `${months} months · ${days} days left` : `${months} months · expired`;
}

/** Catalogue defaults for the line's part: fitment and shelf. */
async function catalogDefaults(line) {
  const floorId = line?.floor_part_id ?? line?.parts_catalog_id ?? null;
  const name = String(line?.spare_part_name || line?.part_name || line?.name || '').trim();
  const { data } = await api.get('/parts', { params: { limit: 50, ...(name ? { search: name } : {}) } });
  const parts = data?.parts || [];
  let part = floorId != null ? parts.find((p) => Number(p.part_id) === Number(floorId)) : null;
  if (!part && name) part = parts.find((p) => String(p.part_name || '').toLowerCase() === name.toLowerCase());
  if (!part) return null;
  const f = String(part.default_fitment || 'unset').toLowerCase();
  const brand = Array.isArray(part.compatible_brands) && part.compatible_brands[0] ? String(part.compatible_brands[0]).trim() : null;
  let fitment = { fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] };
  if (f === 'universal') fitment = { fitment: 'universal', fits_laptop_brand: null, fits_laptop_models: [] };
  if (f === 'specific' && brand) {
    fitment = {
      fitment: 'specific',
      fits_laptop_brand: brand,
      fits_laptop_models: (part.compatible_models || []).map((m) => String(m).trim()).filter(Boolean),
    };
  }
  return { fitment, shelf: part.location_code || '' };
}

const unitLabel = (u, title, poNumber) => ({
  code: u.prt_id,
  title,
  subtitle: u.physical_serial ? `Serial ${u.physical_serial}` : 'No serial on this part',
  serialNumber: u.physical_serial || '',
  poNumber,
});

/** The receive drawer for one PO line: quantity → serials → labels. */
function ReceiveDrawer({ open, line, lineIndex, poNumber, poId, grnId, onClose, onReceived, onPrint }) {
  const [step, setStep] = useState('qty');
  const [qty, setQty] = useState('');
  const [serials, setSerials] = useState([]);
  const [noSerial, setNoSerial] = useState([]);
  const [fitment, setFitment] = useState({ fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] });
  const [shelf, setShelf] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState([]);

  useEffect(() => {
    if (!open) return;
    setStep('qty'); setQty(''); setSerials([]); setNoSerial([]); setCreated([]); setNote(''); setShelf(''); setKey('');
    setFitment({ fitment: 'unset', fits_laptop_brand: null, fits_laptop_models: [] });
  }, [open, lineIndex]);

  const remaining = left(line);
  const cap = Math.min(remaining, MAX_PER_SUBMIT);
  const title = line ? spareLineName(line) : '';

  const toSerials = async () => {
    const q = parseInt(String(qty).trim(), 10);
    if (!Number.isFinite(q) || q < 1) { toast.error('Quantity must be at least 1'); return; }
    if (q > remaining) { toast.error(`Only ${remaining} left to receive on this line`); return; }
    if (q > MAX_PER_SUBMIT) { toast.error(`At most ${MAX_PER_SUBMIT} per receipt`); return; }
    setSerials(Array.from({ length: q }, () => ''));
    setNoSerial(Array.from({ length: q }, () => false));
    setKey(newKey());
    setStep('serials');
    try {
      const d = await catalogDefaults(line);
      if (d) { setFitment(d.fitment); setShelf((s) => s || d.shelf); }
    } catch { /* the catalogue default is a convenience only */ }
  };

  const setSerialAt = (i, v) => setSerials((s) => s.map((x, j) => (j === i ? v : x)));
  const toggleNoSerial = (i) => {
    setNoSerial((f) => f.map((x, j) => (j === i ? !x : x)));
    setSerials((s) => s.map((x, j) => (j === i ? '' : x)));
  };
  const focusNext = (i) => document.getElementById(`spr-serial-${i + 1}`)?.focus();
  const ready = serials.length > 0 && serials.every((s, i) => noSerial[i] || String(s || '').trim());

  const submit = async () => {
    const values = serials.map((s, i) => (noSerial[i] ? '' : String(s || '').trim().toUpperCase()));
    const present = values.filter(Boolean);
    if (new Set(present).size !== present.length) { toast.error('A serial is scanned twice in this batch'); return; }
    if (fitment.fitment === 'specific' && !fitment.fits_laptop_brand) { toast.error('Choose the laptop brand it fits, or pick another option'); return; }
    setBusy(true);
    try {
      const body = {
        line_index: lineIndex,
        quantity: values.length,
        serial_numbers: values,
        receive_key: key,
        fitment: fitment.fitment,
        fits_laptop_brand: fitment.fits_laptop_brand,
        fits_laptop_models: fitment.fits_laptop_models,
        location_code: shelf.trim() || null,
        note: note.trim() || null,
      };
      if (grnId) body.grn_id = Number(grnId);
      const { data } = await api.post(`${SPO_BASE}/${poId}/product-received/receive-bulk`, body);
      const units = data.data?.created || [];
      setCreated(units);
      setStep('labels');
      toast.success(data.message || `Received ${units.length}`);
      invalidateInventoryManagement();
      onReceived?.();
    } catch (e) {
      const m = e.response?.data?.message || e.response?.data?.errors?.[0]?.msg;
      toast.error(m || errMsg(e, 'Could not receive these parts'));
    } finally {
      setBusy(false);
    }
  };

  const labels = created.filter((u) => u.prt_id).map((u) => unitLabel(u, title, poNumber));

  let footer = null;
  if (step === 'qty') footer = <Button variant="primary" disabled={!remaining} onClick={toSerials}>Next — scan units</Button>;
  if (step === 'serials') {
    footer = (
      <div className="flex" style={{ gap: '8px' }}>
        <Button variant="quiet" disabled={busy} onClick={() => setStep('qty')}>Back</Button>
        <Button variant="primary" disabled={busy || !ready} onClick={submit}>{busy ? 'Receiving…' : `Receive ${serials.length} part${serials.length === 1 ? '' : 's'}`}</Button>
      </div>
    );
  }
  if (step === 'labels') {
    footer = (
      <div className="flex" style={{ gap: '8px' }}>
        <Button variant="quiet" onClick={onClose}>Done</Button>
        <Button variant="primary" disabled={!labels.length} onClick={() => onPrint(labels)}>Print QR labels</Button>
      </div>
    );
  }

  return (
    <Drawer open={open} onClose={() => { if (!busy) onClose(); }} title={step === 'labels' ? 'Received — print labels' : `Receive — line ${lineIndex + 1}`} footer={footer} width="36rem">
      {line && (
        <div className="c-stack">
          <KeyValue
            cols={3}
            items={[
              { label: 'Part', value: title || '—' },
              { label: 'Ordered / in', value: `${ordered(line)} / ${got(line)}` },
              { label: 'Left', value: remaining },
            ]}
          />
          {step === 'qty' && (
            <Field label="How many arrived" required hint={`1 to ${cap}. Every unit gets its own Part ID and QR label; a part without a serial is tracked by its Part ID.`}>
              <Input type="number" min={1} max={cap} value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') toSerials(); }} autoFocus />
            </Field>
          )}
          {step === 'serials' && (
            <>
              <FitmentPicker value={fitment} onChange={setFitment} label="Fits laptops (all units below)" />
              <FormGrid cols={2}>
                <Field label="Shelf" hint="Where these are put away"><Input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="e.g. R2-S4" /></Field>
                <Field label="Note" hint="Damage, short pack…"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Leave empty if none" /></Field>
              </FormGrid>
              <div className="c-stack" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                {serials.map((v, i) => (
                  <Field key={i} label={`Unit ${i + 1} — serial`}>
                    <ScanField
                      id={`spr-serial-${i}`}
                      value={v}
                      disabled={busy || noSerial[i]}
                      autoFocus={i === 0}
                      placeholder={noSerial[i] ? 'No serial — Part ID only' : 'Scan or type the serial'}
                      aria-label={`Serial for unit ${i + 1}`}
                      onChange={(val) => setSerialAt(i, val)}
                      onScan={() => focusNext(i)}
                    />
                    <Checkbox label="This part has no serial" checked={Boolean(noSerial[i])} disabled={busy} onChange={() => toggleNoSerial(i)} />
                  </Field>
                ))}
              </div>
              <p className="text-ink-3" style={{ margin: 0 }}>A scan jumps to the next unit. A serial already in stock is refused.</p>
            </>
          )}
          {step === 'labels' && (
            <>
              <Notice tone="good" title={`${created.length} part${created.length === 1 ? '' : 's'} received into stock`}>
                Print two labels per part so a damaged sticker does not lose the unit.
              </Notice>
              <DataTable
                rows={created}
                rowKey={(u) => u.serial_id}
                columns={[
                  { key: 'p', header: 'Part ID', render: (u) => <DocNumber value={u.prt_id} /> },
                  { key: 's', header: 'Serial', render: (u) => u.physical_serial || 'No serial' },
                ]}
              />
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

/** A new delivery (GRN) with the vendor's challan and invoice numbers. */
function NewGrnDrawer({ open, busy, onClose, onSave }) {
  const [challan, setChallan] = useState('');
  const [invoice, setInvoice] = useState('');
  useEffect(() => { if (open) { setChallan(''); setInvoice(''); } }, [open]);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New delivery (GRN)"
      footer={<Button variant="primary" disabled={busy} onClick={() => onSave({ vendor_challan_no: challan.trim() || null, vendor_invoice_no: invoice.trim() || null })}>{busy ? 'Opening…' : 'Open GRN'}</Button>}
    >
      <div className="c-stack">
        <p className="text-ink-2" style={{ margin: 0 }}>One GRN per delivery from the vendor. The parts you receive next are recorded on it.</p>
        <Field label="Vendor challan no."><Input value={challan} onChange={(e) => setChallan(e.target.value)} autoFocus /></Field>
        <Field label="Vendor invoice no." hint="Needed before the vendor is paid"><Input value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

export default function SparePoReceivePage() {
  const { spoId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = ['vendor_management', 'parts_procurement'].some((s) => hasPermission(s, 'edit'));
  const canCreate = ['vendor_management', 'parts_procurement'].some((s) => hasPermission(s, 'create'));

  const [ctx, setCtx] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [grnId, setGrnId] = useState('');
  const [units, setUnits] = useState({ loading: false, rows: [], grn: null });
  const [receiveLine, setReceiveLine] = useState(null);
  const [grnOpen, setGrnOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [labels, setLabels] = useState([]);

  const load = useCallback(() => {
    api.get(`${SPO_BASE}/${spoId}/product-received`)
      .then(({ data }) => {
        setCtx(data.data);
        const gs = data.data?.grns || [];
        setGrnId((cur) => (cur && gs.some((g) => String(g.grn_id) === cur) ? cur : (gs.length ? String(gs[gs.length - 1].grn_id) : '')));
      })
      .catch((e) => setLoadError(errMsg(e, 'Could not load this order.')));
  }, [spoId]);
  useEffect(() => { load(); }, [load]);

  const loadUnits = useCallback(() => {
    if (!grnId) { setUnits({ loading: false, rows: [], grn: null }); return; }
    setUnits((u) => ({ ...u, loading: true }));
    api.get(`${SPO_BASE}/${spoId}/grns/${grnId}/received-products`)
      .then(({ data }) => setUnits({ loading: false, rows: data.data?.items || [], grn: data.data }))
      .catch(() => setUnits({ loading: false, rows: [], grn: null }));
  }, [spoId, grnId]);
  useEffect(() => { loadUnits(); }, [loadUnits]);

  const po = ctx?.spare_purchase_order;
  const lines = useMemo(() => ctx?.lines || [], [ctx]);
  const grns = ctx?.grns || [];
  const stats = ctx?.stats || { order_qty: 0, received_qty: 0, remaining_qty: 0, total_lines: 0 };
  const st = String(po?.status || '').toLowerCase();

  const openGrn = async (body) => {
    setBusy('grn');
    try {
      const { data } = await api.post(`${SPO_BASE}/${spoId}/grns`, body);
      const g = data.data;
      toast.success(g.reused ? `${g.grn_number} is still empty — use it` : `${g.grn_number} opened`);
      setGrnId(String(g.grn_id));
      setGrnOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not open a GRN'));
    } finally {
      setBusy('');
    }
  };

  const onReceived = () => { load(); loadUnits(); };
  const printLabels = (ls) => { setLabels(ls); };

  if (loadError) {
    return (
      <DeskShell title="Receive parts" breadcrumb="Procurement / Spare-parts orders">
        <EmptyState title="Receiving is not open for this order" body={loadError} action={<Button onClick={() => navigate(`/carret/procure/spare-parts-orders/${spoId}`)}>Open the order</Button>} />
      </DeskShell>
    );
  }
  if (!ctx) return <DeskShell title="Receive parts" breadcrumb="Procurement / Spare-parts orders"><EmptyState title="Loading…" /></DeskShell>;

  const lineCols = [
    { key: 'n', header: '#', numeric: true, render: (l, i) => i + 1 },
    { key: 'p', header: 'Part', render: (l) => spareLineName(l) || '—', sub: (l) => l.category_label || l.category || null },
    { key: 'w', header: 'Warranty', render: (l) => warrantyText(l, po?.purchase_order_date) },
    { key: 'r', header: 'Unit cost', numeric: true, render: (l) => <Money value={l.rate} /> },
    { key: 'o', header: 'Ordered', numeric: true, render: (l) => ordered(l) },
    { key: 'g', header: 'Received', numeric: true, render: (l) => got(l) },
    { key: 'l', header: 'Left', numeric: true, render: (l) => left(l) },
    {
      key: 'a',
      header: '',
      render: (l, i) => (left(l) > 0
        ? (canEdit && <Button variant="primary" onClick={() => setReceiveLine(i)}>Receive</Button>)
        : <span className="text-ink-3">All in</span>),
    },
  ];

  const unitCols = [
    { key: 'p', header: 'Part ID', render: (u) => (u.prt_id ? <DocNumber value={u.prt_id} /> : '—'), sub: (u) => (u.physical_serial ? `Serial ${u.physical_serial}` : (u.prt_id ? 'No serial' : u.serial_number)) },
    { key: 'n', header: 'Part', render: (u) => [u.part_name, u.brand && u.brand !== 'Any' ? u.brand : null, u.model].filter(Boolean).join(' · ') || '—' },
    { key: 's', header: 'Shelf', render: (u) => u.location_code || '—' },
    { key: 'c', header: 'Cost', numeric: true, render: (u) => (u.unit_cost != null ? <Money value={u.unit_cost} /> : '—') },
    { key: 'st', header: 'Now', render: (u) => String(u.part_status || '—').replace(/_/g, ' '), sub: (u) => u.receipt_note || null },
    { key: 'd', header: 'Received', render: (u) => <DateTime value={u.grn_date} /> },
    {
      key: 'lb',
      header: '',
      render: (u) => u.prt_id && (
        <Button variant="quiet" onClick={() => printLabels([unitLabel(u, [u.part_name, u.brand && u.brand !== 'Any' ? u.brand : null].filter(Boolean).join(' · '), po?.purchase_order_number)])}>Label</Button>
      ),
    },
  ];
  const grnLabels = units.rows.filter((u) => u.prt_id).map((u) => unitLabel(u, [u.part_name, u.brand && u.brand !== 'Any' ? u.brand : null].filter(Boolean).join(' · '), po?.purchase_order_number));
  const selectedGrn = grns.find((g) => String(g.grn_id) === grnId);

  return (
    <DeskShell title={`Receive — ${po?.purchase_order_number || 'spare-parts order'}`} breadcrumb="Procurement / Spare-parts orders" subtitle={po?.vendor_display_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={po?.purchase_order_number}
          type="Spare-parts order · receiving"
          status={st === 'pending' ? 'pending_approval' : st}
          actions={<Button variant="quiet" onClick={() => navigate(`/carret/procure/spare-parts-orders/${spoId}`)}>Open order</Button>}
          meta={[
            { label: 'Vendor', value: po?.vendor_display_name || po?.vendor_first_name },
            { label: 'Phone', value: po?.vendor_phone },
            { label: 'Order date', value: <DateTime value={po?.purchase_order_date} /> },
            { label: 'Status', value: spoStatusLabel(st) },
          ]}
        />
        <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: '12px' }}>
          <StatTile label="Lines" value={stats.total_lines} />
          <StatTile label="Ordered" value={stats.order_qty} />
          <StatTile label="Received" value={stats.received_qty} />
          <StatTile label="Left to receive" value={stats.remaining_qty} />
        </div>

        {st === 'completed' && <Notice tone="good" title="Everything on this order is received" />}
        {!canEdit && <Notice tone="info" title="View only">You can see what has come in; receiving needs edit access to spare-parts orders.</Notice>}

        <Section
          title="Delivery (GRN)"
          actions={canCreate && stats.remaining_qty > 0 && <Button onClick={() => setGrnOpen(true)}>New delivery (GRN)</Button>}
        >
          {grns.length ? (
            <FormGrid cols={3}>
              <Field label="Receive against" span={2} hint="Parts you receive now are recorded on this GRN.">
                <Select value={grnId} onChange={(e) => setGrnId(e.target.value)} options={grns.slice().reverse().map((g) => ({ value: String(g.grn_id), label: grnLabel(g) }))} />
              </Field>
              <KeyValue
                cols={1}
                items={[
                  { label: 'Vendor invoice', value: selectedGrn?.vendor_invoice_no || <span style={{ color: 'var(--alert-warn)' }}>not given</span> },
                ]}
              />
            </FormGrid>
          ) : (
            <p className="text-ink-2" style={{ margin: 0 }}>No GRN yet — the first receipt opens one, or open one now with the vendor’s challan and invoice number.</p>
          )}
        </Section>

        <Section title="Parts ordered">
          <DataTable columns={lineCols} rows={lines} rowKey={(l, i) => i} empty={<EmptyState title="No lines on this order" />} />
        </Section>

        {grns.length > 0 && (
          <Section
            title={`Received on ${selectedGrn ? grnLabel(selectedGrn).split(' · ')[0] : 'this GRN'} · ${units.rows.length}`}
            actions={grnLabels.length > 0 && <Button onClick={() => printLabels(grnLabels)}>Print {grnLabels.length} label{grnLabels.length === 1 ? '' : 's'}</Button>}
          >
            <DataTable
              columns={unitCols}
              rows={units.rows}
              rowKey={(u) => u.serial_id}
              empty={<EmptyState title={units.loading ? 'Loading…' : 'Nothing received on this GRN yet'} />}
            />
          </Section>
        )}
      </div>

      <ReceiveDrawer
        open={receiveLine != null}
        line={receiveLine != null ? lines[receiveLine] : null}
        lineIndex={receiveLine ?? 0}
        poNumber={po?.purchase_order_number || ''}
        poId={spoId}
        grnId={grnId}
        onClose={() => setReceiveLine(null)}
        onReceived={onReceived}
        onPrint={(ls) => { setReceiveLine(null); printLabels(ls); }}
      />
      <NewGrnDrawer open={grnOpen} busy={busy === 'grn'} onClose={() => setGrnOpen(false)} onSave={openGrn} />
      <PartLabelPrintDrawer open={labels.length > 0} units={labels} title="Print QR labels for received parts" onClose={() => setLabels([])} />
    </DeskShell>
  );
}

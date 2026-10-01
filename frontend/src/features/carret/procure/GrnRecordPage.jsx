import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, DocumentHeader, Drawer, EmptyState, Field, Input, KeyValue,
  Notice, Section, StatTile, StatusChip, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  fetchGeneratedGrnOverview, fetchGrnReceivedProducts, fetchGrns, fetchSerials, updateSerial, uploadGrnBill,
} from '../../vendor-management/vendorManagementApi';
import { LAPTOP_CONDITIONS } from '../../../constants/laptopConditions';
import { errMsg, fileUrl } from './procureShared';

/**
 * Procure → Purchase order → one GRN (goods received note).
 *
 * Works for every GRN, including the ones made before gate logging, which
 * have no delivery behind them: everything here comes from the PO's GRN
 * overview and the GRN's own serials, never from vendor_deliveries.
 *
 * Shows what came in on this receipt, whether each laptop's configuration was
 * read from the laptop and matched the PO line (expected vs captured, field by
 * field), the vendor bill for it, and a serial-number correction list.
 */
const grnNumberOf = (id) => `GRN-${String(id).padStart(4, '0')}`;

const FIELD_LABELS = {
  brand: 'Brand', model: 'Model', processor: 'Processor', generation: 'Generation', ram: 'RAM', ssd: 'SSD', storage: 'Storage', gpu: 'GPU', screen_size: 'Screen',
};
const fieldLabel = (f) => FIELD_LABELS[f] || String(f || '').replace(/_/g, ' ');
const show = (v) => (v === null || v === undefined || v === '' ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));

/** Expected vs captured, per field — the same data GrnConfigVerification reads. */
function verificationRows(v) {
  if (!v) return [];
  if (Array.isArray(v.checks) && v.checks.length) {
    return v.checks.map((c) => ({
      field: c.field, label: c.label || fieldLabel(c.field), expected: show(c.expected), actual: show(c.actual), matched: !!c.matched, required: c.required !== false,
    }));
  }
  const exp = v.expected_config && typeof v.expected_config === 'object' ? v.expected_config : {};
  const act = v.actual_config && typeof v.actual_config === 'object' ? v.actual_config : {};
  const mism = Array.isArray(v.mismatched_fields) ? v.mismatched_fields : [];
  const rows = mism.map((m) => ({
    field: m.field, label: fieldLabel(m.field), expected: show(m.expected ?? exp[m.field]), actual: show(m.actual ?? act[m.field]), matched: false, required: m.required !== false,
  }));
  (Array.isArray(v.matched_fields) ? v.matched_fields : []).forEach((f) => {
    const key = typeof f === 'string' ? f : f?.field;
    if (!key || rows.some((r) => r.field === key)) return;
    rows.push({ field: key, label: fieldLabel(key), expected: show(exp[key]), actual: show(act[key]), matched: true, required: true });
  });
  return rows;
}

/** One-line verdict for the table; colour always comes with a glyph and words. */
function VerificationSummary({ v }) {
  const st = v?.state || 'none';
  if (st === 'matched') return <span style={{ color: 'var(--alert-good)' }}>✓ Configuration verified</span>;
  if (st === 'mismatched') {
    const req = (Array.isArray(v.mismatched_fields) ? v.mismatched_fields : []).filter((m) => m.required !== false);
    return <span style={{ color: 'var(--alert-crit)' }}>✕ Did not match{req.length ? ` — ${req.map((m) => fieldLabel(m.field)).join(', ')}` : ''}</span>;
  }
  if (st === 'waived') return <span style={{ color: 'var(--alert-warn)' }}>⚠ Check skipped{v.reason ? `: ${v.reason}` : ''}</span>;
  if (st === 'captured_without_verification') return <span className="text-ink-3">○ Captured, no comparison on record</span>;
  return <span className="text-ink-3">○ No check on record</span>;
}

/** QC as far as the data says. The endpoint carries no QC flag of its own, so the asset's stage stands in. */
function qcOf(item) {
  if (item.qc_status) return item.qc_status;
  if (item.qc_passed === true) return 'Passed';
  if (item.qc_passed === false) return 'Failed';
  const s = String(item.inventory_status || '').toLowerCase();
  if (s === 'qc_failed') return 'Failed';
  if (['in_stock', 'reserved', 'dispatch_ready', 'at_gate', 'in_transit', 'rented', 'on_demo', 'sold'].includes(s)) return 'Passed';
  return 'Pending';
}

function parseFiles(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [raw]; } catch { return [raw]; }
  }
  return [];
}

const ttsplOf = (row) => {
  const ex = row?.extra && typeof row.extra === 'object' ? row.extra : {};
  return row?.inventory_asset_code || ex.unique_product_serial || ex.unique_number || '';
};

const assetLink = (code) => (code
  ? <Link to={`/carret/stock/assets/${encodeURIComponent(code)}`} onClick={(e) => e.stopPropagation()}><DocNumber value={code} /></Link>
  : <span className="text-ink-3">no TTSPL</span>);

export default function GrnRecordPage() {
  const { poId, grnId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('vendor_management', 'edit');

  const [overview, setOverview] = useState(null);
  const [grnRaw, setGrnRaw] = useState(null);
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('laptops');
  const [compare, setCompare] = useState(null);

  const [billOpen, setBillOpen] = useState(false);
  const [billName, setBillName] = useState('');
  const [billFile, setBillFile] = useState(null);
  const [billBusy, setBillBusy] = useState(false);

  const [serials, setSerials] = useState(null);
  const [serialSearch, setSerialSearch] = useState('');
  const [savingSerial, setSavingSerial] = useState(null);

  const load = useCallback(() => {
    fetchGrnReceivedProducts(poId, grnId)
      .then(({ data }) => setItems(data.data?.items || []))
      .catch((e) => setLoadError(errMsg(e, 'Could not load this GRN.')));
    fetchGeneratedGrnOverview(poId)
      .then(({ data }) => setOverview(data.data || null))
      .catch((e) => setLoadError(errMsg(e, 'Could not load the purchase order.')));
    fetchGrns(poId)
      .then(({ data }) => setGrnRaw((data.data || []).find((g) => String(g.grn_id) === String(grnId)) || {}))
      .catch(() => setGrnRaw({}));
  }, [poId, grnId]);
  useEffect(() => { load(); }, [load]);

  const loadSerials = useCallback(() => {
    fetchSerials(grnId, poId)
      .then(({ data }) => setSerials((data.data || []).map((r) => ({
        serial_id: r.serial_id, ttspl: ttsplOf(r), baseline: String(r.serial_number || ''), draft: String(r.serial_number || ''),
      }))))
      .catch((e) => { toast.error(errMsg(e, 'Could not load serial numbers')); setSerials([]); });
  }, [grnId, poId]);
  useEffect(() => { if (tab === 'serials' && serials === null) loadSerials(); }, [tab, serials, loadSerials]);

  const po = overview?.purchase_order;
  const stats = overview?.stats || {};
  const grnRow = useMemo(() => (overview?.grn_rows || []).find((g) => String(g.grn_id) === String(grnId)) || null, [overview, grnId]);
  const grnNo = grnNumberOf(grnId);
  const billReceived = String(grnRow?.bill_status || '').toLowerCase() === 'received';
  const billFiles = parseFiles(grnRow?.bill_files);
  const itemBySerialId = useMemo(() => new Map((items || []).map((i) => [i.serial_id, i])), [items]);

  const submitBill = async () => {
    const name = billName.trim();
    if (!name) { toast.error('Bill number is required'); return; }
    if (!billFile) { toast.error('Choose the bill file'); return; }
    const fd = new FormData();
    fd.append('bill_name', name);
    fd.append('files', billFile);
    setBillBusy(true);
    try {
      const { data } = await uploadGrnBill(poId, grnId, fd);
      if (data && data.success === false) throw new Error(data.message);
      toast.success(data?.message || 'Bill uploaded');
      setBillOpen(false); setBillName(''); setBillFile(null);
      load();
    } catch (e) {
      toast.error(errMsg(e, 'Upload failed'));
    } finally {
      setBillBusy(false);
    }
  };

  const saveSerial = async (row) => {
    const next = row.draft.trim();
    const old = row.baseline.trim();
    if (!next || !old) { toast.error('Serial number is required'); return; }
    if (next === old) return;
    setSavingSerial(row.serial_id);
    try {
      const { data } = await updateSerial({ old_serial: old, new_serial: next, grn_id: Number(grnId), po_id: Number(poId) });
      if (!data?.success) { toast.error(data?.message || 'Update failed'); return; }
      toast.success(data.message || 'Serial number updated');
      const saved = String(data.old_serial_number ?? next).trim();
      setSerials((rs) => rs.map((r) => (r.serial_id === row.serial_id ? { ...r, baseline: saved, draft: saved } : r)));
      setItems((is) => (is || []).map((i) => (i.serial_id === row.serial_id ? { ...i, serial_number: saved } : i)));
    } catch (e) {
      toast.error(errMsg(e, 'Update failed'));
    } finally {
      setSavingSerial(null);
    }
  };

  const filteredSerials = useMemo(() => {
    const q = serialSearch.trim().toLowerCase();
    if (!q) return serials || [];
    return (serials || []).filter((r) => r.draft.toLowerCase().includes(q) || r.ttspl.toLowerCase().includes(q));
  }, [serials, serialSearch]);

  const downloadCsv = () => {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const header = ['SL', 'Serial Number', 'TTSPL', 'Laptop'];
    const body = filteredSerials.map((r, i) => {
      const it = itemBySerialId.get(r.serial_id) || {};
      const laptop = [it.brand, it.model, it.processor, it.generation, it.ram, it.storage].filter(Boolean).join(' ');
      return [String(i + 1), r.draft, r.ttspl, laptop].map(esc).join(',');
    }).join('\r\n');
    const blob = new Blob([`${header.join(',')}\r\n${body}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `serials_${po?.purchase_order_number || `po${poId}`}_${grnNo}.csv`.replace(/[^\w.-]+/g, '_');
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('CSV downloaded');
  };

  if (loadError) {
    return (
      <DeskShell title={grnNo} breadcrumb="Procurement / Purchase orders">
        <EmptyState title="Could not load this GRN" body={loadError} action={<Button onClick={() => navigate(`/carret/procure/purchase-orders/${poId}`)}>Back to the purchase order</Button>} />
      </DeskShell>
    );
  }
  if (!overview || items === null) {
    return <DeskShell title={grnNo} breadcrumb="Procurement / Purchase orders"><EmptyState title="Loading…" /></DeskShell>;
  }

  const poNumber = po?.purchase_order_number || `PO-${poId}`;
  const vendor = po?.vendor_business_name || po?.vendor_display_name || po?.vendor_first_name || '—';
  const counts = {
    mismatched: items.filter((i) => i.config_verification?.state === 'mismatched').length,
    waived: items.filter((i) => i.config_verification?.state === 'waived').length,
  };

  const laptopCols = [
    {
      key: 't',
      header: 'Asset',
      render: (i) => {
        const code = i.unique_product_serial || i.inventory_asset_code;
        if (i.is_replacement && i.replaced_ttspl_id) {
          return <span className="whitespace-nowrap">{assetLink(i.replaced_ttspl_id)} <span className="text-ink-3">→</span> {assetLink(code)}</span>;
        }
        return assetLink(code);
      },
      sub: (i) => i.serial_number || null,
    },
    {
      key: 'c',
      header: 'Laptop',
      render: (i) => [i.brand, i.model].filter(Boolean).join(' ') || 'Laptop',
      sub: (i) => [i.processor, i.generation, i.ram, i.storage, i.gpu].filter(Boolean).join(' · ') || null,
    },
    {
      key: 'cond',
      header: 'Condition',
      render: (i) => (
        <div>
          <div>{LAPTOP_CONDITIONS.find((c) => c.value === i.received_condition)?.label || i.received_condition || '—'}</div>
          {i.physical_damage_remark && <div style={{ color: 'var(--alert-warn)', fontSize: 'var(--d-sm)' }}>⚠ Damage: {i.physical_damage_remark}</div>}
          {(i.is_replacement || i.is_replaced || i.is_repaired) ? (
            <div className="flex flex-wrap" style={{ gap: '4px', marginTop: '4px' }}>
              {i.is_replacement ? <span className="c-chip" style={{ background: 'var(--lc-moving-soft)', color: 'var(--lc-moving)' }}>⇄ Replacement</span> : null}
              {i.is_replaced ? <span className="c-chip" style={{ background: 'var(--lc-offcycle-soft)', color: 'var(--lc-offcycle)' }}>↺ Replaced</span> : null}
              {i.is_repaired ? <span className="c-chip" style={{ background: 'var(--lc-earning-soft)', color: 'var(--lc-earning)' }}>✶ Repaired</span> : null}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'v',
      header: 'Configuration check',
      render: (i) => {
        const rows = verificationRows(i.config_verification);
        return (
          <div>
            <VerificationSummary v={i.config_verification} />
            {rows.length > 0 && <div><Button variant="quiet" onClick={(e) => { e.stopPropagation(); setCompare(i); }}>Compare fields</Button></div>}
          </div>
        );
      },
    },
    { key: 'qc', header: 'QC', render: (i) => { const q = qcOf(i); return <span style={{ color: q === 'Passed' ? 'var(--alert-good)' : q === 'Failed' ? 'var(--alert-crit)' : 'var(--alert-warn)' }}>{q === 'Passed' ? '✓' : q === 'Failed' ? '✕' : '○'} {q}</span>; } },
    { key: 's', header: 'Stage', render: (i) => (i.inventory_status ? <StatusChip status={i.inventory_status} /> : '—') },
  ];

  const compareRows = compare ? verificationRows(compare.config_verification) : [];

  return (
    <DeskShell title={grnNo} breadcrumb={`Procurement / Purchase orders / ${poNumber}`} subtitle={vendor}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={grnNo}
          type={`Goods received note · ${poNumber}`}
          status={billReceived ? 'received' : 'pending'}
          actions={(
            <>
              {canEdit && !billReceived && <Button variant="primary" onClick={() => setBillOpen(true)}>Upload bill</Button>}
              {grnRaw?.delivery_id && <Button variant="quiet" onClick={() => navigate(`/carret/procure/arrivals/${grnRaw.delivery_id}`)}>Open delivery</Button>}
              <Button variant="quiet" onClick={() => navigate(`/carret/procure/purchase-orders/${poId}`)}>Open PO</Button>
            </>
          )}
          meta={[
            { label: 'Purchase order', value: <Link to={`/carret/procure/purchase-orders/${poId}`}><DocNumber value={poNumber} /></Link> },
            { label: 'Vendor', value: vendor },
            { label: 'Received', value: grnRow?.created_at ? <DateTime value={grnRow.created_at} /> : '—' },
            { label: 'Delivery', value: grnRaw?.meta?.delivery_number || (grnRaw?.delivery_id ? `#${grnRaw.delivery_id}` : <span className="text-ink-3">before gate logging</span>) },
            { label: 'Bill', value: billReceived ? (grnRow?.bill_name || 'Received') : <span style={{ color: 'var(--alert-warn)' }}>⚠ Bill pending</span> },
          ]}
        />

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
          <StatTile label="Ordered on PO" value={stats.order_qty ?? 0} />
          <StatTile label="Received on PO" value={stats.received_qty ?? 0} family="earning" />
          <StatTile label="Remaining on PO" value={stats.remaining_qty ?? 0} family={stats.remaining_qty ? 'offcycle' : undefined} />
          <StatTile label="On this GRN" value={items.length} delta={grnRow?.replacement_qty ? `${grnRow.replacement_qty} replacement(s)` : null} />
        </div>

        {counts.mismatched > 0 && (
          <Notice tone="crit" title={`${counts.mismatched} laptop(s) did not match the PO configuration`}>Use “Compare fields” to see what was ordered and what the laptop reported.</Notice>
        )}
        {counts.waived > 0 && <Notice tone="warn" title={`${counts.waived} laptop(s) received without the configuration check`}>The reason is shown against each one.</Notice>}
        {!billReceived && (
          <Notice tone="warn" title="No vendor bill on this GRN yet" action={canEdit && <Button onClick={() => setBillOpen(true)}>Upload bill</Button>}>
            Needed before the vendor is paid for these laptops.
          </Notice>
        )}

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'laptops', label: 'Laptops received', count: items.length },
            { key: 'serials', label: 'Serial numbers' },
            { key: 'bill', label: 'Bill', count: billFiles.length || undefined },
          ]}
        />

        {tab === 'laptops' && (
          <Section title="Laptops received on this GRN">
            <DataTable
              columns={laptopCols}
              rows={items}
              rowKey={(i) => i.serial_id}
              onRowClick={(i) => { const c = i.unique_product_serial || i.inventory_asset_code; if (c) navigate(`/carret/stock/assets/${encodeURIComponent(c)}`); }}
              empty={<EmptyState title="No laptops on this GRN" />}
            />
          </Section>
        )}

        {tab === 'serials' && (
          <Section
            title="Serial numbers"
            actions={(
              <>
                <Input value={serialSearch} onChange={(e) => setSerialSearch(e.target.value)} placeholder="Search serial or TTSPL" style={{ width: '14rem' }} />
                <Button disabled={!filteredSerials.length} onClick={downloadCsv}>Export CSV</Button>
              </>
            )}
          >
            {!canEdit && <Notice tone="info" title="View only">Correcting a serial number needs edit access to vendor management.</Notice>}
            {serials === null ? <EmptyState title="Loading…" /> : (
              <DataTable
                rows={filteredSerials}
                rowKey={(r) => r.serial_id}
                empty={<EmptyState title={serialSearch ? 'Nothing matches' : 'No serials on this GRN'} />}
                columns={[
                  { key: 'n', header: '#', numeric: true, render: (r) => filteredSerials.indexOf(r) + 1 },
                  { key: 't', header: 'TTSPL', render: (r) => assetLink(r.ttspl) },
                  {
                    key: 's',
                    header: 'Serial number',
                    render: (r) => (canEdit ? (
                      <Input
                        value={r.draft}
                        className="font-mono"
                        aria-label={`Serial for ${r.ttspl || r.serial_id}`}
                        onChange={(e) => { const v = e.target.value; setSerials((rs) => rs.map((x) => (x.serial_id === r.serial_id ? { ...x, draft: v } : x))); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveSerial(r); }}
                        style={{ minWidth: '14rem' }}
                      />
                    ) : <span className="font-mono">{r.draft || '—'}</span>),
                    sub: (r) => (r.draft.trim() !== r.baseline.trim() ? `was ${r.baseline}` : null),
                  },
                  {
                    key: 'a',
                    header: '',
                    render: (r) => canEdit && (
                      <div className="flex" style={{ gap: '4px' }}>
                        <Button variant="primary" disabled={savingSerial === r.serial_id || !r.draft.trim() || r.draft.trim() === r.baseline.trim()} onClick={() => saveSerial(r)}>{savingSerial === r.serial_id ? 'Saving…' : 'Save'}</Button>
                        {r.draft !== r.baseline && <Button variant="quiet" onClick={() => setSerials((rs) => rs.map((x) => (x.serial_id === r.serial_id ? { ...x, draft: x.baseline } : x)))}>Undo</Button>}
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </Section>
        )}

        {tab === 'bill' && (
          <Section title="Vendor bill" actions={canEdit && <Button onClick={() => setBillOpen(true)}>{billReceived ? 'Add a file' : 'Upload bill'}</Button>}>
            <KeyValue items={[
              { label: 'Status', value: billReceived ? <StatusChip status="received" /> : <StatusChip status="pending" label="Bill pending" /> },
              { label: 'Bill number', value: grnRow?.bill_name },
              { label: 'Vendor invoice (gate)', value: grnRaw?.vendor_invoice_no },
              { label: 'Vendor challan', value: grnRaw?.vendor_challan_no },
            ]}
            />
            <div style={{ marginTop: '12px' }}>
              {billFiles.length ? (
                <ul className="c-stack" style={{ gap: '6px', listStyle: 'none', padding: 0, margin: 0 }}>
                  {billFiles.map((f, idx) => (
                    <li key={`${f}-${idx}`}>
                      <a href={fileUrl(f)} target="_blank" rel="noopener noreferrer" className="text-accent">View file {idx + 1}</a>
                      <span className="text-ink-3"> · {String(f).split('/').pop()}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-ink-3" style={{ margin: 0 }}>No bill file uploaded.</p>}
            </div>
          </Section>
        )}
      </div>

      <Drawer
        open={billOpen}
        onClose={() => !billBusy && setBillOpen(false)}
        title={`Upload bill · ${grnNo}`}
        footer={<Button variant="primary" disabled={billBusy || !billName.trim() || !billFile} onClick={submitBill}>{billBusy ? 'Uploading…' : 'Upload'}</Button>}
      >
        <div className="c-stack">
          <Field label="Bill number" required hint="Must not be used on another PO or GRN">
            <Input value={billName} onChange={(e) => setBillName(e.target.value)} placeholder="Invoice / bill number" autoFocus />
          </Field>
          <Field label="Bill file" required hint="PDF or image">
            <Input type="file" accept=".pdf,image/*" onChange={(e) => setBillFile(e.target.files?.[0] || null)} />
          </Field>
        </div>
      </Drawer>

      <Drawer open={Boolean(compare)} onClose={() => setCompare(null)} title={`Configuration · ${compare?.unique_product_serial || compare?.inventory_asset_code || compare?.serial_number || ''}`} width="36rem">
        {compare && (
          <div className="c-stack">
            <VerificationSummary v={compare.config_verification} />
            <DataTable
              rows={compareRows}
              rowKey={(r) => r.field}
              columns={[
                { key: 'f', header: 'Part', render: (r) => <span style={!r.matched ? { color: 'var(--alert-crit)', fontWeight: 600 } : undefined}>{r.label}</span>, sub: (r) => (!r.matched && !r.required ? 'informational' : null) },
                { key: 'e', header: 'Ordered', render: (r) => r.expected || '—' },
                { key: 'a', header: 'On the laptop', render: (r) => <span style={!r.matched ? { color: 'var(--alert-crit)', fontWeight: 600 } : undefined}>{r.actual || '—'}</span> },
                { key: 'm', header: '', render: (r) => (r.matched ? <span style={{ color: 'var(--alert-good)' }}>✓ match</span> : <span style={{ color: 'var(--alert-crit)' }}>✕ differs</span>) },
              ]}
            />
            {compare.config_verification?.verified_at && <p className="text-ink-3" style={{ margin: 0 }}>Read from the laptop <DateTime value={compare.config_verification.verified_at} /></p>}
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

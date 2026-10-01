import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, ConfirmDialog, DataTable, DateTime, Drawer, EmptyState, Field, FormGrid, Input, KeyValue, Notice, Section,
} from '../../../components/carret';
import {
  deletePurchaseOrderBillFile, patchPurchaseOrderLineSpecs, removePurchaseOrderBill, uploadPurchaseOrderBills,
} from '../../vendor-management/vendorManagementApi';
import { errMsg } from './procureShared';
import {
  BILL_STATES, billFileName, billFileUrl, lineConfig, parseBillFiles, poStatus,
} from './poShared';

/**
 * Pieces of the Carret PO record that the old Purchase Orders screen used to
 * own: the vendor's bill (CRM upload + vendor portal upload), vendor-repair
 * replacements, and the super-admin line spec fix.
 */

const FileLinks = ({ file }) => {
  const url = billFileUrl(file);
  if (!url) return <span className="text-ink-3">no file</span>;
  return (
    <span className="flex items-center" style={{ gap: '12px' }}>
      <a href={url} target="_blank" rel="noreferrer">View</a>
      <a href={url} download={billFileName(file)} target="_blank" rel="noreferrer">Download</a>
    </span>
  );
};

/**
 * The bill against a PO.
 * Upload: vendor_management edit (the route's authorizeEdit), once the PO has
 * gone to the vendor. Remove one file / the whole bill: the backend allows it
 * for super admin only, on top of vendor_management delete.
 */
export function PoBillsSection({ po, canUpload, canRemove, onChanged }) {
  const files = parseBillFiles(po.bill_files);
  const hasCrmBill = Boolean(po.bill_name || files.length);
  const st = poStatus(po);
  const uploadOpen = canUpload && BILL_STATES.includes(st);

  const [drawer, setDrawer] = useState(false);
  const [billName, setBillName] = useState('');
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'one', index } | { kind: 'all' }
  const [removing, setRemoving] = useState(false);

  const openUpload = () => {
    setBillName(po.bill_name || po.vendor_invoice_number || '');
    setPicked([]);
    setDrawer(true);
  };

  const upload = async () => {
    const name = billName.trim();
    if (!name) { toast.error('Enter the bill / invoice number'); return; }
    if (!picked.length) { toast.error('Pick at least one file'); return; }
    const fd = new FormData();
    fd.append('bill_name', name);
    picked.forEach((f) => fd.append('files', f));
    setSaving(true);
    try {
      const { data } = await uploadPurchaseOrderBills(po.po_id, fd);
      if (data && data.success === false) throw new Error(data.message);
      toast.success(data?.message || 'Bill uploaded');
      setDrawer(false);
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e, 'Upload failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c) => {
    setRemoving(true);
    try {
      const { data } = c.kind === 'all'
        ? await removePurchaseOrderBill(po.po_id)
        : await deletePurchaseOrderBillFile(po.po_id, c.index);
      if (data && data.success === false) throw new Error(data.message);
      toast.success(data?.message || 'Removed');
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e, 'Could not remove'));
    } finally {
      setRemoving(false);
    }
  };

  const vendorUpload = po.vendor_invoice_file || po.vendor_invoice_number;

  return (
    <Section
      title="Bill / vendor invoice"
      actions={(
        <>
          {uploadOpen && <Button onClick={openUpload}>{hasCrmBill ? 'Add files' : 'Upload bill'}</Button>}
          {canRemove && hasCrmBill && (
            <Button variant="quiet" disabled={removing} onClick={() => setConfirm({ kind: 'all' })}>Remove bill</Button>
          )}
        </>
      )}
    >
      <div className="c-stack">
        <KeyValue
          items={[
            { label: 'Bill status', value: hasCrmBill ? 'Received' : (vendorUpload ? 'Uploaded by the vendor' : 'Pending') },
            { label: 'Bill / invoice number', value: po.bill_name },
            { label: 'Files', value: files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : null },
          ]}
        />
        {!hasCrmBill && !uploadOpen && !vendorUpload && (
          <p className="text-ink-3">
            {BILL_STATES.includes(st) ? 'No bill yet.' : 'The bill is uploaded once the PO has been approved and sent to the vendor.'}
          </p>
        )}
        {files.length > 0 && (
          <DataTable
            columns={[
              { key: 'n', header: '#', render: (_f, i) => i + 1, width: '3rem' },
              { key: 'name', header: 'File', render: (f) => billFileName(f) },
              { key: 'open', header: '', render: (f) => <FileLinks file={f} /> },
              ...(canRemove ? [{
                key: 'rm',
                header: '',
                align: 'right',
                render: (_f, i) => <Button variant="quiet" disabled={removing} onClick={(e) => { e.stopPropagation(); setConfirm({ kind: 'one', index: i }); }}>Remove</Button>,
              }] : []),
            ]}
            rows={files}
            rowKey={(f, i) => `${i}-${billFileName(f)}`}
          />
        )}
        {vendorUpload && (
          <Notice tone="info" title="Uploaded by the vendor on the vendor portal">
            <span className="flex items-center flex-wrap" style={{ gap: '12px' }}>
              {po.vendor_invoice_number && <span>Invoice {po.vendor_invoice_number}</span>}
              {po.vendor_invoice_uploaded_at && <span>on <DateTime value={po.vendor_invoice_uploaded_at} /></span>}
              {po.vendor_invoice_file ? <FileLinks file={po.vendor_invoice_file} /> : <span className="text-ink-3">no file attached</span>}
            </span>
          </Notice>
        )}
      </div>

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title={hasCrmBill ? `Add files to bill ${po.bill_name || ''}` : 'Upload the vendor’s bill'}
        footer={<Button variant="primary" disabled={saving} onClick={upload}>{saving ? 'Uploading…' : 'Upload'}</Button>}
      >
        <div className="c-stack">
          {hasCrmBill && <p className="text-ink-2">New files are added to the {files.length} already on this PO.</p>}
          <Field label="Bill / invoice number" required hint="Must not already be used on another PO or GRN">
            <Input value={billName} onChange={(e) => setBillName(e.target.value)} autoFocus />
          </Field>
          <Field label="Files" required hint="PDF or photos; up to 25 at a time">
            <Input
              type="file"
              multiple
              accept="image/*,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp"
              onChange={(e) => setPicked(Array.from(e.target.files || []))}
            />
          </Field>
          {picked.length > 0 && (
            <ul className="text-ink-2" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {picked.map((f) => <li key={`${f.name}-${f.size}`}>{f.name}</li>)}
            </ul>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => remove(confirm)}
        title={confirm?.kind === 'all' ? 'Remove the whole bill?' : 'Remove this file?'}
        body={confirm?.kind === 'all'
          ? `The bill number ${po.bill_name || ''} and all ${files.length} file(s) are removed from this PO. The files are deleted.`
          : `${confirm ? billFileName(files[confirm.index]) : ''} is deleted. If it is the last file, the bill number is cleared too.`}
        confirmLabel="Remove"
      />
    </Section>
  );
}

/** Vendor-repair replacements on this PO (they never add to the received count). */
export function PoReplacementsSection({ replacements }) {
  const rows = Array.isArray(replacements) ? replacements.filter(Boolean) : [];
  if (!rows.length) return null;
  return (
    <Section title={`Vendor repair replacements · ${rows.length}`}>
      <p className="text-ink-3" style={{ marginBottom: '8px' }}>
        These laptops replaced one already received on this PO. They do not add to the received quantity.
      </p>
      <DataTable
        columns={[
          { key: 'old', header: 'Replaced', render: (r) => r.replaced_ttspl_id || r.replaced_ttspl || '—', sub: (r) => (r.replaced_serial ? `S/N ${r.replaced_serial}` : null) },
          { key: 'new', header: 'Replacement', render: (r) => r.ttspl_id || r.inventory_asset_code || '—', sub: (r) => (r.serial_number ? `S/N ${r.serial_number}` : null) },
          { key: 'lap', header: 'Laptop', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—' },
          { key: 'dc', header: 'Replacement challan', render: (r) => r.replacement_dc_number || '—' },
        ]}
        rows={rows}
        rowKey={(r, i) => r.serial_id || `${r.ttspl_id}-${i}`}
        empty={<EmptyState title="No replacements" />}
      />
    </Section>
  );
}

const SPEC_FIELDS = [
  { key: 'processor', label: 'Processor' },
  { key: 'generation', label: 'Generation' },
  { key: 'ram', label: 'RAM' },
  { key: 'storage', label: 'Storage' },
  { key: 'gpu', label: 'Graphics' },
  { key: 'screen_size', label: 'Screen' },
];

/**
 * Super admin only (PATCH …/line-items/:lineIndex/specs is checkRole('super_admin')):
 * correct a line's configuration on any PO, whatever its status. Logged on the PO activity.
 */
export function LineSpecsDrawer({ po, lineIndex, onClose, onSaved }) {
  const line = lineIndex == null ? null : (po?.line_items || [])[lineIndex];
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!line) return;
    setDraft(Object.fromEntries(SPEC_FIELDS.map((f) => [f.key, String(line[f.key] ?? '')])));
  }, [line]);

  const changed = line && SPEC_FIELDS.some((f) => String(draft[f.key] ?? '').trim() !== String(line[f.key] ?? '').trim());

  const save = async () => {
    if (!changed) { toast('No spec changes to save'); onClose(); return; }
    setSaving(true);
    try {
      const { data } = await patchPurchaseOrderLineSpecs(po.po_id, lineIndex, draft);
      if (data && data.success === false) throw new Error(data.message);
      toast.success(data?.message === 'No spec changes' ? 'No spec changes' : 'Line specs updated');
      onSaved?.(data?.data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not update specs'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={Boolean(line)}
      onClose={onClose}
      title={`Fix line ${Number(lineIndex) + 1} specs`}
      footer={<Button variant="primary" disabled={saving || !changed} onClick={save}>{saving ? 'Saving…' : 'Save specs'}</Button>}
    >
      {line && (
        <div className="c-stack">
          <Notice tone="warn" title="Super admin correction">
            Changes the configuration the receiving check compares against. Recorded on the PO activity.
          </Notice>
          <p className="text-ink-2">{[line.brand, line.model || line.model_name].filter(Boolean).join(' ') || 'Laptop'} · now {lineConfig(line) || '—'}</p>
          <FormGrid cols={2}>
            {SPEC_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
              </Field>
            ))}
          </FormGrid>
        </div>
      )}
    </Drawer>
  );
}

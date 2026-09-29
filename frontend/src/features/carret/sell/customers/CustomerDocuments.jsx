import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, ConfirmDialog, DataTable, DateTime, EmptyState, Field, FormGrid, Input, Section, Select,
} from '../../../../components/carret';
import { deleteCustomerDocument, errMsg, fetchCustomerDocuments, uploadCustomerDocument } from './customersApi';
import { DOC_TYPES, DOC_TYPE_LABEL, uploadUrl } from './customerProfileShared';

/**
 * Customer record → Documents: KYC, GST / PAN copies, signed agreements
 * (/api/customer-documents, sections customer_documents view / create /
 * delete). PDF, JPG or PNG, as the server accepts.
 */
const ACCEPT = '.pdf,.jpg,.jpeg,.png';
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const EMPTY = { doc_type: 'gst_certificate', doc_label: '', is_signed: false, notes: '' };
const kb = (n) => (n ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : '');

export default function DocumentsTab({ customer, canUpload, canDelete }) {
  const customerId = customer.customer_id;
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [type, setType] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(() => {
    fetchCustomerDocuments(customerId).then(({ data }) => setRows(data.all || [])).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [customerId]);
  useEffect(() => { load(); }, [load]);

  const pick = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && !OK_TYPES.includes(f.type)) { toast.error('PDF, JPG or PNG only'); e.target.value = ''; setFile(null); return; }
    setFile(f);
  };
  const upload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', form.doc_type);
    if (form.doc_label.trim()) fd.append('doc_label', form.doc_label.trim());
    fd.append('is_signed', form.is_signed ? 'true' : 'false');
    if (form.notes.trim()) fd.append('notes', form.notes.trim());
    setBusy(true);
    try {
      await uploadCustomerDocument(customerId, fd);
      toast.success('Document uploaded');
      setForm(EMPTY);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) { toast.error(errMsg(e, 'Upload failed')); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await deleteCustomerDocument(customerId, deleting.doc_id); toast.success('Document deleted'); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  const shownRows = (rows || []).filter((r) => !type || r.doc_type === type).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const cols = [
    { key: 't', header: 'Kind', render: (r) => DOC_TYPE_LABEL[r.doc_type] || r.doc_type, sub: (r) => (r.is_signed ? 'Signed' : null) },
    {
      key: 'f',
      header: 'Document',
      render: (r) => <a href={uploadUrl(r.file_path)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.doc_label || r.file_name}</a>,
      sub: (r) => [r.doc_label ? r.file_name : null, kb(r.file_size_bytes)].filter(Boolean).join(' · ') || null,
    },
    { key: 'n', header: 'Notes', render: (r) => r.notes || '—' },
    { key: 'u', header: 'Uploaded', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.uploaded_by_name },
    ...(canDelete ? [{ key: 'x', header: '', render: (r) => <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>Delete</Button> }] : []),
  ];
  const signup = [...(customer.upload_docs || []), ...(customer.profile ? [customer.profile] : [])].filter(Boolean);

  return (
    <div className="c-stack">
      {canUpload && (
        <Section title="Upload a document">
          <FormGrid cols={3}>
            <Field label="Kind"><Select value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} options={DOC_TYPES} /></Field>
            <Field label="Label"><Input value={form.doc_label} placeholder="Optional" onChange={(e) => setForm({ ...form, doc_label: e.target.value })} /></Field>
            <Field label="File" hint="PDF, JPG or PNG"><input ref={fileRef} type="file" accept={ACCEPT} className="c-input" onChange={pick} /></Field>
            <Field label="Notes" span={2}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label="Signed">
              <Checkbox label="Signed agreement" checked={form.is_signed} onChange={(e) => setForm({ ...form, is_signed: e.target.checked })} />
            </Field>
          </FormGrid>
          <div style={{ marginTop: '12px' }}><Button variant="primary" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</Button></div>
        </Section>
      )}
      <Section
        title="Documents"
        actions={<Select value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All kinds' }, ...DOC_TYPES]} />}
      >
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={shownRows} rowKey={(r) => r.doc_id} empty={<EmptyState title="No documents" body={canUpload ? 'Upload the GST certificate, PAN and signed agreement here.' : undefined} />} />
        )}
      </Section>
      {signup.length > 0 && (
        <Section title="Files from when the customer was added">
          <div className="flex flex-wrap" style={{ gap: '12px' }}>
            {signup.map((p, i) => <a key={p} href={uploadUrl(p)} target="_blank" rel="noreferrer">{`File ${i + 1}`}</a>)}
          </div>
        </Section>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete this document?"
        body={deleting ? `${DOC_TYPE_LABEL[deleting.doc_type] || deleting.doc_type}: ${deleting.doc_label || deleting.file_name}. The file is removed for good.` : ''}
        confirmLabel="Delete"
      />
    </div>
  );
}

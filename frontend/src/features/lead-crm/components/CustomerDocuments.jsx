import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { DOC_TYPE_LABELS } from '../leadConstants';
import { deleteCustomerDocument, getCustomerDocuments, uploadCustomerDocument } from '../leadCrmApi';
import PermissionGate from '../../../components/PermissionGate';
import toast from 'react-hot-toast';

export default function CustomerDocuments({ customerId }) {
  const [grouped, setGrouped] = useState({});
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ doc_type: 'gst_certificate', doc_label: '', is_signed: false, notes: '' });

  const load = useCallback(async () => {
    try {
      const res = await getCustomerDocuments(customerId);
      setGrouped(res.data?.documents || {});
    } catch {
      toast.error('Failed to load documents');
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', form.doc_type);
    if (form.doc_label) fd.append('doc_label', form.doc_label);
    fd.append('is_signed', form.is_signed ? 'true' : 'false');
    if (form.notes) fd.append('notes', form.notes);
    setUploading(true);
    try {
      await uploadCustomerDocument(customerId, fd);
      toast.success('Document uploaded');
      load();
      e.target.value = '';
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      await deleteCustomerDocument(customerId, docId);
      toast.success('Document deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-100 p-4 bg-gray-50/50">
        <p className="text-sm font-medium text-gray-700 mb-3">Upload Document</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={form.doc_type} onChange={(e) => setForm((f) => ({ ...f, doc_type: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input placeholder="Label (optional)" value={form.doc_label}
            onChange={(e) => setForm((f) => ({ ...f, doc_label: e.target.value }))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm mt-2">
          <input type="checkbox" checked={form.is_signed}
            onChange={(e) => setForm((f) => ({ ...f, is_signed: e.target.checked }))} />
          Signed Agreement?
        </label>
        <label className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg cursor-pointer hover:bg-blue-700">
          <Upload className="w-4 h-4" />
          {uploading ? 'Uploading...' : 'Choose File'}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {Object.entries(DOC_TYPE_LABELS).map(([type, label]) => {
        const docs = grouped[type] || [];
        if (!docs.length) return null;
        return (
          <div key={type} className="rounded-xl border border-gray-100 p-4">
            <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4" /> {label}
            </h4>
            <ul className="space-y-2">
              {docs.map((doc) => (
                <li key={doc.doc_id} className="flex items-center justify-between gap-2 text-sm p-2 rounded-lg bg-gray-50">
                  <div className="min-w-0">
                    <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate block">
                      {doc.doc_label || doc.file_name}
                    </a>
                    {doc.is_signed && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Signed</span>
                    )}
                  </div>
                  <PermissionGate section="customer_documents" action="delete">
                    <button type="button" onClick={() => handleDelete(doc.doc_id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </PermissionGate>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

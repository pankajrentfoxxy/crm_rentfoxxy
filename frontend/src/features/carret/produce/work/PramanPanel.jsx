import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Field, FormGrid, Input, Notice } from '../../../../components/carret';
import api from '../../../../utils/api';

/**
 * Praman proof on Dispatch QC (migration 410): the Praman Device ID and the
 * Praman report PDF. A Dispatch QC pass needs both — the server refuses it
 * otherwise — and the sales order shows them as proof the laptop was verified
 * and tested before dispatch.
 */
export const fetchPraman = (ticketId) => api.get(`/tickets/${ticketId}/dispatch-qc/praman`);

/** Opens the stored PDF (it is private, so it is fetched with the session). */
export async function openPramanPdf(pramanId) {
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(`/tickets/dispatch-qc/praman/${pramanId}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    if (win) win.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (win) win.close();
    toast.error(e?.response?.status === 404 ? 'The Praman report is not on file.' : 'Could not open the Praman report.');
  }
}

export default function PramanPanel({ ticketId, onChange }) {
  const [praman, setPraman] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let off = false;
    fetchPraman(ticketId)
      .then(({ data }) => { if (!off) { setPraman(data?.praman || null); onChange?.(data?.praman || null); } })
      .catch(() => {})
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const upload = async () => {
    if (!deviceId.trim()) { toast.error('Enter the Praman Device ID'); return; }
    if (!file) { toast.error('Choose the Praman report PDF'); return; }
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast.error('The report must be a PDF'); return; }
    const fd = new FormData();
    fd.append('device_id', deviceId.trim());
    fd.append('praman_report', file);
    setBusy(true);
    try {
      const { data } = await api.post(`/tickets/${ticketId}/dispatch-qc/praman`, fd);
      setPraman(data.praman);
      onChange?.(data.praman);
      setEditing(false);
      setFile(null);
      toast.success('Praman report attached');
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not attach the Praman report');
    } finally { setBusy(false); }
  };

  if (loading) return <span className="text-ink-3">Loading Praman…</span>;

  if (praman && !editing) {
    return (
      <Notice
        tone="good"
        title={`Praman verified · Device ID ${praman.device_id}`}
        action={(
          <div className="flex flex-wrap" style={{ gap: '8px' }}>
            <Button onClick={() => openPramanPdf(praman.praman_id)}>Open report</Button>
            <Button variant="quiet" onClick={() => { setDeviceId(praman.device_id); setEditing(true); }}>Replace</Button>
          </div>
        )}
      >
        {praman.report_name || 'Praman report'} — attached by {praman.uploaded_by_name || 'someone'} on {new Date(praman.uploaded_at).toLocaleString('en-IN')}.
      </Notice>
    );
  }

  return (
    <div className="c-stack" style={{ gap: '10px' }}>
      <Notice tone="warn" title="Praman verification — required to pass">
        Run Praman on the laptop, then enter its Device ID and attach the Praman report (PDF). The sales order keeps it as proof the laptop was verified and tested before dispatch.
      </Notice>
      <FormGrid cols={2}>
        <Field label="Praman Device ID" required>
          <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} maxLength={100} className="font-mono" />
        </Field>
        <Field label="Praman report (PDF)" required hint={file ? file.name : 'PDF only'}>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
      </FormGrid>
      <div className="flex" style={{ gap: '8px' }}>
        <Button onClick={upload} disabled={busy}>{busy ? 'Attaching…' : 'Attach Praman report'}</Button>
        {praman && <Button variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>
    </div>
  );
}

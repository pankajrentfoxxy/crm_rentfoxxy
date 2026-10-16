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
  const doneRef = useRef(false);

  // A pass needs both: a report sent from the tested laptop (migration 429)
  // has no Device ID yet, so it does not count until one is entered.
  const apply = (p) => { doneRef.current = Boolean(p?.device_id); setPraman(p); onChange?.(p?.device_id ? p : null); };

  useEffect(() => {
    let off = false;
    const load = () => fetchPraman(ticketId)
      .then(({ data }) => { if (!off) apply(data?.praman || null); })
      .catch(() => {})
      .finally(() => { if (!off) setLoading(false); });
    load();
    // Picks up the report the moment the tested laptop sends it.
    const t = setInterval(() => { if (!document.hidden && !doneRef.current) load(); }, 6000);
    return () => { off = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const fromDevice = Boolean(praman && !praman.device_id);

  const upload = async () => {
    if (!deviceId.trim()) { toast.error('Enter the Praman Device ID'); return; }
    if (!file && !praman) { toast.error('Choose the Praman report PDF'); return; }
    if (file && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast.error('The report must be a PDF'); return; }
    const fd = new FormData();
    fd.append('device_id', deviceId.trim());
    if (file) fd.append('praman_report', file);
    setBusy(true);
    try {
      const { data } = await api.post(`/tickets/${ticketId}/dispatch-qc/praman`, fd);
      apply(data.praman);
      setEditing(false);
      setFile(null);
      toast.success('Praman saved');
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not save the Praman details');
    } finally { setBusy(false); }
  };

  if (loading) return <span className="text-ink-3">Loading Praman…</span>;

  if (praman?.device_id && !editing) {
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
        {praman.report_source === 'device' ? 'Report from the tested laptop' : (praman.report_name || 'Praman report')} · {praman.uploaded_by_name || 'someone'} · {new Date(praman.uploaded_at).toLocaleString('en-IN')}
      </Notice>
    );
  }

  const when = (v) => new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="c-stack" style={{ gap: '10px' }}>
      {fromDevice ? (
        <Notice
          tone="good"
          title="Report received from the tested laptop"
          action={<Button onClick={() => openPramanPdf(praman.praman_id)}>Open</Button>}
        >
          {praman.report_name || 'Praman report'} · {when(praman.report_uploaded_at || praman.uploaded_at)}
        </Notice>
      ) : (
        <Notice tone="warn" title="Praman — required to pass">
          Upload the PDF from the tested laptop (verification page), or attach it here.
        </Notice>
      )}
      <FormGrid cols={fromDevice ? 1 : 2}>
        <Field label="Praman Device ID" required>
          <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} maxLength={100} className="font-mono" autoFocus={fromDevice} />
        </Field>
        {!fromDevice && (
          <Field label="Praman report (PDF)" required={!praman} hint={file ? file.name : praman ? 'Optional — keeps the current report' : 'PDF only'}>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
        )}
      </FormGrid>
      <div className="flex" style={{ gap: '8px' }}>
        <Button variant={fromDevice ? 'primary' : undefined} onClick={upload} disabled={busy || !deviceId.trim()}>{busy ? 'Saving…' : fromDevice ? 'Save Device ID' : 'Attach Praman report'}</Button>
        {praman?.device_id && <Button variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>
    </div>
  );
}

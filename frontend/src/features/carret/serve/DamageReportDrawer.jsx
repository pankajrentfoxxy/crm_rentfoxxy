import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Drawer, Field, FormGrid, Input, Notice, Select, Textarea,
} from '../../../components/carret';
import { createDamageCase, fetchDamageCatalog, uploadDamagePhotos } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Record damage on a customer's laptop (DM1): each damaged / missing part with
 * the issue and at least one photo. Used by the technician (visit / pickup job)
 * and the warehouse (return receive). The warehouse prices it next.
 *
 * props: open, onClose, onDone, laptop { serial_id?, asset_code }, source, ticketId?, ticketItemId?, returnDcNumber?, customerId?
 */
const emptyLine = () => ({ part_name: '', damage_id: '', issue: '', photos: [], uploading: false });

export default function DamageReportDrawer({ open, onClose, onDone, laptop, source, ticketId, ticketItemId, returnDcNumber, customerId }) {
  const [catalog, setCatalog] = useState([]);
  const [lines, setLines] = useState([emptyLine()]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setLines([emptyLine()]); setNotes(''); fetchDamageCatalog().then(({ data }) => setCatalog(data.data || [])).catch(() => setCatalog([])); } }, [open]);

  const set = (i, patch) => setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const addPhotos = async (i, files) => {
    if (!files?.length) return;
    set(i, { uploading: true });
    try {
      const { data } = await uploadDamagePhotos(files);
      setLines((ls) => ls.map((l, x) => (x === i ? { ...l, photos: [...l.photos, ...(data.data || [])], uploading: false } : l)));
    } catch (e) { toast.error(errMsg(e)); set(i, { uploading: false }); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await createDamageCase({
        source,
        serial_id: laptop?.serial_id,
        asset_code: laptop?.asset_code,
        ticket_id: ticketId,
        ticket_item_id: ticketItemId,
        return_dc_number: returnDcNumber,
        customer_id: customerId,
        notes,
        lines: lines.map(({ uploading, ...l }) => ({ ...l, damage_id: l.damage_id || null })),
      });
      toast.success(data.message);
      onDone?.(data.data);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Record damage — ${laptop?.asset_code || ''}`}
      width="40rem"
      footer={<Button variant="primary" disabled={busy || lines.some((l) => l.uploading)} onClick={save}>Send to warehouse for pricing</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">One line per damaged or missing part, with a photo. The warehouse prices it, Sales / Accounts agree it with the customer, and Accounts approve it for the next invoice.</Notice>
        {lines.map((l, i) => (
          <div key={i} className="c-stack" style={{ border: '1px solid var(--rule)', borderRadius: 'var(--d-radius)', padding: '10px' }}>
            <FormGrid cols={2}>
              <Field label="Part" required><Input value={l.part_name} placeholder="Screen, keyboard, charger…" onChange={(e) => set(i, { part_name: e.target.value })} /></Field>
              <Field label="Damage type">
                <Select
                  value={String(l.damage_id || '')}
                  placeholder="Choose…"
                  onChange={(e) => {
                    const d = catalog.find((x) => String(x.damage_id) === e.target.value);
                    set(i, { damage_id: e.target.value, issue: l.issue || (d ? d.name : '') });
                  }}
                  options={catalog.map((d) => ({ value: String(d.damage_id), label: d.name }))}
                />
              </Field>
            </FormGrid>
            <Field label="Issue" required><Textarea rows={2} value={l.issue} onChange={(e) => set(i, { issue: e.target.value })} /></Field>
            <Field label={`Photos${l.photos.length ? ` · ${l.photos.length} added` : ''}`} required>
              <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => addPhotos(i, e.target.files)} />
              {l.uploading && <span className="text-ink-3"> uploading…</span>}
            </Field>
            {lines.length > 1 && <Button variant="quiet" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}>Remove this part</Button>}
          </div>
        ))}
        <Button variant="quiet" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Another part</Button>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, DataTable, DateTime, Drawer, EmptyState, Field, FormGrid, Input, Notice, Section, Segmented, Select, StatusChip, Textarea,
} from '../../../../components/carret';
import { searchParts } from '../../../floor-pipeline/floorPipelineApi';
import { attachPartToRequest, cancelPartRequest, createPartRequest, uploadPartRequestPhotos } from '../../../floor-pipeline/partRequestsApi';
import { errText } from './workShared';

/**
 * Parts for this laptop, the technician's side (PD7, PD8).
 *
 * Ask for a part → the parts desk gives a real unit → collect it and fit it,
 * recording the old part that came off. A laptop can't leave its stage while a
 * part it is waiting for is not fitted. Nothing here takes stock directly.
 */
const STATUS = {
  pending: { chip: 'pending', text: 'Waiting for the parts desk' },
  escalated: { chip: 'pending', text: 'Parts desk is buying it' },
  ordered: { chip: 'pending', text: 'Ordered from a supplier' },
  received: { chip: 'pending', text: 'Arrived — the parts desk is assigning it' },
  approved: { chip: 'approved', text: 'Ready — collect it from the parts desk and fit it' },
  attached: { chip: 'completed', text: 'Fitted' },
  rejected: { chip: 'rejected', text: 'Refused by the parts desk' },
  cancelled: { chip: 'cancelled', text: 'Cancelled' },
};
const TYPES = [
  { value: 'replacement', label: 'Replace a faulty part' },
  { value: 'upgrade', label: 'Upgrade (e.g. more RAM)' },
  { value: 'consumable', label: 'Consumable (paste, screws…)' },
];
const UPGRADE_FIELDS = ['RAM', 'Storage', 'Processor', 'GPU', 'Screen', 'OS', 'Other'];
const isBattery = (p) => /battery/i.test(`${p?.category || ''} ${p?.part_type || ''} ${p?.part_name || ''}`);

export default function PartsWork({ ticket, partRequests = [], parts = [], canWork, onChanged }) {
  const [drawer, setDrawer] = useState(null); // 'ask' | { fit: request }
  const [f, setF] = useState({});
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const live = (partRequests || []).filter((r) => r.status !== 'cancelled');
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setDrawer(null); setF({}); onChanged?.(); } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };

  const search = async (v) => {
    setF((x) => ({ ...x, q: v }));
    if (v.trim().length < 2) { setHits([]); return; }
    try { const r = await searchParts(v, 12); setHits(r.data?.parts || r.data?.data || []); } catch { setHits([]); }
  };

  const ask = () => run(async () => {
    let photos;
    if (isBattery(f.part) && f.files?.length) {
      const up = await uploadPartRequestPhotos(Array.from(f.files));
      photos = up.data?.photos || up.data?.urls || up.data?.data || [];
    }
    await createPartRequest({
      ticket_id: ticket.ticket_id,
      request_type: f.type || 'replacement',
      part_id: f.part.part_id,
      quantity: 1,
      description: (f.why || '').trim() || undefined,
      config_field: f.type === 'upgrade' ? f.field : undefined,
      old_value: f.type === 'upgrade' ? f.from : undefined,
      new_value: f.type === 'upgrade' ? f.to : undefined,
      battery_model_number: isBattery(f.part) ? (f.battery || '').trim() : undefined,
      battery_photos: isBattery(f.part) ? photos : undefined,
    });
  }, 'Asked — the parts desk will give you a unit');

  const fitReq = drawer?.fit;
  const fit = () => run(() => attachPartToRequest(fitReq.request_id, {
    old_part_returned: f.old === 'good' || f.old === 'defective',
    old_part_condition: f.old === 'good' || f.old === 'defective' ? f.old : undefined,
    old_part_name: (f.oldName || '').trim() || undefined,
    old_part_serial: (f.oldSerial || '').trim() || undefined,
    old_part_notes: (f.notes || '').trim() || undefined,
  }), `${fitReq.part_name} fitted`);

  const askMissing = [
    !f.part && 'choose the part',
    f.type === 'upgrade' && (!f.field || !(f.to || '').trim()) && 'say what it upgrades to',
    f.part && isBattery(f.part) && !(f.battery || '').trim() && 'battery model number',
    f.part && isBattery(f.part) && !f.files?.length && 'a battery photo',
  ].filter(Boolean);
  const fitNeedsOld = fitReq && fitReq.old_part_expected === 'yes';
  const fitMissing = [fitReq && !f.old && 'say what happened to the old part', fitNeedsOld && f.old === 'none' && 'this part must come back — record the old part'].filter(Boolean);

  return (
    <div className="c-stack">
      <Section title="Parts for this laptop" actions={canWork && <Button variant="primary" onClick={() => { setF({ type: 'replacement' }); setHits([]); setDrawer('ask'); }}>Ask for a part</Button>}>
        {!live.length ? <EmptyState title="No parts asked for" body={canWork ? 'Ask for a part when something needs replacing or upgrading.' : undefined} /> : (
          <DataTable
            rows={live}
            rowKey={(r) => r.request_id}
            columns={[
              { key: 'p', header: 'Part', render: (r) => r.part_name, sub: (r) => [TYPES.find((t) => t.value === r.request_type)?.label, r.new_value && `→ ${r.new_value}`].filter(Boolean).join(' ') },
              { key: 's', header: 'Where it is', render: (r) => <StatusChip status={(STATUS[r.status] || {}).chip || 'pending'} label={(STATUS[r.status] || {}).text || r.status} />, sub: (r) => (r.prt_id ? `Unit ${r.prt_id}` : null) },
              { key: 'w', header: 'Asked', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.requested_by_name || null },
              {
                key: 'a',
                header: '',
                render: (r) => (canWork && r.status === 'approved' ? <Button variant="primary" onClick={() => { setF({}); setDrawer({ fit: r }); }}>I fitted it</Button>
                  : canWork && r.status === 'pending' ? <Button variant="quiet" disabled={busy} onClick={() => run(() => cancelPartRequest(r.request_id), 'Request cancelled')}>Cancel</Button> : null),
              },
            ]}
          />
        )}
        {live.some((r) => ['pending', 'escalated', 'ordered', 'received', 'approved'].includes(r.status)) && (
          <Notice tone="info" title="The laptop waits for these parts" className="mt-3">It can't move to the next stage until each part asked for is fitted (or the request is cancelled).</Notice>
        )}
      </Section>

      {parts.length > 0 && (
        <Section title="Fitted on this ticket">
          <DataTable
            rows={parts}
            rowKey={(p) => p.ticket_part_id || p.id}
            columns={[
              { key: 'n', header: 'Part', render: (p) => p.part_name },
              { key: 'q', header: 'Qty', numeric: true, render: (p) => p.quantity_used || 1 },
              { key: 'd', header: 'When', render: (p) => <DateTime value={p.added_at} /> },
            ]}
          />
        </Section>
      )}

      <Drawer
        open={drawer === 'ask'}
        onClose={() => setDrawer(null)}
        title="Ask for a part"
        width="34rem"
        footer={(
          <>
            {askMissing.length > 0 && <span className="text-ink-3" style={{ fontSize: '13px', marginRight: 'auto' }}>Still needed: {askMissing.join(', ')}.</span>}
            <Button variant="primary" disabled={busy || askMissing.length > 0} onClick={ask}>Ask the parts desk</Button>
          </>
        )}
      >
        <div className="c-stack">
          <Field label="Why"><Segmented value={f.type || 'replacement'} onChange={set('type')} label="Request type" options={TYPES} /></Field>
          <Field label="Part" required hint="One unit per request — ask again for a second one.">
            {f.part ? (
              <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><b style={{ fontWeight: 500 }}>{f.part.part_name}</b><Button variant="quiet" onClick={() => setF((x) => ({ ...x, part: null }))}>Change</Button></span>
            ) : <Input placeholder="Type to search, e.g. 8GB DDR4, 14 inch screen" value={f.q || ''} onChange={(e) => search(e.target.value)} />}
          </Field>
          {!f.part && hits.length > 0 && (
            <div className="c-choice">
              {hits.map((p) => (
                <label key={p.part_id}>
                  <input type="radio" name="part" onChange={() => { setF((x) => ({ ...x, part: p, q: '' })); setHits([]); }} />
                  <span>{p.part_name}<small>{p.category || ''}{p.quantity != null ? ` · ${p.quantity} in stock` : ''}</small></span>
                </label>
              ))}
            </div>
          )}
          {f.type === 'upgrade' && (
            <FormGrid cols={3}>
              <Field label="What" required><Select value={f.field || ''} onChange={set('field')} placeholder="Choose" options={UPGRADE_FIELDS} /></Field>
              <Field label="From"><Input value={f.from || ''} onChange={set('from')} placeholder="8GB" /></Field>
              <Field label="To" required><Input value={f.to || ''} onChange={set('to')} placeholder="16GB" /></Field>
            </FormGrid>
          )}
          {f.part && isBattery(f.part) && (
            <FormGrid cols={2}>
              <Field label="Battery model number" required><Input value={f.battery || ''} onChange={set('battery')} className="font-mono" /></Field>
              <Field label="Photo of the old battery" required><Input type="file" accept="image/*" multiple onChange={(e) => setF((x) => ({ ...x, files: e.target.files }))} /></Field>
            </FormGrid>
          )}
          <Field label="Note for the parts desk (optional)"><Textarea rows={2} value={f.why || ''} onChange={set('why')} /></Field>
        </div>
      </Drawer>

      <Drawer
        open={!!fitReq}
        onClose={() => setDrawer(null)}
        title={fitReq ? `Fitted: ${fitReq.part_name}` : ''}
        width="32rem"
        footer={(
          <>
            {fitMissing.length > 0 && <span className="text-ink-3" style={{ fontSize: '13px', marginRight: 'auto' }}>{fitMissing.join(', ')}.</span>}
            <Button variant="primary" disabled={busy || fitMissing.length > 0} onClick={fit}>Record it as fitted</Button>
          </>
        )}
      >
        {fitReq && (
          <div className="c-stack">
            <p>Unit <span className="font-mono">{fitReq.prt_id || '—'}</span> goes into this laptop. The old part is collected by the warehouse later — you don't need to wait.</p>
            <Field label="The old part that came off" required>
              <Segmented value={f.old || ''} onChange={set('old')} label="Old part" options={[
                { value: 'good', label: 'Came off — still good' },
                { value: 'defective', label: 'Came off — faulty' },
                ...(fitNeedsOld ? [] : [{ value: 'none', label: 'Nothing came off' }]),
              ]}
              />
            </Field>
            {(f.old === 'good' || f.old === 'defective') && (
              <FormGrid cols={2}>
                <Field label="Old part (as written on it)"><Input value={f.oldName || ''} onChange={set('oldName')} placeholder="e.g. 4GB DDR4 2400" /></Field>
                <Field label="Its serial (if any)"><Input value={f.oldSerial || ''} onChange={set('oldSerial')} className="font-mono" /></Field>
              </FormGrid>
            )}
            <Field label="Notes (optional)"><Textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

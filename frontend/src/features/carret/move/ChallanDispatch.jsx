import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, ConfirmDialog, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FormGrid, Input,
  KeyValue, Notice, Section, Segmented, Select, Textarea,
} from '../../../components/carret';
import {
  cancelDcBluedartAwb, downloadDcBluedartAwbPdf, generateDcBluedartAwb, getDCMeta, getDcCourierTracking,
  updateDcAssignment,
} from '../../sales-pipeline/salesPipelineApi';
import { downloadBlob } from '../../sales-pipeline/salesPipelineUtils';

/**
 * How a challan goes out, and changing it before it does. Same endpoints as
 * the old Dispatch tab and "Change delivery details" modal: the change is
 * logged in the assignment history and the challan PDF is regenerated.
 */
const MODE_LABEL = { inhouse: 'By hand', courier: 'Courier', porter: 'Porter' };
export const modeOf = (h) => (h?.dispatch_mode || (h?.ship_by === 'by_hand' ? 'inhouse' : h?.ship_by === 'by_porter' ? 'porter' : 'courier'));
const isBlueDart = (n) => /blue\s*dart/i.test(String(n || ''));

export function DispatchSummary({ dc, head, detail, canEdit, onEdit, onChanged }) {
  const mode = modeOf(head);
  const [busy, setBusy] = useState('');
  const [track, setTrack] = useState(null);
  const [cancelAwb, setCancelAwb] = useState(null);
  const units = detail?.shipment_units || [];
  const awbs = [...new Set([...(units.map((u) => u.awb_number)), ...String(head.awb_number || '').split(/[\s,/]+/)].filter(Boolean))];
  const bluedart = mode === 'courier' && isBlueDart(head.courier_name);
  const out = ['in_transit', 'shipped', 'reached', 'delivered', 'rejected'].includes(String(head.status));

  const book = async () => {
    setBusy('book');
    try { const { data } = await generateDcBluedartAwb(dc, {}); toast.success(`BlueDart AWB ${data?.awb_number || data?.data?.awb_number || ''} booked`); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || 'BlueDart booking failed.'); } finally { setBusy(''); }
  };
  const pdf = async (awb) => {
    setBusy(`pdf-${awb || 'all'}`);
    try {
      const res = await downloadDcBluedartAwbPdf(dc, awb ? { awb } : { all: 1 });
      downloadBlob(res.data, `${awb || dc.replace(/\//g, '-')}-bluedart.pdf`);
    } catch (e) { toast.error('The waybill PDF is not available yet.'); } finally { setBusy(''); }
  };
  const openTracking = async () => {
    setTrack({ loading: true });
    try { const { data } = await getDcCourierTracking(dc); setTrack({ data }); } catch (e) { setTrack({ error: e?.response?.data?.message || 'Tracking is not available.' }); }
  };
  const doCancelAwb = async () => {
    try { await cancelDcBluedartAwb(dc, { awb_number: cancelAwb }); toast.success(`AWB ${cancelAwb} cancelled`); onChanged?.(); } catch (e) { toast.error(e?.response?.data?.message || 'Could not cancel the AWB.'); }
  };

  return (
    <Section
      title={`Dispatch · ${MODE_LABEL[mode] || mode}`}
      actions={canEdit && detail?.assignment_editable && <Button onClick={onEdit}>Change delivery details</Button>}
    >
      <div className="c-stack">
        <KeyValue items={[
          mode === 'inhouse' && { label: 'Delivery technician', value: [head.delivery_person_name, head.delivery_person_phone].filter(Boolean).join(' · ') || 'Not assigned' },
          mode === 'courier' && { label: 'Courier', value: head.courier_name },
          mode === 'courier' && { label: 'AWB', value: awbs.length ? awbs.map((a) => <DocNumber key={a} value={a} />) : 'None yet' },
          mode === 'porter' && { label: 'Porter tracking ID', value: head.porter_tracking_id && <DocNumber value={head.porter_tracking_id} /> },
          mode === 'porter' && { label: 'Porter order', value: head.porter_order_id },
          { label: 'Vehicle', value: head.vehicle_number && <DocNumber value={head.vehicle_number} /> },
          { label: 'Left the gate', value: head.dispatched_at ? <DateTime value={head.dispatched_at} /> : 'Not yet' },
          { label: 'Expected delivery', value: head.estimated_delivery && <DateTime value={head.estimated_delivery} /> },
        ]}
        />
        {!detail?.assignment_editable && canEdit && <p className="font-ui text-ink-3 m-0" style={{ fontSize: 'var(--d-sm)' }}>Delivery details are locked once the challan is delivered, refused or cancelled.</p>}
        {mode === 'courier' && (
          <div className="flex flex-wrap" style={{ gap: '8px' }}>
            {bluedart && !awbs.length && canEdit && !out && <Button variant="primary" onClick={book} disabled={busy === 'book'}>{busy === 'book' ? 'Booking…' : 'Book BlueDart AWB'}</Button>}
            {bluedart && awbs.length > 0 && <Button onClick={() => pdf(null)} disabled={busy === 'pdf-all'}>Waybill PDF{awbs.length > 1 ? 's' : ''}</Button>}
            {awbs.length > 0 && <Button onClick={openTracking}>Track</Button>}
            {head.courier_tracking_url && <a className="c-btn c-btn--quiet" href={head.courier_tracking_url} target="_blank" rel="noreferrer">Courier’s tracking page</a>}
            {mode === 'porter' && head.porter_booking_url && <a className="c-btn c-btn--quiet" href={head.porter_booking_url} target="_blank" rel="noreferrer">Porter booking</a>}
          </div>
        )}
        {units.length > 1 && (
          <DataTable
            rows={units}
            rowKey={(u, i) => `${u.awb_number}-${u.ttspl_id}-${i}`}
            columns={[
              { key: 't', header: 'Laptop', render: (u) => <DocNumber value={u.ttspl_id || u.serial_number} /> },
              { key: 'a', header: 'AWB', render: (u) => (u.awb_number ? <DocNumber value={u.awb_number} /> : '—') },
              {
                key: 'x', header: '', align: 'right',
                render: (u) => (
                  <span className="flex justify-end" style={{ gap: '4px' }}>
                    {u.awb_number && u.pdf_available && <Button variant="quiet" onClick={() => pdf(u.awb_number)}>PDF</Button>}
                    {u.awb_number && bluedart && canEdit && !out && <Button variant="quiet" onClick={() => setCancelAwb(u.awb_number)}>Cancel AWB</Button>}
                  </span>
                ),
              },
            ]}
          />
        )}
        {units.length <= 1 && bluedart && awbs.length > 0 && canEdit && !out && (
          <div><Button variant="quiet" onClick={() => setCancelAwb(awbs[0])}>Cancel AWB {awbs[0]}</Button></div>
        )}
        {(detail?.assignment_history || []).length > 0 && (
          <div>
            <div className="c-label" style={{ marginBottom: '6px' }}>Change history</div>
            <DataTable
              rows={detail.assignment_history}
              rowKey={(h, i) => i}
              columns={[
                { key: 'w', header: 'When', render: (h) => <DateTime value={h.changed_at} /> },
                { key: 'c', header: 'Change', render: (h) => `${h.previous_assignee_label || '—'} → ${h.new_assignee_label || '—'}`, sub: (h) => h.reason || null },
                { key: 'b', header: 'By', render: (h) => h.changed_by_name || '—' },
              ]}
            />
          </div>
        )}
      </div>

      <Drawer open={Boolean(track)} onClose={() => setTrack(null)} title="Courier tracking" width="40rem">
        {track?.loading && <EmptyState title="Asking the courier…" />}
        {track?.error && <Notice tone="warn">{track.error}</Notice>}
        {track?.data && <TrackingView data={track.data} />}
      </Drawer>
      <ConfirmDialog
        open={Boolean(cancelAwb)}
        onClose={() => setCancelAwb(null)}
        onConfirm={doCancelAwb}
        title={`Cancel AWB ${cancelAwb || ''}?`}
        body="The BlueDart waybill is cancelled with BlueDart and removed from this challan. Book a new one before the challan leaves."
        confirmLabel="Cancel AWB"
      />
    </Section>
  );
}

function TrackingView({ data }) {
  // GET /courier-tracking answers { data: { trackings[] | tracking, courier_tracking_url } }.
  const p = data?.data || data || {};
  const rows = p.trackings?.length ? p.trackings : (p.tracking ? [p.tracking] : []);
  if (!rows.length) return <Notice tone="info">{data?.message || 'No tracking information yet.'}</Notice>;
  return (
    <div className="c-stack">
      {p.courier_tracking_url && <a className="c-btn c-btn--quiet" href={p.courier_tracking_url} target="_blank" rel="noreferrer">Open on the courier’s site</a>}
      {rows.map((r, i) => (
        <Section key={r.awb_number || i} title={`AWB ${r.awb_number || ''}${r.ttspl_id ? ` · ${r.ttspl_id}` : ''}`}>
          {r.found === false ? <Notice tone="warn">{r.status || 'The courier has no record of this AWB yet.'}</Notice> : (
            <KeyValue items={[
              { label: 'Status', value: [r.status, r.status_type && `(${r.status_type})`].filter(Boolean).join(' ') },
              { label: 'Updated', value: r.last_updated || [r.status_date, r.status_time].filter(Boolean).join(' ') },
              { label: 'Where', value: r.current_location },
              r.received_by && { label: 'Received by', value: r.received_by },
            ]}
            />
          )}
          {(r.scans || []).length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <DataTable
                rows={r.scans}
                rowKey={(x, k) => k}
                columns={[
                  { key: 'd', header: 'When', render: (x) => [x.date, x.time].filter(Boolean).join(' ') },
                  { key: 's', header: 'Scan', render: (x) => x.status || x.code },
                  { key: 'l', header: 'Where', render: (x) => x.location || '—' },
                ]}
              />
            </div>
          )}
        </Section>
      ))}
    </div>
  );
}

export function DispatchEditDrawer({ open, dc, so, head, onClose, onSaved }) {
  const [mode, setMode] = useState('courier');
  const [f, setF] = useState({});
  const [techs, setTechs] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !head) return;
    setMode(modeOf(head));
    setF({
      courier_name: head.courier_name || 'BlueDart',
      awb_number: head.awb_number || '',
      courier_tracking_url: head.courier_tracking_url || '',
      porter_tracking_id: head.porter_tracking_id || head.porter_booking_id || '',
      porter_order_id: head.porter_order_id || '',
      porter_booking_url: head.porter_booking_url || '',
      delivery_person_id: head.delivery_person_id ? String(head.delivery_person_id) : '',
      dispatch_date: head.dispatched_at ? String(head.dispatched_at).slice(0, 10) : '',
      estimated_delivery: head.estimated_delivery ? String(head.estimated_delivery).slice(0, 10) : '',
      reason: '',
    });
    if (so) getDCMeta(so).then(({ data }) => setTechs((data?.delivery_technicians || []).filter((t) => t.is_active !== false))).catch(() => setTechs([]));
  }, [open, head, so]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (mode === 'courier' && !String(f.courier_name).trim()) { toast.error('Enter the courier'); return; }
    if (mode === 'courier' && !isBlueDart(f.courier_name) && !String(f.awb_number).trim()) { toast.error('Enter the AWB'); return; }
    if (mode === 'porter' && !String(f.porter_tracking_id).trim()) { toast.error('Enter the Porter tracking ID'); return; }
    if (mode === 'inhouse' && !f.delivery_person_id) { toast.error('Choose the delivery technician'); return; }
    setBusy(true);
    try {
      const { data } = await updateDcAssignment(dc, { dispatch_mode: mode, ...f, reason: f.reason?.trim() || undefined });
      toast.success(data?.message || 'Delivery details updated — challan PDF regenerated');
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not update the delivery details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Change delivery details"
      width="36rem"
      footer={(
        <div className="flex justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      )}
    >
      <div className="c-stack">
        <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'inhouse', label: 'By hand' }, { value: 'courier', label: 'Courier' }, { value: 'porter', label: 'Porter' }]} />
        <FormGrid cols={2}>
          {mode === 'courier' && (
            <>
              <Field label="Courier" required><Input value={f.courier_name || ''} onChange={set('courier_name')} /></Field>
              <Field label="AWB" hint={isBlueDart(f.courier_name) ? 'Leave empty and book it from the challan.' : null}><Input value={f.awb_number || ''} onChange={set('awb_number')} className="font-mono" /></Field>
              <Field label="Tracking URL" span={2}><Input value={f.courier_tracking_url || ''} onChange={set('courier_tracking_url')} /></Field>
            </>
          )}
          {mode === 'porter' && (
            <>
              <Field label="Porter tracking ID" required><Input value={f.porter_tracking_id || ''} onChange={set('porter_tracking_id')} className="font-mono" /></Field>
              <Field label="Porter order ID"><Input value={f.porter_order_id || ''} onChange={set('porter_order_id')} /></Field>
              <Field label="Booking URL" span={2}><Input value={f.porter_booking_url || ''} onChange={set('porter_booking_url')} /></Field>
            </>
          )}
          {mode === 'inhouse' && (
            <Field label="Delivery technician" required span={2}>
              <Select
                value={f.delivery_person_id || ''}
                onChange={set('delivery_person_id')}
                placeholder="Choose"
                options={techs.map((t) => ({ value: String(t.technician_id), label: `${[t.first_name, t.last_name].filter(Boolean).join(' ')}${t.phone ? ` · ${t.phone}` : ''}` }))}
              />
            </Field>
          )}
          <Field label="Dispatch date"><Input type="date" value={f.dispatch_date || ''} onChange={set('dispatch_date')} /></Field>
          <Field label="Expected delivery"><Input type="date" value={f.estimated_delivery || ''} onChange={set('estimated_delivery')} /></Field>
          <Field label="Reason for the change" span={2}><Textarea value={f.reason || ''} onChange={set('reason')} /></Field>
        </FormGrid>
      </div>
    </Drawer>
  );
}

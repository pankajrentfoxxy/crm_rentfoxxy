import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { Button, Drawer, EmptyState, Field, Input, Notice } from '../../../components/carret';

/**
 * Field technicians → Check-in places (17 Oct 2026): where a technician can
 * start and end the day. The default place is preselected at check-in, and a
 * day nobody ends is checked out there at 10 PM. A place is added by name and
 * location — "Use my location", or coordinates / a Google Maps link pasted in.
 */
const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';
const mapLink = (p) => `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;

/** "28.4721, 77.0724" or a Google Maps link (…@28.47,77.07… / ?q=28.47,77.07) → { lat, lng }. */
function parsePoint(text) {
  const s = String(text || '');
  const m = s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export default function CheckinPlaces({ canEdit }) {
  const [places, setPlaces] = useState(null);
  const [form, setForm] = useState(null); // { id?, name, where }
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/field/places').then(({ data }) => setPlaces(data.places || [])).catch(() => setPlaces([]));
  useEffect(() => { load(); }, []);
  const run = async (fn, ok) => {
    setBusy(true);
    try { const { data } = await fn(); setPlaces(data.places || []); toast.success(ok); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(false); }
  };
  const here = () => {
    if (!navigator.geolocation) { toast.error('Location is not available on this device'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setForm((f) => ({ ...f, where: `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}` })),
      () => toast.error('Allow location, or paste the coordinates'),
      { timeout: 10000, enableHighAccuracy: true }
    );
  };
  const point = form ? parsePoint(form.where) : null;
  const save = async () => {
    if (!form.name.trim()) { toast.error('Name the place'); return; }
    if (!point) { toast.error('Add the location — use your location, or paste coordinates / a Google Maps link'); return; }
    const body = { name: form.name.trim(), latitude: point.lat, longitude: point.lng };
    if (await run(() => (form.id ? api.patch(`/field/places/${form.id}`, body) : api.post('/field/places', body)), form.id ? 'Saved' : 'Place added')) setForm(null);
  };

  if (!places) return <EmptyState title="Loading…" />;
  return (
    <div className="c-stack">
      <Notice tone="info">
        Technicians choose one of these to check in and to check out. The default is preselected, and a day nobody ends is checked out there at 10 PM.
      </Notice>
      <div className="c-places">
        {places.map((p) => (
          <div key={p.place_id} className={`c-place${p.is_default ? ' is-default' : ''}`}>
            <span className="c-place-pin" aria-hidden="true">📍</span>
            <div className="min-w-0">
              <b>{p.name}</b>
              <small><a href={mapLink(p)} target="_blank" rel="noopener noreferrer" className="font-mono">{Number(p.latitude).toFixed(5)}, {Number(p.longitude).toFixed(5)}</a></small>
            </div>
            {p.is_default && <span className="c-place-def">Default</span>}
            {canEdit && (
              <div className="c-place-a">
                {!p.is_default && <Button variant="quiet" disabled={busy} onClick={() => run(() => api.post(`/field/places/${p.place_id}/default`), `${p.name} is the default`)}>Make default</Button>}
                <Button variant="quiet" onClick={() => setForm({ id: p.place_id, name: p.name, where: `${p.latitude}, ${p.longitude}` })}>Edit</Button>
                {!p.is_default && <Button variant="quiet" disabled={busy} onClick={() => run(() => api.delete(`/field/places/${p.place_id}`), 'Removed')}>Remove</Button>}
              </div>
            )}
          </div>
        ))}
        {!places.length && <EmptyState title="No places yet" />}
      </div>
      {canEdit && <div><Button variant="primary" onClick={() => setForm({ name: '', where: '' })}>Add a place</Button></div>}

      <Drawer
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit place' : 'Add a check-in place'}
        footer={<Button variant="primary" disabled={busy} onClick={save}>{form?.id ? 'Save' : 'Add place'}</Button>}
      >
        {form && (
          <div className="c-stack">
            <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Warehouse — Manesar" /></Field>
            <Field label="Location" required hint="Coordinates (28.4721, 77.0724) or a Google Maps link">
              <Input value={form.where} onChange={(e) => setForm({ ...form, where: e.target.value })} placeholder="28.4721, 77.0724" />
            </Field>
            <div><Button onClick={here}>Use my current location</Button></div>
            {form.where && (point
              ? <Notice tone="good" title={`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}><a href={mapLink({ latitude: point.lat, longitude: point.lng })} target="_blank" rel="noopener noreferrer">Check it on the map</a></Notice>
              : <Notice tone="warn">Could not read a location from that — paste coordinates or a Google Maps link.</Notice>)}
          </div>
        )}
      </Drawer>
    </div>
  );
}

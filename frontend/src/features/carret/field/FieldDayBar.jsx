import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, Select } from '../../../components/carret';
import { endFieldDay, fetchFieldDay, fmtKm, fmtTime, resumeFieldDay, startFieldDay, warehouseStop } from './fieldApi';

const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';
const gps = () => new Promise((resolve) => {
  if (!navigator.geolocation) { resolve(null); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => resolve(null), { timeout: 10000, maximumAge: 60000 });
});

/**
 * Top of My work / My deliveries for a field technician (migration 438):
 * "Start my day" at an office (or where they are) before any task, then the
 * day so far — stops and km by road — and "End my day" (the leg back).
 * onReady(started) lets a page hold its "reached" buttons until checked in.
 */
export default function FieldDayBar({ onReady }) {
  const [data, setData] = useState(null);
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [atWh, setAtWh] = useState(false);
  const load = useCallback(() => {
    fetchFieldDay().then(({ data: d }) => {
      setData(d);
      setPlace((p) => p || String((d.places || []).find((x) => x.is_default)?.place_id || (d.places || [])[0]?.place_id || ''));
    }).catch(() => setData({ is_field_user: false }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const started = Boolean(data?.day);
  const onDuty = started && !data.day.ended_at;
  useEffect(() => { if (data) onReady?.(!data.is_field_user || onDuty); }, [data, onDuty, onReady]);
  if (!data || !data.is_field_user) return null;

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setEnding(false); setAtWh(false); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const start = (here) => run(async () => {
    if (here) {
      const p = await gps();
      if (!p) throw new Error('Location is off — allow it, or start at the office');
      await startFieldDay({ ...p, label: 'My location' });
    } else await startFieldDay({ place_id: Number(place) });
  }, 'Checked in — have a safe day');
  const end = (here) => run(async () => {
    if (here) {
      const p = await gps();
      if (!p) throw new Error('Location is off — choose the office');
      await endFieldDay(p);
    } else await endFieldDay({ place_id: Number(place) });
  }, 'Checked out');
  const options = (data.places || []).map((p) => ({ value: String(p.place_id), label: p.name }));

  if (!started) {
    return (
      <div className="c-dayb is-start">
        <div className="c-dayb-t"><b>Check in to start your day</b><span>Before your first task — your travel is measured from where you check in.</span></div>
        <div className="c-dayb-a">
          <Select value={place} onChange={(e) => setPlace(e.target.value)} options={options} aria-label="Check-in place" />
          <Button variant="primary" disabled={busy || !place} onClick={() => start(false)}>Check in here</Button>
          <Button variant="quiet" disabled={busy} onClick={() => start(true)}>📍 Check in at my location</Button>
        </div>
      </div>
    );
  }
  const d = data.day;
  return (
    <div className={`c-dayb${d.ended_at ? ' is-ended' : ''}`}>
      <div className="c-dayb-t">
        <b>{d.ended_at ? 'Checked out' : 'On duty'} · {fmtKm(d.total_km)}</b>
        <span>From {d.start_label} at {fmtTime(d.started_at)} · {d.stops} stop{d.stops === 1 ? '' : 's'}{d.unmeasured ? ` · ${d.unmeasured} being measured` : ''}{d.ended_at ? ` · checked out ${fmtTime(d.ended_at)} at ${d.end_label || '—'}` : ''}</span>
        {!d.ended_at && <span>Not checked out by 10 PM? You are checked out at {(data.places || []).find((p) => p.is_default)?.name || 'the office'} automatically.</span>}
      </div>
      <div className="c-dayb-a">
        <Link className="c-btn" to="/carret/serve/my-report">My report</Link>
        {/* Checked out by mistake, or at 10 PM: back on duty; the next stop is measured from the last one (migration 441). */}
        {d.ended_at && <Button variant="primary" disabled={busy} onClick={() => run(() => resumeFieldDay(), 'Checked in again')}>Check in again</Button>}
        {/* Back at the warehouse to pick up or hand over: the distance there is counted (migration 439). */}
        {!d.ended_at && !ending && !atWh && <Button variant="quiet" onClick={() => setAtWh(true)}>📦 At the warehouse</Button>}
        {!d.ended_at && atWh && (
          <>
            <Select value={place} onChange={(e) => setPlace(e.target.value)} options={options} aria-label="Which warehouse / office" />
            <Button variant="primary" disabled={busy || !place} onClick={() => run(() => warehouseStop({ place_id: Number(place) }), 'Recorded at the warehouse')}>Here</Button>
            <Button variant="quiet" disabled={busy} onClick={() => run(async () => { const p = await gps(); if (!p) throw new Error('Location is off — choose the place'); return warehouseStop(p); }, 'Recorded at your location')}>📍 My location</Button>
            <Button variant="quiet" onClick={() => setAtWh(false)}>Cancel</Button>
          </>
        )}
        {!d.ended_at && !ending && !atWh && <Button variant="quiet" onClick={() => setEnding(true)}>Check out</Button>}
        {!d.ended_at && ending && (
          <>
            <Select value={place} onChange={(e) => setPlace(e.target.value)} options={options} aria-label="Check out at" />
            <Button variant="primary" disabled={busy || !place} onClick={() => end(false)}>Check out here</Button>
            <Button variant="quiet" disabled={busy} onClick={() => end(true)}>📍 Check out at my location</Button>
            <Button variant="quiet" onClick={() => setEnding(false)}>Cancel</Button>
          </>
        )}
      </div>
    </div>
  );
}

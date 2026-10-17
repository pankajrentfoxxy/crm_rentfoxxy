import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, Select } from '../../../components/carret';
import { endFieldDay, fetchFieldDay, fmtKm, fmtTime, startFieldDay } from './fieldApi';

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
  const load = useCallback(() => {
    fetchFieldDay().then(({ data: d }) => {
      setData(d);
      setPlace((p) => p || String((d.places || []).find((x) => x.is_default)?.place_id || (d.places || [])[0]?.place_id || ''));
    }).catch(() => setData({ is_field_user: false }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const started = Boolean(data?.day);
  useEffect(() => { if (data) onReady?.(!data.is_field_user || started); }, [data, started, onReady]);
  if (!data || !data.is_field_user) return null;

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setEnding(false); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const start = (here) => run(async () => {
    if (here) {
      const p = await gps();
      if (!p) throw new Error('Location is off — allow it, or start at the office');
      await startFieldDay({ ...p, label: 'My location' });
    } else await startFieldDay({ place_id: Number(place) });
  }, 'Day started — have a safe day');
  const end = (here) => run(async () => {
    if (here) {
      const p = await gps();
      if (!p) throw new Error('Location is off — choose the office');
      await endFieldDay(p);
    } else await endFieldDay({ place_id: Number(place) });
  }, 'Day ended');
  const options = (data.places || []).map((p) => ({ value: String(p.place_id), label: p.name }));

  if (!started) {
    return (
      <div className="c-dayb is-start">
        <div className="c-dayb-t"><b>Start your day</b><span>Check in before your first task — your travel is measured from here.</span></div>
        <div className="c-dayb-a">
          <Select value={place} onChange={(e) => setPlace(e.target.value)} options={options} aria-label="Check-in place" />
          <Button variant="primary" disabled={busy || !place} onClick={() => start(false)}>Start at the office</Button>
          <Button variant="quiet" disabled={busy} onClick={() => start(true)}>Start here (GPS)</Button>
        </div>
      </div>
    );
  }
  const d = data.day;
  return (
    <div className={`c-dayb${d.ended_at ? ' is-ended' : ''}`}>
      <div className="c-dayb-t">
        <b>{d.ended_at ? 'Day ended' : 'On duty'} · {fmtKm(d.total_km)}</b>
        <span>From {d.start_label} at {fmtTime(d.started_at)} · {d.stops} stop{d.stops === 1 ? '' : 's'}{d.unmeasured ? ` · ${d.unmeasured} being measured` : ''}{d.ended_at ? ` · back ${fmtTime(d.ended_at)}` : ''}</span>
      </div>
      <div className="c-dayb-a">
        <Link className="c-btn" to="/carret/serve/my-report">My report</Link>
        {!d.ended_at && !ending && <Button variant="quiet" onClick={() => setEnding(true)}>End my day</Button>}
        {!d.ended_at && ending && (
          <>
            <Select value={place} onChange={(e) => setPlace(e.target.value)} options={options} aria-label="End at" />
            <Button variant="primary" disabled={busy || !place} onClick={() => end(false)}>Back at the office</Button>
            <Button variant="quiet" disabled={busy} onClick={() => end(true)}>End here (GPS)</Button>
          </>
        )}
      </div>
    </div>
  );
}

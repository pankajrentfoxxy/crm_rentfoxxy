import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Badge, Button, Mono, PageHeader, PriorityChip } from '../../../components/ui/supportPrimitives';
import usePermission from '../../../hooks/usePermission';
import { addSlaHoliday, fetchSlaBreaches, fetchSlaCalendars, fetchSlaPolicies, patchSlaPolicy } from '../supportV2Api';

function overLabel(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0) return 'just due';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function BreachRegister({ data }) {
  const nav = useNavigate();
  const k = (data && data.kpis) || {};
  const reasons = (data && data.by_reason) || [];
  const maxN = Math.max(1, ...reasons.map((r) => r.n));
  const avg = (k.avg_hours_by_priority || []).map((r) => `P${r.priority} ${r.avg_hours}h`).join(' · ') || '—';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Response SLA %', value: `${k.response_pct ?? '—'}%` },
          { label: 'Resolution SLA %', value: `${k.resolution_pct ?? '—'}%` },
          { label: 'Avg time to resolve', value: avg },
          { label: 'Total paused time', value: `${Math.round((k.paused_minutes || 0) / 60)} h` },
        ].map((tile) => (
          <div key={tile.label} className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup px-3.5 py-3">
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-sup-faint font-semibold">{tile.label}</div>
            <div className="font-mono tabular-nums text-[20px] font-bold tracking-[-0.03em] mt-0.5 text-sup-ink">
              {tile.value}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup p-4">
        <div className="text-[13px] font-semibold text-sup-ink mb-2">Breaches by reason</div>
        {reasons.length === 0 && <div className="text-[12px] text-sup-muted">No breaches yet.</div>}
        {reasons.map((r) => (
          <div key={r.reason} className="flex items-center gap-2 py-1">
            <div className="w-40 text-[12px] truncate">{r.reason === 'NOT_YET_GIVEN' ? 'Not yet given' : r.reason}</div>
            <div className="flex-1 h-2 bg-sup-canvas rounded">
              <div className="h-2 bg-pri1 rounded" style={{ width: `${(r.n / maxN) * 100}%` }} />
            </div>
            <Mono className="text-[12px] w-8 text-right">{r.n}</Mono>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup overflow-hidden">
        <div className="px-4 py-3 border-b border-sup-lineSoft text-[13px] font-semibold">Breached tickets</div>
        <table className="w-full text-[12.5px]">
          <thead className="bg-sup-canvas text-sup-muted text-left">
            <tr>
              <th className="px-3 py-2">Ticket</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Over by</th>
              <th className="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((r) => (
              <tr key={r.ticket_id} className="border-t border-sup-lineSoft">
                <td className="px-3 py-2">
                  <button type="button" className="text-sup-accent font-semibold" onClick={() => nav(`/support/tickets/${r.ticket_id}`)}>
                    <Mono>{r.ticket_number}</Mono>
                  </button>
                  <PriorityChip priority={r.priority} />
                </td>
                <td className="px-3 py-2">{r.customer_name || '—'}</td>
                <td className="px-3 py-2 font-mono">{overLabel(r.over_seconds)}</td>
                <td className="px-3 py-2">
                  {r.breach_reason || <span className="text-sup-faint">Not yet given</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hoursLabel(mins) {
  if (mins == null) return '—';
  if (mins % 60 === 0) return `${mins / 60} h`;
  return `${mins} m`;
}

export default function SlaAdminPage() {
  const { canEdit } = usePermission();
  const editable = canEdit('support_sla_admin');
  const [policies, setPolicies] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [calId, setCalId] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [editing, setEditing] = useState(null);
  const [breaches, setBreaches] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, c, b] = await Promise.all([fetchSlaPolicies(), fetchSlaCalendars(), fetchSlaBreaches()]);
      setPolicies(p.data?.rows || []);
      const cals = c.data?.rows || [];
      setCalendars(cals);
      setCalId((prev) => prev || (cals[0] ? String(cals[0].calendar_id) : ''));
      setBreaches(b.data || null);
    } catch {
      toast.error('Failed to load SLA admin');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedCal = calendars.find((c) => String(c.calendar_id) === String(calId));

  const saveHoliday = async () => {
    if (!calId || !holidayDate || !holidayName) {
      toast.error('Date and name are required');
      return;
    }
    try {
      await addSlaHoliday(calId, { holiday_date: holidayDate, name: holidayName });
      toast.success('Holiday saved — preview will use it immediately');
      setHolidayName('');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not add holiday');
    }
  };

  const savePolicy = async (row) => {
    try {
      await patchSlaPolicy(row.policy_id, {
        response_minutes: Number(row.response_minutes),
        resolution_minutes: Number(row.resolution_minutes),
        name: row.name,
      });
      toast.success('Policy updated');
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-5">
      <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">Screen S17</div>
      <PageHeader
        title="SLA policies"
        subtitle="Most specific match wins — customer beats tier beats default."
      />

      <BreachRegister data={breaches} />

      <div className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup overflow-hidden">
        <div className="px-4 py-3 border-b border-sup-lineSoft text-[13px] font-semibold text-sup-ink">Policies</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-sup-canvas text-sup-muted text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Policy</th>
                <th className="px-3 py-2 font-semibold">Applies to</th>
                <th className="px-3 py-2 font-semibold">Priority</th>
                <th className="px-3 py-2 font-semibold">Calendar</th>
                <th className="px-3 py-2 font-semibold">Response</th>
                <th className="px-3 py-2 font-semibold">Resolution</th>
                <th className="px-3 py-2 font-semibold">Edit</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const contractual = p.customer_id || p.support_tier;
                const isEdit = editing === p.policy_id;
                return (
                  <tr
                    key={p.policy_id}
                    className={`border-t border-sup-lineSoft ${contractual ? 'bg-sup-accentSoft' : ''}`}
                  >
                    <td className="px-3 py-2 font-semibold text-sup-ink">
                      {p.name}
                      {contractual ? <span className="ml-2"><Badge tone="blue">Contractual</Badge></span> : null}
                    </td>
                    <td className="px-3 py-2 text-sup-ink2">
                      {p.customer_name || p.support_tier || p.ticket_class || 'All'}
                    </td>
                    <td className="px-3 py-2">{p.priority ? <PriorityChip priority={p.priority} /> : '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{p.calendar_code}</td>
                    <td className="px-3 py-2">
                      {isEdit ? (
                        <input
                          className="w-20 h-8 border border-sup-line rounded px-1 font-mono text-[12px]"
                          defaultValue={p.response_minutes}
                          onChange={(e) => { p.response_minutes = e.target.value; }}
                        />
                      ) : hoursLabel(p.response_minutes)}
                    </td>
                    <td className="px-3 py-2">
                      {isEdit ? (
                        <input
                          className="w-20 h-8 border border-sup-line rounded px-1 font-mono text-[12px]"
                          defaultValue={p.resolution_minutes}
                          onChange={(e) => { p.resolution_minutes = e.target.value; }}
                        />
                      ) : hoursLabel(p.resolution_minutes)}
                    </td>
                    <td className="px-3 py-2">
                      {editable && isEdit ? (
                        <Button size="sm" variant="primary" onClick={() => savePolicy(p)}>Save</Button>
                      ) : editable ? (
                        <button type="button" className="text-sup-accent font-semibold" onClick={() => setEditing(p.policy_id)}>
                          Edit
                        </button>
                      ) : (
                        <span className="text-sup-faint">View only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11.5px] text-sup-muted bg-sup-canvas border-t border-sup-lineSoft">
          Most specific match wins — customer beats tier beats default.
        </div>
      </div>

      <div className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup p-4 space-y-3">
        <div className="text-[13px] font-semibold text-sup-ink">Calendars & holidays</div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-[12px]">
            <div className="text-[10px] uppercase text-sup-faint font-semibold">Calendar</div>
            <select value={calId} onChange={(e) => setCalId(e.target.value)} className="h-9 rounded-lg border border-sup-line px-2">
              {calendars.map((c) => <option key={c.calendar_id} value={c.calendar_id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-[12px]">
            <div className="text-[10px] uppercase text-sup-faint font-semibold">Date</div>
            <input type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} disabled={!editable} className="h-9 rounded-lg border border-sup-line px-2" />
          </label>
          <label className="text-[12px]">
            <div className="text-[10px] uppercase text-sup-faint font-semibold">Name</div>
            <input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} disabled={!editable} className="h-9 rounded-lg border border-sup-line px-2" />
          </label>
          {editable ? <Button size="sm" onClick={saveHoliday}>Add holiday</Button> : null}
        </div>
        <ul className="text-[12px] text-sup-ink2 space-y-1 max-h-48 overflow-y-auto">
          {(selectedCal?.holidays || []).map((h) => (
            <li key={h.holiday_id} className="font-mono">
              {String(h.holiday_date).slice(0, 10)} <span className="font-sans text-sup-muted">{h.name}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-sup-faint m-0">
          Operator: review FY 26-27 public holidays and add company-specific days.
        </p>
      </div>
    </div>
  );
}

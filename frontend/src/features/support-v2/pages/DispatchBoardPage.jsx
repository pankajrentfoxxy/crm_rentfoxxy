import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { PageHeader, Button } from '../../../components/ui/primitives';
import { PriorityChip, Mono } from '../../../components/ui/supportPrimitives';
import {
  dispatchAssign, dispatchAutoAssign, fetchDispatchBoard, fetchDispatchCapacity,
} from '../supportV2Api';
import { woTypeLabel } from '../supportV2Utils';

const PRI = { 1: 'bg-pri1-bg border-pri1 text-pri1', 2: 'bg-pri2-bg border-pri2 text-pri2', 3: 'bg-pri3-bg border-pri3 text-pri3', 4: 'bg-pri4-bg border-pri4 text-pri4' };

function slotIso(date, hhmm) {
  return `${date}T${hhmm}:00`;
}

function willBreach(job, slotStart) {
  if (!job.sla_due_at || !slotStart) return false;
  return new Date(slotStart) > new Date(job.sla_due_at);
}

export default function DispatchBoardPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [board, setBoard] = useState({ technicians: [], unassigned: [], assigned: [], slots: [] });
  const [capacity, setCapacity] = useState([]);
  const [picked, setPicked] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchDispatchBoard({ date }),
      fetchDispatchCapacity({ date }),
    ]).then(([b, c]) => {
      setBoard(b.data || { technicians: [], unassigned: [], assigned: [], slots: [] });
      setCapacity(c.data?.rows || []);
    }).catch(() => toast.error('Could not load dispatch board'))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const assign = async (woId, userId, slot) => {
    try {
      const r = await dispatchAssign({
        wo_id: woId,
        user_id: userId,
        slot_start: slot ? slotIso(date, slot) : undefined,
      });
      const warns = r.data?.warnings || [];
      if (warns.length) toast(warns.map((w) => w.detail || w.code).join(' · '), { icon: '⚠' });
      else toast.success('Assigned');
      setPicked(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Assign failed');
    }
  };

  const onDrop = (e, userId, slot) => {
    e.preventDefault();
    const woId = Number(e.dataTransfer.getData('text/wo_id') || picked?.wo_id);
    if (woId) assign(woId, userId, slot);
  };

  const insights = useMemo(() => {
    const over = (board.technicians || []).filter((t) => t.over_capacity);
    const grouped = (board.unassigned || []).length;
    const chip = (board.unassigned || []).filter((j) => /CHIP|MBD/i.test(j.issue_name || j.wo_type || ''));
    return { over, grouped, chip };
  }, [board]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-3">
      <PageHeader title="Dispatch board" subtitle="One board. Drag a job onto a slot, or select then Enter." />
      <div className="flex flex-wrap gap-2 items-center">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 border rounded px-2 text-[12px]" />
        <Button size="sm" variant="secondary" onClick={async () => {
          try {
            const r = await dispatchAutoAssign({ date, dry_run: true });
            const n = (r.data?.results || []).filter((x) => x.assigned_to).length;
            toast.success(`Dry run · ${n} would assign`);
          } catch (e) { toast.error(e.response?.data?.message || 'Dry run failed'); }
        }}>Auto-assign dry run</Button>
        <Button size="sm" onClick={async () => {
          try {
            const r = await dispatchAutoAssign({ date, dry_run: false });
            toast.success(`Assigned ${(r.data?.results || []).filter((x) => x.assigned_to).length}`);
            load();
          } catch (e) { toast.error(e.response?.data?.message || 'Auto-assign failed'); }
        }}>Auto-assign</Button>
      </div>

      {loading ? <p className="text-[12px] text-sup-muted">Loading…</p> : (
        <div className="flex gap-3 overflow-x-auto">
          <div className="w-[220px] shrink-0 space-y-2">
            <div className="text-[10px] uppercase text-sup-faint font-semibold">Unassigned</div>
            {(board.unassigned || []).map((j) => (
              <div
                key={j.wo_id}
                draggable
                tabIndex={0}
                onDragStart={(e) => e.dataTransfer.setData('text/wo_id', String(j.wo_id))}
                onClick={() => setPicked(j)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPicked(j); }}
                className={`rounded-lg border p-2 text-[11px] cursor-grab ${PRI[j.priority] || PRI[4]} ${picked?.wo_id === j.wo_id ? 'ring-2 ring-sup-accent' : ''}`}
              >
                <div className="flex items-center gap-1"><PriorityChip priority={j.priority} /><Mono>{j.wo_number}</Mono></div>
                <div className="font-semibold">{j.customer_name}</div>
                <div>{woTypeLabel(j.wo_type)}</div>
              </div>
            ))}
            {picked && <div className="text-[11px] text-sup-accent">Selected {picked.wo_number} — focus a cell and press Enter</div>}
          </div>

          <div className="min-w-[640px] flex-1 overflow-x-auto">
            <div className="grid" style={{ gridTemplateColumns: `72px repeat(${(board.technicians || []).length}, minmax(140px,1fr))` }}>
              <div />
              {(board.technicians || []).map((t) => (
                <div key={t.user_id} className="px-2 py-1 text-[11px] border-b border-sup-lineSoft">
                  <div className="font-semibold">{t.name}</div>
                  <div className={t.over_capacity ? 'text-pri1' : 'text-sup-muted'}>
                    {t.jobs_today} jobs{t.over_capacity ? ' · over capacity' : ''}
                  </div>
                </div>
              ))}
              {(board.slots || []).map((slot) => (
                <React.Fragment key={slot}>
                  <div className="text-[11px] font-mono py-2 pr-2 text-sup-muted">{slot}</div>
                  {(board.technicians || []).map((t) => {
                    const here = (board.assigned || []).filter((j) => (
                      Number(j.assigned_to) === Number(t.user_id)
                      && j.slot_start
                      && new Date(j.slot_start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) === slot
                    ));
                    return (
                      <div
                        key={`${t.user_id}-${slot}`}
                        tabIndex={0}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onDrop(e, t.user_id, slot)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && picked) assign(picked.wo_id, t.user_id, slot);
                        }}
                        className="min-h-[56px] border border-sup-lineSoft p-1"
                      >
                        {here.map((j) => (
                          <div key={j.wo_id} className={`rounded border px-1.5 py-1 text-[10.5px] mb-1 ${PRI[j.priority] || PRI[4]}`}>
                            <Mono>{j.wo_number}</Mono> {woTypeLabel(j.wo_type)}
                            {willBreach(j, j.slot_start) && <div className="text-pri1">⚠ will breach — slot too late</div>}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <div className="bg-white border border-sup-lineSoft rounded-xl p-3 text-[12px]">
          <div className="font-semibold">Capacity warning</div>
          <div className="text-sup-muted mt-1">
            {insights.over.length ? insights.over.map((t) => t.name).join(', ') : 'Everyone is inside their daily cap.'}
          </div>
        </div>
        <div className="bg-white border border-sup-lineSoft rounded-xl p-3 text-[12px]">
          <div className="font-semibold">Grouped visits</div>
          <div className="text-sup-muted mt-1">{insights.grouped} unassigned job(s) — group same site before sending two people.</div>
        </div>
        <div className="bg-white border border-sup-lineSoft rounded-xl p-3 text-[12px]">
          <div className="font-semibold">Skill match</div>
          <div className="text-sup-muted mt-1">
            {insights.chip.length ? `${insights.chip.length} chip-level job(s) waiting — do not give these to delivery-only techs.` : 'No unmatched chip-level jobs in the rail.'}
          </div>
          <Button size="sm" className="mt-2" variant="secondary" onClick={() => dispatchAutoAssign({ date, dry_run: true }).then((r) => toast.success(`${(r.data?.results || []).length} explained`))}>
            Explain auto-assign
          </Button>
        </div>
      </div>
      {capacity.length > 0 && (
        <p className="text-[11px] text-sup-faint">{capacity.filter((c) => c.remaining === 0).length} technician(s) at cap today.</p>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { getStageTask, moveTicketStage, saveStageTask } from '../floorPipelineApi';

const NEXT_STAGE_ON_COMPLETE = {
  'Assembly & Software': 'Final Testing',
  'Final Testing': 'QC1',
};

// Recommended refurb checklists. These are intentionally simple constants now and
// can be moved to the editable stage_checklists table later.
export const STAGE_CHECKLISTS = {
  'Assembly & Software': [
    { key: 'os_installed', label: 'OS installed (genuine image)' },
    { key: 'drivers_installed', label: 'All drivers installed' },
    { key: 'activation', label: 'Windows / Office activated' },
    { key: 'software_suite', label: 'Standard software suite installed' },
    { key: 'hardware_reassembled', label: 'Hardware reassembled & screws fitted' },
    { key: 'cleaning_done', label: 'Cleaning / cosmetic finish done' },
    { key: 'boot_ok', label: 'Boots & runs without errors' },
  ],
  'Final Testing': [
    { key: 'power_ok', label: 'Powers on & charges' },
    { key: 'display_ok', label: 'Display — no dead pixels / lines' },
    { key: 'keyboard_ok', label: 'Keyboard & touchpad all keys working' },
    { key: 'battery_ok', label: 'Battery health acceptable' },
    { key: 'ports_ok', label: 'All ports (USB / Type-C / HDMI) working' },
    { key: 'wifi_bt_ok', label: 'Wi-Fi & Bluetooth working' },
    { key: 'audio_ok', label: 'Audio (speaker / mic / jack) working' },
    { key: 'camera_ok', label: 'Camera working' },
    { key: 'final_grade', label: 'Final grade assigned & unit clean' },
  ],
};

export default function StageTaskPanel({ ticket, stageName, onSubmitted }) {
  const items = STAGE_CHECKLISTS[stageName] || [];
  const [checks, setChecks] = useState({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getStageTask(ticket.ticket_id, ticket.current_stage_id);
      if (r.data?.progress?.checklist_data) setChecks(r.data.progress.checklist_data || {});
    } catch {
      /* first time — no progress yet */
    } finally {
      setLoading(false);
    }
  }, [ticket.ticket_id, ticket.current_stage_id]);

  useEffect(() => { load(); }, [load]);

  const toggle = (key) => setChecks((c) => ({ ...c, [key]: !c[key] }));
  const doneCount = items.filter((i) => checks[i.key]).length;
  const allDone = items.length > 0 && doneCount === items.length;

  const save = async (complete) => {
    setSaving(true);
    try {
      await saveStageTask(ticket.ticket_id, {
        stage_id: ticket.current_stage_id,
        checklist_data: checks,
        notes,
        completed: complete,
      });

      const nextStage = complete ? NEXT_STAGE_ON_COMPLETE[stageName] : null;
      if (nextStage) {
        const { data: moveRes } = await moveTicketStage(ticket.ticket_id, {
          to_stage_name: nextStage,
        });
        if (!moveRes?.success) {
          toast.error(moveRes?.message || 'Task saved but stage move failed');
          onSubmitted?.();
          return;
        }
        toast.success(`Task complete — moved to ${nextStage}`);
        setNotes('');
        onSubmitted?.({ nextStage });
        return;
      }

      setNotes('');
      toast.success(complete ? 'Task marked complete' : 'Progress saved');
      onSubmitted?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!items.length) {
    return <p className="text-sm text-slate-500">No structured task for this stage.</p>;
  }

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{stageName} — Task</h3>
        <span className="text-xs text-slate-500">{doneCount}/{items.length} done</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-blue-600" /></div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const on = !!checks[it.key];
            return (
              <li key={it.key}>
                <button
                  type="button"
                  onClick={() => toggle(it.key)}
                  className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-colors ${on ? 'bg-green-50 border-green-200 text-green-900' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                >
                  {on ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" /> : <Circle className="w-4 h-4 text-gray-300 shrink-0" />}
                  {it.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <textarea
        className="w-full rounded-lg border text-sm p-2 min-h-[60px]"
        placeholder="Work notes for this stage (optional)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => save(false)} className="px-4 py-2 rounded-lg border text-sm font-medium disabled:opacity-50">
          Save progress
        </button>
        <button
          type="button"
          disabled={saving || !allDone}
          onClick={() => save(true)}
          title={allDone ? '' : 'Tick all items to complete'}
          className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          Mark task complete
        </button>
      </div>
      {!allDone && <p className="text-xs text-slate-400">Complete all checklist items to enable “Mark task complete”. Assembly tasks auto-advance to Final Testing.</p>}
    </div>
  );
}

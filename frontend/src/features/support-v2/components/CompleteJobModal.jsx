import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui/supportPrimitives';
import { completeWorkOrder, fetchActionCodes, fetchTaxonomyTree } from '../supportV2Api';
import { newIdempotencyKey } from '../supportV2Utils';

function childrenOf(tree, parentId) {
  if (!parentId) return tree || [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (Number(n.catalog_id) === Number(parentId)) return n.children || [];
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree) || [];
}

export default function CompleteJobModal({ wo, assets, onClose, onSaved }) {
  const line = (assets || [])[0] || {};
  const [tree, setTree] = useState([]);
  const [actions, setActions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type_id: line.found_type_id || line.reported_type_id || '',
    subtype_id: line.found_subtype_id || line.reported_subtype_id || '',
    found_issue_id: line.found_issue_id || line.reported_issue_id || '',
    action_code_ids: [],
    outcome: 'RESOLVED',
    notes: '',
    time_spent_minutes: '',
  });

  useEffect(() => {
    fetchTaxonomyTree().then((r) => setTree(r.data?.tree || [])).catch(() => {});
    fetchActionCodes().then((r) => setActions(r.data?.rows || [])).catch(() => {});
  }, []);

  const types = tree;
  const subtypes = childrenOf(tree, form.type_id);
  const issues = childrenOf(tree, form.subtype_id);
  const notesLen = String(form.notes || '').trim().length;
  const valid = form.found_issue_id && form.action_code_ids.length && form.outcome && notesLen >= 20;

  const grouped = useMemo(() => {
    const map = {};
    for (const a of actions) {
      const g = a.group_name || 'Other';
      if (!map[g]) map[g] = [];
      map[g].push(a);
    }
    return map;
  }, [actions]);

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await completeWorkOrder(wo.wo_id, {
        found_issue_id: Number(form.found_issue_id),
        action_code_ids: form.action_code_ids.map(Number),
        notes: form.notes.trim(),
        outcome: form.outcome,
        time_spent_minutes: form.time_spent_minutes ? Number(form.time_spent_minutes) : null,
      }, { 'Idempotency-Key': newIdempotencyKey() });
      toast.success('Job completed');
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not complete job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Complete job"
      subtitle="Record what you found and what you did, then close this work order."
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={saving} onClick={submit}>Complete</Button>
        </>
      )}
    >
      <div className="space-y-4 text-[12px]">
        <p className="text-sup-muted">
          This is the job close-out. Pick the issue you actually found, the actions you took,
          the outcome, and a short note (at least 20 characters).
        </p>
        <div>
          <div className="font-semibold mb-1">Issue found on site</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={form.type_id || ''}
              onChange={(e) => setForm((f) => ({ ...f, type_id: Number(e.target.value), subtype_id: '', found_issue_id: '' }))}
              className="border rounded px-2 py-1.5"
            >
              <option value="">Type *</option>
              {types.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
            </select>
            <select
              value={form.subtype_id || ''}
              onChange={(e) => setForm((f) => ({ ...f, subtype_id: Number(e.target.value), found_issue_id: '' }))}
              className="border rounded px-2 py-1.5"
              disabled={!form.type_id}
            >
              <option value="">Subtype *</option>
              {subtypes.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
            </select>
            <select
              value={form.found_issue_id || ''}
              onChange={(e) => setForm((f) => ({ ...f, found_issue_id: Number(e.target.value) }))}
              className="border rounded px-2 py-1.5"
              disabled={!form.subtype_id}
            >
              <option value="">Issue *</option>
              {issues.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="font-semibold mb-1">Action taken *</div>
          {Object.entries(grouped).map(([g, rows]) => (
            <div key={g} className="mb-2">
              <div className="text-sup-muted text-[11px] mb-1">{g}</div>
              <div className="flex flex-wrap gap-1">
                {rows.map((a) => {
                  const on = form.action_code_ids.includes(a.action_id);
                  return (
                    <button
                      key={a.action_id}
                      type="button"
                      onClick={() => setForm((f) => ({
                        ...f,
                        action_code_ids: on
                          ? f.action_code_ids.filter((x) => x !== a.action_id)
                          : [...f.action_code_ids, a.action_id],
                      }))}
                      className={`px-2 py-1 rounded border text-[11px] ${on ? 'bg-sup-accentSoft border-sup-accent text-sup-accent' : 'border-sup-line'}`}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!actions.length && <p className="text-sup-muted">Loading action codes…</p>}
        </div>
        <label className="block">
          Outcome *
          <select
            value={form.outcome}
            onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}
            className="mt-1 w-full border rounded px-2 py-1.5"
          >
            <option value="RESOLVED">Resolved — issue fixed</option>
            <option value="PARTIAL">Partial — work done, follow-up needed</option>
            <option value="NOT_RESOLVED">Not resolved — could not fix on this visit</option>
          </select>
        </label>
        <label className="block">
          Notes *
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            placeholder="What you did, what the customer confirmed, and anything left open."
            className="mt-1 w-full border rounded px-2 py-1.5"
          />
          <div className="text-sup-muted text-right">{notesLen} / minimum 20</div>
        </label>
        <label className="block">
          Time spent (minutes)
          <input
            type="number"
            min="1"
            value={form.time_spent_minutes}
            onChange={(e) => setForm((f) => ({ ...f, time_spent_minutes: e.target.value }))}
            className="mt-1 w-32 border rounded px-2 py-1.5"
          />
        </label>
      </div>
    </Modal>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Modal } from '../../../components/ui/supportPrimitives';
import {
  fetchActionCodes, fetchResolutionCodes, fetchRootCauses, fetchTaxonomyTree,
  resolveLine, uploadAttachments,
} from '../supportV2Api';

function childrenOf(tree, parentId) {
  if (!parentId) return tree || [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.catalog_id === parentId) return n.children || [];
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree) || [];
}

export default function ResolveLineModal({ line, ticketId, canCharge, onClose, onSaved }) {
  const [tree, setTree] = useState([]);
  const [resolutions, setResolutions] = useState([]);
  const [causes, setCauses] = useState([]);
  const [actions, setActions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type_id: line.found_type_id || line.reported_type_id,
    subtype_id: line.found_subtype_id || line.reported_subtype_id,
    found_issue_id: line.found_issue_id || line.reported_issue_id,
    resolution_code_id: line.resolution_code_id || '',
    root_cause_id: line.root_cause_id || '',
    liability: line.liability || '',
    chargeable_amount: line.chargeable_amount || '',
    action_code_ids: [],
    resolution_notes: line.resolution_notes || '',
    time_spent_minutes: line.time_spent_minutes || '',
    photo_count: 0,
  });

  useEffect(() => {
    fetchTaxonomyTree().then((r) => setTree(r.data?.tree || [])).catch(() => {});
    fetchResolutionCodes().then((r) => setResolutions(r.data?.rows || [])).catch(() => {});
    fetchRootCauses().then((r) => setCauses(r.data?.rows || [])).catch(() => {});
    fetchActionCodes().then((r) => setActions(r.data?.rows || [])).catch(() => {});
  }, []);

  const types = tree;
  const subtypes = childrenOf(tree, form.type_id);
  const issues = childrenOf(tree, form.subtype_id);
  const reclass = Number(form.found_issue_id) && Number(form.found_issue_id) !== Number(line.reported_issue_id);
  const grouped = useMemo(() => {
    const map = {};
    for (const a of actions) {
      const g = a.group_name || 'Other';
      if (!map[g]) map[g] = [];
      map[g].push(a);
    }
    return map;
  }, [actions]);

  const notesLen = String(form.resolution_notes || '').trim().length;
  const chargeOk = form.liability !== 'CUSTOMER_CHARGEABLE'
    || (canCharge && Number(form.chargeable_amount) > 0 && form.photo_count > 0);
  const valid = form.found_issue_id && form.resolution_code_id && form.root_cause_id
    && form.liability && form.action_code_ids.length && notesLen >= 20 && chargeOk;

  const setCause = (id) => {
    const c = causes.find((x) => x.cause_id === Number(id));
    setForm((f) => ({
      ...f,
      root_cause_id: id,
      liability: c?.default_liability || f.liability,
    }));
  };

  const attach = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    try {
      await uploadAttachments(ticketId, files, { kind: 'PHOTO_EVIDENCE', line_id: line.line_id });
      setForm((f) => ({ ...f, photo_count: f.photo_count + files.length }));
      toast.success('Photo attached');
    } catch {
      toast.error('Upload failed');
    }
  };

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await resolveLine(line.line_id, {
        found_issue_id: Number(form.found_issue_id),
        resolution_code_id: Number(form.resolution_code_id),
        root_cause_id: Number(form.root_cause_id),
        liability: form.liability,
        chargeable_amount: form.liability === 'CUSTOMER_CHARGEABLE' ? Number(form.chargeable_amount) : null,
        action_code_ids: form.action_code_ids.map(Number),
        resolution_notes: form.resolution_notes,
        time_spent_minutes: form.time_spent_minutes ? Number(form.time_spent_minutes) : null,
      });
      toast.success(`Resolved ${line.line_code}`);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Resolve failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Resolve ${line.line_code}`}
      subtitle={line.ttspl_id || 'Unknown asset'}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={saving} onClick={submit}>Resolve machine</Button>
        </>
      )}
    >
      <div className="space-y-4 text-[12px]">
        <div>
          <div className="font-semibold mb-1">What was actually wrong</div>
          <div className="grid grid-cols-3 gap-2">
            <select value={form.type_id || ''} onChange={(e) => setForm((f) => ({ ...f, type_id: Number(e.target.value), subtype_id: '', found_issue_id: '' }))} className="border rounded px-2 py-1.5">
              {types.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
            </select>
            <select value={form.subtype_id || ''} onChange={(e) => setForm((f) => ({ ...f, subtype_id: Number(e.target.value), found_issue_id: '' }))} className="border rounded px-2 py-1.5">
              {subtypes.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
            </select>
            <select value={form.found_issue_id || ''} onChange={(e) => setForm((f) => ({ ...f, found_issue_id: Number(e.target.value) }))} className="border rounded px-2 py-1.5">
              {issues.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
            </select>
          </div>
          {reclass && (
            <p className="mt-2 rounded-md bg-sup-canvas2 px-2 py-1.5 text-[11.5px]">
              Different from what was reported ({line.reported_issue_name}). This is recorded as a
              reclassification and feeds the accuracy report — it is not an error.
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select value={form.resolution_code_id} onChange={(e) => setForm((f) => ({ ...f, resolution_code_id: e.target.value }))} className="border rounded px-2 py-1.5">
            <option value="">Resolution *</option>
            {resolutions.map((r) => <option key={r.code_id} value={r.code_id}>{r.name}</option>)}
          </select>
          <select value={form.root_cause_id} onChange={(e) => setCause(e.target.value)} className="border rounded px-2 py-1.5">
            <option value="">Root cause *</option>
            {causes.map((r) => <option key={r.cause_id} value={r.cause_id}>{r.name}</option>)}
          </select>
          <select value={form.liability} onChange={(e) => setForm((f) => ({ ...f, liability: e.target.value }))} className="border rounded px-2 py-1.5">
            <option value="">Liability *</option>
            {['COMPANY', 'CUSTOMER_CHARGEABLE', 'VENDOR_WARRANTY', 'INSURANCE', 'NONE'].map((v) => (
              <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        {form.liability === 'CUSTOMER_CHARGEABLE' && canCharge && (
          <div className="rounded-md bg-pri2-bg p-2 space-y-2">
            <input
              type="number"
              min="1"
              placeholder="Amount *"
              value={form.chargeable_amount}
              onChange={(e) => setForm((f) => ({ ...f, chargeable_amount: e.target.value }))}
              className="w-full border rounded px-2 py-1.5"
            />
            <label className="text-sup-accent underline cursor-pointer">
              ＋ Evidence photos
              <input type="file" accept="image/*" multiple className="hidden" onChange={attach} />
            </label>
            <p>A customer-side approval will be raised. {form.photo_count} photo(s).</p>
          </div>
        )}
        {form.liability === 'CUSTOMER_CHARGEABLE' && !canCharge && (
          <p className="text-pri1">You do not have support_charges permission.</p>
        )}
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
        </div>
        <label className="block">
          Notes *
          <textarea
            value={form.resolution_notes}
            onChange={(e) => setForm((f) => ({ ...f, resolution_notes: e.target.value }))}
            rows={3}
            className="mt-1 w-full border rounded px-2 py-1.5"
          />
          <div className="text-sup-muted text-right">{notesLen} / minimum 20</div>
        </label>
        <div className="text-sup-muted">Parts consumed — none on this line yet (work orders land in Phase 5).</div>
        <label className="block">
          Time spent (minutes)
          <input
            type="number"
            value={form.time_spent_minutes}
            onChange={(e) => setForm((f) => ({ ...f, time_spent_minutes: e.target.value }))}
            className="mt-1 w-32 border rounded px-2 py-1.5"
          />
        </label>
      </div>
    </Modal>
  );
}

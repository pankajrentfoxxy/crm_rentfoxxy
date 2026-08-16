import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PriorityChip } from '../../../../components/ui/supportPrimitives';
import { repeatCheck, searchTaxonomy, uploadAttachments } from '../../supportV2Api';
import { classifyLineErrors, computePriority, SUPPORT_V2_BASE, woTypeLabel } from '../../supportV2Utils';

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

function LineCard({
  line, index, tree, supportTier, contactIsVip, fleetSize, sameIssue, onChange, onCopy,
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const errors = classifyLineErrors(line);
  const types = tree || [];
  const subtypes = childrenOf(tree, line.type_id);
  const issues = childrenOf(tree, line.subtype_id);
  const pri = computePriority({
    impact: Number(line.impact) || 2,
    urgency: Number(line.urgency) || 2,
    supportTier,
    isSafety: Boolean(line.is_safety),
    isRepeat: Boolean(line.repeat),
    contactIsVip,
    isSlaComplaint: line.type_code === 'SVC' && line.subtype_code === 'SVC-SLA',
    fleetSize,
    affectedUnits: 1,
  });

  useEffect(() => {
    if (!q.trim()) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      searchTaxonomy(q.trim()).then((r) => setHits(r.data?.rows || [])).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!line.serial_id || !line.subtype_id) return undefined;
    const t = setTimeout(() => {
      repeatCheck({ serial_id: line.serial_id, subtype_id: line.subtype_id })
        .then((r) => onChange({ repeat: r.data?.repeat || null }))
        .catch(() => onChange({ repeat: null }));
    }, 300);
    return () => clearTimeout(t);
  }, [line.serial_id, line.subtype_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyIssue = (issue, type, subtype) => {
    onChange({
      reported_issue_id: issue.catalog_id,
      type_id: type.catalog_id,
      subtype_id: subtype.catalog_id,
      type_code: type.code,
      subtype_code: subtype.code,
      type_name: type.name,
      subtype_name: subtype.name,
      issue_name: issue.name,
      impact: issue.default_impact || line.impact || 2,
      urgency: issue.default_urgency || line.urgency || 2,
      is_safety: Boolean(issue.is_safety),
      chargeable_default: Boolean(issue.chargeable_default),
      requires_photo: Boolean(issue.requires_photo),
      default_wo_type: issue.default_wo_type,
      kb_article_id: issue.kb_article_id,
      skill_required: issue.skill_required,
    });
    setQ('');
    setHits([]);
  };

  const pickSearch = (row) => applyIssue(row, row.type, row.subtype);

  const onType = (id) => {
    const node = types.find((t) => t.catalog_id === Number(id));
    onChange({
      type_id: node ? node.catalog_id : null,
      type_code: node?.code,
      type_name: node?.name,
      subtype_id: null,
      reported_issue_id: null,
      subtype_code: null,
      issue_name: null,
    });
  };
  const onSubtype = (id) => {
    const node = subtypes.find((t) => t.catalog_id === Number(id));
    onChange({
      subtype_id: node ? node.catalog_id : null,
      subtype_code: node?.code,
      subtype_name: node?.name,
      reported_issue_id: null,
      issue_name: null,
    });
  };
  const onIssue = (id) => {
    const node = issues.find((t) => t.catalog_id === Number(id));
    if (!node) return;
    const type = types.find((t) => t.catalog_id === line.type_id) || { catalog_id: line.type_id, code: line.type_code, name: line.type_name };
    const subtype = subtypes.find((t) => t.catalog_id === line.subtype_id) || { catalog_id: line.subtype_id, code: line.subtype_code, name: line.subtype_name };
    applyIssue(node, type, subtype);
  };

  const attach = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    try {
      const r = await uploadAttachments(null, files, { kind: 'PHOTO_CUSTOMER' });
      const ids = (r.data?.rows || []).map((x) => x.attachment_id);
      onChange({ attachment_ids: [...(line.attachment_ids || []), ...ids] });
    } catch {
      /* toast at page */
    }
  };

  return (
    <div className={`rounded-xl border bg-white p-3 space-y-2 ${errors.length ? 'border-pri1' : 'border-sup-lineSoft'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold">
          [{line.line_code}] {line.ttspl_id || 'Unknown'} · {line.model || '—'}
        </div>
        <div className="flex items-center gap-2">
          {line.is_safety ? <span className="text-[11px] text-pri1 font-semibold">Safety — forced P1</span> : null}
          <PriorityChip priority={pri.priority} showLabel />
        </div>
      </div>
      {index === 0 && (
        <label className="text-[12px] flex items-center gap-1.5">
          <input type="checkbox" checked={sameIssue} onChange={(e) => onCopy(e.target.checked)} />
          Same issue for all machines
        </label>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search catalogue — e.g. cracked"
        className="w-full rounded-md border border-sup-line px-2 py-1.5 text-[12px]"
      />
      {hits.length > 0 && (
        <ul className="border rounded-md max-h-32 overflow-auto text-[12px]">
          {hits.map((h) => (
            <li key={h.catalog_id}>
              <button type="button" className="w-full text-left px-2 py-1 hover:bg-sup-canvas2" onClick={() => pickSearch(h)}>
                {h.type?.name} › {h.subtype?.name} › {h.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-3 gap-2">
        <select value={line.type_id || ''} onChange={(e) => onType(e.target.value)} className="rounded-md border border-sup-line px-2 py-1.5 text-[12px]">
          <option value="">Type *</option>
          {types.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
        </select>
        <select value={line.subtype_id || ''} onChange={(e) => onSubtype(e.target.value)} className="rounded-md border border-sup-line px-2 py-1.5 text-[12px]">
          <option value="">Subtype *</option>
          {subtypes.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
        </select>
        <select value={line.reported_issue_id || ''} onChange={(e) => onIssue(e.target.value)} className="rounded-md border border-sup-line px-2 py-1.5 text-[12px]">
          <option value="">Issue type *</option>
          {issues.map((t) => <option key={t.catalog_id} value={t.catalog_id}>{t.name}</option>)}
        </select>
      </div>
      <textarea
        value={line.reported_description || ''}
        onChange={(e) => onChange({ reported_description: e.target.value })}
        placeholder="What the customer described * (min 15 characters)"
        rows={2}
        className="w-full rounded-md border border-sup-line px-2 py-1.5 text-[12px]"
      />
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <label>Impact
          <select value={line.impact || 2} onChange={(e) => onChange({ impact: Number(e.target.value) })} className="ml-1 border rounded px-1 py-0.5">
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </label>
        <label>Urgency
          <select value={line.urgency || 2} onChange={(e) => onChange({ urgency: Number(e.target.value) })} className="ml-1 border rounded px-1 py-0.5">
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </label>
        <label className="text-sup-accent underline cursor-pointer">
          ＋ Attach
          <input type="file" multiple className="hidden" onChange={attach} />
        </label>
        {(line.attachment_ids || []).length ? <span>{line.attachment_ids.length} file(s)</span> : null}
      </div>
      {line.chargeable_default && (
        <div className="rounded-md bg-pri2-bg text-pri2 px-2 py-1.5 text-[11.5px]">
          This issue type is usually chargeable. Photos are mandatory before a charge can be raised.
        </div>
      )}
      {(line.default_wo_type || line.kb_article_id) && (
        <div className="rounded-md bg-sup-canvas2 px-2 py-1.5 text-[11.5px]">
          Suggested next step: {woTypeLabel(line.default_wo_type) || 'Triage'}
          {line.kb_article_id ? ` · ${line.kb_article_id}` : ''}
        </div>
      )}
      {line.repeat && (
        <div className="rounded-md bg-pri1-bg text-pri1 px-2 py-1.5 text-[11.5px]">
          Repeat of{' '}
          <Link className="underline" to={`${SUPPORT_V2_BASE}/tickets/${line.repeat.ticket_id}`}>
            {line.repeat.ticket_number}
          </Link>
          {' '}within 30 days
        </div>
      )}
    </div>
  );
}

export default function StepClassify({ state, setState, tree, supportTier, fleetSize }) {
  const lines = state.lines || [];
  const patch = (i, patchObj) => {
    setState((s) => {
      const next = s.lines.map((l, idx) => (idx === i ? { ...l, ...patchObj } : l));
      if (s.sameIssue && i === 0) {
        const src = next[0];
        return {
          ...s,
          lines: next.map((l, idx) => (idx === 0 ? l : {
            ...l,
            reported_issue_id: src.reported_issue_id,
            type_id: src.type_id,
            subtype_id: src.subtype_id,
            type_code: src.type_code,
            subtype_code: src.subtype_code,
            type_name: src.type_name,
            subtype_name: src.subtype_name,
            issue_name: src.issue_name,
            reported_description: src.reported_description,
            impact: src.impact,
            urgency: src.urgency,
            is_safety: src.is_safety,
            chargeable_default: src.chargeable_default,
            requires_photo: src.requires_photo,
            default_wo_type: src.default_wo_type,
            kb_article_id: src.kb_article_id,
            skill_required: src.skill_required,
          })),
        };
      }
      return { ...s, lines: next };
    });
  };

  return (
    <div className="space-y-3">
      {lines.map((line, i) => (
        <LineCard
          key={line.serial_id || line.line_code}
          line={line}
          index={i}
          tree={tree}
          supportTier={supportTier}
          contactIsVip={state.contact_is_vip}
          fleetSize={fleetSize}
          sameIssue={state.sameIssue}
          onChange={(p) => patch(i, p)}
          onCopy={(on) => {
            setState((s) => ({ ...s, sameIssue: on }));
            if (on) patch(0, {});
          }}
        />
      ))}
    </div>
  );
}

export function classifyStepValid(state) {
  return (state.lines || []).length > 0 && (state.lines || []).every((l) => classifyLineErrors(l).length === 0);
}

export function previewTicketPriority(state, supportTier, fleetSize) {
  const pris = (state.lines || []).map((l) => computePriority({
    impact: Number(l.impact) || 2,
    urgency: Number(l.urgency) || 2,
    supportTier,
    isSafety: Boolean(l.is_safety),
    isRepeat: Boolean(l.repeat),
    contactIsVip: state.contact_is_vip,
    isSlaComplaint: l.type_code === 'SVC' && l.subtype_code === 'SVC-SLA',
    fleetSize,
    affectedUnits: (state.lines || []).length,
  }));
  if (!pris.length) return { priority: 4, reasons: [] };
  const best = Math.min(...pris.map((p) => p.priority));
  const reasons = pris.flatMap((p) => p.reasons);
  reasons.unshift(`Highest of ${pris.length} line(s) → P${best}`);
  return { priority: best, reasons };
}

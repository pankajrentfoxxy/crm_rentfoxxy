import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { Badge, Button, Modal, PageHeader, TypeTag } from '../../../components/ui/supportPrimitives';
import usePermission from '../../../hooks/usePermission';
import {
  createCatalogNode,
  deleteCatalogNode,
  fetchCatalogStats,
  fetchTaxonomyTree,
  patchCatalogNode,
} from '../supportV2Api';

const WO_TYPES = [
  'FIELD_VISIT', 'REPAIR_PICKUP', 'RETURN_PICKUP', 'SERVICE_RETURN',
  'REPLACEMENT_DELIVERY', 'PART_DELIVERY', 'PART_RETURN', 'REMOTE_FIX',
];

function matchesQuery(node, q) {
  if (!q) return true;
  const hay = `${node.code} ${node.name}`.toLowerCase();
  if (hay.includes(q)) return true;
  return (node.children || []).some((c) => matchesQuery(c, q));
}

function countIssues(node) {
  if (node.level === 3) return 1;
  return (node.children || []).reduce((n, c) => n + countIssues(c), 0);
}

export default function TaxonomyAdminPage() {
  const { canEdit } = usePermission();
  const editable = canEdit('support_taxonomy');
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTaxonomyTree();
      setTree(res.data?.tree || []);
    } catch {
      toast.error('Failed to load taxonomy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected || selected.level !== 3) { setStats(null); return undefined; }
    fetchCatalogStats(selected.catalog_id)
      .then((r) => setStats(r.data?.stats || null))
      .catch(() => setStats(null));
    return undefined;
  }, [selected]);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () => tree.filter((n) => matchesQuery(n, query)),
    [tree, query]
  );

  useEffect(() => {
    if (!query) return;
    const next = {};
    const walk = (nodes) => {
      nodes.forEach((n) => {
        if ((n.children || []).some((c) => matchesQuery(c, query))) next[n.catalog_id] = true;
        walk(n.children || []);
      });
    };
    walk(tree);
    setOpen((prev) => ({ ...prev, ...next }));
  }, [query, tree]);

  const toggle = (id) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  const save = async (patch) => {
    if (!selected || !editable) return;
    try {
      const res = await patchCatalogNode(selected.catalog_id, patch);
      setSelected(res.data.row);
      toast.success('Saved');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Save failed');
    }
  };

  const softDelete = async () => {
    if (!selected || !editable) return;
    try {
      await deleteCatalogNode(selected.catalog_id);
      toast.success('Deactivated');
      setSelected(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="text-[9.5px] uppercase tracking-[0.11em] text-sup-faint font-semibold">Screen S18</div>
      <PageHeader
        title="Issue taxonomy"
        subtitle="Type › subtype › issue. Every ticket line must land on a level-3 row."
        actions={(
          <PermissionGate section="support_taxonomy" action="create">
            <Button size="sm" icon={Plus} onClick={() => setAddOpen(true)}>Add issue type</Button>
          </PermissionGate>
        )}
      />

      <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <div className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup min-h-[560px]">
          <div className="p-3 border-b border-sup-lineSoft">
            <label className="flex items-center gap-2 h-9 px-2.5 rounded-lg border border-sup-line bg-sup-canvas">
              <Search className="w-3.5 h-3.5 text-sup-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter the tree…"
                className="flex-1 bg-transparent text-[12.5px] text-sup-ink outline-none"
              />
            </label>
          </div>
          <div className="p-2 max-h-[70vh] overflow-y-auto">
            {loading ? <div className="p-6 text-[12px] text-sup-muted">Loading…</div> : null}
            {filtered.map((n1) => (
              <div key={n1.catalog_id} className="mb-1">
                <button
                  type="button"
                  onClick={() => { toggle(n1.catalog_id); setSelected(n1); }}
                  className="w-full flex items-center gap-2 bg-sup-canvas rounded-md px-2.5 py-1.5 font-semibold text-[12.5px] text-sup-ink"
                >
                  {open[n1.catalog_id] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span className="flex-1 text-left">{n1.name}</span>
                  <TypeTag type={n1.code} />
                </button>
                {open[n1.catalog_id] ? (n1.children || []).filter((n2) => matchesQuery(n2, query)).map((n2) => (
                  <div key={n2.catalog_id}>
                    <button
                      type="button"
                      onClick={() => { toggle(n2.catalog_id); setSelected(n2); }}
                      className="w-full flex items-center gap-2 pl-[30px] pr-2 py-1.5 border-b border-sup-lineSoft text-[12px] text-sup-ink2"
                    >
                      {open[n2.catalog_id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      <span className="font-mono text-[10.5px] text-sup-muted">{n2.code}</span>
                      <span className="flex-1 text-left">{n2.name}</span>
                      {n2.skill_required ? <Badge tone="gray">{n2.skill_required}</Badge> : null}
                      <span className="font-mono text-[10.5px] text-sup-faint">{countIssues(n2)}</span>
                    </button>
                    {open[n2.catalog_id] ? (n2.children || []).filter((n3) => matchesQuery(n3, query)).map((n3) => {
                      const on = selected?.catalog_id === n3.catalog_id;
                      return (
                        <button
                          key={n3.catalog_id}
                          type="button"
                          onClick={() => setSelected(n3)}
                          className={`w-full flex items-center gap-2 pl-[52px] pr-2 py-1 text-[11.5px] text-left
                            ${on ? 'bg-sup-accentSoft text-sup-accent font-semibold' : 'text-sup-muted hover:bg-sup-canvas'}`}
                        >
                          <span className="font-mono text-[10.5px]">{n3.code}</span>
                          <span className="flex-1">{n3.name}</span>
                          {n3.chargeable_default ? <Badge tone="amber">Chargeable by default</Badge> : null}
                          {n3.is_safety ? <Badge tone="red">Safety</Badge> : null}
                        </button>
                      );
                    }) : null}
                  </div>
                )) : null}
              </div>
            ))}
          </div>
        </div>

        <DetailPanel
          selected={selected}
          stats={stats}
          editable={editable}
          onSave={save}
          onDelete={softDelete}
        />
      </div>

      <AddIssueModal
        open={addOpen}
        tree={tree}
        onClose={() => setAddOpen(false)}
        onCreated={() => { setAddOpen(false); load(); }}
      />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide text-sup-faint font-semibold mb-1">{label}</div>
      {children}
    </label>
  );
}

function Toggle({ label, checked, disabled, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12.5px] text-sup-ink2">{label}</span>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function DetailPanel({ selected, stats, editable, onSave, onDelete }) {
  if (!selected) {
    return (
      <div className="bg-white rounded-[10px] border border-dashed border-sup-line p-8 text-center text-[12px] text-sup-muted">
        Select a node in the tree.
      </div>
    );
  }
  const disabled = !editable;
  return (
    <div className="bg-white rounded-[10px] border border-sup-lineSoft shadow-sup p-4 space-y-4">
      <div>
        <div className="font-mono text-[11px] text-sup-muted">{selected.code}</div>
        <h2 className="text-[16px] font-bold text-sup-ink tracking-tight">{selected.name}</h2>
        <div className="text-[11px] text-sup-faint">Level {selected.level}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Impact">
          <select
            disabled={disabled}
            value={selected.default_impact || ''}
            onChange={(e) => onSave({ default_impact: Number(e.target.value) || null })}
            className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px]"
          >
            <option value="">—</option>
            <option value="1">1 · High</option>
            <option value="2">2 · Medium</option>
            <option value="3">3 · Low</option>
          </select>
        </Field>
        <Field label="Urgency">
          <select
            disabled={disabled}
            value={selected.default_urgency || ''}
            onChange={(e) => onSave({ default_urgency: Number(e.target.value) || null })}
            className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px]"
          >
            <option value="">—</option>
            <option value="1">1 · High</option>
            <option value="2">2 · Medium</option>
            <option value="3">3 · Low</option>
          </select>
        </Field>
        <Field label="Default work order">
          <select
            disabled={disabled}
            value={selected.default_wo_type || ''}
            onChange={(e) => onSave({ default_wo_type: e.target.value || null })}
            className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px]"
          >
            <option value="">—</option>
            {WO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Skill required">
          <input
            disabled={disabled}
            defaultValue={selected.skill_required || ''}
            key={`${selected.catalog_id}-skill`}
            onBlur={(e) => onSave({ skill_required: e.target.value || null })}
            className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px]"
          />
        </Field>
        <Field label="Linked KB article">
          <input
            disabled={disabled}
            defaultValue={selected.kb_article_id || ''}
            key={`${selected.catalog_id}-kb`}
            onBlur={(e) => onSave({ kb_article_id: e.target.value ? Number(e.target.value) : null })}
            className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px] font-mono"
          />
        </Field>
      </div>
      <div className="border-t border-sup-lineSoft pt-2">
        <Toggle label="Chargeable by default" checked={selected.chargeable_default} disabled={disabled} onChange={(v) => onSave({ chargeable_default: v })} />
        <Toggle label="Photos mandatory" checked={selected.requires_photo} disabled={disabled} onChange={(v) => onSave({ requires_photo: v })} />
        <Toggle label="Safety issue" checked={selected.is_safety} disabled={disabled} onChange={(v) => onSave({ is_safety: v })} />
        <Toggle label="Active" checked={selected.active} disabled={disabled} onChange={(v) => onSave({ active: v })} />
      </div>
      {selected.level === 3 ? (
        <div className="border-t border-sup-lineSoft pt-3">
          <div className="text-[10px] uppercase tracking-wide text-sup-faint font-semibold mb-2">Last 90 days</div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div>Reported <span className="font-mono font-semibold">{stats?.reported_90d ?? 0}</span></div>
            <div>Confirmed <span className="font-mono font-semibold">{stats?.confirmed_pct ?? 0}%</span></div>
            <div>Avg resolution <span className="font-mono font-semibold">{stats?.avg_resolution_hours ?? 0}h</span></div>
            <div>Recovered <span className="font-mono font-semibold">₹{stats?.amount_recovered ?? 0}</span></div>
          </div>
        </div>
      ) : null}
      {editable && selected.level === 3 ? (
        <button type="button" onClick={onDelete} className="text-[12px] text-pri1 font-semibold">
          Soft-delete (hide from pick-lists)
        </button>
      ) : null}
    </div>
  );
}

function AddIssueModal({ open, tree, onClose, onCreated }) {
  const [parentId, setParentId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const subtypes = tree.flatMap((t) => t.children || []);

  const submit = async () => {
    const parent = subtypes.find((s) => String(s.catalog_id) === String(parentId));
    if (!parent || !code || !name) { toast.error('Parent, code and name are required'); return; }
    try {
      await createCatalogNode({
        parent_id: parent.catalog_id,
        level: 3,
        code,
        name,
        applies_to_class: parent.applies_to_class,
        default_wo_type: parent.default_wo_type,
        skill_required: parent.skill_required,
      });
      toast.success('Issue type added');
      onCreated();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Create failed');
    }
  };

  return (
    <Modal open={open} title="Add issue type" subtitle="Creates a level-3 row under a subtype" onClose={onClose} size="md"
      footer={(
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit}>Create</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Field label="Subtype">
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px]">
            <option value="">Select…</option>
            {subtypes.map((s) => <option key={s.catalog_id} value={s.catalog_id}>{s.code} · {s.name}</option>)}
          </select>
        </Field>
        <Field label="Code">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HW-DIS-XYZ" className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px] font-mono" />
        </Field>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 rounded-lg border border-sup-line px-2 text-[12px]" />
        </Field>
      </div>
    </Modal>
  );
}

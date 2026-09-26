import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, EmptyState, Field, FormGrid, Input, Notice, Section,
} from '../../../components/carret';
import {
  addIssueEntry, fetchIssueCatalogAdmin, fetchSupportSettings, saveSupportSettings, updateIssueEntry,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Serve → Support settings (claude/carret-support.md rework E).
 *
 * The issue list every new ticket uses (Type › Subtype › Issue): add a subtype
 * or an issue, rename, or switch one off. Nothing is deleted — tickets that
 * used a retired entry keep its name. Plus the two ticket rules. Admin and the
 * support lead can change these; everyone else sees them.
 */
export default function SettingsPage() {
  const [cat, setCat] = useState(null);
  const [rules, setRules] = useState(null);
  const [openType, setOpenType] = useState(null);
  const [draft, setDraft] = useState({}); // parent_id -> new name
  const [rename, setRename] = useState(null); // { id, name }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchIssueCatalogAdmin().then(({ data }) => setCat(data)).catch((e) => { toast.error(errMsg(e)); setCat({ types: [] }); });
  }, []);
  useEffect(() => {
    load();
    fetchSupportSettings().then(({ data }) => setRules(data.settings || {})).catch(() => setRules({}));
  }, [load]);

  const canEdit = Boolean(cat?.can_edit);
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.data?.message || ok); load(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(false); }
  };
  const add = async (parentId) => {
    const name = String(draft[parentId] || '').trim();
    if (name.length < 2) { toast.error('Type a name'); return; }
    if (await run(() => addIssueEntry({ parent_id: parentId, name }), 'Added')) setDraft({ ...draft, [parentId]: '' });
  };
  const toggle = (e) => run(() => updateIssueEntry(e.id, { active: !e.active }), e.active ? 'Switched off — no longer offered' : 'Switched on');
  const saveName = async () => {
    if (await run(() => updateIssueEntry(rename.id, { name: rename.name }), 'Renamed')) setRename(null);
  };

  const entry = (e, strong = false) => (
    <div key={e.id} className="flex items-center" style={{ gap: '8px', padding: '4px 0', opacity: e.active ? 1 : 0.5 }}>
      {rename?.id === e.id ? (
        <>
          <Input value={rename.name} onChange={(ev) => setRename({ ...rename, name: ev.target.value })} onKeyDown={(ev) => ev.key === 'Enter' && saveName()} style={{ maxWidth: '20rem' }} autoFocus />
          <Button disabled={busy} onClick={saveName}>Save</Button>
          <Button variant="quiet" onClick={() => setRename(null)}>Cancel</Button>
        </>
      ) : (
        <>
          <span style={{ fontWeight: strong ? 600 : 400 }}>{e.name}</span>
          {!e.active && <span className="text-ink-3">(off)</span>}
          {canEdit && (
            <span className="flex" style={{ gap: '4px', marginLeft: 'auto' }}>
              <Button variant="quiet" onClick={() => setRename({ id: e.id, name: e.name })}>Rename</Button>
              <Button variant="quiet" disabled={busy} onClick={() => toggle(e)}>{e.active ? 'Switch off' : 'Switch on'}</Button>
            </span>
          )}
        </>
      )}
    </div>
  );

  const addRow = (parentId, label) => canEdit && (
    <div className="flex" style={{ gap: '8px', marginTop: '6px' }}>
      <Input value={draft[parentId] || ''} onChange={(e) => setDraft({ ...draft, [parentId]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add(parentId)} placeholder={label} style={{ maxWidth: '20rem' }} />
      <Button disabled={busy} onClick={() => add(parentId)}>Add</Button>
    </div>
  );

  return (
    <DeskShell title="Support settings" breadcrumb="Serve" subtitle="The issue list every new ticket uses, and the ticket rules.">
      <div className="c-stack">
        {cat && !canEdit && <Notice tone="info">Only admin or the support lead can change these.</Notice>}
        <Section title="Issue list — Type › Subtype › Issue">
          <p className="text-ink-3" style={{ marginBottom: '8px' }}>
            Switching an entry off stops it being offered on new tickets; tickets that used it keep the name. Customers pick the type and subtype on the QR page and portal.
          </p>
          {cat === null ? <EmptyState title="Loading…" /> : cat.types.map((t) => (
            <div key={t.id} className="c-card" style={{ padding: '10px 14px', marginBottom: '8px' }}>
              <div className="flex items-center" style={{ gap: '8px' }}>
                <button type="button" className="c-btn" onClick={() => setOpenType(openType === t.id ? null : t.id)} aria-expanded={openType === t.id}>
                  {openType === t.id ? '▾' : '▸'}
                </button>
                <div style={{ flex: 1 }}>{entry(t, true)}</div>
                <span className="text-ink-3">{t.subtypes.length} subtypes · {t.subtypes.reduce((n, s) => n + s.issues.length, 0)} issues</span>
              </div>
              {openType === t.id && (
                <div style={{ paddingLeft: '32px', marginTop: '8px' }}>
                  {t.subtypes.map((s) => (
                    <div key={s.id} style={{ borderLeft: '2px solid var(--line, #e2e8f0)', paddingLeft: '12px', marginBottom: '12px' }}>
                      {entry(s, true)}
                      <div style={{ paddingLeft: '16px' }}>
                        {s.issues.map((i) => entry(i))}
                        {addRow(s.id, `New issue under ${s.name}`)}
                      </div>
                    </div>
                  ))}
                  {addRow(t.id, `New subtype under ${t.name}`)}
                </div>
              )}
            </div>
          ))}
        </Section>

        <Section title="Ticket rules">
          {rules === null ? <EmptyState title="Loading…" /> : (
            <>
              <FormGrid cols={2}>
                <Field label="Close tickets automatically when every laptop is done">
                  <Checkbox label="Auto-close" checked={Boolean(rules.auto_close_enabled)} disabled={!canEdit} onChange={(e) => setRules({ ...rules, auto_close_enabled: e.target.checked })} />
                </Field>
                <Field label="Flag a ticket as overdue after (hours)">
                  <Input type="number" min="1" value={rules.overdue_threshold_hours ?? 48} disabled={!canEdit} onChange={(e) => setRules({ ...rules, overdue_threshold_hours: e.target.value })} />
                </Field>
              </FormGrid>
              {canEdit && (
                <div className="flex justify-end" style={{ marginTop: '12px' }}>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => run(() => saveSupportSettings({ auto_close_enabled: Boolean(rules.auto_close_enabled), overdue_threshold_hours: Math.max(1, Number(rules.overdue_threshold_hours) || 48) }), 'Saved')}
                  >
                    Save rules
                  </Button>
                </div>
              )}
              <p className="text-ink-3" style={{ marginTop: '8px' }}>SLA targets (visit and resolve by priority) are fixed in the SLA board; technicians are added in Users / Teams with the support technician role.</p>
            </>
          )}
        </Section>
      </div>
    </DeskShell>
  );
}

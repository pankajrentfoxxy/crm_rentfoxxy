import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, DataTable, DocNumber, Drawer, Notice, Section } from '../../../components/carret';
import {
  FindingFields, IssuePicker, emptyFinding, emptyIssue, findingBody, findingError, issueComplete, issueLabel, useIssueCatalog,
} from './IssueFields';
import { recordFinding, setReportedIssue } from './serveApi';
import { errMsg } from './serveShared';

/**
 * Ticket record → Issue (claude/carret-support.md rework A+B). Per laptop:
 * what was reported and what was found (why, what fixed it). The lead can
 * correct the reported issue — a customer's request comes in as
 * "Unspecified" — and records the finding for a laptop repaired in the
 * workshop. Laptops raised before the issue process show their old label only.
 */
const reportedOf = (i) => ({ type_id: i.reported_type_id, subtype_id: i.reported_subtype_id, issue_id: i.reported_issue_id });
const foundOf = (i) => ({ type_id: i.found_type_id, subtype_id: i.found_subtype_id, issue_id: i.found_issue_id });

export default function IssuePanel({ data, canLead, reload }) {
  const catalog = useIssueCatalog();
  const items = (data.items || []).filter((i) => i.item_type === 'complaint' && i.status !== 'removed');
  const repairPickupFor = (i) => (data.items || []).some((p) => p.item_type === 'pickup' && Number(p.source_item_id) === Number(i.id) && p.status !== 'cancelled');
  const [edit, setEdit] = useState(null); // { item, value }
  const [find, setFind] = useState(null); // { item, value }
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;

  const causeName = (id) => catalog?.root_causes.find((c) => c.id === id)?.name;
  const fixName = (id) => catalog?.resolutions.find((r) => r.id === id)?.name;
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.data?.message || ok); setEdit(null); setFind(null); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const missing = items.filter((i) => i.reported_issue_id && !i.found_issue_id);
  const cols = [
    { key: 't', header: 'Laptop', render: (i) => <DocNumber value={i.ttspl_id || i.unique_serial_number || i.serial_number || '—'} />, sub: (i) => [i.brand, i.model].filter(Boolean).join(' ') },
    {
      key: 'r',
      header: 'Reported',
      render: (i) => (i.reported_issue_id ? (issueLabel(catalog, reportedOf(i)) || i.issue_category_label) : <span className="text-ink-3">{i.issue_category_label || '—'} (before the issue process)</span>),
      sub: (i) => i.remarks || null,
    },
    {
      key: 'f',
      header: 'Found',
      render: (i) => {
        if (!i.reported_issue_id) return '—';
        if (!i.found_issue_id) return <span style={{ color: 'var(--alert-warn)', fontWeight: 600 }}>Not recorded yet</span>;
        return issueLabel(catalog, foundOf(i));
      },
      sub: (i) => (i.found_issue_id ? [causeName(i.root_cause_id), fixName(i.resolution_code_id), i.resolution_notes].filter(Boolean).join(' · ') : null),
    },
    {
      key: 'a',
      header: '',
      render: (i) => canLead && i.reported_issue_id && (
        <div className="flex flex-wrap" style={{ gap: '6px' }}>
          {!i.found_issue_id && <Button variant="quiet" onClick={() => setEdit({ item: i, value: { type_id: String(i.reported_type_id), subtype_id: String(i.reported_subtype_id), issue_id: /Unspecified$/.test(i.issue_category_label || '') ? '' : String(i.reported_issue_id) } })}>Change reported</Button>}
          {!i.found_issue_id && repairPickupFor(i) && <Button onClick={() => setFind({ item: i, value: emptyFinding(reportedOf(i)) })}>Record repair finding</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
    <div id="ticket-issue" />
    <Section title="Issue">
      {missing.length > 0 && (
        <Notice tone="info">
          The technician records what was wrong, why and what fixed it when finishing the visit. For a laptop repaired in the workshop, record it here before the Service DC.
        </Notice>
      )}
      <DataTable columns={cols} rows={items} rowKey={(i) => i.id} />

      <Drawer
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={`Reported issue — ${edit?.item.ttspl_id || edit?.item.unique_serial_number || ''}`}
        width="36rem"
        footer={<Button variant="primary" disabled={busy || !issueComplete(edit?.value)} onClick={() => run(() => setReportedIssue(edit.item.id, { type_id: Number(edit.value.type_id), subtype_id: Number(edit.value.subtype_id), issue_id: Number(edit.value.issue_id) }), 'Saved')}>Save</Button>}
      >
        {edit && <IssuePicker catalog={catalog} value={edit.value || emptyIssue()} onChange={(v) => setEdit({ ...edit, value: v })} cols={1} idPrefix="edit-reported" />}
      </Drawer>

      <Drawer
        open={Boolean(find)}
        onClose={() => setFind(null)}
        title={`Repair finding — ${find?.item.ttspl_id || find?.item.unique_serial_number || ''}`}
        width="36rem"
        footer={(
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              const err = findingError('workshop', find.value, catalog);
              if (err) { toast.error(err); return; }
              run(() => recordFinding(find.item.id, findingBody('workshop', find.value, catalog)), 'Recorded');
            }}
          >
            Save
          </Button>
        )}
      >
        {find && <FindingFields catalog={catalog} finish="workshop" value={find.value} onChange={(v) => setFind({ ...find, value: v })} idPrefix="workshop" />}
      </Drawer>
    </Section>
    </>
  );
}

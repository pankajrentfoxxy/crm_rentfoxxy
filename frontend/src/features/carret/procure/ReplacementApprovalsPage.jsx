import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Notice, Section, Textarea,
} from '../../../components/carret';
import { decideReplacement, fetchReplacementApprovals } from '../../floor-pipeline/vendorRepairApi';
import { issueTypeLabel } from '../../floor-pipeline/repairIssueTypes';
import { errMsg } from './procureShared';

/**
 * Procure → Replacement approvals (claude/carret-vendor-repair.md).
 *
 * A vendor's replacement for a laptop out for repair that is a different
 * model / configuration (or could not be read) waits here for Accounts or the
 * named approver. Approve → the warehouse receives it as the replacement, at
 * the original's rent, billed from its gate-in date. Reject → the vendor is
 * mailed and it is handed back; the original stays with the vendor, rent paused.
 */
export default function ReplacementApprovalsPage() {
  const [rows, setRows] = useState(null);
  const [canDecide, setCanDecide] = useState(false);
  const [open, setOpen] = useState(null); // { row, approve }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    fetchReplacementApprovals()
      .then(({ data }) => { setRows(data.data || []); setCanDecide(Boolean(data.can_decide)); })
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load')); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!open.approve && note.trim().length < 3) { toast.error('Give the reason — it goes to the vendor'); return; }
    setBusy(true);
    try {
      const { data } = await decideReplacement(open.row.dc_number, { item_id: open.row.item_id, approve: open.approve, note: note.trim() });
      toast.success(data.message);
      setOpen(null); setNote('');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const sent = (r) => r.configuration || '—';
  const got = (r) => {
    const p = r.replacement_proposed || {};
    return [p.brand, p.model, p.processor, p.generation, p.ram, p.ssd].filter(Boolean).join(' · ') || '—';
  };
  const diffs = (r) => (r.replacement_config_result?.checks || []).filter((c) => c.matched === false);

  const columns = [
    { key: 'd', header: 'Repair challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.vendor_name },
    { key: 't', header: 'Laptop we sent', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => `${sent(r)} · ${r.serial_number || ''}` },
    { key: 'g', header: 'Replacement they sent', render: got, sub: (r) => `serial ${r.replacement_proposed?.serial_number || '—'}${r.replacement_proposed?.condition === 'not_on' ? ' · does not power on' : ''}` },
    { key: 'x', header: 'Differences', render: (r) => (diffs(r).length ? diffs(r).map((c) => `${c.label || c.field}: ${c.expected || '—'} → ${c.actual || '—'}`).join('; ') : (r.replacement_proposed?.condition === 'not_on' ? 'Could not be read' : '—')) },
    { key: 'w', header: 'Waiting since', render: (r) => <DateTime value={r.replacement_requested_at} />, sub: (r) => (r.requested_by_name ? `by ${r.requested_by_name}` : null) },
    {
      key: 'a',
      header: '',
      render: (r) => canDecide && (
        <div className="flex" style={{ gap: '6px' }}>
          <Button variant="primary" onClick={(e) => { e.stopPropagation(); setNote(''); setOpen({ row: r, approve: true }); }}>Approve</Button>
          <Button variant="quiet" onClick={(e) => { e.stopPropagation(); setNote(''); setOpen({ row: r, approve: false }); }}>Reject</Button>
        </div>
      ),
    },
  ];

  return (
    <DeskShell title="Replacement approvals" breadcrumb="Procure" subtitle="Vendor replacements that differ from the laptop we sent for repair.">
      <div className="c-stack">
        <Notice tone="info">
          {canDecide
            ? 'You decide these. Approved: it becomes the replacement at the original laptop’s rent, billed from the day it reached our gate. Rejected: the vendor is mailed and it is handed back.'
            : 'Accounts or the named approver decides these; you can see what is waiting.'}
        </Notice>
        <Section title={`Waiting · ${rows ? rows.length : '…'}`}>
          {rows === null ? <EmptyState title="Loading…" /> : (
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.item_id} empty={<EmptyState title="Nothing waiting" />} />
          )}
        </Section>
      </div>
      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.approve ? 'Approve this replacement' : 'Reject this replacement'}
        footer={<Button variant="primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : (open?.approve ? 'Approve' : 'Reject and mail the vendor')}</Button>}
      >
        {open ? (
          <div className="c-stack">
            <p><strong>{open.row.vendor_name}</strong> · <Link to={`/vendor-management/vendor-repair-dc/${encodeURIComponent(open.row.dc_number)}`}>{open.row.dc_number}</Link></p>
            <p>We sent <span className="font-mono">{open.row.ttspl_id}</span> — {sent(open.row)} ({issueTypeLabel(open.row.issue_type)}: {open.row.item_remarks || '—'})</p>
            <p>They sent {got(open.row)} · serial <span className="font-mono">{open.row.replacement_proposed?.serial_number || '—'}</span></p>
            {(open.row.replacement_rejections || []).length ? <p className="text-ink-3">{open.row.replacement_rejections.length} earlier replacement(s) for this laptop were not accepted.</p> : null}
            <Field label={open.approve ? 'Note (optional)' : 'Reason — goes to the vendor'} required={!open.approve}>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        ) : null}
      </Drawer>
    </DeskShell>
  );
}

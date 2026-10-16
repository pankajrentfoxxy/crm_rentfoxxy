import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Drawer } from '../../../components/carret';
import {
  FindingFields, IssuePicker, emptyFinding, emptyIssue, findingBody, findingError, issueComplete, issueLabel, useIssueCatalog,
} from './IssueFields';
import { applyUpgrade, cancelUpgrade, damagePhotoBlob, recordFinding, setReportedIssue } from './serveApi';
import { errMsg, when } from './serveShared';
import { podUrl } from '../../../components/support/utils';

/**
 * The detail rows on a laptop's card (16 Oct 2026) — once, here, instead of a
 * separate Issue table and Return challans table repeating the same laptop:
 *   Reported   what the customer said (the lead can correct it)
 *   Result     what the technician found, why, what fixed it, the photo
 *   OTP        the customer's code while we wait for it (only for people allowed)
 *   Damage     damage reported on this laptop, with every photo
 */
const OUTCOME = {
  fixed: 'Fixed on site',
  working: 'No fault found',
  replacement_required: 'Could not fix on site',
  repair_pickup_requested: 'Repair pickup asked for',
  repair_required: 'Converted to repair pickup',
  return_required: 'Converted to return pickup',
};
const DMG_STATUS = { reported: 'Waiting for price', priced: 'Priced', proposed: 'With Accounts', approved: 'Approved', waived: 'Waived', rejected: 'Rejected', cancelled: 'Cancelled', billed: 'Billed' };
const reportedOf = (i) => ({ type_id: i.reported_type_id, subtype_id: i.reported_subtype_id, issue_id: i.reported_issue_id });
const foundOf = (i) => ({ type_id: i.found_type_id, subtype_id: i.found_subtype_id, issue_id: i.found_issue_id });

function Row({ k, children, action }) {
  return (
    <div className="c-ldet-row">
      <div className="c-ldet-k">{k}</div>
      <div className="c-ldet-v">{children}</div>
      {action && <div className="c-ldet-a">{action}</div>}
    </div>
  );
}

async function openDamagePhoto(path) {
  const win = window.open('', '_blank');
  try {
    const { data } = await damagePhotoBlob(path);
    const url = URL.createObjectURL(data);
    if (win) win.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (win) win.close();
    toast.error('Could not open the photo');
  }
}

/** complaint: the visit item (or null); otpItem: the item whose OTP we wait for; damage: cases for this laptop. */
const UPG_STATUS = { pending: 'Waiting for the part to be fitted', applied: 'Applied', ordered: 'Replacement ordered', cancelled: 'Cancelled' };
const cfgText = (c = {}) => [c.brand, c.model, c.processor, c.generation, c.ram, c.storage].filter(Boolean).join(' · ');
const money = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);

export default function LaptopDetails({ complaint, hasRepairPickup, otpItem, damage = [], upgrades = [], canLead, locked, reload }) {
  const catalog = useIssueCatalog();
  const [edit, setEdit] = useState(null);
  const [find, setFind] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(r?.data?.message || ok); setEdit(null); setFind(null); reload?.(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const causeName = (id) => catalog?.root_causes.find((c) => c.id === id)?.name;
  const fixName = (id) => catalog?.resolutions.find((r) => r.id === id)?.name;
  const c = complaint;
  const reported = c ? (c.reported_issue_id ? (issueLabel(catalog, reportedOf(c)) || c.issue_category_label) : c.issue_category_label) : null;
  const found = c?.found_issue_id ? issueLabel(catalog, foundOf(c)) : null;
  const result = c && (c.outcome || c.found_issue_id || c.work_done_at);
  const photo = c?.proof_of_completion_path || c?.pod_image_path;
  const otp = otpItem && (otpItem.item_type === 'pickup' ? otpItem.customer_otp_code : otpItem.otp_code);
  const canEdit = canLead && !locked;

  if (!c && !otp && !damage.length && !upgrades.length) return null;
  return (
    <div className="c-ldet">
      {c && (reported || c.remarks) && (
        <Row
          k="Reported"
          action={canEdit && c.reported_issue_id && !c.found_issue_id ? (
            <Button variant="quiet" onClick={() => setEdit({ item: c, value: { type_id: String(c.reported_type_id), subtype_id: String(c.reported_subtype_id), issue_id: /Unspecified$/.test(c.issue_category_label || '') ? '' : String(c.reported_issue_id) } })}>Change</Button>
          ) : null}
        >
          {reported || '—'}
          {c.remarks && <small>“{c.remarks}”</small>}
        </Row>
      )}
      {c && result && (
        <Row
          k="Visit result"
          action={canEdit && hasRepairPickup && c.reported_issue_id && !c.found_issue_id
            ? <Button variant="quiet" onClick={() => setFind({ item: c, value: emptyFinding(reportedOf(c)) })}>Record repair finding</Button>
            : null}
        >
          <b>{OUTCOME[c.outcome] || (c.work_done_at ? 'Work done' : '—')}</b>
          {found && <span> · {found}</span>}
          {(c.root_cause_id || c.resolution_code_id || c.resolution_notes) && (
            <small>{[causeName(c.root_cause_id) && `Cause: ${causeName(c.root_cause_id)}`, fixName(c.resolution_code_id) && `Fix: ${fixName(c.resolution_code_id)}`, c.resolution_notes].filter(Boolean).join(' · ')}</small>
          )}
          {c.replacement_flag_reason && <small>Technician: {c.replacement_flag_reason}</small>}
          {(photo || c.otp_verified_at) && (
            <small>
              {photo && <a href={podUrl(photo)} target="_blank" rel="noopener noreferrer">Photo</a>}
              {photo && c.otp_verified_at ? ' · ' : ''}
              {c.otp_verified_at ? `Closed with customer OTP ${when(c.otp_verified_at)}` : ''}
            </small>
          )}
        </Row>
      )}
      {otp && !locked && (
        <Row k="Customer OTP">
          <span className="c-otp">{otp}</span>
          <small>
            {otpItem.item_type === 'pickup' ? 'The customer gives this when the laptop is collected.' : 'The customer gives this to close the visit.'}
            {otpItem.customer_otp_sent_at ? ` Sent ${when(otpItem.customer_otp_sent_at)}.` : ''}
          </small>
        </Row>
      )}
      {upgrades.filter((u) => u.status !== 'cancelled').map((u) => (
        <Row
          key={`u${u.upgrade_id}`}
          k={u.kind === 'laptop' ? 'Laptop upgrade' : 'RAM / SSD upgrade'}
          action={canLead && !locked && u.status === 'pending' ? (
            <>
              <Button variant="primary" disabled={busy} onClick={() => run(() => applyUpgrade(u.upgrade_id), 'Upgraded')}>Apply — part fitted</Button>
              <Button variant="quiet" disabled={busy} onClick={() => { const why = window.prompt('Why cancel this upgrade?'); if (why && why.trim().length >= 3) run(() => cancelUpgrade(u.upgrade_id, why.trim()), 'Cancelled'); }}>Cancel</Button>
            </>
          ) : null}
        >
          <b>{u.kind === 'laptop' ? cfgText(u.new_config) : Object.entries(u.new_config || {}).map(([k, v]) => `${k === 'ram' ? 'RAM' : 'SSD'} ${(u.old_config || {})[k] || '—'} → ${v}`).join(' · ')}</b>
          <small>Rent {money(u.old_rate)} → {money(u.new_rate)}/month{u.effective_from ? ` from ${new Date(u.effective_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''} · {UPG_STATUS[u.status] || u.status}</small>
          {u.notes && <small>{u.notes}</small>}
        </Row>
      ))}
      {damage.length > 0 && (
        <Row k={`Damage · ${damage.length}`}>
          {damage.map((d) => (
            <div key={d.id} className="c-ldet-dmg">
              <span>{(d.lines || []).map((l) => `${l.part_name}: ${l.issue}`).join('; ') || 'Damage'}</span>
              <small>{DMG_STATUS[d.status] || d.status}{d.total ? ` · ₹${Number(d.approved_amount ?? d.total).toLocaleString('en-IN')}` : ''} · {d.reported_by_name || '—'} {when(d.reported_at)}</small>
              <span className="c-ldet-photos">
                {(d.lines || []).flatMap((l) => l.photos || []).map((p, n) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <button key={n} type="button" className="c-photo-chip" onClick={() => openDamagePhoto(p)}>Photo {n + 1}</button>
                ))}
              </span>
            </div>
          ))}
        </Row>
      )}

      <Drawer
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title="Reported issue"
        width="36rem"
        footer={<Button variant="primary" disabled={busy || !issueComplete(edit?.value)} onClick={() => run(() => setReportedIssue(edit.item.id, { type_id: Number(edit.value.type_id), subtype_id: Number(edit.value.subtype_id), issue_id: Number(edit.value.issue_id) }), 'Saved')}>Save</Button>}
      >
        {edit && <IssuePicker catalog={catalog} value={edit.value || emptyIssue()} onChange={(v) => setEdit({ ...edit, value: v })} cols={1} idPrefix={`edit-reported-${edit.item.id}`} />}
      </Drawer>
      <Drawer
        open={Boolean(find)}
        onClose={() => setFind(null)}
        title="Repair finding"
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
        {find && <FindingFields catalog={catalog} finish="workshop" value={find.value} onChange={(v) => setFind({ ...find, value: v })} idPrefix={`workshop-${find.item.id}`} />}
      </Drawer>
    </div>
  );
}

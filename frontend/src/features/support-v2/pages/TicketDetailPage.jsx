import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '../../../components/ui/primitives';
import {
  ClassificationChain, Mono, PriorityChip, SlaChip, StatusPill, WorkOrderCard, prioritySpine, Modal,
} from '../../../components/ui/supportPrimitives';
import PermissionGate from '../../../components/PermissionGate';
import { usePermission } from '../../../hooks/usePermission';
import {
  assignTicket, cancelTicket, closeTicket, commentTicket, getTicket, linkTicket,
  overridePriority, pauseTicket, reopenTicket, resolveTicket, resumeTicket, fetchQueueMeta,
  waiveCollect,
} from '../supportV2Api';
import { SUPPORT_V2_BASE } from '../supportV2Utils';
import ResolveLineModal from '../components/ResolveLineModal';
import CreateWorkOrderModal from '../components/CreateWorkOrderModal';
import InitiateReplacementModal from '../components/InitiateReplacementModal';
import ReplacementPair from '../components/ReplacementPair';

const TABS = ['Overview', 'Machines', 'Work orders', 'Timeline', 'Attachments', 'Costs', 'Approvals'];

function eventTone(type) {
  const t = String(type || '');
  if (/BREACH|FAIL|CANCEL/.test(t)) return 'bg-pri1';
  if (/RESOLVE|COMPLETE|CREATED/.test(t)) return 'bg-sup-ok';
  if (/ASSIGN|PAUSE|RESUME|PRIORITY|SLA/.test(t)) return 'bg-sup-accent';
  return 'bg-white border border-sup-line';
}

function AssetCard({ line, canEdit, onResolve, onCreateWo, onReplace, onOpenWo, ticketPriority, replacements, onWaive }) {
  const found = line.found_issue_id;
  const match = found && Number(found) === Number(line.reported_issue_id);
  return (
    <div className="bg-white rounded-xl border border-sup-lineSoft p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-semibold">{line.line_code}</span>
          <Mono bold>{line.ttspl_id || 'Unknown'}</Mono>
          <StatusPill status={line.line_status} />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3 text-[12px]">
        <div>
          <div className="text-sup-muted mb-1">Reported by customer</div>
          <ClassificationChain type={line.reported_type_name} subtype={line.reported_subtype_name} issue={line.reported_issue_name} />
        </div>
        <div>
          <div className="text-sup-muted mb-1">Found by technician</div>
          {found ? (
            <>
              <ClassificationChain type={line.found_type_name} subtype={line.found_subtype_name} issue={line.found_issue_name} />
              <span className={`ml-2 text-[10.5px] px-1.5 py-0.5 rounded ${match ? 'bg-sup-okBg text-sup-ok' : 'bg-pri2-bg text-pri2'}`}>
                {match ? 'Matched' : 'Reclassified at diagnosis'}
              </span>
            </>
          ) : <span className="text-sup-faint">Not yet diagnosed</span>}
        </div>
      </div>
      {line.resolution_code_id && (
        <div className="grid grid-cols-4 gap-2 text-[11.5px] pt-1">
          <div>Resolution<br /><b>{line.resolution_name || '—'}</b></div>
          <div>Root cause<br /><b>{line.root_cause_name || '—'}</b></div>
          <div className={line.liability === 'CUSTOMER_CHARGEABLE' ? 'text-pri2' : ''}>
            Liability<br /><b>{line.liability || '—'}</b>
          </div>
          <div>Amount<br /><b>{line.chargeable_amount ? `₹${line.chargeable_amount}` : '—'}</b></div>
        </div>
      )}
      <div className="space-y-2">
        {(replacements || []).filter((p) => p.line_id === line.line_id).map((p) => (
          <ReplacementPair
            key={p.replacement_id}
            pair={p}
            workOrders={line.work_orders || []}
            onOpenWo={onOpenWo}
            onWaive={onWaive}
          />
        ))}
        {(line.work_orders || []).filter((w) => !w.replacement_group_id).map((w) => (
          <WorkOrderCard
            key={w.wo_id}
            woNumber={w.wo_number}
            type={w.wo_type}
            status={w.status}
            priority={ticketPriority}
            title={w.notes}
            assignee={w.assigned_to_name}
            documentNumber={w.document_number}
            stepsDone={(w.steps || []).filter((s) => s.status === 'DONE').length}
            stepsTotal={(w.steps || []).length}
            onClick={() => onOpenWo(w.wo_id)}
          />
        ))}
        {!(line.work_orders || []).length && (
          <p className="text-[12px] text-sup-muted">No work order yet.</p>
        )}
      </div>
      <div className="flex gap-2">
        <PermissionGate section="support_work_orders" action="create">
          <Button size="sm" variant="secondary" onClick={onCreateWo}>＋ Work order</Button>
        </PermissionGate>
        <PermissionGate section="support_replacement" action="create">
          <Button size="sm" variant="secondary" onClick={() => onReplace(line)}>Replace</Button>
        </PermissionGate>
        {canEdit && line.line_status !== 'RESOLVED' && (
          <Button size="sm" onClick={() => onResolve(line)}>Resolve this machine</Button>
        )}
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { canEdit, canDelete, hasPermission } = usePermission();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [resolveLine, setResolveLine] = useState(null);
  const [woOpen, setWoOpen] = useState(false);
  const [replaceLine, setReplaceLine] = useState(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseForm, setPauseForm] = useState({ reason: 'PENDING_CUSTOMER', contact_method: 'PHONE', note: '' });
  const [comment, setComment] = useState('');
  const [owners, setOwners] = useState([]);

  const load = useCallback(() => {
    getTicket(id).then((r) => setData(r.data)).catch(() => toast.error('Ticket not found'));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetchQueueMeta().then((r) => setOwners(r.data?.owners || [])).catch(() => {});
  }, []);

  if (!data?.ticket) return <p className="text-sup-muted text-sm p-4">Loading…</p>;
  const t = data.ticket;
  const lines = data.asset_lines || [];
  const events = data.events || [];
  const canCharge = hasPermission('support_charges', 'edit') || hasPermission('support_charges', 'create');

  const act = async (fn, ok) => {
    try { await fn(); toast.success(ok); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
  };

  return (
    <div className="space-y-3">
      <div className={`bg-white rounded-xl border border-sup-lineSoft p-4 ${prioritySpine(t.priority)}`}>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityChip priority={t.priority} showLabel />
          <Mono bold className="text-[15px]">{t.ticket_number}</Mono>
          <StatusPill status={t.status} pendingReason={t.pending_reason} />
          <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-sup-canvas2">{t.ticket_class}</span>
          <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-sup-canvas2">{t.channel}</span>
          {t.sla_resolution_breached && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-pri1-bg text-pri1">Breached</span>}
        </div>
        <h2 className="text-[16px] font-semibold mt-2">{t.subject}</h2>
        {data.waiting_for_part > 0 && (
          <div className="mt-2 text-[12px] text-pri2">
            {data.waiting_for_part} of {data.asset_line_count} machines waiting for part
          </div>
        )}
        <div className="text-[12px] text-sup-muted mt-1">
          {t.customer_name} · {t.contact_name} {t.contact_phone} · {t.assignment_group_name || 'No group'} · {t.assigned_to_name || 'Unassigned'}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 mt-3">
          <div className="flex gap-4">
            <div>
              <div className="text-[10px] uppercase text-sup-faint">Response</div>
              <SlaChip dueAt={t.sla_response_due_at} startedAt={t.sla_started_at} paused={t.sla_paused} />
            </div>
            <div>
              <div className="text-[10px] uppercase text-sup-faint">Resolution</div>
              <SlaChip dueAt={t.sla_resolution_due_at} startedAt={t.sla_started_at} paused={t.sla_paused} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit('support_tickets') && t.status !== 'CLOSED' && t.status !== 'CANCELLED' && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setPauseOpen(true)}>Pause</Button>
                {t.sla_paused && <Button size="sm" variant="secondary" onClick={() => act(() => resumeTicket(t.ticket_id), 'Resumed')}>Resume</Button>}
                <Button size="sm" variant="secondary" onClick={() => act(() => resolveTicket(t.ticket_id, {}), 'Resolved')}>Resolve ticket</Button>
                <Button size="sm" variant="secondary" onClick={() => act(() => closeTicket(t.ticket_id, {}), 'Closed')}>Close</Button>
              </>
            )}
            {canEdit('support_tickets') && (t.status === 'CLOSED' || t.status === 'RESOLVED') && (
              <Button size="sm" onClick={() => {
                const reason = window.prompt('Reopen reason');
                if (reason) act(() => reopenTicket(t.ticket_id, { reason }), 'Reopened');
              }}>Reopen</Button>
            )}
            {canDelete('support_tickets') && t.status !== 'CANCELLED' && (
              <Button size="sm" variant="danger" onClick={() => {
                const reason = window.prompt('Cancel reason');
                if (reason) act(() => cancelTicket(t.ticket_id, { reason }), 'Cancelled');
              }}>Cancel</Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap text-[12px]">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`px-2.5 py-1 rounded ${tab === name ? 'bg-sup-accentSoft text-sup-accent font-semibold' : 'text-sup-muted'}`}
          >
            {name}
            {name === 'Machines' ? ` (${lines.length})` : ''}
            {name === 'Work orders' ? ` (${lines.reduce((n, l) => n + (l.work_orders || []).length, 0)})` : ''}
            {name === 'Timeline' ? ` (${events.length})` : ''}
            {name === 'Attachments' ? ` (${(data.attachments || []).length})` : ''}
            {name === 'Approvals' ? ` (${(data.approvals || []).length})` : ''}
          </button>
        ))}
      </div>

      {(tab === 'Overview' || tab === 'Machines') && (
        <div className={tab === 'Overview' ? 'grid lg:grid-cols-[1fr_280px] gap-3' : 'space-y-3'}>
          <div className="space-y-3">
            {lines.map((line) => (
              <AssetCard
                key={line.line_id}
                line={line}
                canEdit={canEdit('support_tickets')}
                onResolve={setResolveLine}
                onCreateWo={() => setWoOpen(true)}
                onReplace={setReplaceLine}
                onOpenWo={(woId) => nav(`${SUPPORT_V2_BASE}/jobs/${woId}`)}
                ticketPriority={t.priority}
                replacements={data.replacements || []}
                onWaive={(p) => {
                  const reason = window.prompt('Waive collect-before-delivery — reason');
                  if (!reason) return;
                  act(() => waiveCollect(p.replacement_id, { reason }), 'Collect waived');
                }}
              />
            ))}
          </div>
          {tab === 'Overview' && (
            <div className="space-y-3">
              <div className="bg-white rounded-xl border border-sup-lineSoft p-3">
                <div className="font-semibold text-[12px] mb-2">Timeline</div>
                <ol className="space-y-2">
                  {events.slice(0, 8).map((e) => (
                    <li key={e.event_id} className="flex gap-2 text-[11.5px]">
                      <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${eventTone(e.event_type)}`} />
                      <div>
                        <div>{e.summary}</div>
                        <div className="text-sup-faint font-mono">
                          {new Date(e.created_at).toLocaleString()}
                          {e.is_customer_visible ? ' · customer visible' : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="bg-white rounded-xl border border-sup-lineSoft p-3 text-[12px]">
                <div className="font-semibold mb-1">Costs on this ticket</div>
                <div>Chargeable ₹{data.costs?.chargeable_total || 0}</div>
                <div>Pending lines {data.costs?.pending_lines || 0}</div>
              </div>
              <div className="bg-white rounded-xl border border-sup-lineSoft p-3 space-y-2 text-[12px]">
                <div className="font-semibold">Quick actions</div>
                <PermissionGate section="support_work_orders" action="create">
                  <button type="button" className="block text-left w-full underline" onClick={() => setWoOpen(true)}>Create work order</button>
                </PermissionGate>
                <PermissionGate section="support_tickets" action="edit">
                  <button type="button" className="block text-left w-full underline" onClick={() => setPauseOpen(true)}>Pause — waiting on customer</button>
                  <button type="button" className="block text-left w-full underline" onClick={() => {
                    const target = window.prompt('Target ticket id');
                    if (target) act(() => linkTicket(t.ticket_id, { target_ticket_id: Number(target), link_type: 'RELATED' }), 'Linked');
                  }}>Link or merge ticket</button>
                </PermissionGate>
                <PermissionGate section="support_triage" action="edit">
                  <button type="button" className="block text-left w-full underline" onClick={() => {
                    const p = Number(window.prompt('New priority 1–4'));
                    const reason = window.prompt('Reason');
                    if (p && reason) act(() => overridePriority(t.ticket_id, { priority: p, reason }), 'Priority updated');
                  }}>Escalate / override priority</button>
                </PermissionGate>
                <PermissionGate section="support_tickets" action="view">
                  <button type="button" className="block text-left w-full underline" onClick={() => {
                    const body = window.prompt('Update to customer');
                    if (body) act(() => commentTicket(t.ticket_id, { body, is_customer_visible: true }), 'Sent');
                  }}>Send update to customer</button>
                </PermissionGate>
                <PermissionGate section="support_tickets" action="delete">
                  <button type="button" className="block text-left w-full underline text-pri1" onClick={() => {
                    const reason = window.prompt('Cancel reason');
                    if (reason) act(() => cancelTicket(t.ticket_id, { reason }), 'Cancelled');
                  }}>Cancel ticket</button>
                </PermissionGate>
                {canEdit('support_tickets') && owners.length > 0 && (
                  <select
                    className="w-full border rounded px-2 py-1"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) act(() => assignTicket(t.ticket_id, { user_id: Number(e.target.value) }), 'Assigned');
                    }}
                  >
                    <option value="">Assign owner…</option>
                    {owners.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'Work orders' && (
        <div className="space-y-2">
          {(data.replacements || []).map((p) => (
            <ReplacementPair
              key={p.replacement_id}
              pair={p}
              workOrders={lines.flatMap((l) => l.work_orders || [])}
              onOpenWo={(woId) => nav(`${SUPPORT_V2_BASE}/jobs/${woId}`)}
              onWaive={(row) => {
                const reason = window.prompt('Waive collect-before-delivery — reason');
                if (!reason) return;
                act(() => waiveCollect(row.replacement_id, { reason }), 'Collect waived');
              }}
            />
          ))}
          {lines.flatMap((l) => l.work_orders || []).filter((w) => !w.replacement_group_id).map((w) => (
            <WorkOrderCard
              key={w.wo_id}
              woNumber={w.wo_number}
              type={w.wo_type}
              status={w.status}
              priority={t.priority}
              assignee={w.assigned_to_name}
              documentNumber={w.document_number}
              stepsDone={(w.steps || []).filter((s) => s.status === 'DONE').length}
              stepsTotal={(w.steps || []).length}
              onClick={() => nav(`${SUPPORT_V2_BASE}/jobs/${w.wo_id}`)}
            />
          ))}
          {!lines.some((l) => (l.work_orders || []).length) && <p className="text-sup-muted text-sm">No work orders yet.</p>}
        </div>
      )}

      {tab === 'Timeline' && (
        <ol className="space-y-2 bg-white rounded-xl border border-sup-lineSoft p-4">
          {events.map((e) => (
            <li key={e.event_id} className="flex gap-2 text-[12px]">
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${eventTone(e.event_type)}`} />
              <div>
                <div className="font-semibold">{e.summary}</div>
                <div className="text-sup-faint font-mono text-[11px]">
                  {e.actor_name || e.actor_kind} · {new Date(e.created_at).toLocaleString()}
                  {e.is_customer_visible ? ' · customer visible' : ''}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {tab === 'Attachments' && (
        <ul className="bg-white rounded-xl border border-sup-lineSoft p-4 text-[12px] space-y-1">
          {(data.attachments || []).map((a) => (
            <li key={a.attachment_id}>{a.original_name || a.file_path} · {a.kind}</li>
          ))}
          {!(data.attachments || []).length && <li className="text-sup-muted">None</li>}
        </ul>
      )}

      {tab === 'Costs' && (
        <div className="bg-white rounded-xl border border-sup-lineSoft p-4 text-[12px]">
          Chargeable total ₹{data.costs?.chargeable_total || 0} · pending {data.costs?.pending_lines || 0} · open holds {data.costs?.open_holds || 0}
        </div>
      )}

      {tab === 'Approvals' && (
        <ul className="bg-white rounded-xl border border-sup-lineSoft p-4 text-[12px] space-y-1">
          {(data.approvals || []).map((a) => (
            <li key={a.approval_id}>{a.label || a.approval_type} · {a.status} {a.amount ? `· ₹${a.amount}` : ''}</li>
          ))}
          {!(data.approvals || []).length && <li className="text-sup-muted">None</li>}
        </ul>
      )}

      <div className="bg-white rounded-xl border border-sup-lineSoft p-3 flex gap-2">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment"
          className="flex-1 border rounded px-2 py-1.5 text-[12px]"
        />
        <Button size="sm" onClick={() => {
          if (!comment.trim()) return;
          act(() => commentTicket(t.ticket_id, { body: comment, is_customer_visible: false }), 'Comment added');
          setComment('');
        }}>Comment</Button>
      </div>

      {(data.links || []).length > 0 && (
        <div className="text-[12px] text-sup-muted">
          Linked:{' '}
          {data.links.map((l) => (
            <Link key={l.link_id} className="underline mr-2" to={`${SUPPORT_V2_BASE}/tickets/${l.to_ticket_id}`}>
              {l.link_type} {l.to_ticket_number}
            </Link>
          ))}
        </div>
      )}

      {replaceLine && (
        <InitiateReplacementModal
          line={replaceLine}
          ticket={t}
          onClose={() => setReplaceLine(null)}
          onCreated={() => { setReplaceLine(null); load(); }}
        />
      )}
      {woOpen && (
        <CreateWorkOrderModal
          ticket={t}
          lines={lines}
          onClose={() => setWoOpen(false)}
          onCreated={() => { setWoOpen(false); load(); }}
        />
      )}
      {resolveLine && (
        <ResolveLineModal
          line={resolveLine}
          ticketId={t.ticket_id}
          canCharge={canCharge}
          onClose={() => setResolveLine(null)}
          onSaved={() => { setResolveLine(null); load(); }}
        />
      )}

      {pauseOpen && (
        <Modal title="Pause ticket" onClose={() => setPauseOpen(false)} size="sm" footer={(
          <>
            <Button variant="secondary" onClick={() => setPauseOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              act(() => pauseTicket(t.ticket_id, pauseForm), 'Paused');
              setPauseOpen(false);
            }}>Pause</Button>
          </>
        )}
        >
          <div className="space-y-2 text-[12px]">
            <select value={pauseForm.reason} onChange={(e) => setPauseForm((f) => ({ ...f, reason: e.target.value }))} className="w-full border rounded px-2 py-1.5">
              <option value="PENDING_CUSTOMER">Waiting on customer</option>
              <option value="PENDING_VENDOR">Waiting on vendor</option>
              <option value="PENDING_APPROVAL">Waiting on approval</option>
              <option value="PENDING_PART">Waiting on part</option>
            </select>
            {pauseForm.reason === 'PENDING_CUSTOMER' && (
              <select value={pauseForm.contact_method} onChange={(e) => setPauseForm((f) => ({ ...f, contact_method: e.target.value }))} className="w-full border rounded px-2 py-1.5">
                <option value="PHONE">Phone</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            )}
            <textarea value={pauseForm.note} onChange={(e) => setPauseForm((f) => ({ ...f, note: e.target.value }))} placeholder="Note" className="w-full border rounded px-2 py-1.5" />
          </div>
        </Modal>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, Drawer, EmptyState, Field, Input, KeyValue, Select,
} from '../../../components/carret';
import { fetchAuditLog } from './controlApi';
import { errMsg } from './controlShared';

/**
 * Control → Audit log. Every change to roles, role permissions, user overrides
 * and users that the RBAC endpoints record (permission_audit_logs), newest first.
 */
const LIMIT = 50;
const humanise = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function AuditLogPage() {
  const [res, setRes] = useState(null);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [facets, setFacets] = useState({ actions: [], target_types: [] });

  const load = useCallback(() => {
    fetchAuditLog({
      page,
      limit: LIMIT,
      action: action || undefined,
      target_type: targetType || undefined,
      from: from || undefined,
      to: to || undefined,
      search: q.trim() || undefined,
    })
      .then(({ data }) => {
        setRes(data);
        setFacets((f) => ({
          actions: data.actions?.length ? data.actions : f.actions,
          target_types: data.target_types?.length ? data.target_types : f.target_types,
        }));
      })
      .catch((e) => { setRes({ logs: [], pagination: {} }); toast.error(errMsg(e)); });
  }, [page, action, targetType, from, to, q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { setPage(1); }, [action, targetType, from, to, q]);

  const cols = [
    { key: 'w', header: 'When', render: (r) => <DateTime value={r.created_at} /> },
    { key: 'a', header: 'Change', render: (r) => humanise(r.action) },
    { key: 't', header: 'On', render: (r) => r.target_label || r.target_id || '—', sub: (r) => r.target_type },
    { key: 'b', header: 'By', render: (r) => r.actor_name || (r.actor_user_id ? `User #${r.actor_user_id}` : 'System'), sub: (r) => r.actor_email },
  ];
  const pg = res?.pagination || {};

  return (
    <DeskShell title="Audit log" breadcrumb="Control" subtitle="Who changed roles, permissions and users, and when.">
      <div className="c-stack">
        <div className="flex flex-wrap items-end" style={{ gap: '8px' }}>
          <Field label="Change">
            <Select value={action} placeholder="All changes" options={facets.actions.map((a) => ({ value: a, label: humanise(a) }))} onChange={(e) => setAction(e.target.value)} />
          </Field>
          <Field label="On">
            <Select value={targetType} placeholder="Everything" options={facets.target_types.map((a) => ({ value: a, label: humanise(a) }))} onChange={(e) => setTargetType(e.target.value)} />
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Search"><Input type="search" placeholder="Role, user, section" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        </div>
        {res === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={cols} rows={res.logs || []} rowKey={(r) => r.id} onRowClick={setOpen} empty={<EmptyState title="No changes recorded" />} />
        )}
        {(pg.totalPages || 1) > 1 && (
          <div className="flex items-center" style={{ gap: '8px' }}>
            <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-ink-3">Page {pg.page || page} of {pg.totalPages} · {pg.total} entries</span>
            <Button variant="quiet" disabled={page >= pg.totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open ? humanise(open.action) : ''} width="40rem">
        {open && (
          <div className="c-stack">
            <KeyValue cols={2} items={[
              { label: 'When', value: <DateTime value={open.created_at} /> },
              { label: 'By', value: open.actor_name ? `${open.actor_name} (${open.actor_email || ''})` : open.actor_user_id },
              { label: 'On', value: open.target_type },
              { label: 'Target', value: open.target_label || open.target_id },
            ]} />
            <pre className="font-mono" style={{ fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--surface-2, transparent)', border: '1px solid var(--rule)', borderRadius: '6px', padding: '10px', margin: 0 }}>
              {JSON.stringify(open.payload ?? {}, null, 2)}
            </pre>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, ConfirmDialog, DataTable, DateTime, Drawer, EmptyState, StatusChip, Tabs,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import {
  deleteGrnAccessNumber, expireGrnAccessNumber, fetchGrnAccessAttempts, listGrnAccessNumbers,
} from '../../vendor-management/vendorManagementApi';
import { errMsg } from './procureShared';

/**
 * GRN access numbers — the short numbers typed on a laptop to run its
 * configuration check. Port of vendor-management/components/AccessNumbersAdmin.
 *
 * Listing needs vendor_management view; expiring and deleting need edit (the
 * same as the /api/grn-access routes). The backend lists every PO's numbers,
 * so "This PO only" narrows it here.
 */
const STATUS_CHIP = {
  pending: { status: 'active', label: 'Pending' },
  used: { status: 'completed', label: 'Used' },
  expired: { status: 'cancelled', label: 'Expired' },
};
const RESULT_TONE = { ok: 'var(--alert-good)', invalid: 'var(--alert-crit)', expired: 'var(--alert-warn)' };

export default function AccessNumbersDrawer({ open, onClose, poId }) {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('vendor_management', 'edit');

  const [tab, setTab] = useState('numbers');
  const [rows, setRows] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [onlyPo, setOnlyPo] = useState(Boolean(poId));
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const [numRes, attRes] = await Promise.all([
        listGrnAccessNumbers(),
        fetchGrnAccessAttempts({ limit: 100 }).catch(() => ({ data: { data: [] } })),
      ]);
      setRows(numRes.data?.data || []);
      setAttempts(attRes.data?.data || []);
    } catch (e) {
      toast.error(errMsg(e, 'Could not load access numbers'));
      setRows([]);
    }
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  const shown = useMemo(() => {
    const all = rows || [];
    return onlyPo && poId ? all.filter((r) => String(r.po_id) === String(poId)) : all;
  }, [rows, onlyPo, poId]);
  const shownAttempts = useMemo(() => {
    if (!(onlyPo && poId)) return attempts;
    const nums = new Set(shown.map((r) => String(r.access_number)));
    return attempts.filter((a) => nums.has(String(a.access_number)));
  }, [attempts, shown, onlyPo, poId]);

  const expire = async (r) => {
    setBusyId(r.id);
    try { await expireGrnAccessNumber(r.id); toast.success(`${r.access_number} expired`); await load(); } catch (e) { toast.error(errMsg(e, 'Could not expire')); } finally { setBusyId(null); }
  };
  const remove = async (r) => {
    setBusyId(r.id);
    try { await deleteGrnAccessNumber(r.id); toast.success(`${r.access_number} deleted`); await load(); } catch (e) { toast.error(errMsg(e, 'Could not delete')); } finally { setBusyId(null); }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Access numbers" width="44rem" footer={<Button onClick={load}>Refresh</Button>}>
      <div className="c-stack">
        <div className="flex flex-wrap items-center" style={{ gap: '12px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'numbers', label: 'Access numbers', count: rows ? shown.length : undefined },
              { key: 'audit', label: 'Attempts', count: rows ? shownAttempts.length : undefined },
            ]}
          />
          {poId && <Checkbox label="This PO only" checked={onlyPo} onChange={(e) => setOnlyPo(e.target.checked)} />}
        </div>
        {rows === null ? <EmptyState title="Loading…" /> : tab === 'numbers' ? (
          <DataTable
            rows={shown}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No access numbers" />}
            columns={[
              { key: 'n', header: 'Number', render: (r) => <span className="font-mono" style={{ fontWeight: 600 }}>{r.access_number}</span> },
              { key: 's', header: 'Status', render: (r) => { const c = STATUS_CHIP[r.status]; return c ? <StatusChip status={c.status} label={c.label} /> : <StatusChip status={r.status} />; } },
              { key: 'p', header: 'PO', render: (r) => r.purchase_order_number || (r.po_id ? `PO-${r.po_id}` : '—') },
              { key: 'c', header: 'Created', render: (r) => <DateTime value={r.created_at} /> },
              { key: 'u', header: 'Used', render: (r) => (r.used_at ? <DateTime value={r.used_at} /> : '—') },
              {
                key: 'a',
                header: '',
                render: (r) => canEdit && (
                  <div className="flex justify-end" style={{ gap: '4px' }}>
                    <Button variant="quiet" disabled={busyId === r.id || r.status !== 'pending'} onClick={() => expire(r)}>Expire</Button>
                    <Button variant="quiet" disabled={busyId === r.id} onClick={() => setConfirmDelete(r)}>Delete</Button>
                  </div>
                ),
              },
            ]}
          />
        ) : (
          <DataTable
            rows={shownAttempts}
            rowKey={(a, i) => a.id ?? i}
            empty={<EmptyState title="No attempts recorded" />}
            columns={[
              { key: 't', header: 'When', render: (a) => <DateTime value={a.created_at} /> },
              { key: 'n', header: 'Number', render: (a) => <span className="font-mono">{a.access_number ?? '—'}</span> },
              { key: 'r', header: 'Result', render: (a) => { const res = a.result || (a.success ? 'ok' : 'failed'); return <span style={{ color: RESULT_TONE[res] || 'var(--ink-2)' }}>{res === 'ok' ? '✓' : '✕'} {res}</span>; } },
              { key: 'i', header: 'IP', render: (a) => <span className="font-mono">{a.ip || '—'}</span> },
            ]}
          />
        )}
        {!canEdit && <p className="text-ink-3" style={{ margin: 0 }}>Expiring or deleting a number needs edit access to vendor management.</p>}
      </div>
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => remove(confirmDelete)}
        title={`Delete access number ${confirmDelete?.access_number || ''}?`}
        body="This cannot be undone."
        confirmLabel="Delete"
      />
    </Drawer>
  );
}

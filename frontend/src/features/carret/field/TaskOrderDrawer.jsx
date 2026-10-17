import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Drawer, EmptyState, Notice } from '../../../components/carret';
import { TASK_KIND_COLOR, fetchFieldTasks, releaseFieldTask, saveFieldTaskOrder } from './fieldApi';

/**
 * Lead: the order a technician works in (migration 439). Move a task up or
 * down — a task assigned later can go anywhere — and save. The technician sees
 * only the first open task, then the next. A task stuck "in progress"
 * (reached by mistake, customer away) can be put back to not started.
 */
const KIND = { visit: 'Visit', pickup: 'Pickup', return: 'Return pickup', delivery: 'Delivery', vendor: 'Vendor' };
const errMsg = (e) => e?.response?.data?.message || e?.message || 'That did not work.';

export default function TaskOrderDrawer({ userId, name, open, onClose }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetchFieldTasks(userId).then(({ data }) => setList((data.tasks || []).filter((t) => t.state !== 'carrying'))).catch((e) => { toast.error(errMsg(e)); setList([]); });
  useEffect(() => { if (open) { setList(null); load(); } }, [open, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i, d) => setList((l) => {
    const j = i + d;
    if (j < 0 || j >= l.length) return l;
    const n = [...l];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const save = async () => {
    setBusy(true);
    try { const { data } = await saveFieldTaskOrder(userId, list.map((t) => t.key)); toast.success(data.message || 'Saved'); onClose(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const putBack = async (t) => {
    setBusy(true);
    try { await releaseFieldTask(userId, t.key); toast.success('Put back to not started'); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onClose={onClose} title={`Task order · ${name || 'technician'}`} width="38rem" footer={<Button variant="primary" disabled={busy || !list?.length} onClick={save}>Save the order</Button>}>
      {!list ? <EmptyState title="Loading…" /> : !list.length ? <EmptyState title="No open tasks" /> : (
        <div className="c-stack">
          <Notice tone="info">First to last. The technician sees one task at a time and cannot start the next until this one is closed with the customer’s OTP.</Notice>
          <ol className="c-torder">
            {list.map((t, i) => (
              <li key={t.key} className={t.state === 'active' ? 'is-active' : ''} style={{ '--k': TASK_KIND_COLOR[t.kind] || '#64748b' }}>
                <span className="c-torder-n">{i + 1}</span>
                <div className="min-w-0">
                  <div><span className="c-tq-chip">{KIND[t.kind] || t.kind}</span> <b>{t.customer || t.title}</b></div>
                  <small>{t.title}{t.state === 'active' ? ' · in progress' : ''}{t.appointment ? ` · slot ${new Date(t.appointment).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</small>
                </div>
                <span className="c-torder-a">
                  {t.state === 'active' && <Button variant="quiet" disabled={busy} onClick={() => putBack(t)}>Put back</Button>}
                  <Button variant="quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</Button>
                  <Button variant="quiet" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</Button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Drawer>
  );
}

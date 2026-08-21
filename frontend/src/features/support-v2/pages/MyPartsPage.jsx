import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button, PageHeader, StatusPill } from '../../../components/ui/supportPrimitives';
import { consumePartRequest, listPartRequests, returnUnusedPart } from '../supportV2Api';
import { SUPPORT_V2_BASE } from '../supportV2Utils';

const GROUPS = [
  { key: 'AWAITING', title: 'Awaiting approval', match: (s) => ['REQUESTED', 'PENDING_APPROVAL'].includes(s) },
  { key: 'COLLECT', title: 'Approved — collect from warehouse', match: (s) => ['APPROVED', 'ISSUED'].includes(s) },
  { key: 'WITH_ME', title: 'With me', match: (s) => s === 'COLLECTED' || s === 'IN_TRANSIT' },
  { key: 'FITTED', title: 'Fitted', match: (s) => s === 'CONSUMED' || s === 'FITTED' },
  { key: 'RETURNED', title: 'Returned', match: (s) => ['RETURNED', 'REJECTED', 'CANCELLED'].includes(s) },
];

export default function MyPartsPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);

  const load = () => listPartRequests({ own_only: true, limit: 100 })
    .then((r) => setRows(r.data?.rows || r.data || []))
    .catch(() => setRows([]));

  useEffect(() => { load(); }, []);

  const act = async (fn, ok) => {
    try { await fn(); toast.success(ok); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <PageHeader title="My parts" subtitle="Requests you raised, and where each one is." />
      {GROUPS.map((g) => {
        const items = (Array.isArray(rows) ? rows : []).filter((r) => g.match(String(r.status_v2 || r.status || '').toUpperCase()));
        if (!items.length) return null;
        return (
          <section key={g.key}>
            <h2 className="text-[12px] font-semibold text-sup-muted uppercase tracking-wide mb-2">{g.title}</h2>
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.request_id} className="rounded-lg border border-sup-line bg-white p-3 space-y-1.5">
                  <div className="flex justify-between gap-2">
                    <div className="font-medium text-[13px]">{r.part_name || r.request_number || `Request ${r.request_id}`}</div>
                    <StatusPill status={r.status_v2} />
                  </div>
                  <p className="text-[12px] text-sup-muted">
                    {r.ttspl_id || '—'} · {r.wo_number || 'No WO'}
                    {r.reject_reason ? ` · ${r.reject_reason}` : ''}
                  </p>
                  <div className="flex gap-2">
                    {['APPROVED', 'ISSUED'].includes(r.status_v2) && (
                      <Button size="sm" onClick={() => act(() => consumePartRequest(r.request_id, { collected: true }), 'Collected')}>
                        Mark collected
                      </Button>
                    )}
                    {r.work_order_id && (
                      <Button size="sm" variant="ghost" onClick={() => nav(`${SUPPORT_V2_BASE}/jobs/${r.work_order_id}`)}>
                        Open job
                      </Button>
                    )}
                    {['ISSUED', 'COLLECTED'].includes(r.status_v2) && (
                      <Button size="sm" variant="ghost" onClick={() => act(() => returnUnusedPart(r.request_id), 'Returned')}>
                        Return unused
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {!rows.length && <p className="text-sm text-sup-muted">No part requests yet.</p>}
    </div>
  );
}

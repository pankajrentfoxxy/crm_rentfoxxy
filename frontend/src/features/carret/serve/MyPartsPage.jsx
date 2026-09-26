import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import { Button, Checkbox, EmptyState, Notice, Section } from '../../../components/carret';
import { fetchMyParts, markPartFitted } from './serveApi';
import { TECH_TABS, errMsg } from './serveShared';

/**
 * Serve → My parts (the technician's phone). Parts issued to me: sign for a
 * new challan, mark a part fitted (collecting the old one when asked), and
 * hand old parts back to the warehouse (existing screen).
 */
export default function MyPartsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [collected, setCollected] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    fetchMyParts().then(({ data: d }) => setData(d)).catch((e) => { setData({ bucket: [], awaiting: [], old_parts_bucket: [] }); toast.error(errMsg(e, 'Could not load your parts')); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const fitted = async (p) => {
    const needsOld = p.collect_old_part && p.old_part_collection_method === 'tech_collection' && p.old_part_status === 'pending';
    if (needsOld && !collected[p.id]) { toast.error('Collect the old part first, then tick it'); return; }
    setBusy(p.id);
    try {
      const { data: r } = await markPartFitted(p.id, needsOld ? { old_part_collected: true, old_part_condition: 'defective' } : {});
      toast.success(r.message || 'Marked fitted');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  const parts = (data?.bucket || []).flatMap((g) => g.parts || []).filter((p) => p.status === 'issued');
  const oldParts = (data?.old_parts_bucket || []).flatMap((g) => g.old_parts || []);
  const awaiting = data?.awaiting || [];

  return (
    <FieldShell title="My parts" tabs={TECH_TABS}>
      {data === null ? <EmptyState title="Loading…" /> : (
        <div className="c-stack">
          {awaiting.length > 0 && (
            <Section title={`To sign for · ${awaiting.length}`}>
              {awaiting.map((a) => (
                <div key={a.challan_id} className="flex items-center justify-between" style={{ gap: '8px', padding: '8px 0' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{a.challan_number}</div>
                    <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{(a.items || []).map((i) => i.part_name).join(', ')} · {a.customer_name}</div>
                  </div>
                  <Button variant="primary" onClick={() => navigate(`/support/challans/${a.challan_id}`)}>Sign</Button>
                </div>
              ))}
            </Section>
          )}
          <Section title={`With me · ${parts.length}`}>
            {parts.length === 0 ? <EmptyState title="No parts with you" /> : parts.map((p) => {
              const needsOld = p.collect_old_part && p.old_part_collection_method === 'tech_collection' && p.old_part_status === 'pending';
              return (
                <div key={p.id} className="c-card" style={{ padding: '12px', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 600 }}>{p.part_name} <span className="font-mono text-ink-3">{p.prt_id || ''}</span></div>
                  <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>For <span className="font-mono">{p.ttspl_id || p.serial_number}</span> · {p.customer_name} · {p.ticket_number}</div>
                  {p.billing_type === 'charge_customer' && <div style={{ fontSize: 'var(--d-sm)', color: 'var(--alert-warn)' }}>Chargeable to the customer</div>}
                  {needsOld && (
                    <Checkbox label="I have collected the old part from the laptop" checked={Boolean(collected[p.id])} onChange={(e) => setCollected((c) => ({ ...c, [p.id]: e.target.checked }))} />
                  )}
                  <Button variant="primary" disabled={busy === p.id} onClick={() => fitted(p)} style={{ width: '100%', marginTop: '8px', minHeight: '48px' }}>Fitted on the laptop</Button>
                </div>
              );
            })}
          </Section>
          {oldParts.length > 0 && (
            <Section title={`Old parts to return · ${oldParts.length}`}>
              <Notice tone="info" action={<Button onClick={() => navigate('/support/tech-bucket')}>Return them</Button>}>
                {oldParts.map((o) => o.part_name || o.prt_id).join(', ')}
              </Notice>
            </Section>
          )}
        </div>
      )}
    </FieldShell>
  );
}

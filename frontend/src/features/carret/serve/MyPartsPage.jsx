import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import FieldShell from '../../../shells/FieldShell';
import { Button, Checkbox, DateTime, EmptyState, Section, Select } from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { fetchMyParts, markPartFitted } from './serveApi';
import { TECH_TABS, errMsg } from './serveShared';

/**
 * Serve → My parts (the technician's phone). Parts issued to me, in the order I
 * deal with them: sign for a new challan, fit the part (collecting the old one
 * when asked), then hand old parts back to the warehouse.
 *
 * Supervisors (lead, admin, warehouse) start on their own parts too and can
 * switch to any technician who holds parts — read-only, since only the holder
 * signs and fits. Before 5 Oct a supervisor saw everyone's parts mixed under
 * "With me", each with a Fitted button.
 */
const chip = (text, tone) => (
  <span
    style={{
      display: 'inline-block',
      fontSize: '12px',
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: '999px',
      marginRight: '6px',
      background: tone === 'warn' ? 'var(--alert-warn-soft, #fef3c7)' : 'var(--accent-soft, #e0e7ff)',
      color: tone === 'warn' ? 'var(--alert-warn, #b45309)' : 'var(--accent, #1d4ed8)',
    }}
  >
    {text}
  </span>
);

const needsOldPart = (p) => p.collect_old_part && p.old_part_collection_method === 'tech_collection' && p.old_part_status === 'pending';
const laptopOf = (p) => p.ttspl_id || p.serial_number || '—';

function Count({ n, label, tone }) {
  return (
    <div className="c-card" style={{ padding: '12px' }}>
      <div style={{ fontSize: '22px', fontWeight: 600, lineHeight: 1.1, color: n && tone ? tone : undefined }}>{n}</div>
      <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{label}</div>
    </div>
  );
}

export default function MyPartsPage() {
  const navigate = useNavigate();
  const { user } = usePermission();
  const [who, setWho] = useState('me'); // 'me' | tech user_id (supervisors)
  const [data, setData] = useState(null);
  const [holders, setHolders] = useState([]);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [collected, setCollected] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setData(null);
    fetchMyParts(who === 'me' ? { mine: '1' } : { tech_id: who })
      .then(({ data: d }) => {
        setData(d);
        setIsSupervisor(Boolean(d.is_supervisor));
        if (d.is_supervisor) setHolders(d.holders || []);
      })
      .catch((e) => { setData({ bucket: [], awaiting: [], old_parts_bucket: [] }); toast.error(errMsg(e, 'Could not load the parts')); });
  }, [who]);
  useEffect(() => { load(); }, [load]);

  const own = who === 'me' || Number(who) === Number(user?.user_id);
  const holderName = own ? null : holders.find((h) => String(h.user_id) === String(who))?.name;
  const whose = own ? 'you' : (holderName || 'this technician');

  const fitted = async (p) => {
    if (needsOldPart(p) && !collected[p.id]) { toast.error('Collect the old part first, then tick the box'); return; }
    setBusy(p.id);
    try {
      const { data: r } = await markPartFitted(p.id, needsOldPart(p) ? { old_part_collected: true, old_part_condition: 'defective' } : {});
      toast.success(r.message || 'Marked fitted');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  const parts = (data?.bucket || []).flatMap((g) => g.parts || []);
  const oldParts = (data?.old_parts_bucket || []).flatMap((g) => g.old_parts || []);
  const awaiting = data?.awaiting || [];
  const nothing = data && !parts.length && !oldParts.length && !awaiting.length;

  const options = [
    { value: 'me', label: 'My parts' },
    ...holders
      .filter((h) => Number(h.user_id) !== Number(user?.user_id))
      .map((h) => ({
        value: String(h.user_id),
        label: `${h.name} — ${[h.with_them && `${h.with_them} with them`, h.to_sign && `${h.to_sign} to sign`, h.old_parts && `${h.old_parts} old`].filter(Boolean).join(', ') || 'none'}`,
      })),
  ];

  return (
    <FieldShell title={own ? 'My parts' : `${holderName || 'Technician'}'s parts`} tabs={TECH_TABS}>
      <div className="c-stack">
        {isSupervisor && (
          <div>
            <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)', marginBottom: '4px' }}>Whose parts</div>
            <Select value={who} onChange={(e) => setWho(e.target.value)} options={options} />
          </div>
        )}

        {data === null ? <EmptyState title="Loading…" /> : (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
              <Count n={awaiting.length} label="challans to sign" tone="var(--alert-warn)" />
              <Count n={parts.length} label="parts to fit" />
              <Count n={oldParts.length} label="old parts to hand back" tone="var(--alert-warn)" />
            </div>

            {nothing && (
              <EmptyState
                title={own ? 'No parts with you' : `No parts with ${whose}`}
                body={own
                  ? 'When the warehouse issues a part for one of your tickets, it shows here to sign for and fit.'
                  : 'Pick another technician above.'}
                action={<Button onClick={load}>Refresh</Button>}
              />
            )}

            {awaiting.length > 0 && (
              <Section title={`1 · Challans to sign · ${awaiting.length}`}>
                <p className="text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: 0 }}>
                  The warehouse has packed these parts. {own ? 'Sign the challan when you collect them.' : `${whose} signs when collecting them.`}
                </p>
                {awaiting.map((a) => (
                  <div key={a.challan_id} className="flex items-center justify-between" style={{ gap: '12px', padding: '10px 0', borderTop: '1px solid var(--rule)' }}>
                    <div className="min-w-0">
                      <div style={{ fontWeight: 600 }}>{a.challan_number || `Challan ${a.challan_id}`}</div>
                      <div className="text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>{(a.items || []).map((i) => `${i.part_name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')}</div>
                      <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{[a.customer_name, a.ticket_number, a.ttspl_id].filter(Boolean).join(' · ')}</div>
                    </div>
                    {own
                      ? <Button variant="primary" onClick={() => navigate(`/carret/serve/parts-challans/${a.challan_id}`)}>Sign ›</Button>
                      : <Button onClick={() => navigate(`/carret/serve/parts-challans/${a.challan_id}`)}>View</Button>}
                  </div>
                ))}
              </Section>
            )}

            {parts.length > 0 && (
              <Section title={`2 · Parts to fit · ${parts.length}`}>
                <p className="text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: 0 }}>
                  Signed for and {own ? 'with you' : `with ${whose}`}. Mark each one fitted once it is in the laptop.
                </p>
                {parts.map((p) => {
                  const returnAsked = p.status === 'return_requested';
                  return (
                    <div key={p.id} style={{ padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
                      <div className="flex items-start justify-between" style={{ gap: '8px' }}>
                        <div className="min-w-0">
                          <div style={{ fontWeight: 600 }}>{p.part_name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</div>
                          <div className="text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>
                            For <span className="font-mono">{laptopOf(p)}</span>{p.customer_name ? ` · ${p.customer_name}` : ''}
                          </div>
                          <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
                            {[p.ticket_number, p.prt_id && `Part ${p.prt_id}`].filter(Boolean).join(' · ')}
                            {p.issued_at && <> · issued <DateTime value={p.issued_at} /></>}
                          </div>
                        </div>
                      </div>
                      {(p.billing_type === 'charge_customer' || needsOldPart(p) || returnAsked) && (
                        <div style={{ marginTop: '6px' }}>
                          {returnAsked && chip('Return to warehouse requested', 'warn')}
                          {p.billing_type === 'charge_customer' && chip('Chargeable to customer', 'warn')}
                          {needsOldPart(p) && chip('Bring the old part back')}
                        </div>
                      )}
                      {own && !returnAsked && (
                        <>
                          {needsOldPart(p) && (
                            <div style={{ marginTop: '8px' }}>
                              <Checkbox label="I have taken the old part out of the laptop" checked={Boolean(collected[p.id])} onChange={(e) => setCollected((c) => ({ ...c, [p.id]: e.target.checked }))} />
                            </div>
                          )}
                          <Button variant="primary" disabled={busy === p.id} onClick={() => fitted(p)} style={{ width: '100%', marginTop: '8px', minHeight: '44px' }}>
                            {busy === p.id ? 'Saving…' : 'Fitted on the laptop'}
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </Section>
            )}

            {oldParts.length > 0 && (
              <Section
                title={`3 · Old parts to hand back · ${oldParts.length}`}
                actions={own ? <Button onClick={() => navigate('/support/tech-bucket')}>Hand back ›</Button> : null}
              >
                <p className="text-ink-3" style={{ fontSize: 'var(--d-sm)', marginTop: 0 }}>
                  Taken out of customers&apos; laptops. Return them to the warehouse.
                </p>
                {oldParts.map((o) => (
                  <div key={o.id} style={{ padding: '8px 0', borderTop: '1px solid var(--rule)' }}>
                    <div style={{ fontWeight: 600 }}>{o.part_name}{o.old_part_prt_id ? <span className="font-mono text-ink-3" style={{ fontWeight: 400 }}> · {o.old_part_prt_id}</span> : null}</div>
                    <div className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
                      From <span className="font-mono">{laptopOf(o)}</span>{o.customer_name ? ` · ${o.customer_name}` : ''}{o.ticket_number ? ` · ${o.ticket_number}` : ''}
                      {o.old_part_collected_at && <> · collected <DateTime value={o.old_part_collected_at} /></>}
                    </div>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </FieldShell>
  );
}

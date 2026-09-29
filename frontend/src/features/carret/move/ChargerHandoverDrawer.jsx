import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Button, DateTime, DocNumber, Drawer, EmptyState, Field, Input, KeyValue, Notice, Section, StatusChip,
} from '../../../components/carret';
import ScanField from '../../../components/ScanField';
import {
  approveChargerHandover, fetchAvailableChargers, fetchChargerWarehouseQueue,
} from '../../dispatch-charger/dispatchChargerApi';
import { usePermission } from '../../../hooks/usePermission';
import { CHARGER_STATUS, chargerStatusLabel, errText, kitRoleOf, laptopConfig, laptopName } from './chargerShared';

/**
 * Hand over a charger kit for one request — the same drawer from the sales
 * order, the Dispatch QC ticket and the warehouse's "Chargers to hand over".
 *
 * The request is re-read here rather than trusted from the caller, so what the
 * warehouse sees is what the server will check: laptop, order, requester. If
 * anything is missing the server's reasons are shown and there is no button —
 * the fix is at Dispatch QC (cancel and raise again), not on this desk.
 */
export default function ChargerHandoverDrawer({ requestId, onClose, onDone }) {
  const { hasPermission } = usePermission();
  const canHandOver = hasPermission('dispatch_charger_warehouse', 'edit');
  const [req, setReq] = useState({ loading: true, row: null, error: null });
  const [stock, setStock] = useState([]);
  const [stockQ, setStockQ] = useState('');
  const [adapter, setAdapter] = useState({ scan: '', unit: null });
  const [cable, setCable] = useState({ scan: '', unit: null });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!requestId) return;
    setReq({ loading: true, row: null, error: null });
    fetchChargerWarehouseQueue('all', { request_id: requestId })
      .then(({ data }) => {
        const row = (data?.data || [])[0] || null;
        setReq({ loading: false, row, error: row ? null : 'This charger request was not found or is cancelled.' });
      })
      .catch((e) => setReq({ loading: false, row: null, error: errText(e, 'Could not load the request.') }));
  }, [requestId]);

  useEffect(() => {
    setAdapter({ scan: '', unit: null });
    setCable({ scan: '', unit: null });
    setStockQ('');
    load();
  }, [load]);

  const row = req.row;
  const ready = Boolean(row?.can_hand_over) && canHandOver;

  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(() => {
      Promise.all([
        fetchAvailableChargers(stockQ || undefined, { role: 'adapter', limit: 40 }),
        fetchAvailableChargers(stockQ || undefined, { role: 'cable', limit: 40 }),
      ])
        .then(([a, c]) => setStock([...(a.data?.data || []), ...(c.data?.data || [])]))
        .catch((e) => toast.error(errText(e, 'Could not load charger stock')));
    }, stockQ ? 250 : 0);
    return () => clearTimeout(t);
  }, [ready, stockQ]);

  const adapters = useMemo(() => stock.filter((u) => (u.kit_role || kitRoleOf(u)) === 'adapter'), [stock]);
  const cables = useMemo(() => stock.filter((u) => (u.kit_role || kitRoleOf(u)) === 'cable'), [stock]);

  const findUnit = (code) => {
    const c = String(code || '').trim().toUpperCase();
    return stock.find((u) => [u.prt_id, u.asset_code, u.serial_number].some((x) => String(x || '').toUpperCase() === c)) || null;
  };
  const pick = (unit) => {
    const v = { scan: unit.prt_id || unit.asset_code || '', unit };
    if ((unit.kit_role || kitRoleOf(unit)) === 'cable') setCable(v); else setAdapter(v);
  };

  const handOver = async () => {
    if (!adapter.scan.trim() || !cable.scan.trim()) { toast.error('Scan both the adapter and the power cable'); return; }
    setSaving(true);
    try {
      const unitRef = (s) => (s.unit?.instance_id ? { instance_id: s.unit.instance_id } : { scan_code: s.scan.trim() });
      const { data } = await approveChargerHandover(row.request_id, { adapter: unitRef(adapter), cable: unitRef(cable) });
      toast.success(data?.message || 'Adapter and power cable handed over');
      onDone?.();
      onClose?.();
    } catch (e) {
      toast.error(errText(e, 'Handover failed'));
      load();
    } finally {
      setSaving(false);
    }
  };

  const status = CHARGER_STATUS[row?.status];

  return (
    <Drawer
      open={Boolean(requestId)}
      onClose={onClose}
      title={row ? `Charger kit — ${row.request_number}` : 'Charger kit'}
      width="40rem"
      footer={ready && (
        <Button variant="primary" onClick={handOver} disabled={saving || !adapter.scan.trim() || !cable.scan.trim()}>
          {saving ? 'Handing over…' : 'Hand over adapter + power cable'}
        </Button>
      )}
    >
      {req.loading && <EmptyState title="Loading the request…" />}
      {req.error && <EmptyState title="Cannot open this request" body={req.error} />}
      {row && (
        <div className="c-stack">
          <Section title="Laptop">
            <KeyValue
              cols={2}
              items={[
                { label: 'TTSPL', value: row.ttspl_id ? <Link to={`/carret/stock/assets/${encodeURIComponent(row.ttspl_id)}`}><DocNumber value={row.ttspl_id} /></Link> : null },
                { label: 'Serial', value: row.serial_number },
                { label: 'Brand / model', value: laptopName(row) },
                { label: 'Configuration', value: laptopConfig(row) },
              ]}
            />
          </Section>
          <Section title="Order">
            <KeyValue
              cols={2}
              items={[
                { label: 'Sales order', value: row.sales_order_number ? <Link to={`/carret/sell/sales-orders/${encodeURIComponent(row.sales_order_number)}`}><DocNumber value={row.sales_order_number} /></Link> : null },
                { label: 'Customer', value: row.customer_name },
                { label: 'Dispatch QC ticket', value: row.ticket_id ? <Link to={`/floor-pipeline/tickets/${row.ticket_id}`}>#{row.ticket_id}{row.ticket_stage ? ` · ${row.ticket_stage}` : ''}</Link> : null },
                { label: 'Challan', value: row.dc_number ? <DocNumber value={row.dc_number} /> : null },
              ]}
            />
          </Section>
          <Section title="Request">
            <KeyValue
              cols={2}
              items={[
                { label: 'Status', value: <StatusChip status={status?.chip || row.status} label={chargerStatusLabel(row.status)} /> },
                { label: 'Requested by', value: row.requested_by_name ? `${row.requested_by_name}${row.requested_by_role ? ` (${row.requested_by_role})` : ''}` : null },
                { label: 'Requested at', value: row.requested_at ? <DateTime value={row.requested_at} /> : null },
                { label: 'Remarks', value: row.remarks },
                row.handed_over_by_name && { label: 'Handed over by', value: <>{row.handed_over_by_name} · <DateTime value={row.handed_over_at} /></> },
                (row.adapter_label || row.cable_label) && { label: 'Kit', value: [row.adapter_label, row.cable_label].filter(Boolean).join(' + ') },
              ]}
            />
          </Section>

          {row.status === 'pending' && row.handover_blockers?.length > 0 && (
            <Notice tone="serious" title="Cannot hand over yet">
              <ul className="m-0" style={{ paddingLeft: '1.1rem' }}>
                {row.handover_blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
              Fix it at Dispatch QC: cancel this request on the ticket and raise it again.
            </Notice>
          )}
          {row.status === 'pending' && row.can_hand_over && !canHandOver && (
            <Notice tone="info" title="Waiting for the warehouse">Only the warehouse can hand a charger kit over.</Notice>
          )}
          {row.status !== 'pending' && (
            <Notice tone="info" title={chargerStatusLabel(row.status)}>Nothing to hand over for this request.</Notice>
          )}

          {ready && (
            <Section title="Scan the kit">
              <div className="c-stack">
                <Field label="1. Laptop charger / power adapter" hint={adapter.unit?.part_name || 'Scan the PRT label or pick below'}>
                  <ScanField
                    value={adapter.scan}
                    onChange={(v) => setAdapter({ scan: v, unit: null })}
                    onScan={(code) => setAdapter({ scan: code, unit: findUnit(code) })}
                    placeholder="Scan adapter PRT"
                    aria-label="Scan adapter"
                  />
                </Field>
                <Field label="2. Power cable" hint={cable.unit?.part_name || 'Scan the PRT label or pick below'}>
                  <ScanField
                    value={cable.scan}
                    onChange={(v) => setCable({ scan: v, unit: null })}
                    onScan={(code) => setCable({ scan: code, unit: findUnit(code) })}
                    placeholder="Scan power cable PRT"
                    aria-label="Scan power cable"
                  />
                </Field>
                <Field label="In stock">
                  <Input value={stockQ} onChange={(e) => setStockQ(e.target.value)} placeholder="Search adapters and cables" />
                </Field>
                <StockList title="Adapters" units={adapters} picked={adapter.unit} onPick={pick} />
                <StockList title="Power cables" units={cables} picked={cable.unit} onPick={pick} />
              </div>
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function StockList({ title, units, picked, onPick }) {
  return (
    <div>
      <div className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)', fontWeight: 600, marginBottom: '4px' }}>{title}</div>
      {!units.length && <p className="font-ui text-ink-3 m-0" style={{ fontSize: 'var(--d-sm)' }}>None in stock.</p>}
      <div className="flex flex-wrap" style={{ gap: '6px', maxHeight: '9rem', overflowY: 'auto' }}>
        {units.map((u) => (
          <Button
            key={u.instance_id}
            variant={picked?.instance_id === u.instance_id ? 'primary' : 'quiet'}
            onClick={() => onPick(u)}
            title={u.part_name}
          >
            {u.prt_id || u.asset_code}
          </Button>
        ))}
      </div>
    </div>
  );
}

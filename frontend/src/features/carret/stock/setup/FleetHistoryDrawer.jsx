import React, { useEffect, useState } from 'react';
import {
  DataTable, DateTime, DocNumber, Drawer, EmptyState, KeyValue, Money, Notice, Section, StatusChip, Timeline,
} from '../../../../components/carret';
import { usePermission } from '../../../../hooks/usePermission';
import { fetchTtsplHistory } from '../../../floor-pipeline/floorPipelineApi';
import { errMsg } from './partsApi';

/**
 * One laptop's history, opened in place from Stock → With customers for people
 * who cannot open the asset record (/carret/stock/assets/:ttspl is
 * inventory_management; this list is customer_inventory).
 *
 * Same source as the old fleet page's TtsplHistoryDrawer:
 * GET /tickets/ttspl/:id/history. That route is guarded by any of
 * HISTORY_SECTIONS (backend/routes/tickets.js) — NOT customer_inventory — so a
 * fleet-only user gets the row's own facts and a note instead of a 403.
 */
const HISTORY_SECTIONS = ['ttspl_history', 'dispatch_qc', 'floor_pipeline', 'floor_tickets', 'qc_management'];

const humanise = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const CONFIG_COLS = [
  { key: 'd', header: 'Date', render: (h) => <DateTime value={h.created_at} /> },
  { key: 'f', header: 'Field', render: (h) => humanise(h.field_name) },
  { key: 'c', header: 'Before → after', render: (h) => <>{h.old_value || '—'} → <strong>{h.new_value || '—'}</strong></> },
  { key: 'p', header: 'Cost', numeric: true, render: (h) => <Money value={h.part_cost} showZero={false} /> },
];

export default function FleetHistoryDrawer({ row, onClose }) {
  const { hasPermission } = usePermission();
  const canHistory = HISTORY_SECTIONS.some((s) => hasPermission(s, 'view'));
  const ttspl = row?.ttspl_id || null;
  const [hist, setHist] = useState(null);

  useEffect(() => {
    if (!ttspl || !canHistory) return undefined;
    let live = true;
    setHist(null);
    fetchTtsplHistory(ttspl)
      .then(({ data }) => { if (live) setHist(data || {}); })
      .catch((e) => {
        if (!live) return;
        setHist({ error: e?.response?.status === 403 ? 'forbidden' : errMsg(e) });
      });
    return () => { live = false; };
  }, [ttspl, canHistory]);

  const events = (hist?.auditLog || []).map((ev) => ({
    event_id: ev.log_id,
    occurred_at: ev.created_at,
    event_type: humanise(ev.event_type),
    actor_name: ev.actor_name_resolved || ev.actor_name,
    note: ev.description,
  }));
  const forbidden = !canHistory || hist?.error === 'forbidden';

  let history;
  if (!ttspl) history = <EmptyState title="No TTSPL on this laptop" body="History is kept against the TTSPL code." />;
  else if (forbidden) {
    history = (
      <Notice tone="info" title="History needs laptop-history access">
        Ask an admin for TTSPL history (view) to see this laptop&apos;s timeline here.
      </Notice>
    );
  } else if (hist === null) history = <EmptyState title="Loading…" />;
  else if (hist.error) history = <Notice tone="crit" title="The history did not load">{hist.error}</Notice>;
  else history = <Timeline events={events} />;

  return (
    <Drawer open={Boolean(row)} onClose={onClose} title={ttspl || row?.serial_number || 'Laptop'} width="40rem">
      {row && (
        <div className="c-stack">
          <KeyValue
            cols={2}
            items={[
              { label: 'Serial', value: row.serial_number },
              { label: 'Model', value: [row.brand, row.model].filter(Boolean).join(' ') },
              { label: 'Configuration', value: [row.processor, row.generation, row.ram, row.storage].filter(Boolean).join(' · ') },
              { label: 'State', value: row.inventory_status ? <StatusChip status={row.inventory_status} /> : null },
              { label: 'Customer', value: row.company_name || row.customer_name },
              { label: 'Challan', value: row.dc_number ? <DocNumber value={row.dc_number} /> : null },
              { label: 'Sales order', value: row.sales_order_number },
              { label: 'Delivered', value: row.delivered_at ? <DateTime value={row.delivered_at} /> : null },
            ]}
          />
          <Section title="History">{history}</Section>
          {!forbidden && hist?.configHistory?.length > 0 && (
            <Section title="Configuration changes">
              <DataTable columns={CONFIG_COLS} rows={hist.configHistory} rowKey={(h) => h.history_id} />
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}

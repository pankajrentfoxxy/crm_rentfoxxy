import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, EmptyState, Notice, Section, StatusChip,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { LAPTOP_CONDITIONS } from '../../../constants/laptopConditions';
import api from '../../../utils/api';
import AddSerialDrawer from './AddSerialDrawer';
import { errMsg } from './procureShared';

/**
 * Procurement → Serials to add (428).
 *
 * Laptops received on GRN without a serial number — they would not power on
 * and had no readable sticker. They are on the floor under their TTSPL; once
 * one powers on, its serial is added here. Until then it can't be allocated.
 * View needs grn_pending_serial:view, adding needs :edit.
 */
export default function PendingSerialsPage() {
  const { hasPermission } = usePermission();
  const canAdd = hasPermission('grn_pending_serial', 'edit');
  const [rows, setRows] = useState(null);
  const [addFor, setAddFor] = useState(null);

  const load = useCallback(() => {
    api.get('/vendor-management/serials/pending-serial')
      .then(({ data }) => setRows(data.data || []))
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load')); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const columns = [
    { key: 't', header: 'Asset', render: (r) => <DocNumber value={r.ttspl_id} />, sub: () => <span style={{ color: 'var(--alert-warn)' }}>Serial pending</span> },
    { key: 'l', header: 'Laptop', render: (r) => [r.brand, r.model].filter(Boolean).join(' ') || '—', sub: (r) => [r.processor, r.generation, r.ram, r.storage].filter(Boolean).join(' · ') || null },
    { key: 'c', header: 'Condition', render: (r) => LAPTOP_CONDITIONS.find((c) => c.value === r.received_condition)?.label || r.received_condition || '—' },
    { key: 'p', header: 'Purchase order', render: (r) => r.purchase_order_number || '—', sub: (r) => r.vendor_name },
    { key: 's', header: 'Stage', render: (r) => (r.inventory_status ? <StatusChip status={r.inventory_status} /> : '—'), sub: (r) => (r.ticket_id ? `Ticket #${r.ticket_id}${r.stage_name ? ` · ${r.stage_name}` : ''}` : null) },
    { key: 'r', header: 'Received', render: (r) => <DateTime value={r.received_at} /> },
    { key: 'a', header: '', render: (r) => canAdd && <Button variant="primary" onClick={() => setAddFor(r)}>Add serial</Button> },
  ];

  return (
    <DeskShell title="Serials to add" breadcrumb="Procurement">
      <div className="c-stack">
        <Notice tone="info" title="Laptops received without a serial number">
          They would not power on at GRN. Once one does, read its serial and add it here — it can't be put on an order until then.
        </Notice>
        <Section title={rows ? `Waiting · ${rows.length}` : 'Waiting'}>
          {rows === null
            ? <EmptyState title="Loading…" />
            : <DataTable columns={columns} rows={rows} rowKey={(r) => r.serial_id} empty={<EmptyState title="No laptop is waiting for a serial" />} />}
        </Section>
      </div>
      <AddSerialDrawer unit={addFor} onClose={() => setAddFor(null)} onSaved={load} />
    </DeskShell>
  );
}

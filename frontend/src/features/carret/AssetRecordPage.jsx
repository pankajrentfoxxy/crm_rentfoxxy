import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import {
  DocumentHeader, StatusChip, EntityEdge, StatTile, Timeline,
  DataTable, Money, DocNumber, DateTime, EmptyState, Button,
} from '../../components/carret';
import { statusFamily } from '../../config/statuses';
import { ASSET_FIXTURE, ASSET_TIMELINE_FIXTURE, ASSET_DOCUMENTS_FIXTURE } from './fixtures/assetTimeline';

/**
 * Phase 7 — the one screen built end to end, so the foundation is proven before
 * five more parts are built on it.
 *
 * It exercises almost every primitive: DocumentHeader, StatusChip, EntityEdge,
 * StatTile, Timeline, DataTable, Money, DocNumber, DateTime and EmptyState.
 * If the token system, the density dial or the theme switch is wrong, it is
 * wrong here first and cheaply.
 *
 * The Timeline runs on a fixture until Part 2.1 builds the events table. That
 * is the only fabricated data on this page, and it is labelled on screen — a
 * screen that quietly shows invented numbers is exactly the habit the audit
 * found (finding I11), and this part must not add to it.
 */
export default function AssetRecordPage() {
  const { ttspl } = useParams();
  const asset = useMemo(() => ({ ...ASSET_FIXTURE, ttspl_id: ttspl || ASSET_FIXTURE.ttspl_id }), [ttspl]);

  const columns = useMemo(() => [
    { key: 'doc', header: 'Document', render: (r) => <DocNumber value={r.doc} /> },
    { key: 'type', header: 'Type' },
    { key: 'date', header: 'Date', render: (r) => <DateTime value={r.date} /> },
    { key: 'status', header: 'Asset state after', render: (r) => <StatusChip status={r.status} /> },
    { key: 'amount', header: 'Amount', numeric: true, render: (r) => <Money value={r.amount} showZero={false} /> },
  ], []);

  const config = [asset.brand, asset.model, asset.processor, asset.generation, asset.ram, asset.storage]
    .filter(Boolean).join(' · ');

  return (
    <DeskShell
      title={asset.ttspl_id}
      breadcrumb="Stock / Assets"
      actions={<Button variant="secondary">Export</Button>}
    >
      <div style={{ display: 'grid', gap: 'var(--d-pad-x)' }}>
        <DocumentHeader
          docNumber={asset.ttspl_id}
          type="Asset"
          entity={asset.entity}
          status={asset.inventory_status}
          meta={[
            { label: 'Serial', value: <DocNumber value={asset.serial_number} /> },
            { label: 'Configuration', value: config },
            { label: 'Customer', value: asset.customer_name },
            { label: 'Vendor', value: asset.vendor_name },
            { label: 'Rent from', value: <DateTime value={asset.rent_start_date} /> },
            { label: 'Billed until', value: <DateTime value={asset.rent_billed_until} /> },
          ]}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--d-pad-x)' }}>
          <StatTile label="Monthly rent" value={<Money value={asset.rent_monthly_rate} />} family={statusFamily(asset.inventory_status)} />
          <StatTile label="Lifecycle state" value={asset.inventory_status} family={statusFamily(asset.inventory_status)} />
          <StatTile label="QC state" value={asset.qc_status} />
          <StatTile label="Current challan" value={<DocNumber value={asset.current_dc_number} />} />
          {/* No tile without a real figure behind it — this one says so. */}
          <StatTile label="Lifetime revenue" value={null} />
        </div>

        <EntityEdge entity={asset.entity} showLabel>
          <section>
            <h2 className="font-ui text-ink" style={{ fontSize: 'var(--d-lg)', fontWeight: 600, marginBottom: 'var(--d-gap)' }}>
              Documents
            </h2>
            <DataTable
              columns={columns}
              rows={ASSET_DOCUMENTS_FIXTURE}
              rowKey={(r) => r.doc}
              empty={<EmptyState title="No documents yet" body="Purchase orders, challans and invoices appear here." />}
            />
          </section>
        </EntityEdge>

        <section>
          <div className="flex items-baseline flex-wrap" style={{ gap: 'var(--d-pad-x)', marginBottom: 'var(--d-gap)' }}>
            <h2 className="font-ui text-ink m-0" style={{ fontSize: 'var(--d-lg)', fontWeight: 600 }}>Timeline</h2>
            <span
              className="font-ui"
              style={{
                fontSize: 'var(--d-sm)', color: 'var(--alert-warn)',
                border: '1px solid var(--alert-warn)', borderRadius: 'var(--d-radius)',
                padding: '0 var(--d-pad-x)',
              }}
            >
              Fixture data — wired to the events table in Part 2.1
            </span>
          </div>
          <Timeline events={ASSET_TIMELINE_FIXTURE} />
        </section>
      </div>
    </DeskShell>
  );
}

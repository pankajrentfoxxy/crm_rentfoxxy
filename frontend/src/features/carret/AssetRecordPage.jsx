import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import {
  DocumentHeader, StatusChip, EntityEdge, StatTile, Timeline,
  DataTable, Money, DocNumber, DateTime, EmptyState, Button,
} from '../../components/carret';
import { statusFamily } from '../../config/statuses';
import useAssetTimeline from './useAssetTimeline';

/**
 * The asset record — Part 1's proving screen, now on real data (Part 2.7).
 *
 * The Timeline reads the events table built in Part 2.1, which is the first
 * time this system can render a laptop's whole life in one place: PO, GRN,
 * production, QC, sales order, DC, gate, delivery, support, return and
 * billing. Before 2.1 that history was split across two logs that disagreed
 * (finding I15) and could not be joined.
 *
 * Nothing on this page is fabricated. Where a figure has no source yet, the
 * tile says so rather than showing a confident zero — the habit finding I11 is
 * about.
 */
export default function AssetRecordPage() {
  const { ttspl } = useParams();
  const { loading, error, asset, events } = useAssetTimeline(ttspl);

  const documentColumns = useMemo(() => [
    { key: 'ref', header: 'Reference', render: (r) => <DocNumber value={r.ref} /> },
    { key: 'event_type', header: 'Event' },
    { key: 'occurred_at', header: 'When', render: (r) => <DateTime value={r.occurred_at} format="datetime" /> },
    { key: 'actor_name', header: 'Actor' },
    {
      key: 'to_state',
      header: 'State after',
      render: (r) => (r.to_state ? <StatusChip status={r.to_state} /> : <span className="text-ink-3">—</span>),
    },
  ], []);

  /** The document-shaped events, which is what a reader scanning for paperwork wants. */
  const documents = useMemo(() => {
    const DOCUMENT_EVENTS = /grn|challan|invoice|order|credit|dispatch|delivered|gate/i;
    return events
      .filter((e) => e.entity_ref || DOCUMENT_EVENTS.test(e.event_type || ''))
      .filter((e) => e.entity_ref && e.entity_ref !== asset?.ttspl_id)
      .slice(0, 50)
      .map((e) => ({ ...e, ref: e.entity_ref }));
  }, [events, asset]);

  const config = useMemo(() => {
    const x = asset?.extra || {};
    return [x.brand, x.model || x.model_name, x.processor, x.generation, x.ram, x.storage]
      .filter(Boolean).join(' · ');
  }, [asset]);

  const entity = asset?.current_entity === 'gorefurbo' ? 'sale' : 'rental';

  if (loading) {
    return (
      <DeskShell title={ttspl} breadcrumb="Stock / Assets">
        <EmptyState title="Loading…" body={`Fetching ${ttspl}.`} />
      </DeskShell>
    );
  }

  if (error) {
    return (
      <DeskShell title={ttspl} breadcrumb="Stock / Assets">
        <EmptyState title="Not available" body={error} />
      </DeskShell>
    );
  }

  return (
    <DeskShell
      title={asset?.ttspl_id || ttspl}
      breadcrumb="Stock / Assets"
      actions={<Button variant="secondary" onClick={() => window.print()}>Print</Button>}
    >
      <div style={{ display: 'grid', gap: 'var(--d-pad-x)' }}>
        <DocumentHeader
          docNumber={asset?.ttspl_id || ttspl}
          type="Asset"
          entity={entity}
          status={asset?.inventory_status}
          meta={[
            { label: 'Serial', value: <DocNumber value={asset?.serial_number} /> },
            { label: 'Configuration', value: config || '—' },
            { label: 'QC status', value: asset?.qc_status || '—' },
            { label: 'Current challan', value: asset?.current_dc_number ? <DocNumber value={asset.current_dc_number} /> : '—' },
            { label: 'Rent from', value: <DateTime value={asset?.rent_start_date} /> },
            { label: 'Billed until', value: <DateTime value={asset?.rent_billed_until} /> },
          ]}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--d-pad-x)' }}>
          <StatTile
            label="Lifecycle state"
            value={asset?.inventory_status || 'awaiting GRN'}
            family={statusFamily(asset?.inventory_status)}
          />
          <StatTile label="Monthly rent" value={<Money value={asset?.rent_monthly_rate} showZero={false} />} />
          <StatTile label="Events recorded" value={events.length} />
          <StatTile
            label="With a customer"
            value={asset?.current_customer_id ? 'Yes' : 'No'}
            family={asset?.current_customer_id ? 'earning' : 'idle'}
          />
        </div>

        {/* The un-GRN'd bucket from decision D1 — 1,345 laptops in this state,
            and until Part 2.5 every one of them read as in_stock. Saying so on
            the record is cheaper than someone rediscovering it. */}
        {!asset?.inventory_status && (
          <div
            className="font-ui"
            style={{
              padding: 'var(--d-pad-x)', borderRadius: 'var(--d-radius)',
              border: '1px solid var(--alert-warn)', color: 'var(--alert-warn)',
              fontSize: 'var(--d-base)',
            }}
          >
            This asset has no lifecycle status. It has a TTSPL code and a serial number but has
            not been through GRN, so it is not available to attach or sell.
          </div>
        )}

        <EntityEdge entity={entity} showLabel>
          <section>
            <h2 className="font-ui text-ink" style={{ fontSize: 'var(--d-lg)', fontWeight: 600, marginBottom: 'var(--d-gap)' }}>
              Documents and movements
            </h2>
            <DataTable
              columns={documentColumns}
              rows={documents}
              rowKey={(r) => r.event_id}
              empty={<EmptyState title="No documents yet" body="Purchase orders, challans and invoices appear here as they are raised." />}
            />
          </section>
        </EntityEdge>

        <section>
          <h2 className="font-ui text-ink" style={{ fontSize: 'var(--d-lg)', fontWeight: 600, marginBottom: 'var(--d-gap)' }}>
            Timeline
          </h2>
          <Timeline events={events} />
        </section>
      </div>
    </DeskShell>
  );
}

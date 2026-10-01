import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DeskShell from '../../shells/DeskShell';
import {
  DocumentHeader, StatusChip, Panel, StatTile, Timeline,
  DataTable, Money, DocNumber, DateTime, EmptyState, Button, KeyValue, Notice,
} from '../../components/carret';
import { usePermission } from '../../hooks/usePermission';
import { fetchAsset } from './stock/stockApi';
import { LocationDrawer, RetagDrawer, ScrapRequestDrawer } from './stock/StockActions';
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
  // Stock facts + actions (claude/carret-stock.md): tag, slot, PO, vendor, scrap.
  const { hasPermission } = usePermission();
  const [stock, setStock] = useState(null);
  const [act, setAct] = useState(null);
  const loadStock = useCallback(() => {
    fetchAsset(ttspl).then(({ data }) => setStock(data.data)).catch(() => setStock(null));
  }, [ttspl]);
  useEffect(() => { loadStock(); }, [loadStock]);
  const done = () => { setAct(null); loadStock(); };
  const canWarehouse = hasPermission('ready_to_rent_location', 'edit');
  const canRaiseScrap = ['inventory_management', 'floor_tickets', 'qc_management', 'ready_to_rent_location'].some((sec) => hasPermission(sec, 'edit'));
  const scrappable = stock && ['in_stock', 'in_repair', 'returned', 'qc_failed'].includes(stock.inventory_status)
    && stock.scrap_request?.status !== 'pending';

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
      actions={(
        <div className="flex" style={{ gap: '6px' }}>
          <Link to={`/carret/stock/lifecycle/${encodeURIComponent(asset?.ttspl_id || ttspl)}`} className="c-btn">Lifecycle</Link>
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      )}
    >
      <div style={{ display: 'grid', gap: '16px' }}>
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

        {stock && (
          <Panel
            title="Stock"
            actions={(
              <div className="flex" style={{ gap: '6px' }}>
                {canWarehouse && stock.is_ready && <Button onClick={() => setAct('tag')}>Tag</Button>}
                {canWarehouse && stock.is_ready && <Button onClick={() => setAct('slot')}>{stock.location ? 'Move slot' : 'Put in a slot'}</Button>}
                {canRaiseScrap && scrappable && <Button variant="quiet" onClick={() => setAct('scrap')}>Scrap…</Button>}
              </div>
            )}
          >
            <div className="c-card-b c-stack">
              {stock.scrap_request?.status === 'pending' && <Notice tone="warn" title="Scrap requested">{stock.scrap_request.reason} — waiting for a manager on Stock → Scrap.</Notice>}
              {stock.inventory_status === 'in_stock' && !stock.is_ready && <Notice tone="info">In stock but not ready: QC status is “{stock.qc_status || 'none'}”. It becomes ready only after QC passes and it is scanned into a carret slot (Production → Into stock).</Notice>}
              <KeyValue
                cols={4}
                items={[
                  { label: 'Ready', value: stock.is_ready ? 'Yes' : 'No' },
                  { label: 'Use for', value: stock.tag_label || (stock.is_ready ? 'Not tagged' : '—') },
                  { label: 'Carret slot', value: stock.location || (stock.is_ready ? 'No slot' : '—') },
                  { label: 'Customer', value: stock.customer_name ? <Link to={`/carret/sell/customers/${stock.current_customer_id}`}>{stock.customer_name}</Link> : '—' },
                  { label: 'Purchase order', value: stock.purchase_order_number || '—' },
                  { label: 'Vendor', value: stock.vendor_name || '—' },
                  { label: 'Lock-in till', value: stock.lock_in_end_date ? <DateTime value={stock.lock_in_end_date} /> : '—' },
                  { label: 'Warranty till', value: stock.warranty_end_date ? <DateTime value={stock.warranty_end_date} /> : '—' },
                  stock.scrap_challan_number && { label: 'Scrap challan', value: <DocNumber value={stock.scrap_challan_number} /> },
                ]}
              />
              <p className="text-ink-3" style={{ fontSize: '12px' }}>
                History from the old ERP: <Link to={`/inventory-management/serial-number-status?serial=${encodeURIComponent(stock.serial_number || '')}`}>serial status (old view)</Link>
              </p>
            </div>
          </Panel>
        )}
        <RetagDrawer laptops={act === 'tag' && stock ? [stock] : null} onClose={() => setAct(null)} onDone={done} />
        <LocationDrawer laptop={act === 'slot' ? stock : null} onClose={() => setAct(null)} onDone={done} />
        <ScrapRequestDrawer laptop={act === 'scrap' ? stock : null} onClose={() => setAct(null)} onDone={done} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <StatTile
            label="Lifecycle state"
            value={asset?.inventory_status || 'awaiting GRN'}
            family={statusFamily(asset?.inventory_status)}
          />
          {/* Rent only while it is with a customer; in stock the row keeps the last customer's rate. */}
          <StatTile
            label={['rented', 'on_demo'].includes(asset?.inventory_status) ? 'Monthly rent' : 'Last monthly rent'}
            value={<Money value={asset?.rent_monthly_rate} showZero={false} />}
          />
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
              padding: '12px 16px', borderRadius: 'var(--d-radius-lg)',
              border: '1px solid var(--alert-warn)', color: 'var(--alert-warn)',
              background: 'var(--surface)',
              fontSize: 'var(--d-base)',
            }}
          >
            This asset has no lifecycle status. It has a TTSPL code and a serial number but has
            not been through GRN, so it is not available to attach or sell.
          </div>
        )}

        <Panel entity={entity} title="Documents and movements">
          <DataTable
            columns={documentColumns}
            rows={documents}
            rowKey={(r) => r.event_id}
            empty={<EmptyState title="No documents yet" body="Purchase orders, challans and invoices appear here as they are raised." />}
          />
        </Panel>

        <Panel title="Timeline">
          <div className="c-card-b">
            <Timeline events={events} />
          </div>
        </Panel>
      </div>
    </DeskShell>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DocNumber, DocumentHeader, EmptyState, Field, FormGrid, Input, KeyValue, Money, Notice, Section,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { fileUrl } from '../procure/procureShared';
import {
  fetchPartDc, fetchPartReturnDc, markPartDcDelivered, receivePartReturnDc, setPartDcCourier, setPartReturnDcCourier,
} from './serveApi';
import { errMsg } from './serveShared';

/**
 * Support → Parts desk → Part DC record (replaces the old
 * /support-parts/part-dcs/:no and /support-parts/part-return-dcs/:no pages,
 * same endpoints).
 *   kind="customer"  a part sent to the customer: courier details (→ in transit),
 *                    delivered, PDF, internal laptop costing.
 *   kind="return"    old parts coming back (RPDC): courier details, received.
 * Writes need support_part_challan edit (backend requireWarehouseEdit).
 */
const SHIP_LABEL = { by_courier: 'Courier', by_hand: 'By hand' };
const STATUS_LABEL = { processing: 'Awaiting courier details', in_transit: 'In transit', delivered: 'Delivered' };

const customerCols = [
  { key: 'p', header: 'Part', render: (r) => r.part_name, sub: (r) => r.prt_id || null },
  { key: 't', header: 'Laptop', render: (r) => (r.ttspl_id ? <DocNumber value={r.ttspl_id} /> : '—') },
  { key: 'b', header: 'Charge', render: (r) => (r.billing_type === 'charge_customer' ? <Money value={r.charge_amount} /> : r.billing_type === 'under_warranty' ? 'Under warranty' : 'Free') },
  { key: 's', header: 'Status', render: (r) => String(r.status || '').replace(/_/g, ' ') },
];
const returnCols = [
  { key: 'p', header: 'Part', render: (r) => r.part_name },
  { key: 'o', header: 'Old part', render: (r) => r.old_part_prt_id || 'Expected old part', sub: (r) => r.old_part_condition || null },
  { key: 't', header: 'Laptop', render: (r) => (r.ttspl_id ? <DocNumber value={r.ttspl_id} /> : '—') },
];

export default function PartDcRecordPage({ kind = 'customer' }) {
  const isReturn = kind === 'return';
  const { dcNumber: raw } = useParams();
  const dcNumber = decodeURIComponent(raw || '');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canEdit = hasPermission('support_part_challan', 'edit');

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [courier, setCourier] = useState({ name: '', awb: '', url: '' });
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(() => {
    (isReturn ? fetchPartReturnDc(dcNumber) : fetchPartDc(dcNumber))
      .then(({ data: d }) => {
        setData(d);
        setCourier({ name: d.dc?.courier_name || '', awb: d.dc?.awb_number || '', url: d.dc?.courier_tracking_url || '' });
      })
      .catch((e) => setError(errMsg(e, 'Could not load the Part DC.')));
  }, [dcNumber, isReturn]);
  useEffect(() => { load(); }, [load]);

  const title = isReturn ? 'Old-part return DC' : 'Part DC';
  const back = <Button onClick={() => navigate('/carret/serve/parts-desk?tab=dcs')}>Parts desk</Button>;
  if (error) return <DeskShell title={dcNumber} breadcrumb="Support / Parts desk"><EmptyState title={`Could not load this ${title}`} body={error} action={back} /></DeskShell>;
  if (!data?.dc) return <DeskShell title={dcNumber} breadcrumb="Support / Parts desk"><EmptyState title="Loading…" /></DeskShell>;

  const dc = data.dc;
  const parts = data.parts || [];
  const costs = data.laptop_costs || [];
  const needsCourier = isReturn
    ? dc.status === 'processing' && dc.ship_by === 'by_courier' && !dc.courier_name
    : dc.ship_by === 'by_courier' && ['processing', 'in_transit'].includes(dc.status) && !dc.courier_name;
  const canFinish = isReturn ? ['in_transit', 'processing'].includes(dc.status) : dc.status === 'in_transit';

  const saveCourier = async () => {
    setBusy('courier');
    try {
      const body = { courier_name: courier.name.trim(), awb_number: courier.awb.trim() || null, courier_tracking_url: courier.url.trim() || null };
      const { data: r } = await (isReturn ? setPartReturnDcCourier(dcNumber, body) : setPartDcCourier(dcNumber, body));
      toast.success(r?.message || 'Courier saved');
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  const finish = async () => {
    setBusy('finish');
    try {
      const { data: r } = await (isReturn ? receivePartReturnDc(dcNumber) : markPartDcDelivered(dcNumber));
      toast.success(r?.message || (isReturn ? 'Received' : 'Delivered'));
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };

  return (
    <DeskShell title={dcNumber} breadcrumb="Support / Parts desk" subtitle={dc.customer_name}>
      <div className="c-stack">
        <DocumentHeader
          docNumber={dcNumber}
          type={title}
          status={dc.status === 'delivered' ? 'completed' : dc.status === 'processing' ? 'pending' : 'processing'}
          actions={(
            <>
              {dc.pdf_path && <a className="c-btn" href={fileUrl(dc.pdf_path)} target="_blank" rel="noopener noreferrer">PDF</a>}
              {canEdit && canFinish && <Button variant="primary" disabled={busy === 'finish'} onClick={() => setConfirm(true)}>{isReturn ? 'Received' : 'Delivered'}</Button>}
            </>
          )}
          meta={[
            { label: 'Status', value: STATUS_LABEL[dc.status] || dc.status },
            { label: 'Ticket', value: dc.ticket_id ? <Link to={`/carret/serve/tickets/${dc.ticket_id}`}>{dc.ticket_number}</Link> : (dc.ticket_number || '—') },
            { label: 'Customer', value: dc.customer_name || '—' },
            { label: 'Travels by', value: SHIP_LABEL[dc.ship_by] || dc.ship_by || '—' },
            ...(dc.sales_order_number ? [{ label: 'Sales order', value: dc.sales_order_number }] : []),
          ]}
        />
        {!isReturn && parts[0]?.billing_type === 'under_warranty' && <Notice tone="info">Under warranty — no charge to the customer.</Notice>}

        {needsCourier && canEdit && (
          <Section title="Courier details">
            <FormGrid cols={3}>
              <Field label="Courier" required><Input value={courier.name} onChange={(e) => setCourier({ ...courier, name: e.target.value })} /></Field>
              <Field label="AWB / tracking number"><Input value={courier.awb} onChange={(e) => setCourier({ ...courier, awb: e.target.value })} /></Field>
              <Field label="Tracking link"><Input value={courier.url} onChange={(e) => setCourier({ ...courier, url: e.target.value })} /></Field>
            </FormGrid>
            <div className="flex justify-end" style={{ marginTop: '12px' }}>
              <Button variant="primary" disabled={busy === 'courier' || !courier.name.trim()} onClick={saveCourier}>{isReturn ? 'Save courier' : 'Save courier — in transit'}</Button>
            </div>
          </Section>
        )}

        <Section title={`Parts · ${parts.length}`}>
          <DataTable columns={isReturn ? returnCols : customerCols} rows={parts} rowKey={(r) => r.id} empty={<EmptyState title="No parts" />} />
        </Section>

        <Section title="Details">
          <KeyValue cols={2} items={[
            { label: 'Courier', value: [dc.courier_name, dc.awb_number && `AWB ${dc.awb_number}`].filter(Boolean).join(' · ') || '—' },
            { label: 'Tracking', value: dc.courier_tracking_url ? <a href={dc.courier_tracking_url} target="_blank" rel="noopener noreferrer">Open</a> : '—' },
            ...costs.map((c) => ({ label: `Our cost — ${c.part_name} on ${c.ttspl_id}`, value: <>{<Money value={c.unit_cost} />} ({String(c.billing_type || '').replace(/_/g, ' ')})</> })),
          ]}
          />
        </Section>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={finish}
        title={isReturn ? `Old parts on ${dcNumber} received?` : `Mark ${dcNumber} delivered?`}
        body={isReturn ? 'The old parts are booked back into the warehouse.' : 'The customer has the part.'}
        confirmLabel={isReturn ? 'Received' : 'Delivered'}
        tone="good"
      />
    </DeskShell>
  );
}

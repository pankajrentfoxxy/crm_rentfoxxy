import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, Input, Money, Notice, Segmented, StatusChip,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { recordVendorBuyout, SALE_IN_PLACE_REASONS } from '../../../utils/saleInPlaceApi';
import { SO_SECTIONS } from './sellShared';

/**
 * Sell → Sale in place: a customer keeps a laptop they hold on rent because it
 * is lost, damaged beyond repair, or they buy it. No challan, no e-way bill.
 *
 *   New sale in place  → /carret/sell/sale-in-place/new (stop rent + sale order,
 *                        POST /customer-management/customers/:id/sale-in-place/sale-order)
 *   Vendor-rented unit → "Record vendor buyout" (POST /vendor-management/serials/:id/buyout);
 *                        the order then confirms that laptop by itself
 *   Confirm the sale   → on the sales order record (it already handles in-place orders)
 *
 * The list is GET /customer-management/sale-in-place (section sale_in_place view).
 */
const STAGES = [
  { value: '', label: 'All' },
  { value: 'rent_stopped', label: 'Rent stopped — no order' },
  { value: 'vendor_buyout', label: 'Waiting for vendor buyout' },
  { value: 'to_confirm', label: 'To confirm' },
  { value: 'sold', label: 'Sold' },
];
const STAGE_CHIP = {
  rent_stopped: { status: 'pending', label: 'Rent stopped — no order yet' },
  vendor_buyout: { status: 'pending', label: 'Waiting for vendor buyout' },
  to_confirm: { status: 'processing', label: 'On order — confirm the sale' },
  sold: { status: 'completed', label: 'Sold' },
};
const enc = encodeURIComponent;
const reasonLabel = (r) => SALE_IN_PLACE_REASONS.find((x) => x.value === r)?.label || r;
const day = (v) => (v ? String(v).slice(0, 10) : '—');

export default function SaleInPlacePage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('sale_in_place', 'create');
  const canBuyout = ['vendor_management', 'sale_in_place'].some((s) => hasPermission(s, 'edit'));
  const canOpenSo = SO_SECTIONS.some((s) => hasPermission(s, 'view'));
  const canOpenCustomer = ['customers', 'customer_management'].some((s) => hasPermission(s, 'view'));

  const [stage, setStage] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [buyout, setBuyout] = useState(null); // { row, billNo, amount }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(() => {
    setRows(null);
    api.get('/customer-management/sale-in-place', { params: { stage: stage || undefined, search: search || undefined } })
      .then(({ data }) => setRows(data?.data || []))
      .catch((e) => { setRows([]); toast.error(e?.response?.data?.message || 'Could not load sale-in-place cases'); });
  }, [stage, search]);
  useEffect(() => { load(); }, [load]);

  const submitBuyout = async () => {
    if (!buyout.billNo.trim()) { toast.error('Enter the vendor bill number'); return; }
    if (!(Number(buyout.amount) > 0)) { toast.error('Enter the buyout amount'); return; }
    setBusy(true);
    try {
      const res = await recordVendorBuyout(buyout.row.serial_id, { vendor_bill_no: buyout.billNo.trim(), amount: Number(buyout.amount) });
      toast.success(res?.message || 'Vendor buyout recorded');
      setBuyout(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.response?.data?.errors?.[0]?.msg || 'Could not record the buyout');
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'l', header: 'Laptop',
      render: (r) => <Link to={`/carret/stock/assets/${enc(r.ttspl_id || r.serial_number)}`}><DocNumber value={r.ttspl_id || r.serial_number} /></Link>,
      sub: (r) => [r.brand, r.model_name].filter(Boolean).join(' ') || r.serial_number,
    },
    {
      key: 'c', header: 'Customer',
      render: (r) => (canOpenCustomer ? <Link to={`/carret/sell/customers/${r.customer_id}`}>{r.customer_name}</Link> : r.customer_name),
    },
    { key: 'r', header: 'Why', render: (r) => reasonLabel(r.reason), sub: (r) => r.notes || null },
    { key: 'st', header: 'Rent stopped', render: (r) => day(r.rent_stopped_on), sub: (r) => (r.credit_note_number ? `Credit note ${r.credit_note_number}` : null) },
    { key: 'rate', header: 'Rent / month', numeric: true, render: (r) => <Money value={r.rent_monthly_rate} showZero={false} /> },
    {
      key: 'so', header: 'Sales order',
      render: (r) => {
        if (!r.sales_order_number) return '—';
        return canOpenSo
          ? <Link to={`/carret/sell/sales-orders/${enc(r.sales_order_number)}`}><DocNumber value={r.sales_order_number} /></Link>
          : <DocNumber value={r.sales_order_number} />;
      },
    },
    {
      key: 'v', header: 'Owner',
      render: (r) => (r.vendor_id ? `Vendor: ${r.vendor_name || '—'}` : 'Ours'),
      sub: (r) => (r.vendor_id ? (r.vendor_settled ? 'Buyout recorded' : 'Buyout bill awaited') : null),
    },
    { key: 's', header: 'Stage', render: (r) => { const c = STAGE_CHIP[r.stage] || { status: 'pending', label: r.stage }; return <StatusChip status={c.status} label={c.label} />; } },
    { key: 'w', header: 'Reported', render: (r) => <DateTime value={r.created_at} />, sub: (r) => r.created_by_name || null },
    {
      key: 'a', header: '', align: 'right',
      render: (r) => (
        <div className="flex" style={{ gap: '6px', justifyContent: 'flex-end' }}>
          {r.stage === 'vendor_buyout' && canBuyout && (
            <Button variant="primary" onClick={(e) => { e.stopPropagation(); setBuyout({ row: r, billNo: '', amount: '' }); }}>Record vendor buyout</Button>
          )}
          {['rent_stopped', 'vendor_buyout'].includes(r.stage) && !r.sales_order_number && canCreate && (
            <Button variant="primary" onClick={(e) => { e.stopPropagation(); navigate(`/carret/sell/sale-in-place/new?customer=${r.customer_id}&serial=${r.serial_id}`); }}>Make sale order</Button>
          )}
          {r.stage === 'to_confirm' && canOpenSo && (
            <Button onClick={(e) => { e.stopPropagation(); navigate(`/carret/sell/sales-orders/${enc(r.sales_order_number)}`); }}>Confirm on the order</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <DeskShell
      title="Sale in place"
      breadcrumb="Sell"
      subtitle="The customer keeps a laptop they have on rent — lost, damaged or bought. No challan, no e-way bill."
      actions={canCreate && <Button variant="primary" onClick={() => navigate('/carret/sell/sale-in-place/new')}>New sale in place</Button>}
    >
      <div className="c-stack">
        <Notice tone="info">
          A new sale in place stops rent (credit note for unused prepaid days), raises a Sale order and sells every laptop we own on the spot.
          A laptop we rent from a vendor waits for the vendor’s buyout bill; recording it completes that laptop’s sale.
          Accounts then attach the Zoho invoice in the sale invoice queue.
        </Notice>
        <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
          <Segmented label="Stage" value={stage} onChange={setStage} options={STAGES} />
          <Input type="search" placeholder="TTSPL, serial, customer, order" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={{ width: '16rem', marginLeft: 'auto' }} aria-label="Search" />
        </div>
        {rows === null ? <EmptyState title="Loading…" /> : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.event_id} empty={<EmptyState title="No sale-in-place cases" />} />
        )}
      </div>

      <Drawer
        open={Boolean(buyout)}
        onClose={() => setBuyout(null)}
        title={`Vendor buyout — ${buyout?.row?.ttspl_id || ''}`}
        footer={<Button variant="primary" disabled={busy} onClick={submitBuyout}>{busy ? 'Saving…' : 'Record buyout'}</Button>}
      >
        {buyout && (
          <div className="c-stack">
            <p>
              We rent this laptop from <strong>{buyout.row.vendor_name || 'a vendor'}</strong>. Record the vendor’s buyout bill: the laptop becomes ours
              (this laptop only — the vendor PO is not changed) and its sale on {buyout.row.sales_order_number || 'the order'} is confirmed.
            </p>
            <Field label="Vendor bill number" required>
              <Input value={buyout.billNo} onChange={(e) => setBuyout({ ...buyout, billNo: e.target.value })} />
            </Field>
            <Field label="Buyout amount (₹)" required>
              <Input type="number" min="1" step="0.01" value={buyout.amount} onChange={(e) => setBuyout({ ...buyout, amount: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </DeskShell>
  );
}

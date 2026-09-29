import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, DocNumber, EmptyState, Field, FormGrid, Input, KeyValue, Money, Notice, Section, Select, StatusChip, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import api from '../../../utils/api';
import { matchIndianState } from '../../../constants/indianStates';
import {
  SALE_IN_PLACE_REASONS, createSaleInPlaceOrder, fetchSaleInPlacePrefill,
} from '../../../utils/saleInPlaceApi';
import {
  computeGstBreakdown, formatSupplyStateLabel, resolveSupplyStateFromShipping,
} from '../../sales-pipeline/salesPipelineUtils';
import { AddressFields } from './CustomerAddresses';
import { SO_SECTIONS } from './sellShared';

/**
 * Sell → Sale in place → New (the old customer page's "Report lost / damaged /
 * buyout" modal, same API):
 *   1. customer → laptops on rent → why + date rent stops
 *   2. GET  /customers/:id/sale-in-place/prefill   (addresses, laptops, blockers)
 *   3. POST /customers/:id/sale-in-place/sale-order (one transaction: stop rent,
 *      credit note, Sale SO in place, sell every laptop we own)
 * The order then opens on the sales order record, which confirms in-place sales.
 * ?customer=<id>&serial=<id> pre-picks (from the Sale in place list).
 */
const enc = encodeURIComponent;
const configLine = (l) => [l.processor, l.generation, l.ram, l.storage].filter(Boolean).join(' · ');
const emptyAddress = () => ({ name: '', phone: '', country: 'India', address: '', city: '', state: '', zip_code: '' });
const withStateName = (a) => (a ? { ...emptyAddress(), ...a, state: matchIndianState(a.state) || a.state || '' } : emptyAddress());

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Server rules for a sale-in-place address: address + state required, pincode 6 digits if given. */
function addressError(a, label) {
  if (!String(a?.address || '').trim()) return `${label}: address is required`;
  if (!String(a?.state || '').trim()) return `${label}: state is required — it decides CGST+SGST or IGST`;
  if (a.zip_code && !/^\d{6}$/.test(String(a.zip_code))) return `${label}: pincode must be 6 digits`;
  return '';
}

function CustomerPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return undefined; }
    const t = setTimeout(() => {
      setLoading(true);
      api.get('/customer-management/customers', { params: { search: term, limit: 20, page: 1 } })
        .then(({ data }) => setRows(data?.customers || []))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="c-stack">
      <Field label="Customer" hint="Type at least two letters of the name, company, phone or GSTIN.">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" autoFocus />
      </Field>
      {loading && <EmptyState title="Searching…" />}
      {!loading && q.trim().length >= 2 && (
        <DataTable
          columns={[
            { key: 'n', header: 'Customer', render: (c) => c.company_name || c.name, sub: (c) => [c.name !== c.company_name ? c.name : null, c.phone].filter(Boolean).join(' · ') || null },
            { key: 'g', header: 'GSTIN', render: (c) => c.gst_no || '—' },
          ]}
          rows={rows}
          rowKey={(c) => c.customer_id}
          onRowClick={(c) => onPick({ customer_id: c.customer_id, name: c.company_name || c.name })}
          empty={<EmptyState title="No customer matches" />}
        />
      )}
    </div>
  );
}

export default function SaleInPlaceNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hasPermission } = usePermission();
  const canOpenSo = SO_SECTIONS.some((s) => hasPermission(s, 'view'));

  const [customer, setCustomer] = useState(null); // { customer_id, name }
  const [laptops, setLaptops] = useState(null);
  const [lapSearch, setLapSearch] = useState('');
  const [selected, setSelected] = useState({}); // serial_id -> row
  const [reason, setReason] = useState('lost');
  const [reportedOn, setReportedOn] = useState(todayYmd());
  const [notes, setNotes] = useState('');

  const [prefill, setPrefill] = useState(null);
  const [billing, setBilling] = useState(emptyAddress());
  const [shipKey, setShipKey] = useState('manual');
  const [shipping, setShipping] = useState(emptyAddress());
  const [gstNumber, setGstNumber] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [prices, setPrices] = useState({});
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);

  // ?customer=&serial= from the list.
  const preCustomer = params.get('customer');
  const preSerial = params.get('serial');
  useEffect(() => {
    if (!preCustomer) return;
    api.get(`/customer-management/customers/${enc(preCustomer)}`)
      .then(({ data }) => { const c = data?.customer; if (c) setCustomer({ customer_id: c.customer_id || c.id, name: c.company_name || c.name }); })
      .catch(() => setCustomer({ customer_id: Number(preCustomer), name: `Customer #${preCustomer}` }));
  }, [preCustomer]);

  const loadLaptops = useCallback(() => {
    if (!customer) return;
    setLaptops(null);
    api.get(`/customer-management/customers/${customer.customer_id}/laptops`, {
      params: { lifecycle: 'active', page: 1, limit: 100, status: 'rented', search: lapSearch.trim() || undefined },
    })
      .then(({ data }) => {
        const rows = (data?.data || []).filter((a) => String(a.status || '').toLowerCase() === 'rented');
        setLaptops(rows);
        if (preSerial) {
          const hit = rows.find((a) => String(a.serial_id) === String(preSerial));
          if (hit && !hit.sale_in_place?.sales_order_number) setSelected((s) => ({ ...s, [hit.serial_id]: hit }));
        }
      })
      .catch((e) => { setLaptops([]); toast.error(e?.response?.data?.message || 'Could not load the laptops on rent'); });
  }, [customer, lapSearch, preSerial]);
  useEffect(() => {
    const t = setTimeout(loadLaptops, lapSearch ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadLaptops, lapSearch]);

  const pickedRows = Object.values(selected);
  const monthlyStopped = pickedRows.filter((a) => !a.sale_in_place).reduce((s, a) => s + Number(a.rent_monthly_rate || 0), 0);

  const toggle = (row) => {
    if (row.sale_in_place?.sales_order_number) return;
    setSelected((p) => {
      const n = { ...p };
      if (n[row.serial_id]) delete n[row.serial_id]; else n[row.serial_id] = row;
      return n;
    });
  };

  const goToDetails = async () => {
    if (!pickedRows.length) { toast.error('Pick at least one laptop'); return; }
    if (!reportedOn) { toast.error('Pick the date rent stops'); return; }
    setBusy('prefill');
    try {
      const res = await fetchSaleInPlacePrefill(customer.customer_id, pickedRows.map((r) => r.serial_id));
      const data = res.data;
      const blocked = data.laptops.find((l) => l.blocker);
      if (blocked) { toast.error(`${blocked.ttspl_id}: ${blocked.blocker}`); return; }
      setPrefill(data);
      setBilling(withStateName(data.billing_address));
      const first = data.shipping_options[0];
      setShipKey(first ? first.key : 'manual');
      setShipping(withStateName(first?.address));
      setGstNumber(data.customer.gst_number || '');
      setEmail(data.customer.email || '');
      setMobile(data.customer.phone || '');
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not load the sale order details');
    } finally {
      setBusy('');
    }
  };

  const pickShipping = (key) => {
    setShipKey(key);
    if (key === 'manual') { setShipping(emptyAddress()); return; }
    setShipping(withStateName(prefill?.shipping_options.find((o) => o.key === key)?.address));
  };

  const subtotal = (prefill?.laptops || []).reduce((s, l) => s + (Number(prices[l.serial_id]) || 0), 0);
  const supplyState = resolveSupplyStateFromShipping(shipping);
  const gst = computeGstBreakdown({ subtotal, supplyState });
  const vendorUnits = (prefill?.laptops || []).filter((l) => l.vendor_rented);

  const check = () => {
    const missing = prefill.laptops.find((l) => !(Number(prices[l.serial_id]) > 0));
    if (missing) return `Enter a sale price for ${missing.ttspl_id}`;
    return addressError(billing, 'Billing address') || addressError(shipping, 'Ship-to address');
  };

  const submit = async () => {
    setBusy('save');
    try {
      const res = await createSaleInPlaceOrder(customer.customer_id, {
        serial_ids: prefill.laptops.map((l) => l.serial_id),
        reason,
        reported_on: reportedOn,
        notes: notes.trim() || null,
        prices: Object.fromEntries(prefill.laptops.map((l) => [l.serial_id, Number(prices[l.serial_id])])),
        customer_billing_address: { ...billing, gst_number: gstNumber },
        customer_shipping_address: shipping,
        gst_number: gstNumber || null,
        customer_email: email || null,
        customer_mobile: mobile || null,
        remark: remark.trim() || null,
      });
      toast.success(res.message || 'Sales order created');
      setResult(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not create the sales order');
    } finally {
      setBusy('');
    }
  };

  if (result) {
    const cns = [...new Set((result.rent_stopped || []).map((r) => r.credit_note_number).filter(Boolean))];
    return (
      <DeskShell title="Sale in place — done" breadcrumb="Sell">
        <div className="c-stack">
          <Notice tone="good" title={`Sales order ${result.sales_order_number} created`}>Rent stopped and the sale is recorded. No challan, no e-way bill.</Notice>
          <KeyValue
            items={[
              { label: 'Sold now', value: (result.sold || []).map((i) => i.ttspl_id).join(', ') || '—' },
              { label: 'Waiting for vendor buyout', value: (result.awaiting_vendor_buyout || []).map((i) => i.ttspl_id).join(', ') || '—' },
              { label: 'Credit note (unused prepaid rent)', value: cns.join(', ') || '—' },
            ]}
          />
          <p className="text-ink-3">Next: Accounts raise the invoice in Zoho and attach it in the sale invoice queue.</p>
          <div className="flex" style={{ gap: '8px' }}>
            {canOpenSo && <Button variant="primary" onClick={() => navigate(`/carret/sell/sales-orders/${enc(result.sales_order_number)}`)}>Open the sales order</Button>}
            <Button onClick={() => navigate('/carret/sell/sale-in-place')}>Back to Sale in place</Button>
          </div>
        </div>
      </DeskShell>
    );
  }

  const lapCols = [
    {
      key: 'x', header: '', width: '2.5rem',
      render: (a) => (
        <input
          type="checkbox"
          aria-label={`Pick ${a.ttspl_id || a.serial_number}`}
          disabled={Boolean(a.sale_in_place?.sales_order_number)}
          checked={Boolean(selected[a.serial_id])}
          onChange={() => toggle(a)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    { key: 't', header: 'Laptop', render: (a) => <DocNumber value={a.ttspl_id || a.serial_number} />, sub: (a) => a.serial_number },
    { key: 'm', header: 'Model', render: (a) => [a.brand, a.model_name].filter(Boolean).join(' ') || '—', sub: (a) => configLine(a) || null },
    {
      key: 's', header: '',
      render: (a) => {
        if (a.sale_in_place?.sales_order_number) return <StatusChip status="processing" label={`On ${a.sale_in_place.sales_order_number}`} />;
        if (a.sale_in_place) return <StatusChip status="pending" label={`Rent already stopped ${String(a.sale_in_place.rent_stopped_on || '').slice(0, 10)}`} />;
        return null;
      },
    },
    { key: 'r', header: 'Rent / month', numeric: true, render: (a) => <Money value={a.rent_monthly_rate} showZero={false} /> },
  ];

  const priceCols = [
    { key: 't', header: 'Laptop', render: (l) => <DocNumber value={l.ttspl_id} />, sub: (l) => [[l.brand, l.model_name].filter(Boolean).join(' '), configLine(l)].filter(Boolean).join(' · ') || null },
    { key: 'o', header: 'Owner', render: (l) => (l.vendor_rented ? <StatusChip status="pending" label={`Vendor: ${l.vendor_name || 'rented'} — buyout needed`} /> : <StatusChip status="active" label="Ours" />) },
    { key: 'r', header: 'Rent / month', numeric: true, render: (l) => <Money value={l.rent_monthly_rate} showZero={false} /> },
    { key: 'st', header: 'Rent stops', render: (l) => String(l.open_case?.rent_stopped_on || reportedOn).slice(0, 10) },
    {
      key: 'p', header: 'Sale price (₹, before GST)', numeric: true,
      render: (l) => (
        <Input
          type="number" min="1" step="0.01" aria-label={`Sale price for ${l.ttspl_id}`}
          value={prices[l.serial_id] ?? ''}
          onChange={(e) => setPrices((p) => ({ ...p, [l.serial_id]: e.target.value }))}
          style={{ width: '9rem', textAlign: 'right' }}
        />
      ),
    },
  ];

  return (
    <DeskShell
      title="New sale in place"
      breadcrumb="Sell"
      subtitle="The customer keeps laptops they have on rent — lost, damaged or bought. Rent stops and a Sale order is made; nothing moves."
      actions={<Link to="/carret/sell/sale-in-place">Back to the list</Link>}
    >
      <div className="c-stack">
        {!customer && (
          <Section title="1. Customer">
            <CustomerPicker onPick={(c) => { setCustomer(c); setSelected({}); setPrefill(null); }} />
          </Section>
        )}

        {customer && !prefill && (
          <>
            <Section
              title={`1. Laptops on rent with ${customer.name}`}
              actions={(
                <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
                  <Input type="search" placeholder="TTSPL, serial, model" value={lapSearch} onChange={(e) => setLapSearch(e.target.value)} style={{ width: '14rem' }} aria-label="Search laptops" />
                  {!preCustomer && <Button variant="quiet" onClick={() => { setCustomer(null); setLaptops(null); setSelected({}); }}>Change customer</Button>}
                </div>
              )}
            >
              {laptops === null ? <EmptyState title="Loading…" /> : (
                <DataTable
                  columns={lapCols}
                  rows={laptops}
                  rowKey={(a) => a.serial_id}
                  onRowClick={toggle}
                  empty={<EmptyState title="No laptops on rent with this customer" />}
                />
              )}
              <p className="text-ink-3" style={{ marginTop: '8px' }}>A laptop whose rent was stopped earlier keeps its stop date and credit note.</p>
            </Section>
            <Section title="2. Why, and when rent stops">
              <FormGrid cols={3}>
                <Field label="Why the customer keeps it" required>
                  <Select value={reason} onChange={(e) => setReason(e.target.value)} options={SALE_IN_PLACE_REASONS} />
                </Field>
                <Field label="Rent stops from" required hint="Today or earlier.">
                  <Input type="date" max={todayYmd()} value={reportedOn} onChange={(e) => setReportedOn(e.target.value)} />
                </Field>
                <Field label="Notes" span={3}>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference, who confirmed it, claim number…" />
                </Field>
              </FormGrid>
              <div className="flex flex-wrap items-center" style={{ gap: '12px', marginTop: '12px' }}>
                <strong>{pickedRows.length} picked</strong>
                {monthlyStopped > 0 && <span className="text-ink-3">₹{monthlyStopped.toLocaleString('en-IN')} a month stops</span>}
                <span style={{ marginLeft: 'auto' }} />
                <Button variant="primary" disabled={!pickedRows.length || busy === 'prefill'} onClick={goToDetails}>
                  {busy === 'prefill' ? 'Loading…' : 'Next: sale order'}
                </Button>
              </div>
            </Section>
          </>
        )}

        {customer && prefill && (
          <>
            <Notice tone="info" title={`${prefill.customer.name} · ${SALE_IN_PLACE_REASONS.find((r) => r.value === reason)?.label} · rent stops ${reportedOn}`}>
              gorefurbo Sale order, in place: no challan, no e-way bill.
            </Notice>
            <Section title="3. Customer on the order">
              <FormGrid cols={3}>
                <Field label="GSTIN"><Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value.toUpperCase())} className="font-mono" /></Field>
                <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Field label="Mobile"><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></Field>
              </FormGrid>
            </Section>
            <Section title="Billing address">
              <AddressFields value={billing} onChange={setBilling} />
            </Section>
            <Section title="Ship-to (place of supply)">
              <div className="c-stack">
                <Field label="Where the laptops were delivered" hint="Each laptop's own delivered address is also kept on its order line.">
                  <Select
                    value={shipKey}
                    onChange={(e) => pickShipping(e.target.value)}
                    options={[
                      ...prefill.shipping_options.map((o) => ({ value: o.key, label: `${o.label} — ${String(o.address?.address || '').slice(0, 60)}` })),
                      { value: 'manual', label: 'Type an address' },
                    ]}
                  />
                </Field>
                <AddressFields value={shipping} onChange={setShipping} />
              </div>
            </Section>
            <Section title="4. Sale price">
              <DataTable columns={priceCols} rows={prefill.laptops} rowKey={(l) => l.serial_id} />
              <FormGrid cols={2}>
                <Field label="Remark on the sales order"><Textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} /></Field>
                <KeyValue
                  items={[
                    { label: 'Subtotal', value: <Money value={gst.subtotal} /> },
                    ...(gst.gst_type === 'inter'
                      ? [{ label: `IGST ${gst.gst_rate}%`, value: <Money value={gst.igst} /> }]
                      : [{ label: `CGST ${gst.gst_rate / 2}%`, value: <Money value={gst.cgst} /> }, { label: `SGST ${gst.gst_rate / 2}%`, value: <Money value={gst.sgst} /> }]),
                    { label: 'Total', value: <strong><Money value={gst.grand_total} /></strong> },
                    { label: 'Place of supply', value: formatSupplyStateLabel(supplyState) },
                  ]}
                />
              </FormGrid>
            </Section>
            <Notice tone="warn" title="What happens on save">
              Rent stops, a credit note is raised for unused prepaid days, and a Sale order is created with these laptops attached.
              Laptops we own become Sold at once.
              {vendorUnits.length > 0 && ` ${vendorUnits.map((l) => l.ttspl_id).join(', ')} ${vendorUnits.length === 1 ? 'is' : 'are'} rented from a vendor: vendor rent stops now, Procurement is told, and the sale completes when the vendor buyout is recorded.`}
            </Notice>
            <div className="flex" style={{ gap: '8px' }}>
              <Button variant="quiet" onClick={() => setPrefill(null)}>Back</Button>
              <Button
                variant="primary"
                disabled={busy === 'save'}
                onClick={() => { const err = check(); if (err) { toast.error(err); return; } setConfirming(true); }}
              >
                {busy === 'save' ? 'Saving…' : 'Stop rent and create the sale order'}
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={submit}
        title={`Sell ${prefill?.laptops?.length || 0} laptop(s) in place?`}
        body={`Total ₹${Number(gst.grand_total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} incl. GST. No challan or e-way bill. Laptops we own become Sold immediately; this cannot be undone from the CRM.`}
        confirmLabel="Stop rent & create order"
      />
    </DeskShell>
  );
}

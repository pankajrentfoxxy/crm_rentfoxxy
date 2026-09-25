import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, EmptyState, Field, FormGrid, Input, Money, Notice, Section, Segmented, Select,
} from '../../../components/carret';
import { ENTITIES } from '../../../config/entities';
import {
  createSalesOrder, getQuotation, getSalesOrderFull, getSalesOrderMeta, listQuotations, updateSalesOrder,
} from '../../sales-pipeline/salesPipelineApi';
import {
  computeGstBreakdown, resolveSupplyStateFromShipping, formatSupplyStateLabel,
} from '../../sales-pipeline/salesPipelineUtils';
import {
  filterCustomersForQuotation, isCustomerEligibleForQuotation, customerTypeMismatchMessage,
} from '../../../utils/customerType';
import LineItemsEditor, {
  emptyLine, linesToPayload, linesTotal, firstMissing, fieldLabel,
} from './LineItemsEditor';
import {
  useCustomerAddresses, ShippingPicker, resolveShipping, AddressText, validateAddress,
} from './CustomerAddresses';
import { parseJson } from './sellShared';

/**
 * Sell → New sales order / Edit sales order.
 *
 * Same endpoints and payload as the old drawer (POST /sales-orders, PATCH
 * /sales-orders/:n). Two things differ on purpose:
 *
 * - "From a quotation" lists ACCEPTED quotations. The old picker listed
 *   approved ones, which the server then refused (it requires accepted, Part
 *   4.3), so every order raised that way failed at the last step.
 * - The advance (amount and due date) is stored since migration 329 and
 *   printed on the order PDF; the server used to drop it.
 *
 * Processor, generation, RAM and storage are required on every line because
 * the attach step matches stock on exactly those four.
 */
const REQUIRED = ['processor', 'generation', 'ram', 'storage'];

const TYPES = [
  { value: 'rental', label: 'Rental' },
  { value: 'sale', label: 'Sale' },
  { value: 'demo', label: 'Demo' },
];

// sale → Gorefurbo, rental → RentFoxxy, demo → whichever book it is chosen for.
const bookFor = (type, demoBook) => (type === 'sale' ? 'gorefurbo' : type === 'demo' ? demoBook : 'rentfoxxy');
const scopeFor = (book) => (book === 'gorefurbo' ? 'sale' : 'rental');

function linesFromDoc(rows) {
  return rows.map((l) => ({
    ...emptyLine(),
    line_id: l.line_id || l.id || null,
    brand: l.brand || '',
    model_name: l.model_name || l.model || '',
    processor: l.processor || '',
    generation: l.generation || '',
    ram: l.ram || '',
    storage: l.storage || '',
    gpu: l.gpu || '',
    screen_size: l.screen_size || '',
    quantity: l.main_qty || l.quantity || 1,
    rate: l.rate || '',
    locking_period: l.locking_period || '',
    technical_warranty: l.technical_warranty || '',
    battery_charger_warranty: l.battery_charger_warranty || '',
    remark: l.remark || '',
  }));
}

export default function SalesOrderFormPage() {
  const navigate = useNavigate();
  const { soNumber } = useParams();
  const editSo = soNumber ? decodeURIComponent(soNumber) : null;
  const [params] = useSearchParams();
  const fromQuotationParam = params.get('quotation') || '';

  const [type, setType] = useState('rental');
  const [demoBook, setDemoBook] = useState('rentfoxxy');
  const book = bookFor(type, demoBook);
  const scope = scopeFor(book);

  const [meta, setMeta] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [quotationNumber, setQuotationNumber] = useState(fromQuotationParam);
  const [quoteNote, setQuoteNote] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [gst, setGst] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [securityType, setSecurityType] = useState('none');
  const [shipping, setShipping] = useState('');
  const [inPlace, setInPlace] = useState(false);
  const [wfh, setWfh] = useState({ on: false, name: '', phone: '' });
  const [shipChoice, setShipChoice] = useState({ key: 'billing', manual: null });
  const [advance, setAdvance] = useState({ on: false, amount: '', due: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editLocked, setEditLocked] = useState('');

  // Customers eligible for this book, and the accepted quotations to raise from.
  useEffect(() => {
    getSalesOrderMeta({ entity_scope: scope })
      .then(({ data }) => setMeta(data))
      .catch((e) => setLoadError(e?.response?.data?.message || 'Could not load customers.'));
  }, [scope]);
  useEffect(() => {
    if (editSo) return;
    listQuotations({ status: 'accepted', limit: 100 })
      .then(({ data }) => setQuotes(data?.quotations || []))
      .catch(() => setQuotes([]));
  }, [editSo]);

  // Copy an accepted quotation in.
  useEffect(() => {
    if (!quotationNumber || editSo) return;
    getQuotation(quotationNumber).then(({ data }) => {
      const qLines = data?.lines || [];
      const h = qLines[0] || {};
      if (String(h.status).toLowerCase() !== 'accepted') {
        setQuoteNote(`${quotationNumber} is ${h.status === 'pending' ? 'a draft' : h.status}, not accepted. An order needs an accepted quotation.`);
        return;
      }
      const t = ['sale', 'sales'].includes(String(h.quotation_type).toLowerCase()) ? 'sale' : (h.quotation_type || 'rental');
      setType(t);
      if (t === 'demo') setDemoBook(h.entity_code === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy');
      setLines(qLines.length ? linesFromDoc(qLines) : [emptyLine()]);
      setSecurityType(h.security_type || (Number(h.security_amount) > 0 ? 'one_month_rental' : 'none'));
      setShipping(h.shiping_charges ?? '');
      setGst(h.gst_number || '');
      setCustomerId(h.customer_id ? String(h.customer_id) : '');
      const ship = parseJson(h.customer_shipping_address);
      if (ship?.address) setShipChoice({ key: 'manual', manual: { ...ship, zip_code: ship.zip_code || ship.pincode || '' } });
      setQuoteNote(h.customer_id
        ? ''
        : `${quotationNumber} was raised for a prospect (${h.company_name || h.customer_name}). Choose the customer account this order is for.`);
    }).catch(() => setQuoteNote(`Could not load ${quotationNumber}.`));
  }, [quotationNumber, editSo]);

  // Edit: load the order.
  useEffect(() => {
    if (!editSo) return;
    getSalesOrderFull(editSo).then(({ data }) => {
      const soLines = data?.lines || [];
      const h = soLines[0] || {};
      if ((data?.delivery_challans || []).length) setEditLocked('This order already has a delivery challan, so it can no longer be edited. Change a line’s rate or configuration from the order instead.');
      else if (String(data?.status) === 'cancelled') setEditLocked('This order is cancelled.');
      else if (h.fulfillment_mode === 'in_place') setEditLocked('Sale-in-place orders cannot be edited.');
      const t = ['sale', 'sales'].includes(String(h.quotation_type).toLowerCase()) ? 'sale' : (h.quotation_type || 'rental');
      setType(t);
      if (t === 'demo') setDemoBook(h.entity_code === 'gorefurbo' ? 'gorefurbo' : 'rentfoxxy');
      setQuotationNumber(h.quotation_number && h.quotation_number !== 'N/A' ? h.quotation_number : '');
      setCustomerId(h.customer_id ? String(h.customer_id) : '');
      setGst(h.gst_number || '');
      setLines(soLines.length ? linesFromDoc(soLines) : [emptyLine()]);
      setSecurityType(h.security_type || (Number(h.security_amount) > 0 ? 'one_month_rental' : 'none'));
      setShipping(h.shiping_charges ?? '');
      const isW = soLines.some((l) => l.is_wfh === true || l.is_wfh === 't' || l.is_wfh === 1);
      const delivery = parseJson(h.delivery_address) || {};
      setWfh({ on: isW, name: delivery.employee_name || '', phone: delivery.employee_phone || '' });
      setAdvance(Number(h.advance_amount) > 0
        ? { on: true, amount: String(h.advance_amount), due: h.advance_due_date ? String(h.advance_due_date).slice(0, 10) : '' }
        : { on: false, amount: '', due: '' });
      const ship = parseJson(h.customer_shipping_address);
      if (ship?.address) setShipChoice({ key: 'manual', manual: { ...ship, zip_code: ship.zip_code || ship.pincode || '' } });
    }).catch((e) => setLoadError(e?.response?.data?.message || 'Could not load the order.'));
  }, [editSo]);

  const customers = useMemo(() => filterCustomersForQuotation(meta?.customers || [], type), [meta, type]);
  const eligibleQuotes = useMemo(() => quotes.filter((q) => {
    const qt = ['sale', 'sales'].includes(String(q.quotation_type).toLowerCase()) ? 'sale' : q.quotation_type;
    return qt === type || (type === 'demo' && qt === 'demo');
  }), [quotes, type]);

  const addr = useCustomerAddresses(customerId);
  const shipAddress = resolveShipping(addr.options, shipChoice);
  const supplyState = useMemo(() => resolveSupplyStateFromShipping(shipAddress), [shipAddress]);

  const isSale = type === 'sale';
  const subtotal = linesTotal(lines);
  const security = !isSale && !inPlace && securityType === 'one_month_rental' ? subtotal : 0;
  const shippingCharge = inPlace ? 0 : (Number(shipping) || 0);
  const totals = computeGstBreakdown({
    subtotal, shipping: shippingCharge, security, supplyState, gstOnShipping: wfh.on,
  });

  const onType = (t) => {
    setType(t);
    if (t !== 'sale') setInPlace(false);
    if (t === 'sale') setSecurityType('none');
    setQuotationNumber('');
  };

  const onCustomer = (id) => {
    setCustomerId(id);
    setShipChoice({ key: 'billing', manual: null });
    const c = (meta?.customers || []).find((x) => String(x.customer_id) === String(id));
    setGst(c?.gst_no || c?.gst_number || '');
  };

  const submit = async () => {
    const e = {};
    if (!customerId) e.customer = 'Choose the customer';
    const c = (meta?.customers || []).find((x) => String(x.customer_id) === String(customerId));
    if (c && !isCustomerEligibleForQuotation(c.customer_type, type)) e.customer = customerTypeMismatchMessage(c.customer_type, type);
    const miss = firstMissing(lines, REQUIRED);
    if (miss) e.line = miss;
    if (!inPlace) {
      if (!shipAddress) e.ship = { address: 'Choose where this order ships' };
      else if (shipChoice.key === 'manual' || wfh.on) {
        const ae = validateAddress(shipAddress);
        if (Object.keys(ae).length) e.ship = ae;
      }
      if (wfh.on && !(Number(shipping) > 0)) e.shipping = 'Work-from-home delivery needs a shipping charge (GST applies to it)';
    }
    if (advance.on && !(Number(advance.amount) > 0)) e.advance = 'Enter the advance amount, or untick it';
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error(e.advance || e.customer || (e.line ? `Line ${e.line.index + 1}: ${fieldLabel(e.line.field)} is missing` : e.shipping || 'Some required fields are empty'));
      return;
    }

    const shipPayload = inPlace ? null : (wfh.on
      ? { ...shipAddress, employee_name: wfh.name || undefined, employee_phone: wfh.phone || undefined }
      : shipAddress);
    const payload = {
      customer_id: customerId,
      customer_name: c?.company_name || c?.name || addr.customer?.company_name || addr.customer?.name,
      email: c?.email || addr.customer?.email || '',
      customer_mobile: c?.phone || addr.customer?.phone || '',
      quotation_number: quotationNumber || '',
      quotation_type: type,
      branch: book,
      security_type: security > 0 ? 'one_month_rental' : 'none',
      security_amount: security,
      shiping_charges: shippingCharge,
      GST_number: gst || null,
      fulfillment_mode: inPlace ? 'in_place' : 'dispatch',
      supply_state: supplyState,
      customer_shipping_address: shipPayload,
      customer_billing_address: addr.billing,
      advance_amount: advance.on ? Number(advance.amount) || 0 : '',
      advance_due_date: advance.on ? advance.due || null : null,
      is_wfh: wfh.on,
      wfh_employee_name: wfh.on ? wfh.name || undefined : undefined,
      wfh_employee_phone: wfh.on ? wfh.phone || undefined : undefined,
      ...linesToPayload(lines),
    };

    setSaving(true);
    try {
      if (editSo) {
        await updateSalesOrder(editSo, payload);
        toast.success(`${editSo} updated`);
        navigate(`/carret/sell/sales-orders/${encodeURIComponent(editSo)}`);
      } else {
        const { data } = await createSalesOrder(payload);
        const so = data?.sales_order_number;
        toast.success(`${so} created`);
        navigate(`/carret/sell/sales-orders/${encodeURIComponent(so)}`);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save the order.');
    } finally {
      setSaving(false);
    }
  };

  if (editSo && editLocked) {
    return (
      <DeskShell title={`Edit ${editSo}`} breadcrumb="Sell / Sales orders">
        <EmptyState title="This order cannot be edited" body={editLocked} action={<Button onClick={() => navigate(`/carret/sell/sales-orders/${encodeURIComponent(editSo)}`)}>Back to the order</Button>} />
      </DeskShell>
    );
  }

  return (
    <DeskShell
      title={editSo ? `Edit ${editSo}` : 'New sales order'}
      breadcrumb="Sell / Sales orders"
      subtitle={editSo ? 'Changes regenerate the order PDF.' : 'The SO number is assigned when you save.'}
    >
      <div className="c-split">
        <div className="c-stack">
          {loadError && <Notice tone="crit" title="Could not load the form">{loadError}</Notice>}

          <Section title="Order type">
            <div className="flex flex-wrap items-center" style={{ gap: '12px' }}>
              <Segmented label="Order type" value={type} onChange={onType} options={TYPES} />
              {type === 'demo' && (
                <Segmented
                  label="Demo book"
                  value={demoBook}
                  onChange={setDemoBook}
                  options={Object.values(ENTITIES).map((e) => ({ value: e.code, label: e.label }))}
                />
              )}
              <span className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
                Billed by <b className="text-ink">{Object.values(ENTITIES).find((e) => e.code === book)?.label}</b>
              </span>
            </div>
            {editSo && <p className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)', margin: '10px 0 0' }}>The type and customer cannot change once an order exists.</p>}
          </Section>

          {!editSo && (
            <Section title="Quotation">
              <FormGrid cols={2}>
                <Field label="Raise from an accepted quotation" hint="Leave empty to raise the order without one.">
                  <Select
                    value={quotationNumber}
                    onChange={(e) => { setQuoteNote(''); setQuotationNumber(e.target.value); }}
                    placeholder={`No quotation (${eligibleQuotes.length} accepted available)`}
                    options={[
                      ...(quotationNumber && !eligibleQuotes.some((q) => q.quotation_number === quotationNumber)
                        ? [{ value: quotationNumber, label: quotationNumber }] : []),
                      ...eligibleQuotes.map((q) => ({ value: q.quotation_number, label: `${q.quotation_number} — ${q.company_name || q.customer_name}` })),
                    ]}
                  />
                </Field>
              </FormGrid>
              {quoteNote && <div style={{ marginTop: '12px' }}><Notice tone="warn">{quoteNote}</Notice></div>}
            </Section>
          )}

          <Section title="Customer">
            <FormGrid cols={2}>
              <Field label="Customer" required error={errors.customer} span={editSo ? 2 : 1}>
                <Select
                  value={customerId}
                  onChange={(e) => onCustomer(e.target.value)}
                  disabled={Boolean(editSo)}
                  placeholder={meta ? `Choose a customer (${customers.length} eligible)` : 'Loading…'}
                  options={[
                    ...(customerId && !customers.some((c) => String(c.customer_id) === customerId)
                      ? [{ value: customerId, label: `Customer #${customerId}` }] : []),
                    ...customers.map((c) => ({ value: String(c.customer_id), label: `${c.company_name || c.name}${c.gst_no ? ` · ${c.gst_no}` : ''}` })),
                  ]}
                />
              </Field>
              <Field label="GSTIN">
                <Input value={gst} onChange={(e) => setGst(e.target.value)} className="font-mono" />
              </Field>
            </FormGrid>
          </Section>

          <Section title="Laptops">
            <LineItemsEditor lines={lines} onChange={setLines} quotationType={type} required={REQUIRED} errors={errors.line} />
          </Section>

          <Section title="Delivery">
            <div className="c-stack" style={{ gap: '14px' }}>
              {isSale && !editSo && (
                <Checkbox
                  label="Sale in place — the customer already has these laptops (lost, damaged or bought out). No challan, no shipping."
                  checked={inPlace}
                  onChange={(e) => setInPlace(e.target.checked)}
                />
              )}
              {!inPlace && (
                <>
                  <Checkbox
                    label="Work-from-home delivery to an employee (GST applies to shipping)"
                    checked={wfh.on}
                    onChange={(e) => setWfh((w) => ({ ...w, on: e.target.checked }))}
                  />
                  {wfh.on && (
                    <FormGrid cols={2}>
                      <Field label="Employee name"><Input value={wfh.name} onChange={(e) => setWfh((w) => ({ ...w, name: e.target.value }))} /></Field>
                      <Field label="Employee phone"><Input value={wfh.phone} inputMode="tel" onChange={(e) => setWfh((w) => ({ ...w, phone: e.target.value }))} /></Field>
                    </FormGrid>
                  )}
                  {customerId ? (
                    <div className="c-form-grid" style={{ '--c-cols': 2 }}>
                      <div>
                        <div className="c-label" style={{ marginBottom: '6px' }}>Bill to</div>
                        {addr.loading ? <span className="text-ink-3">Loading…</span> : <AddressText address={addr.billing} />}
                      </div>
                      <ShippingPicker options={addr.options} value={shipChoice} onChange={setShipChoice} errors={errors.ship} />
                    </div>
                  ) : (
                    <p className="font-ui text-ink-3 m-0">Choose the customer to pick a delivery address.</p>
                  )}
                  {errors.ship?.address && shipChoice.key !== 'manual' && <Notice tone="crit">{errors.ship.address}</Notice>}
                  <p className="font-ui text-ink-3 m-0" style={{ fontSize: 'var(--d-sm)' }}>
                    Laptops can go to different addresses: set each one on the order after attaching them. One challan is made per address.
                  </p>
                </>
              )}
            </div>
          </Section>

          <Section title="Charges">
            <FormGrid cols={3}>
              {!isSale && !inPlace && (
                <Field label="Security deposit">
                  <Select
                    value={securityType}
                    onChange={(e) => setSecurityType(e.target.value)}
                    options={[{ value: 'none', label: 'None' }, { value: 'one_month_rental', label: 'One month’s rent' }]}
                  />
                </Field>
              )}
              {!inPlace && (
                <Field label="Shipping charges (₹)" required={wfh.on} error={errors.shipping}>
                  <Input type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} />
                </Field>
              )}
            </FormGrid>
            <div style={{ marginTop: '14px' }}>
              <Checkbox label="Advance required before dispatch" checked={advance.on} onChange={(e) => setAdvance((a) => ({ ...a, on: e.target.checked }))} />
              {advance.on && (
                <FormGrid cols={3}>
                  <Field label="Advance amount (₹)" required error={errors.advance}>
                    <Input type="number" min="0" step="0.01" value={advance.amount} onChange={(e) => setAdvance((a) => ({ ...a, amount: e.target.value }))} />
                  </Field>
                  <Field label="Due by">
                    <Input type="date" value={advance.due} onChange={(e) => setAdvance((a) => ({ ...a, due: e.target.value }))} />
                  </Field>
                </FormGrid>
              )}
            </div>
          </Section>
        </div>

        <aside className="c-stack" style={{ position: 'sticky', top: '76px' }}>
          <Section title="Summary">
            <div className="c-totals">
              <div><span>{isSale ? 'Laptops' : 'Monthly rent'}</span><span><Money value={totals.subtotal} /></span></div>
              {totals.gst_type === 'intra'
                ? (<><div><span>CGST 9%</span><span><Money value={totals.cgst} /></span></div><div><span>SGST 9%</span><span><Money value={totals.sgst} /></span></div></>)
                : <div><span>IGST 18%</span><span><Money value={totals.igst} /></span></div>}
              <div><span>Shipping{wfh.on ? ' (taxed)' : ''}</span><span><Money value={totals.shipping} /></span></div>
              {!isSale && <div><span>Security deposit</span><span><Money value={totals.security} /></span></div>}
              <div className="is-grand"><span>{isSale ? 'Total' : 'First payment'}</span><span><Money value={totals.grand_total} /></span></div>
              {advance.on && Number(advance.amount) > 0 && <div><span>Advance before dispatch</span><span><Money value={Number(advance.amount)} /></span></div>}
            </div>
            <p className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)', margin: '10px 0 0' }}>
              Place of supply: {supplyState ? formatSupplyStateLabel(supplyState) : 'from the delivery address'}. Security is not taxed.
            </p>
          </Section>
          <div className="c-stack" style={{ gap: '8px' }}>
            <Button variant="primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : (editSo ? 'Save changes' : 'Create sales order')}</Button>
            <Button variant="quiet" onClick={() => navigate(editSo ? `/carret/sell/sales-orders/${encodeURIComponent(editSo)}` : '/carret/sell/sales-orders')} disabled={saving}>Cancel</Button>
          </div>
        </aside>
      </div>
    </DeskShell>
  );
}

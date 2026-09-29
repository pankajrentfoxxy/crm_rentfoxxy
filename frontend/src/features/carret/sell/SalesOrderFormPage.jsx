import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, EmptyState, Field, FormGrid, Input, Money, Notice, Section, Segmented, Select, SearchSelect,
} from '../../../components/carret';
import { ENTITIES } from '../../../config/entities';
import {
  createSalesOrder, createSalesOrderDraft, getQuotation, getSalesOrderDraft, getSalesOrderFull, getSalesOrderMeta,
  listQuotations, updateSalesOrder, updateSalesOrderDraft,
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
import { customerGstin, gstinError, parseJson } from './sellShared';
import GstinField from './GstinField';

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
 *
 * Work from home (rental and demo only — a sale has no WFH, its shipping is
 * optional): the ship-to contact IS the employee (one name and phone, not
 * two), shipping is Rs 799 per laptop with GST on it — it follows the laptop
 * count until someone types their own figure — and the server keeps the
 * address on the customer as a WFH address so a later pickup from it is seen
 * to be chargeable.
 *
 * A rental order needs the customer's GSTIN, taken from the customer record
 * only. Missing → the order is blocked; it is added on the customer (where the
 * GSTIN lookup also fills the billing address) and then rechecked here.
 *
 * Save as draft (migration 406) keeps the form without taking an SO number;
 * ?draft=<id> reopens it, and creating the order deletes the draft.
 */
const REQUIRED = ['processor', 'generation', 'ram', 'storage'];
const WFH_SHIPPING = 799;

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
    _editing: false,
  }));
}

export default function SalesOrderFormPage() {
  const navigate = useNavigate();
  const { soNumber } = useParams();
  const editSo = soNumber ? decodeURIComponent(soNumber) : null;
  const [params] = useSearchParams();
  const fromQuotationParam = params.get('quotation') || '';
  const draftParam = editSo ? '' : (params.get('draft') || '');
  const [draftId, setDraftId] = useState(draftParam);
  const [draftSaving, setDraftSaving] = useState(false);
  const loadedDraft = useRef('');
  // A restored draft carries its own lines; don't re-copy its quotation over them.
  const skipQuote = useRef('');

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
  const [wfh, setWfh] = useState({ on: false });
  // WFH shipping follows 799 x laptops until someone types their own amount.
  const [shipAuto, setShipAuto] = useState(false);
  const [metaTick, setMetaTick] = useState(0);
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
  }, [scope, metaTick]);
  useEffect(() => {
    if (editSo) return;
    listQuotations({ status: 'accepted', limit: 100 })
      .then(({ data }) => setQuotes(data?.quotations || []))
      .catch(() => setQuotes([]));
  }, [editSo]);

  // Copy an accepted quotation in.
  useEffect(() => {
    if (!quotationNumber || editSo) return;
    if (skipQuote.current === quotationNumber) { skipQuote.current = ''; return; }
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

  // Reopen a draft.
  useEffect(() => {
    if (!draftParam || loadedDraft.current === draftParam) return;
    loadedDraft.current = draftParam;
    getSalesOrderDraft(draftParam).then(({ data }) => {
      const d = data?.draft?.payload || {};
      if (d.quotationNumber) skipQuote.current = d.quotationNumber;
      setType(d.type || 'rental');
      setDemoBook(d.demoBook || 'rentfoxxy');
      setQuotationNumber(d.quotationNumber || '');
      setCustomerId(d.customerId ? String(d.customerId) : '');
      setGst(d.gst || '');
      setLines(Array.isArray(d.lines) && d.lines.length ? d.lines : [emptyLine()]);
      setSecurityType(d.securityType || 'none');
      setShipping(d.shipping ?? '');
      setInPlace(Boolean(d.inPlace));
      setWfh({ on: Boolean(d.wfh?.on) });
      setShipAuto(Boolean(d.shipAuto));
      setShipChoice(d.shipChoice || { key: 'billing', manual: null });
      setAdvance(d.advance || { on: false, amount: '', due: '' });
      setDraftId(String(data.draft.draft_id));
    }).catch((e) => {
      setDraftId('');
      setLoadError(e?.response?.data?.message || 'Could not load the draft.');
    });
  }, [draftParam]);

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
      setWfh({ on: isW });
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

  const addr = useCustomerAddresses(customerId, metaTick);
  const shipAddress = resolveShipping(addr.options, shipChoice);
  const supplyState = useMemo(() => resolveSupplyStateFromShipping(shipAddress), [shipAddress]);

  const isSale = type === 'sale';
  const subtotal = linesTotal(lines);
  const security = !isSale && !inPlace && securityType === 'one_month_rental' ? subtotal : 0;
  const shippingCharge = inPlace ? 0 : (Number(shipping) || 0);
  const totals = computeGstBreakdown({
    subtotal, shipping: shippingCharge, security, supplyState, gstOnShipping: wfh.on,
  });

  const laptopCount = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  const wfhShipping = WFH_SHIPPING * Math.max(laptopCount, 1);
  useEffect(() => {
    if (wfh.on && shipAuto) setShipping(String(wfhShipping));
  }, [wfh.on, shipAuto, wfhShipping]);

  const onType = (t) => {
    setType(t);
    if (t !== 'sale') setInPlace(false);
    if (t === 'sale') {
      setSecurityType('none');
      // No work-from-home on a sale; its shipping is optional.
      if (wfh.on) { setWfh({ on: false }); if (shipAuto) setShipping(''); setShipAuto(false); }
    }
    setQuotationNumber('');
  };

  const selectedCustomer = (meta?.customers || []).find((x) => String(x.customer_id) === String(customerId));
  const isRental = type === 'rental';
  const gstLocked = isRental || (Boolean(gst) && gst === customerGstin(selectedCustomer));
  const rentalGstMissing = isRental && Boolean(selectedCustomer) && !customerGstin(selectedCustomer);
  // Rental: the GSTIN is always the customer's own (refreshed after a recheck).
  useEffect(() => {
    if (isRental && selectedCustomer) setGst(customerGstin(selectedCustomer));
  }, [isRental, selectedCustomer]);

  const shipOption = addr.options.find((o) => o.value === shipChoice.key);

  const onWfh = (on) => {
    setWfh({ on });
    if (on) {
      setShipAuto(true);
      // An employee's home is never the billing / office address: start from a
      // saved WFH address or a blank one.
      if (!String(shipChoice.key).startsWith('saved_') && shipChoice.key !== 'manual') {
        const saved = addr.options.find((o) => o.is_wfh);
        setShipChoice(saved ? { key: saved.value, manual: null } : { key: 'manual', manual: shipChoice.manual || null });
      }
    } else {
      if (shipAuto) setShipping('');
      setShipAuto(false);
    }
  };

  const onCustomer = (id) => {
    setCustomerId(id);
    setShipChoice({ key: wfh.on ? 'manual' : 'billing', manual: null });
    const c = (meta?.customers || []).find((x) => String(x.customer_id) === String(id));
    // Only a real GSTIN is copied (and then locked); placeholders like "NA" are not.
    setGst(customerGstin(c));
  };

  const submit = async () => {
    const e = {};
    if (!customerId) e.customer = 'Choose the customer';
    const c = (meta?.customers || []).find((x) => String(x.customer_id) === String(customerId));
    if (c && !isCustomerEligibleForQuotation(c.customer_type, type, c.customer_type_source)) e.customer = customerTypeMismatchMessage(c.customer_type, type);
    const miss = firstMissing(lines, REQUIRED);
    if (miss) e.line = miss;
    if (gstinError(gst)) e.gst = gstinError(gst);
    if (rentalGstMissing) e.gst = 'A rental order needs the customer’s GSTIN — add it on the customer record, then recheck';
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
      toast.error(e.advance || e.customer || (e.gst && (rentalGstMissing ? e.gst : `GSTIN: ${e.gst}`)) || (e.line ? `Line ${e.line.index + 1}: ${fieldLabel(e.line.field)} is missing` : e.shipping || 'Some required fields are empty'));
      return;
    }

    // WFH: the ship-to contact is the employee.
    const shipPayload = inPlace ? null : (wfh.on
      ? { ...shipAddress, employee_name: shipAddress?.name || undefined, employee_phone: shipAddress?.phone || undefined }
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
      is_wfh: wfh.on && !inPlace,
      wfh_employee_name: wfh.on && !inPlace ? shipAddress?.name || undefined : undefined,
      wfh_employee_phone: wfh.on && !inPlace ? shipAddress?.phone || undefined : undefined,
      draft_id: !editSo && draftId ? draftId : undefined,
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

  const saveDraft = async () => {
    const c = selectedCustomer;
    const body = {
      payload: { type, demoBook, quotationNumber, customerId, gst, lines, securityType, shipping, shipAuto, inPlace, wfh, shipChoice, advance },
      customer_id: customerId || null,
      customer_name: c ? (c.company_name || c.name) : '',
      quotation_type: type,
      quotation_number: quotationNumber || '',
      total: totals.grand_total || 0,
    };
    setDraftSaving(true);
    try {
      if (draftId) {
        await updateSalesOrderDraft(draftId, body);
      } else {
        const { data } = await createSalesOrderDraft(body);
        const id = String(data.draft_id);
        setDraftId(id);
        loadedDraft.current = id;
        navigate(`/carret/sell/sales-orders/new?draft=${id}`, { replace: true });
      }
      toast.success('Draft saved — find it under Sales orders → Drafts');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save the draft.');
    } finally {
      setDraftSaving(false);
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
      title={editSo ? `Edit ${editSo}` : (draftId ? 'New sales order (draft)' : 'New sales order')}
      breadcrumb="Sell / Sales orders"
      subtitle={editSo ? 'Changes regenerate the order PDF.' : 'The SO number is assigned when you create the order. A draft takes no number.'}
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
                <SearchSelect
                  value={customerId}
                  onChange={(e) => onCustomer(e.target.value)}
                  disabled={Boolean(editSo)}
                  placeholder={meta ? `Type to search ${customers.length} eligible customers` : 'Loading…'}
                  options={[
                    ...(customerId && !customers.some((c) => String(c.customer_id) === customerId)
                      ? [{ value: customerId, label: `Customer #${customerId}` }] : []),
                    ...customers.map((c) => ({ value: String(c.customer_id), label: `${c.company_name || c.name}${c.gst_no ? ` · ${c.gst_no}` : ''}`, search: [c.name, c.company_name, c.phone, c.email].filter(Boolean).join(' ') })),
                  ]}
                />
              </Field>
              <GstinField value={gst} onChange={setGst} locked={gstLocked} error={errors.gst} />
            </FormGrid>
            {rentalGstMissing && (
              <div style={{ marginTop: '12px' }}>
                <Notice
                  tone="crit"
                  title="GSTIN required for a rental order"
                  action={(
                    <div className="flex flex-wrap" style={{ gap: '8px' }}>
                      <Button onClick={() => window.open(`/carret/sell/customers/${encodeURIComponent(customerId)}?tab=profile`, '_blank', 'noopener')}>Add GSTIN on the customer</Button>
                      <Button variant="quiet" onClick={() => setMetaTick((t) => t + 1)}>Recheck</Button>
                    </div>
                  )}
                >
                  {selectedCustomer.company_name || selectedCustomer.name} has no GSTIN. Add it on the customer’s Profile (Look up GSTIN also updates the billing address), then press Recheck. You can save this as a draft meanwhile.
                </Notice>
              </div>
            )}
          </Section>

          <Section title="Laptops">
            <LineItemsEditor lines={lines} onChange={setLines} quotationType={type} required={REQUIRED} errors={errors.line} collapsible />
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
                  {(!isSale || wfh.on) && (
                  <Checkbox
                    label={`Work-from-home delivery to an employee (₹${WFH_SHIPPING} per laptop shipping + GST)`}
                    checked={wfh.on}
                    onChange={(e) => onWfh(e.target.checked)}
                  />
                  )}
                  {customerId ? (
                    <div className="c-form-grid" style={{ '--c-cols': 2 }}>
                      <div>
                        <div className="c-label" style={{ marginBottom: '6px' }}>Bill to</div>
                        {addr.loading ? <span className="text-ink-3">Loading…</span> : <AddressText address={addr.billing} />}
                      </div>
                      <ShippingPicker
                        options={addr.options}
                        value={shipChoice}
                        onChange={setShipChoice}
                        errors={errors.ship}
                        label={wfh.on ? 'Employee’s home address' : 'Ship to'}
                        hint={wfh.on ? 'Saved on the customer as a WFH address, so a later pickup from it is charged.' : undefined}
                        nameLabel={wfh.on ? 'Employee name' : undefined}
                        phoneLabel={wfh.on ? 'Employee phone' : undefined}
                      />
                    </div>
                  ) : (
                    <p className="font-ui text-ink-3 m-0">Choose the customer to pick a delivery address.</p>
                  )}
                  {errors.ship?.address && shipChoice.key !== 'manual' && <Notice tone="crit">{errors.ship.address}</Notice>}
                  {!isSale && !wfh.on && shipOption?.is_wfh && (
                    <Notice tone="warn" action={<Button onClick={() => onWfh(true)}>Make it WFH</Button>}>
                      This is a saved work-from-home address. Tick work-from-home delivery so the ₹{WFH_SHIPPING}-per-laptop shipping and GST apply.
                    </Notice>
                  )}
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
                <Field label="Shipping charges (₹)" required={wfh.on} error={errors.shipping} hint={wfh.on ? `Work from home: ₹${WFH_SHIPPING} × ${laptopCount || 1} laptop${laptopCount === 1 ? '' : 's'}${shipAuto ? '' : ' (edited by hand)'}, GST added` : (isSale ? 'Optional' : undefined)}>
                  <Input type="number" min="0" step="0.01" value={shipping} onChange={(e) => { setShipAuto(false); setShipping(e.target.value); }} />
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
              <div><span>Shipping{wfh.on ? ' (WFH, GST added)' : ''}</span><span><Money value={totals.shipping} /></span></div>
              {!isSale && <div><span>Security deposit</span><span><Money value={totals.security} /></span></div>}
              <div className="is-grand"><span>{isSale ? 'Total' : 'First payment'}</span><span><Money value={totals.grand_total} /></span></div>
              {advance.on && Number(advance.amount) > 0 && <div><span>Advance before dispatch</span><span><Money value={Number(advance.amount)} /></span></div>}
            </div>
            <p className="font-ui text-ink-3" style={{ fontSize: 'var(--d-sm)', margin: '10px 0 0' }}>
              Place of supply: {supplyState ? formatSupplyStateLabel(supplyState) : 'from the delivery address'}. Security is not taxed.
            </p>
          </Section>
          <div className="c-stack" style={{ gap: '8px' }}>
            <Button variant="primary" onClick={submit} disabled={saving || draftSaving}>{saving ? 'Saving…' : (editSo ? 'Save changes' : 'Create sales order')}</Button>
            {!editSo && (
              <Button onClick={saveDraft} disabled={saving || draftSaving}>{draftSaving ? 'Saving draft…' : (draftId ? 'Update draft' : 'Save as draft')}</Button>
            )}
            <Button variant="quiet" onClick={() => navigate(editSo ? `/carret/sell/sales-orders/${encodeURIComponent(editSo)}` : '/carret/sell/sales-orders')} disabled={saving}>Cancel</Button>
          </div>
        </aside>
      </div>
    </DeskShell>
  );
}

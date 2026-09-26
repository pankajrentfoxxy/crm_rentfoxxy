import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, Checkbox, EmptyState, Field, FormGrid, Input, Money, Notice, Section, Select, Textarea,
} from '../../../components/carret';
import api from '../../../utils/api';
import { INDIAN_STATE_OPTIONS } from '../../../constants/indianStates';
import { LAPTOP_CONDITIONS } from '../../../constants/laptopConditions';
import {
  createPurchaseOrder, fetchPurchaseOrder, fetchPurchaseOrderFormMeta, patchPurchaseOrderStatus,
} from '../../vendor-management/vendorManagementApi';
import { modelsForBrand, processorsForBrand, generationsForBrandProcessor } from '../../../utils/assetCatalogUtils';
import { errMsg } from './procureShared';
import { PO_BASE, PO_TYPES, isRentalType, poStatus } from './poShared';

/**
 * Procure → Purchase order → new / edit.
 *
 * D3: a rental PO asks for the MONTHLY RENT per laptop (what the vendor bills
 * us) and, separately, the laptop's asset value (for e-way bills and
 * insurance). It used to ask for "Rate" and "Monthly rental" side by side, and
 * billing read the wrong one. A purchase PO asks for the price.
 *
 * Only a draft (or one sent back) can be edited. An approved PO is amended
 * from its record first, which puts it back through approval.
 *
 * Opened from the To-buy queue (?request=<id>), the lines come from the
 * order's shortfall, and saving links the order to this PO.
 */
const today = () => new Date().toISOString().slice(0, 10);
const normState = (s) => String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const blankLine = () => ({
  brand: '', model: '', processor: '', generation: '', ram: '', storage: '', gpu: '', screen_size: '',
  quantity: 1, rate: '', asset_value: '', months: '', remarks: '', allowed_conditions: ['on'],
});
const withValue = (list, v) => (v && !list.includes(v) ? [v, ...list] : list);

function lineFromPo(l, type) {
  return {
    ...blankLine(),
    brand: l.brand || '', model: l.model || l.model_name || '', processor: l.processor || '', generation: l.generation || '',
    ram: l.ram || '', storage: l.storage || '', gpu: l.gpu || '', screen_size: l.screen_size || '',
    quantity: Number(l.quantity) || 1,
    rate: String((isRentalType(type) ? (Number(l.monthly_rental_amount) || l.rate) : l.rate) ?? ''),
    asset_value: l.asset_value != null ? String(l.asset_value) : '',
    months: String((isRentalType(type) ? (l.vendor_locking_period ?? l.locking_period) : (l.warranty ?? l.warranty_months)) ?? ''),
    remarks: l.remarks || '',
    allowed_conditions: Array.isArray(l.allowed_conditions) && l.allowed_conditions.length ? l.allowed_conditions : ['on'],
  };
}

export default function PurchaseOrderFormPage() {
  const { poId } = useParams();
  const isEdit = Boolean(poId);
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [po, setPo] = useState(null);
  const [form, setForm] = useState({
    vendor_id: params.get('vendor_id') || '', purchase_order_type: 'rental_purchase', purchase_order_date: today(),
    expected_delivery_date: '', po_state: 'haryana', remarks: '', lines: [blankLine()],
  });
  const [request, setRequest] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState('');

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { data: m } = await fetchPurchaseOrderFormMeta();
        if (off) return;
        setMeta(m);
        if (isEdit) {
          const { data } = await fetchPurchaseOrder(poId);
          const p = data.data;
          setPo(p);
          setForm({
            vendor_id: String(p.vendor_id || ''), purchase_order_type: p.purchase_order_type || 'rental_purchase',
            purchase_order_date: String(p.purchase_order_date || '').slice(0, 10) || today(),
            expected_delivery_date: String(p.expected_delivery_date || '').slice(0, 10),
            po_state: normState(p.po_state) || 'haryana', remarks: p.remarks || '',
            lines: (p.line_items || []).map((l) => lineFromPo(l, p.purchase_order_type)),
          });
        } else if (requestId) {
          const { data } = await api.get('/vendor-management/to-buy');
          const r = (data.laptops || []).find((x) => String(x.request_id) === String(requestId));
          if (r) {
            setRequest(r);
            const rental = !String(r.order_type || '').toLowerCase().startsWith('sale');
            setForm((f) => ({
              ...f,
              purchase_order_type: rental ? 'rental_purchase' : 'direct_purchase',
              remarks: f.remarks || `For sales order ${r.sales_order_number} (${r.customer_name || 'customer'}).`,
              lines: r.lines.filter((l) => l.short > 0).map((l) => ({
                ...blankLine(), brand: l.brand || '', model: l.model_name || '', processor: l.processor || '',
                generation: l.generation || '', ram: l.ram || '', storage: l.storage || '', quantity: l.short,
              })),
            }));
          }
        }
        setLoading(false);
      } catch (e) {
        if (!off) { setLoadError(errMsg(e, 'Could not load the form.')); setLoading(false); }
      }
    })();
    return () => { off = true; };
  }, [isEdit, poId, requestId]);

  const catalog = meta?.asset_catalog || {};
  const vendors = meta?.vendors || [];
  const vendor = vendors.find((v) => String(v.id) === String(form.vendor_id));
  const rental = isRentalType(form.purchase_order_type);
  const sameState = vendor && (vendor.gst_state || normState(vendor.state)) === normState(form.po_state);
  const subtotal = form.lines.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const total = Math.round(subtotal * 118) / 100;
  const locked = isEdit && po && !['draft', 'pending', 'rejected', 'vendor_rejected', ''].includes(poStatus(po));

  const vendorOptions = useMemo(() => {
    const opts = vendors.map((v) => ({ value: String(v.id), label: v.label }));
    if (po && !opts.some((o) => o.value === String(po.vendor_id))) opts.unshift({ value: String(po.vendor_id), label: `${po.vendor_display_name || 'Vendor'} (not approved)` });
    return opts;
  }, [vendors, po]);

  const set = (k) => (e) => {
    const v = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => { const n = { ...er }; delete n[k]; return n; });
  };
  const setLine = (i, k, v) => setForm((f) => ({
    ...f,
    lines: f.lines.map((l, j) => {
      if (j !== i) return l;
      const next = { ...l, [k]: v };
      if (k === 'brand') { next.model = ''; next.processor = ''; next.generation = ''; }
      if (k === 'processor') next.generation = '';
      return next;
    }),
  }));

  const validate = () => {
    const e = {};
    if (!form.vendor_id) e.vendor_id = 'Pick the vendor';
    if (!form.po_state) e.po_state = 'Pick the state';
    if (!form.remarks.trim()) e.remarks = 'Say what this order is for — it prints on the PO';
    if (!form.lines.length) e.lines = 'Add at least one laptop line';
    form.lines.forEach((l, i) => {
      if (!l.brand || !l.processor || !l.ram || !l.storage) e[`line${i}`] = 'Brand, processor, RAM and storage are needed — the receiving check compares against them.';
      else if (!(Number(l.quantity) > 0)) e[`line${i}`] = 'Quantity must be at least 1.';
      else if (!(Number(l.rate) > 0)) e[`line${i}`] = rental ? 'Enter the monthly rent per laptop.' : 'Enter the price per laptop.';
    });
    return e;
  };

  const save = async (submit) => {
    const found = validate();
    if (Object.keys(found).length) { setErrors(found); toast.error('Some fields need fixing — they are marked in red.'); return; }
    setSaving(submit ? 'submit' : 'save');
    const body = {
      vendor_id: Number(form.vendor_id),
      purchase_order_type: form.purchase_order_type,
      purchase_order_date: form.purchase_order_date,
      expected_delivery_date: form.expected_delivery_date || '',
      po_state: form.po_state,
      remarks: form.remarks.trim(),
      line_items: form.lines.map((l) => ({
        brand: l.brand, model: l.model, processor: l.processor, generation: l.generation, ram: l.ram, storage: l.storage,
        gpu: l.gpu, screen_size: l.screen_size, quantity: Number(l.quantity), rate: Number(l.rate),
        ...(rental
          ? { monthly_rental_amount: Number(l.rate), asset_value: l.asset_value ? Number(l.asset_value) : null, vendor_locking_period: l.months === '' ? null : Number(l.months) }
          : { warranty: l.months === '' ? null : Number(l.months) }),
        remarks: l.remarks || null,
        allowed_conditions: l.allowed_conditions,
      })),
    };
    try {
      let id = poId;
      if (isEdit) {
        await api.put(`${PO_BASE}/${poId}`, body);
      } else {
        const { data } = await createPurchaseOrder(body);
        id = data?.data?.po_id;
        if (request && id) {
          await api.patch(`/vendor-management/to-buy/laptop-requests/${request.request_id}/link`, { po_id: id })
            .catch(() => toast.error(`Saved, but ${request.sales_order_number} was not linked — link it from To buy`));
        }
      }
      if (submit && id) {
        await patchPurchaseOrderStatus(id, 'pending_approval');
        toast.success('Saved and sent for approval');
      } else toast.success('Draft saved');
      navigate(`/carret/procure/purchase-orders/${id}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not save the purchase order.'));
    } finally {
      setSaving('');
    }
  };

  const title = isEdit ? `Edit ${po?.purchase_order_number || 'purchase order'}` : 'New purchase order';

  return (
    <DeskShell title={title} breadcrumb="Procure / Purchase orders">
      {loading && <EmptyState title="Loading…" />}
      {loadError && <EmptyState title="Could not load" body={loadError} action={<Button onClick={() => navigate('/carret/procure/purchase-orders')}>Back</Button>} />}
      {!loading && !loadError && locked && (
        <Notice tone="warn" title={`This purchase order is ${poStatus(po).replace(/_/g, ' ')}`} action={<Button onClick={() => navigate(`/carret/procure/purchase-orders/${poId}`)}>Open it</Button>}>
          It can't be edited directly. Use “Amend” on the purchase order: it goes back for approval and is sent to the vendor again.
        </Notice>
      )}
      {!loading && !loadError && !locked && (
        <div className="c-stack">
          {request && (
            <Notice tone="info" title={`For sales order ${request.sales_order_number}`}>
              The lines are what the order is short. Saving links the order to this PO on the To-buy list.
            </Notice>
          )}
          {po && Number(po.amendment_no) > 0 && <Notice tone="info" title={`Amendment ${po.amendment_no}`}>{po.amend_reason}</Notice>}
          {po?.rejection_reason && ['rejected', 'vendor_rejected'].includes(poStatus(po)) && (
            <Notice tone="serious" title={poStatus(po) === 'vendor_rejected' ? 'The vendor declined it' : 'Sent back by the approver'}>{po.rejection_reason}</Notice>
          )}

          <Section title="Order">
            <FormGrid cols={3}>
              <Field label="Vendor" required error={errors.vendor_id} span={2} hint={vendor ? [(vendor.gst_state || vendor.state) && `GST state: ${String(vendor.gst_state || vendor.state).replace(/_/g, ' ')}`, vendor.phone].filter(Boolean).join(' · ') : 'Only approved vendors are listed'}>
                <Select value={form.vendor_id} onChange={set('vendor_id')} placeholder="Pick the vendor" options={vendorOptions} />
              </Field>
              <Field label="Type" required>
                <Select value={form.purchase_order_type} onChange={set('purchase_order_type')} options={PO_TYPES} />
              </Field>
              <Field label="PO date" required>
                <Input type="date" value={form.purchase_order_date} onChange={set('purchase_order_date')} />
              </Field>
              <Field label="Deliver by" hint="Shown to the vendor and on the gate's expected list">
                <Input type="date" value={form.expected_delivery_date} min={form.purchase_order_date} onChange={set('expected_delivery_date')} />
              </Field>
              <Field label="Deliver to (state)" required error={errors.po_state} hint={vendor ? (sameState ? 'Same state as the vendor: CGST + SGST' : 'Other state: IGST') : undefined}>
                <Select value={form.po_state} onChange={set('po_state')} options={INDIAN_STATE_OPTIONS} />
              </Field>
            </FormGrid>
          </Section>

          <Section
            title={`Laptops · ${form.lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0)}`}
            actions={<Button onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>Add line</Button>}
          >
            {errors.lines && <p className="c-note is-error">{errors.lines}</p>}
            <div className="c-stack">
              {form.lines.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} className="c-card" style={{ padding: '12px' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                    <strong>Line {i + 1}</strong>
                    {form.lines.length > 1 && <Button variant="quiet" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>Remove</Button>}
                  </div>
                  <FormGrid cols={4}>
                    <Field label="Brand" required><Select value={l.brand} onChange={(e) => setLine(i, 'brand', e.target.value)} placeholder="—" options={withValue(catalog.brands || [], l.brand)} /></Field>
                    <Field label="Model"><Select value={l.model} onChange={(e) => setLine(i, 'model', e.target.value)} placeholder="Any" options={withValue(modelsForBrand(l.brand, catalog), l.model)} /></Field>
                    <Field label="Processor" required><Select value={l.processor} onChange={(e) => setLine(i, 'processor', e.target.value)} placeholder="—" options={withValue(processorsForBrand(l.brand, catalog), l.processor)} /></Field>
                    <Field label="Generation"><Select value={l.generation} onChange={(e) => setLine(i, 'generation', e.target.value)} placeholder="Any" options={withValue(generationsForBrandProcessor(l.brand, l.processor, catalog), l.generation)} /></Field>
                    <Field label="RAM" required><Select value={l.ram} onChange={(e) => setLine(i, 'ram', e.target.value)} placeholder="—" options={withValue(catalog.rams || [], l.ram)} /></Field>
                    <Field label="Storage" required><Select value={l.storage} onChange={(e) => setLine(i, 'storage', e.target.value)} placeholder="—" options={withValue(catalog.storages || [], l.storage)} /></Field>
                    <Field label="Graphics"><Select value={l.gpu} onChange={(e) => setLine(i, 'gpu', e.target.value)} placeholder="Any" options={withValue(catalog.gpus || [], l.gpu)} /></Field>
                    <Field label="Screen"><Select value={l.screen_size} onChange={(e) => setLine(i, 'screen_size', e.target.value)} placeholder="Any" options={withValue(catalog.screen_sizes || [], l.screen_size)} /></Field>
                    <Field label="Quantity" required><Input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></Field>
                    <Field label={rental ? 'Monthly rent per laptop' : 'Price per laptop'} required hint={rental ? 'What the vendor bills us each month' : 'Before GST'}>
                      <Input type="number" min={0} step="0.01" value={l.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} />
                    </Field>
                    <Field label={rental ? 'Lock-in (months)' : 'Warranty (months)'}>
                      <Input type="number" min={0} value={l.months} onChange={(e) => setLine(i, 'months', e.target.value)} />
                    </Field>
                    {rental
                      ? <Field label="Asset value per laptop" hint="For e-way bills and insurance; not billed"><Input type="number" min={0} value={l.asset_value} onChange={(e) => setLine(i, 'asset_value', e.target.value)} /></Field>
                      : <div />}
                    <Field label="Accept at the door when" span={2} hint="A laptop that won't power on still needs a manager-approved waiver">
                      <div className="flex flex-wrap" style={{ gap: '12px' }}>
                        {LAPTOP_CONDITIONS.map((c) => (
                          <Checkbox
                            key={c.value}
                            label={c.label}
                            checked={l.allowed_conditions.includes(c.value)}
                            onChange={(e) => {
                              const next = e.target.checked ? [...l.allowed_conditions, c.value] : l.allowed_conditions.filter((x) => x !== c.value);
                              setLine(i, 'allowed_conditions', next.length ? next : ['on']);
                            }}
                          />
                        ))}
                      </div>
                    </Field>
                    <Field label="Line note" span={2}><Input value={l.remarks} onChange={(e) => setLine(i, 'remarks', e.target.value)} /></Field>
                  </FormGrid>
                  {errors[`line${i}`] && <p className="c-note is-error">{errors[`line${i}`]}</p>}
                  <p className="text-ink-3" style={{ marginTop: '6px' }}>
                    Line total <Money value={(Number(l.quantity) || 0) * (Number(l.rate) || 0)} />{rental ? ' per month' : ''}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Terms and total">
            <FormGrid cols={2}>
              <Field label="What this order is for / terms" required error={errors.remarks} hint="Prints on the PO the vendor receives">
                <Textarea rows={4} value={form.remarks} onChange={set('remarks')} />
              </Field>
              <div className="c-stack" style={{ gap: '4px', alignSelf: 'end', textAlign: 'right' }}>
                <div>{rental ? 'Rent per month' : 'Subtotal'} <Money value={subtotal} /></div>
                <div className="text-ink-3">GST 18% {vendor ? (sameState ? '(CGST 9% + SGST 9%)' : '(IGST)') : ''} <Money value={total - subtotal} /></div>
                <div style={{ fontSize: '1.15rem' }}><strong>{rental ? 'Total per month' : 'Total'} <Money value={total} /></strong></div>
              </div>
            </FormGrid>
          </Section>

          <div className="flex items-center justify-end" style={{ gap: '8px' }}>
            <Button variant="quiet" onClick={() => navigate(isEdit ? `/carret/procure/purchase-orders/${poId}` : '/carret/procure/purchase-orders')}>Cancel</Button>
            <Button disabled={Boolean(saving)} onClick={() => save(false)}>{saving === 'save' ? 'Saving…' : 'Save draft'}</Button>
            <Button variant="primary" disabled={Boolean(saving)} onClick={() => save(true)}>{saving === 'submit' ? 'Sending…' : 'Save and send for approval'}</Button>
          </div>
        </div>
      )}
    </DeskShell>
  );
}

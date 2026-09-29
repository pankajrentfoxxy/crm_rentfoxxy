import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DocNumber, EmptyState, Field, FormGrid, Input, Money, Notice, SearchSelect, Section, Select, Textarea,
} from '../../../components/carret';
import { usePermission } from '../../../hooks/usePermission';
import { createOutForRepairDc, fetchDiagnosisFailedTickets, fetchVendorRepairCompanyDefaults } from '../../floor-pipeline/vendorRepairApi';
import { DEFAULT_BILLING_ADDRESS, formatVendorBillingFromVendor, formatVendorShippingFromVendor } from '../../floor-pipeline/vendorRepairUi';
import { REPAIR_ISSUE_TYPES, addDaysYmd, todayIst } from '../../floor-pipeline/repairIssueTypes';
import { fetchVendor, fetchVendors } from '../../vendor-management/vendorManagementApi';
import { formatStateLabel } from '../../vendor-management/vendorMgmtUi';
import VrtdcTransportFields, { validateVrtdcTransport } from '../../vendor-management/components/VrtdcTransportFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import { checkTtsplAndSerial } from '../../../utils/machineIdentityVerify';
import { formatIndianMobileInput, indianMobileError, normalizeIndianMobile } from '../../../utils/phoneValidation';
import { errMsg, vendorName } from './procureShared';
import { REPAIR_WAREHOUSE_ROLES } from './repairShared';

/**
 * Procurement → Vendor returns → To repair → make a repair challan (VRDC).
 *
 * The old "Out for Repair" modal on Floor → Diagnosis Failed, on the same
 * endpoint (POST /vendor-repair/out-for-repair) with the same rules: per laptop
 * scan TTSPL + serial, issue type and remarks (required), declared value
 * pre-filled from the PO line; HSN only for admins; a rent stop date (today …
 * +30 days) when a laptop is rented from this vendor; transport per mode.
 * The challan record opens next (mail the vendor, sign, send to the gate).
 */
const blankForm = {
  vendor_id: '', vendor_name: '', vendor_billing_address: '', shipping_address: '',
  contact_person: '', contact_mobile: '', expected_return_date: '', remarks: '',
};

export default function RepairChallanCreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, hasPermission } = usePermission();
  // requireDiagnosisFailedProcess: diagnosis_failed create/edit OR a warehouse role.
  const canCreate = REPAIR_WAREHOUSE_ROLES.has(user?.role) || hasPermission('diagnosis_failed', 'create') || hasPermission('diagnosis_failed', 'edit');
  const canHsn = user?.role === 'admin' || user?.role === 'super_admin';
  const wanted = useMemo(() => new Set(String(params.get('tickets') || '').split(',').filter(Boolean).map(String)), [params]);

  const [rows, setRows] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [techs, setTechs] = useState([]);
  const [defaults, setDefaults] = useState({ hsn: '847330', threshold: 50000 });
  const [form, setForm] = useState(blankForm);
  const [shipBy, setShipBy] = useState('');
  const [fields, setFields] = useState({});
  const [per, setPer] = useState({}); // ticket_id -> { issue, remarks, price, hsn, ttspl, serial }
  const [rentStop, setRentStop] = useState(todayIst());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchDiagnosisFailedTickets({})
      .then(({ data }) => {
        const picked = (data.data || []).filter((r) => wanted.has(String(r.ticket_id)));
        setRows(picked);
        setPer(Object.fromEntries(picked.map((r) => [r.ticket_id, {
          issue: '', remarks: r.diagnosis_failed_reason || '', price: r.suggested_value != null ? String(r.suggested_value) : '', hsn: '', ttspl: '', serial: '',
        }])));
      })
      .catch((e) => { setRows([]); toast.error(errMsg(e, 'Could not load the laptops')); });
    fetchVendors({ page: 1, limit: 200 }).then(({ data }) => setVendors(data.data || [])).catch(() => setVendors([]));
    fetchDeliveryTechnicians({ limit: 200 }).then((d) => setTechs(d?.data || d?.technicians || [])).catch(() => {});
    fetchVendorRepairCompanyDefaults()
      .then(({ data }) => setDefaults({ hsn: String(data?.hsn_code || '847330'), threshold: Number(data?.eway_value_threshold) || 50000 }))
      .catch(() => {});
  }, [wanted]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (id, k, v) => setPer((m) => ({ ...m, [id]: { ...(m[id] || {}), [k]: v } }));

  const pickVendor = async (vendorId) => {
    if (!vendorId) { set('vendor_id', ''); return; }
    try {
      const { data } = await fetchVendor(vendorId);
      const raw = data?.data;
      const v = raw ? { ...raw, state_label: formatStateLabel(raw.state), shipping_state_label: formatStateLabel(raw.shipping_state) } : null;
      setForm((f) => ({
        ...f,
        vendor_id: vendorId,
        vendor_name: v?.business_name || v?.f_name || f.vendor_name,
        vendor_billing_address: formatVendorBillingFromVendor(v) || f.vendor_billing_address,
        shipping_address: formatVendorShippingFromVendor(v) || f.shipping_address,
        contact_person: v?.contact_person_name || v?.f_name || f.contact_person,
        contact_mobile: v?.contact_person_phone || v?.phone || v?.number || f.contact_mobile,
      }));
    } catch {
      set('vendor_id', vendorId);
    }
  };

  const list = rows || [];
  const total = list.reduce((n, r) => n + (Number(per[r.ticket_id]?.price) > 0 ? Number(per[r.ticket_id].price) : 0), 0);
  const rentedHere = list.filter((r) => r.is_vendor_rented && form.vendor_id && String(r.rent_vendor_id) === String(form.vendor_id));
  const today = todayIst();

  const submit = async () => {
    if (!list.length) { toast.error('No laptops picked'); return; }
    if (!form.vendor_name.trim()) { toast.error('Pick the vendor'); return; }
    if (!form.vendor_billing_address.trim() || !form.shipping_address.trim()) { toast.error('The vendor’s billing and shipping addresses are required'); return; }
    const err = validateVrtdcTransport(shipBy, fields);
    if (err) { toast.error(err); return; }
    if (rentedHere.length) {
      if (!rentStop) { toast.error('Set the date rent stops'); return; }
      if (rentStop < today) { toast.error('The rent stop date can’t be in the past'); return; }
      if (rentStop > addDaysYmd(today, 30)) { toast.error('The rent stop date can be at most 30 days ahead'); return; }
    }
    for (const r of list) {
      const p = per[r.ticket_id] || {};
      const label = r.ttspl_id || `#${r.ticket_id}`;
      if (!p.issue) { toast.error(`Choose the issue for ${label}`); return; }
      if (String(p.remarks || '').trim().length < 3) { toast.error(`Write the remarks for ${label}`); return; }
      if (canHsn && p.hsn && !/^\d{4,8}$/.test(String(p.hsn).trim())) { toast.error(`HSN for ${label} must be 4–8 digits`); return; }
      const check = checkTtsplAndSerial({ expectedTtspl: r.ttspl_id, expectedSerial: r.serial_number, verifiedTtspl: p.ttspl, verifiedSerial: p.serial, label });
      if (!check.ok) { toast.error(check.message); return; }
    }
    if (form.contact_mobile.trim()) {
      const m = indianMobileError(form.contact_mobile, { label: 'Contact mobile' });
      if (m) { toast.error(m); return; }
    }
    setBusy(true);
    try {
      const { data } = await createOutForRepairDc({
        ticket_ids: list.map((r) => r.ticket_id),
        vendor_id: form.vendor_id || undefined,
        vendor_name: form.vendor_name.trim(),
        vendor_billing_address: form.vendor_billing_address.trim(),
        vendor_address: form.vendor_billing_address.trim(),
        shipping_address: form.shipping_address.trim(),
        contact_person: form.contact_person.trim() || undefined,
        contact_mobile: form.contact_mobile.trim() ? normalizeIndianMobile(form.contact_mobile) : undefined,
        expected_return_date: form.expected_return_date || undefined,
        remarks: form.remarks.trim() || undefined,
        warehouse_address: DEFAULT_BILLING_ADDRESS,
        item_remarks: Object.fromEntries(list.map((r) => [r.ticket_id, per[r.ticket_id]?.remarks || ''])),
        item_issue_types: Object.fromEntries(list.map((r) => [r.ticket_id, per[r.ticket_id]?.issue || ''])),
        item_prices: Object.fromEntries(list.map((r) => [r.ticket_id, per[r.ticket_id]?.price ?? ''])),
        item_hsn_codes: canHsn ? Object.fromEntries(list.map((r) => [r.ticket_id, per[r.ticket_id]?.hsn || defaults.hsn])) : undefined,
        item_verifications: Object.fromEntries(list.map((r) => [r.ticket_id, { ttspl: per[r.ticket_id]?.ttspl || '', serial: per[r.ticket_id]?.serial || '' }])),
        rent_stop_date: rentedHere.length ? rentStop : undefined,
        ship_by: shipBy,
        ...fields,
        delivery_person_id: fields.delivery_person_id || undefined,
        vehicle_number: fields.vehicle_number || undefined,
      });
      toast.success(data?.message || 'Repair challan made');
      navigate(`/carret/procure/repairs/${encodeURIComponent(data.dc_number)}`);
    } catch (e) {
      toast.error(errMsg(e, 'Could not make the challan'));
    } finally { setBusy(false); }
  };

  if (!canCreate) {
    return <DeskShell title="New repair challan" breadcrumb="Procurement / Vendor returns"><EmptyState title="You can’t make repair challans" body="It needs Diagnosis Failed create or edit, or a warehouse role." /></DeskShell>;
  }
  if (rows === null) return <DeskShell title="New repair challan" breadcrumb="Procurement / Vendor returns"><EmptyState title="Loading…" /></DeskShell>;
  if (!list.length) {
    return (
      <DeskShell title="New repair challan" breadcrumb="Procurement / Vendor returns">
        <EmptyState title="No laptops picked" body="Pick laptops on the “To repair” list first — they may already be on a challan." action={<Button onClick={() => navigate('/carret/procure/returns?tab=to_repair')}>To repair</Button>} />
      </DeskShell>
    );
  }

  const cols = [
    { key: 't', header: 'Laptop', render: (r) => <DocNumber value={r.ttspl_id} />, sub: (r) => [r.serial_number, r.configuration].filter(Boolean).join(' · ') },
    {
      key: 'v',
      header: 'Scan to check',
      render: (r) => (
        <div className="flex flex-col" style={{ gap: '4px' }}>
          <Input placeholder="TTSPL" className="font-mono" value={per[r.ticket_id]?.ttspl || ''} onChange={(e) => setItem(r.ticket_id, 'ttspl', e.target.value)} aria-label={`Check TTSPL of ${r.ttspl_id}`} autoComplete="off" />
          <Input placeholder="Serial" className="font-mono" value={per[r.ticket_id]?.serial || ''} onChange={(e) => setItem(r.ticket_id, 'serial', e.target.value)} aria-label={`Check serial of ${r.ttspl_id}`} autoComplete="off" />
        </div>
      ),
    },
    {
      key: 'i',
      header: 'Issue and remarks',
      render: (r) => (
        <div className="flex flex-col" style={{ gap: '4px', minWidth: '14rem' }}>
          <Select value={per[r.ticket_id]?.issue || ''} onChange={(e) => setItem(r.ticket_id, 'issue', e.target.value)} placeholder="Issue…" options={REPAIR_ISSUE_TYPES} aria-label={`Issue of ${r.ttspl_id}`} />
          <Textarea rows={2} placeholder="Remarks for the vendor" value={per[r.ticket_id]?.remarks || ''} onChange={(e) => setItem(r.ticket_id, 'remarks', e.target.value)} />
          {r.is_vendor_rented && (
            <span className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>
              Rented from {r.rent_vendor_name || 'a vendor'}{form.vendor_id && String(r.rent_vendor_id) !== String(form.vendor_id) ? ' — a different vendor, so rent continues' : ''}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'p',
      header: 'Declared value',
      numeric: true,
      render: (r) => (
        <div className="flex flex-col" style={{ gap: '4px', alignItems: 'flex-end' }}>
          <Input type="number" min={0} step="0.01" value={per[r.ticket_id]?.price ?? ''} onChange={(e) => setItem(r.ticket_id, 'price', e.target.value)} style={{ width: '8rem', textAlign: 'right' }} aria-label={`Value of ${r.ttspl_id}`} />
          {r.suggested_value != null && <span className="text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>From the PO: <Money value={r.suggested_value} /></span>}
          {canHsn && <Input placeholder={`HSN ${defaults.hsn}`} className="font-mono" value={per[r.ticket_id]?.hsn || ''} onChange={(e) => setItem(r.ticket_id, 'hsn', e.target.value)} style={{ width: '8rem' }} aria-label={`HSN of ${r.ttspl_id}`} />}
        </div>
      ),
    },
  ];

  return (
    <DeskShell title="New repair challan" breadcrumb="Procurement / Vendor returns" subtitle={`${list.length} laptop(s) from Diagnosis Failed`}>
      <div className="c-stack">
        <Section title="Vendor">
          <FormGrid cols={2}>
            <Field label="Repair vendor" required>
              <SearchSelect value={form.vendor_id} onChange={(e) => pickVendor(e.target.value)} placeholder="Choose…" options={vendors.map((v) => ({ value: String(v.vendor_id), label: vendorName(v), search: [v.gst_number, v.phone].filter(Boolean).join(' ') }))} />
            </Field>
            <Field label="Name on the challan" required><Input value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} /></Field>
            <Field label="Vendor billing address" required><Textarea rows={3} value={form.vendor_billing_address} onChange={(e) => set('vendor_billing_address', e.target.value)} /></Field>
            <Field label="Vendor shipping address" required><Textarea rows={3} value={form.shipping_address} onChange={(e) => set('shipping_address', e.target.value)} /></Field>
            <Field label="Contact person"><Input value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} /></Field>
            <Field label="Mobile"><Input inputMode="numeric" maxLength={10} value={form.contact_mobile} onChange={(e) => set('contact_mobile', formatIndianMobileInput(e.target.value))} /></Field>
            <Field label="Expected back"><Input type="date" value={form.expected_return_date} onChange={(e) => set('expected_return_date', e.target.value)} /></Field>
            <Field label="Challan remarks"><Textarea rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></Field>
          </FormGrid>
        </Section>

        {rentedHere.length > 0 && (
          <Notice tone="warn" title={`${rentedHere.length} of these laptops are rented from this vendor`}>
            Their rent stops from this date once you mail the vendor (next step, on the challan) and starts again the day each one is back at our gate.
            <div style={{ marginTop: '8px', maxWidth: '14rem' }}>
              <Input type="date" min={today} max={addDaysYmd(today, 30)} value={rentStop} onChange={(e) => setRentStop(e.target.value)} aria-label="Rent stops from" />
            </div>
          </Notice>
        )}

        <Section title={`Laptops · ${list.length}`}>
          <DataTable columns={cols} rows={list} rowKey={(r) => r.ticket_id} />
          <p className="text-ink-3" style={{ marginTop: '8px' }}>
            Declared value <Money value={total} />
            {total >= defaults.threshold
              ? ` — ₹${defaults.threshold.toLocaleString('en-IN')} or more: Accounts is mailed for the e-way bill when it is signed for dispatch, and it can’t leave the gate without it.`
              : ` — no e-way bill below ₹${defaults.threshold.toLocaleString('en-IN')}.`}
          </p>
        </Section>

        <Section title="How it travels">
          <VrtdcTransportFields shipBy={shipBy} onShipByChange={setShipBy} fields={fields} onFieldsChange={setFields} deliveryTechnicians={techs} disabled={busy} />
        </Section>

        <div className="flex justify-end" style={{ gap: '8px' }}>
          <Button variant="quiet" onClick={() => navigate('/carret/procure/returns?tab=to_repair')}>Back</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>{busy ? 'Making…' : 'Make repair challan'}</Button>
        </div>
      </div>
    </DeskShell>
  );
}

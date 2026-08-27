import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Truck } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import usePermission from '../../../hooks/usePermission';
import { DateRangeFilter } from '../../../components/ui/primitives';
import VendorSearchSelect from '../../vendor-management/components/VendorSearchSelect';
import { fetchVendor } from '../../vendor-management/vendorManagementApi';
import { fetchDiagnosisFailedTickets, createOutForRepairDc, fetchVendorRepairCompanyDefaults } from '../vendorRepairApi';
import { DEFAULT_BILLING_ADDRESS, formatVendorBillingFromVendor, formatVendorShippingFromVendor } from '../vendorRepairUi';
import VrdcDispatchFields, { validateVrdcDispatch } from '../components/VrdcDispatchFields';
import { fetchDeliveryTechnicians } from '../../../utils/deliveryRegisterApi';
import { ticketStatusLabel } from '../floorPipelineUi';
import { formatStateLabel } from '../../vendor-management/vendorMgmtUi';
import FloorPipelineFilterPanel from '../components/FloorPipelineFilterPanel';
import TtsplHistoryDrawer from '../components/TtsplHistoryDrawer';
import TtsplHistoryLink from '../components/TtsplHistoryLink';
import { formatIndianMobileInput, indianMobileError, normalizeIndianMobile } from '../../../utils/phoneValidation';
import { EMPTY_SPEC_FILTERS } from '../../inventory-management/inventorySpecFilters';
import useDebouncedSpecParams from '../../inventory-management/hooks/useDebouncedSpecParams';
import { checkTtsplAndSerial } from '../../../utils/machineIdentityVerify';

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN');
}

function withStateLabel(vendor) {
  if (!vendor) return vendor;
  return {
    ...vendor,
    state_label: formatStateLabel(vendor.state),
    shipping_state_label: formatStateLabel(vendor.shipping_state),
  };
}

export default function DiagnosisFailedPage() {
  const { user } = useAuth();
  const { canView, canCreate, canEdit } = usePermission();
  const navigate = useNavigate();
  const canProcess = canCreate('diagnosis_failed') || canEdit('diagnosis_failed');
  const canOverrideHsn = user?.role === 'admin' || user?.role === 'super_admin';
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deliveryTechnicians, setDeliveryTechnicians] = useState([]);
  const [shipBy, setShipBy] = useState('');
  const [dispatchFields, setDispatchFields] = useState({});
  const [itemRemarks, setItemRemarks] = useState({});
  const [itemPrices, setItemPrices] = useState({});
  const [itemHsnCodes, setItemHsnCodes] = useState({});
  const [itemVerifications, setItemVerifications] = useState({});
  const [defaultHsn, setDefaultHsn] = useState('847330');
  const [ewayThreshold, setEwayThreshold] = useState(50000);
  const [historyTtspl, setHistoryTtspl] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [specFilters, setSpecFilters] = useState(EMPTY_SPEC_FILTERS);
  const debouncedSpecParams = useDebouncedSpecParams(specFilters);
  const [form, setForm] = useState({
    vendor_id: '',
    vendor_name: '',
    vendor_billing_address: '',
    vendor_address: '',
    shipping_address: '',
    contact_person: '',
    contact_mobile: '',
    expected_return_date: '',
    remarks: '',
    warehouse_name: '',
    warehouse_address: '',
    eway_bill_number: '',
    eway_bill_date: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await fetchDiagnosisFailedTickets({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        ...debouncedSpecParams,
      });
      setRows(data.data || []);
      setSelected(new Set());
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, debouncedSpecParams]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchVendorRepairCompanyDefaults()
      .then((res) => {
        const d = res?.data || {};
        if (d.hsn_code) setDefaultHsn(String(d.hsn_code));
        if (d.eway_value_threshold) setEwayThreshold(Number(d.eway_value_threshold) || 50000);
      })
      .catch(() => {});
    fetchDeliveryTechnicians({ limit: 200 })
      .then((data) => setDeliveryTechnicians(data?.data || data?.technicians || []))
      .catch(() => {});
  }, []);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.ticket_id)));
  };
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.ticket_id)),
    [rows, selected]
  );

  const openModal = () => {
    const remarksInit = {};
    const pricesInit = {};
    const hsnInit = {};
    const verifyInit = {};
    selectedRows.forEach((r) => {
      remarksInit[r.ticket_id] = r.diagnosis_failed_reason || '';
      pricesInit[r.ticket_id] = '';
      hsnInit[r.ticket_id] = defaultHsn;
      verifyInit[r.ticket_id] = { ttspl: '', serial: '' };
    });
    setItemRemarks(remarksInit);
    setItemPrices(pricesInit);
    setItemHsnCodes(hsnInit);
    setItemVerifications(verifyInit);
    setForm((f) => ({ ...f, eway_bill_number: '', eway_bill_date: '' }));
    setModalOpen(true);
  };

  const totalDeclaredValue = useMemo(
    () => selectedRows.reduce((sum, r) => {
      const n = Number(itemPrices[r.ticket_id]);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0),
    [selectedRows, itemPrices]
  );
  const ewayRequired = totalDeclaredValue >= ewayThreshold;

  const onVendorChange = async (vendorId) => {
    if (!vendorId) {
      setForm((f) => ({ ...f, vendor_id: '' }));
      return;
    }
    try {
      const { data } = await fetchVendor(vendorId);
      const vendor = withStateLabel(data?.data);
      const vendorBilling = formatVendorBillingFromVendor(vendor);
      const vendorShipping = formatVendorShippingFromVendor(vendor);
      setForm((f) => ({
        ...f,
        vendor_id: vendorId,
        vendor_name: vendor?.business_name || vendor?.f_name || f.vendor_name,
        vendor_billing_address: vendorBilling || f.vendor_billing_address,
        vendor_address: vendorBilling || f.vendor_address,
        shipping_address: vendorShipping || f.shipping_address,
        contact_person: vendor?.contact_person_name || vendor?.f_name || f.contact_person,
        contact_mobile: vendor?.contact_person_phone || vendor?.phone || vendor?.number || f.contact_mobile,
      }));
    } catch {
      setForm((f) => ({ ...f, vendor_id: vendorId }));
    }
  };

  const submitOutForRepair = async () => {
    if (!selectedRows.length) {
      toast.error('Select at least one laptop');
      return;
    }
    if (!form.vendor_name.trim()) {
      toast.error('Vendor name is required');
      return;
    }
    if (!form.vendor_billing_address.trim() || !form.shipping_address.trim()) {
      toast.error('Vendor billing and shipping addresses are required');
      return;
    }
    const dispatchErr = validateVrdcDispatch(shipBy, dispatchFields);
    if (dispatchErr) {
      toast.error(dispatchErr);
      return;
    }
    if (ewayRequired && !form.eway_bill_number.trim()) {
      toast.error(`E-way Bill is required when consignment value is ₹${ewayThreshold.toLocaleString('en-IN')} or more`);
      return;
    }
    for (const r of selectedRows) {
      const hsn = String(itemHsnCodes[r.ticket_id] || '').trim();
      if (hsn && !/^\d{4,8}$/.test(hsn)) {
        toast.error(`Invalid HSN for ${r.ttspl_id || `#${r.ticket_id}`}`);
        return;
      }
      const v = itemVerifications[r.ticket_id] || {};
      const check = checkTtsplAndSerial({
        expectedTtspl: r.ttspl_id,
        expectedSerial: r.serial_number,
        verifiedTtspl: v.ttspl,
        verifiedSerial: v.serial,
        label: r.ttspl_id || `#${r.ticket_id}`,
      });
      if (!check.ok) {
        toast.error(check.message);
        return;
      }
    }
    if (form.contact_mobile?.trim()) {
      const mobileErr = indianMobileError(form.contact_mobile, { label: 'Contact mobile' });
      if (mobileErr) {
        toast.error(mobileErr);
        return;
      }
    }
    setSaving(true);
    try {
      const { data } = await createOutForRepairDc({
        ticket_ids: selectedRows.map((r) => r.ticket_id),
        vendor_id: form.vendor_id || undefined,
        vendor_name: form.vendor_name.trim(),
        vendor_billing_address: form.vendor_billing_address.trim(),
        vendor_address: form.vendor_billing_address.trim(),
        shipping_address: form.shipping_address.trim(),
        contact_person: form.contact_person.trim() || undefined,
        contact_mobile: form.contact_mobile.trim() ? normalizeIndianMobile(form.contact_mobile) : undefined,
        expected_return_date: form.expected_return_date || undefined,
        remarks: form.remarks.trim() || undefined,
        warehouse_name: form.warehouse_name.trim() || undefined,
        warehouse_address: DEFAULT_BILLING_ADDRESS,
        item_remarks: itemRemarks,
        item_prices: itemPrices,
        item_hsn_codes: canOverrideHsn ? itemHsnCodes : undefined,
        item_verifications: itemVerifications,
        eway_bill_number: form.eway_bill_number.trim() || undefined,
        eway_bill_date: form.eway_bill_date || undefined,
        ship_by: shipBy,
        courier_name: dispatchFields.courier_name,
        awb_number: dispatchFields.awb_number,
        courier_tracking_url: dispatchFields.courier_tracking_url,
        porter_tracking_id: dispatchFields.porter_tracking_id,
        porter_order_id: dispatchFields.porter_order_id,
        porter_booking_url: dispatchFields.porter_booking_url,
        delivery_person_id: dispatchFields.delivery_person_id || undefined,
      });
      toast.success(data.message || 'Vendor DC created');
      setModalOpen(false);
      if (canView('vendor_repair_dc')) {
        navigate(`/vendor-management/vendor-repair-dc/${encodeURIComponent(data.dc_number)}`);
      } else {
        load();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create DC');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Diagnosis Failed</h1>
          <p className="text-sm text-slate-500">Laptops requiring external vendor diagnosis or repair</p>
        </div>
        {canProcess ? (
          <button
            type="button"
            disabled={!selected.size}
            onClick={openModal}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-purple-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            <Truck className="w-4 h-4" />
            Out for Repair ({selected.size || 0})
          </button>
        ) : null}
      </div>

      <FloorPipelineFilterPanel
        className="mb-4"
        specFilters={specFilters}
        onSpecFiltersChange={setSpecFilters}
        onSpecFiltersClear={() => setSpecFilters(EMPTY_SPEC_FILTERS)}
      >
        <DateRangeFilter
          layout="inline"
          controlClassName="h-9 px-2 text-sm min-h-0"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          fromLabel="Failed from"
          toLabel="Failed to"
        />
      </FloorPipelineFilterPanel>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {canProcess ? (
                  <th className="p-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                  </th>
                ) : null}
                <th className="p-3">Ticket</th>
                <th className="p-3">TTSPL</th>
                <th className="p-3">Configuration</th>
                <th className="p-3">Status</th>
                <th className="p-3">Failure reason</th>
                <th className="p-3">Location</th>
                <th className="p-3">Created</th>
                <th className="p-3">Prev. technician</th>
                <th className="p-3">Prev. stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticket_id} className="border-t hover:bg-slate-50/80">
                  {canProcess ? (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.ticket_id)}
                        onChange={() => toggleOne(r.ticket_id)}
                        aria-label={`Select ticket ${r.ticket_id}`}
                      />
                    </td>
                  ) : null}
                  <td className="p-3">
                    <Link to={`/floor-pipeline/tickets/${r.ticket_id}`} className="font-mono text-blue-700 hover:underline">
                      #{r.ticket_id}
                    </Link>
                  </td>
                  <td className="p-3">
                    <TtsplHistoryLink
                      ttsplId={r.ttspl_id}
                      onOpen={setHistoryTtspl}
                    />
                  </td>
                  <td className="p-3 text-xs max-w-[220px]">{r.configuration || '—'}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900">
                      {ticketStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="p-3 text-xs max-w-[200px]">{r.diagnosis_failed_reason || '—'}</td>
                  <td className="p-3 text-xs">{r.current_location || '—'}</td>
                  <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="p-3 text-xs">{r.previous_technician_name || '—'}</td>
                  <td className="p-3 text-xs">{r.previous_stage_name || '—'}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={canProcess ? 10 : 9} className="p-8 text-center text-slate-500">
                    No laptops in Diagnosis Failed
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} aria-label="Close" />
          <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">Out for Repair</h2>
            <p className="text-xs text-slate-500">{selectedRows.length} laptop(s) selected — a Vendor Delivery Challan will be generated.</p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
              <VendorSearchSelect value={form.vendor_id} onChange={onVendorChange} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor name</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">Our Address (Dispatch From)</p>
              {DEFAULT_BILLING_ADDRESS}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor Billing Address (from vendor registered address)</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm min-h-[70px]" value={form.vendor_billing_address} onChange={(e) => setForm({ ...form, vendor_billing_address: e.target.value, vendor_address: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vendor Shipping Address (from vendor shipping address)</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm min-h-[70px]" value={form.shipping_address} onChange={(e) => setForm({ ...form, shipping_address: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Contact person</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mobile</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.contact_mobile} onChange={(e) => setForm({ ...form, contact_mobile: formatIndianMobileInput(e.target.value) })} maxLength={10} inputMode="numeric" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Expected return date</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.expected_return_date} onChange={(e) => setForm({ ...form, expected_return_date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  E-way Bill number{ewayRequired ? ' *' : ''}
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm uppercase"
                  value={form.eway_bill_number}
                  onChange={(e) => setForm({ ...form, eway_bill_number: e.target.value.toUpperCase() })}
                  placeholder={ewayRequired ? 'Required (≥ ₹50,000)' : 'Optional'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">E-way Bill date</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={form.eway_bill_date}
                  onChange={(e) => setForm({ ...form, eway_bill_date: e.target.value })}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Declared value: ₹{totalDeclaredValue.toLocaleString('en-IN')}
              {ewayRequired ? ' — E-way Bill required' : ` — E-way Bill optional below ₹${ewayThreshold.toLocaleString('en-IN')}`}
            </p>
            <div className="rounded-lg border p-3 bg-slate-50/80">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Send to vendor</p>
              <VrdcDispatchFields
                shipBy={shipBy}
                onShipByChange={setShipBy}
                fields={dispatchFields}
                onFieldsChange={setDispatchFields}
                deliveryTechnicians={deliveryTechnicians}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">DC-level remarks</label>
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm min-h-[50px]" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                Per-laptop verify TTSPL + Serial / Price / HSN / remarks
              </div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {selectedRows.map((r) => (
                  <div key={r.ticket_id} className="p-3 space-y-2">
                    <p className="text-xs font-mono text-slate-700">
                      Expected: {r.ttspl_id || '—'} · SN {r.serial_number || '—'} · #{r.ticket_id}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Verify TTSPL *</label>
                        <input
                          className="w-full border rounded-lg px-2 py-1.5 text-xs font-mono"
                          value={itemVerifications[r.ticket_id]?.ttspl ?? ''}
                          onChange={(e) => setItemVerifications((m) => ({
                            ...m,
                            [r.ticket_id]: { ...(m[r.ticket_id] || {}), ttspl: e.target.value },
                          }))}
                          placeholder="Scan / type TTSPL"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Verify Serial *</label>
                        <input
                          className="w-full border rounded-lg px-2 py-1.5 text-xs font-mono"
                          value={itemVerifications[r.ticket_id]?.serial ?? ''}
                          onChange={(e) => setItemVerifications((m) => ({
                            ...m,
                            [r.ticket_id]: { ...(m[r.ticket_id] || {}), serial: e.target.value },
                          }))}
                          placeholder="Scan / type serial"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">Price (₹)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full border rounded-lg px-2 py-1.5 text-xs"
                          value={itemPrices[r.ticket_id] ?? ''}
                          onChange={(e) => setItemPrices((m) => ({ ...m, [r.ticket_id]: e.target.value }))}
                          placeholder="Declared value"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                          HSN {canOverrideHsn ? '(admin override)' : '(auto)'}
                        </label>
                        <input
                          className="w-full border rounded-lg px-2 py-1.5 text-xs font-mono"
                          value={itemHsnCodes[r.ticket_id] ?? defaultHsn}
                          onChange={(e) => setItemHsnCodes((m) => ({ ...m, [r.ticket_id]: e.target.value }))}
                          placeholder={defaultHsn}
                          readOnly={!canOverrideHsn}
                          disabled={!canOverrideHsn}
                        />
                      </div>
                    </div>
                    <textarea
                      className="w-full border rounded-lg px-2 py-1.5 text-xs"
                      rows={2}
                      value={itemRemarks[r.ticket_id] || ''}
                      onChange={(e) => setItemRemarks((m) => ({ ...m, [r.ticket_id]: e.target.value }))}
                      placeholder="Repair notes for this laptop"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button type="button" disabled={saving} onClick={submitOutForRepair} className="px-4 py-2 bg-purple-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Creating…' : 'Generate Vendor DC'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <TtsplHistoryDrawer
        ttsplId={historyTtspl}
        open={Boolean(historyTtspl)}
        onClose={() => setHistoryTtspl(null)}
      />
    </div>
  );
}

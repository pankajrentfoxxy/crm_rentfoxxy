import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Camera, CheckCircle2, PenLine, X, FileText, ScanLine } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { useAuth } from '../../../context/AuthContext';
import usePermission from '../../../hooks/usePermission';
import { isSupportLead, isSupportTechnician } from '../../../utils/supportAccess';
import { podUrl as podUrlFor, compressImageFile, uploadAssetUrl, isPickupAssignmentEditable } from '../utils';
import { formatDeliveryAddressLine, parseDeliveryAddress } from '../../../features/sales-pipeline/salesPipelineUtils';
import { applyPincodeAutofill, sanitizePincode } from '../../../utils/pincodeLookup';
import {
  formatIndianMobileInput,
  indianMobileError,
  normalizeIndianMobile,
} from '../../../utils/phoneValidation';
import { INDIAN_STATES } from '../../../constants/indianStates';
import PickupSetupForm from './PickupSetupForm';
import AssignmentHistoryList from './AssignmentHistoryList';
import ReturnDcNumberLink from './ReturnDcNumberLink';

/**
 * PickupItemCard — Phase 20 step-by-step pickup flow.
 * Assigned -> Reached (GPS) -> POD photo -> Customer OTP -> Guard inward -> Warehouse e-sign.
 * Rendered for item_type='pickup' items that carry a pickup_type.
 */
export default function PickupItemCard({ item, ticket, onRefresh, assignmentHistory = [], isTicketLead = false }) {
  const { user } = useAuth();
  const { canView } = usePermission();
  const [esignOpen, setEsignOpen] = useState(false);
  const [techSignOpen, setTechSignOpen] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [changeAssigneeOpen, setChangeAssigneeOpen] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [assignPickupOpen, setAssignPickupOpen] = useState(false);
  const [assignPickupBusy, setAssignPickupBusy] = useState(false);
  const [addrEditing, setAddrEditing] = useState(false);
  const [addrSaving, setAddrSaving] = useState(false);
  const [addrForm, setAddrForm] = useState({
    name: '', phone: '', address: '', city: '', state: '', pincode: '',
  });

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); onRefresh?.(); }
    catch (e) { toast.error(e.response?.data?.message || 'Action failed'); }
    finally { setBusy(false); }
  };

  const lead = isTicketLead || isSupportLead(user);
  const tech = isSupportTechnician(user);
  const readOnly = ticket?.status === 'cancelled';
  const isWH = !readOnly && ['warehouse', 'admin', 'support_lead', 'manager', 'floor_manager', 'super_admin'].includes(user?.role);
  const isMyPickup = item.pickup_assigned_to === user?.user_id || item.assigned_to === user?.user_id;
  const canActTech = !readOnly && ((tech && isMyPickup) || lead);

  const es = item.effective_current_step || 'assigned';
  const isCourier = item.pickup_method === 'courier';
  const isPorter = item.pickup_method === 'porter';
  // Default to an in-house (technician) pickup unless explicitly courier/porter,
  // so items created without a pickup_method still expose the technician wizard.
  const isInhouse = !isCourier && !isPorter;

  const podUrl = podUrlFor(item.proof_of_completion_path || item.pod_image_path);
  const esignUrl = uploadAssetUrl(item.warehouse_esign_url);
  const techSigned = !!item.technician_esign_url;
  const returnDcPdfUrl = uploadAssetUrl(item.return_dc_pdf_path);

  const dispatchBadge = isCourier
    ? `🚚 Courier${item.pickup_courier_name ? ` — ${item.pickup_courier_name}` : ''}`
    : isPorter
      ? `🛵 Porter${item.porter_tracking_id ? ` — ${item.porter_tracking_id}` : ''}`
      : '👤 Technician';
  const pickupTypeBadge = item.pickup_type === 'repair' ? '🔧 Repair Pickup' : '🔄 Return Pickup';

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    run(async () => {
      const compressed = await compressImageFile(file);
      const fd = new FormData();
      fd.append('pod', compressed);
      await api.post(`/support/items/${item.id}/pod`, fd);
    });
  };

  const handleReached = () => {
    setBusy(true);
    const doMark = (lat, lng) =>
      api.post(`/support/items/${item.id}/pickup-reached`, {
        latitude: lat != null ? String(lat) : null,
        longitude: lng != null ? String(lng) : null,
      })
        .then(() => onRefresh?.())
        .catch((e) => toast.error(e.response?.data?.message || 'Failed to mark reached'))
        .finally(() => setBusy(false));
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => doMark(p.coords.latitude, p.coords.longitude),
        () => { toast('Location unavailable — continuing', { icon: '⚠️' }); doMark(null, null); },
        { timeout: 10000 }
      );
    } else { doMark(null, null); }
  };

  const handleVerifyOtp = () => run(async () => {
    await api.post(`/support/items/${item.id}/verify-pickup-otp`, { otp: otpInput.trim() });
    toast.success('OTP verified! Laptop picked up.');
    setOtpInput('');
  });

  const handleSendOtp = () => run(async () => {
    await api.post(`/support/items/${item.id}/send-otp`);
    setOtpSent(true);
    toast.success('OTP sent to the customer on WhatsApp');
  });

  const podDone = !!(item.pod_image_path || item.proof_of_completion_path);
  const otpVerified = !!item.customer_otp_verified_at;
  const whDone = !!item.warehouse_received_at;
  const needsGate = !!item.return_dc_number;
  const gateDone = !!item.gate_inward_at;
  const pickupReadyForWarehouse = isInhouse ? otpVerified : true;
  const awaitingGate = needsGate && !gateDone && !whDone && pickupReadyForWarehouse;
  const canWarehouseEsign = !whDone && isWH && pickupReadyForWarehouse && (!needsGate || gateDone);
  const canOpenGuardScanner = canView('guard_gate_checking');
  const guardScannerHref = item.return_dc_number
    ? `/guard/scanner?dir=inward&q=${encodeURIComponent(item.return_dc_number)}`
    : '/guard/scanner?dir=inward';
  const addr = parseDeliveryAddress(ticket?.pickup_address);
  const addrLine = formatDeliveryAddressLine(ticket?.pickup_address);
  const canEditAddress = lead && !readOnly;
  const canChangeAssignee = lead && isPickupAssignmentEditable(item);

  const startEditAddress = () => {
    setAddrForm({
      name: addr?.name || ticket?.customer_name || '',
      phone: formatIndianMobileInput(addr?.phone || ticket?.display_phone || ticket?.customer_phone || ''),
      address: addr?.address || addr?.address_line_1 || addr?.line1 || '',
      city: addr?.city || '',
      state: addr?.state || '',
      pincode: sanitizePincode(addr?.pincode || addr?.zip_code || ''),
    });
    setAddrEditing(true);
  };

  const saveAddress = async () => {
    const phoneErr = indianMobileError(addrForm.phone, { required: true, label: 'Mobile number' });
    if (!String(addrForm.name || '').trim()) {
      toast.error('Contact name is required');
      return;
    }
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }
    if (!String(addrForm.address || '').trim()) {
      toast.error('Pickup address is required');
      return;
    }
    const pin = sanitizePincode(addrForm.pincode);
    if (pin && pin.length !== 6) {
      toast.error('Pincode must be 6 digits');
      return;
    }
    setAddrSaving(true);
    try {
      await api.patch(`/support/tickets/${ticket.id}/pickup-address`, {
        pickup_address: {
          name: addrForm.name.trim(),
          phone: normalizeIndianMobile(addrForm.phone),
          address: addrForm.address.trim(),
          city: addrForm.city.trim(),
          state: addrForm.state.trim(),
          pincode: pin,
        },
      });
      toast.success('Pickup address updated');
      setAddrEditing(false);
      onRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update address');
    } finally {
      setAddrSaving(false);
    }
  };

  const assignPendingPickup = async (form) => {
    setAssignPickupBusy(true);
    try {
      await api.post(`/support/tickets/${ticket.id}/assign-return-pickup`, {
        dispatch_mode: form.dispatch_mode,
        technician_user_id: form.technician_user_id,
        courier_name: form.courier_name,
        awb_number: form.awb_number,
        porter_tracking_id: form.porter_tracking_id,
        porter_order_id: form.porter_order_id,
      });
      toast.success('Return pickup assigned');
      setAssignPickupOpen(false);
      onRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to assign pickup');
    } finally {
      setAssignPickupBusy(false);
    }
  };

  const changeAssignee = async (form) => {
    setChangeBusy(true);
    try {
      await api.patch(`/support/tickets/${ticket.id}/return-pickup-assignment`, {
        dispatch_mode: form.dispatch_mode,
        technician_user_id: form.technician_user_id,
        courier_name: form.courier_name,
        awb_number: form.awb_number,
        porter_tracking_id: form.porter_tracking_id,
        porter_order_id: form.porter_order_id,
        reason: form.reason,
      });
      toast.success('Pickup assignee updated');
      setChangeAssigneeOpen(false);
      onRefresh?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update assignee');
    } finally {
      setChangeBusy(false);
    }
  };

  const pickupInitialValues = {
    dispatch_mode: item.pickup_method || 'technician',
    technician_user_id: item.pickup_assigned_to || item.assigned_to,
    courier_name: item.pickup_courier_name,
    awb_number: item.pickup_awb,
    porter_tracking_id: item.porter_tracking_id,
    porter_order_id: item.porter_order_id,
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-600 to-orange-700 p-4 text-white">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{pickupTypeBadge}</span>
              <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{dispatchBadge}</span>
              {needsGate && !whDone && awaitingGate && (
                <span className="text-xs bg-amber-400/90 text-amber-950 px-2 py-0.5 rounded-full font-semibold">
                  Awaiting Guard inward
                </span>
              )}
              {needsGate && !whDone && gateDone && (
                <span className="text-xs bg-emerald-400/90 text-emerald-950 px-2 py-0.5 rounded-full font-semibold">
                  Guard inward done
                </span>
              )}
            </div>
            <p className="font-bold text-lg mt-1.5 truncate">{item.brand} {item.model}</p>
            <p className="text-sm text-orange-100 font-mono">
              {item.ttspl_id || item.unique_serial_number || item.serial_number}
            </p>
          </div>
          {item.return_dc_number && (
            <ReturnDcNumberLink
              rdcNumber={item.return_dc_number}
              onUpdated={onRefresh}
              className="shrink-0 text-xs bg-white/10 px-2 py-1 rounded-lg text-orange-50 font-mono"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[item.generation, item.ram, item.storage].filter(Boolean).map((v) => (
            <span key={v} className="px-2 py-0.5 bg-white/10 rounded-full text-xs">{v}</span>
          ))}
        </div>
      </div>

      {/* Return DC tracking + PDF */}
      {(returnDcPdfUrl || item.original_dc_number || item.return_so_number) && (
        <div className="mx-4 mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-slate-600 space-y-0.5">
            {item.original_dc_number && <p>Original DC: <span className="font-mono font-semibold text-slate-800">{item.original_dc_number}</span></p>}
            {item.return_so_number && <p>Sales Order: <span className="font-mono font-semibold text-slate-800">{item.return_so_number}</span></p>}
            {item.return_dc_number && (
              <p>
                Return DC:{' '}
                <ReturnDcNumberLink
                  rdcNumber={item.return_dc_number}
                  onUpdated={onRefresh}
                  className="font-mono font-semibold text-slate-800"
                />
              </p>
            )}
          </div>
          {returnDcPdfUrl && (
            <a href={returnDcPdfUrl} target="_blank" rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100">
              <FileText className="w-4 h-4" /> Return DC (PDF)
            </a>
          )}
        </div>
      )}

      {/* Customer OTP — admin / manager / support lead only, before verification.
          The technician never sees it: they type what the customer reads out. */}
      {lead && item.customer_otp_code && !otpVerified && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-amber-700 font-semibold uppercase tracking-wide mb-1">
            Customer OTP (Admin / Lead only)
          </p>
          <p className="font-mono text-2xl font-bold text-amber-900 tracking-widest">{item.customer_otp_code}</p>
          <p className="text-xs text-amber-600 mt-1">
            OTP is sent to the customer on WhatsApp. Share this code only if WhatsApp failed.
          </p>
        </div>
      )}

      {/* Pickup address */}
      {(canEditAddress || addrLine || addr?.name || addr?.phone) && (
        <div className="mx-4 mt-3 p-3 bg-gray-50 rounded-xl text-sm">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Pickup Address</p>
            {canEditAddress && !addrEditing ? (
              <button
                type="button"
                onClick={startEditAddress}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
              >
                <PenLine className="w-3.5 h-3.5" /> Edit
              </button>
            ) : null}
          </div>
          {addrEditing ? (
            <div className="space-y-2 pt-1">
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-500">Name *</span>
                <input
                  className="mt-0.5 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm"
                  value={addrForm.name}
                  onChange={(e) => setAddrForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-500">Mobile *</span>
                <input
                  className="mt-0.5 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm"
                  value={addrForm.phone}
                  onChange={(e) => setAddrForm((f) => ({ ...f, phone: formatIndianMobileInput(e.target.value) }))}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[11px] font-semibold text-gray-500">Pincode</span>
                  <input
                    className="mt-0.5 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm"
                    value={addrForm.pincode}
                    onChange={async (e) => {
                      const pin = sanitizePincode(e.target.value);
                      setAddrForm((f) => ({ ...f, pincode: pin }));
                      if (pin.length === 6) {
                        await applyPincodeAutofill(pin, setAddrForm, {
                          pinKey: 'pincode',
                          cityKey: 'city',
                          stateKey: 'state',
                          fillAddressIfEmpty: false,
                        });
                      }
                    }}
                    inputMode="numeric"
                    maxLength={6}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-gray-500">City</span>
                  <input
                    className="mt-0.5 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm"
                    value={addrForm.city}
                    onChange={(e) => setAddrForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-gray-500">State</span>
                  <select
                    className="mt-0.5 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm bg-white"
                    value={addrForm.state}
                    onChange={(e) => setAddrForm((f) => ({ ...f, state: e.target.value }))}
                  >
                    <option value="">Select</option>
                    {INDIAN_STATES.map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                    {addrForm.state && !INDIAN_STATES.includes(addrForm.state) ? (
                      <option value={addrForm.state}>{addrForm.state}</option>
                    ) : null}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-500">Address *</span>
                <textarea
                  className="mt-0.5 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm min-h-[72px]"
                  value={addrForm.address}
                  onChange={(e) => setAddrForm((f) => ({ ...f, address: e.target.value }))}
                />
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAddrEditing(false)}
                  className="flex-1 py-2 border border-gray-200 rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={addrSaving}
                  onClick={saveAddress}
                  className="flex-[2] py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {addrSaving ? 'Saving…' : 'Save address'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {addr?.name && <p className="font-medium text-gray-800">{addr.name}</p>}
              {addr?.phone && <p className="text-gray-600">{addr.phone}</p>}
              {addrLine && <p className="text-gray-600">{addrLine}</p>}
              {addrLine && (
                <a
                  href={`https://www.google.com/maps/search/${encodeURIComponent(addrLine)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-600 mt-1 inline-block"
                >
                  🗺 Open in Maps
                </a>
              )}
            </>
          )}
        </div>
      )}

      {/* Awaiting pickup assignment — only when nobody is assigned yet */}
      {es === 'pending_dispatch' && !item.assigned_to && !item.pickup_assigned_to && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900">
          <p className="font-semibold">Awaiting pickup assignment</p>
          <p className="text-xs mt-1 text-amber-800">
            Return DC {item.return_dc_number || ''} is created. Assign a technician, courier, or porter to start pickup.
            {item.assigned_to && !item.pickup_method && !item.pickup_assigned_to ? (
              <> Ticket assignee is set, but that is not a pickup dispatch yet.</>
            ) : null}
          </p>
          {lead && !readOnly && (
            <div className="mt-3">
              {!assignPickupOpen ? (
                <button
                  type="button"
                  className="w-full py-2.5 text-sm font-semibold bg-amber-600 text-white rounded-xl"
                  onClick={() => setAssignPickupOpen(true)}
                >
                  Assign pickup
                </button>
              ) : (
                <div className="rounded-xl border border-amber-100 bg-white p-3">
                  <PickupSetupForm
                    ticket={ticket}
                    dispatchOnly
                    changeMode
                    initialValues={pickupInitialValues}
                    saving={assignPickupBusy}
                    submitLabel="Assign pickup"
                    onSubmit={assignPendingPickup}
                    onCancel={() => setAssignPickupOpen(false)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dispatch tracking info */}
      {(isCourier || isPorter) && (
        <div className="mx-4 mt-3 p-3 bg-blue-50 rounded-xl text-xs text-blue-800 space-y-0.5">
          {isCourier && item.pickup_courier_name && <p><strong>Courier:</strong> {item.pickup_courier_name}</p>}
          {isCourier && item.pickup_awb && <p><strong>AWB:</strong> {item.pickup_awb}</p>}
          {isPorter && item.porter_tracking_id && <p><strong>Porter ID:</strong> {item.porter_tracking_id}</p>}
          {isPorter && item.porter_order_id && <p><strong>Order ID:</strong> {item.porter_order_id}</p>}
        </div>
      )}

      {canChangeAssignee && (
        <div className="mx-4 mt-3">
          {!changeAssigneeOpen ? (
            <button
              type="button"
              className="w-full py-2.5 text-sm font-semibold border border-blue-200 text-blue-700 rounded-xl bg-blue-50"
              onClick={() => setChangeAssigneeOpen(true)}
            >
              Change pickup assignee
            </button>
          ) : (
            <div className="rounded-xl border border-blue-100 bg-white p-3">
              <PickupSetupForm
                ticket={ticket}
                dispatchOnly
                changeMode
                initialValues={pickupInitialValues}
                saving={changeBusy}
                submitLabel="Save assignee"
                onSubmit={changeAssignee}
                onCancel={() => setChangeAssigneeOpen(false)}
              />
            </div>
          )}
        </div>
      )}

      {assignmentHistory.length > 0 && (
        <div className="mx-4 mt-3 mb-3">
          <AssignmentHistoryList rows={assignmentHistory} compact />
        </div>
      )}

      {/* Technician step wizard (inhouse) */}
      {isInhouse && !whDone && es !== 'pending_dispatch' && (
        <div className="p-4 space-y-3">
          {/* Mark reached */}
          {(es === 'assigned' || es === 'in_transit') && canActTech && (
            <button
              type="button" disabled={busy} onClick={handleReached}
              className="w-full py-4 bg-orange-600 text-white rounded-2xl font-bold text-base active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <MapPin className="w-5 h-5" />
              {busy ? 'Getting location…' : 'I have reached the pickup location'}
            </button>
          )}

          {/* Technician e-sign — sign the Return DC at the customer site, before pickup */}
          {['reached', 'visited'].includes(es) && !techSigned && canActTech && (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3">
              <p className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
                <PenLine className="w-4 h-4 text-orange-600" /> Sign the Return DC (before pickup)
              </p>
              <p className="text-xs text-gray-500 mb-2">
                Sign the Return Delivery Challan to take custody of the laptop, then verify the customer OTP.
              </p>
              <button
                type="button" disabled={busy} onClick={() => setTechSignOpen(true)}
                className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold text-sm active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <PenLine className="w-4 h-4" /> Sign Return DC
              </button>
            </div>
          )}

          {/* Technician signed confirmation */}
          {['reached', 'visited'].includes(es) && techSigned && !podDone && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-xs text-green-700 font-medium">Return DC signed by technician</span>
            </div>
          )}

          {/* POD photo (after technician sign-out) */}
          {['reached', 'visited'].includes(es) && techSigned && !podDone && canActTech && (
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2">📷 Take photo of laptop (at customer site)</p>
              <label className="cursor-pointer block">
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
                <div className={`w-full py-6 rounded-2xl border-2 border-dashed text-center ${busy ? 'border-blue-200 bg-blue-50' : 'border-orange-200 bg-orange-50'}`}>
                  {busy ? (
                    <div>
                      <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm text-orange-600">Uploading…</p>
                    </div>
                  ) : (
                    <div>
                      <Camera className="w-10 h-10 text-orange-300 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-orange-700">Tap to photo laptop</p>
                      <p className="text-xs text-orange-500 mt-1">Take photo before picking up</p>
                    </div>
                  )}
                </div>
              </label>
            </div>
          )}

          {/* POD preview */}
          {podDone && !otpVerified && podUrl && (
            <div className="rounded-xl overflow-hidden border border-green-200">
              <img src={podUrl} alt="POD" className="w-full max-h-40 object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
              <div className="bg-green-50 px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-xs text-green-700 font-medium">Photo uploaded</span>
                </div>
                {canActTech && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm('Remove this photo and upload a different one?')) return;
                      run(() => api.delete(`/support/items/${item.id}/pod`));
                    }}
                    className="shrink-0 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                  >
                    Remove &amp; retake
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Customer OTP entry */}
          {podDone && !otpVerified && canActTech && (
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-1">Enter customer OTP</p>
              <p className="text-xs text-gray-500 mb-2">
                Send OTP to the customer on WhatsApp, then enter the 6-digit code they received.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={handleSendOtp}
                className="mb-2 w-full px-3 py-2 border border-orange-200 bg-orange-50 text-orange-800 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {otpSent || item.customer_otp_sent_at ? 'Resend OTP' : 'Send OTP to customer'}
              </button>
              <div className="flex gap-2 items-stretch">
                <input
                  type="tel" inputMode="numeric" maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit OTP"
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 text-center text-xl sm:text-2xl font-mono font-bold tracking-widest focus:ring-2 focus:ring-orange-500 outline-none"
                  autoComplete="one-time-code"
                />
                <button
                  type="button" disabled={busy || otpInput.length < 6} onClick={handleVerifyOtp}
                  className="shrink-0 whitespace-nowrap px-4 sm:px-5 py-3 bg-orange-600 text-white rounded-xl font-semibold disabled:opacity-50"
                >
                  Verify
                </button>
              </div>
            </div>
          )}

          {/* Verified — carry to warehouse */}
          {otpVerified && !whDone && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <p className="font-semibold text-sm">OTP verified — laptop picked up</p>
              </div>
              <p className="text-xs text-green-600 mt-1">
                {needsGate && !gateDone
                  ? 'Carry the laptop to the warehouse. Guard must scan this Return DC inward before warehouse e-sign.'
                  : 'Carry the laptop to the warehouse. The warehouse team will e-sign to confirm receipt.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Courier / porter: lead tracking note */}
      {(isCourier || isPorter) && !whDone && (
        <div className="px-4 pt-3 text-sm text-gray-500 text-center">
          Track this pickup via the <strong>Return DC</strong> register.
        </div>
      )}

      {awaitingGate && (
        <div className="mx-4 mt-3 mb-1 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center gap-2 text-amber-900">
            <ScanLine className="w-5 h-5 text-amber-700" />
            <p className="font-semibold text-sm">Awaiting Guard inward scan</p>
          </div>
          <p className="text-xs text-amber-800 mt-1">
            Guard must scan Return DC{' '}
            <ReturnDcNumberLink
              rdcNumber={item.return_dc_number}
              onUpdated={onRefresh}
              className="font-mono font-semibold"
            />{' '}
            at the warehouse gate before e-sign.
          </p>
          {canOpenGuardScanner && (
            <Link
              to={guardScannerHref}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"
            >
              <ScanLine className="w-3.5 h-3.5" /> Open inward gate scanner
            </Link>
          )}
        </div>
      )}

      {needsGate && gateDone && !whDone && (
        <div className="mx-4 mt-3 mb-1 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-2 text-emerald-900">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <p className="font-semibold text-sm">Guard inward done — warehouse can e-sign</p>
          </div>
          {item.gate_inward_at && (
            <p className="text-xs text-emerald-700 mt-1">
              Scanned {new Date(item.gate_inward_at).toLocaleString('en-IN')}
            </p>
          )}
        </div>
      )}

      {/* Warehouse confirm (warehouse / lead) — only after Guard inward */}
      {canWarehouseEsign && (
        <div className="p-4 pt-3">
          <button
            type="button" onClick={() => setEsignOpen(true)}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-sm active:scale-[0.98] transition flex items-center justify-center gap-2"
          >
            <PenLine className="w-4 h-4" /> Warehouse confirm receipt (e-sign)
          </button>
        </div>
      )}

      {/* Warehouse confirmed — repair pickups stay open until Service DC delivery */}
      {whDone && (
        <div className="p-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-green-800 mb-2">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <p className="font-bold">Received at warehouse!</p>
            </div>
            {item.pickup_type === 'repair' && item.floor_ticket_id && (
              <p className="text-xs text-green-600">🔧 Floor repair ticket #{item.floor_ticket_id} created automatically</p>
            )}
            {item.pickup_type === 'repair' && item.status === 'swap_initiated' && (
              <p className="text-xs text-pink-700 mt-1">
                Swap started — a replacement sales order will deliver a different laptop. This unit stays in warehouse inventory.
              </p>
            )}
            {item.pickup_type === 'repair' && item.status !== 'swap_initiated' && (
              <p className="text-xs text-green-700 mt-1">
                Unit removed from customer inventory. Send the same unit back via Service DC, or use &quot;Send a different laptop&quot; on the ticket if not repairable.
              </p>
            )}
            {item.pickup_type === 'return' && (
              <p className="text-xs text-green-600">✓ Inventory updated — laptop marked as returned</p>
            )}
            {esignUrl && <img src={esignUrl} alt="Warehouse sign" className="mt-2 h-10 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />}
          </div>
        </div>
      )}

      {esignOpen && (
        <WarehouseReceiptSignModal
          item={item}
          onSigned={() => { setEsignOpen(false); onRefresh?.(); }}
          onClose={() => setEsignOpen(false)}
        />
      )}

      {techSignOpen && (
        <TechnicianSignModal
          item={item}
          onSigned={() => { setTechSignOpen(false); onRefresh?.(); }}
          onClose={() => setTechSignOpen(false)}
        />
      )}
    </div>
  );
}

function TechnicianSignModal({ item, onSigned, onClose }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [name, setName] = useState(() => user?.name || user?.email || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loginName = user?.name || user?.email || '';
    if (!loginName) return;
    setName((prev) => (prev?.trim() ? prev : loginName));
  }, [user?.name, user?.email]);

  useEffect(() => {
    let pad;
    import('signature_pad').then(({ default: SP }) => {
      if (canvasRef.current) {
        // Scale for high-DPI / touch screens so the pen tracks the finger exactly.
        const canvas = canvasRef.current;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d').scale(ratio, ratio);
        pad = new SP(canvas, {
          backgroundColor: 'rgb(255,255,255)', penColor: '#1A1A2E', minWidth: 1.5, maxWidth: 3,
        });
        padRef.current = pad;
      }
    });
    return () => { pad?.off?.(); };
  }, []);

  const handleSave = async () => {
    if (!padRef.current || padRef.current.isEmpty()) { toast.error('Please sign'); return; }
    setSaving(true);
    try {
      await api.post(`/support/items/${item.id}/technician-esign`, {
        esign_data: padRef.current.toDataURL('image/png'),
        signer_name: name.trim() || undefined,
      });
      toast.success('Return DC signed.');
      onSigned();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-gray-900">✍️ Sign Return DC {item.return_dc_number ? `(${item.return_dc_number})` : ''}</p>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Laptop: <strong>{item.ttspl_id || item.unique_serial_number || item.serial_number}</strong>
          {' · '}{item.pickup_type === 'repair' ? 'Repair pickup' : 'Return pickup'}
        </p>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Technician name (optional)"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:ring-2 focus:ring-orange-500 outline-none"
        />
        <div className="border-2 border-gray-200 rounded-xl overflow-hidden mb-3">
          <p className="text-xs text-gray-400 px-3 pt-2 text-center">Sign to take custody of the laptop</p>
          <canvas ref={canvasRef} width={500} height={140} className="w-full touch-none bg-white block" style={{ touchAction: 'none' }} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => padRef.current?.clear()} className="flex-1 py-3 border rounded-xl text-sm">Clear</button>
          <button type="button" onClick={onClose} className="flex-1 py-3 border rounded-xl text-sm">Cancel</button>
          <button
            type="button" onClick={handleSave} disabled={saving}
            className="flex-[2] py-3 bg-orange-600 text-white rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Sign & continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WarehouseReceiptSignModal({ item, onSigned, onClose }) {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const padRef = useRef(null);
  const [name, setName] = useState(() => user?.name || user?.email || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loginName = user?.name || user?.email || '';
    if (!loginName) return;
    setName((prev) => (prev?.trim() ? prev : loginName));
  }, [user?.name, user?.email]);

  useEffect(() => {
    let pad;
    import('signature_pad').then(({ default: SP }) => {
      if (canvasRef.current) {
        // Scale for high-DPI / touch screens so the pen tracks the finger exactly.
        const canvas = canvasRef.current;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d').scale(ratio, ratio);
        pad = new SP(canvas, {
          backgroundColor: 'rgb(255,255,255)', penColor: '#1A1A2E', minWidth: 1.5, maxWidth: 3,
        });
        padRef.current = pad;
      }
    });
    return () => { pad?.off?.(); };
  }, []);

  const handleSave = async () => {
    if (!padRef.current || padRef.current.isEmpty()) { toast.error('Please sign'); return; }
    if (!name.trim()) { toast.error('Enter your name'); return; }
    setSaving(true);
    try {
      const { data } = await api.post(`/support/items/${item.id}/warehouse-confirm`, {
        esign_data: padRef.current.toDataURL('image/png'),
        signer_name: name.trim(),
      });
      toast.success(data.units_received > 1
        ? `Receipt confirmed for ${data.units_received} laptops on this Return DC.`
        : 'Receipt confirmed. Laptop back in warehouse.');
      onSigned();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to confirm');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-gray-900">✍️ Warehouse receipt confirmation</p>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Laptop: <strong>{item.ttspl_id || item.unique_serial_number || item.serial_number}</strong>
          {' · '}{item.pickup_type === 'repair' ? 'Repair pickup' : 'Return pickup'}
        </p>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Warehouse staff name*"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <div className="border-2 border-gray-200 rounded-xl overflow-hidden mb-3">
          <p className="text-xs text-gray-400 px-3 pt-2 text-center">Sign to confirm you received the laptop</p>
          <canvas ref={canvasRef} width={500} height={140} className="w-full touch-none bg-white block" style={{ touchAction: 'none' }} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => padRef.current?.clear()} className="flex-1 py-3 border rounded-xl text-sm">Clear</button>
          <button type="button" onClick={onClose} className="flex-1 py-3 border rounded-xl text-sm">Cancel</button>
          <button
            type="button" onClick={handleSave} disabled={saving}
            className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {saving ? 'Confirming…' : 'Confirm receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

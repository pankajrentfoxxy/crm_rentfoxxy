import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { generateBluedartWaybill, downloadBluedartWaybillPdfByAwb } from '../salesPipelineApi';
import { downloadBlob } from '../salesPipelineUtils';
import { lookupDeclaredValueForUnit } from '../bluedartDeclaredValue';

function buildConsigneeFromAddress(address, meta) {
  const a = address || {};
  return {
    name: a.name || meta?.customer_name || '',
    mobile: a.phone || a.mobile || meta?.customer_mobile || '',
    address: [a.address, a.city, a.state].filter(Boolean).join(', ') || a.address || '',
    pincode: a.pincode || a.zip_code || '',
  };
}

/**
 * Per-selected-laptop BlueDart AWB mapping UI.
 * Updates each serial via onUpdateSerial(allocationId, patch).
 * Syncs combined AWBs via onCombinedAwbs(joined).
 */
export default function PerLaptopCourierMapping({
  selected = [],
  meta = null,
  groupAddress = null,
  soNumber = '',
  onUpdateSerial,
  onCombinedAwbs,
}) {
  const [bdBusy, setBdBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);
  const [bdOpen, setBdOpen] = useState(true);
  const [bdForm, setBdForm] = useState({
    name: '', mobile: '', address: '', pincode: '',
  });

  const joinedAwbs = useMemo(
    () => selected.map((s) => String(s.awb_number || '').trim()).filter(Boolean).join(','),
    [selected]
  );

  useEffect(() => {
    const c = buildConsigneeFromAddress(groupAddress, meta);
    setBdForm((f) => ({
      ...f,
      name: c.name || f.name,
      mobile: c.mobile || f.mobile,
      address: c.address || f.address,
      pincode: c.pincode || f.pincode,
    }));
    selected.forEach((s) => {
      const patch = {};
      if (!s.courier_name) patch.courier_name = 'BlueDart';
      if (!s.shipment_weight) patch.shipment_weight = '2.50';
      if (s.declared_value == null || s.declared_value === '') {
        const auto = lookupDeclaredValueForUnit(
          s.processor,
          s.generation,
          s.model || s.model_name
        );
        if (auto != null) patch.declared_value = String(auto);
      }
      if (Object.keys(patch).length) onUpdateSerial?.(s.allocation_id, patch);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupAddress, meta, selected.length]);

  useEffect(() => {
    onCombinedAwbs?.(joinedAwbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedAwbs]);

  const generateForUnit = async (unit) => {
    const consignee = {
      name: bdForm.name.trim(),
      mobile: bdForm.mobile.trim(),
      address: bdForm.address.trim(),
      pincode: bdForm.pincode.trim(),
      email: meta?.customer_email || meta?.email || '',
      gst: meta?.gst_number || '',
      attention: bdForm.name.trim(),
    };
    if (!consignee.name || !consignee.address || !consignee.pincode || !consignee.mobile) {
      toast.error('Fill consignee name, mobile, address and pincode');
      return null;
    }
    const unitDeclared = Number(unit.declared_value);
    const matrixDeclared = lookupDeclaredValueForUnit(
      unit.processor,
      unit.generation,
      unit.model || unit.model_name
    );
    const declaredValue = (Number.isFinite(unitDeclared) && unitDeclared > 0)
      ? unitDeclared
      : matrixDeclared;
    if (!declaredValue) {
      toast.error(`${unit.ttspl_id || unit.serial_number}: set Declared value (₹)`);
      return null;
    }
    const { data } = await generateBluedartWaybill({
      consignee,
      services: {
        pieceCount: 1,
        actualWeight: String(unit.shipment_weight || '2.50'),
        declaredValue,
        itemName: 'LAPTOP',
      },
      serial_number: unit.serial_number || unit.vsn_serial || null,
      ttspl_id: unit.ttspl_id || unit.ttspl_id_vsn || null,
      sales_order_number: soNumber || null,
    });
    return data?.data || null;
  };

  const generateOne = async (unit) => {
    setGeneratingId(unit.allocation_id);
    setBdBusy(true);
    try {
      const result = await generateForUnit(unit);
      if (!result?.awb_number) {
        toast.error('No AWB returned');
        return;
      }
      onUpdateSerial?.(unit.allocation_id, {
        courier_name: 'BlueDart',
        awb_number: result.awb_number,
        bluedart_awb_pdf_path: result.pdf_path || null,
      });
      toast.success(`AWB ${result.awb_number} → ${unit.ttspl_id || unit.serial_number}`);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'BlueDart AWB failed');
    } finally {
      setGeneratingId(null);
      setBdBusy(false);
    }
  };

  const generateAll = async () => {
    if (!selected.length) return;
    setBdBusy(true);
    let ok = 0;
    try {
      for (const unit of selected) {
        setGeneratingId(unit.allocation_id);
        try {
          const result = await generateForUnit(unit);
          if (!result?.awb_number) continue;
          onUpdateSerial?.(unit.allocation_id, {
            courier_name: 'BlueDart',
            awb_number: result.awb_number,
            bluedart_awb_pdf_path: result.pdf_path || null,
          });
          ok += 1;
        } catch (e) {
          toast.error(`${unit.ttspl_id || unit.serial_number}: ${e.response?.data?.message || e.message}`);
        }
      }
      if (ok) toast.success(`${ok} AWB(s) generated`);
      else toast.error('No AWBs generated');
    } finally {
      setGeneratingId(null);
      setBdBusy(false);
    }
  };

  const downloadPdf = async (raw) => {
    const awb = String(raw || '').split(/[/|,;\s]+/).map((x) => x.trim()).find((x) => /^\d{8,}$/.test(x));
    if (!awb) return toast.error('No AWB');
    setBdBusy(true);
    try {
      const pdfRes = await downloadBluedartWaybillPdfByAwb(awb);
      downloadBlob(new Blob([pdfRes.data], { type: 'application/pdf' }), `BlueDart_${awb}.pdf`);
      toast.success('PDF downloaded');
    } catch {
      toast.error('PDF not found');
    } finally {
      setBdBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-blue-900">Per-laptop BlueDart shipment</p>
        <button type="button" className="text-[11px] text-blue-700 underline" onClick={() => setBdOpen((v) => !v)}>
          {bdOpen ? 'Hide' : 'Show'} consignee
        </button>
      </div>
      <p className="text-[11px] text-blue-800/80">
        Laptop 1 → BlueDart → AWB · Laptop 2 → BlueDart → AWB · …
        Combined AWBs are stored on the DC for tracking.
      </p>

      {bdOpen && (
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Consignee name *</span>
            <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
              value={bdForm.name} onChange={(e) => setBdForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Mobile *</span>
            <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
              value={bdForm.mobile} onChange={(e) => setBdForm((f) => ({ ...f, mobile: e.target.value }))} />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Pincode *</span>
            <input className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white"
              value={bdForm.pincode} onChange={(e) => setBdForm((f) => ({ ...f, pincode: e.target.value }))} />
          </label>
          <label className="col-span-2 block">
            <span className="block text-[11px] font-medium text-slate-600 mb-0.5">Address *</span>
            <textarea className="w-full border rounded-lg px-2 py-1.5 text-xs bg-white min-h-[56px]"
              value={bdForm.address} onChange={(e) => setBdForm((f) => ({ ...f, address: e.target.value }))} />
          </label>
        </div>
      )}

      <div className="space-y-2">
        {selected.map((unit, idx) => (
          <div key={unit.allocation_id} className="rounded-lg border border-blue-100 bg-white p-2.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">
                  Laptop {idx + 1}
                  <span className="ml-2 font-mono text-blue-700">{unit.ttspl_id || unit.serial_number || '—'}</span>
                </p>
                <p className="text-[10px] text-slate-500 truncate">
                  {[unit.brand, unit.model, unit.processor, unit.generation, unit.ram, unit.storage]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 shrink-0">
                {unit.courier_name || 'BlueDart'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block col-span-2">
                <span className="block text-[10px] font-medium text-slate-600 mb-0.5">AWB Number</span>
                <input
                  className="w-full border rounded-md px-2 py-1.5 text-xs font-mono"
                  placeholder="Enter or generate AWB"
                  value={unit.awb_number || ''}
                  onChange={(e) => onUpdateSerial?.(unit.allocation_id, { awb_number: e.target.value.trim() })}
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium text-slate-600 mb-0.5">Declared value (₹)</span>
                <input
                  className="w-full border rounded-md px-2 py-1.5 text-xs"
                  placeholder="From config"
                  value={unit.declared_value ?? ''}
                  onChange={(e) => onUpdateSerial?.(unit.allocation_id, { declared_value: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-medium text-slate-600 mb-0.5">Weight (kg)</span>
                <input
                  className="w-full border rounded-md px-2 py-1.5 text-xs"
                  value={unit.shipment_weight || '2.50'}
                  onChange={(e) => onUpdateSerial?.(unit.allocation_id, { shipment_weight: e.target.value })}
                />
              </label>
              <label className="block col-span-2">
                <span className="block text-[10px] font-medium text-slate-600 mb-0.5">Remarks</span>
                <input
                  className="w-full border rounded-md px-2 py-1.5 text-xs"
                  placeholder="Optional"
                  value={unit.shipment_remarks || ''}
                  onChange={(e) => onUpdateSerial?.(unit.allocation_id, { shipment_remarks: e.target.value })}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={bdBusy}
                onClick={() => generateOne(unit)}
                className="flex-1 py-1.5 rounded-md bg-blue-600 text-white text-[11px] font-semibold disabled:opacity-50"
              >
                {generatingId === unit.allocation_id ? 'Generating…' : (unit.awb_number ? 'Regenerate AWB' : 'Generate AWB')}
              </button>
              <button
                type="button"
                disabled={bdBusy || !unit.awb_number}
                onClick={() => downloadPdf(unit.awb_number)}
                className="flex-1 py-1.5 rounded-md border border-sky-300 bg-sky-50 text-sky-900 text-[11px] font-semibold disabled:opacity-50"
              >
                PDF
              </button>
            </div>
          </div>
        ))}
        {!selected.length && (
          <p className="text-xs text-amber-700">Select QC-passed laptops above to map AWBs.</p>
        )}
      </div>

      {joinedAwbs ? (
        <p className="text-[11px] text-emerald-800 font-mono break-all">Combined AWBs: {joinedAwbs}</p>
      ) : null}

      <button
        type="button"
        disabled={bdBusy || !selected.length}
        onClick={generateAll}
        className="w-full py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
      >
        {bdBusy ? 'Generating…' : `Generate AWB for all ${selected.length} laptop(s)`}
      </button>
    </div>
  );
}

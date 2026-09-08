import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../../components/ui/primitives';
import { PART_CATEGORIES } from '../../../constants/laptopConditions';
import {
  PHYSICAL_CONDITIONS,
  PHYSICAL_INWARD_REASONS,
  createPhysicalInward,
  uploadPhysicalPartPhotos,
} from '../physicalDeadPartApi';
import { todayIso } from '../physicalDeadPartUi';

function emptyUnit() {
  return { serial_number: '', photos: [] };
}

function emptyLine() {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    part_name: '',
    category: 'general',
    quantity: 1,
    condition: 'dead',
    remarks: '',
    units: [emptyUnit()],
  };
}

function resizeUnits(units, qty) {
  const n = Math.min(Math.max(Number(qty) || 1, 1), 20);
  const next = units.slice(0, n);
  while (next.length < n) next.push(emptyUnit());
  return next;
}

export default function PhysicalPartInwardPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [warehouse, setWarehouse] = useState('Main Warehouse');
  const [inwardDate, setInwardDate] = useState(todayIso());
  const [inwardReason, setInwardReason] = useState(PHYSICAL_INWARD_REASONS[0]);
  const [reasonOther, setReasonOther] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState([emptyLine()]);

  const updateLine = (key, patch) => {
    setLines((prev) => prev.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.quantity != null) next.units = resizeUnits(line.units, patch.quantity);
      return next;
    }));
  };

  const updateUnit = (lineKey, idx, patch) => {
    setLines((prev) => prev.map((line) => {
      if (line.key !== lineKey) return line;
      const units = line.units.map((u, i) => (i === idx ? { ...u, ...patch } : u));
      return { ...line, units };
    }));
  };

  const onPhotos = async (lineKey, idx, fileList) => {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    try {
      const data = await uploadPhysicalPartPhotos(files);
      const paths = data.paths || (data.path ? [data.path] : []);
      setLines((prev) => prev.map((line) => {
        if (line.key !== lineKey) return line;
        const units = line.units.map((u, i) => {
          if (i !== idx) return u;
          const added = paths.map((path, n) => ({
            path,
            preview: files[n] ? URL.createObjectURL(files[n]) : '',
          }));
          return { ...u, photos: [...(u.photos || []), ...added] };
        });
        return { ...line, units };
      }));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Photo upload failed');
    }
  };

  const removePhoto = (lineKey, idx, photoIdx) => {
    setLines((prev) => prev.map((line) => {
      if (line.key !== lineKey) return line;
      const units = line.units.map((u, i) => (
        i === idx ? { ...u, photos: u.photos.filter((_, n) => n !== photoIdx) } : u
      ));
      return { ...line, units };
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const reason = inwardReason === 'Other' ? reasonOther.trim() : inwardReason;
    if (!warehouse.trim()) { toast.error('Warehouse is required'); return; }
    if (!reason) { toast.error('Inward reason is required'); return; }
    const units = [];
    for (const line of lines) {
      if (!line.part_name.trim()) { toast.error('Every part needs a name'); return; }
      for (let i = 0; i < line.units.length; i += 1) {
        const u = line.units[i];
        const photos = (u.photos || []).map((p) => p.path).filter(Boolean);
        if (!photos.length) {
          toast.error(`At least one photo required for ${line.part_name} (${i + 1} of ${line.units.length})`);
          return;
        }
        units.push({
          part_name: line.part_name.trim(),
          category: line.category,
          serial_number: u.serial_number.trim() || undefined,
          condition: line.condition,
          remarks: line.remarks.trim() || undefined,
          inward_photo_path: photos[0],
          inward_photo_paths: photos,
        });
      }
    }
    setBusy(true);
    try {
      const { data } = await createPhysicalInward({
        warehouse: warehouse.trim(),
        inward_date: inwardDate,
        inward_reason: reason,
        remarks: remarks.trim() || undefined,
        units,
      });
      toast.success(`Inward ${data.inward.inward_number} · ${data.parts.length} part(s)`);
      navigate(`/inventory-management/physical-parts/inward/${encodeURIComponent(data.inward.inward_number)}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Inward failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Part Inward"
        subtitle="Create a CRM record for a physical / dead part already in the warehouse"
        actions={(
          <Link to="/inventory-management/physical-parts" className="inline-flex items-center gap-1.5 text-sm text-blue-700">
            <ArrowLeft className="w-4 h-4" /> Inventory
          </Link>
        )}
      />

      <form onSubmit={submit} className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm grid sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Warehouse *</span>
            <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Inward date *</span>
            <input type="date" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={inwardDate} onChange={(e) => setInwardDate(e.target.value)} required />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">Inward reason *</span>
            <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={inwardReason} onChange={(e) => setInwardReason(e.target.value)}>
              {PHYSICAL_INWARD_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {inwardReason === 'Other' ? (
            <label className="block text-sm sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Specify reason *</span>
              <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} required />
            </label>
          ) : null}
          <label className="block text-sm sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">Remarks</span>
            <textarea className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[64px]" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
        </section>

        {lines.map((line, lineIdx) => (
          <section key={line.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 m-0">Part type {lineIdx + 1}</h3>
              {lines.length > 1 ? (
                <button type="button" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} className="text-xs text-red-600 inline-flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              ) : null}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Part name *</span>
                <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={line.part_name} onChange={(e) => updateLine(line.key, { part_name: e.target.value })} placeholder="Charger, Battery, Keyboard…" required />
              </label>
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Category / type *</span>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={line.category} onChange={(e) => updateLine(line.key, { category: e.target.value })}>
                  {PART_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Quantity *</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: Number(e.target.value) })}
                />
                <p className="text-[11px] text-slate-400 mt-1 m-0">Each unit gets its own DP number. You can attach multiple photos per unit.</p>
              </label>
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Condition *</span>
                <select className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={line.condition} onChange={(e) => updateLine(line.key, { condition: e.target.value })}>
                  {PHYSICAL_CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Line remarks</span>
                <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={line.remarks} onChange={(e) => updateLine(line.key, { remarks: e.target.value })} />
              </label>
            </div>
            <div className="space-y-2">
              {line.units.map((unit, idx) => (
                <div key={idx} className="rounded-xl border border-dashed border-slate-200 p-3 grid sm:grid-cols-[1fr_1fr] gap-3">
                  <label className="block text-sm">
                    <span className="text-xs font-medium text-slate-600">Serial {line.units.length > 1 ? `#${idx + 1}` : ''} (if applicable)</span>
                    <input className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" value={unit.serial_number} onChange={(e) => updateUnit(line.key, idx, { serial_number: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs font-medium text-slate-600">Photos {line.units.length > 1 ? `#${idx + 1}` : ''} * (multiple)</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="mt-1 block text-sm"
                      onChange={(e) => { onPhotos(line.key, idx, e.target.files); e.target.value = ''; }}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(unit.photos || []).map((ph, photoIdx) => (
                        <span key={`${ph.path}-${photoIdx}`} className="relative">
                          <img src={ph.preview || ph.path} alt="" className="h-16 w-16 rounded border object-cover" />
                          <button
                            type="button"
                            onClick={() => removePhoto(line.key, idx, photoIdx)}
                            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border text-[10px] leading-none"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </section>
        ))}

        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
          className="inline-flex items-center gap-1.5 h-9 px-3 border rounded-lg text-sm hover:bg-slate-50"
        >
          <Plus className="w-4 h-4" /> Add another part type
        </button>

        <div className="flex justify-end gap-2">
          <Link to="/inventory-management/physical-parts" className="h-9 px-3 border rounded-lg text-sm inline-flex items-center">Cancel</Link>
          <button type="submit" disabled={busy} className="h-9 px-4 rounded-lg text-sm font-semibold bg-teal-700 text-white disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Create part records'}
          </button>
        </div>
      </form>
    </div>
  );
}

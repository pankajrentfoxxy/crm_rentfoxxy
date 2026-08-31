import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Package, Pencil } from 'lucide-react';
import PermissionGate from '../../../components/PermissionGate';
import { useAuth } from '../../../context/AuthContext';
import { canEditSoLineRateConfig } from '../../../utils/permissionHelper';
import { attachSoSerial, detachSoSerial, getAvailableSerials, listSoSerials } from '../salesPipelineApi';
import { SO_SERIAL_EDIT_SECTIONS } from '../salesOrderScope';
import SoLineConfigEditModal from './SoLineConfigEditModal';
import SoLineRateEditModal from './SoLineRateEditModal';
import DispatchQcAssignModal from './DispatchQcAssignModal';

const QC_BADGE = {
  passed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

function AttachPicker({ soNumber, line, onAttached, onTicketCreated }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = options.filter((o) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return [o.unique_product_serial, o.inventory_asset_code, o.serial_number, o.processor, o.ram, o.storage]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });

  const loadOptions = async () => {
    setOpen(true);
    setLoading(true);
    try {
      // Match by processor + generation + RAM + storage only (not sales-side brand).
      const r = await getAvailableSerials({
        processor: line.processor,
        generation: line.generation,
        ram: line.ram,
        storage: line.storage,
      });
      setOptions(r.data?.serials || []);
    } catch {
      toast.error('Failed to load available serials');
    } finally {
      setLoading(false);
    }
  };

  const specChips = [
    { label: 'Processor', value: line.processor },
    { label: 'Gen', value: line.generation },
    { label: 'RAM', value: line.ram },
    { label: 'Storage', value: line.storage },
  ].filter((f) => f.value);

  const attach = async (serialId) => {
    setBusy(true);
    try {
      const { data } = await attachSoSerial(soNumber, { serial_id: serialId, line_id: line.line_id });
      setOpen(false);
      onAttached();
      if (data?.qc_ticket_id && data?.qc_ticket) {
        onTicketCreated?.({
          ticket: data.qc_ticket,
          serial: data.serial,
        });
      } else {
        toast.success('Laptop attached · QC ticket created');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Attach failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={loadOptions}
          className="text-xs px-3 py-1.5 rounded border border-teal-600 text-teal-700 hover:bg-teal-50">
          + Attach laptop ({line.remaining_qty} left)
        </button>
      ) : (
        <div className="border rounded-lg p-2 bg-gray-50">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {specChips.map((f) => (
              <span key={f.label} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[11px] font-medium">
                {f.label}: {f.value}
              </span>
            ))}
            {!loading && (
              <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-[11px] font-medium">
                {filtered.length} laptop(s) match
              </span>
            )}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search TTSPL / Serial / config…"
            className="w-full mb-2 border rounded px-2 py-1 text-xs"
          />
          {loading ? (
            <p className="text-xs text-gray-400">Loading available units…</p>
          ) : options.length === 0 ? (
            <div className="text-center py-5 text-amber-700 bg-amber-50 rounded-lg">
              <Package className="w-7 h-7 mx-auto mb-1.5 text-amber-400" />
              <p className="text-sm font-medium">No matching laptops in inventory</p>
              <p className="text-[11px] mt-1">
                Looking for: {[line.processor, line.generation, line.ram, line.storage].filter(Boolean).join(' · ') || 'this config'}
              </p>
              <p className="text-[11px] text-gray-400 mt-1">
                QC-passed units reserved on another SO or already on a DC will not appear here.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-400">No units match “{query}”.</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-2 text-[10px] uppercase text-gray-400 font-semibold">
                <span>TTSPL ID</span><span>Serial Number</span><span></span>
              </div>
              {filtered.map((o) => (
                <div key={o.serial_id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center bg-white border rounded px-2 py-1.5">
                  <span className="text-xs font-mono font-semibold text-blue-700">{o.unique_product_serial || o.inventory_asset_code || '—'}</span>
                  <span className="text-xs font-mono text-gray-700">{o.serial_number || '—'}</span>
                  <button type="button" disabled={busy} onClick={() => attach(o.serial_id)}
                    className="text-xs px-2.5 py-0.5 bg-teal-600 text-white rounded disabled:opacity-50">Attach</button>
                  <span className="col-span-3 text-[11px] text-gray-500 -mt-1">
                    {[o.brand, o.processor, o.generation, o.ram, o.storage].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 mt-2">Cancel</button>
        </div>
      )}
    </div>
  );
}

export default function SoSerialPanel({ soNumber, onSummaryChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editLine, setEditLine] = useState(null);
  const [editRateLine, setEditRateLine] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const { user, effectivePermissions } = useAuth();
  const canEditLineRateConfig = canEditSoLineRateConfig(user, effectivePermissions);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listSoSerials(soNumber);
      setData(r.data);
    } catch {
      toast.error('Failed to load attached laptops');
    } finally {
      setLoading(false);
    }
  }, [soNumber]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    await load();
    onSummaryChange?.();
  }, [load, onSummaryChange]);

  const detach = async (allocId) => {
    if (!window.confirm('Detach this laptop and cancel its QC ticket?')) return;
    try {
      await detachSoSerial(soNumber, allocId);
      toast.success('Laptop detached');
      refresh();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Detach failed');
    }
  };

  if (loading) return <div className="text-gray-400 text-sm">Loading…</div>;
  if (!data) return null;
  const s = data.summary || {};

  return (
    <div className="space-y-4">
      <div className={`rounded-lg p-3 text-sm border ${s.ready_for_dc ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        {s.ready_for_dc
          ? 'All ordered laptops are attached and QC-passed — ready to generate the Delivery Challan.'
          : `Attached ${s.total_attached}/${s.total_ordered} · QC passed ${s.passed} · pending ${s.pending}${s.failed ? ` · failed ${s.failed}` : ''}. Attach all units and pass QC before DC.`}
      </div>

      {(data.lines || []).map((line) => (
        <div key={line.line_id} className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">{line.brand} {line.model_name}</p>
              <p className="text-xs text-gray-500">{[line.processor, line.generation, line.ram, line.storage].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canEditLineRateConfig && (
                <button
                  type="button"
                  onClick={() => setEditRateLine(line)}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-300 text-amber-800 hover:bg-amber-50"
                  title="Edit monthly rate"
                >
                  <Pencil className="w-3 h-3" />
                  Edit rate
                </button>
              )}
              {canEditLineRateConfig && (
                <button
                  type="button"
                  onClick={() => setEditLine(line)}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  title="Edit line config"
                >
                  <Pencil className="w-3 h-3" />
                  Edit config
                </button>
              )}
              <span className="text-xs text-gray-500">{line.attached_count}/{line.ordered_qty} attached</span>
              {line.rate != null ? (
                <span className="text-xs text-gray-600">@ ₹{Number(line.rate).toLocaleString('en-IN')}</span>
              ) : null}
            </div>
          </div>

          {(line.allocations || []).length > 0 && (
            <div className="mt-3 divide-y border rounded-lg">
              {line.allocations.map((a) => (
                <div key={a.allocation_id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-blue-700">{a.ttspl_id || a.serial_number}</span>
                    {(a.serial_brand || a.serial_processor) && (
                      <p className="text-[11px] text-gray-500 truncate">
                        {[a.serial_brand, a.serial_model, a.serial_processor, a.serial_generation, a.serial_ram, a.serial_storage]
                          .filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {a.qc_ticket_id && (
                      <Link to={`/floor-pipeline/tickets/${a.qc_ticket_id}`} className="text-xs text-blue-600">QC #{a.qc_ticket_id}</Link>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs ${QC_BADGE[a.qc_status] || QC_BADGE.pending}`}>{a.qc_status}</span>
                    <PermissionGate section={SO_SERIAL_EDIT_SECTIONS} action="edit">
                      {a.qc_status !== 'passed' && (
                        <button type="button" onClick={() => detach(a.allocation_id)} className="text-xs text-red-600 hover:underline">Remove</button>
                      )}
                    </PermissionGate>
                  </div>
                </div>
              ))}
            </div>
          )}

          {line.remaining_qty > 0 && (
            <PermissionGate section={SO_SERIAL_EDIT_SECTIONS} action="edit">
              <AttachPicker
                soNumber={soNumber}
                line={line}
                onAttached={refresh}
                onTicketCreated={setAssignModal}
              />
            </PermissionGate>
          )}
        </div>
      ))}

      <SoLineConfigEditModal
        open={Boolean(editLine)}
        line={editLine}
        onClose={() => setEditLine(null)}
        onSaved={refresh}
      />
      <SoLineRateEditModal
        open={Boolean(editRateLine)}
        line={editRateLine}
        onClose={() => setEditRateLine(null)}
        onSaved={refresh}
      />
      <DispatchQcAssignModal
        open={Boolean(assignModal)}
        soNumber={soNumber}
        ticket={assignModal?.ticket}
        serial={assignModal?.serial}
        onClose={() => setAssignModal(null)}
        onAssigned={refresh}
      />
    </div>
  );
}

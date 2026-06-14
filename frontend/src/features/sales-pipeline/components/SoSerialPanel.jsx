import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import PermissionGate from '../../../components/PermissionGate';
import { attachSoSerial, detachSoSerial, getAvailableSerials, listSoSerials } from '../salesPipelineApi';

const QC_BADGE = {
  passed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

function AttachPicker({ soNumber, line, onAttached }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadOptions = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const r = await getAvailableSerials({
        brand: line.brand,
        model_name: line.model_name,
        processor: line.processor,
        generation: line.generation,
      });
      setOptions(r.data?.serials || []);
    } catch {
      toast.error('Failed to load available serials');
    } finally {
      setLoading(false);
    }
  };

  const attach = async (serialId) => {
    setBusy(true);
    try {
      await attachSoSerial(soNumber, { serial_id: serialId, line_id: line.line_id });
      toast.success('Laptop attached · QC ticket created');
      setOpen(false);
      onAttached();
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
          {loading ? (
            <p className="text-xs text-gray-400">Loading available units…</p>
          ) : options.length === 0 ? (
            <p className="text-xs text-gray-400">No QC-passed stock matching this config.</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-2 text-[10px] uppercase text-gray-400 font-semibold">
                <span>TTSPL ID</span><span>Serial Number</span><span></span>
              </div>
              {options.map((o) => (
                <div key={o.serial_id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center bg-white border rounded px-2 py-1.5">
                  <span className="text-xs font-mono font-semibold text-blue-700">{o.unique_product_serial || o.inventory_asset_code || '—'}</span>
                  <span className="text-xs font-mono text-gray-700">{o.serial_number || '—'}</span>
                  <button type="button" disabled={busy} onClick={() => attach(o.serial_id)}
                    className="text-xs px-2.5 py-0.5 bg-teal-600 text-white rounded disabled:opacity-50">Attach</button>
                  <span className="col-span-3 text-[11px] text-gray-500 -mt-1">
                    {[o.processor, o.generation, o.ram, o.storage].filter(Boolean).join(' · ')}
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

export default function SoSerialPanel({ soNumber }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const detach = async (allocId) => {
    if (!window.confirm('Detach this laptop and cancel its QC ticket?')) return;
    try {
      await detachSoSerial(soNumber, allocId);
      toast.success('Laptop detached');
      load();
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
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{line.brand} {line.model_name}</p>
              <p className="text-xs text-gray-500">{[line.processor, line.generation, line.ram, line.storage].filter(Boolean).join(' · ')}</p>
            </div>
            <span className="text-xs text-gray-500">{line.attached_count}/{line.ordered_qty} attached</span>
          </div>

          {(line.allocations || []).length > 0 && (
            <div className="mt-3 divide-y border rounded-lg">
              {line.allocations.map((a) => (
                <div key={a.allocation_id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-mono text-xs text-blue-700">{a.ttspl_id || a.serial_number}</span>
                  <div className="flex items-center gap-2">
                    {a.qc_ticket_id && (
                      <Link to={`/floor-pipeline/tickets/${a.qc_ticket_id}`} className="text-xs text-blue-600">QC #{a.qc_ticket_id}</Link>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs ${QC_BADGE[a.qc_status] || QC_BADGE.pending}`}>{a.qc_status}</span>
                    <PermissionGate section="delivery_challans" action="edit">
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
            <PermissionGate section="delivery_challans" action="edit">
              <AttachPicker soNumber={soNumber} line={line} onAttached={load} />
            </PermissionGate>
          )}
        </div>
      ))}
    </div>
  );
}

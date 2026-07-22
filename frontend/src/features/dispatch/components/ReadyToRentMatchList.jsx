import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Package } from 'lucide-react';
import { fetchDispatchMatchingSerials } from '../../../utils/dispatchWorkflowApi';
import { formatSoLineConfig } from '../dispatchSoConfigUtils';

function formatSerialConfig(row) {
  return [row.brand, row.processor, row.generation, row.ram, row.storage]
    .filter(Boolean)
    .join(' · ') || '—';
}

export default function ReadyToRentMatchList({
  lines = [],
  orderType,
  maxPerLine = 8,
  compact = false,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lineKey = useMemo(
    () => lines.map((l) => [
      l.line_id,
      l.processor,
      l.generation,
      l.ram,
      l.storage,
      l.quotation_type,
    ].join('|')).join(';'),
    [lines]
  );

  useEffect(() => {
    if (!lines.length) {
      setItems([]);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const merged = [];
        const seen = new Set();
        for (const line of lines) {
          const { data } = await fetchDispatchMatchingSerials({
            processor: line.processor,
            generation: line.generation,
            ram: line.ram,
            storage: line.storage,
            quotation_type: orderType || line.quotation_type,
            limit: maxPerLine,
          });
          for (const serial of data?.serials || []) {
            const key = serial.serial_id || serial.inventory_row_id;
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            merged.push({
              ...serial,
              _lineId: line.line_id,
              _lineLabel: formatSoLineConfig(line),
            });
          }
        }
        if (!cancelled) setItems(merged);
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          setError(e.response?.data?.message || 'Could not load matching inventory');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [lineKey, orderType, maxPerLine, lines]);

  const maxHeight = compact ? 'max-h-40' : 'max-h-52';

  return (
    <div className={`rounded-xl border border-emerald-100 bg-emerald-50/30 p-3 ${compact ? '' : 'h-full'}`}>
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Ready to Rent / Sell
        </p>
        <p className="text-[11px] text-emerald-700/80 mt-0.5">
          Matching laptops in inventory (same spec as SO lines)
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading matching units…
        </div>
      ) : error ? (
        <p className="text-xs text-red-600 py-2">{error}</p>
      ) : !lines.length ? (
        <p className="text-xs text-slate-500 py-2">No configuration on this order.</p>
      ) : items.length === 0 ? (
        <div className="text-center py-4 text-amber-700 bg-amber-50 rounded-lg border border-amber-100">
          <Package className="w-6 h-6 mx-auto mb-1 text-amber-400" />
          <p className="text-xs font-medium">No matching laptops available</p>
        </div>
      ) : (
        <div className={`space-y-1 overflow-y-auto ${maxHeight}`}>
          <div className="grid grid-cols-[1fr_1fr] gap-2 px-1 text-[10px] uppercase text-slate-400 font-semibold sticky top-0 bg-emerald-50/95 py-1">
            <span>TTSPL ID</span>
            <span>Serial Number</span>
          </div>
          {items.map((row) => (
            <div
              key={`${row.serial_id || row.inventory_row_id}-${row._lineId}`}
              className="grid grid-cols-[1fr_1fr] gap-2 items-start bg-white border border-slate-200 rounded px-2 py-1.5"
            >
              <span className="text-xs font-mono font-semibold text-blue-700 truncate" title={row.unique_product_serial || row.inventory_asset_code}>
                {row.unique_product_serial || row.inventory_asset_code || '—'}
              </span>
              <span className="text-xs font-mono text-slate-700 truncate" title={row.serial_number}>
                {row.serial_number || '—'}
              </span>
              <span className="col-span-2 text-[11px] text-slate-500 -mt-0.5">
                {formatSerialConfig(row)}
              </span>
              {lines.length > 1 ? (
                <span className="col-span-2 text-[10px] text-slate-400 -mt-0.5 truncate" title={row._lineLabel}>
                  Matches: {row._lineLabel}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

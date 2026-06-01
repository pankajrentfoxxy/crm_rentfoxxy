import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { fetchQcOrders, submitQcCheck } from '../qcManagementApi';
import { QC_LIST_META } from '../qcStatusConfig';

const PAGE_SIZE = 50;

function ItemDescriptionCard({ item }) {
  if (!item) return <span className="text-slate-400">—</span>;
  const { brand, model, screen_size, processor, generation, ram, storage, gpu } = item;
  const title = [brand, model].filter(Boolean).join(' — ');
  const specs = [processor, generation, [ram, storage].filter(Boolean).join(' | '), gpu]
    .filter(Boolean)
    .join(' | ');
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-sm">
      <div className="font-semibold text-slate-900">
        {title || '—'}
        {screen_size ? <span className="font-normal text-slate-600"> | {screen_size}</span> : null}
      </div>
      {specs ? <p className="mt-1 text-slate-600 text-xs">{specs}</p> : null}
    </div>
  );
}

function PeriodBadge({ period }) {
  if (!period?.label || period.label === '—') return <span className="text-slate-400">—</span>;
  const expired = period.daysLeft != null && period.daysLeft <= 0;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        expired ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800'
      }`}
    >
      {period.label}
    </span>
  );
}

function QcStatusSelect({ row, onUpdated }) {
  const [busy, setBusy] = useState(false);

  const handleChange = async (e) => {
    const selected = e.target.value;
    if (selected === row.qc_status) return;

    let remark = '';
    if (selected === 'failed') {
      const input = window.prompt('Please provide a reason for failure (required):');
      if (input == null) {
        e.target.value = row.qc_status;
        return;
      }
      if (!String(input).trim()) {
        toast.error('Remark is required for Failed');
        e.target.value = row.qc_status;
        return;
      }
      remark = String(input).trim();
    }

    setBusy(true);
    try {
      const { data } = await submitQcCheck({
        serial_number_id: row.serial_id,
        serial_number: row.serial_number,
        selected_value: selected,
        remark
      });
      if (data.success) {
        toast.success(data.message || 'QC updated');
        onUpdated?.();
      } else {
        toast.error(data.message || 'Update failed');
        e.target.value = row.qc_status;
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Update failed');
      e.target.value = row.qc_status;
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      className="rounded-md border border-slate-200 text-sm px-2 py-1 min-w-[7rem] disabled:opacity-50"
      defaultValue={row.qc_status}
      disabled={busy}
      onChange={handleChange}
    >
      <option value="pending">Pending</option>
      <option value="passed">Passed</option>
      <option value="failed">Failed</option>
    </select>
  );
}

export default function QcOrdersTable({ routeKey }) {
  const meta = QC_LIST_META[routeKey];
  const apiStatus = meta?.apiStatus;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!apiStatus) return;
    setLoading(true);
    try {
      const { data } = await fetchQcOrders(apiStatus, {
        page: 1,
        limit: PAGE_SIZE,
        search: search || undefined
      });
      if (data.success) {
        setRows(data.data || []);
        setTotal(data.pagination?.total ?? (data.data || []).length);
      } else {
        toast.error(data.message || 'Failed to load list');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiStatus, search]);

  useEffect(() => {
    load();
  }, [load]);

  const showRemark = meta?.showRemark;
  const showQcActions = meta?.showQcActions;

  const emptyHint = useMemo(
    () =>
      'Serial rows appear after vendor PO receive when qc_status is pending (or extra.status). Receive stock via Vendor Management first.',
    []
  );

  if (!meta) {
    return <p className="text-sm text-red-600">Unknown QC list route.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{meta.title}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Laravel parity: <code className="text-xs">qc-orders/{apiStatus}</code>
            <span className="ml-2 inline-flex rounded-full bg-teal-50 text-teal-800 px-2 py-0.5 text-xs font-semibold">
              {total}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Serial, PO number, vendor…"
            className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Serial / Unique</th>
                <th className="px-4 py-3">PO Details</th>
                <th className="px-4 py-3">Item Description</th>
                <th className="px-4 py-3">Locking Period</th>
                <th className="px-4 py-3">PO Type</th>
                <th className="px-4 py-3">Status</th>
                {showRemark ? <th className="px-4 py-3">Remark</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={showRemark ? 8 : 7} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-teal-600" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={showRemark ? 8 : 7} className="px-4 py-10 text-center text-slate-500">
                    {emptyHint}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={row.serial_id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-slate-600">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">
                        <div className="border-b border-teal-100 text-teal-900">{row.serial_number}</div>
                        <div className="mt-1 text-slate-500">{row.unique_product_serial || '—'}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">
                        <div className="font-medium border-b border-slate-100">{row.purchase_order_number}</div>
                        <div className="mt-1 text-slate-500">{row.grn_number}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 min-w-[220px]">
                      <ItemDescriptionCard item={row.item_description} />
                    </td>
                    <td className="px-4 py-3">
                      <PeriodBadge period={row.locking_period} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span className="inline-flex rounded-full bg-blue-50 text-blue-800 px-2 py-0.5 text-xs">
                          {row.purchase_order_type_label || '—'}
                        </span>
                        <div>
                          <PeriodBadge period={row.po_type_period} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {showQcActions ? (
                        <QcStatusSelect row={row} onUpdated={load} />
                      ) : (
                        <span className="capitalize text-slate-700">{row.qc_status?.replace(/_/g, ' ')}</span>
                      )}
                    </td>
                    {showRemark ? (
                      <td className="px-4 py-3 max-w-xs text-xs text-slate-600">{row.remark || '—'}</td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PackageSearch, RefreshCw, Search } from 'lucide-react';
import { PageHeader, Button, SearchField, ListPagination } from '../../../components/ui/primitives';
import PermissionGate from '../../../components/PermissionGate';
import {
  getBluedartTrackingStatus,
  listBluedartAwbRegistry,
  syncBluedartPendingAwbs,
  trackBluedartAwbs,
} from '../bluedartTrackingApi';
import { BluedartTrackingDetailModal, BluedartTrackingTable } from '../components/BluedartTrackingViews';
import { deliveryChallanDetailPath, statusLabel } from '../salesPipelineUtils';

function splitManualAwbs(raw) {
  return [...new Set(
    String(raw || '')
      .split(/[/|,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{8,}$/.test(s))
  )];
}

export default function BluedartAwbTrackingPage() {
  const [configured, setConfigured] = useState(true);
  const [manualInput, setManualInput] = useState('');
  const [manualRows, setManualRows] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [detailRow, setDetailRow] = useState(null);

  const [registrySearch, setRegistrySearch] = useState('');
  const [registryRows, setRegistryRows] = useState([]);
  const [registryPage, setRegistryPage] = useState(1);
  const [registryTotal, setRegistryTotal] = useState(0);
  const [registryTotalPages, setRegistryTotalPages] = useState(1);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const limit = 25;

  useEffect(() => {
    getBluedartTrackingStatus()
      .then((res) => setConfigured(res.data?.configured !== false))
      .catch(() => setConfigured(false));
  }, []);

  const loadRegistry = useCallback(async () => {
    setRegistryLoading(true);
    try {
      const res = await listBluedartAwbRegistry({
        search: registrySearch || undefined,
        page: registryPage,
        limit,
      });
      setRegistryRows(res.data?.rows || []);
      setRegistryTotal(res.data?.pagination?.total || 0);
      setRegistryTotalPages(res.data?.pagination?.totalPages || 1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load AWB registry');
      setRegistryRows([]);
    } finally {
      setRegistryLoading(false);
    }
  }, [registryPage, registrySearch]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  const trackManual = async () => {
    const awbs = splitManualAwbs(manualInput);
    if (!awbs.length) {
      toast.error('Enter a valid AWB number (8+ digits). Separate multiple AWBs with comma or space.');
      return;
    }
    setManualLoading(true);
    try {
      const res = await trackBluedartAwbs({ awb_numbers: awbs });
      setManualRows(res.data?.trackings || []);
      if (!res.data?.trackings?.length) toast.error('No tracking data returned');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Tracking failed');
      setManualRows([]);
    } finally {
      setManualLoading(false);
    }
  };

  const trackOne = async (awb) => {
    setManualLoading(true);
    try {
      const res = await trackBluedartAwbs({ awb_numbers: [awb] });
      const rows = res.data?.trackings || [];
      setManualRows(rows);
      setManualInput(awb);
      if (rows[0]) setDetailRow(rows[0]);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Tracking failed');
    } finally {
      setManualLoading(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await syncBluedartPendingAwbs();
      toast.success(res.data?.summary?.message || 'BlueDart sync completed');
      loadRegistry();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="BlueDart AWB Tracking"
        subtitle="Track courier shipments by AWB — type any number or pick from delivery challans"
        actions={(
          <PermissionGate section="bluedart_awb_tracking" action="edit">
            <Button variant="secondary" loading={syncing} onClick={runSync}>
              <RefreshCw className="w-4 h-4" /> Sync pending AWBs
            </Button>
          </PermissionGate>
        )}
      />

      {!configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          BlueDart tracking API is not configured on the server. Set BLUEDART_LOGIN_ID and BLUEDART_LICENSE_KEY to enable live tracking.
        </div>
      ) : null}

      <section className="bg-white border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <PackageSearch className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-slate-900">Track by AWB number</h2>
        </div>
        <p className="text-sm text-slate-600">
          Enter one or more BlueDart AWB numbers manually. This works even when the AWB is not linked to a DC in the CRM.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
            placeholder="e.g. 90652411522 or multiple AWBs separated by comma"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') trackManual(); }}
          />
          <Button loading={manualLoading} onClick={trackManual}>
            <Search className="w-4 h-4" /> Track
          </Button>
        </div>
        {manualRows.length > 0 ? (
          <BluedartTrackingTable rows={manualRows} onView={setDetailRow} />
        ) : null}
      </section>

      <section className="bg-white border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-slate-900">AWBs on delivery challans</h2>
        <p className="text-sm text-slate-600">
          Courier AWBs registered on outbound delivery challans. Click Track to fetch live BlueDart status.
        </p>
        <SearchField
          value={registrySearch}
          onChange={(v) => { setRegistrySearch(v); setRegistryPage(1); }}
          placeholder="Search DC, AWB, customer, SO…"
        />
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 text-left">
              <tr>
                <th className="px-3 py-2">AWB</th>
                <th className="px-3 py-2">DC</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Dispatched</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {registryLoading ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : registryRows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No AWBs found</td></tr>
              ) : registryRows.map((row) => (
                <tr key={`${row.dc_number}-${row.awb_number}`} className="border-t hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-mono text-blue-700">{row.awb_number}</td>
                  <td className="px-3 py-2">
                    <Link to={deliveryChallanDetailPath(row.dc_number)} className="text-blue-600 hover:underline font-mono text-xs">
                      {row.dc_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.customer_name || '—'}</td>
                  <td className="px-3 py-2 capitalize">{statusLabel(row.status || 'pending')}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {row.dispatched_at ? new Date(row.dispatched_at).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => trackOne(row.awb_number)}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Track
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ListPagination
          page={registryPage}
          totalPages={registryTotalPages}
          total={registryTotal}
          pageSize={limit}
          onPageChange={setRegistryPage}
        />
      </section>

      {detailRow ? (
        <BluedartTrackingDetailModal detail={detailRow} onClose={() => setDetailRow(null)} />
      ) : null}
    </div>
  );
}

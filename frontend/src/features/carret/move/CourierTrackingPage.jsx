import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, DataTable, DateTime, DocNumber, Drawer, EmptyState, Field, FilterBar, KeyValue, Notice, Panel,
  Section, StatusChip, Textarea,
} from '../../../components/carret';
import api from '../../../utils/api';
import { usePermission } from '../../../hooks/usePermission';

/**
 * Move → Courier & tracking.
 *
 * Every AWB on a challan, with BlueDart's live status one click away. The
 * sweep that marks courier challans delivered runs every 20 minutes on its
 * own; "Sync now" runs the same sweep immediately. Reads /api/bluedart-awb-tracking,
 * the endpoints the old page uses.
 */
const base = '/bluedart-awb-tracking';

function TrackingResult({ t }) {
  return (
    <Section title={`AWB ${t.awb_number || ''}`}>
      {t.found === false ? <Notice tone="warn">{t.status || t.message || 'BlueDart has no record of this AWB yet.'}</Notice> : (
        <KeyValue items={[
          { label: 'Status', value: [t.status, t.status_type && `(${t.status_type})`].filter(Boolean).join(' ') },
          { label: 'Updated', value: t.last_updated || [t.status_date, t.status_time].filter(Boolean).join(' ') },
          { label: 'Where', value: t.current_location },
          t.received_by && { label: 'Received by', value: t.received_by },
          t.dc_number && { label: 'Challan', value: <DocNumber value={t.dc_number} /> },
        ]}
        />
      )}
      {(t.scans || []).length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <DataTable
            rows={t.scans}
            rowKey={(x, k) => k}
            columns={[
              { key: 'd', header: 'When', render: (x) => [x.date, x.time].filter(Boolean).join(' ') },
              { key: 's', header: 'Scan', render: (x) => x.status || x.code },
              { key: 'l', header: 'Where', render: (x) => x.location || '—' },
            ]}
          />
        </div>
      )}
    </Section>
  );
}

export default function CourierTrackingPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canSync = hasPermission('bluedart_awb_tracking', 'edit');
  const [configured, setConfigured] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reg, setReg] = useState({ loading: true, rows: [], total: 0, pages: 1 });
  const [track, setTrack] = useState(null);
  const [lookup, setLookup] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { api.get(`${base}/status`).then(({ data }) => setConfigured(Boolean(data?.configured))).catch(() => setConfigured(null)); }, []);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api.get(`${base}/registry`, { params: { search: search || undefined, page, limit: 50 } })
        .then(({ data }) => { if (!cancelled) setReg({ loading: false, rows: data?.rows || [], total: data?.pagination?.total || 0, pages: data?.pagination?.totalPages || 1 }); })
        .catch(() => { if (!cancelled) setReg({ loading: false, rows: [], total: 0, pages: 1 }); });
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, page]);

  const trackAwbs = async (awbs) => {
    setTrack({ loading: true });
    try { const { data } = await api.post(`${base}/track`, { awb_numbers: awbs }); setTrack({ rows: data?.trackings || [] }); } catch (e) { setTrack({ error: e?.response?.data?.message || 'Tracking failed.' }); }
  };
  const sync = async () => {
    setBusy('sync');
    try {
      const { data } = await api.post(`${base}/sync-pending`);
      const s = data?.summary || {};
      toast.success(`Checked ${s.awbs || 0} AWBs · ${s.delivered || 0} delivered · ${s.errors || 0} errors`);
      setPage(1); setSearch((x) => x);
    } catch (e) { toast.error(e?.response?.data?.message || 'Sync failed.'); } finally { setBusy(''); }
  };

  const columns = useMemo(() => [
    { key: 'awb', header: 'AWB', render: (r) => <DocNumber value={r.awb_number} />, sub: (r) => r.courier_name },
    { key: 'dc', header: 'Challan', render: (r) => <DocNumber value={r.dc_number} />, sub: (r) => r.customer_name },
    { key: 'st', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
    { key: 'out', header: 'Left the gate', render: (r) => <DateTime value={r.dispatched_at} /> },
    { key: 'del', header: 'Delivered', render: (r) => <DateTime value={r.delivered_at} /> },
    { key: 't', header: '', align: 'right', render: (r) => <Button variant="quiet" onClick={(e) => { e.stopPropagation(); trackAwbs([r.awb_number]); }}>Track</Button> },
  ], []);

  return (
    <DeskShell
      title="Courier & tracking"
      breadcrumb="Move"
      subtitle="Every AWB on a challan. Delivered courier challans close themselves from tracking every 20 minutes."
      actions={canSync && <Button variant="primary" onClick={sync} disabled={busy === 'sync' || configured === false}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</Button>}
    >
      <div className="c-stack">
        {configured === false && <Notice tone="warn" title="BlueDart tracking is not configured on this server">Statuses will not update until the BlueDart credentials are set.</Notice>}
        <Section title="Track any AWB">
          <div className="flex items-end flex-wrap" style={{ gap: '10px' }}>
            <div style={{ flex: '1 1 320px' }}>
              <Field label="AWB numbers" hint="One per line, or separated by commas.">
                <Textarea rows={2} value={lookup} onChange={(e) => setLookup(e.target.value)} className="font-mono" />
              </Field>
            </div>
            <Button onClick={() => { const a = lookup.split(/[\s,]+/).filter(Boolean); if (a.length) trackAwbs(a); }}>Track</Button>
          </div>
        </Section>
        <Panel
          toolbar={<FilterBar filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'AWB, challan or customer' }]} values={{ search }} onChange={(k, v) => { setSearch(v); setPage(1); }} onClear={() => setSearch('')} count={`${reg.total} challans`} />}
        >
          {reg.loading ? <EmptyState title="Loading…" /> : (
            <DataTable rows={reg.rows} rowKey={(r, i) => `${r.dc_number}-${r.awb_number}-${i}`} columns={columns} onRowClick={(r) => navigate(`/carret/move/challans/${encodeURIComponent(r.dc_number)}`)} empty={<EmptyState title="No courier challans" />} />
          )}
          {reg.pages > 1 && (
            <div className="c-toolbar" style={{ borderTop: '1px solid var(--rule)', borderBottom: 0 }}>
              <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="font-ui text-ink-3">Page {page} of {reg.pages}</span>
              <Button variant="quiet" disabled={page >= reg.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </Panel>
      </div>
      <Drawer open={Boolean(track)} onClose={() => setTrack(null)} title="BlueDart tracking" width="40rem">
        {track?.loading && <EmptyState title="Asking BlueDart…" />}
        {track?.error && <Notice tone="crit">{track.error}</Notice>}
        {track?.rows && (track.rows.length ? <div className="c-stack">{track.rows.map((t, i) => <TrackingResult key={t.awb_number || i} t={t} />)}</div> : <EmptyState title="No result" />)}
      </Drawer>
    </DeskShell>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronDown, X, Cpu, MonitorSmartphone,
  ClipboardList, Inbox, Wrench, Layers, TestTube2, CircuitBoard, PaintBucket,
  ShieldCheck, ShieldQuestion, PackageCheck, Warehouse,
  User, Download, ChevronLeft, ChevronRight, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getLaptopReport, getLaptopReportTickets } from '../reportingApi';
import useDebouncedValue from '../../../hooks/useDebouncedValue';

const C = {
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  surface2: '#F1F3F6',
  border: '#E2E6EB',
  borderLite: '#CDD4DC',
  text: '#161B22',
  dim: '#5B6572',
  dim2: '#98A2AE',
  cyan: '#0E7C90',
  amber: '#B4650A',
  green: '#16803C',
  red: '#C4302B',
  violet: '#6D4CC7',
};

const STAGE_LIST = [
  { key: 'floormanager', label: 'Floor Manager', icon: ClipboardList },
  { key: 'qcqueue', label: 'QC Queue', icon: Inbox },
  { key: 'diagnosis', label: 'Diagnosis', icon: Wrench },
  { key: 'assembly', label: 'Assembly & Software', icon: Layers },
  { key: 'testing', label: 'Final Testing', icon: TestTube2 },
  { key: 'chip', label: 'Chip Level Repair', icon: CircuitBoard },
  { key: 'paint', label: 'Body & Paint', icon: PaintBucket },
  { key: 'qc1', label: 'QC1', icon: ShieldCheck },
  { key: 'qc2', label: 'QC2', icon: ShieldQuestion },
  { key: 'dispatchqc', label: 'Dispatch QC', icon: PackageCheck },
  { key: 'inventory', label: 'Inventory', icon: Warehouse },
];

const STATUS_LIST = ['Pending', 'In Progress', 'Done', 'QC Failed', 'Diagnosis Failed'];
const STATUS_COLOR = {
  Pending: C.amber,
  'In Progress': C.violet,
  Done: C.green,
  'QC Failed': C.red,
  'Diagnosis Failed': C.red,
};

const STAGE_PERF_LIST = [
  { key: 'diagnosis', label: 'Diagnosis', icon: Wrench, qc: false },
  { key: 'assembly', label: 'Assembly & Software', icon: Layers, qc: false },
  { key: 'testing', label: 'Final Testing', icon: TestTube2, qc: false },
  { key: 'chip', label: 'Chip Level Repair', icon: CircuitBoard, qc: false },
  { key: 'paint', label: 'Body & Paint', icon: PaintBucket, qc: false },
  { key: 'qc1', label: 'QC1', icon: ShieldCheck, qc: true },
  { key: 'qc2', label: 'QC2', icon: ShieldQuestion, qc: true },
  { key: 'dispatchqc', label: 'Dispatch QC', icon: PackageCheck, qc: true },
];

const DEFAULT_POPUP_COLUMNS = [
  { key: 'ticketId', label: 'Ticket ID' },
  { key: 'ttspl', label: 'TTSPL' },
  { key: 'serial', label: 'Serial Number' },
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'processor', label: 'Processor' },
  { key: 'generation', label: 'Generation' },
  { key: 'ram', label: 'RAM' },
  { key: 'ssd', label: 'SSD' },
  { key: 'stage', label: 'Current Stage' },
  { key: 'tech', label: 'Assigned Technician' },
  { key: 'team', label: 'Team' },
  { key: 'status', label: 'Ticket Status' },
];

const STAGE_PERF_POPUP_COLUMNS = [
  { key: 'ticketId', label: 'Ticket ID' },
  { key: 'ttspl', label: 'TTSPL' },
  { key: 'serial', label: 'Serial Number' },
  { key: 'configuration', label: 'Configuration' },
  { key: 'currentStage', label: 'Current Stage' },
  { key: 'stageStatus', label: 'Stage Status' },
  { key: 'tech', label: 'Assigned Technician' },
  { key: 'team', label: 'Team' },
  { key: 'assignedAt', label: 'Assigned Time', format: 'datetime' },
  { key: 'completedAt', label: 'Completed Time', format: 'datetime' },
  { key: 'workDuration', label: 'Work Duration' },
];

const PAGE_SIZE = 8;

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
        border: `1px solid ${active ? C.cyan : C.border}`,
        background: active ? C.cyan : 'transparent',
        color: active ? '#fff' : C.dim,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function Select({ label, value, onChange, options, icon: Icon }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          background: C.surface2,
          border: `1px solid ${C.border}`,
          color: value === 'All' ? C.dim : C.text,
          fontSize: 12, fontWeight: 500, borderRadius: 8,
          padding: Icon ? '7px 26px 7px 28px' : '7px 26px 7px 10px',
          cursor: 'pointer', minWidth: 108,
        }}
      >
        <option value="All">{label}</option>
        {options.map((o) => (<option key={o} value={o}>{o}</option>))}
      </select>
      {Icon && <Icon size={12} color={C.dim2} style={{ position: 'absolute', left: 9, top: 9 }} />}
      <ChevronDown size={12} color={C.dim2} style={{ position: 'absolute', right: 8, top: 9, pointerEvents: 'none' }} />
    </div>
  );
}

function StatCard({ label, value, accent, icon: Icon, onClick, loading }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: '14px 16px', flex: '1 1 130px', minWidth: 130, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, color: C.dim, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>{label}</span>
        {Icon && <Icon size={14} color={accent} />}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.text, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
        {loading ? '—' : value}
      </div>
    </div>
  );
}

function CountLink({ value, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13.5,
        color: color || C.cyan, textDecoration: 'underline', textUnderlineOffset: 2,
      }}
    >
      {value}
    </button>
  );
}

function fmtDateTime(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function cellValue(row, col) {
  const raw = row[col.key];
  if (col.format === 'datetime') return fmtDateTime(raw);
  return raw ?? '—';
}

function exportCSV(rows, filename, columns) {
  const headers = columns.map((c) => c.label);
  const lines = [headers.join(',')].concat(
    rows.map((r) => columns.map((c) => `"${String(cellValue(r, c)).replace(/"/g, '""')}"`).join(','))
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildBaseParams({
  dateMode, customFrom, customTo, search,
  fStage, fTeam, fTech, fStatus, fBrand, fModel, fProcessor, fGeneration, fRam, fSsd,
}) {
  const params = {
    dateMode: dateMode === 'All' ? 'all' : dateMode.toLowerCase(),
    search: search || undefined,
    stage: fStage !== 'All' ? fStage : undefined,
    team: fTeam !== 'All' ? fTeam : undefined,
    technician: fTech !== 'All' ? fTech : undefined,
    status: fStatus !== 'All' ? fStatus : undefined,
    brand: fBrand !== 'All' ? fBrand : undefined,
    model: fModel !== 'All' ? fModel : undefined,
    processor: fProcessor !== 'All' ? fProcessor : undefined,
    generation: fGeneration !== 'All' ? fGeneration : undefined,
    ram: fRam !== 'All' ? fRam : undefined,
    ssd: fSsd !== 'All' ? fSsd : undefined,
  };
  if (customFrom && customTo) {
    params.dateMode = 'custom';
    params.dateFrom = customFrom;
    params.dateTo = customTo;
  }
  return params;
}

function PopupModal({ title, baseParams, popupParams, columns, onClose }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const debouncedQ = useDebouncedValue(q.trim(), 320);

  const fetchTickets = useCallback(async (pageNum, searchTerm) => {
    setLoading(true);
    try {
      const res = await getLaptopReportTickets({
        ...baseParams,
        ...popupParams,
        page: pageNum,
        limit: PAGE_SIZE,
        search: searchTerm || undefined,
      });
      const payload = res.data || res;
      setRows(payload.rows || []);
      setTotal(payload.pagination?.total || 0);
      setTotalPages(payload.pagination?.totalPages || 1);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load tickets');
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [baseParams, popupParams]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, popupParams]);

  useEffect(() => {
    fetchTickets(page, debouncedQ);
  }, [page, debouncedQ, fetchTickets]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await getLaptopReportTickets({
        ...baseParams,
        ...popupParams,
        page: 1,
        limit: 5000,
        search: debouncedQ || undefined,
      });
      const payload = res.data || res;
      exportCSV(payload.rows || [], 'laptop-report-export.csv', columns);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface, borderRadius: 14, width: '100%', maxWidth: 980,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{title}</div>
            <div style={{ fontSize: 11.5, color: C.dim2, marginTop: 2 }}>{total} laptop{total !== 1 ? 's' : ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 11px', fontSize: 12, color: C.dim, cursor: 'pointer', fontWeight: 600 }}
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Export
            </button>
            <button type="button" onClick={onClose} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 7, cursor: 'pointer', display: 'flex' }}>
              <X size={15} color={C.dim} />
            </button>
          </div>
        </div>

        <div style={{ padding: '10px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ position: 'relative', maxWidth: 320 }}>
            <Search size={13} color={C.dim2} style={{ position: 'absolute', left: 9, top: 8 }} />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search ticket, TTSPL, serial, model"
              style={{ width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px 7px 28px', fontSize: 12.5, color: C.text }}
            />
          </div>
        </div>

        <div style={{ overflow: 'auto', flex: 1, position: 'relative' }}>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.7)', zIndex: 2 }}>
              <Loader2 size={24} color={C.cyan} className="animate-spin" />
            </div>
          )}
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: C.surface2, position: 'sticky', top: 0 }}>
                {columns.map((c) => (
                  <th key={c.key} style={{ padding: '9px 12px', fontSize: 10, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borderLite}` }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.eventKey || r.ticketId} style={{ borderTop: `1px solid ${C.border}` }}>
                  {columns.map((c) => {
                    const val = cellValue(r, c);
                    const mono = ['ticketId', 'ttspl', 'serial'].includes(c.key);
                    const isStatus = c.key === 'status' || c.key === 'stageStatus';
                    return (
                      <td
                        key={c.key}
                        style={{
                          padding: '8px 12px',
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                          fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
                          color: c.key === 'ticketId' ? C.cyan : c.key === 'ttspl' || c.key === 'serial' ? C.dim : undefined,
                          fontWeight: c.key === 'ticketId' ? 600 : undefined,
                        }}
                      >
                        {isStatus && c.key === 'status' ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: STATUS_COLOR[r.status] || C.dim, fontWeight: 700 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 99, background: STATUS_COLOR[r.status] || C.dim }} />
                            {val}
                          </span>
                        ) : isStatus ? (
                          <span style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 8px', fontWeight: 600, textTransform: 'capitalize' }}>{val}</span>
                        ) : c.key === 'stage' || c.key === 'currentStage' ? (
                          <span style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>{val}</span>
                        ) : val}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={columns.length} style={{ padding: 30, textAlign: 'center', color: C.dim2, fontSize: 13 }}>No laptops match this view.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11.5, color: C.dim2 }}>Page {page} of {totalPages}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', fontSize: 12, color: page === 1 ? C.dim2 : C.text, cursor: page === 1 ? 'default' : 'pointer' }}>
              <ChevronLeft size={13} /> Prev
            </button>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px', fontSize: 12, color: page === totalPages ? C.dim2 : C.text, cursor: page === totalPages ? 'default' : 'pointer' }}>
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LaptopReportPage() {
  const [dateMode, setDateMode] = useState('Today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 320);

  const [fStage, setFStage] = useState('All');
  const [fTeam, setFTeam] = useState('All');
  const [fTech, setFTech] = useState('All');
  const [fStatus, setFStatus] = useState('All');
  const [fBrand, setFBrand] = useState('All');
  const [fModel, setFModel] = useState('All');
  const [fProcessor, setFProcessor] = useState('All');
  const [fGeneration, setFGeneration] = useState('All');
  const [fRam, setFRam] = useState('All');
  const [fSsd, setFSsd] = useState('All');

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastSynced, setLastSynced] = useState(null);
  const [popup, setPopup] = useState(null);

  const filterState = useMemo(() => ({
    dateMode, customFrom, customTo, search,
    fStage, fTeam, fTech, fStatus, fBrand, fModel, fProcessor, fGeneration, fRam, fSsd,
  }), [dateMode, customFrom, customTo, search, fStage, fTeam, fTech, fStatus, fBrand, fModel, fProcessor, fGeneration, fRam, fSsd]);

  const baseParams = useMemo(() => buildBaseParams(filterState), [filterState]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLaptopReport(baseParams);
      const payload = res.data || res;
      setReport(payload);
      setLastSynced(new Date());
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load laptop report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [baseParams]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const filters = report?.filters || {};
  const summaryCounts = report?.summary || { Total: 0 };
  const techAgg = report?.technicians || [];
  const configAgg = report?.configurations || [];
  const stagePerf = report?.stagePerformance || [];
  const techStageMatrix = report?.technicianStageMatrix || [];

  const stagePerfByKey = useMemo(() => {
    const map = {};
    stagePerf.forEach((s) => { map[s.key] = s; });
    return map;
  }, [stagePerf]);

  const activeFilterCount = [fStage, fTeam, fTech, fStatus, fBrand, fModel, fProcessor, fGeneration, fRam, fSsd].filter((f) => f !== 'All').length;

  const clearAllFilters = () => {
    setFStage('All'); setFTeam('All'); setFTech('All'); setFStatus('All');
    setFBrand('All'); setFModel('All'); setFProcessor('All'); setFGeneration('All'); setFRam('All'); setFSsd('All');
    setSearchInput('');
  };

  const openPopup = (title, popupParams, columns = DEFAULT_POPUP_COLUMNS) => setPopup({ title, popupParams, columns });
  const openStagePerfPopup = (stageDef, bucket) => {
    const stats = stagePerfByKey[stageDef.key] || {};
    const stageName = stats.stage || stageDef.label;
    const bucketLabels = {
      assigned: 'Assigned',
      completed: 'Completed',
      passed: 'Passed',
      pending: 'Pending',
      failed: 'Failed',
      reworked: 'Reworked',
    };
    openPopup(
      `${stageDef.label} — ${bucketLabels[bucket] || bucket}`,
      { stage_perf_stage: stageName, stage_perf_bucket: bucket },
      STAGE_PERF_POPUP_COLUMNS,
    );
  };
  const openTechStagePopup = (techName, stageDef, bucket) => {
    const stats = stagePerfByKey[stageDef.key] || {};
    const stageName = stats.stage || stageDef.label;
    const bucketLabel = bucket === 'assigned' ? 'Assigned' : (stageDef.qc ? 'Passed' : 'Completed');
    openPopup(
      `${techName} · ${stageDef.label} — ${bucketLabel}`,
      {
        stage_perf_stage: stageName,
        stage_perf_bucket: bucket === 'completed' && stageDef.qc ? 'passed' : bucket,
        stage_perf_technician: techName,
      },
      STAGE_PERF_POPUP_COLUMNS,
    );
  };
  const openStatusPopup = (status) => {
    if (status === 'QC Failed') {
      openPopup('QC Failed', { popup_qc_history_failed: true }, STAGE_PERF_POPUP_COLUMNS);
      return;
    }
    const popupParams = status === 'Total' ? {} : { popup_status: status };
    openPopup(status === 'Total' ? 'All Tickets' : status, popupParams);
  };
  const openTechPopup = (name, statusKey) => {
    const popupParams = { popup_technician: name };
    let suffix = 'Total';
    if (statusKey === 'inProgress') { popupParams.popup_tech_mode = 'inProgress'; suffix = 'In Progress'; }
    if (statusKey === 'done') { popupParams.popup_tech_mode = 'done'; suffix = 'Done'; }
    if (statusKey === 'pending') { popupParams.popup_tech_mode = 'pending'; suffix = 'Pending'; }
    openPopup(`${name} — ${suffix}`, popupParams);
  };
  const openConfigPopup = (label) => openPopup(`Configuration — ${label}`, { popup_processor: label });

  const syncedLabel = lastSynced
    ? `Live · synced from CRM ${Math.max(1, Math.round((Date.now() - lastSynced.getTime()) / 1000))}s ago`
    : 'Loading…';

  const dateLabel = customFrom && customTo ? 'Custom' : dateMode;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", color: C.text, padding: '22px 24px 60px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${C.borderLite}; border-radius: 4px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; }
        tr:hover td { background: ${C.surface2} !important; }
        select:focus, input:focus { outline: 1.5px solid ${C.cyan}; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: C.dim2, fontWeight: 600, marginBottom: 4, letterSpacing: 0.3 }}>/reports/laptop-report</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: -0.3 }}>Laptop Report</h1>
          <p style={{ fontSize: 12.5, color: C.dim, margin: '4px 0 0' }}>Today&apos;s overall production summary, live from the floor</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.dim2 }}>
          <div style={{ width: 7, height: 7, borderRadius: 99, background: C.green, boxShadow: '0 0 0 3px rgba(22,128,60,0.14)' }} />
          {syncedLabel}
        </div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
          <Search size={13} color={C.dim2} style={{ position: 'absolute', left: 9, top: 8 }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="TTSPL ID, serial, model..."
            style={{ width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px 7px 28px', fontSize: 12.5, color: C.text }}
          />
        </div>
        <Select label="All stages" value={fStage} onChange={setFStage} options={(filters.stages || STAGE_LIST).map((s) => s.label)} />
        <Select label="All teams" value={fTeam} onChange={setFTeam} options={filters.teams || []} />
        <Select label="All technicians" value={fTech} onChange={setFTech} options={filters.technicians || []} icon={User} />
        <Select label="All statuses" value={fStatus} onChange={setFStatus} options={filters.statuses || STATUS_LIST} />

        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {['All', 'Today', 'Yesterday'].map((d) => (
            <Chip key={d} active={dateMode === d && !(customFrom && customTo)} onClick={() => { setDateMode(d); setCustomFrom(''); setCustomTo(''); }}>{d}</Chip>
          ))}
        </div>
        <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
          style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', fontSize: 12, color: C.text }} />
        <span style={{ color: C.dim2, fontSize: 12 }}>–</span>
        <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
          style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', fontSize: 12, color: C.text }} />
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <span style={{ fontSize: 10.5, color: C.dim2, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 2 }}>Attributes</span>
        <Select label="Brand" value={fBrand} onChange={setFBrand} options={filters.brands || []} />
        <Select label="Model" value={fModel} onChange={setFModel} options={filters.models || []} />
        <Select label="Processor" value={fProcessor} onChange={setFProcessor} options={filters.processors || []} icon={Cpu} />
        <Select label="Gen" value={fGeneration} onChange={setFGeneration} options={filters.generations || []} />
        <Select label="RAM" value={fRam} onChange={setFRam} options={filters.rams || []} />
        <Select label="SSD" value={fSsd} onChange={setFSsd} options={filters.ssds || []} />
        {activeFilterCount > 0 && (
          <button type="button" onClick={clearAllFilters} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(196,48,43,0.06)', border: '1px solid rgba(196,48,43,0.35)', color: C.red, borderRadius: 8, padding: '7px 11px', fontSize: 12, cursor: 'pointer', fontWeight: 600, marginLeft: 'auto' }}>
            <X size={12} /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
          </button>
        )}
      </div>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Dashboard</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatCard label={`Total Tickets · ${dateLabel}`} value={summaryCounts.Total ?? 0} accent={C.cyan} icon={MonitorSmartphone} onClick={() => openStatusPopup('Total')} loading={loading} />
          <StatCard label="Not Assigned" value={summaryCounts.Pending ?? 0} accent={STATUS_COLOR.Pending} icon={Inbox} onClick={() => openStatusPopup('Pending')} loading={loading} />
          <StatCard label="In Progress" value={summaryCounts['In Progress'] ?? 0} accent={STATUS_COLOR['In Progress']} icon={Layers} onClick={() => openStatusPopup('In Progress')} loading={loading} />
          <StatCard label="Completed" value={summaryCounts.Done ?? 0} accent={STATUS_COLOR.Done} icon={ShieldCheck} onClick={() => openStatusPopup('Done')} loading={loading} />
          <StatCard label="QC Failed" value={summaryCounts['QC Failed'] ?? 0} accent={C.red} icon={ShieldQuestion} onClick={() => openStatusPopup('QC Failed')} loading={loading} />
          <StatCard label="Diagnosis Failed" value={summaryCounts['Diagnosis Failed'] ?? 0} accent={C.red} icon={Wrench} onClick={() => openStatusPopup('Diagnosis Failed')} loading={loading} />
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Stage Performance</h2>
          <p style={{ fontSize: 12, color: C.dim, margin: '4px 0 0' }}>Historical counts from production workflow — assigned, completed, pending, failed, and reworked per stage</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {STAGE_PERF_LIST.map((def) => {
            const stats = stagePerfByKey[def.key] || {};
            const Icon = def.icon;
            const doneVal = def.qc ? (stats.passed ?? 0) : (stats.completed ?? 0);
            const doneLabel = def.qc ? 'Passed' : 'Completed';
            const doneBucket = def.qc ? 'passed' : 'completed';
            return (
              <div key={def.key} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: C.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={15} color={C.dim} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{def.label}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 12 }}>
                  <span style={{ color: C.dim }}>Assigned</span>
                  <span style={{ textAlign: 'right' }}><CountLink value={stats.assigned ?? 0} onClick={() => openStagePerfPopup(def, 'assigned')} /></span>
                  <span style={{ color: C.dim }}>{doneLabel}</span>
                  <span style={{ textAlign: 'right' }}><CountLink value={doneVal} color={C.green} onClick={() => openStagePerfPopup(def, doneBucket)} /></span>
                  <span style={{ color: C.dim }}>Pending</span>
                  <span style={{ textAlign: 'right' }}><CountLink value={stats.pending ?? 0} color={C.amber} onClick={() => openStagePerfPopup(def, 'pending')} /></span>
                  <span style={{ color: C.dim }}>Failed</span>
                  <span style={{ textAlign: 'right' }}><CountLink value={stats.failed ?? 0} color={C.red} onClick={() => openStagePerfPopup(def, 'failed')} /></span>
                  {!def.qc && (
                    <>
                      <span style={{ color: C.dim }}>Reworked</span>
                      <span style={{ textAlign: 'right' }}>
                        {(stats.reworked ?? 0) > 0 ? (
                          <CountLink value={stats.reworked} color={C.violet} onClick={() => openStagePerfPopup(def, 'reworked')} />
                        ) : (
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.dim2 }}>0</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Technician Stage Report</h2>
          <p style={{ fontSize: 12, color: C.dim, margin: '4px 0 0' }}>Assigned / completed per stage — click any count for ticket details</p>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto' }}>
          <table>
            <thead>
              <tr style={{ background: C.surface2 }}>
                <th style={{ padding: '9px 16px', fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'left', position: 'sticky', left: 0, background: C.surface2, zIndex: 1 }}>Technician</th>
                {STAGE_PERF_LIST.map((s) => (
                  <th key={s.key} style={{ padding: '9px 12px', fontSize: 10.5, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'center', whiteSpace: 'nowrap' }}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {techStageMatrix.length === 0 && !loading && (
                <tr><td colSpan={STAGE_PERF_LIST.length + 1} style={{ padding: 24, textAlign: 'center', color: C.dim2, fontSize: 13 }}>No stage history for this period yet.</td></tr>
              )}
              {techStageMatrix.map((t) => (
                <tr key={t.technician_id || t.name} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 16px', fontSize: 12.5, fontWeight: 600, position: 'sticky', left: 0, background: C.surface, zIndex: 1 }}>{t.name}</td>
                  {STAGE_PERF_LIST.map((def) => {
                    const cell = t.stages?.[def.key] || { assigned: 0, completed: 0 };
                    if (!cell.assigned && !cell.completed) {
                      return <td key={def.key} style={{ padding: '10px 12px', textAlign: 'center', color: C.dim2, fontSize: 12 }}>—</td>;
                    }
                    return (
                      <td key={def.key} style={{ padding: '10px 12px', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                        <CountLink value={cell.assigned} onClick={() => openTechStagePopup(t.name, def, 'assigned')} />
                        <span style={{ color: C.dim2, margin: '0 3px' }}>/</span>
                        <CountLink value={cell.completed} color={C.green} onClick={() => openTechStagePopup(t.name, def, 'completed')} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Technician Summary</h2>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr style={{ background: C.surface2 }}>
                {['Technician', 'Total', 'In Progress', 'Done', 'Pending'].map((h, i) => (
                  <th key={h} style={{ padding: '9px 16px', fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {techAgg.length === 0 && !loading && (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.dim2, fontSize: 13 }}>No technician data for this filter.</td></tr>
              )}
              {techAgg.map((t) => (
                <tr key={t.name} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '10px 16px', fontSize: 12.5, fontWeight: 600 }}>{t.name}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}><CountLink value={t.total} onClick={() => openTechPopup(t.name)} /></td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}><CountLink value={t.inProgress} color={STATUS_COLOR['In Progress']} onClick={() => openTechPopup(t.name, 'inProgress')} /></td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}><CountLink value={t.done} color={STATUS_COLOR.Done} onClick={() => openTechPopup(t.name, 'done')} /></td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}><CountLink value={t.pending} color={STATUS_COLOR.Pending} onClick={() => openTechPopup(t.name, 'pending')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Configuration Summary</h2>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', maxWidth: 420 }}>
          <table>
            <thead>
              <tr style={{ background: C.surface2 }}>
                <th style={{ padding: '9px 16px', fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>Processor</th>
                <th style={{ padding: '9px 16px', fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'right' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {configAgg.map((c) => (
                <tr key={c.label} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 500 }}>{c.label}</td>
                  <td style={{ padding: '9px 16px', textAlign: 'right' }}><CountLink value={c.count} onClick={() => openConfigPopup(c.label)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {popup && (
        <PopupModal
          title={popup.title}
          baseParams={baseParams}
          popupParams={popup.popupParams}
          columns={popup.columns || DEFAULT_POPUP_COLUMNS}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

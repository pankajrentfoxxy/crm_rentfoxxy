import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, X, Cpu, Package, Link2, Truck, ClipboardList,
  Warehouse, ShieldCheck, ShoppingCart, RefreshCw, Calendar,
  ChevronRight, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getSalesOrderReport, getSalesOrderReportDrilldown } from '../reportingApi';
import { SO_SCOPES } from '../../sales-pipeline/salesOrderScope';

const C = {
  bg: '#F4F6F9',
  surface: '#FFFFFF',
  border: '#E3E8EF',
  text: '#111827',
  dim: '#5B6573',
  rental: '#E85D04',
  sale: '#0B9E6A',
  blue: '#2563EB',
  violet: '#7C3AED',
  amber: '#D97706',
  cyan: '#0891B2',
  emerald: '#059669',
  rose: '#E11D48',
};

const PRESETS = [
  { key: 'all', label: 'All (Live)' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'custom', label: 'Custom Range' },
];

const KPI_META = [
  { key: 'ordered', label: 'Laptops Ordered', icon: ShoppingCart, color: C.blue },
  { key: 'attached', label: 'Attached', icon: Link2, color: C.violet },
  { key: 'dispatch_qc', label: 'Dispatch QC Done', icon: ShieldCheck, color: C.emerald },
  { key: 'challan_generated', label: 'DC Generated', icon: FileText, color: C.amber },
  { key: 'in_transit', label: 'In Transit', icon: Truck, color: C.cyan },
  { key: 'delivered', label: 'Delivered', icon: Package, color: C.rose },
];

const TABLE_COLS = [
  { key: 'processor', label: 'Processor', sticky: true },
  { key: 'generation', label: 'Generation', sticky: true },
  { key: 'ordered', label: 'Ordered', bucket: 'ordered', color: C.blue },
  { key: 'attached', label: 'Attached', bucket: 'attached', color: C.violet },
  { key: 'challan_generated', label: 'DC Generated', bucket: 'challan', color: C.amber },
  { key: 'available', label: 'Ready Stock', bucket: 'available', color: C.emerald },
  { key: 'qc_process', label: 'QC1 / QC2', bucket: 'qc', color: '#9333EA' },
  { key: 'dispatched', label: 'Dispatched', bucket: 'dispatched', color: C.cyan },
];

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function CountBtn({ value, color, onClick }) {
  if (!value) return <span style={{ color: C.dim }}>0</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontWeight: 700, fontSize: 14, color, background: `${color}14`,
        border: `1px solid ${color}33`, borderRadius: 8, padding: '4px 10px',
        cursor: 'pointer', minWidth: 36,
      }}
    >
      {value}
    </button>
  );
}

function KpiCard({ meta, value, loading }) {
  const Icon = meta.icon;
  return (
    <div style={{
      background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`,
      padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'center',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 12, background: `${meta.color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color,
      }}
      >
        <Icon size={22} />
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: C.dim, fontWeight: 600 }}>{meta.label}</p>
        <p style={{ margin: '2px 0 0', fontSize: 26, fontWeight: 800, color: C.text }}>
          {loading ? '…' : value}
        </p>
      </div>
    </div>
  );
}

function ConfigTable({ title, accent, rows, scope, filters, onCellClick }) {
  return (
    <div style={{
      background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`,
      overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}
    >
      <div style={{
        padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
        background: `linear-gradient(135deg, ${accent}12, transparent)`,
      }}
      >
        <Cpu size={20} color={accent} />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.text }}>{title}</h3>
        <span style={{
          marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: accent,
          background: `${accent}18`, padding: '4px 10px', borderRadius: 20,
        }}
        >
          {rows.length} config{rows.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {TABLE_COLS.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: col.key === 'processor' || col.key === 'generation' ? 'left' : 'center',
                    padding: '12px 14px', fontWeight: 700, color: C.dim, fontSize: 11,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                    position: col.sticky ? 'sticky' : 'static', left: col.key === 'generation' ? 140 : col.key === 'processor' ? 0 : 'auto',
                    background: '#F8FAFC', zIndex: col.sticky ? 2 : 0,
                    minWidth: col.sticky ? 140 : 90,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLS.length} style={{ padding: 32, textAlign: 'center', color: C.dim }}>
                  No pending pipeline for this scope
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.key} style={{ borderTop: `1px solid ${C.border}` }}>
                {TABLE_COLS.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: '11px 14px',
                      textAlign: col.bucket ? 'center' : 'left',
                      fontWeight: col.sticky ? 600 : 400,
                      position: col.sticky ? 'sticky' : 'static',
                      left: col.key === 'generation' ? 140 : col.key === 'processor' ? 0 : 'auto',
                      background: C.surface, zIndex: col.sticky ? 1 : 0,
                    }}
                  >
                    {col.bucket ? (
                      <CountBtn
                        value={row[col.key]}
                        color={col.color}
                        onClick={() => row[col.key] > 0 && onCellClick({
                          scope, bucket: col.bucket, processor: row.processor, generation: row.generation,
                        })}
                      />
                    ) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DrilldownModal({ open, onClose, title, loading, items, scope }) {
  if (!open) return null;
  const scopeCfg = SO_SCOPES[scope] || SO_SCOPES.rental;

  const linkFor = (item) => {
    if (item.link_type === 'sales_order' && item.sales_order_number) {
      return `${scopeCfg.listPath}/${encodeURIComponent(item.sales_order_number)}`;
    }
    if (item.link_type === 'delivery_challan' && item.dc_number) {
      return `/sales-pipeline/delivery-challans/${encodeURIComponent(item.dc_number)}`;
    }
    if (item.link_type === 'delivery_register' && item.dc_number) {
      return `/sales-pipeline/delivery-register?dc=${encodeURIComponent(item.dc_number)}`;
    }
    if (item.link_type === 'inventory' && item.ttspl_id) {
      return `/inventory-management/serial-number-status?serial=${encodeURIComponent(item.ttspl_id)}`;
    }
    if (item.link_type === 'floor_ticket' && item.ticket_id) {
      return `/floor-pipeline/tickets/${item.ticket_id}`;
    }
    return null;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}
    >
      <div style={{
        background: C.surface, borderRadius: 16, width: 'min(960px, 100%)',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}
        >
          <ClipboardList size={20} color={C.blue} />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={20} color={C.dim} />
          </button>
        </div>
        <div style={{ overflow: 'auto', padding: 16 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.dim }}>
              <Loader2 className="animate-spin inline" size={24} /> Loading…
            </div>
          ) : items.length === 0 ? (
            <p style={{ textAlign: 'center', color: C.dim, padding: 32 }}>No items</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {['ID', 'Config', 'Details', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: C.dim, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const href = linkFor(item);
                  const primary = item.sales_order_number || item.dc_number || item.ttspl_id || item.ticket_id;
                  const config = [item.brand || item.model_name || item.model, item.processor, item.generation, item.ram, item.storage, item.gpu, item.screen_size]
                    .filter(Boolean).join(' · ');
                  const extra = [
                    item.serial_number && `SN: ${item.serial_number}`,
                    item.qc_status && `QC: ${item.qc_status}`,
                    item.dispatch_mode && `Mode: ${item.dispatch_mode}`,
                    item.delivery_person_name && `Assigned: ${item.delivery_person_name}`,
                    item.ticket_stage && `Stage: ${item.ticket_stage}`,
                    item.quantity && `Qty: ${item.quantity}`,
                    item.attached_at && fmtDate(item.attached_at),
                    item.dispatched_at && fmtDate(item.dispatched_at),
                  ].filter(Boolean).join(' · ');

                  return (
                    <tr key={idx} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, fontFamily: 'monospace' }}>{primary || '—'}</td>
                      <td style={{ padding: '10px 12px', maxWidth: 280 }}>{config || '—'}</td>
                      <td style={{ padding: '10px 12px', color: C.dim, fontSize: 11 }}>{extra || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {href ? (
                          <Link
                            to={href}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              color: C.blue, fontWeight: 600, textDecoration: 'none', fontSize: 12,
                            }}
                          >
                            Open <ChevronRight size={14} />
                          </Link>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SalesOrderReportPage() {
  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [drill, setDrill] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillItems, setDrillItems] = useState([]);

  const filters = useMemo(() => {
    const f = { preset };
    if (preset === 'custom') {
      f.from = from;
      f.to = to;
    }
    return f;
  }, [preset, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await getSalesOrderReport(filters);
      if (!res?.success) throw new Error(res?.message || 'Failed to load');
      setData(res);
    } catch (err) {
      toast.error(err.message || 'Could not load report');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const openDrill = async ({ scope, bucket, processor, generation }) => {
    const col = TABLE_COLS.find((c) => c.bucket === bucket);
    setDrill({
      scope,
      bucket,
      processor,
      generation,
      title: `${col?.label || bucket} — ${processor} / ${generation} (${scope === 'sale' ? 'Sale' : 'Rental'})`,
    });
    setDrillLoading(true);
    setDrillItems([]);
    try {
      const { data: res } = await getSalesOrderReportDrilldown({
        ...filters, scope, bucket, processor, generation,
      });
      setDrillItems(res?.items || []);
    } catch (err) {
      toast.error(err.message || 'Could not load details');
    } finally {
      setDrillLoading(false);
    }
  };

  const summary = data?.summary?.combined || {};

  return (
    <div style={{ background: C.bg, minHeight: '100%', padding: '20px 24px 40px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.text, letterSpacing: '-0.02em' }}>
              Sales Order Operations
            </h1>
            <p style={{ margin: '6px 0 0', color: C.dim, fontSize: 14, maxWidth: 560 }}>
              Live warehouse dashboard by processor &amp; generation — orders, attachments, stock, QC, and dispatch pipeline.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface,
              fontWeight: 600, cursor: 'pointer', color: C.dim,
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Date filters */}
        <div style={{
          background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`,
          padding: 16, marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        }}
        >
          <Calendar size={18} color={C.dim} />
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                border: preset === p.key ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                background: preset === p.key ? `${C.blue}10` : C.surface,
                color: preset === p.key ? C.blue : C.dim, cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px' }} />
              <span style={{ color: C.dim }}>to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px' }} />
            </>
          )}
          {data?.generated_at && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.dim }}>
              Updated {fmtDate(data.generated_at)}
            </span>
          )}
        </div>

        {/* KPI row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14, marginBottom: 24,
        }}
        >
          {KPI_META.map((meta) => (
            <KpiCard key={meta.key} meta={meta} value={summary[meta.key] ?? 0} loading={loading} />
          ))}
        </div>

        {/* Pipeline legend */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, fontSize: 12, color: C.dim,
        }}
        >
          <span><Warehouse size={14} style={{ verticalAlign: -2 }} /> Delivered laptops are excluded from pipeline tables</span>
          <span>·</span>
          <span>Click any count to see details and open the record</span>
        </div>

        {/* Tables */}
        <div style={{ display: 'grid', gap: 24 }}>
          <ConfigTable
            title="Rental Orders (Rentfoxxy)"
            accent={C.rental}
            rows={data?.rental?.rows || []}
            scope="rental"
            filters={filters}
            onCellClick={openDrill}
          />
          <ConfigTable
            title="Sale Orders (Gorefurbo)"
            accent={C.sale}
            rows={data?.sale?.rows || []}
            scope="sale"
            filters={filters}
            onCellClick={openDrill}
          />
        </div>
      </div>

      <DrilldownModal
        open={!!drill}
        onClose={() => setDrill(null)}
        title={drill?.title || ''}
        loading={drillLoading}
        items={drillItems}
        scope={drill?.scope || 'rental'}
      />
    </div>
  );
}

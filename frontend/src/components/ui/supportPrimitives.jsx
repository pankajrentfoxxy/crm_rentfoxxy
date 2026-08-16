import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

/* ───────────────────────── Mono ───────────────────────── */
export function Mono({ children, className = '', bold = false }) {
  return (
    <span className={`font-mono tabular-nums tracking-tight ${bold ? 'font-semibold' : ''} ${className}`}>
      {children}
    </span>
  );
}

/* ───────────────────────── Priority ───────────────────── */
export const PRIORITY_META = {
  1: { label: 'Critical', short: 'P1', chip: 'text-pri1 bg-pri1-bg', spine: 'border-pri1' },
  2: { label: 'High',     short: 'P2', chip: 'text-pri2 bg-pri2-bg', spine: 'border-pri2' },
  3: { label: 'Moderate', short: 'P3', chip: 'text-pri3 bg-pri3-bg', spine: 'border-pri3' },
  4: { label: 'Low',      short: 'P4', chip: 'text-pri4 bg-pri4-bg', spine: 'border-pri4' },
};

export function PriorityChip({ priority, showLabel = false }) {
  const m = PRIORITY_META[Number(priority)] || PRIORITY_META[4];
  return (
    <span className={`inline-flex items-center gap-1 h-[19px] px-1.5 rounded font-mono text-[10.5px] font-bold whitespace-nowrap ${m.chip}`}>
      <span className="w-[5px] h-[5px] rounded-full bg-current" />
      {m.short}{showLabel ? ` ${m.label}` : ''}
    </span>
  );
}

export const prioritySpine = (priority) =>
  `border-l-[3px] ${(PRIORITY_META[Number(priority)] || PRIORITY_META[4]).spine}`;

export function PrioritySpine({ priority, className = '' }) {
  return <span className={`${prioritySpine(priority)} ${className}`} />;
}

/* ───────────────────────── SLA chip ────────────────────
   THE signature element. Countdown in mono + a 2.5px depleting bar.
   states: paused | breached | risk(>=75%) | warn(>=50%) | ok
   ------------------------------------------------------- */
export function SlaChip({ dueAt, startedAt, paused = false, className = '' }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused || !dueAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [dueAt, paused]);

  const state = useMemo(() => {
    if (paused) return { key: 'paused', text: '‖ paused', pct: 40 };
    if (!dueAt) return { key: 'none', text: '—', pct: 0 };
    const due = new Date(dueAt).getTime();
    const start = startedAt ? new Date(startedAt).getTime() : due - 24 * 3600 * 1000;
    const total = Math.max(due - start, 1);
    const left = due - now;
    const pct = Math.min(100, Math.max(0, ((total - left) / total) * 100));
    const sign = left < 0 ? '−' : '';
    const abs = Math.abs(left);
    const d = Math.floor(abs / 86400000);
    const h = Math.floor((abs % 86400000) / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    const text = d > 0
      ? `${sign}${d}d ${String(h).padStart(2, '0')}h`
      : `${sign}${h}h ${String(m).padStart(2, '0')}m`;
    if (left < 0) return { key: 'breached', text, pct: 100 };
    if (pct >= 75) return { key: 'risk', text, pct };
    if (pct >= 50) return { key: 'warn', text, pct };
    return { key: 'ok', text, pct };
  }, [dueAt, startedAt, paused, now]);

  const tone = {
    ok:       ['text-sup-ok',    'bg-sup-ok'],
    warn:     ['text-sup-warn',  'bg-sup-warn'],
    risk:     ['text-pri2',      'bg-pri2'],
    breached: ['text-pri1',      'bg-pri1'],
    paused:   ['text-sup-faint', 'bg-sup-faint'],
    none:     ['text-sup-faint', 'bg-sup-faint'],
  }[state.key];

  return (
    <span className={`inline-flex flex-col gap-[3px] min-w-[76px] ${className}`}>
      <span className={`font-mono tabular-nums text-[11.5px] font-semibold tracking-tight ${tone[0]}`}>{state.text}</span>
      <span className="h-[2.5px] rounded-sm bg-sup-canvas2 overflow-hidden">
        <i className={`block h-full rounded-sm ${tone[1]}`} style={{ width: `${state.pct}%` }} />
      </span>
    </span>
  );
}

/* ─────────────────── Classification chain ─────────────── */
export function ClassificationChain({ type, subtype, issue, className = '' }) {
  if (!issue && !type) return <span className="text-sup-faint text-[11.5px]">Not classified</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap text-[11.5px] ${className}`}>
      <span className="text-sup-muted">{type}</span>
      <span className="text-sup-faint text-[9px]">›</span>
      <span className="text-sup-muted">{subtype}</span>
      <span className="text-sup-faint text-[9px]">›</span>
      <span className="text-sup-ink font-semibold">{issue}</span>
    </span>
  );
}

/* ───────────────────────── Modal ───────────────────────── */
export function Modal({ open = true, title, subtitle, onClose, footer, size = 'lg', children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <button type="button" className="fixed inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className={`relative bg-white rounded-xl shadow-supLg w-full ${w} my-8`} role="dialog" aria-modal="true">
        <div className="flex items-start gap-3 px-4 py-3.5 border-b border-sup-lineSoft">
          <div className="flex-1">
            <h3 className="text-[13px] font-semibold text-sup-ink">{title}</h3>
            {subtitle && <p className="text-[11.5px] text-sup-muted mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-sup-canvas2" aria-label="Close">
            <X className="w-4 h-4 text-sup-muted" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-sup-lineSoft bg-sup-canvas rounded-b-xl flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Status / type ───────────────── */
export const TICKET_STATUS_META = {
  NEW:         { label: 'New',         tone: 'bg-sup-canvas2 text-sup-ink2' },
  TRIAGED:     { label: 'Triaged',     tone: 'bg-sup-canvas2 text-sup-ink2' },
  ASSIGNED:    { label: 'Assigned',    tone: 'bg-sup-accentSoft text-sup-accent' },
  IN_PROGRESS: { label: 'In progress', tone: 'bg-pri2-bg text-pri2' },
  PENDING:     { label: 'Pending',     tone: 'bg-white border border-sup-line text-sup-muted' },
  PENDING_PART:{ label: 'Waiting for part', tone: 'bg-pri2-bg text-pri2' },
  RESOLVED:    { label: 'Resolved',    tone: 'bg-sup-okBg text-sup-ok' },
  CLOSED:      { label: 'Closed',      tone: 'bg-sup-canvas2 text-sup-muted' },
  CANCELLED:   { label: 'Cancelled',   tone: 'bg-sup-canvas2 text-sup-faint line-through' },
};

export const WO_STATUS_META = {
  DRAFT: 'Draft',
  PENDING_ASSIGNMENT: 'Pending assignment',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'En route',
  ON_SITE: 'On site',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const WO_TYPE_META = {
  FIELD_VISIT: 'Field visit',
  REPAIR_PICKUP: 'Repair pickup',
  RETURN_PICKUP: 'Return pickup',
  SERVICE_RETURN: 'Service return',
  REPLACEMENT_DELIVERY: 'Replacement delivery',
  PART_DELIVERY: 'Part delivery',
  PART_RETURN: 'Part return',
  REMOTE_FIX: 'Remote fix',
};

const WO_STATUS_TONE = {
  DRAFT: 'bg-sup-canvas2 text-sup-muted',
  PENDING_ASSIGNMENT: 'bg-pri3-bg text-pri3',
  ASSIGNED: 'bg-sup-accentSoft text-sup-accent',
  ACCEPTED: 'bg-sup-accentSoft text-sup-accent',
  EN_ROUTE: 'bg-pri2-bg text-pri2',
  ON_SITE: 'bg-pri2-bg text-pri2',
  IN_PROGRESS: 'bg-pri2-bg text-pri2',
  COMPLETED: 'bg-sup-okBg text-sup-ok',
  FAILED: 'bg-pri1-bg text-pri1',
  CANCELLED: 'bg-sup-canvas2 text-sup-faint line-through',
};

export function StatusPill({ status, kind = 'ticket', pendingReason, className = '' }) {
  const key = String(status || '').toUpperCase();
  if (kind === 'wo') {
    const label = WO_STATUS_META[key] || key || '—';
    const tone = WO_STATUS_TONE[key] || 'bg-sup-canvas2 text-sup-ink2';
    return (
      <span className={`inline-flex items-center h-[19px] px-1.5 rounded text-[10.5px] font-semibold whitespace-nowrap ${tone} ${className}`}>
        {label}
      </span>
    );
  }
  const meta = TICKET_STATUS_META[key] || { label: key || '—', tone: 'bg-sup-canvas2 text-sup-ink2' };
  const reason = key === 'PENDING' && pendingReason
    ? ` · ${String(pendingReason).replace(/^PENDING_/, '').replace(/_/g, ' ').toLowerCase()}`
    : '';
  return (
    <span className={`inline-flex items-center h-[19px] px-1.5 rounded text-[10.5px] font-semibold whitespace-nowrap ${meta.tone} ${className}`}>
      {meta.label}{reason}
    </span>
  );
}

export function TypeTag({ type, className = '' }) {
  const key = String(type || '').toUpperCase();
  const label = WO_TYPE_META[key] || type || '—';
  return (
    <span className={`inline-flex items-center h-[19px] px-1.5 rounded bg-sup-canvas2 text-sup-ink2 text-[10.5px] font-semibold whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

/* ───────────────────────── Timeline ───────────────────── */
export function Timeline({ children, className = '' }) {
  return <ol className={`relative m-0 p-0 list-none space-y-3 ${className}`}>{children}</ol>;
}

export function TimelineItem({ title, meta, children, last = false }) {
  return (
    <li className="relative pl-5">
      <span className="absolute left-0 top-1.5 w-[7px] h-[7px] rounded-full bg-sup-accent ring-2 ring-sup-accentSoft" />
      {!last && <span className="absolute left-[3px] top-3.5 bottom-[-14px] w-px bg-sup-line" />}
      <div className="text-[12px] font-semibold text-sup-ink">{title}</div>
      {meta ? <div className="text-[11px] text-sup-muted font-mono tabular-nums">{meta}</div> : null}
      {children ? <div className="text-[11.5px] text-sup-ink2 mt-0.5">{children}</div> : null}
    </li>
  );
}

/* ───────────────────────── Cards ──────────────────────── */
export function WorkOrderCard({
  woNumber,
  type,
  status,
  priority = 4,
  title,
  subtitle,
  dueAt,
  paused,
  onClick,
  assignee,
  slot,
  documentNumber,
  stepsDone,
  stepsTotal,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl shadow-sup border border-sup-lineSoft ${prioritySpine(priority)} px-3 py-2.5 hover:bg-sup-canvas transition-colors`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <TypeTag type={type} />
            <Mono bold className="text-[12px] text-sup-ink">{woNumber}</Mono>
            <StatusPill kind="wo" status={status} />
            {assignee ? <span className="text-[11px] text-sup-muted">{assignee}</span> : null}
          </div>
          {title ? <div className="text-[12.5px] text-sup-ink mt-1 truncate">{title}</div> : null}
          {subtitle ? <div className="text-[11px] text-sup-muted truncate">{subtitle}</div> : null}
          {slot ? <div className="text-[11px] text-sup-muted">{slot}</div> : null}
        </div>
        <div className="text-right shrink-0">
          {documentNumber ? <Mono className="text-[11px] text-sup-ink2 block">{documentNumber}</Mono> : null}
          {stepsTotal != null ? (
            <div className="text-[11px] text-sup-muted font-mono">{stepsDone || 0} / {stepsTotal} steps</div>
          ) : <SlaChip dueAt={dueAt} paused={paused} />}
        </div>
      </div>
    </button>
  );
}

export function AssetLineCard({ ttsplId, serial, type, subtype, issue, extra }) {
  return (
    <div className="bg-white rounded-xl border border-sup-lineSoft px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <Mono bold className="text-[12px] text-sup-ink">{ttsplId || '—'}</Mono>
        {serial ? <Mono className="text-[11px] text-sup-muted">{serial}</Mono> : null}
      </div>
      <div className="mt-1">
        <ClassificationChain type={type} subtype={subtype} issue={issue} />
      </div>
      {extra ? <div className="text-[11px] text-sup-muted mt-1">{extra}</div> : null}
    </div>
  );
}

/* ───────────────────────── Filters ────────────────────── */
export function FilterBar({ children, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {children}
    </div>
  );
}

export function FilterSelect({ id, label, value, onChange, children, className = '' }) {
  return (
    <label className={`inline-flex flex-col gap-0.5 ${className}`}>
      {label ? <span className="text-[10px] uppercase tracking-wide text-sup-faint font-semibold">{label}</span> : null}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-9 rounded-lg border border-sup-line bg-white px-2 text-[12px] text-sup-ink focus:outline-none focus:ring-2 focus:ring-sup-accent/30"
      >
        {children}
      </select>
    </label>
  );
}

export function ViewChip({ active, children, onClick, count, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[12px] font-semibold border transition-colors
        ${active
          ? 'bg-sup-accent text-white border-sup-accent'
          : 'bg-white text-sup-ink2 border-sup-line hover:bg-sup-canvas'}`}
    >
      {children}
      {count != null ? (
        <span className={`font-mono tabular-nums text-[10.5px] ${danger && Number(count) > 0 && !active ? 'text-pri1' : ''}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

/* ───────────────────────── KPI / divider ──────────────── */
export function KpiTile({ label, value, hint, tone = 'default', onClick }) {
  const tones = {
    default: 'border-sup-lineSoft',
    ok: 'border-sup-ok/30',
    warn: 'border-sup-warn/30',
    danger: 'border-pri1/30',
  };
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sup border ${tones[tone] || tones.default} px-3.5 py-3 text-left w-full`}
    >
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-sup-faint font-semibold">{label}</div>
      <div className="font-mono tabular-nums text-[22px] font-bold text-sup-ink tracking-tight mt-0.5">{value}</div>
      {hint ? <div className="text-[11px] text-sup-muted mt-0.5">{hint}</div> : null}
    </Comp>
  );
}

export function SectionDivider({ children, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-[10px] uppercase tracking-[0.12em] text-sup-faint font-semibold whitespace-nowrap">{children}</span>
      <span className="flex-1 h-px bg-sup-lineSoft" />
    </div>
  );
}

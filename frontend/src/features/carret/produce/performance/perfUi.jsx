import React from 'react';
import { Drawer } from '../../../../components/carret';
import { TargetMeter } from './perfShared';

/**
 * Floor performance — the page's visual pieces. One colour per meaning
 * everywhere (styles/carret.css "Floor performance: colour system"):
 * blue = volume, green = correct / passed, red = failed / missed,
 * amber = waiting, violet = rates, teal = targets. Every coloured mark also
 * carries a word or number, so colour is never the only signal.
 */

/** A metric card: tone, icon, label, the number, one short line, optional bar. */
export function KpiCard({ tone = 'blue', icon: Icon, label, value, unit, sub, progress, title }) {
  return (
    <div className={`c-pf-kpi t-${tone}`} title={title}>
      <div className="c-pf-kpi-h">
        {Icon && <span className="c-pf-kpi-i" aria-hidden="true"><Icon size={16} /></span>}
        {label}
      </div>
      <div className="c-pf-kpi-v">{value}{unit ? <small>{unit}</small> : null}</div>
      {progress != null && (
        <div className="c-prog" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>
      )}
      {sub && <div className="c-pf-kpi-s">{sub}</div>}
    </div>
  );
}

/** A boxed section with a compact header: title, count pill, right-side actions. */
export function Card({ title, count, right, children, bodyPad = false }) {
  return (
    <section className="c-pf-card">
      <header className="c-pf-card-h">
        <h3>{title}</h3>
        {count != null && <span className="c-pf-count">{count}</span>}
        {right && <div className="c-pf-right">{right}</div>}
      </header>
      {bodyPad ? <div className="c-pf-card-b">{children}</div> : children}
    </section>
  );
}

const AVATAR_TONES = ['blue', 'violet', 'teal'];
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Name with an initials avatar and one short line under it. */
export function Who({ id, name, sub }) {
  const tone = AVATAR_TONES[Math.abs(Number(id) || 0) % AVATAR_TONES.length];
  return (
    <span className="c-pf-who">
      <span className={`c-pf-av t-${tone}`} aria-hidden="true">{initials(name)}</span>
      <span className="min-w-0"><b>{name}</b>{sub && <small>{sub}</small>}</span>
    </span>
  );
}

/** A number in its meaning's colour; zero is muted. */
export function Num({ value, tone }) {
  const n = Number(value) || 0;
  return <span className={`c-pf-num${n ? (tone ? ` t-${tone}` : '') : ' is-zero'}`}>{n.toLocaleString('en-IN')}</span>;
}

/** Above / on / below target, and the incentive, as coloured pills. */
export function StandingPills({ standing, eligible, provisional }) {
  const key = standing?.key;
  const tone = key === 'above' || key === 'on' ? 'green' : key === 'below' ? 'red' : null;
  const short = key === 'above' ? `▲ +${standing.label.replace(/\D+/g, '')}`
    : key === 'below' ? `▼ −${standing.label.replace(/\D+/g, '')}`
      : key === 'on' ? '● On target' : 'No target';
  return (
    <span className="inline-flex flex-wrap items-center" style={{ gap: '6px' }}>
      <span className={`c-pf-pill${tone ? ` t-${tone}` : ''}`} title={standing?.label} style={tone ? undefined : { background: 'var(--surface-3)', color: 'var(--ink-3)' }}>{short}</span>
      {eligible && <span className={`c-pf-pill t-${provisional ? 'amber' : 'teal'}`}>{provisional ? 'Incentive · pending QC' : '★ Incentive'}</span>}
    </span>
  );
}

/** "43 / 60" with the meter and the standing pills under it. */
export function TargetCell({ correct, target, bad, pending, standing, eligible, provisional }) {
  return (
    <div className="c-pf-prog">
      <span className="c-pf-corr"><b>{correct}</b>{target ? <span> / {target}</span> : null}</span>
      {target > 0 && <TargetMeter correct={correct} failed={bad} awaiting={pending} target={target} />}
      <StandingPills standing={standing} eligible={eligible} provisional={provisional} />
    </div>
  );
}

/** "How it's counted" — the definitions, out of the way until asked for. */
export function HowDrawer({ open, onClose, items = [] }) {
  return (
    <Drawer open={open} onClose={onClose} title="How it's counted" width="30rem">
      <dl className="c-pf-how" style={{ margin: 0 }}>
        {items.map(([k, v]) => (
          <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
        ))}
      </dl>
    </Drawer>
  );
}

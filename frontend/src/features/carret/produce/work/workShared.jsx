/**
 * Shared pieces of the floor's stage forms (Production → a ticket → Work).
 *
 * Every form reads its questions from the server (GET /tickets/floor-checklists)
 * — the same definitions the server checks the submission against — so what
 * the technician sees and what the server accepts cannot drift apart.
 */
import React, { useEffect, useState } from 'react';
import api from '../../../../utils/api';
import { Input } from '../../../../components/carret';

let cached = null;
export function useFloorChecklists() {
  const [data, setData] = useState(cached);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (cached) return;
    api.get('/tickets/floor-checklists')
      .then(({ data: d }) => { cached = d; setData(d); })
      .catch((e) => setError(e?.response?.data?.message || 'Could not load the checklist'));
  }, []);
  return { data, error };
}

const GLYPH = { good: '✓', bad: '✕', info: '●', na: '–' };

/** One question and its answers (single choice). */
export function Question({ item, value, onChange, open }) {
  return (
    <div className={`c-q${open && !value ? ' is-open' : ''}`}>
      <div className="c-q-t">
        {item.q}
        {item.hint && <small>{item.hint}</small>}
      </div>
      <div className="c-ans" role="radiogroup" aria-label={item.q}>
        {item.options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={`t-${o.tone}${on ? ' is-on' : ''}`}
              onClick={() => onChange(item.key, o.value)}
            >
              {on && <span aria-hidden="true">{GLYPH[o.tone] || '●'}</span>}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The first group with an unanswered question — the one that opens by itself. */
export function firstOpenSection(sections = [], answers = {}) {
  const s = sections.find((sec) => sec.items.some((it) => answers[it.key] == null || answers[it.key] === ''));
  return s ? s.key : null;
}

/**
 * A titled group of questions with its own "answered / problems" count. It
 * folds: only the first unfinished group (focused) opens by itself, and the
 * next one opens as it is completed; any group opens on a click. "Show what's
 * open" (showOpen) opens every group with a gap.
 */
export function QuestionSection({ section, answers, onChange, showOpen, focused = true }) {
  const total = section.items.length;
  const answered = section.items.filter((it) => answers[it.key] != null && answers[it.key] !== '').length;
  const bad = section.items.filter((it) => it.options.some((o) => o.tone === 'bad' && o.value === answers[it.key])).length;
  const complete = answered === total;
  const [manual, setManual] = useState(null); // null = follow completeness
  const open = showOpen && !complete ? true : (manual ?? (!complete && focused));
  return (
    <div className={`c-qsec${complete ? ' is-done' : ''}${bad ? ' has-bad' : ''}`}>
      <button type="button" className="c-qsec-h c-qsec-toggle" aria-expanded={open} onClick={() => setManual(!open)}>
        <span className="c-qsec-mark" aria-hidden="true">{complete ? (bad ? '!' : '✓') : ''}</span>
        <span className="min-w-0">{section.title}</span>
        <small className={bad ? 'is-bad' : ''}>
          {bad ? `${bad} problem${bad > 1 ? 's' : ''} · ` : ''}{answered}/{total}
        </small>
        <span className="c-qsec-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      <div className="c-prog c-prog-thin" aria-hidden="true"><span style={{ width: `${total ? Math.round((answered / total) * 100) : 0}%` }} /></div>
      {open && (
        <>
          {section.hint && <div className="c-qsec-hint">{section.hint}</div>}
          {section.items.map((it) => <Question key={it.key} item={it} value={answers[it.key]} onChange={onChange} open={showOpen} />)}
        </>
      )}
    </div>
  );
}

/* ── The stage work layout ──────────────────────────────────────────────
 * Every stage form (Diagnosis, the repair stages, QC) is the same shape:
 * numbered step cards on the left, and a pinned panel on the right saying
 * what this stage is for, where the laptop goes next, what is still needed,
 * and the submit button. On a phone the panel drops below as a sticky bar.
 */

/** One numbered step. state: 'done' | 'current' | 'todo' | 'locked'. */
export function WorkStep({ n, title, state = 'current', summary, lockedText, children }) {
  return (
    <section className={`c-wstep is-${state}`} aria-label={`Step ${n}: ${title}`}>
      <header className="c-wstep-h">
        <span className="c-wstep-n" aria-hidden="true">{state === 'done' ? '✓' : n}</span>
        <span className="c-wstep-t">
          <span className="c-wstep-k">Step {n}</span>
          {title}
        </span>
        {summary && <span className="c-wstep-s">{summary}</span>}
      </header>
      <div className="c-wstep-b">
        {state === 'locked' ? <p className="text-ink-3" style={{ margin: 0 }}>{lockedText || 'Finish the step above first.'}</p> : children}
      </div>
    </section>
  );
}

/**
 * The pinned "this stage" panel.
 *   checks: [{ label, ok }] — every requirement, ticked or not (not just the gaps)
 *   facts:  [{ label, value, tone? }] — short counts (faults, parts, grade…)
 *   after:  where the laptop goes when this is submitted
 */
export function WorkSummary({ stage, goal, after, afterTone, checks = [], facts = [], children }) {
  const done = checks.filter((c) => c.ok).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 100;
  return (
    <aside className="c-wsum" aria-label={`${stage} summary`}>
      <div className="c-wsum-k">This stage</div>
      <div className="c-wsum-t">{stage}</div>
      {goal && <p className="c-wsum-goal">{goal}</p>}
      {checks.length > 0 && (
        <>
          <div className="c-wsum-row"><span>Ready to submit</span><b>{done}/{checks.length}</b></div>
          <div className="c-prog" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          <ul className="c-wsum-list">
            {checks.map((c) => <li key={c.label} className={c.ok ? 'is-ok' : ''}><span aria-hidden="true">{c.ok ? '✓' : '○'}</span>{c.label}</li>)}
          </ul>
        </>
      )}
      {facts.length > 0 && (
        <dl className="c-wsum-facts">
          {facts.map((f) => (
            <div key={f.label}><dt>{f.label}</dt><dd className={f.tone ? `is-${f.tone}` : ''}>{f.value}</dd></div>
          ))}
        </dl>
      )}
      {after && <div className={`c-wsum-after${afterTone ? ` is-${afterTone}` : ''}`}><span>Next</span>{after}</div>}
      <div className="c-wsum-act">{children}</div>
    </aside>
  );
}

/** Steps on the left, the summary panel on the right. */
export function WorkLayout({ intro, summary, children }) {
  return (
    <div className="c-work">
      <div className="c-work-main">
        {intro}
        {children}
      </div>
      {summary}
    </div>
  );
}

/** Pick one of a few outcomes. options: [{ value, label, hint?, disabled?, why? }] */
export function Choice({ options, value, onChange, name }) {
  return (
    <div className="c-choice" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className={`${value === o.value ? 'is-on' : ''}${o.disabled ? ' is-off' : ''}`}>
          <input type="radio" name={name} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <span>
            {o.label}
            {(o.disabled && o.why) ? <small>{o.why}</small> : o.hint ? <small>{o.hint}</small> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function StepHead({ n, of, children }) {
  return <div className="c-steps-h"><b>Step {n}{of ? ` of ${of}` : ''}</b>{children}</div>;
}

export const errText = (e, fallback = 'That did not work.') => {
  const d = e?.response?.data;
  return d?.message || e?.message || fallback;
};

/**
 * TTSPL scan box. Asset codes are TTSPL + 4 digits (TTSPL7708, 9 characters)
 * or TTSPLGR + 4 digits for gorefurbo (11). The box takes at most 11 — or the
 * length of this laptop's own code when an older one is longer
 * (TTSPL6271_OLD_3380) — upper-cased, no spaces, so a scanner that sends
 * extra characters cannot overflow it.
 */
export const TTSPL_MAX = 11;
export function TtsplInput({ value, onChange, expected, className = '', ...rest }) {
  const max = Math.max(TTSPL_MAX, String(expected || '').length);
  return (
    <Input
      {...rest}
      value={value}
      maxLength={max}
      onChange={(e) => onChange(String(e.target.value || '').toUpperCase().replace(/\s+/g, '').slice(0, max))}
      className={`font-mono ${className}`}
      placeholder={rest.placeholder || 'TTSPL0000'}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

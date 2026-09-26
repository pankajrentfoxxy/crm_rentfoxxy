/**
 * Shared pieces of the floor's stage forms (Production → a ticket → Work).
 *
 * Every form reads its questions from the server (GET /tickets/floor-checklists)
 * — the same definitions the server checks the submission against — so what
 * the technician sees and what the server accepts cannot drift apart.
 */
import React, { useEffect, useState } from 'react';
import api from '../../../../utils/api';

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

/** A titled group of questions with its own "answered / problems" count. */
export function QuestionSection({ section, answers, onChange, showOpen }) {
  const answered = section.items.filter((it) => answers[it.key] != null && answers[it.key] !== '').length;
  const bad = section.items.filter((it) => it.options.some((o) => o.tone === 'bad' && o.value === answers[it.key])).length;
  return (
    <div className="c-qsec">
      <div className="c-qsec-h">
        {section.title}
        <small className={bad ? 'is-bad' : ''}>
          {bad ? `${bad} problem${bad > 1 ? 's' : ''} · ` : ''}{answered}/{section.items.length}
        </small>
      </div>
      {section.hint && <div className="c-qsec-hint">{section.hint}</div>}
      {section.items.map((it) => <Question key={it.key} item={it} value={answers[it.key]} onChange={onChange} open={showOpen} />)}
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

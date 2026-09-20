import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Floor density. Built here, used by the gate in Part 3.
 *
 * The scanner input holds focus at all times — a guard with a wedge scanner has
 * no keyboard and no mouse, and an input that loses focus means the next scan
 * goes nowhere. Refocusing on every blur is deliberate, not a bug.
 *
 * expected: [{ code, label }]
 */
export default function ScanPanel({ expected = [], onScan, title = 'Scan units', className = '' }) {
  const inputRef = useRef(null);
  const [buffer, setBuffer] = useState('');
  const [scanned, setScanned] = useState([]);
  const [lastResult, setLastResult] = useState(null);

  const hold = useCallback(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { hold(); }, [hold]);

  const submit = useCallback((raw) => {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    const match = expected.find((e) => String(e.code).toUpperCase() === code);
    const already = scanned.includes(code);
    const result = already ? 'duplicate' : match ? 'matched' : 'unexpected';
    if (result === 'matched') setScanned((s) => [...s, code]);
    setLastResult({ code, result });
    setBuffer('');
    onScan?.({ code, result, match });
  }, [expected, scanned, onScan]);

  const matchedCount = scanned.length;
  const tone = lastResult?.result === 'matched' ? 'good' : lastResult?.result === 'duplicate' ? 'warn' : 'crit';

  return (
    <div className={`bg-surface border border-rule ${className}`} style={{ padding: 'var(--d-pad-x)', borderRadius: 'var(--d-radius)' }}>
      <div className="flex items-baseline" style={{ gap: 'var(--d-pad-x)' }}>
        <h2 className="text-ink font-ui m-0" style={{ fontSize: 'var(--d-lg)', fontWeight: 600 }}>{title}</h2>
        <span className="ml-auto font-mono tabular-nums text-ink-2" style={{ fontSize: 'var(--d-base)' }}>
          {matchedCount} / {expected.length}
        </span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(buffer); }} style={{ marginTop: 'var(--d-pad-x)' }}>
        <input
          ref={inputRef}
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          onBlur={hold}
          autoFocus
          autoComplete="off"
          spellCheck="false"
          placeholder="Scan or type a TTSPL code"
          aria-label="Scan a unit"
          className="w-full bg-surface-2 border-2 border-rule-2 text-ink font-mono"
          style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'var(--d-tap)', fontSize: 'var(--d-lg)', borderRadius: 'var(--d-radius)' }}
        />
      </form>

      {lastResult && (
        <div
          role="status"
          aria-live="polite"
          className="font-ui"
          style={{
            marginTop: 'var(--d-pad-x)', padding: 'var(--d-pad-y) var(--d-pad-x)',
            borderRadius: 'var(--d-radius)', fontSize: 'var(--d-base)',
            color: `var(--alert-${tone})`, border: `1px solid var(--alert-${tone})`,
          }}
        >
          {lastResult.result === 'matched' && `✓ ${lastResult.code} matched`}
          {lastResult.result === 'duplicate' && `⚠ ${lastResult.code} already scanned`}
          {lastResult.result === 'unexpected' && `✕ ${lastResult.code} is not on this challan`}
        </div>
      )}

      <ul className="list-none p-0" style={{ marginTop: 'var(--d-pad-x)' }}>
        {expected.map((e) => {
          const done = scanned.includes(String(e.code).toUpperCase());
          return (
            <li
              key={e.code}
              className="flex items-center border-b border-rule-2 font-ui"
              style={{ gap: 'var(--d-pad-x)', height: 'var(--d-row)', fontSize: 'var(--d-base)' }}
            >
              <span aria-hidden="true" style={{ color: done ? 'var(--alert-good)' : 'var(--ink-3)' }}>
                {done ? '✓' : '○'}
              </span>
              <span className="font-mono text-ink">{e.code}</span>
              <span className="text-ink-3 truncate">{e.label}</span>
              <span className="ml-auto text-ink-3" style={{ fontSize: 'var(--d-sm)' }}>{done ? 'scanned' : 'expected'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

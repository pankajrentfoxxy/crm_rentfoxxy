import React, { useEffect, useRef, useCallback } from 'react';

/** Focus trap, Esc closes, focus returns to whatever opened it. */
function useDialogBehaviour(open, onClose) {
  const ref = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement;

    const node = ref.current;
    const focusables = () => Array.from(
      node?.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])') || []
    );
    focusables()[0]?.focus() ?? node?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Returning focus is the half everyone forgets; without it a keyboard
      // user lands back at the top of the document every time.
      if (returnTo.current?.focus) returnTo.current.focus();
    };
  }, [open, onClose]);

  return ref;
}

export default function Drawer({ open, onClose, title, children, footer, width = '32rem' }) {
  const ref = useDialogBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <div
        className="absolute inset-0"
        style={{ background: 'var(--surface-sunk)', opacity: 0.6 }}
        onClick={onClose}
      />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative h-full bg-surface border-l border-rule flex flex-col"
        style={{ width: `min(${width}, 100vw)` }}
      >
        <header className="flex items-center border-b border-rule" style={{ gap: 'var(--d-pad-x)', padding: 'var(--d-pad-x)' }}>
          <h2 className="text-ink font-ui m-0" style={{ fontSize: 'var(--d-lg)', fontWeight: 600 }}>{title}</h2>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="ml-auto bg-transparent border-0 text-ink-2 cursor-pointer font-ui"
            style={{ minHeight: 'var(--d-tap)', minWidth: 'var(--d-tap)', fontSize: 'var(--d-lg)' }}
          >
            {'×'}
          </button>
        </header>
        <div className="flex-1 overflow-y-auto" style={{ padding: 'var(--d-pad-x)' }}>{children}</div>
        {footer && <footer className="border-t border-rule" style={{ padding: 'var(--d-pad-x)' }}>{footer}</footer>}
      </aside>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', tone = 'crit' }) {
  const ref = useDialogBehaviour(open, onClose);
  const confirm = useCallback(() => { onConfirm?.(); onClose?.(); }, [onConfirm, onClose]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="presentation" style={{ padding: 'var(--d-pad-x)' }}>
      <div className="absolute inset-0" style={{ background: 'var(--surface-sunk)', opacity: 0.6 }} onClick={onClose} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative bg-surface border border-rule"
        style={{ width: 'min(28rem, 100%)', borderRadius: 'var(--d-radius)', padding: 'var(--d-pad-x)' }}
      >
        <h2 className="text-ink font-ui m-0" style={{ fontSize: 'var(--d-lg)', fontWeight: 600 }}>{title}</h2>
        {body && <p className="text-ink-2 font-ui" style={{ fontSize: 'var(--d-base)', marginTop: 'var(--d-gap)' }}>{body}</p>}
        <div className="flex justify-end" style={{ gap: 'var(--d-gap)', marginTop: 'var(--d-pad-x)' }}>
          <button
            type="button" onClick={onClose}
            className="font-ui bg-surface-2 border border-rule text-ink cursor-pointer"
            style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'var(--d-tap)', borderRadius: 'var(--d-radius)', fontSize: 'var(--d-base)' }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={confirm}
            className="font-ui cursor-pointer border"
            style={{
              padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'var(--d-tap)',
              borderRadius: 'var(--d-radius)', fontSize: 'var(--d-base)',
              background: `var(--alert-${tone})`, borderColor: `var(--alert-${tone})`, color: 'var(--ink-inverse)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

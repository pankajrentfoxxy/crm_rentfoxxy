/**
 * Copy text on both HTTPS and plain HTTP.
 * navigator.clipboard is blocked on http:// host:port pages (no secure context).
 */
export async function copyToClipboard(text) {
  const value = String(text ?? '');
  if (!value) {
    throw new Error('Nothing to copy');
  }

  if (
    typeof navigator !== 'undefined'
    && window.isSecureContext
    && navigator.clipboard
    && typeof navigator.clipboard.writeText === 'function'
  ) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const el = document.createElement('textarea');
  el.value = value;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.padding = '0';
  el.style.border = 'none';
  el.style.outline = 'none';
  el.style.boxShadow = 'none';
  el.style.background = 'transparent';
  document.body.appendChild(el);
  el.focus();
  el.select();
  el.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    document.body.removeChild(el);
  }
  if (!ok) {
    throw new Error('Copy failed');
  }
}

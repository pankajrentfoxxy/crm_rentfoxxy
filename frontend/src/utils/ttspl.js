const TTSPL_PREFIX = 'TTSPL';
const TTSPL_PAD = 4;

export function formatTtspl(num) {
  return `${TTSPL_PREFIX}${String(num).padStart(TTSPL_PAD, '0')}`;
}

export function parseTtsplNum(code) {
  const m = String(code || '').match(/^TTSPL(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/** Accept TTSPL3424, tttspl3424, 3424, etc. */
export function normalizeTtsplSearchInput(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return '';

  const stripped = code.replace(/[\s\-_]/g, '');

  const parsed = parseTtsplNum(stripped);
  if (parsed != null) return formatTtspl(parsed);

  if (/^\d+$/.test(stripped)) {
    const num = Number(stripped);
    if (Number.isFinite(num) && num > 0) return formatTtspl(num);
  }

  const flexMatch = stripped.match(/^T+SPL(\d+)$/i);
  if (flexMatch) {
    const num = Number(flexMatch[1]);
    if (Number.isFinite(num) && num > 0) return formatTtspl(num);
  }

  return stripped;
}

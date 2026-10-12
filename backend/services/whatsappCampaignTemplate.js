/**
 * Template variable mapping for WhatsApp campaigns.
 *
 * A campaign stores body_variables as an ordered list; entry i fills template
 * variable {{i+1}}:
 *
 *   [{ source: 'column', key: 'name' },          // {{1}} = the row's Name column
 *    { source: 'column', key: 'ordernumber' },   // {{2}} = the row's OrderNumber column
 *    { source: 'static', value: 'Diwali' }]      // {{3}} = the same text for everyone
 *
 * Column keys are normalised headers (see normalizeHeader), so "Order Number",
 * "order_number" and "ORDERNUMBER" all address the same column.
 */

const MAX_BODY_VARIABLES = 10;
const MAX_VALUE_LENGTH = 500;

function normalizeHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const NAME_HEADERS = new Set(['name', 'fullname', 'customername', 'contactname', 'firstname']);
const MOBILE_HEADERS = new Set([
  'mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'phonenumber',
  'whatsapp', 'whatsappno', 'whatsappnumber', 'contact', 'contactno', 'contactnumber', 'number', 'cell',
]);

/** Normalised header, with every Name / Mobile alias folded onto 'name' / 'mobile'. */
function canonicalColumnKey(value) {
  const key = normalizeHeader(value);
  if (NAME_HEADERS.has(key)) return 'name';
  if (MOBILE_HEADERS.has(key)) return 'mobile';
  return key;
}

/**
 * Meta rejects body parameters containing newlines, tabs or more than four
 * consecutive spaces, so collapse all whitespace. Control characters are dropped.
 */
function sanitizeText(value, maxLength = MAX_VALUE_LENGTH) {
  if (value == null) return '';
  let s = typeof value === 'number' && Number.isFinite(value)
    ? (Number.isInteger(value) ? value.toFixed(0) : String(value))
    : String(value);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, maxLength);
}

/** @returns {{ ok: true, variables: object[] } | { ok: false, error: string }} */
function validateBodyVariables(raw) {
  const list = raw == null ? [{ source: 'column', key: 'name' }] : raw;
  if (!Array.isArray(list)) return { ok: false, error: 'body_variables must be an array' };
  if (list.length > MAX_BODY_VARIABLES) {
    return { ok: false, error: `At most ${MAX_BODY_VARIABLES} template variables are supported` };
  }
  const variables = [];
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i] || {};
    const label = `{{${i + 1}}}`;
    if (v.source === 'column') {
      const key = canonicalColumnKey(v.key);
      if (!key) return { ok: false, error: `${label}: choose a column` };
      variables.push({ source: 'column', key });
    } else if (v.source === 'static') {
      const value = sanitizeText(v.value);
      if (!value) return { ok: false, error: `${label}: fixed text cannot be empty` };
      variables.push({ source: 'static', value });
    } else {
      return { ok: false, error: `${label}: source must be "column" or "static"` };
    }
  }
  return { ok: true, variables };
}

/** Columns a mapping needs that are not in the file. */
function missingColumns(bodyVariables, availableKeys) {
  const have = new Set(availableKeys);
  return (bodyVariables || [])
    .filter((v) => v.source === 'column' && !have.has(v.key))
    .map((v) => v.key);
}

/**
 * Body values for one contact, in template order.
 * @param {object[]} bodyVariables
 * @param {{ name?: string, variables?: object }} contact
 * @returns {{ ok: true, values: string[] } | { ok: false, error: string }}
 */
function buildBodyValues(bodyVariables, contact) {
  const vars = contact?.variables || {};
  const values = [];
  for (let i = 0; i < (bodyVariables || []).length; i += 1) {
    const v = bodyVariables[i];
    let value = '';
    if (v.source === 'static') value = sanitizeText(v.value);
    else if (v.key === 'name') value = sanitizeText(vars.name ?? contact?.name);
    else value = sanitizeText(vars[v.key]);
    if (!value) {
      return { ok: false, error: `Template variable {{${i + 1}}} (${v.source === 'static' ? 'fixed text' : v.key}) is empty` };
    }
    values.push(value);
  }
  return { ok: true, values };
}

/** Fill {{n}} placeholders in the preview body. Unfilled ones are left visible. */
function renderPreview(previewBody, values) {
  const body = String(previewBody || '');
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n) => {
    const v = values[Number(n) - 1];
    return v == null || v === '' ? match : v;
  });
}

module.exports = {
  MAX_BODY_VARIABLES,
  NAME_HEADERS,
  MOBILE_HEADERS,
  normalizeHeader,
  canonicalColumnKey,
  sanitizeText,
  validateBodyVariables,
  missingColumns,
  buildBodyValues,
  renderPreview,
};

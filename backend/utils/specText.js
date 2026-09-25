/**
 * Hardware-spec text shared by the quotation email and the document PDFs.
 */

/**
 * Normalise a spec field, treating a placeholder as "not specified".
 *
 * Sales types "-" in the brand box when a quote is not brand-specific — it is the
 * single most common brand value on file. A dash is a truthy string, so every
 * `filter(Boolean)` and `v === ''` check waved it through and the customer was
 * sent "- — Intel Core i5 - 11th Gen" in the mail body and "- N/A" on the PDF.
 *
 * Only punctuation-only text and the usual n/a spellings are blanked. A real
 * answer such as "Any brand" is a deliberate statement and is left alone.
 */
function cleanSpecValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^[-–—_.\s]+$/.test(text)) return '';
  if (/^(n\.?\/?a\.?|nil|none|null|na)$/i.test(text)) return '';
  return text;
}

/** Join spec parts with `sep`, dropping any that are blank or placeholders. */
function joinSpecParts(parts, sep = ' ') {
  return (parts || []).map(cleanSpecValue).filter(Boolean).join(sep);
}

module.exports = { cleanSpecValue, joinSpecParts };

'use strict';

/**
 * Split a stored BlueDart AWB field that may contain multiple numbers
 * (comma / slash / pipe / semicolon / whitespace separated).
 */
function splitAwbTokens(raw) {
  return [...new Set(
    String(raw || '')
      .split(/[/|,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{8,}$/.test(s))
  )];
}

function joinAwbTokens(tokens) {
  return splitAwbTokens(
    Array.isArray(tokens) ? tokens.join(',') : String(tokens || '')
  ).join(',');
}

module.exports = {
  splitAwbTokens,
  joinAwbTokens,
};

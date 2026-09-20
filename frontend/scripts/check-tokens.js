#!/usr/bin/env node
/**
 * Part 1 rule 7 / acceptance test 1: no colour literal inside the Carret
 * system. Every colour comes from a token in src/styles/carret.css.
 *
 * Scoped to the Carret directories on purpose — the legacy app is full of
 * literals and is not being rewritten in this part. Widen the roots as screens
 * migrate.
 */
const { execSync } = require('child_process');

const ROOTS = ['src/components/carret', 'src/shells'];
// carret.css is the one file allowed to hold literals: it defines the tokens.
// grep -E is POSIX ERE: no (?:) groups, so these are plain alternations.
const PATTERN = '#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\(|(text|bg|border|ring|from|to|via)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}';

const present = ROOTS.filter((r) => { try { require('fs').statSync(r); return true; } catch { return false; } });
if (!present.length) {
  console.log('check-tokens: no Carret directories yet — nothing to check.');
  process.exit(0);
}

let out = '';
try {
  out = execSync(`grep -rEn "${PATTERN}" ${present.join(' ')} || true`, { encoding: 'utf8' });
} catch (e) {
  out = e.stdout || '';
}

const hits = out.split('\n').filter(Boolean);
if (hits.length) {
  console.error('check-tokens: colour literals found inside the Carret system.\n');
  hits.forEach((h) => console.error('  ' + h));
  console.error(`\n${hits.length} violation(s). Use a token from src/styles/carret.css.`);
  process.exit(1);
}
console.log(`check-tokens: clean (${present.join(', ')}).`);

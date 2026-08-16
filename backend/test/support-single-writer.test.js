'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function walkJs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'test') continue;
      walkJs(full, acc);
    } else if (name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

test('only supportTicketStateService writes ticket status', () => {
  const roots = ['controllers', 'services', 'scripts'].map((d) => path.join(__dirname, '..', d));
  const offenders = [];
  for (const root of roots) {
    for (const file of walkJs(root)) {
      if (file.replace(/\\/g, '/').includes('supportTicketStateService.js')) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (!/UPDATE\s+support_tickets_v2/i.test(text)) continue;
      if (/UPDATE\s+support_tickets_v2[\s\S]{0,500}?SET[\s\S]{0,200}?\bstatus\s*=/i.test(text)) {
        offenders.push(path.relative(path.join(__dirname, '..'), file));
      }
    }
  }
  assert.deepStrictEqual(offenders, [], `Direct status writes found:\n${offenders.join('\n')}`);
});

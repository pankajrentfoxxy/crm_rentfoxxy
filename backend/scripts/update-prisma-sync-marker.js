#!/usr/bin/env node
/**
 * Updates the "Last synced migration" marker in schema.prisma after db pull.
 */
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

let max = 0;
for (const f of fs.readdirSync(migrationsDir)) {
  const m = /^(\d+)_/.exec(f);
  if (m) max = Math.max(max, parseInt(m[1], 10));
}

let text = fs.readFileSync(schemaPath, 'utf8');
if (/Last synced migration:/i.test(text)) {
  text = text.replace(/Last synced migration:\s*\d+/i, `Last synced migration: ${max}`);
} else {
  text = `// Prisma schema — read-only mirror. SQL migrations are source of truth.\n// Last synced migration: ${max}\n\n${text}`;
}
fs.writeFileSync(schemaPath, text);
console.log(`Updated schema.prisma sync marker to migration ${max}.`);

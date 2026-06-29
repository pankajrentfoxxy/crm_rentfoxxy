#!/usr/bin/env node
/**
 * Fails if schema.prisma sync marker is behind latest SQL migration number.
 */
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

function latestMigrationNumber() {
  const files = fs.readdirSync(migrationsDir);
  let max = 0;
  for (const f of files) {
    const m = /^(\d+)_/.exec(f);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function syncedMigrationNumber() {
  const text = fs.readFileSync(schemaPath, 'utf8');
  const m = /Last synced migration:\s*(\d+)/i.exec(text);
  return m ? parseInt(m[1], 10) : 0;
}

const latest = latestMigrationNumber();
const synced = syncedMigrationNumber();

if (synced < latest) {
  console.error(
    `Prisma schema drift: schema.prisma marker is ${synced}, latest migration is ${latest}.\n` +
      'Run: npm run prisma:sync (after applying migrations on a reference DB).'
  );
  process.exit(1);
}

console.log(`Prisma sync OK (marker ${synced}, latest migration ${latest}).`);

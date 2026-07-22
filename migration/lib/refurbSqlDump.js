/**
 * Read laptop_refurbishment_backup.sql COPY blocks when live refurb DB is unavailable.
 */
const fs = require('fs');
const path = require('path');

function parseCopyBlock(sqlPath, tableName) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const marker = `COPY public.${tableName} `;
  const start = sql.indexOf(marker);
  if (start < 0) return [];

  const headerEnd = sql.indexOf(' FROM stdin;', start);
  const headerLine = sql.slice(start, headerEnd);
  const headerMatch = headerLine.match(/COPY public\.\w+ \(([^)]+)\)/);
  if (!headerMatch) return [];
  const columns = headerMatch[1].split(',').map((c) => c.trim());

  const dataStart = sql.indexOf('\n', headerEnd) + 1;
  const dataEnd = sql.indexOf('\n\\.\n', dataStart);
  if (dataEnd < 0) return [];
  const block = sql.slice(dataStart, dataEnd);

  const rows = [];
  for (const line of block.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const row = {};
    columns.forEach((col, i) => {
      row[col] = parts[i] === '\\N' ? null : parts[i];
    });
    rows.push(row);
  }
  return rows;
}

function defaultDumpPath() {
  return (
    process.env.REFURB_SQL_DUMP_PATH
    || path.join(__dirname, '..', '..', 'laptop_refurbishment_backup.sql')
  );
}

function createRefurbSqlDumpSource(dumpPath = defaultDumpPath()) {
  if (!fs.existsSync(dumpPath)) {
    throw new Error(`Refurb SQL dump not found: ${dumpPath}`);
  }

  const cache = new Map();
  function load(table) {
    if (!cache.has(table)) cache.set(table, parseCopyBlock(dumpPath, table));
    return cache.get(table);
  }

  return {
    mode: 'sql_dump',
    dumpPath,
    database: path.basename(dumpPath),
    query(sql) {
      const m = String(sql).match(/FROM\s+(\w+)/i);
      const table = m?.[1];
      if (!table) return Promise.resolve([[]]);

      let rows = load(table);
      if (/assigned_user_id\s+IS\s+NOT\s+NULL/i.test(sql)) {
        rows = rows.filter((r) => r.assigned_user_id != null && r.assigned_user_id !== '');
      }
      if (/ORDER BY lead_id/i.test(sql)) {
        rows = [...rows].sort((a, b) => Number(a.lead_id) - Number(b.lead_id));
      }
      if (/ORDER BY user_id/i.test(sql)) {
        rows = [...rows].sort((a, b) => Number(a.user_id) - Number(b.user_id));
      }
      if (/email IS NOT NULL/i.test(sql)) {
        rows = rows.filter((r) => r.email && String(r.email).trim());
      }
      return Promise.resolve([rows]);
    },
    close() {
      return Promise.resolve();
    },
  };
}

module.exports = {
  parseCopyBlock,
  defaultDumpPath,
  createRefurbSqlDumpSource,
};

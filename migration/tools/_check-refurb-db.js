const { Pool } = require('pg');

async function main() {
  const p = new Pool({
    host: 'localhost',
    port: 5433,
    user: 'postgres',
    password: 'password123',
    database: 'postgres',
  });
  const exists = await p.query(
    `SELECT 1 FROM pg_database WHERE datname = 'laptop_refurbishment'`
  );
  console.log('exists', exists.rows.length > 0);
  if (exists.rows.length) {
    const c = new Pool({
      host: 'localhost',
      port: 5433,
      user: 'postgres',
      password: 'password123',
      database: 'laptop_refurbishment',
    });
    const leads = await c.query('SELECT COUNT(*)::int AS c FROM leads').catch(() => ({ rows: [{ c: -1 }] }));
    const tickets = await c.query('SELECT COUNT(*)::int AS c FROM tickets').catch(() => ({ rows: [{ c: -1 }] }));
    console.log('leads', leads.rows[0].c, 'tickets', tickets.rows[0].c);
    await c.end();
  }
  await p.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

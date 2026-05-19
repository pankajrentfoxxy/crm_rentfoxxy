const { Client } = require('pg');

const client = new Client({
  host: '127.0.0.1',
  port: 5433,
  user: 'postgres',
  password: 'xL5o1SZ4kvblM30SnQGobO6YdGVvW',
  database: 'postgres',
  ssl: false,
});

client.connect()
  .then(() => {
    console.log('✅ Database connected successfully');
    return client.end();
  })
  .catch(err => {
    console.error('❌ Connection failed');
    console.error(err);
  });
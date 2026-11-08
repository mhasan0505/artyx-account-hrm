import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const url = process.env.DATABASE_URL.replace('-pooler.', '.');
console.log('Connecting to', url.split('@')[1]);

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false }
});

async function clearLocks() {
  await client.connect();
  console.log('Connected.');
  
  const res = await client.query("SELECT pid, objid FROM pg_locks WHERE locktype = 'advisory' AND objid = 72707369;");
  console.log('Locks found:', res.rows);
  
  for (const row of res.rows) {
    console.log('Killing process', row.pid);
    await client.query("SELECT pg_terminate_backend(" + row.pid + ");");
    console.log('Killed.');
  }
  
  await client.end();
}

clearLocks().catch(console.error);

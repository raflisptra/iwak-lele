const { Pool } = require('pg');

// Konfigurasi koneksi diambil dari file .env, bukan ditulis langsung di source code.
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

pool.on('error', (error) => {
  console.error('Terjadi error pada koneksi idle PostgreSQL:', error.message);
});

module.exports = pool;

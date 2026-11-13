// Usage: SILELE_NEW_PASSWORD=... node scripts/create-user.mjs admin admin
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordHash } from '../auth.mjs';

const username = process.argv[2];
const role = process.argv[3] || 'viewer';
const password = process.env.SILELE_NEW_PASSWORD;
if (!username || !/^[A-Za-z0-9_.-]{3,40}$/.test(username) || !['admin', 'viewer'].includes(role)) {
  console.error('Cara: node scripts/create-user.mjs USERNAME admin|viewer');
  process.exit(1);
}
if (!password) {
  console.error('Isi SILELE_NEW_PASSWORD sementara saat membuat user; password tidak disimpan di .env.');
  process.exit(1);
}
const dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = path.resolve(dirname, process.env.DB_PATH || './data/smartpond.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS silele_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);
try {
  const hash = await passwordHash(password);
  const result = db.prepare('INSERT INTO silele_users(username,password_hash,role) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role').run(username, hash, role);
  console.log(`Akun '${username}' (${role}) siap. ${result.changes} baris diperbarui.`);
} catch (err) {
  console.error('Tidak dapat membuat akun:', err.message);
  process.exitCode = 1;
} finally { db.close(); }

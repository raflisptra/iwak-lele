import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import mqtt from 'mqtt';
import { WebSocketServer } from 'ws';
import { decryptReadings, loadKey } from './crypto.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
if (!process.env.DEVICE_TOKEN || process.env.DEVICE_TOKEN.length < 24) {
  throw new Error('DEVICE_TOKEN belum diisi (minimal 24 karakter).');
}
loadKey();
const DATABASE_FILE = path.resolve(dirname, process.env.DB_PATH || './data/smartpond.sqlite');
fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });
const db = new DatabaseSync(DATABASE_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    protocol TEXT NOT NULL,
    boot_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    encrypted INTEGER NOT NULL,
    temperature_c REAL,
    ph REAL,
    water_level_pct REAL,
    payload_bytes INTEGER NOT NULL,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(node_id, boot_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_samples_node_date ON samples(node_id,id DESC);
`);
const insert = db.prepare(`
  INSERT OR IGNORE INTO samples
  (node_id, protocol, boot_id, seq, encrypted, temperature_c, ph, water_level_pct, payload_bytes)
  VALUES (?,?,?,?,?,?,?,?,?)
`);

const EXPECTED = new Map([
  ['mqtt-01', 'MQTT'],
  ['http-01', 'HTTP'],
  ['ws-01', 'WebSocket'],
]);
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '4kb' }));
app.use('/assets', express.static(path.join(dirname, 'public', 'assets'), { maxAge: '5m' }));
app.get('/', (_, res) => res.sendFile(path.join(dirname, 'public', 'index.html')));
app.get('/health', (_, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

function equalsToken(value) {
  const got = Buffer.from(String(value ?? ''));
  const expected = Buffer.from(process.env.DEVICE_TOKEN);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
function authHttp(req, res, next) {
  if (!equalsToken(req.get('x-device-token'))) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function numericSensor(value, name, min, max) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Data sensor ${name} tidak valid`);
  }
  return value;
}
function ingest(envelope, source, payloadBytes) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('JSON tidak valid');
  const { node_id, protocol, boot_id, seq, encrypted } = envelope;
  if (!EXPECTED.has(node_id) || EXPECTED.get(node_id) !== protocol || protocol !== source) {
    throw new Error('node_id/protocol/source tidak cocok');
  }
  if (!/^[a-f0-9]{16}$/i.test(boot_id ?? '')) throw new Error('boot_id tidak valid');
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('seq tidak valid');
  if (typeof encrypted !== 'boolean') throw new Error('encrypted harus boolean');
  const readings = encrypted ? decryptReadings(envelope) : envelope.data;
  if (!readings || typeof readings !== 'object' || Array.isArray(readings)) throw new Error('data sensor tidak ada');
  const temperature = numericSensor(readings.temperature_c, 'temperature_c', -20, 90);
  const ph = numericSensor(readings.ph, 'ph', 0, 14);
  const water = numericSensor(readings.water_level_pct, 'water_level_pct', 0, 100);
  const result = insert.run(node_id, protocol, boot_id, seq, Number(encrypted), temperature, ph, water, payloadBytes);
  if (result.changes > 0) {
    console.log(`[${new Date().toISOString()}] ${protocol} ${node_id} seq=${seq} AES=${encrypted} ${payloadBytes}B`);
  }
  return { ok: true, duplicate: result.changes === 0, node_id, seq };
}

app.post('/ingest/http', authHttp, (req, res) => {
  try {
    const result = ingest(req.body, 'HTTP', Buffer.byteLength(JSON.stringify(req.body)));
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const selectFields = `id,node_id,protocol,boot_id,seq,encrypted,temperature_c,ph,water_level_pct,payload_bytes,received_at`;
app.get('/api/latest', (_, res) => {
  const rows = db.prepare(`SELECT ${selectFields} FROM samples WHERE id IN
    (SELECT MAX(id) FROM samples GROUP BY node_id) ORDER BY node_id ASC`).all();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ nodes: rows });
});
app.get('/api/history', (req, res) => {
  const nodeId = String(req.query.node_id ?? '');
  if (!EXPECTED.has(nodeId)) return res.status(400).json({ error: 'node_id tidak valid' });
  const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 50));
  const rows = db.prepare(`SELECT ${selectFields} FROM samples WHERE node_id=? ORDER BY id DESC LIMIT ?`).all(nodeId, limit);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ node_id: nodeId, rows });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ingest/ws' || !equalsToken(req.headers['x-device-token'])) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});
wss.on('connection', (ws) => {
  ws.on('message', (raw, isBinary) => {
    try {
      if (isBinary || raw.length > 4096) throw new Error('Hanya JSON text maksimum 4 KB');
      const payload = JSON.parse(raw.toString('utf8'));
      const result = ingest(payload, 'WebSocket', raw.length);
      ws.send(JSON.stringify(result));
    } catch (error) {
      ws.send(JSON.stringify({ ok: false, error: error.message }));
    }
  });
});

const mqttClient = mqtt.connect(process.env.MQTT_URL || 'mqtt://127.0.0.1:1883', {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
  clientId: `smartpond-backend-${crypto.randomBytes(4).toString('hex')}`,
  reconnectPeriod: 2000,
});
mqttClient.on('connect', () => {
  console.log('MQTT backend terhubung ke Mosquitto');
  mqttClient.subscribe('pond/mqtt-01/telemetry', { qos: 0 }, (err) => {
    if (err) console.error('MQTT subscribe gagal:', err.message);
  });
});
mqttClient.on('message', (topic, raw) => {
  try {
    if (topic !== 'pond/mqtt-01/telemetry' || raw.length > 4096) return;
    ingest(JSON.parse(raw.toString('utf8')), 'MQTT', raw.length);
  } catch (error) {
    console.error('MQTT payload ditolak:', error.message);
  }
});
mqttClient.on('error', (error) => console.error('Mosquitto:', error.message));
httpServer.listen(PORT, '0.0.0.0', () => console.log(`Smart Pond backend :${PORT}`));

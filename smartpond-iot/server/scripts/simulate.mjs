import 'dotenv/config';
import crypto from 'node:crypto';
import mqtt from 'mqtt';
import { WebSocket } from 'ws';
import { encryptReadings } from '../crypto.mjs';

const enableAes = process.env.TEST_AES === '1';
const boot_id = crypto.randomBytes(8).toString('hex');
const readings = { temperature_c: 28.2, ph: 7.1, water_level_pct: 63.4 };
const make = (node_id, protocol) => {
  const metadata = { node_id, protocol, boot_id, seq: 1 };
  return enableAes ? encryptReadings(metadata, readings) : { ...metadata, encrypted: false, data: readings };
};

try {
  const response = await fetch('http://127.0.0.1:3000/ingest/http', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': process.env.DEVICE_TOKEN },
    body: JSON.stringify(make('http-01', 'HTTP')),
  });
  console.log('HTTP', response.status, await response.json());

  await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:3000/ingest/ws', {
      headers: { 'X-Device-Token': process.env.DEVICE_TOKEN },
    });
    ws.on('open', () => ws.send(JSON.stringify(make('ws-01', 'WebSocket'))));
    ws.on('message', (data) => { console.log('WebSocket', data.toString()); ws.close(); resolve(); });
    ws.on('error', reject);
  });

  const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://127.0.0.1:1883', {
    username: process.env.TEST_MQTT_USER || 'pbllele',
    password: process.env.TEST_MQTT_PASSWORD,
  });
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
  await new Promise((resolve, reject) => {
    client.publish('pond/mqtt-01/telemetry', JSON.stringify(make('mqtt-01', 'MQTT')), { qos: 0 }, err => err ? reject(err) : resolve());
  });
  console.log('MQTT terkirim (QoS 0; konfirmasi penerimaan cek dashboard/server)');
  await new Promise(resolve => setTimeout(resolve, 500));
  client.end();
} catch (error) {
  console.error('Simulasi gagal:', error);
  process.exitCode = 1;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptReadings, decryptReadings } from '../crypto.mjs';

const testKey = 'a3'.repeat(32);
const meta = { node_id: 'http-01', protocol: 'HTTP', boot_id: 'aabbccddeeff0011', seq: 42 };
const data = { temperature_c: 27.5, ph: null, water_level_pct: 72 };

test('AES-256-GCM round trip', () => {
  const enc = encryptReadings(meta, data, testKey);
  assert.deepEqual(decryptReadings(enc, testKey), data);
});
test('AAD metadata tamper rejection', () => {
  const enc = encryptReadings(meta, data, testKey);
  assert.throws(() => decryptReadings({ ...enc, seq: 43 }, testKey));
});
test('ciphertext tamper rejection', () => {
  const enc = encryptReadings(meta, data, testKey);
  const damaged = { ...enc, ciphertext: `${enc.ciphertext[0] === 'a' ? 'b' : 'a'}${enc.ciphertext.slice(1)}` };
  assert.throws(() => decryptReadings(damaged, testKey));
});

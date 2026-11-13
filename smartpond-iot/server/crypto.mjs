import crypto from 'node:crypto';

export function loadKey(hex = process.env.AES_KEY_HEX) {
  if (!/^[a-f0-9]{64}$/i.test(hex ?? '')) {
    throw new Error('AES_KEY_HEX harus tepat 64 karakter hexadecimal (32 byte)');
  }
  return Buffer.from(hex, 'hex');
}

export function aadOf(payload) {
  return Buffer.from(`${payload.node_id}|${payload.protocol}|${payload.boot_id}|${payload.seq}`, 'utf8');
}

export function decryptReadings(payload, hexKey = process.env.AES_KEY_HEX) {
  if (!/^[a-f0-9]{24}$/i.test(payload.iv ?? '') ||
      !/^[a-f0-9]{32}$/i.test(payload.tag ?? '') ||
      !/^(?:[a-f0-9]{2}){1,1024}$/i.test(payload.ciphertext ?? '')) {
    throw new Error('Envelope AES tidak valid');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(hexKey), Buffer.from(payload.iv, 'hex'));
  decipher.setAAD(aadOf(payload));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  const raw = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(raw);
}

// Digunakan untuk pengujian lokal agar tidak perlu menyambungkan ESP32 terlebih dahulu.
export function encryptReadings(metadata, readings, hexKey = process.env.AES_KEY_HEX) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(hexKey), iv);
  cipher.setAAD(aadOf(metadata));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(readings), 'utf8'),
    cipher.final(),
  ]);
  return {
    ...metadata,
    encrypted: true,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

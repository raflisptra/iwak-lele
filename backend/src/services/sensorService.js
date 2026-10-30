const db = require('../config/db');

const ALLOWED_PROTOCOLS = new Set(['HTTP', 'MQTT', 'WebSocket']);

function createInputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * Mengubah pesan masuk menjadi objek dan memeriksa kolom wajib.
 *
 * Kunci payload yang didukung:
 * - device_id atau node_id
 * - temperature_c
 * - ph_value atau ph
 * - water_level_cm
 * - timestamp atau sensor_timestamp (opsional)
 * - scenario_id (opsional; ID harus sudah ada di tabel test_scenarios)
 *
 * Sesuaikan nama kunci di sini apabila JSON dari ESP32 nanti memakai nama lain.
 */
function parseSensorPayload(rawPayload) {
  let payload;

  try {
    if (Buffer.isBuffer(rawPayload)) {
      payload = JSON.parse(rawPayload.toString('utf8'));
    } else if (typeof rawPayload === 'string') {
      payload = JSON.parse(rawPayload);
    } else {
      // Pada endpoint HTTP, express.json() biasanya sudah mengubah JSON menjadi objek.
      payload = rawPayload;
    }
  } catch (_error) {
    throw createInputError('Payload yang diterima bukan JSON yang valid.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createInputError('Payload harus berupa objek JSON.');
  }

  // Baca ID perangkat. Gunakan salah satu nama kunci ini dari ESP32.
  const deviceId = payload.device_id ?? payload.node_id;
  const temperature = payload.temperature_c;
  const phValue = payload.ph_value ?? payload.ph;
  const waterLevel = payload.water_level_cm;

  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    throw createInputError('Kunci device_id atau node_id harus diisi.');
  }
  if (!Number.isFinite(temperature)) {
    throw createInputError('temperature_c harus berupa angka.');
  }
  if (!Number.isFinite(phValue)) {
    throw createInputError('ph_value atau ph harus berupa angka.');
  }
  if (!Number.isFinite(waterLevel)) {
    throw createInputError('water_level_cm harus berupa angka.');
  }

  // Timestamp dari sensor bersifat opsional. Jika tersedia, pastikan formatnya valid.
  const rawTimestamp = payload.timestamp ?? payload.sensor_timestamp ?? null;
  let sensorTimestamp = null;
  if (rawTimestamp !== null && rawTimestamp !== '') {
    sensorTimestamp = new Date(rawTimestamp);
    if (Number.isNaN(sensorTimestamp.getTime())) {
      throw createInputError('timestamp atau sensor_timestamp bukan waktu yang valid.');
    }
  }

  // scenario_id opsional; jangan kirim ID sebelum skenario dibuat di database.
  let scenarioId = null;
  if (payload.scenario_id !== undefined && payload.scenario_id !== null && payload.scenario_id !== '') {
    scenarioId = Number(payload.scenario_id);
    if (!Number.isSafeInteger(scenarioId) || scenarioId < 1) {
      throw createInputError('scenario_id harus berupa ID bilangan bulat positif.');
    }
  }

  return {
    deviceId: deviceId.trim(),
    temperature,
    phValue,
    waterLevel,
    sensorTimestamp,
    scenarioId,
    // Simpan payload asli dalam kolom JSONB untuk kebutuhan audit/penelusuran.
    rawPayload: payload
  };
}

async function saveSensorReading(rawPayload, protocol) {
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new Error('Protokol penerimaan belum didukung oleh backend.');
  }

  const data = parseSensorPayload(rawPayload);

  // Parameter SQL ($1, $2, ...) menjaga nilai data terpisah dari teks query.
  // Kolom dan urutan parameter harus disesuaikan jika skema database diubah.
  const query = `
    INSERT INTO sensor_readings (
      device_id,
      temperature_c,
      ph_value,
      water_level_cm,
      sensor_timestamp,
      protocol,
      scenario_id,
      raw_payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    RETURNING id, received_at
  `;

  const values = [
    data.deviceId,
    data.temperature,
    data.phValue,
    data.waterLevel,
    data.sensorTimestamp,
    protocol,
    data.scenarioId,
    JSON.stringify(data.rawPayload)
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

async function getSensorReadings(limit = 100) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);

  const result = await db.query(
    `SELECT
       id, device_id, temperature_c, ph_value, water_level_cm,
       sensor_timestamp, received_at, protocol, scenario_id
     FROM sensor_readings
     ORDER BY received_at DESC
     LIMIT $1`,
    [safeLimit]
  );

  return result.rows;
}

module.exports = {
  parseSensorPayload,
  saveSensorReading,
  getSensorReadings
};

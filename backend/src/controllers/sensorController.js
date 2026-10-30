const {
  saveSensorReading,
  getSensorReadings
} = require('../services/sensorService');

async function createHttpReading(req, res) {
  try {
    // req.body berasal dari JSON pada request HTTP, yang diproses oleh express.json().
    const saved = await saveSensorReading(req.body, 'HTTP');
    return res.status(201).json({ success: true, reading: saved });
  } catch (error) {
    console.error('Gagal menyimpan pembacaan HTTP:', error.message);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: status === 400 ? error.message : 'Data gagal disimpan ke database.'
    });
  }
}

async function listReadings(req, res) {
  try {
    const rows = await getSensorReadings(req.query.limit);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Gagal membaca data sensor:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Data sensor gagal dibaca dari database.'
    });
  }
}

module.exports = { createHttpReading, listReadings };

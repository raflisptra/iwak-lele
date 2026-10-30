const express = require('express');
const {
  createHttpReading,
  listReadings
} = require('../controllers/sensorController');

const router = express.Router();

// Endpoint untuk menerima payload JSON dengan protokol HTTP.
router.post('/', createHttpReading);

// Endpoint untuk membaca data yang sudah tersimpan, misalnya dari dashboard.
router.get('/', listReadings);

module.exports = router;

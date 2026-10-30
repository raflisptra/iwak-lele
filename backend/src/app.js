const express = require('express');
const cors = require('cors');
const sensorRoutes = require('./routes/sensorRoutes');

const app = express();

// Jika FRONTEND_ORIGIN kosong, CORS dibuka untuk memudahkan pengembangan lokal.
// Saat deployment, isi FRONTEND_ORIGIN dengan alamat frontend yang benar.
const frontendOrigin = process.env.FRONTEND_ORIGIN;
app.use(cors(frontendOrigin ? { origin: frontendOrigin } : {}));

// Mengubah request HTTP berformat application/json menjadi req.body.
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Backend aktif.' });
});

app.use('/api/sensor-readings', sensorRoutes);

// Menangani request dengan JSON rusak, misalnya tanda kurung/komanya tidak valid.
app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
    return res.status(400).json({
      success: false,
      message: 'Body request bukan JSON yang valid.'
    });
  }

  console.error('Error backend:', error.message);
  return res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan pada backend.'
  });
});

module.exports = app;

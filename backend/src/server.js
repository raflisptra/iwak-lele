require('dotenv').config();

const http = require('http');
const { WebSocketServer } = require('ws');
const app = require('./app');
const db = require('./config/db');
const { saveSensorReading } = require('./services/sensorService');
const { startMqttConsumer } = require('./transports/mqttTransport');

const server = http.createServer(app);

// WebSocket menggunakan server HTTP yang sama, melalui path /ws-sensor.
const webSocketServer = new WebSocketServer({
  server,
  path: '/ws-sensor'
});

webSocketServer.on('connection', (socket) => {
  socket.on('message', async (message, isBinary) => {
    if (isBinary) {
      socket.send(JSON.stringify({
        success: false,
        message: 'Kirim payload sensor sebagai teks JSON, bukan data biner.'
      }));
      return;
    }

    try {
      const saved = await saveSensorReading(message, 'WebSocket');
      socket.send(JSON.stringify({ success: true, reading: saved }));
    } catch (error) {
      console.error('Pesan WebSocket gagal diproses:', error.message);
      socket.send(JSON.stringify({
        success: false,
        message: error.statusCode === 400
          ? error.message
          : 'Data gagal disimpan ke database.'
      }));
    }
  });
});

const port = Number(process.env.PORT || 3000);
const mqttClient = startMqttConsumer();

server.listen(port, () => {
  console.log(`Backend berjalan pada port ${port}.`);
  console.log('Endpoint kesehatan: /api/health');
  console.log('Endpoint HTTP sensor: POST /api/sensor-readings');
  console.log('Endpoint daftar data: GET /api/sensor-readings');
  console.log('Endpoint WebSocket: /ws-sensor');

  // Cek koneksi database setelah server mulai; tidak membuat atau mengisi data sensor.
  db.query('SELECT 1')
    .then(() => console.log('Koneksi PostgreSQL berhasil.'))
    .catch((error) => {
      console.error('Belum dapat terhubung ke PostgreSQL:', error.message);
      console.error('Periksa apakah database sudah dibuat dan konfigurasi .env benar.');
    });
});

function shutdown() {
  if (mqttClient) mqttClient.end(true);
  webSocketServer.close();
  server.close(() => {
    db.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

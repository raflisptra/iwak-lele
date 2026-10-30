const mqtt = require('mqtt');
const { saveSensorReading } = require('../services/sensorService');

function startMqttConsumer() {
  const brokerUrl = process.env.MQTT_URL;
  const topic = process.env.MQTT_TOPIC;

  // Jangan membuat koneksi ke broker sebelum alamat dan topik yang sebenarnya disiapkan.
  if (!brokerUrl || !topic) {
    console.log('MQTT belum diaktifkan: isi MQTT_URL dan MQTT_TOPIC pada file .env.');
    return null;
  }

  const client = mqtt.connect(brokerUrl);

  client.on('connect', () => {
    client.subscribe(topic, (error) => {
      if (error) {
        console.error('Gagal subscribe topik MQTT:', error.message);
        return;
      }
      console.log('MQTT siap menerima pesan pada topik yang dikonfigurasi.');
    });
  });

  client.on('message', async (receivedTopic, message) => {
    try {
      // Message MQTT diterima sebagai Buffer; service akan mem-parsing JSON-nya.
      const saved = await saveSensorReading(message, 'MQTT');
      console.log('Pesan MQTT tersimpan dengan ID:', saved.id);
    } catch (error) {
      console.error('Pesan MQTT gagal diproses:', error.message);
    }
  });

  client.on('error', (error) => {
    console.error('Koneksi MQTT mengalami error:', error.message);
  });

  return client;
}

module.exports = { startMqttConsumer };

# Backend Node.js — PBL Monitoring Kolam Lele

Folder ini adalah backend dan terpisah dari frontend yang sudah ada di folder `PBL/css`, `PBL/js`, dan `PBL/index.html`.

## Komponen

- `src/server.js`: menjalankan server HTTP dan WebSocket serta mengaktifkan penerima MQTT jika dikonfigurasi.
- `src/app.js`: middleware dan route API HTTP.
- `src/routes/` dan `src/controllers/`: endpoint dan logika request HTTP.
- `src/services/sensorService.js`: tempat payload JSON dibaca, divalidasi, lalu disimpan ke PostgreSQL.
- `src/config/db.js`: konfigurasi koneksi PostgreSQL.
- `src/transports/mqttTransport.js`: penerima pesan MQTT.
- `.env.example`: daftar konfigurasi yang perlu diisi pada komputer lokal.

## Instalasi

1. Pastikan Node.js dan PostgreSQL Server sudah terpasang.
2. Buka terminal pada folder `backend`.
3. Jalankan `npm install`.
4. Salin `.env.example` menjadi `.env`.
5. Isi nilai `PGDATABASE`, `PGUSER`, dan `PGPASSWORD` sesuai konfigurasi PostgreSQL lokal. Jangan bagikan `.env`.
6. Buat database bernama `monitoring_lele` jika belum ada. Setelah itu buka database tersebut di pgAdmin dan jalankan isi file `../database/schema.sql` melalui Query Tool.
7. Jalankan `npm run dev` dari folder `backend`.

## Endpoint

- `GET /api/health`: memeriksa apakah server aktif.
- `POST /api/sensor-readings`: menerima JSON melalui HTTP.
- `GET /api/sensor-readings?limit=100`: membaca data sensor terbaru yang sudah tersimpan. Nilai `limit` dibatasi maksimal 500.
- `ws://localhost:3000/ws-sensor`: menerima pesan teks JSON melalui WebSocket.
- MQTT: diaktifkan hanya setelah `MQTT_URL` dan `MQTT_TOPIC` diisi pada `.env`.

## Bentuk payload yang diharapkan

Sesuaikan nama kunci JSON yang dikirim ESP32 dengan kebutuhan berikut. Nilai pembacaan tidak ditentukan di template ini karena data sensor sebenarnya belum tersedia.

- `device_id` atau `node_id`: identitas perangkat, berupa teks.
- `temperature_c`: pembacaan sensor suhu, berupa angka.
- `ph_value` atau `ph`: pembacaan sensor pH, berupa angka.
- `water_level_cm`: pembacaan ketinggian air, berupa angka.
- `timestamp` atau `sensor_timestamp`: waktu pembacaan (opsional).
- `scenario_id`: ID pada tabel `test_scenarios` (opsional; harus sudah ada apabila diisi).

Jika nama kunci dari firmware ESP32 berbeda, ubah bagian `parseSensorPayload()` di `src/services/sensorService.js`. Kolom `protocol` tidak perlu dikirim dari ESP32: backend menetapkannya berdasarkan jalur penerimaan HTTP, MQTT, atau WebSocket.

## Catatan database dan pengujian

File `../database/schema.sql` hanya membuat tabel dan indeks, tanpa `INSERT` data dummy. `sensor_readings` menyimpan nilai sensor; `test_scenarios` disediakan untuk mencatat skenario pengujian; `qos_results` disiapkan untuk hasil analisis PCAP. Template backend ini belum menghitung throughput, delay, jitter, packet loss, response time, goodput, atau protocol overhead. Metrik tersebut tetap perlu dianalisis dari hasil pengujian jaringan dan PCAP, lalu hasil finalnya dapat dicatat ke `qos_results`.

Untuk menjalankan dashboard dari origin/port berbeda, isi `FRONTEND_ORIGIN` pada `.env` dengan origin frontend yang benar. Saat deployment, batasi CORS hanya untuk domain frontend yang dipercaya.

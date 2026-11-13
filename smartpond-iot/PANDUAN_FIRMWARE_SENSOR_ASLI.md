# Integrasi Pembacaan Sensor Asli (berdasarkan sketch kelompok)

## Ringkasan

Firmware MQTT, HTTP dan WebSocket tetap mengirim JSON lewat transport yang sama ke backend Node.js + SQLite + dashboard SiLele yang sudah berjalan. Yang diubah hanya logika `readSensors()` di `SmartPondShared.h`, konfigurasi sensor dan timestamp NTP.

**Tidak perlu mengganti `server.mjs`, database, MQTT broker, atau file dashboard di server. Jangan menyalin ulang konfigurasi Mosquitto dari ZIP ini karena pada `server-lele` listener port 1883 dan 8883 sudah disesuaikan sebelumnya.**

## Arduino IDE: file yang dipakai

- ESP32 #1: `firmware/esp32_mqtt/esp32_mqtt.ino`
- ESP32 #2: `firmware/esp32_http/esp32_http.ino`
- ESP32 #3: `firmware/esp32_websocket/esp32_websocket.ino`

Setiap folder punya `SmartPondShared.h` dan `secrets.example.h`. Salin `secrets.example.h` menjadi `secrets.h` **pada masing-masing folder** sebelum mengompilasi. Pastikan ketiga file ada dalam satu folder sketch. Jangan upload `SmartPondShared.h` secara terpisah.

Library: ArduinoJson 7.x, OneWire, DallasTemperature; PubSubClient untuk MQTT, WebSockets (Markus Sattler) untuk WebSocket. Gunakan ESP32 Dev Module (ESP32 klasik/WROOM-32), Arduino-ESP32 3.x, USB data dan COM port benar.

## Konfigurasi K1 tanpa Raspberry Pi

`SIMULATE_SENSORS 0`, `DEFAULT_USE_AES false`, `SEND_INTERVAL_MS 5000UL`; ubah `SERVER_IP` ke IP lokal Ubuntu Server. ESP32 masuk Wi-Fi 2,4 GHz yang punya rute langsung ke server, tidak harus 1 subnet jika routing sudah benar. Port 1883 dan 3000 harus dapat diakses dari subnet ESP32.

Di `.env` server: `DEVICE_TOKEN`, `AES_KEY_HEX`, `MQTT_USER=backend`, `MQTT_PASSWORD=...` tetap berlaku. Di `secrets.h` ketiga ESP32 isi `DEVICE_TOKEN` dan `AES_KEY_HEX` dengan nilai yang **sama** seperti server, serta `MQTT_USER=pbllele` dan password akun ini. Kredensial ESP32 **tidak** dimasukkan ke paket ini.

## Sensor asli

Wiring: DS18B20 DATA GPIO4 dengan pull-up 4,7 kOhm ke 3,3V, pH4502C PO analog GPIO34, water level analog S GPIO35. **Tegangan ke pin ESP32 tidak boleh lebih dari 3,3V**; ukur PO pH board (terutama jika board mendapat suplai 5V) dan gunakan GND bersama.

Pembacaan mengikuti sketch asli kalian:

```cpp
sensors.requestTemperatures();
float temperatureC = sensors.getTempCByIndex(0);
int phRaw = analogRead(34);
float phVoltage = phRaw * (3.3f / 4095.0f);
float phValue = 7.0f - ((phVoltage - PH_VOLT_AT_PH7) * PH_SLOPE);
int waterRaw = analogRead(35);
long waterLevelPercent = map(waterRaw, WATER_RAW_MIN, WATER_RAW_MAX, 0, 100);
// Clamp 0-100%; apabila waterRaw>=4090, kirim null sebagai diagnosa saturasi ADC.
```

**PENTING:** rumus pH `PH_VOLT_AT_PH7=2.40`, `PH_SLOPE=1.00` dan rentang level `0..2500` adalah asumsi dari sketch kelompok, **bukan kalibrasi ilmiah**. pH harus diverifikasi larutan buffer (mis. pH 4 dan pH 7), dan water level harus dikalibrasi pada batas bawah/atas perendaman yang benar. `water_level_pct` tidak otomatis mewakili kedalaman kolam dalam cm.

Jika water sensor berulang menunjukkan 4095, secara default `INVALIDATE_SATURATED_WATER=1` mengirim `null` agar kejenuhan ADC tidak disalahartikan sebagai 100%. Periksa wiring, tegangan dan tipe sensor. Jika memang sudah diverifikasi 4095 normal untuk sensor yang digunakan, fitur ini dapat dinonaktifkan secara sengaja setelah pengukuran.

## JSON dan waktu

Firmware mengubah nama field dari sketch serial ke field yang **sudah dipakai backend**:

- `ph_value` => `data.ph`
- `water_level_percent` => `data.water_level_pct`
- `temperature_c` => `data.temperature_c`

Tetap menyertakan metadata `node_id`, `protocol`, `boot_id`, `seq`, `encrypted`, dan timestamp lokal dari NTP sebagai `timestamp` (WIB offset `+07:00`). Bila NTP belum sinkron `timestamp=null`, pengiriman **tetap berjalan**. Server saat ini memakai `received_at` dari SQLite sebagai waktu penerimaan dan **mengabaikan** field tambahan `timestamp`. Mode AES mengenkripsi objek `data` saja, bukan metadata timestamp.

Contoh JSON MQTT tanpa AES:

```json
{"node_id":"mqtt-01","protocol":"MQTT","boot_id":"aabbccddeeff0011","seq":1,"encrypted":false,"timestamp":"2026-11-09T16:00:00+07:00","data":{"temperature_c":28.5,"ph":7.1,"water_level_pct":65}}
```

## Pengujian dasar

1. Cek `sudo systemctl status mosquitto --no-pager` di Ubuntu Server, lalu backend `npm start` atau systemd yang dipakai.
2. Flash satu sketch per ESP32 melalui Arduino IDE, COM port masing-masing. Jangan upload 3 sketch ke satu board.
3. Buka Serial Monitor 115200; catat `SENSOR phRaw=...`, `MQTT seq...`, `HTTP seq...` atau `WS seq...`.
4. Cek `curl http://127.0.0.1:3000/api/latest` dan buka `http://IP_SERVER:3000` untuk dashboard SiLele.
5. Pastikan 3 `node_id` muncul dan setiap `seq`/`received_at` bertambah. Cek nilai nyata bukan dari simulator.
6. Untuk K1, AES OFF, Raspberry Pi tidak dilalui; capture TCP port 1883/3000 pada interface server. Rute K1 berbeda dari impairment melalui Pi: catat sebagai pengujian validasi tersendiri jika membandingkan QoS eksperimental.

## Keamanan

Wi-Fi credential yang pernah dikirim ke chat sebaiknya diganti sebelum deployment dan jangan dibagikan di GitHub. Password MQTT, token perangkat dan AES key cukup disimpan lokal dalam `secrets.h` dan `.env` server.

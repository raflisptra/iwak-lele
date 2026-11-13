> **VERSI SENSOR ASLI (2026-11-09):** Firmware `SmartPondShared.h` sudah menggunakan rumus DS18B20/pH4502C/water level dari sketch kelompok (sensor sungguhan). Baca **`PANDUAN_FIRMWARE_SENSOR_ASLI.md`** terlebih dahulu. Untuk `server-lele` yang sudah berjalan, jangan mengulang instruksi instalasi Mosquitto pada dokumen lama karena konfigurasi listener sudah disesuaikan.

# Smart Pond IoT: MQTT, HTTP, WebSocket, AES-256-GCM

Paket referensi implementasi PBL: **3 ESP32 × 3 sensor**, 3 protokol komunikasi, Linux gateway dengan TC/Netem **sudah disiapkan oleh tim**, 1 server Node.js + Eclipse Mosquitto, SQLite, dan dashboard web hanya-baca. Semua IP di bawah hanya **contoh**; sesuaikan dengan IP addressing dan topologi kalian.

## Isi paket

```text
firmware/
  esp32_mqtt/esp32_mqtt.ino               # Arduino IDE: ESP32 #1 MQTT (QoS 0)
  esp32_http/esp32_http.ino               # Arduino IDE: ESP32 #2 HTTP POST
  esp32_websocket/esp32_websocket.ino     # Arduino IDE: ESP32 #3 WebSocket
  */SmartPondShared.h                     # Sensor DS18B20 + pH + water-level + AES-GCM
  */secrets.example.h                     # Template konfigurasi, copy -> secrets.h
server/
  server.mjs                              # MQTT subscriber + HTTP ingest + WS ingest + API
  crypto.mjs                              # Decrypt AES-GCM + AAD, test helpers
  .env.example                            # Template environment
  public/index.html,assets/*              # Dashboard monitoring
  scripts/simulate.mjs                    # Penguji pengiriman 3 protokol tanpa hardware
  scripts/crypto.test.mjs                 # Test AES dan tamper resistance
  package.json

deploy/
  mosquitto-smartpond.conf
  mosquitto-smartpond.acl
  nginx-smartpond.conf                    # Public dashboard only, no ingest
  cloudflared-config.example.yml
  smartpond.service                       # Optional systemd
```

## 0. Cek rute RPi (WAJIB SEBELUM PENGUJIAN)

Gambar topologi memperlihatkan RPi sebagai perangkat yang terhubung ke router, **bukan pasti sebagai hop perantara**. Meskipun `tc/netem` sudah dikonfigurasi, trafik ESP32 bisa melewati router langsung ke server jika RPi tidak menjadi hop routing/bridging sebenarnya.

**Alur yang wajib terjadi untuk testbed:**

```text
ESP32 (Wi-Fi) -> Router/AP -> Raspberry Pi gateway (tc/netem) -> Server LAN
```

Tempatkan ESP32 dan server pada subnet/VLAN berbeda dengan Pi sebagai next-hop perantara, atau gunakan routing/policy-routing/bridge yang memang memaksa lintasan tersebut. Jika ketiganya pada satu subnet L2, host dapat melakukan ARP langsung sehingga netem pada Pi tidak kena. Periksa routing/bridging aktual dan tangkap paket di Pi ketika tiap node mengirim:

```bash
sudo tcpdump -ni any 'host 192.168.50.10 and (tcp port 1883 or tcp port 3000)'
```

Substitusi IP **server aktual**, serta gunakan filter IP ESP32 jika perlu. Pi harus benar-benar melihat paket data aplikasi yang menuju server; paket di `any` saja belum membuktikan bahwa qdisc yang benar sudah dilalui. Periksa juga counter `tc -s qdisc show dev <IFACE_EGRESS>` dan bandingkan sebelum/sesudah pengiriman. Jangan berasumsi impairment aktif hanya karena perintah `tc` berhasil.

## 1. Desain IP dan port (contoh)

| Device | IP/port ilustratif | Fungsi |
|---|---|---|
| Node MQTT | DHCP Wi-Fi | Publisher `pond/mqtt-01/telemetry` |
| Node HTTP | DHCP Wi-Fi | POST `http://192.168.50.10:3000/ingest/http` |
| Node WS | DHCP Wi-Fi | WS `ws://192.168.50.10:3000/ingest/ws` |
| Mosquitto server | `192.168.50.10:1883` | Broker MQTT lokal |
| Node.js server | `192.168.50.10:3000` | HTTP + WebSocket ingestion, read API, dashboard |
| Nginx lokal | `127.0.0.1:8080` | Proxy read-only dashboard untuk Tunnel |
| Public domain | `https://pond.example.com` | Dashboard remote via Cloudflare Tunnel |

**Port `1883` dan `3000` tidak boleh dipublikasikan langsung ke internet.** Pastikan firewall hanya mengizinkan ESP32 pada LAN penelitian mengaksesnya. Jangan memasukkan IP publik/domain ke firmware; firmware selalu mengarah ke alamat server internal lewat Pi. Tidak ada perubahan konfigurasi RPi/router yang dipaksakan oleh paket ini.

## 2. Siapkan server Ubuntu/Debian

Gunakan **Node.js 26 LTS** (atau Node.js 24+) dan npm, Mosquitto, Nginx, OpenSSL. Gunakan sumber paket Node.js resmi atau metode instalasi distro yang menyediakan Node 24+/26. Jangan mengandalkan `apt install nodejs` jika repositori ternyata memasang Node <24.

```bash
node --version  # 26.x direkomendasikan
sudo apt update
sudo apt install -y mosquitto mosquitto-clients nginx openssl
```

**2.1. Password Mosquitto dan ACL**

```bash
sudo cp deploy/mosquitto-smartpond.conf /etc/mosquitto/conf.d/smartpond.conf
sudo cp deploy/mosquitto-smartpond.acl /etc/mosquitto/smartpond.acl
sudo mosquitto_passwd -c /etc/mosquitto/smartpond.passwd pbllele
sudo mosquitto_passwd /etc/mosquitto/smartpond.passwd backend
sudo chown mosquitto:mosquitto /etc/mosquitto/smartpond.passwd /etc/mosquitto/smartpond.acl
sudo chmod 640 /etc/mosquitto/smartpond.passwd
sudo chmod 640 /etc/mosquitto/smartpond.acl
sudo systemctl enable --now mosquitto
sudo systemctl restart mosquitto
sudo systemctl status mosquitto --no-pager
```

Masukkan password berbeda dan kuat untuk `pbllele` dan `backend`. Jika Mosquitto gagal restart, cek `sudo journalctl -u mosquitto -n 70 --no-pager`; lihat apakah ada listener ganda pada port 1883 dan pastikan user `mosquitto` dapat membaca ACL/password. Konfigurasi ACL di paket mengizinkan `pbllele` hanya publish ke topik MQTT dan `backend` hanya subscribe. Jika memakai Mosquitto 2.1+, sintaks `password_file`/`acl_file` versi 2.0 masih umum, tetapi plugin-based ACL/auth adalah jalur yang lebih baru.

**2.2. Node.js + environment**

Jalankan perintah di direktori `server/`:

```bash
cd server
cp .env.example .env
openssl rand -hex 32   # 64 hex untuk AES_KEY_HEX (copy hasilnya)
openssl rand -hex 24   # contoh token 48 karakter untuk DEVICE_TOKEN
nano .env
npm install
npm run test:crypto
npm start
```

Isi semua `CHANGE_ME` di `.env` termasuk password Mosquitto untuk `backend`. AES key **harus tepat 64 karakter hex**; token minimal 24 karakter. Simpan `.env` dengan hak akses terbatas (`chmod 600 .env`) dan jangan commit ke Git.

Server mendengarkan `0.0.0.0:3000`, agar ESP32 pada jaringan testbed dapat mengakses. Selama percobaan manual, buka dashboard LAN di `http://<IP_SERVER>:3000/`. Konfigurasi firewall harus membatasi akses LAN. Pastikan Port 1883 MQTT dan port 3000 TCP dapat dilewati dari ESP32 ke server melalui RPi. Jika server memakai UFW, buat allow rule **berdasarkan subnet sumber LAN penelitian**, bukan `allow` global; misalnya `sudo ufw allow from <SUBNET_IOT_CIDR> to any port 1883 proto tcp`, dan serupa untuk 3000.

**2.3. Layanan systemd (opsional setelah manual berhasil)**

File `deploy/smartpond.service` mengasumsikan aplikasi ditempatkan di `/opt/smartpond/server`, user `smartpond` dibuat, dan `/usr/bin/node` tersedia. Ubah jalur atau user bila server kalian berbeda.

```bash
sudo useradd --system --home /opt/smartpond --shell /usr/sbin/nologin smartpond
sudo mkdir -p /opt/smartpond/server/data
# Copy seluruh isi folder server/ ke /opt/smartpond/server/ (termasuk node_modules dan .env)
sudo chown -R smartpond:smartpond /opt/smartpond
sudo chmod 600 /opt/smartpond/server/.env
sudo cp deploy/smartpond.service /etc/systemd/system/smartpond.service
sudo systemctl daemon-reload
sudo systemctl enable --now smartpond
sudo journalctl -u smartpond -f
```

Saat eksperimen lokal, cukup jalankan `npm start`, tidak wajib systemd.

## 3. Flash 3 ESP32 (Arduino IDE)

Pilih board ESP32 Dev Module **ESP32 klasik/WROOM-32**. Mapping GPIO untuk board ESP32-S3/C3 berbeda dan harus disesuaikan. Gunakan Arduino-ESP32 3.x dan instal library di Arduino IDE > Library Manager:

- **ArduinoJson** 7.x (Benoit Blanchon)
- **OneWire** (Paul Stoffregen)
- **DallasTemperature** (Miles Burton)
- **PubSubClient** (Nick O'Leary; firmware MQTT saja)
- **WebSockets** / **arduinoWebSockets** (Markus Sattler; firmware WS saja)

Untuk **masing-masing folder firmware**, copy `secrets.example.h` menjadi `secrets.h` dan edit:

```cpp
#define WIFI_SSID "SSID-LAB"
#define WIFI_PASSWORD "WIFI-PASSWORD"
#define SERVER_IP "192.168.50.10"  // ganti IP server aktual
#define MQTT_USER "pbllele"
#define MQTT_PASSWORD "password-dari-mosquitto_passwd"
#define DEVICE_TOKEN "token-sama-dengan-server-env"
#define AES_KEY_HEX "64-karakter-hex-yang-sama-dengan-server"
#define SIMULATE_SENSORS 1
#define DEFAULT_USE_AES false
```

Open `esp32_mqtt.ino` untuk ESP32-01, `esp32_http.ino` untuk ESP32-02, `esp32_websocket.ino` untuk ESP32-03, upload bergiliran. Masing-masing firmware sudah mengatur `NODE_ID` dan `NODE_PROTOCOL` sehingga tidak perlu diubah.

**Wiring (SETIAP ESP32 memiliki 3 sensor sendiri):**

| Sensor | GPIO ESP32 | Catatan |
|---|---|---|
| DS18B20 (data) | GPIO 4 | Resistor pull-up 4.7kΩ antara DATA dan 3.3 V; VCC/GND sesuai modul/probe |
| pH analog (PO) | GPIO 34 | ADC1; hanya sinyal <=3.3 V masuk ESP32; lakukan kalibrasi pH4/pH7 |
| Level analog (S) | GPIO 35 | ADC1; hanya sinyal <=3.3 V; kalibrasi basah/kering |
| Semua sensor | GND bersama | Wajib common ground dengan ESP32 |

Jika pH board diberi 5V, ukur dulu **tegangan output analog PO**. Gunakan pembagi tegangan/buffer bila lebih dari 3.3V dan kalibrasikan kembali nilai yang dibaca ESP32. Jangan menghubungkan output 5V langsung ke pin ADC. GPIO 34/35 adalah input-only sehingga cocok untuk analog. Lebih aman dari ADC2 ketika Wi-Fi aktif.

**Mode sensor:** `SIMULATE_SENSORS=1` adalah mode dummy deterministik untuk menuntaskan integrasi ketiga protokol dan membandingkan sampel identik. Untuk **sensor sungguhan**, set `SIMULATE_SENSORS=0`, lalu kalibrasi pH (`PH_MV_AT_7_0` dan `PH_MV_AT_4_0` dari pengukuran cairan buffer) serta water level (`WATER_RAW_DRY`, `WATER_RAW_WET`). Sebelum kalibrasi, nilai pH/water dikirim `null` alih-alih menampilkan angka palsu. DS18B20 terputus juga dikirim `null`. Sensor ketinggian analog yang saturasi di ADC `4095` akan dikirim `null`; periksa kabel/tegangan jika ini terjadi.

**Mode AES tanpa re-upload:** Buka Serial Monitor 115200 pada tiap ESP32. Ketik karakter `1` untuk **AES aktif** atau `0` untuk **AES nonaktif**. Default mengikuti `DEFAULT_USE_AES`; saat reboot mode kembali ke default. Ubah ketiga node ke mode yang sama dan tunggu data terkirim sebelum memulai capture skenario.

Setiap node mengirim satu JSON tiap 5000 ms. MQTT memakai **QoS 0** dari `PubSubClient` (library ini tidak menyediakan MQTT publish QoS 1 secara langsung). HTTP memakai POST + response; WebSocket memakai koneksi persisten dan application ACK. **Tiga semantik delivery ini tidak identik** dan harus dicatat pada analisis eksperimen.

## 4. Format JSON yang sama untuk seluruh node

**Tanpa AES:**

```json
{
  "node_id": "mqtt-01",
  "protocol": "MQTT",
  "boot_id": "aabbccddeeff0011",
  "seq": 1,
  "encrypted": false,
  "data": {
    "temperature_c": 27.8,
    "ph": 6.9,
    "water_level_pct": 62.0
  }
}
```

**Dengan AES:**

```json
{
  "node_id": "mqtt-01",
  "protocol": "MQTT",
  "boot_id": "aabbccddeeff0011",
  "seq": 1,
  "encrypted": true,
  "iv": "...24 hexadecimal characters...",
  "tag": "...32 hexadecimal characters...",
  "ciphertext": "...hex ciphertext..."
}
```

AES-256-GCM mengenkripsi hanya object `data` dan melindungi metadata dengan **AAD** persis: `node_id|protocol|boot_id|seq`, UTF-8. IV/nonce 12 byte dibuat acak per pesan. Autentikasi tag 16 byte diverifikasi server sebelum JSON dibaca. `boot_id` merupakan identitas acak 8 byte setiap power-on, memisahkan `seq` yang kembali ke 1 setelah restart. **Key sama** di ketiga firmware dan server untuk prototipe ini, bukan praktik pengelolaan kunci produksi.

Format ciphertext hex sengaja mudah dibaca/di-debug, meskipun lebih boros bandwidth dibanding base64/binary. Pertimbangkan pengaruhnya sebagai protocol-independent application encoding overhead pada laporan.

## 5. Uji server TANPA ESP32

Jalankan backend dahulu (`npm start`). Dalam terminal kedua di `server/`:

```bash
# Set TEST_MQTT_USER dan TEST_MQTT_PASSWORD di .env lebih dahulu
npm run simulate
TEST_AES=1 npm run simulate
```

Program simulator mengirim satu payload lewat **HTTP + WebSocket + MQTT**, lalu kalian dapat melihat tiga kartu di `http://<IP_SERVER>:3000/` dan endpoint:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/latest
curl 'http://127.0.0.1:3000/api/history?node_id=mqtt-01&limit=10'
```

Log yang benar antara lain `MQTT backend terhubung`, `HTTP ... seq=1`, `WebSocket ... seq=1`, `MQTT ... seq=1`. Jika MQTT simulator berhasil publish tetapi backend gagal terima, cek broker ACL, credentials, subscriber, dan output log backend. HTTP dan WebSocket memerlukan `X-Device-Token`; MQTT memakai username/password broker. `/api/latest` dan `/api/history` hanya untuk membaca data.

Data SQLite disimpan di `server/data/smartpond.sqlite` (mode WAL). Kolom `payload_bytes` hanya menyatakan ukuran **JSON application message**, bukan ukuran total frame TCP/IP; untuk protocol overhead/throughput jaringan wajib ambil PCAP dan hitung sesuai lapisan yang didefinisikan di laporan.

## 6. Dashboard dapat diakses dari mana saja

### Pilihan disarankan: Cloudflare Tunnel (tidak perlu IP publik)

Di server, pasang Nginx + file konfigurasi dari paket:

```bash
sudo cp deploy/nginx-smartpond.conf /etc/nginx/sites-available/smartpond
sudo ln -s /etc/nginx/sites-available/smartpond /etc/nginx/sites-enabled/smartpond
sudo nginx -t && sudo systemctl reload nginx
curl -I http://127.0.0.1:8080/
curl -I http://127.0.0.1:8080/ingest/http  # harus 404, bukan endpoint publik
```

Daftarkan domain di Cloudflare, install `cloudflared` di **server** (bukan di Raspberry Pi), buat Tunnel di **Cloudflare Dashboard > Networking > Tunnels**. Buat Published Application dengan subdomain `pond.domainkalian.com` dan Service URL `http://127.0.0.1:8080`. Ikuti instruksi resmi untuk menjalankan `cloudflared` sebagai service agar tetap hidup setelah reboot. DNS rute subdomain melalui Tunnel; pengunjung membuka `https://pond.domainkalian.com` dari jaringan mana pun. Tidak perlu port-forward 443 ataupun IP publik statis. Atur **Cloudflare Access** jika hanya dosen/kelompok yang boleh melihat dashboard.

File `deploy/cloudflared-config.example.yml` adalah contoh alternatif untuk *locally-managed tunnel* jika kalian memilih CLI. Jangan mengikuti sekaligus dua konfigurasi tunnel yang berbeda.

Mengapa via Nginx 8080? Karena backend juga menerima kiriman sensor pada `/ingest/http` dan `/ingest/ws`. **Nginx public origin ini hanya mengizinkan UI dan GET API** sehingga pengunjung internet tidak dapat mengirim data sensor melalui Tunnel, meskipun punya domain dashboard.

### Alternatif: IP publik + domain + HTTPS

Jika ISP benar-benar memberi IP publik yang bisa menerima inbound, port-forward **80 dan 443 saja** ke reverse proxy, pasang Nginx + Certbot untuk TLS (`Let's Encrypt`), set DNS `A`/`AAAA` domain ke alamat publik, dan gunakan DDNS bila IP dinamis. Konfigurasi virtual host untuk alternatif ini perlu disesuaikan (file paket ini khusus origin loopback Tunnel). Jika IP WAN router masih CGNAT, port-forward biasa tidak dapat diandalkan; Tunnel lebih sederhana. Jangan pernah port-forward 1883 atau 3000.

## 7. Skenario eksperimen K1-K4

| Test | Pi impairment | AES di ESP32 |
|---|---|---|
| K1 | tidak | mode `0` |
| K2 | tidak | mode `1` |
| K3 | ya | mode `0` |
| K4 | ya | mode `1` |

Pada mode impairment, bentuk variasi bertahap sebagai sub-skenario (misalnya delay 100/300 ms, loss 1/5%, limit 1 Mbps/512 kbps). Sebelum tiap pengukuran, pastikan kondisi Pi benar-benar berlaku **pada path ketiga protokol**, catat `tc -s qdisc`, simpan timestamp, capture PCAP, dan sinkronkan jam host apabila mengukur delay satu arah. Jalankan setidaknya beberapa pengulangan dengan durasi/jumlah pesan yang sama. Isolasi uji per protokol **atau** uji simultan secara konsisten; kedua pendekatan menjawab pertanyaan berbeda.

Contoh packet capture di server untuk data mentah:

```bash
sudo tcpdump -ni any -s 0 -w smartpond-K1.pcap '(tcp port 1883 or tcp port 3000)'
```

Untuk observasi protocol overhead, definisikan tepat lapisan mana yang dihitung (frame Ethernet, IP bytes, TCP payload, protokol application), dan bedakan overhead AES dari overhead header MQTT/HTTP/WebSocket. Karena TCP menjamin pengiriman berurutan saat koneksi sehat, **packet loss yang disuntikkan Netem tidak selalu sama dengan kehilangan pesan tingkat aplikasi**. Analisis TCP retransmission dan sequence ID adalah dua metrik berbeda. `seq` di tiap ESP juga baru bertambah ketika stack siap mencoba kirim sehingga jangan menafsirkan jumlah `seq` yang tidak muncul saat putus koneksi sebagai total packet loss IP.

## 8. Trouble-shoot cepat

| Gejala | Periksa |
|---|---|
| ESP32 MQTT state=5 | user/password/ACL Mosquitto; cek broker server |
| ESP32 HTTP -1 | routing ESP32 -> Pi -> server, firewall TCP 3000, backend running |
| HTTP 401 / WS 401 | `DEVICE_TOKEN` sama persis dengan `.env` |
| HTTP 400 / WS `ok:false` | AES key beda, AAD/JSON tidak valid, atau nilai sensor diluar rentang |
| MQTT terkirim namun dashboard kosong | subscriber backend, ACL backend, topic yang sama, cek `journalctl` |
| DS18B20 `null` | pull-up 4.7kΩ DATA -> 3.3V; pin GPIO4; cek probe |
| pH `null` | kalibrasi kedua buffer point belum diisi |
| Water `null` / ADC 4095 | pin saturasi atau kalibrasi belum dilakukan; cek keluaran analog <=3.3V |
| Pi `tc` tidak mengubah hasil | RPi ternyata bukan next-hop atau qdisc dipasang ke interface/arah yang salah |
| Domain terbuka tetapi data kosong | backend MQTT/HTTP/WS bermasalah, bukan Cloudflare; tes LAN lebih dulu |

## 9. Catatan keamanan dan batasan

- Enkripsi AES-GCM pada payload adalah **variabel penelitian**, bukan pengganti TLS untuk sistem produksi. Token HTTP/WS dan password MQTT di lab masih melewati transport biasa. Jaga Wi-Fi/segmen lab, jangan ekspos port ingest ke internet.
- Kode ini contoh proyek PBL, belum menyediakan kontrol akses granular per device, provisioning key aman, manajemen sertifikat perangkat, rate limiting tingkat produksi, monitoring penggunaan disk jangka panjang, atau mekanisme spool saat koneksi putus.
- Dashboard **hanya menampilkan sensor** dan status AES/penerimaan. Dashboard tidak menghitung QoS, sesuai kebutuhan proyek; analisis PCAP/hasil `tc` dilakukan terpisah.
- Data sensor nyata tidak otomatis seragam antar node. Untuk eksperimen perbandingan protokol, mode simulasi deterministik lebih baik dalam mengendalikan variabel sensor; gunakan mode nyata sebagai demonstrasi Smart Pond.

## Referensi dokumentasi

- Eclipse Mosquitto authentication: https://www.mosquitto.org/documentation/authentication-methods/
- Cloudflare Tunnel: https://developers.cloudflare.com/tunnel/get-started/
- Cloudflare locally-managed tunnel: https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/
- ESP32 analog ADC: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html
- Arduino WebSockets client: https://github.com/Links2004/arduinoWebSockets
- Node.js SQLite: https://nodejs.org/api/sqlite.html

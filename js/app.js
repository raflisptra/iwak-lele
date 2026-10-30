/* =====================================================================
   SiLele IoT — Dashboard Admin (MODE SLOT KOSONG)
   Sensor BELUM terpasang -> semua grafik/tabel/kartu tampil "--"/kosong.
   Setelah perangkat siap, isi HANYA bagian bertanda  [TODO - ISI DI SINI].

   PETA CEPAT PENGISIAN:
   - BAGIAN 0 : alamat server / broker (wajib isi sekali saat install)
   - BAGIAN 5 : angka QoS hasil Wireshark/PCAP untuk skenario subbab 6.10
   - BAGIAN 8 : fungsi updateDashboard() = SATU-SATUNYA pintu masuk data sensor
   - BAGIAN 9 : pilih 1 cara ambil data (HTTP / WebSocket / MQTT / manual)
   ===================================================================== */

// =====================================================================
// BAGIAN 0 — KONFIGURASI KONEKSI  [TODO - ISI DI SINI saat perangkat siap]
// ---------------------------------------------------------------------
// Isi alamat asli sesuai proposal 6.3.1 (d). Contoh nilai di bawah hanya template.
const CONFIG = {
  SENSOR_TERHUBUNG: false, // [TODO] ubah ke true setelah ESP32 + sensor terpasang & mengirim

  // [TODO] isi URL backend Anda. Contoh:
  HTTP_ENDPOINT: 'http://192.168.0.40:3000/api/sensor', // <- [TODO] ganti port/path sesuai server Anda
  WS_URL: 'ws://192.168.0.40:3001',                     // <- [TODO] ganti sesuai WebSocket server Anda
  MQTT_BROKER: 'ws://192.168.0.40:9001',                // <- [TODO] ganti sesuai Mosquitto (websocket port)
  MQTT_TOPIC: 'kolam/lele/sensor',                      // <- [TODO] samakan dengan topic di ESP32

  POLLING_INTERVAL_DETIK: 2, // [TODO] samakan dengan interval kirim ESP32 (proposal: diseragamkan)
};

// ---------- 1. AUTH (proposal 6.1.2) — tidak perlu diisi ----------
const CRED = { user: 'admin', pass: 'admin123' };
const loginOverlay = document.getElementById('loginOverlay');
const appLayout = document.getElementById('appLayout');
document.getElementById('btnLogin').onclick = () => {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  if (u === CRED.user && p === CRED.pass) {
    loginOverlay.style.display = 'none';
    appLayout.style.display = 'flex';
    pushEvent('Login admin berhasil.', 'ok');
  } else {
    document.getElementById('loginError').textContent = 'Username / password salah.';
  }
};
document.getElementById('btnLogout').onclick = () => {
  appLayout.style.display = 'none';
  loginOverlay.style.display = 'flex';
  document.getElementById('loginPass').value = '';
};
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btnLogin').click(); });

// ---------- 2. NAVIGASI — tidak perlu diisi ----------
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
    document.getElementById('pageTitle').textContent = btn.textContent.trim();
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  };
});

// ---------- 3. JAM — tidak perlu diisi ----------
setInterval(() => {
  document.getElementById('clock').textContent =
    new Date().toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}, 1000);

// ---------- 4. BATAS IDEAL (KKP) + TIPHON — tidak perlu diisi (ubah jika standar berubah) ----------
const IDEAL = { suhuMin: 25, suhuMax: 30, phMin: 7, phMax: 8, lvlMin: 60, lvlMax: 80 };
function tiphonDelay(ms)  { if (ms == null) return ['-', '']; if (ms < 150) return ['Sangat Baik','sb']; if (ms <= 300) return ['Baik','b']; if (ms <= 450) return ['Sedang','s']; return ['Buruk','bu']; }
function tiphonJitter(ms) { if (ms == null) return ['-', '']; if (ms <= 0.5) return ['Sangat Baik','sb']; if (ms <= 75) return ['Baik','b']; if (ms <= 125) return ['Sedang','s']; return ['Buruk','bu']; }
function tiphonLoss(p)    { if (p == null) return ['-', '']; if (p <= 0.01) return ['Sangat Baik','sb']; if (p <= 3) return ['Baik','b']; if (p <= 15) return ['Sedang','s']; return ['Buruk','bu']; }
function statusSuhu(v){ if (v == null) return 'Menunggu sensor…'; return (v >= IDEAL.suhuMin && v <= IDEAL.suhuMax) ? 'Ideal' : (v < IDEAL.suhuMin ? 'Terlalu Dingin' : 'Terlalu Panas'); }
function statusPh(v){ if (v == null) return 'Menunggu sensor…'; return (v >= IDEAL.phMin && v <= IDEAL.phMax) ? 'Ideal' : (v < IDEAL.phMin ? 'Terlalu Asam' : 'Terlalu Basa'); }
function statusLevel(v){ if (v == null) return 'Menunggu sensor…'; return (v >= IDEAL.lvlMin && v <= IDEAL.lvlMax) ? 'Aman' : (v < IDEAL.lvlMin ? 'Air Kurang' : 'Luber'); }
const pill = t => (t[0] === '-' ? '-' : `<span class="pill ${t[1]}">${t[0]}</span>`);
const fmt = (v, d=2) => (v == null ? '--' : Number(v).toFixed(d));

// =====================================================================
// BAGIAN 5 — SLOT DATA QoS HASIL WIRESHARK/PCAP  [diisi setelah skenario subbab 6.10 diuji]
// ---------------------------------------------------------------------
// Sekarang dikosongkan (null) -> tabel & grafik QoS tampil "-".
// Setelah pengujian selesai, ganti setiap null dengan angka hasil PCAP.
// Seluruh skenario final proposal 6.10 dibuat otomatis pada array SCENARIOS.
// Satuan: d=delay(ms), j=jitter(ms), l=loss(%), t=throughput(kbps),
//         r=response time(ms), g=goodput(kbps), o=overhead(%)
const scenarioList = [];

// A. Baseline tanpa impairment dan tanpa AES (proposal 6.10, Tabel 6.5)
scenarioList.push({
  id: 'A-S0', nomorProposal: 1, kelompok: 'A',
  kelompokLabel: 'A. Tanpa impairment dan tanpa AES',
  nama: 'Baseline', rekayasa: 'Jaringan normal tanpa impairment',
  aesEnabled: false
});

// B. Impairment tanpa AES (proposal 6.10, Tabel 6.6)
const latencyLevels = Array.from({ length: 10 }, (_, i) => (i + 1) * 100);
latencyLevels.forEach((ms, i) => scenarioList.push({
  id: `B-L${ms}`, nomorProposal: i + 2, kelompok: 'B',
  kelompokLabel: 'B. Network impairment tanpa AES',
  nama: `Latency ${i + 1}`, rekayasa: `Penambahan latency +${ms} ms`,
  aesEnabled: false
}));

const packetLossLevels = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
packetLossLevels.forEach((loss, i) => scenarioList.push({
  id: `B-P${loss}`, nomorProposal: i + 12, kelompok: 'B',
  kelompokLabel: 'B. Network impairment tanpa AES',
  nama: `Packet Loss ${i + 1}`, rekayasa: `Packet loss ${loss}%`,
  aesEnabled: false
}));

const bandwidthLevels = [1024, 512, 128, 64, 32, 16, 8, 4, 2, 1];
bandwidthLevels.forEach((kbps, i) => scenarioList.push({
  id: `B-W${kbps}`, nomorProposal: i + 22, kelompok: 'B',
  kelompokLabel: 'B. Network impairment tanpa AES',
  nama: `Bandwidth ${i + 1}`, rekayasa: `Pembatasan bandwidth ${kbps} Kbps`,
  aesEnabled: false
}));

// C. Impairment dengan AES (proposal 6.10, Tabel 6.7).
// Parameter impairment sengaja identik dengan kelompok B agar perbandingan AES adil.
latencyLevels.forEach((ms, i) => scenarioList.push({
  id: `C-L${ms}`, nomorProposal: i + 2, kelompok: 'C',
  kelompokLabel: 'C. Network impairment dan AES',
  nama: `Latency ${i + 1}`, rekayasa: `Penambahan latency +${ms} ms`,
  aesEnabled: true
}));
packetLossLevels.forEach((loss, i) => scenarioList.push({
  id: `C-P${loss}`, nomorProposal: i + 12, kelompok: 'C',
  kelompokLabel: 'C. Network impairment dan AES',
  nama: `Packet Loss ${i + 1}`, rekayasa: `Packet loss ${loss}%`,
  aesEnabled: true
}));
bandwidthLevels.forEach((kbps, i) => scenarioList.push({
  id: `C-W${kbps}`, nomorProposal: i + 22, kelompok: 'C',
  kelompokLabel: 'C. Network impairment dan AES',
  nama: `Bandwidth ${i + 1}`, rekayasa: `Pembatasan bandwidth ${kbps} Kbps`,
  aesEnabled: true
}));

// D. Baseline dengan AES (proposal 6.10, Tabel 6.8)
scenarioList.push({
  id: 'D-S0', nomorProposal: 1, kelompok: 'D',
  kelompokLabel: 'D. AES tanpa network impairment',
  nama: 'Baseline dengan AES',
  rekayasa: 'Jaringan normal tanpa impairment',
  aesEnabled: true
});

const SCENARIOS = scenarioList.map(s => ({
  ...s,
  aesLabel: s.aesEnabled ? 'Ya' : 'Tidak',
  protokol: 'MQTT, HTTP, WebSocket'
}));

// Hasil PCAP belum dimasukkan. Semua nilai QoS dimulai null agar dashboard
// tidak menampilkan angka eksperimen yang belum benar-benar diukur.
const emptyQosMetrics = () => ({ d: null, j: null, l: null, t: null, r: null, g: null, o: null });
const DATA_QOS = Object.fromEntries(SCENARIOS.map(s => [s.id, {
  MQTT: emptyQosMetrics(),
  HTTP: emptyQosMetrics(),
  WS: emptyQosMetrics()
}]));

// ---------- 6. GAUGE APEXCHARTS — tidak perlu diisi (slot, mulai dari 0) ----------
function gauge(el, color, suffix){
  const c = new ApexCharts(document.querySelector(el), {
    chart:{ type:'radialBar', height:150, sparkline:{enabled:true} },
    series:[0],
    plotOptions:{ radialBar:{ hollow:{size:'55%'}, track:{background:'#e8eef4'},
      dataLabels:{ name:{show:false}, value:{fontSize:'18px',fontWeight:800, formatter:v=>v.toFixed(1)+suffix} } } },
    colors:[color], stroke:{lineCap:'round'}
  });
  c.render(); return c;
}
const gSuhu = gauge('#gaugeSuhu', '#ef4444', '°');
const gPh = gauge('#gaugePh', '#8b5cf6', '');
const gLevel = gauge('#gaugeLevel', '#0ea5e9', '');

// =====================================================================
// BAGIAN 7 — SLOT GRAFIK REALTIME (kosong) — tidak perlu diisi manual
// ---------------------------------------------------------------------
// Array di bawah adalah SLOT PENAMPUNG data sensor.
// Jangan isi manual — biarkan kosong. Mereka terisi otomatis lewat
// updateDashboard() di BAGIAN 8 setiap ada data baru masuk.
const N = 30; // jumlah titik tampil di grafik
let labels = Array.from({length:N}, () => ''); // SLOT label waktu (kosong)
let suhuMQTT = Array(N).fill(null); // [SLOT] riwayat suhu node MQTT 192.168.0.21
let suhuHTTP = Array(N).fill(null); // [SLOT] riwayat suhu node HTTP 192.168.0.22
let suhuWS   = Array(N).fill(null); // [SLOT] riwayat suhu node WS 192.168.0.23
let phMQTT = Array(N).fill(null);   // [SLOT] riwayat pH node MQTT
let phHTTP = Array(N).fill(null);   // [SLOT] riwayat pH node HTTP
let phWS   = Array(N).fill(null);   // [SLOT] riwayat pH node WS
let lvl    = Array(N).fill(null);    // [SLOT] riwayat ketinggian air (cm)

function lineChart(el, series, colors, ymin, ymax, ann){
  const c = new ApexCharts(document.querySelector(el), {
    chart:{type:'line',height:300,animations:{enabled:false},toolbar:{show:true},zoom:{enabled:true}},
    series, colors,
    xaxis:{categories: labels, labels:{show:false}, title:{text:'menunggu data sensor…'}},
    yaxis:{min:ymin,max:ymax,decimalsInFloat:1},
    legend:{position:'top'}, grid:{strokeDashArray:4},
    annotations: ann||{}, tooltip:{shared:true}
  });
  c.render(); return c;
}
const chSuhu = lineChart('#chartSuhu', [
  {name:'MQTT (.21) — DS18B20 [SLOT]', data:[...suhuMQTT]},
  {name:'HTTP (.22) [SLOT]', data:[...suhuHTTP]},
  {name:'WS (.23) [SLOT]', data:[...suhuWS]},
], ['#0e7c5b','#f59e0b','#0ea5e9'], 22, 34, {
  yaxis:[{y:25,y2:30,fillColor:'#16a34a',opacity:0.12,label:{text:'Ideal 25–30°C'}}]
});
const chPh = lineChart('#chartPh', [
  {name:'MQTT (.21) — PH-4502C [SLOT]', data:[...phMQTT]},
  {name:'HTTP (.22) [SLOT]', data:[...phHTTP]},
  {name:'WS (.23) [SLOT]', data:[...phWS]},
], ['#8b5cf6','#ec4899','#6366f1'], 6, 9, {
  yaxis:[{y:7,y2:8,fillColor:'#16a34a',opacity:0.15,label:{text:'Ideal pH 7–8'}}]
});
const chLevel = new ApexCharts(document.querySelector('#chartLevel'), {
  chart:{type:'area',height:300,toolbar:{show:true},animations:{enabled:false}},
  series:[{name:'Ketinggian (cm) [SLOT]', data:[...lvl]}],
  colors:['#0ea5e9'],
  xaxis:{categories: labels, labels:{show:false}},
  yaxis:{min:30,max:110},
  annotations:{yaxis:[
    {y:60,borderColor:'#f59e0b',label:{text:'Batas bawah 60'}},
    {y:80,borderColor:'#dc2626',label:{text:'Batas atas 80'}}]},
});
chLevel.render();

// ---------- TABEL + GRAFIK QoS (otomatis kosong bila DATA_QOS masih null) ----------
const protos = ['MQTT','HTTP','WS'];
const qosColors = ['#0e7c5b','#f59e0b','#0ea5e9'];
function barChart(el, title, getVal){
  const c = new ApexCharts(document.querySelector(el), {
    chart:{type:'bar',height:280,toolbar:{show:true},animations:{enabled:false}},
    series: protos.map(p=>({name:p, data: SCENARIOS.map(s=>getVal(s.id,p) ?? 0)})),
    colors: qosColors, xaxis:{categories: SCENARIOS.map(s=>s.id)},
    plotOptions:{bar:{columnWidth:'55%',borderRadius:5}},
    dataLabels:{enabled:false}, legend:{position:'top'},
    title:{text:title + ' (slot kosong = 0)', style:{fontSize:'13px'}}
  });
  c.render(); return c;
}
const chDelay = barChart('#chartQosDelay','Delay (ms)',(s,p)=>DATA_QOS[s][p].d);
const chJitter= barChart('#chartQosJitter','Jitter (ms)',(s,p)=>DATA_QOS[s][p].j);
const chLoss  = barChart('#chartQosLoss','Packet Loss (%)',(s,p)=>DATA_QOS[s][p].l);
const chTput  = barChart('#chartQosThroughput','Throughput (kbps)',(s,p)=>DATA_QOS[s][p].t);
let chEff = null;
function renderEfficiency(sid){
  const d = DATA_QOS[sid];
  if(chEff) chEff.destroy();
  chEff = new ApexCharts(document.querySelector('#chartEfficiency'), {
    chart:{type:'bar',height:280,animations:{enabled:false}},
    series:[
      {name:'Response time (ms)', data: protos.map(p=>d[p].r ?? 0)},
      {name:'Goodput (kbps)', data: protos.map(p=>d[p].g ?? 0)},
      {name:'Overhead (%)', data: protos.map(p=>d[p].o ?? 0)},
    ],
    colors:['#6366f1','#16a34a','#ef4444'],
    xaxis:{categories:protos}, plotOptions:{bar:{columnWidth:'50%',borderRadius:5}}, dataLabels:{enabled:false}
  });
  chEff.render();
}

// ---------- 9b. TABEL QoS + SKENARIO — tidak perlu diisi ----------
const sel = document.getElementById('scenarioSelect');
SCENARIOS.forEach(s=>{ const o=document.createElement('option'); o.value=s.id; o.textContent=`${s.id} — [${s.kelompok}] ${s.nama} | AES ${s.aesEnabled ? 'ON' : 'OFF'}`; sel.appendChild(o); });
function renderQosTable(sid){
  const d = DATA_QOS[sid];
  const cell = v => (v == null ? '-' : v);
  document.getElementById('qosTable').innerHTML =
    `<thead><tr><th>Protokol</th><th>Delay</th><th>Kat.</th><th>Jitter</th><th>Kat.</th><th>Loss</th><th>Kat.</th><th>Throughput</th><th>Resp.</th><th>Goodput</th><th>Overhead</th></tr></thead><tbody>` +
    protos.map(p=>{
      const v=d[p];
      return `<tr><td><b>${p}</b></td><td>${cell(v.d)}${v.d==null?'':' ms'}</td><td>${pill(tiphonDelay(v.d))}</td><td>${cell(v.j)}${v.j==null?'':' ms'}</td><td>${pill(tiphonJitter(v.j))}</td><td>${cell(v.l)}${v.l==null?'':'%'}</td><td>${pill(tiphonLoss(v.l))}</td><td>${cell(v.t)}${v.t==null?'':' kbps'}</td><td>${cell(v.r)}${v.r==null?'':' ms'}</td><td>${cell(v.g)}${v.g==null?'':' kbps'}</td><td>${cell(v.o)}${v.o==null?'':'%'}</td></tr>`;
    }).join('') + `</tbody><tfoot><tr><td colspan="11" style="text-align:left;color:#6b7d90">Slot kosong — isi BAGIAN 5 (DATA_QOS) setelah pengujian Wireshark selesai.</td></tr></tfoot>`;
}
sel.onchange = ()=>{ renderQosTable(sel.value); renderEfficiency(sel.value); };
sel.value = SCENARIOS[0].id;
renderQosTable(sel.value);
renderEfficiency(sel.value);
document.getElementById('scenarioTable').innerHTML = SCENARIOS.map(s=>
  `<tr><td>${s.nomorProposal}</td><td>${s.kelompokLabel}</td><td><b>${s.nama}</b> <small>(${s.id})</small></td><td>${s.rekayasa}</td><td>${s.aesLabel}</td><td>${s.protokol}</td><td>Belum ada hasil PCAP</td></tr>`
).join('');

// =====================================================================
// BAGIAN 8 — PINTU MASUK DATA SENSOR ★ [TODO - ISI / PANGGIL DI SINI]
// ---------------------------------------------------------------------
// INILAH SATU-SATUNYA FUNGSI yang perlu Anda panggil saat sensor mengirim.
// Format input WAJIB:
//   { suhu: number (°C, DS18B20 pin D4),
//     ph: number (0-14, PH-4502C pin A34),
//     level: number (cm, Water Level pin A35),
//     protocol: 'MQTT' | 'HTTP' | 'WS',   // asal node (.21/.22/.23)
//     node: 'ESP32-MQTT' | ... }          // opsional, default otomatis
//
// CONTOH PANGGIL:
//   updateDashboard({ suhu: 28.5, ph: 7.4, level: 72, protocol: 'MQTT' });
//
// Fungsi ini otomatis mengisi SEMUA slot HTML:
//   kartu #valSuhu/#valPh/#valLevel, gauge, 3 grafik, payload, log, event.
let logRows = [];
function pushShift(arr, v){ arr.push(v); if(arr.length > N) arr.shift(); }

function updateDashboard(data) {
  // [TODO - ISI DI SINI]: tidak perlu ubah isi fungsi ini.
  // Cukup PANGGIL fungsi ini dari BAGIAN 9 (fetch/websocket/mqtt/manual).
  const { suhu, ph, level, protocol = 'MQTT', node } = data;
  const proto = ['MQTT','HTTP','WS'].includes(protocol) ? protocol : 'MQTT';
  const nodeName = node || ('ESP32-' + proto);
  const now = new Date();
  const jam = now.toLocaleTimeString('id-ID');
  const tgl = now.toLocaleString('id-ID');

  // 1) Geser riwayat grafik sesuai protokol pengirim
  if (proto === 'MQTT') { pushShift(suhuMQTT, suhu); pushShift(phMQTT, ph); }
  if (proto === 'HTTP') { pushShift(suhuHTTP, suhu); pushShift(phHTTP, ph); }
  if (proto === 'WS')   { pushShift(suhuWS, suhu);   pushShift(phWS, ph); }
  pushShift(lvl, level);
  labels.push(jam); labels.shift();

  // 2) Isi kartu angka + status
  document.getElementById('valSuhu').textContent = fmt(suhu);
  document.getElementById('valPh').textContent = fmt(ph);
  document.getElementById('valLevel').textContent = fmt(level, 1);
  document.getElementById('statSuhu').textContent = statusSuhu(suhu);
  document.getElementById('statPh').textContent = statusPh(ph);
  document.getElementById('statLevel').textContent = statusLevel(level);
  gSuhu.updateSeries([[(suhu/40*100).toFixed(1)]]);
  gPh.updateSeries([[(ph/14*100).toFixed(1)]]);
  gLevel.updateSeries([[level]]);

  // 3) Banner peringatan KKP
  const bad = (suhu<IDEAL.suhuMin||suhu>IDEAL.suhuMax)||(ph<IDEAL.phMin||ph>IDEAL.phMax)||(level<IDEAL.lvlMin||level>IDEAL.lvlMax);
  const banner = document.getElementById('alertBanner');
  if (bad) { banner.className='alert-banner bad'; document.getElementById('alertText').textContent=`PERINGATAN: Suhu ${suhu}°C (${statusSuhu(suhu)}), pH ${ph} (${statusPh(ph)}), Level ${level} cm (${statusLevel(level)}).`; pushEvent(`⚠️ Anomali — Suhu ${suhu}°C, pH ${ph}, Level ${level} cm`, 'bad'); }
  else { banner.className='alert-banner ok'; document.getElementById('alertText').textContent=`Normal — Suhu ${suhu}°C, pH ${ph}, Level ${level} cm (batas: 25–30°C, pH 7–8, 60–80 cm).`; }

  // 4) Preview payload JSON identik antar protokol (proposal 6.5)
  const payload = { node_id: nodeName, protocol: proto, suhu, ph, level_cm: level, timestamp: now.toISOString() };
  document.getElementById('payloadPreview').textContent = JSON.stringify(payload, null, 2);

  // 5) Refresh 3 grafik
  chSuhu.updateSeries([
    {name:'MQTT (.21) — DS18B20', data:[...suhuMQTT]},
    {name:'HTTP (.22)', data:[...suhuHTTP]},
    {name:'WS (.23)', data:[...suhuWS]},
  ]);
  chPh.updateSeries([
    {name:'MQTT (.21) — PH-4502C', data:[...phMQTT]},
    {name:'HTTP (.22)', data:[...phHTTP]},
    {name:'WS (.23)', data:[...phWS]},
  ]);
  chLevel.updateSeries([{name:'Ketinggian (cm)', data:[...lvl]}]);

  // 6) Tambah baris log
  tambahLog({ t: tgl, node: nodeName, proto, s: fmt(suhu), ph: fmt(ph), lv: fmt(level,1),
    st:(statusSuhu(suhu)==='Ideal'&&statusPh(ph)==='Ideal'&&statusLevel(level)==='Aman')?'Normal':'Cek' });
}

// ---------- BAGIAN 10 — LOG & EVENT — tidak perlu diisi ----------
// CATATAN: #eventList kini disembunyikan di dalam panel maps (hidden) agar
// pushEvent() tetap aman dipanggil tanpa menampilkan section kosong.
function pushEvent(msg, level){
  const list = document.getElementById('eventList');
  if(!list) return;
  const li = document.createElement('li');
  if(level==='warn') li.className='warn';
  if(level==='bad') li.className='bad';
  li.innerHTML = `${msg}<br><small>${new Date().toLocaleTimeString('id-ID')}</small>`;
  if(list.firstChild && list.firstChild.textContent.includes('Menunggu data')) list.innerHTML='';
  list.prepend(li);
  while(list.children.length > 12) list.lastChild.remove();
}
function tambahLog(r){
  logRows.unshift(r); logRows = logRows.slice(0,60);
  document.getElementById('logBody').innerHTML = logRows.map(x=>
    `<tr><td>${x.t}</td><td>${x.node}</td><td>${x.proto}</td><td>${x.s}</td><td>${x.ph}</td><td>${x.lv}</td><td>${x.st}</td></tr>`).join('');
  document.getElementById('logCount').textContent = `${logRows.length} baris (sumber: ESP32 via ${CONFIG.HTTP_ENDPOINT})`;
}
document.getElementById('btnExport').onclick = ()=>{
  if(!logRows.length){ alert('Belum ada data untuk di-export (sensor belum terpasang).'); return; }
  const csv = 'waktu,node,protokol,suhu_C,ph,level_cm,status\n' + logRows.map(r=>[r.t,r.node,r.proto,r.s,r.ph,r.lv,r.st].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'silele_log_'+Date.now()+'.csv'; a.click();
};

// =====================================================================
// BAGIAN 9 — PILIH 1 CARA AMBIL DATA ★ [TODO - AKTIFKAN SALAH SATU DI SINI]
// ---------------------------------------------------------------------
// HAPUS komentar (/* */) pada SALAH SATU blok di bawah setelah backend siap.
// OPSI A: HTTP polling (paling mudah, cocok untuk HTTP server / REST API)
// OPSI B: WebSocket (real-time dua arah)
// OPSI C: MQTT via WebSocket (perlu tambah library mqtt.js di index.html)
// OPSI D: Input manual (untuk tes tanpa perangkat — JANGAN dipakai produksi)
// Saat ini SEMUA opsi dimatikan -> dashboard tetap kosong (sesuai permintaan).
// =====================================================================

/* ----- OPSI A: HTTP POLLING [TODO: hapus pembuka/penutup komentar ini untuk memakai] -----
setInterval(async () => {
  // [TODO - ISI DI SINI] pastikan CONFIG.HTTP_ENDPOINT sudah diisi di BAGIAN 0
  try {
    const res = await fetch(CONFIG.HTTP_ENDPOINT); // contoh: GET http://192.168.0.40:3000/api/sensor
    const j = await res.json();
    // [TODO - SESUAIKAN FIELD] samakan dengan JSON dari server Anda:
    // Misal server kirim {"suhu":28.5,"ph":7.4,"level_cm":72,"protocol":"HTTP"}
    updateDashboard({
      suhu: j.suhu,          // <- [TODO] ganti nama field jika beda (misal j.temperature)
      ph: j.ph,              // <- [TODO] ganti jika beda (misal j.ph_value)
      level: j.level_cm,     // <- [TODO] ganti jika beda (misal j.water_level)
      protocol: j.protocol || 'HTTP',
    });
  } catch(e){ console.warn('HTTP belum tersedia:', e.message); }
}, CONFIG.POLLING_INTERVAL_DETIK * 1000);
----- AKHIR OPSI A ----- */

/* ----- OPSI B: WEBSOCKET [TODO: hapus pembuka/penutup komentar ini untuk memakai] -----
// [TODO - ISI DI SINI] pastikan CONFIG.WS_URL sudah diisi di BAGIAN 0
const socket = new WebSocket(CONFIG.WS_URL);
socket.onmessage = (ev) => {
  const j = JSON.parse(ev.data);
  // [TODO - SESUAIKAN FIELD] samakan dengan payload ESP32:
  updateDashboard({ suhu: j.suhu, ph: j.ph, level: j.level_cm, protocol: 'WS' });
};
socket.onerror = (e) => console.warn('WebSocket belum tersedia', e);
----- AKHIR OPSI B ----- */

/* ----- OPSI C: MQTT (butuh mqtt.js) [TODO: tambah <script src="https://unpkg.com/mqtt/dist/mqtt.min.js"> di index.html lalu aktifkan ini] -----
// const client = mqtt.connect(CONFIG.MQTT_BROKER); // [TODO] isi BROKER + TOPIC di BAGIAN 0
// client.on('connect', () => client.subscribe(CONFIG.MQTT_TOPIC));
// client.on('message', (topic, msg) => {
//   const j = JSON.parse(msg.toString());
//   updateDashboard({ suhu: j.suhu, ph: j.ph, level: j.level_cm, protocol: 'MQTT' });
// });
----- AKHIR OPSI C ----- */

/* ----- OPSI D: TES MANUAL TANPA SENSOR (sementara saja) -----
   [TODO] Untuk cek tampilan sebelum sensor datang, jalankan baris ini di Console browser:
     updateDashboard({ suhu: 28.5, ph: 7.4, level: 72, protocol: 'MQTT' });
     updateDashboard({ suhu: 27.9, ph: 7.1, level: 70, protocol: 'HTTP' });
     updateDashboard({ suhu: 28.2, ph: 7.6, level: 74, protocol: 'WS' });
   Hapus / jangan pakai saat sensor asli sudah terpasang.
----- AKHIR OPSI D ----- */

// Status awal: pastikan kartu tetap "--" dan banner mode kosong
document.getElementById('intervalRange').oninput = e=>{
  document.getElementById('intervalLabel').textContent = e.target.value;
  // [CATATAN] slider interval hanya hiasan selama sensor belum terpasang.
  // Setelah pakai OPSI A, atur interval di CONFIG.POLLING_INTERVAL_DETIK (BAGIAN 0).
};

// =====================================================================
// BAGIAN 11 — TAMBAHAN: Google Maps + Mode Gelap/Terang (tidak mengubah BAGIAN 0-10)
// ---------------------------------------------------------------------
// - MAPS: ubah QUERY_MAPS bila titik kolam pindah. iframe #gmapFrame +
//   semua link maps di .map-mini disinkron otomatis.
// - TEMA: tombol #btnTheme ganti atribut data-theme di <html>, tersimpan di
//   localStorage ('silele-theme'). Warna ApexCharts ikut disesuaikan.
// =====================================================================
const QUERY_MAPS = 'Jl. Prof. Dr. G.A Siwabessy Kukusan Beji Kota Depok, Jawa Barat 16242, Kukusan, Kecamatan Beji, Kota Depok, Jawa Barat 16425'; // [TODO] ganti bila lokasi kolam pindah
const GMAPS_LINK = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(QUERY_MAPS);
const GMAPS_EMBED = 'https://maps.google.com/maps?q=' + encodeURIComponent(QUERY_MAPS) + '&t=&z=16&ie=UTF8&iwloc=&output=embed';

(function initMaps(){
  const frame = document.getElementById('gmapFrame');
  if (frame && !frame.dataset.custom) frame.src = GMAPS_EMBED;
  document.querySelectorAll('.map-mini a[href*="google.com/maps"]').forEach(a => { a.href = GMAPS_LINK; });
  const addr = document.getElementById('mapsAddress');
  if (addr) addr.textContent = QUERY_MAPS;
})();

(function(){
  const root = document.documentElement;
  const btn = document.getElementById('btnTheme');
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if(!btn) return;

  function applyCharts(theme){
    try{
      const fore = theme === 'dark' ? '#e2e8f0' : '#373d3f';
      const grid = theme === 'dark' ? '#243a52' : '#e5e7eb';
      const tip = theme === 'dark' ? 'dark' : 'light';
      [gSuhu,gPh,gLevel,chSuhu,chPh,chLevel,chDelay,chJitter,chLoss,chTput].forEach(c=>{
        if(c && c.updateOptions) c.updateOptions({ chart:{foreColor:fore}, grid:{borderColor:grid}, tooltip:{theme:tip} }, false, false);
      });
      if(chEff && chEff.updateOptions) chEff.updateOptions({ chart:{foreColor:fore}, grid:{borderColor:grid}, tooltip:{theme:tip} }, false, false);
    }catch(e){}
  }
  function paint(theme){
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    try{ localStorage.setItem('silele-theme', theme); }catch(e){}
    const dark = theme === 'dark';
    if(icon) icon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if(label) label.textContent = dark ? 'Terang' : 'Gelap';
    applyCharts(theme);
  }
  let init = 'light';
  try{ init = localStorage.getItem('silele-theme') || 'light'; }catch(e){}
  if(init !== 'dark' && init !== 'light') init = 'light';
  paint(init);
  btn.onclick = ()=> paint(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
})();

// =====================================================================
// BAGIAN 12 — RESPONSIVE DRAWER (HP/Tablet) — tidak mengubah BAGIAN 0-11
// ---------------------------------------------------------------------
// - #btnMenu membuka/menutup #sidebar di layar <=1100px
// - Klik nav / overlay / ESC menutup drawer, lalu refresh chart via resize
(function(){
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sideOverlay');
  const menuBtn = document.getElementById('btnMenu');
  if(!sidebar || !menuBtn) return;
  const close = ()=>{
    sidebar.classList.remove('open');
    if(overlay) overlay.classList.remove('show');
  };
  const open = ()=>{
    sidebar.classList.add('open');
    if(overlay) overlay.classList.add('show');
  };
  menuBtn.onclick = (e)=>{
    e.stopPropagation();
    if(sidebar.classList.contains('open')) close();
    else open();
    setTimeout(()=>window.dispatchEvent(new Event('resize')), 300);
  };
  if(overlay) overlay.onclick = close;
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(window.innerWidth <= 1100) close();
      setTimeout(()=>window.dispatchEvent(new Event('resize')), 80);
    });
  });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') close(); });
  window.addEventListener('resize', ()=>{
    if(window.innerWidth > 1100) close();
  });
})();

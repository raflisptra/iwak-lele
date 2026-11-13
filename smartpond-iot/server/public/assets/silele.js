/* SiLele asli dari iwak-lele.rar, diadaptasi untuk Smart Pond Node.js + SQLite.
   Ketiga protokol diterima server dahulu; browser HANYA memanggil API baca.
   Authentication wajib dijalankan di Node.js, bukan password yang ditulis di browser. */
'use strict';
const CONFIG = {
  API_LATEST:'/api/latest', API_HISTORY:'/api/history',
  POLLING_INTERVAL_DETIK:2, HISTORY_INTERVAL_DETIK:10,
  STALE_AFTER_SECONDS:25, HISTORY_LIMIT:120, CHART_POINTS:50
};
const NODES = [
  {id:'mqtt-01', protocol:'MQTT', label:'ESP32 MQTT', ui:'mqtt'},
  {id:'http-01', protocol:'HTTP', label:'ESP32 HTTP', ui:'http'},
  {id:'ws-01', protocol:'WebSocket', label:'ESP32 WebSocket', ui:'ws'}
];
const $ = id=>document.getElementById(id);
const isNumber=v=>typeof v==='number' && Number.isFinite(v);
const shown=(v,d=1)=>isNumber(v)?v.toFixed(d):'--';
const when=iso=>{const d=new Date(iso);return Number.isFinite(+d)?d.toLocaleString('id-ID'):'--';};
const fresh=row=>row && Number.isFinite(Date.parse(row.received_at)) && Date.now()-Date.parse(row.received_at)<CONFIG.STALE_AFTER_SECONDS*1000 && Date.now()>=Date.parse(row.received_at)-5000;

// Navigasi & jam tetap mengikuti rancangan asli SiLele.
document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.target).classList.add('active');
    $('pageTitle').textContent=btn.textContent.trim();
    setTimeout(()=>window.dispatchEvent(new Event('resize')),50);
  };
});
function updateClock(){ $('clock').textContent=new Date().toLocaleString('id-ID',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
updateClock(); setInterval(updateClock,1000);

// ---------- 4. BATAS IDEAL (KKP) + TIPHON — tidak perlu diisi (ubah jika standar berubah) ----------
const IDEAL = { suhuMin: 25, suhuMax: 30, phMin: 7, phMax: 8, lvlMin: 0, lvlMax: 100 };
function tiphonDelay(ms)  { if (ms == null) return ['-', '']; if (ms < 150) return ['Sangat Baik','sb']; if (ms <= 300) return ['Baik','b']; if (ms <= 450) return ['Sedang','s']; return ['Buruk','bu']; }
function tiphonJitter(ms) { if (ms == null) return ['-', '']; if (ms <= 0.5) return ['Sangat Baik','sb']; if (ms <= 75) return ['Baik','b']; if (ms <= 125) return ['Sedang','s']; return ['Buruk','bu']; }
function tiphonLoss(p)    { if (p == null) return ['-', '']; if (p <= 0.01) return ['Sangat Baik','sb']; if (p <= 3) return ['Baik','b']; if (p <= 15) return ['Sedang','s']; return ['Buruk','bu']; }
function statusSuhu(v){ if (v == null) return 'Menunggu sensor…'; return (v >= IDEAL.suhuMin && v <= IDEAL.suhuMax) ? 'Ideal' : (v < IDEAL.suhuMin ? 'Terlalu Dingin' : 'Terlalu Panas'); }
function statusPh(v){ if (v == null) return 'Menunggu sensor…'; return (v >= IDEAL.phMin && v <= IDEAL.phMax) ? 'Ideal' : (v < IDEAL.phMin ? 'Terlalu Asam' : 'Terlalu Basa'); }
function statusLevel(v){ if(v == null) return 'Belum valid'; return (v >= 0 && v <= 100) ? 'Terukur' : 'Di luar rentang'; }
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


// Kartu radial: angka utama di kartu adalah satuan sensor; ring chart adalah persentase skala.
function gauge(el,color,formatter) {
  const c=new ApexCharts(document.querySelector(el),{
    chart:{type:'radialBar',height:150,sparkline:{enabled:true}},series:[0],
    plotOptions:{radialBar:{hollow:{size:'55%'},track:{background:'#e8eef4'},dataLabels:{name:{show:false},value:{fontSize:'16px',fontWeight:800,formatter}}}},
    colors:[color],stroke:{lineCap:'round'}
  }); c.render(); return c;
}
const gSuhu=gauge('#gaugeSuhu','#ef4444',p=>(p*40/100).toFixed(1)+'°C');
const gPh=gauge('#gaugePh','#8b5cf6',p=>(p*14/100).toFixed(2)+' pH');
const gLevel=gauge('#gaugeLevel','#0ea5e9',p=>p.toFixed(1)+'%');
function lineChart(el, title, colors, min, max, annotations, chartType='line') {
  const c=new ApexCharts(document.querySelector(el),{
    chart:{type:chartType,height:290,animations:{enabled:false},toolbar:{show:true},zoom:{enabled:true}},
    series:NODES.map(n=>({name:n.label,data:[]})),colors,
    xaxis:{type:'datetime',labels:{datetimeUTC:false}},
    yaxis:{min,max,decimalsInFloat:1},title:{text:title,style:{fontSize:'12px'}},
    stroke:{curve:'smooth',width:2},markers:{size:2},legend:{position:'top'},grid:{strokeDashArray:4},
    tooltip:{shared:false,x:{format:'dd MMM yyyy HH:mm:ss'}},annotations:annotations||{}
  }); c.render(); return c;
}
const chSuhu=lineChart('#chartSuhu','Suhu (°C)', ['#0e7c5b','#f59e0b','#0ea5e9'],20,40,{yaxis:[{y:25,y2:30,fillColor:'#16a34a',opacity:.12,label:{text:'Referensi 25–30°C'}}]});
const chPh=lineChart('#chartPh','pH (hanya nilai yang diterima backend)', ['#8b5cf6','#ec4899','#6366f1'],0,14,{yaxis:[{y:7,y2:8,fillColor:'#16a34a',opacity:.12,label:{text:'Referensi pH 7–8'}}]});
const chLevel=lineChart('#chartLevel','Level relatif (%)', ['#0ea5e9','#f59e0b','#16a34a'],0,100,undefined,'area');

// ---------- TABEL + GRAFIK QoS (otomatis kosong bila DATA_QOS masih null) ----------
const protos = ['MQTT','HTTP','WS'];
const qosColors = ['#0e7c5b','#f59e0b','#0ea5e9'];
function barChart(el, title, getVal){
  const c = new ApexCharts(document.querySelector(el), {
    chart:{type:'bar',height:280,toolbar:{show:true},animations:{enabled:false}},
    series: protos.map(p=>({name:p, data: SCENARIOS.map(s=>getVal(s.id,p) ?? null)})),
    colors: qosColors, xaxis:{categories: SCENARIOS.map(s=>s.id)},
    plotOptions:{bar:{columnWidth:'55%',borderRadius:5}},
    dataLabels:{enabled:false}, legend:{position:'top'},
    title:{text:title + ' (belum ada PCAP)', style:{fontSize:'13px'}}
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
      {name:'Response time (ms)', data: protos.map(p=>d[p].r ?? null)},
      {name:'Goodput (kbps)', data: protos.map(p=>d[p].g ?? null)},
      {name:'Overhead (%)', data: protos.map(p=>d[p].o ?? null)},
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
    }).join('') + `</tbody><tfoot><tr><td colspan="11" style="text-align:left;color:#6b7d90">Belum ada hasil pengujian PCAP. Angka kosong bukan berarti 0.</td></tr></tfoot>`;
}
sel.onchange = ()=>{ renderQosTable(sel.value); renderEfficiency(sel.value); };
sel.value = SCENARIOS[0].id;
renderQosTable(sel.value);
renderEfficiency(sel.value);
document.getElementById('scenarioTable').innerHTML = SCENARIOS.map(s=>
  `<tr><td>${s.nomorProposal}</td><td>${s.kelompokLabel}</td><td><b>${s.nama}</b> <small>(${s.id})</small></td><td>${s.rekayasa}</td><td>${s.aesLabel}</td><td>${s.protokol}</td><td>Belum ada hasil PCAP</td></tr>`
).join('');


// Monitoring actual: status dari timestamp terakhir, bukan label ON statis.
const latest=new Map();
const history=new Map(NODES.map(n=>[n.id,[]]));
let selectedNode='mqtt-01';
let latestWorking=false, historyWorking=false;
const knownNode = id=>NODES.find(n=>n.id===id);
function setText(id,value){const e=$(id);if(e)e.textContent=String(value);}
function setBanner(msg,level='warn') {const e=$('alertBanner');e.className='alert-banner '+level;setText('alertText',msg);}
function checkReading(row) {
  if(!row) return 'Belum ada pembacaan';
  if(!isNumber(row.temperature_c)||!isNumber(row.ph)||!isNumber(row.water_level_pct)) return 'Ada sensor belum valid';
  if(row.temperature_c<IDEAL.suhuMin||row.temperature_c>IDEAL.suhuMax||row.ph<IDEAL.phMin||row.ph>IDEAL.phMax)return 'Periksa kualitas air';
  return 'Terbaca';
}
function renderNodeStatus(){
  const summaries=$('nodeSummaries'); if(!summaries)return;
  summaries.replaceChildren();
  NODES.forEach(n=>{
    const row=latest.get(n.id), online=Boolean(fresh(row));
    const status=$('proto-'+n.ui),dot=$('dot-'+n.ui);
    if(status)status.textContent=online?'ON':'OFF';
    if(dot){dot.classList.toggle('ok',online);dot.classList.toggle('off',!online);}
    const box=document.createElement('div');box.className='silele-node-summary'+(online?'':' is-offline');
    const title=document.createElement('strong');title.textContent=n.label+' · '+(online?'Online':'Offline');box.appendChild(title);
    const reading=document.createElement('p');reading.textContent=row?`Suhu ${shown(row.temperature_c)}°C · pH ${shown(row.ph,2)} · Level ${shown(row.water_level_pct)}%`:'Belum ada data sensor';box.appendChild(reading);
    const date=document.createElement('small');date.textContent=row?`Terakhir: ${when(row.received_at)} · AES ${row.encrypted?'ON':'OFF'}`:'Menunggu pembacaan';box.appendChild(date);
    summaries.appendChild(box);
  });
}
function renderSelected(){
  const row=latest.get(selectedNode), node=knownNode(selectedNode);
  setText('selectedNodeStatus',!row?'Belum ada data':fresh(row)?'Online • '+when(row.received_at):'Offline • terakhir '+when(row.received_at));
  $('selectedNodeStatus').className='silele-node-state '+(fresh(row)?'is-on':'is-off');
  const temp=row?.temperature_c, ph=row?.ph,level=row?.water_level_pct;
  setText('valSuhu',shown(temp,2));setText('valPh',shown(ph,2));setText('valLevel',shown(level,1));
  setText('statSuhu',statusSuhu(temp));setText('statPh',statusPh(ph));setText('statLevel',statusLevel(level));
  gSuhu.updateSeries([isNumber(temp)?Math.max(0,Math.min(100,temp/40*100)):0]);
  gPh.updateSeries([isNumber(ph)?Math.max(0,Math.min(100,ph/14*100)):0]);
  gLevel.updateSeries([isNumber(level)?Math.max(0,Math.min(100,level)):0]);
  if(!row) setBanner(`${node.label}: belum ada data dari server.`);
  else if(!fresh(row)) setBanner(`${node.label}: data terakhir sudah lebih dari ${CONFIG.STALE_AFTER_SECONDS} detik. Periksa koneksi ESP32.`);
  else if([temp,ph,level].some(v=>!isNumber(v)))setBanner(`${node.label}: sensor belum valid. Nilai kosong tidak dianggap nol. Periksa kalibrasi pH/level.`);
  else if(checkReading(row)==='Periksa kualitas air')setBanner(`${node.label}: suhu atau pH di luar rentang referensi. Pastikan sensor sudah dikalibrasi.`,'bad');
  else setBanner(`${node.label}: data diterima ${when(row.received_at)}. Kondisi pembacaan tersedia.`,'ok');
  setText('payloadPreview',row?JSON.stringify({node_id:row.node_id,protocol:row.protocol,boot_id:row.boot_id,seq:row.seq,encrypted:Boolean(row.encrypted),received_at:row.received_at,data:{temperature_c:row.temperature_c,ph:row.ph,water_level_pct:row.water_level_pct}},null,2):'// Menunggu data node '+selectedNode);
}
function mapSeries(field) {
  const show={MQTT:$('sim-mqtt')?.checked??true,HTTP:$('sim-http')?.checked??true,WebSocket:$('sim-ws')?.checked??true};
  return NODES.filter(n=>show[n.protocol]).map(n=>({
    name:n.label,
    data:(history.get(n.id)||[]).filter(r=>Number.isFinite(Date.parse(r.received_at))).slice(-CONFIG.CHART_POINTS).map(r=>({x:Date.parse(r.received_at),y:isNumber(r[field])?r[field]:null}))
  }));
}
function renderCharts(){
  chSuhu.updateSeries(mapSeries('temperature_c'));
  chPh.updateSeries(mapSeries('ph'));
  chLevel.updateSeries(mapSeries('water_level_pct'));
}
function cell(text){const td=document.createElement('td');td.textContent=String(text);return td;}
let logRows=[];
function renderLog(){
  const all=NODES.flatMap(n=>history.get(n.id)||[]);
  all.sort((a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at)||Number(b.id)-Number(a.id));
  logRows=all.slice(0,60);
  const body=$('logBody');body.replaceChildren();
  if(!logRows.length){const tr=document.createElement('tr'),td=cell('Belum ada data sensor tersimpan.');td.colSpan=7;tr.appendChild(td);body.appendChild(tr);}
  for(const r of logRows){
    const tr=document.createElement('tr');
    const values=[when(r.received_at),r.node_id,r.protocol,shown(r.temperature_c,2),shown(r.ph,2),shown(r.water_level_pct,1),checkReading(r)];
    values.forEach(v=>tr.appendChild(cell(v)));body.appendChild(tr);
  }
  setText('logCount',`${logRows.length} baris terbaru (sumber: SQLite melalui API)`);
}
$('btnExport').onclick=()=>{
  if(!logRows.length){alert('Belum ada data untuk diekspor.');return;}
  const rows=[['received_at','node_id','protocol','temperature_c','ph','water_level_pct','encrypted','seq'],...logRows.map(r=>[r.received_at,r.node_id,r.protocol,r.temperature_c,r.ph,r.water_level_pct,r.encrypted,r.seq])];
  const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`silele-sensor-${Date.now()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('nodeSelect').onchange=e=>{selectedNode=e.target.value;renderSelected();};
for(const n of NODES){$('sim-'+n.ui).addEventListener('change',renderCharts);}
function loginRedirect(r){if(r.status===401){location.assign('/login');throw new Error('Session kedaluwarsa, silakan login lagi.');}}
async function pollLatest(){
  if(latestWorking)return;latestWorking=true;
  try{
    const resp=await fetch(CONFIG.API_LATEST,{cache:'no-store',credentials:'same-origin'});
    loginRedirect(resp); if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
    const value=await resp.json();if(!Array.isArray(value.nodes))throw new Error('Format API terbaru salah');
    for(const r of value.nodes){if(knownNode(r.node_id))latest.set(r.node_id,r);}
    renderNodeStatus();renderSelected();
  }catch(err){console.warn('SiLele API latest:',err.message);setBanner('Backend tidak dapat dihubungi. Data mungkin sudah tidak terbaru.');}
  finally{latestWorking=false;}
}
async function pollHistory(){
  if(historyWorking)return;historyWorking=true;
  try{
    const responses=await Promise.all(NODES.map(n=>fetch(`${CONFIG.API_HISTORY}?node_id=${encodeURIComponent(n.id)}&limit=${CONFIG.HISTORY_LIMIT}`,{cache:'no-store',credentials:'same-origin'})));
    const values=[];
    for(const r of responses){loginRedirect(r);if(!r.ok)throw new Error(`HTTP ${r.status}`);values.push(await r.json());}
    values.forEach((v,i)=>{if(!Array.isArray(v.rows))throw new Error('Riwayat API tidak sesuai');history.set(NODES[i].id,[...v.rows].reverse());});
    renderCharts();renderLog();
  }catch(err){console.warn('SiLele API history:',err.message);}
  finally{historyWorking=false;}
}
$('intervalRange').value=String(CONFIG.POLLING_INTERVAL_DETIK);
$('intervalLabel').textContent=String(CONFIG.POLLING_INTERVAL_DETIK);
$('intervalRange').oninput=e=>{
  // Pengaturan ini hanya untuk refresh browser. Interval ESP32 tidak berubah.
  CONFIG.POLLING_INTERVAL_DETIK=Math.max(1,Math.min(10,Number(e.target.value)||2));
  setText('intervalLabel',CONFIG.POLLING_INTERVAL_DETIK);
};
pollLatest(); pollHistory();
let lastLatestPoll=Date.now();
let lastHistoryPoll=Date.now();
setInterval(()=>{
  const now=Date.now();
  if(now-lastLatestPoll>=CONFIG.POLLING_INTERVAL_DETIK*1000){lastLatestPoll=now;pollLatest();}
  if(now-lastHistoryPoll>=CONFIG.HISTORY_INTERVAL_DETIK*1000){lastHistoryPoll=now;pollHistory();}
},1000);
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

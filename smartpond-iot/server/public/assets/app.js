const DEVICES = [
  { id: 'mqtt-01', name: 'MQTT', node: 'ESP32-01' },
  { id: 'http-01', name: 'HTTP', node: 'ESP32-02' },
  { id: 'ws-01', name: 'WebSocket', node: 'ESP32-03' },
];
const grid = document.querySelector('#node-grid');
const historyBody = document.querySelector('#history-body');
const nodeSelect = document.querySelector('#node-select');
const timeText = (date) => date ? new Date(date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' }) : 'Belum ada data';
const reading = (value, unit = '') => value == null ? '—' : `${Number(value).toFixed(1)}${unit ? ` ${unit}` : ''}`;
function metric(label, value, unit) {
  const box = document.createElement('div'); box.className = 'metric';
  const caption = document.createElement('p'); caption.className = 'metric-label'; caption.textContent = label;
  const number = document.createElement('div'); number.className = 'metric-value'; number.textContent = reading(value);
  if (value != null && unit) { const suffix = document.createElement('span'); suffix.className = 'metric-unit'; suffix.textContent = unit; number.append(suffix); }
  box.append(caption, number); return box;
}
function updateCards(rows) {
  const byNode = new Map(rows.map(r => [r.node_id, r]));
  grid.replaceChildren();
  for (const device of DEVICES) {
    const row = byNode.get(device.id);
    const recent = row && (Date.now() - Date.parse(row.received_at) < 15000);
    const card = document.createElement('article'); card.className = 'node-card';
    const top = document.createElement('div'); top.className = 'node-top';
    const protocol = document.createElement('div'); protocol.className = 'protocol';
    const dot = document.createElement('span'); dot.className = 'proto-dot';
    const label = document.createElement('span'); label.textContent = device.name;
    protocol.append(dot, label);
    const status = document.createElement('span'); status.className = `status ${recent ? 'ok' : ''}`; status.textContent = recent ? 'Data aktif' : row ? 'Data lama' : 'Belum terhubung';
    top.append(protocol, status);
    const ident = document.createElement('p'); ident.className = 'node-id'; ident.textContent = device.node + ' · ' + device.id;
    const metrics = document.createElement('div'); metrics.className = 'metrics';
    metrics.append(metric('Suhu air', row?.temperature_c, '°C'), metric('pH air', row?.ph, 'pH'), metric('Ketinggian air', row?.water_level_pct, '%'));
    const bottom = document.createElement('div'); bottom.className = 'node-bottom';
    const seen = document.createElement('span'); seen.textContent = timeText(row?.received_at);
    const enc = document.createElement('span'); enc.textContent = row ? (row.encrypted ? 'AES-256-GCM' : 'Plain JSON') : '—';
    bottom.append(seen, enc); card.append(top, ident, metrics, bottom); grid.append(card);
  }
}
async function loadLatest() {
  try {
    const response = await fetch('/api/latest', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json(); updateCards(data.nodes);
    document.querySelector('#api-dot').classList.add('online');
    document.querySelector('#api-status').textContent = 'Server online';
    document.querySelector('#last-update').textContent = data.nodes.length ? timeText(data.nodes.reduce((latest, row) => Date.parse(row.received_at) > Date.parse(latest) ? row.received_at : latest, data.nodes[0].received_at)) : 'Belum ada data';
  } catch (error) {
    document.querySelector('#api-dot').classList.remove('online');
    document.querySelector('#api-status').textContent = 'Server tidak terjangkau';
    console.error(error);
  }
}
async function loadHistory() {
  try {
    const response = await fetch(`/api/history?node_id=${encodeURIComponent(nodeSelect.value)}&limit=25`, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json(); historyBody.replaceChildren();
    if (!data.rows.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 7; td.className = 'empty'; td.textContent = 'Belum ada data sensor'; tr.append(td); historyBody.append(tr); return;
    }
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      for (const value of [timeText(row.received_at), String(row.seq), reading(row.temperature_c, '°C'), reading(row.ph), reading(row.water_level_pct, '%'), row.encrypted ? 'Aktif' : 'Nonaktif', String(row.payload_bytes)]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      historyBody.append(tr);
    }
  } catch (error) { console.error(error); }
}
nodeSelect.addEventListener('change', loadHistory);
async function refresh() { await Promise.all([loadLatest(), loadHistory()]); }
refresh(); setInterval(refresh, 3000);

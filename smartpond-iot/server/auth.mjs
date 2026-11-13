// SiLele authentication extension. No browser-side passwords and no MQTT credential reuse.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';

const scrypt = promisify(crypto.scrypt);
const N = 131072; // OWASP scrypt alternative: 2^17, r=8, p=1.
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const MAXMEM = 256 * 1024 * 1024;
const COOKIE_NAME = 'silele_sid';
const ABSOLUTE_TTL = 12 * 60 * 60 * 1000;
const IDLE_TTL = 30 * 60 * 1000;
const FAIL_LIMIT = 8;
const FAIL_WINDOW = 15 * 60 * 1000;
const attempts = new Map();

export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) {
    throw new Error('Password harus 14-256 karakter');
  }
  const salt = crypto.randomBytes(24);
  const output = await scrypt(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${output.toString('hex')}`;
}

export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 256 || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashedHex] = parts;
  if (+n !== N || +r !== R || +p !== P || !/^[a-f0-9]{48}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(hashedHex)) return false;
  const target = Buffer.from(hashedHex, 'hex');
  const result = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return crypto.timingSafeEqual(result, target);
}

function getCookie(req, name) {
  const header = String(req.headers.cookie || '');
  for (const pair of header.split(';')) {
    const [key, ...value] = pair.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function safeCookie(value, secure, maxAge = Math.floor(ABSOLUTE_TTL / 1000)) {
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
function checkOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.get('host') && (parsed.protocol === 'https:' || parsed.protocol === 'http:');
  } catch { return false; }
}
function rateLimited(ip) {
  const now = Date.now();
  if (attempts.size > 5000) {
    for (const [key, value] of attempts) if (now - value.start > FAIL_WINDOW) attempts.delete(key);
  }
  const existing = attempts.get(ip);
  if (!existing || now - existing.start > FAIL_WINDOW) {
    attempts.set(ip, { start: now, count: 0 });
    return false;
  }
  return existing.count >= FAIL_LIMIT;
}
function countFailure(ip) {
  const entry = attempts.get(ip) || { start: Date.now(), count: 0 };
  entry.count++;
  attempts.set(ip, entry);
}

export function installAuth(app, db, dirname) {
  const secure = process.env.COOKIE_SECURE !== 'false';
  if (!secure) {
    if (process.env.NODE_ENV === 'production') throw new Error('COOKIE_SECURE=false dilarang saat NODE_ENV=production');
    console.warn('PERINGATAN: COOKIE_SECURE=false hanya untuk uji LAN HTTP; jangan gunakan untuk akses publik.');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS silele_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS silele_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES silele_users(id),
      created_at_ms INTEGER NOT NULL,
      last_seen_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_silele_sessions_user ON silele_sessions(user_id);
  `);
  const getSession = db.prepare(`SELECT s.token_hash,s.user_id,s.last_seen_ms,s.expires_at_ms,u.username,u.role
    FROM silele_sessions s JOIN silele_users u ON u.id=s.user_id WHERE s.token_hash=?`);
  const touchSession = db.prepare('UPDATE silele_sessions SET last_seen_ms=? WHERE token_hash=?');
  const deleteSession = db.prepare('DELETE FROM silele_sessions WHERE token_hash=?');
  const addSession = db.prepare('INSERT INTO silele_sessions(token_hash,user_id,created_at_ms,last_seen_ms,expires_at_ms) VALUES(?,?,?,?,?)');
  const getUser = db.prepare('SELECT id,username,password_hash,role FROM silele_users WHERE username=?');
  // For apps using a single Node.js process: minimal periodic cleanup on authentication.
  let lastSweep = 0;
  function authenticated(req) {
    const token = getCookie(req, COOKIE_NAME);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const now = Date.now();
    if (now - lastSweep > 5 * 60 * 1000) {
      db.prepare('DELETE FROM silele_sessions WHERE expires_at_ms < ? OR last_seen_ms < ?').run(now, now - IDLE_TTL);
      lastSweep = now;
    }
    const tokenHash = hashToken(token);
    const session = getSession.get(tokenHash);
    if (!session) return null;
    if (session.expires_at_ms <= now || now - session.last_seen_ms > IDLE_TTL) {
      deleteSession.run(tokenHash);
      return null;
    }
    if (now - session.last_seen_ms > 60_000) touchSession.run(now, tokenHash);
    return { id: session.user_id, username: session.username, role: session.role, sessionHash: tokenHash };
  }
  function requireLogin(req, res, next) {
    const user = authenticated(req);
    if (!user) {
      res.setHeader('Cache-Control', 'no-store');
      if (req.baseUrl === '/api' || (req.originalUrl || '').startsWith('/api/')) return res.status(401).json({ error: 'login_required' });
      return res.redirect(303, '/login');
    }
    req.sileleUser = user;
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
  function requireOrigin(req, res, next) {
    if (!checkOrigin(req)) return res.status(403).json({ error: 'Permintaan lintas situs ditolak' });
    next();
  }
  app.get('/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'");
    if (authenticated(req)) return res.redirect(303, '/');
    return res.sendFile(path.join(dirname, 'public', 'login.html'));
  });
  app.post('/auth/login', requireOrigin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { username, password } = req.body || {};
    const key = `${req.socket.remoteAddress || 'unknown'}:${String(username || '').slice(0,40).toLowerCase()}`;
    if (rateLimited(key)) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi dalam 15 menit.' });
    if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,40}$/.test(username) || typeof password !== 'string' || password.length > 256) {
      countFailure(key);
      return res.status(401).json({ error: 'Username atau password salah.' });
    }
    let accepted = false;
    let user;
    try {
      user = getUser.get(username);
      // Avoid leaking registered username through noticeably different response time.
      const fake = 'scrypt$131072$8$1$000000000000000000000000000000000000000000000000$' + '00'.repeat(64);
      accepted = await passwordMatches(password, user?.password_hash || fake);
    } catch (err) {
      console.error('Login gagal:', err.message);
      return res.status(500).json({ error: 'Kesalahan server' });
    }
    if (!accepted || !user) {
      countFailure(key);
      return res.status(401).json({ error: 'Username atau password salah.' });
    }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    addSession.run(hashToken(token), user.id, now, now, now + ABSOLUTE_TTL);
    res.setHeader('Set-Cookie', safeCookie(token, secure));
    return res.json({ ok: true, username: user.username, role: user.role });
  });
  app.get('/auth/me', requireLogin, (req, res) => res.json({ username: req.sileleUser.username, role: req.sileleUser.role }));
  app.post('/auth/logout', requireOrigin, (req, res) => {
    const user = authenticated(req);
    if (user) deleteSession.run(user.sessionHash);
    res.setHeader('Set-Cookie', safeCookie('', secure, 0));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });
  // The root dashboard and all read APIs require login. Device endpoints stay independent.
  app.get('/', requireLogin, (_req, _res, next) => next());
  app.get('/index.html', requireLogin, (_req, res) => res.sendFile(path.join(dirname, 'public', 'index.html')));
  app.use('/api', requireLogin);
}

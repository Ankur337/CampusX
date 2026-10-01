// CampusX - campus repair board. Node.js built-in modules only (no npm install needed).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

const CATEGORIES = ['Electrical', 'Plumbing', 'Furniture', 'Equipment', 'Cleanliness', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const STATUSES = ['Reported', 'In Progress', 'Resolved'];

const load = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const save = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function makeUser(name, email, pw, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { id: crypto.randomUUID(), name, email: email.toLowerCase(), salt, hash: hash(pw, salt), role };
}

// Seed first run: one admin and a few sample reports
if (!fs.existsSync(USERS_FILE)) save(USERS_FILE, [makeUser('Facilities Admin', 'admin@campusx.local', 'admin123', 'admin')]);
if (!fs.existsSync(DATA_FILE)) {
  const now = Date.now();
  save(DATA_FILE, [
    { id: crypto.randomUUID(), title: 'Ceiling fan not working', category: 'Electrical', priority: 'High', location: 'Block A - Room 204', description: 'Fan stopped completely. Room gets very hot in the afternoon.', status: 'Reported', votes: [], author: 'Sample Student', createdAt: now - 86400000 * 2 },
    { id: crypto.randomUUID(), title: 'Tap leaking in washroom', category: 'Plumbing', priority: 'Medium', location: 'Library - Ground floor washroom', description: 'Constant dripping from the second tap.', status: 'In Progress', votes: [], author: 'Sample Student', createdAt: now - 86400000 },
    { id: crypto.randomUUID(), title: 'Broken desk in lab', category: 'Furniture', priority: 'Low', location: 'CS Lab 2', description: 'Desk leg is loose and wobbles.', status: 'Resolved', votes: [], author: 'Sample Student', createdAt: now - 86400000 * 5 }
  ]);
}

const sessions = new Map(); // token -> user (cleared when server restarts)

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = req => new Promise(resolve => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});
const getUser = req => {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return m ? sessions.get(m[1]) || null : null;
};
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const startSession = (res, user) => {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user);
  send(res, 200, publicUser(user), { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
};
const makeGuest = () => ({ id: crypto.randomUUID(), name: 'Campus Visitor', email: '', role: 'guest' });
const view = (r, user) => ({ ...r, votes: r.votes.length, voted: user ? r.votes.includes(user.id) : false });
const clean = (v, max) => String(v || '').trim().slice(0, max);

async function api(req, res, url) {
  const user = getUser(req);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /api/register') {
    const b = await readBody(req);
    const name = clean(b.name, 60), email = clean(b.email, 100).toLowerCase(), pw = String(b.password || '');
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Enter your name and a valid email.' });
    if (pw.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });
    const users = load(USERS_FILE, []);
    if (users.some(u => u.email === email)) return send(res, 409, { error: 'An account with this email already exists.' });
    const u = makeUser(name, email, pw, 'student');
    users.push(u); save(USERS_FILE, users);
    return startSession(res, u);
  }
  if (route === 'POST /api/login') {
    const b = await readBody(req);
    const u = load(USERS_FILE, []).find(x => x.email === clean(b.email, 100).toLowerCase());
    if (!u || hash(String(b.password || ''), u.salt) !== u.hash) return send(res, 401, { error: 'Email or password is incorrect.' });
    return startSession(res, u);
  }
  if (route === 'POST /api/logout') {
    const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (m) sessions.delete(m[1]);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
  }
  if (route === 'GET /api/me') return user ? send(res, 200, publicUser(user)) : startSession(res, makeGuest());
  if (route === 'GET /api/meta') return send(res, 200, { CATEGORIES, PRIORITIES, STATUSES });

  const currentUser = user || makeGuest();

  if (route === 'GET /api/reports') {
    return send(res, 200, load(DATA_FILE, []).sort((a, b) => b.createdAt - a.createdAt).map(r => view(r, currentUser)));
  }
  if (route === 'POST /api/reports') {
    const b = await readBody(req);
    const r = {
      id: crypto.randomUUID(), title: clean(b.title, 80), category: b.category, priority: b.priority,
      location: clean(b.location, 80), description: clean(b.description, 500),
      status: 'Reported', votes: [currentUser.id], author: currentUser.name, createdAt: Date.now()
    };
    if (!r.title || !r.location || !r.description) return send(res, 400, { error: 'Title, location and description are required.' });
    if (!CATEGORIES.includes(r.category) || !PRIORITIES.includes(r.priority)) return send(res, 400, { error: 'Choose a valid category and priority.' });
    const all = load(DATA_FILE, []); all.push(r); save(DATA_FILE, all);
    return send(res, 201, view(r, currentUser));
  }
  let m = /^\/api\/reports\/([\w-]+)\/(vote|status)$/.exec(url.pathname);
  if (m) {
    const all = load(DATA_FILE, []);
    const r = all.find(x => x.id === m[1]);
    if (!r) return send(res, 404, { error: 'Report not found.' });
    if (m[2] === 'vote' && req.method === 'POST') {
      const i = r.votes.indexOf(currentUser.id);
      i === -1 ? r.votes.push(user.id) : r.votes.splice(i, 1); // toggle
    } else if (m[2] === 'status' && req.method === 'PATCH') {
      if (currentUser.role !== 'admin') return send(res, 403, { error: 'Only the facilities administrator can change status.' });
      const b = await readBody(req);
      if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Invalid status.' });
      r.status = b.status;
    } else return send(res, 405, { error: 'Method not allowed.' });
    save(DATA_FILE, all);
    return send(res, 200, view(r, currentUser));
  }
  send(res, 404, { error: 'Not found.' });
}

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { error: 'Server error.' }); }
}).listen(PORT, () => console.log(`CampusX running at http://localhost:${PORT}`));

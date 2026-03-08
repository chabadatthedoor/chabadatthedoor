const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');
const path = require('path');

const app = express();
const db = new Database('app.db');
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const initSql = `
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  street_address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  zip TEXT,
  "group" TEXT,
  jewish_status TEXT,
  age_range TEXT,
  route_id INTEGER,
  contact_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  address_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_name TEXT NOT NULL,
  route_type TEXT CHECK(route_type IN ('walking','driving')),
  campaign_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_name TEXT NOT NULL,
  campaign_type TEXT,
  year INTEGER,
  jewish_year TEXT,
  status TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,
  role TEXT CHECK(role IN ('admin','member')) NOT NULL,
  assigned_routes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_id INTEGER,
  user_id INTEGER,
  campaign_id INTEGER,
  visit_result TEXT,
  notes TEXT,
  follow_up INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  action TEXT,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  api_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

db.exec(initSql);

const adminExists = db.prepare("SELECT id FROM users WHERE username='admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username,password_hash,role,assigned_routes) VALUES (?,?,?,?)').run('admin', hash, 'admin', '[]');
}

function logAction(actorUserId, action, details = '') {
  db.prepare('INSERT INTO audit_logs (actor_user_id, action, details) VALUES (?,?,?)').run(actorUserId || null, action, details);
}

function tokenForUser(user) {
  return jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '12h' });
}

function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const token = header.replace('Bearer ', '');
      req.user = jwt.verify(token, JWT_SECRET);
      if (requiredRole && req.user.role !== requiredRole) return res.status(403).json({ error: 'Forbidden' });
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

app.post('/api/auth/member-login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=? AND role IN (\'member\',\'admin\')').get(username);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = tokenForUser(user);
  logAction(user.id, 'member_login', `username:${username}`);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/api/auth/google-login', (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email required' });
  const user = db.prepare('SELECT * FROM users WHERE username=? AND role=\'admin\'').get(email);
  if (!user) return res.status(403).json({ error: 'Admin account not found. Create admin first.' });
  const token = tokenForUser(user);
  logAction(user.id, 'google_login', `email:${email}`);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/me', auth(), (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/dashboard', auth(), (req, res) => {
  const counts = {
    addresses: db.prepare('SELECT COUNT(*) AS c FROM addresses').get().c,
    routes: db.prepare('SELECT COUNT(*) AS c FROM routes').get().c,
    activeCampaigns: db.prepare("SELECT COUNT(*) AS c FROM campaigns WHERE status='Active'").get().c,
    interactions: db.prepare('SELECT COUNT(*) AS c FROM interactions').get().c,
  };
  res.json(counts);
});

app.get('/api/addresses', auth(), (req, res) => {
  const rows = db.prepare(`SELECT a.*, r.route_name,
    (SELECT first_name||' '||last_name FROM contacts c WHERE c.address_id=a.id LIMIT 1) as contact_name,
    (SELECT email FROM contacts c WHERE c.address_id=a.id LIMIT 1) as email,
    (SELECT phone FROM contacts c WHERE c.address_id=a.id LIMIT 1) as phone
    FROM addresses a LEFT JOIN routes r ON a.route_id=r.id ORDER BY a.id DESC`).all();
  res.json(rows);
});

app.post('/api/addresses', auth('admin'), (req, res) => {
  const d = req.body;
  const info = db.prepare('INSERT INTO addresses (street_address,city,state,zip,"group",jewish_status,age_range,route_id,contact_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(d.street_address, d.city, d.state, d.zip, d.group || '', d.jewish_status, d.age_range || '', d.route_id || null, null);
  logAction(req.user.id, 'create_address', d.street_address);
  res.json({ id: info.lastInsertRowid });
});

app.post('/api/addresses/bulk', auth('admin'), (req, res) => {
  const { street, city, state, zip, numbers = [] } = req.body;
  const insert = db.prepare('INSERT INTO addresses (street_address,city,state,zip,jewish_status) VALUES (?,?,?,?,?)');
  const txn = db.transaction((nums) => nums.forEach((n) => insert.run(`${n} ${street}`, city, state, zip, 'Not_sure')));
  txn(numbers);
  logAction(req.user.id, 'bulk_addresses', `${street} (${numbers.length})`);
  res.json({ inserted: numbers.length });
});

app.post('/api/import/csv', auth('admin'), (req, res) => {
  const { csvText } = req.body;
  const records = parse(csvText, { columns: true, skip_empty_lines: true });
  const failed = [];
  let imported = 0;
  const getRoute = db.prepare('SELECT id FROM routes WHERE route_name=?');
  const createRoute = db.prepare('INSERT INTO routes (route_name,route_type,notes) VALUES (?,?,?)');
  const insertAddress = db.prepare('INSERT INTO addresses (street_address,city,state,zip,"group",jewish_status,age_range,route_id) VALUES (?,?,?,?,?,?,?,?)');

  for (const [index, row] of records.entries()) {
    try {
      if (!row.street_address) throw new Error('street_address missing');
      let routeId = null;
      if (row.route) {
        const r = getRoute.get(row.route);
        routeId = r ? r.id : createRoute.run(row.route, 'walking', 'auto-created by import').lastInsertRowid;
      }
      insertAddress.run(row.street_address, row.city || '', row.state || '', row.zip || '', row.group || '', row.jewish_status || 'Not_sure', row.age_range || '', routeId);
      imported++;
    } catch (e) {
      failed.push({ row: index + 2, reason: e.message, data: row });
    }
  }
  logAction(req.user.id, 'csv_import', `imported:${imported},failed:${failed.length}`);
  res.json({ imported, failed });
});

app.get('/api/contacts', auth(), (req, res) => {
  const q = req.query.q;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`SELECT c.*, a.street_address FROM contacts c LEFT JOIN addresses a ON c.address_id=a.id
      WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR notes LIKE ? OR a.street_address LIKE ?`).all(like, like, like, like, like, like);
  } else {
    rows = db.prepare('SELECT c.*, a.street_address FROM contacts c LEFT JOIN addresses a ON c.address_id=a.id ORDER BY c.id DESC').all();
  }
  res.json(rows);
});

app.post('/api/contacts', auth('admin'), (req, res) => {
  const d = req.body;
  const info = db.prepare('INSERT INTO contacts (first_name,last_name,email,phone,address_id,notes) VALUES (?,?,?,?,?,?)').run(d.first_name, d.last_name, d.email, d.phone, d.address_id, d.notes || '');
  logAction(req.user.id, 'create_contact', `${d.first_name} ${d.last_name}`);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/routes', auth(), (req, res) => {
  if (req.user.role === 'member') {
    const user = db.prepare('SELECT assigned_routes FROM users WHERE id=?').get(req.user.id);
    const assigned = JSON.parse(user.assigned_routes || '[]');
    const rows = assigned.length ? db.prepare(`SELECT * FROM routes WHERE id IN (${assigned.map(() => '?').join(',')})`).all(...assigned) : [];
    return res.json(rows);
  }
  res.json(db.prepare('SELECT * FROM routes ORDER BY id DESC').all());
});

app.post('/api/routes', auth('admin'), (req, res) => {
  const d = req.body;
  const info = db.prepare('INSERT INTO routes (route_name,route_type,campaign_id,notes) VALUES (?,?,?,?)').run(d.route_name, d.route_type, d.campaign_id || null, d.notes || '');
  logAction(req.user.id, 'create_route', d.route_name);
  res.json({ id: info.lastInsertRowid });
});

app.post('/api/routes/optimize', auth('admin'), (req, res) => {
  const { filters, walkingRoutes = 0, drivingRoutes = 0 } = req.body;
  let where = '1=1';
  const params = [];
  ['jewish_status', 'group', 'city', 'state', 'zip', 'age_range'].forEach((k) => {
    if (filters[k]) { where += ` AND ${k === 'group' ? '"group"' : k}=?`; params.push(filters[k]); }
  });
  const addresses = db.prepare(`SELECT * FROM addresses WHERE ${where}`).all(...params);
  if (addresses.length < 2) return res.status(400).json({ error: 'Need at least 2 addresses.' });

  const total = walkingRoutes + drivingRoutes;
  const routeIds = [];
  for (let i = 0; i < total; i++) {
    const type = i < walkingRoutes ? 'walking' : 'driving';
    const id = db.prepare('INSERT INTO routes (route_name,route_type,notes) VALUES (?,?,?)').run(`Optimized ${type} ${Date.now()}-${i + 1}`, type, 'generated by optimizer').lastInsertRowid;
    routeIds.push(id);
  }
  addresses.forEach((addr, i) => {
    db.prepare('UPDATE addresses SET route_id=? WHERE id=?').run(routeIds[i % routeIds.length], addr.id);
  });
  logAction(req.user.id, 'optimize_routes', `addresses:${addresses.length}`);
  res.json({ createdRoutes: routeIds.length, addressesAssigned: addresses.length });
});

app.get('/api/campaigns', auth(), (req, res) => {
  res.json(db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all());
});

app.post('/api/campaigns', auth('admin'), (req, res) => {
  const d = req.body;
  const info = db.prepare('INSERT INTO campaigns (campaign_name,campaign_type,year,jewish_year,status) VALUES (?,?,?,?,?)').run(d.campaign_name, d.campaign_type, d.year, d.jewish_year, d.status);
  logAction(req.user.id, 'create_campaign', d.campaign_name);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/interactions', auth(), (req, res) => {
  const rows = req.user.role === 'member'
    ? db.prepare('SELECT * FROM interactions WHERE user_id=? ORDER BY id DESC').all(req.user.id)
    : db.prepare('SELECT * FROM interactions ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/interactions', auth(), (req, res) => {
  const d = req.body;
  const info = db.prepare('INSERT INTO interactions (address_id,user_id,campaign_id,visit_result,notes,follow_up) VALUES (?,?,?,?,?,?)')
    .run(d.address_id, req.user.id, d.campaign_id || null, d.visit_result, d.notes || '', d.follow_up ? 1 : 0);
  logAction(req.user.id, 'submit_duch', `address:${d.address_id}`);
  res.json({ id: info.lastInsertRowid });
});

app.get('/api/admin/users', auth('admin'), (req, res) => {
  res.json(db.prepare('SELECT id,username,role,assigned_routes,created_at FROM users ORDER BY id DESC').all());
});

app.post('/api/admin/users', auth('admin'), (req, res) => {
  const d = req.body;
  const hash = d.password ? bcrypt.hashSync(d.password, 10) : null;
  const info = db.prepare('INSERT INTO users (username,password_hash,role,assigned_routes) VALUES (?,?,?,?)').run(d.username, hash, d.role, JSON.stringify(d.assigned_routes || []));
  logAction(req.user.id, 'create_user', d.username);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/admin/users/:id/routes', auth('admin'), (req, res) => {
  db.prepare('UPDATE users SET assigned_routes=? WHERE id=?').run(JSON.stringify(req.body.assigned_routes || []), req.params.id);
  logAction(req.user.id, 'assign_routes', `user:${req.params.id}`);
  res.json({ ok: true });
});

app.get('/api/admin/audit-logs', auth('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all());
});

app.get('/api/admin/api-keys', auth('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM api_keys ORDER BY id DESC').all());
});

app.post('/api/admin/api-keys', auth('admin'), (req, res) => {
  const key = `ck_${Math.random().toString(36).slice(2)}${Date.now()}`;
  const info = db.prepare('INSERT INTO api_keys (name,api_key) VALUES (?,?)').run(req.body.name || 'Default key', key);
  logAction(req.user.id, 'create_api_key', req.body.name || 'Default key');
  res.json({ id: info.lastInsertRowid, key });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

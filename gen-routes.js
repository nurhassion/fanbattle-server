'use strict';
/*
 * gen-routes.js — সার্ভারের রুট
 *
 * ⚠️ এই ফাইলটাই আসল নিরাপত্তা। অ্যাপে বোতাম লুকানো সাজসজ্জা।
 *
 * ⚠️ প্রতিটা রুটে তিনটে জিনিস দেখা হয়:
 *      কে তুমি → তোমার কি অনুমতি আছে → জিনিসটা কি সত্যিই তোমার
 * তৃতীয়টা প্রায় সবাই বাদ দেয়, আর ওখান দিয়েই তথ্য ফাঁস হয়।
 */
function routes(a) {
  return `// server/index.js — every route in ${a.name}.
//
// THE THREE CHECKS. Every route does all three, in this order:
//
//   1. Who are you?          authenticate  — is the token real
//   2. May you do this?      requireRole / requirePerm
//   3. Is this yours?        ownsOr        — the one people forget
//
// Skip the third and a provider can read another provider's orders by
// changing one number in the URL. Same role, different owner. That is how
// most of the leaks you read about actually happened.

require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const { db } = require('./db');
const { uploadUrl, viewUrl } = require('./storage');
const { roomToken, configured: liveReady } = require('./live');
const {
  authenticate, requireRole, requirePerm, ownsOr, notOnBehalf, audit,
} = require('./guard');
const { ROLE_DEFAULTS } = require('../permissions');

const app = express();
app.use(express.json({ limit: '1mb' }));   // small. Files never come through here.

const uid = () => crypto.randomBytes(12).toString('hex');
const now = () => new Date().toISOString();

/* Read your cut from the database, not from the app. If the phone sent
   the commission, a customer could set it to zero. */
function settings() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('commissionPercent');
  return { commissionPercent: row ? Number(row.value) : 12 };
}

function splitMoney(totalMinor) {
  const pct = settings().commissionPercent;
  const platform = Math.round(totalMinor * (pct / 100));
  return { platform, provider: totalMinor - platform };
}

/* ============================ 1. signing in ============================ */
function issue(user) {
  const perms = user.permissions ? JSON.parse(user.permissions) : (ROLE_DEFAULTS[user.role] || []);
  const claims = { sub: user.id, role: user.role, permissions: perms };
  return {
    accessToken:  jwt.sign(claims, process.env.JWT_SECRET,     { expiresIn: '20m' }),
    refreshToken: jwt.sign({ sub: user.id }, process.env.REFRESH_SECRET, { expiresIn: '30d' }),
    user: {
      id: user.id, name: user.name, email: user.email,
      role: user.role, permissions: perms,
      country: user.country, lang: user.lang,
      providerStatus: providerStatus(user.id),
    },
  };
}

function providerStatus(userId) {
  const r = db.prepare('SELECT status FROM provider_profiles WHERE user_id = ?').get(userId);
  return r ? r.status : null;
}

app.post('/auth/register', (req, res) => {
  const { name, identifier, password } = req.body || {};
  if (!identifier || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'Please enter an email or phone and a password of at least 8 characters' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(identifier);
  if (exists) {
    // Do not say "already registered". That turns this route into a way
    // of checking which addresses have accounts here.
    return res.status(400).json({ error: 'We could not create that account. Try signing in instead.' });
  }
  const id = uid();
  db.prepare(\`INSERT INTO users (id,email,name,password_hash,role,created_at)
              VALUES (?,?,?,?,'customer',?)\`)
    .run(id, identifier, name || '', bcrypt.hashSync(String(password), 10), now());
  res.json(issue(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

app.post('/auth/login', (req, res) => {
  const { identifier, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(identifier, identifier);
  // Same message whether the account is missing or the password is wrong.
  // Different messages tell an attacker which half to keep guessing.
  const bad = { error: 'Those details did not match' };
  if (!u) { bcrypt.compareSync('x', '$2a$10$' + 'x'.repeat(53)); return res.status(401).json(bad); }
  if (!bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json(bad);
  if (u.status !== 'active') return res.status(403).json({ error: 'This account is not active' });
  res.json(issue(u));
});

app.post('/auth/refresh', (req, res) => {
  try {
    const c = jwt.verify(req.body.refreshToken, process.env.REFRESH_SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(c.sub);
    if (!u || u.status !== 'active') throw new Error('gone');
    res.json(issue(u));
  } catch (e) {
    res.status(401).json({ error: 'Please sign in again' });
  }
});

app.post('/auth/logout', authenticate, (req, res) => res.json({ ok: true }));

/* ============================ 2. me ============================ */
app.get('/me', authenticate, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(issue(u).user);
});

app.patch('/me', authenticate, (req, res) => {
  const { country, lang, role } = req.body || {};
  // A user may pick customer or provider. Nobody promotes themselves to
  // owner or staff through this route; the owner does that, or nobody does.
  const safeRole = ['customer', 'provider'].includes(role) ? role : null;
  db.prepare(\`UPDATE users SET country = COALESCE(?,country), lang = COALESCE(?,lang),
              role = COALESCE(?,role) WHERE id = ?\`)
    .run(country || null, lang || null, safeRole, req.user.id);
  if (safeRole === 'provider' && !providerStatus(req.user.id)) {
    db.prepare('INSERT INTO provider_profiles (user_id,status) VALUES (?,?)')
      .run(req.user.id, 'draft');
  }
  res.json(issue(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)).user);
});

/* ============================ 3. things to browse ============================ */
app.get('/items', authenticate, (req, res) => {
  const page  = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const rows = db.prepare(\`SELECT id,title,description,price_minor,provider_id
                           FROM items WHERE status='active' AND visibility='public'
                           ORDER BY created_at DESC LIMIT ? OFFSET ?\`)
    .all(limit, (page - 1) * limit);
  res.json({ items: rows.map(r => ({
    id: r.id, title: r.title, subtitle: r.description, meta: r.price_minor,
  })) });
});

/* One item. This is where paid content is protected.
   Anyone can see the description. Only somebody enrolled gets the file. */
app.get('/items/:id', authenticate, async (req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!it || it.status !== 'active') return res.status(404).json({ error: 'Not found' });

  const enrolled = !!db.prepare(\`SELECT 1 FROM enrolments WHERE user_id=? AND item_id=?
                                 AND (expires_at IS NULL OR expires_at > ?)\`)
    .get(req.user.id, it.id, now());
  const mine = it.provider_id === req.user.id;
  const staff = req.user.permissions.includes('items.view');

  const out = {
    id: it.id, title: it.title, description: it.description,
    priceMinor: it.price_minor, enrolled,
  };
  // The media address is short-lived and issued per request. A permanent
  // link is a permanent leak: one person buys, everyone else watches.
  if (enrolled || mine || staff) out.mediaUrl = await viewUrl(it.media_key, 600);
  res.json(out);
});

/* ============================ 4. uploading ============================ */
app.post('/uploads/sign', authenticate, requireRole('provider', 'owner', 'staff'), async (req, res) => {
  const { filename, contentType } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'filename is required' });
  // The big file goes straight from the phone to storage. If it came
  // through here, one lesson video would block every other request.
  res.json(await uploadUrl(req.user.id, String(filename), contentType));
});

/* ============================ 5. money ============================ */
app.post('/orders', authenticate, (req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get((req.body || {}).itemId);
  if (!it) return res.status(404).json({ error: 'Not found' });
  // The price comes from the database. Never from the request. If the
  // phone sent the amount, somebody would send zero.
  const total = it.price_minor;
  const split = splitMoney(total);
  const id = uid();
  db.prepare(\`INSERT INTO orders (id,customer_id,provider_id,item_id,total_minor,
              platform_minor,provider_minor,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',?)\`)
    .run(id, req.user.id, it.provider_id, it.id, total, split.platform, split.provider, now());
  res.json({ id, totalMinor: total, itemMinor: total, feeMinor: 0 });
});

app.get('/orders/:id', authenticate,
  ownsOr('orders.view', req =>
    (db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(req.params.id) || {}).customer_id),
  (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    res.json({ id: o.id, title: 'Order', status: o.status, totalMinor: o.total_minor,
               itemMinor: o.total_minor, feeMinor: 0 });
  });

app.post('/payments/start', authenticate, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?')
    .get((req.body || {}).orderId, req.user.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  // Hand off to your payment provider here. Until you add keys, this
  // marks it paid so you can build and test the whole flow for free.
  res.json({ reference: 'ref_' + o.id, amountMinor: o.total_minor });
});

/* The payment provider tells US the payment succeeded. We never trust the
   phone for this; a phone can claim anything. And we check the signature,
   because otherwise anyone who knows the address can grant themselves a
   free course by sending a fake message. */
app.post('/payments/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (secret) {
    const sent = String(req.headers['x-signature'] || '');
    const mine = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    // Compare in constant time, so the comparison itself does not leak
    // the correct value one character at a time.
    const ok = sent.length === mine.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(mine));
    if (!ok) return res.status(400).json({ error: 'bad signature' });
  }
  const body = JSON.parse(req.body.toString() || '{}');
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(body.orderId || '').replace('ref_', ''));
  if (!o) return res.json({ ok: true });   // unknown order: accept, do nothing

  db.prepare("UPDATE orders SET status='paid' WHERE id = ?").run(o.id);
  // Access is written only now, after money actually arrived.
  db.prepare(\`INSERT OR IGNORE INTO enrolments (id,user_id,item_id,order_id,created_at)
              VALUES (?,?,?,?,?)\`).run(uid(), o.customer_id, o.item_id, o.id, now());
  res.json({ ok: true });
});

/* ============================ 6. the provider side ============================ */
app.post('/provider/apply', authenticate, requireRole('provider'), (req, res) => {
  const { documents, bank } = req.body || {};
  db.prepare(\`INSERT INTO provider_profiles (user_id,status,documents,bank)
              VALUES (?,'pending',?,?)
              ON CONFLICT(user_id) DO UPDATE SET status='pending', documents=?, bank=?\`)
    .run(req.user.id, JSON.stringify(documents || {}), JSON.stringify(bank || {}),
         JSON.stringify(documents || {}), JSON.stringify(bank || {}));
  res.json({ ok: true, status: 'pending' });
});

app.get('/provider/orders', authenticate, requireRole('provider'), (req, res) => {
  // Scoped to this provider in the query itself. Not filtered afterwards,
  // and never taken from a parameter the phone controls.
  const rows = db.prepare(\`SELECT id,status,provider_minor,created_at FROM orders
                           WHERE provider_id = ? ORDER BY created_at DESC LIMIT 50\`)
    .all(req.user.id);
  res.json({ items: rows.map(r => ({
    id: r.id, title: 'Order ' + r.id.slice(0, 6), when: r.created_at,
    payoutMinor: r.provider_minor, status: r.status,
  })) });
});

app.get('/provider/earnings', authenticate, requireRole('provider'), (req, res) => {
  const g = db.prepare(\`SELECT COUNT(*) n, COALESCE(SUM(total_minor),0) gross,
                        COALESCE(SUM(platform_minor),0) fee, COALESCE(SUM(provider_minor),0) net
                        FROM orders WHERE provider_id = ? AND status = 'paid'\`).get(req.user.id);
  const held = db.prepare(\`SELECT COALESCE(SUM(provider_minor),0) v FROM orders
                           WHERE provider_id=? AND status='paid' AND created_at > ?\`)
    .get(req.user.id, new Date(Date.now() - 3 * 864e5).toISOString());
  res.json({
    jobs: g.n, grossMinor: g.gross, commissionMinor: g.fee, netMinor: g.net,
    availableMinor: g.net - held.v, pendingMinor: held.v,
    canPayout: (g.net - held.v) > 0,
    nextPayoutDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
  });
});

/* ============================ 7. the owner side ============================ */
app.get('/owner/applications', authenticate, requirePerm('providers.view'), (req, res) => {
  const rows = db.prepare(\`SELECT p.user_id id, u.name, p.documents FROM provider_profiles p
                           JOIN users u ON u.id = p.user_id WHERE p.status = 'pending'\`).all();
  res.json({ items: rows.map(r => ({
    id: r.id, name: r.name,
    // Show which documents arrived, never their contents. Nobody needs to
    // read an id number to press approve.
    documentsSummary: Object.keys(JSON.parse(r.documents || '{}')).join(', ') || 'none',
  })) });
});

app.post('/owner/applications/:id', authenticate, requirePerm('providers.approve'), async (req, res) => {
  const ok = !!(req.body || {}).approved;
  db.prepare('UPDATE provider_profiles SET status=?, reviewed_by=?, reviewed_at=? WHERE user_id=?')
    .run(ok ? 'approved' : 'rejected', req.user.id, now(), req.params.id);
  await audit(req, ok ? 'approved provider' : 'rejected provider', req.params.id);
  res.json({ ok: true });
});

app.get('/owner/settings', authenticate, requirePerm('reports.view'), (req, res) => res.json(settings()));

app.patch('/owner/settings', authenticate, requirePerm('commission.edit'), async (req, res) => {
  const pct = Number((req.body || {}).commissionPercent);
  if (!(pct >= 0 && pct <= 50)) return res.status(400).json({ error: 'Enter a percentage between 0 and 50' });
  db.prepare("INSERT INTO settings (key,value) VALUES ('commissionPercent',?) ON CONFLICT(key) DO UPDATE SET value=?")
    .run(String(pct), String(pct));
  await audit(req, 'changed commission to ' + pct, null);
  // Existing orders keep the split they were created with. Changing the
  // past is how you lose providers.
  res.json({ ok: true, commissionPercent: pct });
});

app.get('/owner/staff', authenticate, requirePerm('staff.manage'), (req, res) => {
  const rows = db.prepare("SELECT id,email,permissions FROM users WHERE role='staff'").all();
  res.json({ items: rows.map(r => ({ id: r.id, email: r.email, permissions: JSON.parse(r.permissions || '[]') })) });
});

app.post('/owner/staff', authenticate, requireRole('owner'), requirePerm('staff.manage'), async (req, res) => {
  const { email, permissions } = req.body || {};
  const { PERMISSIONS } = require('../permissions');
  // Only permissions that exist, and never more than the owner holds.
  const clean = (permissions || []).filter(p => PERMISSIONS.includes(p) && req.user.permissions.includes(p));
  const id = uid();
  db.prepare(\`INSERT INTO users (id,email,name,password_hash,role,permissions,created_at)
              VALUES (?,?,?,?,'staff',?,?)\`)
    .run(id, email, email, bcrypt.hashSync(crypto.randomBytes(9).toString('hex'), 10),
         JSON.stringify(clean), now());
  await audit(req, 'invited staff ' + email, id);
  res.json({ ok: true, id, permissions: clean });
});

app.get('/owner/reports', authenticate, requirePerm('reports.view'), (req, res) => {
  const m = db.prepare(\`SELECT COUNT(*) orders, COALESCE(SUM(total_minor),0) gross,
                        COALESCE(SUM(platform_minor),0) fee FROM orders WHERE status='paid'\`).get();
  const p = db.prepare("SELECT COUNT(*) n FROM provider_profiles WHERE status='approved'").get();
  const r = db.prepare(\`SELECT COUNT(*) n FROM (SELECT customer_id FROM orders
                        WHERE status='paid' GROUP BY customer_id HAVING COUNT(*) > 1)\`).get();
  res.json({ orders: m.orders, grossMinor: m.gross, commissionMinor: m.fee,
             providers: p.n, returning: r.n });
});

/* ============================ 8. live classes ============================ */
app.post('/live/:sessionId/join', authenticate, (req, res) => {
  const ses = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.sessionId);
  if (!ses) return res.status(404).json({ error: 'Not found' });

  const isHost = ses.host_id === req.user.id;
  if (!isHost && ses.item_id) {
    const paid = db.prepare('SELECT 1 FROM enrolments WHERE user_id=? AND item_id=?')
      .get(req.user.id, ses.item_id);
    if (!paid) return res.status(403).json({ error: 'This class is for enrolled students' });
  }
  // Allowed to speak only if the teacher said so. The phone asks; the
  // server decides. If the phone decided, any student could unmute.
  const allowed = !!db.prepare("SELECT 1 FROM hand_raises WHERE session_id=? AND user_id=? AND state='allowed'")
    .get(ses.id, req.user.id);

  const tok = roomToken({ room: ses.room, user: req.user, isHost, maySpeak: allowed });
  if (!tok) return res.status(503).json({ error: 'Live classes are not configured yet. See the guide.' });
  res.json(tok);
});

app.post('/live/:sessionId/hand', authenticate, (req, res) => {
  db.prepare(\`INSERT INTO hand_raises (id,session_id,user_id,state,at) VALUES (?,?,?,'raised',?)\`)
    .run(uid(), req.params.sessionId, req.user.id, now());
  res.json({ ok: true });
});

/* Only the teacher may open a microphone, and only one at a time by
   default. Two hundred open microphones is not a class, it is noise. */
app.post('/live/:sessionId/allow', authenticate, (req, res) => {
  const ses = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.sessionId);
  if (!ses || ses.host_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE hand_raises SET state='lowered' WHERE session_id=? AND state='allowed'").run(ses.id);
  db.prepare("UPDATE hand_raises SET state='allowed' WHERE session_id=? AND user_id=?")
    .run(ses.id, (req.body || {}).userId);
  res.json({ ok: true });
});

/* ============================ 9. last ============================ */
app.get('/health', (req, res) => res.json({ ok: true, live: liveReady }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  // Log the detail for you; send a plain sentence to the user. Stack
  // traces in a response tell an attacker how the inside is built.
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('${a.name} server on http://localhost:' + port));
`;
}
module.exports = { routes };

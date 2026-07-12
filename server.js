// Fan Battle Live — Automation Server
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const RECORDS_FILE = path.join(__dirname, 'records.json');

function loadRecords() {
  try { return JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); }
  catch (e) { return []; }
}

function saveRecord(record) {
  const records = loadRecords();
  records.push(record);
  try { fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2)); }
  catch (e) { console.error('Could not save record to disk:', e.message); }
}

const API_KEY = process.env.IM_API_KEY || 'PASTE_YOUR_PRIVATE_API_KEY_HERE';
const AUTH_TOKEN = process.env.IM_AUTH_TOKEN || 'PASTE_YOUR_PRIVATE_AUTH_TOKEN_HERE';

const POLL_INTERVAL_MS = 5000;
let seenPaymentIds = new Set();
let latestEvents = [];
let isFirstRun = true;

async function resolveSideFromPaymentRequest(paymentRequestUrl) {
  if (!paymentRequestUrl) return null;
  try {
    const res = await fetch(paymentRequestUrl, {
      headers: { 'X-Api-Key': API_KEY, 'X-Auth-Token': AUTH_TOKEN }
    });
    const data = await res.json();
    const pr = data.payment_request || data;
    const purpose = (pr && pr.purpose) || '';
    if (/^R:/i.test(purpose.trim())) return 'right';
    if (/^L:/i.test(purpose.trim())) return 'left';
    return null;
  } catch (e) {
    console.error('Could not resolve payment_request purpose:', e.message);
    return null;
  }
}

async function fetchRecentPayments() {
  try {
    const res = await fetch('https://www.instamojo.com/api/1.1/payments/', {
      headers: { 'X-Api-Key': API_KEY, 'X-Auth-Token': AUTH_TOKEN }
    });
    const data = await res.json();
    if (!data.success) { console.error('Instamojo API error:', data.message || data); return; }

    const payments = data.payments || [];

    if (isFirstRun) {
      console.log(`Startup check: found ${payments.length} payment(s) on this account.`);
      payments.forEach(p => seenPaymentIds.add(p.payment_id));
      isFirstRun = false;
      console.log('✅ API connection working.');
      return;
    }

    for (const p of payments) {
      if (p.status === 'Credit' && !seenPaymentIds.has(p.payment_id)) {
        seenPaymentIds.add(p.payment_id);

        const purposeRaw = p.purpose || '';
        let side = null;
        if (/^R:/i.test(purposeRaw.trim())) side = 'right';
        else if (/^L:/i.test(purposeRaw.trim())) side = 'left';

        if (!side && p.payment_request) {
          side = await resolveSideFromPaymentRequest(p.payment_request);
        }

        if (!side) {
          console.log('⚠️ Could not determine side, skipping:', p.payment_id);
          continue;
        }

        const event = { name: p.buyer_name || 'Anonymous', side, amount: parseFloat(p.amount), purpose: purposeRaw };
        latestEvents.push(event);
        saveRecord({
          id: p.payment_id, name: p.buyer_name || 'Anonymous',
          email: p.buyer_email || p.buyer || null, phone: p.buyer_phone || null,
          side, amount: parseFloat(p.amount), purpose: purposeRaw,
          timestamp: new Date().toISOString()
        });
        console.log('🎉 New payment detected:', event);
      }
    }
  } catch (err) {
    console.error('Error fetching payments:', err.message);
  }
}

setInterval(fetchRecentPayments, POLL_INTERVAL_MS);
fetchRecentPayments();

app.get('/events', (req, res) => {
  const eventsToSend = [...latestEvents];
  latestEvents = [];
  res.json({ events: eventsToSend });
});

app.get('/', (req, res) => res.send('Fan Battle Live automation server is running.'));

const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'changeme123';

function requireDashboardAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, encoded] = authHeader.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    if (user === DASHBOARD_USER && pass === DASHBOARD_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Fan Battle Dashboard"');
  return res.status(401).send('Authentication required.');
}

app.get('/dashboard', requireDashboardAuth, (req, res) => {
  const records = loadRecords();
  const byMonth = {}, byDay = {};
  for (const r of records) {
    const month = r.timestamp.slice(0, 7), day = r.timestamp.slice(0, 10);
    if (!byMonth[month]) byMonth[month] = { total: 0, left: 0, right: 0, count: 0 };
    byMonth[month].total += r.amount; byMonth[month][r.side] += r.amount; byMonth[month].count += 1;
    if (!byDay[day]) byDay[day] = { total: 0, count: 0 };
    byDay[day].total += r.amount; byDay[day].count += 1;
  }
  const months = Object.keys(byMonth).sort().reverse();
  const days = Object.keys(byDay).sort().reverse();
  const monthRows = months.map(m => `<tr><td>${m}</td><td>₹${byMonth[m].total}</td><td>₹${byMonth[m].left}</td><td>₹${byMonth[m].right}</td><td>${byMonth[m].count}</td></tr>`).join('');
  const dayRows = days.map(d => `<tr><td>${d}</td><td>₹${byDay[d].total}</td><td>${byDay[d].count}</td></tr>`).join('');
  const recordRows = [...records].reverse().slice(0, 300).map(r => `<tr><td>${new Date(r.timestamp).toLocaleString('en-IN')}</td><td>${r.name}</td><td>${r.side}</td><td>₹${r.amount}</td><td>${r.email || '-'}</td><td>${r.phone || '-'}</td><td style="font-size:11px;color:#888;">${r.id}</td></tr>`).join('');
  res.send(`<html><head><title>Fan Battle Live — Dashboard</title><style>
    body{font-family:Arial;background:#0B0F19;color:#F5F7FA;padding:24px}
    h1{font-size:22px}h2{font-size:16px;margin-top:32px;color:#FFC53D}
    table{border-collapse:collapse;width:100%;margin-top:10px}
    th,td{border:1px solid #333;padding:6px 10px;font-size:13px;text-align:left}
    th{background:#121728}tr:nth-child(even){background:#121728}
    .warn{background:#2a1f0a;border:1px solid #FFC53D;padding:10px 14px;border-radius:8px;font-size:12.5px;margin-top:8px}
  </style></head><body>
    <h1>📊 Fan Battle Live — Donation Records</h1>
    <div class="warn">⚠️ Records stored on server disk — export/screenshot periodically for permanent proof.</div>
    <h2>Monthly totals</h2><table><tr><th>Month</th><th>Total</th><th>Left</th><th>Right</th><th>Payments</th></tr>${monthRows || '<tr><td colspan="5">No records yet</td></tr>'}</table>
    <h2>Daily totals</h2><table><tr><th>Date</th><th>Total</th><th>Payments</th></tr>${dayRows || '<tr><td colspan="3">No records yet</td></tr>'}</table>
    <h2>Individual records</h2><p><a href="/export" style="background:#FFC53D;color:#0B0F19;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">⬇ Download full backup (CSV)</a></p>
    <table><tr><th>Time</th><th>Name</th><th>Side</th><th>Amount</th><th>Email</th><th>Phone</th><th>Payment ID</th></tr>${recordRows || '<tr><td colspan="7">No records yet</td></tr>'}</table>
  </body></html>`);
});

app.get('/export', requireDashboardAuth, (req, res) => {
  const records = loadRecords();
  const header = 'timestamp,name,side,amount,email,phone,purpose,payment_id\n';
  const rows = records.map(r => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [r.timestamp, r.name, r.side, r.amount, r.email, r.phone, r.purpose, r.id].map(esc).join(',');
  }).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="fan-battle-records-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(header + rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

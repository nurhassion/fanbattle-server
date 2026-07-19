// Fan Battle Live — Automation Server
// Domestic (India): dynamically creates a fresh Instamojo Payment Request per
// visitor via the API (with our own redirect_url) — this does NOT depend on
// any Instamojo dashboard "Post Purchase" settings, so it keeps working even
// without dashboard access.
// International: serves a PayPal payment page (custom amount) and captures
// payments via the PayPal REST API.
// Both paths land on the same /thanks page afterwards, which optionally
// invites the donor to upload a photo — entirely their choice, one tap to
// skip and return straight to the stream.

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '6mb' })); // photo uploads are base64, need a bit of headroom

// ====== Persistent donor records (name, side, amount, currency, country, date) ======
// NOTE: On Render's FREE tier, the filesystem is not guaranteed to survive
// every restart/redeploy — treat this as a convenience log, not a permanent
// legal record. Records are ALSO mirrored to a Google Sheet below. PayPal's
// own Activity/Reports page and Instamojo's own dashboard/reports remain the
// authoritative record for each side respectively — this server and the
// Google Sheet are convenience copies, not replacements.
const RECORDS_FILE = path.join(__dirname, 'records.json');
const PHOTOS_FILE = path.join(__dirname, 'donor-photos.json');
const GATEWAY_SETTINGS_FILE = path.join(__dirname, 'gateway-settings.json');
const NOTIFY_SETTINGS_FILE = path.join(__dirname, 'notify-settings.json');
const SCHEDULED_EVENTS_FILE = path.join(__dirname, 'scheduled-events.json');

// ====== Go-Live Reminders: contact info (set once, reused every schedule) ======
function loadNotifySettings() {
  try { return JSON.parse(fs.readFileSync(NOTIFY_SETTINGS_FILE, 'utf8')); }
  catch (e) { return { whatsappNumber: '', smsNumber: '', email: '' }; }
}
function saveNotifySettings(settings) {
  try { fs.writeFileSync(NOTIFY_SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
  catch (e) { console.error('Could not save notify settings:', e.message); }
}

// ====== Scheduled events (for the go-live reminder checker below) ======
function loadScheduledEvents() {
  try { return JSON.parse(fs.readFileSync(SCHEDULED_EVENTS_FILE, 'utf8')); }
  catch (e) { return []; }
}
function saveScheduledEvents(events) {
  try { fs.writeFileSync(SCHEDULED_EVENTS_FILE, JSON.stringify(events, null, 2)); }
  catch (e) { console.error('Could not save scheduled events:', e.message); }
}

// ====== STEP 4: Payment Gateway On/Off — instant, one-click, no redeploy ======
// Unlike an environment variable (which needs a Render redeploy, ~1 minute,
// to take effect), this is read fresh on every single payment page request —
// so flipping it from /gateway-settings takes effect for the very next
// visitor, immediately. International tips default to ON, exactly as
// requested, until you flip it off yourself.
function loadGatewaySettings() {
  try {
    const s = JSON.parse(fs.readFileSync(GATEWAY_SETTINGS_FILE, 'utf8'));
    if (!Array.isArray(s.additionalGateways)) s.additionalGateways = [];
    return s;
  }
  catch (e) { return { domesticEnabled: true, internationalEnabled: true, additionalGateways: [] }; }
}
function saveGatewaySettings(settings) {
  try { fs.writeFileSync(GATEWAY_SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
  catch (e) { console.error('Could not save gateway settings:', e.message); }
}

function loadRecords() {
  try { return JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch (e) { return []; }
}
function saveRecord(record) {
  const records = loadRecords();
  records.push(record);
  try { fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2)); }
  catch (e) { console.error('Could not save record to disk:', e.message); }
}

// ====== Donor photos — entirely optional, donor's own choice ======
// Stored as { name: { photo: "data:image/...", timestamp, driveLink } } so
// the streamer can moderate (delete) any single one from the dashboard.
// The local base64 copy is kept for instant dashboard display even if the
// Google Drive upload is briefly slow/unreachable — driveLink (once we have
// it) is the DURABLE copy that survives a Render restart/redeploy.
function loadPhotos() {
  try { return JSON.parse(fs.readFileSync(PHOTOS_FILE, 'utf8')); } catch (e) { return {}; }
}
function savePhotos(map) {
  try { fs.writeFileSync(PHOTOS_FILE, JSON.stringify(map, null, 2)); }
  catch (e) { console.error('Could not save photos to disk:', e.message); }
}
let donorPhotoMap = loadPhotos();

// ====== Google Sheets permanent backup ======
const GSHEET_WEBHOOK_URL = process.env.GSHEET_WEBHOOK_URL || '';
const GSHEET_SECRET = process.env.GSHEET_SECRET || '';
async function backupToGoogleSheet(record) {
  if (!GSHEET_WEBHOOK_URL) return;
  try {
    await fetch(GSHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...record, secret: GSHEET_SECRET })
    });
  } catch (e) { console.error('Could not back up record to Google Sheet:', e.message); }
}

// ====== STEP 3 (new): Donor photo -> Google Drive, link saved to Sheet ======
// Uses the SAME Apps Script Web App as the donation-record backup above
// (GSHEET_WEBHOOK_URL) — the script tells the two kinds of requests apart
// by the presence of `type: 'photo'`. See DRIVE-PHOTO-SETUP.md for the exact
// Apps Script code to paste in (it's an addition to your existing script,
// not a replacement).
async function uploadPhotoToDriveAndLog(name, photoDataUrl) {
  if (!GSHEET_WEBHOOK_URL) return null;
  try {
    const res = await fetch(GSHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'photo',
        name,
        photoDataUrl,
        secret: GSHEET_SECRET,
        timestamp: new Date().toISOString()
      })
    });
    const data = await res.json().catch(() => null);
    return (data && data.driveLink) ? data.driveLink : null;
  } catch (e) {
    console.error('Could not upload photo to Google Drive:', e.message);
    return null;
  }
}

// ====== Shared in-memory event queue the browser overlay polls every 4s ======
let latestEvents = [];

// ---- Celebration timing is DELIBERATELY separated from bookkeeping. ----
// The payment itself is recorded immediately (recordDonation) so accounting/
// dashboard/CSV/Google Sheet are always accurate and instant. But the
// CELEBRATION on the overlay (which the donor watches via the YouTube live
// stream, which itself has its own broadcast delay) is only fired once the
// donor has actually left the thank-you/photo page and headed back to the
// stream — either by confirming their photo upload or by tapping Skip.
// A small extra buffer is added on top of that moment so the stream has
// time to catch up before their name appears, so they don't feel like their
// tip "wasn't counted" just because they hadn't scrolled back to the stream
// yet. See notifyOverlay() and the /confirm-return route below.
let pendingCelebrations = {}; // { id: { name, side, amount, currency, country } }
const RETURN_TO_STREAM_BUFFER_MS = 6000;  // used when the donor explicitly confirms/skips — see /confirm-return
const FALLBACK_CELEBRATION_BUFFER_MS = 30000; // safety-net only, in case the donor never interacts with /thanks at all

function recordDonation({ name, side, amount, currency, email, phone, country, purpose, source, id }) {
  const recordId = id || ('manual-' + Date.now());
  // Guard against double-recording the SAME payment — this can legitimately
  // happen because both the Instamojo background poller and the /thanks
  // page can independently notice the same payment_id.
  const existing = loadRecords().find(r => r.id === recordId);
  if (existing) {
    if (!pendingCelebrations[recordId]) {
      pendingCelebrations[recordId] = { name: existing.name, side: existing.side, amount: existing.amount, currency: existing.currency, country: existing.country };
    }
    return existing;
  }
  const fullRecord = {
    id: recordId, name: name || 'Anonymous', email: email || null, phone: phone || null,
    country: country || null, side, amount: parseFloat(amount), currency: currency || 'INR',
    purpose: purpose || '', source: source || 'unknown', timestamp: new Date().toISOString()
  };
  saveRecord(fullRecord);
  backupToGoogleSheet(fullRecord);
  console.log(`💾 Recorded ${fullRecord.source} payment (celebration pending donor's return-to-stream):`, fullRecord.name, fullRecord.amount, fullRecord.currency);
  pendingCelebrations[fullRecord.id] = {
    name: fullRecord.name, side: fullRecord.side, amount: fullRecord.amount,
    currency: fullRecord.currency, country: fullRecord.country
  };
  return fullRecord;
}

function notifyOverlay(celebrationId) {
  const pending = pendingCelebrations[celebrationId];
  if (!pending) return; // already fired, or an unknown/expired id — safe no-op
  delete pendingCelebrations[celebrationId];
  latestEvents.push(pending);
  console.log('🎉 Celebration fired for:', pending.name, '(after donor confirmed return to stream)');
}

// Legacy alias kept so any older call sites (e.g. Instamojo's background
// poller, which has no explicit "return to stream" click to wait for) still
// work — it records AND queues the celebration to fire after a generous
// fallback buffer, purely as a safety net in case the donor closes the
// /thanks page without ever tapping Skip or confirming a photo upload.
// Whichever fires first (this fallback, or the donor's explicit action via
// /confirm-return) wins — notifyOverlay() is safe to call twice.
function pushDonationEvent(args) {
  const fullRecord = recordDonation(args);
  setTimeout(() => notifyOverlay(fullRecord.id), FALLBACK_CELEBRATION_BUFFER_MS);
  return fullRecord;
}

// A donor is invited to add a photo after EVERY payment (not just the top
// ones) — this just checks if they're currently within striking distance of
// the podium, purely to decide the wording shown, not to gate the invite.
function isCurrentlyTopThree(name) {
  const records = loadRecords();
  const totalsByName = {};
  for (const r of records) totalsByName[r.name] = (totalsByName[r.name] || 0) + r.amount;
  const ranked = Object.entries(totalsByName).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  return ranked.includes(name);
}

// =====================================================================
// ============================  INSTAMOJO  ===========================
// =====================================================================
const API_KEY = process.env.IM_API_KEY || 'PASTE_YOUR_PRIVATE_API_KEY_HERE';
const AUTH_TOKEN = process.env.IM_AUTH_TOKEN || 'PASTE_YOUR_PRIVATE_AUTH_TOKEN_HERE';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://fanbattle-server-yqo5.onrender.com';
const STREAM_BACK_URL = process.env.STREAM_BACK_URL || ''; // e.g. your YouTube Live URL, for the ✕ skip button
const POLL_INTERVAL_MS = 5000;
let seenPaymentIds = new Set();
let isFirstRun = true;

async function fetchInstamojoPayment(paymentId) {
  const res = await fetch(`https://www.instamojo.com/api/1.1/payments/${paymentId}/`, {
    headers: { 'X-Api-Key': API_KEY, 'X-Auth-Token': AUTH_TOKEN }
  });
  const data = await res.json();
  return data.payment || null;
}

async function resolveSideFromPaymentRequest(paymentRequestUrl) {
  if (!paymentRequestUrl) return null;
  try {
    const res = await fetch(paymentRequestUrl, { headers: { 'X-Api-Key': API_KEY, 'X-Auth-Token': AUTH_TOKEN } });
    const data = await res.json();
    const pr = data.payment_request || data;
    const purpose = (pr && pr.purpose) || '';
    if (/^R:/i.test(purpose.trim())) return 'right';
    if (/^L:/i.test(purpose.trim())) return 'left';
    return null;
  } catch (e) { console.error('Could not resolve payment_request purpose:', e.message); return null; }
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
      console.log(`Startup check: found ${payments.length} Instamojo payment(s) on this account.`);
      payments.forEach(p => seenPaymentIds.add(p.payment_id));
      isFirstRun = false;
      return;
    }

    for (const p of payments) {
      if (p.status === 'Credit' && !seenPaymentIds.has(p.payment_id)) {
        seenPaymentIds.add(p.payment_id);
        const purposeRaw = p.purpose || '';
        let side = null;
        if (/^R:/i.test(purposeRaw.trim())) side = 'right';
        else if (/^L:/i.test(purposeRaw.trim())) side = 'left';
        if (!side && p.payment_request) side = await resolveSideFromPaymentRequest(p.payment_request);
        if (!side) { console.log('⚠️ Could not determine side, skipping. Purpose was:', purposeRaw); continue; }

        pushDonationEvent({
          id: p.payment_id, name: p.buyer_name, email: p.buyer || p.email, phone: p.buyer_phone,
          country: 'IN', side, amount: p.amount, currency: 'INR', purpose: purposeRaw, source: 'instamojo'
        });
      }
    }
  } catch (err) { console.error('Error fetching Instamojo payments:', err.message); }
}
setInterval(fetchRecentPayments, POLL_INTERVAL_MS);
fetchRecentPayments();

// Creates a brand-new Instamojo Payment Request for the exact amount the
// visitor chose on our own page, with OUR redirect_url baked in — this
// works purely through the API and does not depend on any dashboard
// "Post Purchase" configuration at all.
async function createInstamojoPaymentRequest(amount, side, donorName, donorPhone) {
  const purpose = (side === 'left' ? 'L: ' : 'R: ') + 'Fan Battle Live tip';
  // Carry the donor's OWN name/phone (entered on our page, not Instamojo's
  // hosted checkout) through the redirect, so /thanks can prefer it — this
  // is what lets us skip requiring an email at all on our side.
  const nameParam = donorName ? `&dn=${encodeURIComponent(donorName)}` : '';
  const phoneParam = donorPhone ? `&dp=${encodeURIComponent(donorPhone)}` : '';
  const redirectUrl = `${PUBLIC_BASE_URL}/thanks?via=instamojo${nameParam}${phoneParam}`;
  const body = new URLSearchParams({
    purpose, amount: String(amount), redirect_url: redirectUrl, send_email: 'False', send_sms: 'False',
    allow_repeated_payments: 'False'
  });
  // Pre-fill Instamojo's own hosted checkout with the name we already have,
  // so the donor isn't asked to type it twice. Note: Instamojo's hosted page
  // may still show its own email field per their platform's own checkout
  // requirements — that's on their side, outside what this API can remove.
  if (donorName) body.set('buyer_name', donorName);
  if (donorPhone) body.set('phone', donorPhone);
  const res = await fetch('https://www.instamojo.com/api/1.1/payment-requests/', {
    method: 'POST',
    headers: { 'X-Api-Key': API_KEY, 'X-Auth-Token': AUTH_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (!data.success) throw new Error('Instamojo payment-request creation failed: ' + JSON.stringify(data));
  return data.payment_request.longurl;
}

// Our own small "choose an amount" page for domestic visitors — mirrors the
// PayPal page's look/flow exactly, so the experience feels identical.
// STEP 3: name + amount are REQUIRED (enforced both client-side below and
// server-side in /instamojo-create-request); email is never asked at all;
// phone stays optional.
function instamojoAmountPageHtml(side, teamName) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support ${teamName}</title>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; text-align:center; padding:32px 16px;}
    h2{margin-bottom:6px;} p{color:#8B93A7; font-size:14px;}
    input{padding:10px; border-radius:8px; border:1px solid #333; font-size:16px; margin:6px; width:200px; text-align:center;}
    input#amt{width:140px;}
    label.fieldLabel{display:block; font-size:11.5px; color:#8B93A7; margin-top:14px;}
    label.fieldLabel .req{color:#FF8A7A;}
    button{padding:12px 28px; border-radius:10px; border:none; background:#FFC53D; color:#0B0F19; font-weight:bold; font-size:15px; margin-top:12px; cursor:pointer;}
    .presets{display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-top:14px;}
    .preset-btn{background:#121728; border:1px solid #333; color:#F5F7FA; padding:8px 14px; border-radius:20px; font-size:13px; font-weight:600; cursor:pointer;}
    .preset-btn.active{background:#FFC53D; color:#0B0F19; border-color:#FFC53D;}
    #status{margin-top:14px; font-weight:bold;}
  </style></head><body>
    <h2>Support ${teamName} 🔥</h2>
    <p>Enter any amount you'd like to tip — this is a completely voluntary show of support, no goods or prizes are exchanged. Minimum ₹9.</p>
    <label class="fieldLabel">Your name (shown on stream) <span class="req">*required</span></label>
    <div><input type="text" id="donorName" placeholder="Your name" maxlength="40"></div>
    <label class="fieldLabel">Mobile number (optional)</label>
    <div><input type="tel" id="donorPhone" placeholder="Optional"></div>
    <label class="fieldLabel">Amount <span class="req">*required</span></label>
    <div style="margin-top:4px;"><input type="number" id="amt" placeholder="₹ Amount" min="9" value="9"></div>
    <div class="presets">
      <button class="preset-btn active" onclick="setAmt(9,this)">₹9 - Thanks!</button>
      <button class="preset-btn" onclick="setAmt(10,this)">₹10 - Nice One!</button>
      <button class="preset-btn" onclick="setAmt(20,this)">₹20 - Super!</button>
      <button class="preset-btn" onclick="setAmt(50,this)">₹50 - Great!</button>
      <button class="preset-btn" onclick="setAmt(100,this)">₹100 - Awesome!</button>
    </div>
    <br><button onclick="pay()">Pay Now</button>
    <div id="status"></div>
    <script>
      function setAmt(v, btn){
        document.getElementById('amt').value = v;
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      document.getElementById('amt').addEventListener('input', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      });
      function pay(){
        const amt = parseFloat(document.getElementById('amt').value);
        const donorName = document.getElementById('donorName').value.trim();
        const donorPhone = document.getElementById('donorPhone').value.trim();
        if(!donorName){
          document.getElementById('status').textContent = 'Please enter your name — it\\'s required.';
          document.getElementById('donorName').focus();
          return;
        }
        if(!amt || isNaN(amt) || amt < 9){
          document.getElementById('status').textContent = 'Please enter a valid amount (minimum ₹9).';
          document.getElementById('amt').focus();
          return;
        }
        document.getElementById('status').textContent = 'Redirecting to payment...';
        fetch('/instamojo-create-request', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ amount: amt, side: '${side}', donorName, donorPhone })
        }).then(r => r.json()).then(d => {
          if(d.longurl) window.location.href = d.longurl;
          else document.getElementById('status').textContent = 'Something went wrong: ' + (d.error || 'please t

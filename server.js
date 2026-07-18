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

// ====== STEP 4: Payment Gateway On/Off — instant, one-click, no redeploy ======
// Unlike an environment variable (which needs a Render redeploy, ~1 minute,
// to take effect), this is read fresh on every single payment page request —
// so flipping it from /gateway-settings takes effect for the very next
// visitor, immediately. International tips default to ON, exactly as
// requested, until you flip it off yourself.
function loadGatewaySettings() {
  try { return JSON.parse(fs.readFileSync(GATEWAY_SETTINGS_FILE, 'utf8')); }
  catch (e) { return { domesticEnabled: true, internationalEnabled: true }; }
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
          else document.getElementById('status').textContent = 'Something went wrong: ' + (d.error || 'please try again.');
        }).catch(err => {
          document.getElementById('status').textContent = 'Network error: ' + err.message;
        });
      }
    </script>
  </body></html>`;
}

app.post('/instamojo-create-request', async (req, res) => {
  try {
    const { amount, side, donorName, donorPhone } = req.body;
    const amt = parseFloat(amount);
    // STEP 3: name + amount are required — enforced here too, not just in
    // the page's own JS, since this endpoint could in principle be called
    // directly.
    if (!donorName || !donorName.trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!amt || amt < 9) return res.status(400).json({ error: 'Minimum amount is ₹9 (Instamojo requirement).' });
    const longurl = await createInstamojoPaymentRequest(amt, side === 'left' ? 'left' : 'right', donorName.trim(), donorPhone);
    res.json({ longurl });
  } catch (e) {
    console.error('instamojo-create-request failed:', e.message);
    // Surface the real reason (e.g. bad/missing API key, Instamojo-side
    // validation error) instead of a generic message — makes debugging the
    // "Something went wrong" case on the phone actually possible.
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// =============================  PAYPAL  ==============================
// =====================================================================
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || '';
const PAYPAL_API_BASE = 'https://api-m.paypal.com';
let cachedPaypalToken = null;
let cachedPaypalTokenExpiry = 0;

async function getPaypalAccessToken() {
  if (cachedPaypalToken && Date.now() < cachedPaypalTokenExpiry) return cachedPaypalToken;
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('PayPal auth failed: ' + JSON.stringify(data));
  cachedPaypalToken = data.access_token;
  cachedPaypalTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedPaypalToken;
}

app.post('/paypal-create-order', async (req, res) => {
  try {
    const { amount, currency, side } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const token = await getPaypalAccessToken();
    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: currency || 'USD', value: amt.toFixed(2) }, custom_id: side === 'left' ? 'left' : 'right' }]
      })
    });
    const order = await orderRes.json();
    res.json({ id: order.id });
  } catch (e) { console.error('paypal-create-order failed:', e.message); res.status(500).json({ error: 'Could not create PayPal order' }); }
});

app.post('/paypal-capture-order', async (req, res) => {
  try {
    const { orderID, donorName, donorPhone } = req.body;
    const token = await getPaypalAccessToken();
    const captureRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const capture = await captureRes.json();
    const purchaseUnit = (capture.purchase_units || [])[0] || {};
    const captureObj = (purchaseUnit.payments && purchaseUnit.payments.captures && purchaseUnit.payments.captures[0]) || {};
    const payer = capture.payer || {};
    // Prefer the name the donor typed on OUR OWN page over whatever their
    // PayPal account name happens to be (some donors' PayPal accounts show
    // an unrelated business/family name) — same reasoning as the Instamojo
    // path above.
    const paypalAccountName = [payer.name && payer.name.given_name, payer.name && payer.name.surname].filter(Boolean).join(' ') || 'Anonymous';
    const name = (donorName && donorName.trim()) || paypalAccountName;
    const amount = captureObj.amount ? captureObj.amount.value : null;
    const currency = captureObj.amount ? captureObj.amount.currency_code : 'USD';
    const country = (payer.address && payer.address.country_code) || null;
    const side = (purchaseUnit.custom_id === 'left') ? 'left' : 'right';

    let celebrationId = null;
    if (amount) {
      const record = recordDonation({ id: captureObj.id || orderID, name, email: payer.email_address, phone: donorPhone || null, country, side, amount, currency, purpose: 'PayPal donation', source: 'paypal' });
      celebrationId = record.id;
    }
    // Tell the client everything /thanks would need, so the PayPal page can
    // show the same "add your photo" invite inline without a redirect hop.
    // celebrationId is what the page uses when the donor confirms a photo
    // or taps Skip — that's the moment the overlay celebration actually fires.
    res.json({ status: capture.status || 'UNKNOWN', name, side, amount, currency, celebrationId, isTopThree: amount ? isCurrentlyTopThree(name) : false });
  } catch (e) { console.error('paypal-capture-order failed:', e.message); res.status(500).json({ error: 'Could not capture PayPal payment' }); }
});

// STEP 3: name is REQUIRED (already enforced in createOrder below) and now
// amount is also explicitly validated client-side before the PayPal button
// flow even starts; email is never asked at all; phone stays optional.
function paypalPageHtml(side, teamName) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support ${teamName}</title>
  <script src="https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture"></script>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; text-align:center; padding:32px 16px;}
    h2{margin-bottom:6px;} p{color:#8B93A7; font-size:14px;}
    input, select{padding:10px; border-radius:8px; border:1px solid #333; font-size:16px; margin:6px; width:200px;}
    label.fieldLabel{display:block; font-size:11.5px; color:#8B93A7; margin-top:14px;}
    label.fieldLabel .req{color:#FF8A7A;}
    #paypal-button-container{max-width:320px; margin:20px auto;}
    #status{margin-top:14px; font-weight:bold;}
    #photoSection{display:none; margin-top:22px; border-top:1px solid #333; padding-top:18px;}
    #photoSection img{max-width:120px; border-radius:12px; margin-top:8px;}
    .skipBtn{position:fixed; top:14px; right:14px; background:#222; color:#fff; border:none; border-radius:50%; width:34px; height:34px; font-size:18px; cursor:pointer;}
  </style></head><body>
    ${STREAM_BACK_URL ? `<button class="skipBtn" onclick="skipToStream()" title="Back to stream">✕</button>` : ''}
    <h2>Support ${teamName} 🔥</h2>
    <p>Enter any amount you'd like to tip — this is a voluntary show of support, no goods or services are exchanged.</p>
    <label class="fieldLabel">Your name (shown on stream) <span class="req">*required</span></label>
    <div><input type="text" id="donorNameInput" placeholder="Your name" maxlength="40"></div>
    <label class="fieldLabel">Mobile number (optional)</label>
    <div><input type="tel" id="donorPhoneInput" placeholder="Optional"></div>
    <label class="fieldLabel">Amount <span class="req">*required</span></label>
    <div style="margin-top:4px;">
      <input type="number" id="amt" placeholder="Amount" min="1" value="5">
      <select id="cur">
        <option value="USD">USD $</option><option value="EUR">EUR €</option><option value="GBP">GBP £</option>
        <option value="AUD">AUD A$</option><option value="CAD">CAD C$</option>
      </select>
    </div>
    <div id="paypal-button-container"></div>
    <div id="status"></div>
    <div id="photoSection">
      <p><b id="photoQuestionText">Want to show your photo on the live stream?</b><br><span id="photoNoteText">Totally optional — skip if you'd rather not.</span></p>
      <input type="file" id="photoInput" accept="image/*" capture="environment">
      <div id="photoPreviewWrap"><img id="photoPreview" style="display:none;"></div>
      <br><button onclick="uploadPhoto()"><span id="addPhotoText">Add my photo</span></button>
      ${STREAM_BACK_URL ? `<br><br><a href="javascript:void(0)" onclick="skipToStream()" style="color:#8B93A7;"><span id="skipText">Skip — back to stream</span></a>` : ''}
    </div>
    <script>
      let donorName = '';
      let celebrationId = null;
      let returnAlreadyTriggered = false; // guards against firing twice (e.g. button click AND pagehide both firing)

      // ---- Auto-detect the visitor's OWN device/browser language and show
      // it ALONGSIDE English (never replacing it) — based on navigator.language.
      (function applyLocalLanguage(){
        const translations = ${JSON.stringify(THANKS_TRANSLATIONS)};
        const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
        const t = translations[browserLang];
        if (!t) return;
        const addBilingual = (el, translated) => { if (el && translated) el.innerHTML = el.innerHTML + '<br><span style="opacity:0.8;">' + translated + '</span>'; };
        addBilingual(document.getElementById('photoQuestionText'), t.photoQuestion);
        addBilingual(document.getElementById('photoNoteText'), t.photoNote);
        addBilingual(document.getElementById('addPhotoText'), t.addPhoto);
        addBilingual(document.getElementById('skipText'), t.skip);
      })();

      // Whether the donor confirms a photo, taps Skip, presses their phone's
      // back button/gesture, or just closes the tab — ANY of these mean
      // "I'm heading back to the stream now", which is the ONE moment that
      // should start the buffered celebration timer — not the instant the
      // payment was captured. fetch(..., {keepalive:true}) lets the request
      // finish sending even as the page is actively navigating away.
      function confirmReturnAndGo(){
        if(returnAlreadyTriggered) return;
        returnAlreadyTriggered = true;
        if(celebrationId){
          fetch('/confirm-return', {
            method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
            body: JSON.stringify({ celebrationId })
          }).catch(()=>{});
        }
        ${STREAM_BACK_URL ? `window.location.href = '${STREAM_BACK_URL}';` : ''}
      }
      function skipToStream(){ confirmReturnAndGo(); }
      // Catches the phone's back button/swipe, or the tab/browser being
      // closed — pagehide fires reliably in all of these cases on mobile.
      window.addEventListener('pagehide', confirmReturnAndGo);

      paypal.Buttons({
        createOrder: function() {
          const donorNameVal = document.getElementById('donorNameInput').value.trim();
          const amtVal = parseFloat(document.getElementById('amt').value);
          if(!donorNameVal){
            document.getElementById('status').textContent = 'Please enter your name — it\\'s required.';
            document.getElementById('donorNameInput').focus();
            return Promise.reject(new Error('name required'));
          }
          if(!amtVal || isNaN(amtVal) || amtVal <= 0){
            document.getElementById('status').textContent = 'Please enter a valid amount.';
            document.getElementById('amt').focus();
            return Promise.reject(new Error('amount required'));
          }
          return fetch('/paypal-create-order', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ amount: document.getElementById('amt').value, currency: document.getElementById('cur').value, side: '${side}' })
          }).then(r => r.json()).then(d => d.id);
        },
        onApprove: function(data) {
          document.getElementById('status').textContent = 'Processing...';
          const donorNameVal = document.getElementById('donorNameInput').value.trim();
          const donorPhoneVal = document.getElementById('donorPhoneInput').value.trim();
          return fetch('/paypal-capture-order', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ orderID: data.orderID, side: '${side}', donorName: donorNameVal, donorPhone: donorPhoneVal })
          }).then(r => r.json()).then(d => {
            document.getElementById('status').textContent = 'Thank you! Your support will appear on stream shortly 🎉';
            donorName = d.name || 'Anonymous';
            celebrationId = d.celebrationId || null;
            document.getElementById('photoSection').style.display = 'block';
            document.getElementById('paypal-button-container').style.display = 'none';
          });
        }
      }).render('#paypal-button-container');

      document.getElementById('photoInput').addEventListener('change', function(e){
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = function(ev){
          document.getElementById('photoPreview').src = ev.target.result;
          document.getElementById('photoPreview').style.display = 'block';
        };
        reader.readAsDataURL(file);
      });
      function uploadPhoto(){
        const img = document.getElementById('photoPreview');
        if(!img.src) { alert('Choose a photo first, or use Skip.'); return; }
        document.getElementById('photoSection').innerHTML = '<p>✅ Thanks! Taking you back to the stream…</p>';
        fetch('/donor-photo', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ name: donorName, photoDataUrl: img.src, celebrationId })
        }).finally(() => { ${STREAM_BACK_URL ? `window.location.href = '${STREAM_BACK_URL}';` : ''} });
      }
    </script>
  </body></html>`;
}

// =====================================================================
// ==============  UNIVERSAL "/thanks" PAGE (Instamojo lands here) ======
// =====================================================================
// ---- Lightweight translation table for the donor-facing thank-you page. ----
// Detected from the visitor's own device/browser language (navigator.language)
// — NOT their location/IP. Falls back to English-only for any language not
// listed here. Each entry is [thankYou(name), tipReceived(amount,currency),
// photoQuestion, photoNote, addPhotoBtn, skipLink].
const THANKS_TRANSLATIONS = {
  hi: { thankYou: 'धन्यवाद', tipReceived: 'आपका टिप प्राप्त हो गया है।', photoQuestion: 'क्या आप अपनी फोटो लाइव स्ट्रीम पर दिखाना चाहेंगे?', photoNote: 'यह पूरी तरह वैकल्पिक है — चाहें तो स्किप करें।', addPhoto: 'मेरी फोटो जोड़ें', skip: 'स्किप करें — स्ट्रीम पर वापस जाएं' },
  bn: { thankYou: 'ধন্যবাদ', tipReceived: 'আপনার টিপ পাওয়া গেছে।', photoQuestion: 'আপনি কি আপনার ছবি লাইভ স্ট্রিমে দেখাতে চান?', photoNote: 'এটা সম্পূর্ণ ঐচ্ছিক — না চাইলে স্কিপ করুন।', addPhoto: 'আমার ছবি যোগ করুন', skip: 'স্কিপ করুন — স্ট্রিমে ফিরে যান' },
  ur: { thankYou: 'شکریہ', tipReceived: 'آپ کا ٹپ موصول ہو گیا ہے۔', photoQuestion: 'کیا آپ اپنی تصویر لائیو اسٹریم پر دکھانا چاہیں گے؟', photoNote: 'یہ مکمل طور پر اختیاری ہے — چاہیں تو چھوڑ دیں۔', addPhoto: 'میری تصویر شامل کریں', skip: 'چھوڑیں — اسٹریم پر واپس جائیں' },
  es: { thankYou: 'Gracias', tipReceived: 'Tu propina ha sido recibida.', photoQuestion: '¿Quieres mostrar tu foto en la transmisión en vivo?', photoNote: 'Esto es completamente opcional — omite si prefieres.', addPhoto: 'Añadir mi foto', skip: 'Omitir — volver a la transmisión' },
  ar: { thankYou: 'شكراً لك', tipReceived: 'تم استلام إكراميتك.', photoQuestion: 'هل ترغب في عرض صورتك على البث المباشر؟', photoNote: 'هذا اختياري تماماً — تخطَّ إذا أردت.', addPhoto: 'أضف صورتي', skip: 'تخطَّ — العودة إلى البث' },
  pt: { thankYou: 'Obrigado', tipReceived: 'Sua gorjeta foi recebida.', photoQuestion: 'Quer mostrar sua foto na transmissão ao vivo?', photoNote: 'Isso é totalmente opcional — pule se preferir.', addPhoto: 'Adicionar minha foto', skip: 'Pular — voltar para a transmissão' }
};

function thanksPageHtml({ name, side, amount, currency, celebrationId }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thank you!</title>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; text-align:center; padding:32px 16px;}
    h2{margin-bottom:6px;} p{color:#8B93A7; font-size:14px;}
    input{padding:10px; border-radius:8px; border:1px solid #333; font-size:16px; margin:6px;}
    button{padding:12px 28px; border-radius:10px; border:none; background:#FFC53D; color:#0B0F19; font-weight:bold; font-size:15px; margin-top:12px;}
    img{max-width:120px; border-radius:12px; margin-top:8px;}
    .skipBtn{position:fixed; top:14px; right:14px; background:#222; color:#fff; border:none; border-radius:50%; width:34px; height:34px; font-size:18px; cursor:pointer;}
    .lang-note{ font-size:11px; color:#555; margin-top:2px; }
  </style></head><body>
    ${STREAM_BACK_URL ? `<button class="skipBtn" onclick="skipToStream()" title="Back to stream">✕</button>` : ''}
    <h2 id="thankYouHeading">🎉 Thank you, ${name || 'friend'}!</h2>
    <p id="tipReceivedText">${amount ? `Your ${currency || '₹'} ${amount} tip has been received.` : 'Your support has been received.'}</p>
    <p><b id="photoQuestionText">Want to show your photo on the live stream?</b><br><span id="photoNoteText">This is completely optional — skip if you'd rather not.</span></p>
    <div><input type="file" id="photoInput" accept="image/*" capture="environment"></div>
    <img id="photoPreview" style="display:none;">
    <br><button onclick="uploadPhoto()"><span id="addPhotoText">Add my photo</span></button>
    ${STREAM_BACK_URL ? `<br><br><a href="javascript:void(0)" onclick="skipToStream()" style="color:#8B93A7;"><span id="skipText">Skip — back to stream</span></a>` : ''}
    <div id="doneMsg"></div>
    <script>
      const donorName = ${JSON.stringify(name || 'Anonymous')};
      const celebrationId = ${JSON.stringify(celebrationId || null)};
      let returnAlreadyTriggered = false; // guards against firing twice (e.g. button click AND pagehide both firing)

      // ---- Auto-detect the visitor's OWN device/browser language and show
      // it ALONGSIDE English (never replacing it) — based on navigator.language,
      // which reflects the phone/browser's language setting, not location/GPS.
      (function applyLocalLanguage(){
        const translations = ${JSON.stringify(THANKS_TRANSLATIONS)};
        const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
        const t = translations[browserLang];
        if (!t) return; // no match — English-only stays as-is, which is a safe fallback
        const addBilingual = (el, translated) => { if (el && translated) el.innerHTML = el.innerHTML + '<br><span style="opacity:0.8;">' + translated + '</span>'; };
        addBilingual(document.getElementById('tipReceivedText'), t.tipReceived);
        addBilingual(document.getElementById('photoQuestionText'), t.photoQuestion);
        addBilingual(document.getElementById('photoNoteText'), t.photoNote);
        addBilingual(document.getElementById('addPhotoText'), t.addPhoto);
        addBilingual(document.getElementById('skipText'), t.skip);
      })();

      // This is the moment that matters — not when the payment happened,
      // but when the donor is actually about to be watching the stream
      // again (confirming a photo, tapping Skip, pressing the phone's back
      // button, or just closing the tab). keepalive lets the request finish
      // even mid-navigation.
      function confirmReturnAndGo(){
        if(returnAlreadyTriggered) return;
        returnAlreadyTriggered = true;
        if(celebrationId){
          fetch('/confirm-return', {
            method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
            body: JSON.stringify({ celebrationId })
          }).catch(()=>{});
        }
        ${STREAM_BACK_URL ? `window.location.href = '${STREAM_BACK_URL}';` : ''}
      }
      function skipToStream(){ confirmReturnAndGo(); }
      // Catches the phone's back button/swipe, or the tab/browser being
      // closed — pagehide fires reliably in all of these cases on mobile.
      window.addEventListener('pagehide', confirmReturnAndGo);

      document.getElementById('photoInput').addEventListener('change', function(e){
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = function(ev){
          document.getElementById('photoPreview').src = ev.target.result;
          document.getElementById('photoPreview').style.display = 'block';
        };
        reader.readAsDataURL(file);
      });
      function uploadPhoto(){
        const img = document.getElementById('photoPreview');
        if(!img.src){ alert('Choose a photo first, or tap Skip.'); return; }
        document.getElementById('doneMsg').innerHTML = '<p>✅ Thanks! Taking you back to the stream…</p>';
        fetch('/donor-photo', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ name: donorName, photoDataUrl: img.src, celebrationId })
        }).finally(() => { ${STREAM_BACK_URL ? `window.location.href = '${STREAM_BACK_URL}';` : ''} });
      }
    </script>
  </body></html>`;
}

app.get('/thanks', async (req, res) => {
  try {
    const { payment_id, payment_status, dn, dp } = req.query;
    const donorProvidedName = dn ? decodeURIComponent(dn) : null;
    const donorProvidedPhone = dp ? decodeURIComponent(dp) : null;
    let name = null, amount = null, currency = 'INR', side = null, celebrationId = null;
    if (payment_id && payment_status === 'Credit') {
      const payment = await fetchInstamojoPayment(payment_id);
      if (payment) {
        // Prefer the name/phone the donor typed on OUR OWN page (before being
        // sent to Instamojo's hosted checkout) over whatever Instamojo itself
        // returns — this is what our own donor form is for.
        name = donorProvidedName || payment.buyer_name;
        amount = payment.amount; currency = 'INR';
        const purpose = payment.purpose || '';
        side = /^L:/i.test(purpose.trim()) ? 'left' : (/^R:/i.test(purpose.trim()) ? 'right' : null);
        // Record now (recordDonation's built-in duplicate-guard makes this
        // safe even if the background poller also notices this same
        // payment_id around the same time) — celebration itself is queued
        // separately, only once the donor confirms/skips on this page.
        // No email is required or requested on our own page at all; phone
        // is optional and, if the donor left it blank, we fall back to
        // whatever Instamojo itself captured on its hosted checkout.
        const record = recordDonation({
          id: payment_id, name, side, amount, currency, purpose, source: 'instamojo',
          email: payment.buyer || payment.email || null,
          phone: donorProvidedPhone || payment.buyer_phone || null
        });
        celebrationId = record.id;
      }
    }
    res.send(thanksPageHtml({ name, side, amount, currency, celebrationId }));
  } catch (e) {
    console.error('/thanks failed:', e.message);
    res.send(thanksPageHtml({ name: null, side: null, amount: null, currency: 'INR', celebrationId: null }));
  }
});

// ====== Donor photo upload (fully optional, donor's own choice) ======
// Called the instant a donor taps "Skip" (or right after a successful photo
// upload) — schedules the celebration to fire after the return-to-stream
// buffer, then responds immediately so the redirect isn't held up.
app.post('/confirm-return', (req, res) => {
  const { celebrationId } = req.body;
  if (celebrationId) setTimeout(() => notifyOverlay(celebrationId), RETURN_TO_STREAM_BUFFER_MS);
  res.json({ ok: true });
});

// STEP 3 (updated): the local base64 copy is still saved instantly (so the
// dashboard's moderation panel keeps working exactly as before, with zero
// delay) — but we NOW ALSO upload the photo to Google Drive and store that
// permanent link in the Google Sheet, so the photo survives even if this
// server's disk is wiped on a Render restart/redeploy. If the Drive upload
// fails for any reason (Sheet unreachable, quota, etc.), the donor is not
// affected at all — the local copy and celebration flow proceed exactly as
// before, this is purely an added safety net.
app.post('/donor-photo', async (req, res) => {
  const { name, photoDataUrl, celebrationId } = req.body;
  if (!name || !photoDataUrl) return res.status(400).json({ error: 'Missing name or photo' });

  donorPhotoMap[name] = { photo: photoDataUrl, timestamp: new Date().toISOString() };
  savePhotos(donorPhotoMap);

  // Fire the Drive upload but don't let a slow/failed upload delay the
  // donor's redirect back to the stream more than necessary.
  const driveLink = await uploadPhotoToDriveAndLog(name, photoDataUrl);
  if (driveLink) donorPhotoMap[name].driveLink = driveLink;
  savePhotos(donorPhotoMap);

  backupToGoogleSheet({
    id: 'photo-' + Date.now(), name, side: '', amount: '', currency: '', country: '',
    purpose: driveLink ? `PHOTO_UPLOADED: ${driveLink}` : 'PHOTO_UPLOADED (Drive upload failed — local copy only)',
    source: 'photo-log', timestamp: new Date().toISOString()
  });

  // Confirming a photo IS the donor's "I'm heading back to the stream now"
  // moment — queue their celebration the same way Skip does.
  if (celebrationId) setTimeout(() => notifyOverlay(celebrationId), RETURN_TO_STREAM_BUFFER_MS);
  res.json({ ok: true, driveLink: driveLink || null });
});

// =====================================================================
// ==================  ONE QR PER SIDE — SMART GEO ROUTES  =============
// =====================================================================
async function lookupCountry(ip) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
    const data = await res.json();
    return data.countryCode || null;
  } catch (e) { console.error('Geo lookup failed:', e.message); return null; }
}
function getVisitorIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress);
}

function pausedPageHtml(teamName) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tips paused</title>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; text-align:center; padding:60px 20px;}
    h2{margin-bottom:10px;} p{color:#8B93A7; font-size:15px;}
  </style></head><body>
    <h2>⏸️ Tips are temporarily paused</h2>
    <p>Support for ${teamName} is not being accepted at this exact moment.<br>Please try again shortly.</p>
  </body></html>`;
}

app.get('/pay-left', async (req, res) => {
  const gw = loadGatewaySettings(); // read fresh EVERY request — toggle takes effect instantly
  // Manual override for testing — e.g. /pay-left?force=paypal lets you see
  // the PayPal page even from India, and /pay-left?force=instamojo forces
  // the domestic page from anywhere. Real visitors never use this param.
  if (req.query.force === 'paypal') {
    if (!gw.internationalEnabled) return res.send(pausedPageHtml('the Left side'));
    return res.send(paypalPageHtml('left', 'the Left side'));
  }
  if (req.query.force === 'instamojo') {
    if (!gw.domesticEnabled) return res.send(pausedPageHtml('the Left side'));
    return res.send(instamojoAmountPageHtml('left', 'the Left side'));
  }
  const country = await lookupCountry(getVisitorIp(req));
  if (country === 'IN') {
    if (!gw.domesticEnabled) return res.send(pausedPageHtml('the Left side'));
    return res.send(instamojoAmountPageHtml('left', 'the Left side'));
  }
  if (!gw.internationalEnabled) return res.send(pausedPageHtml('the Left side'));
  res.send(paypalPageHtml('left', 'the Left side'));
});
app.get('/pay-right', async (req, res) => {
  const gw = loadGatewaySettings();
  if (req.query.force === 'paypal') {
    if (!gw.internationalEnabled) return res.send(pausedPageHtml('the Right side'));
    return res.send(paypalPageHtml('right', 'the Right side'));
  }
  if (req.query.force === 'instamojo') {
    if (!gw.domesticEnabled) return res.send(pausedPageHtml('the Right side'));
    return res.send(instamojoAmountPageHtml('right', 'the Right side'));
  }
  const country = await lookupCountry(getVisitorIp(req));
  if (country === 'IN') {
    if (!gw.domesticEnabled) return res.send(pausedPageHtml('the Right side'));
    return res.send(instamojoAmountPageHtml('right', 'the Right side'));
  }
  if (!gw.internationalEnabled) return res.send(pausedPageHtml('the Right side'));
  res.send(paypalPageHtml('right', 'the Right side'));
});

// NOTE: the /gateway-settings page and its toggle endpoint are registered
// further below, right after requireDashboardAuth is defined (they need
// that middleware to exist first).

// =====================================================================
// ===============================  ROUTES  =============================
// =====================================================================
app.get('/events', (req, res) => {
  const eventsToSend = [...latestEvents];
  latestEvents = [];
  const photosOut = {};
  Object.entries(donorPhotoMap).forEach(([name, v]) => { photosOut[name] = v.photo; });
  res.json({ events: eventsToSend, photos: photosOut });
});

app.get('/', (req, res) => { res.send('Fan Battle Live automation server is running. <a href="/overlay">Open the live overlay</a>'); });

function makeAuthMiddleware(realmName, envUserVar, envPassVar, defaultUser, defaultPass) {
  const USER = process.env[envUserVar] || defaultUser;
  const PASS = process.env[envPassVar] || defaultPass;
  return function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      if (user === USER && pass === PASS) return next();
    }
    res.set('WWW-Authenticate', `Basic realm="${realmName}"`);
    return res.status(401).send('Authentication required.');
  };
}
const requireOverlayAuth = makeAuthMiddleware('Fan Battle Overlay', 'OVERLAY_USER', 'OVERLAY_PASS', 'liveadmin', 'changeme456');
const requireDashboardAuth = makeAuthMiddleware('Fan Battle Dashboard', 'DASHBOARD_USER', 'DASHBOARD_PASS', 'admin', 'changeme123');

// ====== STEP 4: The one-click Payment Gateway switch page ======
// Protected by the SAME login you already use for /dashboard — no new
// username/password to remember. Flips take effect instantly (no redeploy),
// since /pay-left and /pay-right both re-read gateway-settings.json fresh
// on every single visitor.
app.get('/gateway-settings', requireDashboardAuth, (req, res) => {
  const gw = loadGatewaySettings();
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Gateway Switches</title>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; padding:28px 20px; max-width:480px; margin:0 auto;}
    h2{margin-bottom:4px;} p.sub{color:#8B93A7; font-size:13px; margin-top:0;}
    .row{ display:flex; align-items:center; justify-content:space-between; background:#121728; border:1px solid #333; border-radius:12px; padding:16px 18px; margin-top:16px; }
    .label{ font-size:15px; font-weight:600; } .status{ font-size:12px; margin-top:3px; }
    .status.on{ color:#4ADE80; } .status.off{ color:#FF8A7A; }
    .switch{ position:relative; width:56px; height:30px; }
    .switch input{ display:none; }
    .slider{ position:absolute; cursor:pointer; inset:0; background:#333; border-radius:30px; transition:0.2s; }
    .slider:before{ content:""; position:absolute; width:24px; height:24px; left:3px; top:3px; background:white; border-radius:50%; transition:0.2s; }
    input:checked + .slider{ background:#4ADE80; }
    input:checked + .slider:before{ transform:translateX(26px); }
    a.back{ display:inline-block; margin-top:24px; color:#8B93A7; font-size:13px; text-decoration:none; }
  </style></head><body>
    <h2>🎛️ Payment Gateway Switches</h2>
    <p class="sub">Flip instantly, no redeploy needed — takes effect on the very next visitor.</p>

    <div class="row">
      <div><div class="label">🇮🇳 Domestic (Instamojo)</div><div class="status ${gw.domesticEnabled ? 'on' : 'off'}" id="domesticStatus">${gw.domesticEnabled ? 'Active — accepting tips' : 'Paused'}</div></div>
      <label class="switch"><input type="checkbox" id="domesticToggle" ${gw.domesticEnabled ? 'checked' : ''} onchange="toggle('domestic', this.checked)"><span class="slider"></span></label>
    </div>

    <div class="row">
      <div><div class="label">🌍 International (PayPal)</div><div class="status ${gw.internationalEnabled ? 'on' : 'off'}" id="internationalStatus">${gw.internationalEnabled ? 'Active — accepting tips' : 'Paused'}</div></div>
      <label class="switch"><input type="checkbox" id="internationalToggle" ${gw.internationalEnabled ? 'checked' : ''} onchange="toggle('international', this.checked)"><span class="slider"></span></label>
    </div>

    <a class="back" href="/dashboard">← Back to dashboard</a>
    <script>
      function toggle(gateway, enabled){
        const statusEl = document.getElementById(gateway + 'Status');
        statusEl.textContent = 'Saving...';
        fetch('/gateway-settings/toggle', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ gateway, enabled })
        }).then(r => r.json()).then(d => {
          if(d.ok){
            statusEl.textContent = enabled ? 'Active — accepting tips' : 'Paused';
            statusEl.className = 'status ' + (enabled ? 'on' : 'off');
          } else {
            statusEl.textContent = 'Error saving — try again';
          }
        }).catch(() => { statusEl.textContent = 'Network error — try again'; });
      }
    </script>
  </body></html>`);
});

app.post('/gateway-settings/toggle', requireDashboardAuth, (req, res) => {
  const { gateway, enabled } = req.body;
  if (gateway !== 'domestic' && gateway !== 'international') return res.status(400).json({ ok: false, error: 'unknown gateway' });
  const gw = loadGatewaySettings();
  if (gateway === 'domestic') gw.domesticEnabled = !!enabled;
  if (gateway === 'international') gw.internationalEnabled = !!enabled;
  saveGatewaySettings(gw);
  console.log(`🎛️ Gateway toggle: ${gateway} -> ${enabled ? 'ON' : 'OFF'}`);
  res.json({ ok: true, settings: gw });
});

// Streamer-only moderation: delete any photo they don't want shown.
app.delete('/donor-photo', requireDashboardAuth, (req, res) => {
  const { name } = req.query;
  if (name && donorPhotoMap[name]) { delete donorPhotoMap[name]; savePhotos(donorPhotoMap); }
  res.json({ ok: true });
});

app.get('/overlay', requireOverlayAuth, (req, res) => {
  // No caching, ever — every layout/CSS fix must take effect immediately
  // the next time this page loads, never an old cached copy.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'fan-battle-live-demo.html'));
});

// ====== Unified App: JSON data API (same data as /dashboard, machine-readable) ======
app.get('/api/dashboard-data', requireDashboardAuth, (req, res) => {
  const records = loadRecords();
  const byMonth = {}, byDay = {};
  for (const r of records) {
    const month = r.timestamp.slice(0, 7), day = r.timestamp.slice(0, 10), cur = r.currency || 'INR';
    if (!byMonth[month]) byMonth[month] = { byCurrency: {}, count: 0 };
    byMonth[month].byCurrency[cur] = (byMonth[month].byCurrency[cur] || 0) + r.amount;
    byMonth[month].count += 1;
    if (!byDay[day]) byDay[day] = { byCurrency: {}, count: 0 };
    byDay[day].byCurrency[cur] = (byDay[day].byCurrency[cur] || 0) + r.amount;
    byDay[day].count += 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const photosOut = Object.entries(donorPhotoMap).map(([name, v]) => ({ name, photo: v.photo, driveLink: v.driveLink || null, timestamp: v.timestamp }));
  res.json({
    todayTotals: byDay[today] || { byCurrency: {}, count: 0 },
    monthTotals: byMonth[thisMonth] || { byCurrency: {}, count: 0 },
    recentRecords: [...records].reverse().slice(0, 50),
    photos: photosOut,
    gatewaySettings: loadGatewaySettings()
  });
});

// ====== Unified App: one professional, app-like control panel ======
// Single page, bottom tab navigation (Home / Gateways / Photos / Records) —
// looks and feels like a native Android app. Works in any mobile browser;
// visiting it once and choosing "Add to Home Screen" makes it open full-
// screen with its own icon, exactly like an installed app, with zero extra
// setup. A true native/Electron app remains the later, more complete step —
// this is the professional, unified interface available right now.
app.get('/app', requireDashboardAuth, (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<meta name="theme-color" content="#0B0F19">
<title>Fan Battle Live — Control</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0B0F19; --bg-soft:#121728; --card:#161C2E; --line:rgba(245,247,250,0.08);
    --white:#F5F7FA; --dim:#8B93A7; --left:#6C9BFF; --right:#FF6B5E; --gold:#FFC53D; --green:#4ADE80;
  }
  *{box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent;}
  html,body{height:100%;}
  body{
    background:var(--bg); color:var(--white); font-family:'Inter',sans-serif;
    max-width:480px; margin:0 auto; min-height:100vh; position:relative;
    padding-bottom:82px; overflow-x:hidden;
  }
  header{
    padding:20px 18px 14px; position:sticky; top:0; background:var(--bg); z-index:5;
    border-bottom:1px solid var(--line);
  }
  .brand{ font-family:'Manrope',sans-serif; font-weight:800; font-size:19px; letter-spacing:-0.2px; }
  .brand span.dot{ color:var(--gold); }
  .split-bar{ height:3px; border-radius:3px; margin-top:10px; background:linear-gradient(90deg, var(--left) 0%, var(--left) 48%, var(--gold) 50%, var(--right) 52%, var(--right) 100%); }
  main{ padding:18px; }
  .tab-panel{ display:none; animation:fadeIn .25s ease; }
  .tab-panel.active{ display:block; }
  @keyframes fadeIn{ from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:translateY(0);} }

  .stat-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .stat-card{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; }
  .stat-label{ font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:0.6px; font-weight:600; }
  .stat-value{ font-family:'Manrope',sans-serif; font-size:22px; font-weight:800; margin-top:6px; }
  .stat-sub{ font-size:11.5px; color:var(--dim); margin-top:2px; }

  .section-title{ font-size:13px; font-weight:700; color:var(--dim); text-transform:uppercase; letter-spacing:0.6px; margin:22px 0 10px; }
  .quick-links{ display:flex; gap:10px; margin-top:14px; }
  .quick-link{ flex:1; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 10px; text-align:center; text-decoration:none; color:var(--white); font-size:12.5px; font-weight:600; }
  .quick-link .emoji{ font-size:20px; display:block; margin-bottom:6px; }

  .gw-row{ display:flex; align-items:center; justify-content:space-between; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px; margin-top:12px; }
  .gw-name{ font-size:15px; font-weight:700; }
  .gw-status{ font-size:12px; margin-top:3px; }
  .gw-status.on{ color:var(--green); } .gw-status.off{ color:var(--right); }
  .switch{ position:relative; width:52px; height:30px; flex-shrink:0; }
  .switch input{ display:none; }
  .slider{ position:absolute; cursor:pointer; inset:0; background:#2A3350; border-radius:30px; transition:.2s; }
  .slider:before{ content:""; position:absolute; width:24px; height:24px; left:3px; top:3px; background:white; border-radius:50%; transition:.2s; }
  input:checked + .slider{ background:var(--green); }
  input:checked + .slider:before{ transform:translateX(22px); }

  .photo-grid{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:6px; }
  .photo-card{ background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; text-align:center; }
  .photo-card img{ width:100%; aspect-ratio:1; object-fit:cover; display:block; }
  .photo-card .pname{ font-size:11px; padding:6px 4px 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .photo-card .pdel{ display:block; width:100%; background:none; border:none; color:var(--right); font-size:10.5px; padding:2px 0 6px; cursor:pointer; }
  .empty{ color:var(--dim); font-size:13px; text-align:center; padding:40px 10px; }

  table{ width:100%; border-collapse:collapse; margin-top:8px; font-size:12.5px; }
  th,td{ padding:8px 6px; text-align:left; border-bottom:1px solid var(--line); }
  th{ color:var(--dim); font-weight:600; font-size:11px; text-transform:uppercase; }
  .amt-pos{ color:var(--green); font-weight:600; }
  .export-btn{ display:block; text-align:center; background:var(--gold); color:#0B0F19; font-weight:700; padding:12px; border-radius:12px; text-decoration:none; margin-top:14px; font-size:13.5px; }

  nav.bottom{
    position:fixed; bottom:0; left:50%; transform:translateX(-50%); width:100%; max-width:480px;
    background:var(--bg-soft); border-top:1px solid var(--line); display:flex; padding:8px 6px 10px;
    z-index:10;
  }
  nav.bottom button{
    flex:1; background:none; border:none; color:var(--dim); font-family:'Inter',sans-serif;
    display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 2px; border-radius:12px; cursor:pointer;
  }
  nav.bottom button .icon{ font-size:19px; }
  nav.bottom button .lbl{ font-size:10.5px; font-weight:600; }
  nav.bottom button.active{ color:var(--gold); background:rgba(255,197,61,0.08); }
</style>
</head><body>

<header>
  <div class="brand">Fan Battle Live <span class="dot">●</span> Control</div>
  <div class="split-bar"></div>
</header>

<main>
  <!-- HOME -->
  <section class="tab-panel active" id="tab-home">
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Today</div><div class="stat-value" id="todayValue">—</div><div class="stat-sub" id="todayCount">—</div></div>
      <div class="stat-card"><div class="stat-label">This month</div><div class="stat-value" id="monthValue">—</div><div class="stat-sub" id="monthCount">—</div></div>
    </div>
    <div class="section-title">Quick access</div>
    <div class="quick-links">
      <a class="quick-link" href="/overlay" target="_blank"><span class="emoji">🖥️</span>Overlay</a>
      <a class="quick-link" href="/pay-left" target="_blank"><span class="emoji">🔵</span>Left pay</a>
      <a class="quick-link" href="/pay-right" target="_blank"><span class="emoji">🔴</span>Right pay</a>
    </div>
  </section>

  <!-- GATEWAYS -->
  <section class="tab-panel" id="tab-gateways">
    <div class="section-title">Payment gateways</div>
    <div class="gw-row">
      <div><div class="gw-name">🇮🇳 Domestic (Instamojo)</div><div class="gw-status" id="domesticStatus">—</div></div>
      <label class="switch"><input type="checkbox" id="domesticToggle" onchange="toggleGateway('domestic', this.checked)"><span class="slider"></span></label>
    </div>
    <div class="gw-row">
      <div><div class="gw-name">🌍 International (PayPal)</div><div class="gw-status" id="internationalStatus">—</div></div>
      <label class="switch"><input type="checkbox" id="internationalToggle" onchange="toggleGateway('international', this.checked)"><span class="slider"></span></label>
    </div>
  </section>

  <!-- PHOTOS -->
  <section class="tab-panel" id="tab-photos">
    <div class="section-title">Donor photos — moderate here</div>
    <div class="photo-grid" id="photoGrid"></div>
  </section>

  <!-- RECORDS -->
  <section class="tab-panel" id="tab-records">
    <div class="section-title">Recent donations (latest 50)</div>
    <table>
      <tr><th>Name</th><th>Side</th><th>Amount</th></tr>
      <tbody id="recordsBody"></tbody>
    </table>
    <a class="export-btn" href="/export">⬇ Download full CSV backup</a>
  </section>
</main>

<nav class="bottom">
  <button class="active" data-tab="home" onclick="showTab('home')"><span class="icon">🏠</span><span class="lbl">Home</span></button>
  <button data-tab="gateways" onclick="showTab('gateways')"><span class="icon">🎛️</span><span class="lbl">Gateways</span></button>
  <button data-tab="photos" onclick="showTab('photos')"><span class="icon">🖼️</span><span class="lbl">Photos</span></button>
  <button data-tab="records" onclick="showTab('records')"><span class="icon">📊</span><span class="lbl">Records</span></button>
</nav>

<script>
  function showTab(name){
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  }

  function fmtCurrencies(byCurrency){
    const entries = Object.entries(byCurrency || {});
    if(!entries.length) return '—';
    return entries.map(([cur, amt]) => cur + ' ' + amt.toLocaleString('en-IN')).join(' · ');
  }

  async function loadData(){
    try {
      const res = await fetch('/api/dashboard-data');
      const d = await res.json();

      document.getElementById('todayValue').textContent = fmtCurrencies(d.todayTotals.byCurrency);
      document.getElementById('todayCount').textContent = d.todayTotals.count + ' tip' + (d.todayTotals.count === 1 ? '' : 's');
      document.getElementById('monthValue').textContent = fmtCurrencies(d.monthTotals.byCurrency);
      document.getElementById('monthCount').textContent = d.monthTotals.count + ' tip' + (d.monthTotals.count === 1 ? '' : 's');

      document.getElementById('domesticToggle').checked = d.gatewaySettings.domesticEnabled;
      document.getElementById('domesticStatus').textContent = d.gatewaySettings.domesticEnabled ? 'Active — accepting tips' : 'Paused';
      document.getElementById('domesticStatus').className = 'gw-status ' + (d.gatewaySettings.domesticEnabled ? 'on' : 'off');
      document.getElementById('internationalToggle').checked = d.gatewaySettings.internationalEnabled;
      document.getElementById('internationalStatus').textContent = d.gatewaySettings.internationalEnabled ? 'Active — accepting tips' : 'Paused';
      document.getElementById('internationalStatus').className = 'gw-status ' + (d.gatewaySettings.internationalEnabled ? 'on' : 'off');

      const photoGrid = document.getElementById('photoGrid');
      photoGrid.innerHTML = d.photos.length ? d.photos.map(p => \`
        <div class="photo-card">
          <img src="\${p.photo}">
          <div class="pname">\${p.name}</div>
          <button class="pdel" onclick="deletePhoto('\${encodeURIComponent(p.name)}')">Delete</button>
        </div>\`).join('') : '<div class="empty" style="grid-column:1/-1;">No photos uploaded yet.</div>';

      const recordsBody = document.getElementById('recordsBody');
      recordsBody.innerHTML = d.recentRecords.length ? d.recentRecords.map(r => \`
        <tr><td>\${r.name}</td><td>\${r.side || '-'}</td><td class="amt-pos">\${r.currency || 'INR'} \${r.amount.toLocaleString('en-IN')}</td></tr>\`).join('') : '<tr><td colspan="3" style="color:var(--dim);">No records yet</td></tr>';
    } catch(e){ console.error('Could not load dashboard data:', e); }
  }

  function toggleGateway(gateway, enabled){
    const statusEl = document.getElementById(gateway + 'Status');
    statusEl.textContent = 'Saving...';
    fetch('/gateway-settings/toggle', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ gateway, enabled })
    }).then(r => r.json()).then(d => {
      statusEl.textContent = enabled ? 'Active — accepting tips' : 'Paused';
      statusEl.className = 'gw-status ' + (enabled ? 'on' : 'off');
    }).catch(() => { statusEl.textContent = 'Network error'; });
  }

  function deletePhoto(encodedName){
    fetch('/donor-photo?name=' + encodedName, { method:'DELETE' }).then(loadData);
  }

  loadData();
  setInterval(loadData, 10000); // keep stats fresh while the app is open
</script>
</body></html>`);
});

app.get('/dashboard', requireDashboardAuth, (req, res) => {
  const records = loadRecords();
  const byMonth = {}, byDay = {};
  for (const r of records) {
    const month = r.timestamp.slice(0, 7), day = r.timestamp.slice(0, 10), cur = r.currency || 'INR';
    if (!byMonth[month]) byMonth[month] = { byCurrency: {}, count: 0 };
    byMonth[month].byCurrency[cur] = (byMonth[month].byCurrency[cur] || 0) + r.amount;
    byMonth[month].count += 1;
    if (!byDay[day]) byDay[day] = { byCurrency: {}, count: 0 };
    byDay[day].byCurrency[cur] = (byDay[day].byCurrency[cur] || 0) + r.amount;
    byDay[day].count += 1;
  }
  const fmtCurrencies = (byCurrency) => Object.entries(byCurrency).map(([cur, amt]) => `${cur} ${amt.toLocaleString('en-IN')}`).join(' · ');
  const months = Object.keys(byMonth).sort().reverse();
  const days = Object.keys(byDay).sort().reverse();
  const monthRows = months.map(m => `<tr><td>${m}</td><td>${fmtCurrencies(byMonth[m].byCurrency)}</td><td>${byMonth[m].count}</td></tr>`).join('');
  const dayRows = days.map(d => `<tr><td>${d}</td><td>${fmtCurrencies(byDay[d].byCurrency)}</td><td>${byDay[d].count}</td></tr>`).join('');
  const recordRows = [...records].reverse().slice(0, 300).map(r => `
    <tr><td>${new Date(r.timestamp).toLocaleString('en-IN')}</td><td>${r.name}</td><td>${r.side}</td>
    <td>${(r.currency||'INR')} ${r.amount.toLocaleString('en-IN')}</td><td>${r.country || '-'}</td><td>${r.source || '-'}</td>
    <td>${r.email || '-'}</td><td>${r.phone || '-'}</td><td style="font-size:11px; color:#888;">${r.id}</td></tr>`).join('');
  const photoRows = Object.entries(donorPhotoMap).map(([name, v]) => `
    <div style="display:inline-block; margin:8px; text-align:center;">
      <img src="${v.photo}" style="width:90px; height:90px; object-fit:cover; border-radius:10px; display:block;">
      <div style="font-size:12px; margin-top:4px;">${name}</div>
      ${v.driveLink ? `<div style="font-size:10px;"><a href="${v.driveLink}" target="_blank" style="color:#6C9BFF;">Drive backup ↗</a></div>` : `<div style="font-size:10px; color:#FF8A7A;">No Drive backup</div>`}
      <button onclick="fetch('/donor-photo?name=${encodeURIComponent(name)}', {method:'DELETE'}).then(()=>location.reload())"
        style="font-size:11px; background:#FF4B3E; color:#fff; border:none; padding:4px 8px; border-radius:6px; margin-top:4px; cursor:pointer;">Delete</button>
    </div>`).join('') || '<p style="color:#8B93A7;">No photos uploaded yet.</p>';

  res.send(`<html><head><title>Fan Battle Live — Dashboard</title>
    <style>
      body{ font-family: Arial, sans-serif; background:#0B0F19; color:#F5F7FA; padding:24px; }
      h1{ font-size:22px; } h2{ font-size:16px; margin-top:32px; color:#FFC53D; }
      table{ border-collapse:collapse; width:100%; margin-top:10px; }
      th, td{ border:1px solid #333; padding:6px 10px; font-size:13px; text-align:left; }
      th{ background:#121728; } tr:nth-child(even){ background:#121728; }
      .warn{ background:#2a1f0a; border:1px solid #FFC53D; padding:10px 14px; border-radius:8px; font-size:12.5px; margin-top:8px; }
    </style></head><body>
      <h1>📊 Fan Battle Live — Donation Records</h1>
      <p><a href="/gateway-settings" style="color:#FFC53D; font-size:13px;">🎛️ Payment Gateway Switches (turn tips on/off) →</a></p>
      <div class="warn">⚠️ This page and the Google Sheet are convenience copies. Instamojo's own dashboard is authoritative for domestic (₹) payments, and PayPal's own Activity/Reports page is authoritative for international payments.</div>
      <h2>Monthly totals (by currency)</h2>
      <table><tr><th>Month</th><th>Totals</th><th>Payments</th></tr>${monthRows || '<tr><td colspan="3">No records yet</td></tr>'}</table>
      <h2>Daily totals (by currency)</h2>
      <table><tr><th>Date</th><th>Totals</th><th>Payments</th></tr>${dayRows || '<tr><td colspan="3">No records yet</td></tr>'}</table>
      <h2>🖼️ Uploaded donor photos (moderate here)</h2>
      <div>${photoRows}</div>
      <h2>Individual records (latest 300)</h2>
      <p><a href="/export" style="display:inline-block; background:#FFC53D; color:#0B0F19; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:bold;">⬇ Download full backup (CSV)</a></p>
      <table><tr><th>Time</th><th>Name</th><th>Side</th><th>Amount</th><th>Country</th><th>Via</th><th>Email</th><th>Phone</th><th>ID</th></tr>
      ${recordRows || '<tr><td colspan="9">No records yet</td></tr>'}</table>
    </body></html>`);
});

app.get('/export', requireDashboardAuth, (req, res) => {
  const records = loadRecords();
  const header = 'timestamp,name,side,amount,currency,country,source,email,phone,purpose,payment_id\n';
  const rows = records.map(r => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [r.timestamp, r.name, r.side, r.amount, r.currency || 'INR', r.country, r.source, r.email, r.phone, r.purpose, r.id].map(esc).join(',');
  }).join('\n');
  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="fan-battle-records-${today}.csv"`);
  res.send(header + rows);
});

const PORT = process.env.PORT || 3000;

// =====================================================================
// =====================  CONTENT CALENDAR (STEP 2)  ====================
// =====================================================================
// A separate Google Apps Script Web App (deployed from a "Calendar" Google
// Sheet — see CALENDAR-SHEET-SETUP.md for the exact script to paste) reads
// today's row and returns it as JSON. This server just proxies that, with a
// short cache so the overlay's periodic checks don't hammer the Sheet.
const CALENDAR_WEBHOOK_URL = process.env.CALENDAR_WEBHOOK_URL || '';
let calendarCache = { date: null, data: null, fetchedAt: 0 };
const CALENDAR_CACHE_MS = 60000; // re-check the Sheet at most once a minute

app.get('/calendar-today', async (req, res) => {
  if (!CALENDAR_WEBHOOK_URL) return res.json({ found: false, reason: 'not_configured' });
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, server's own clock
  const now = Date.now();
  if (calendarCache.date === today && (now - calendarCache.fetchedAt) < CALENDAR_CACHE_MS) {
    return res.json(calendarCache.data);
  }
  try {
    const sheetRes = await fetch(`${CALENDAR_WEBHOOK_URL}?date=${today}`);
    const sheetData = await sheetRes.json();
    calendarCache = { date: today, data: sheetData, fetchedAt: now };
    res.json(sheetData);
  } catch (e) {
    console.error('Could not reach Content Calendar Sheet:', e.message);
    // If the Sheet is briefly unreachable but we have a same-day cached
    // answer, prefer that over failing the overlay outright.
    if (calendarCache.date === today && calendarCache.data) return res.json(calendarCache.data);
    res.json({ found: false, reason: 'fetch_error' });
  }
});

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });

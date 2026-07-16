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
// Stored as { name: { photo: "data:image/...", timestamp } } so the streamer
// can moderate (delete) any single one from the dashboard.
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
const RETURN_TO_STREAM_BUFFER_MS = 9000;  // used when the donor explicitly confirms/skips — see /confirm-return
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
async function createInstamojoPaymentRequest(amount, side) {
  const purpose = (side === 'left' ? 'L: ' : 'R: ') + 'Fan Battle Live tip';
  const redirectUrl = `${PUBLIC_BASE_URL}/thanks?via=instamojo`;
  const body = new URLSearchParams({
    purpose, amount: String(amount), redirect_url: redirectUrl, send_email: 'False', send_sms: 'False',
    allow_repeated_payments: 'False'
  });
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
function instamojoAmountPageHtml(side, teamName) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support ${teamName}</title>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; text-align:center; padding:32px 16px;}
    h2{margin-bottom:6px;} p{color:#8B93A7; font-size:14px;}
    input{padding:10px; border-radius:8px; border:1px solid #333; font-size:16px; margin:6px; width:140px;}
    button{padding:12px 28px; border-radius:10px; border:none; background:#FFC53D; color:#0B0F19; font-weight:bold; font-size:15px; margin-top:12px;}
    #status{margin-top:14px; font-weight:bold;}
  </style></head><body>
    <h2>Support ${teamName} 🔥</h2>
    <p>যেকোনো অ্যামাউন্ট বসান — এটা সম্পূর্ণ স্বেচ্ছায় দেওয়া টিপস, কোনো পণ্য/পুরস্কার নেই।</p>
    <div><input type="number" id="amt" placeholder="₹ Amount" min="1" value="10"></div>
    <button onclick="pay()">Pay Now</button>
    <div id="status"></div>
    <script>
      function pay(){
        document.getElementById('status').textContent = 'Redirecting to payment...';
        fetch('/instamojo-create-request', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ amount: document.getElementById('amt').value, side: '${side}' })
        }).then(r => r.json()).then(d => {
          if(d.longurl) window.location.href = d.longurl;
          else document.getElementById('status').textContent = 'Something went wrong, please try again.';
        });
      }
    </script>
  </body></html>`;
}

app.post('/instamojo-create-request', async (req, res) => {
  try {
    const { amount, side } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const longurl = await createInstamojoPaymentRequest(amt, side === 'left' ? 'left' : 'right');
    res.json({ longurl });
  } catch (e) {
    console.error('instamojo-create-request failed:', e.message);
    res.status(500).json({ error: 'Could not create Instamojo payment request' });
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
    const { orderID } = req.body;
    const token = await getPaypalAccessToken();
    const captureRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const capture = await captureRes.json();
    const purchaseUnit = (capture.purchase_units || [])[0] || {};
    const captureObj = (purchaseUnit.payments && purchaseUnit.payments.captures && purchaseUnit.payments.captures[0]) || {};
    const payer = capture.payer || {};
    const name = [payer.name && payer.name.given_name, payer.name && payer.name.surname].filter(Boolean).join(' ') || 'Anonymous';
    const amount = captureObj.amount ? captureObj.amount.value : null;
    const currency = captureObj.amount ? captureObj.amount.currency_code : 'USD';
    const country = (payer.address && payer.address.country_code) || null;
    const side = (purchaseUnit.custom_id === 'left') ? 'left' : 'right';

    let celebrationId = null;
    if (amount) {
      const record = recordDonation({ id: captureObj.id || orderID, name, email: payer.email_address, country, side, amount, currency, purpose: 'PayPal donation', source: 'paypal' });
      celebrationId = record.id;
    }
    // Tell the client everything /thanks would need, so the PayPal page can
    // show the same "add your photo" invite inline without a redirect hop.
    // celebrationId is what the page uses when the donor confirms a photo
    // or taps Skip — that's the moment the overlay celebration actually fires.
    res.json({ status: capture.status || 'UNKNOWN', name, side, amount, currency, celebrationId, isTopThree: amount ? isCurrentlyTopThree(name) : false });
  } catch (e) { console.error('paypal-capture-order failed:', e.message); res.status(500).json({ error: 'Could not capture PayPal payment' }); }
});

function paypalPageHtml(side, teamName) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Support ${teamName}</title>
  <script src="https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture"></script>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; text-align:center; padding:32px 16px;}
    h2{margin-bottom:6px;} p{color:#8B93A7; font-size:14px;}
    input, select{padding:10px; border-radius:8px; border:1px solid #333; font-size:16px; margin:6px; width:140px;}
    #paypal-button-container{max-width:320px; margin:20px auto;}
    #status{margin-top:14px; font-weight:bold;}
    #photoSection{display:none; margin-top:22px; border-top:1px solid #333; padding-top:18px;}
    #photoSection img{max-width:120px; border-radius:12px; margin-top:8px;}
    .skipBtn{position:fixed; top:14px; right:14px; background:#222; color:#fff; border:none; border-radius:50%; width:34px; height:34px; font-size:18px; cursor:pointer;}
  </style></head><body>
    ${STREAM_BACK_URL ? `<button class="skipBtn" onclick="skipToStream()" title="Back to stream">✕</button>` : ''}
    <h2>Support ${teamName} 🔥</h2>
    <p>Enter any amount you'd like to tip — this is a voluntary show of support, no goods or services are exchanged.</p>
    <div>
      <input type="number" id="amt" placeholder="Amount" min="1" value="5">
      <select id="cur">
        <option value="USD">USD $</option><option value="EUR">EUR €</option><option value="GBP">GBP £</option>
        <option value="AUD">AUD A$</option><option value="CAD">CAD C$</option>
      </select>
    </div>
    <div id="paypal-button-container"></div>
    <div id="status"></div>
    <div id="photoSection">
      <p><b>Want to show your photo on the live stream?</b><br>Totally optional — skip if you'd rather not.</p>
      <input type="file" id="photoInput" accept="image/*">
      <div id="photoPreviewWrap"><img id="photoPreview" style="display:none;"></div>
      <br><button onclick="uploadPhoto()">Add my photo</button>
      ${STREAM_BACK_URL ? `<br><br><a href="javascript:void(0)" onclick="skipToStream()" style="color:#8B93A7;">Skip — back to stream</a>` : ''}
    </div>
    <script>
      let donorName = '';
      let celebrationId = null;

      // Whether the donor confirms a photo or taps Skip, this is the ONE
      // moment that matters: it tells the server "I'm heading back to the
      // stream now", which is when the buffered celebration timer starts —
      // NOT at the instant the payment was captured. fetch(..., {keepalive:true})
      // lets the request finish sending even as the page navigates away.
      function confirmReturnAndGo(){
        if(celebrationId){
          fetch('/confirm-return', {
            method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
            body: JSON.stringify({ celebrationId })
          }).catch(()=>{});
        }
        ${STREAM_BACK_URL ? `window.location.href = '${STREAM_BACK_URL}';` : ''}
      }
      function skipToStream(){ confirmReturnAndGo(); }

      paypal.Buttons({
        createOrder: function() {
          return fetch('/paypal-create-order', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ amount: document.getElementById('amt').value, currency: document.getElementById('cur').value, side: '${side}' })
          }).then(r => r.json()).then(d => d.id);
        },
        onApprove: function(data) {
          document.getElementById('status').textContent = 'Processing...';
          return fetch('/paypal-capture-order', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ orderID: data.orderID, side: '${side}' })
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
  </style></head><body>
    ${STREAM_BACK_URL ? `<button class="skipBtn" onclick="skipToStream()" title="Back to stream / স্ট্রিমে ফিরে যান">✕</button>` : ''}
    <h2>🎉 Thank you, ${name || 'friend'}!</h2>
    <p>${amount ? `Your ${currency || '₹'} ${amount} tip has been received.` : 'Your support has been received.'}</p>
    <p><b>Want to show your photo on the live stream?</b><br>এটা সম্পূর্ণ ঐচ্ছিক — না চাইলে স্কিপ করুন।</p>
    <div><input type="file" id="photoInput" accept="image/*"></div>
    <img id="photoPreview" style="display:none;">
    <br><button onclick="uploadPhoto()">Add my photo / ছবি যোগ করুন</button>
    ${STREAM_BACK_URL ? `<br><br><a href="javascript:void(0)" onclick="skipToStream()" style="color:#8B93A7;">Skip — back to stream / স্কিপ করুন</a>` : ''}
    <div id="doneMsg"></div>
    <script>
      const donorName = ${JSON.stringify(name || 'Anonymous')};
      const celebrationId = ${JSON.stringify(celebrationId || null)};

      // This is the moment that matters — not when the payment happened,
      // but when the donor is actually about to be watching the stream
      // again. keepalive lets the request finish even mid-navigation.
      function confirmReturnAndGo(){
        if(celebrationId){
          fetch('/confirm-return', {
            method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
            body: JSON.stringify({ celebrationId })
          }).catch(()=>{});
        }
        ${STREAM_BACK_URL ? `window.location.href = '${STREAM_BACK_URL}';` : ''}
      }
      function skipToStream(){ confirmReturnAndGo(); }

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
    const { payment_id, payment_status } = req.query;
    let name = null, amount = null, currency = 'INR', side = null, celebrationId = null;
    if (payment_id && payment_status === 'Credit') {
      const payment = await fetchInstamojoPayment(payment_id);
      if (payment) {
        name = payment.buyer_name; amount = payment.amount; currency = 'INR';
        const purpose = payment.purpose || '';
        side = /^L:/i.test(purpose.trim()) ? 'left' : (/^R:/i.test(purpose.trim()) ? 'right' : null);
        // Record now (recordDonation's built-in duplicate-guard makes this
        // safe even if the background poller also notices this same
        // payment_id around the same time) — celebration itself is queued
        // separately, only once the donor confirms/skips on this page.
        const record = recordDonation({ id: payment_id, name, side, amount, currency, purpose, source: 'instamojo' });
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

app.post('/donor-photo', (req, res) => {
  const { name, photoDataUrl, celebrationId } = req.body;
  if (!name || !photoDataUrl) return res.status(400).json({ error: 'Missing name or photo' });
  donorPhotoMap[name] = { photo: photoDataUrl, timestamp: new Date().toISOString() };
  savePhotos(donorPhotoMap);
  // Extra safety net: log that a photo was uploaded (name + time only, not
  // the image itself — keeps the Sheet lightweight) in case the photo file
  // on disk is ever lost, at least there's a trace of who uploaded one.
  backupToGoogleSheet({
    id: 'photo-' + Date.now(), name, side: '', amount: '', currency: '', country: '',
    purpose: 'PHOTO_UPLOADED', source: 'photo-log', timestamp: new Date().toISOString()
  });
  // Confirming a photo IS the donor's "I'm heading back to the stream now"
  // moment — queue their celebration the same way Skip does.
  if (celebrationId) setTimeout(() => notifyOverlay(celebrationId), RETURN_TO_STREAM_BUFFER_MS);
  res.json({ ok: true });
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

app.get('/pay-left', async (req, res) => {
  const country = await lookupCountry(getVisitorIp(req));
  if (country === 'IN') return res.send(instamojoAmountPageHtml('left', 'the Left side'));
  res.send(paypalPageHtml('left', 'the Left side'));
});
app.get('/pay-right', async (req, res) => {
  const country = await lookupCountry(getVisitorIp(req));
  if (country === 'IN') return res.send(instamojoAmountPageHtml('right', 'the Right side'));
  res.send(paypalPageHtml('right', 'the Right side'));
});

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
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });

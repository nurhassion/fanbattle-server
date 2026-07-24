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
app.use(express.json({ limit: '60mb' })); // content ideas can now bundle photos + multiple voice/music audio clips as base64

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

// ====== Multi-channel config (Fan Battle Live / Zero to Trader / Daily Needle) ======
// Each channel gets its OWN saved-ideas file, its own Google Drive backup
// destination (so Render restarts never lose any channel's ideas), and its
// own YouTube/Facebook links for the Go-Live wizard. Fan Battle Live and
// Zero to Trader share the original Google account's backup webhook;
// Daily Needle uses a separate, dedicated Google account/webhook (set up
// specifically to avoid one account's storage/quota being shared across
// everything).
const CHANNELS = {
  fanbattle: {
    label: 'Fan Battle Live',
    file: path.join(__dirname, 'scheduled-events-fanbattle.json'),
    youtubeUrl: 'https://www.youtube.com/@supportyourfavourite',
    facebookUrl: 'https://www.facebook.com/share/18Av6gds4G/',
    webhookUrl: () => GSHEET_WEBHOOK_URL,
    secret: () => GSHEET_SECRET
  },
  zerototrader: {
    label: 'Zero to Trader',
    file: path.join(__dirname, 'scheduled-events-zerototrader.json'),
    youtubeUrl: 'https://www.youtube.com/@ZerotoTrader-y6k',
    facebookUrl: 'https://www.facebook.com/share/1YovxyeAcD/',
    webhookUrl: () => GSHEET_WEBHOOK_URL,
    secret: () => GSHEET_SECRET,
    // Facebook Live requires 100 followers + the Page being 60 days old —
    // rather than guessing this automatically, you flip this switch
    // yourself from the app once Facebook itself shows you're eligible.
    // Until then, Go Live only ever sends you to YouTube.
    facebookEligibilityIsManual: true
  },
  dailyneedle: {
    label: 'Daily Needle',
    file: path.join(__dirname, 'scheduled-events-dailyneedle.json'),
    youtubeUrl: 'https://www.youtube.com/@DailyNeedle',
    facebookUrl: 'https://www.facebook.com/share/1D9aN6mMPv/',
    webhookUrl: () => GSHEET_WEBHOOK_URL_CH3,
    secret: () => GSHEET_SECRET_CH3
  }
};
function channelOrDefault(channel) { return CHANNELS[channel] ? channel : 'fanbattle'; }

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
function loadScheduledEvents(channel) {
  const ch = channelOrDefault(channel);
  const file = CHANNELS[ch].file;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    // One-time migration: the very first version of this server only had a
    // single channel (Fan Battle Live) saved at the old shared filename —
    // if that old file still exists and the new per-channel file doesn't
    // yet, adopt it once so nobody's existing ideas silently disappear.
    if (ch === 'fanbattle') {
      try { return JSON.parse(fs.readFileSync(SCHEDULED_EVENTS_FILE, 'utf8')); }
      catch (e2) { return []; }
    }
    return [];
  }
}
function saveScheduledEvents(events, channel) {
  const ch = channelOrDefault(channel);
  try { fs.writeFileSync(CHANNELS[ch].file, JSON.stringify(events, null, 2)); }
  catch (e) { console.error(`Could not save scheduled events (${ch}):`, e.message); }
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
// Daily Needle's OWN dedicated Google account/Apps Script — kept entirely
// separate from the original account so its content ideas (which can carry
// large base64 photos) never share storage/quota with donation records,
// donor photos, or the other two channels' saved ideas.
const GSHEET_WEBHOOK_URL_CH3 = process.env.GSHEET_WEBHOOK_URL_CH3 || 'https://script.google.com/macros/s/AKfycbyaxFWaA-3yuiopQ0Y8S7ShoMWkwMICzn-XiNteDAcrDHFnuqfXhRKsKXqJJ2nsbR5C/exec';
const GSHEET_SECRET_CH3 = process.env.GSHEET_SECRET_CH3 || 'papugandu.0215.0912.02150912';
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

// ====== Content Ideas — durable cross-device backup, per channel ======
// Render's free-tier disk can be wiped on restart/redeploy — so each
// channel's local scheduled-events-*.json file alone is only a fast,
// same-session cache, not the source of truth. Every save/delete is ALSO
// pushed to that channel's own Google Drive (as a JSON text file, via its
// Apps Script webhook) which survives any server restart AND is reachable
// from any device — this is what makes ideas durable and "the same
// everywhere", not tied to one laptop/phone's local storage. Fan Battle
// Live and Zero to Trader share the original account's webhook; Daily
// Needle uses its own separate one (see CHANNELS config above).
async function backupContentIdeasToSheet(events, channel) {
  const ch = channelOrDefault(channel);
  const webhookUrl = CHANNELS[ch].webhookUrl();
  const secret = CHANNELS[ch].secret();
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'content-ideas', ideas: events, secret })
    });
  } catch (e) { console.error(`Could not back up content ideas to Google Drive (${ch}):`, e.message); }
}
async function fetchContentIdeasFromSheet(channel) {
  const ch = channelOrDefault(channel);
  const webhookUrl = CHANNELS[ch].webhookUrl();
  const secret = CHANNELS[ch].secret();
  if (!webhookUrl) return null;
  try {
    const res = await fetch(`${webhookUrl}?type=content-ideas&secret=${encodeURIComponent(secret)}`);
    const data = await res.json();
    return Array.isArray(data.ideas) ? data.ideas : null;
  } catch (e) { console.error(`Could not restore content ideas from Google Drive (${ch}):`, e.message); return null; }
}
// Called once at server startup (see bottom of this file) — for EACH
// channel, if its local file is empty (fresh disk after a restart) but a
// durable copy exists on that channel's own Drive, pull it back down so
// nothing saved earlier is lost, for all three channels independently.
async function restoreContentIdeasOnStartup() {
  for (const ch of Object.keys(CHANNELS)) {
    const local = loadScheduledEvents(ch);
    if (local.length > 0) continue; // this channel's local file already has data this boot — nothing to restore
    const webhookUrl = CHANNELS[ch].webhookUrl();
    if (!webhookUrl) { console.log(`ℹ️ No backup webhook configured for "${ch}" — its content ideas will only persist for this server session.`); continue; }
    const restored = await fetchContentIdeasFromSheet(ch);
    if (restored && restored.length > 0) {
      saveScheduledEvents(restored, ch);
      console.log(`♻️ Restored ${restored.length} content idea(s) for "${ch}" from Google Drive backup after restart.`);
    }
  }
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

// ====== Per-channel in-memory event queues the browser overlays poll ======
// Fan Battle Live keeps "side" meaning left/right (its own two-team battle).
// Daily Needle and Zero to Trader have no sides at all — for them, `side`
// IS the channel name itself ('dailyneedle' / 'zerototrader'), and this
// helper maps any side value to which overlay's queue it belongs in.
function sideToChannel(side) {
  if (side === 'left' || side === 'right') return 'fanbattle';
  if (side === 'dailyneedle' || side === 'zerototrader') return side;
  return 'fanbattle';
}
let latestEventsByChannel = { fanbattle: [], dailyneedle: [], zerototrader: [] };

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
  const channel = sideToChannel(pending.side);
  latestEventsByChannel[channel].push(pending);
  console.log(`🎉 Celebration fired for (${channel}):`, pending.name, '(after donor confirmed return to stream)');
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

// Shared with the /thanks handler further below — decodes which of the
// four possible prefixes (L/R for Fan Battle Live's two sides, DN for
// Daily Needle, ZT for Zero to Trader) an Instamojo purpose string starts
// with, so every payment always lands on the correct channel/overlay.
function parseSideFromPurpose(purpose) {
  const p = (purpose || '').trim();
  if (/^ZT:/i.test(p)) return 'zerototrader';
  if (/^DN:/i.test(p)) return 'dailyneedle';
  if (/^R:/i.test(p)) return 'right';
  if (/^L:/i.test(p)) return 'left';
  return null;
}

async function resolveSideFromPaymentRequest(paymentRequestUrl) {
  if (!paymentRequestUrl) return null;
  try {
    const res = await fetch(paymentRequestUrl, { headers: { 'X-Api-Key': API_KEY, 'X-Auth-Token': AUTH_TOKEN } });
    const data = await res.json();
    const pr = data.payment_request || data;
    const purpose = (pr && pr.purpose) || '';
    return parseSideFromPurpose(purpose);
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
        let side = parseSideFromPurpose(purposeRaw);
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
// Maps every valid "side" value (which now also doubles as a bare channel
// name for Daily Needle/Zero to Trader) to the short prefix embedded in the
// Instamojo purpose field/PayPal custom_id — this is how /thanks and the
// background poller later figure out which channel a payment belongs to.
const SIDE_PREFIX = { left: 'L', right: 'R', dailyneedle: 'DN', zerototrader: 'ZT' };
const SIDE_LABEL = { left: 'Fan Battle Live tip', right: 'Fan Battle Live tip', dailyneedle: 'Daily Needle tip', zerototrader: 'Zero to Trader tip' };
async function createInstamojoPaymentRequest(amount, side, donorName, donorPhone) {
  const prefix = SIDE_PREFIX[side] || 'R';
  const purpose = `${prefix}: ${SIDE_LABEL[side] || 'Fan Battle Live tip'}`;
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
    <label class="fieldLabel">Mobile number <span class="req">*required</span></label>
    <div><input type="tel" id="donorPhone" placeholder="Your mobile number"></div>
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
        if(!donorPhone){
          document.getElementById('status').textContent = 'Please enter your mobile number — it\\'s required.';
          document.getElementById('donorPhone').focus();
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
    if (!donorPhone || !donorPhone.trim()) return res.status(400).json({ error: 'Mobile number is required.' });
    if (!amt || amt < 9) return res.status(400).json({ error: 'Minimum amount is ₹9 (Instamojo requirement).' });
    const validSides = ['left', 'right', 'dailyneedle', 'zerototrader'];
    const safeSide = validSides.includes(side) ? side : 'right';
    const longurl = await createInstamojoPaymentRequest(amt, safeSide, donorName.trim(), donorPhone);
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
    // A donor should see the CHANNEL's name during PayPal checkout, never the
    // account holder's personal/real name — PayPal's experience_context lets
    // us set this per-order, so each channel shows its own brand here.
    const PAYPAL_BRAND_NAME = {
      left: 'Fan Battle Live', right: 'Fan Battle Live',
      dailyneedle: 'Daily Needle', zerototrader: 'Zero to Trader'
    };
    const brandName = PAYPAL_BRAND_NAME[side] || 'Fan Battle Live';
    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: currency || 'USD', value: amt.toFixed(2) }, custom_id: ['left', 'right', 'dailyneedle', 'zerototrader'].includes(side) ? side : 'right' }],
        payment_source: { paypal: { experience_context: { brand_name: brandName } } }
      })
    });
    const order = await orderRes.json();
    res.json({ id: order.id });
  } catch (e) { console.error('paypal-create-order failed:', e.message); res.status(500).json({ error: 'Could not create PayPal order' }); }
});

app.post('/paypal-capture-order', async (req, res) => {
  try {
    const { orderID, donorName, donorPhone, donorEmail } = req.body;
    // Legal/record-keeping requirement: an email is mandatory for every
    // international donor, so there's always a way to identify who paid
    // if a dispute or legal question ever comes up later.
    if (!donorEmail || !donorEmail.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
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
    // Prefer the email the donor typed on our own page (guaranteed present,
    // since it's required above) over PayPal's own account email — this is
    // what we asked them for specifically for legal/dispute traceability.
    const email = donorEmail.trim() || payer.email_address;
    const amount = captureObj.amount ? captureObj.amount.value : null;
    const currency = captureObj.amount ? captureObj.amount.currency_code : 'USD';
    const country = (payer.address && payer.address.country_code) || null;
    const side = ['left', 'right', 'dailyneedle', 'zerototrader'].includes(purchaseUnit.custom_id) ? purchaseUnit.custom_id : 'right';

    let celebrationId = null;
    if (amount) {
      const record = recordDonation({ id: captureObj.id || orderID, name, email, phone: donorPhone || null, country, side, amount, currency, purpose: 'PayPal donation', source: 'paypal' });
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
    <label class="fieldLabel">Email <span class="req">*required</span></label>
    <div><input type="email" id="donorEmailInput" placeholder="you@example.com"></div>
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
      <input type="file" id="photoInput" accept="image/*">
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
          const donorEmailVal = document.getElementById('donorEmailInput').value.trim();
          const amtVal = parseFloat(document.getElementById('amt').value);
          if(!donorNameVal){
            document.getElementById('status').textContent = 'Please enter your name — it\\'s required.';
            document.getElementById('donorNameInput').focus();
            return Promise.reject(new Error('name required'));
          }
          if(!donorEmailVal || !donorEmailVal.includes('@')){
            document.getElementById('status').textContent = 'Please enter a valid email — it\\'s required.';
            document.getElementById('donorEmailInput').focus();
            return Promise.reject(new Error('email required'));
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
          const donorEmailVal = document.getElementById('donorEmailInput').value.trim();
          return fetch('/paypal-capture-order', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ orderID: data.orderID, side: '${side}', donorName: donorNameVal, donorPhone: donorPhoneVal, donorEmail: donorEmailVal })
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
    <div><input type="file" id="photoInput" accept="image/*"></div>
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
        side = parseSideFromPurpose(purpose);
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

// ====== Daily Needle & Zero to Trader — ONE smart-routed QR each ======
// Same exact mechanism as /pay-left and /pay-right above (India → Instamojo,
// abroad → PayPal, decided per-visitor) — just a single QR per channel
// instead of two, since neither channel has "sides" to split between.
const SINGLE_CHANNEL_PAY_LABEL = { dailyneedle: 'Daily Needle', zerototrader: 'Zero to Trader' };
app.get('/pay/:channel', async (req, res) => {
  const channel = req.params.channel;
  if (channel !== 'dailyneedle' && channel !== 'zerototrader') return res.status(404).send('Unknown channel');
  const label = SINGLE_CHANNEL_PAY_LABEL[channel];
  const gw = loadGatewaySettings();
  if (req.query.force === 'paypal') {
    if (!gw.internationalEnabled) return res.send(pausedPageHtml(label));
    return res.send(paypalPageHtml(channel, label));
  }
  if (req.query.force === 'instamojo') {
    if (!gw.domesticEnabled) return res.send(pausedPageHtml(label));
    return res.send(instamojoAmountPageHtml(channel, label));
  }
  const country = await lookupCountry(getVisitorIp(req));
  if (country === 'IN') {
    if (!gw.domesticEnabled) return res.send(pausedPageHtml(label));
    return res.send(instamojoAmountPageHtml(channel, label));
  }
  if (!gw.internationalEnabled) return res.send(pausedPageHtml(label));
  res.send(paypalPageHtml(channel, label));
});

// NOTE: the /gateway-settings page and its toggle endpoint are registered
// further below, right after requireDashboardAuth is defined (they need
// that middleware to exist first).

// =====================================================================
// ===============================  ROUTES  =============================
// =====================================================================
app.get('/events', (req, res) => {
  const eventsToSend = [...latestEventsByChannel.fanbattle];
  latestEventsByChannel.fanbattle = [];
  const photosOut = {};
  Object.entries(donorPhotoMap).forEach(([name, v]) => { photosOut[name] = v.photo; });
  res.json({ events: eventsToSend, photos: photosOut });
});
// Daily Needle and Zero to Trader poll their OWN channel's events —
// entirely separate queues, so one channel's tips never show up on
// another channel's overlay.
app.get('/events/:channel', (req, res) => {
  const channel = (req.params.channel === 'dailyneedle' || req.params.channel === 'zerototrader') ? req.params.channel : 'fanbattle';
  const eventsToSend = [...latestEventsByChannel[channel]];
  latestEventsByChannel[channel] = [];
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

// ====== "Add New Gateway" request ======
// This does NOT wire up real payment processing by itself — every gateway
// (Razorpay, Stripe, etc.) has its own different API, so real integration
// code has to be written once you actually have that gateway's approval and
// API keys. What this DOES do: instantly records your request so it shows
// up right here in the app as "Pending — needs integration", instead of
// getting lost in chat. Once the real code is added for a specific gateway,
// its entry becomes a live on/off switch like Instamojo/PayPal above.
app.post('/gateway-settings/add-gateway', requireDashboardAuth, (req, res) => {
  const { name, category, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Gateway name is required.' });
  if (category !== 'domestic' && category !== 'international') return res.status(400).json({ ok: false, error: 'Category must be domestic or international.' });
  const gw = loadGatewaySettings();
  gw.additionalGateways.push({
    id: 'gw-' + Date.now(),
    name: name.trim(),
    category,
    notes: (notes || '').trim(),
    status: 'pending_integration',
    addedAt: new Date().toISOString()
  });
  saveGatewaySettings(gw);
  res.json({ ok: true, settings: gw });
});

app.delete('/gateway-settings/remove-gateway', requireDashboardAuth, (req, res) => {
  const { id } = req.query;
  const gw = loadGatewaySettings();
  gw.additionalGateways = gw.additionalGateways.filter(g => g.id !== id);
  saveGatewaySettings(gw);
  res.json({ ok: true, settings: gw });
});

// Streamer-only moderation: delete any photo they don't want shown.
app.delete('/donor-photo', requireDashboardAuth, (req, res) => {
  const { name } = req.query;
  if (name && donorPhotoMap[name]) { delete donorPhotoMap[name]; savePhotos(donorPhotoMap); }
  res.json({ ok: true });
});

// Each channel's overlay is its own HTML file — Fan Battle Live keeps its
// original filename (and the original bare /overlay URL, unchanged, so the
// OBS Browser Source you already set up keeps working with no edits);
// Daily Needle and Zero to Trader are new files (see OVERLAY_FILES below).
const OVERLAY_FILES = {
  fanbattle: 'fan-battle-live-demo.html',
  dailyneedle: 'daily-needle-overlay.html',
  zerototrader: 'zero-to-trader-overlay.html'
};
function serveOverlay(channel, res) {
  const fileName = OVERLAY_FILES[channelOrDefault(channel)];
  const filePath = path.join(__dirname, fileName);
  // No caching, ever — every layout/CSS fix must take effect immediately
  // the next time this page loads, never an old cached copy.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(`<body style="background:#0B0F19;color:#F5F7FA;font-family:Arial;text-align:center;padding:60px;">This channel's overlay file (${fileName}) hasn't been uploaded to the server yet.</body>`);
  }
  res.sendFile(filePath);
}
app.get('/overlay', requireOverlayAuth, (req, res) => { serveOverlay('fanbattle', res); });
app.get('/overlay/:channel', requireOverlayAuth, (req, res) => { serveOverlay(req.params.channel, res); });

// ====== Unified App: JSON data API (same data as /dashboard, machine-readable) ======
// ====== One-time backfill: push already-uploaded local photos to Drive ======
// For photos that were uploaded BEFORE the Apps Script's "photo" handling
// was added — they're still sitting in local donor-photos.json with no
// driveLink yet. This re-sends each one that's missing a driveLink, exactly
// the same way a brand-new upload would, so nothing has to be re-uploaded
// by hand.
app.post('/api/backfill-photos-to-drive', requireDashboardAuth, async (req, res) => {
  const missing = Object.entries(donorPhotoMap).filter(([, v]) => !v.driveLink);
  if (missing.length === 0) return res.json({ ok: true, updated: 0, total: 0 });
  let updated = 0;
  for (const [name, v] of missing) {
    const driveLink = await uploadPhotoToDriveAndLog(name, v.photo);
    if (driveLink) { donorPhotoMap[name].driveLink = driveLink; updated++; }
  }
  savePhotos(donorPhotoMap);
  res.json({ ok: true, updated, total: missing.length });
});

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
  // No caching, ever — same reasoning as /overlay below. Without this, some
  // browsers keep serving an old cached copy of this page even after the
  // server has a newer version, which looks like "nothing I fix ever shows
  // up" even though the deploy succeeded.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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
    padding-bottom:200px; overflow-x:hidden;
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
  .pending-row{ display:flex; align-items:center; justify-content:space-between; background:rgba(255,197,61,0.05); border:1px dashed rgba(255,197,61,0.35); border-radius:14px; padding:12px 16px; margin-top:10px; }
  .pending-name{ font-size:13.5px; font-weight:600; }
  .pending-badge{ font-size:10.5px; color:var(--gold); margin-top:2px; }
  .pending-del{ background:none; border:none; color:var(--dim); font-size:12px; cursor:pointer; padding:4px 8px; }
  .add-gw-btn{ display:block; width:100%; background:none; border:1.5px dashed var(--line); color:var(--dim); font-weight:600; font-size:13px; padding:12px; border-radius:14px; margin-top:12px; cursor:pointer; font-family:'Inter',sans-serif; }
  .form-card{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin-top:6px; }
  .f-label{ display:block; font-size:11.5px; color:var(--dim); margin:10px 0 5px; font-weight:600; }
  .form-card input, .form-card textarea{ width:100%; background:var(--bg-soft); border:1px solid var(--line); border-radius:10px; padding:10px 12px; color:var(--white); font-family:'Inter',sans-serif; font-size:13.5px; resize:vertical; }
  .form-hint{ font-size:11px; color:var(--dim); margin-top:10px; line-height:1.5; }
  .form-actions{ display:flex; gap:10px; margin-top:14px; }
  .btn-secondary, .btn-primary{ flex:1; padding:11px; border-radius:10px; border:none; font-weight:700; font-size:13px; cursor:pointer; font-family:'Inter',sans-serif; }
  .btn-secondary{ background:var(--bg-soft); color:var(--dim); }
  .btn-primary{ background:var(--gold); color:#0B0F19; }
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

    <div style="font-size:11px; color:var(--dim); font-weight:700; margin-top:6px;">⚔️ Fan Battle Live</div>
    <div class="quick-links">
      <a class="quick-link" href="/overlay" target="_blank"><span class="emoji">🖥️</span>Overlay</a>
      <a class="quick-link" href="/pay-left" target="_blank"><span class="emoji">🔵</span>Left pay</a>
      <a class="quick-link" href="/pay-right" target="_blank"><span class="emoji">🔴</span>Right pay</a>
    </div>

    <div style="font-size:11px; color:var(--dim); font-weight:700; margin-top:16px;">📈 Zero to Trader</div>
    <div class="quick-links">
      <a class="quick-link" href="/overlay/zerototrader" target="_blank"><span class="emoji">🖥️</span>Overlay</a>
      <a class="quick-link" href="/pay/zerototrader" target="_blank"><span class="emoji">💸</span>Pay</a>
    </div>

    <div style="font-size:11px; color:var(--dim); font-weight:700; margin-top:16px;">🧵 Daily Needle</div>
    <div class="quick-links">
      <a class="quick-link" href="/overlay/dailyneedle" target="_blank"><span class="emoji">🖥️</span>Overlay</a>
      <a class="quick-link" href="/pay/dailyneedle" target="_blank"><span class="emoji">💸</span>Pay</a>
    </div>
  </section>

  <!-- GATEWAYS -->
  <section class="tab-panel" id="tab-gateways">
    <div class="section-title">Domestic (India)</div>
    <div class="gw-row">
      <div><div class="gw-name">🇮🇳 Instamojo</div><div class="gw-status" id="domesticStatus">—</div></div>
      <label class="switch"><input type="checkbox" id="domesticToggle" onchange="toggleGateway('domestic', this.checked)"><span class="slider"></span></label>
    </div>
    <div id="domesticPendingList"></div>
    <button class="add-gw-btn" onclick="openAddGatewayForm('domestic')">+ Add domestic gateway</button>

    <div class="section-title" style="margin-top:30px;">International</div>
    <div class="gw-row">
      <div><div class="gw-name">🌍 PayPal</div><div class="gw-status" id="internationalStatus">—</div></div>
      <label class="switch"><input type="checkbox" id="internationalToggle" onchange="toggleGateway('international', this.checked)"><span class="slider"></span></label>
    </div>
    <div id="internationalPendingList"></div>
    <button class="add-gw-btn" onclick="openAddGatewayForm('international')">+ Add international gateway</button>

    <div id="addGatewayForm" style="display:none;">
      <div class="section-title" id="addGatewayFormTitle" style="margin-top:26px;">Add gateway</div>
      <div class="form-card">
        <label class="f-label">Gateway name</label>
        <input type="text" id="newGwName" placeholder="e.g. Razorpay, Stripe" maxlength="40">
        <label class="f-label">Notes (optional — approval status, account email, etc.)</label>
        <textarea id="newGwNotes" placeholder="Optional notes for your own reference" maxlength="300" rows="3"></textarea>
        <p class="form-hint">This records your request here so it's not lost — real payment processing for this gateway still needs its own integration code once you have approval and API keys.</p>
        <div class="form-actions">
          <button class="btn-secondary" onclick="closeAddGatewayForm()">Cancel</button>
          <button class="btn-primary" onclick="submitAddGateway()">Add</button>
        </div>
      </div>
    </div>
  </section>

  <!-- PHOTOS -->
  <section class="tab-panel" id="tab-photos">
    <div class="section-title">Donor photos — moderate here</div>
    <button class="add-gw-btn" onclick="backfillPhotosToDrive()">☁️ Backup all photos to Google Drive now</button>
    <div id="backfillStatus" style="margin-top:8px; font-size:12.5px; color:var(--dim);"></div>
    <div class="photo-grid" id="photoGrid" style="margin-top:14px;"></div>
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

  <!-- SCHEDULE -->
  <section class="tab-panel" id="tab-schedule">
    <div class="section-title">Channel</div>
    <div class="quick-links" id="channelSwitcher">
      <a class="quick-link channel-pill active" data-channel="fanbattle" onclick="switchChannel('fanbattle')" style="cursor:pointer;">⚔️ Fan Battle Live</a>
      <a class="quick-link channel-pill" data-channel="zerototrader" onclick="switchChannel('zerototrader')" style="cursor:pointer;">📈 Zero to Trader</a>
      <a class="quick-link channel-pill" data-channel="dailyneedle" onclick="switchChannel('dailyneedle')" style="cursor:pointer;">🧵 Daily Needle</a>
    </div>

    <div id="zeroToTraderFbBox" style="display:none;">
      <div class="gw-row" style="margin-top:14px;">
        <div><div class="gw-name">📘 Facebook Live eligible</div><div class="gw-status" id="zttFbStatus">—</div></div>
        <label class="switch"><input type="checkbox" id="zttFbToggle" onchange="toggleZttFbEligibility(this.checked)"><span class="slider"></span></label>
      </div>
      <p class="form-hint" style="margin-top:6px;">Turn this ON only once Facebook itself shows this Page has 100+ followers and is at least 60 days old. Until then, Go Live only sends you to YouTube for this channel.</p>
    </div>

    <div class="section-title" style="margin-top:22px;">Save a content idea (no time needed)</div>
    <div class="form-card">
      <label class="f-label">Title</label>
      <input type="text" id="schTitle" placeholder="e.g. Fan Battle Live — Final Night" maxlength="100">
      <label class="f-label">Description</label>
      <textarea id="schDescription" placeholder="What's happening in this stream" rows="4"></textarea>
      <label class="f-label">Hashtags (comma separated)</label>
      <input type="text" id="schHashtags" placeholder="FanBattle, LiveCricket, WorldCup">
      <label class="f-label">Thumbnail (for YouTube/Facebook)</label>
      <input type="file" id="schThumbnail" accept="image/*">
      <img id="schThumbPreview" style="display:none; max-width:140px; border-radius:10px; margin-top:8px;">

      <label class="f-label" id="schLeftNameLabel" style="color:var(--left);">🔵 Left side name</label>
      <input type="text" id="schLeftName" placeholder="Left side name" maxlength="40">
      <label class="f-label" id="schLeftPhotoLabel" style="color:var(--left);">🔵 Left side photo</label>
      <input type="file" id="schLeftPhoto" accept="image/*">
      <img id="schLeftPhotoPreview" style="display:none; max-width:100px; border-radius:10px; margin-top:8px;">

      <div id="schRightFieldsWrap">
        <label class="f-label" style="color:var(--right); margin-top:16px;">🔴 Right side name</label>
        <input type="text" id="schRightName" placeholder="Right side name" maxlength="40">
        <label class="f-label" style="color:var(--right);">🔴 Right side photo</label>
        <input type="file" id="schRightPhoto" accept="image/*">
        <img id="schRightPhotoPreview" style="display:none; max-width:100px; border-radius:10px; margin-top:8px;">
      </div>

      <label class="f-label" style="margin-top:16px;">🎙️ Voice commentary (pick multiple — e.g. one per language, played back-to-back each cycle)</label>
      <input type="file" id="schIntroVoice" accept="audio/*" multiple>
      <div id="schIntroVoiceList" style="font-size:11.5px; color:var(--dim); margin-top:6px;"></div>
      <label class="f-label">Repeat every (seconds)</label>
      <input type="number" id="schVoiceRepeat" value="40" min="10" max="3600" style="width:90px;">

      <label class="f-label" style="margin-top:16px;">🎵 Background music (pick multiple for a playlist, optional)</label>
      <input type="file" id="schMusic" accept="audio/*" multiple>
      <div id="schMusicList" style="font-size:11.5px; color:var(--dim); margin-top:6px;"></div>

      <div id="schVideoLinksWrap">
        <label class="f-label" style="color:var(--left); margin-top:16px;">🔵 Left side video links (one per line, up to 10)</label>
        <textarea id="schLeftVideoLinks" rows="3" placeholder="https://streamable.com/xxxxx"></textarea>
        <label class="f-label" style="color:var(--right);">🔴 Right side video links (one per line, up to 10)</label>
        <textarea id="schRightVideoLinks" rows="3" placeholder="https://streamable.com/yyyyy"></textarea>
        <p class="form-hint">Paste direct video links here (e.g. from Streamable) — they'll rotate automatically on stream, same as uploading clips directly in the overlay. Google Drive's usual share link often won't play directly, so Streamable (or a similar direct-link host) works more reliably.</p>
      </div>

      <div id="zttLossFieldWrap" style="display:none;">
        <label class="f-label" style="margin-top:16px;">📉 Starting loss amount (₹) — counts down live as tips come in</label>
        <input type="number" id="schStartingLoss" placeholder="e.g. 10000" min="0">
      </div>

      <div class="section-title" style="margin-top:20px;">🛍️ Affiliate marketing (optional — up to 20 products per platform)</div>
      <div id="affPlatformsWrap"></div>

      <button class="btn-primary" style="width:100%; margin-top:16px; padding:13px;" onclick="submitSchedule()">Save idea</button>
      <div id="scheduleStatus" style="margin-top:14px; font-size:13px;"></div>
    </div>

    <div class="section-title" style="margin-top:26px;">Your saved ideas (<span id="ideaCount">0</span>/20)</div>
    <div id="ideasList"></div>

    <div class="section-title" style="margin-top:26px;">Reminder contact info (optional, set once)</div>
    <div class="form-card">
      <label class="f-label">WhatsApp number (with country code)</label>
      <input type="text" id="notifyWhatsapp" placeholder="+91XXXXXXXXXX">
      <label class="f-label">Mobile number for SMS</label>
      <input type="text" id="notifySms" placeholder="+91XXXXXXXXXX">
      <label class="f-label">Email</label>
      <input type="email" id="notifyEmail" placeholder="you@example.com">
      <button class="btn-primary" style="width:100%; margin-top:14px; padding:13px; margin-bottom:24px;" onclick="saveNotifySettings()">Save contact info</button>
      <div id="notifySaveStatus" style="margin-top:10px; font-size:12.5px;"></div>
    </div>
  </section>
</main>

<nav class="bottom">
  <button class="active" data-tab="home" onclick="showTab('home')"><span class="icon">🏠</span><span class="lbl">Home</span></button>
  <button data-tab="gateways" onclick="showTab('gateways')"><span class="icon">🎛️</span><span class="lbl">Gateways</span></button>
  <button data-tab="photos" onclick="showTab('photos')"><span class="icon">🖼️</span><span class="lbl">Photos</span></button>
  <button data-tab="records" onclick="showTab('records')"><span class="icon">📊</span><span class="lbl">Records</span></button>
  <button data-tab="schedule" onclick="showTab('schedule')"><span class="icon">📅</span><span class="lbl">Schedule</span></button>
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

      const additional = d.gatewaySettings.additionalGateways || [];
      renderPendingList('domesticPendingList', additional.filter(g => g.category === 'domestic'));
      renderPendingList('internationalPendingList', additional.filter(g => g.category === 'international'));

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

  function backfillPhotosToDrive(){
    const statusEl = document.getElementById('backfillStatus');
    statusEl.textContent = 'Uploading to Drive... this may take a moment.';
    fetch('/api/backfill-photos-to-drive', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if(!d.ok){ statusEl.innerHTML = '<span style="color:var(--right);">Something went wrong.</span>'; return; }
        if(d.total === 0){ statusEl.innerHTML = '<span style="color:var(--green);">All photos already backed up ✓</span>'; return; }
        statusEl.innerHTML = '<span style="color:var(--green);">✅ ' + d.updated + ' of ' + d.total + ' photo(s) backed up to Drive</span>';
        loadData();
      }).catch(() => { statusEl.innerHTML = '<span style="color:var(--right);">Network error — try again.</span>'; });
  }

  function renderPendingList(containerId, items){
    const el = document.getElementById(containerId);
    el.innerHTML = items.map(g => \`
      <div class="pending-row">
        <div><div class="pending-name">\${g.name}</div><div class="pending-badge">⏳ Pending — needs integration</div></div>
        <button class="pending-del" onclick="removePendingGateway('\${g.id}')">Remove</button>
      </div>\`).join('');
  }

  let addGatewayCategory = null;
  function openAddGatewayForm(category){
    addGatewayCategory = category;
    document.getElementById('addGatewayFormTitle').textContent = 'Add ' + (category === 'domestic' ? 'domestic' : 'international') + ' gateway';
    document.getElementById('addGatewayForm').style.display = 'block';
    document.getElementById('newGwName').value = '';
    document.getElementById('newGwNotes').value = '';
    document.getElementById('addGatewayForm').scrollIntoView({ behavior:'smooth', block:'center' });
  }
  function closeAddGatewayForm(){
    document.getElementById('addGatewayForm').style.display = 'none';
  }
  function submitAddGateway(){
    const name = document.getElementById('newGwName').value.trim();
    const notes = document.getElementById('newGwNotes').value.trim();
    if(!name){ alert('Please enter a gateway name.'); return; }
    fetch('/gateway-settings/add-gateway', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, category: addGatewayCategory, notes })
    }).then(r => r.json()).then(d => {
      if(d.ok){ closeAddGatewayForm(); loadData(); }
      else alert(d.error || 'Could not add gateway.');
    }).catch(() => alert('Network error — try again.'));
  }
  function removePendingGateway(id){
    fetch('/gateway-settings/remove-gateway?id=' + encodeURIComponent(id), { method:'DELETE' }).then(loadData);
  }

  let schThumbDataUrl = null, schLeftPhotoDataUrl = null, schRightPhotoDataUrl = null;
  function setupPhotoPreview(inputId, previewId, setter){
    document.getElementById(inputId).addEventListener('change', function(e){
      const file = e.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = function(ev){
        setter(ev.target.result);
        const img = document.getElementById(previewId);
        img.src = ev.target.result;
        img.style.display = 'block';
      };
      reader.readAsDataURL(file);
    });
  }
  setupPhotoPreview('schThumbnail', 'schThumbPreview', v => schThumbDataUrl = v);
  setupPhotoPreview('schLeftPhoto', 'schLeftPhotoPreview', v => schLeftPhotoDataUrl = v);
  setupPhotoPreview('schRightPhoto', 'schRightPhotoPreview', v => schRightPhotoDataUrl = v);

  // Reads every file picked in a multi-file input as base64, in order —
  // used for voice-commentary clips and background-music tracks, both of
  // which can be more than one file.
  function readMultipleFilesAsDataUrls(fileList){
    return Promise.all(Array.from(fileList).map(file => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.readAsDataURL(file);
    })));
  }
  let schIntroVoiceUrls = [], schMusicUrls = [];
  document.getElementById('schIntroVoice').addEventListener('change', async function(e){
    schIntroVoiceUrls = await readMultipleFilesAsDataUrls(e.target.files);
    document.getElementById('schIntroVoiceList').textContent = schIntroVoiceUrls.length + ' voice clip(s) selected';
  });
  document.getElementById('schMusic').addEventListener('change', async function(e){
    schMusicUrls = await readMultipleFilesAsDataUrls(e.target.files);
    document.getElementById('schMusicList').textContent = schMusicUrls.length + ' music track(s) selected';
  });

  // ====== Affiliate marketing — 4 platforms, up to 20 products each ======
  // Kept entirely client-side until "Save idea" is pressed — this builds
  // the { amazon: [...], flipkart: [...], meesho: [...], myntra: [...] }
  // object sent along with the rest of the content idea. Every product is
  // { link, price, imageDataUrl } — the overlay generates its OWN QR code
  // from the link when it's this product's turn to appear, since a
  // livestream video can never contain a directly-clickable link.
  var AFF_PLATFORMS = [
    { key: 'amazon', label: '🅰️ Amazon' },
    { key: 'flipkart', label: '🛒 Flipkart' },
    { key: 'meesho', label: '👜 Meesho' },
    { key: 'myntra', label: '👗 Myntra' }
  ];
  var affProducts = { amazon: [], flipkart: [], meesho: [], myntra: [] };
  var affPendingImage = {}; // { amazon: dataUrl, ... } — the currently-picked (not-yet-added) product image per platform

  function renderAffiliatePanel(){
    var wrap = document.getElementById('affPlatformsWrap');
    var html = '';
    for(var idx = 0; idx < AFF_PLATFORMS.length; idx++){
      var p = AFF_PLATFORMS[idx];
      var platformNameOnly = p.label.replace(/^\S+\s/, '');
      html += '<div class="gw-row" style="margin-top:10px;">' +
        '<div><div class="gw-name">' + p.label + '</div><div class="gw-status" id="affStatus_' + p.key + '">' + affProducts[p.key].length + ' / 20 products added</div></div>' +
        '<label class="switch"><input type="checkbox" id="affToggle_' + p.key + '" onchange="toggleAffPanel(\\'' + p.key + '\\', this.checked)"><span class="slider"></span></label>' +
        '</div>' +
        '<div id="affPanel_' + p.key + '" style="display:none;">' +
          '<div class="form-card" style="margin-top:6px;">' +
            '<label class="f-label">Product link</label>' +
            '<input type="text" id="affLink_' + p.key + '" placeholder="Paste the ' + platformNameOnly + ' product link">' +
            '<label class="f-label">Original price (₹, optional)</label>' +
            '<input type="text" id="affOrigPrice_' + p.key + '" placeholder="e.g. 999">' +
            '<label class="f-label">Discounted / actual selling price (₹, optional)</label>' +
            '<input type="text" id="affDiscPrice_' + p.key + '" placeholder="e.g. 649">' +
            '<label class="f-label">Product photo</label>' +
            '<input type="file" id="affImage_' + p.key + '" accept="image/*">' +
            '<img id="affImagePreview_' + p.key + '" style="display:none; max-width:100px; border-radius:10px; margin-top:8px;">' +
            '<button class="btn-secondary" style="width:100%; margin-top:12px; padding:10px;" onclick="addAffiliateProduct(\\'' + p.key + '\\')">+ Add this product</button>' +
            '<div id="affList_' + p.key + '" style="margin-top:10px;"></div>' +
          '</div>' +
        '</div>';
    }
    wrap.innerHTML = html;
    AFF_PLATFORMS.forEach(function(p){
      document.getElementById('affImage_' + p.key).addEventListener('change', function(e){
        var file = e.target.files[0];
        if(!file) return;
        var reader = new FileReader();
        reader.onload = function(ev){
          affPendingImage[p.key] = ev.target.result;
          var img = document.getElementById('affImagePreview_' + p.key);
          img.src = ev.target.result; img.style.display = 'block';
        };
        reader.readAsDataURL(file);
      });
      renderAffiliateList(p.key);
    });
  }
  function toggleAffPanel(key, open){
    document.getElementById('affPanel_' + key).style.display = open ? 'block' : 'none';
  }
  function addAffiliateProduct(key){
    var linkInput = document.getElementById('affLink_' + key);
    var origPriceInput = document.getElementById('affOrigPrice_' + key);
    var discPriceInput = document.getElementById('affDiscPrice_' + key);
    var link = linkInput.value.trim();
    if(!link){ alert('Please paste a product link first.'); return; }
    if(affProducts[key].length >= 20){ alert('You already have 20 products for this platform — delete one first.'); return; }
    affProducts[key].push({ link: link, originalPrice: origPriceInput.value.trim(), discountedPrice: discPriceInput.value.trim(), imageDataUrl: affPendingImage[key] || null });
    linkInput.value = ''; origPriceInput.value = ''; discPriceInput.value = '';
    affPendingImage[key] = null;
    document.getElementById('affImage_' + key).value = '';
    document.getElementById('affImagePreview_' + key).style.display = 'none';
    document.getElementById('affStatus_' + key).textContent = affProducts[key].length + ' / 20 products added';
    renderAffiliateList(key);
  }
  function removeAffiliateProduct(key, index){
    affProducts[key].splice(index, 1);
    document.getElementById('affStatus_' + key).textContent = affProducts[key].length + ' / 20 products added';
    renderAffiliateList(key);
  }
  function renderAffiliateList(key){
    var el = document.getElementById('affList_' + key);
    if(!el) return;
    var html = '';
    for(var i = 0; i < affProducts[key].length; i++){
      var prod = affProducts[key][i];
      var priceLabel = '';
      if(prod.discountedPrice){ priceLabel = '₹' + prod.discountedPrice + (prod.originalPrice ? ' (was ₹' + prod.originalPrice + ') — ' : ' — '); }
      else if(prod.originalPrice){ priceLabel = '₹' + prod.originalPrice + ' — '; }
      html += '<div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-top:1px solid var(--line);">' +
        (prod.imageDataUrl ? '<img src="' + prod.imageDataUrl + '" style="width:34px; height:34px; object-fit:cover; border-radius:6px;">' : '') +
        '<div style="flex:1; min-width:0; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + priceLabel + prod.link + '</div>' +
        '<button class="pending-del" onclick="removeAffiliateProduct(\\'' + key + '\\', ' + i + ')">Remove</button>' +
        '</div>';
    }
    el.innerHTML = html;
  }
  function resetAffiliateProducts(){
    affProducts = { amazon: [], flipkart: [], meesho: [], myntra: [] };
    affPendingImage = {};
    renderAffiliatePanel();
    AFF_PLATFORMS.forEach(function(p){ document.getElementById('affToggle_' + p.key).checked = false; toggleAffPanel(p.key, false); });
  }
  renderAffiliatePanel();

  // ====== Channel switcher — Fan Battle Live / Zero to Trader / Daily Needle ======
  // All three channels share this ONE form/list UI; only which channel's
  // saved-ideas endpoint gets called changes. Each channel's ideas, Go-Live
  // links, and "currently live" marker are completely independent of the
  // others — switching tabs never affects another channel's saved ideas.
  let currentScheduleChannel = 'fanbattle';
  function switchChannel(channel){
    currentScheduleChannel = channel;
    document.querySelectorAll('.channel-pill').forEach(p => p.classList.toggle('active', p.dataset.channel === channel));
    document.getElementById('zeroToTraderFbBox').style.display = (channel === 'zerototrader') ? 'block' : 'none';
    document.getElementById('zttLossFieldWrap').style.display = (channel === 'zerototrader') ? 'block' : 'none';
    // Daily Needle / Zero to Trader have no "sides" at all — the Left-side
    // fields are relabeled as the channel's own name/logo (this is exactly
    // what their overlay reads), and the Right-side fields are hidden
    // entirely since they'd never be used.
    const isSingleTotalChannel = (channel === 'dailyneedle' || channel === 'zerototrader');
    document.getElementById('schRightFieldsWrap').style.display = isSingleTotalChannel ? 'none' : 'block';
    document.getElementById('schVideoLinksWrap').style.display = isSingleTotalChannel ? 'none' : 'block';
    document.getElementById('schLeftNameLabel').textContent = isSingleTotalChannel ? '📛 Channel name' : '🔵 Left side name';
    document.getElementById('schLeftPhotoLabel').textContent = isSingleTotalChannel ? '🖼️ Channel logo' : '🔵 Left side photo';
    document.getElementById('schLeftName').placeholder = isSingleTotalChannel ? 'e.g. Daily Needle' : 'Left side name';
    if(channel === 'zerototrader') loadZttFbEligibility();
    resetAffiliateProducts();
    loadIdeas();
  }

  function submitSchedule(){
    const title = document.getElementById('schTitle').value.trim();
    const description = document.getElementById('schDescription').value.trim();
    const hashtags = document.getElementById('schHashtags').value.trim();
    const leftName = document.getElementById('schLeftName').value.trim();
    const rightName = document.getElementById('schRightName').value.trim();
    const voiceRepeatSeconds = parseInt(document.getElementById('schVoiceRepeat').value, 10) || 40;
    const leftVideoUrls = document.getElementById('schLeftVideoLinks').value.trim();
    const rightVideoUrls = document.getElementById('schRightVideoLinks').value.trim();
    const startingLossAmount = document.getElementById('schStartingLoss').value.trim();
    const statusEl = document.getElementById('scheduleStatus');

    if(!title){ statusEl.innerHTML = '<span style="color:var(--right);">Please enter a title.</span>'; return; }

    statusEl.textContent = 'Saving...';
    fetch('/schedule/' + currentScheduleChannel + '/create', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ title, description, hashtags, thumbnailDataUrl: schThumbDataUrl, leftName, rightName, leftPhotoDataUrl: schLeftPhotoDataUrl, rightPhotoDataUrl: schRightPhotoDataUrl, introVoiceDataUrls: schIntroVoiceUrls, voiceRepeatSeconds, musicDataUrls: schMusicUrls, leftVideoUrls, rightVideoUrls, startingLossAmount, affiliateProducts: affProducts })
    }).then(r => r.json()).then(d => {
      if(!d.ok){ statusEl.innerHTML = '<span style="color:var(--right);">' + (d.error || 'Something went wrong.') + '</span>'; return; }
      statusEl.innerHTML = '<span style="color:var(--green);">✅ Idea saved — find it in the list below anytime.</span>';
      document.getElementById('schTitle').value = '';
      document.getElementById('schDescription').value = '';
      document.getElementById('schHashtags').value = '';
      document.getElementById('schLeftName').value = '';
      document.getElementById('schRightName').value = '';
      document.getElementById('schLeftVideoLinks').value = '';
      document.getElementById('schRightVideoLinks').value = '';
      document.getElementById('schStartingLoss').value = '';
      ['schThumbnail','schLeftPhoto','schRightPhoto','schIntroVoice','schMusic'].forEach(id => document.getElementById(id).value = '');
      ['schThumbPreview','schLeftPhotoPreview','schRightPhotoPreview'].forEach(id => document.getElementById(id).style.display = 'none');
      document.getElementById('schIntroVoiceList').textContent = '';
      document.getElementById('schMusicList').textContent = '';
      schThumbDataUrl = schLeftPhotoDataUrl = schRightPhotoDataUrl = null;
      schIntroVoiceUrls = []; schMusicUrls = [];
      resetAffiliateProducts();
      loadIdeas();
    }).catch(() => { statusEl.innerHTML = '<span style="color:var(--right);">Network error — try again.</span>'; });
  }

  async function loadIdeas(){
    try {
      const res = await fetch('/api/content-ideas/' + currentScheduleChannel);
      const d = await res.json();
      document.getElementById('ideaCount').textContent = d.ideas.length;
      const listEl = document.getElementById('ideasList');
      listEl.innerHTML = d.ideas.length ? d.ideas.map(idea =>
        '<div class="form-card" style="margin-top:10px; ' + (idea.isLive ? 'border-color:var(--right); box-shadow:0 0 0 1px var(--right);' : '') + '">' +
          (idea.isLive ? '<div style="color:var(--right); font-weight:800; font-size:12px; margin-bottom:8px;">🔴 LIVE NOW</div>' : '') +
          '<div style="font-weight:700;">' + idea.title + '</div>' +
          '<div style="display:flex; gap:14px; margin-top:8px;">' +
            (idea.leftPhotoDataUrl ? '<img src="' + idea.leftPhotoDataUrl + '" style="width:56px; height:56px; object-fit:cover; border-radius:8px;">' : '') +
            (idea.leftName ? '<div style="font-size:12px; align-self:center; color:var(--left);">🔵 ' + idea.leftName + '</div>' : '') +
            (idea.rightPhotoDataUrl ? '<img src="' + idea.rightPhotoDataUrl + '" style="width:56px; height:56px; object-fit:cover; border-radius:8px;">' : '') +
            (idea.rightName ? '<div style="font-size:12px; align-self:center; color:var(--right);">🔴 ' + idea.rightName + '</div>' : '') +
          '</div>' +
          '<div style="display:flex; gap:8px; margin-top:12px; align-items:center;">' +
            '<span style="font-size:11px; color:var(--dim);">Theme:</span>' +
            '<button title="Blue/Red (default)" style="width:22px; height:22px; border-radius:50%; border:2px solid ' + (idea.preset==='1'||!idea.preset ? '#fff' : 'transparent') + '; background:linear-gradient(135deg,#6C9BFF 50%,#FF6B5E 50%); cursor:pointer; padding:0;" onclick="setPreset(\\'' + idea.id + '\\',\\'1\\')"></button>' +
            '<button title="Purple/Gold" style="width:22px; height:22px; border-radius:50%; border:2px solid ' + (idea.preset==='2' ? '#fff' : 'transparent') + '; background:linear-gradient(135deg,#A78BFA 50%,#FFC53D 50%); cursor:pointer; padding:0;" onclick="setPreset(\\'' + idea.id + '\\',\\'2\\')"></button>' +
            '<button title="Green/Orange" style="width:22px; height:22px; border-radius:50%; border:2px solid ' + (idea.preset==='3' ? '#fff' : 'transparent') + '; background:linear-gradient(135deg,#4ADE80 50%,#FB923C 50%); cursor:pointer; padding:0;" onclick="setPreset(\\'' + idea.id + '\\',\\'3\\')"></button>' +
            '<button title="Pink/Teal" style="width:22px; height:22px; border-radius:50%; border:2px solid ' + (idea.preset==='4' ? '#fff' : 'transparent') + '; background:linear-gradient(135deg,#F472B6 50%,#2DD4BF 50%); cursor:pointer; padding:0;" onclick="setPreset(\\'' + idea.id + '\\',\\'4\\')"></button>' +
            '<button title="Yellow/White" style="width:22px; height:22px; border-radius:50%; border:2px solid ' + (idea.preset==='5' ? '#fff' : 'transparent') + '; background:linear-gradient(135deg,#FDE047 50%,#F5F7FA 50%); cursor:pointer; padding:0;" onclick="setPreset(\\'' + idea.id + '\\',\\'5\\')"></button>' +
          '</div>' +
          '<div style="display:flex; gap:8px; margin-top:10px;">' +
            '<a href="' + idea.goLiveUrl + (idea.preset ? '?preset=' + idea.preset : '') + '" target="_blank" class="btn-primary" style="flex:1; text-align:center; text-decoration:none; padding:11px;" onclick="markLive(\\'' + idea.id + '\\')">▶ Go Live</a>' +
            (idea.isLive ? '<button class="btn-secondary" style="flex:0 0 auto; padding:11px 16px;" onclick="endLive()">End Live</button>' : '') +
            '<button class="btn-secondary" style="flex:0 0 auto; padding:11px 16px;" onclick="deleteIdea(\\'' + idea.id + '\\')">Delete</button>' +
          '</div>' +
        '</div>'
      ).join('') : '<div class="empty">No saved ideas yet — add one above.</div>';
    } catch(e){ /* not critical */ }
  }

  function deleteIdea(id){
    if(!confirm('Delete this saved idea?')) return;
    fetch('/schedule/' + currentScheduleChannel + '/' + id, { method: 'DELETE' }).then(loadIdeas);
  }

  function markLive(id){
    fetch('/schedule/' + currentScheduleChannel + '/' + id + '/set-live', { method: 'POST' }).then(loadIdeas);
  }
  function endLive(){
    fetch('/schedule/' + currentScheduleChannel + '/end-live', { method: 'POST' }).then(loadIdeas);
  }
  function setPreset(id, preset){
    fetch('/schedule/' + currentScheduleChannel + '/' + id + '/set-preset', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ preset })
    }).then(loadIdeas);
  }

  // ====== Zero to Trader — manual Facebook-eligibility switch ======
  function loadZttFbEligibility(){
    fetch('/api/fb-eligibility/zerototrader').then(r => r.json()).then(d => {
      document.getElementById('zttFbToggle').checked = !!d.eligible;
      document.getElementById('zttFbStatus').textContent = d.eligible ? 'Enabled — Go Live will include Facebook' : 'Not yet — Go Live only goes to YouTube';
      document.getElementById('zttFbStatus').className = 'gw-status ' + (d.eligible ? 'on' : 'off');
    }).catch(() => {});
  }
  function toggleZttFbEligibility(eligible){
    fetch('/api/fb-eligibility/zerototrader', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ eligible })
    }).then(loadZttFbEligibility);
  }

  function saveNotifySettings(){
    const whatsappNumber = document.getElementById('notifyWhatsapp').value.trim();
    const smsNumber = document.getElementById('notifySms').value.trim();
    const email = document.getElementById('notifyEmail').value.trim();
    const statusEl = document.getElementById('notifySaveStatus');
    statusEl.textContent = 'Saving...';
    fetch('/api/notify-settings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ whatsappNumber, smsNumber, email })
    }).then(r => r.json()).then(() => { statusEl.innerHTML = '<span style="color:var(--green);">Saved ✓</span>'; })
      .catch(() => { statusEl.innerHTML = '<span style="color:var(--right);">Could not save — try again.</span>'; });
  }

  async function loadNotifySettingsIntoForm(){
    try {
      const res = await fetch('/api/notify-settings');
      const d = await res.json();
      document.getElementById('notifyWhatsapp').value = d.whatsappNumber || '';
      document.getElementById('notifySms').value = d.smsNumber || '';
      document.getElementById('notifyEmail').value = d.email || '';
    } catch(e){ /* not critical if this fails */ }
  }

  loadData();
  loadNotifySettingsIntoForm();
  loadIdeas();
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
// =========  LIVE SCHEDULING: YouTube + Facebook (title/thumbnail/  =====
// =========  description/hashtags), pushed from the /app Schedule tab ===
// =====================================================================
// YouTube part: needs a one-time OAuth setup (Google Cloud Console) — see
// SCHEDULE-SETUP.md. Once YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN
// are set as Render env vars, this works fully automatically from then on.
//
// Facebook part: Facebook's Live Video API requires Facebook's own App
// Review approval for the relevant permission — this is a manual review
// Facebook itself performs, no code can bypass it (flagged honestly here,
// same as discussed before). The code below is written correctly against
// Facebook's documented API and will work the moment that approval is
// granted and FB_PAGE_ID/FB_PAGE_ACCESS_TOKEN are set — until then it will
// return a clear error explaining exactly that, rather than failing silently.
const YT_CLIENT_ID = process.env.YT_CLIENT_ID || '';
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET || '';
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN || '';
const FB_PAGE_ID = process.env.FB_PAGE_ID || '';
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';

let cachedYoutubeToken = null;
let cachedYoutubeTokenExpiry = 0;
async function getYoutubeAccessToken() {
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    throw new Error('YouTube isn\'t connected yet — see SCHEDULE-SETUP.md to set YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN.');
  }
  if (cachedYoutubeToken && Date.now() < cachedYoutubeTokenExpiry) return cachedYoutubeToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET,
      refresh_token: YT_REFRESH_TOKEN, grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('YouTube auth failed: ' + JSON.stringify(data));
  cachedYoutubeToken = data.access_token;
  cachedYoutubeTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedYoutubeToken;
}

// Creates a scheduled YouTube live broadcast with title/description, then
// uploads the custom thumbnail — this is what shows up on your channel and
// in subscribers' feeds ahead of time, with your own thumbnail instead of a
// generic placeholder.
async function createYoutubeScheduledBroadcast({ title, description, scheduledTime, thumbnailDataUrl }) {
  const token = await getYoutubeAccessToken();
  const insertRes = await fetch('https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snippet: { title, description, scheduledStartTime: scheduledTime },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true }
    })
  });
  const broadcast = await insertRes.json();
  if (!broadcast.id) throw new Error('YouTube broadcast creation failed: ' + JSON.stringify(broadcast));

  // Upload the thumbnail, if one was provided — a separate API call because
  // YouTube treats the image as binary media, not part of the JSON body above.
  if (thumbnailDataUrl) {
    const matches = thumbnailDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (matches) {
      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${broadcast.id}&uploadType=media`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': mimeType },
        body: buffer
      });
    }
  }

  return { id: broadcast.id, url: `https://www.youtube.com/watch?v=${broadcast.id}` };
}

// Creates a SCHEDULED (not yet live) Facebook video on your Page — viewers
// see it appear on the Page ahead of time with your title/description.
// NOTE: Facebook's scheduled-live thumbnail is best set from Facebook's own
// Live Producer/Creator Studio at go-live time — their API for pre-setting
// a custom thumbnail on a not-yet-started scheduled live video is
// inconsistent, so this intentionally does not attempt it, to avoid
// silently failing while claiming success.
async function createFacebookScheduledLive({ title, description, scheduledTime }) {
  if (!FB_PAGE_ID || !FB_PAGE_ACCESS_TOKEN) {
    throw new Error('Facebook isn\'t connected yet — see SCHEDULE-SETUP.md to set FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN (requires Facebook App Review approval for Live Video access first).');
  }
  const scheduledUnix = Math.floor(new Date(scheduledTime).getTime() / 1000);
  const res = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/live_videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title, description,
      status: 'SCHEDULED_UNPUBLISHED',
      planned_start_time: scheduledUnix,
      access_token: FB_PAGE_ACCESS_TOKEN
    })
  });
  const data = await res.json();
  if (data.error) throw new Error('Facebook scheduling failed: ' + (data.error.message || JSON.stringify(data.error)));
  return { id: data.id, url: `https://www.facebook.com/${FB_PAGE_ID}/videos/${data.id}` };
}

// Single endpoint the Schedule tab calls — pushes to whichever platform(s)
// were checked, and reports each platform's own success/failure separately
// (one platform failing, e.g. Facebook pending approval, never blocks the
// other from succeeding).
// ====== Content Ideas Library — no fixed time, click "Go Live" whenever ======
// You save up to 20 title/description/hashtags/thumbnail sets ahead of time.
// Whenever you actually want to go live with one, open its "Go Live" link —
// it walks you through YouTube then Facebook, one tap each, entirely on your
// own schedule. Nothing here calls the YouTube or Facebook API at all, so
// there's no OAuth/billing/App-Review dependency of any kind.
const MAX_CONTENT_IDEAS = 20;

// ====== Per-channel "which idea is live" + Zero to Trader's manual  ======
// ====== Facebook-eligibility toggle — both stored inside gateway-settings ======
function getActiveIdeaId(gw, channel) {
  if (!gw.activeIdeaIds) gw.activeIdeaIds = {};
  return gw.activeIdeaIds[channel] || null;
}
function setActiveIdeaId(gw, channel, id) {
  if (!gw.activeIdeaIds) gw.activeIdeaIds = {};
  gw.activeIdeaIds[channel] = id;
}

app.post('/schedule/:channel/create', requireDashboardAuth, async (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const { title, description, hashtags, thumbnailDataUrl, leftName, rightName, leftPhotoDataUrl, rightPhotoDataUrl, introVoiceDataUrls, voiceRepeatSeconds, musicDataUrls, leftVideoUrls, rightVideoUrls, startingLossAmount, affiliateProducts } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ ok: false, error: 'Title is required.' });

  const hashtagLine = (hashtags || '')
    .split(',').map(h => h.trim()).filter(Boolean)
    .map(h => h.startsWith('#') ? h : '#' + h).join(' ');
  const fullDescription = hashtagLine ? `${description || ''}\n\n${hashtagLine}` : (description || '');

  // Video LINKS only (not uploaded files) — this is the safe way to include
  // several clips per side without risking the server's memory/disk, since
  // we're just storing short text URLs, never the video data itself.
  const parseVideoLinks = (raw) => (raw || '')
    .split(/[\n,]+/).map(u => u.trim()).filter(Boolean).slice(0, 10);

  // ====== Affiliate marketing products — up to 20 per platform, 4 platforms ======
  // Each product is { link, originalPrice, discountedPrice, imageDataUrl } —
  // both prices are OPTIONAL and only shown/percentage-calculated on the
  // overlay if both are present and the discount is real (never a fabricated
  // "% off" — see the honesty discussion this was designed around). The
  // overlay generates its OWN QR code from `link` at render time (never a
  // clickable video overlay, since livestream video can never be clickable).
  const AFFILIATE_PLATFORMS = ['amazon', 'flipkart', 'meesho', 'myntra'];
  function sanitizeAffiliateProducts(raw) {
    const out = {};
    for (const platform of AFFILIATE_PLATFORMS) {
      const list = (raw && Array.isArray(raw[platform])) ? raw[platform] : [];
      out[platform] = list
        .filter(p => p && p.link && p.link.trim())
        .slice(0, 20)
        .map(p => ({
          link: p.link.trim(),
          originalPrice: p.originalPrice != null ? String(p.originalPrice).trim() : '',
          discountedPrice: p.discountedPrice != null ? String(p.discountedPrice).trim() : '',
          imageDataUrl: p.imageDataUrl || null
        }));
    }
    return out;
  }

  const events = loadScheduledEvents(channel);
  if (events.length >= MAX_CONTENT_IDEAS) {
    return res.status(400).json({ ok: false, error: `You already have ${MAX_CONTENT_IDEAS} saved ideas — delete one first from the list below.` });
  }
  const eventId = 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  events.push({
    id: eventId, title, description: fullDescription, hashtags: hashtagLine,
    thumbnailDataUrl: thumbnailDataUrl || null,
    leftName: leftName || '', rightName: rightName || '',
    leftPhotoDataUrl: leftPhotoDataUrl || null, rightPhotoDataUrl: rightPhotoDataUrl || null,
    // Multiple intro-voice clips (e.g. one per language) played back-to-back
    // every repeat cycle — same idea as the AI-generated bilingual clip
    // discussed earlier, just via separate uploaded files instead.
    introVoiceDataUrls: Array.isArray(introVoiceDataUrls) ? introVoiceDataUrls.slice(0, 5) : [],
    voiceRepeatSeconds: Number(voiceRepeatSeconds) || 40,
    // Multiple background music tracks — played as a playlist, looping
    // through all of them instead of just one repeating track.
    musicDataUrls: Array.isArray(musicDataUrls) ? musicDataUrls.slice(0, 5) : [],
    // Up to 10 video LINKS per side (e.g. Streamable links) — rotates
    // through them just like the overlay's own manual video upload already did.
    leftVideoUrls: parseVideoLinks(leftVideoUrls),
    rightVideoUrls: parseVideoLinks(rightVideoUrls),
    // Zero to Trader only: the "loss" figure you set by hand, which then
    // counts DOWN live on the overlay as tips come in (see /api/active-idea/:channel).
    startingLossAmount: startingLossAmount != null && startingLossAmount !== '' ? Number(startingLossAmount) : null,
    // Affiliate marketing products, up to 20 per platform (Amazon/Flipkart/
    // Meesho/Myntra) — see /api/active-idea/:channel for how the overlay
    // consumes these.
    affiliateProducts: sanitizeAffiliateProducts(affiliateProducts),
    createdAt: new Date().toISOString()
  });
  saveScheduledEvents(events, channel);
  backupContentIdeasToSheet(events, channel); // fire-and-forget durable cross-device backup

  res.json({ ok: true, goLiveUrl: `${PUBLIC_BASE_URL}/go-live/${channel}/${eventId}` });
});

app.delete('/schedule/:channel/:id', requireDashboardAuth, (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const events = loadScheduledEvents(channel).filter(e => e.id !== req.params.id);
  saveScheduledEvents(events, channel);
  backupContentIdeasToSheet(events, channel); // keep the durable backup in sync with deletions too
  res.json({ ok: true });
});

// ====== Track which saved idea is currently the LIVE one, per channel ======
// A simple marker so each channel's ideas list can show a 🔴 LIVE badge, and
// so you can jump back into that specific idea later (e.g. to moderate
// photos) without hunting for it. Each channel tracks its own "live" idea
// independently — going live on one channel never affects another.
app.post('/schedule/:channel/:id/set-live', requireDashboardAuth, (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const gw = loadGatewaySettings();
  setActiveIdeaId(gw, channel, req.params.id);
  saveGatewaySettings(gw);
  res.json({ ok: true });
});
app.post('/schedule/:channel/end-live', requireDashboardAuth, (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const gw = loadGatewaySettings();
  setActiveIdeaId(gw, channel, null);
  saveGatewaySettings(gw);
  res.json({ ok: true });
});

app.post('/schedule/:channel/:id/set-preset', requireDashboardAuth, (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const { preset } = req.body;
  const events = loadScheduledEvents(channel);
  const evt = events.find(e => e.id === req.params.id);
  if (!evt) return res.status(404).json({ ok: false, error: 'Idea not found' });
  evt.preset = preset;
  saveScheduledEvents(events, channel);
  backupContentIdeasToSheet(events, channel); // keep the durable backup in sync with preset changes too
  res.json({ ok: true });
});

// ====== Zero to Trader's manual Facebook-eligibility switch ======
// Facebook requires the Page to have 100 followers AND be 60 days old
// before Live Video works — rather than guessing this automatically, you
// flip this switch yourself once Facebook shows you're eligible. Until
// then, every Go-Live for this channel only ever sends you to YouTube.
app.get('/api/fb-eligibility/:channel', requireDashboardAuth, (req, res) => {
  const gw = loadGatewaySettings();
  res.json({ eligible: !!(gw.fbEligibility && gw.fbEligibility[req.params.channel]) });
});
app.post('/api/fb-eligibility/:channel', requireDashboardAuth, (req, res) => {
  const gw = loadGatewaySettings();
  if (!gw.fbEligibility) gw.fbEligibility = {};
  gw.fbEligibility[req.params.channel] = !!req.body.eligible;
  saveGatewaySettings(gw);
  res.json({ ok: true });
});

app.get('/api/content-ideas/:channel', requireDashboardAuth, (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const gw = loadGatewaySettings();
  const activeId = getActiveIdeaId(gw, channel);
  const events = loadScheduledEvents(channel).map(e => ({ ...e, goLiveUrl: `${PUBLIC_BASE_URL}/go-live/${channel}/${e.id}`, isLive: e.id === activeId }));
  res.json({ ideas: events.reverse() });
});

// ====== Overlay auto-load: whichever idea is marked "live" right now, per channel ======
// Intentionally public (no login) — the OBS Browser Source loading each
// channel's overlay has no way to authenticate as you, so this has to be
// readable without a login, same as /events and /calendar-today already
// are. It only ever exposes whatever YOU chose to mark live from that
// channel's Schedule panel — nothing donors/visitors submit ends up here.
app.get('/api/active-idea/:channel', (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const gw = loadGatewaySettings();
  const activeId = getActiveIdeaId(gw, channel);
  if (!activeId) return res.json({ found: false });
  const evt = loadScheduledEvents(channel).find(e => e.id === activeId);
  if (!evt) return res.json({ found: false });
  res.json({
    found: true,
    title: evt.title,
    leftName: evt.leftName, rightName: evt.rightName,
    leftPhotoUrl: evt.leftPhotoDataUrl, rightPhotoUrl: evt.rightPhotoDataUrl,
    introVoiceUrls: evt.introVoiceDataUrls || [],
    voiceRepeatSeconds: evt.voiceRepeatSeconds,
    musicUrls: evt.musicDataUrls || [],
    leftClipUrls: evt.leftVideoUrls || [],
    rightClipUrls: evt.rightVideoUrls || [],
    startingLossAmount: evt.startingLossAmount != null ? evt.startingLossAmount : null,
    affiliateProducts: evt.affiliateProducts || { amazon: [], flipkart: [], meesho: [], myntra: [] },
    preset: evt.preset || '1'
  });
});

// ====== Backward-compatible aliases (old links/bookmarks without a  ======
// ====== :channel segment) — always resolve to Fan Battle Live, so    ======
// nothing that was already saved/bookmarked before this update breaks. ======
app.get('/api/active-idea', (req, res) => {
  const channel = 'fanbattle';
  const gw = loadGatewaySettings();
  const activeId = getActiveIdeaId(gw, channel);
  if (!activeId) return res.json({ found: false });
  const evt = loadScheduledEvents(channel).find(e => e.id === activeId);
  if (!evt) return res.json({ found: false });
  res.json({
    found: true, title: evt.title,
    leftName: evt.leftName, rightName: evt.rightName,
    leftPhotoUrl: evt.leftPhotoDataUrl, rightPhotoUrl: evt.rightPhotoDataUrl,
    introVoiceUrls: evt.introVoiceDataUrls || [],
    voiceRepeatSeconds: evt.voiceRepeatSeconds,
    musicUrls: evt.musicDataUrls || [],
    leftClipUrls: evt.leftVideoUrls || [],
    rightClipUrls: evt.rightVideoUrls || [],
    affiliateProducts: evt.affiliateProducts || { amazon: [], flipkart: [], meesho: [], myntra: [] },
    preset: evt.preset || '1'
  });
});
app.get('/api/content-ideas', requireDashboardAuth, (req, res) => {
  const channel = 'fanbattle';
  const gw = loadGatewaySettings();
  const activeId = getActiveIdeaId(gw, channel);
  const events = loadScheduledEvents(channel).map(e => ({ ...e, goLiveUrl: `${PUBLIC_BASE_URL}/go-live/${channel}/${e.id}`, isLive: e.id === activeId }));
  res.json({ ideas: events.reverse() });
});



// ====== Notification senders — plain HTTPS calls, no extra npm packages ======
// Email via Resend (resend.com) — simplest transactional email API, works
// immediately with just an API key, no domain verification needed if you
// use their shared sending address for now.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
async function sendEmailNotification(toEmail, subject, htmlBody) {
  if (!RESEND_API_KEY || !toEmail) return { ok: false, error: 'Email not configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Fan Battle Live <onboarding@resend.dev>', to: [toEmail], subject, html: htmlBody })
    });
    const data = await res.json();
    if (data.id) return { ok: true };
    return { ok: false, error: JSON.stringify(data) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// SMS + WhatsApp via Twilio's plain REST API — self-serve signup, no
// content/App Review needed for your own number sending to your own phone.
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ''; // e.g. 'whatsapp:+14155238886' (sandbox)

async function sendTwilioMessage({ to, from, body }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !from || !to) return { ok: false, error: 'Twilio not configured' };
  try {
    const creds = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body })
    });
    const data = await res.json();
    if (data.sid) return { ok: true };
    return { ok: false, error: data.message || JSON.stringify(data) };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function sendSmsNotification(toNumber, message) {
  return sendTwilioMessage({ to: toNumber, from: TWILIO_SMS_FROM, body: message });
}
async function sendWhatsappNotification(toNumber, message) {
  return sendTwilioMessage({ to: `whatsapp:${toNumber.replace(/^whatsapp:/, '')}`, from: TWILIO_WHATSAPP_FROM, body: message });
}

// ====== Go-Live Reminder checker ======
// Runs every 30 seconds. For each not-yet-notified scheduled event, once the
// current time reaches (scheduledTime - reminderMinutesBefore), fires all
// three notification channels with the same link, then marks it notified so
// it never re-sends. This is independent of whether Facebook approval ever
// arrives — it works today, regardless.
async function checkGoLiveReminders() {
  const events = loadScheduledEvents();
  if (!events.length) return;
  const now = Date.now();
  let changed = false;
  for (const evt of events) {
    if (evt.notified) continue;
    const fireAt = new Date(evt.scheduledTime).getTime() - (evt.reminderMinutesBefore || 0) * 60000;
    if (now >= fireAt) {
      const notify = loadNotifySettings();
      const link = `${PUBLIC_BASE_URL}/go-live/${evt.id}`;
      const message = `🔴 Time to go live: "${evt.title}"\nPublish on Facebook now: ${link}`;
      const results = await Promise.allSettled([
        notify.email ? sendEmailNotification(notify.email, `Go live now: ${evt.title}`, `<p><b>${evt.title}</b></p><p>${(evt.description || '').replace(/\n/g, '<br>')}</p><p><a href="${link}">Click here to publish on Facebook</a></p>`) : Promise.resolve({ ok: false, error: 'no email set' }),
        notify.smsNumber ? sendSmsNotification(notify.smsNumber, message) : Promise.resolve({ ok: false, error: 'no SMS number set' }),
        notify.whatsappNumber ? sendWhatsappNotification(notify.whatsappNumber, message) : Promise.resolve({ ok: false, error: 'no WhatsApp number set' })
      ]);
      console.log(`🔔 Go-live reminder fired for "${evt.title}":`, results.map(r => r.value || r.reason));
      evt.notified = true;
      changed = true;
    }
  }
  if (changed) saveScheduledEvents(events);
}
setInterval(checkGoLiveReminders, 30000);

// ====== The page the reminder link opens — everything needed to publish ======
// Intentionally NOT behind dashboard login — this link is meant to be
// tapped straight from a WhatsApp/SMS/email notification on your phone,
// possibly without an active browser session. The event id itself
// (long, random, unguessable) is what keeps this from being public.
app.get('/go-live/:channel/:id', (req, res) => {
  const channel = channelOrDefault(req.params.channel);
  const chConfig = CHANNELS[channel];
  const events = loadScheduledEvents(channel);
  const evt = events.find(e => e.id === req.params.id);
  if (!evt) return res.status(404).send('<body style="background:#0B0F19; color:#F5F7FA; font-family:Arial; text-align:center; padding:60px;">This link is no longer valid — the idea may have been deleted.</body>');

  // Zero to Trader's Facebook step only unlocks once you've manually
  // flipped the eligibility switch in the app (100 followers + 60 days) —
  // every other channel always shows both steps.
  const gw = loadGatewaySettings();
  const fbStepEnabled = !chConfig.facebookEligibilityIsManual || !!(gw.fbEligibility && gw.fbEligibility[channel]);

  // ====== Five color+font presets (cosmetic only — same layout/design, just recolored) ======
  const PRESETS = {
    '1': { accent: '#FFC53D', badge: '#FFC53D', left: '#6C9BFF', right: '#FF6B5E' },
    '2': { accent: '#A78BFA', badge: '#A78BFA', left: '#A78BFA', right: '#FFC53D' },
    '3': { accent: '#4ADE80', badge: '#4ADE80', left: '#4ADE80', right: '#FB923C' },
    '4': { accent: '#F472B6', badge: '#F472B6', left: '#F9A8D4', right: '#5EEAD4' },
    '5': { accent: '#FDE047', badge: '#FDE047', left: '#FEF08A', right: '#F5F7FA' }
  };
  const chosenPreset = PRESETS[req.query.preset] || PRESETS[evt.preset] || PRESETS['1'];
  const finalStepNumber = fbStepEnabled ? 3 : 2;

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Go live: ${evt.title}</title>
  <style>
    body{font-family:Arial,sans-serif; background:#0B0F19; color:#F5F7FA; padding:28px 20px; max-width:480px; margin:0 auto;}
    h2{margin-bottom:14px;}
    .box{ background:#161C2E; border:1px solid rgba(245,247,250,0.08); border-radius:14px; padding:16px; margin-top:14px; }
    .box-label{ font-size:11px; color:#8B93A7; text-transform:uppercase; margin-bottom:6px; }
    .copy-btn{ font-size:11px; background:#2A3350; color:#F5F7FA; border:none; padding:5px 10px; border-radius:8px; margin-top:8px; cursor:pointer; }
    img{ max-width:100%; border-radius:10px; margin-top:10px; }
    a.fb-btn, a.yt-btn, button.confirm-btn{ display:block; width:100%; box-sizing:border-box; text-align:center; font-weight:bold; padding:14px; border-radius:12px; text-decoration:none; margin-top:14px; border:none; font-size:15px; cursor:pointer; font-family:Arial,sans-serif; }
    a.yt-btn{ background:#FF0000; color:white; }
    a.fb-btn{ background:#1877F2; color:white; }
    button.confirm-btn{ background:${chosenPreset.accent}; color:#0B0F19; }
    .step{ display:none; }
    .step.active{ display:block; }
    .step-badge{ display:inline-block; background:${chosenPreset.badge}; color:#0B0F19; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:800; margin-bottom:10px; }
    .done-box{ text-align:center; padding:30px 10px; }
    .top-back{ display:inline-block; color:#8B93A7; font-size:13px; text-decoration:none; margin-bottom:14px; }
    .sides-row{ display:flex; gap:16px; margin-top:12px; }
    .sides-row img{ width:56px; height:56px; object-fit:cover; border-radius:8px; margin-top:0; }
    .fb-note{ font-size:12px; color:#8B93A7; margin-top:10px; text-align:center; line-height:1.5; }
  </style></head><body>
    <a class="top-back" href="/app">← Back to Control (without going live)</a>
    <h2>🔴 Go live: ${evt.title}</h2>
    <div style="font-size:12px; color:#8B93A7; margin-top:-8px; margin-bottom:10px;">${chConfig.label}</div>
    ${(evt.leftName || evt.rightName) ? `<div class="sides-row">
      ${evt.leftPhotoDataUrl ? `<img src="${evt.leftPhotoDataUrl}">` : ''}
      ${evt.leftName ? `<div style="align-self:center; color:${chosenPreset.left}; font-size:13px;">🔵 ${evt.leftName}</div>` : ''}
      ${evt.rightPhotoDataUrl ? `<img src="${evt.rightPhotoDataUrl}">` : ''}
      ${evt.rightName ? `<div style="align-self:center; color:${chosenPreset.right}; font-size:13px;">🔴 ${evt.rightName}</div>` : ''}
    </div>` : ''}
    <div class="box"><div class="box-label">Title (copy this into YouTube${fbStepEnabled ? '/Facebook' : ''})</div><div id="titleText">${evt.title}</div><button class="copy-btn" onclick="copyText('titleText')">Copy</button></div>
    <div class="box"><div class="box-label">Description + hashtags</div><div id="descText" style="white-space:pre-wrap;">${evt.description || ''}</div><button class="copy-btn" onclick="copyText('descText')">Copy</button></div>
    ${evt.thumbnailDataUrl ? `<div class="box"><div class="box-label">Thumbnail (save this image, upload manually)</div><img src="${evt.thumbnailDataUrl}"></div>` : ''}

    <div class="step active" id="step1">
      <a class="yt-btn" href="${chConfig.youtubeUrl ? 'https://studio.youtube.com/live_dashboard' : 'https://studio.youtube.com/live_dashboard'}" target="_blank">Open YouTube Studio →</a>
      <button class="confirm-btn" onclick="goToStep(${fbStepEnabled ? 2 : finalStepNumber + 1})">✓ Published on YouTube${fbStepEnabled ? ' — Continue to Facebook' : ' — Done'}</button>
      ${!fbStepEnabled ? `<div class="fb-note">Facebook Live isn't enabled for this channel yet (needs 100 followers + the Page to be 60 days old). Flip it on from the app's ${chConfig.label} panel once Facebook shows you're eligible.</div>` : ''}
    </div>

    ${fbStepEnabled ? `<div class="step" id="step2">
      <span class="step-badge">STEP 2</span>
      <a class="fb-btn" href="https://www.facebook.com/live/producer" target="_blank">Open Facebook Live Producer →</a>
      <button class="confirm-btn" onclick="goToStep(3)">✓ Published on Facebook — Done</button>
    </div>` : ''}

    <div class="step" id="step${finalStepNumber + 1}">
      <div class="done-box">
        <div style="font-size:40px;">🎉</div>
        <h2>You're live!</h2>
        <p style="color:#8B93A7;">Taking you to your live overlay.</p>
        <a href="/overlay/${channel}" style="display:block; background:${chosenPreset.accent}; color:#0B0F19; font-weight:800; padding:14px; border-radius:12px; text-decoration:none; margin-top:16px;">→ Go to my Live Overlay</a>
        <a href="/app" style="display:block; color:#8B93A7; font-size:12.5px; margin-top:14px; text-decoration:none;">← Or back to Control panel</a>
      </div>
    </div>

    <script>
      function copyText(id){ navigator.clipboard.writeText(document.getElementById(id).textContent); }
      function goToStep(n){
        document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
        document.getElementById('step' + n).classList.add('active');
      }
      // Mark this idea as the "live" one the moment this page opens, so the
      // ideas list back in /app shows a 🔴 LIVE badge on it. Silently
      // ignored if not logged into the dashboard in this browser.
      fetch('/schedule/${channel}/${evt.id}/set-live', { method: 'POST' }).catch(() => {});
    </script>
  </body></html>`);
});

// ====== Notification contact settings (WhatsApp / SMS / Email) ======
app.get('/api/notify-settings', requireDashboardAuth, (req, res) => { res.json(loadNotifySettings()); });
app.post('/api/notify-settings', requireDashboardAuth, (req, res) => {
  const { whatsappNumber, smsNumber, email } = req.body;
  saveNotifySettings({ whatsappNumber: whatsappNumber || '', smsNumber: smsNumber || '', email: email || '' });
  res.json({ ok: true });
});


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

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  // Pull back any content ideas from the Google Drive backup if this boot
  // started with an empty/wiped local disk (e.g. after a Render free-tier
  // restart) — see restoreContentIdeasOnStartup() above for details.
  await restoreContentIdeasOnStartup();
});

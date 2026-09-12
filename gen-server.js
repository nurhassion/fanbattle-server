'use strict';
/*
 * gen-server.js — সার্ভার, ডেটাবেস, আপলোড, লাইভ ক্লাস
 *
 * ⚠️ এখানেই আসল নিরাপত্তা। অ্যাপে বোতাম লুকানো সাজসজ্জা।
 *
 * ⚠️ তিনটে জিনিস যেগুলো বেশিরভাগ শেখানো প্রকল্পে থাকে না, অথচ ছাড়া
 * অ্যাপটা ব্যবসা হয় না:
 *
 *   ১. আপলোড — বড় ফাইল সার্ভারের ভেতর দিয়ে পাঠানো হয় না। সার্ভার
 *      একটা সময়সীমাওয়ালা ঠিকানা দেয়, ফোন সরাসরি স্টোরেজে পাঠায়।
 *      নাহলে একটা ৫০০ MB ভিডিওই পুরো সার্ভার আটকে দেয়।
 *
 *   ২. কে দেখতে পাবে — ভিডিওর ঠিকানা স্থায়ী হলে একজন কিনে বাকিদের
 *      লিংক পাঠিয়ে দেবে। তাই প্রতিবার নতুন, অল্প সময়ের ঠিকানা।
 *
 *   ৩. লাইভ ক্লাস — শিক্ষকের মাইক খোলা, ছাত্রদের বন্ধ। প্রশ্ন থাকলে
 *      হাত তোলে, শিক্ষক অনুমতি দিলে মাইক খোলে। ২০০ জনের মাইক একসাথে
 *      খোলা রাখলে কোনো যন্ত্রই সামলাতে পারবে না।
 */

function db(a) {
  return `// db.js — the shape of everything ${a.name} stores.
//
// Starts as a single file on your machine. Nothing to install, nothing to
// pay for. When you outgrow it, change DATABASE_URL and the rest of the
// code does not care. That is the whole reason it is behind this file.

const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_URL ? process.env.DATABASE_URL.replace('file:', '') : './data.db');
db.pragma('journal_mode = WAL');   // lets reading and writing happen at once

db.exec(\`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  permissions TEXT DEFAULT '[]',
  country TEXT DEFAULT 'IN',
  lang TEXT DEFAULT 'en',
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

-- A provider's application and papers. We store WHERE the file is,
-- never the number itself. An id number in a database column is a
-- liability; a file you can delete is not.
CREATE TABLE IF NOT EXISTS provider_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  status TEXT DEFAULT 'pending',          -- pending | approved | suspended
  documents TEXT DEFAULT '{}',            -- { "Aadhaar number": "file-key" }
  bank TEXT DEFAULT '{}',
  reviewed_by TEXT,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  price_minor INTEGER NOT NULL DEFAULT 0,
  media_key TEXT,
  visibility TEXT DEFAULT 'public',       -- public | enrolled | private
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT REFERENCES items(id),
  total_minor INTEGER NOT NULL,
  platform_minor INTEGER NOT NULL,        -- your cut, worked out at order time
  provider_minor INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL
);

-- Who is allowed to open which item. Written when payment succeeds,
-- never before. This one table is what stops a paid course leaking.
CREATE TABLE IF NOT EXISTS enrolments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  order_id TEXT REFERENCES orders(id),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, item_id)
);

CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES items(id),
  host_id TEXT NOT NULL REFERENCES users(id),
  room TEXT NOT NULL UNIQUE,
  starts_at TEXT,
  status TEXT DEFAULT 'scheduled',        -- scheduled | live | ended
  created_at TEXT NOT NULL
);

-- Students ask to speak; the teacher lets them. Nobody unmutes themselves.
CREATE TABLE IF NOT EXISTS hand_raises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT DEFAULT 'raised',            -- raised | allowed | lowered
  at TEXT NOT NULL
);

-- Your commission and anything else you change from the owner screen.
-- Kept in the database, not in a file, because the app must be able to
-- read it without a redeploy, and because a file resets on most hosts.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES users(id),
  amount_minor INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  requested_at TEXT NOT NULL,
  paid_at TEXT
);

-- Every time somebody looks at a record that is not theirs.
-- A look that leaves no trace cannot be told apart from theft.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT, actor_role TEXT, action TEXT,
  subject_id TEXT, path TEXT, at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_provider ON orders(provider_id);
CREATE INDEX IF NOT EXISTS idx_items_provider  ON items(provider_id);
CREATE INDEX IF NOT EXISTS idx_enrol_user      ON enrolments(user_id);
\`);

module.exports = { db };
`;
}


/* ---------------------------------------------------------------- */
function storage(a) {
  return `// storage.js — where uploaded files actually live.
//
// THE RULE: big files never travel through your server.
//
// A 500 MB lesson video sent through Node blocks everything else while it
// uploads. Instead the server hands out a short-lived address, the phone
// uploads straight to storage, and the server only ever sees the key.
// Same pattern every large app uses, and it costs nothing to do right.
//
// Free to start: Cloudflare R2 gives 10 GB and no charge for downloads,
// which is the part that usually hurts. Backblaze B2 and Supabase Storage
// also have free tiers. All three speak the same S3 language, so switching
// later means changing three lines here and nothing anywhere else.

const crypto = require('crypto');

const BUCKET   = process.env.STORAGE_BUCKET || '';
const ENDPOINT = process.env.STORAGE_ENDPOINT || '';
const KEY      = process.env.STORAGE_KEY || '';
const SECRET   = process.env.STORAGE_SECRET || '';

// Until you fill those in, uploads are saved next to the app so you can
// still build and test everything. Do not ship to real users like this;
// most hosts wipe local files every time the app restarts.
const LOCAL_MODE = !BUCKET;

function newKey(userId, filename) {
  const ext = (filename.match(/\\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  // Never keep the name the user gave. It can contain paths, quotes, or
  // somebody's real name in a document they did not mean to share.
  return userId + '/' + crypto.randomBytes(16).toString('hex') + ext;
}

/* An address the phone can POST to, valid for a few minutes. */
async function uploadUrl(userId, filename, contentType) {
  const key = newKey(userId, filename);
  if (LOCAL_MODE) return { key, url: '/upload-local/' + encodeURIComponent(key), local: true };
  const url = await presign('PUT', key, 300, contentType);
  return { key, url, local: false };
}

/* An address to WATCH with, valid for minutes, not forever.
   This is what stops one person buying a course and posting the link.
   A permanent link is a permanent leak. */
async function viewUrl(key, seconds = 600) {
  if (!key) return null;
  if (LOCAL_MODE) return '/files/' + encodeURIComponent(key);
  return presign('GET', key, seconds);
}

async function presign(method, key, seconds, contentType) {
  // Signed with your secret, so the address cannot be edited or extended.
  const expires = Math.floor(Date.now() / 1000) + seconds;
  const toSign = [method, BUCKET, key, expires, contentType || ''].join('\\n');
  const sig = crypto.createHmac('sha256', SECRET).update(toSign).digest('hex');
  return ENDPOINT + '/' + BUCKET + '/' + key +
    '?expires=' + expires + '&key=' + KEY + '&sig=' + sig;
}

module.exports = { uploadUrl, viewUrl, newKey, LOCAL_MODE };
`;
}

/* ---------------------------------------------------------------- */
function live(a) {
  return `// live.js — live classes.
//
// HOW THIS WORKS, and why it is built this way:
//
// The teacher's microphone is open. Every student's is off. A student who
// wants to ask something raises a hand; the teacher taps allow, and only
// then does that one microphone open. Nobody unmutes themselves.
//
// This is not politeness. Two hundred open microphones is more audio than
// any connection or any device can carry, and the class becomes noise.
// Every serious classroom app works this way.
//
// The room itself runs on LiveKit. It is open source, so you can run it
// yourself for nothing, or use their hosted service which is free up to
// about fifty hours a month. Fifty hours is a lot of classes while you
// are starting. The guide explains exactly when you would outgrow it and
// what it costs then. There is no way to avoid this cost with code; video
// to many people at once needs real machines somewhere.

const { AccessToken } = require('livekit-server-sdk');

const LK_KEY    = process.env.LIVEKIT_KEY || '';
const LK_SECRET = process.env.LIVEKIT_SECRET || '';
const LK_URL    = process.env.LIVEKIT_URL || '';

// The server decides what each person may do in the room. The phone asks;
// it never decides. If the phone decided, any student could grant
// themselves a microphone by editing one value.
function roomToken({ room, user, isHost, maySpeak }) {
  if (!LK_KEY) return null;             // not configured yet
  const at = new AccessToken(LK_KEY, LK_SECRET, {
    identity: user.id,
    name: user.name,
    ttl: 60 * 60 * 3,                   // three hours, then re-ask
  });
  at.addGrant({
    room,
    roomJoin: true,
    // Only the teacher, or a student the teacher has allowed, may publish
    // audio. Everyone else can listen and watch, nothing more.
    canPublish: !!(isHost || maySpeak),
    canPublishData: true,               // chat and hand-raises use this
    canSubscribe: true,
    roomAdmin: !!isHost,                // only the host can end the class
  });
  return { url: LK_URL, token: at.toJwt() };
}

module.exports = { roomToken, configured: !!LK_KEY };
`;
}

module.exports = { db, storage, live };

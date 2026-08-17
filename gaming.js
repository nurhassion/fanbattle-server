// gaming.js
// ============================================================================
// সব গেমিং-অটোমেশন কোড এই ONE ফাইলে — কোনো ফোল্ডার/সাব-ফাইল নেই, তাই GitHub-এ
// একটামাত্র "Create new file" দিয়ে path "gaming.js" (রুটে) বসিয়ে পুরো কনটেন্ট
// পেস্ট করলেই যথেষ্ট। server.js-এর নিচে এক লাইনে এটা mount করা হয়:
//
//   require('./gaming.js')(app);
//
// এই ফাইল যা করে:
//   - config/schedule.json এর বদলে নিচের SCHEDULE অবজেক্ট থেকে সময়সূচি পড়ে
//     (এই ফাইলের ভেতরেই এডিট করবেন, আলাদা ফাইল না)
//   - /gaming/overlay/chess ইত্যাদি রুট চালু করে (HTML এই
//     ফাইলের ভেতরেই লেখা, আলাদা .html ফাইল লাগে না)
//   - Stockfish দিয়ে চেস ইঞ্জিন ব্যাটেল চালায়, chess.js দিয়ে বৈধতা যাচাই করে
//   - CricAPI/football-data.org থেকে লাইভ স্কোর টানে
//   - edge-tts দিয়ে বাংলা voice commentary বানায়
//   - YouTube Data API দিয়ে broadcast তৈরি/শুরু/শেষ করে
//
// *** যা লাগবে (Dockerfile-এ আগে থেকেই ইনস্টল করা থাকবে) ***
//   npm: chess.js  (এগুলো মূল package.json-এ যোগ করুন — canvas/googleapis/node-cron আসলে লাগে না, বাদ দেওয়া হয়েছে)
//   system: stockfish, python3-pip + edge-tts, xvfb, ffmpeg, chromium
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const express = require("express");
// multer — ছবি আপলোডের জন্য (join ফর্মে দর্শক নিজের ছবি দেবে)। ইনস্টল না থাকলে
// upload অংশ চুপচাপ বন্ধ থাকবে (ছবি ছাড়া নাম দিয়েই লাইনে দাঁড়ানো যাবে), বাকি সব ঠিক চলবে।
let multer = null;
try {
  multer = require("multer");
} catch (e) {
  console.error("⚠️ multer ইনস্টল নেই (package.json এ যোগ করুন) — ছবি আপলোড ছাড়াই চ্যালেঞ্জ queue চলবে।");
}
// web-push — queue-তে দাঁড়ানো দর্শকের মোবাইলে আসল push notification পাঠানোর জন্য
// (ব্রাউজার ট্যাব বন্ধ থাকলেও নোটিফিকেশন পৌঁছাবে, Android/Chrome-এ সবচেয়ে ভালো কাজ করে;
// iOS-এ Safari-তে PWA হিসেবে হোম-স্ক্রিনে অ্যাড না করলে কাজ করবে না — এটা Apple-এর নিজস্ব সীমাবদ্ধতা)
let webpush = null;
try {
  webpush = require("web-push");
} catch (e) {
  console.error("⚠️ web-push ইনস্টল নেই (package.json এ 'web-push': '^3.6.7' যোগ করুন) — push notification পাঠানো যাবে না, শুধু ব্রাউজার ট্যাব খোলা থাকলে status পেজে লাইভ পজিশন দেখা যাবে।");
}
const CHALLENGE_UPLOAD_DIR = path.join(__dirname, "public-uploads");
if (!fs.existsSync(CHALLENGE_UPLOAD_DIR)) fs.mkdirSync(CHALLENGE_UPLOAD_DIR, { recursive: true });
const upload = multer ? multer({ dest: CHALLENGE_UPLOAD_DIR, limits: { fileSize: 4 * 1024 * 1024 } }) : null;

// ---------------------------------------------------------------------------
// ১. শিডিউল — এখানেই এডিট করুন কখন কোন চ্যানেলে কী চলবে
// ---------------------------------------------------------------------------
const SCHEDULE = {
  timezone: "Asia/Kolkata",
  channels: {
    boardgames: { youtubeChannelId: "PUT_YOUR_GAMING_CHANNEL_ID_HERE" },
  },
  blocks: [
    {
      id: "morning-chess",
      channel: "boardgames",
      days: [0, 1, 2, 3, 4, 5, 6],
      start: "00:00",
      end: "23:59",
      game: "chess",
      title: "🔥 AI vs AI Chess Battle LIVE | Stockfish vs Stockfish | চাল বিশ্লেষণ সহ",
      description:
        "দুটো Stockfish ইঞ্জিন নিজেদের মধ্যে লড়ছে — প্রতিটা গেম শেষে বাংলায় চাল বিশ্লেষণ ও নিয়ম ব্যাখ্যা।\n\n#chess #ai #livestream",
    },
  ],
};

// ---------------------------------------------------------------------------
// ২. ছোট হেল্পার — ফাইল-ভিত্তিক state (JSON), যাতে overlay পেজ poll করে পড়তে পারে
// ---------------------------------------------------------------------------
const STATE_DIR = path.join(__dirname, ".gaming-state");
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
const AUDIO_DIR = path.join(STATE_DIR, "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

function writeState(name, data) {
  fs.writeFileSync(path.join(STATE_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}
function readState(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${name}.json`), "utf-8"));
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ৩. TTS (edge-tts, ফ্রি) — cache সহ
// ---------------------------------------------------------------------------
// ⚠️ এই দুটো key সরাসরি কোডে বসানো আছে টেস্টিং সহজ করতে। এটা কখনো public
// repo-তে না রাখাই ভালো অভ্যাস — পরে VPS-এ deploy করার সময় Environment
// Variables-এ সরিয়ে নেবেন (README-তে বলা আছে)।

const VOICE = process.env.TTS_VOICE || "bn-BD-NabanitaNeural";
function textToSpeech(text) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5").update(text).digest("hex").slice(0, 12);
    const filename = `${hash}.mp3`;
    const outPath = path.join(AUDIO_DIR, filename);
    if (fs.existsSync(outPath)) return resolve(`/gaming/audio/${filename}`);

    const proc = spawn("edge-tts", ["--voice", VOICE, "--text", text, "--write-media", outPath]);
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(`/gaming/audio/${filename}`) : reject(new Error("edge-tts failed"))));
  });
}

// ---------------------------------------------------------------------------
// ৪. চেস — Stockfish + chess.js
// ---------------------------------------------------------------------------
// প্রতিটা নতুন ম্যাচে বোর্ডের রঙ থিম বদলাতে — ক্লাসিক লুক (কাঠের বোর্ড, গোলাকার গুটির আকৃতি) ঠিক রেখেই
// শুধু রঙ কম্বিনেশন পাল্টায়, যাতে ওভারঅল টেমপ্লেটটা একঘেয়ে না লাগে
const BOARD_THEMES = [
  { light: "#EFE0BF", dark: "#5C3A21", pcW1: "#ffffff", pcW2: "#d4cbb8", pcB1: "#3a3a3a", pcB2: "#000000", border: "linear-gradient(135deg,#B8874A,#3E2712)", accent: "#E8B33D" }, // ক্লাসিক কাঠ
  { light: "#DDEBF7", dark: "#3B5F82", pcW1: "#ffffff", pcW2: "#c9d9e8", pcB1: "#1a2c3d", pcB2: "#0a1420", border: "linear-gradient(135deg,#5A87B0,#1E3A54)", accent: "#5EC8FF" }, // নীল সমুদ্র
  { light: "#E9F0DF", dark: "#4A6741", pcW1: "#ffffff", pcW2: "#d2e0c4", pcB1: "#2b3a26", pcB2: "#111a0d", border: "linear-gradient(135deg,#7A9E6B,#2E4527)", accent: "#9EDB6E" }, // সবুজ বন
  { light: "#F3E3EC", dark: "#6B3F5C", pcW1: "#ffffff", pcW2: "#e3cbdb", pcB1: "#3a2333", pcB2: "#180d15", border: "linear-gradient(135deg,#A5628F,#4A2740)", accent: "#F088C4" }, // বেগুনি-গোলাপি
  { light: "#EDEDED", dark: "#3F4448", pcW1: "#ffffff", pcW2: "#d8d8d8", pcB1: "#26292b", pcB2: "#0a0b0c", border: "linear-gradient(135deg,#8A9196,#2A2E31)", accent: "#E0E4E8" }, // মনোক্রোম গ্রে
  { light: "#F5E9D3", dark: "#7A2E2E", pcW1: "#fff8ec", pcW2: "#e3c9a1", pcB1: "#3a1414", pcB2: "#180606", border: "linear-gradient(135deg,#B0524A,#5A1E1E)", accent: "#FF8A5C" }, // পোড়া লাল-কমলা
];
function randomBoardTheme() { return BOARD_THEMES[Math.floor(Math.random() * BOARD_THEMES.length)]; }

const OPENING_BOOK = [

  { name: "Ruy Lopez", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"] },
  { name: "Sicilian Defence", moves: ["e4", "c5", "Nf3", "d6", "d4"] },
  { name: "Queen's Gambit", moves: ["d4", "d5", "c4"] },
  { name: "King's Indian Defence", moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"] },
  { name: "English Opening", moves: ["c4", "e5", "Nc3"] },
  { name: "Caro-Kann Defence", moves: ["e4", "c6", "d4", "d5"] },
];
const RULES_TEXT_BN = `
এবার সংক্ষেপে প্রতিটা গুটির চাল বুঝিয়ে দিই।
রাজা — এক ঘর করে, যেকোনো দিকে যেতে পারে।
মন্ত্রী/রানী — সবচেয়ে শক্তিশালী, যেকোনো দিকে যত ইচ্ছা ঘর যেতে পারে।
কেল্লা/রুক — শুধু সোজা লাইনে, সামনে-পেছনে বা ডানে-বামে, যত ইচ্ছা ঘর।
ঘোড়া — 'L' আকারে চলে, একমাত্র গুটি যেটা অন্য গুটির উপর দিয়ে ডিঙিয়ে যেতে পারে।
বিশপ/উজির — শুধু কোনাকুনি, সবসময় একই রঙের ঘরে থাকে।
সৈনিক/বোড়ে — সাধারণত এক ঘর সামনে, প্রথম চালে দুই ঘর; মারার সময় কোনাকুনি এক ঘর; শেষ প্রান্তে পৌঁছালে প্রমোট হয়।
`.trim();

let chessLoopActive = false;

// ---------------------------------------------------------------------------
// লাইভ চ্যালেঞ্জ / queue সিস্টেম — দর্শক লাইনে দাঁড়িয়ে Nur-এর বিরুদ্ধে সত্যিই খেলতে পারবে
// ---------------------------------------------------------------------------
let challengeQueue = []; // [{ id, name, photoUrl, joinedAt, lastNotifiedPosition }]
let activeChallenge = null; // { id, name, photoUrl, chess, lastHumanMoveAt }
const TIP_URL = process.env.CHALLENGE_TIP_URL || ""; // আপনার payment/tip লিংক, .env এ CHALLENGE_TIP_URL হিসেবে বসান

function nextQueueId() {
  return "q" + Date.now() + Math.floor(Math.random() * 1000);
}
function getQueuePublicState() {
  return challengeQueue.map((q, i) => ({ position: i + 1, name: q.name, photoUrl: q.photoUrl, tipAmount: q.tipAmount || 0 }));
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// পুশ নোটিফিকেশন সিস্টেম — queue-তে থাকা প্রত্যেকের নাম্বার কমার সাথে সাথে,
// আর turn আসার মুহূর্তে তার মোবাইলে notification পাঠায়
// ---------------------------------------------------------------------------
const VAPID_FILE = path.join(STATE_DIR, "vapid-keys.json");
let VAPID_PUBLIC_KEY = "";
if (webpush) {
  let keys;
  if (fs.existsSync(VAPID_FILE)) {
    keys = JSON.parse(fs.readFileSync(VAPID_FILE, "utf-8"));
  } else {
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
  }
  VAPID_PUBLIC_KEY = keys.publicKey;
  webpush.setVapidDetails("mailto:admin@example.com", keys.publicKey, keys.privateKey);
}
let pushSubscriptions = {}; // { [queueId]: subscriptionObject }

async function sendPushToId(id, payload) {
  const sub = pushSubscriptions[id];
  if (!sub || !webpush) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
  } catch (e) {
    if (e.statusCode === 410 || e.statusCode === 404) delete pushSubscriptions[id]; // সাবস্ক্রিপশন mara গেছে, মুছে দিলাম
    else console.error("push পাঠাতে সমস্যা:", e.message);
  }
}

// queue array পরিবর্তন হলেই (কেউ join/leave করলে, বা turn শুরু হয়ে কেউ শিফট হলে) এটা কল করুন —
// প্রত্যেকের নতুন position আগেরটার থেকে আলাদা হলেই শুধু নোটিফিকেশন পাঠাবে (বারবার একই নাম্বার পাঠাবে না)
function notifyQueuePositions() {
  challengeQueue.forEach((q, i) => {
    const position = i + 1;
    if (q.lastNotifiedPosition === position) return;
    q.lastNotifiedPosition = position;
    if (position === 1) {
      // "প্রায় ২ মিনিট আগে" এর সবচেয়ে কাছাকাছি বাস্তবসম্মত সংকেত — এখন লাইনে ঠিক পরেরজন,
      // মানে চলতি ম্যাচ শেষ হলেই তার পালা শুরু হবে। এটা "রিং"-স্টাইল — দীর্ঘ vibration pattern,
      // notification নিজে থেকে বন্ধ হবে না (requireInteraction), tab খোলা থাকলে সাথে আসল রিংটোনও বাজবে
      sendPushToId(q.id, {
        title: "📞 আপনার পালা প্রায় এসে গেছে!",
        body: `${q.name}, you are next in line — get ready, you play as soon as the current match ends!`,
        tag: "queue-ring",
        requireInteraction: true,
        ring: true,
        url: "/gaming/challenge/status?id=" + q.id,
      });
    } else if (position === 3) {
      // মানে তার আগে মাত্র ২ জন বাকি — বড় এলার্ম-স্টাইল নোটিফিকেশন
      sendPushToId(q.id, {
        title: "🔔 Almost your turn!",
        body: `${q.name}, only 2 players before you — get ready now!`,
        tag: "queue-alert",
        requireInteraction: true,
        url: "/gaming/challenge/status?id=" + q.id,
      });
    } else {
      sendPushToId(q.id, {
        title: "🔢 Queue update",
        body: `${q.name}, you are now #${position} in line`,
        tag: "queue-position",
        requireInteraction: false,
        url: "/gaming/challenge/status?id=" + q.id,
      });
    }
  });
}

// ===========================================================================
// Snake / Ball Sort — লাইনে দাঁড়িয়ে খেলার সিস্টেম (queue)
// ---------------------------------------------------------------------------
// চেসের queue থেকে এটা একটা জায়গায় আলাদা: চেসে চ্যালেঞ্জার overlay-র বোর্ডেই চাল দেয়,
// তাই সেখানে "turn" মানে বোর্ডের দখল। এখানে খেলোয়াড় নিজের ফোনেই খেলে — তাই "turn" মানে
// তাকে একটা নির্দিষ্ট সময়ের স্লট দেওয়া হয়, ওই সময়টুকুতে তার নাম ও ছবি লাইভ স্ট্রিমে
// দেখা যায়, আর সে তার একটামাত্র খেলা খেলে ফেলে।
//
// নিয়ম:
//  • একবার লিংকে ঢুকে নাম-ছবি দিয়ে লাইনে দাঁড়ালে **একবারই** খেলা যায়। আবার খেলতে চাইলে
//    আবার লিংকে ঢুকে নতুন করে লাইনে দাঁড়াতে হবে।
//  • একসাথে একজনই খেলে। তার স্লট শেষ হলে বা খেলা শেষ করলে পরেরজনের ডাক পড়ে।
//  • পালা আসার ~৫ মিনিট আগে (= লাইনে ১ নম্বরে পৌঁছালে) ফোনে নোটিফিকেশন যায়, আর সেটা
//    বারবার ভাইব্রেট করতে থাকে যতক্ষণ না সে ক্লিক করে খেলার পেজে আসছে।
// ===========================================================================
const GQ_GAMES = ["snake", "ballsort"];
const GQ_TURN_MS = 5 * 60 * 1000;     // একজনের স্লট ৫ মিনিট — এটাই "৫ মিনিট আগে" হিসেবের ভিত্তি
const GQ_IDLE_MS = 60 * 1000;         // টানা এত সময় কোনো চাল না দিলে পালা বাতিল
const GQ_RING_EVERY_MS = 20 * 1000;   // ক্লিক না করা পর্যন্ত প্রতি ২০ সেকেন্ডে আবার ভাইব্রেট
const GQ_RING_MAX_MS = 5 * 60 * 1000; // অনন্তকাল বাজতে থাকবে না — বড়জোর ৫ মিনিট

// server.js এই ফাইলেই সব পেমেন্ট রেকর্ড করে — আমরা শুধু পড়ি, কখনো লিখি না
const DONATION_RECORDS_FILE = path.join(__dirname, "records.json");
const gameQueues = {};
GQ_GAMES.forEach((g) => { gameQueues[g] = { queue: [], active: null }; });

function gqLabel(game) { return game === "snake" ? "Snake" : "Ball Sort Puzzle"; }

// লাইনে দাঁড়ানোর সময় দেওয়া ছবিটা server.js-এর /donor-photo রুটে পাঠানো হয়, যাতে পরে
// সে টাকা দিলে সেলিব্রেশনে ও টপ-৩ তালিকায় ওই ছবিটাই ব্যবহার হয়।
// celebrationId পাঠানো হয় না, তাই এখনই কোনো সেলিব্রেশন হয় না, শুধু ছবিটা জমা থাকে।
function registerQueuePhotoAsDonorPhoto(name, filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length > 4 * 1024 * 1024) return;
    const ext = (path.extname(filePath) || ".jpg").slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const dataUrl = "data:" + mime + ";base64," + buf.toString("base64");
    const port = process.env.PORT || 3000;
    fetch("http://127.0.0.1:" + port + "/donor-photo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, photoDataUrl: dataUrl }),
    }).catch(function(){});
  } catch (e) { /* ছবি নথিভুক্ত না হলেও লাইনে দাঁড়ানো আটকাবে না */ }
}

// ⚠️ আগে খেলোয়াড় নিজেই "কত টিপস দিয়েছি" টাইপ করে দিত — যে কেউ ₹৯৯৯৯ লিখে দিতে পারত।
// এখন সংখ্যাটা আসে সার্ভারে সত্যিই রেকর্ড হওয়া পেমেন্ট থেকে, নাম মিলিয়ে। কেউ টাকা না দিলে
// শূন্য দেখাবে, আর যত টাকা সত্যিই দিয়েছে ঠিক ততটাই দেখাবে।
function gqRealTipTotal(game, name) {
  try {
    const records = JSON.parse(fs.readFileSync(DONATION_RECORDS_FILE, "utf-8"));
    const key = (name || "").trim().toLowerCase();
    if (!key) return 0;
    return Math.round(records
      .filter((r) => r.side === game && (r.name || "").trim().toLowerCase() === key)
      .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0));
  } catch (e) { return 0; }
}
function gqPublicQueue(game) {
  return gameQueues[game].queue.map((q, i) => ({
    position: i + 1, name: q.name, photoUrl: q.photoUrl,
    tipAmount: gqRealTipTotal(game, q.name),
  }));
}
// ---------------------------------------------------------------------------
// খেলার আয়না (mirror)
// ---------------------------------------------------------------------------
// চ্যালেঞ্জার নিজের ফোনে যা খেলছে, প্রতিটা চালের পর সেটার অবস্থা এখানে পাঠায়।
// overlay সেটাই পড়ে নিজের বোর্ডে এঁকে দেয় — তাই দর্শক দেখে *তারই* খেলাটা লাইভে চলছে।
// (ফোনের পর্দা স্ট্রিম করা হচ্ছে না — শুধু খেলার অবস্থাটুকু, তাই খুবই হালকা।)
const gqMirror = { snake: null, ballsort: null };
// overlay-র নিজের (AI) খেলার অবস্থা — লাইনে দাঁড়ানো দর্শকদের দেখানোর জন্য
const gqWatch = { snake: null, ballsort: null };

function gqPublicActive(game) {
  const a = gameQueues[game].active;
  if (!a) return null;
  return {
    name: a.name, photoUrl: a.photoUrl, tipAmount: gqRealTipTotal(game, a.name),
    secondsLeft: Math.max(0, Math.round((a.startedAt + GQ_TURN_MS - Date.now()) / 1000)),
  };
}

// পালা আসার আগে ফোনে "রিং" — ক্লিক না করা পর্যন্ত থামে না
function gqStartRinging(game, entry) {
  gqStopRinging(entry);
  const started = Date.now();
  const fire = () => {
    if (entry.acknowledged || Date.now() - started > GQ_RING_MAX_MS) return gqStopRinging(entry);
    // প্রতিবার আবার পাঠানোর সময় কত বাকি তা হিসেব করে শিরোনামে লেখা হয়, তাই
    // নোটিফিকেশনেই সে দেখতে পায় হাতে আর কতটুকু সময় আছে
    var leftSec = Math.max(0, Math.round((GQ_TURN_MS - (Date.now() - started)) / 1000));
    var mm = Math.floor(leftSec / 60), ss = leftSec % 60;
    sendPushToId(entry.id, {
      title: "📞 YOUR TURN — " + mm + ":" + (ss < 10 ? "0" : "") + ss + " left",
      body: `${entry.name}, tap now to play ${gqLabel(game)} live!`,
      tag: "gq-ring-" + game,       // একই tag, তাই ফোনে নোটিফিকেশন জমতে থাকবে না — একটাই বারবার বাজবে
      requireInteraction: true,
      ring: true,
      url: `/gaming/challenge/${game}?id=${entry.id}`,
    });
  };
  fire();
  entry.ringTimer = setInterval(fire, GQ_RING_EVERY_MS);
}
function gqStopRinging(entry) {
  if (entry && entry.ringTimer) { clearInterval(entry.ringTimer); entry.ringTimer = null; }
}

// লাইনের নাম্বার বদলালে সবাইকে জানানো। ⚠️ শুধু নাম্বার বদলালেই পাঠানো হয়, একই নাম্বার
// বারবার পাঠালে দর্শকের ফোন অকারণে বাজতেই থাকত।
function gqNotifyPositions(game) {
  gameQueues[game].queue.forEach((q, i) => {
    const position = i + 1;
    if (q.lastNotifiedPosition === position) return;
    q.lastNotifiedPosition = position;
    const mins = Math.round((position * GQ_TURN_MS) / 60000);
    if (position === 1) {
      sendPushToId(q.id, {
        title: "🔔 Almost your turn!",
        body: `${q.name}, you are next in line — about 5 minutes to go. Get ready!`,
        tag: "gq-next-" + game, requireInteraction: true,
        url: `/gaming/challenge/${game}?id=${q.id}`,
      });
    } else {
      sendPushToId(q.id, {
        title: "🔢 Queue update",
        body: `${q.name}, you are #${position} in line — about ${mins} minutes to go`,
        tag: "gq-pos-" + game, requireInteraction: false,
        url: `/gaming/challenge/${game}?id=${q.id}`,
      });
    }
  });
}

function gqFinishActive(game, reason) {
  const st = gameQueues[game];
  if (!st.active) return;
  console.log(`[${game}-queue] ${st.active.name}-এর পালা শেষ (${reason})`);
  gqStopRinging(st.active);
  delete pushSubscriptions[st.active.id];
  st.active = null;
  gqMirror[game] = null; // আয়না মুছে দিলে overlay নিজে থেকেই AI-এর খেলায় ফিরে যাবে
}

// প্রতি ২ সেকেন্ডে — কারও স্লট শেষ হয়েছে কিনা, আর লাইনে কেউ অপেক্ষা করছে কিনা দেখে
function gqTick() {
  GQ_GAMES.forEach((game) => {
    const st = gameQueues[game];
    if (st.active) {
      const m = gqMirror[game];
      // শেষ কবে সে কিছু করেছে — চাল দিলে mirror আপডেট হয়, তাই ওটাই সবচেয়ে নির্ভরযোগ্য চিহ্ন
      const lastActivity = (m && m.at > st.active.startedAt) ? m.at : st.active.startedAt;
      if (st.active.finished) gqFinishActive(game, "খেলা শেষ করেছেন");
      else if (Date.now() - st.active.startedAt > GQ_TURN_MS) gqFinishActive(game, "সময় শেষ");
      // ⚠️ কেউ লিংক খুলে ফেলে রাখলে পুরো ৫ মিনিট বোর্ড আটকে থাকত আর দর্শক স্থির পর্দা
      // দেখত। এখন টানা ১ মিনিট কোনো চাল না এলে পালা বাতিল হয়ে পরের জন ডাক পায়
      // (কেউ না থাকলে AI আবার নিজে খেলতে শুরু করে)।
      else if (Date.now() - lastActivity > GQ_IDLE_MS) gqFinishActive(game, "১ মিনিট কোনো চাল দেননি");
    }
    if (!st.active && st.queue.length) {
      const next = st.queue.shift();
      next.startedAt = Date.now();
      next.finished = false;
      next.acknowledged = false;
      st.active = next;
      console.log(`[${game}-queue] এখন খেলছেন: ${next.name} (লাইনে বাকি ${st.queue.length} জন)`);
      gqStartRinging(game, next);
      gqNotifyPositions(game);
    }
  });
}
setInterval(gqTick, 2000);

// ===========================================================================
// সার্ভারকে জাগিয়ে রাখা
// ---------------------------------------------------------------------------
// Render-এর ফ্রি প্ল্যানে ১৫ মিনিট কোনো ভিজিটর না এলে সার্ভার ঘুমিয়ে পড়ে। তখন পরের
// দর্শক লিংকে ঢুকলে ৫০+ সেকেন্ড "Waking up the server…" দেখে, অনেকে অতক্ষণ অপেক্ষা না
// করে চলে যায় — চ্যালেঞ্জই নেওয়া হয় না।
//
// স্ট্রিম চলার সময় overlay নিজেই বারবার সার্ভারে আসে, তাই সমস্যা হয় না। কিন্তু স্ট্রিম
// বন্ধ থাকলে (বা OBS আলাদা মেশিনে থাকলে) কেউ আসে না। তাই প্রতি ১২ মিনিটে সার্ভার
// নিজের public URL-এ একটা ছোট্ট request পাঠায় — Render সেটাকে আসল ভিজিটর হিসেবেই গোনে।
const KEEPALIVE_URL = process.env.PUBLIC_BASE_URL || "";
if (KEEPALIVE_URL) {
  setInterval(() => {
    fetch(KEEPALIVE_URL.replace(/\/+$/, "") + "/gaming/health")
      .catch(() => {}); // ব্যর্থ হলেও কিছু যায় আসে না, পরেরবার আবার চেষ্টা হবে
  }, 12 * 60 * 1000);
  console.log("💤 keep-alive চালু — প্রতি ১২ মিনিটে সার্ভার নিজেকে জাগিয়ে রাখবে");
}

async function runChessLoop() {
  if (chessLoopActive) return;
  chessLoopActive = true;
  let Chess;
  try {
    ({ Chess } = require("chess.js"));
  } catch (e) {
    console.error("chess.js ইনস্টল নেই — package.json এ যোগ করুন। চেস loop থামানো হলো।");
    chessLoopActive = false;
    return;
  }

  while (chessLoopActive) {
    if (challengeQueue.length > 0) {
      await playChallengeGame(Chess).catch((e) => console.error("challenge game error:", e.message));
    } else {
      await playOneChessGame(Chess).catch((e) => console.error("chess game error:", e.message));
    }
    await sleep(8000);
  }
}
function stopChessLoop() {
  chessLoopActive = false;
}

// লাইনে থাকা প্রথম দর্শকের সাথে একটা "চ্যালেঞ্জ ম্যাচ" — মানুষ কালো ঘুঁটি খেলে, Nur/ইঞ্জিন সাদা
async function playChallengeGame(Chess) {
  const challenger = challengeQueue.shift();
  notifyQueuePositions(); // বাকিদের নাম্বার এক ঘর করে কমে গেল, সবাইকে জানিয়ে দিন
  const chess = new Chess();
  activeChallenge = { id: challenger.id, name: challenger.name, photoUrl: challenger.photoUrl, chess, lastHumanMoveAt: 0 };
  // এখন তার পালা — মোবাইলে notification পাঠান, ট্যাপ করলেই সরাসরি play পেজ খুলবে
  sendPushToId(challenger.id, {
    title: "🎉 আপনার পালা এসে গেছে!",
    body: `${challenger.name}, খেলা শুরু হয়ে গেছে — এখনই ট্যাপ করে চাল দিন!`,
    tag: "your-turn",
    requireInteraction: true,
    url: "/gaming/challenge/play?id=" + challenger.id,
  });

  const engine = spawnStockfish(14); // মাঝারি strength, যাতে মানুষের সাথে fair fight হয়
  const capturedByWhite = [];
  const capturedByBlack = [];
  const boardTheme = randomBoardTheme(); // প্রতি ম্যাচে র‍্যান্ডম থিম
  // ⏱️ দাবার real clock — ১০ মিনিট করে দুই পক্ষের জন্য, বিশ্বব্যাপী chess.com/lichess-এ প্রচলিত
  // স্ট্যান্ডার্ড format (একটা নির্দিষ্ট চাল-সংখ্যার সীমার চেয়ে সময়-ভিত্তিক ক্লকই বেশি প্রফেশনাল/গ্রহণযোগ্য) —
  // যার ক্লক শূন্য হয়ে যাবে, সে টাইম-আউটে হেরে যাবে, খেলা শেষ, লাইন এগিয়ে যাবে
  const CLOCK_MS = 10 * 60 * 1000;
  let whiteMs = CLOCK_MS, blackMs = CLOCK_MS;
  let timedOutSide = null; // 'w' | 'b' | null
  const state = {
    mode: "challenge",
    openingName: "🔴 LIVE CHALLENGE",
    fen: chess.fen(),
    moves: [],
    status: "playing",
    whiteName: YOUR_DISPLAY_NAME,
    whiteAvatarUrl: YOUR_AVATAR_URL,
    blackName: challenger.name,
    blackAvatarUrl: challenger.photoUrl || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(challenger.name)}`,
    blackTipAmount: challenger.tipAmount || 0,
    queue: getQueuePublicState(),
    candidates: [],
    chosenMove: null,
    lastMove: null,
    capturedByWhite,
    capturedByBlack,
    boardTheme,
    whiteMs, blackMs, clockMax: CLOCK_MS,
  };
  writeState("chess", state);

  let moveCount = 0;
  while (!chess.isGameOver() && moveCount < 300 && chessLoopActive && whiteMs > 0 && blackMs > 0) {
    const turnStart = Date.now();
    if (chess.turn() === "w") {
      const thinkTimeMs = 1200 + Math.floor(Math.random() * 1200);
      const { bestmove, candidates } = await getCandidateMoves(engine, chess.fen(), thinkTimeMs);
      whiteMs = Math.max(0, whiteMs - (Date.now() - turnStart));
      if (!bestmove) break;
      if (whiteMs <= 0) { timedOutSide = "w"; break; } // সাদার ক্লক এই চালেই শেষ হয়ে গেল
      const mv = chess.move(bestmove, { sloppy: true });
      if (!mv) break;
      state.lastMove = { from: mv.from, to: mv.to };
      if (mv.captured) capturedByWhite.push(mv.captured);
      const bestCp = candidates && candidates[0] ? candidates[0].cp : 0; // সাদার turn ছিল, তাই sign উল্টানোর দরকার নেই
      state.whiteWinPct = Math.round(100 / (1 + Math.pow(10, -Math.max(-1000, Math.min(1000, bestCp)) / 400)));
    } else {
      const beforeFen = chess.fen();
      const turnDeadline = turnStart + blackMs; // মানুষের নিজের বাকি ক্লক-টাইমই এখানে deadline
      let lastTickWrite = 0;
      while (Date.now() < turnDeadline && chess.fen() === beforeFen && chessLoopActive) {
        await sleep(400);
        const elapsed = Date.now() - turnStart;
        state.blackMs = Math.max(0, blackMs - elapsed);
        // প্রতি ~সেকেন্ডে একবার state লেখা যথেষ্ট — প্রতি 400ms-এ লিখলে অপ্রয়োজনীয় I/O বাড়বে
        if (Date.now() - lastTickWrite > 900) { writeState("chess", state); if (activeChallenge) activeChallenge.blackMs = state.blackMs; lastTickWrite = Date.now(); }
      }
      if (chess.fen() === beforeFen) {
        // ⏱️ ক্লক শেষ — এখন আর random চাল অটো-খেলে দেওয়া হয় না, বরং টাইম-আউটে সরাসরি হার,
        // খেলা শেষ, লাইনে পরের জনের পালা আসবে
        blackMs = 0;
        timedOutSide = "b";
        break;
      } else {
        blackMs = Math.max(0, blackMs - (Date.now() - turnStart));
        const lastHist = chess.history({ verbose: true }).slice(-1)[0];
        if (lastHist) {
          state.lastMove = { from: lastHist.from, to: lastHist.to };
          if (lastHist.captured) capturedByBlack.push(lastHist.captured);
        }
      }
    }
    moveCount++;
    state.fen = chess.fen();
    state.moves = chess.history();
    state.capturedByWhite = capturedByWhite;
    state.capturedByBlack = capturedByBlack;
    state.queue = getQueuePublicState();
    state.whiteMs = whiteMs; state.blackMs = blackMs;
    if (activeChallenge) { activeChallenge.lastMove = state.lastMove; activeChallenge.whiteMs = whiteMs; activeChallenge.blackMs = blackMs; } // play পেজে move animation + ক্লক দেখানোর জন্য দরকার
    writeState("chess", state);
    await sleep(1700); // অ্যানিমেশন (~1.1s) সম্পূর্ণ শেষ হওয়া পর্যন্ত সময় দেওয়া, নাহলে পরের চাল মাঝপথে এসে animation কেটে দিতে পারে
  }

  engine.proc.kill();
  let winnerName;
  if (timedOutSide === "w") winnerName = challenger.name; // সাদার (Nur) ক্লক শেষ — challenger জিতল
  else if (timedOutSide === "b") winnerName = YOUR_DISPLAY_NAME; // challenger-এর ক্লক শেষ — Nur জিতল
  else winnerName = chess.isCheckmate() ? (chess.turn() === "w" ? challenger.name : YOUR_DISPLAY_NAME) : null;
  state.status = "finished";
  state.result = winnerName
    ? (timedOutSide ? `Time out — ${winnerName} wins` : `Checkmate — ${winnerName} wins`)
    : "Draw";
  state.lastCommentaryBn = winnerName
    ? (timedOutSide
        ? `⏱️ সময় শেষ! ${winnerName} এই চ্যালেঞ্জ ম্যাচে জিতে গেল — প্রতিপক্ষের ক্লক ফুরিয়ে গিয়েছিল।`
        : `🎉 ${winnerName} এই চ্যালেঞ্জ ম্যাচে ${YOUR_DISPLAY_NAME}-কে হারিয়ে দিল! দারুণ খেলা।`)
    : `চ্যালেঞ্জ ম্যাচ ড্র হলো — ${challenger.name} বনাম ${YOUR_DISPLAY_NAME}। ভালো লড়াই হয়েছে।`;
  writeState("chess", state);

  try {
    const audio = await textToSpeech(state.lastCommentaryBn);
    state.audioPlaylist = [audio];
    writeState("chess", state);
  } catch (e) {
    console.error("challenge TTS সমস্যা:", e.message);
  }

  activeChallenge = null;
}

// Stockfish বাইনারি কোথায় আছে সেটা খুঁজে বের করা — priority অনুযায়ী:
// ১) STOCKFISH_PATH env var (সবচেয়ে নির্ভরযোগ্য, ম্যানুয়ালি সেট করা)
// ২) Windows-এ এই ফাইলের পাশে রাখা stockfish.exe
// ৩) Linux hosting-এ (Render ইত্যাদি) Build Command দিয়ে ডাউনলোড করা ./stockfish-bin —
//    এটা থাকলে env var সেট করতে ভুলে গেলেও কাজ চলবে
// ৪) শেষ ভরসা: সিস্টেম PATH-এ globally ইনস্টল করা "stockfish" (apt install stockfish ইত্যাদি)
function resolveStockfishBinary() {
  if (process.env.STOCKFISH_PATH) return process.env.STOCKFISH_PATH;
  if (process.platform === "win32") return path.join(__dirname, "stockfish.exe");
  const bundled = path.join(__dirname, "stockfish-bin");
  if (fs.existsSync(bundled)) return bundled;
  return "stockfish";
}
function spawnStockfish(skillLevel) {
  const bin = resolveStockfishBinary();
  const engine = spawn(bin);
  engine.on("error", (err) => {
    console.error("❌ Stockfish চালু করা যায়নি:", err.message, "| ব্যবহৃত path:", bin);
  });
  engine.on("exit", (code, signal) => {
    // প্রসেসটা মাঝপথে হঠাৎ বন্ধ হয়ে গেলে (crash/OOM kill ইত্যাদি) এখানে ধরা পড়বে —
    // getCandidateMoves-এর ৬ সেকেন্ড টাইমআউট এমনিতেই বোর্ড আটকে থাকা আটকাবে,
    // কিন্তু এই লগ থাকলে আসল কারণটা (কেন Stockfish মারা গেল) পরে বোঝা সহজ হবে
    if (code !== 0 && code !== null) console.error(`⚠️ Stockfish প্রসেস বন্ধ হয়ে গেছে (exit code ${code}, signal ${signal})`);
  });
  const send = (cmd) => engine.stdin.write(cmd + "\n");
  send("uci");
  send(`setoption name Skill Level value ${skillLevel}`);
  send("setoption name MultiPV value 3"); // top ৩টা candidate move বের করার জন্য — দর্শকদের প্রেডিকশনের জন্য দরকার
  // 512MB RAM-এর free-tier hosting-এ (Render ইত্যাদি) OOM (out-of-memory) এড়াতে
  // hash table আর thread সংখ্যা যতটা সম্ভব ছোট রাখা হচ্ছে — কোয়ালিটি সামান্য কমবে,
  // কিন্তু casual entertainment-স্তরের খেলার জন্য এটা যথেষ্ট, আর crash হওয়ার চেয়ে ঢের ভালো
  send("setoption name Threads value 1");
  send("setoption name Hash value 8");
  return { proc: engine, send };
}

// শুধু বেস্ট মুভ না, top ৩টা candidate move (UCI ফরম্যাটে, যেমন "e2e4") ফেরত দেয় —
// দর্শকদের আগে prediction দেখানো, পরে সবচেয়ে ভালোটা highlight করার জন্য এটা দরকার।
// ⏱️ TIMEOUT SAFETY NET: Stockfish প্রসেস কোনো কারণে হ্যাং/ক্র্যাশ করলে (যেমন
// low-memory hosting-এ মাঝেমধ্যে হয়) আগে এই Promise কখনো resolve না হয়ে পুরো
// game loop-টাই চিরদিনের জন্য আটকে যেত — বোর্ড এক জায়গায় স্থির হয়ে থাকতো, নতুন
// কোনো চাল আর কখনো আসতো না। এখন movetime-এর কয়েক সেকেন্ড পরও reply না এলে
// resolve({bestmove:null}) দিয়ে দেওয়া হয়, যাতে বাইরের লুপ সেটা ধরে পরের গেম শুরু
// করে দিতে পারে — সিস্টেম নিজে থেকেই সেরে ওঠে (self-heals), স্থায়ীভাবে আটকে থাকে না।
function getCandidateMoves(engine, fen, movetimeMs = 1200) {
  return new Promise((resolve) => {
    const candidates = {}; // multipv index -> {uci, cp}
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      engine.proc.stdout.off("data", onData);
      resolve(result);
    };
    const timeoutHandle = setTimeout(() => {
      console.error("⚠️ Stockfish " + movetimeMs + "ms + বাফার সময়েও reply দেয়নি — এই চালটা বাদ দিয়ে (bestmove:null) এগিয়ে যাচ্ছি, যাতে বোর্ড চিরস্থায়ীভাবে আটকে না থাকে।");
      finish({ bestmove: null, candidates: [] });
    }, movetimeMs + 6000);
    const onData = (d) => {
      const text = d.toString();
      for (const line of text.split("\n")) {
        const mpvMatch = line.match(/multipv (\d+)/);
        const pvMatch = line.match(/ pv (\S+)/);
        if (mpvMatch && pvMatch) {
          const idx = parseInt(mpvMatch[1], 10);
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          candidates[idx] = {
            uci: pvMatch[1],
            cp: mateMatch ? (parseInt(mateMatch[1], 10) > 0 ? 100000 : -100000) : cpMatch ? parseInt(cpMatch[1], 10) : 0,
          };
        }
      }
      const bmMatch = text.match(/bestmove\s+(\S+)/);
      if (bmMatch) {
        const list = Object.keys(candidates)
          .sort((a, b) => a - b)
          .map((k) => candidates[k]);
        finish({ bestmove: bmMatch[1] === "(none)" ? null : bmMatch[1], candidates: list.slice(0, 3) });
      }
    };
    engine.proc.stdout.on("data", onData);
    engine.send(`position fen ${fen}`);
    engine.send(`go movetime ${movetimeMs}`);
  });
}
function uciToSquares(uci) {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

const OPPONENT_NAME_POOL = ["Kabir", "Rakesh", "Meera", "Tanvir", "Alina", "Rafiq", "Sudip", "Priya", "Farhan", "Nadia"];
const YOUR_DISPLAY_NAME = process.env.CHESS_YOUR_NAME || "Grandmaster"; // ডিফল্ট এখন সরাসরি কোডেই বদলে দেওয়া হলো (env var লাগবে না)
const YOUR_AVATAR_URL = process.env.CHESS_YOUR_AVATAR_URL || ""; // চাইলে নিজের ছবির লিংক .env-এ CHESS_YOUR_AVATAR_URL হিসেবে বসান

async function playOneChessGame(Chess) {
  const chess = new Chess();
  const opening = OPENING_BOOK[Math.floor(Math.random() * OPENING_BOOK.length)];
  opening.moves.forEach((m) => chess.move(m));
  const boardTheme = randomBoardTheme(); // প্রতি ম্যাচে র‍্যান্ডম থিম

  const skillOptions = [12, 15, 18, 20];
  // আগে দুটো আলাদা Stockfish process (সাদা+কালোর জন্য) একসাথে চলতো — 512MB RAM-এর
  // free-tier hosting-এ এটাই মূল কারণ ছিল OOM crash হওয়ার। এখন মাত্র ONE process
  // ব্যবহার হচ্ছে, প্রতি চালের আগে শুধু skill level বদলে দেওয়া হয় (UCI নিজেই এটা সাপোর্ট করে) —
  // মেমরি প্রায় অর্ধেক লাগে, খেলার মানেও কোনো পার্থক্য পড়ে না
  const whiteSkill = skillOptions[Math.floor(Math.random() * skillOptions.length)];
  const blackSkill = skillOptions[Math.floor(Math.random() * skillOptions.length)];
  const engineProc = spawnStockfish(whiteSkill);

  const opponentName = OPPONENT_NAME_POOL[Math.floor(Math.random() * OPPONENT_NAME_POOL.length)];
  // DiceBear (ফ্রি, ওপেন-সোর্স avatar generator, real মানুষের ছবি না — তাই কপিরাইট-নিরাপদ)
  // প্রতিটা opponent নামের জন্য automatically একটা ভিন্ন, ইউনিক কার্টুন-স্টাইল অ্যাভাটার বানায়
  const opponentAvatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(opponentName)}&backgroundColor=b6e3f4,c0aede,ffd5dc,ffdfbf`;
  const capturedByWhite = []; // সাদা যেসব কালো ঘুঁটি মেরেছে
  const capturedByBlack = []; // কালো যেসব সাদা ঘুঁটি মেরেছে

  const state = {
    openingName: opening.name,
    moves: chess.history(),
    fen: chess.fen(),
    status: "playing",
    whiteName: YOUR_DISPLAY_NAME,
    whiteAvatarUrl: YOUR_AVATAR_URL,
    blackName: opponentName,
    blackAvatarUrl: opponentAvatarUrl,
    queue: getQueuePublicState(),
    candidates: [],
    chosenMove: null,
    lastMove: null,
    capturedByWhite,
    capturedByBlack,
    boardTheme,
  };
  writeState("chess", state);

  let moveCount = 0;
  const MAX_MOVES = 140;
  while (!chess.isGameOver() && moveCount < MAX_MOVES && chessLoopActive) {
    const isWhiteTurn = chess.turn() === "w";
    engineProc.send(`setoption name Skill Level value ${isWhiteTurn ? whiteSkill : blackSkill}`); // একই process, শুধু পালা বদলালে skill level বদলে দেওয়া

    // "ভাবার সময়" মানুষের মতো এলোমেলো — কখনো তাড়াতাড়ি সহজ চাল, কখনো ধীরে জটিল চাল ভাবছে এমন অনুভূতি
    const thinkTimeMs = 1000 + Math.floor(Math.random() * 1600); // 1.0s–2.6s
    const { bestmove, candidates } = await getCandidateMoves(engineProc, chess.fen(), thinkTimeMs);
    if (!bestmove) break;

    // ধাপ ১ — সম্ভাব্য candidate move গুলো বোর্ডে হালকা করে দেখানো, দর্শককে "প্রেডিক্ট" করার সময় দেওয়া
    state.candidates = candidates.map((c) => uciToSquares(c.uci)).filter(Boolean);
    state.chosenMove = null;
    // এই মুহূর্তে খেলাটা বন্ধ করে দিলে technically কে কতটা এগিয়ে — এভাবে হিসাব করা:
    // Stockfish-এর cp score সবসময় "যার চাল, তার দৃষ্টিকোণ" থেকে আসে, তাই সাদার
    // দৃষ্টিকোণে আনতে কালোর turn হলে sign উল্টে দেওয়া হচ্ছে, তারপর একটা standard
    // sigmoid formula দিয়ে win-probability % বের করা হচ্ছে (±১০০০ সেন্টিপন-এর বেশি
    // হলে ক্ল্যাম্প করা, নাহলে মেট স্কোরে বার একদম ০%/১০০% এ আটকে যেত)
    const bestCp = candidates[0] ? candidates[0].cp : 0;
    const whiteCp = Math.max(-1000, Math.min(1000, isWhiteTurn ? bestCp : -bestCp));
    state.whiteWinPct = Math.round(100 / (1 + Math.pow(10, -whiteCp / 400)));
    writeState("chess", state);
    if (!chessLoopActive) break;
    await new Promise((r) => setTimeout(r, 3200)); // দর্শকের ভাবার সময়

    // ধাপ ২ — সবচেয়ে ভালো (bestmove) চালটা highlight করা, চাল খেলার আগেই
    const chosen = uciToSquares(bestmove);
    state.chosenMove = chosen;
    writeState("chess", state);
    if (!chessLoopActive) break;
    await new Promise((r) => setTimeout(r, 1800)); // "কেন এটাই ভালো" বোঝার সময়

    // ধাপ ৩ — আসল চাল খেলা
    const targetPieceBefore = chess.get(chosen.to); // capture হচ্ছে কিনা বোঝার জন্য, চালের আগে
    const moveObj = chess.move(bestmove, { sloppy: true });
    if (!moveObj) break;
    moveCount++;

    if (moveObj.captured) {
      const capturedPiece = moveObj.captured; // p,n,b,r,q ইত্যাদি (chess.js lowercase দেয়)
      if (isWhiteTurn) capturedByWhite.push(capturedPiece);
      else capturedByBlack.push(capturedPiece);
    }

    state.moves = chess.history();
    state.fen = chess.fen();
    state.lastMove = { from: moveObj.from, to: moveObj.to };
    state.candidates = [];
    state.chosenMove = null;
    state.capturedByWhite = capturedByWhite;
    state.capturedByBlack = capturedByBlack;
    state.queue = getQueuePublicState(); // ম্যাচ চলাকালীন কেউ নতুন লাইনে দাঁড়ালে সাথে সাথেই overlay-তে দেখাবে
    writeState("chess", state);

    await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1500))); // 1.5s–3s, পরের চাল শুরুর আগে সাধারণ বিরতি
  }

  engineProc.proc.kill();

  const winnerName = chess.isCheckmate() ? (chess.turn() === "w" ? state.blackName : state.whiteName) : null;
  const resultText = winnerName ? `Checkmate — ${winnerName} wins` : chess.isDraw() ? "Draw" : "Game stopped";
  const commentary = winnerName
    ? `🎉 ${winnerName} জিতে গেল! দারুণ খেলা দেখাল। (ওপেনিং: ${opening.name})`
    : `শেষমেশ ${resultText} — ${state.whiteName} ও ${state.blackName} সমান লড়াই করেছে। (ওপেনিং: ${opening.name})`;

  state.status = "finished";
  state.result = resultText;
  state.lastCommentaryBn = commentary;
  writeState("chess", state);

  try {
    const audio1 = await textToSpeech(commentary);
    const audio2 = await textToSpeech(RULES_TEXT_BN);
    state.audioPlaylist = [audio1, audio2];
    writeState("chess", state);
  } catch (e) {
    console.error("TTS সমস্যা (edge-tts ইনস্টল আছে কিনা চেক করুন):", e.message);
  }
}

// ---------------------------------------------------------------------------
// ৬. Overlay HTML — ইনলাইন টেমপ্লেট (আলাদা .html ফাইল লাগে না)
// ---------------------------------------------------------------------------
const CHESS_OVERLAY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Chess</title>
<style>
*{box-sizing:border-box;}
body{margin:0;background:linear-gradient(160deg,#0a0e1f 0%,#12081f 60%,#0a0e1f 100%);color:#F5F7FA;font-family:'Segoe UI',sans-serif;
padding:16px 20px;height:100vh;overflow:hidden;}
h1{text-align:center;margin:0 0 12px;font-size:24px;letter-spacing:0.5px;font-weight:800;
color:#FFD866;text-shadow:0 2px 12px rgba(255,216,102,0.35);}
.layout{display:grid;grid-template-columns:1.5fr 3fr 0.95fr 1.05fr;gap:12px;align-items:stretch;width:100%;max-width:100%;margin:0 auto;height:calc(100vh - 66px);}
.topSupCol{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;}
.sideCol{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;}
.rulesBox{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:14px 18px;
box-shadow:0 10px 24px rgba(0,0,0,0.5);font-family:'Segoe UI',sans-serif;overflow-y:auto;flex:1.4;min-height:0;}
/* "How Pieces Move" / সাম্প্রতিক সাপোর্টার — কখনোই স্ক্রলবার না লাগুক, তাই overflow বন্ধ, আর সাইজ
   একটু বড় করে ফিরিয়ে আনা হলো (আগে বেশি ছোট হয়ে গিয়েছিল) */
#leftAltPanel .altView{display:none;flex-direction:column;height:100%;overflow:hidden;}
#leftAltPanel .altView.show{display:flex;}
#rulesList{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;}
.rulesBox h3{margin:0 0 8px;font-size:14px;color:#FFD866;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;flex-shrink:0;}
.ruleRow{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #202a44;}
.ruleRow:last-child{border-bottom:none;}
.ruleGlyph{font-size:27px;width:32px;text-align:center;flex-shrink:0;filter:drop-shadow(0 0 6px rgba(255,216,102,0.5));}
.ruleGlyph.hi{animation:glow 1.4s ease-in-out infinite;}
@keyframes glow{0%,100%{filter:drop-shadow(0 0 6px rgba(255,216,102,0.4));}50%{filter:drop-shadow(0 0 14px rgba(255,216,102,1));}}
.ruleText{font-size:13px;color:#B8C4D9;line-height:1.35;}
.ruleText b{color:#fff;}
.playerCard{background:#161b2e;border:1px solid #2a3352;border-radius:16px;padding:14px;
box-shadow:0 10px 24px rgba(0,0,0,0.55);text-align:center;}
.playerCard.active{border-color:#FFD866;box-shadow:0 0 0 2px #FFD866, 0 10px 30px rgba(255,216,102,0.3);}
/* সাদা/Nur-এর কার্ড — আরো বড় করা হলো */
.playerCard.compact{padding:20px 14px;flex:0 0 auto;}
.playerCard.compact .avatar{width:68px;height:68px;font-size:28px;margin-bottom:8px;}
.playerCard.compact .pName{font-size:19px;}
.playerCard.compact .pLabel{font-size:11px;}
.playerCard.compact .captured{margin-top:8px;min-height:20px;font-size:17px;}
.avatar{width:88px;height:88px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;
font-size:36px;font-weight:800;color:#0a0e1f;background:#4FC3F7;border:4px solid #2a3352;overflow:hidden;}
.avatar.black{background:#B0BEC5;}
.avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
.pName{font-size:16px;font-weight:700;color:#fff;}
.pLabel{font-size:10px;color:#7C8AAD;margin-top:2px;text-transform:uppercase;letter-spacing:1px;}
.captured{margin-top:10px;min-height:26px;font-size:18px;letter-spacing:2px;color:#FFD866;opacity:0.9;}
/* দাবার ক্লক — ১০ মিনিট, চলমান turn-এর পক্ষটার ক্লক হাইলাইট থাকে, ১ মিনিটের নিচে লাল হয়ে সতর্ক করে */
.clockDisplay{margin-top:6px;font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;
color:#7C8AAD;background:#0f1526;border-radius:8px;padding:4px 10px;display:inline-block;}
.clockDisplay.active{color:#0a0e1f;background:#FFD866;}
.clockDisplay.low{color:#fff;background:#E8443D;animation:pulse 1s ease-in-out infinite;}
/* প্রতিপক্ষ/challenger-এর বড় কার্ড — ছবিটাই এখানে মূল ফোকাস, নিচে অল্প জায়গায় নাম+টিপস */
.playerCard.big{padding:0;overflow:hidden;flex:0 0 40%;display:flex;flex-direction:column;min-height:0;}
.playerCard.big.small{flex:0 0 32%;} /* এবার একটু ছোট — নিচের queue বক্সকে বেশি জায়গা দিতে */
.bigPhotoWrap{flex:8.5;background:#0a0e1f;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;}
.bigPhotoWrap img{width:100%;height:100%;object-fit:contain;}
.bigPhotoWrap .avatarFallbackBig{width:70%;height:70%;border-radius:50%;background:#B0BEC5;color:#0a0e1f;
display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:800;}
.bigInfoFooter{flex:1.5;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:#12172a;border-top:1px solid #2a3352;padding:4px 8px;}
.bigInfoFooter .pName{font-size:17px;}
.bigInfoFooter .pLabel{font-size:9px;}
.bigInfoFooter .tipLine{color:#FFD866;font-size:12px;font-weight:700;margin-top:2px;min-height:15px;}
/* চ্যালেঞ্জ queue বক্স (ডান কলাম) — ফিক্সড, বাকি সব জায়গা নেয়, প্লেইন (আর অল্টারনেট করে না) */
#queuePanelFixed{flex:1;min-height:0;}
/* গুটির নিয়ম ↔ সাম্প্রতিক সাপোর্টার অল্টারনেটিং প্যানেল (বাম কলাম, নিচে) */
#leftAltPanel{flex:1;display:flex;flex-direction:column;min-height:0;}
#leftAltPanel .rulesBox{flex:1;position:relative;}
#leftAltPanel .altView{display:none;}
#leftAltPanel .altView.show{display:block;}
/* টপ ৩ সাপোর্টার — ৩টা স্ট্যাক করা প্যানেল, প্রতিটাতে ৯০% ছবি + ১০% নাম/অ্যামাউন্ট, কোনো বাড়তি ফাঁকা জায়গা নেই */
.topSupporterPanel{flex:1;display:flex;flex-direction:column;min-height:0;background:#161b2e;
border:1px solid #2a3352;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(0,0,0,0.5);}
.tsPhoto{flex:9;background:#0a0e1f;display:flex;align-items:center;justify-content:center;overflow:hidden;
position:relative;min-height:0;background-size:cover;background-position:center;}
.tsRank{position:absolute;top:6px;left:6px;width:26px;height:26px;border-radius:50%;background:#FFD866;
color:#0a0e1f;font-weight:900;font-size:13px;display:flex;align-items:center;justify-content:center;
box-shadow:0 2px 8px rgba(0,0,0,0.5);z-index:2;}
.tsPhoto img{width:100%;height:100%;object-fit:cover;}
.tsPhoto .tsFallback{width:60%;height:60%;border-radius:50%;background:#4FC3F7;color:#0a0e1f;font-weight:900;
font-size:34px;display:flex;align-items:center;justify-content:center;}
.tsInfo{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#12172a;
border-top:1px solid #2a3352;font-size:12px;font-weight:700;color:#fff;padding:2px 6px;text-align:center;}
.tsInfo .tsAmt{color:#FFD866;}
.centerCol{display:flex;flex-direction:column;align-items:center;height:100%;min-height:0;width:100%;}
#opening{color:#7C8AAD;font-size:15px;margin-bottom:8px;font-weight:600;}
/* বোর্ডটা এখন fluid — সেন্টার কলামের যতটা জায়গা আছে (৭০%-এর কাছাকাছি) তার সাথেই স্কেল হয়,
   fixed pixel-এ আটকে থেকে চারপাশে ফাঁকা জায়গা রাখে না। max-width শুধু অতিরিক্ত ওয়াইড মনিটরে
   বোর্ডটা অস্বাভাবিক বড় হয়ে যাওয়া আটকাতে */
#boardWrap{position:relative;width:min(98%, calc((100vh - 260px) * 1));max-width:960px;aspect-ratio:1;flex-shrink:1;}
#board{display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);
width:100%;height:100%;border:10px solid;border-image:var(--board-border) 1;border-radius:8px;
box-shadow:0 20px 46px rgba(0,0,0,0.75), inset 0 0 0 2px rgba(0,0,0,0.5);}
#arrowLayer{position:absolute;top:10px;left:10px;width:calc(100% - 20px);height:calc(100% - 20px);pointer-events:none;}
.sq{display:flex;align-items:center;justify-content:center;font-size:clamp(28px,5.2vw,64px);user-select:none;position:relative;}
/* বোর্ডের রঙ CSS variable দিয়ে — প্রতি নতুন ম্যাচে server থেকে আলাদা থিম আসবে, ক্লাসিক লুক ঠিক রেখেই রঙ বদলাবে */
:root{--sq-light:#EFE0BF;--sq-dark:#5C3A21;--pc-w1:#ffffff;--pc-w2:#d4cbb8;--pc-b1:#3a3a3a;--pc-b2:#000000;--board-border:linear-gradient(135deg,#B8874A,#3E2712);}
.light{background:var(--sq-light);}
.dark{background:var(--sq-dark);}
.sq.lastFrom{box-shadow:inset 0 0 0 4px rgba(76,217,100,0.85);}
.sq.lastTo{box-shadow:inset 0 0 0 4px #FFD866;}
.piece{display:inline-block;position:relative;transform:translateY(-2px);}
.piece-w{background:linear-gradient(160deg,var(--pc-w1) 0%,#f0ede4 40%,var(--pc-w2) 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 2px 0 #6b6252) drop-shadow(0 6px 5px rgba(0,0,0,0.6));}
.piece-b{background:linear-gradient(160deg,var(--pc-b1) 0%,#181818 45%,var(--pc-b2) 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 2px 0 #000) drop-shadow(0 6px 5px rgba(0,0,0,0.7));}
#thinking{color:#7C8AAD;font-size:13px;margin-top:10px;min-height:16px;}
#thinking.active{animation:pulse 1.2s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:0.35;}50%{opacity:1;}}
#predictLabel{color:#FFD866;font-size:16px;min-height:20px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;}
#moveCount{color:#7C8AAD;font-size:12px;margin-top:6px;}
#commentary{margin-top:10px;font-size:16px;color:#FFD866;max-width:90%;text-align:center;min-height:20px;font-weight:600;}
/* "এই মুহূর্তে থামলে কে কতটা এগিয়ে" — দুই পক্ষের জন্য দুটো আলাদা, স্পষ্ট বৈসাদৃশ্যপূর্ণ রঙ,
   ঠিক দুই রঙের জোড়া লাগার জায়গাতেই (fixed মাঝখানে না) একটা উজ্জ্বল ব্যাজে win% লেখা,
   আর দুই প্রান্তে যে খেলছে তার নাম (প্রতি ম্যাচে বদলায়) — আগে অনেক পাতলা ও ছোট ছিল, এখন চওড়া+মোটা */
#evalBarWrap{width:min(97%,900px);margin-top:16px;display:none;}
#evalNames{display:flex;justify-content:space-between;font-size:13px;color:#B8C4D9;font-weight:700;margin-bottom:6px;padding:0 4px;}
#evalBarTrack{position:relative;display:flex;height:30px;border-radius:15px;overflow:visible;box-shadow:0 4px 12px rgba(0,0,0,0.5);}
#evalBarWhite{background:linear-gradient(90deg,#c99a3f,#FFD866);transition:flex-basis 1s ease;border-radius:15px 0 0 15px;}
#evalBarBlack{background:linear-gradient(90deg,#7C4DFF,#5A32D6);transition:flex-basis 1s ease;border-radius:0 15px 15px 0;}
#evalBarBadge{position:absolute;top:50%;transform:translate(-50%,-50%);transition:left 1s ease;width:44px;height:44px;
border-radius:50%;background:#fff;border:3px solid #0a0e1f;display:flex;align-items:center;justify-content:center;
font-size:11px;font-weight:900;color:#0a0e1f;box-shadow:0 3px 12px rgba(0,0,0,0.7),0 0 0 3px rgba(255,255,255,0.25);z-index:2;text-align:center;line-height:1;}
.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;
font-size:76px;font-weight:900;opacity:0;pointer-events:none;text-align:center;padding:20px;background:rgba(0,0,0,0.45);z-index:60;}
.flash.show{animation:pop 3.2s ease-out forwards;}
.flash .confetti{font-size:36px;}
@keyframes pop{0%{opacity:0;transform:scale(0.5) rotate(-5deg);}12%{opacity:1;transform:scale(1.1) rotate(1deg);}
25%{transform:scale(1) rotate(0);}85%{opacity:1;}100%{opacity:0;}}
/* আসল উড়ন্ত কনফেটি — জয়ের সময় flash-এর সাথে একসাথে চলবে */
.confettiPiece{position:fixed;top:-20px;width:10px;height:16px;z-index:59;pointer-events:none;
animation:confettiFall linear forwards;}
@keyframes confettiFall{0%{transform:translateY(0) rotate(0deg);opacity:1;}100%{transform:translateY(108vh) rotate(720deg);opacity:0.9;}}

/* Fan Battle Live-স্টাইল ডোনার সেলিব্রেশন — ছবি (থাকলে) বড় করে, নাম+অ্যামাউন্ট, পপ-আপ হয়ে ফেড হয়ে যায় */
.donorCeleb{position:fixed;inset:0;z-index:65;display:flex;align-items:center;justify-content:center;
pointer-events:none;opacity:0;}
.donorCeleb.show{animation:donorCelebFade 4.5s ease forwards;}
@keyframes donorCelebFade{0%{opacity:0;}8%{opacity:1;}82%{opacity:1;}100%{opacity:0;}}
.donorCelebCard{background:#161b2e;border:2px solid #FFD866;border-radius:22px;padding:26px 40px;text-align:center;
box-shadow:0 0 60px rgba(255,216,102,0.5),0 20px 50px rgba(0,0,0,0.7);transform:scale(0.7);}
.donorCeleb.show .donorCelebCard{animation:donorCelebPop 4.5s cubic-bezier(.2,1.4,.3,1) forwards;}
@keyframes donorCelebPop{0%{transform:scale(0.6);}12%{transform:scale(1.08);}20%{transform:scale(1);}100%{transform:scale(1);}}
.donorCelebTag{color:#FFD866;font-size:13px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;}
#donorCelebPhotoWrap{width:110px;height:110px;border-radius:20px;overflow:hidden;margin:0 auto 12px;
border:3px solid #FFD866;box-shadow:0 0 24px rgba(255,216,102,0.6);}
#donorCelebPhotoWrap img{width:100%;height:100%;object-fit:cover;}
.donorCelebName{font-size:32px;font-weight:900;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.6);}
.donorCelebAmount{font-size:26px;font-weight:800;color:#FFD866;margin-top:6px;}

/* সরাসরি টিপস QR — মূল layout-এর ভেতরেই, বাম কলামে নিয়মের বক্সের নিচে */
#tipBoxOverlay{flex:0 0 42%;min-height:0;}
#tipQrWrap{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:16px;text-align:center;
box-shadow:0 10px 24px rgba(0,0,0,0.5);height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden;}
#tipQrWrap::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 20%,rgba(255,216,102,0.12),transparent 60%);pointer-events:none;}
#tipQrImg{width:min(78%,210px);height:auto;aspect-ratio:1;border-radius:12px;background:#fff;padding:8px;display:block;margin:0 auto;
box-shadow:0 0 0 3px #FFD866,0 8px 24px rgba(255,216,102,0.25);}
.tipLabel{color:#FFD866;font-weight:800;font-size:21px;margin-top:12px;}
.tipHeart{font-size:15px;margin-top:2px;letter-spacing:3px;opacity:0.85;}
.tipSub{color:#5a6a8a;font-size:12px;margin-top:5px;line-height:1.45;max-width:220px;}
.miniListRow{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #202a44;font-size:12px;}
.miniListRow:last-child{border-bottom:none;}
.miniListRow .miniAvatar{width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.miniListRow .miniAvatarFallback{width:24px;height:24px;border-radius:50%;background:#4FC3F7;color:#0a0e1f;
font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
</style></head><body>
<h1>♟️ Chess Battle — Live</h1>
<div class="layout">
  <div class="sideCol">
    <div class="playerCard compact" id="whiteCard">
      <div class="avatar" id="whiteAvatar">N</div>
      <div class="pName" id="whiteName">—</div>
      <div class="pLabel">WHITE</div>
      <div class="clockDisplay" id="whiteClock" style="display:none;">10:00</div>
      <div class="captured" id="capturedByWhite"></div>
    </div>
    <!-- সরাসরি টিপস — এখন উপরে, ফিক্সড উচ্চতা যাতে QR সবসময় পুরোপুরি দেখা যায় -->
    <div id="tipBoxOverlay" style="display:none;">
      <div id="tipQrWrap">
        <img id="tipQrImg" src="" alt="Scan to help">
        <div class="tipLabel">🙏 Help Me</div>
        <div class="tipHeart">♟️ ❤️ ♟️</div>
        <div class="tipSub">Voluntary support — not tied to the game, never required</div>
      </div>
    </div>
    <!-- নিচে — গুটির নিয়ম ↔ সাম্প্রতিক সাপোর্টার, পালাক্রমে (আগে ডান কলামে যেমন হতো, এখন এখানে) -->
    <div id="leftAltPanel">
      <div class="rulesBox">
        <div class="altView show" id="rulesView">
          <h3>How Pieces Move</h3>
          <div id="rulesList"></div>
        </div>
        <div class="altView" id="donorView">
          <h3>💛 Recent Supporters</h3>
          <div id="recentDonorList"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="centerCol">
    <div id="opening"></div>
    <div id="boardWrap">
      <div id="board"></div>
      <svg id="arrowLayer" viewBox="0 0 464 464"><defs>
        <marker id="ah1" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#E8B33D"/></marker>
        <marker id="ah2" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="rgba(232,179,61,0.5)"/></marker>
      </defs></svg>
    </div>
    <div id="thinking">Thinking...</div>
    <div id="predictLabel"></div>
    <div id="moveCount"></div>
    <div id="commentary"></div>
    <!-- "এই মুহূর্তে থামলে কে কতটা এগিয়ে" win-probability বার — দুই রঙ, মাঝে স্থির win% ব্যাজ, দুই প্রান্তে খেলোয়াড়ের নাম -->
    <div id="evalBarWrap">
      <div id="evalNames"><span id="evalNameWhite">White</span><span id="evalNameBlack">Black</span></div>
      <div id="evalBarTrack">
        <div id="evalBarWhite"></div>
        <div id="evalBarBadge">50%</div>
        <div id="evalBarBlack"></div>
      </div>
    </div>
  </div>

  <!-- টপ ৩ সাপোর্টার — বোর্ড আর Nadia-প্যানেলের মাঝের গ্যাপে, ওপর থেকে নিচ পর্যন্ত ৩টা প্যানেল,
       প্রতিটাতে ৯০% ছবি + ১০% নাম/অ্যামাউন্ট, কোনো বাড়তি ফাঁকা জায়গা নেই -->
  <div class="topSupCol">
    <div class="topSupporterPanel" id="topSup1"><div class="tsPhoto" id="tsPhoto1"><div class="tsRank">1</div></div><div class="tsInfo" id="tsInfo1">—</div></div>
    <div class="topSupporterPanel" id="topSup2"><div class="tsPhoto" id="tsPhoto2"><div class="tsRank">2</div></div><div class="tsInfo" id="tsInfo2">—</div></div>
    <div class="topSupporterPanel" id="topSup3"><div class="tsPhoto" id="tsPhoto3"><div class="tsRank">3</div></div><div class="tsInfo" id="tsInfo3">—</div></div>
  </div>

  <div class="sideCol">
    <!-- প্রতিপক্ষ/challenger-এর ছবির কার্ড — একটু ছোট করা, নিচের queue-বক্সকে বেশি জায়গা দিতে -->
    <div class="playerCard big small" id="blackCard">
      <div class="bigPhotoWrap" id="blackPhotoWrap"><div class="avatarFallbackBig" id="blackAvatarFallback">?</div></div>
      <div class="bigInfoFooter">
        <div class="pName" id="blackName">—</div>
        <div class="clockDisplay" id="blackClock" style="display:none;">10:00</div>
      </div>
    </div>
    <!-- চ্যালেঞ্জ queue — এখন প্লেইন, ফিক্সড, অল্টারনেট করে না, আকার সবসময় স্থির -->
    <div class="rulesBox" id="queuePanelFixed">
      <h3>🔴 Now Playing / Up Next</h3>
      <div id="currentPlayerLine" style="color:#FFD866;font-weight:800;font-size:13px;margin-bottom:8px;"></div>
      <div id="queueList"></div>
    </div>
  </div>
</div>

<div class="flash" id="flash"></div>

<!-- Fan Battle Live-স্টাইল ডোনার সেলিব্রেশন কার্ড — ছবি (থাকলে) বড় করে, নাম + অ্যামাউন্ট -->
<div class="donorCeleb" id="donorCelebration">
  <div class="donorCelebCard">
    <div class="donorCelebTag">🙏 New Supporter</div>
    <div id="donorCelebPhotoWrap" style="display:none;"><img id="donorCelebPhotoImg"></div>
    <div class="donorCelebName" id="donorCelebName">—</div>
    <div class="donorCelebAmount" id="donorCelebAmount">₹0</div>
  </div>
</div>

<button id="soundBtn" style="position:fixed;top:12px;right:12px;background:#E8B33D;border:none;
border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600;">🔊 Turn on sound</button>
<audio id="narrator" autoplay></audio>
<script>
const PIECE_RULES = [
  { glyph: "♔", name: "King", text: "Moves <b>1 square</b> in any direction — forward, back, sideways, diagonal." },
  { glyph: "♕", name: "Queen", text: "Moves <b>any number of squares</b> in any direction — straight or diagonal." },
  { glyph: "♖", name: "Rook", text: "Moves <b>any number of squares</b>, only straight lines (no diagonal)." },
  { glyph: "♘", name: "Knight", text: "Moves in an <b>'L' shape</b> — 2 squares one way, then 1 square sideways. Can jump over pieces." },
  { glyph: "♗", name: "Bishop", text: "Moves <b>any number of squares</b>, only diagonally. Stays on one color forever." },
  { glyph: "♙", name: "Pawn", text: "Moves <b>1 square forward</b> (2 on first move). Captures diagonally, 1 square." },
];
let ruleIdx = 0;
function renderRules() {
  const el = document.getElementById("rulesList");
  el.innerHTML = PIECE_RULES.map((r, i) =>
    '<div class="ruleRow"><div class="ruleGlyph' + (i === ruleIdx ? " hi" : "") + '">' + r.glyph + '</div>' +
    '<div class="ruleText"><b>' + r.name + ':</b> ' + r.text + '</div></div>'
  ).join("");
}
// safeInit — একটা অংশ কোনো কারণে fail করলেও (যেমন কোনো element খুঁজে না পেলে) বাকি সব অংশ
// যেন স্বাভাবিকভাবে চলতে থাকে, পুরো পেজ যেন এক জায়গার ভুলে সম্পূর্ণ ফাঁকা/অকেজো হয়ে না যায়
function safeInit(label, fn) {
  try { fn(); } catch (e) { console.error("⚠️ overlay init failed [" + label + "]:", e); }
}
safeInit("renderRules", () => { renderRules(); setInterval(() => { ruleIdx = (ruleIdx + 1) % PIECE_RULES.length; renderRules(); }, 4000); });

let lastKey="";const audioEl=document.getElementById("narrator");let queue=[];
let audioCtx = null;
const bgMusicEl = document.createElement("audio");
bgMusicEl.loop = true; bgMusicEl.id = "bgMusic";
document.body.appendChild(bgMusicEl);
document.getElementById("soundBtn").addEventListener("click", () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  audioEl.play().catch(()=>{});
  bgMusicEl.play().catch(()=>{}); // ব্রাউজার autoplay policy-র কারণে ব্যাকগ্রাউন্ড মিউজিকও এই একই user-tap-এর সাথে শুরু হচ্ছে
  document.getElementById("soundBtn").style.display = "none";
});
function playQueue(){if(queue.length===0)return;audioEl.src=queue.shift();audioEl.play().catch(()=>{});}
audioEl.addEventListener("ended",playQueue);

// ---------- ব্যাকগ্রাউন্ড মিউজিক + আপনার নিজের রেকর্ড করা কমেন্ট্রি অডিও লুপ (/gaming/chess-admin থেকে সেট করা) ----------
let chessConfigCache = null;
let commentaryIdx = 0;
let commentaryLoopTimer = null;
const commentaryAudioEl = document.createElement("audio");
commentaryAudioEl.id = "commentaryAudio";
document.body.appendChild(commentaryAudioEl);
async function loadChessConfig(){
  try {
    const res = await fetch("/gaming/chess-config");
    const cfg = await res.json();
    const changed = JSON.stringify(cfg) !== JSON.stringify(chessConfigCache);
    if (!changed) return;
    chessConfigCache = cfg;
    if (cfg.bgMusicUrl && bgMusicEl.src !== cfg.bgMusicUrl) {
      bgMusicEl.src = cfg.bgMusicUrl;
      bgMusicEl.play().catch(()=>{}); // সাউন্ড আগে থেকেই চালু থাকলে সাথে সাথেই বাজবে, নাহলে "Turn on sound"-এর অপেক্ষা করবে
    } else if (!cfg.bgMusicUrl) {
      bgMusicEl.removeAttribute("src");
    }
    bgMusicEl.volume = typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15;
    if (commentaryLoopTimer) clearInterval(commentaryLoopTimer);
    if (cfg.commentaryUrls && cfg.commentaryUrls.length) {
      commentaryLoopTimer = setInterval(playNextCommentaryClip, (cfg.loopIntervalSec || 90) * 1000);
    }
  } catch(e){}
}
function playNextCommentaryClip(){
  // আপনার নিজের আপলোড করা অডিও ফাইল সরাসরি বাজানো হচ্ছে — কোনো TTS/টেক্সট কনভার্সন নেই
  if (!chessConfigCache || !chessConfigCache.commentaryUrls || !chessConfigCache.commentaryUrls.length) return;
  const url = chessConfigCache.commentaryUrls[commentaryIdx % chessConfigCache.commentaryUrls.length];
  commentaryIdx++;
  commentaryAudioEl.src = url;
  commentaryAudioEl.play().catch(()=>{});
}
safeInit("loadChessConfig", () => { loadChessConfig(); setInterval(loadChessConfig, 15000); }); // সেভ করলে ১৫ সেকেন্ডের মধ্যেই লাইভে প্রতিফলিত হবে

// ---------- ডোনার সেলিব্রেশনের ভয়েস — Fan Battle Live-এর মতো Web Speech API ব্যবহার হয়,
// কিন্তু ভয়েস বাছাইয়ের UI এখন আর এই পাবলিক পেজে নেই (নিরাপত্তার জন্য /gaming/chess-admin-এ সরানো হয়েছে) —
// এখানে শুধু সেভ করা celebVoiceURI অনুযায়ী সঠিক ভয়েসটা প্রোগ্রাম্যাটিকভাবে বেছে নেওয়া হয় ----------
let availableVoices = [];
let selectedCelebVoice = null;
function scoreVoiceForBn(v){
  let score = 0;
  if (/bn|beng|india|hindi/i.test(v.lang) || /bn|beng|india/i.test(v.name)) score += 5;
  if (/en-IN|en-GB|en-US/i.test(v.lang)) score += 2;
  if (/Google|Natural|Neural|Premium/i.test(v.name)) score += 3;
  return score;
}
function resolveCelebVoice(){
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!availableVoices.length) return;
  const sorted = [...availableVoices].sort((a,b) => scoreVoiceForBn(b) - scoreVoiceForBn(a));
  const savedURI = chessConfigCache && chessConfigCache.celebVoiceURI;
  const match = savedURI ? sorted.find(v => v.voiceURI === savedURI) : null;
  selectedCelebVoice = match || sorted[0];
}
safeInit("voicePicker", () => {
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = resolveCelebVoice;
    resolveCelebVoice();
  }
});
function speakCeleb(text){
  if (!window.speechSynthesis) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    if (selectedCelebVoice) utter.voice = selectedCelebVoice;
    utter.rate = 1.0; utter.pitch = 1.0;
    window.speechSynthesis.cancel(); // আগেরটা কথা বলছে থাকলে থামিয়ে নতুনটা বলুক
    window.speechSynthesis.speak(utter);
  } catch(e){}
}

// "স্যাটিসফাইং" গুটি-বসার শব্দ — mobile game-এর মতো একটা তীক্ষ্ণ, পরিষ্কার সূচনা (crisp attack)
// থাকা জরুরি, নাহলে সেটা "satisfying" লাগে না — filtered noise "tap" + কাঠের মতো উষ্ণ tone মিলিয়ে
function playMoveSound(isCapture) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const baseFreq = isCapture ? 260 : 380;

    // ধাপ ১ — খুব সংক্ষিপ্ত noise "tap" (আসল চাল-দেওয়ার মতো তীক্ষ্ণ, স্পষ্ট সূচনা)
    const bufSize = Math.floor(audioCtx.sampleRate * 0.03);
    const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const noise = audioCtx.createBufferSource(); noise.buffer = noiseBuf;
    const noiseFilter = audioCtx.createBiquadFilter(); noiseFilter.type = "bandpass"; noiseFilter.frequency.value = baseFreq * 2.2; noiseFilter.Q.value = 1.2;
    const noiseGain = audioCtx.createGain(); noiseGain.gain.setValueAtTime(0.22, t); noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination); noise.start(t);

    // ধাপ ২ — কাঠের মতো উষ্ণ tone, noise-এর ঠিক পরপরই বাজবে, সব মিলিয়ে একটা পূর্ণাঙ্গ "ঠক" অনুভূতি দেয়
    const osc1 = audioCtx.createOscillator(); const g1 = audioCtx.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(baseFreq, t);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, t + 0.1);
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc1.connect(g1).connect(audioCtx.destination);
    osc1.start(t); osc1.stop(t + 0.14);

    const osc2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(baseFreq * 0.5, t);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc2.connect(g2).connect(audioCtx.destination);
    osc2.start(t); osc2.stop(t + 0.22);
  } catch (e) {}
}
// কাঠের গুটি "পড়ে গিয়ে" এলিমিনেট হওয়ার শব্দ — capture-এর মুহূর্তে বাজে (attacker পৌঁছানোর ঠিক আগেই),
// একটা হালকা "টাল খেয়ে পড়া" + বাক্সে গড়িয়ে পড়ার মতো শব্দ, যাতে বাস্তব দাবা বোর্ডের অনুভূতি হয়
function playCaptureFallSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    // একটা "টুক" শব্দ দিয়ে টাল খাওয়া শুরু, তারপর ২-৩টা কমতে থাকা bounce — বাক্সে গড়িয়ে পড়ার মতো
    [0, 0.09, 0.16, 0.21].forEach((delay, i) => {
      const tt = t + delay;
      const freq = 180 - i * 25;
      const vol = 0.16 - i * 0.03;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(freq, tt);
      g.gain.setValueAtTime(Math.max(0.02, vol), tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.08);
      osc.connect(g).connect(audioCtx.destination); osc.start(tt); osc.stop(tt + 0.09);
    });
  } catch (e) {}
}

// প্রতি ম্যাচের theme অনুযায়ী বোর্ডের রঙ CSS variable দিয়ে বদলে দেওয়া — একই থিমে বারবার
// DOM লেখা এড়াতে lastAppliedTheme দিয়ে compare করা হচ্ছে
let lastAppliedTheme = "";
function applyBoardTheme(theme){
  if (!theme) return;
  const key = JSON.stringify(theme);
  if (key === lastAppliedTheme) return;
  lastAppliedTheme = key;
  const root = document.documentElement.style;
  root.setProperty("--sq-light", theme.light);
  root.setProperty("--sq-dark", theme.dark);
  root.setProperty("--pc-w1", theme.pcW1);
  root.setProperty("--pc-w2", theme.pcW2);
  root.setProperty("--pc-b1", theme.pcB1);
  root.setProperty("--pc-b2", theme.pcB2);
  root.setProperty("--board-border", theme.border);
  root.setProperty("--arrow-color", theme.accent || "#E8B33D");
}

const PIECE_GLYPH = { p:"♟",r:"♜",n:"♞",b:"♝",q:"♛",k:"♚", P:"♟",R:"♜",N:"♞",B:"♝",Q:"♛",K:"♚" };
const CAPTURED_GLYPH = { p:"♟",n:"♞",b:"♝",r:"♜",q:"♛" };
let prevFenBoard = "";
let lastAnimatedMoveKey = "";
function squareToRC(sq) {
  const file = sq.charCodeAt(0) - 97; // 'a' = 0
  const rank = parseInt(sq[1], 10);
  return { r: 8 - rank, c: file };
}
function rcToSquare(r, c) { return "abcdefgh"[c] + (8 - r); }
function renderBoard(fen, lastMove) {
  const boardEl = document.getElementById("board");
  if (!fen) return;
  const boardPart = fen.split(" ")[0];
  const rows = boardPart.split("/");
  const lastFromRC = lastMove ? squareToRC(lastMove.from) : null;
  const lastToRC = lastMove ? squareToRC(lastMove.to) : null;
  const grid = [];
  for (let r = 0; r < 8; r++) {
    let col = 0;
    for (const ch of rows[r]) {
      if (/[0-9]/.test(ch)) { const empty = parseInt(ch, 10); for (let i = 0; i < empty; i++) { grid.push({ r, c: col, piece: "" }); col++; } }
      else { grid.push({ r, c: col, piece: ch }); col++; }
    }
  }
  const moveKey = lastMove ? (lastMove.from + lastMove.to + boardPart) : "";
  const shouldAnimate = lastMove && moveKey !== lastAnimatedMoveKey && prevFenBoard && prevFenBoard !== boardPart;
  lastAnimatedMoveKey = moveKey;

  if (shouldAnimate) {
    // চাল দেওয়ার মুহূর্তে গুটিটা এক ঘর থেকে পরের ঘরে চোখের সামনে দিয়ে "হেঁটে" যাবে, আচমকা টেলিপোর্ট করবে না।
    // capture হলে — যে গুটিটা মারা পড়বে সে জায়গাতেই থাকবে, attacker আসলেই "পৌঁছানোর পর" সে উধাও হবে
    // (আগে সে destination hide করার সাথে সাথেই সরাসরি অদৃশ্য হয়ে যেত, যেটা এলোমেলো/আচমকা লাগতো)
    const fromEl0 = boardEl.querySelector('[data-square="' + lastMove.from + '"]');
    const toEl0 = boardEl.querySelector('[data-square="' + lastMove.to + '"]');
    const movingPiece = grid.find(g => rcToSquare(g.r, g.c) === lastMove.to);
    const wasOccupiedBefore = prevFenBoard && isSquareOccupiedInFen(prevFenBoard, lastToRC);
    const capturedPieceChar = wasOccupiedBefore ? getPieceAtRC(prevFenBoard, lastToRC) : "";
    // transitional grid — destination square-এ attacker না, বরং মৃত্যুর অপেক্ষায় থাকা গুটিটা দেখানো হচ্ছে
    const transGrid = grid.map(g => (g.r === lastToRC.r && g.c === lastToRC.c) ? { r: g.r, c: g.c, piece: capturedPieceChar } : g);
    drawGrid(boardEl, transGrid, lastFromRC, lastToRC, null);
    const fromEl = fromEl0, toEl = toEl0;
    if (fromEl && toEl && movingPiece && movingPiece.piece) {
      const wrap = document.getElementById("boardWrap");
      const wrapRect = wrap.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const ghost = document.createElement("div");
      const isWhite = movingPiece.piece === movingPiece.piece.toUpperCase();
      ghost.className = "ghostPieceMain piece " + (isWhite ? "piece-w" : "piece-b");
      ghost.textContent = PIECE_GLYPH[movingPiece.piece] || "";
      const ANIM_MS = 1300;
      ghost.style.cssText = "position:absolute;z-index:30;display:flex;align-items:center;justify-content:center;font-size:44px;pointer-events:none;"+
        "transition:left "+(ANIM_MS/1000)+"s ease-in-out,top "+(ANIM_MS/1000)+"s ease-in-out,transform "+(ANIM_MS/1000)+"s ease-in-out;"+
        "filter:drop-shadow(0 8px 10px rgba(0,0,0,0.6));"; // চলার সময় হালকা ছায়া — যেন একটু "উঠে" ভেসে চলছে, পরিষ্কার/সুন্দর লাগে
      ghost.style.left = (fromRect.left - wrapRect.left) + "px";
      ghost.style.top = (fromRect.top - wrapRect.top) + "px";
      ghost.style.width = fromRect.width + "px";
      ghost.style.height = fromRect.height + "px";
      ghost.style.transform = "scale(1)";
      wrap.appendChild(ghost);
      if (wasOccupiedBefore) { setTimeout(() => playCaptureFallSound(), 30); } // মৃত গুটিটা "পড়ে যাওয়ার" শব্দ, attacker পৌঁছানোর আগেই
      // শব্দ এবং capture — দুটোই blind timer-এর বদলে ব্রাউজারের transitionend event-এ ফায়ার হয়,
      // মানে গুটি ঠিক যে মুহূর্তে থামছে, সেই মুহূর্তেই মৃত গুটিটা সরবে আর শব্দ বাজবে — কোনো drift নেই
      let landed = false;
      const onLanded = () => {
        if (landed) return;
        landed = true;
        ghost.remove();
        drawGrid(boardEl, grid, lastFromRC, lastToRC, null); // এখন আসল পোস্ট-মুভ অবস্থায় ফিরে আসা — captured গুটি এখন সত্যিই সরে গেছে
        playMoveSound(wasOccupiedBefore);
      };
      const isKnight = movingPiece.piece.toLowerCase() === "n";
      if (isKnight) {
        // ঘোড়ার আসল "L" আকৃতির পথ ধরে চলা দেখানো — আগে লম্বা লেগ (২ ঘর), তারপর ছোট লেগ (১ ঘর) —
        // সরাসরি কোনাকুনি "শর্টকাট" দিয়ে না গিয়ে, দর্শক যেন বুঝতে পারে ঘোড়া ঠিক কোন পথে গেল
        const dr = lastToRC.r - lastFromRC.r, dc = lastToRC.c - lastFromRC.c;
        const longAxisIsRow = Math.abs(dr) === 2;
        const midRC = longAxisIsRow ? { r: lastFromRC.r + dr, c: lastFromRC.c } : { r: lastFromRC.r, c: lastFromRC.c + dc };
        const midEl = boardEl.querySelector('[data-square="' + rcToSquare(midRC.r, midRC.c) + '"]');
        const midRect = midEl ? midEl.getBoundingClientRect() : null;
        ghost.style.transition = "left "+(ANIM_MS*0.55/1000)+"s ease-in,top "+(ANIM_MS*0.55/1000)+"s ease-in,transform "+(ANIM_MS*0.55/1000)+"s ease-in-out";
        requestAnimationFrame(() => {
          ghost.style.transform = "scale(1.15)"; // মাঝপথে সামান্য বড়/উঁচু — গতির অনুভূতি
          if (midRect) { ghost.style.left = (midRect.left - wrapRect.left) + "px"; ghost.style.top = (midRect.top - wrapRect.top) + "px"; }
        });
        // দ্বিতীয় ধাপ শুরু হবে প্রথম transition শেষ হওয়ার transitionend-এ, timer-এর উপর ভরসা না করে
        ghost.addEventListener("transitionend", function phase2(e) {
          if (e.propertyName !== "left") return;
          ghost.removeEventListener("transitionend", phase2);
          ghost.style.transition = "left "+(ANIM_MS*0.45/1000)+"s ease-out,top "+(ANIM_MS*0.45/1000)+"s ease-out,transform "+(ANIM_MS*0.45/1000)+"s ease-in-out";
          requestAnimationFrame(() => {
            ghost.style.transform = "scale(1)";
            ghost.style.left = (toRect.left - wrapRect.left) + "px";
            ghost.style.top = (toRect.top - wrapRect.top) + "px";
          });
          ghost.addEventListener("transitionend", onLanded, { once: true });
        }, { once: true });
      } else {
        requestAnimationFrame(() => {
          ghost.style.transform = "scale(1.1)";
          ghost.style.left = (toRect.left - wrapRect.left) + "px";
          ghost.style.top = (toRect.top - wrapRect.top) + "px";
        });
        ghost.addEventListener("transitionend", (e) => { if (e.propertyName === "left") { ghost.style.transform = "scale(1)"; onLanded(); } }, { once: true });
      }
      setTimeout(onLanded, ANIM_MS + 400); // নিরাপত্তার জন্য — কোনো কারণে transitionend না ফায়ার করলেও (যেমন ট্যাব ব্যাকগ্রাউন্ডে থাকলে) যাতে চিরকাল আটকে না থাকে
      prevFenBoard = boardPart;
      return;
    }
  }
  drawGrid(boardEl, grid, lastFromRC, lastToRC, null);
  const changed = prevFenBoard && prevFenBoard !== boardPart;
  if (changed) playMoveSound(prevFenBoard && isSquareOccupiedInFen(prevFenBoard, lastToRC));
  prevFenBoard = boardPart;
}
// আগের FEN-এ (চাল দেওয়ার আগে) কোনো নির্দিষ্ট ঘরে গুটি ছিল কিনা — capture সাউন্ড ঠিকভাবে বাজানোর জন্য দরকার
function isSquareOccupiedInFen(fenBoardPart, rc) {
  if (!rc) return false;
  const rows = fenBoardPart.split("/");
  const row = rows[rc.r];
  if (!row) return false;
  let col = 0;
  for (const ch of row) {
    if (/[0-9]/.test(ch)) { col += parseInt(ch, 10); }
    else { if (col === rc.c) return true; col++; }
  }
  return false;
}
// ওই ঘরে ঠিক কোন গুটিটা ছিল (capture হওয়ার আগে) — এটা জানা দরকার, যাতে attacker গিয়ে
// পৌঁছানোর আগ পর্যন্ত মৃত গুটিটাকে জায়গায় দেখানো যায়, হুট করে "উধাও" না হয়ে যায়
function getPieceAtRC(fenBoardPart, rc) {
  if (!rc) return "";
  const rows = fenBoardPart.split("/");
  const row = rows[rc.r];
  if (!row) return "";
  let col = 0;
  for (const ch of row) {
    if (/[0-9]/.test(ch)) { col += parseInt(ch, 10); }
    else { if (col === rc.c) return ch; col++; }
  }
  return "";
}
function drawGrid(boardEl, grid, lastFromRC, lastToRC, hideRC) {
  boardEl.innerHTML = "";
  grid.forEach(g => {
    const hide = hideRC && hideRC.r === g.r && hideRC.c === g.c;
    addSquare(boardEl, g.r, g.c, hide ? "" : g.piece, lastFromRC, lastToRC);
  });
}
function addSquare(boardEl, r, c, piece, lastFromRC, lastToRC) {
  const sq = document.createElement("div");
  let cls = "sq " + ((r + c) % 2 === 0 ? "light" : "dark");
  if (lastFromRC && lastFromRC.r === r && lastFromRC.c === c) cls += " lastFrom";
  if (lastToRC && lastToRC.r === r && lastToRC.c === c) cls += " lastTo";
  sq.className = cls;
  sq.dataset.square = rcToSquare(r, c);
  if (piece) {
    const isWhite = piece === piece.toUpperCase();
    sq.innerHTML = '<span class="piece ' + (isWhite ? "piece-w" : "piece-b") + '">' + (PIECE_GLYPH[piece] || "") + '</span>';
  }
  boardEl.appendChild(sq);
}

// candidate / chosen move গুলোকে বোর্ডের উপর তীর (arrow) দিয়ে দেখানো
function squareCenter(sq) {
  const { r, c } = squareToRC(sq);
  return { x: c * 58 + 29, y: r * 58 + 29 };
}
function hexToRgb(hex){
  const h = hex.replace("#","");
  const n = h.length===3 ? h.split("").map(c=>c+c).join("") : h;
  const num = parseInt(n,16);
  return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
}
function renderArrows(candidates, chosenMove) {
  const svg = document.getElementById("arrowLayer");
  const accent = (getComputedStyle(document.documentElement).getPropertyValue("--arrow-color") || "#E8B33D").trim();
  const { r, g, b } = hexToRgb(accent.startsWith("#") ? accent : "#E8B33D");
  const dim = "rgba(" + r + "," + g + "," + b + ",0.42)";
  svg.innerHTML = '<defs>' +
    '<marker id="ah1" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="'+accent+'"/></marker>' +
    '<marker id="ah2" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="'+dim+'"/></marker>' +
  '</defs>';
  (candidates || []).forEach((c) => {
    if (chosenMove && c.from === chosenMove.from && c.to === chosenMove.to) return; // chosen আলাদাভাবে আঁকা হবে, ডুপ্লিকেট না
    const p1 = squareCenter(c.from), p2 = squareCenter(c.to);
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
    line.setAttribute("stroke", dim); line.setAttribute("stroke-width", "4.5"); line.setAttribute("stroke-linecap", "round");
    line.setAttribute("marker-end", "url(#ah2)");
    svg.appendChild(line);
  });
  if (chosenMove) {
    const p1 = squareCenter(chosenMove.from), p2 = squareCenter(chosenMove.to);
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
    line.setAttribute("stroke", accent); line.setAttribute("stroke-width", "6.5"); line.setAttribute("stroke-linecap", "round");
    line.setAttribute("marker-end", "url(#ah1)");
    line.style.filter = "drop-shadow(0 0 5px rgba(" + r + "," + g + "," + b + ",0.85))";
    svg.appendChild(line);
  }
}

function showFlash(text, color, withConfetti) {
  const flashEl = document.getElementById("flash");
  flashEl.innerHTML = "";
  const main = document.createElement("div");
  main.textContent = text; main.style.color = color;
  main.style.textShadow = "0 0 30px rgba(0,0,0,0.9)";
  flashEl.appendChild(main);
  if (withConfetti) {
    const row = document.createElement("div");
    row.className = "confetti";
    row.textContent = "🎉 🏆 ♟️ ✨ 🎊";
    flashEl.appendChild(row);
  }
  flashEl.classList.remove("show"); void flashEl.offsetWidth; flashEl.classList.add("show");
}

// গেম-শেষে celebration/draw সাউন্ড — জেতার জন্য উঠতি সুরেলা arpeggio, ড্র-র জন্য শান্ত টোন
function playEndGameSound(isWin) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = isWin ? [523.25, 659.25, 783.99, 1046.5] : [440, 392, 349.23];
    notes.forEach((freq, i) => {
      const t = audioCtx.currentTime + i * 0.16;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(g).connect(audioCtx.destination); osc.start(t); osc.stop(t + 0.55);
    });
  } catch (e) {}
}

function renderCaptured(el, pieces) {
  el.textContent = (pieces || []).map((p) => CAPTURED_GLYPH[p] || "").join(" ");
}

let lastStatus = "";
async function poll(){try{
  const res=await fetch("/gaming/state/chess.json?t="+Date.now());const data=await res.json();
  applyBoardTheme(data.boardTheme);
  renderBoard(data.fen, data.lastMove);
  renderArrows(data.candidates, data.chosenMove);

  document.getElementById("opening").textContent = data.mode === "challenge" ? "🔴 LIVE — " + data.blackName + " vs " + data.whiteName : (data.openingName?("Opening: "+data.openingName):"");

  document.getElementById("currentPlayerLine").textContent = data.blackName ? ("Now playing: " + data.blackName) : "";
  if (data.queue && data.queue.length) {
    document.getElementById("queueList").innerHTML = data.queue.slice(0,6).map(q =>
      '<div class="miniListRow">' +
      (q.photoUrl ? '<img class="miniAvatar" src="'+q.photoUrl+'">' : '<div class="miniAvatarFallback">'+(q.name[0]||"?")+'</div>') +
      '<div><b>#'+q.position+'</b> '+q.name+ (q.tipAmount ? ' <span style="color:#FFD866;font-weight:700;">₹'+q.tipAmount+'</span>' : '') + '</div></div>'
    ).join("");
  } else {
    document.getElementById("queueList").innerHTML = '<div style="font-size:11px;color:#5a6a8a;">No one in queue right now</div>';
  }

  document.getElementById("moveCount").textContent=data.moves?(data.moves.length+" moves played"):"";
  document.getElementById("commentary").textContent=data.lastCommentaryBn||"";

  document.getElementById("whiteName").textContent = data.whiteName || "—";
  document.getElementById("blackName").textContent = data.blackName || "—";
  const wAv = document.getElementById("whiteAvatar");
  if (data.whiteAvatarUrl) wAv.innerHTML = '<img src="'+data.whiteAvatarUrl+'">';
  else wAv.textContent = (data.whiteName || "N")[0].toUpperCase();
  // প্রতিপক্ষের সম্পূর্ণ ছবি (ছোট গোল avatar না) — বড় ফটো বক্সে দেখানো হচ্ছে
  const bPhotoWrap = document.getElementById("blackPhotoWrap");
  if (data.blackAvatarUrl) {
    if (bPhotoWrap.dataset.url !== data.blackAvatarUrl) {
      bPhotoWrap.dataset.url = data.blackAvatarUrl;
      bPhotoWrap.innerHTML = '<img src="'+data.blackAvatarUrl+'">';
    }
  } else if (bPhotoWrap.dataset.url) {
    bPhotoWrap.dataset.url = "";
    bPhotoWrap.innerHTML = '<div class="avatarFallbackBig">'+((data.blackName||"?")[0]||"?").toUpperCase()+'</div>';
  }
  // (blackTipLine বাদ দেওয়া হয়েছে — blackCard এখন শুধু ছবি+নাম দেখায়, tip amount টপ-সাপোর্টার প্যানেলে দেখা যায়)
  renderCaptured(document.getElementById("capturedByWhite"), data.capturedByWhite);

  document.getElementById("whiteCard").classList.toggle("active", data.fen && data.fen.includes(" w "));
  document.getElementById("blackCard").classList.toggle("active", data.fen && data.fen.includes(" b "));

  // দাবার ক্লক — শুধু challenge মোডে (মানুষের বিরুদ্ধে খেলা) থাকে, সাধারণ auto-game-এ দেখায় না
  const wClockEl = document.getElementById("whiteClock"), bClockEl = document.getElementById("blackClock");
  if (typeof data.whiteMs === "number" && typeof data.blackMs === "number") {
    const fmt = (ms) => { const s = Math.max(0, Math.round(ms/1000)); return String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0"); };
    wClockEl.style.display = "inline-block"; bClockEl.style.display = "inline-block";
    wClockEl.textContent = fmt(data.whiteMs); bClockEl.textContent = fmt(data.blackMs);
    const isWhiteTurn = data.fen && data.fen.includes(" w ");
    wClockEl.classList.toggle("active", isWhiteTurn); bClockEl.classList.toggle("active", !isWhiteTurn);
    wClockEl.classList.toggle("low", data.whiteMs < 60000); bClockEl.classList.toggle("low", data.blackMs < 60000);
  } else {
    wClockEl.style.display = "none"; bClockEl.style.display = "none";
  }

  // "এই মুহূর্তে থামলে কে কতটা এগিয়ে" — win-probability বার, প্রতি ম্যাচে নাম বদলায়
  const evalWrap = document.getElementById("evalBarWrap");
  document.getElementById("evalNameWhite").textContent = data.whiteName || "White";
  document.getElementById("evalNameBlack").textContent = data.blackName || "Black";
  if (typeof data.whiteWinPct === "number" && data.status === "playing") {
    evalWrap.style.display = "block";
    const wp = Math.max(2, Math.min(98, data.whiteWinPct));
    document.getElementById("evalBarWhite").style.flexBasis = wp + "%";
    document.getElementById("evalBarBlack").style.flexBasis = (100 - wp) + "%";
    const badge = document.getElementById("evalBarBadge");
    const leadingIsWhite = wp >= 50;
    badge.textContent = (leadingIsWhite ? wp : (100 - wp)) + "%"; // যে পক্ষ এগিয়ে, ব্যাজে তার শতাংশটাই দেখাবে
    badge.style.left = wp + "%"; // ঠিক যেখানে দুই রঙ জোড়া লাগছে, সেই বিন্দুতেই ব্যাজ থাকবে (fixed মাঝখানে না)
    badge.style.borderColor = leadingIsWhite ? "#FFD866" : "#7C4DFF"; // এগিয়ে থাকা পক্ষের রঙে বর্ডার — এক নজরেই বোঝা যায়
  } else {
    evalWrap.style.display = "none";
  }

  document.getElementById("thinking").style.display = data.status === "playing" ? "block" : "none";
  document.getElementById("thinking").classList.toggle("active", data.status === "playing");
  document.getElementById("predictLabel").textContent = (data.candidates && data.candidates.length)
    ? (data.chosenMove ? "BEST MOVE HIGHLIGHTED ⭐" : "PREDICT THE NEXT MOVE 🤔")
    : "";

  if (data.status === "finished" && lastStatus !== "finished-" + data.result) {
    lastStatus = "finished-" + data.result;
    const isWin = data.result && (data.result.includes("Checkmate") || data.result.includes("Time out"));
    showFlash(isWin ? "🎉 " + data.result : "🤝 " + (data.result || "Draw"), isWin ? "#FFD866" : "#8FA3C0", isWin);
    if (isWin) launchConfetti(); // জেতার মুহূর্তে কাগজের কুচির মতো উড়ন্ত কনফেটি
    playEndGameSound(isWin);
  }
  if (data.status === "playing") lastStatus = "";

  const key=JSON.stringify(data.audioPlaylist||[]);
  if(data.audioPlaylist&&key!==lastKey){lastKey=key;queue=[...data.audioPlaylist];playQueue();}
}catch(e){}}
safeInit("mainPoll", () => { setInterval(poll,1200); poll(); });

// জেতার সময় সত্যিকারের উড়ন্ত কনফেটি — CSS keyframe দিয়ে অনেকগুলো ছোট রঙিন ফালি উপর থেকে পড়ে
function launchConfetti(){
  const colors = ["#FFD866","#4FC3F7","#E8443D","#8BE28B","#FF8FCF","#B39DDB"];
  for (let i = 0; i < 70; i++) {
    const piece = document.createElement("div");
    piece.className = "confettiPiece";
    piece.style.left = Math.random()*100 + "vw";
    piece.style.background = colors[Math.floor(Math.random()*colors.length)];
    piece.style.animationDuration = (2.2 + Math.random()*1.8) + "s";
    piece.style.animationDelay = (Math.random()*0.6) + "s";
    piece.style.transform = "rotate(" + Math.floor(Math.random()*360) + "deg)";
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 5000);
  }
}

// ---------- নিয়ম ↔ সাম্প্রতিক সাপোর্টার অল্টারনেটিং প্যানেল (বাম কলামে, নিচে) ----------
let altShowingRules = true;
function toggleAltPanel(){
  altShowingRules = !altShowingRules;
  document.getElementById("rulesView").classList.toggle("show", altShowingRules);
  document.getElementById("donorView").classList.toggle("show", !altShowingRules);
}
async function refreshRecentDonors(){
  try {
    const res = await fetch("/recent-donors/chessbattle?limit=6");
    const data = await res.json();
    const list = data.recent || [];
    document.getElementById("recentDonorList").innerHTML = list.length ? list.map(d =>
      '<div class="miniListRow">' +
      (d.photo ? '<img class="miniAvatar" src="'+d.photo+'">' : '<div class="miniAvatarFallback">'+(d.name[0]||"?")+'</div>') +
      '<div>'+d.name+' <span style="color:#FFD866;font-weight:700;">₹'+Math.round(d.amount)+'</span></div></div>'
    ).join("") : '<div style="font-size:11px;color:#5a6a8a;">No tips yet</div>';
  } catch(e){}
}
safeInit("leftAltPanel", () => { refreshRecentDonors(); setInterval(refreshRecentDonors, 20000); setInterval(toggleAltPanel, 9000); }); // প্রতি ৯ সেকেন্ডে নিয়ম ↔ সাম্প্রতিক সাপোর্টার পালাক্রমে দেখাবে

// ---------- সরাসরি টিপস QR ----------
fetch("/gaming/challenge/tip-info").then(r=>r.json()).then(d=>{
  if (d.tipUrl) {
    document.getElementById("tipQrImg").src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(d.tipUrl);
    document.getElementById("tipBoxOverlay").style.display = "block";
  }
});

// টপ ৩ সাপোর্টার — ৩টা স্থায়ী স্ট্যাক করা প্যানেল, প্রতিটাতে ৯০% ছবি + ১০% নাম/অ্যামাউন্ট
function fillTopSupporterPanel(idx, donor){
  const photoEl = document.getElementById("tsPhoto" + idx);
  const infoEl = document.getElementById("tsInfo" + idx);
  if (!donor) {
    photoEl.innerHTML = '<div class="tsRank">' + idx + '</div><div class="tsFallback">?</div>';
    infoEl.innerHTML = '<span style="color:#5a6a8a;">No tips yet</span>';
    return;
  }
  photoEl.innerHTML = '<div class="tsRank">' + idx + '</div>' +
    (donor.photo ? '<img src="'+donor.photo+'">' : '<div class="tsFallback">'+((donor.name&&donor.name[0])||"?")+'</div>');
  infoEl.innerHTML = donor.name + ' <span class="tsAmt">₹' + Math.round(donor.amount) + '</span>';
}
async function refreshTopDonors(){
  try {
    const res = await fetch("/top-donors/chessbattle");
    const data = await res.json();
    const top = data.top || [];
    fillTopSupporterPanel(1, top[0]);
    fillTopSupporterPanel(2, top[1]);
    fillTopSupporterPanel(3, top[2]);
  } catch(e){}
}
safeInit("topDonors", () => { refreshTopDonors(); setInterval(refreshTopDonors, 20000); }); // প্রতি ২০ সেকেন্ডে সবশেষ টপ ৩ রিফ্রেশ

// নতুন কোনো real payment এলে (verified, চেস চ্যানেলের) নাম নিয়ে সেলিব্রেশন
async function pollChessTips(){
  try {
    const res = await fetch("/events/chessbattle");
    const data = await res.json();
    const photos = data.photos || {};
    (data.events || []).forEach(ev => {
      const name = ev.name || "Anonymous";
      const amount = Math.round(ev.amount || 0);
      const photo = photos[name] || null;
      showDonorCelebration(name, amount, photo);
      playEndGameSound(true);
      // Fan Battle Live-এর মতোই Web Speech API দিয়ে — নাম + কত টাকা দিয়েছে দুটোই বলা হয়
      speakCeleb("Thank you " + name + " for the " + amount + " rupee tip!");
    });
  } catch(e){}
}
safeInit("pollChessTips", () => { setInterval(pollChessTips, 4000); });

// Fan Battle Live-এর মতোই — ছবি (থাকলে) বড় করে, নাম আর টাকার অ্যামাউন্ট সহ সেলিব্রেশন কার্ড
let donorCelebTimeout = null;
function showDonorCelebration(name, amount, photo){
  const card = document.getElementById("donorCelebration");
  const photoWrap = document.getElementById("donorCelebPhotoWrap");
  const photoImg = document.getElementById("donorCelebPhotoImg");
  if (photo) { photoImg.src = photo; photoWrap.style.display = "block"; }
  else { photoWrap.style.display = "none"; }
  document.getElementById("donorCelebName").textContent = name;
  document.getElementById("donorCelebAmount").textContent = "₹" + amount;
  card.classList.remove("show"); void card.offsetWidth; card.classList.add("show");
  launchConfetti();
  clearTimeout(donorCelebTimeout);
  donorCelebTimeout = setTimeout(() => card.classList.remove("show"), 4500);
}
</script></body></html>`;

// ---------------------------------------------------------------------------
// ৭. Scheduler — প্রতি মিনিটে চেক করে কোন block এখন active
// ---------------------------------------------------------------------------
let activeBlockId = { boardgames: null };

function nowInTZ(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" });
    const map = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { day: wd[map.weekday], hhmm: `${map.hour}:${map.minute}` };
  } catch (e) {
    // কিছু Windows/Node বিল্ডে "small-icu" থাকে, যেখানে timeZone সহ Intl.DateTimeFormat
    // কাজ না-ও করতে পারে। এই fallback সিস্টেমের নিজের লোকাল সময় ব্যবহার করে,
    // যাতে scheduler নিঃশব্দে ব্যর্থ না হয়ে অন্তত কাজ করতে থাকে।
    console.error("⚠️ Intl timezone সমস্যা, লোকাল সময় ব্যবহার করা হচ্ছে:", e.message);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return { day: now.getDay(), hhmm: `${hh}:${mm}` };
  }
}
function inRange(hhmm, start, end) {
  return start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}
async function schedulerTick() {
  console.log("⏱️ schedulerTick চলছে..."); // ডিবাগ লাইন — নিশ্চিত করবে ফাংশনটা আদৌ কল হচ্ছে কিনা
  const { day, hhmm } = nowInTZ(SCHEDULE.timezone);
  console.log(`   এখন: day=${day}, time=${hhmm}`); // ডিবাগ লাইন
  for (const channelKey of Object.keys(SCHEDULE.channels)) {
    const block = SCHEDULE.blocks.find((b) => b.channel === channelKey && b.days.includes(day) && inRange(hhmm, b.start, b.end));
    const blockId = block ? block.id : null;
    console.log(`   [${channelKey}] ম্যাচ করা ব্লক: ${blockId || "(কোনোটা না)"}`); // ডিবাগ লাইন
    if (blockId === activeBlockId[channelKey]) continue; // অপরিবর্তিত

    // ব্লক বদলাচ্ছে — আগেরটা বন্ধ করো
    if (channelKey === "boardgames") stopChessLoop();
    activeBlockId[channelKey] = blockId;

    if (block) {
      console.log(`[${channelKey}] ব্লক শুরু: ${block.id} (${block.game})`);
      if (block.game === "chess") runChessLoop();
      // এখানে ভবিষ্যতে YouTube broadcast auto-start যোগ করা যাবে (youtubeClient অংশ)
    }
  }
}

// ---------------------------------------------------------------------------
// ৮ক. চ্যালেঞ্জ/queue পেজের HTML — join ফর্ম, status/queue-position, ও খেলার পেজ
// ---------------------------------------------------------------------------
const SERVICE_WORKER_JS = `
self.addEventListener('push', function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Chess Battle Live';
  // "ring"-স্টাইল নোটিফিকেশনে অনেক লম্বা, বারবার কম্পনের প্যাটার্ন — ফোনের রিং-এর কাছাকাছি অনুভূতি
  // দেওয়ার জন্য এটাই সবচেয়ে বাস্তবসম্মত (Web Push API-তে সত্যিকারের অসীম-লুপ ringtone চালানো যায় না,
  // ব্রাউজার/OS নিজেই এটা নিরাপত্তার কারণে আটকে রাখে — তবে দীর্ঘ vibrate pattern + requireInteraction
  // মিলিয়ে এটাই সবচেয়ে কাছাকাছি যেটা দেওয়া সম্ভব)
  const vibratePattern = data.ring
    ? [400,150,400,150,400,150,400,150,400,150,400,150,400]
    : (data.requireInteraction ? [300, 100, 300, 100, 300] : [150, 60, 150]);
  const options = {
    body: data.body || '',
    tag: data.tag || 'general',
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    vibrate: vibratePattern,
    data: { url: data.url || '/gaming/challenge/status' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) { if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
`;

// দুই পেজেই (status ও join) পুশ-সাবস্ক্রাইব করার জন্য পুনরায় ব্যবহারযোগ্য স্ক্রিপ্ট
const PUSH_SETUP_JS = `
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}
async function setupPush(id, statusEl) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (statusEl) statusEl.textContent = 'Push notifications aren\\'t supported in this browser — keep this tab open to see live updates here instead.';
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.register('/gaming/sw.js', { scope: '/gaming/' });
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (statusEl) statusEl.textContent = 'Notification permission was not granted — you can enable it later in your browser settings.';
      return false;
    }
    const keyRes = await fetch('/gaming/vapid-public-key');
    const { key } = await keyRes.json();
    if (!key) { if (statusEl) statusEl.textContent = 'Push isn\\'t set up on the server yet.'; return false; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await fetch('/gaming/challenge/push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, subscription: sub }) });
    if (statusEl) statusEl.textContent = '🔔 Notifications are on — you\\'ll get an alert on your phone when it\\'s your turn.';
    return true;
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Something went wrong turning on notifications.';
    return false;
  }
}
`;

// ===========================================================================
// চলমান লাইভ স্ট্রিম — চ্যালেঞ্জ পেজের নিচে
// ---------------------------------------------------------------------------
// দর্শক লাইনে দাঁড়িয়ে অপেক্ষা করার সময় স্ট্রিমটাই দেখতে পাবে, আর নিজের পালা এলে
// নিজেকে লাইভে দেখতে পাবে — "হ্যাঁ, আমিই খেলছি, ওটা আমারই ছবি" — এটাই পুরো
// চ্যালেঞ্জ সিস্টেমটাকে বিশ্বাসযোগ্য করে তোলে।
//
// ⚠️ ইউটিউব চ্যানেল আইডি আগে চেসের play পেজে হাতে লেখা ছিল। এখন এক জায়গায় এসেছে,
// আর environment variable দিয়ে বদলানো যায় — ভবিষ্যতে চ্যানেল বদলালে কোড ছুঁতে হবে না।
// ===========================================================================
const GAMING_YT_CHANNEL_ID = process.env.GAMING_YT_CHANNEL_ID || "UCVP5_uwrKIp7rfMNgolnEqA";

const LIVE_EMBED_CSS = `
.liveWrap{width:100%;max-width:460px;margin:22px auto 30px;}
.liveWrap h3{font-size:12px;color:#FF6B5E;font-weight:800;letter-spacing:1px;text-transform:uppercase;
margin:0 0 8px;display:flex;align-items:center;gap:7px;justify-content:center;}
.liveWrap h3 i{width:8px;height:8px;border-radius:50%;background:#FF3B30;display:block;
animation:liveDot 1.4s ease-in-out infinite;}
@keyframes liveDot{0%,100%{opacity:1;}50%{opacity:0.25;}}
.liveFrameBox{position:relative;border-radius:12px;overflow:hidden;border:1px solid #2a3352;
background:#000;box-shadow:0 12px 34px rgba(0,0,0,0.6);}
.liveFrameBox iframe{width:100%;aspect-ratio:16/9;display:block;border:0;}
.liveNote{color:#6b7b9c;font-size:10.5px;margin-top:8px;line-height:1.6;text-align:center;}
.liveNote b{color:#8FA3CC;}
`;

// heading: প্যানেলের উপরে কী লেখা থাকবে
function liveEmbedHTML(heading) {
  return `
<div class="liveWrap">
  <h3><i></i>${heading}</h3>
  <div class="liveFrameBox">
    <iframe src="https://www.youtube.com/embed/live_stream?channel=${GAMING_YT_CHANNEL_ID}&autoplay=1&mute=1&playsinline=1"
      allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>
  </div>
  <div class="liveNote">
    🔇 Sound is off. Tap the speaker inside the video to turn it on.<br>
    ⏱ Live video is a few seconds behind, so your move shows up a little later. That is normal.<br>
    If nothing plays, the stream is not live right now.
  </div>
</div>`;
}

const CHALLENGE_JOIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Challenge Nur</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;background:#0a0e1f;color:#F5F7FA;font-family:sans-serif;padding:24px;max-width:460px;margin:0 auto;}
h1{font-size:22px;text-align:center;color:#FFD866;}
form{background:rgba(10,14,31,0.72);backdrop-filter:blur(5px);border-radius:14px;padding:16px;}
label{display:block;margin-top:16px;font-size:13px;color:#7C8AAD;}
input[type=text],input[type=number]{width:100%;padding:12px;border-radius:8px;border:1px solid #26314f;background:#131a2c;color:#fff;font-size:15px;margin-top:6px;}
input[type=file]{margin-top:8px;color:#7C8AAD;}
.tipBox{background:rgba(19,26,44,0.9);border:1px solid #26314f;border-radius:12px;padding:16px;margin-top:20px;font-size:13px;color:#B8C4D9;text-align:center;}
.tipBox b{color:#F5F7FA;}
/* ⚠️ আগে এখানে একটা QR কোড ছিল। কিন্তু দর্শক তো ইতিমধ্যেই ফোনে এই পেজটাই খুলে বসে আছে —
   নিজের ফোনের পর্দার QR নিজেই স্ক্যান করা যায় না! তাই QR সরিয়ে সরাসরি একটা বোতাম দেওয়া
   হলো, এক চাপে পেমেন্ট পেজ খুলে যায়। */
.helpBtn{display:block;width:100%;box-sizing:border-box;margin:14px 0 4px;padding:14px;
border-radius:10px;background:linear-gradient(135deg,#FF8A5B,#FFC53D);color:#0a0e1f;
font-weight:800;font-size:15px;text-decoration:none;text-align:center;}
.helpBtn small{display:block;font-weight:600;font-size:11px;opacity:0.75;margin-top:3px;}
.notFee{font-size:12px;color:#8BE28B;font-weight:700;margin-top:10px;line-height:1.5;}
${LIVE_EMBED_CSS}
.disclaimer{font-size:11px;color:#6b7b9c;margin-top:10px;line-height:1.6;text-align:left;background:#0f1526;border-radius:8px;padding:10px;}
button{width:100%;padding:14px;border-radius:10px;border:none;background:#FFD866;color:#0a0e1f;font-weight:800;
font-size:16px;margin-top:20px;cursor:pointer;}
</style></head><body>
${challengeBgLayer("chess-bg.mp4", "linear-gradient(135deg,#1a1206,#0a0e1f 45%,#0d1a2b)")}
<h1>♟️ Challenge Nur — Live!</h1>
<p style="text-align:center;color:#7C8AAD;font-size:14px;">Enter your name and photo to join the queue — when it's your turn, you'll play live on the board.</p>
<form id="joinForm" enctype="multipart/form-data">
  <label>Your name</label>
  <input type="text" name="name" required maxlength="30" placeholder="e.g. Alex">
  <label>Your photo (optional)</label>
  <input type="file" name="photo" accept="image/*">
  <div class="tipBox" id="tipBox" style="display:none;">
    <b>🙏 Want to help me out?</b>
    <div class="notFee">Playing is free. This is only if you want to help.</div>
    <a class="helpBtn" id="tipLink" href="#" target="_blank">💛 Send a Tip<small>Optional · Opens the payment page</small></a>
    <label style="text-align:left;">If you did send a tip, enter the amount (optional)</label>
    <input type="number" name="tipAmount" min="0" step="1" placeholder="e.g. 50">
    <div class="disclaimer">
      ⚠️ This is <b>not</b> an entry fee, tournament fee, or any kind of bet or gambling.
      Tipping does <b>not</b> improve your chances, your place in the queue, or your score —
      winning and losing have nothing to do with it. It is purely voluntary support for the
      streamer. The amount you type is only shown next to your name on screen; it is typed by
      you and is not automatically verified as a real payment.
    </div>
  </div>
  <button type="submit">Join queue (Skip & Play)</button>
</form>
${liveEmbedHTML("LIVE NOW")}
<script>
fetch("/gaming/challenge/tip-info").then(r=>r.json()).then(d=>{
  if (d.tipUrl) {
    document.getElementById("tipLink").href = d.tipUrl;
    document.getElementById("tipBox").style.display="block";
  }
});
${PUSH_SETUP_JS}
document.getElementById("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true; btn.textContent = "Joining queue...";
  const fd = new FormData(e.target);
  // Render-এর ফ্রি সার্ভার কিছুক্ষণ নিষ্ক্রিয় থাকলে "ঘুমিয়ে" যায়, প্রথম রিকোয়েস্টে জাগতে
  // ৫০+ সেকেন্ড লাগতে পারে — তাই দীর্ঘ সময় লাগলে স্পষ্ট বার্তা দেখানো, আর কোনো error হলে
  // বাটনটা যেন চিরকাল "Joining queue..." লেখা আটকে না থেকে যায়
  const slowNoticeTimer = setTimeout(() => {
    btn.textContent = "Still working — the server may be waking up, please wait...";
  }, 6000);
  try {
    const res = await fetch("/gaming/challenge/join", { method: "POST", body: fd });
    clearTimeout(slowNoticeTimer);
    if (!res.ok) throw new Error("Server returned an error (" + res.status + ")");
    const data = await res.json();
    if (data.id) {
      setupPush(data.id, null).catch(()=>{}); // ব্যাকগ্রাউন্ডে চেষ্টা করবে, আটকাবে না
      location.href = "/gaming/challenge/status?id=" + data.id;
    } else {
      throw new Error("No queue id returned");
    }
  } catch (err) {
    clearTimeout(slowNoticeTimer);
    btn.disabled = false;
    btn.textContent = "Could not join — tap to try again";
  }
});
</script></body></html>`;

const CHALLENGE_STATUS_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Queue Status</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
* { box-sizing: border-box; -webkit-tap-highlight-color:transparent; }
html,body{margin:0;height:100%;background:#0a0e1f;color:#F5F7FA;font-family:sans-serif;overflow:hidden;
touch-action:manipulation;}
#topBar{padding:8px 12px;text-align:center;}
#queueBadge{display:inline-flex;align-items:center;gap:8px;background:#161b2e;border:1px solid #2a3352;
border-radius:20px;padding:6px 16px;font-weight:800;}
#pos{color:#FFD866;font-size:18px;}
#msg{color:#7C8AAD;font-size:11px;margin-top:4px;}
/* স্পেকটেটর কার্ড — উপরে প্রতিপক্ষ, নিচে Nur, মাঝে বোর্ড (মোবাইল গেমিং অ্যাপের মতো লেআউট) */
.pCard{display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 10px;}
.pCard .av{width:30px;height:30px;border-radius:50%;object-fit:cover;background:#4FC3F7;flex-shrink:0;}
.pCard .avFallback{width:30px;height:30px;border-radius:50%;background:#4FC3F7;color:#0a0e1f;font-weight:900;
display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
.pCard .nm{font-weight:800;font-size:14px;}
.pCard .clk{font-variant-numeric:tabular-nums;font-weight:800;font-size:13px;color:#7C8AAD;
background:#0f1526;border-radius:6px;padding:2px 8px;margin-left:6px;}
.pCard .clk.active{color:#0a0e1f;background:#FFD866;}
#boardWrap{position:relative;width:min(94vw,66vh);margin:2px auto;}
#board{display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);
width:100%;aspect-ratio:1;border:4px solid #8a5a2a;}
.sq{display:flex;align-items:center;justify-content:center;font-size:clamp(20px,6.6vw,38px);position:relative;}
.light{background:#EFE0BF;} .dark{background:#5C3A21;}
.sq.lastFrom{box-shadow:inset 0 0 0 3px rgba(76,217,100,0.85);}
.sq.lastTo{box-shadow:inset 0 0 0 3px #FFD866;}
.piece{display:inline-block;}
.piece-w{background:linear-gradient(160deg,#ffffff 0%,#f0ede4 40%,#d4cbb8 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 1px 0 #6b6252) drop-shadow(0 3px 3px rgba(0,0,0,0.6));}
.piece-b{background:linear-gradient(160deg,#3a3a3a 0%,#181818 45%,#000000 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 1px 0 #000) drop-shadow(0 3px 3px rgba(0,0,0,0.7));}
.ghostPiece{position:absolute;pointer-events:none;z-index:20;transition:left 1.1s ease-in-out,top 1.1s ease-in-out;
font-size:clamp(20px,6.6vw,38px);}
#hud{padding:6px 12px 14px;text-align:center;}
.btnRow{display:flex;gap:8px;margin-top:8px;}
button{flex:1;padding:11px;border-radius:10px;border:none;font-weight:700;font-size:13px;cursor:pointer;}
#notifyBtn{background:#4FC3F7;color:#0a0e1f;}
#leaveBtn{background:#26314f;color:#F5F7FA;border:1px solid #3a4a70;}
#pushStatus{color:#5a6a8a;font-size:10px;margin-top:6px;min-height:12px;}
#alertBanner{position:fixed;top:0;left:0;right:0;background:#E8443D;color:#fff;font-weight:800;font-size:14px;
  text-align:center;padding:10px;display:none;animation:pulse 1s infinite;z-index:30;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.55;}}
${LIVE_EMBED_CSS}
</style></head><body>
<div id="alertBanner">🔔 Your turn is almost here — only 2 people left, get ready!</div>
<div id="topBar">
  <div id="queueBadge"><span id="pos">...</span></div>
  <div id="msg">Loading...</div>
</div>
<div class="pCard" id="oppCard"><div class="avFallback" id="oppAv">?</div><div class="nm" id="oppName">—</div><div class="clk" id="oppClock" style="display:none;">10:00</div></div>
<div id="boardWrap"><div id="board"></div></div>
<div class="pCard" id="whiteCard"><div class="avFallback" id="whiteAv">N</div><div class="nm" id="whiteName">Nur</div><div class="clk" id="whiteClock" style="display:none;">10:00</div></div>
<div id="hud">
  <div class="btnRow">
    <button id="notifyBtn">🔔 Turn on notifications</button>
    <button id="leaveBtn">✖ Leave the queue</button>
  </div>
  <div id="pushStatus"></div>
</div>
<script>
${PUSH_SETUP_JS}
const params = new URLSearchParams(location.search);
const id = params.get("id");
let audioCtx = null;
function beep(freqs, loud){
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f,i)=>{
      const t = audioCtx.currentTime + i*0.18;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(loud?0.3:0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t+0.35);
      osc.connect(g).connect(audioCtx.destination); osc.start(t); osc.stop(t+0.4);
    });
  }catch(e){}
}
document.getElementById("notifyBtn").addEventListener("click", async () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  const ok = await setupPush(id, document.getElementById("pushStatus"));
  if (ok) document.getElementById("notifyBtn").style.display = "none";
});
document.getElementById("leaveBtn").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to leave the queue?")) return;
  await fetch("/gaming/challenge/leave", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id }) });
  document.getElementById("msg").textContent = "You have left the queue. Thank you!";
  document.getElementById("pos").textContent = "—";
});
let lastPosition = null;
let ringTimer = null;
function startRinging(){
  if (ringTimer) return; // আগে থেকেই বাজতে থাকলে আবার শুরু করার দরকার নেই
  beep([600,900], true);
  ringTimer = setInterval(() => beep([600,900], true), 2500); // ফোনের রিং-এর মতো বারবার বাজতে থাকবে
  if (navigator.vibrate) navigator.vibrate([400,150,400,150,400]);
}
function stopRinging(){
  if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
}
async function pollQueue(){
  try{
    const res = await fetch("/gaming/challenge/queue-state?id="+id);
    const data = await res.json();
    if (data.isYourTurn) { stopRinging(); location.href = "/gaming/challenge/play?id="+id; return; }
    if (data.position) {
      document.getElementById("pos").textContent = "#"+data.position;
      document.getElementById("msg").textContent = data.total+" people total in the queue, please wait...";
      const banner = document.getElementById("alertBanner");
      if (data.position === 1) {
        // ঠিক আপনার আগের ম্যাচটাই এখন চলছে — এখন থেকেই "রিং" বাজতে থাকবে, ট্যাব খোলা/ফোন আনলক থাকলে
        banner.textContent = "📞 Your turn is coming up next — get ready!";
        banner.style.display = "block";
        startRinging();
      } else {
        stopRinging();
        if (data.position <= 3 && lastPosition !== data.position) {
          if (data.position === 3) { banner.textContent = "🔔 Your turn is almost here — only 2 people left, get ready!"; banner.style.display = "block"; beep([880,660,880,660],true); setTimeout(()=>banner.style.display="none", 6000); }
          else beep([520,700], false);
        }
      }
      lastPosition = data.position;
    } else {
      stopRinging();
      document.getElementById("pos").textContent = "—";
      document.getElementById("msg").textContent = "Your turn may already be over, or the queue entry cannot be found.";
    }
  }catch(e){}
}
setInterval(pollQueue, 3000); pollQueue();

// ---------- সরাসরি live board (native, iframe না — মোবাইলে বড়/স্পষ্ট দেখানোর জন্য) ----------
const PIECE_GLYPH = { p:"♟",r:"♜",n:"♞",b:"♝",q:"♛",k:"♚", P:"♟",R:"♜",N:"♞",B:"♝",Q:"♛",K:"♚" };
function squareName(r,c){ return "abcdefgh"[c] + (8-r); }
function squareToRC(sq){ return { r: 8 - parseInt(sq[1],10), c: sq.charCodeAt(0) - 97 }; }
let lastRenderedFenStatus = "";
let lastRenderedMoveKeyStatus = "";
function renderStatusBoard(fen, lastMove, animate){
  const boardEl = document.getElementById("board");
  const boardPart = fen.split(" ")[0];
  const moveKey = lastMove ? (lastMove.from+lastMove.to+fen.length) : "";
  const shouldAnimate = animate && lastMove && moveKey !== lastRenderedMoveKeyStatus;
  if (!shouldAnimate && boardPart === lastRenderedFenStatus) { lastRenderedMoveKeyStatus = moveKey; return; }
  lastRenderedMoveKeyStatus = moveKey;
  const rows = boardPart.split("/");
  const grid = [];
  for (let r=0;r<8;r++){
    let col=0;
    for (const ch of rows[r]) {
      if (/[0-9]/.test(ch)) { const n=parseInt(ch,10); for(let i=0;i<n;i++){grid.push({r,c:col,piece:""});col++;} }
      else { grid.push({r,c:col,piece:ch}); col++; }
    }
  }
  if (shouldAnimate) {
    const fromEl = boardEl.querySelector('[data-square="'+lastMove.from+'"]');
    const toEl = boardEl.querySelector('[data-square="'+lastMove.to+'"]');
    const toRC = squareToRC(lastMove.to);
    const movingPiece = grid.find(g => squareName(g.r,g.c) === lastMove.to);
    if (fromEl && toEl && movingPiece && movingPiece.piece) {
      const wrap = document.getElementById("boardWrap");
      const wrapRect = wrap.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const ghost = document.createElement("div");
      const isWhite = movingPiece.piece === movingPiece.piece.toUpperCase();
      ghost.className = "ghostPiece piece " + (isWhite ? "piece-w" : "piece-b");
      ghost.textContent = PIECE_GLYPH[movingPiece.piece] || "";
      ghost.style.left = (fromRect.left - wrapRect.left) + "px";
      ghost.style.top = (fromRect.top - wrapRect.top) + "px";
      ghost.style.width = fromRect.width + "px";
      ghost.style.height = fromRect.height + "px";
      ghost.style.display = "flex"; ghost.style.alignItems = "center"; ghost.style.justifyContent = "center";
      wrap.appendChild(ghost);
      statusDrawGrid(grid, lastMove, true);
      requestAnimationFrame(() => {
        ghost.style.left = (toRect.left - wrapRect.left) + "px";
        ghost.style.top = (toRect.top - wrapRect.top) + "px";
      });
      setTimeout(() => { ghost.remove(); statusDrawGrid(grid, lastMove, false); lastRenderedFenStatus = boardPart; }, 1150);
      return;
    }
  }
  statusDrawGrid(grid, lastMove, false);
  lastRenderedFenStatus = boardPart;
}
function statusDrawGrid(grid, lastMove, hideDestination){
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  grid.forEach(g => {
    const sq = document.createElement("div");
    const sqName = squareName(g.r,g.c);
    let cls = "sq " + ((g.r+g.c)%2===0?"light":"dark");
    if (lastMove && sqName === lastMove.from) cls += " lastFrom";
    if (lastMove && sqName === lastMove.to) cls += " lastTo";
    sq.className = cls;
    sq.dataset.square = sqName;
    const piece = (hideDestination && lastMove && sqName===lastMove.to) ? "" : g.piece;
    if (piece) {
      const isWhite = piece === piece.toUpperCase();
      sq.innerHTML = '<span class="piece ' + (isWhite ? "piece-w" : "piece-b") + '">' + (PIECE_GLYPH[piece]||"") + '</span>';
    }
    boardEl.appendChild(sq);
  });
}
function fmtClock(ms){ const s = Math.max(0, Math.round(ms/1000)); return String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0"); }
async function pollBoard(){
  try{
    const res = await fetch("/gaming/state/chess.json?t="+Date.now());
    const data = await res.json();
    renderStatusBoard(data.fen, data.lastMove, true);
    document.getElementById("whiteName").textContent = data.whiteName || "Nur";
    document.getElementById("oppName").textContent = data.blackName || "—";
    const wAv = document.getElementById("whiteAv");
    if (data.whiteAvatarUrl) wAv.outerHTML = '<img class="av" id="whiteAv" src="'+data.whiteAvatarUrl+'">';
    const oAv = document.getElementById("oppAv");
    if (data.blackAvatarUrl && oAv.tagName !== "IMG") oAv.outerHTML = '<img class="av" id="oppAv" src="'+data.blackAvatarUrl+'">';
    else if (!data.blackAvatarUrl) document.getElementById("oppAv").textContent = (data.blackName||"?")[0] || "?";
    if (typeof data.whiteMs === "number" && typeof data.blackMs === "number") {
      const isWhiteTurn = data.fen && data.fen.includes(" w ");
      const wc = document.getElementById("whiteClock"), oc = document.getElementById("oppClock");
      wc.style.display = "inline-block"; oc.style.display = "inline-block";
      wc.textContent = fmtClock(data.whiteMs); oc.textContent = fmtClock(data.blackMs);
      wc.classList.toggle("active", isWhiteTurn); oc.classList.toggle("active", !isWhiteTurn);
    }
  }catch(e){}
}
setInterval(pollBoard, 1500); pollBoard();
</script>
${liveEmbedHTML("LIVE NOW")}
</body></html>`;

// ---------------------------------------------------------------------------
// অ্যাডমিন-শুধু সেটিংস পেজ — ব্যাকগ্রাউন্ড মিউজিক, কাস্টম কমেন্ট্রি অডিও, সেলিব্রেশন ভয়েস।
// ⚠️ এই পেজটা কোনো পাবলিক পেজ (overlay, join, status) থেকে link করা নেই এবং কোনো
// iframe-এ embed হয় না — শুধু আপনি নিজে সরাসরি এই URL-এ গিয়ে ব্যবহার করবেন।
// ---------------------------------------------------------------------------
const CHESS_ADMIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Chess Overlay Admin Settings</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<style>
body{margin:0;background:#0a0e1f;color:#F5F7FA;font-family:sans-serif;padding:24px;max-width:560px;margin:0 auto;}
h1{color:#FFD866;font-size:20px;}
.warn{background:#2a1a1a;border:1px solid #5c2a2a;border-radius:8px;padding:10px 14px;font-size:12px;color:#E8998F;margin-top:10px;}
label{display:block;margin-top:16px;font-size:12px;color:#7C8AAD;font-weight:700;}
input[type=text],input[type=number],textarea,select{width:100%;padding:10px;border-radius:8px;border:1px solid #26314f;
background:#131a2c;color:#fff;font-size:14px;margin-top:6px;font-family:inherit;box-sizing:border-box;}
textarea{min-height:110px;resize:vertical;}
input[type=range]{width:100%;margin-top:8px;}
button{padding:12px 18px;border-radius:8px;border:none;background:#FFD866;color:#0a0e1f;font-weight:800;
font-size:14px;cursor:pointer;margin-top:10px;}
.secondary{background:#26314f;color:#fff;font-size:12px;padding:8px 14px;}
#status{margin-top:12px;font-size:13px;color:#8BE28B;min-height:18px;}
</style></head><body>
<h1>Chess Overlay — Admin Settings</h1>
<div class="warn">This link is private — do not share it in the YouTube description or with viewers. It is not linked from any public page.</div>
<form id="cfgForm">
  <label>Background music link (copyright-free MP3/audio URL — leave blank for no music)</label>
  <input type="text" id="bgMusicUrlInput" placeholder="https://...mp3">

  <label>Music volume — <span id="volLabel">15%</span></label>
  <input type="range" id="bgMusicVolumeInput" min="0" max="1" step="0.05" value="0.15">

  <label>Your own recorded commentary audio links (one URL per line — cycles through them if more than one)</label>
  <textarea id="commentaryUrlsInput" placeholder="https://example.com/commentary1.mp3"></textarea>

  <label>Seconds between commentary clips (example: 90 = every 1.5 minutes)</label>
  <input type="number" id="loopIntervalInput" min="20" value="90">

  <label>Donor celebration voice (Web Speech API — voices available in this browser)</label>
  <select id="celebVoiceSelect"></select>
  <button type="button" id="testVoiceBtn" class="secondary">Test voice</button>

  <button type="submit">Save</button>
  <div id="status"></div>
</form>

<script>
let availableVoices = [];
function scoreVoice(v){
  let score = 0;
  if (/bn|beng|india|hindi/i.test(v.lang) || /bn|beng|india/i.test(v.name)) score += 5;
  if (/en-IN|en-GB|en-US/i.test(v.lang)) score += 2;
  if (/Google|Natural|Neural|Premium/i.test(v.name)) score += 3;
  return score;
}
function populateVoices(savedURI){
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const sel = document.getElementById("celebVoiceSelect");
  if (!availableVoices.length) { sel.innerHTML = "<option value=" + JSON.stringify("") + ">No voices found yet, try again in a moment</option>"; return; }
  const sorted = availableVoices.slice().sort((a,b) => scoreVoice(b) - scoreVoice(a));
  sel.innerHTML = sorted.map(v => "<option value=" + JSON.stringify(v.voiceURI) + ">" + v.name + " (" + v.lang + ")</option>").join("");
  const match = savedURI ? sorted.find(v => v.voiceURI === savedURI) : null;
  selectedVoice = match || sorted[0];
  if (selectedVoice) sel.value = selectedVoice.voiceURI;
}
document.getElementById("celebVoiceSelect").addEventListener("change", function(e){
  selectedVoice = availableVoices.find(v => v.voiceURI === e.target.value) || null;
});
document.getElementById("testVoiceBtn").addEventListener("click", function(){
  if (!window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance("Thank you Rahim for the fifty rupee tip!");
  if (selectedVoice) utter.voice = selectedVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
});
let loadedURI = "";
fetch("/gaming/chess-config").then(function(r){ return r.json(); }).then(function(cfg){
  document.getElementById("bgMusicUrlInput").value = cfg.bgMusicUrl || "";
  document.getElementById("bgMusicVolumeInput").value = cfg.bgMusicVolume != null ? cfg.bgMusicVolume : 0.15;
  document.getElementById("volLabel").textContent = Math.round((cfg.bgMusicVolume != null ? cfg.bgMusicVolume : 0.15) * 100) + "%";
  document.getElementById("commentaryUrlsInput").value = (cfg.commentaryUrls || []).join(String.fromCharCode(10));
  document.getElementById("loopIntervalInput").value = cfg.loopIntervalSec || 90;
  loadedURI = cfg.celebVoiceURI || "";
  populateVoices(loadedURI);
});
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = function(){ populateVoices(loadedURI); };
document.getElementById("bgMusicVolumeInput").addEventListener("input", function(e){
  document.getElementById("volLabel").textContent = Math.round(e.target.value * 100) + "%";
});
document.getElementById("cfgForm").addEventListener("submit", function(e){
  e.preventDefault();
  const linesRaw = document.getElementById("commentaryUrlsInput").value;
  const lines = linesRaw.split(String.fromCharCode(10)).map(function(s){ return s.trim(); }).filter(Boolean);
  const body = {
    bgMusicUrl: document.getElementById("bgMusicUrlInput").value.trim(),
    bgMusicVolume: parseFloat(document.getElementById("bgMusicVolumeInput").value) || 0.15,
    commentaryUrls: lines,
    loopIntervalSec: parseInt(document.getElementById("loopIntervalInput").value, 10) || 90,
    celebVoiceURI: selectedVoice ? selectedVoice.voiceURI : "",
  };
  const statusEl = document.getElementById("status");
  fetch("/gaming/chess-admin", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) })
    .then(function(res){ statusEl.textContent = res.ok ? "Saved. Takes effect on the live overlay within about 15 seconds." : "Could not save."; })
    .catch(function(){ statusEl.textContent = "Could not save — network problem."; });
});
</script></body></html>`;

const CHALLENGE_PLAY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Your Move!</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body{margin:0;background:#0a0e1f;color:#fff;font-family:sans-serif;text-align:center;
touch-action:manipulation;overscroll-behavior:none;height:100%;overflow:hidden;} /* touch-action:manipulation — ব্রাউজারের ডিফল্ট ~৩০০ms ট্যাপ-ডিলে বাদ, টাচ সাথে সাথে কার্যকর হবে */
h1{color:#FFD866;font-size:15px;margin:6px 0;}
#boardWrap{position:relative;width:min(96vw,88vh);margin:4px auto;}
#board{display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);
width:100%;aspect-ratio:1;border:4px solid #8a5a2a;transition:transform 0.3s;touch-action:manipulation;}
#board.flipped{transform:rotate(180deg);}
.sq{display:flex;align-items:center;justify-content:center;font-size:clamp(22px,7.5vw,44px);cursor:pointer;position:relative;touch-action:manipulation;}
.light{background:#EFE0BF;} .dark{background:#5C3A21;}
.sq.sel{box-shadow:inset 0 0 0 3px #FFD866;}
.sq.lastFrom{box-shadow:inset 0 0 0 3px rgba(76,217,100,0.85);}
.sq.lastTo{box-shadow:inset 0 0 0 3px #FFD866;}
.piece{display:inline-block;}
#board.flipped .piece{transform:rotate(180deg);} /* বোর্ড উল্টানো থাকলে গুটির লেখা যেন উল্টো না দেখায় */
.piece-w{background:linear-gradient(160deg,#ffffff 0%,#f0ede4 40%,#d4cbb8 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 1px 0 #6b6252) drop-shadow(0 3px 3px rgba(0,0,0,0.6));}
.piece-b{background:linear-gradient(160deg,#3a3a3a 0%,#181818 45%,#000000 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 1px 0 #000) drop-shadow(0 3px 3px rgba(0,0,0,0.7));}
.ghostPiece{position:absolute;font-size:clamp(22px,7.5vw,44px);pointer-events:none;z-index:20;transition:left 1.1s ease-in-out,top 1.1s ease-in-out;}
#status{color:#7C8AAD;font-size:12px;margin-top:6px;padding:0 10px;}
/* মোবাইলে শুধু বোর্ডটাই যেন সম্পূর্ণ স্ক্রিন জুড়ে দেখা যায় — YouTube লাইভ আর অন্য সব বাদ (নিচে স্ক্রল করলে পাওয়া যাবে, কিন্তু ডিফল্টে দেখা যাবে না) */
${LIVE_EMBED_CSS}
#celebrate{position:fixed;inset:0;background:#0a0e1f;display:flex;flex-direction:column;align-items:center;
  justify-content:center;z-index:50;transition:opacity 0.5s;}
#celebrate img,#celebrate .avatarFallback{width:110px;height:110px;border-radius:50%;object-fit:cover;
  border:4px solid #FFD866;box-shadow:0 0 30px rgba(255,216,102,0.6);}
#celebrate .avatarFallback{display:flex;align-items:center;justify-content:center;background:#4FC3F7;
  color:#0a0e1f;font-weight:900;font-size:44px;}
#celebrate .cName{font-size:28px;font-weight:900;color:#FFD866;margin-top:16px;text-align:center;padding:0 20px;}
#celebrate .cSub{color:#B8C4D9;font-size:14px;margin-top:6px;}
#celebrate .confetti{font-size:30px;margin-top:14px;letter-spacing:6px;}
</style></head><body>
<div id="celebrate" style="display:none;">
  <div id="celebAvatarWrap"></div>
  <div class="cName" id="celebName"></div>
  <div class="cSub">Your turn has started!</div>
  <div class="confetti">🎉 ♟️ 🎊 ✨</div>
</div>
<h1>Your move! You are playing Black</h1>
<div id="clockRow" style="display:none;font-weight:800;font-size:16px;font-variant-numeric:tabular-nums;margin:2px 0;">
  <span id="clockYou" style="color:#FFD866;">10:00</span> <span style="color:#5a6a8a;font-size:11px;">you</span>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <span id="clockOpp" style="color:#7C8AAD;">10:00</span> <span style="color:#5a6a8a;font-size:11px;">Nur</span>
</div>
<div id="boardWrap"><div id="board"></div></div>
<div id="status">Loading...</div>
${liveEmbedHTML("LIVE NOW")}
<script>
const params = new URLSearchParams(location.search);
const id = params.get("id");
const PIECE_GLYPH = { p:"♟",r:"♜",n:"♞",b:"♝",q:"♛",k:"♚", P:"♟",R:"♜",N:"♞",B:"♝",Q:"♛",K:"♚" };
let selected = null;
let hasCelebrated = false;
let audioCtx = null;
function smallAlarm(){
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    [660,880].forEach((f,i)=>{
      const t = audioCtx.currentTime + i*0.15;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t+0.3);
      osc.connect(g).connect(audioCtx.destination); osc.start(t); osc.stop(t+0.35);
    });
  }catch(e){}
}
// "স্যাটিসফাইং" গুটি-বসার শব্দ — filtered noise "tap" + কাঠের মতো উষ্ণ tone মিলিয়ে,
// প্রত্যেকটা চালের সাথে সাথেই বাজে (কোনো নির্দিষ্ট সময় পর পর না)
function playMoveSound(isCapture) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const baseFreq = isCapture ? 260 : 380;
    const bufSize = Math.floor(audioCtx.sampleRate * 0.03);
    const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    const noise = audioCtx.createBufferSource(); noise.buffer = noiseBuf;
    const noiseFilter = audioCtx.createBiquadFilter(); noiseFilter.type = "bandpass"; noiseFilter.frequency.value = baseFreq * 2.2; noiseFilter.Q.value = 1.2;
    const noiseGain = audioCtx.createGain(); noiseGain.gain.setValueAtTime(0.22, t); noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    noise.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination); noise.start(t);

    const osc1 = audioCtx.createOscillator(); const g1 = audioCtx.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(baseFreq, t);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, t + 0.1);
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc1.connect(g1).connect(audioCtx.destination);
    osc1.start(t); osc1.stop(t + 0.14);

    const osc2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(baseFreq * 0.5, t);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc2.connect(g2).connect(audioCtx.destination);
    osc2.start(t); osc2.stop(t + 0.22);
  } catch (e) {}
}
// কাঠের গুটি "পড়ে গিয়ে" এলিমিনেট হওয়ার শব্দ — capture-এর মুহূর্তে বাজে
function playCaptureFallSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [0, 0.09, 0.16, 0.21].forEach((delay, i) => {
      const tt = t + delay;
      const freq = 180 - i * 25;
      const vol = 0.16 - i * 0.03;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(freq, tt);
      g.gain.setValueAtTime(Math.max(0.02, vol), tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.08);
      osc.connect(g).connect(audioCtx.destination); osc.start(tt); osc.stop(tt + 0.09);
    });
  } catch (e) {}
}
function runCelebration(name, photoUrl){
  hasCelebrated = true;
  const wrap = document.getElementById("celebAvatarWrap");
  wrap.innerHTML = photoUrl
    ? '<img src="'+photoUrl+'">'
    : '<div class="avatarFallback">'+((name&&name[0])||"?")+'</div>';
  document.getElementById("celebName").textContent = "🎉 " + (name||"Player") + " 🎉";
  document.getElementById("celebrate").style.display = "flex";
  document.getElementById("celebrate").style.opacity = "1";
  smallAlarm();
  setTimeout(() => {
    document.getElementById("celebrate").style.opacity = "0";
    setTimeout(() => { document.getElementById("celebrate").style.display = "none"; }, 500);
  }, 2500); // ২.৫ সেকেন্ড সেলিব্রেশন, তারপর অটোমেটিক্যালি সরে গিয়ে বোর্ড দেখাবে
}
function squareName(r,c){ return "abcdefgh"[c] + (8-r); }
function squareToRC(sq){ return { r: 8 - parseInt(sq[1],10), c: sq.charCodeAt(0) - 97 }; }
function getPieceAtRC(fenBoardPart, rc) {
  if (!rc) return "";
  const rows = fenBoardPart.split("/");
  const row = rows[rc.r];
  if (!row) return "";
  let col = 0;
  for (const ch of row) {
    if (/[0-9]/.test(ch)) { col += parseInt(ch, 10); }
    else { if (col === rc.c) return ch; col++; }
  }
  return "";
}
let lastRenderedMoveKey = "";
let prevFenBoardPlay = "";
let lastRenderedFenPlay = "";
function renderBoard(fen, lastMove, animate){
  const boardEl = document.getElementById("board");
  boardEl.classList.add("flipped"); // আপনি সবসময় কালো ঘুঁটি খেলছেন — নিজের গুটি সবসময় নিচে দেখানোই স্বাভাবিক
  const boardPart = fen.split(" ")[0];
  const moveKey = lastMove ? (lastMove.from+lastMove.to+fen.length) : "";
  const shouldAnimate = animate && lastMove && moveKey !== lastRenderedMoveKey;
  // ⚡ টাচ রেসপন্স দ্রুত রাখতে — নতুন কোনো চাল না থাকলে আর বোর্ড state অপরিবর্তিত থাকলে DOM পুনরায়
  // তৈরি করা হয় না। আগে প্রতি ১.৫ সেকেন্ডের poll-এ বোর্ডের সবকটা (৬৪টা) square DOM থেকে মুছে আবার
  // তৈরি হতো, এমনকি কিছুই না বদলালেও — কেউ ঠিক তখন ট্যাপ করলে সেই ট্যাপটা হারিয়ে যেত, "স্লো" মনে হতো
  if (!shouldAnimate && boardPart === lastRenderedFenPlay) { lastRenderedMoveKey = moveKey; return; }
  lastRenderedMoveKey = moveKey;
  const rows = boardPart.split("/");
  const grid = [];
  for (let r=0;r<8;r++){
    let col=0;
    for (const ch of rows[r]) {
      if (/[0-9]/.test(ch)) { const n=parseInt(ch,10); for(let i=0;i<n;i++){grid.push({r,c:col,piece:""});col++;} }
      else { grid.push({r,c:col,piece:ch}); col++; }
    }
  }

  if (shouldAnimate) {
    // চাল দেওয়ার সময় গুটিটা যেন এক ঘর থেকে আরেক ঘরে চোখের সামনে দিয়ে সরে যায় (হুট করে "টেলিপোর্ট" না করে)।
    // capture হলে — মৃত গুটিটা attacker সত্যিই পৌঁছানোর আগ পর্যন্ত জায়গায়ই থাকবে, আচমকা উধাও হবে না।
    // ⚡ গুরুত্বপূর্ণ ফিক্স: আগে animation-এর প্রতিটা ধাপে পুরো বোর্ড (৬৪টা square) DOM থেকে মুছে
    // আবার তৈরি হতো — এই মুহূর্তে কেউ অন্য কোনো ঘরে (যেমন capture করার জন্য) ট্যাপ করলে সেই ঘরের
    // element-টাই হারিয়ে যেত, ট্যাপ কাজ করতো না (এটাই "টাচ কাজ করছে না" সমস্যার আসল কারণ ছিল,
    // কোনো ইচ্ছাকৃত block/চিটিং না)। এখন শুধু from আর to — এই দুইটা ঘর ছাড়া বাকি ৬২টা ঘরের
    // DOM element কখনোই touch হয় না, তাই সেগুলোতে ট্যাপ সবসময় নির্ভরযোগ্যভাবে কাজ করবে।
    const fromEl = boardEl.querySelector('[data-square="'+lastMove.from+'"]');
    const toEl = boardEl.querySelector('[data-square="'+lastMove.to+'"]');
    const toRC = squareToRC(lastMove.to);
    const movingPiece = grid.find(g => squareName(g.r,g.c) === lastMove.to);
    const capturedPieceChar = prevFenBoardPlay ? getPieceAtRC(prevFenBoardPlay, toRC) : "";
    if (fromEl && toEl && movingPiece && movingPiece.piece) {
      const wrap = document.getElementById("boardWrap");
      const wrapRect = wrap.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const ghost = document.createElement("div");
      const isWhite = movingPiece.piece === movingPiece.piece.toUpperCase();
      ghost.className = "ghostPiece piece " + (isWhite ? "piece-w" : "piece-b");
      ghost.textContent = PIECE_GLYPH[movingPiece.piece] || "";
      const ANIM_MS = 1300;
      ghost.style.left = (fromRect.left - wrapRect.left) + "px";
      ghost.style.top = (fromRect.top - wrapRect.top) + "px";
      ghost.style.width = fromRect.width + "px";
      ghost.style.height = fromRect.height + "px";
      ghost.style.display = "flex"; ghost.style.alignItems = "center"; ghost.style.justifyContent = "center";
      ghost.style.transition = "left "+(ANIM_MS/1000)+"s ease-in-out,top "+(ANIM_MS/1000)+"s ease-in-out,transform "+(ANIM_MS/1000)+"s ease-in-out";
      ghost.style.filter = "drop-shadow(0 8px 10px rgba(0,0,0,0.6))";
      wrap.appendChild(ghost);
      // পুরনো highlight সরিয়ে শুধু from/to ঘর দুটোই surgically আপডেট — বাকি বোর্ড অক্ষত থাকে
      clearHighlights(boardEl);
      setSquareContent(boardEl, lastMove.from, "", true, false);
      setSquareContent(boardEl, lastMove.to, capturedPieceChar, false, true);
      if (capturedPieceChar) { setTimeout(() => playCaptureFallSound(), 30); } // মৃত গুটিটা "পড়ে যাওয়ার" শব্দ, ঘোড়া/আক্রমণকারী পৌঁছানোর আগেই
      const isKnight = movingPiece.piece.toLowerCase() === "n";
      if (isKnight) {
        // ঘোড়ার আসল "L" আকৃতির পথ ধরে চলা দেখানো — সরাসরি কোনাকুনি "শর্টকাট" না নিয়ে
        const fromRC = squareToRC(lastMove.from);
        const dr = toRC.r - fromRC.r, dc = toRC.c - fromRC.c;
        const longAxisIsRow = Math.abs(dr) === 2;
        const midRC = longAxisIsRow ? { r: fromRC.r + dr, c: fromRC.c } : { r: fromRC.r, c: fromRC.c + dc };
        const midEl = document.getElementById("board").querySelector('[data-square="' + squareName(midRC.r, midRC.c) + '"]');
        const midRect = midEl ? midEl.getBoundingClientRect() : null;
        ghost.style.transition = "left "+(ANIM_MS*0.55/1000)+"s ease-in,top "+(ANIM_MS*0.55/1000)+"s ease-in,transform "+(ANIM_MS*0.55/1000)+"s ease-in-out";
        requestAnimationFrame(() => {
          ghost.style.transform = "scale(1.15)";
          if (midRect) { ghost.style.left = (midRect.left - wrapRect.left) + "px"; ghost.style.top = (midRect.top - wrapRect.top) + "px"; }
        });
        setTimeout(() => {
          ghost.style.transition = "left "+(ANIM_MS*0.45/1000)+"s ease-out,top "+(ANIM_MS*0.45/1000)+"s ease-out,transform "+(ANIM_MS*0.45/1000)+"s ease-in-out";
          ghost.style.transform = "scale(1)";
          ghost.style.left = (toRect.left - wrapRect.left) + "px";
          ghost.style.top = (toRect.top - wrapRect.top) + "px";
        }, ANIM_MS * 0.55);
      } else {
        requestAnimationFrame(() => {
          ghost.style.transform = "scale(1.1)";
          ghost.style.left = (toRect.left - wrapRect.left) + "px";
          ghost.style.top = (toRect.top - wrapRect.top) + "px";
        });
        setTimeout(() => { ghost.style.transform = "scale(1)"; }, ANIM_MS - 150);
      }
      setTimeout(() => {
        ghost.remove();
        setSquareContent(boardEl, lastMove.to, movingPiece.piece, false, true); // attacker এসে পৌঁছালো
        playMoveSound(!!capturedPieceChar);
        prevFenBoardPlay = boardPart; lastRenderedFenPlay = boardPart;
      }, ANIM_MS);
      return;
    }
  }
  prevFenBoardPlay = boardPart;
  lastRenderedFenPlay = boardPart;
  drawGrid(grid, lastMove, false);
}
// শুধু নির্দিষ্ট একটা ঘরের ভেতরের গুটি/highlight বদলায় — পুরো বোর্ড DOM থেকে মোছা হয় না,
// তাই বাকি সব ঘরের click listener অক্ষত থাকে (এটাই টাচ নির্ভরযোগ্য রাখার মূল চাবিকাঠি)
function setSquareContent(boardEl, sqName, piece, isFrom, isTo) {
  const sq = boardEl.querySelector('[data-square="' + sqName + '"]');
  if (!sq) return;
  sq.classList.toggle("lastFrom", !!isFrom);
  sq.classList.toggle("lastTo", !!isTo);
  if (piece) {
    const isWhite = piece === piece.toUpperCase();
    sq.innerHTML = '<span class="piece ' + (isWhite ? "piece-w" : "piece-b") + '">' + (PIECE_GLYPH[piece] || "") + '</span>';
  } else {
    sq.innerHTML = "";
  }
}
function clearHighlights(boardEl) {
  boardEl.querySelectorAll(".lastFrom,.lastTo").forEach(el => { el.classList.remove("lastFrom"); el.classList.remove("lastTo"); });
}
function drawGrid(grid, lastMove, hideDestination){
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  grid.forEach(g => addSq(g.r, g.c, (hideDestination && lastMove && squareName(g.r,g.c)===lastMove.to) ? "" : g.piece, lastMove));
}
function addSq(r,c,piece,lastMove){
  const sq = document.createElement("div");
  const sqName = squareName(r,c);
  let cls = "sq " + ((r+c)%2===0?"light":"dark");
  if (lastMove && sqName === lastMove.from) cls += " lastFrom";
  if (lastMove && sqName === lastMove.to) cls += " lastTo";
  sq.className = cls;
  sq.dataset.square = sqName;
  if (piece) {
    const isWhite = piece === piece.toUpperCase();
    sq.innerHTML = '<span class="piece ' + (isWhite ? "piece-w" : "piece-b") + '">' + (PIECE_GLYPH[piece]||"") + '</span>';
  }
  sq.addEventListener("click", onSquareClick);
  document.getElementById("board").appendChild(sq);
}
function onSquareClick(e){
  const sq = e.currentTarget.dataset.square;
  if (!selected) { selected = sq; e.currentTarget.classList.add("sel"); }
  else {
    const from = selected, to = sq;
    document.querySelectorAll(".sq.sel").forEach(el=>el.classList.remove("sel"));
    selected = null;
    fetch("/gaming/challenge/move", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ id, from, to })
    }).then(r=>r.json()).then(d=>{
      if (!d.ok) document.getElementById("status").textContent = "❌ " + (d.error||"Invalid move, try again");
    });
  }
}
let gameEndedRedirectStarted = false;
async function poll(){
  try{
    const res = await fetch("/gaming/challenge/play-state?id="+id);
    const data = await res.json();
    if (!data.active) {
      document.getElementById("status").textContent = "Game over. Thanks for playing! Taking you back to the live stream now...";
      if (!gameEndedRedirectStarted) {
        gameEndedRedirectStarted = true;
        setTimeout(() => { location.href = "/gaming/overlay/chess"; }, 3000); // খেলা শেষে সাথে সাথেই চলমান লাইভে ফিরিয়ে দেওয়া
      }
      return;
    }
    if (!hasCelebrated) runCelebration(data.name, data.photoUrl);
    renderBoard(data.fen, data.lastMove, hasCelebrated);
    document.getElementById("status").textContent = data.turn === "b" ? "✅ Your turn — click a piece, then click where you want to move it" : "⏳ Nur is thinking...";
    if (typeof data.blackMs === "number" && typeof data.whiteMs === "number") {
      const fmt = (ms) => { const s = Math.max(0, Math.round(ms/1000)); return String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0"); };
      document.getElementById("clockRow").style.display = "block";
      document.getElementById("clockYou").textContent = fmt(data.blackMs);
      document.getElementById("clockOpp").textContent = fmt(data.whiteMs);
      document.getElementById("clockYou").style.color = data.blackMs < 60000 ? "#E8443D" : "#FFD866";
    }
  }catch(e){}
}
setInterval(poll, 1500); poll();
</script></body></html>`;

// ---------------------------------------------------------------------------
// ৭.৫ — SNAKE GAME — AI নিজেই খেলে, ২৪/৭ দেখার জন্য satisfying/hypnotic লুপ
// ---------------------------------------------------------------------------
const SNAKE_COLS = 32, SNAKE_ROWS = 20;
let snakeLoopActive = false;
let snakeHighScoreState = readState("snake-highscore") || { score: 0, name: "Grandmaster" };
let snakeHighScore = snakeHighScoreState.score || 0;
let snakeHighScoreName = snakeHighScoreState.name || "Grandmaster"; // যতক্ষণ না কেউ challenge করে হারায়, এই নামটাই ডিফল্ট থাকবে

function snakeNewGame() {
  const startR = Math.floor(SNAKE_ROWS / 2), startC = Math.floor(SNAKE_COLS / 3);
  return {
    body: [{ r: startR, c: startC }, { r: startR, c: startC - 1 }, { r: startR, c: startC - 2 }],
    dir: { r: 0, c: 1 },
    food: snakeRandomFood([{ r: startR, c: startC }, { r: startR, c: startC - 1 }, { r: startR, c: startC - 2 }]),
    score: 0,
  };
}
function snakeRandomFood(body) {
  let pos;
  do {
    pos = { r: Math.floor(Math.random() * SNAKE_ROWS), c: Math.floor(Math.random() * SNAKE_COLS) };
  } while (body.some((s) => s.r === pos.r && s.c === pos.c));
  return pos;
}
// BFS দিয়ে খাবার পর্যন্ত সবচেয়ে ছোট নিরাপদ পথ খোঁজা — সাপ যেন উদ্দেশ্যপূর্ণভাবে চলে, এলোমেলো না
function snakeFindPath(game) {
  const occupied = new Set(game.body.slice(0, -1).map((s) => s.r + "," + s.c)); // লেজ বাদ (এক ধাপ পর সরে যাবে)
  const start = game.body[0];
  const target = game.food;
  const q = [[start.r, start.c]];
  const visited = new Set([start.r + "," + start.c]);
  const parent = {};
  const dirs = [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }];
  while (q.length) {
    const [r, c] = q.shift();
    if (r === target.r && c === target.c) {
      const path = [];
      let cur = r + "," + c;
      while (cur !== start.r + "," + start.c) {
        path.unshift(cur);
        cur = parent[cur];
      }
      return path.map((p) => { const [pr, pc] = p.split(",").map(Number); return { r: pr, c: pc }; });
    }
    for (const d of dirs) {
      const nr = r + d.r, nc = c + d.c;
      if (nr < 0 || nr >= SNAKE_ROWS || nc < 0 || nc >= SNAKE_COLS) continue;
      const key = nr + "," + nc;
      if (visited.has(key) || occupied.has(key)) continue;
      visited.add(key);
      parent[key] = r + "," + c;
      q.push([nr, nc]);
    }
  }
  return null; // কোনো নিরাপদ পথ নেই
}
function snakeSafeMoves(game) {
  const occupied = new Set(game.body.slice(0, -1).map((s) => s.r + "," + s.c));
  const head = game.body[0];
  const dirs = [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }];
  return dirs.filter((d) => {
    const nr = head.r + d.r, nc = head.c + d.c;
    if (nr < 0 || nr >= SNAKE_ROWS || nc < 0 || nc >= SNAKE_COLS) return false;
    return !occupied.has(nr + "," + nc);
  });
}
async function runSnakeLoop() {
  if (snakeLoopActive) return;
  snakeLoopActive = true;
  let game = snakeNewGame();
  writeState("snake", { ...game, highScore: snakeHighScore, highScoreName: snakeHighScoreName, status: "playing" });
  while (snakeLoopActive) {
    const path = snakeFindPath(game);
    let nextDir;
    if (path && path.length) {
      const step = path[0];
      nextDir = { r: step.r - game.body[0].r, c: step.c - game.body[0].c };
    } else {
      // খাবার পর্যন্ত নিরাপদ পথ নেই — বেঁচে থাকার জন্য যেকোনো নিরাপদ দিকে যাওয়া, সময় কেনার চেষ্টা
      const safe = snakeSafeMoves(game);
      if (!safe.length) {
        // আটকে গেছে — game over, নতুন গেম শুরু হবে
        writeState("snake", { ...game, highScore: snakeHighScore, highScoreName: snakeHighScoreName, status: "gameover" });
        if (game.score > snakeHighScore) { snakeHighScore = game.score; snakeHighScoreName = "Grandmaster"; writeState("snake-highscore", { score: snakeHighScore, name: snakeHighScoreName }); } // চ্যালেঞ্জ সিস্টেম যোগ হলে এখানে challenger জিতলে তার নাম বসবে
        await sleep(2500);
        game = snakeNewGame();
        writeState("snake", { ...game, highScore: snakeHighScore, highScoreName: snakeHighScoreName, status: "playing" });
        await sleep(600);
        continue;
      }
      nextDir = safe[Math.floor(Math.random() * safe.length)];
    }
    const newHead = { r: game.body[0].r + nextDir.r, c: game.body[0].c + nextDir.c };
    const ateFood = newHead.r === game.food.r && newHead.c === game.food.c;
    game.body.unshift(newHead);
    if (ateFood) {
      game.score += 10;
      game.food = snakeRandomFood(game.body);
    } else {
      game.body.pop();
    }
    game.dir = nextDir;
    writeState("snake", { ...game, highScore: snakeHighScore, highScoreName: snakeHighScoreName, status: "playing" });
    await sleep(110); // চেস/বলসর্টের মতো "ধীরে ভেবে খেলা" এখানে না — Snake স্বাভাবিক দ্রুত গতিতেই চলবে, শুধু smooth (interpolated) থাকবে
  }
}

// ---------------------------------------------------------------------------
// ৭.৬ — BALL SORT PUZZLE — AI নিজেই সমাধান করে দেখায়, শেষ হলে নতুন পাজল
// ---------------------------------------------------------------------------
const BS_TUBE_COUNT = 14, BS_TUBE_CAPACITY = 4, BS_COLOR_COUNT = 12; // ⚠️ সতর্কতা হিসেবে কমানো হলো — ২০/১৮/৫ সাইজে
// Render-এর ফ্রি সার্ভারের সীমিত RAM-এ পুরো সার্ভার ক্র্যাশ করার সন্দেহ হয়েছে, তাই নিরাপদ মাপে ফিরিয়ে আনা হলো
// ইউজারের দেওয়া রঙের নাম অনুযায়ী (প্রথম ১২টা রেখে) — প্রতিটাকে উজ্জ্বল/স্যাচুরেটেড ভার্সনে রাখা হয়েছে
const BS_COLORS = [
  "#1E5FFF", // Sapphire
  "#10C469", // Emerald
  "#9B4DFF", // Amethyst
  "#00C2C2", // Teal
  "#B98CFF", // Lavender
  "#FF6F5E", // Coral
  "#FF2D55", // Crimson
  "#2DE0C7", // Turquoise
  "#A32148", // Burgundy
  "#E8C22E", // Mustard
  "#5B3FD9", // Indigo
  "#FFA173", // Peach
];

// একই টিউবে পরপর (touching) দুটো একই রঙের বল যেন না থাকে — তাড়াহুড়োয় বোঝা কঠিন হয়ে যায় এই কারণে
// ইউজার এই নিয়ম রাখতে বলেছেন। একই টিউবে একই রঙ একাধিকবার থাকতেই পারে, শুধু পাশাপাশি (adjacent) না।
function bsHasAdjacentDuplicate(tubes) {
  return tubes.some((t) => {
    for (let i = 1; i < t.length; i++) { if (t[i] === t[i - 1]) return true; }
    return false;
  });
}
function bsGeneratePuzzleOnce() {
  // ⚠️ আগে এখানে সমাধান করা অবস্থা থেকে ১৮০টা র‍্যান্ডম উল্টো চাল চালিয়ে শাফল করা হতো।
  // সমস্যা: ওই চালগুলো খালি টিউব দুটোতেও বল ফেলে দিত, তাই শাফল শেষে প্রায়ই **একটাও খালি
  // টিউব থাকত না** — ১৪টা টিউবেই ২-৪টা করে মেশানো বল। AI solver তবু খুঁজে বের করত, কিন্তু
  // মানুষের পক্ষে ওই অবস্থায় বৈধ চালই প্রায় থাকে না — স্ক্রিন রেকর্ডিংয়ে ঠিক সেটাই দেখা গেছে,
  // খেলোয়াড় টিউবে চাপ দিয়েও একটা বলও নাড়াতে পারছিলেন না।
  //
  // এখন আসল Ball Sort গেমের মতোই করা হচ্ছে: ৪৮টা বল ভালোভাবে মিশিয়ে প্রথম ১২টা টিউবে
  // ৪টা করে ভাগ করে দেওয়া হয়, আর শেষ ২টা টিউব **সবসময় সম্পূর্ণ খালি** থাকে। ওই দুটো খালি
  // টিউবই খেলার জায়গা — প্রথম চাল থেকেই খেলা যায়।
  const bag = [];
  for (let c = 0; c < BS_COLOR_COUNT; c++) {
    for (let n = 0; n < BS_TUBE_CAPACITY; n++) bag.push(c);
  }
  // Fisher–Yates — প্রতিটা সাজানো সমানভাবে সম্ভব
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
  }
  const tubes = [];
  for (let i = 0; i < BS_COLOR_COUNT; i++) tubes.push(bag.slice(i * BS_TUBE_CAPACITY, (i + 1) * BS_TUBE_CAPACITY));
  const emptyCount = BS_TUBE_COUNT - BS_COLOR_COUNT;
  for (let i = 0; i < emptyCount; i++) tubes.push([]);
  return tubes;
}

function bsGeneratePuzzle() {
  // কালেভদ্রে (কম শাফল-সুযোগ পাওয়া কোনো টিউব) তারপরও adjacent-duplicate থেকে যেতে পারে —
  // সেক্ষেত্রে পুরো পাজলটাই আবার নতুন করে তৈরি করা হচ্ছে, যতক্ষণ না নিয়ম মেনে চলে
  let tubes, tries = 0;
  do { tubes = bsGeneratePuzzleOnce(); tries++; } while (bsHasAdjacentDuplicate(tubes) && tries < 40);
  return tubes;
}
function bsIsSolved(tubes) {
  return tubes.every((t) => t.length === 0 || (t.length === BS_TUBE_CAPACITY && t.every((c) => c === t[0])));
}
function bsCanPour(tubes, from, to) {
  if (from === to) return false;
  const f = tubes[from], t = tubes[to];
  if (!f.length) return false;
  if (t.length >= BS_TUBE_CAPACITY) return false;
  if (t.length === 0) return true;
  return t[t.length - 1] === f[f.length - 1];
}
function bsClone(tubes) { return tubes.map((t) => [...t]); }
function bsKey(tubes) { return tubes.map((t) => t.join(",")).join("|"); }
// ===========================================================================
// পাজল সমাধানকারী (solver)
// ---------------------------------------------------------------------------
// ⚠️ আগের সংস্করণে এখানে BFS ছিল, আর সেটাই ছিল "পাজল কখনো শুরুই হয় না" সমস্যার আসল কারণ।
// ১৪ টিউব × ১২ রঙের পাজলে সম্ভাব্য অবস্থার সংখ্যা কোটি কোটি — BFS সবগুলো স্তর একসাথে ধরে
// এগোয়, তাই ৬০,০০০ অবস্থার নিরাপত্তা-সীমায় পৌঁছেই হাল ছেড়ে দিত। পরীক্ষা করে দেখা গেছে
// ১০০% পাজলেই সে ব্যর্থ হচ্ছিল — ফলে overlay চিরকাল "সমাধান খুঁজে বের করছে..." দেখিয়ে যেত।
//
// এখন DFS (গভীরতা-প্রথম) + তিনটা কৌশল ব্যবহার হচ্ছে:
//  ১. একসাথে পুরো "রান" ঢালা — উপরের একই রঙের সবগুলো বল এক চালে যায় (মানুষও তা-ই করে)।
//     এতে সমাধানের গভীরতা কয়েকগুণ কমে যায়। অ্যানিমেশনের সময় আবার একটা-একটা বলে ভাগ করা হয়।
//  ২. অর্থহীন চাল বাদ — সম্পূর্ণ হয়ে যাওয়া টিউব ছোঁয়া হয় না, এক-রঙা টিউব খালি টিউবে ঢালা হয় না,
//     আর একাধিক খালি টিউব থাকলে সেগুলো অভিন্ন বলে শুধু একটাই বিবেচনা করা হয়।
//  ৩. চালের ক্রম সাজানো — যে চাল একটা টিউব সম্পূর্ণ করে বা একটা টিউব খালি করে, সেটা আগে চেষ্টা।
// ===========================================================================
function bsTopRun(t) { // উপরে একই রঙের কতগুলো বল পরপর আছে
  if (!t.length) return 0;
  const c = t[t.length - 1];
  let n = 1;
  for (let i = t.length - 2; i >= 0 && t[i] === c; i--) n++;
  return n;
}
// দুটো টিউবের অবস্থান অদলবদল হলে পাজলটা আসলে একই — তাই টিউবগুলো সাজিয়ে (sort) চাবি বানানো হয়।
// এতে "একই অবস্থা" বারবার খোঁজা বন্ধ হয়, search কয়েকগুণ ছোট হয়ে যায়।
function bsCanonicalKey(tubes) {
  const parts = new Array(tubes.length);
  for (let i = 0; i < tubes.length; i++) parts[i] = tubes[i].join(",");
  parts.sort();
  return parts.join("|");
}
async function bsSolve(tubes) {
  const work = bsClone(tubes);
  const visited = new Set();
  const path = [];
  const MAX_NODES = 400000;  // এর মধ্যেই সমাধান না এলে নতুন পাজল বানানো হবে
  let nodes = 0, sinceYield = 0, aborted = false;

  async function dfs() {
    if (aborted) return false;
    if (bsIsSolved(work)) return true;
    if (++nodes > MAX_NODES) { aborted = true; return false; }
    // মাঝে মাঝে event loop-কে শ্বাস নেওয়ার সুযোগ — নাহলে solve চলাকালীন পুরো সার্ভার
    // (chess, Fan Battle Live, পেমেন্ট — সবকিছু) কয়েক সেকেন্ডের জন্য জমে যেত
    if (++sinceYield >= 4000) { sinceYield = 0; await sleep(0); }

    const key = bsCanonicalKey(work);
    if (visited.has(key)) return false;
    visited.add(key);

    const moves = [];
    for (let from = 0; from < work.length; from++) {
      const f = work[from];
      if (!f.length) continue;
      const run = bsTopRun(f);
      if (run === f.length && f.length === BS_TUBE_CAPACITY) continue; // এই টিউব সম্পূর্ণ, ছোঁয়ার দরকার নেই
      const color = f[f.length - 1];
      let emptyTried = false;
      for (let to = 0; to < work.length; to++) {
        if (to === from) continue;
        const t = work[to];
        if (t.length >= BS_TUBE_CAPACITY) continue;
        let score;
        if (t.length === 0) {
          if (run === f.length) continue;  // এক-রঙা টিউব পুরোটা খালি টিউবে সরানো = কিছুই বদলালো না
          if (emptyTried) continue;        // খালি টিউবগুলো একে অপরের সমান, একটাই যথেষ্ট
          emptyTried = true;
          score = 1;
        } else {
          if (t[t.length - 1] !== color) continue;
          score = 10;
        }
        const n = Math.min(run, BS_TUBE_CAPACITY - t.length);
        if (t.length + n === BS_TUBE_CAPACITY) score += 30; // এই চালে একটা টিউব সম্পূর্ণ হয়ে যায়
        if (n === f.length) score += 20;                    // এই চালে একটা টিউব খালি হয়ে যায়
        moves.push({ from, to, n, score: score + n });
      }
    }
    moves.sort((x, y) => y.score - x.score);

    for (const mv of moves) {
      for (let i = 0; i < mv.n; i++) work[mv.to].push(work[mv.from].pop());
      path.push(mv);
      if (await dfs()) return true;
      path.pop();
      for (let i = 0; i < mv.n; i++) work[mv.from].push(work[mv.to].pop());
      if (aborted) return false;
    }
    return false;
  }

  const ok = await dfs();
  if (!ok) return null;
  // একসাথে ঢালা রান-গুলো আবার একটা-একটা বলে ভেঙে দেওয়া — দর্শক প্রতিটা বল আলাদা করে
  // তুলতে ও নামাতে দেখবে, ঠিক যেমন কেউ হাতে করে খেলছে
  const single = [];
  for (const mv of path) for (let i = 0; i < mv.n; i++) single.push({ from: mv.from, to: mv.to });
  return single;
}
let ballSortLoopActive = false;
let bsFastestState = readState("ballsort-fastest") || { seconds: null, name: "Grandmaster" };
async function runBallSortLoop() {
  if (ballSortLoopActive) return;
  ballSortLoopActive = true;
  while (ballSortLoopActive) {
    let tubes = bsGeneratePuzzle();
    writeState("ballsort", { tubes, colors: BS_COLORS, status: "solving", lastMove: null, movesLeft: null, fastest: bsFastestState }); // "চিন্তা করছে" — বড় পাজলে solve করতে কিছুটা সময় লাগে
    let solution = await bsSolve(tubes);
    let attempts = 0;
    // পাজলটা এলোমেলো করে বানানো হয়, তাই মাঝে মাঝে (পরীক্ষায় ~৮% ক্ষেত্রে) এমন অবস্থা তৈরি হয়
    // যেটা মাত্র ২টা খালি টিউব দিয়ে আসলেই সমাধান করা অসম্ভব। solver এখন সেটা মিলিসেকেন্ডের
    // মধ্যেই বুঝে ফেলে, তাই সাথে সাথে নতুন পাজল বানিয়ে নেওয়াই সবচেয়ে সহজ সমাধান।
    while (!solution && attempts < 25) { tubes = bsGeneratePuzzle(); solution = await bsSolve(tubes); attempts++; }
    if (attempts) console.log("🧪 Ball Sort:", attempts, "বার নতুন পাজল বানাতে হয়েছে");
    if (!solution) { await sleep(2000); continue; } // চরম বিরল কেস, আবার চেষ্টা
    writeState("ballsort", { tubes, colors: BS_COLORS, status: "playing", lastMove: null, movesLeft: solution.length, fastest: bsFastestState });
    await sleep(1200);
    // মোট সমাধানের সময়টা একটা লক্ষ্যমাত্রার (~১৪ মিনিট) কাছাকাছি রাখার চেষ্টা — আগের চেয়ে আরও ধীর
    const targetTotalMs = 14 * 60 * 1000;
    // ⚠️ ন্যূনতম বিরতি অবশ্যই client-side অ্যানিমেশনের মোট সময়ের (~২.৩ সেকেন্ড) চেয়ে বেশি রাখা জরুরি,
    // নাহলে পরের চাল আসার আগেই আগেরটার অ্যানিমেশন শেষ না হয়ে ছন্দ ভেঙে যাবে
    // ⚠️ ক্লায়েন্টের অ্যানিমেশন এখন মোট ~৩.০ সেকেন্ড (০.৭s ভাবা + ১.০s বল ওঠা + ১.৩s নেমে বসা)।
    // দুই চালের ব্যবধান অবশ্যই তার চেয়ে বেশি রাখতে হবে, নাহলে আগেরটা শেষ হওয়ার আগেই পরেরটা এসে
    // ছন্দ ভেঙে যায়। তাই ন্যূনতম ৩.৩ সেকেন্ড, আর ভেবেচিন্তে খেলার অনুভূতির জন্য সর্বোচ্চ ৫ সেকেন্ড।
    const perMoveDelay = Math.max(3300, Math.min(5000, Math.round(targetTotalMs / Math.max(1, solution.length))));
    const solveStartedAt = Date.now();
    for (let i = 0; i < solution.length && ballSortLoopActive; i++) {
      const mv = solution[i];
      tubes[mv.to].push(tubes[mv.from].pop());
      writeState("ballsort", { tubes: bsClone(tubes), colors: BS_COLORS, status: "playing", lastMove: mv, movesLeft: solution.length - i - 1, fastest: bsFastestState });
      await sleep(perMoveDelay); // প্রতিটা ঢালার মাঝে বিরতি — দর্শক স্পষ্ট দেখতে পাবে, মানুষ ভাবছে এমন অনুভূতি
    }
    // এই সমাধানের real সময় — ভবিষ্যতে challenge সিস্টেম যোগ হলে, কেউ এর চেয়ে কম সময়ে সমাধান করলে
    // "fastest" রেকর্ডটা তার নামে বদলে যাবে; আপাতত ডিফল্ট "Grandmaster"-ই থাকছে (AI-এর নিজের সময়)
    const solveSeconds = Math.round((Date.now() - solveStartedAt) / 1000);
    if (bsFastestState.seconds === null || solveSeconds < bsFastestState.seconds) {
      bsFastestState = { seconds: solveSeconds, name: "Grandmaster" };
      writeState("ballsort-fastest", bsFastestState);
    }
    writeState("ballsort", { tubes, colors: BS_COLORS, status: "solved", lastMove: null, movesLeft: 0, fastest: bsFastestState });
    await sleep(2000); // সমাধান হওয়া পাজলটা কিছুক্ষণ দেখানো, তারপর নতুন পাজল
  }
}

// ===========================================================================
// সেলিব্রেশন + আওয়াজ ডাকিং + টপ সাপোর্টার ঘোষণা
// ---------------------------------------------------------------------------
// Fan Battle Live / Chess Battle-এ যা আছে, হুবহু সেই ব্যবহারটাই Snake আর Ball Sort-এ।
// তিনটে অংশ:
//  ১) কেউ টাকা পাঠালে — বড় সেলিব্রেশন কার্ড (ছবি + নাম + টাকা), কনফেটি, আর কণ্ঠে ধন্যবাদ
//  ২) ঘোষণার সময় ব্যাকগ্রাউন্ডের সব আওয়াজ (মিউজিক, কমেন্ট্রি, গেমের শব্দ) ৮০% নেমে যায়,
//     ঘোষণা শেষ হলে আবার ধীরে ধীরে আগের জায়গায় ফিরে আসে — টিভির voice-over-এর মতো
//  ৩) প্রতি ৩ মিনিটে টপ ৩ সাপোর্টারের নাম পর্দায় ও কণ্ঠে ঘোষণা
// দুটো overlay-ই এই একই কোড ব্যবহার করে, তাই ভবিষ্যতে একবার বদলালেই দুই জায়গায় লাগু হবে।
// ===========================================================================
const CELEBRATION_CSS = `
.confettiPiece{position:fixed;top:-20px;width:10px;height:16px;z-index:59;pointer-events:none;
border-radius:2px;animation:confettiFall linear forwards;}
@keyframes confettiFall{to{transform:translateY(105vh) rotate(720deg);opacity:0;}}

.donorCeleb{position:fixed;inset:0;z-index:65;display:flex;align-items:center;justify-content:center;
opacity:0;pointer-events:none;background:rgba(4,7,18,0.55);}
.donorCeleb.show{animation:donorCelebFade 4.5s ease forwards;}
@keyframes donorCelebFade{0%{opacity:0;}8%{opacity:1;}82%{opacity:1;}100%{opacity:0;}}
.donorCelebCard{background:#161b2e;border:2px solid #FFD866;border-radius:22px;padding:26px 40px;
text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.7);transform:scale(0.6);}
.donorCeleb.show .donorCelebCard{animation:donorCelebPop 4.5s cubic-bezier(.2,1.4,.3,1) forwards;}
@keyframes donorCelebPop{0%{transform:scale(0.6);}12%{transform:scale(1.08);}20%{transform:scale(1);}100%{transform:scale(1);}}
.donorCelebTag{color:#FFD866;font-size:13px;font-weight:800;letter-spacing:1.5px;
text-transform:uppercase;margin-bottom:10px;}
#donorCelebPhotoWrap{width:110px;height:110px;border-radius:20px;overflow:hidden;margin:0 auto 12px;
border:2px solid #FFD866;}
#donorCelebPhotoWrap img{width:100%;height:100%;object-fit:cover;}
.donorCelebName{font-size:32px;font-weight:900;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,0.6);}
.donorCelebAmount{font-size:26px;font-weight:800;color:#FFD866;margin-top:6px;}
.donorCelebNote{font-size:11px;color:#7C8AAD;margin-top:10px;}

/* প্রতি ৩ মিনিটের টপ-সাপোর্টার ঘোষণা — পর্দার উপরে সরু একটা প্যানেল, গেম ঢাকে না */
.topAnnounce{position:fixed;left:50%;top:0;transform:translate(-50%,-130%);z-index:64;
background:rgba(18,23,42,0.96);border:2px solid #FFD866;border-top:none;
border-radius:0 0 18px 18px;padding:14px 26px 16px;box-shadow:0 14px 40px rgba(0,0,0,0.7);
transition:transform 0.6s cubic-bezier(.2,1.2,.3,1);min-width:340px;}
.topAnnounce.show{transform:translate(-50%,0);}
.topAnnounce h4{margin:0 0 10px;color:#FFD866;font-size:12px;letter-spacing:1.4px;
text-transform:uppercase;text-align:center;font-weight:800;}
.taRow{display:flex;align-items:center;gap:10px;padding:5px 0;}
.taMedal{font-size:16px;width:22px;text-align:center;}
.taAvatar{width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid #FFD866;}
.taFallback{width:30px;height:30px;border-radius:50%;background:#2a3352;display:flex;
align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#9fb0d4;}
.taName{flex:1;font-size:14px;font-weight:700;color:#F5F7FA;}
.taAmt{font-size:14px;font-weight:800;color:#FFD866;}
`;

const CELEBRATION_HTML = `
<div class="donorCeleb" id="donorCelebration">
  <div class="donorCelebCard">
    <div class="donorCelebTag">🙏 New Supporter</div>
    <div id="donorCelebPhotoWrap" style="display:none;"><img id="donorCelebPhotoImg"></div>
    <div class="donorCelebName" id="donorCelebName">—</div>
    <div class="donorCelebAmount" id="donorCelebAmount">₹0</div>
    <div class="donorCelebNote">Voluntary support — thank you!</div>
  </div>
</div>
<div class="topAnnounce" id="topAnnounce">
  <h4>🏆 Top Supporters Right Now</h4>
  <div id="topAnnounceRows"></div>
</div>
`;

// gameKey: "snake" / "ballsort" — কোন চ্যানেলের টিপস ও লিডারবোর্ড পড়বে সেটা ঠিক করে
function celebrationJS(gameKey) {
  return `
/* ---------- ১. সব গেম-শব্দের জন্য একটা master volume ----------
   আগে প্রতিটা শব্দ সরাসরি audioCtx.destination-এ যেত, তাই একসাথে সবগুলোর আওয়াজ
   কমানোর কোনো উপায় ছিল না। এখন সব শব্দ এই একটা gain node দিয়ে যায় — ঘোষণার সময়
   শুধু এটার মান কমালেই গেমের সব শব্দ একসাথে নিচু হয়ে যায়। */
var sfxMasterGain = null;
function sfxOut(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (!sfxMasterGain){
    sfxMasterGain = audioCtx.createGain();
    sfxMasterGain.gain.value = duckFactor;
    sfxMasterGain.connect(audioCtx.destination);
  }
  return sfxMasterGain;
}

/* ---------- ২. ডাকিং — ঘোষণার সময় ব্যাকগ্রাউন্ডের আওয়াজ ৮০% কমে যায় ----------
   হঠাৎ করে নয়, প্রায় আধা সেকেন্ড ধরে মসৃণভাবে নামে আর ওঠে — টিভি/রেডিওতে
   voice-over এলে যেভাবে পেছনের গান নিচু হয়ে যায়, ঠিক সেভাবে। */
var DUCK_LEVEL = 0.2;           // ২০% বাকি থাকে = ৮০% কমে
var baseMusicVolume = 0.15;     // সেটিংসে দেওয়া আসল ভলিউম
var duckFactor = 1;             // এখনকার গুণক (১ = স্বাভাবিক)
var duckDepth = 0, duckTween = null;
function applyMusicVolume(){
  try {
    bgMusicEl.volume = Math.max(0, Math.min(1, baseMusicVolume * duckFactor));
    commentaryAudioEl.volume = Math.max(0, Math.min(1, duckFactor));
    if (sfxMasterGain && audioCtx) sfxMasterGain.gain.setTargetAtTime(duckFactor, audioCtx.currentTime, 0.1);
  } catch(e){}
}
function setDuck(on){
  duckDepth += on ? 1 : -1;
  if (duckDepth < 0) duckDepth = 0;
  var target = duckDepth > 0 ? DUCK_LEVEL : 1;
  if (duckTween) clearInterval(duckTween);
  duckTween = setInterval(function(){
    var diff = target - duckFactor;
    if (Math.abs(diff) < 0.015){ duckFactor = target; clearInterval(duckTween); duckTween = null; }
    else duckFactor += diff * 0.22;
    applyMusicVolume();
  }, 40);
}

/* ---------- ৩. ঘোষণার কণ্ঠ ---------- */
var availableVoices = [], selectedCelebVoice = null, savedVoiceURI = "";
function scoreVoice(v){
  var sc = 0;
  if (/bn|beng|india|hindi/i.test(v.lang) || /bn|beng|india/i.test(v.name)) sc += 5;
  if (/en-IN|en-GB|en-US/i.test(v.lang)) sc += 2;
  if (/Google|Natural|Neural|Premium/i.test(v.name)) sc += 3;
  return sc;
}
function resolveCelebVoice(){
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  if (!availableVoices.length) return;
  var sorted = availableVoices.slice().sort(function(a,b){ return scoreVoice(b) - scoreVoice(a); });
  var match = savedVoiceURI ? sorted.filter(function(v){ return v.voiceURI === savedVoiceURI; })[0] : null;
  selectedCelebVoice = match || sorted[0];
  var sel = document.getElementById("celebVoiceSelect");
  if (sel && sel.options.length !== availableVoices.length){
    sel.innerHTML = "";
    availableVoices.forEach(function(v){
      var o = document.createElement("option");
      o.value = v.voiceURI; o.textContent = v.name + " (" + v.lang + ")";
      if (selectedCelebVoice && v.voiceURI === selectedCelebVoice.voiceURI) o.selected = true;
      sel.appendChild(o);
    });
  }
}
if (window.speechSynthesis){
  window.speechSynthesis.onvoiceschanged = resolveCelebVoice;
  resolveCelebVoice();
}
// কথা বলার পুরো সময়টা ডাক করা থাকে, শেষ হলেই ছেড়ে দেয়।
// ⚠️ onend কোনো কোনো ব্রাউজারে আসে না — তাই একটা সময়সীমার নিরাপত্তা-জালও রাখা হয়েছে,
// নাহলে একবার ব্যর্থ হলে ব্যাকগ্রাউন্ড মিউজিক চিরকাল নিচু হয়েই থেকে যেত।
function speakCeleb(text, fallbackMs){
  var released = false;
  function release(){ if (released) return; released = true; setDuck(false); }
  setDuck(true);
  setTimeout(release, fallbackMs || Math.max(6000, text.length * 110));
  if (!window.speechSynthesis) return;
  try {
    var u = new SpeechSynthesisUtterance(text);
    if (selectedCelebVoice) u.voice = selectedCelebVoice;
    u.rate = 0.98; u.pitch = 1.0;
    u.onend = release; u.onerror = release;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch(e){ release(); }
}

/* ---------- ৪. কনফেটি ---------- */
function launchConfetti(){
  var colors = ["#FFD866","#4FC3F7","#E8443D","#8BE28B","#FF8FCF","#B39DDB"];
  for (var i = 0; i < 70; i++){
    var piece = document.createElement("div");
    piece.className = "confettiPiece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2.2 + Math.random() * 1.8) + "s";
    piece.style.animationDelay = (Math.random() * 0.6) + "s";
    piece.style.transform = "rotate(" + Math.floor(Math.random() * 360) + "deg)";
    document.body.appendChild(piece);
    (function(el){ setTimeout(function(){ el.remove(); }, 5000); })(piece);
  }
}

/* ---------- ৫. টাকা এলে সেলিব্রেশন ---------- */
var donorCelebTimeout = null;
function showDonorCelebration(name, amount, photo){
  var card = document.getElementById("donorCelebration");
  var wrap = document.getElementById("donorCelebPhotoWrap");
  var img = document.getElementById("donorCelebPhotoImg");
  if (photo){ img.src = photo; wrap.style.display = "block"; }
  else { wrap.style.display = "none"; }
  document.getElementById("donorCelebName").textContent = name;
  document.getElementById("donorCelebAmount").textContent = "₹" + amount;
  card.classList.remove("show"); void card.offsetWidth; card.classList.add("show");
  launchConfetti();
  clearTimeout(donorCelebTimeout);
  donorCelebTimeout = setTimeout(function(){ card.classList.remove("show"); }, 4500);
}
// সার্ভার প্রতিটা verified পেমেন্ট একবারই এই queue-তে দেয়, পড়ে নিলেই মুছে যায়
function pollTips(){
  fetch("/events/${gameKey}").then(function(r){ return r.json(); }).then(function(data){
    var photos = data.photos || {};
    (data.events || []).forEach(function(ev){
      var name = ev.name || "Anonymous";
      var amount = Math.round(ev.amount || 0);
      showDonorCelebration(name, amount, photos[name] || null);
      speakCeleb("Thank you " + name + " for the " + amount + " rupee tip!");
      refreshTopDonors(); refreshRecentDonors(); // লিডারবোর্ড সাথে সাথেই আপডেট
    });
  }).catch(function(){});
}
setInterval(pollTips, 4000);

/* ---------- ৬. প্রতি ৩ মিনিটে টপ সাপোর্টার ঘোষণা ---------- */
var TOP_ANNOUNCE_MS = 180000; // ৩ মিনিট
function showTopAnnounce(top){
  var rows = top.map(function(d, i){
    var medal = ["🥇","🥈","🥉"][i] || "🏅";
    var av = d.photo ? '<img class="taAvatar" src="' + d.photo + '">'
                     : '<div class="taFallback">' + ((d.name && d.name[0]) || "?") + '</div>';
    return '<div class="taRow"><span class="taMedal">' + medal + '</span>' + av +
           '<span class="taName">' + d.name + '</span>' +
           '<span class="taAmt">₹' + Math.round(d.amount) + '</span></div>';
  }).join("");
  var box = document.getElementById("topAnnounceRows");
  box.innerHTML = rows;
  var panel = document.getElementById("topAnnounce");
  panel.classList.add("show");
  setTimeout(function(){ panel.classList.remove("show"); }, 11000);
}
function announceTopSupporters(){
  fetch("/top-donors/${gameKey}?limit=3").then(function(r){ return r.json(); }).then(function(data){
    var top = data.top || [];
    if (!top.length) return; // এখনো কেউ সাপোর্ট করেননি — বলার কিছু নেই, চুপ থাকাই ভালো
    showTopAnnounce(top);
    var line = "Right now, our number one supporter is " + top[0].name +
               ", with " + Math.round(top[0].amount) + " rupees. ";
    if (top[1]) line += "Number two is " + top[1].name + ". ";
    if (top[2]) line += "And number three is " + top[2].name + ". ";
    line += "Thank you all so much for supporting the stream!";
    speakCeleb(line, 14000);
  }).catch(function(){});
}
setInterval(announceTopSupporters, TOP_ANNOUNCE_MS);
// প্রথম ঘোষণাটা শুরুর ৪৫ সেকেন্ড পরে, যাতে স্ট্রিম চালু হওয়ার সাথে সাথেই কথা শুরু না হয়
setTimeout(announceTopSupporters, 45000);
`;
}

const SNAKE_OVERLAY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Snake — Live</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;}
html{background:#0a0e1f;}
body{margin:0;color:#F5F7FA;
font-family:'Segoe UI',sans-serif;overflow-y:auto;min-height:100vh;padding:8px;position:relative;}
.liveFrame{display:grid;grid-template-columns:230px 1fr 230px;gap:10px;height:calc(100vh - 16px);}
#bgVideo{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;opacity:0;
transition:opacity 0.8s ease;}
/* ভিডিওটা একটু ম্লান করার জন্য আগে CSS filter ব্যবহার হতো — সেটা প্রতিটা ভিডিও-ফ্রেমে পুরো পর্দা
   নতুন করে হিসেব করতে বাধ্য করত (jank-এর বড় কারণ)। এখন তার বদলে একটা স্থির, আধা-স্বচ্ছ কালো
   পর্দা উপরে বসানো হয়েছে — এটা একবারই আঁকা হয়, প্রতি ফ্রেমে কোনো খরচ নেই। */
#bgDim{position:fixed;inset:0;z-index:-1;background:rgba(6,9,20,0.22);pointer-events:none;}
/* ভিডিও না এলে যেন পর্দা মরা-কালো না লাগে — ধীরে রং বদলানো একটা জীবন্ত স্তর সবসময় পেছনে থাকে */
#bgFallback{position:fixed;inset:0;z-index:-3;background:linear-gradient(135deg,#0d2818,#0a0e1f 45%,#12331f);}
/* ⚠️ আগে এখানে ৪০ সেকেন্ডের একটা background-position অ্যানিমেশন ছিল। পুরো পর্দাজুড়ে gradient-এর
   অবস্থান বদলানো মানে ব্রাউজারকে প্রতি ফ্রেমে গোটা স্ক্রিন নতুন করে আঁকতে হওয়া — এটাই সাপের
   চলায় ধারাবাহিক ঝাঁকুনি তৈরি করছিল। স্থির gradient-এ দেখতে কার্যত একই, কিন্তু খরচ শূন্য। */
.sideCol{display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;}
.centerCol{display:flex;flex-direction:column;align-items:center;min-height:0;height:100%;}
h1{color:#FFD866;font-size:20px;margin:0 0 2px;text-shadow:0 2px 12px rgba(255,216,102,0.35);}
#scoreRow{display:flex;gap:16px;font-size:12px;color:#7C8AAD;margin-bottom:6px;font-weight:700;flex-wrap:wrap;justify-content:center;}
#scoreRow b{color:#FFD866;font-size:15px;}
#scoreRow .hs{color:#8BE28B;}
#boardWrap{position:relative;flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;}
/* ছকঘর/checkerboard বাদ — এখন একটা প্রাকৃতিক, সবুজ ঘাসের মাঠের মতো রঙিন থিম */
#board{border:5px solid #6b4423;border-radius:10px;box-shadow:0 20px 46px rgba(0,0,0,0.75);}
.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:60px;font-weight:900;
color:#FFD866;opacity:0;pointer-events:none;text-shadow:0 0 30px rgba(0,0,0,0.9);}
.flash.show{animation:pop 2.2s ease-out forwards;}
@keyframes pop{0%{opacity:0;transform:scale(0.6);}15%{opacity:1;transform:scale(1.05);}80%{opacity:1;}100%{opacity:0;}}
/* নিচের ৪টা "সুইচ" — শুধু ভিজ্যুয়াল ইঙ্গিত, সাপ যেদিকে যাচ্ছে সেদিকেরটা আলো জ্বলে ওঠে, যেন মনে হয়
   কেউ সুইচ চেপে সাপ ঘোরাচ্ছে (আসলে AI নিজেই সিদ্ধান্ত নেয়, এটা শুধু দর্শকদের জন্য একটা মজার ইঙ্গিত) */
#dpad{display:grid;grid-template-columns:40px 40px 40px;grid-template-rows:40px 40px 40px;gap:5px;margin-top:8px;flex-shrink:0;}
.dbtn{background:#161b2e;border:2px solid #2a3352;border-radius:8px;display:flex;align-items:center;justify-content:center;
font-size:16px;color:#5a6a8a;transition:all 0.15s;}
.dbtn.active{background:#FFD866;border-color:#FFD866;color:#0a0e1f;box-shadow:0 0 16px rgba(255,216,102,0.7);transform:scale(1.08);}
#dUp{grid-column:2;grid-row:1;} #dLeft{grid-column:1;grid-row:2;} #dRight{grid-column:3;grid-row:2;} #dDown{grid-column:2;grid-row:3;}
/* বাম কলাম — QR/Help Me বক্স + সাম্প্রতিক সাপোর্টারদের স্থায়ী তালিকা */
#tipQrWrap{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:12px;text-align:center;flex-shrink:0;}
#tipQrImg{width:120px;height:120px;border-radius:10px;background:#fff;padding:6px;display:block;margin:0 auto;}
.tipLabel{color:#FFD866;font-weight:800;font-size:14px;margin-top:8px;}
.tipSub{color:#5a6a8a;font-size:9px;margin-top:4px;line-height:1.35;}
.rulesBox{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:10px;flex:1;min-height:0;overflow-y:auto;}
.rulesBox h3{margin:0 0 8px;font-size:11px;color:#FFD866;text-transform:uppercase;letter-spacing:1px;font-weight:800;}
.miniListRow{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #202a44;font-size:11px;}
.miniListRow:last-child{border-bottom:none;}
.miniAvatar{width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.miniAvatarFallback{width:20px;height:20px;border-radius:50%;background:#4FC3F7;color:#0a0e1f;font-weight:800;
font-size:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
/* ডান কলাম — টপ ৩ সাপোর্টার, স্ট্যাক করা ৯০% ছবি + ১০% নাম/অ্যামাউন্ট */
.topSupporterPanel{flex:1;display:flex;flex-direction:column;min-height:0;background:#161b2e;
border:1px solid #2a3352;border-radius:14px;overflow:hidden;}
.tsPhoto{flex:8.5;background:#0a0e1f;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;}
.tsRank{position:absolute;top:5px;left:5px;width:20px;height:20px;border-radius:50%;background:#FFD866;
color:#0a0e1f;font-weight:900;font-size:10px;display:flex;align-items:center;justify-content:center;z-index:2;}
.tsPhoto img{width:100%;height:100%;object-fit:cover;}
.tsPhoto .tsFallback{width:55%;height:55%;border-radius:50%;background:#4FC3F7;color:#0a0e1f;font-weight:900;
font-size:24px;display:flex;align-items:center;justify-content:center;}
.tsInfo{flex:1.5;display:flex;align-items:center;justify-content:center;background:#12172a;border-top:1px solid #2a3352;
font-size:10px;font-weight:700;color:#fff;padding:2px 4px;text-align:center;}
.tsInfo .tsAmt{color:#FFD866;}
/* যে চ্যালেঞ্জ করে বর্তমানে খেলছে তার ছবি — এখনো কেউ challenge করার প্রকৃত সিস্টেম চালু হয়নি,
   তাই আপাতত "কেউ খেলছে না" অবস্থাই দেখাবে; সিস্টেম যোগ হলে এটা automatic populate হবে */
#challengerBox{background:#161b2e;border:1px solid #2a3352;border-radius:14px;overflow:hidden;flex:0 0 34%;
display:flex;flex-direction:column;}
#challengerPhotoWrap{flex:1;background:#0a0e1f;display:flex;align-items:center;justify-content:center;overflow:hidden;}
#challengerPhotoWrap img{width:100%;height:100%;object-fit:cover;}
#challengerPhotoWrap .cFallback{width:60%;height:60%;border-radius:50%;background:#4FC3F7;color:#0a0e1f;
font-weight:900;font-size:30px;display:flex;align-items:center;justify-content:center;}
#challengerName{padding:6px;text-align:center;font-size:12px;font-weight:800;background:#12172a;border-top:1px solid #2a3352;}
.altView{display:none;}
.altView.show{display:block;}
/* নিচে-স্ক্রল-করা ব্যাকগ্রাউন্ড মিউজিক+কমেন্ট্রি সেটিংস — দর্শক/স্ট্রিম কখনো এটা দেখবে না, শুধু
   normal live-frame উচ্চতার নিচে থাকে, আপনি নিজের মনিটরে স্ক্রল করলে দেখতে পাবেন */
#bgSettingsPanel{max-width:560px;margin:30px auto 20px;padding:20px;background:#12172a;border:1px solid #2a3352;
border-radius:16px;position:relative;}
#bgSettingsPanel h2{color:#FFD866;font-size:16px;margin:0 0 4px;}
#bgSettingsPanel label{display:block;margin-top:14px;font-size:11px;color:#7C8AAD;font-weight:700;}
#bgSettingsPanel input[type=text],#bgSettingsPanel input[type=number],#bgSettingsPanel textarea{width:100%;padding:9px;border-radius:8px;border:1px solid #26314f;
background:#0f1526;color:#fff;font-size:13px;margin-top:5px;box-sizing:border-box;font-family:inherit;}
#bgSettingsPanel textarea{min-height:90px;resize:vertical;}
#bgSettingsPanel input[type=range]{width:100%;margin-top:6px;}
#bgSettingsPanel button{margin-top:14px;padding:10px 18px;border-radius:8px;border:none;background:#FFD866;
color:#0a0e1f;font-weight:800;cursor:pointer;font-size:13px;}
#bgSettingsStatus{margin-top:10px;font-size:12px;color:#8BE28B;min-height:16px;}
${CELEBRATION_CSS}
</style></head><body>
${CELEBRATION_HTML}
<div id="bgFallback"></div>
<div id="bgDim"></div>
<video id="bgVideo" autoplay muted loop playsinline preload="auto" src="/game-assets/snake-bg.mp4"></video>
<script>
// ব্রাউজার কখনো কখনো নিজে থেকে autoplay শুরু করে না (বিশেষত OBS/PRISM-এর ভেতরে) — তাই বারবার
// চেষ্টা করা হচ্ছে। ভিডিও কোনো কারণে না এলে নিচের নড়াচড়া করা gradient ব্যাকগ্রাউন্ডটা থেকে যাবে,
// অন্তত পর্দা একদম ফাঁকা কালো দেখাবে না।
(function(){
  var v = document.getElementById("bgVideo");
  function tryPlay(){ var p = v.play(); if (p && p.catch) p.catch(function(){}); }
  v.addEventListener("canplay", tryPlay);
  v.addEventListener("loadeddata", function(){ v.style.opacity = "0.78"; });
  v.addEventListener("error", function(){ console.warn("ব্যাকগ্রাউন্ড ভিডিও লোড হয়নি — /gaming/assets-check দেখুন"); });
  document.addEventListener("visibilitychange", tryPlay);
  setInterval(function(){ if (v.paused) tryPlay(); }, 3000);
  tryPlay();
})();
</script>
<div class="liveFrame">
<div class="sideCol">
  <div id="challengerBox">
    <div id="challengerPhotoWrap"><div class="cFallback">?</div></div>
    <div id="challengerName">No one playing right now</div>
  </div>
  <div id="tipQrWrap">
    <img id="tipQrImg" src="" alt="Scan to help">
    <div class="tipLabel">🙏 Help Me</div>
    <div class="tipSub">Voluntary support — not tied to the game, never required</div>
  </div>
  <div class="rulesBox">
    <div class="altView show" id="recentView">
      <h3>💛 Recent Supporters</h3>
      <div id="recentDonorList"></div>
    </div>
    <div class="altView" id="queueView">
      <h3>⏳ Challenge Queue</h3>
      <div id="queueList"><div style="font-size:10px;color:#5a6a8a;">No one in queue right now</div></div>
    </div>
    <div class="altView" id="howToView">
      <h3>🎮 Beat the Grandmaster</h3>
      <div style="font-size:10px;color:#9fb0d4;line-height:1.6;">
        Join the queue and play live<br>
        <b style="color:#FFD866;">/gaming/challenge/snake</b><br><br>
        Beat the record and your name<br>goes up on this screen.
      </div>
    </div>
  </div>
</div>
<div class="centerCol">
  <h1>🐍 Snake — Live</h1>
  <div id="scoreRow">Score: <b id="scoreVal">0</b> &nbsp;|&nbsp; <span class="hs">🏆 High Score: <b id="highScoreVal">0</b> — <span id="highScoreNameVal">Grandmaster</span></span></div>
  <div id="boardWrap"><canvas id="board"></canvas></div>
  <div id="dpad">
    <div class="dbtn" id="dUp">▲</div>
    <div class="dbtn" id="dLeft">◀</div>
    <div class="dbtn" id="dRight">▶</div>
    <div class="dbtn" id="dDown">▼</div>
  </div>
</div>
<div class="sideCol">
  <div class="topSupporterPanel" id="topSup1"><div class="tsPhoto" id="tsPhoto1"><div class="tsRank">1</div></div><div class="tsInfo" id="tsInfo1">—</div></div>
  <div class="topSupporterPanel" id="topSup2"><div class="tsPhoto" id="tsPhoto2"><div class="tsRank">2</div></div><div class="tsInfo" id="tsInfo2">—</div></div>
  <div class="topSupporterPanel" id="topSup3"><div class="tsPhoto" id="tsPhoto3"><div class="tsRank">3</div></div><div class="tsInfo" id="tsInfo3">—</div></div>
</div>
</div>
<div id="bgSettingsPanel">
  <h2>🎵 Background Music &amp; Commentary</h2>
  <form id="bgSettingsForm">
    <label>Music link (copyright-free MP3/audio URL — leave blank for no music)</label>
    <input type="text" id="bgMusicUrlInput" placeholder="https://...mp3">
    <label>Volume — <span id="volLabel">15%</span></label>
    <input type="range" id="bgMusicVolumeInput" min="0" max="1" step="0.05" value="0.15">
    <label>Your own recorded commentary audio links (one URL per line — cycles through them)</label>
    <textarea id="commentaryUrlsInput" placeholder="https://example.com/commentary1.mp3"></textarea>
    <label>Seconds between commentary clips (example: 90 = every 1.5 minutes)</label>
    <input type="number" id="loopIntervalInput" min="20" value="90">
    <label>Announcement voice (which voice reads out names and tips)</label>
    <select id="celebVoiceSelect"></select>
    <label>Background video link (direct .mp4 URL — leave blank to use the repo folder)</label>
    <input type="text" id="bgVideoUrlInput" placeholder="https://.../background.mp4">
    <button type="submit">Save</button>
    <div id="bgSettingsStatus"></div>
  </form>
</div>
<div class="flash" id="flash"></div>
<script>
// ⚠️ কোনো কারণে স্ক্রিপ্টের যেকোনো জায়গায় unexpected error হলে (যেমন আগে "Cannot access before
// initialization" হয়েছিল) — সেটা যেন নীরবে পুরো গেম থামিয়ে না দেয়, বরং সরাসরি স্ক্রিনে স্পষ্ট
// দেখা যায়, যাতে স্ক্রিনশট পাঠালেই আসল কারণ বোঝা যায়
window.addEventListener("error", (e) => {
  const el = document.getElementById("board") || document.body;
  if (el.tagName === "CANVAS") {
    const c = el.getContext("2d");
    c.fillStyle = "#3a0e0e"; c.fillRect(0,0,el.width,el.height);
    c.fillStyle = "#FF8A80"; c.font = "13px monospace"; c.textAlign = "center";
    c.fillText("Script error: " + e.message, el.width/2, el.height/2);
  }
});
// ---------- QR/Help Me + টপ ৩ সাপোর্টার + সাম্প্রতিক সাপোর্টার (স্থায়ী তালিকা) ----------
document.getElementById("tipQrImg").src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(location.origin + "/pay/snake");
function fillTopSupporterPanel(idx, donor){
  const photoEl = document.getElementById("tsPhoto" + idx);
  const infoEl = document.getElementById("tsInfo" + idx);
  if (!donor) { photoEl.innerHTML = '<div class="tsRank">' + idx + '</div><div class="tsFallback">?</div>'; infoEl.innerHTML = '<span style="color:#5a6a8a;">No tips yet</span>'; return; }
  photoEl.innerHTML = '<div class="tsRank">' + idx + '</div>' + (donor.photo ? '<img src="'+donor.photo+'">' : '<div class="tsFallback">'+((donor.name&&donor.name[0])||"?")+'</div>');
  infoEl.innerHTML = donor.name + ' <span class="tsAmt">₹' + Math.round(donor.amount) + '</span>';
}
async function refreshTopDonors(){
  try { const res = await fetch("/top-donors/snake"); const data = await res.json(); const top = data.top || [];
    fillTopSupporterPanel(1, top[0]); fillTopSupporterPanel(2, top[1]); fillTopSupporterPanel(3, top[2]); } catch(e){}
}
async function refreshRecentDonors(){
  try { const res = await fetch("/recent-donors/snake?limit=6"); const data = await res.json(); const list = data.recent || [];
    document.getElementById("recentDonorList").innerHTML = list.length ? list.map(d =>
      '<div class="miniListRow">' + (d.photo ? '<img class="miniAvatar" src="'+d.photo+'">' : '<div class="miniAvatarFallback">'+(d.name[0]||"?")+'</div>') +
      '<div>'+d.name+' <span style="color:#FFD866;font-weight:700;">₹'+Math.round(d.amount)+'</span></div></div>'
    ).join("") : '<div style="font-size:10px;color:#5a6a8a;">No tips yet</div>'; } catch(e){}
}
refreshTopDonors(); refreshRecentDonors();
setInterval(refreshTopDonors, 20000); setInterval(refreshRecentDonors, 20000);

// Recent Supporters ↔ Challenge Queue — প্রতি ১ মিনিটে পালাক্রমে বদলায়
// (⚠️ চ্যালেঞ্জ/queue-এর real backend এখনো এই গেমে যোগ হয়নি, তাই queueList আপাতত সবসময় খালি দেখাবে)
var altIdx = 0;
var ALT_VIEWS = ["recentView", "queueView", "howToView"];
function toggleAltPanel(){
  altIdx = (altIdx + 1) % ALT_VIEWS.length;
  ALT_VIEWS.forEach(function(v, i){
    document.getElementById(v).classList.toggle("show", i === altIdx);
  });
}
setInterval(toggleAltPanel, 20000);

/* ---------- কে এখন খেলছে + লাইনে কারা ---------- */
// বাম কলামের ছবির বাক্সে এখন খেলোয়াড়ের আসল ছবি ও নাম দেখা যাবে — দর্শক বুঝবে
// স্ক্রিনে যে খেলছে সে-ই লাইভে আছে
function refreshChallengeQueue(){
  fetch("/gaming/gq/snake/public").then(function(r){ return r.json(); }).then(function(d){
    var wrap = document.getElementById("challengerPhotoWrap");
    var nameEl = document.getElementById("challengerName");
    if (d.nowPlaying){
      var np = d.nowPlaying;
      wrap.innerHTML = np.photoUrl
        ? '<img src="' + np.photoUrl + '">'
        : '<div class="cFallback">' + ((np.name && np.name[0]) || "?") + '</div>';
      nameEl.innerHTML = np.name + (np.tipAmount ? ' <span style="color:#FFD866;">₹' + np.tipAmount + '</span>' : '');
    } else {
      wrap.innerHTML = '<div class="cFallback">?</div>';
      nameEl.textContent = "No one playing right now";
    }
    var list = d.queue || [];
    document.getElementById("queueList").innerHTML = list.length
      ? list.slice(0, 6).map(function(q){
          return '<div class="miniListRow">' +
            (q.photoUrl ? '<img class="miniAvatar" src="' + q.photoUrl + '">'
                        : '<div class="miniAvatarFallback">' + ((q.name && q.name[0]) || "?") + '</div>') +
            '<div><b>#' + q.position + '</b> ' + q.name +
            (q.tipAmount ? ' <span style="color:#FFD866;font-weight:700;">₹' + q.tipAmount + '</span>' : '') +
            '</div></div>';
        }).join("")
      : '<div style="font-size:10px;color:#5a6a8a;">No one in queue right now</div>';
  }).catch(function(){});
}
refreshChallengeQueue();
setInterval(refreshChallengeQueue, 3000);

// ব্যাকগ্রাউন্ড মিউজিক + কমেন্ট্রি — এই পেজেই নিচে স্ক্রল করলে ফর্ম দিয়ে সরাসরি সেট করা যায় (chess-এর প্যাটার্নে)
const bgMusicEl = new Audio();
bgMusicEl.loop = true;
const commentaryAudioEl = new Audio();
let lastMusicUrl = "";
let lastVideoUrl = "";
let commentaryList = [];
let commentaryIdx = 0;
let commentaryTimer = null;
function scheduleCommentary(intervalSec){
  if (commentaryTimer) clearInterval(commentaryTimer);
  if (!commentaryList.length) return;
  commentaryTimer = setInterval(() => {
    commentaryAudioEl.src = commentaryList[commentaryIdx % commentaryList.length];
    commentaryAudioEl.play().catch(() => {});
    commentaryIdx++;
  }, Math.max(20, intervalSec) * 1000);
}
async function loadMusicConfig(){
  try {
    const res = await fetch("/gaming/snake-config");
    const cfg = await res.json();
    if (cfg.bgMusicUrl && cfg.bgMusicUrl !== lastMusicUrl) {
      lastMusicUrl = cfg.bgMusicUrl;
      bgMusicEl.src = cfg.bgMusicUrl;
      bgMusicEl.play().catch(() => {}); // ব্রাউজারের autoplay নীতির কারণে প্রথমবার নাও বাজতে পারে, ব্যবহারকারীর প্রথম ক্লিকে বাজবে
    }
    // ⚠️ সরাসরি .volume বসালে ঘোষণার মাঝখানে সেটিংস রিফ্রেশ হলে ডাকিং ভেঙে যেত —
    // তাই আসল মানটা baseMusicVolume-এ রাখা হয়, আর প্রকৃত ভলিউম হিসেব করে বসানো হয়
    baseMusicVolume = typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15;
    savedVoiceURI = cfg.celebVoiceURI || savedVoiceURI;
    resolveCelebVoice();
    applyMusicVolume();
    const newList = Array.isArray(cfg.commentaryUrls) ? cfg.commentaryUrls : [];
    if (JSON.stringify(newList) !== JSON.stringify(commentaryList)) {
      commentaryList = newList; commentaryIdx = 0;
      scheduleCommentary(cfg.loopIntervalSec || 90);
    }
    // ফর্মের ইনপুটেও বর্তমান মান দেখানো — কিন্তু ব্যবহারকারী টাইপ করছেন এমন কোনো ফিল্ড overwrite না করে
    if (document.activeElement !== document.getElementById("bgMusicUrlInput")) {
      document.getElementById("bgMusicUrlInput").value = cfg.bgMusicUrl || "";
    }
    document.getElementById("bgMusicVolumeInput").value = typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15;
    document.getElementById("volLabel").textContent = Math.round((typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15) * 100) + "%";
    if (document.activeElement !== document.getElementById("commentaryUrlsInput")) {
      document.getElementById("commentaryUrlsInput").value = newList.join(String.fromCharCode(10));
    }
    if (document.activeElement !== document.getElementById("loopIntervalInput")) {
      document.getElementById("loopIntervalInput").value = cfg.loopIntervalSec || 90;
    }
    if (document.activeElement !== document.getElementById("bgVideoUrlInput")) {
      document.getElementById("bgVideoUrlInput").value = cfg.bgVideoUrl || "";
    }
    // সেটিংসে আলাদা ভিডিও-ঠিকানা দেওয়া থাকলে সেটাই ব্যবহার হবে — তখন GitHub ফোল্ডারের নাম
    // ঠিক আছে কিনা তা নিয়ে আর ভাবতে হয় না
    if (cfg.bgVideoUrl && cfg.bgVideoUrl !== lastVideoUrl) {
      lastVideoUrl = cfg.bgVideoUrl;
      var vEl = document.getElementById("bgVideo");
      vEl.src = cfg.bgVideoUrl;
      vEl.load();
      vEl.play().catch(function(){});
    }
  } catch(e) {}
}
loadMusicConfig();
setInterval(loadMusicConfig, 15000);
document.body.addEventListener("click", () => { bgMusicEl.play().catch(() => {}); }, { once: true });
document.getElementById("bgMusicVolumeInput").addEventListener("input", (e) => {
  document.getElementById("volLabel").textContent = Math.round(e.target.value * 100) + "%";
});
document.getElementById("bgSettingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("bgSettingsStatus");
  const linesRaw = document.getElementById("commentaryUrlsInput").value;
  const lines = linesRaw.split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean);
  try {
    await fetch("/gaming/snake-config", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        bgMusicUrl: document.getElementById("bgMusicUrlInput").value.trim(),
        bgMusicVolume: parseFloat(document.getElementById("bgMusicVolumeInput").value) || 0.15,
        commentaryUrls: lines,
        loopIntervalSec: parseInt(document.getElementById("loopIntervalInput").value, 10) || 90,
        bgVideoUrl: document.getElementById("bgVideoUrlInput").value.trim(),
        celebVoiceURI: document.getElementById("celebVoiceSelect").value || "",
      }) });
    statusEl.textContent = "Saved!";
    lastMusicUrl = ""; // পরের loadMusicConfig() কল-এ নতুন মিউজিক অবিলম্বে লোড হবে
  } catch(e) { statusEl.textContent = "Could not save — network problem."; }
});

const COLS = ${SNAKE_COLS}, ROWS = ${SNAKE_ROWS};
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
let cellSize = 24;
function resize(){
  const wrap = document.getElementById("boardWrap");
  const availW = wrap.clientWidth - 8, availH = wrap.clientHeight - 8;
  cellSize = Math.floor(Math.min(availW / COLS, availH / ROWS));
  canvas.width = cellSize * COLS; canvas.height = cellSize * ROWS;
}
window.addEventListener("resize", resize); resize();

let audioCtx = null;
function playEatSound(){
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [520, 780].forEach((f,i) => {
      const tt = t + i*0.06;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = "triangle"; osc.frequency.setValueAtTime(f, tt);
      g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.18, tt+0.01); g.gain.exponentialRampToValueAtTime(0.001, tt+0.16);
      osc.connect(g).connect(sfxOut()); osc.start(tt); osc.stop(tt+0.18);
    });
  }catch(e){}
}
document.body.addEventListener("click", () => { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); }, { once: true });

let lastDir = { r: 0, c: 1 }; // মুখ কোনদিকে হাঁ হবে তার জন্য — শুরুতে ডানদিকে মুখ করা ধরে নেওয়া হচ্ছে
let mouthOpenUntil = 0; // এই সময় পর্যন্ত মুখ "হাঁ" অ্যানিমেশন চলবে (বল খাওয়ার মুহূর্তে সেট হয়)
let prevBody = null, curBody = null, curFood = null;

// ===========================================================================
// সাপের সম্পূর্ণ ইঞ্জিন — এখন ব্রাউজারেই চলে (আগে সার্ভারে চলত)
// ---------------------------------------------------------------------------
// কেন বদলানো হলো: আগে প্রতিটা ধাপের জন্য সার্ভারে HTTP রিকোয়েস্ট যেত। Render-এর ফ্রি সার্ভারে
// সেই রিকোয়েস্টগুলোর দেরি একেকবার একেকরকম (কখনো ৩০ms, কখনো ৩০০ms) — ফলে সাপ একটু এগিয়ে
// থমকে যেত, আবার লাফ দিত। এখন হিসেবটাও এখানেই, আঁকাও এখানেই — মাঝখানে নেটওয়ার্ক নেই, তাই
// গতি একদম সমান ও মসৃণ থাকে, আর গেম ওভার না হওয়া পর্যন্ত এক মুহূর্তের জন্যও থামে না।
// ===========================================================================
const TICK_MS = 125;           // প্রতি ধাপের সময় — এক ঘর এগোতে যতক্ষণ লাগে
const GAMEOVER_PAUSE_MS = 2600; // গেম ওভারের পর নতুন গেম শুরুর আগে সামান্য বিরতি
let game = null;
let tickAcc = 0, lastFrameTs = 0, resumeAt = 0;
let score = 0, highScore = 0, highScoreName = "Grandmaster";
let scoreSubmitted = false;
// পরের চাল আগেই ভেবে রাখা হয় — কেন, তার ব্যাখ্যা scheduleThink()-এ
let pendingDir = null, thinkTimer = null;
// শেষ কতগুলো চালে সাপ কিছু খায়নি — বোর্ড প্রায় ভরে গেলে সাপ শুধু বেঁচে থাকতে পারে, কিন্তু
// বাকি ঘরগুলোয় আর পৌঁছাতে পারে না; তখন সে ঘণ্টার পর ঘণ্টা ঘুরতেই থাকবে। সেটা ঠেকাতে এই গণনা।
let stepsSinceEat = 0;

function inBounds(r, c){ return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
function keyOf(r, c){ return r * COLS + c; }

// ===========================================================================
// পথ খোঁজার জন্য পুনর্ব্যবহারযোগ্য (reusable) মেমরি
// ---------------------------------------------------------------------------
// আগে প্রতিটা চালে ৪-৫ বার নতুন Set / Array / Int32Array তৈরি হতো। সাপ যত বড় হয়
// (স্কোর ৫০০ মানে ৫০+ পুঁতি), তত বেশি আবর্জনা জমে — ব্রাউজারকে তখন মাঝে মাঝে থেমে
// garbage collection করতে হয়, আর ঠিক সেই মুহূর্তগুলোতেই সাপ "আটকে" যেত।
// এখন একবারই বরাদ্দ করা এই কয়েকটা বাফার বারবার ব্যবহার হয় — কোনো নতুন মেমরি লাগে না,
// তাই GC-জনিত ঝাঁকুনি সম্পূর্ণ বন্ধ।
// ===========================================================================
const CELLS = ROWS * COLS;
const _blocked = new Uint8Array(CELLS);
const _seen = new Int32Array(CELLS);   // stamp পদ্ধতি — প্রতিবার clear করার দরকার নেই
const _prevCell = new Int32Array(CELLS);
const _queue = new Int32Array(CELLS);
let _stamp = 0;
const _DR = [-1, 1, 0, 0], _DC = [0, 0, -1, 1];

// সাপের শরীর বাধা হিসেবে চিহ্নিত করা (লেজ বাদ — পরের ধাপে ওটা সরে যাবে)
function markBlocked(body){
  _blocked.fill(0);
  for (let i = 0; i < body.length - 1; i++) _blocked[keyOf(body[i].r, body[i].c)] = 1;
}
// এক ধাপ এগোনোর *পরের* অবস্থাটা সরাসরি চিহ্নিত করা — এর জন্য নতুন কোনো array বানাতে হয় না।
// (নতুন মাথা + পুরনো শরীরের শেষ দুটো ঘর বাদ; কারণ এক ধাপে লেজ এক ঘর এগিয়ে যায়।)
// সাপ বড় হলে প্রতি চালে হাজার হাজার অবজেক্ট তৈরি হচ্ছিল — সেটাই ছিল সবচেয়ে ভারী কাজ।
function markBlockedAfterMove(body, nr, nc){
  _blocked.fill(0);
  _blocked[keyOf(nr, nc)] = 1;
  for (let i = 0; i < body.length - 2; i++) _blocked[keyOf(body[i].r, body[i].c)] = 1;
}
// start থেকে goal পর্যন্ত সবচেয়ে ছোট পথের প্রথম ঘরটা ফেরত দেয় (-1 = পৌঁছানো যায় না)।
// markBlocked() আগে থেকে ডাকা থাকতে হবে।
function bfsFirstStep(sr, sc, gr, gc){
  const start = keyOf(sr, sc), goal = keyOf(gr, gc);
  if (start === goal) return start;
  _stamp++;
  _seen[start] = _stamp; _prevCell[start] = -1;
  let qh = 0, qt = 0;
  _queue[qt++] = start;
  while (qh < qt) {
    const cur = _queue[qh++];
    const cr = (cur / COLS) | 0, cc = cur % COLS;
    for (let d = 0; d < 4; d++) {
      const nr = cr + _DR[d], nc = cc + _DC[d];
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const nk = nr * COLS + nc;
      if (_seen[nk] === _stamp || _blocked[nk]) continue;
      _seen[nk] = _stamp; _prevCell[nk] = cur; _queue[qt++] = nk;
      if (nk === goal) {
        let k = nk;
        while (_prevCell[k] !== start && _prevCell[k] !== -1) k = _prevCell[k];
        return k;
      }
    }
  }
  return -1;
}
// start থেকে goal-এর দূরত্ব (কত ঘর) — -1 মানে পৌঁছানো যায় না। markBlocked() আগে ডাকা থাকতে হবে।
const _dist = new Int32Array(CELLS);
function bfsDistance(sr, sc, gr, gc){
  const start = keyOf(sr, sc), goal = keyOf(gr, gc);
  if (start === goal) return 0;
  _stamp++;
  _seen[start] = _stamp; _dist[start] = 0;
  let qh = 0, qt = 0;
  _queue[qt++] = start;
  while (qh < qt) {
    const cur = _queue[qh++];
    const cr = (cur / COLS) | 0, cc = cur % COLS, cd = _dist[cur];
    for (let d = 0; d < 4; d++) {
      const nr = cr + _DR[d], nc = cc + _DC[d];
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const nk = nr * COLS + nc;
      if (_seen[nk] === _stamp || _blocked[nk]) continue;
      _seen[nk] = _stamp; _dist[nk] = cd + 1; _queue[qt++] = nk;
      if (nk === goal) return cd + 1;
    }
  }
  return -1;
}
// একটা ঘর থেকে শুরু করে মোট কত ঘর খোলা আছে (flood fill)। markBlocked() আগে ডাকা থাকতে হবে।
function floodCount(sr, sc){
  if (sr < 0 || sr >= ROWS || sc < 0 || sc >= COLS) return -1;
  const start = keyOf(sr, sc);
  if (_blocked[start]) return -1;
  _stamp++;
  _seen[start] = _stamp;
  let qh = 0, qt = 0, count = 0;
  _queue[qt++] = start;
  while (qh < qt) {
    const cur = _queue[qh++]; count++;
    const cr = (cur / COLS) | 0, cc = cur % COLS;
    for (let d = 0; d < 4; d++) {
      const nr = cr + _DR[d], nc = cc + _DC[d];
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const nk = nr * COLS + nc;
      if (_seen[nk] === _stamp || _blocked[nk]) continue;
      _seen[nk] = _stamp; _queue[qt++] = nk;
    }
  }
  return count;
}

function randomFood(body){
  const taken = new Set(body.map((s) => keyOf(s.r, s.c)));
  const free = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!taken.has(keyOf(r,c))) free.push({ r, c });
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}
function newGame(){
  const r = Math.floor(ROWS/2), c = Math.floor(COLS/3);
  const body = [{r, c}, {r, c: c-1}, {r, c: c-2}];
  return { body, dir: {r:0, c:1}, food: randomFood(body) };
}
// খাবার পর্যন্ত পুরো পথটা ধরে এগোলে শরীর শেষ পর্যন্ত কেমন দাঁড়াবে — শুধু হিসেবের জন্য।
// পুরো পথ আবার BFS দিয়ে বের না করে, দূরত্ব দিয়েই ঠিকঠাক আন্দাজ করা যায়: পথে যতগুলো ধাপ,
// ততগুলো ঘর লেজ থেকে কেটে যাবে আর মাথায় ততগুলো যোগ হবে।
function simulateAlongPath(body, path, food){
  const newLen = body.length + (food ? 1 : 0); // খাবার খেলে এক ঘর লম্বা হবে
  const b = [];
  for (let i = path.length - 1; i >= 0 && b.length < newLen; i--) b.push({ r: path[i].r, c: path[i].c });
  for (let i = 0; b.length < newLen && i < body.length; i++) b.push({ r: body[i].r, c: body[i].c });
  return b;
}
// খাবার পর্যন্ত পুরো পথ (ধাপে ধাপে ঘরের তালিকা) — শুধু tail-safety যাচাইয়ের জন্য দরকার হয়
function bfsFullPath(body, target){
  if (!target) return null;
  markBlocked(body);
  const start = keyOf(body[0].r, body[0].c), goal = keyOf(target.r, target.c);
  if (start === goal) return [];
  _stamp++;
  _seen[start] = _stamp; _prevCell[start] = -1;
  let qh = 0, qt = 0, found = false;
  _queue[qt++] = start;
  while (qh < qt && !found) {
    const cur = _queue[qh++];
    const cr = (cur / COLS) | 0, cc = cur % COLS;
    for (let d = 0; d < 4; d++) {
      const nr = cr + _DR[d], nc = cc + _DC[d];
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const nk = nr * COLS + nc;
      if (_seen[nk] === _stamp || _blocked[nk]) continue;
      _seen[nk] = _stamp; _prevCell[nk] = cur; _queue[qt++] = nk;
      if (nk === goal) { found = true; break; }
    }
  }
  if (!found) return null;
  const path = [];
  let k = goal;
  while (k !== start) { path.unshift({ r: (k / COLS) | 0, c: k % COLS }); k = _prevCell[k]; }
  return path;
}
// খাবার খাওয়ার পর নিজের লেজ পর্যন্ত পৌঁছানো যাবে কি না — না গেলে সাপ নিজের ফাঁদে আটকে মরে।
// এই একটা পরীক্ষার জন্যই সাপ অনেক বেশিক্ষণ বাঁচে, স্কোর অনেক বড় হয়, দেখতেও বুদ্ধিমান লাগে।
function tailSafe(body){
  if (body.length < 3) return true;
  markBlocked(body);
  return bfsFirstStep(body[0].r, body[0].c, body[body.length-1].r, body[body.length-1].c) !== -1;
}
function chooseDir(){
  const body = game.body;
  const head = body[0];
  // ১) খাবার পর্যন্ত সোজা পথ আছে? থাকলে সেই পথে গেলে পরে নিজের লেজ পর্যন্ত ফিরতে পারব কি না দেখি
  const path = bfsFullPath(body, game.food);
  if (path && path.length) {
    const after = simulateAlongPath(body, path, game.food);
    if (tailSafe(after)) {
      return { r: path[0].r - head.r, c: path[0].c - head.c };
    }
  }
  // ২) খাবারের দিকে যাওয়া এখন নিরাপদ না — তাই "বেঁচে থাকার" চাল।
  // ⚠️ আগে এখানে সোজা লেজের পিছু পিছু (shortest path to tail) যাওয়া হতো। কিন্তু লেজের সবচেয়ে
  // কাছের পথ মানে সাপ নিজের গায়ে গা লাগিয়ে কুণ্ডলী পাকিয়ে থাকে — একবার ওই অবস্থায় ঢুকলে সে
  // ঘণ্টার পর ঘণ্টা শুধু গোল গোল ঘুরতে থাকত, খাবারের দিকে আর কখনো যেত না। পরীক্ষায় দেখা গেছে
  // ১০টা খেলার প্রতিটাই এভাবে অনন্তকাল আটকে থাকছিল, স্কোর এক জায়গায় থেমে যাচ্ছিল।
  // এখন উল্টোটা করা হচ্ছে: যে বৈধ চালে (ক) লেজ পর্যন্ত ফেরার পথ খোলা থাকে এবং (খ) লেজ থেকে
  // দূরত্ব সবচেয়ে বেশি হয়, সেটাই বাছা হয়। এতে কুণ্ডলী ধীরে ধীরে খুলে যায়, জায়গা তৈরি হয়, আর
  // অল্প কিছু চালের মধ্যেই খাবার পর্যন্ত নিরাপদ পথ আবার খুলে যায় — খেলা থেমে থাকে না।
  let bestDir = null, bestRank = -1;
  const newTail = body[body.length - 2] || body[body.length - 1]; // চাল দেওয়ার পর লেজ যেখানে থাকবে
  for (let d = 0; d < 4; d++) {
    const nr = head.r + _DR[d], nc = head.c + _DC[d];
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    markBlocked(body);
    if (_blocked[keyOf(nr, nc)]) continue;
    markBlockedAfterMove(body, nr, nc);
    const dTail = bfsDistance(nr, nc, newTail.r, newTail.c);
    if (dTail === -1) continue;              // লেজ পর্যন্ত ফেরার পথ বন্ধ — এই চাল আত্মহত্যা
    if (dTail > bestRank) { bestRank = dTail; bestDir = { r: _DR[d], c: _DC[d] }; }
  }
  if (bestDir) return bestDir;
  // ৩) শেষ উপায় — যেদিকে সবচেয়ে বেশি খোলা জায়গা সেদিকে
  let best = null, bestSpace = 0;
  for (let d = 0; d < 4; d++) {
    markBlocked(body);
    const space = floodCount(head.r + _DR[d], head.c + _DC[d]);
    if (space > bestSpace) { bestSpace = space; best = { r: _DR[d], c: _DC[d] }; }
  }
  return best;
}
// ---------------------------------------------------------------------------
// পরের চাল আগেভাগে ভেবে রাখা — এটাই "আটকে আটকে" চলার শেষ কারণটা দূর করে।
// আগে ঠিক যে ফ্রেমে সাপ এক ঘর এগোতো, সেই একই ফ্রেমেই পুরো পথ-খোঁজার হিসেবটাও হতো।
// ফলে ঐ ফ্রেমটা বাকিগুলোর চেয়ে ভারী হয়ে যেত আর প্রতি ধাপে একটা ছোট ঝাঁকুনি দেখা যেত।
// এখন চাল দেওয়ার সাথে সাথেই পরের চালটা আলাদা করে (setTimeout 0 — অর্থাৎ দুটো ফ্রেমের
// মাঝের অলস সময়ে) হিসেব করে রাখা হয়। ফলে যে ফ্রেমে সাপ এগোয় সেটায় আঁকা ছাড়া আর কোনো
// কাজই থাকে না — গতি একদম সমান থাকে।
// ---------------------------------------------------------------------------
function scheduleThink(){
  if (thinkTimer) return;
  thinkTimer = setTimeout(function(){
    thinkTimer = null;
    if (game) { try { pendingDir = chooseDir(); } catch(e) { pendingDir = null; } }
  }, 0);
}
function step(){
  const dir = (pendingDir !== null) ? pendingDir : chooseDir();
  pendingDir = null;
  if (!dir) { endGame(); return; }
  const head = { r: game.body[0].r + dir.r, c: game.body[0].c + dir.c };
  const ate = game.food && head.r === game.food.r && head.c === game.food.c;
  prevBody = game.body.map((s) => ({ r: s.r, c: s.c }));
  game.body.unshift(head);
  if (ate) {
    score += 10;
    stepsSinceEat = 0;
    game.food = randomFood(game.body);
    prevBody.push(prevBody[prevBody.length-1]); // দৈর্ঘ্য মিলিয়ে রাখা, যাতে interpolation-এ ঝাঁকুনি না লাগে
    playEatSound();
    mouthOpenUntil = performance.now() + 420;
    document.getElementById("scoreVal").textContent = score;
  } else {
    game.body.pop();
    stepsSinceEat++;
  }
  game.dir = dir; lastDir = dir;
  updateDpad(dir);
  curBody = game.body.map((s) => ({ r: s.r, c: s.c }));
  curFood = game.food;
  if (!game.food) { endGame(true); return; } // পুরো বোর্ড ভরে গেছে — নিখুঁত গেম!
  // বোর্ড এত ভরে গেছে যে বাকি খাবারে আর পৌঁছানো যাচ্ছে না — ~৩ মিনিট কিছু না খেলে খেলা শেষ ধরা হয়,
  // নইলে স্ট্রিমে একই সাপ অনন্তকাল গোল গোল ঘুরতে থাকত আর নতুন খেলা কখনো শুরু হতো না
  if (stepsSinceEat > 1500) { endGame(true); return; }
  scheduleThink(); // পরের চালটা এখনই, ফ্রেমের বাইরে ভেবে রাখা হচ্ছে
}
function endGame(perfect){
  const flashEl = document.getElementById("flash");
  flashEl.textContent = (perfect ? "🏆 Board Mastered — Score: " : "💀 Game Over — Score: ") + score;
  flashEl.classList.remove("show"); void flashEl.offsetWidth; flashEl.classList.add("show");
  if (!scoreSubmitted) {
    scoreSubmitted = true;
    fetch("/gaming/snake/highscore", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ score }) })
      .then((r) => r.json()).then((d) => { highScore = d.score; highScoreName = d.name; paintHighScore(); }).catch(() => {});
  }
  resumeAt = performance.now() + GAMEOVER_PAUSE_MS;
  setTimeout(startFreshGame, GAMEOVER_PAUSE_MS);
}
function startFreshGame(){
  game = newGame(); score = 0; scoreSubmitted = false; tickAcc = 0;
  pendingDir = null; stepsSinceEat = 0;
  if (thinkTimer) { clearTimeout(thinkTimer); thinkTimer = null; }
  prevBody = game.body.map((s) => ({ r: s.r, c: s.c }));
  curBody = game.body.map((s) => ({ r: s.r, c: s.c }));
  curFood = game.food;
  document.getElementById("scoreVal").textContent = "0";
  scheduleThink(); // প্রথম চালটাও আগেভাগে ভেবে রাখা, যাতে শুরুর ফ্রেমেও ঝাঁকুনি না লাগে
}
function paintHighScore(){
  document.getElementById("highScoreVal").textContent = highScore;
  document.getElementById("highScoreNameVal").textContent = highScoreName || "Grandmaster";
}
// হাই-স্কোর সার্ভার থেকে আনা — এটা গেমের গতির সাথে জড়িত না, তাই ধীরে ধীরে (৮ সেকেন্ডে একবার)
// আনলেই যথেষ্ট; এতে সাপের চলায় কোনো প্রভাব পড়ে না
function syncHighScore(){
  fetch("/gaming/snake/highscore").then((r) => r.json())
    .then((d) => { if (typeof d.score === "number" && d.score >= highScore) { highScore = d.score; highScoreName = d.name; paintHighScore(); } })
    .catch(() => {});
}
setInterval(syncHighScore, 8000); syncHighScore();
startFreshGame();
// রেফারেন্স ভিডিওর মতো রংধনু-রঙের পুঁতির চেইন — মাথা বাদে প্রতিটা পুঁতি এই প্যালেট থেকে ক্রমানুসারে রঙ পায়,
// সাপ যতই বড় হোক প্রতিটা পুঁতি নিজের রঙ ধরে রাখে (index-ভিত্তিক, তাই বাড়লে re-render-এও অপরিবর্তিত থাকে)
const SNAKE_RAINBOW = ["#FF2D55","#FF9500","#FFCC00","#8BE28B","#34C759","#00C7BE","#30B0C7","#32ADE6","#5856D6","#AF52DE"];

function updateDpad(dir){
  ["dUp","dDown","dLeft","dRight"].forEach(id => document.getElementById(id).classList.remove("active"));
  if (!dir) return;
  if (dir.r === -1) document.getElementById("dUp").classList.add("active");
  else if (dir.r === 1) document.getElementById("dDown").classList.add("active");
  else if (dir.c === -1) document.getElementById("dLeft").classList.add("active");
  else if (dir.c === 1) document.getElementById("dRight").classList.add("active");
}

function render(now){
  requestAnimationFrame(render);
  try {
  // ---- ধাপ চালানো: স্থির timestep, ফ্রেম-রেট যাই হোক গতি একই থাকবে ----
  if (!lastFrameTs) lastFrameTs = now;
  let dt = now - lastFrameTs;
  lastFrameTs = now;
  // ট্যাব ব্যাকগ্রাউন্ডে চলে গেলে ব্রাউজার ফ্রেম থামিয়ে দেয় — ফিরে এলে যেন হঠাৎ ২০টা ধাপ
  // একসাথে না ফেলে (তাতেই "লাফ" দেখা যেত), তাই বড় ফাঁক এলে সেটা এক ধাপে সীমিত করা হচ্ছে
  if (dt > 400) dt = TICK_MS;
  // মানুষ খেলার সময় AI-এর নিজের খেলা থেমে থাকে — বোর্ডে তখন চ্যালেঞ্জারের খেলাটাই আঁকা হয়
  if (game && now >= resumeAt && !mirrorMode) {
    tickAcc += dt;
    // একসাথে বড়জোর ২ ধাপ — এর বেশি হলে দর্শক "লাফ" দেখতে পায়, তাই বাড়তিটুকু ফেলে দেওয়া হয়
    let guard = 0;
    while (tickAcc >= TICK_MS && guard++ < 2) {
      tickAcc -= TICK_MS;
      // একটা ধাপে অপ্রত্যাশিত কিছু ঘটলেও গেম যেন চিরতরে থমকে না যায় — সাথে সাথে নতুন গেম শুরু হবে
      try { step(); } catch (e) { console.warn("step() error — নতুন গেম শুরু হচ্ছে", e); startFreshGame(); break; }
    }
    if (tickAcc > TICK_MS) tickAcc = 0;
  } else {
    tickAcc = 0;
  }
  if (!curBody) {
    // যদি সার্ভার থেকে কোনো state এখনো না এসে থাকে (fresh deploy/সাময়িক নেটওয়ার্ক সমস্যা),
    // অন্তত একটা "Loading..." দেখানো হচ্ছে যাতে বোঝা যায় সমস্যাটা কোথায়, একদম ফাঁকা না থাকে
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#FFD866"; ctx.font = "bold 20px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Loading...", canvas.width/2, canvas.height/2);
    return;
  }
  // প্রতিটা ফ্রেমে ঠিক কতটা সময় পেরিয়েছে সেটা জমিয়ে রেখে ধাপগুলো ফেলা হচ্ছে (accumulator পদ্ধতি)।
  // ফলে ধাপের সময় সবসময় হুবহু TICK_MS, আর দুই ধাপের মাঝের ভগ্নাংশটাই (t) নিখুঁত interpolation দেয় —
  // এটাই "আটকে আটকে চলা" পুরোপুরি বন্ধ করে দেয়, কারণ এখানে আর কোনো নেটওয়ার্ক অপেক্ষা নেই।
  // মিরর মোডে সময় গোনা হয় শেষ কবে নতুন অবস্থা এসেছে তার থেকে — নিজের tickAcc থেকে নয়
  const t = mirrorMode
    ? Math.min(1, (now - mirrorAt) / MIRROR_TICK_MS)
    : Math.min(1, tickAcc / TICK_MS);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // ব্যাকগ্রাউন্ড সম্পূর্ণ স্বচ্ছ — সবুজ ফিল আর নেই, ভিডিও ব্যাকগ্রাউন্ড সরাসরি দেখা যাবে (Ball Sort-এর প্যাটার্নে)

  // খাবার — গ্লসি, দুই-টোন হাইলাইট, হালকা pulsating
  const pulse = 1 + Math.sin(now/220)*0.08;
  const fx = curFood.c*cellSize+cellSize/2, fy = curFood.r*cellSize+cellSize/2;
  ctx.fillStyle = "#E8443D";
  ctx.beginPath(); ctx.arc(fx, fy, cellSize*0.38*pulse, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath(); ctx.arc(fx-cellSize*0.1, fy-cellSize*0.1, cellSize*0.12*pulse, 0, Math.PI*2); ctx.fill();

  // সাপ — রেফারেন্স ভিডিওর মতো আলাদা আলাদা গোল, রঙিন পুঁতির (bead) চেইন, সোজা tube না।
  // প্রতিটা পুঁতির রঙ তার মাথা থেকে দূরত্ব (index) অনুযায়ী নির্ধারিত — তাই সাপ যতই বাড়ুক, প্রতিটা
  // পুঁতি নিজের রঙ ধরে রাখে, শুধু নতুন লেজের দিকে নতুন রঙ যোগ হতে থাকে (প্যালেট শেষ হলে আবার শুরু থেকে)
  let body = curBody;
  if (prevBody && prevBody.length === curBody.length) {
    body = curBody.map((seg, i) => ({
      r: prevBody[i].r + (seg.r - prevBody[i].r) * t,
      c: prevBody[i].c + (seg.c - prevBody[i].c) * t,
    }));
  }
  let pts = body.map((seg) => ({ x: seg.c*cellSize+cellSize/2, y: seg.r*cellSize+cellSize/2 }));
  // মোড়/বাঁক-গুলো যেন "কাটা কাটা" (sharp, jagged) না লাগে — প্রতিবেশী বিন্দুর গড়ের দিকে সামান্য
  // টেনে নিয়ে (Laplacian smoothing) কোনাগুলো গোলাকার করা হচ্ছে, মাথা আর একদম শেষ প্রান্ত অপরিবর্তিত থাকে
  for (let iter = 0; iter < 2; iter++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const prev = pts[i-1], next = pts[i+1];
      return { x: p.x*0.5 + (prev.x+next.x)*0.25, y: p.y*0.5 + (prev.y+next.y)*0.25 };
    });
  }
  // ⚠️ আগে এখানে একটা perpendicular "swaying/wiggle" যোগ করা হয়েছিল, কিন্তু সেটা "হাওয়ায় ভাসছে"-এর
  // মতো লাগছিল বলে সম্পূর্ণ সরিয়ে দেওয়া হলো — সাপ এখন শুধু গন্তব্যের দিকে সরাসরি, মসৃণভাবে এগোবে
  const beadR = cellSize * 0.46;
  // লেজ থেকে মাথার দিকে আঁকা হচ্ছে, যাতে মাথা সবসময় বাকি পুঁতিগুলোর উপরে (overlap) থাকে
  for (let i = pts.length - 1; i >= 1; i--) {
    const color = SNAKE_RAINBOW[(i - 1) % SNAKE_RAINBOW.length];
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, beadR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath(); ctx.arc(pts[i].x - beadR*0.28, pts[i].y - beadR*0.28, beadR*0.32, 0, Math.PI*2); ctx.fill();
  }
  // মাথা — নির্দিষ্ট/স্থায়ী রঙ (লাল), দুটো চোখ। বল খাওয়ার মুহূর্তে মুখ "হাঁ" হয়ে সামনে এগিয়ে
  // বলটা খেয়ে আবার বন্ধ হয়ে যায় (Pac-Man-এর মতো একটা wedge কেটে বাদ দিয়ে আঁকা হচ্ছে)
  const head = pts[0];
  const dirAngle = Math.atan2(lastDir.r, lastDir.c); // মুখ যেদিকে তাকিয়ে আছে সেই কোণ
  let mouthOpenAmt = 0;
  const mouthRemain = mouthOpenUntil - now;
  if (mouthRemain > 0) {
    const MOUTH_ANIM_MS = 420;
    const progress = Math.min(1, Math.max(0, 1 - mouthRemain / MOUTH_ANIM_MS));
    mouthOpenAmt = Math.sin(progress * Math.PI); // ০ → ১ → ০ (খোলা → পুরোপুরি হাঁ → বন্ধ)
  }
  const maxGap = 0.85; // radian — সর্বোচ্চ কতটা হাঁ হবে
  const gapHalf = mouthOpenAmt * maxGap;
  ctx.fillStyle = "#E8443D";
  ctx.beginPath();
  if (gapHalf > 0.03) {
    ctx.moveTo(head.x, head.y);
    ctx.arc(head.x, head.y, beadR*1.08, dirAngle + gapHalf, dirAngle - gapHalf + Math.PI*2);
    ctx.closePath();
  } else {
    ctx.arc(head.x, head.y, beadR*1.08, 0, Math.PI*2);
  }
  ctx.fill();
  // মুখের ভেতরের অংশ (হাঁ থাকা অবস্থায় একটু গাঢ় ছায়া, বাস্তবসম্মত গভীরতার অনুভূতি)
  if (gapHalf > 0.03) {
    ctx.fillStyle = "#7a1410";
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.arc(head.x, head.y, beadR*0.85, dirAngle + gapHalf, dirAngle - gapHalf + Math.PI*2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath(); ctx.arc(head.x - beadR*0.3, head.y - beadR*0.3, beadR*0.35, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(head.x-beadR*0.32, head.y-beadR*0.15, beadR*0.28, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(head.x+beadR*0.32, head.y-beadR*0.15, beadR*0.28, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#0a0e1f";
  ctx.beginPath(); ctx.arc(head.x-beadR*0.32, head.y-beadR*0.15, beadR*0.13, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(head.x+beadR*0.32, head.y-beadR*0.15, beadR*0.13, 0, Math.PI*2); ctx.fill();
  } catch(err) {
    // ভবিষ্যতে যদি আবার এমন কোনো bug হয় যেটা draw করার মাঝপথে থেমে যায়, অন্তত এখানে স্পষ্ট
    // error message দেখা যাবে (ক্যানভাসের উপরেই লেখা), স্ক্রিনশট পাঠালেই আসল কারণ সরাসরি বোঝা যাবে
    ctx.fillStyle = "#3a0e0e"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#FF8A80"; ctx.font = "13px monospace"; ctx.textAlign = "center";
    ctx.fillText("Render error: " + (err && err.message ? err.message : String(err)), canvas.width/2, canvas.height/2);
  }
}
requestAnimationFrame(render);

// (আগে এখানে প্রতি ১১০ms-এ সার্ভারে HTTP রিকোয়েস্ট পাঠানোর poll() ছিল — সেটাই ছিল থেমে থেমে
//  চলার আসল কারণ, তাই সম্পূর্ণ সরিয়ে দেওয়া হয়েছে। গেম এখন ১০০% ব্রাউজারেই চলে।)

/* =========================================================================
   চ্যালেঞ্জারের খেলা লাইভে দেখানো (mirror)
   -------------------------------------------------------------------------
   কেউ লাইনে দাঁড়িয়ে খেলতে শুরু করলে এই বোর্ডে তার খেলাটাই চলতে থাকে — সে যেদিকে
   সাপ ঘোরাচ্ছে, এখানেও ঠিক সেদিকেই ঘোরে। দর্শক তাই বিশ্বাস করে "ওর খেলাটাই লাইভে"।
   কেউ না খেললে বা মাঝপথে চলে গেলে AI নিজে থেকেই আবার খেলা শুরু করে দেয়।
   ========================================================================= */
var mirrorMode = false, mirrorSeq = -1, mirrorAt = 0;
var MIRROR_TICK_MS = 190; // চ্যালেঞ্জ পেজের সাপ এই গতিতে চলে — একই গতিতে interpolate করলে মসৃণ দেখায়

function applyMirrorState(d){
  if (d.seq === mirrorSeq) return;
  mirrorSeq = d.seq; mirrorAt = performance.now();
  var st = d.state || {};
  // আগের অবস্থা → নতুন অবস্থা, মাঝেরটুকু interpolate হয় — তাই ঝাঁকুনি ছাড়া মসৃণ চলে
  prevBody = curBody && curBody.length ? curBody : (st.body || []);
  curBody = st.body || [];
  curFood = st.food || null;
  if (typeof st.score === "number") document.getElementById("scoreVal").textContent = st.score;
  if (st.dir) lastDir = st.dir;
  updateDpad(lastDir);
}
function pollMirror(){
  fetch("/gaming/gq/snake/mirror").then(function(r){ return r.json(); }).then(function(d){
    // ⚠️ এখানে আর AI থামানো হয় না। খেলোয়াড় নিয়ম দেখছে/তৈরি হচ্ছে — ততক্ষণ দর্শক
    // যেন স্থির পর্দা না দেখে, তাই AI-এর খেলাই চলতে থাকে। শুধু জানিয়ে রাখা হয় পরে কে আসছে।
    if (d.upNext){
      document.getElementById("flash").textContent = "🎮 Up next: " + d.upNext;
    }
    if (d.active && d.state && d.state.body){
      if (!mirrorMode){
        document.getElementById("flash").classList.remove("show");
      }
      if (!mirrorMode){
        mirrorMode = true;
        document.getElementById("flash").textContent = "🎮 " + d.name + " is playing live!";
        document.getElementById("flash").classList.add("show");
        setTimeout(function(){ document.getElementById("flash").classList.remove("show"); }, 2600);
      }
      applyMirrorState(d);
    } else if (mirrorMode){
      // খেলোয়াড় শেষ করেছেন বা চলে গেছেন — AI আবার নিজের খেলা শুরু করবে
      mirrorMode = false; mirrorSeq = -1;
      startFreshGame();
    }
  }).catch(function(){});
}
setInterval(pollMirror, 200);

// AI যখন খেলছে তখন তার অবস্থাও প্রকাশ করা হয় — লাইনে দাঁড়ানো দর্শক নিজের ফোনেই
// এই খেলাটা দেখতে পায়, তাই অপেক্ষার সময় তার পর্দা কখনো ফাঁকা থাকে না
setInterval(function(){
  if (mirrorMode || !curBody) return;
  fetch("/gaming/watch/snake", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ state: { body: curBody, food: curFood, score: score, dir: lastDir } })
  }).catch(function(){});
}, 220);
${celebrationJS("snake")}
</script></body></html>`;

const BALLSORT_OVERLAY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Ball Sort Puzzle — Live</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;}
html{background:#0a0e1f;}
body{margin:0;color:#F5F7FA;
font-family:'Segoe UI',sans-serif;overflow-y:auto;min-height:100vh;padding:10px;position:relative;}
.liveFrame{display:grid;grid-template-columns:230px 1fr 230px;gap:10px;height:calc(100vh - 20px);}
#bgVideo{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;opacity:0;
transition:opacity 0.8s ease;}
/* ভিডিওটা একটু ম্লান করার জন্য আগে CSS filter ব্যবহার হতো — সেটা প্রতিটা ভিডিও-ফ্রেমে পুরো পর্দা
   নতুন করে হিসেব করতে বাধ্য করত (jank-এর বড় কারণ)। এখন তার বদলে একটা স্থির, আধা-স্বচ্ছ কালো
   পর্দা উপরে বসানো হয়েছে — এটা একবারই আঁকা হয়, প্রতি ফ্রেমে কোনো খরচ নেই। */
#bgDim{position:fixed;inset:0;z-index:-1;background:rgba(6,9,20,0.22);pointer-events:none;}
/* ভিডিও না এলে যেন পর্দা মরা-কালো না লাগে — ধীরে রং বদলানো একটা জীবন্ত স্তর সবসময় পেছনে থাকে */
#bgFallback{position:fixed;inset:0;z-index:-3;background:linear-gradient(135deg,#101a3d,#0a0e1f 45%,#241442);}
.sideCol{display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;}
.centerCol{display:flex;flex-direction:column;align-items:center;min-height:0;height:100%;}
h1{color:#FFD866;font-size:20px;margin:0 0 4px;text-shadow:0 2px 12px rgba(255,216,102,0.35);}
#statusLine{color:#7C8AAD;font-size:12px;margin-bottom:3px;font-weight:700;min-height:16px;}
#statusLine.solved{color:#8BE28B;}
#fastestLine{color:#8BE28B;font-size:11px;margin-bottom:5px;font-weight:700;background:#161b2e;
border:1px solid #2a3352;border-radius:8px;padding:4px 12px;}
#fastestLine b{color:#FFD866;}
/* ১৪টা টিউব — উপরে ৭টা, নিচে ৭টা। আগে ১০-কলামের ছকে ছিল বলে নিচের সারিতে মাত্র ৪টা টিউব থেকে
   ডানদিকের বিরাট অংশ ফাঁকা পড়ে থাকত। এখন দুই সারিতে সমান ভাগ হওয়ায় পুরো পর্দা ভরে যায়, আর
   সেই বাড়তি জায়গাটুকু কাজে লাগিয়ে টিউব ও বল দুটোই অনেক বড় করা গেছে। */
#tubesWrap{flex:1;min-height:0;width:100%;display:grid;grid-template-columns:repeat(7,auto);
grid-template-rows:1fr 1fr;gap:12px 0;align-items:center;justify-items:center;
justify-content:space-evenly;padding:2px 0;}
/* কাচের মতো টিউব — আধা-স্বচ্ছ, ওপরে-নিচে হালকা রিফ্লেকশন স্ট্রাইপ, পাতলা উজ্জ্বল বর্ডার।
   উচ্চতা এখন সারির পুরোটা নেয়, আর প্রস্থ সেই উচ্চতা থেকেই অনুপাতে হিসেব হয় (aspect-ratio) —
   ফলে ছোট-বড় যেকোনো পর্দাতেই টিউব যতটা সম্ভব বড় হয়, কখনো উপচে পড়ে না */
/* aspect-ratio ৪-এর নিচে নামানো যায় না — টিউবে ৪টা বল খাড়াভাবে বসে, তাই উচ্চতা অন্তত
   ৪ × বলের ব্যাস হতেই হবে। বলকে বড় করার একমাত্র উপায় টিউবকে লম্বা করা, তাই উপরের
   হেডিং/লাইনগুলো ছোট করে সেই জায়গাটুকু টিউবকে দেওয়া হয়েছে। */
.tube{height:100%;aspect-ratio:1/4.05;max-width:210px;
background:linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 8%, rgba(20,26,46,0.55) 20%, rgba(10,14,31,0.68) 100%);
border:2px solid rgba(255,255,255,0.30);border-top:none;border-radius:5px 5px 26px 26px;
display:flex;flex-direction:column-reverse;padding:5px;gap:4px;
box-shadow:0 10px 26px rgba(0,0,0,0.55), inset 3px 0 6px rgba(255,255,255,0.12), inset -3px 0 6px rgba(0,0,0,0.35);position:relative;overflow:hidden;
transition:box-shadow 0.35s ease, border-color 0.35s ease;}
/* "ভাবছে" — চাল দেওয়ার ঠিক আগে যে টিউব থেকে বল তোলা হবে সেটা একটু জ্বলে ওঠে, যেন কেউ তাকিয়ে
   ভাবছে কোনটা তুলবে; দর্শক তখন নিজেও আন্দাজ করার সময় পায় */
.tube.thinking{border-color:rgba(255,216,102,0.85);box-shadow:0 0 26px rgba(255,216,102,0.55), 0 10px 26px rgba(0,0,0,0.55);}
.tube.target{border-color:rgba(139,226,139,0.8);box-shadow:0 0 22px rgba(139,226,139,0.45), 0 10px 26px rgba(0,0,0,0.55);}
.tube::before{content:"";position:absolute;top:0;left:8%;width:14%;height:100%;background:linear-gradient(180deg,rgba(255,255,255,0.35),rgba(255,255,255,0.05));
border-radius:20px;pointer-events:none;} /* কাচের গায়ে আলোর প্রতিফলনের রেখা */
.ball{width:100%;aspect-ratio:1;border-radius:50%;box-shadow:0 3px 6px rgba(0,0,0,0.45);position:relative;z-index:1;}
.flyingBall{border-radius:50%;box-shadow:0 6px 14px rgba(0,0,0,0.6);z-index:20;}
/* স্ক্রিন-রেকর্ডিং-এর টাচ-পয়েন্ট রিং-এর মতো — বল তোলা/রাখার মুহূর্তে দেখা দেয়, মনে হয় কেউ হাত দিয়ে ধরছে */
.tapIndicator{position:fixed;width:36px;height:36px;border-radius:50%;border:3px solid rgba(255,216,102,0.9);
background:rgba(255,216,102,0.15);pointer-events:none;z-index:25;animation:tapPulse 0.5s ease-out forwards;}
@keyframes tapPulse{0%{transform:scale(0.4);opacity:1;}70%{transform:scale(1.3);opacity:0.6;}100%{transform:scale(1.6);opacity:0;}}
.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:900;
color:#8BE28B;opacity:0;pointer-events:none;text-shadow:0 0 30px rgba(0,0,0,0.9);}
.flash.show{animation:pop 2.2s ease-out forwards;}
@keyframes pop{0%{opacity:0;transform:scale(0.6);}15%{opacity:1;transform:scale(1.05);}80%{opacity:1;}100%{opacity:0;}}
/* বাম কলাম — QR/Help Me বক্স + সাম্প্রতিক সাপোর্টারদের স্থায়ী তালিকা */
#tipQrWrap{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:12px;text-align:center;flex-shrink:0;}
#tipQrImg{width:120px;height:120px;border-radius:10px;background:#fff;padding:6px;display:block;margin:0 auto;}
.tipLabel{color:#FFD866;font-weight:800;font-size:14px;margin-top:8px;}
.tipSub{color:#5a6a8a;font-size:9px;margin-top:4px;line-height:1.35;}
.rulesBox{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:10px;flex:1;min-height:0;overflow-y:auto;}
.rulesBox h3{margin:0 0 8px;font-size:11px;color:#FFD866;text-transform:uppercase;letter-spacing:1px;font-weight:800;}
.miniListRow{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #202a44;font-size:11px;}
.miniListRow:last-child{border-bottom:none;}
.miniAvatar{width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;}
.miniAvatarFallback{width:20px;height:20px;border-radius:50%;background:#4FC3F7;color:#0a0e1f;font-weight:800;
font-size:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
/* ডান কলাম — টপ ৩ সাপোর্টার */
.topSupporterPanel{flex:1;display:flex;flex-direction:column;min-height:0;background:#161b2e;
border:1px solid #2a3352;border-radius:14px;overflow:hidden;}
.tsPhoto{flex:8.5;background:#0a0e1f;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;}
.tsRank{position:absolute;top:5px;left:5px;width:20px;height:20px;border-radius:50%;background:#FFD866;
color:#0a0e1f;font-weight:900;font-size:10px;display:flex;align-items:center;justify-content:center;z-index:2;}
.tsPhoto img{width:100%;height:100%;object-fit:cover;}
.tsPhoto .tsFallback{width:55%;height:55%;border-radius:50%;background:#4FC3F7;color:#0a0e1f;font-weight:900;
font-size:24px;display:flex;align-items:center;justify-content:center;}
.tsInfo{flex:1.5;display:flex;align-items:center;justify-content:center;background:#12172a;border-top:1px solid #2a3352;
font-size:10px;font-weight:700;color:#fff;padding:2px 4px;text-align:center;}
.tsInfo .tsAmt{color:#FFD866;}
/* যে চ্যালেঞ্জ করে বর্তমানে খেলছে তার ছবি — এখনো real challenge backend যোগ হয়নি, তাই আপাতত placeholder */
#challengerBox{background:#161b2e;border:1px solid #2a3352;border-radius:14px;overflow:hidden;flex:0 0 34%;
display:flex;flex-direction:column;}
#challengerPhotoWrap{flex:1;background:#0a0e1f;display:flex;align-items:center;justify-content:center;overflow:hidden;}
#challengerPhotoWrap img{width:100%;height:100%;object-fit:cover;}
#challengerPhotoWrap .cFallback{width:60%;height:60%;border-radius:50%;background:#4FC3F7;color:#0a0e1f;
font-weight:900;font-size:30px;display:flex;align-items:center;justify-content:center;}
#challengerName{padding:6px;text-align:center;font-size:12px;font-weight:800;background:#12172a;border-top:1px solid #2a3352;}
.altView{display:none;}
.altView.show{display:block;}
/* নিচে-স্ক্রল-করা ব্যাকগ্রাউন্ড মিউজিক+কমেন্ট্রি সেটিংস — দর্শক/স্ট্রিম কখনো এটা দেখবে না, শুধু
   normal live-frame উচ্চতার নিচে থাকে, আপনি নিজের মনিটরে স্ক্রল করলে দেখতে পাবেন */
#bgSettingsPanel{max-width:560px;margin:30px auto 20px;padding:20px;background:#12172a;border:1px solid #2a3352;
border-radius:16px;position:relative;}
#bgSettingsPanel h2{color:#FFD866;font-size:16px;margin:0 0 4px;}
#bgSettingsPanel label{display:block;margin-top:14px;font-size:11px;color:#7C8AAD;font-weight:700;}
#bgSettingsPanel input[type=text],#bgSettingsPanel input[type=number],#bgSettingsPanel textarea{width:100%;padding:9px;border-radius:8px;border:1px solid #26314f;
background:#0f1526;color:#fff;font-size:13px;margin-top:5px;box-sizing:border-box;font-family:inherit;}
#bgSettingsPanel textarea{min-height:90px;resize:vertical;}
#bgSettingsPanel input[type=range]{width:100%;margin-top:6px;}
#bgSettingsPanel button{margin-top:14px;padding:10px 18px;border-radius:8px;border:none;background:#FFD866;
color:#0a0e1f;font-weight:800;cursor:pointer;font-size:13px;}
#bgSettingsStatus{margin-top:10px;font-size:12px;color:#8BE28B;min-height:16px;}
${CELEBRATION_CSS}
</style></head><body>
${CELEBRATION_HTML}
<div id="bgFallback"></div>
<div id="bgDim"></div>
<video id="bgVideo" autoplay muted loop playsinline preload="auto" src="/game-assets/ballsort-bg.mp4"></video>
<script>
// ব্রাউজার কখনো কখনো নিজে থেকে autoplay শুরু করে না (বিশেষত OBS/PRISM-এর ভেতরে) — তাই বারবার
// চেষ্টা করা হচ্ছে। ভিডিও কোনো কারণে না এলে নিচের নড়াচড়া করা gradient ব্যাকগ্রাউন্ডটা থেকে যাবে।
(function(){
  var v = document.getElementById("bgVideo");
  function tryPlay(){ var p = v.play(); if (p && p.catch) p.catch(function(){}); }
  v.addEventListener("canplay", tryPlay);
  v.addEventListener("loadeddata", function(){ v.style.opacity = "0.78"; });
  v.addEventListener("error", function(){ console.warn("ব্যাকগ্রাউন্ড ভিডিও লোড হয়নি — /gaming/assets-check দেখুন"); });
  document.addEventListener("visibilitychange", tryPlay);
  setInterval(function(){ if (v.paused) tryPlay(); }, 3000);
  tryPlay();
})();
</script>
<div class="liveFrame">
<div class="sideCol">
  <div id="challengerBox">
    <div id="challengerPhotoWrap"><div class="cFallback">?</div></div>
    <div id="challengerName">No one playing right now</div>
  </div>
  <div id="tipQrWrap">
    <img id="tipQrImg" src="" alt="Scan to help">
    <div class="tipLabel">🙏 Help Me</div>
    <div class="tipSub">Voluntary support — not tied to the game, never required</div>
  </div>
  <div class="rulesBox">
    <div class="altView show" id="recentView">
      <h3>💛 Recent Supporters</h3>
      <div id="recentDonorList"></div>
    </div>
    <div class="altView" id="queueView">
      <h3>⏳ Challenge Queue</h3>
      <div id="queueList"><div style="font-size:10px;color:#5a6a8a;">No one in queue right now</div></div>
    </div>
    <div class="altView" id="howToView">
      <h3>🎮 Beat the Grandmaster</h3>
      <div style="font-size:10px;color:#9fb0d4;line-height:1.6;">
        Join the queue and play live<br>
        <b style="color:#FFD866;">/gaming/challenge/ballsort</b><br><br>
        Solve it faster than the record<br>and your name goes up here.
      </div>
    </div>
  </div>
</div>
<div class="centerCol">
  <h1>🧪 Ball Sort Puzzle — Live</h1>
  <div id="statusLine">Thinking...</div>
  <div id="fastestLine">🏆 Fastest solve: <b id="fastestTime">—</b> — <span id="fastestName">Grandmaster</span></div>
  <div id="tubesWrap"></div>
</div>
<div class="sideCol">
  <div class="topSupporterPanel" id="topSup1"><div class="tsPhoto" id="tsPhoto1"><div class="tsRank">1</div></div><div class="tsInfo" id="tsInfo1">—</div></div>
  <div class="topSupporterPanel" id="topSup2"><div class="tsPhoto" id="tsPhoto2"><div class="tsRank">2</div></div><div class="tsInfo" id="tsInfo2">—</div></div>
  <div class="topSupporterPanel" id="topSup3"><div class="tsPhoto" id="tsPhoto3"><div class="tsRank">3</div></div><div class="tsInfo" id="tsInfo3">—</div></div>
</div>
</div>
<div id="bgSettingsPanel">
  <h2>🎵 Background Music &amp; Commentary</h2>
  <form id="bgSettingsForm">
    <label>Music link (copyright-free MP3/audio URL — leave blank for no music)</label>
    <input type="text" id="bgMusicUrlInput" placeholder="https://...mp3">
    <label>Volume — <span id="volLabel">15%</span></label>
    <input type="range" id="bgMusicVolumeInput" min="0" max="1" step="0.05" value="0.15">
    <label>Your own recorded commentary audio links (one URL per line — cycles through them)</label>
    <textarea id="commentaryUrlsInput" placeholder="https://example.com/commentary1.mp3"></textarea>
    <label>Seconds between commentary clips (example: 90 = every 1.5 minutes)</label>
    <input type="number" id="loopIntervalInput" min="20" value="90">
    <label>Announcement voice (which voice reads out names and tips)</label>
    <select id="celebVoiceSelect"></select>
    <label>Background video link (direct .mp4 URL — leave blank to use the repo folder)</label>
    <input type="text" id="bgVideoUrlInput" placeholder="https://.../background.mp4">
    <button type="submit">Save</button>
    <div id="bgSettingsStatus"></div>
  </form>
</div>
<div class="flash" id="flash"></div>
<script>
// ⚠️ কোনো কারণে স্ক্রিপ্টের যেকোনো জায়গায় unexpected error হলে, নীরবে গেম থামিয়ে না দিয়ে
// সরাসরি স্ক্রিনে দেখানো — যাতে স্ক্রিনশট পাঠালেই আসল কারণ বোঝা যায়
window.addEventListener("error", (e) => {
  const statusEl = document.getElementById("statusLine");
  if (statusEl) { statusEl.textContent = "⚠️ Script error: " + e.message; statusEl.style.color = "#FF8A80"; }
});
// ---------- QR/Help Me + টপ ৩ সাপোর্টার + সাম্প্রতিক সাপোর্টার (স্থায়ী তালিকা) ----------
document.getElementById("tipQrImg").src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(location.origin + "/pay/ballsort");
function fillTopSupporterPanel(idx, donor){
  const photoEl = document.getElementById("tsPhoto" + idx);
  const infoEl = document.getElementById("tsInfo" + idx);
  if (!donor) { photoEl.innerHTML = '<div class="tsRank">' + idx + '</div><div class="tsFallback">?</div>'; infoEl.innerHTML = '<span style="color:#5a6a8a;">No tips yet</span>'; return; }
  photoEl.innerHTML = '<div class="tsRank">' + idx + '</div>' + (donor.photo ? '<img src="'+donor.photo+'">' : '<div class="tsFallback">'+((donor.name&&donor.name[0])||"?")+'</div>');
  infoEl.innerHTML = donor.name + ' <span class="tsAmt">₹' + Math.round(donor.amount) + '</span>';
}
async function refreshTopDonors(){
  try { const res = await fetch("/top-donors/ballsort"); const data = await res.json(); const top = data.top || [];
    fillTopSupporterPanel(1, top[0]); fillTopSupporterPanel(2, top[1]); fillTopSupporterPanel(3, top[2]); } catch(e){}
}
async function refreshRecentDonors(){
  try { const res = await fetch("/recent-donors/ballsort?limit=6"); const data = await res.json(); const list = data.recent || [];
    document.getElementById("recentDonorList").innerHTML = list.length ? list.map(d =>
      '<div class="miniListRow">' + (d.photo ? '<img class="miniAvatar" src="'+d.photo+'">' : '<div class="miniAvatarFallback">'+(d.name[0]||"?")+'</div>') +
      '<div>'+d.name+' <span style="color:#FFD866;font-weight:700;">₹'+Math.round(d.amount)+'</span></div></div>'
    ).join("") : '<div style="font-size:10px;color:#5a6a8a;">No tips yet</div>'; } catch(e){}
}
refreshTopDonors(); refreshRecentDonors();
setInterval(refreshTopDonors, 20000); setInterval(refreshRecentDonors, 20000);

// Recent Supporters ↔ Challenge Queue — প্রতি ১ মিনিটে পালাক্রমে বদলায়
// (⚠️ চ্যালেঞ্জ/queue-এর real backend এখনো এই গেমে যোগ হয়নি, তাই queueList আপাতত সবসময় খালি দেখাবে)
var altIdx = 0;
var ALT_VIEWS = ["recentView", "queueView", "howToView"];
function toggleAltPanel(){
  altIdx = (altIdx + 1) % ALT_VIEWS.length;
  ALT_VIEWS.forEach(function(v, i){
    document.getElementById(v).classList.toggle("show", i === altIdx);
  });
}
setInterval(toggleAltPanel, 20000);

/* ---------- কে এখন খেলছে + লাইনে কারা ---------- */
// বাম কলামের ছবির বাক্সে এখন খেলোয়াড়ের আসল ছবি ও নাম দেখা যাবে — দর্শক বুঝবে
// স্ক্রিনে যে খেলছে সে-ই লাইভে আছে
function refreshChallengeQueue(){
  fetch("/gaming/gq/ballsort/public").then(function(r){ return r.json(); }).then(function(d){
    var wrap = document.getElementById("challengerPhotoWrap");
    var nameEl = document.getElementById("challengerName");
    if (d.nowPlaying){
      var np = d.nowPlaying;
      wrap.innerHTML = np.photoUrl
        ? '<img src="' + np.photoUrl + '">'
        : '<div class="cFallback">' + ((np.name && np.name[0]) || "?") + '</div>';
      nameEl.innerHTML = np.name + (np.tipAmount ? ' <span style="color:#FFD866;">₹' + np.tipAmount + '</span>' : '');
    } else {
      wrap.innerHTML = '<div class="cFallback">?</div>';
      nameEl.textContent = "No one playing right now";
    }
    var list = d.queue || [];
    document.getElementById("queueList").innerHTML = list.length
      ? list.slice(0, 6).map(function(q){
          return '<div class="miniListRow">' +
            (q.photoUrl ? '<img class="miniAvatar" src="' + q.photoUrl + '">'
                        : '<div class="miniAvatarFallback">' + ((q.name && q.name[0]) || "?") + '</div>') +
            '<div><b>#' + q.position + '</b> ' + q.name +
            (q.tipAmount ? ' <span style="color:#FFD866;font-weight:700;">₹' + q.tipAmount + '</span>' : '') +
            '</div></div>';
        }).join("")
      : '<div style="font-size:10px;color:#5a6a8a;">No one in queue right now</div>';
  }).catch(function(){});
}
refreshChallengeQueue();
setInterval(refreshChallengeQueue, 3000);

// ব্যাকগ্রাউন্ড মিউজিক + কমেন্ট্রি — এই পেজেই নিচে স্ক্রল করলে ফর্ম দিয়ে সরাসরি সেট করা যায় (chess-এর প্যাটার্নে)
const bgMusicEl = new Audio();
bgMusicEl.loop = true;
const commentaryAudioEl = new Audio();
let lastMusicUrl = "";
let lastVideoUrl = "";
let commentaryList = [];
let commentaryIdx = 0;
let commentaryTimer = null;
function scheduleCommentary(intervalSec){
  if (commentaryTimer) clearInterval(commentaryTimer);
  if (!commentaryList.length) return;
  commentaryTimer = setInterval(() => {
    commentaryAudioEl.src = commentaryList[commentaryIdx % commentaryList.length];
    commentaryAudioEl.play().catch(() => {});
    commentaryIdx++;
  }, Math.max(20, intervalSec) * 1000);
}
async function loadMusicConfig(){
  try {
    const res = await fetch("/gaming/ballsort-config");
    const cfg = await res.json();
    if (cfg.bgMusicUrl && cfg.bgMusicUrl !== lastMusicUrl) {
      lastMusicUrl = cfg.bgMusicUrl;
      bgMusicEl.src = cfg.bgMusicUrl;
      bgMusicEl.play().catch(() => {});
    }
    // ⚠️ সরাসরি .volume বসালে ঘোষণার মাঝখানে সেটিংস রিফ্রেশ হলে ডাকিং ভেঙে যেত —
    // তাই আসল মানটা baseMusicVolume-এ রাখা হয়, আর প্রকৃত ভলিউম হিসেব করে বসানো হয়
    baseMusicVolume = typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15;
    savedVoiceURI = cfg.celebVoiceURI || savedVoiceURI;
    resolveCelebVoice();
    applyMusicVolume();
    const newList = Array.isArray(cfg.commentaryUrls) ? cfg.commentaryUrls : [];
    if (JSON.stringify(newList) !== JSON.stringify(commentaryList)) {
      commentaryList = newList; commentaryIdx = 0;
      scheduleCommentary(cfg.loopIntervalSec || 90);
    }
    if (document.activeElement !== document.getElementById("bgMusicUrlInput")) {
      document.getElementById("bgMusicUrlInput").value = cfg.bgMusicUrl || "";
    }
    document.getElementById("bgMusicVolumeInput").value = typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15;
    document.getElementById("volLabel").textContent = Math.round((typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15) * 100) + "%";
    if (document.activeElement !== document.getElementById("commentaryUrlsInput")) {
      document.getElementById("commentaryUrlsInput").value = newList.join(String.fromCharCode(10));
    }
    if (document.activeElement !== document.getElementById("loopIntervalInput")) {
      document.getElementById("loopIntervalInput").value = cfg.loopIntervalSec || 90;
    }
    if (document.activeElement !== document.getElementById("bgVideoUrlInput")) {
      document.getElementById("bgVideoUrlInput").value = cfg.bgVideoUrl || "";
    }
    // সেটিংসে আলাদা ভিডিও-ঠিকানা দেওয়া থাকলে সেটাই ব্যবহার হবে — তখন GitHub ফোল্ডারের নাম
    // ঠিক আছে কিনা তা নিয়ে আর ভাবতে হয় না
    if (cfg.bgVideoUrl && cfg.bgVideoUrl !== lastVideoUrl) {
      lastVideoUrl = cfg.bgVideoUrl;
      var vEl = document.getElementById("bgVideo");
      vEl.src = cfg.bgVideoUrl;
      vEl.load();
      vEl.play().catch(function(){});
    }
  } catch(e) {}
}
loadMusicConfig();
setInterval(loadMusicConfig, 15000);
document.body.addEventListener("click", () => { bgMusicEl.play().catch(() => {}); }, { once: true });
document.getElementById("bgMusicVolumeInput").addEventListener("input", (e) => {
  document.getElementById("volLabel").textContent = Math.round(e.target.value * 100) + "%";
});
document.getElementById("bgSettingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("bgSettingsStatus");
  const linesRaw = document.getElementById("commentaryUrlsInput").value;
  const lines = linesRaw.split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean);
  try {
    await fetch("/gaming/ballsort-config", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        bgMusicUrl: document.getElementById("bgMusicUrlInput").value.trim(),
        bgMusicVolume: parseFloat(document.getElementById("bgMusicVolumeInput").value) || 0.15,
        commentaryUrls: lines,
        loopIntervalSec: parseInt(document.getElementById("loopIntervalInput").value, 10) || 90,
        bgVideoUrl: document.getElementById("bgVideoUrlInput").value.trim(),
        celebVoiceURI: document.getElementById("celebVoiceSelect").value || "",
      }) });
    statusEl.textContent = "Saved!";
    lastMusicUrl = "";
  } catch(e) { statusEl.textContent = "Could not save — network problem."; }
});

let lastStatus = "";
let lastMoveSig = "";
let animating = false;

let audioCtx = null;
document.body.addEventListener("click", () => { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); }, { once: true });
// মিষ্টি, নরম "জল ঢালার" মতো শব্দ — বল টিউব থেকে বেরিয়ে অন্য টিউবে পড়ার মুহূর্তে বাজে
// রঙ হালকা/গাঢ় করার হেল্পার — বলগুলোকে 3D গ্লসি দেখানোর জন্য (আগে ফ্ল্যাট রঙ ছিল, "মেরা" লাগছিল)
function shadeColor(hex, percent){
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + Math.round(255 * (percent/100));
  let g = ((num >> 8) & 0x00FF) + Math.round(255 * (percent/100));
  let b = (num & 0x0000FF) + Math.round(255 * (percent/100));
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return "#" + (0x1000000 + r*0x10000 + g*0x100 + b).toString(16).slice(1);
}
function ballGradient(color){
  return "radial-gradient(circle at 32% 26%, " + shadeColor(color, 55) + ", " + color + " 55%, " + shadeColor(color, -32) + " 100%)";
}

function playPourSound(){
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.28);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t+0.03); g.gain.exponentialRampToValueAtTime(0.001, t+0.32);
    osc.connect(g).connect(sfxOut()); osc.start(t); osc.stop(t+0.34);
    // ছোট্ট "প্লিং" — বল টিউবে গিয়ে বসার মুহূর্তে
    const osc2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    osc2.type = "triangle"; osc2.frequency.setValueAtTime(1100, t+0.26);
    g2.gain.setValueAtTime(0.0001, t+0.26); g2.gain.exponentialRampToValueAtTime(0.12, t+0.27); g2.gain.exponentialRampToValueAtTime(0.001, t+0.4);
    osc2.connect(g2).connect(sfxOut()); osc2.start(t+0.26); osc2.stop(t+0.42);
  }catch(e){}
}

// সবশেষে যে বোর্ডটা আঁকা হয়েছে সেটা মনে রাখা — অপেক্ষমাণ দর্শকদের কাছে এটাই পাঠানো হয়
var lastTubes = null, lastColors = null;
function renderStatic(tubes, colors){
  lastTubes = tubes; lastColors = colors;
  const wrap = document.getElementById("tubesWrap");
  wrap.innerHTML = "";
  tubes.forEach((tube) => {
    const tubeEl = document.createElement("div");
    tubeEl.className = "tube";
    tube.forEach((colorIdx) => {
      const ball = document.createElement("div");
      ball.className = "ball";
      ball.style.background = ballGradient(colors[colorIdx]);
      tubeEl.appendChild(ball);
    });
    wrap.appendChild(tubeEl);
  });
}

// আসল "বল বেরিয়ে অন্য টিউবে ঢোকা" অ্যানিমেশন — আগে বল সরাসরি লাফিয়ে অন্য জায়গায় দেখা যেত, এখন
// বল টিউব থেকে উপরে উঠে, বাঁক নিয়ে, তারপর নতুন টিউবে নেমে যায় — যেন সত্যিই কেউ ঢালছে
// ⚠️ এটাই ছিল আসল সমস্যা। AI-এর একটা চাল দেখাতে প্রায় ৩ সেকেন্ড লাগে, আর সেই সময়ের
// মধ্যে কয়েকটা setTimeout সারিবদ্ধ থাকে। মাঝপথে চ্যালেঞ্জারের খেলা শুরু হলে animating
// পতাকা নামিয়ে দিলেও ওই পুরনো setTimeout গুলো ঠিকই চলত আর শেষে নিজের বোর্ড এঁকে
// দিত — তাই মূল স্ক্রিনে বারবার AI-এর পুরনো খেলাটাই ফিরে আসত।
// এখন প্রতিটা অ্যানিমেশন শুরুর সময় একটা "প্রজন্ম" নম্বর ধরে রাখে; মিরর চালু হলেই নম্বরটা
// বদলে যায়, আর পুরনো অ্যানিমেশনের প্রতিটা ধাপ নিজে থেকেই থেমে যায়।
var bsRenderGen = 0, bsAnimRunning = 0;
// একটা অ্যানিমেশন শেষ/বাতিল হলে "ব্যস্ত" পতাকা নামানো — কিন্তু ততক্ষণে নতুন অ্যানিমেশন
// শুরু হয়ে গেলে নয়। গোনাগুনি ছাড়া করলে একটা বাতিল হওয়া অ্যানিমেশন নতুনটার পতাকা নামিয়ে
// দিত, আর দুটো অ্যানিমেশন একসাথে চলে বোর্ড এলোমেলো হয়ে যেত।
function bsAnimDone(){
  bsAnimRunning = Math.max(0, bsAnimRunning - 1);
  if (bsAnimRunning === 0) animating = false;
}
function cancelAiAnimation(){
  bsRenderGen++;          // পুরনো সব অ্যানিমেশন এতেই অচল হয়ে যায়
  bsAnimRunning = 0;
  animating = false;
  var stray = document.querySelector(".flyingBall");
  if (stray) stray.remove(); // উড়ন্ত বলটা পর্দায় আটকে থাকতে দেওয়া যাবে না
}
function animateMove(mv, tubesAfter, colors){
  var myGen = bsRenderGen;
  function stale(){ return myGen !== bsRenderGen; }
  bsAnimRunning++;
  animating = true;
  // চাল দেওয়ার *আগের* অবস্থাটা আঁকা হচ্ছে, তারপর সেখান থেকে বলটা তুলে নেওয়ার অ্যানিমেশন
  const before = tubesAfter.map((t) => [...t]);
  const movedColor = before[mv.to].pop();
  before[mv.from].push(movedColor);
  renderStatic(before, colors);

  const wrap = document.getElementById("tubesWrap");
  const fromTubeEl = wrap.children[mv.from];
  const toTubeEl = wrap.children[mv.to];
  if (!fromTubeEl || !toTubeEl) { bsAnimDone(); renderStatic(tubesAfter, colors); return; }
  const srcBall = fromTubeEl.lastElementChild; // column-reverse — শেষ সন্তানই টিউবের সবচেয়ে উপরের বল
  if (!srcBall) { bsAnimDone(); renderStatic(tubesAfter, colors); return; }

  const toRect = toTubeEl.getBoundingClientRect();
  const srcRect = srcBall.getBoundingClientRect();
  // ⚠️ বলের আকার আর অবস্থান আগে হাতে হিসেব করা হতো (টিউবের প্রস্থ − ১৬px ইত্যাদি)। প্যাডিং/বর্ডার
  // একটু বদলালেই সেই হিসেব ভুল হয়ে যেত, আর উড়ন্ত বলটা আসল বলের চেয়ে ছোট/বড় দেখাতো। এখন সরাসরি
  // আসল বলের মাপ ও অবস্থান পড়ে নেওয়া হচ্ছে — CSS যাই হোক, সবসময় নিখুঁতভাবে মিলবে।
  const ballSize = srcRect.width;
  const startX = srcRect.left, startY = srcRect.top;

  // বলটা গন্তব্য টিউবে ঠিক কোথায় গিয়ে বসবে — উপরের বলের ঠিক উপরে, নাহলে টিউবের একদম নিচে
  const GAP = 4, PAD = 5, BORDER = 2;
  const endX = toRect.left + (toRect.width - ballSize) / 2;
  const topBallOfTarget = toTubeEl.lastElementChild;
  const endY = topBallOfTarget
    ? topBallOfTarget.getBoundingClientRect().top - GAP - ballSize
    : toRect.bottom - BORDER - PAD - ballSize;

  const flyBall = document.createElement("div");
  flyBall.className = "ball flyingBall";
  flyBall.style.background = ballGradient(colors[movedColor]);
  flyBall.style.position = "fixed";
  flyBall.style.width = ballSize + "px"; flyBall.style.height = ballSize + "px";
  flyBall.style.left = startX + "px"; flyBall.style.top = startY + "px";
  document.body.appendChild(flyBall);

  // স্ক্রিন-রেকর্ডিং-এ যেমন আঙুলের ট্যাপ পয়েন্ট দেখায়, তেমনি একটা "tap" রিং — মনে হবে কেউ হাত দিয়ে
  // বলটা তুলে অন্য টিউবে রাখছে, নিজে নিজে ভেসে যাচ্ছে না
  function showTapIndicator(x, y){
    const tap = document.createElement("div");
    tap.className = "tapIndicator";
    tap.style.left = (x - 18) + "px"; tap.style.top = (y - 18) + "px";
    document.body.appendChild(tap);
    setTimeout(() => { tap.remove(); }, 500);
  }

  // ---- ১) "ভাবার" মুহূর্ত ----
  // চাল দেওয়ার আগে ৭০০ms ধরে উৎস ও গন্তব্য টিউব দুটো জ্বলে ওঠে। এতে দর্শক আগেভাগে বুঝতে পারে
  // কোন বলটা কোথায় যাচ্ছে, আর পুরো ব্যাপারটা তাড়াহুড়ো না লেগে "ভেবেচিন্তে খেলা" মনে হয়।
  fromTubeEl.classList.add("thinking");
  toTubeEl.classList.add("target");
  const riseTop = Math.min(srcRect.top, toRect.top) - 55; // দুটো টিউবেরই উপরে, যাতে কাচে ধাক্কা না লাগে

  setTimeout(function(){
    if (stale()) { flyBall.remove(); bsAnimDone(); return; } // চ্যালেঞ্জারের খেলা শুরু হয়ে গেছে
    // ---- ২) তুলে নেওয়া ----
    fromTubeEl.classList.remove("thinking");
    showTapIndicator(startX + ballSize/2, startY + ballSize/2);
    srcBall.style.visibility = "hidden"; // আসল বলটা লুকিয়ে ফেলা, নাহলে দুটো বল একসাথে দেখা যেত
    playPourSound();
    flyBall.style.transition = "top 1.0s ease-out";
    flyBall.style.top = riseTop + "px";

    setTimeout(function(){
      if (stale()) { flyBall.remove(); bsAnimDone(); return; }
      // ---- ৩) পাশে সরে গিয়ে নেমে বসা ----
      flyBall.style.transition = "left 1.2s ease-in-out, top 1.25s ease-in";
      flyBall.style.left = endX + "px";
      flyBall.style.top = endY + "px";

      setTimeout(function(){
        if (stale()) { flyBall.remove(); bsAnimDone(); return; }
        // ---- ৪) রেখে দেওয়ার মুহূর্ত ----
        showTapIndicator(endX + ballSize/2, endY + ballSize/2);
        flyBall.remove();
        toTubeEl.classList.remove("target");
        renderStatic(tubesAfter, colors);
        bsAnimDone();
      }, 1270);
    }, 1020);
  }, 700);
}

async function poll(){
  if (animating || bsMirror) return; // মানুষ খেলার সময় AI-এর বোর্ড আঁকা বন্ধ // একটা অ্যানিমেশন চলাকালীন নতুন poll-এর জন্য অপেক্ষা, নাহলে ছন্দ ভেঙে যাবে
  try{
    const res = await fetch("/gaming/state/ballsort.json?t="+Date.now());
    const data = await res.json();
    const statusEl = document.getElementById("statusLine");

    if (data.fastest && typeof data.fastest.seconds === "number") {
      const m = Math.floor(data.fastest.seconds/60), s = data.fastest.seconds%60;
      document.getElementById("fastestTime").textContent = m + "m " + s + "s";
      document.getElementById("fastestName").textContent = data.fastest.name || "Grandmaster";
    }

    if (data.status === "solving") {
      statusEl.textContent = "🤔 একটা বড় পাজল — সমাধান খুঁজে বের করছে...";
      statusEl.classList.remove("solved");
      // ⚠️ আসল বাগ — এই "solving" অবস্থায় টিউবগুলো কখনো রেন্ডারই হতো না, তাই বড় পাজলে
      // AI চিন্তা করার পুরোটা সময় (এখন আরও দীর্ঘ, ১৮ রঙের কারণে) টিউব একদম ফাঁকা দেখাতো
      if (lastStatus !== "solving") { renderStatic(data.tubes, data.colors); lastMoveSig = ""; }
      lastStatus = data.status;
      return;
    }
    if (data.status === "solved") {
      statusEl.textContent = "✅ Solved! Starting a new puzzle...";
      statusEl.classList.add("solved");
      if (lastStatus !== "solved") {
        renderStatic(data.tubes, data.colors);
        const flashEl = document.getElementById("flash");
        flashEl.textContent = "🎉 Solved!";
        flashEl.classList.remove("show"); void flashEl.offsetWidth; flashEl.classList.add("show");
      }
      lastStatus = data.status; lastMoveSig = "";
      return;
    }
    statusEl.textContent = "Thinking... " + data.movesLeft + " moves left";
    statusEl.classList.remove("solved");
    const moveSig = data.lastMove ? (data.lastMove.from + "-" + data.lastMove.to + "-" + data.movesLeft) : "init";
    if (data.lastMove && moveSig !== lastMoveSig) {
      lastMoveSig = moveSig;
      animateMove(data.lastMove, data.tubes, data.colors);
    } else if (!data.lastMove) {
      renderStatic(data.tubes, data.colors);
    }
    lastStatus = data.status;
  }catch(e){ animating = false; }
}
setInterval(poll, 500); poll();

/* ---------- চ্যালেঞ্জারের পাজল লাইভে দেখানো ----------
   কেউ লাইনে দাঁড়িয়ে খেলতে শুরু করলে এই বোর্ডে তার পাজলটাই দেখা যায় — সে যে বলটা
   তুলছে, এখানেও সেই টিউবটাই জ্বলে ওঠে। কেউ না খেললে AI আবার নিজের পাজল সমাধান করে। */
var bsMirror = false, bsMirrorSeq = -1;
function pollBsMirror(){
  fetch("/gaming/gq/ballsort/mirror").then(function(r){ return r.json(); }).then(function(d){
    // ⚠️ এখানে আর AI থামানো হয় না। খেলোয়াড় নিয়ম দেখছে/তৈরি হচ্ছে — ততক্ষণ দর্শক
    // যেন স্থির পর্দা না দেখে, তাই AI-এর খেলাই চলতে থাকে। শুধু জানিয়ে রাখা হয় পরে কে আসছে।
    if (d.upNext){
      document.getElementById("statusLine").textContent = "🎮 Up next: " + d.upNext;
    }
    if (d.active && d.state && d.state.tubes){
      if (!bsMirror){
        bsMirror = true;
        cancelAiAnimation(); // প্রথম চাল আসামাত্রই AI-এর খেলা থামিয়ে দেওয়া
        document.getElementById("statusLine").textContent = "🎮 " + d.name + " is playing live!";
      }
      if (d.seq !== bsMirrorSeq){
        bsMirrorSeq = d.seq;
        var st = d.state;
        // ⚠️ আগে শুধু renderStatic ডাকা হতো, কিন্তু AI-এর পুরনো animation ততক্ষণে চলতে
        // থাকলে সে নিজের বোর্ড আবার এঁকে দিত — তাই মূল পর্দায় পুরনো খেলাটাই দেখা যেত।
        // এখন animating পতাকাটাও নামিয়ে দেওয়া হয়, ফলে AI-এর আঁকা সম্পূর্ণ থেমে যায়।
        cancelAiAnimation(); // AI-এর চলমান অ্যানিমেশন সম্পূর্ণ বাতিল
        renderStatic(st.tubes, st.colors || []);
        // খেলোয়াড় যে টিউব থেকে বল তুলেছে সেটা জ্বলে ওঠে — দর্শক বুঝতে পারে সে কী ভাবছে
        var wrap = document.getElementById("tubesWrap");
        if (typeof st.sel === "number" && st.sel >= 0 && wrap.children[st.sel]) {
          wrap.children[st.sel].classList.add("thinking");
        }
      }
    } else if (bsMirror){
      // খেলোয়াড় শেষ করেছেন বা চলে গেছেন — AI আবার নিজের পাজলে ফিরে যায়
      bsMirror = false; bsMirrorSeq = -1;
      cancelAiAnimation();
      document.getElementById("statusLine").textContent = "";
    }
  }).catch(function(){});
}
setInterval(pollBsMirror, 250);

// AI-এর পাজলের অবস্থাও প্রকাশ করা — অপেক্ষমাণ দর্শক এটাই দেখবে
setInterval(function(){
  if (bsMirror || !lastTubes) return;
  fetch("/gaming/watch/ballsort", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ state: { tubes: lastTubes, colors: lastColors, capacity: 4, sel: -1 } })
  }).catch(function(){});
}, 500);
${celebrationJS("ballsort")}
</script></body></html>`;

// ===========================================================================
// দর্শকদের চ্যালেঞ্জ পেজ — Snake ও Ball Sort
// ---------------------------------------------------------------------------
// চেসের মতো এখানে "লাইনে দাঁড়ানোর" (queue) দরকার নেই — কারণ চেসে চ্যালেঞ্জার সরাসরি overlay-র
// বোর্ডে AI-এর বিরুদ্ধে চাল দেয়, তাই একসাথে একজনই খেলতে পারে। কিন্তু Snake/Ball Sort-এ
// প্রতিযোগিতাটা রেকর্ডের বিরুদ্ধে (সর্বোচ্চ স্কোর / সবচেয়ে কম সময়) — তাই যত খুশি দর্শক একসাথে
// নিজের ফোনে খেলতে পারে, আর কেউ রেকর্ড ভাঙলে overlay-তে সাথে সাথে তার নাম বসে যায়।
// ===========================================================================
// চ্যালেঞ্জ পেজগুলোর জন্য ব্যাকগ্রাউন্ড-ভিডিও স্তর।
// overlay-তে যে ভিডিওটা চলছে, চ্যালেঞ্জারের ফোনেও ঠিক সেটাই চলবে — ফলে যে দর্শক
// স্ট্রিম দেখে লিংকে ঢুকছে, তার কাছে দুটো একই জগতের অংশ মনে হবে। ভিডিও না থাকলে
// নিচের স্থির gradient-টাই থেকে যায়, পর্দা কখনো ফাঁকা কালো দেখায় না।
function challengeBgLayer(videoFile, gradient) {
  return `
<div class="bgFallback"></div>
<video class="bgVideo" autoplay muted loop playsinline preload="auto" src="/game-assets/${videoFile}"></video>
<div class="bgDim"></div>
<style>
html{background:#0a0e1f;}
body{background:transparent !important;}
.bgFallback{position:fixed;inset:0;z-index:-3;background:${gradient};}
.bgVideo{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;opacity:0;
transition:opacity 1s ease;}
.bgDim{position:fixed;inset:0;z-index:-1;background:rgba(6,9,20,0.55);pointer-events:none;}
</style>
<script>
(function(){
  var v = document.querySelector(".bgVideo");
  v.addEventListener("loadeddata", function(){ v.style.opacity = "0.7"; });
  function go(){ var p = v.play(); if (p && p.catch) p.catch(function(){}); }
  v.addEventListener("canplay", go);
  document.addEventListener("visibilitychange", go);
  setInterval(function(){ if (v.paused) go(); }, 3000);
  go();
})();
</script>`;
}

const CHALLENGE_SHARED_CSS = `
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
body{margin:0;background:linear-gradient(160deg,#0a0e1f,#12081f 60%,#0a0e1f);color:#F5F7FA;
font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;padding:14px;display:flex;
flex-direction:column;align-items:center;}
h1{color:#FFD866;font-size:20px;margin:2px 0 2px;text-align:center;}
.sub{color:#7C8AAD;font-size:12px;margin-bottom:12px;text-align:center;line-height:1.5;}
.card{background:rgba(22,27,46,0.86);backdrop-filter:blur(6px);border:1px solid #2a3352;
border-radius:16px;padding:16px;width:100%;max-width:420px;}
label{display:block;font-size:11px;color:#7C8AAD;font-weight:700;margin-bottom:6px;}
input[type=text]{width:100%;padding:12px;border-radius:10px;border:1px solid #26314f;background:#0f1526;
color:#fff;font-size:16px;}
button{padding:13px 20px;border-radius:10px;border:none;background:#FFD866;color:#0a0e1f;
font-weight:800;cursor:pointer;font-size:15px;width:100%;margin-top:12px;}
button.ghost{background:#242c48;color:#cfd8ef;}
.record{color:#8BE28B;font-size:12px;font-weight:700;margin-bottom:10px;text-align:center;}
.record b{color:#FFD866;}
/* ⚠️ !important জরুরি — নিচে .screen{display:flex} নিয়মটা পরে আসে, আর দুটোর specificity
   সমান। তাই এটা ছাড়া .screen.hide কখনোই লুকাত না, আর সব পর্দা একসাথে একটার উপর আরেকটা
   জমে যেত (স্ক্রিনশটে ঠিক সেটাই দেখা গেছে)। */
.hide{display:none !important;}
/* ---- ঐচ্ছিক "Help Me" বক্স — চেস চ্যালেঞ্জ পেজে যেমন, ঠিক তেমনই ---- */
.tipBox{background:rgba(19,26,44,0.9);border:1px solid #26314f;border-radius:12px;padding:14px;
margin-top:16px;font-size:13px;color:#B8C4D9;text-align:center;}
.tipBox b{color:#F5F7FA;}
.notFee{font-size:12px;color:#8BE28B;font-weight:700;margin-top:8px;line-height:1.5;}
.helpBtn{display:block;width:100%;box-sizing:border-box;margin:12px 0 4px;padding:13px;
border-radius:10px;background:linear-gradient(135deg,#FF8A5B,#FFC53D);color:#0a0e1f;
font-weight:800;font-size:15px;text-decoration:none;text-align:center;}
.helpBtn small{display:block;font-weight:600;font-size:11px;opacity:0.75;margin-top:3px;}
.disclaimer{font-size:11px;color:#6b7b9c;margin-top:10px;line-height:1.6;text-align:left;
background:#0f1526;border-radius:8px;padding:10px;}
.msg{margin-top:12px;font-size:14px;font-weight:700;text-align:center;min-height:20px;line-height:1.5;}
.msg.win{color:#8BE28B;} .msg.lose{color:#FF8A80;}
`;

// লাইনে দাঁড়ানোর অংশটা দুটো চ্যালেঞ্জ পেজেই এক — তাই একবার লিখে দুই জায়গায় ব্যবহার
// ===========================================================================
// চ্যালেঞ্জ পেজের সাধারণ খোলস (তিনটে গেমেই এক)
// ---------------------------------------------------------------------------
// দর্শকের যাত্রাটা একদম সরল রাখা হয়েছে:
//   ১) নাম + ছবি → "Join the queue"
//   ২) সাথে সাথে একটা ছোট পপআপ — "সাহায্য করতে চান? টিপস দিন" (ঐচ্ছিক, এক চাপে পেমেন্ট)
//   ৩) তারপর একটাই পর্দা: উপরে ছোট্ট স্ট্যাটাস, মাঝে গেম বোর্ড, নিচে ইউটিউব লাইভ
//      — অপেক্ষার সময় বোর্ডে এখন যে খেলছে (AI বা অন্য কেউ) তার খেলাই দেখা যায়
//   ৪) পালা এলে বড় করে "YOUR TURN!", তারপর ৫ সেকেন্ডের ছোট্ট নিয়ম-দেখানো, তারপর খেলা
// পুরোটাই ফোনের এক পর্দায় — কোথাও স্ক্রল করতে হয় না।
// ===========================================================================
const PLAY_SHELL_CSS = `
html,body{height:100%;overflow:hidden;}
body{padding:0;display:flex;flex-direction:column;}
.hdr{padding:6px 12px 4px;text-align:center;flex-shrink:0;}
.hdr h1{font-size:14px;margin:0;}
/* ---- ধাপ ১: নাম ও ছবি ---- */
#joinCard{position:absolute;inset:0;z-index:30;overflow-y:auto;padding:16px;
display:flex;flex-direction:column;justify-content:center;}
/* ---- ধাপ ২: টিপসের পপআপ ---- */
#tipModal{position:absolute;inset:0;z-index:40;background:rgba(4,7,18,0.85);
display:flex;align-items:center;justify-content:center;padding:20px;}
#tipModal .box{background:#161b2e;border:1px solid #2a3352;border-radius:18px;padding:22px 20px;
text-align:center;max-width:340px;width:100%;}
#tipModal h3{margin:0 0 8px;font-size:18px;color:#FFD866;}
#tipModal p{font-size:12.5px;color:#B8C4D9;line-height:1.6;margin:0 0 4px;}
#tipModal .small{font-size:11px;color:#7C8AAD;margin-top:10px;line-height:1.5;}
/* ---- ধাপ ৩: মূল পর্দা ---- */
#stage{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 8px 8px;gap:6px;}
.statusStrip{background:rgba(22,27,46,0.92);border:1px solid #2a3352;border-radius:10px;
padding:7px 12px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.statusStrip .pos{font-size:13px;font-weight:800;color:#FFD866;}
.statusStrip .eta{font-size:11px;color:#8BE28B;font-weight:700;}
.statusStrip.myturn{border-color:#8BE28B;background:rgba(20,60,40,0.92);}
.statusStrip.myturn .pos{color:#8BE28B;}
.boardArea{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.watchTag{font-size:10px;color:#7C8AAD;text-align:center;flex-shrink:0;min-height:13px;}
.liveArea{height:30vh;flex-shrink:0;display:flex;flex-direction:column;}
.liveArea .cap{font-size:9.5px;color:#FF6B5E;font-weight:800;letter-spacing:0.6px;text-align:center;
margin-bottom:3px;display:flex;align-items:center;justify-content:center;gap:5px;}
.liveArea .cap i{width:6px;height:6px;border-radius:50%;background:#FF3B30;display:block;
animation:liveDot 1.4s ease-in-out infinite;}
@keyframes liveDot{0%,100%{opacity:1;}50%{opacity:0.25;}}
.liveArea iframe{flex:1;width:100%;border:0;border-radius:10px;background:#000;}
/* ---- পালা এলে ---- */
#turnBanner{position:absolute;inset:0;z-index:45;background:rgba(4,7,18,0.9);display:flex;
flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;}
#turnBanner .big{font-size:38px;font-weight:900;color:#8BE28B;line-height:1.1;
text-shadow:0 4px 20px rgba(139,226,139,0.5);}
#turnBanner .sub{font-size:14px;color:#F5F7FA;margin-top:10px;}
#tutorial{position:absolute;inset:0;z-index:44;background:rgba(4,7,18,0.92);display:flex;
flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;}
#tutorial h3{color:#FFD866;font-size:19px;margin:0 0 14px;}
#tutorial .step{font-size:14px;color:#E6ECFF;line-height:1.9;}
#tutorial .step b{color:#8BE28B;}
#tutorial .count{margin-top:18px;font-size:34px;font-weight:900;color:#FFD866;}
#doneCard{position:absolute;inset:0;z-index:35;overflow-y:auto;padding:20px;
display:flex;flex-direction:column;justify-content:center;}
`;

const QUEUE_CARDS_CSS = `
.qRow{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid #232b45;}
.qRow:first-child{border-top:none;}
.qPos{width:24px;font-size:12px;font-weight:800;color:#7C8AAD;}
.qAv{width:32px;height:32px;border-radius:50%;object-fit:cover;border:1px solid #2a3352;}
.qAvF{width:32px;height:32px;border-radius:50%;background:#2a3352;display:flex;align-items:center;
justify-content:center;font-weight:800;color:#9fb0d4;font-size:14px;}
.qName{flex:1;font-size:13px;font-weight:700;}
.qTip{font-size:12px;font-weight:800;color:#FFD866;}
.bigNum{font-size:44px;font-weight:900;color:#FFD866;line-height:1;}
.nowBox{background:#0f1526;border:1px solid #2a3352;border-radius:12px;padding:12px;margin-top:14px;}
.nowBox h4{margin:0 0 8px;font-size:11px;letter-spacing:1px;color:#7C8AAD;text-transform:uppercase;}
.turnBar{background:linear-gradient(135deg,#8BE28B,#34D399);color:#06210f;font-weight:800;
border-radius:10px;padding:10px;text-align:center;font-size:13px;margin-bottom:10px;}
#pushStatus{font-size:11px;color:#7C8AAD;margin-top:10px;line-height:1.5;}
`;

const QUEUE_CARDS_HTML = `
<div class="hide" id="waitCard">
  <div class="card">
    <div style="text-align:center;">
      <div style="font-size:11px;color:#7C8AAD;font-weight:700;letter-spacing:1px;">YOUR POSITION</div>
      <div class="bigNum" id="qPosition">—</div>
      <div style="font-size:12px;color:#7C8AAD;margin-top:4px;" id="qEta">লাইনে দাঁড়ানো হচ্ছে...</div>
    </div>
    <div class="nowBox">
      <h4>▶ এখন খেলছেন</h4>
      <div id="nowPlayingBox" style="font-size:12px;color:#5a6a8a;">এখনো কেউ খেলছেন না</div>
    </div>
    <div class="nowBox">
      <h4>⏳ লাইনে অপেক্ষা করছেন</h4>
      <div id="queueListBox" style="font-size:12px;color:#5a6a8a;">লাইনে কেউ নেই</div>
    </div>
    <div id="pushStatus"></div>
    <div style="font-size:11.5px;color:#8BE28B;text-align:center;margin-top:12px;line-height:1.6;">
      👇 অপেক্ষা করার সময় নিচে স্ক্রল করে<br><b>চলমান লাইভ স্ট্রিমটাই দেখতে পারেন</b>
    </div>
    <button class="ghost" id="leaveBtn" style="margin-top:12px;">লাইন থেকে সরে যান</button>
  </div>
</div>

<div class="hide" id="doneCard">
  <div class="card" style="text-align:center;">
    <div style="font-size:34px;">🎉</div>
    <div class="msg" id="doneMsg" style="margin-top:6px;"></div>
    <p style="font-size:12px;color:#7C8AAD;line-height:1.6;margin-top:10px;">
      একবার লাইনে দাঁড়ালে একবারই খেলা যায়।<br>আবার খেলতে চাইলে নতুন করে নাম দিয়ে লাইনে দাঁড়ান।
    </p>
    <button id="againBtn2">আবার লাইনে দাঁড়ান</button>
  </div>
</div>
`;

// gameKey: "snake" / "ballsort" | startFn: পালা এলে যে ফাংশনটা খেলা চালু করবে
// gameKey: "snake"/"ballsort" | startFn: পালা এলে খেলা চালু করার ফাংশন
// drawWatch: অপেক্ষার সময় "এখন কে খেলছে" তার অবস্থা বোর্ডে আঁকার ফাংশন
// tutorialHtml: খেলা শুরুর আগে ৫ সেকেন্ডের নিয়ম দেখানোর লেখা
function queueClientJS(gameKey, startFn, drawWatch, tutorialHtml) {
  return `
${PUSH_SETUP_JS}
var myQueueId = null, myTurnStarted = false, pollTimer = null, watchTimer = null, lastWatchSeq = null;
var joinAttempts = 0;

function show(id, on){ document.getElementById(id).classList.toggle("hide", !on); }

/* ---------- ধাপ ২: টিপসের পপআপ ----------
   লাইনে দাঁড়ানোর পর একবারই দেখা যায়। "No thanks" চাপলেই মূল পর্দায় চলে যায় —
   টাকা না দিলে খেলায় কোনো পার্থক্যই হয় না, সেটা পরিষ্কার লেখাও আছে। */
function openTipModal(){
  show("tipModal", true);
  fetch("/gaming/challenge/tip-info?game=${gameKey}").then(function(r){ return r.json(); })
    .then(function(d){
      if (!d.tipUrl) return;
      // dn = তার নাম, nophoto=1 = ছবিও আগেই দেওয়া আছে।
      // এই দুটোর জন্যই পেমেন্টের সময় আর নাম বা ছবি চাওয়া হয় না, আর সেলিব্রেশনটা
      // ঠিক তার নামেই হয় (নাম আলাদা হয়ে গেলে টিপসটা তার সাথে মিলত না)।
      document.getElementById("tipGo").href = d.tipUrl
        + "&dn=" + encodeURIComponent(playerName || "")
        + "&nophoto=1";
    }).catch(function(){});
}
function closeTipModal(){ show("tipModal", false); enterStage(); }

/* ---------- ধাপ ৩: মূল পর্দা ---------- */
function enterStage(){
  show("stage", true);
  setLiveOn();
  pollQueue();
  if (!pollTimer) pollTimer = setInterval(pollQueue, 3000);
  if (!watchTimer) watchTimer = setInterval(pollWatch, 220);
}
// অপেক্ষার সময় বোর্ডে এখন যে খেলছে তার খেলাটাই দেখা যায় — AI হোক বা অন্য কেউ
function pollWatch(){
  if (myTurnStarted) return; // নিজের পালা চলছে — তখন নিজের খেলাই আঁকা হয়
  fetch("/gaming/watch/${gameKey}").then(function(r){ return r.json(); }).then(function(d){
    var tag = document.getElementById("watchTag");
    if (!d.active || !d.state){ tag.textContent = ""; return; }
    tag.textContent = d.source === "player" ? ("▶ " + d.name + " is playing now") : "▶ Grandmaster is playing";
    if (d.seq !== lastWatchSeq){ lastWatchSeq = d.seq; ${drawWatch}(d.state); }
  }).catch(function(){});
}
function startTurnCountdown(){
  if (window.__turnTimer) clearInterval(window.__turnTimer);
  window.__turnTimer = setInterval(function(){
    fetch("/gaming/gq/${gameKey}/state?id=" + myQueueId).then(function(r){ return r.json(); })
      .then(function(st){
        if (st.secondsLeft == null) return;
        var m = Math.floor(st.secondsLeft / 60), sec = st.secondsLeft % 60;
        document.getElementById("qPos").textContent = "YOUR TURN";
        document.getElementById("qEta").textContent = m + ":" + (sec < 10 ? "0" : "") + sec + " left";
        if (st.secondsLeft <= 0) endMyTurn("Time is up — next player's turn.");
      }).catch(function(){});
  }, 1000);
}
/* ---------- পালা এলে: বড় ঘোষণা → ৫ সেকেন্ডের নিয়ম → খেলা ---------- */
function beginTurnSequence(){
  myTurnStarted = true;
  fetch("/gaming/gq/${gameKey}/ack", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: myQueueId }) }).catch(function(){});
  show("turnBanner", true);
  document.getElementById("statusStrip").classList.add("myturn");
  document.getElementById("qPos").textContent = "YOUR TURN";
  document.getElementById("qEta").textContent = "get ready…";
  setTimeout(function(){
    show("turnBanner", false);
    // নতুন অ্যাপ ইনস্টল করলে যেমন প্রথমে নিয়মটা দেখিয়ে দেয়, তেমনই — ৫ সেকেন্ড।
    // নোটিফিকেশনে চাপ দিয়ে সবে পেজে এসেছে, তাই কী করতে হবে জানার সময় দরকার।
    show("tutorial", true);
    var n = 5;
    document.getElementById("tutCount").textContent = n;
    var iv = setInterval(function(){
      n--;
      document.getElementById("tutCount").textContent = n > 0 ? n : "GO!";
      if (n <= 0){
        clearInterval(iv);
        setTimeout(function(){
          show("tutorial", false);
          startTurnCountdown();
          ${startFn}();
        }, 550);
      }
    }, 1000);
  }, 2000);
}
function endMyTurn(message){
  if (window.__turnTimer) { clearInterval(window.__turnTimer); window.__turnTimer = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  fetch("/gaming/gq/${gameKey}/finish", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: myQueueId }) }).catch(function(){});
  show("stage", false); show("doneCard", true);
  if (message) document.getElementById("doneMsg").textContent = message;
}
function pollQueue(){
  fetch("/gaming/gq/${gameKey}/state?id=" + myQueueId).then(function(r){ return r.json(); })
    .then(function(st){
      if (st.isYourTurn && !myTurnStarted){ beginTurnSequence(); return; }
      if (!st.isYourTurn && !myTurnStarted){
        if (st.position == null){ endMyTurn("Your turn has expired — join again to play."); return; }
        document.getElementById("qPos").textContent = "#" + st.position + " in queue";
        document.getElementById("qEta").textContent = "about " + st.etaMinutes + " min to go";
      }
    }).catch(function(){});
}
function joinQueue(){
  var name = document.getElementById("nameInput").value.trim();
  if (name.length < 2){ document.getElementById("startMsg").textContent = "Please type your name (2 letters or more)."; return; }
  var btn = document.getElementById("startBtn");
  btn.disabled = true; btn.textContent = "Joining…";
  // ফ্রি সার্ভার ঘুমিয়ে থাকলে প্রথম request-এ ৫০ সেকেন্ড পর্যন্ত লাগতে পারে।
  // চুপ করে থাকলে দর্শক ভাবে পেজটা ভেঙে গেছে — তাই কী হচ্ছে ধাপে ধাপে বলা হয়,
  // আর ব্যর্থ হলে নিজে থেকেই আরও দুবার চেষ্টা করা হয়।
  var waited = 0;
  var slow = setInterval(function(){
    waited += 4;
    if (waited <= 4) btn.textContent = "Starting the server… (about 30s)";
    else if (waited <= 12) btn.textContent = "Almost there — please wait… " + waited + "s";
    else btn.textContent = "Still waking up… " + waited + "s";
  }, 4000);
  // ⚠️ ছবি না দিলে FormData পাঠানো হয় না — ইচ্ছে করেই।
  // FormData মানে multipart, আর multipart পড়তে সার্ভারে multer লাগে। multer ইনস্টল না
  // থাকলে সার্ভার নামটা পড়তেই পারত না, ফলে সবার নাম নীরবে "Player" হয়ে যেত।
  // ছবি ছাড়া সাধারণ form-encoded পাঠালে নাম সবসময় ঠিকঠাক পৌঁছায়।
  var photo = document.getElementById("photoInput");
  var hasPhoto = !!(photo && photo.files && photo.files[0]);
  var req;
  if (hasPhoto) {
    var fd = new FormData();
    fd.append("name", name);
    fd.append("photo", photo.files[0]);
    req = { method: "POST", body: fd };
  } else {
    req = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "name=" + encodeURIComponent(name) };
  }
  fetch("/gaming/gq/${gameKey}/join", req)
    .then(function(r){ return r.json(); })
    .then(function(d){
      clearInterval(slow);
      if (!d.id) throw new Error("no id");
      myQueueId = d.id;
      try { localStorage.setItem("gq_${gameKey}", d.id); } catch(e){}
      playerName = name;
      show("joinCard", false);
      setupPush(myQueueId, null).catch(function(){});
      openTipModal();
    })
    .catch(function(){
      clearInterval(slow);
      // ঘুম থেকে ওঠার সময় প্রথম request প্রায়ই ব্যর্থ হয় — তাই নিজে থেকেই আবার চেষ্টা
      if (joinAttempts < 3){
        joinAttempts++;
        btn.textContent = "Retrying… (" + joinAttempts + "/3)";
        setTimeout(joinQueue, 2500);
      } else {
        btn.disabled = false; btn.textContent = "Try again";
      }
    });
}
document.getElementById("startBtn").addEventListener("click", joinQueue);
document.getElementById("tipSkip").addEventListener("click", closeTipModal);
document.getElementById("tipGo").addEventListener("click", function(){
  // পেমেন্ট পেজ থেকে ফিরে এলে যেন আবার নাম-ছবি দিতে না হয় — তাই id মনে রাখা আছে
  setTimeout(closeTipModal, 400);
});
document.getElementById("againBtn2").addEventListener("click", function(){
  try { localStorage.removeItem("gq_${gameKey}"); } catch(e){}
  location.reload();
});
document.getElementById("leaveBtn").addEventListener("click", function(){
  fetch("/gaming/gq/${gameKey}/leave", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: myQueueId }) }).finally(function(){
      try { localStorage.removeItem("gq_${gameKey}"); } catch(e){}
      location.reload();
    });
});

/* ---------- পেমেন্ট সেরে ফিরে এলে ----------
   টাকা দিতে গিয়ে পেজ ছেড়ে যেতে হয়। ফিরে এলে যেন আবার শুরু থেকে নাম-ছবি দিতে না হয়,
   তাই id মনে রাখা হয় আর সোজা মূল পর্দায় ফেরত নিয়ে যাওয়া হয়। */
(function restoreAfterPayment(){
  var saved = null;
  try { saved = localStorage.getItem("gq_${gameKey}"); } catch(e){}
  if (!saved) return;
  fetch("/gaming/gq/${gameKey}/state?id=" + saved).then(function(r){ return r.json(); })
    .then(function(st){
      if (st.position == null && !st.isYourTurn) { try { localStorage.removeItem("gq_${gameKey}"); } catch(e){} return; }
      myQueueId = saved;
      show("joinCard", false); show("tipModal", false);
      enterStage();
    }).catch(function(){});
})();
`;
}

const SNAKE_CHALLENGE_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Play Snake Live</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>${CHALLENGE_SHARED_CSS}${PLAY_SHELL_CSS}
#board{background:rgba(10,14,31,0.45);border:3px solid #6b4423;border-radius:8px;display:block;touch-action:none;}
/* ⚠️ নিচের ▲◀▶▼ বোতামগুলো সরিয়ে দেওয়া হয়েছে — বোর্ডের যেকোনো জায়গায় আঙুল
   টেনেই সাপ ঘোরানো যায়, তাই বোতামগুলো শুধু জায়গা খাচ্ছিল। ওই জায়গাটুকু এখন
   বোর্ডেই যোগ হয়েছে, ফলে বোর্ড অনেক বড় ও স্পষ্ট। */
.swipeHint{font-size:11px;color:#8BE28B;text-align:center;flex-shrink:0;font-weight:700;}
</style></head><body>
${challengeBgLayer("snake-bg.mp4", "linear-gradient(135deg,#0d2818,#0a0e1f 45%,#12331f)")}

<div class="hdr"><h1>🐍 Beat the Grandmaster</h1></div>

<!-- ধাপ ১ — শুধু নাম আর ছবি -->
<div id="joinCard">
  <div class="card">
    <div class="record">🏆 Record to beat: <b id="recScore">—</b> — <span id="recName">Grandmaster</span></div>
    <label>Your name (shown on the live stream)</label>
    <input type="text" id="nameInput" maxlength="24" placeholder="Type your name">
    <label>Your photo (optional — shown on the live stream)</label>
    <input type="file" id="photoInput" accept="image/*" style="color:#7C8AAD;font-size:13px;">
    <button id="startBtn">Join the queue</button>
    <div class="msg" id="startMsg"></div>
  </div>
</div>

<!-- ধাপ ২ — ঐচ্ছিক টিপস -->
<div id="tipModal" class="hide">
  <div class="box">
    <h3>🙏 Want to help me out?</h3>
    <p>You are in the queue. Playing is <b>free</b>.</p>
    <p>If you'd like, you can send a small tip to support the stream.</p>
    <a class="helpBtn" id="tipGo" href="#">💛 Send a Tip</a>
    <button class="ghost" id="tipSkip">No thanks — take me to the game</button>
    <div class="small">A tip does not change your score, your turn, or your place in the queue.
    After paying you come straight back here.</div>
  </div>
</div>

<!-- ধাপ ৩ — এক পর্দা: স্ট্যাটাস | বোর্ড | লাইভ -->
<div id="stage" class="hide">
  <div class="statusStrip" id="statusStrip">
    <span class="pos" id="qPos">Joining…</span>
    <span class="eta" id="qEta"></span>
  </div>
  <div class="boardArea">
    <canvas id="board"></canvas>
  </div>
  <div class="swipeHint" id="swipeHint">👆 Swipe anywhere on the board to turn</div>
  <div class="watchTag" id="watchTag"></div>
  <div class="liveArea">
    <div class="cap"><i></i>LIVE ON YOUTUBE</div>
    <iframe id="liveFrame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
  </div>
  <button class="ghost" id="leaveBtn" style="padding:7px;font-size:12px;flex-shrink:0;">Leave the queue</button>
</div>

<div id="turnBanner" class="hide">
  <div class="big">YOUR TURN!</div>
  <div class="sub">Get ready — everyone is watching you now</div>
</div>

<div id="tutorial" class="hide">
  <h3>How to play</h3>
  <div class="step">
    👆 <b>Swipe up / down / left / right</b><br>
    anywhere on the board to turn<br><br>
    🔴 Eat the red dot to grow<br>
    🚫 Don't hit the wall or yourself<br><br>
    <span style="color:#FFD866;">Longer snake = higher score</span>
  </div>
  <div class="count" id="tutCount">5</div>
</div>

<div id="doneCard" class="hide">
  <div class="card" style="text-align:center;">
    <div style="font-size:34px;">🎉</div>
    <div class="msg" id="doneMsg" style="margin-top:6px;"></div>
    <p style="font-size:12px;color:#7C8AAD;line-height:1.6;margin-top:10px;">
      One turn per join.<br>To play again, join the queue again.
    </p>
    <button id="againBtn2">Join again</button>
  </div>
</div>

<script>
var COLS = 15, ROWS = 21, TICK = 190;
var canvas = document.getElementById("board"), ctx = canvas.getContext("2d");
var cell = 20, snake = null, dir = null, nextDir = null, food = null, score = 0;
var timer = null, playerName = "", alive = false;
var RAINBOW = ["#FF2D55","#FF9500","#FFCC00","#8BE28B","#34C759","#00C7BE","#30B0C7","#32ADE6","#5856D6","#AF52DE"];

// ⚠️ আওয়াজ চালু (mute=0) — লাইনে দাঁড়িয়েও যেন স্ট্রিমের কমেন্ট্রি শোনা যায়।
// কিছু ব্রাউজার আওয়াজসহ autoplay আটকায়, তাই দর্শককে একবার চাপ দিতে হতে পারে —
// কিন্তু সে তো "Join" বাটনে চাপ দিয়েই এসেছে, তাই সাধারণত এমনিতেই বাজবে।
var LIVE_SRC = "https://www.youtube.com/embed/live_stream?channel=${GAMING_YT_CHANNEL_ID}&autoplay=1&mute=0&playsinline=1";
function setLiveOn(){
  var f = document.getElementById("liveFrame");
  if (f.getAttribute("src") !== LIVE_SRC) f.src = LIVE_SRC;
}

function loadRecord(){
  fetch("/gaming/snake/highscore").then(function(r){ return r.json(); }).then(function(d){
    document.getElementById("recScore").textContent = d.score;
    document.getElementById("recName").textContent = d.name || "Grandmaster";
  }).catch(function(){});
}
loadRecord();

// বোর্ডটা যতটুকু জায়গা বেঁচে আছে ঠিক ততটুকুতেই বসে — তাই কোনো ফোনেই স্ক্রল লাগে না
function fitBoard(){
  var host = canvas.parentElement;
  var availH = Math.max(80, host.clientHeight - 4);
  var availW = Math.max(80, host.clientWidth);
  cell = Math.max(8, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  canvas.width = cell * COLS; canvas.height = cell * ROWS;
}
function paint(body, foodPos){
  if (!ctx) return; // পুরনো/অস্বাভাবিক ব্রাউজারে canvas না থাকলেও যেন পুরো পেজ ভেঙে না যায়
  fitBoard();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (foodPos){
    ctx.fillStyle = "#E8443D";
    ctx.beginPath(); ctx.arc(foodPos.c*cell+cell/2, foodPos.r*cell+cell/2, cell*0.36, 0, Math.PI*2); ctx.fill();
  }
  if (!body || !body.length) return;
  for (var i = body.length - 1; i >= 1; i--){
    ctx.fillStyle = RAINBOW[(i-1) % RAINBOW.length];
    ctx.beginPath(); ctx.arc(body[i].c*cell+cell/2, body[i].r*cell+cell/2, cell*0.44, 0, Math.PI*2); ctx.fill();
  }
  var h = body[0];
  ctx.fillStyle = "#E8443D";
  ctx.beginPath(); ctx.arc(h.c*cell+cell/2, h.r*cell+cell/2, cell*0.48, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(h.c*cell+cell/2-cell*0.15, h.r*cell+cell/2-cell*0.08, cell*0.12, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(h.c*cell+cell/2+cell*0.15, h.r*cell+cell/2-cell*0.08, cell*0.12, 0, Math.PI*2); ctx.fill();
}
// অপেক্ষার সময় — এখন যে খেলছে তার সাপটাই এই বোর্ডে দেখা যায়
function drawWatched(st){ paint(st.body, st.food); }
function draw(){ paint(snake, food); }

function pushMirror(){
  if (!myQueueId) return;
  fetch("/gaming/gq/snake/mirror", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ id: myQueueId, state: { body: snake, food: food, score: score, dir: dir } })
  }).catch(function(){});
}
function placeFood(){
  var taken = {};
  for (var i = 0; i < snake.length; i++) taken[snake[i].r + ":" + snake[i].c] = 1;
  var free = [];
  for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (!taken[r + ":" + c]) free.push({r:r,c:c});
  food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
}
function tick(){
  if (!alive) return;
  if (nextDir) dir = nextDir;
  var h = { r: snake[0].r + dir.r, c: snake[0].c + dir.c };
  if (h.r < 0 || h.r >= ROWS || h.c < 0 || h.c >= COLS) return gameOver();
  for (var i = 0; i < snake.length - 1; i++) if (snake[i].r === h.r && snake[i].c === h.c) return gameOver();
  snake.unshift(h);
  if (food && h.r === food.r && h.c === food.c){ score += 10; placeFood(); }
  else snake.pop();
  document.getElementById("watchTag").textContent = "Your score: " + score;
  draw(); pushMirror();
}
function setDir(r, c){
  if (!alive) return;
  if (dir && (dir.r === -r && dir.c === -c)) return; // ১৮০° ঘোরা যাবে না
  nextDir = { r: r, c: c };
}
function gameOver(){
  alive = false;
  clearInterval(timer);
  fetch("/gaming/snake/highscore", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: score, name: playerName }) })
    .then(function(r){ return r.json(); }).then(function(d){
      endMyTurn(d.beaten
        ? "🎉 New record! " + score + " — your name is on the live stream now."
        : "Your score: " + score + ". Record is still " + d.score + " by " + d.name + ".");
    })
    .catch(function(){ endMyTurn("Your score: " + score); });
}
function startGame(){
  var mid = Math.floor(ROWS/2);
  snake = [{r:mid,c:5},{r:mid,c:4},{r:mid,c:3}];
  dir = {r:0,c:1}; nextDir = null; score = 0; alive = true;
  placeFood(); draw(); pushMirror();
  clearInterval(timer); timer = setInterval(tick, TICK);
}
document.addEventListener("keydown", function(e){
  if (e.key === "ArrowUp") setDir(-1,0); else if (e.key === "ArrowDown") setDir(1,0);
  else if (e.key === "ArrowLeft") setDir(0,-1); else if (e.key === "ArrowRight") setDir(0,1);
});
// সোয়াইপ ধরা হয় পুরো খেলার এলাকায় — শুধু ক্যানভাসে নয়। আঙুল একটু বাইরে চলে গেলেও
// চাল কাজ করে, তাই দ্রুত খেলার সময় হতাশ হতে হয় না।
var sx = 0, sy = 0, swiping = false;
var swipeZone = document.querySelector(".boardArea");
swipeZone.addEventListener("touchstart", function(e){
  sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
}, {passive:true});
swipeZone.addEventListener("touchend", function(e){
  if (!swiping) return; swiping = false;
  var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return; // সামান্য নড়াচড়া = ভুল করে ছোঁয়া
  if (Math.abs(dx) > Math.abs(dy)) setDir(0, dx > 0 ? 1 : -1); else setDir(dy > 0 ? 1 : -1, 0);
}, {passive:true});
// মাউসেও একই — কম্পিউটার থেকে খেললেও চলবে
swipeZone.addEventListener("mousedown", function(e){ sx = e.clientX; sy = e.clientY; swiping = true; });
swipeZone.addEventListener("mouseup", function(e){
  if (!swiping) return; swiping = false;
  var dx = e.clientX - sx, dy = e.clientY - sy;
  if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
  if (Math.abs(dx) > Math.abs(dy)) setDir(0, dx > 0 ? 1 : -1); else setDir(dy > 0 ? 1 : -1, 0);
});
window.addEventListener("resize", function(){ if (alive) draw(); });
${queueClientJS("snake", "startGame", "drawWatched")}
</script></body></html>`;

const BALLSORT_CHALLENGE_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Play Ball Sort Live</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<style>${CHALLENGE_SHARED_CSS}${PLAY_SHELL_CSS}
#tubes{display:grid;grid-template-columns:repeat(7,1fr);gap:10px 6px;width:100%;touch-action:none;}
.tube{aspect-ratio:1/4.05;background:linear-gradient(180deg,rgba(255,255,255,0.13),rgba(10,14,31,0.55));
border:2px solid rgba(255,255,255,0.30);border-top:none;border-radius:4px 4px 16px 16px;
display:flex;flex-direction:column-reverse;padding:3px;gap:2px;position:relative;
transition:transform 0.15s,box-shadow 0.15s,border-color 0.15s;}
/* আঙুল ঠিক টিউবের গায়ে না পড়লেও যেন ধরা পড়ে — চারপাশে অদৃশ্য বাড়তি জায়গা */
.tube::after{content:"";position:absolute;inset:-6px -3px;}
.tube.sel{border-color:#FFD866;box-shadow:0 0 16px rgba(255,216,102,0.7);transform:translateY(-8px);}
.tube.target{border-color:#8BE28B;box-shadow:0 0 16px rgba(139,226,139,0.7);}
/* বোতল ভরা থাকলে লাল — আঙুল সেখানে নিলেই আগেভাগে বোঝা যায় রাখা যাবে না */
.tube.noDrop{border-color:#FF6B5E;box-shadow:0 0 12px rgba(255,107,94,0.5);}
.tube.done{border-color:rgba(139,226,139,0.75);}
.ball{width:100%;aspect-ratio:1;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.45);}
/* আঙুলের সাথে সাথে যে বলটা ভেসে চলে */
#dragBall{position:fixed;width:34px;height:34px;border-radius:50%;pointer-events:none;z-index:50;
box-shadow:0 6px 16px rgba(0,0,0,0.6);transform:translate(-50%,-50%);display:none;}
</style></head><body>
${challengeBgLayer("ballsort-bg.mp4", "linear-gradient(135deg,#101a3d,#0a0e1f 45%,#241442)")}

<div class="hdr"><h1>🧪 Beat the Grandmaster</h1></div>

<div id="joinCard">
  <div class="card">
    <div class="record">🏆 Fastest time: <b id="recTime">—</b> — <span id="recName">Grandmaster</span></div>
    <label>Your name (shown on the live stream)</label>
    <input type="text" id="nameInput" maxlength="24" placeholder="Type your name">
    <label>Your photo (optional — shown on the live stream)</label>
    <input type="file" id="photoInput" accept="image/*" style="color:#7C8AAD;font-size:13px;">
    <button id="startBtn">Join the queue</button>
    <div class="msg" id="startMsg"></div>
  </div>
</div>

<div id="tipModal" class="hide">
  <div class="box">
    <h3>🙏 Want to help me out?</h3>
    <p>You are in the queue. Playing is <b>free</b>.</p>
    <p>If you'd like, you can send a small tip to support the stream.</p>
    <a class="helpBtn" id="tipGo" href="#">💛 Send a Tip</a>
    <button class="ghost" id="tipSkip">No thanks — take me to the game</button>
    <div class="small">A tip does not change your time, your turn, or your place in the queue.
    After paying you come straight back here.</div>
  </div>
</div>

<div id="stage" class="hide">
  <div class="statusStrip" id="statusStrip">
    <span class="pos" id="qPos">Joining…</span>
    <span class="eta" id="qEta"></span>
  </div>
  <div class="boardArea"><div id="tubes"></div></div>
<div id="dragBall"></div>
  <div class="watchTag" id="watchTag"></div>
  <div class="liveArea">
    <div class="cap"><i></i>LIVE ON YOUTUBE</div>
    <iframe id="liveFrame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
  </div>
  <button class="ghost" id="leaveBtn" style="padding:7px;font-size:12px;flex-shrink:0;">Leave the queue</button>
</div>

<div id="turnBanner" class="hide">
  <div class="big">YOUR TURN!</div>
  <div class="sub">Get ready — everyone is watching you now</div>
</div>

<div id="tutorial" class="hide">
  <h3>How to play</h3>
  <div class="step">
    <b>Drag</b> a ball from one tube to another<br>
    <span style="color:#7C8AAD;font-size:12px;">(or tap one tube, then tap another)</span><br><br>
    A ball only sits on the <b>same colour</b><br>
    …or in an <b>empty tube</b><br><br>
    Make every tube <b>one single colour</b> to win
  </div>
  <div class="count" id="tutCount">5</div>
</div>

<div id="doneCard" class="hide">
  <div class="card" style="text-align:center;">
    <div style="font-size:34px;">🎉</div>
    <div class="msg" id="doneMsg" style="margin-top:6px;"></div>
    <p style="font-size:12px;color:#7C8AAD;line-height:1.6;margin-top:10px;">
      One turn per join.<br>To play again, join the queue again.
    </p>
    <button id="againBtn2">Join again</button>
  </div>
</div>

<script>
var CAP = 4, COLORS = [], tubes = [], sel = -1, startedAt = 0, clockTimer = null, playerName = "", finished = false;
var myTurnLive = false;

// আওয়াজ চালু — লাইনে দাঁড়িয়েও স্ট্রিমের কমেন্ট্রি শোনা যাবে
var LIVE_SRC = "https://www.youtube.com/embed/live_stream?channel=${GAMING_YT_CHANNEL_ID}&autoplay=1&mute=0&playsinline=1";
function setLiveOn(){
  var f = document.getElementById("liveFrame");
  if (f.getAttribute("src") !== LIVE_SRC) f.src = LIVE_SRC;
}

function fmt(sec){ var m = Math.floor(sec/60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
function loadRecord(){
  fetch("/gaming/ballsort/fastest").then(function(r){ return r.json(); }).then(function(d){
    document.getElementById("recTime").textContent = (typeof d.seconds === "number") ? fmt(d.seconds) : "—";
    document.getElementById("recName").textContent = d.name || "Grandmaster";
  }).catch(function(){});
}
loadRecord();

function ballGradient(hex){
  return "radial-gradient(circle at 32% 28%, #ffffff 0%, " + hex + " 42%, " + hex + " 70%, rgba(0,0,0,0.45) 100%)";
}
function isDone(t){ return t.length === CAP && t.every(function(c){ return c === t[0]; }); }
function solved(){ return tubes.every(function(t){ return t.length === 0 || isDone(t); }); }

// একই ফাংশন দুই কাজে — অপেক্ষার সময় অন্যের বোর্ড আঁকে, নিজের পালায় নিজের বোর্ড
function paint(list, colors, selected, clickable){
  var wrap = document.getElementById("tubes");
  wrap.style.gridTemplateColumns = "repeat(" + Math.ceil(list.length/2) + ",1fr)";
  wrap.innerHTML = "";
  list.forEach(function(tube, idx){
    var el = document.createElement("div");
    el.className = "tube" + (idx === selected ? " sel" : "") + (isDone(tube) ? " done" : "");
    tube.forEach(function(ci){
      var b = document.createElement("div");
      b.className = "ball";
      b.style.background = ballGradient(colors[ci]);
      el.appendChild(b);
    });
    el.dataset.idx = idx;
    wrap.appendChild(el);
  });
}

/* =========================================================================
   বল সরানোর নিয়ন্ত্রণ — আঙুল দিয়ে টেনে নেওয়া
   -------------------------------------------------------------------------
   ⚠️ আগে শুধু "ট্যাপ করে বাছো, তারপর ট্যাপ করে ছাড়ো" ছিল। ফোনে টিউবগুলো সরু, তাই
   আঙুল একটু এদিক-ওদিক পড়লেই কিছু হতো না — খেলাই যাচ্ছিল না। এখন সাপের মতোই: বল ধরে
   টেনে যে টিউবে ইচ্ছা ছেড়ে দিন। ট্যাপ-ট্যাপও চলে, তাই যার যেটা সুবিধা।
   ========================================================================= */
var dragFrom = -1, dragging = false, dragMoved = false;
var dragBallEl = document.getElementById("dragBall");

/* =========================================================================
   বল সরানোর নিয়ম (সহজ করা হয়েছে)
   -------------------------------------------------------------------------
   • যেকোনো বোতলের **উপরের** বলটিতে আঙুল দিয়ে টানুন
   • যে বোতলে **জায়গা আছে** সেখানেই ছেড়ে দিন — রঙ মেলানোর কোনো নিয়ম নেই
   • আগে বোতল "সিলেক্ট" করার দরকার নেই, সরাসরি টানলেই হয়

   ⚠️ আগের কোডে একটা বাজে বাগ ছিল: একবার কোনো বোতল সিলেক্ট হয়ে গেলে পরের বার
   আঙুল যে বোতলেই দিন না কেন, বল উঠত ওই *পুরনো সিলেক্ট করা* বোতল থেকে। তাই দুই-তিনটা
   চালের পর আর ঠিকমতো খেলা যেত না। এখন সবসময় আপনি যে বোতল ছুঁয়েছেন সেখান থেকেই ওঠে।
   ========================================================================= */
function tubeIndexAt(x, y){
  var els = document.querySelectorAll("#tubes .tube");
  var best = -1, bestDist = 1e9;
  for (var i = 0; i < els.length; i++){
    var r = els[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    var cx = Math.max(r.left, Math.min(x, r.right));
    var cy = Math.max(r.top, Math.min(y, r.bottom));
    var d = Math.hypot(x - cx, y - cy);
    if (d < bestDist){ bestDist = d; best = i; }
  }
  return bestDist <= 18 ? best : -1; // আঙুল একটু বাইরে পড়লেও ধরা পড়ে
}
// বলটা ওখানে রাখা যাবে কি না — শুধু জায়গা আছে কি না দেখা হয়, রঙ দেখা হয় না
function canDrop(from, to){
  if (from < 0 || to < 0 || from === to) return false;
  if (!tubes[from] || !tubes[from].length) return false;
  return !!tubes[to] && tubes[to].length < CAP;
}
function highlightTarget(idx){
  var els = document.querySelectorAll("#tubes .tube");
  for (var i = 0; i < els.length; i++){
    els[i].classList.remove("target", "noDrop");
    if (i === idx && i !== dragFrom) els[i].classList.add(canDrop(dragFrom, i) ? "target" : "noDrop");
  }
}
function showDragBall(x, y, colorIdx){
  dragBallEl.style.display = "block";
  dragBallEl.style.background = ballGradient(COLORS[colorIdx]);
  dragBallEl.style.left = x + "px";
  dragBallEl.style.top = y + "px";
}
function hideDragBall(){
  dragBallEl.style.display = "none";
  highlightTarget(-1);
}
function pointerDown(x, y){
  if (finished || !myTurnLive) return;
  var idx = tubeIndexAt(x, y);
  // সবসময় ছোঁয়া বোতল থেকেই — আগে কী সিলেক্ট ছিল তাতে কিছু যায় আসে না
  if (idx < 0 || !tubes[idx] || !tubes[idx].length) return;
  sel = idx; dragFrom = idx; dragging = true; dragMoved = false;
  render();
  // বলটা বোতলের উপরের বলের জায়গা থেকেই ওড়া শুরু করে, তাই কোনটা উঠল স্পষ্ট বোঝা যায়
  var tubeEl = document.querySelectorAll("#tubes .tube")[idx];
  var topBall = tubeEl && tubeEl.lastElementChild; // column-reverse — শেষ সন্তানই উপরের বল
  var colorIdx = tubes[idx][tubes[idx].length - 1];
  if (topBall){
    var tb = topBall.getBoundingClientRect();
    showDragBall(tb.left + tb.width / 2, tb.top + tb.height / 2, colorIdx);
  } else {
    showDragBall(x, y, colorIdx);
  }
}
function pointerMove(x, y){
  if (!dragging) return;
  dragMoved = true;
  if (dragFrom >= 0 && tubes[dragFrom] && tubes[dragFrom].length){
    showDragBall(x, y, tubes[dragFrom][tubes[dragFrom].length - 1]);
  }
  highlightTarget(tubeIndexAt(x, y));
}
function pointerUp(x, y){
  if (!dragging) return;
  dragging = false;
  hideDragBall();
  var idx = tubeIndexAt(x, y);
  var from = dragFrom;
  if (idx >= 0 && canDrop(from, idx)) doMove(from, idx);
  else { sel = -1; dragFrom = -1; render(); pushMirror(); } // বলটা নিজের জায়গায় ফিরে যায়
  dragFrom = -1;
}
function doMove(from, to){
  tubes[to].push(tubes[from].pop());
  sel = -1; dragFrom = -1;
  render(); pushMirror();
  if (solved()) finish();
}
(function bindControls(){
  var wrap = document.getElementById("tubes");
  wrap.addEventListener("touchstart", function(e){
    var t = e.touches[0]; pointerDown(t.clientX, t.clientY);
  }, { passive: true });
  wrap.addEventListener("touchmove", function(e){
    if (!dragging) return;
    e.preventDefault(); // পেজ স্ক্রল আটকানো, নাহলে বল টানা যেত না
    var t = e.touches[0]; pointerMove(t.clientX, t.clientY);
  }, { passive: false });
  wrap.addEventListener("touchend", function(e){
    var t = e.changedTouches[0]; pointerUp(t.clientX, t.clientY);
  }, { passive: true });
  wrap.addEventListener("mousedown", function(e){ pointerDown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function(e){ pointerMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", function(e){ if (dragging) pointerUp(e.clientX, e.clientY); });
})();

function drawWatched(st){
  if (myTurnLive) return;
  CAP = st.capacity || 4;
  paint(st.tubes || [], st.colors || [], typeof st.sel === "number" ? st.sel : -1, false);
}
function render(){ paint(tubes, COLORS, sel, true); }

function pushMirror(){
  if (!myQueueId) return;
  fetch("/gaming/gq/ballsort/mirror", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ id: myQueueId, state: { tubes: tubes, colors: COLORS, capacity: CAP, sel: sel } })
  }).catch(function(){});
}
function finish(){
  finished = true;
  clearInterval(clockTimer);
  var secs = Math.round((Date.now() - startedAt) / 1000);
  fetch("/gaming/ballsort/fastest", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seconds: secs, name: playerName }) })
    .then(function(r){ return r.json(); }).then(function(d){
      endMyTurn(d.beaten
        ? "🎉 New record! " + fmt(secs) + " — your name is on the live stream now."
        : "Your time: " + fmt(secs) + ". Record is still " + fmt(d.seconds) + " by " + d.name + ".");
    })
    .catch(function(){ endMyTurn("Solved in " + fmt(secs)); });
}
function startGame(){
  myTurnLive = true; finished = false; sel = -1;
  fetch("/gaming/ballsort/new-challenge").then(function(r){ return r.json(); }).then(function(d){
    tubes = d.tubes; COLORS = d.colors; CAP = d.capacity;
    render(); pushMirror();
    startedAt = Date.now();
    clearInterval(clockTimer);
    clockTimer = setInterval(function(){
      document.getElementById("watchTag").textContent = "Your time: " + fmt(Math.round((Date.now() - startedAt)/1000));
    }, 1000);
  }).catch(function(){
    document.getElementById("watchTag").textContent = "Could not load a puzzle — please try again.";
  });
}
${queueClientJS("ballsort", "startGame", "drawWatched")}
</script></body></html>`;


// ===========================================================================
// ৯. Code Live — "একটা অ্যাপ তৈরি হওয়া" লাইভ চ্যানেল
// ---------------------------------------------------------------------------
// পর্দায় একটা ল্যাপটপ। ভেতরে বাঁ পাশে কোড এডিটর — অক্ষর ধরে ধরে কোড টাইপ হতে থাকে, লাইন
// ভরে গেলে উপরে উঠে যায়। ডান পাশে একটা ফোন, আর সেই কোড অনুযায়ী ধাপে ধাপে অ্যাপের স্ক্রিন
// তৈরি হয় — লগইন, হোম, সার্চ, প্রোফাইল ইত্যাদি। একটা অ্যাপ শেষ হলে পরেরটা শুরু হয়, ২৪/৭।
//
// ⚠️ অ্যাপগুলো ইচ্ছে করেই কোনো আসল ব্র্যান্ডের নকল নয় — ধরন (মেসেজিং, খাবার ডেলিভারি,
// রাইড, ব্যাংকিং...) এক, কিন্তু নাম/লোগো/রঙ সব নিজস্ব। আসল অ্যাপের ইন্টারফেস হুবহু নকল
// করলে ট্রেডমার্ক/কপিরাইট সমস্যা হতে পারত, আর YouTube-এ স্ট্রাইকও আসতে পারত।
// ===========================================================================
const CODELIVE_APPS = [
  {
    name: "ChatWave", tag: "Messaging App", accent: "#4F8CFF", lang: "React Native",
    screens: [
      { file: "LoginScreen.jsx", label: "লগইন স্ক্রিন", ui: [
          {t:"status"},{t:"hero",title:"ChatWave",sub:"Talk to anyone, anywhere"},
          {t:"input",ph:"Phone number"},{t:"input",ph:"Password"},
          {t:"btn",label:"Log in"},{t:"note",text:"New here? Create an account"}],
        code: [
          "import React, { useState } from 'react';",
          "import { View, Text, TextInput, Pressable } from 'react-native';",
          "",
          "export default function LoginScreen({ navigation }) {",
          "  const [phone, setPhone] = useState('');",
          "  const [pass, setPass] = useState('');",
          "  const [busy, setBusy] = useState(false);",
          "",
          "  async function handleLogin() {",
          "    setBusy(true);",
          "    const res = await api.post('/auth/login', { phone, pass });",
          "    if (res.ok) navigation.replace('Home');",
          "    setBusy(false);",
          "  }",
          "",
          "  return (",
          "    <View style={styles.wrap}>",
          "      <Text style={styles.brand}>ChatWave</Text>",
          "      <TextInput placeholder='Phone number' onChangeText={setPhone} />",
          "      <TextInput placeholder='Password' secureTextEntry onChangeText={setPass} />",
          "      <Pressable style={styles.cta} onPress={handleLogin}>",
          "        <Text>{busy ? 'Please wait...' : 'Log in'}</Text>",
          "      </Pressable>",
          "    </View>",
          "  );",
          "}"] },
      { file: "ChatList.jsx", label: "চ্যাট তালিকা", ui: [
          {t:"status"},{t:"appbar",title:"Chats"},{t:"search",ph:"Search messages"},
          {t:"row",icon:"A",title:"Ayesha",sub:"See you at 8 tonight!",meta:"2m"},
          {t:"row",icon:"R",title:"Rahul",sub:"Sent the files ✓",meta:"14m"},
          {t:"row",icon:"T",title:"Team Standup",sub:"Mira: pushed the fix",meta:"1h"},
          {t:"row",icon:"N",title:"Nadia",sub:"Typing...",meta:"3h"},
          {t:"tabbar",items:["Chats","Calls","You"]}],
        code: [
          "function ChatList() {",
          "  const { data: threads, loading } = useThreads();",
          "",
          "  const renderItem = ({ item }) => (",
          "    <Pressable onPress={() => open(item.id)}>",
          "      <Avatar uri={item.photo} online={item.online} />",
          "      <View>",
          "        <Text style={styles.name}>{item.name}</Text>",
          "        <Text numberOfLines={1}>{item.lastMessage}</Text>",
          "      </View>",
          "      <Text style={styles.time}>{ago(item.updatedAt)}</Text>",
          "    </Pressable>",
          "  );",
          "",
          "  if (loading) return <Skeleton rows={6} />;",
          "  return <FlatList data={threads} renderItem={renderItem} />;",
          "}"] },
      { file: "ChatRoom.jsx", label: "মেসেজ স্ক্রিন", ui: [
          {t:"status"},{t:"appbar",title:"Ayesha",sub:"online"},
          {t:"bubble",side:"in",text:"Are we still on for tonight?"},
          {t:"bubble",side:"out",text:"Yes! 8pm at the usual place"},
          {t:"bubble",side:"in",text:"Perfect 🎉"},
          {t:"bubble",side:"out",text:"Booking a table now"},
          {t:"composer",ph:"Message"}],
        code: [
          "function ChatRoom({ threadId }) {",
          "  const socket = useSocket();",
          "  const [messages, setMessages] = useState([]);",
          "",
          "  useEffect(() => {",
          "    socket.on('message:new', (msg) => {",
          "      setMessages((prev) => [...prev, msg]);",
          "    });",
          "    return () => socket.off('message:new');",
          "  }, [threadId]);",
          "",
          "  function send(text) {",
          "    const optimistic = { id: uid(), text, mine: true, pending: true };",
          "    setMessages((prev) => [...prev, optimistic]);",
          "    socket.emit('message:send', { threadId, text });",
          "  }",
          "",
          "  return <Bubbles data={messages} onSend={send} />;",
          "}"] },
    ],
  },
  {
    name: "QuickBite", tag: "Food Delivery", accent: "#FF7A45", lang: "Flutter",
    screens: [
      { file: "home_page.dart", label: "রেস্টুরেন্ট হোম", ui: [
          {t:"status"},{t:"appbar",title:"Deliver to Home",sub:"12 min away"},
          {t:"search",ph:"Search for biryani, pizza..."},
          {t:"chips",items:["Nearby","Fast","Offers","Veg"]},
          {t:"card",title:"Spice Route",sub:"Biryani · 4.6 ★ · 25 min"},
          {t:"card",title:"Green Bowl",sub:"Healthy · 4.4 ★ · 18 min"},
          {t:"tabbar",items:["Home","Cart","Orders"]}],
        code: [
          "class HomePage extends StatefulWidget {",
          "  @override",
          "  State<HomePage> createState() => _HomePageState();",
          "}",
          "",
          "class _HomePageState extends State<HomePage> {",
          "  late Future<List<Restaurant>> _nearby;",
          "",
          "  @override",
          "  void initState() {",
          "    super.initState();",
          "    _nearby = RestaurantApi.nearby(radiusKm: 5);",
          "  }",
          "",
          "  @override",
          "  Widget build(BuildContext context) {",
          "    return Scaffold(",
          "      body: FutureBuilder(",
          "        future: _nearby,",
          "        builder: (ctx, snap) => RestaurantList(snap.data),",
          "      ),",
          "    );",
          "  }",
          "}"] },
      { file: "cart_page.dart", label: "কার্ট", ui: [
          {t:"status"},{t:"appbar",title:"Your Cart"},
          {t:"row",icon:"🍛",title:"Chicken Biryani",sub:"Large · x1",meta:"₹320"},
          {t:"row",icon:"🥗",title:"Garden Salad",sub:"Regular · x2",meta:"₹180"},
          {t:"line",label:"Delivery",value:"₹40"},
          {t:"line",label:"Total",value:"₹540",strong:true},
          {t:"btn",label:"Place order"}],
        code: [
          "class CartModel extends ChangeNotifier {",
          "  final List<CartItem> _items = [];",
          "",
          "  int get subtotal =>",
          "      _items.fold(0, (sum, i) => sum + i.price * i.qty);",
          "",
          "  int get total => subtotal + deliveryFee - discount;",
          "",
          "  void add(MenuItem item) {",
          "    final found = _items.indexWhere((i) => i.id == item.id);",
          "    if (found >= 0) {",
          "      _items[found].qty++;",
          "    } else {",
          "      _items.add(CartItem.from(item));",
          "    }",
          "    notifyListeners();",
          "  }",
          "}"] },
      { file: "tracking_page.dart", label: "অর্ডার ট্র্যাকিং", ui: [
          {t:"status"},{t:"appbar",title:"Order #4821"},
          {t:"map"},
          {t:"steps",items:["Order placed","Being prepared","Out for delivery","Delivered"],active:2},
          {t:"row",icon:"🛵",title:"Imran is on the way",sub:"Arriving in 8 minutes"}],
        code: [
          "class TrackingPage extends StatelessWidget {",
          "  final String orderId;",
          "",
          "  Stream<OrderStatus> get _stream =>",
          "      FirebaseFirestore.instance",
          "          .collection('orders')",
          "          .doc(orderId)",
          "          .snapshots()",
          "          .map(OrderStatus.fromDoc);",
          "",
          "  @override",
          "  Widget build(BuildContext context) {",
          "    return StreamBuilder<OrderStatus>(",
          "      stream: _stream,",
          "      builder: (ctx, snap) {",
          "        if (!snap.hasData) return const LoadingMap();",
          "        return DeliveryMap(status: snap.data!);",
          "      },",
          "    );",
          "  }",
          "}"] },
    ],
  },
  {
    name: "RideNow", tag: "Ride Hailing", accent: "#22C39A", lang: "Kotlin",
    screens: [
      { file: "MapActivity.kt", label: "রাইড বুকিং", ui: [
          {t:"status"},{t:"map"},
          {t:"input",ph:"Where to?"},
          {t:"row",icon:"🏠",title:"Home",sub:"Ring Road, Block C"},
          {t:"row",icon:"💼",title:"Office",sub:"Tech Park, Gate 2"},
          {t:"btn",label:"Confirm pickup"}],
        code: [
          "class MapActivity : AppCompatActivity(), OnMapReadyCallback {",
          "",
          "    private lateinit var map: GoogleMap",
          "    private val viewModel: RideViewModel by viewModels()",
          "",
          "    override fun onMapReady(googleMap: GoogleMap) {",
          "        map = googleMap",
          "        map.isMyLocationEnabled = true",
          "        viewModel.nearbyDrivers.observe(this) { drivers ->",
          "            drivers.forEach { addCarMarker(it) }",
          "        }",
          "    }",
          "",
          "    private fun addCarMarker(driver: Driver) {",
          "        map.addMarker(",
          "            MarkerOptions()",
          "                .position(driver.latLng)",
          "                .icon(carIcon)",
          "        )",
          "    }",
          "}"] },
      { file: "FareEstimator.kt", label: "ভাড়া ও গাড়ি", ui: [
          {t:"status"},{t:"map"},
          {t:"pick",icon:"🚗",title:"Standard",sub:"4 seats · 6 min",meta:"₹180",on:true},
          {t:"pick",icon:"🚙",title:"Comfort",sub:"4 seats · 9 min",meta:"₹265"},
          {t:"pick",icon:"🛺",title:"Mini",sub:"3 seats · 4 min",meta:"₹95"},
          {t:"btn",label:"Book Standard"}],
        code: [
          "object FareEstimator {",
          "",
          "    private const val BASE = 35.0",
          "    private const val PER_KM = 12.5",
          "    private const val PER_MIN = 1.8",
          "",
          "    fun estimate(route: Route, tier: Tier): Fare {",
          "        val distance = route.distanceKm * PER_KM",
          "        val time = route.durationMin * PER_MIN",
          "        val raw = (BASE + distance + time) * tier.multiplier",
          "        val surge = SurgeEngine.factorFor(route.origin)",
          "        return Fare(",
          "            amount = (raw * surge).roundToInt(),",
          "            surged = surge > 1.0",
          "        )",
          "    }",
          "}"] },
    ],
  },
  {
    name: "PulseFit", tag: "Fitness Tracker", accent: "#FF4D6D", lang: "SwiftUI",
    screens: [
      { file: "DashboardView.swift", label: "ড্যাশবোর্ড", ui: [
          {t:"status"},{t:"appbar",title:"Today"},
          {t:"rings"},
          {t:"grid",items:[["8,420","Steps"],["512","Calories"],["6.1 km","Distance"],["72","Avg BPM"]]},
          {t:"tabbar",items:["Today","Workouts","You"]}],
        code: [
          "import SwiftUI",
          "import HealthKit",
          "",
          "struct DashboardView: View {",
          "    @StateObject private var health = HealthStore()",
          "",
          "    var body: some View {",
          "        ScrollView {",
          "            ActivityRings(",
          "                move: health.moveProgress,",
          "                exercise: health.exerciseProgress,",
          "                stand: health.standProgress",
          "            )",
          "            StatGrid(metrics: health.todayMetrics)",
          "        }",
          "        .task { await health.requestAuthorization() }",
          "    }",
          "}"] },
      { file: "WorkoutSession.swift", label: "ওয়ার্কআউট", ui: [
          {t:"status"},{t:"appbar",title:"Outdoor Run"},
          {t:"big",value:"28:14",label:"Elapsed"},
          {t:"grid",items:[["5.42 km","Distance"],["5'12\"","Pace"],["148","Heart rate"]]},
          {t:"chart"},
          {t:"btn",label:"End workout"}],
        code: [
          "final class WorkoutSession: ObservableObject {",
          "",
          "    @Published var elapsed: TimeInterval = 0",
          "    @Published var distance: Double = 0",
          "    private var timer: AnyCancellable?",
          "",
          "    func start() {",
          "        timer = Timer.publish(every: 1, on: .main, in: .common)",
          "            .autoconnect()",
          "            .sink { [weak self] _ in",
          "                self?.elapsed += 1",
          "                self?.sampleLocation()",
          "            }",
          "    }",
          "",
          "    func end() -> WorkoutSummary {",
          "        timer?.cancel()",
          "        return WorkoutSummary(time: elapsed, distance: distance)",
          "    }",
          "}"] },
    ],
  },
  {
    name: "Vaultly", tag: "Banking & Wallet", accent: "#7C6BFF", lang: "React Native",
    screens: [
      { file: "WalletHome.jsx", label: "ওয়ালেট হোম", ui: [
          {t:"status"},{t:"appbar",title:"Vaultly"},
          {t:"balance",value:"₹ 48,250.00",label:"Available balance"},
          {t:"chips",items:["Send","Request","Top up","Bills"]},
          {t:"row",icon:"↗",title:"Rent transfer",sub:"Today · 09:12",meta:"−₹12,000"},
          {t:"row",icon:"↙",title:"Salary credited",sub:"Yesterday",meta:"+₹64,000"},
          {t:"tabbar",items:["Home","Cards","History"]}],
        code: [
          "export function WalletHome() {",
          "  const { balance, txns, refresh } = useWallet();",
          "  const [hidden, setHidden] = useState(false);",
          "",
          "  useFocusEffect(",
          "    useCallback(() => {",
          "      refresh();",
          "    }, [])",
          "  );",
          "",
          "  return (",
          "    <SafeAreaView>",
          "      <BalanceCard",
          "        amount={hidden ? '••••••' : format(balance)}",
          "        onToggle={() => setHidden(!hidden)}",
          "      />",
          "      <QuickActions actions={ACTIONS} />",
          "      <TransactionList data={txns} />",
          "    </SafeAreaView>",
          "  );",
          "}"] },
      { file: "SendMoney.jsx", label: "টাকা পাঠানো", ui: [
          {t:"status"},{t:"appbar",title:"Send money"},
          {t:"row",icon:"S",title:"Sadia Rahman",sub:"•••• 4821"},
          {t:"big",value:"₹ 2,500",label:"Amount"},
          {t:"input",ph:"Add a note"},
          {t:"keypad"},
          {t:"btn",label:"Slide to pay"}],
        code: [
          "async function sendMoney({ to, amount, note }) {",
          "  if (amount <= 0) throw new Error('INVALID_AMOUNT');",
          "  if (amount > dailyLimitLeft()) throw new Error('LIMIT_EXCEEDED');",
          "",
          "  const idempotencyKey = uuid();",
          "  const signed = await signPayload({ to, amount, idempotencyKey });",
          "",
          "  const res = await api.post('/transfers', signed, {",
          "    headers: { 'Idempotency-Key': idempotencyKey },",
          "  });",
          "",
          "  if (res.status === 'PENDING') {",
          "    return pollUntilSettled(res.transferId);",
          "  }",
          "  return res;",
          "}"] },
    ],
  },
  {
    name: "Soundrift", tag: "Music Player", accent: "#1DD3A0", lang: "React Native",
    screens: [
      { file: "Library.jsx", label: "লাইব্রেরি", ui: [
          {t:"status"},{t:"appbar",title:"Your Library"},
          {t:"chips",items:["Playlists","Artists","Albums"]},
          {t:"row",icon:"🎧",title:"Late Night Drive",sub:"32 songs"},
          {t:"row",icon:"🌧",title:"Rainy Day Acoustic",sub:"18 songs"},
          {t:"row",icon:"🔥",title:"Workout Boost",sub:"45 songs"},
          {t:"miniplayer",title:"Midnight Echo",sub:"Aria Lane"}],
        code: [
          "export default function Library() {",
          "  const playlists = useSelector(selectPlaylists);",
          "  const dispatch = useDispatch();",
          "",
          "  useEffect(() => {",
          "    dispatch(fetchPlaylists());",
          "  }, [dispatch]);",
          "",
          "  return (",
          "    <FlatList",
          "      data={playlists}",
          "      keyExtractor={(p) => p.id}",
          "      renderItem={({ item }) => (",
          "        <PlaylistRow",
          "          playlist={item}",
          "          onPress={() => dispatch(playPlaylist(item.id))}",
          "        />",
          "      )}",
          "    />",
          "  );",
          "}"] },
      { file: "PlayerScreen.jsx", label: "প্লেয়ার", ui: [
          {t:"status"},{t:"art"},
          {t:"hero",title:"Midnight Echo",sub:"Aria Lane · Neon Hours"},
          {t:"seek"},
          {t:"controls"},
          {t:"chips",items:["Lyrics","Queue","Devices"]}],
        code: [
          "function PlayerScreen() {",
          "  const { track, position, duration, playing } = usePlayer();",
          "",
          "  const progress = duration ? position / duration : 0;",
          "",
          "  async function toggle() {",
          "    if (playing) await TrackPlayer.pause();",
          "    else await TrackPlayer.play();",
          "  }",
          "",
          "  return (",
          "    <View style={styles.player}>",
          "      <Artwork uri={track.artwork} spinning={playing} />",
          "      <Text style={styles.title}>{track.title}</Text>",
          "      <Seekbar value={progress} onSeek={TrackPlayer.seekTo} />",
          "      <Controls playing={playing} onToggle={toggle} />",
          "    </View>",
          "  );",
          "}"] },
    ],
  },
  {
    name: "Shopr", tag: "E-Commerce", accent: "#FFB020", lang: "React Native",
    screens: [
      { file: "ProductList.jsx", label: "প্রোডাক্ট তালিকা", ui: [
          {t:"status"},{t:"appbar",title:"Shopr"},{t:"search",ph:"Search products"},
          {t:"chips",items:["All","Shoes","Bags","Watches"]},
          {t:"tiles",items:[["Runner X","₹2,499"],["Canvas Tote","₹1,199"],["Steel Watch","₹4,850"],["Daypack","₹1,750"]]},
          {t:"tabbar",items:["Shop","Cart","Account"]}],
        code: [
          "function ProductList() {",
          "  const [query, setQuery] = useState('');",
          "  const [category, setCategory] = useState('all');",
          "",
          "  const { items, fetchNextPage, hasNextPage } = useInfiniteQuery({",
          "    queryKey: ['products', query, category],",
          "    queryFn: ({ pageParam = 1 }) =>",
          "      api.products({ q: query, category, page: pageParam }),",
          "  });",
          "",
          "  return (",
          "    <FlatList",
          "      numColumns={2}",
          "      data={items}",
          "      onEndReached={() => hasNextPage && fetchNextPage()}",
          "      renderItem={({ item }) => <ProductCard product={item} />}",
          "    />",
          "  );",
          "}"] },
      { file: "Checkout.jsx", label: "চেকআউট", ui: [
          {t:"status"},{t:"appbar",title:"Checkout"},
          {t:"row",icon:"📍",title:"Delivery address",sub:"House 14, Lake Road"},
          {t:"row",icon:"💳",title:"Payment",sub:"Card ending 4821"},
          {t:"line",label:"Items (3)",value:"₹6,448"},
          {t:"line",label:"Shipping",value:"Free"},
          {t:"line",label:"Total",value:"₹6,448",strong:true},
          {t:"btn",label:"Pay now"}],
        code: [
          "async function createOrder(cart, address, paymentMethod) {",
          "  const order = await api.post('/orders', {",
          "    lines: cart.map((c) => ({ sku: c.sku, qty: c.qty })),",
          "    addressId: address.id,",
          "  });",
          "",
          "  const intent = await payments.createIntent({",
          "    orderId: order.id,",
          "    amount: order.total,",
          "    method: paymentMethod,",
          "  });",
          "",
          "  const result = await payments.confirm(intent);",
          "  if (result.status !== 'succeeded') {",
          "    await api.post('/orders/' + order.id + '/cancel');",
          "    throw new PaymentError(result.reason);",
          "  }",
          "  return order;",
          "}"] },
    ],
  },
  {
    name: "SkyCast", tag: "Weather App", accent: "#38BDF8", lang: "SwiftUI",
    screens: [
      { file: "WeatherView.swift", label: "আবহাওয়া", ui: [
          {t:"status"},
          {t:"big",value:"29°",label:"Partly cloudy · Feels like 32°"},
          {t:"chips",items:["Now","Hourly","7 days"]},
          {t:"chart"},
          {t:"grid",items:[["68%","Humidity"],["12 km/h","Wind"],["6","UV index"],["18:41","Sunset"]]}],
        code: [
          "struct WeatherView: View {",
          "    @StateObject private var vm = WeatherViewModel()",
          "",
          "    var body: some View {",
          "        VStack(spacing: 20) {",
          "            Text(vm.temperatureText)",
          "                .font(.system(size: 72, weight: .thin))",
          "            Text(vm.conditionText)",
          "            HourlyStrip(hours: vm.hourly)",
          "            DetailGrid(details: vm.details)",
          "        }",
          "        .refreshable { await vm.reload() }",
          "        .task { await vm.load(for: .currentLocation) }",
          "    }",
          "}"] },
    ],
  },
  {
    name: "Loop", tag: "Social Feed", accent: "#E879F9", lang: "React Native",
    screens: [
      { file: "Feed.jsx", label: "ফিড", ui: [
          {t:"status"},{t:"appbar",title:"Loop"},
          {t:"stories",items:["You","Mira","Zain","Ayan","Nila"]},
          {t:"post",title:"Mira Sen",sub:"2 hours ago"},
          {t:"post",title:"Zain Ahmed",sub:"5 hours ago"},
          {t:"tabbar",items:["Feed","Search","Profile"]}],
        code: [
          "function Feed() {",
          "  const { posts, refreshing, onRefresh } = useFeed();",
          "  const viewability = useRef({ itemVisiblePercentThreshold: 60 });",
          "",
          "  const onViewable = useCallback(({ viewableItems }) => {",
          "    viewableItems.forEach((v) => analytics.impression(v.item.id));",
          "  }, []);",
          "",
          "  return (",
          "    <FlatList",
          "      data={posts}",
          "      refreshing={refreshing}",
          "      onRefresh={onRefresh}",
          "      viewabilityConfig={viewability.current}",
          "      onViewableItemsChanged={onViewable}",
          "      renderItem={({ item }) => <PostCard post={item} />}",
          "    />",
          "  );",
          "}"] },
    ],
  },
  {
    name: "Taskly", tag: "Notes & Tasks", accent: "#34D399", lang: "React Native",
    screens: [
      { file: "TaskBoard.jsx", label: "টাস্ক বোর্ড", ui: [
          {t:"status"},{t:"appbar",title:"Today",sub:"4 of 7 done"},
          {t:"progress",value:0.57},
          {t:"check",title:"Review pull request",done:true},
          {t:"check",title:"Write release notes",done:true},
          {t:"check",title:"Call the design team",done:false},
          {t:"check",title:"Ship v2.4 to beta",done:false},
          {t:"btn",label:"Add task"}],
        code: [
          "export function TaskBoard() {",
          "  const [tasks, setTasks] = useState([]);",
          "",
          "  const done = tasks.filter((t) => t.done).length;",
          "  const progress = tasks.length ? done / tasks.length : 0;",
          "",
          "  function toggle(id) {",
          "    setTasks((prev) =>",
          "      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))",
          "    );",
          "    db.tasks.update(id, { done: !find(id).done });",
          "  }",
          "",
          "  return (",
          "    <View>",
          "      <ProgressBar value={progress} />",
          "      {tasks.map((t) => (",
          "        <TaskRow key={t.id} task={t} onToggle={toggle} />",
          "      ))}",
          "    </View>",
          "  );",
          "}"] },
    ],
  },
];

const CODELIVE_OVERLAY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Code Live — Building Apps</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;}
html{background:#05070f;}
body{margin:0;color:#E6ECFF;font-family:'Segoe UI',system-ui,sans-serif;overflow-y:auto;
min-height:100vh;padding:0;position:relative;}
#bgFallback{position:fixed;inset:0;z-index:-3;background:linear-gradient(135deg,#0b1030,#05070f 45%,#141033);}
#bgVideo{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;opacity:0;transition:opacity 1s ease;}
/* ⚠️ আগে এই কালো পর্দাটা ৪৬% ছিল, ভিডিওর উপর অত ঘন ছায়া পড়লে দৃষ্টিনন্দন
   ভিডিওটাই ম্লান হয়ে যেত। এখন ২৪% — ভিডিও স্পষ্ট, অথচ ল্যাপটপের লেখাও পড়া যায়। */
#bgDim{position:fixed;inset:0;z-index:-1;background:rgba(4,6,16,0.24);pointer-events:none;}

/* ---- ল্যাপটপ ---- */
/* ল্যাপটপের চারপাশে ইচ্ছে করেই ফাঁকা জায়গা রাখা — ওই ফাঁকা অংশ দিয়েই পেছনের
   ভিডিওটা দেখা যায়। প্যাডিং বাড়ানোয় দুপাশে ও উপর-নিচে ভিডিও আরও বেশি দেখা যাবে। */
.stage{height:100vh;display:flex;align-items:center;justify-content:center;padding:34px 48px;}
.laptop{width:100%;max-width:1460px;}
.lid{background:linear-gradient(180deg,#2a2f42,#171a28);border-radius:16px 16px 4px 4px;
padding:14px 14px 10px;box-shadow:0 30px 70px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.10);}
.cam{width:6px;height:6px;border-radius:50%;background:#3D4562;margin:0 auto 9px;}
.screen{background:#0c1020;border-radius:8px;overflow:hidden;border:1px solid #1e2540;
display:flex;flex-direction:column;height:72vh;min-height:400px;}
.base{height:14px;background:linear-gradient(180deg,#20243a,#0e1120);border-radius:0 0 18px 18px;
margin:0 auto;width:104%;max-width:none;position:relative;left:-2%;
box-shadow:0 16px 30px rgba(0,0,0,0.6);}
.base::after{content:"";position:absolute;left:50%;transform:translateX(-50%);top:0;
width:120px;height:5px;border-radius:0 0 6px 6px;background:#0a0d18;}

/* ---- এডিটরের টাইটেল বার ---- */
.titlebar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#121729;
border-bottom:1px solid #1e2540;flex-shrink:0;}
.dots{display:flex;gap:6px;}
.dot{width:11px;height:11px;border-radius:50%;}
.tab{font-size:12px;color:#8FA3CC;background:#0c1020;border:1px solid #1e2540;border-radius:6px;
padding:4px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;}
.tab b{color:#E6ECFF;font-weight:600;}
.brandChip{margin-left:auto;font-size:11px;font-weight:800;letter-spacing:0.4px;
padding:4px 11px;border-radius:20px;}
.langChip{font-size:10px;color:#8FA3CC;border:1px solid #1e2540;border-radius:20px;padding:4px 10px;}

/* ---- কাজের জায়গা ---- */
.work{flex:1;display:grid;grid-template-columns:1fr 400px;min-height:0;}
.editor{display:flex;min-height:0;overflow:hidden;position:relative;background:#0c1020;}
.gutter{padding:14px 10px 14px 16px;text-align:right;color:#33406b;font-size:13px;line-height:1.62;
font-family:ui-monospace,Menlo,Consolas,monospace;user-select:none;flex-shrink:0;}
.code{padding:14px 16px 14px 6px;font-size:13.5px;line-height:1.62;white-space:pre;flex:1;
font-family:ui-monospace,Menlo,Consolas,monospace;overflow:hidden;}
.k{color:#C792EA;} .s{color:#C3E88D;} .c{color:#4A5578;font-style:italic;}
.n{color:#F78C6C;} .f{color:#82AAFF;} .p{color:#89DDFF;}
.cursor{display:inline-block;width:8px;height:15px;background:#FFD866;vertical-align:-2px;
animation:blink 1.05s step-end infinite;}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:0;}}

/* ---- ফোন ---- */
.side{border-left:1px solid #1e2540;background:#0a0d1a;display:flex;flex-direction:column;
align-items:center;justify-content:center;gap:12px;padding:14px;min-height:0;}
.phone{width:250px;height:100%;max-height:520px;background:#000;border-radius:32px;padding:9px;
border:2px solid #262d47;box-shadow:0 22px 46px rgba(0,0,0,0.7);flex-shrink:1;}
.pscreen{width:100%;height:100%;color:#141C2E;background:#F5F7FC;border-radius:24px;overflow:hidden;
display:flex;flex-direction:column;position:relative;}
.pscreen.swap{animation:swapIn 0.55s ease-out;}
@keyframes swapIn{from{opacity:0;transform:scale(0.97) translateY(8px);}to{opacity:1;transform:none;}}
.caption{font-size:11px;color:#8FA3CC;text-align:center;line-height:1.5;flex-shrink:0;}
.caption b{color:#FFD866;}

/* ফোনের ভেতরের উপাদান */
.w{padding:0 12px;}
.pstatus{display:flex;justify-content:space-between;padding:7px 14px 3px;font-size:9px;color:#6B7891;flex-shrink:0;}
.pbar{padding:10px 14px 8px;flex-shrink:0;}
.pbar .t{font-size:15px;font-weight:800;}
.pbar .st{font-size:9.5px;color:#6B7891;margin-top:2px;}
.psearch{margin:6px 12px;background:#E7EBF3;border-radius:9px;padding:8px 11px;font-size:10.5px;color:#7A879E;}
.phero{padding:22px 16px 12px;text-align:center;}
.phero .t{font-size:19px;font-weight:800;}
.phero .st{font-size:10px;color:#6B7891;margin-top:4px;}
.pinput{margin:6px 12px;background:#EDF0F7;border:1px solid #DCE2ED;border-radius:9px;
padding:9px 11px;font-size:10.5px;color:#8290A6;}
.pbtn{margin:9px 12px 4px;border-radius:9px;padding:10px;text-align:center;font-size:11.5px;
font-weight:800;color:#08101f;}
.pnote{text-align:center;font-size:9.5px;color:#7A879E;margin-top:8px;}
.prow{display:flex;align-items:center;gap:9px;padding:8px 13px;}
.pic{width:29px;height:29px;border-radius:50%;display:flex;align-items:center;justify-content:center;
font-size:12px;font-weight:800;color:#08101f;flex-shrink:0;}
.prow .tx{flex:1;min-width:0;}
.prow .t{font-size:11.5px;font-weight:700;}
.prow .st{font-size:9.5px;color:#6B7891;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.prow .mt{font-size:9.5px;color:#6B7891;flex-shrink:0;font-weight:700;}
.pchips{display:flex;gap:6px;padding:7px 12px;flex-wrap:wrap;}
.pchip{font-size:9.5px;padding:4px 10px;border-radius:20px;background:#E7EBF3;color:#5D6B84;}
.pchip.on{color:#08101f;font-weight:800;}
.pcard{margin:6px 12px;background:#FFFFFF;border-radius:11px;overflow:hidden;box-shadow:0 1px 4px rgba(20,30,60,0.10);}
.pcard .im{height:52px;}
.pcard .bd{padding:8px 10px;}
.pcard .t{font-size:11.5px;font-weight:700;}
.pcard .st{font-size:9.5px;color:#6B7891;margin-top:2px;}
.ptab{margin-top:auto;display:flex;border-top:1px solid #DCE2ED;background:#FFFFFF;flex-shrink:0;}
.ptab div{flex:1;text-align:center;padding:9px 0;font-size:9.5px;color:#8290A6;font-weight:700;}
.pbub{max-width:75%;padding:8px 11px;border-radius:14px;font-size:10.5px;margin:5px 13px;line-height:1.45;}
.pbub.in{background:#E7EBF3;color:#1B2333;border-bottom-left-radius:4px;}
.pbub.out{margin-left:auto;color:#08101f;border-bottom-right-radius:4px;}
.pcomp{margin-top:auto;display:flex;gap:7px;padding:9px 12px;border-top:1px solid #DCE2ED;background:#FFFFFF;flex-shrink:0;}
.pcomp .f{flex:1;background:#EDF0F7;border-radius:18px;padding:8px 12px;font-size:10px;color:#7A879E;}
.pcomp .s{width:30px;height:30px;border-radius:50%;flex-shrink:0;}
.pgrid{display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:8px 12px;}
.pcell{background:#FFFFFF;border-radius:10px;padding:9px;box-shadow:0 1px 3px rgba(20,30,60,0.09);}
.pcell .v{font-size:14px;font-weight:800;}
.pcell .l{font-size:8.5px;color:#6B7891;margin-top:2px;}
.pbig{text-align:center;padding:18px 12px 10px;}
.pbig .v{font-size:33px;font-weight:200;letter-spacing:-1px;}
.pbig .l{font-size:9.5px;color:#6B7891;margin-top:3px;}
.pbal{margin:10px 12px;border-radius:13px;padding:15px;}
.pbal .v{font-size:22px;font-weight:800;color:#08101f;}
.pbal .l{font-size:9.5px;color:rgba(8,16,31,0.65);margin-top:2px;font-weight:700;}
.pmap{height:112px;margin:8px 12px;border-radius:11px;position:relative;overflow:hidden;
background:linear-gradient(135deg,#DCE6F5,#C3D2EA);}
.pmap::before{content:"";position:absolute;inset:0;
background:repeating-linear-gradient(58deg,transparent 0 17px,rgba(255,255,255,0.05) 17px 19px),
repeating-linear-gradient(-32deg,transparent 0 23px,rgba(255,255,255,0.04) 23px 25px);}
.pmap .pin{position:absolute;left:46%;top:44%;width:13px;height:13px;border-radius:50% 50% 50% 0;
transform:rotate(-45deg);}
.pline{display:flex;justify-content:space-between;padding:5px 14px;font-size:10.5px;color:#5D6B84;}
.pline.strong{font-weight:800;color:#121A2B;font-size:12px;padding-top:8px;}
.pchart{height:76px;margin:8px 12px;display:flex;align-items:flex-end;gap:4px;}
.pchart i{flex:1;border-radius:3px 3px 0 0;display:block;}
.prings{display:flex;justify-content:center;padding:14px 0 6px;}
.prings .r{width:82px;height:82px;border-radius:50%;border:9px solid #E2E7F1;position:relative;}
.prings .r::after{content:"";position:absolute;inset:-9px;border-radius:50%;
border:9px solid transparent;transform:rotate(-90deg);}
.psteps{padding:8px 14px;}
.pstep{display:flex;align-items:center;gap:9px;font-size:10px;color:#8290A6;padding:4px 0;}
.pstep .b{width:9px;height:9px;border-radius:50%;background:#D6DDEA;flex-shrink:0;}
.pstep.on{color:#16203A;font-weight:700;}
.pprog{height:6px;margin:8px 14px;border-radius:6px;background:#E2E7F1;overflow:hidden;}
.pprog i{display:block;height:100%;border-radius:6px;}
.pcheck{display:flex;align-items:center;gap:9px;padding:7px 14px;font-size:11px;}
.pcheck .bx{width:16px;height:16px;border-radius:5px;border:2px solid #2C3454;flex-shrink:0;}
.pcheck.done{color:#98A3B8;text-decoration:line-through;}
.pstories{display:flex;gap:9px;padding:9px 12px;overflow:hidden;}
.pstory{text-align:center;flex-shrink:0;}
.pstory .c{width:38px;height:38px;border-radius:50%;border:2px solid;}
.pstory .n{font-size:8px;color:#6B7891;margin-top:3px;}
.ppost{margin:7px 12px;background:#FFFFFF;border-radius:11px;overflow:hidden;box-shadow:0 1px 4px rgba(20,30,60,0.10);}
.ppost .hd{display:flex;align-items:center;gap:8px;padding:8px 10px;}
.ppost .im{height:78px;}
.ppost .ac{display:flex;gap:12px;padding:7px 11px;font-size:11px;color:#6B7891;}
.ptiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 12px;}
.ptile{background:#FFFFFF;border-radius:11px;overflow:hidden;box-shadow:0 1px 3px rgba(20,30,60,0.09);}
.ptile .im{height:56px;}
.ptile .bd{padding:6px 8px;}
.ptile .t{font-size:10px;font-weight:700;}
.ptile .p{font-size:10px;margin-top:2px;font-weight:800;}
.part{height:132px;margin:14px 22px 8px;border-radius:14px;}
.pseek{margin:10px 16px 4px;}
.pseek .bar{height:4px;border-radius:4px;background:#DCE2ED;overflow:hidden;}
.pseek .bar i{display:block;height:100%;width:42%;}
.pseek .tm{display:flex;justify-content:space-between;font-size:8.5px;color:#6B7891;margin-top:5px;}
.pctl{display:flex;align-items:center;justify-content:center;gap:20px;padding:6px 0 10px;font-size:15px;color:#5D6B84;}
.pctl .pl{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;
justify-content:center;color:#08101f;font-size:16px;}
.pmini{margin-top:auto;display:flex;align-items:center;gap:9px;padding:9px 12px;
background:#FFFFFF;border-top:1px solid #DCE2ED;flex-shrink:0;}
.pmini .ar{width:32px;height:32px;border-radius:7px;flex-shrink:0;}
.pkey{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:8px 20px;}
.pkey div{text-align:center;padding:7px 0;font-size:13px;font-weight:700;color:#41506B;
background:#FFFFFF;border-radius:8px;}
.ppick{display:flex;align-items:center;gap:10px;margin:5px 12px;padding:9px 11px;
border-radius:11px;background:#FFFFFF;border:1px solid #E4E9F2;}
.ppick.on{background:#EEF3FC;}
.ppick .tx{flex:1;} .ppick .t{font-size:11.5px;font-weight:700;}
.ppick .st{font-size:9px;color:#6B7891;margin-top:1px;}
.ppick .mt{font-size:12px;font-weight:800;}

/* ---- নিচের স্ট্যাটাস লাইন ---- */
.statusbar{display:flex;align-items:center;gap:12px;padding:7px 14px;background:#121729;
border-top:1px solid #1e2540;font-size:11px;color:#8FA3CC;flex-shrink:0;
font-family:ui-monospace,Menlo,Consolas,monospace;}
.statusbar .grow{flex:1;height:4px;border-radius:4px;background:#1A2136;overflow:hidden;}
.statusbar .grow i{display:block;height:100%;width:0;transition:width 0.3s linear;}
.blip{width:7px;height:7px;border-radius:50%;background:#34D399;animation:blink 1.6s infinite;}

/* ---- কোনার "কেউ টাইপ করছে" ভিডিও ---- */
/* ---- কোনার "কেউ বসে টাইপ করছে" বক্স ----
   ইউটিউব স্ট্রিমাররা ওয়েবক্যাম যেভাবে ডান-নিচের কোনায় রাখেন, ঠিক সেই চেহারা:
   ১৬:৯ ফ্রেম, হালকা সোনালি বর্ডার, উপরে লাল জ্বলজ্বলে LIVE ব্যাজ, নিচে নাম-প্লেট। */
#camBox{position:fixed;right:20px;bottom:20px;width:264px;border-radius:14px;overflow:hidden;
border:2px solid rgba(255,216,102,0.55);box-shadow:0 18px 44px rgba(0,0,0,0.75);
background:#0c1020;z-index:5;}
#camBox video{width:100%;display:block;aspect-ratio:16/9;object-fit:cover;background:#0c1020;}
#camBox .liveTag{position:absolute;left:9px;top:8px;display:flex;align-items:center;gap:5px;
font-size:9px;font-weight:800;color:#fff;background:rgba(200,30,30,0.88);padding:3px 9px;
border-radius:20px;letter-spacing:0.6px;}
#camBox .liveTag i{width:5px;height:5px;border-radius:50%;background:#fff;display:block;
animation:livePulse 1.4s ease-in-out infinite;}
@keyframes livePulse{0%,100%{opacity:1;}50%{opacity:0.25;}}
#camBox .nameTag{position:absolute;left:0;right:0;bottom:0;padding:14px 10px 7px;
font-size:10px;font-weight:700;color:#F2F5FF;letter-spacing:0.3px;
background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,0.72) 100%);}
/* ভিডিও না থাকলে বক্সটা একদম লুকিয়ে যায় — ফাঁকা কালো চৌকো দেখা যায় না */
#camBox.empty{display:none;}

#bgSettingsPanel{max-width:560px;margin:30px auto;padding:20px;background:#12172a;
border:1px solid #2a3352;border-radius:16px;}
#bgSettingsPanel h2{color:#FFD866;font-size:16px;margin:0 0 4px;}
#bgSettingsPanel label{display:block;margin-top:14px;font-size:11px;color:#7C8AAD;font-weight:700;}
#bgSettingsPanel select{width:100%;padding:9px;border-radius:8px;border:1px solid #26314f;
background:#0f1526;color:#fff;font-size:13px;margin-top:5px;}
#bgSettingsPanel input,#bgSettingsPanel textarea{width:100%;padding:9px;border-radius:8px;
border:1px solid #26314f;background:#0f1526;color:#fff;font-size:13px;margin-top:5px;
font-family:inherit;}
#bgSettingsPanel textarea{min-height:70px;resize:vertical;}
#bgSettingsPanel input[type=range]{padding:0;}
#bgSettingsPanel .hint{font-size:11.5px;color:#7C8AAD;line-height:1.6;margin:6px 0 0;}
#bgSettingsPanel .hint b{color:#FFD866;font-family:ui-monospace,Menlo,Consolas,monospace;}
#bgSettingsPanel button{margin-top:14px;padding:10px 18px;border-radius:8px;border:none;
background:#FFD866;color:#0a0e1f;font-weight:800;cursor:pointer;font-size:13px;}
#bgSettingsStatus{margin-top:10px;font-size:12px;color:#8BE28B;min-height:16px;}
${CELEBRATION_CSS}
</style></head><body>
${CELEBRATION_HTML}
<div id="bgFallback"></div>
<div id="bgDim"></div>
<!-- ⚠️ src এখানে সরাসরি বসানো — Snake/Ball Sort যেভাবে কাজ করে ঠিক সেভাবেই।
     রিপোর ভিডিও-ফোল্ডারে ফাইলটা রাখলেই কোনো সেটিংস ছাড়াই নিজে থেকে চলতে শুরু করবে। -->
<video id="bgVideo" autoplay muted loop playsinline preload="auto" src="/game-assets/codelive-bg.mp4"></video>

<div class="stage"><div class="laptop">
  <div class="lid">
    <div class="cam"></div>
    <div class="screen">
      <div class="titlebar">
        <div class="dots">
          <span class="dot" style="background:#FF5F57"></span>
          <span class="dot" style="background:#FEBC2E"></span>
          <span class="dot" style="background:#28C840"></span>
        </div>
        <div class="tab"><b id="tabFile">app.jsx</b></div>
        <div class="langChip" id="langChip">React Native</div>
        <div class="brandChip" id="brandChip">Building</div>
      </div>
      <div class="work">
        <div class="editor">
          <div class="gutter" id="gutter"></div>
          <div class="code" id="code"></div>
        </div>
        <div class="side">
          <div class="phone"><div class="pscreen" id="pscreen"></div></div>
          <div class="caption" id="caption">Live preview</div>
        </div>
      </div>
      <div class="statusbar">
        <span class="blip"></span>
        <span id="statusText">Starting build...</span>
        <span class="grow"><i id="growBar"></i></span>
        <span id="counter"></span>
      </div>
    </div>
  </div>
  <div class="base"></div>
</div></div>

<div id="camBox" class="empty">
  <video id="camVideo" autoplay muted loop playsinline preload="auto" src="/game-assets/codelive-cam.mp4"></video>
  <div class="liveTag"><i></i>LIVE</div>
  <div class="nameTag">👨‍💻 Coding live</div>
</div>

<audio id="bgMusic" loop preload="auto"></audio>
<audio id="commentaryAudio" preload="auto"></audio>

<div id="bgSettingsPanel">
  <h2>🎬 Code Live — Video, Music &amp; Commentary</h2>
  <p class="hint">Both videos play automatically from your repo video folder —
  <b>codelive-bg.mp4</b> (background) and <b>codelive-cam.mp4</b> (corner box).
  The fields below are only needed if you want to play them from a link instead.</p>
  <form id="bgSettingsForm">
    <label>Music link (copyright-free MP3/audio URL — leave blank for no music)</label>
    <input type="text" id="bgMusicUrlInput" placeholder="https://...mp3">
    <label>Volume — <span id="volLabel">15%</span></label>
    <input type="range" id="bgMusicVolumeInput" min="0" max="1" step="0.05" value="0.15">
    <label>Your own recorded commentary audio links (one URL per line — cycles through them)</label>
    <textarea id="commentaryUrlsInput" placeholder="https://example.com/commentary1.mp3"></textarea>
    <label>Seconds between commentary clips (example: 90 = every 1.5 minutes)</label>
    <input type="number" id="loopIntervalInput" min="20" value="90">
    <label>Background video link (optional — overrides the folder file)</label>
    <input type="text" id="bgVideoUrlInput" placeholder="https://.../relaxing-background.mp4">
    <label>Corner video link (optional — overrides the folder file)</label>
    <input type="text" id="camVideoUrlInput" placeholder="https://.../typing-hands.mp4">
    <button type="submit">Save</button>
    <div id="bgSettingsStatus"></div>
  </form>
</div>

<script>
var APPS = ${JSON.stringify(CODELIVE_APPS)};

/* =========================================================================
   ভিডিও, মিউজিক ও কমেন্ট্রি
   -------------------------------------------------------------------------
   ভিডিও দুটো HTML-এই /game-assets/codelive-bg.mp4 আর /game-assets/codelive-cam.mp4
   ধরে বসানো আছে — অর্থাৎ ফোল্ডারে ফাইল রাখলেই চলবে, কোথাও কিছু লিখতে হবে না।
   সেটিংসে আলাদা লিংক দিলে সেটাই অগ্রাধিকার পাবে।
   ========================================================================= */
var bgVideoEl = document.getElementById("bgVideo");
var camVideoEl = document.getElementById("camVideo");
var camBoxEl = document.getElementById("camBox");
var bgMusicEl = document.getElementById("bgMusic");
var commentaryAudioEl = document.getElementById("commentaryAudio");
var lastBg = "", lastCam = "", lastMusicUrl = "";
var commentaryList = [], commentaryIdx = 0, commentaryTimer = null;

// কোনার বক্সটা তখনই দেখানো হয় যখন ভিডিওটা সত্যিই লোড হয়েছে — ফাইল না থাকলে
// দর্শক একটা ফাঁকা কালো চৌকো দেখবে না, বক্সটা একেবারেই থাকবে না
camVideoEl.addEventListener("loadeddata", function(){ camBoxEl.classList.remove("empty"); });
camVideoEl.addEventListener("error", function(){ camBoxEl.classList.add("empty"); });
bgVideoEl.addEventListener("loadeddata", function(){ bgVideoEl.style.opacity = "0.95"; });

// OBS/PRISM-এর ভেতরে ব্রাউজার মাঝে মাঝে নিজে থেকে autoplay শুরু করে না বা থেমে যায়,
// তাই দুটো ভিডিওকেই নিয়মিত ঠেলে চালু রাখা হচ্ছে
function keepPlaying(el){ if (el.getAttribute("src") && el.paused) el.play().catch(function(){}); }
setInterval(function(){ keepPlaying(bgVideoEl); keepPlaying(camVideoEl); }, 3000);
keepPlaying(bgVideoEl); keepPlaying(camVideoEl);

function applyVideo(el, url){
  el.src = url; el.load();
  el.play().catch(function(){});
}
function scheduleCommentary(intervalSec){
  if (commentaryTimer) clearInterval(commentaryTimer);
  if (!commentaryList.length) return;
  commentaryTimer = setInterval(function(){
    commentaryAudioEl.src = commentaryList[commentaryIdx % commentaryList.length];
    commentaryAudioEl.play().catch(function(){});
    commentaryIdx++;
  }, Math.max(20, intervalSec) * 1000);
}
function setIfNotTyping(id, value){
  var el = document.getElementById(id);
  if (document.activeElement !== el) el.value = value;
}
function loadConfig(){
  fetch("/gaming/codelive-config").then(function(r){ return r.json(); }).then(function(cfg){
    if (cfg.bgVideoUrl && cfg.bgVideoUrl !== lastBg){ lastBg = cfg.bgVideoUrl; applyVideo(bgVideoEl, cfg.bgVideoUrl); }
    if (cfg.camVideoUrl && cfg.camVideoUrl !== lastCam){ lastCam = cfg.camVideoUrl; applyVideo(camVideoEl, cfg.camVideoUrl); }

    if (cfg.bgMusicUrl && cfg.bgMusicUrl !== lastMusicUrl){
      lastMusicUrl = cfg.bgMusicUrl;
      bgMusicEl.src = cfg.bgMusicUrl;
      bgMusicEl.play().catch(function(){}); // autoplay নীতির কারণে প্রথম ক্লিকের পর বাজবে
    }
    bgMusicEl.volume = typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15;

    var newList = Array.isArray(cfg.commentaryUrls) ? cfg.commentaryUrls : [];
    if (JSON.stringify(newList) !== JSON.stringify(commentaryList)){
      commentaryList = newList; commentaryIdx = 0;
      scheduleCommentary(cfg.loopIntervalSec || 90);
    }

    var vol = typeof cfg.bgMusicVolume === "number" ? cfg.bgMusicVolume : 0.15;
    setIfNotTyping("bgMusicUrlInput", cfg.bgMusicUrl || "");
    document.getElementById("bgMusicVolumeInput").value = vol;
    document.getElementById("volLabel").textContent = Math.round(vol * 100) + "%";
    setIfNotTyping("commentaryUrlsInput", newList.join(String.fromCharCode(10)));
    setIfNotTyping("loopIntervalInput", cfg.loopIntervalSec || 90);
    setIfNotTyping("bgVideoUrlInput", cfg.bgVideoUrl || "");
    setIfNotTyping("camVideoUrlInput", cfg.camVideoUrl || "");
  }).catch(function(){});
}
loadConfig(); setInterval(loadConfig, 15000);
document.body.addEventListener("click", function(){ bgMusicEl.play().catch(function(){}); }, { once: true });
document.getElementById("bgMusicVolumeInput").addEventListener("input", function(e){
  document.getElementById("volLabel").textContent = Math.round(e.target.value * 100) + "%";
  bgMusicEl.volume = parseFloat(e.target.value);
});
document.getElementById("bgSettingsForm").addEventListener("submit", function(e){
  e.preventDefault();
  var urls = document.getElementById("commentaryUrlsInput").value
    .split(String.fromCharCode(10)).map(function(u){ return u.trim(); }).filter(Boolean);
  fetch("/gaming/codelive-config", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      bgMusicUrl: document.getElementById("bgMusicUrlInput").value.trim(),
      bgMusicVolume: parseFloat(document.getElementById("bgMusicVolumeInput").value),
      commentaryUrls: urls,
      loopIntervalSec: parseInt(document.getElementById("loopIntervalInput").value, 10) || 90,
      bgVideoUrl: document.getElementById("bgVideoUrlInput").value.trim(),
      camVideoUrl: document.getElementById("camVideoUrlInput").value.trim() }) })
    .then(function(){ document.getElementById("bgSettingsStatus").textContent = "Saved!"; lastBg=""; lastCam=""; lastMusicUrl=""; })
    .catch(function(){ document.getElementById("bgSettingsStatus").textContent = "Could not save."; });
});

/* ---------- কোড হাইলাইট ---------- */
var HLRE = /(\\/\\/[^\\n]*)|('[^']*'|"[^"]*")|\\b(const|let|var|function|return|if|else|for|while|import|from|export|default|async|await|class|extends|new|try|catch|this|null|true|false|struct|func|fun|override|private|final|late|void|super|Widget|object|companion|enum|interface|type|public|static)\\b|\\b(\\d+(?:\\.\\d+)?)\\b|([A-Za-z_$][\\w$]*)(?=\\s*\\()/g;
function esc(t){ return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function hl(line){
  return esc(line).replace(HLRE, function(m, cm, st, kw, num, fn){
    if (cm) return '<span class="c">' + cm + '</span>';
    if (st) return '<span class="s">' + st + '</span>';
    if (kw) return '<span class="k">' + kw + '</span>';
    if (num) return '<span class="n">' + num + '</span>';
    if (fn) return '<span class="f">' + fn + '</span>';
    return m;
  });
}

/* ---------- ফোনের স্ক্রিন আঁকা ---------- */
function el(cls, html){ var d = document.createElement("div"); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }
function fade(hex, a){ return hex + Math.round(a * 255).toString(16).padStart(2, "0"); }

function renderPhone(ui, accent){
  var scr = document.getElementById("pscreen");
  scr.innerHTML = "";
  scr.classList.remove("swap"); void scr.offsetWidth; scr.classList.add("swap");
  ui.forEach(function(w){
    var d;
    switch (w.t) {
      case "status":
        d = el("pstatus", "<span>9:41</span><span>▮▮▮ ᯤ ▉</span>"); break;
      case "appbar":
        d = el("pbar", '<div class="t">' + w.title + '</div>' + (w.sub ? '<div class="st">' + w.sub + '</div>' : "")); break;
      case "search":
        d = el("psearch", "🔍  " + w.ph); break;
      case "hero":
        d = el("phero", '<div class="t" style="color:' + accent + '">' + w.title + '</div><div class="st">' + w.sub + '</div>'); break;
      case "input":
        d = el("pinput", w.ph); break;
      case "btn":
        d = el("pbtn", w.label); d.style.background = accent; break;
      case "note":
        d = el("pnote", w.text); break;
      case "row":
        d = el("prow");
        var ic = el("pic", w.icon); ic.style.background = accent; d.appendChild(ic);
        d.appendChild(el("tx", '<div class="t">' + w.title + '</div>' + (w.sub ? '<div class="st">' + w.sub + '</div>' : "")));
        if (w.meta) d.appendChild(el("mt", w.meta));
        break;
      case "pick":
        d = el("ppick" + (w.on ? " on" : ""));
        if (w.on) d.style.borderColor = accent;
        d.appendChild(el("pic", w.icon)).style.background = fade(accent, 0.25);
        d.appendChild(el("tx", '<div class="t">' + w.title + '</div><div class="st">' + w.sub + '</div>'));
        var mt = el("mt", w.meta); mt.style.color = accent; d.appendChild(mt);
        break;
      case "chips":
        d = el("pchips");
        w.items.forEach(function(c, i){
          var ch = el("pchip" + (i === 0 ? " on" : ""), c);
          if (i === 0) ch.style.background = accent;
          d.appendChild(ch);
        });
        break;
      case "card":
        d = el("pcard", '<div class="im"></div><div class="bd"><div class="t">' + w.title + '</div><div class="st">' + w.sub + '</div></div>');
        d.querySelector(".im").style.background = "linear-gradient(135deg," + fade(accent, 0.55) + ",#1A2136)";
        break;
      case "tiles":
        d = el("ptiles");
        w.items.forEach(function(it){
          var tl = el("ptile", '<div class="im"></div><div class="bd"><div class="t">' + it[0] + '</div><div class="p">' + it[1] + '</div></div>');
          tl.querySelector(".im").style.background = "linear-gradient(135deg," + fade(accent, 0.5) + ",#1A2136)";
          tl.querySelector(".p").style.color = accent;
          d.appendChild(tl);
        });
        break;
      case "grid":
        d = el("pgrid");
        w.items.forEach(function(it){
          var c = el("pcell", '<div class="v">' + it[0] + '</div><div class="l">' + it[1] + '</div>');
          c.querySelector(".v").style.color = accent;
          d.appendChild(c);
        });
        break;
      case "big":
        d = el("pbig", '<div class="v">' + w.value + '</div><div class="l">' + w.label + '</div>'); break;
      case "balance":
        d = el("pbal", '<div class="l">' + w.label + '</div><div class="v">' + w.value + '</div>');
        d.style.background = "linear-gradient(135deg," + accent + "," + fade(accent, 0.65) + ")";
        break;
      case "line":
        d = el("pline" + (w.strong ? " strong" : ""), "<span>" + w.label + "</span><span>" + w.value + "</span>"); break;
      case "map":
        d = el("pmap", '<div class="pin"></div>');
        d.querySelector(".pin").style.background = accent;
        break;
      case "bubble":
        d = el("pbub " + w.side, w.text);
        if (w.side === "out") d.style.background = accent;
        break;
      case "composer":
        d = el("pcomp", '<div class="f">' + w.ph + '</div>');
        var sb = el("s"); sb.style.background = accent; d.appendChild(sb);
        break;
      case "chart":
        d = el("pchart");
        for (var i = 0; i < 14; i++) {
          var b = document.createElement("i");
          b.style.height = (26 + Math.round(Math.abs(Math.sin(i * 1.1)) * 66)) + "%";
          b.style.background = i % 3 === 0 ? accent : fade(accent, 0.4);
          d.appendChild(b);
        }
        break;
      case "rings":
        d = el("prings", '<div class="r"></div>');
        var r = d.querySelector(".r");
        r.style.borderColor = fade(accent, 0.22);
        r.style.boxShadow = "0 0 0 2px " + fade(accent, 0.5) + " inset";
        break;
      case "steps":
        d = el("psteps");
        w.items.forEach(function(sname, i){
          var st = el("pstep" + (i <= w.active ? " on" : ""), '<span class="b"></span>' + sname);
          if (i <= w.active) st.querySelector(".b").style.background = accent;
          d.appendChild(st);
        });
        break;
      case "progress":
        d = el("pprog", "<i></i>");
        d.querySelector("i").style.width = Math.round(w.value * 100) + "%";
        d.querySelector("i").style.background = accent;
        break;
      case "check":
        d = el("pcheck" + (w.done ? " done" : ""));
        var bx = el("bx"); if (w.done) { bx.style.background = accent; bx.style.borderColor = accent; }
        d.appendChild(bx); d.appendChild(el("", w.title));
        break;
      case "stories":
        d = el("pstories");
        w.items.forEach(function(nm, i){
          var s = el("pstory", '<div class="c"></div><div class="n">' + nm + '</div>');
          s.querySelector(".c").style.borderColor = i === 0 ? "#2C3454" : accent;
          s.querySelector(".c").style.background = fade(accent, 0.25);
          d.appendChild(s);
        });
        break;
      case "post":
        d = el("ppost", '<div class="hd"></div><div class="im"></div><div class="ac"><span>♡ 128</span><span>💬 24</span><span>↗</span></div>');
        var hd = d.querySelector(".hd");
        var av = el("pic", w.title.charAt(0)); av.style.background = accent; hd.appendChild(av);
        hd.appendChild(el("tx", '<div class="t" style="font-size:11px;font-weight:700">' + w.title + '</div><div class="st" style="font-size:9px;color:#7C8AAD">' + w.sub + '</div>'));
        d.querySelector(".im").style.background = "linear-gradient(135deg," + fade(accent, 0.5) + ",#1A2136)";
        break;
      case "art":
        d = el("part"); d.style.background = "linear-gradient(135deg," + accent + ",#1A2136)"; break;
      case "seek":
        d = el("pseek", '<div class="bar"><i></i></div><div class="tm"><span>1:24</span><span>3:18</span></div>');
        d.querySelector("i").style.background = accent;
        break;
      case "controls":
        d = el("pctl", '<span>⏮</span><span class="pl">▶</span><span>⏭</span>');
        d.querySelector(".pl").style.background = accent;
        break;
      case "miniplayer":
        d = el("pmini", '<div class="ar"></div><div class="tx"><div class="t" style="font-size:11px;font-weight:700">' + w.title + '</div><div class="st" style="font-size:9px;color:#7C8AAD">' + w.sub + '</div></div><span style="color:#9FB0D4">▶</span>');
        d.querySelector(".ar").style.background = accent;
        break;
      case "keypad":
        d = el("pkey");
        ["1","2","3","4","5","6","7","8","9","","0","⌫"].forEach(function(kk){ d.appendChild(el("", kk)); });
        break;
      case "tabbar":
        d = el("ptab");
        w.items.forEach(function(tname, i){
          var tb = el("", tname);
          if (i === 0) { tb.style.color = accent; }
          d.appendChild(tb);
        });
        break;
      default:
        d = el("w", "");
    }
    scr.appendChild(d);
  });
}

/* ---------- টাইপিং ইঞ্জিন ---------- */
// গতি — "ফাস্ট, কিন্তু একটু ধীরে", যেন সত্যিই কেউ বসে টাইপ করছে
var CHAR_MS = 28, LINE_PAUSE = 240, SCREEN_PAUSE = 4200, APP_PAUSE = 5000, MAX_LINES = 26;
var order = [], oi = 0, app = null, si = 0, li = 0, ci = 0;
var lineEls = [], lineNo = 0, totalChars = 0, doneChars = 0;

function shuffled(n){
  var a = []; for (var i = 0; i < n; i++) a.push(i);
  for (var j = a.length - 1; j > 0; j--){ var k = Math.floor(Math.random() * (j + 1)); var t = a[j]; a[j] = a[k]; a[k] = t; }
  return a;
}
function clearEditor(){
  document.getElementById("code").innerHTML = "";
  document.getElementById("gutter").innerHTML = "";
  lineEls = []; lineNo = 0;
}
function pushLine(){
  lineNo++;
  var codeBox = document.getElementById("code"), gut = document.getElementById("gutter");
  var d = document.createElement("div");
  codeBox.appendChild(d); lineEls.push(d);
  var g = document.createElement("div"); g.textContent = lineNo; gut.appendChild(g);
  // লাইন বেশি হয়ে গেলে উপরেরটা মুছে ফেলা — এতেই "লেখা উপরে উঠে যাচ্ছে" অনুভূতি হয়
  while (lineEls.length > MAX_LINES){
    lineEls.shift().remove();
    if (gut.firstChild) gut.firstChild.remove();
  }
  return d;
}
function startApp(){
  app = APPS[order[oi]];
  si = 0;
  document.getElementById("brandChip").textContent = app.name;
  document.getElementById("brandChip").style.background = app.accent;
  document.getElementById("brandChip").style.color = "#08101f";
  document.getElementById("langChip").textContent = app.lang;
  document.getElementById("counter").textContent = app.tag;
  totalChars = 0; doneChars = 0;
  app.screens.forEach(function(s){ s.code.forEach(function(l){ totalChars += l.length + 1; }); });
  document.getElementById("pscreen").innerHTML = "";
  clearEditor();
  startScreen();
}
function startScreen(){
  var sc = app.screens[si];
  li = 0; ci = 0;
  document.getElementById("tabFile").textContent = sc.file;
  document.getElementById("statusText").textContent = "Writing " + sc.file;
  pushLine();
  tick();
}
function tick(){
  var sc = app.screens[si];
  var raw = sc.code[li];
  if (ci <= raw.length){
    lineEls[lineEls.length - 1].innerHTML = hl(raw.slice(0, ci)) + '<span class="cursor"></span>';
    ci++; doneChars++;
    document.getElementById("growBar").style.width = Math.min(100, Math.round(doneChars / totalChars * 100)) + "%";
    document.getElementById("growBar").style.background = app.accent;
    setTimeout(tick, CHAR_MS + Math.random() * 26);
    return;
  }
  lineEls[lineEls.length - 1].innerHTML = hl(raw) || "&nbsp;";
  li++;
  if (li < sc.code.length){
    pushLine(); ci = 0;
    setTimeout(tick, raw.trim() === "" ? 60 : LINE_PAUSE);
    return;
  }
  // স্ক্রিনের কোড শেষ — এবার ফোনে সেই স্ক্রিনটা তৈরি হবে
  document.getElementById("statusText").textContent = "✓ " + sc.file + " compiled — rendering preview";
  setTimeout(function(){
    renderPhone(sc.ui, app.accent);
    document.getElementById("caption").innerHTML = "<b>" + app.name + "</b> — " + sc.label;
    si++;
    if (si < app.screens.length){
      setTimeout(startScreen, SCREEN_PAUSE);
    } else {
      document.getElementById("statusText").textContent = "🎉 " + app.name + " build complete — starting next project";
      setTimeout(function(){
        oi++;
        if (oi >= order.length){ order = shuffled(APPS.length); oi = 0; }
        startApp();
      }, APP_PAUSE);
    }
  }, 700);
}
order = shuffled(APPS.length);
startApp();

/* Code Live-এ পাশে ডোনার প্যানেল নেই, তাই এই দুটো কিছুই করে না —
   কিন্তু সেলিব্রেশন কোডটা দুই গেমের সাথে হুবহু এক রাখতে এগুলো দরকার */
function refreshTopDonors(){}
function refreshRecentDonors(){}
var audioCtx = null;
${celebrationJS("codelive")}
</script></body></html>`;

// ---------------------------------------------------------------------------
// ৮. মূল mount ফাংশন — server.js থেকে কল হয়
// ---------------------------------------------------------------------------
// এই ফাইলটার পরিচয়পত্র। প্রতিবার নতুন সংস্করণ দিলে এটা বদলায় — তাই /gaming/health খুলেই
// নিশ্চিত হওয়া যায় সার্ভারে আসলেই নতুন ফাইলটা উঠেছে কিনা, নাকি পুরনোটাই রয়ে গেছে।
const GAMING_BUILD = "2026-08-16 · codelive + queue + celebration + live-embed";

module.exports = function mountGaming(app) {
  // ⚠️ /gaming/health সবার আগে রেজিস্টার করা — ইচ্ছে করেই।
  // নিচের কোনো এক জায়গায় কিছু ভাঙলে server.js পুরো mount-টাকে catch করে চুপ করে যেত, আর
  // তখন /gaming/* সব রুট উধাও হয়ে "Cannot GET" দেখাত — কেন, তা বোঝার কোনো উপায় থাকত না।
  // এখন এই একটা রুট সবসময় বেঁচে থাকে আর ঠিক কী ভেঙেছে তা বলে দেয়।
  let mountError = null;
  function listGamingRoutes() {
    // Express 4 আর 5-এ router-এর নাম আলাদা, তাই দুটোই দেখা হয়
    const router = app._router || app.router;
    const stack = (router && router.stack) || [];
    return stack
      .filter((l) => l.route && String(l.route.path || "").startsWith("/gaming"))
      .map((l) => Object.keys(l.route.methods).join(",").toUpperCase() + " " + l.route.path);
  }
  app.get("/gaming/health", (req, res) => {
    const routes = listGamingRoutes();
    res.json({
      build: GAMING_BUILD,
      node: process.version,
      mountedOk: !mountError,
      mountError: mountError ? { message: mountError.message, stack: mountError.stack } : null,
      optionalModules: { multer: !!multer, webPush: !!webpush },
      gamingRouteCount: routes.length,
      hasCodeliveOverlay: routes.some((r) => r.includes("/gaming/overlay/codelive")),
      routes,
    });
  });

  try {
  app.use("/gaming/state", express.static(STATE_DIR));
  app.use("/gaming/audio", express.static(AUDIO_DIR));
  app.use("/gaming/uploads", express.static(CHALLENGE_UPLOAD_DIR));
  // ---------- গেমের ব্যাকগ্রাউন্ড ভিডিও (Snake / Ball Sort) ----------
  // GitHub-এ ফোল্ডারের নাম কখনো "game-assets", কখনো "gaming assetes" (স্পেস + ভিন্ন বানান) হয়ে
  // গিয়েছিল — সেই একটামাত্র অক্ষরের গরমিলেই ভিডিও লোড হচ্ছিল না, ব্যাকগ্রাউন্ড কালো দেখাচ্ছিল।
  // এখন আর কোনো নির্দিষ্ট নামের উপর নির্ভর করা হচ্ছে না: নিচের যেকোনো নামের ফোল্ডার রিপোতে থাকলেই
  // সেটা /game-assets URL-এ সার্ভ হবে। ভবিষ্যতে ফোল্ডারের নাম বদলে গেলেও ভিডিও আর বন্ধ হবে না।
  const ASSET_DIR_CANDIDATES = [
    "game-assets", "gaming assetes", "gaming-assets", "game assets",
    "gaming assets", "gameassets", "assets", "public/game-assets",
  ];
  const foundAssetDirs = [];
  for (const cand of ASSET_DIR_CANDIDATES) {
    try {
      const full = path.join(__dirname, cand);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        app.use("/game-assets", express.static(full, { maxAge: "1h" }));
        foundAssetDirs.push({ dir: cand, files: fs.readdirSync(full) });
      }
    } catch (e) { /* এই নামটা নেই — পরেরটা দেখা হবে */ }
  }
  if (foundAssetDirs.length) {
    console.log("🎬 ব্যাকগ্রাউন্ড ভিডিও ফোল্ডার পাওয়া গেছে:", JSON.stringify(foundAssetDirs));
  } else {
    console.warn("⚠️ কোনো ব্যাকগ্রাউন্ড-ভিডিও ফোল্ডার পাওয়া যায়নি — /gaming/assets-check খুলে দেখুন রিপোতে কী কী আছে");
  }
  // এক ক্লিকে নির্ণয়: এই URL খুললেই দেখা যাবে সার্ভার আসলে কোন ফোল্ডার/ফাইল দেখতে পাচ্ছে
  app.get("/gaming/assets-check", (req, res) => {
    let rootListing = [];
    try {
      rootListing = fs.readdirSync(__dirname, { withFileTypes: true })
        .map((d) => (d.isDirectory() ? "[DIR] " : "      ") + d.name);
    } catch (e) { rootListing = ["পড়া যায়নি: " + e.message]; }
    res.json({
      servedFrom: foundAssetDirs,
      expectedUrls: [
        "/game-assets/snake-bg.mp4",
        "/game-assets/ballsort-bg.mp4",
        "/game-assets/codelive-bg.mp4",   // Code Live — বড় ব্যাকগ্রাউন্ড ভিডিও
        "/game-assets/codelive-cam.mp4",  // Code Live — কোনার ছোট "কেউ টাইপ করছে" ভিডিও
      ],
      repoRoot: rootListing,
    });
  });
  app.get("/gaming/overlay/chess", (req, res) => res.type("html").send(CHESS_OVERLAY_HTML));
  app.get("/gaming/overlay/codelive", (req, res) => res.type("html").send(CODELIVE_OVERLAY_HTML));
  app.get("/gaming/status", (req, res) => res.json({ ok: true, activeBlockId }));

  // --- লাইভ চ্যালেঞ্জ / queue রুটগুলো ---
  app.get("/gaming/challenge/join", (req, res) => res.type("html").send(CHALLENGE_JOIN_HTML));
  app.get("/gaming/challenge/status", (req, res) => res.type("html").send(CHALLENGE_STATUS_HTML));
  app.get("/gaming/challenge/play", (req, res) => res.type("html").send(CHALLENGE_PLAY_HTML));
  // প্রতিটা গেমের টিপস লিংক এখন সার্ভারের নিজের পেমেন্ট রুটেই যায় (/pay/snake, /pay/ballsort,
  // /pay/chessbattle) — অর্থাৎ কোনো environment variable সেট না করলেও বোতামটা কাজ করবে।
  // CHALLENGE_TIP_URL সেট করা থাকলে সেটাই অগ্রাধিকার পাবে (পুরনো সেটআপ যেন না ভাঙে)।
  const TIP_CHANNEL = { snake: "snake", ballsort: "ballsort", chess: "chessbattle", chessbattle: "chessbattle" };
  const TIP_RETURN = { snake: "/gaming/challenge/snake", ballsort: "/gaming/challenge/ballsort",
                       chess: "/gaming/challenge/join", chessbattle: "/gaming/challenge/join" };
  app.get("/gaming/challenge/tip-info", (req, res) => {
    const game = req.query.game;
    const channel = TIP_CHANNEL[game] || "chessbattle";
    // ⚠️ ?ret= টুকুই আসল পরিবর্তন। এটা ছাড়া টাকা দেওয়ার পর দর্শককে সোজা YouTube-এ
    // পাঠিয়ে দেওয়া হতো — অথচ সে তো লাইভ দেখছিল না, লাইনে দাঁড়াতে এসেছিল।
    const ret = TIP_RETURN[game] || "/gaming/challenge/join";
    // ⚠️ এখানেই সবচেয়ে বড় ভুলটা ছিল। CHALLENGE_TIP_URL সেট করা থাকলে *সব* গেমের টিপস
    // ওই এক ঠিকানাতেই যেত — অর্থাৎ Snake-এ দেওয়া টাকা chessbattle চ্যানেলে জমা হতো।
    // ফলে Snake overlay-তে সেলিব্রেশন কখনোই হতো না, টপ-৩ তেও নাম উঠত না।
    // (স্ক্যানারের QR সরাসরি /pay/snake দেখাত, তাই ওটা ঠিকঠাক কাজ করছিল — আর এই
    //  পার্থক্যটাই "স্ক্যানারে হয়, লাইনে হয় না" রহস্যের আসল কারণ।)
    // এখন গেম জানা থাকলে সবসময় সেই গেমের নিজের চ্যানেলেই যায়।
    const base = TIP_CHANNEL[game] ? ("/pay/" + channel) : (TIP_URL || "/pay/" + channel);
    const sep = base.indexOf("?") >= 0 ? "&" : "?"; // ঠিকানায় আগে থেকে ? থাকলেও যেন না ভাঙে
    res.json({ tipUrl: base + sep + "ret=" + encodeURIComponent(ret) });
  });

  // চেস overlay-তে নতুন টিপস এলে তার নাম নিয়ে real voice announcement বাজানোর জন্য —
  // আগে থেকে থাকা edge-tts টেক্সট-টু-স্পিচ সিস্টেমটাই পুনরায় ব্যবহার হচ্ছে (chess commentary-তে যেটা ব্যবহৃত)
  app.get("/gaming/tts", async (req, res) => {
    const text = (req.query.text || "").toString().slice(0, 200);
    if (!text) return res.status(400).json({ error: "text প্রয়োজন" });
    try {
      const url = await textToSpeech(text);
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- ব্যাকগ্রাউন্ড মিউজিক + কাস্টম লুপিং কমেন্ট্রি (অ্যাডমিন কনফিগ) ----------
  // ⚠️ এটা এখন একদম আলাদা, non-public পেজ — /gaming/overlay/chess-এর ভেতরে বা status পেজের
  // iframe-এ এটা কখনো embed হয় না। এই লিংকটা শুধু আপনার নিজের কাছে থাকবে, কোনো দর্শক/challenger
  // কখনো এখানে পৌঁছাতে পারবে না (কোনো পাবলিক পেজ থেকে এই URL-এর লিংকও দেওয়া নেই)।
  const CHESS_CONFIG_FILE = path.join(STATE_DIR, "chess-config.json");
  function readChessConfig() {
    try {
      return JSON.parse(fs.readFileSync(CHESS_CONFIG_FILE, "utf-8"));
    } catch (e) {
      return { bgMusicUrl: "", bgMusicVolume: 0.15, commentaryUrls: [], loopIntervalSec: 90, celebVoiceURI: "" };
    }
  }
  function writeChessConfig(cfg) {
    fs.writeFileSync(CHESS_CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }

  app.get("/gaming/chess-config", (req, res) => res.json(readChessConfig()));

  app.get("/gaming/chess-admin", (req, res) => {
    res.type("html").send(CHESS_ADMIN_HTML);
  });

  app.post("/gaming/chess-admin", express.json(), (req, res) => {
    const body = req.body || {};
    writeChessConfig({
      bgMusicUrl: (body.bgMusicUrl || "").toString().slice(0, 500),
      bgMusicVolume: Math.max(0, Math.min(1, parseFloat(body.bgMusicVolume) || 0.15)),
      commentaryUrls: Array.isArray(body.commentaryUrls) ? body.commentaryUrls.slice(0, 20).map(s => (s || "").toString().slice(0, 500)) : [],
      loopIntervalSec: Math.max(20, parseInt(body.loopIntervalSec, 10) || 90),
      celebVoiceURI: (body.celebVoiceURI || "").toString().slice(0, 300),
    });
    res.json({ ok: true });
  });

  // ---------- Snake ও Ball Sort-এর ব্যাকগ্রাউন্ড মিউজিক + কমেন্ট্রি — প্রতিটা গেমের নিজের পেজেই
  // স্ক্রল করে নিচে সেট করা যায় (ইউজারের স্পষ্ট অনুরোধ অনুযায়ী, আলাদা কোনো admin পেজে না) ----------
  // ব্যাকগ্রাউন্ড ভিডিওর ঠিকানা — তিন ধাপে খোঁজা হয়:
  //  ১) Render-এর Environment Variable (SNAKE_BG_VIDEO_URL / BALLSORT_BG_VIDEO_URL)
  //  ২) সেটিংস প্যানেলে সেভ করা মান
  //  ৩) কিছুই না থাকলে রিপোর ফোল্ডার থেকে (/game-assets/...mp4)
  // ⚠️ Render প্রতিবার deploy করলে সার্ভারের নিজের ফাইল মুছে যায়, তাই সেটিংস প্যানেলে সেভ করা
  // ঠিকানাও মুছে যেতে পারে। স্থায়ীভাবে রাখতে চাইলে Environment Variable-ই সবচেয়ে নিরাপদ।
  const ENV_BG_VIDEO = {
    snake: process.env.SNAKE_BG_VIDEO_URL || "",
    ballsort: process.env.BALLSORT_BG_VIDEO_URL || "",
    codelive: process.env.CODELIVE_BG_VIDEO_URL || "",
  };
  function readMindGameConfig(game) {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${game}-config.json`), "utf-8")); }
    catch (e) { cfg = { bgMusicUrl: "", bgMusicVolume: 0.15, commentaryUrls: [], loopIntervalSec: 90, bgVideoUrl: "", celebVoiceURI: "" }; }
    if (!cfg.bgVideoUrl) cfg.bgVideoUrl = ENV_BG_VIDEO[game] || "";
    if (!cfg.camVideoUrl) cfg.camVideoUrl = process.env.CODELIVE_CAM_VIDEO_URL || "";
    return cfg;
  }
  function writeMindGameConfig(game, cfg) {
    fs.writeFileSync(path.join(STATE_DIR, `${game}-config.json`), JSON.stringify(cfg, null, 2));
  }
  function saveMindGameConfigRoute(game) {
    return (req, res) => {
      const body = req.body || {};
      writeMindGameConfig(game, {
        bgMusicUrl: (body.bgMusicUrl || "").toString().slice(0, 500),
        bgMusicVolume: Math.max(0, Math.min(1, parseFloat(body.bgMusicVolume) || 0.15)),
        commentaryUrls: Array.isArray(body.commentaryUrls) ? body.commentaryUrls.slice(0, 20).map(s => (s || "").toString().slice(0, 500)) : [],
        loopIntervalSec: Math.max(20, parseInt(body.loopIntervalSec, 10) || 90),
        bgVideoUrl: (body.bgVideoUrl || "").toString().slice(0, 500),
        camVideoUrl: (body.camVideoUrl || "").toString().slice(0, 500),
        // কোন কণ্ঠে ঘোষণা পড়া হবে — ব্রাউজারভেদে ভয়েস আলাদা, তাই voiceURI সেভ করা হয়
        celebVoiceURI: (body.celebVoiceURI || "").toString().slice(0, 300),
      });
      res.json({ ok: true });
    };
  }
  app.get("/gaming/snake-config", (req, res) => res.json(readMindGameConfig("snake")));
  app.post("/gaming/snake-config", express.json(), saveMindGameConfigRoute("snake"));
  app.get("/gaming/ballsort-config", (req, res) => res.json(readMindGameConfig("ballsort")));
  app.post("/gaming/ballsort-config", express.json(), saveMindGameConfigRoute("ballsort"));
  app.get("/gaming/codelive-config", (req, res) => res.json(readMindGameConfig("codelive")));
  app.post("/gaming/codelive-config", express.json(), saveMindGameConfigRoute("codelive"));

  // কুকি পড়া/লেখার জন্য হালকা helper — নতুন কোনো npm প্যাকেজ ছাড়াই
  function readCookie(req, name) {
    const header = req.headers.cookie || "";
    const match = header.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
    return match ? decodeURIComponent(match.split("=")[1]) : null;
  }
  function setCookie(res, name, value, maxAgeSec) {
    res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSec}; Path=/; SameSite=Lax`);
  }

  app.post("/gaming/challenge/join", (req, res, next) => {
    if (upload) return upload.single("photo")(req, res, next);
    next();
  }, express.urlencoded({ extended: true }), (req, res) => {
    // ⚠️ পুরো হ্যান্ডলারটা try/catch দিয়ে মোড়ানো — কোনো কারণে ভেতরে error হলেও যেন সার্ভার
    // নীরবে ক্র্যাশ/হ্যাং না করে, বরং client-কে একটা স্পষ্ট JSON error ফেরত দেয় (আগে এরকম ঘটলে
    // ব্রাউজারে "Joining queue..." বাটন চিরকাল আটকে থাকতো, কোনো error দেখা যেত না)
    try {
      // একই ব্রাউজার/ডিভাইস থেকে আগের একটা queue-entry এখনো সক্রিয় (লাইনে আছে অথবা এখনই খেলছে) থাকলে
      // দ্বিতীয়বার নতুন করে লাইনে ঢুকতে দেওয়া হচ্ছে না — বরং তার আগের entry-টাই ফিরিয়ে দেওয়া হচ্ছে
      const existingId = readCookie(req, "chessQueueId");
      if (existingId) {
        const stillInQueue = challengeQueue.some(q => q.id === existingId);
        const isCurrentlyPlaying = activeChallenge && activeChallenge.id === existingId;
        if (stillInQueue || isCurrentlyPlaying) {
          console.log(`[chess-join] ${existingId} আগে থেকেই সক্রিয় — পুরনো entry ফেরত দেওয়া হলো`);
          return res.json({ id: existingId, alreadyInQueue: true });
        }
      }
      const id = nextQueueId();
      const name = ((req.body && req.body.name) || "Chess Legend").toString().slice(0, 30);
      const photoUrl = req.file ? `/gaming/uploads/${path.basename(req.file.path)}` : "";
      // "কত টাকা টিপস দিলেন" — দর্শক নিজে QR স্ক্যান করে পাঠানোর পর এখানে (ঐচ্ছিক) লিখে দেয়,
      // এটা payment gateway থেকে auto-verify হয় না, শুধু queue-তে তার নামের পাশে দেখানোর জন্য
      let tipAmount = parseInt((req.body && req.body.tipAmount) || "0", 10);
      if (!Number.isFinite(tipAmount) || tipAmount < 0) tipAmount = 0;
      if (tipAmount > 1000000) tipAmount = 1000000; // অস্বাভাবিক বড় সংখ্যা আটকানো
      challengeQueue.push({ id, name, photoUrl, tipAmount, joinedAt: Date.now() });
      console.log(`[chess-join] নতুন queue entry: ${id} (${name}), মোট লাইনে এখন ${challengeQueue.length} জন`);
      setCookie(res, "chessQueueId", id, 3600); // ১ ঘণ্টা — এর মধ্যে আবার join চাপলে পুরনো entry-ই ফেরত পাবে
      res.json({ id });
    } catch (e) {
      console.error("❌ [chess-join] join route-এ error:", e.message, e.stack);
      res.status(500).json({ error: "join_failed", message: e.message });
    }
  });

  app.get("/gaming/challenge/queue-state", (req, res) => {
    const id = req.query.id;
    const idx = challengeQueue.findIndex((q) => q.id === id);
    const isActive = !!(activeChallenge && activeChallenge.id === id);
    res.json({ position: idx >= 0 ? idx + 1 : isActive ? 0 : null, total: challengeQueue.length, isYourTurn: isActive });
  });

  app.get("/gaming/challenge/play-state", (req, res) => {
    const id = req.query.id;
    if (!activeChallenge || activeChallenge.id !== id) return res.json({ active: false });
    res.json({
      active: true,
      fen: activeChallenge.chess.fen(),
      turn: activeChallenge.chess.turn(),
      name: activeChallenge.name,
      photoUrl: activeChallenge.photoUrl,
      lastMove: activeChallenge.lastMove || null,
      whiteMs: typeof activeChallenge.whiteMs === "number" ? activeChallenge.whiteMs : null,
      blackMs: typeof activeChallenge.blackMs === "number" ? activeChallenge.blackMs : null,
    });
  });

  app.post("/gaming/challenge/move", express.json(), (req, res) => {
    const { id, from, to } = req.body || {};
    if (!activeChallenge || activeChallenge.id !== id) return res.json({ ok: false, error: "It's not your turn right now" });
    if (activeChallenge.chess.turn() !== "b") return res.json({ ok: false, error: "Your turn hasn't come yet" });
    const move = activeChallenge.chess.move({ from, to, promotion: "q" });
    if (!move) return res.json({ ok: false, error: "Invalid move" });
    activeChallenge.lastHumanMoveAt = Date.now();
    activeChallenge.lastMove = { from: move.from, to: move.to }; // play পেজেই নিজের চালটাও animate দেখানোর জন্য
    res.json({ ok: true });
  });

  // --- "কাটার সুইচ" — লাইনে দাঁড়ানো কেউ চাইলে মাঝপথে লাইন থেকে সরে যেতে পারবে ---
  app.post("/gaming/challenge/leave", express.json(), (req, res) => {
    const { id } = req.body || {};
    const idx = challengeQueue.findIndex((q) => q.id === id);
    if (idx >= 0) challengeQueue.splice(idx, 1);
    delete pushSubscriptions[id];
    notifyQueuePositions();
    res.json({ ok: true });
  });

  // --- পুশ নোটিফিকেশন সেটআপ রুট ---
  // ---------- Snake / Ball Sort queue রুট ----------
  function gqValid(req, res) {
    const game = req.params.game;
    if (!gameQueues[game]) { res.status(404).json({ error: "unknown_game" }); return null; }
    return game;
  }

  app.post("/gaming/gq/:game/join", (req, res, next) => {
    if (upload) return upload.single("photo")(req, res, next);
    next();
  }, express.urlencoded({ extended: true }), (req, res) => {
    try {
      const game = gqValid(req, res); if (!game) return;
      const st = gameQueues[game];
      // একই ব্রাউজার থেকে ইতিমধ্যেই লাইনে থাকলে বা খেলতে থাকলে — নতুন entry না বানিয়ে
      // পুরনোটাই ফেরত দেওয়া হয়, নাহলে একজন বারবার চেপে পুরো লাইন দখল করে ফেলত
      const existingId = readCookie(req, "gq_" + game);
      if (existingId) {
        const inQueue = st.queue.some((q) => q.id === existingId);
        const isPlaying = st.active && st.active.id === existingId;
        if (inQueue || isPlaying) return res.json({ id: existingId, alreadyInQueue: true });
      }
      const id = nextQueueId();
      const name = ((req.body && req.body.name) || "Player").toString().trim().slice(0, 30) || "Player";
      const photoUrl = req.file ? `/gaming/uploads/${path.basename(req.file.path)}` : "";
      // অঙ্কটা খেলোয়াড়ের কাছ থেকে নেওয়া হয় না — সার্ভারে রেকর্ড হওয়া আসল পেমেন্ট থেকেই আসে
      st.queue.push({ id, name, photoUrl, joinedAt: Date.now() });
      // ⚠️ এই ছবিটা server.js-এর ডোনার-ছবির তালিকাতেও পাঠিয়ে দেওয়া হয়। কারণ সেলিব্রেশন আর
      // টপ-৩ প্যানেল ওই তালিকা থেকেই ছবি নেয়। এটা না করলে লাইনে দাঁড়ানো কেউ টাকা দিলে
      // তার নাম দেখা যেত কিন্তু ছবি আসত না, আর তাকে দ্বিতীয়বার ছবি চাইতে হতো।
      if (req.file) registerQueuePhotoAsDonorPhoto(name, req.file.path);
      setCookie(res, "gq_" + game, id, 3600);
      console.log(`[${game}-queue] নতুন: ${name} (লাইনে এখন ${st.queue.length} জন)`);
      gqNotifyPositions(game);
      res.json({ id });
    } catch (e) {
      console.error("❌ gq/join error:", e.message);
      res.status(500).json({ error: "join_failed", message: e.message });
    }
  });

  // খেলোয়াড়ের নিজের পেজ প্রতি ৩ সেকেন্ডে এটা জিজ্ঞেস করে — এখন কি আমার পালা?
  app.get("/gaming/gq/:game/state", (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const st = gameQueues[game];
    const id = req.query.id;
    const idx = st.queue.findIndex((q) => q.id === id);
    const isYourTurn = !!(st.active && st.active.id === id);
    res.json({
      position: idx >= 0 ? idx + 1 : null,
      total: st.queue.length,
      isYourTurn,
      finished: isYourTurn ? !!st.active.finished : false,
      secondsLeft: isYourTurn ? Math.max(0, Math.round((st.active.startedAt + GQ_TURN_MS - Date.now()) / 1000)) : null,
      etaMinutes: idx >= 0 ? Math.round(((idx + 1) * GQ_TURN_MS) / 60000) : null,
      nowPlaying: gqPublicActive(game),
    });
  });

  // খেলোয়াড় নোটিফিকেশনে চাপ দিয়ে পেজে এসেছে — রিং থামাও
  app.post("/gaming/gq/:game/ack", express.json(), (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const st = gameQueues[game];
    const { id } = req.body || {};
    if (st.active && st.active.id === id) { st.active.acknowledged = true; gqStopRinging(st.active); }
    res.json({ ok: true });
  });

  // খেলা শেষ — একবারই খেলা যায়, তাই এর পরেই তার পালা শেষ হয়ে পরেরজনের ডাক পড়ে
  app.post("/gaming/gq/:game/finish", express.json(), (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const st = gameQueues[game];
    const { id } = req.body || {};
    if (st.active && st.active.id === id) st.active.finished = true;
    res.json({ ok: true });
  });

  app.post("/gaming/gq/:game/leave", express.json(), (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const st = gameQueues[game];
    const { id } = req.body || {};
    const idx = st.queue.findIndex((q) => q.id === id);
    if (idx >= 0) { gqStopRinging(st.queue[idx]); st.queue.splice(idx, 1); }
    if (st.active && st.active.id === id) st.active.finished = true;
    delete pushSubscriptions[id];
    gqNotifyPositions(game);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // "এখন লাইভে কী চলছে" ফিড
  // ---------------------------------------------------------------------------
  // লাইনে দাঁড়ানো দর্শক নিজের ফোনেই দেখতে পায় এই মুহূর্তে বোর্ডে কী চলছে — AI খেলছে না
  // অন্য কেউ খেলছে, দুটোই। overlay নিজের AI-খেলার অবস্থা এখানে পাঠায়; কোনো মানুষ খেললে
  // তার নিজের অবস্থাই (gqMirror) অগ্রাধিকার পায়। ফলে অপেক্ষা করার সময় পর্দা ফাঁকা থাকে না।
  app.post("/gaming/watch/:game", express.json({ limit: "64kb" }), (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const prev = gqWatch[game];
    gqWatch[game] = { seq: (prev ? prev.seq : 0) + 1, state: (req.body || {}).state, at: Date.now() };
    res.json({ ok: true });
  });
  app.get("/gaming/watch/:game", (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const m = gqMirror[game];
    if (m && Date.now() - m.at < 8000) {
      return res.json({ active: true, source: "player", seq: "p" + m.seq, name: m.name, photoUrl: m.photoUrl, state: m.state });
    }
    const w = gqWatch[game];
    if (w && Date.now() - w.at < 8000) {
      return res.json({ active: true, source: "ai", seq: "a" + w.seq, name: "Grandmaster", photoUrl: "", state: w.state });
    }
    res.json({ active: false });
  });

  // চ্যালেঞ্জারের ফোন প্রতিটা চালের পর তার খেলার অবস্থা এখানে পাঠায়
  app.post("/gaming/gq/:game/mirror", express.json({ limit: "64kb" }), (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const st = gameQueues[game];
    const { id, state } = req.body || {};
    // শুধু যার পালা চলছে সে-ই পাঠাতে পারে — নইলে যে কেউ overlay-তে যা খুশি আঁকিয়ে দিতে পারত
    if (!st.active || st.active.id !== id) return res.json({ ok: false, reason: "not_your_turn" });
    gqMirror[game] = {
      seq: (gqMirror[game] ? gqMirror[game].seq : 0) + 1,
      name: st.active.name, photoUrl: st.active.photoUrl, state, at: Date.now(),
    };
    res.json({ ok: true });
  });

  // overlay এটা পড়ে চ্যালেঞ্জারের খেলাটা নিজের বোর্ডে এঁকে দেয়
  app.get("/gaming/gq/:game/mirror", (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    const st = gameQueues[game];
    const m = gqMirror[game];
    // কারও পালা চলছে অথচ এখনো প্রথম চাল আসেনি (নিয়ম দেখছে/তৈরি হচ্ছে) — তখনও AI-কে
    // থামিয়ে রাখা হয়, নাহলে দুই সেকেন্ডের জন্য AI-এর খেলা ঝিলিক দিয়ে উঠত
    if (st.active && (!m || m.at < st.active.startedAt)) {
      // active:false মানে overlay এখনো AI-এর খেলাই চালিয়ে যাবে। খেলোয়াড় তখন টিপসের
      // পপআপ, "YOUR TURN" আর নিয়ম দেখছে — ওই সময়টুকু মূল পর্দা স্থির হয়ে বসে থাকত।
      // upNext দিয়ে শুধু জানিয়ে রাখা হয় পরেই কে আসছে।
      return res.json({ active: false, upNext: st.active.name, upNextPhoto: st.active.photoUrl });
    }
    // ৮ সেকেন্ড কোনো খবর না এলে ধরে নেওয়া হয় খেলোয়াড় চলে গেছেন (ইন্টারনেট গেছে/ট্যাব বন্ধ) —
    // তখন overlay নিজে থেকেই AI-এর খেলায় ফিরে যায়, পর্দা জমে থাকে না
    if (!m || Date.now() - m.at > 8000) return res.json({ active: false });
    res.json({ active: true, seq: m.seq, name: m.name, photoUrl: m.photoUrl, state: m.state });
  });

  // overlay এই রুটটা poll করে — কে এখন খেলছে, আর লাইনে কারা আছে
  app.get("/gaming/gq/:game/public", (req, res) => {
    const game = gqValid(req, res); if (!game) return;
    res.json({ nowPlaying: gqPublicActive(game), queue: gqPublicQueue(game), total: gameQueues[game].queue.length });
  });

  app.get("/gaming/vapid-public-key", (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));
  app.post("/gaming/challenge/push-subscribe", express.json(), (req, res) => {
    const { id, subscription } = req.body || {};
    if (id && subscription) pushSubscriptions[id] = subscription;
    res.json({ ok: true });
  });
  app.get("/gaming/sw.js", (req, res) => {
    res.set("Service-Worker-Allowed", "/gaming/");
    res.type("application/javascript").send(SERVICE_WORKER_JS);
  });

  schedulerTick().catch((e) => console.error("❌ schedulerTick এ error:", e));
  setInterval(() => schedulerTick().catch((e) => console.error("❌ schedulerTick এ error:", e)), 60000);

  // ---------- নতুন গেম: Snake ও Ball Sort Puzzle — সিডিউলারের বাইরে, নিজে থেকেই ২৪/৭ চলবে ----------
  app.get("/gaming/overlay/snake", (req, res) => res.type("html").send(SNAKE_OVERLAY_HTML));
  app.get("/gaming/overlay/ballsort", (req, res) => res.type("html").send(BALLSORT_OVERLAY_HTML));
  // ⚠️ Snake আর সার্ভার থেকে চালানো হয় না। আগে সার্ভার প্রতি ১১০ms-এ এক ধাপ হিসেব করে ফাইলে লিখত
  // আর ব্রাউজার প্রতি ১১০ms-এ HTTP দিয়ে সেটা টেনে আনত — Render-এর ফ্রি সার্ভারে প্রতিটা রিকোয়েস্টের
  // দেরি একেকবার একেকরকম হওয়ায় সাপ "আটকে আটকে" চলত। এখন পুরো সাপের ইঞ্জিন ব্রাউজারের ভেতরেই চলে,
  // তাই নেটওয়ার্কের উপর কোনো নির্ভরতা নেই — সাপ একদম মসৃণভাবে, না থেমে চলতে থাকবে।
  // শুধু হাই-স্কোরটা নিচের দুটো রুট দিয়ে সার্ভারে জমা থাকে, যাতে রিফ্রেশ/রিস্টার্টেও হারিয়ে না যায়।
  app.get("/gaming/snake/highscore", (req, res) => {
    res.json({ score: snakeHighScore, name: snakeHighScoreName || "Grandmaster" });
  });
  app.post("/gaming/snake/highscore", express.json(), (req, res) => {
    const s = parseInt((req.body && req.body.score) || 0, 10) || 0;
    // নাম না পাঠালে ধরে নেওয়া হয় overlay-র AI নিজেই খেলেছে, তাই "Grandmaster"।
    // চ্যালেঞ্জ পেজ থেকে এলে দর্শকের নিজের নামটাই যাবে।
    const rawName = ((req.body && req.body.name) || "").toString().trim().slice(0, 24);
    const name = rawName || "Grandmaster";
    let beaten = false;
    if (s > snakeHighScore) {
      snakeHighScore = s;
      snakeHighScoreName = name;
      beaten = true;
      try { writeState("snake-highscore", { score: snakeHighScore, name: snakeHighScoreName }); } catch (e) {}
      if (rawName) console.log(`🐍 নতুন Snake রেকর্ড: ${s} — ${name}`);
    }
    res.json({ score: snakeHighScore, name: snakeHighScoreName, beaten });
  });

  // ---------- Ball Sort: রেকর্ড ও চ্যালেঞ্জ ----------
  app.get("/gaming/ballsort/fastest", (req, res) => {
    res.json({ seconds: bsFastestState.seconds, name: bsFastestState.name || "Grandmaster" });
  });
  app.post("/gaming/ballsort/fastest", express.json(), (req, res) => {
    const sec = parseInt((req.body && req.body.seconds) || 0, 10) || 0;
    const rawName = ((req.body && req.body.name) || "").toString().trim().slice(0, 24);
    const name = rawName || "Grandmaster";
    let beaten = false;
    // ২০ সেকেন্ডের কমে ৮০+ চালের পাজল সমাধান করা মানুষের পক্ষে সম্ভব না — এমন সময় বাদ দেওয়া হয়,
    // যাতে কেউ ইচ্ছে করে ভুয়া রেকর্ড পাঠিয়ে লিডারবোর্ড নষ্ট করতে না পারে
    if (sec >= 20 && (bsFastestState.seconds === null || sec < bsFastestState.seconds)) {
      bsFastestState = { seconds: sec, name };
      beaten = true;
      try { writeState("ballsort-fastest", bsFastestState); } catch (e) {}
      if (rawName) console.log(`🧪 নতুন Ball Sort রেকর্ড: ${sec}s — ${name}`);
    }
    res.json({ seconds: bsFastestState.seconds, name: bsFastestState.name, beaten });
  });
  // চ্যালেঞ্জারের জন্য নতুন পাজল — অবশ্যই সমাধানযোগ্য কিনা যাচাই করেই পাঠানো হয়,
  // নাহলে দর্শক এমন একটা পাজল পেতে পারত যেটা কোনোভাবেই মেলানো সম্ভব না
  app.get("/gaming/ballsort/new-challenge", async (req, res) => {
    try {
      let tubes = null;
      for (let i = 0; i < 25; i++) {
        const cand = bsGeneratePuzzle();
        if (await bsSolve(cand)) { tubes = cand; break; }
      }
      if (!tubes) return res.status(503).json({ error: "puzzle_unavailable" });
      res.json({ tubes, colors: BS_COLORS, capacity: BS_TUBE_CAPACITY });
    } catch (e) {
      res.status(500).json({ error: "server_error" });
    }
  });

  // ---------- চ্যালেঞ্জ পেজ ----------
  app.get("/gaming/challenge/snake", (req, res) => res.type("html").send(SNAKE_CHALLENGE_HTML));
  app.get("/gaming/challenge/ballsort", (req, res) => res.type("html").send(BALLSORT_CHALLENGE_HTML));
  runBallSortLoop().catch((e) => console.error("❌ Ball Sort loop-এ error:", e));

  console.log("✅ gaming.js mount হয়েছে — build:", GAMING_BUILD);
  console.log("   রুট সংখ্যা:", listGamingRoutes().length, "| codelive আছে:", listGamingRoutes().some(r => r.includes("/gaming/overlay/codelive")));
  console.log("   কোন সংস্করণ চলছে দেখতে: /gaming/health");
  } catch (e) {
    // এখানে পৌঁছানো মানে mount-এর মাঝপথে কিছু ভেঙেছে। যেসব রুট ইতিমধ্যে রেজিস্টার হয়ে গেছে
    // সেগুলো কিন্তু বেঁচে থাকে — তাই পুরো সাইট মরে না, আর /gaming/health খুললেই আসল কারণ দেখা যায়।
    mountError = e;
    console.error("❌ gaming.js mount আংশিকভাবে ব্যর্থ:", e.message);
    console.error(e.stack);
    console.error("   বিস্তারিত দেখতে: /gaming/health");
  }
};

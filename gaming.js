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
//   - /gaming/overlay/chess ও /gaming/overlay/sports রুট চালু করে (HTML এই
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
    sportsgaming: { youtubeChannelId: "PUT_YOUR_SPORTS_CHANNEL_ID_HERE" },
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
    {
      id: "midday-sports",
      channel: "sportsgaming",
      days: [0, 1, 2, 3, 4, 5, 6],
      start: "00:00",
      end: "23:59",
      game: "sports",
      title: "🏆 LIVE Score Update | সবচেয়ে বড় ম্যাচ",
      description: "লাইভ স্কোর আপডেট — নিজস্ব অ্যানিমেটেড স্কোরবোর্ডে।\n\n#cricket #football #livescore",
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
const CRICAPI_KEY = process.env.CRICAPI_KEY || "0640b807-8962-4662-b00b-cd0c6f42a437";
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY || "6de99c89e60241018c28622a9e441c9f";

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
        body: `${q.name}, এখন আপনিই লাইনে সবার আগে — এখনই তৈরি হয়ে যান, চলতি ম্যাচ শেষ হলেই আপনার সুযোগ!`,
        tag: "queue-ring",
        requireInteraction: true,
        ring: true,
        url: "/gaming/challenge/status?id=" + q.id,
      });
    } else if (position === 3) {
      // মানে তার আগে মাত্র ২ জন বাকি — বড় এলার্ম-স্টাইল নোটিফিকেশন
      sendPushToId(q.id, {
        title: "🔔 প্রায় আপনার পালা!",
        body: `${q.name}, আপনার আগে মাত্র ২ জন বাকি — এখনই তৈরি হয়ে যান!`,
        tag: "queue-alert",
        requireInteraction: true,
        url: "/gaming/challenge/status?id=" + q.id,
      });
    } else {
      sendPushToId(q.id, {
        title: "🔢 লাইনের অবস্থান আপডেট",
        body: `${q.name}, আপনি এখন #${position} নম্বরে আছেন`,
        tag: "queue-position",
        requireInteraction: false,
        url: "/gaming/challenge/status?id=" + q.id,
      });
    }
  });
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
// ৫. স্পোর্টস — CricAPI + football-data.org
// ---------------------------------------------------------------------------
let sportsTrackerInterval = null;

async function findLiveCricketMatch() {
  const key = CRICAPI_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${key}&offset=0`);
  const json = await res.json();
  const matches = (json.data || []).filter((m) => m.matchStarted && !m.matchEnded);
  if (matches.length === 0) return null;
  const m = matches[0];
  return {
    sport: "cricket",
    sportEmoji: "🏏",
    matchId: m.id,
    teamA: m.teams?.[0] || "Team A",
    teamB: m.teams?.[1] || "Team B",
    competition: m.name || "লাইভ ক্রিকেট ম্যাচ",
  };
}
async function findLiveFootballMatch() {
  const key = FOOTBALL_DATA_KEY;
  if (!key) return null;
  const res = await fetch("https://api.football-data.org/v4/matches?status=LIVE", {
    headers: { "X-Auth-Token": key },
  });
  const json = await res.json();
  const matches = json.matches || [];
  if (matches.length === 0) return null;
  const m = matches[0];
  return {
    sport: "football",
    sportEmoji: "⚽",
    matchId: m.id,
    teamA: m.homeTeam?.shortName || "Team A",
    teamB: m.awayTeam?.shortName || "Team B",
    competition: m.competition?.name || "লাইভ ফুটবল ম্যাচ",
  };
}
async function fetchCricketScore(matchId) {
  const key = CRICAPI_KEY;
  const res = await fetch(`https://api.cricapi.com/v1/match_info?apikey=${key}&id=${matchId}`);
  const json = await res.json();
  const d = json.data;
  if (!d) return null;
  return {
    matchEnded: !!d.matchEnded,
    scores: (d.score || []).map((s) => ({ runs: s.r, wickets: s.w, overs: s.o })),
  };
}

// ব্যাটসম্যান/বোলারের বিস্তারিত (রান, বল, স্ট্রাইক রেট, ওভার, ইকোনমি) — CricAPI-র সংস্করণভেদে
// field-এর নাম আলাদা হতে পারে, তাই একাধিক সম্ভাব্য key চেষ্টা করা হয়। এই কল fail করলে বা
// কোনো ডেটা না মিললে শুধু null রিটার্ন করে — বাকি scoreboard-এ কোনো প্রভাব পড়ে না।
async function fetchCricketScorecard(matchId) {
  try {
    const key = CRICAPI_KEY;
    const res = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${key}&id=${matchId}`);
    const json = await res.json();
    const d = json.data;
    if (!d || !d.scorecard || !d.scorecard.length) return null;
    const inn = d.scorecard[d.scorecard.length - 1];

    const battingList = inn.batting || inn.batsmen || [];
    const allBatters = battingList.map((b) => {
      const dis = b.dismissal || b["dismissal-text"] || b.dismissal_text || "";
      const isOut = dis && !dis.toLowerCase().includes("not out") && !dis.toLowerCase().includes("batting");
      return {
        name: b.name || b.batsman?.name || "—",
        runs: b.r ?? b.runs ?? 0,
        balls: b.b ?? b.balls ?? 0,
        sr: b.sr ?? (b.b || b.balls ? (((b.r ?? b.runs ?? 0) / (b.b || b.balls)) * 100).toFixed(1) : "0"),
        out: isOut,
      };
    });
    // এখনো ব্যাট করছে এমন (২ জনের বেশি না, top-এ), বাকিরা "আউট হওয়া" তালিকায়
    const notOut = allBatters.filter((b) => !b.out).slice(0, 2);
    const outBatters = allBatters.filter((b) => b.out);

    const bowlingList = inn.bowling || inn.bowlers || [];
    const allBowlers = bowlingList.map((bw) => ({
      name: bw.name || bw.bowler?.name || "—",
      overs: bw.o ?? bw.overs ?? 0,
      runs: bw.r ?? bw.runs ?? 0,
      wickets: bw.w ?? bw.wickets ?? 0,
      economy: bw.eco ?? bw.economy ?? "-",
    }));
    const currentBowler = allBowlers[allBowlers.length - 1] || null;

    return { batters: notOut, outBatters, bowler: currentBowler, allBowlers };
  } catch (e) {
    return null; // scorecard না পেলেও মূল স্কোরবোর্ড ঠিকই কাজ করবে
  }
}
async function fetchFootballScore(matchId) {
  const key = FOOTBALL_DATA_KEY;
  const res = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, {
    headers: { "X-Auth-Token": key },
  });
  const m = await res.json();
  return { minute: m.minute, homeGoals: m.score?.fullTime?.home ?? 0, awayGoals: m.score?.fullTime?.away ?? 0 };
}

// দেশ/টিমের নাম থেকে flag emoji বের করার হেল্পার — "Tanzania Women", "India U19" ইত্যাদি
// suffix বাদ দিয়ে মূল দেশের নাম মিলিয়ে flag emoji রিটার্ন করে। না মিললে খালি স্ট্রিং (কোনো flag দেখাবে না)।
const COUNTRY_FLAGS = {
  india: "🇮🇳", australia: "🇦🇺", england: "🏴", pakistan: "🇵🇰", "sri lanka": "🇱🇰",
  bangladesh: "🇧🇩", "new zealand": "🇳🇿", "south africa": "🇿🇦", "west indies": "🏴",
  afghanistan: "🇦🇫", zimbabwe: "🇿🇼", ireland: "🇮🇪", scotland: "🏴", netherlands: "🇳🇱",
  nepal: "🇳🇵", uae: "🇦🇪", oman: "🇴🇲", usa: "🇺🇸", canada: "🇨🇦", namibia: "🇳🇦",
  uganda: "🇺🇬", tanzania: "🇹🇿", kenya: "🇰🇪", rwanda: "🇷🇼", nigeria: "🇳🇬",
};
function getFlagEmoji(teamName) {
  if (!teamName) return "";
  const cleaned = teamName.toLowerCase().replace(/\b(women|men|u-?19|u-?23|xi|a team|emerging)\b/g, "").trim();
  return COUNTRY_FLAGS[cleaned] || "";
}

async function startSportsTracking() {
  if (sportsTrackerInterval) clearInterval(sportsTrackerInterval);

  const [cricket, football] = await Promise.all([findLiveCricketMatch().catch(() => null), findLiveFootballMatch().catch(() => null)]);
  const context = cricket || football || {
    sport: null,
    sportEmoji: "📺",
    teamA: "কোনো",
    teamB: "লাইভ ম্যাচ নেই",
    competition: "এই মুহূর্তে কোনো বড় ম্যাচ চলছে না",
  };
  context.flagA = getFlagEmoji(context.teamA);
  context.flagB = getFlagEmoji(context.teamB);
  writeState("sports", { ...context, score: null });
  if (!context.matchId) return;

  let prevScore = null;
  const fetchAndUpdate = async () => {
    try {
      const score = context.sport === "cricket" ? await fetchCricketScore(context.matchId) : await fetchFootballScore(context.matchId);
      if (!score) return;

      // ম্যাচ শেষ হয়ে গেলে — এই ট্র্যাকার বন্ধ করে নতুন লাইভ ম্যাচ খোঁজা শুরু করা,
      // যাতে স্কোরবোর্ড কখনো "আটকে" থেকে না যায়
      if (context.sport === "cricket" && score.matchEnded) {
        console.log(`[sportsgaming] ম্যাচ শেষ হয়ে গেছে (${context.teamA} vs ${context.teamB}) — নতুন ম্যাচ খোঁজা হচ্ছে...`);
        clearInterval(sportsTrackerInterval);
        startSportsTracking(); // পুনরায় শুরু, নতুন ম্যাচ detect করবে
        return;
      }

      let event = null;
      if (context.sport === "cricket" && prevScore) {
        const p = prevScore.scores?.[prevScore.scores.length - 1];
        const n = score.scores?.[score.scores.length - 1];
        if (p && n) {
          if (n.wickets > p.wickets) event = { type: "wicket", textBn: "উইকেট পড়ল! বড় ধাক্কা।" };
          else if (n.runs - p.runs === 6) event = { type: "six", textBn: "ছক্কা! বল সীমানার বাইরে।" };
          else if (n.runs - p.runs === 4) event = { type: "four", textBn: "চার! দারুণ শট।" };
        }
      } else if (context.sport === "football" && prevScore) {
        if (score.homeGoals + score.awayGoals > prevScore.homeGoals + prevScore.awayGoals) {
          event = { type: "goal", textBn: "গোওল!! দুর্দান্ত ফিনিশ।" };
        }
      }
      const state = { ...context, score, updatedAt: Date.now() };
      if (context.sport === "cricket") {
        const scorecard = await fetchCricketScorecard(context.matchId);
        if (scorecard) {
          state.batters = scorecard.batters;
          state.outBatters = scorecard.outBatters;
          state.bowler = scorecard.bowler;
          state.allBowlers = scorecard.allBowlers;
        }
      }
      if (event) {
        try {
          event.audioUrl = await textToSpeech(event.textBn);
          event.at = Date.now();
          state.lastEvent = event;
        } catch (e) {
          console.error("event TTS সমস্যা:", e.message);
        }
      }
      writeState("sports", state);
      prevScore = score;
    } catch (e) {
      console.error("sports fetch সমস্যা:", e.message);
    }
  };

  await fetchAndUpdate(); // প্রথম স্কোর সাথে সাথেই আনা হয় — ৩ মিনিট অপেক্ষা করতে হয় না
  sportsTrackerInterval = setInterval(fetchAndUpdate, 180000); // এরপর থেকে প্রতি ৩ মিনিটে একবার (ফ্রি API সীমা বাঁচাতে)
}
function stopSportsTracking() {
  if (sportsTrackerInterval) clearInterval(sportsTrackerInterval);
  sportsTrackerInterval = null;
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

const SPORTS_OVERLAY_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>Sports</title>
<style>
*{box-sizing:border-box;}
body{margin:0;background:linear-gradient(160deg,#0a0e1f 0%,#0d1a12 60%,#0a0e1f 100%);color:#F5F7FA;font-family:'Segoe UI',sans-serif;min-height:100vh;padding:0 0 24px;}
.scorebar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:20px 32px;
background:#12182b;border-bottom:3px solid #FFD866;box-shadow:0 6px 20px rgba(0,0,0,0.6);}
.teamBlock{display:flex;align-items:center;gap:12px;}
.teamBlock.right{justify-content:flex-end;}
.flagBig{font-size:34px;}
.team{font-size:24px;font-weight:800;color:#fff;}
.score{font-family:'Consolas',monospace;font-size:42px;color:#FFD866;font-weight:800;}
.mid{text-align:center;font-size:14px;color:#7C8AAD;padding:0 24px;}
.competition{text-align:center;padding:10px;color:#7C8AAD;font-size:15px;background:#0d1220;font-weight:600;}

.mainGrid{display:grid;grid-template-columns:280px 1fr 280px;gap:22px;max-width:1360px;margin:22px auto 0;padding:0 22px;}
.statCard{background:#131a2c;border:1px solid #26314f;border-radius:16px;padding:18px;
box-shadow:0 12px 28px rgba(0,0,0,0.55);}
.statCard h3{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#FFD866;font-weight:800;}
.batterRow{display:flex;justify-content:space-between;align-items:center;padding:9px 0;
border-bottom:1px solid #202a44;}
.batterRow:last-child{border-bottom:none;}
.batterRow.out{opacity:0.45;}
.batterName{font-size:14px;font-weight:700;color:#fff;}
.batterFigs{font-family:monospace;color:#4FC3F7;font-size:15px;text-align:right;font-weight:700;}
.batterSR{color:#7C8AAD;font-size:10px;}
.bowlerBox{text-align:center;padding:8px 0;border-bottom:1px solid #202a44;}
.bowlerBox:last-child{border-bottom:none;}
.bowlerBox.current{background:rgba(255,216,102,0.08);border-radius:8px;}
.bowlerName{font-size:15px;font-weight:700;color:#fff;}
.bowlerFigs{font-family:monospace;color:#4FC3F7;font-size:20px;margin-top:4px;font-weight:800;}
.bowlerEco{color:#7C8AAD;font-size:11px;margin-top:2px;}

.videoSlot{width:100%;max-width:640px;margin:0 auto 14px;height:120px;border:2px dashed #26314f;border-radius:12px;
display:flex;align-items:center;justify-content:center;color:#4a5578;font-size:13px;text-align:center;padding:10px;}

.groundWrap{display:flex;justify-content:center;}
.ground{position:relative;width:100%;max-width:640px;height:400px;
background:radial-gradient(ellipse at 50% 45%,#2f8a44 0%,#1d5c2e 55%,#0f2e17 100%);
border-radius:50%;box-shadow:0 20px 50px rgba(0,0,0,0.65), inset 0 0 60px rgba(0,0,0,0.4);
border:4px solid #1a2338;}
.pitchStrip{position:absolute;left:50%;top:32%;transform:translateX(-50%);width:52px;height:36%;
background:linear-gradient(180deg,#e0cd9a,#c8b077);border-radius:3px;box-shadow:0 4px 10px rgba(0,0,0,0.5);}
.fielder{position:absolute;width:16px;height:16px;border-radius:50%;background:#4FC3F7;
box-shadow:0 3px 4px rgba(0,0,0,0.5);transform:translate(-50%,-50%);}
.fielder::after{content:"";position:absolute;left:50%;top:110%;width:14px;height:5px;
background:rgba(0,0,0,0.4);border-radius:50%;transform:translateX(-50%);}
.player{position:absolute;transition:left 0.6s ease, top 0.6s ease;transform:translate(-50%,-50%);}
.player svg{overflow:visible;filter:drop-shadow(0 6px 4px rgba(0,0,0,0.5));}
.playerShadow{position:absolute;width:26px;height:8px;background:rgba(0,0,0,0.4);border-radius:50%;
left:50%;bottom:-4px;transform:translateX(-50%);filter:blur(1px);}
#bowler{left:50%;top:70%;}
#striker{left:50%;top:30%;}

@keyframes bowlArm{0%{transform:rotate(-40deg);}55%{transform:rotate(-40deg);}75%{transform:rotate(120deg);}100%{transform:rotate(160deg);}}
.anim-bowl .arm{animation:bowlArm 0.6s ease-out forwards;transform-origin:0px -12px;}
@keyframes batSwing{0%,40%{transform:rotate(70deg);}60%{transform:rotate(70deg);}78%{transform:rotate(-35deg);}100%{transform:rotate(-55deg);}}
.anim-bat .bat{animation:batSwing 0.7s ease-out forwards;transform-origin:2px -2px;}

.ball{position:absolute;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 6px rgba(255,255,255,0.9);
left:50%;top:66%;opacity:0;}
@keyframes flyBall{0%{left:50%;top:66%;opacity:0;}10%{opacity:1;}50%{left:50%;top:48%;}100%{left:50%;top:32%;opacity:1;}}
.ball.fly{animation:flyBall 0.7s cubic-bezier(.4,0,.2,1) forwards;}

.recentBalls{display:flex;gap:7px;justify-content:center;margin-top:16px;flex-wrap:wrap;max-width:640px;margin-left:auto;margin-right:auto;}
.ballChip{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;
font-size:13px;font-weight:800;background:#1c2a42;color:#7C8AAD;border:1px solid #26314f;}
.ballChip.four{background:#4FC3F7;color:#0a0e1f;}
.ballChip.six{background:#FFD866;color:#0a0e1f;}
.ballChip.wicket{background:#E5484D;color:#fff;}

.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);
font-size:96px;font-weight:900;opacity:0;pointer-events:none;}
.flash.show{animation:pop 1.6s ease-out forwards;}
@keyframes pop{0%{opacity:0;transform:scale(.5) rotate(-8deg);}25%{opacity:1;transform:scale(1.1) rotate(2deg);}
55%{transform:scale(1) rotate(0);}100%{opacity:0;}}
</style></head><body>
<div class="scorebar">
  <div class="teamBlock"><span class="flagBig" id="flagA"></span><span class="team" id="teamA">—</span></div>
  <div class="mid"><div style="font-size:18px;" id="sportEmoji">🏆</div><div class="score" id="scoreA">-</div></div>
  <div class="teamBlock right"><span class="team" id="teamB">—</span><span class="flagBig" id="flagB"></span></div>
</div>
<div class="scorebar" style="grid-template-columns:1fr;padding:6px;">
<div class="score" id="scoreB" style="text-align:center;font-size:22px;">-</div></div>
<div class="competition" id="competition">লাইভ ম্যাচ খোঁজা হচ্ছে...</div>

<div class="mainGrid">
  <div class="statCard" id="battingCard">
    <h3>🏏 BATTING</h3>
    <div id="battersList"><div style="color:#5a6a8a;font-size:13px;">তথ্য আসছে...</div></div>
  </div>

  <div>
    <!-- এখানে চাইলে মাঠের real ভিডিও/ফুটেজ embed করা যাবে (iframe/video ট্যাগ বসিয়ে) —
         নিজস্ব কনটেন্ট ছাড়া real broadcast embed করলে কপিরাইট সমস্যা হতে পারে, তাই এই
         জায়গাটা ইচ্ছাকৃতভাবে খালি/placeholder রাখা হলো, আপনি নিজের পছন্দমতো ভরে দিতে পারবেন -->
    <div class="videoSlot">🎥 এখানে চাইলে নিজস্ব ভিডিও/ইমেজ embed করা যাবে (video/iframe ট্যাগ)</div>
    <div class="groundWrap"><div class="ground" id="pitch">
      <div class="pitchStrip"></div>
      <div class="fielder" style="left:50%;top:38%;" title="উইকেটকিপার"></div>
      <div class="fielder" style="left:44%;top:36%;" title="স্লিপ"></div>
      <div class="fielder" style="left:30%;top:45%;" title="কভার"></div>
      <div class="fielder" style="left:22%;top:60%;" title="পয়েন্ট"></div>
      <div class="fielder" style="left:28%;top:78%;" title="মিড-উইকেট"></div>
      <div class="fielder" style="left:42%;top:88%;" title="মিড-অন"></div>
      <div class="fielder" style="left:58%;top:88%;" title="মিড-অফ"></div>
      <div class="fielder" style="left:72%;top:78%;" title="কভার পয়েন্ট"></div>
      <div class="fielder" style="left:78%;top:60%;" title="থার্ড ম্যান"></div>
      <div class="fielder" style="left:70%;top:45%;" title="গালি"></div>
      <div class="fielder" style="left:56%;top:36%;" title="ফাইন লেগ"></div>
      <div class="player" id="bowler">
        <div class="playerShadow"></div>
        <svg width="46" height="60" viewBox="-20 -20 40 60">
          <g><line x1="0" y1="20" x2="-5" y2="34" stroke="#E8B48A" stroke-width="3" stroke-linecap="round"/>
          <line x1="0" y1="20" x2="5" y2="34" stroke="#E8B48A" stroke-width="3" stroke-linecap="round"/>
          <rect x="-5" y="4" width="10" height="17" rx="3" fill="#4FC3F7"/>
          <g transform="translate(0,8)"><line class="arm" x1="0" y1="0" x2="12" y2="-6" stroke="#E8B48A" stroke-width="3" stroke-linecap="round"/></g>
          <circle cx="0" cy="-3" r="5.5" fill="#E8B48A"/></g>
        </svg>
        <div style="font-size:10px;color:#fff;background:rgba(0,0,0,0.5);border-radius:3px;padding:1px 4px;margin-top:2px;">বোলার</div>
      </div>
      <div class="player" id="striker">
        <div class="playerShadow"></div>
        <svg width="46" height="60" viewBox="-20 -20 40 60">
          <g><line x1="0" y1="20" x2="-4" y2="34" stroke="#E8B48A" stroke-width="3" stroke-linecap="round"/>
          <line x1="0" y1="20" x2="4" y2="34" stroke="#E8B48A" stroke-width="3" stroke-linecap="round"/>
          <rect x="-5" y="4" width="10" height="17" rx="3" fill="#FFD866"/>
          <line x1="0" y1="8" x2="-8" y2="18" stroke="#E8B48A" stroke-width="3" stroke-linecap="round"/>
          <g transform="translate(0,8)"><line x1="0" y1="0" x2="9" y2="-14" stroke="#E8B48A" stroke-width="3" stroke-linecap="round"/></g>
          <g transform="translate(9,-6)"><rect class="bat" x="-1.5" y="0" width="3" height="16" rx="1.5" fill="#D8B26A"/></g>
          <circle cx="0" cy="-3" r="5.5" fill="#E8B48A"/></g>
        </svg>
        <div style="font-size:10px;color:#fff;background:rgba(0,0,0,0.5);border-radius:3px;padding:1px 4px;margin-top:2px;">ব্যাটসম্যান</div>
      </div>
      <div class="ball" id="ball"></div>
    </div></div>
    <div class="recentBalls" id="recentBalls"></div>
  </div>

  <div class="statCard" id="bowlingCard">
    <h3>⚾ BOWLING</h3>
    <div id="bowlersList"><div style="color:#5a6a8a;font-size:13px;">তথ্য আসছে...</div></div>
  </div>
</div>

<div class="flash" id="flash"></div><audio id="narrator" autoplay></audio>
<button id="soundBtn" style="position:fixed;top:12px;right:12px;background:#FFD866;border:none;
border-radius:6px;padding:9px 16px;font-size:13px;cursor:pointer;font-weight:700;z-index:50;">🔊 সাউন্ড ও মাঠের আবহ চালু করুন</button>
<script>
let audioCtx = null, crowdNode = null;
// মাঠের হালকা আবহ-শব্দ (crowd murmur) — ফিল্টার করা white noise দিয়ে generate,
// কোনো কপিরাইটেড অডিও ফাইল লাগে না, সম্পূর্ণ ব্রাউজারে তৈরি
function startCrowdAmbience() {
  if (crowdNode) return;
  const bufferSize = 2 * audioCtx.sampleRate;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer; noise.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass"; filter.frequency.value = 700; filter.Q.value = 0.6;
  const gain = audioCtx.createGain(); gain.gain.value = 0.025;
  noise.connect(filter).connect(gain).connect(audioCtx.destination);
  noise.start();
  crowdNode = { noise, gain };
}
document.getElementById("soundBtn").addEventListener("click",()=>{
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  const a=document.getElementById("narrator"); a.play().catch(()=>{});
  startCrowdAmbience();
  document.getElementById("soundBtn").style.display="none";
});
let lastEventAt=0;const audioEl=document.getElementById("narrator");const flashEl=document.getElementById("flash");
const FLASH={wicket:{t:"OUT!",c:"#E5484D"},six:{t:"SIX!",c:"#FFD866"},four:{t:"FOUR!",c:"#4FC3F7"},goal:{t:"GOAL!",c:"#2ECC71"}};
function showFlash(type){const cfg=FLASH[type];if(!cfg)return;flashEl.textContent=cfg.t;flashEl.style.color=cfg.c;
flashEl.classList.remove("show");void flashEl.offsetWidth;flashEl.classList.add("show");}

function playBallAnimation() {
  const bowlerEl = document.getElementById("bowler");
  const strikerEl = document.getElementById("striker");
  const ballEl = document.getElementById("ball");
  bowlerEl.classList.remove("anim-bowl"); void bowlerEl.offsetWidth; bowlerEl.classList.add("anim-bowl");
  strikerEl.classList.remove("anim-bat"); void strikerEl.offsetWidth; strikerEl.classList.add("anim-bat");
  ballEl.classList.remove("fly"); void ballEl.offsetWidth; ballEl.classList.add("fly");
}

function renderBatters(notOut, out) {
  const el = document.getElementById("battersList");
  const all = [...(notOut||[]), ...((out||[]).slice(0,4))];
  if (!all.length) { el.innerHTML = '<div style="color:#5a6a8a;font-size:13px;">তথ্য পাওয়া যায়নি</div>'; return; }
  el.innerHTML = all.map(b =>
    '<div class="batterRow'+(b.out?" out":"")+'"><div class="batterName">'+b.name+(b.out?" (out)":" *")+'</div>' +
    '<div><div class="batterFigs">'+b.runs+'('+b.balls+')</div><div class="batterSR">SR '+b.sr+'</div></div></div>'
  ).join("");
}
function renderBowlers(allBowlers) {
  const el = document.getElementById("bowlersList");
  if (!allBowlers || !allBowlers.length) { el.innerHTML = '<div style="color:#5a6a8a;font-size:13px;">তথ্য পাওয়া যায়নি</div>'; return; }
  const list = allBowlers.slice(-4).reverse();
  el.innerHTML = list.map((bw,i) =>
    '<div class="bowlerBox'+(i===0?" current":"")+'"><div class="bowlerName">'+bw.name+'</div>' +
    '<div class="bowlerFigs">'+bw.wickets+'-'+bw.runs+'</div>' +
    '<div class="bowlerEco">'+bw.overs+' ov · Eco '+bw.economy+'</div></div>'
  ).join("");
}

let lastScoreSnapshot = "";
async function poll(){try{
  const res=await fetch("/gaming/state/sports.json?t="+Date.now());const data=await res.json();
  document.getElementById("sportEmoji").textContent=data.sportEmoji||"🏆";
  document.getElementById("teamA").textContent=data.teamA||"—";
  document.getElementById("teamB").textContent=data.teamB||"—";
  document.getElementById("flagA").textContent=data.flagA||"";
  document.getElementById("flagB").textContent=data.flagB||"";
  document.getElementById("competition").textContent=data.competition||"";
  document.getElementById("pitch").style.display = data.sport === "cricket" ? "block" : "none";
  document.getElementById("battingCard").style.display = data.sport === "cricket" ? "block" : "none";
  document.getElementById("bowlingCard").style.display = data.sport === "cricket" ? "block" : "none";

  let scoreSnapshot = "";
  if(data.sport==="cricket"&&data.score&&data.score.scores&&data.score.scores.length){
    const inn=data.score.scores[data.score.scores.length-1];
    document.getElementById("scoreA").textContent=inn.runs+"/"+inn.wickets;
    document.getElementById("scoreB").textContent="("+inn.overs+" ov)";
    scoreSnapshot = inn.runs+"-"+inn.wickets+"-"+inn.overs;
  }else if(data.sport==="football"&&data.score){
    document.getElementById("scoreA").textContent=data.score.homeGoals+" - "+data.score.awayGoals;
    document.getElementById("scoreB").textContent=data.score.minute?(data.score.minute+"'"):"";
  }
  renderBatters(data.batters, data.outBatters);
  renderBowlers(data.allBowlers);

  if (scoreSnapshot && lastScoreSnapshot && scoreSnapshot !== lastScoreSnapshot) {
    playBallAnimation();
  }
  lastScoreSnapshot = scoreSnapshot || lastScoreSnapshot;

  if(data.lastEvent&&data.lastEvent.at!==lastEventAt){
    lastEventAt=data.lastEvent.at;showFlash(data.lastEvent.type);
    playBallAnimation();
    const chip = document.createElement("div");
    chip.className = "ballChip " + data.lastEvent.type;
    chip.textContent = data.lastEvent.type === "six" ? "6" : data.lastEvent.type === "four" ? "4" : data.lastEvent.type === "wicket" ? "W" : "•";
    const rb = document.getElementById("recentBalls");
    rb.appendChild(chip);
    while (rb.children.length > 12) rb.removeChild(rb.firstChild);
    if(data.lastEvent.audioUrl){audioEl.src=data.lastEvent.audioUrl;audioEl.play().catch(()=>{});}
  }
}catch(e){}}
setInterval(poll,3000);poll();
</script></body></html>`;

// ---------------------------------------------------------------------------
// ৭. Scheduler — প্রতি মিনিটে চেক করে কোন block এখন active
// ---------------------------------------------------------------------------
let activeBlockId = { boardgames: null, sportsgaming: null };

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
    if (channelKey === "sportsgaming") stopSportsTracking();
    activeBlockId[channelKey] = blockId;

    if (block) {
      console.log(`[${channelKey}] ব্লক শুরু: ${block.id} (${block.game})`);
      if (block.game === "chess") runChessLoop();
      else if (block.game === "sports") startSportsTracking();
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

const CHALLENGE_JOIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Challenge Nur</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;background:#0a0e1f;color:#F5F7FA;font-family:sans-serif;padding:24px;max-width:460px;margin:0 auto;}
h1{font-size:22px;text-align:center;color:#FFD866;}
label{display:block;margin-top:16px;font-size:13px;color:#7C8AAD;}
input[type=text],input[type=number]{width:100%;padding:12px;border-radius:8px;border:1px solid #26314f;background:#131a2c;color:#fff;font-size:15px;margin-top:6px;}
input[type=file]{margin-top:8px;color:#7C8AAD;}
.tipBox{background:#131a2c;border:1px solid #26314f;border-radius:12px;padding:16px;margin-top:20px;font-size:13px;color:#B8C4D9;text-align:center;}
.tipBox a{color:#FFD866;font-weight:700;}
.tipBox img{width:150px;height:150px;border-radius:10px;margin:12px auto;display:block;background:#fff;padding:6px;}
.disclaimer{font-size:11px;color:#5a6a8a;margin-top:10px;line-height:1.5;text-align:left;background:#0f1526;border-radius:8px;padding:10px;}
button{width:100%;padding:14px;border-radius:10px;border:none;background:#FFD866;color:#0a0e1f;font-weight:800;
font-size:16px;margin-top:20px;cursor:pointer;}
</style></head><body>
<h1>♟️ Challenge Nur — Live!</h1>
<p style="text-align:center;color:#7C8AAD;font-size:14px;">Enter your name and photo to join the queue — when it's your turn, you'll play live on the board.</p>
<form id="joinForm" enctype="multipart/form-data">
  <label>Your name</label>
  <input type="text" name="name" required maxlength="30" placeholder="e.g. Alex">
  <label>Your photo (optional)</label>
  <input type="file" name="photo" accept="image/*">
  <div class="tipBox" id="tipBox" style="display:none;">
    <b>You can support/tip if you'd like</b>
    <img id="tipQr" src="" alt="Scan to tip">
    <div>Scan the QR or click <a id="tipLink" href="#" target="_blank">this link</a></div>
    <label style="text-align:left;">If you tipped, enter the amount (optional)</label>
    <input type="number" name="tipAmount" min="0" step="1" placeholder="e.g. 50">
    <div class="disclaimer">
      ⚠️ This tip is completely voluntary — <b>it has nothing to do with playing the game, you can play without tipping.</b>
      This is not a tournament fee, entry fee, or gambling. The amount above is only shown next to your name on screen — you type it in yourself, it is not automatically verified as a real payment.
    </div>
  </div>
  <button type="submit">Join queue (Skip & Play)</button>
</form>
<script>
fetch("/gaming/challenge/tip-info").then(r=>r.json()).then(d=>{
  if (d.tipUrl) {
    document.getElementById("tipLink").href = d.tipUrl;
    document.getElementById("tipQr").src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(d.tipUrl);
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
</script></body></html>`;

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
let selectedVoice = null;
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
#ytWrap{margin-top:10px;}
#ytFrame{width:100%;max-width:400px;aspect-ratio:16/9;border-radius:10px;}
.ytNote{color:#5a6a8a;font-size:10px;margin-top:6px;}
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
<div id="ytWrap">
  <iframe id="ytFrame" src="https://www.youtube.com/embed/live_stream?channel=UCVP5_uwrKIp7rfMNgolnEqA&autoplay=1&mute=1"
    frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
  <div class="ytNote">🔴 What you see live may lag a few seconds behind (streaming delay)</div>
</div>
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
let snakeHighScore = (readState("snake-highscore") || {}).score || 0;

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
  writeState("snake", { ...game, highScore: snakeHighScore, status: "playing" });
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
        writeState("snake", { ...game, highScore: snakeHighScore, status: "gameover" });
        if (game.score > snakeHighScore) { snakeHighScore = game.score; writeState("snake-highscore", { score: snakeHighScore }); }
        await sleep(2500);
        game = snakeNewGame();
        writeState("snake", { ...game, highScore: snakeHighScore, status: "playing" });
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
    writeState("snake", { ...game, highScore: snakeHighScore, status: "playing" });
    await sleep(220); // চালের গতি — একটু ধীর করা হলো, মানুষ খেলছে এমন অনুভূতি (client-side smooth interpolation-এর সাথে মিলিয়ে)
  }
}

// ---------------------------------------------------------------------------
// ৭.৬ — BALL SORT PUZZLE — AI নিজেই সমাধান করে দেখায়, শেষ হলে নতুন পাজল
// ---------------------------------------------------------------------------
const BS_TUBE_COUNT = 13, BS_TUBE_CAPACITY = 4, BS_COLOR_COUNT = 11; // ১১টা রঙ, ২টা খালি টিউব
const BS_COLORS = ["#E8443D", "#4FC3F7", "#FFD866", "#8BE28B", "#B084F5", "#FF8FCF", "#FFA94D",
  "#4AD9C0", "#C9D3E0", "#8A5A2A", "#5C6BFF"]; // মোট ১১টা রঙ, প্রতিটা BS_COLOR_COUNT-এর সাথে মিলে

function bsGeneratePuzzle() {
  // সমাধানযোগ্যতা নিশ্চিত করতে সমাধান করা অবস্থা থেকে উল্টো দিকে র‍্যান্ডম বৈধ চাল চালিয়ে "শাফল" করা হচ্ছে
  let tubes = [];
  for (let i = 0; i < BS_COLOR_COUNT; i++) tubes.push(new Array(BS_TUBE_CAPACITY).fill(i));
  tubes.push([]); tubes.push([]); // ২টা খালি টিউব
  for (let shuffle = 0; shuffle < 220; shuffle++) {
    const from = Math.floor(Math.random() * tubes.length);
    const to = Math.floor(Math.random() * tubes.length);
    if (from === to || !tubes[from].length || tubes[to].length >= BS_TUBE_CAPACITY) continue;
    tubes[to].push(tubes[from].pop());
  }
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
// BFS দিয়ে solve — বড় পাজলে (১৫টা টিউব) state space অনেক বড় হতে পারে, তাই প্রতি কয়েক হাজার
// ধাপে একবার event loop-কে "শ্বাস" নেওয়ার সুযোগ দেওয়া হচ্ছে (await sleep(0)) — নাহলে এই solve
// চলাকালীন পুরো সার্ভার (chess সহ সবকিছু) কিছুক্ষণের জন্য জমে/আটকে যেতে পারত, যেটা মেনে নেওয়া যায় না
async function bsSolve(tubes) {
  const startKey = bsKey(tubes);
  const q = [tubes];
  const visited = new Set([startKey]);
  const parent = {}; // key -> { fromKey, move: {from,to} }
  parent[startKey] = null;
  let steps = 0;
  // ⚠️ নিরাপত্তার জন্য একটা visited-state সীমা — এত বড় পাজলে (১১ রঙ) না থামালে এই একটা search
  // কয়েক গিগাবাইট মেমরি খেয়ে ফেলতে পারত, যেটা ছোট সার্ভারে পুরো অ্যাপকেই ক্র্যাশ করিয়ে দিতে পারে
  const MAX_VISITED = 150000;
  while (q.length && steps < 250000 && visited.size < MAX_VISITED) {
    steps++;
    if (steps % 1500 === 0) await sleep(0); // event loop-কে বাকি কাজ (chess ইত্যাদি) করার সুযোগ দেওয়া
    const cur = q.shift();
    const curKey = bsKey(cur);
    if (bsIsSolved(cur)) {
      const moves = [];
      let k = curKey;
      while (parent[k]) {
        moves.unshift(parent[k].move);
        k = parent[k].fromKey;
      }
      return moves;
    }
    for (let from = 0; from < cur.length; from++) {
      for (let to = 0; to < cur.length; to++) {
        if (!bsCanPour(cur, from, to)) continue;
        const next = bsClone(cur);
        next[to].push(next[from].pop());
        const nextKey = bsKey(next);
        if (visited.has(nextKey)) continue;
        visited.add(nextKey);
        parent[nextKey] = { fromKey: curKey, move: { from, to } };
        q.push(next);
      }
    }
  }
  return null; // সমাধান পাওয়া যায়নি (তাত্ত্বিকভাবে বিরল, নতুন পাজল বানিয়ে নেওয়া হবে)
}
let ballSortLoopActive = false;
async function runBallSortLoop() {
  if (ballSortLoopActive) return;
  ballSortLoopActive = true;
  while (ballSortLoopActive) {
    let tubes = bsGeneratePuzzle();
    writeState("ballsort", { tubes, colors: BS_COLORS, status: "solving", lastMove: null, movesLeft: null }); // "চিন্তা করছে" — বড় পাজলে solve করতে কিছুটা সময় লাগে
    let solution = await bsSolve(tubes);
    let attempts = 0;
    while (!solution && attempts < 5) { tubes = bsGeneratePuzzle(); solution = await bsSolve(tubes); attempts++; }
    if (!solution) { await sleep(2000); continue; } // চরম বিরল কেস, আবার চেষ্টা
    writeState("ballsort", { tubes, colors: BS_COLORS, status: "playing", lastMove: null, movesLeft: solution.length });
    await sleep(1500);
    // মোট সমাধানের সময়টা একটা লক্ষ্যমাত্রার (~৪ মিনিট) কাছাকাছি রাখার চেষ্টা — খুব বেশি চাল থাকলে
    // প্রতি চালের বিরতি একটু কমিয়ে, কম চাল থাকলে বাড়িয়ে — যাতে "কম্পিউটার-দ্রুত" মনে না হয়
    const targetTotalMs = 4 * 60 * 1000;
    const perMoveDelay = Math.max(700, Math.min(2200, Math.round(targetTotalMs / Math.max(1, solution.length))));
    for (let i = 0; i < solution.length && ballSortLoopActive; i++) {
      const mv = solution[i];
      tubes[mv.to].push(tubes[mv.from].pop());
      writeState("ballsort", { tubes: bsClone(tubes), colors: BS_COLORS, status: "playing", lastMove: mv, movesLeft: solution.length - i - 1 });
      await sleep(perMoveDelay); // প্রতিটা ঢালার মাঝে বিরতি — দর্শক স্পষ্ট দেখতে পাবে, মানুষ ভাবছে এমন অনুভূতি
    }
    writeState("ballsort", { tubes, colors: BS_COLORS, status: "solved", lastMove: null, movesLeft: 0 });
    await sleep(3000); // সমাধান হওয়া পাজলটা কিছুক্ষণ দেখানো, তারপর নতুন পাজল
  }
}

const SNAKE_OVERLAY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Snake — Live</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;}
body{margin:0;background:linear-gradient(160deg,#0a0e1f 0%,#12081f 60%,#0a0e1f 100%);color:#F5F7FA;
font-family:'Segoe UI',sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:10px;}
h1{color:#FFD866;font-size:22px;margin:0 0 2px;text-shadow:0 2px 12px rgba(255,216,102,0.35);}
#scoreRow{display:flex;gap:24px;font-size:14px;color:#7C8AAD;margin-bottom:6px;font-weight:700;}
#scoreRow b{color:#FFD866;font-size:18px;}
#boardWrap{position:relative;flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;}
#board{background:#161b2e;border:4px solid #8a5a2a;border-radius:8px;box-shadow:0 20px 46px rgba(0,0,0,0.75);}
.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:60px;font-weight:900;
color:#FFD866;opacity:0;pointer-events:none;text-shadow:0 0 30px rgba(0,0,0,0.9);}
.flash.show{animation:pop 2.2s ease-out forwards;}
@keyframes pop{0%{opacity:0;transform:scale(0.6);}15%{opacity:1;transform:scale(1.05);}80%{opacity:1;}100%{opacity:0;}}
/* নিচের ৪টা "সুইচ" — শুধু ভিজ্যুয়াল ইঙ্গিত, সাপ যেদিকে যাচ্ছে সেদিকেরটা আলো জ্বলে ওঠে, যেন মনে হয়
   কেউ সুইচ চেপে সাপ ঘোরাচ্ছে (আসলে AI নিজেই সিদ্ধান্ত নেয়, এটা শুধু দর্শকদের জন্য একটা মজার ইঙ্গিত) */
#dpad{display:grid;grid-template-columns:44px 44px 44px;grid-template-rows:44px 44px 44px;gap:5px;margin-top:10px;flex-shrink:0;}
.dbtn{background:#161b2e;border:2px solid #2a3352;border-radius:8px;display:flex;align-items:center;justify-content:center;
font-size:18px;color:#5a6a8a;transition:all 0.15s;}
.dbtn.active{background:#FFD866;border-color:#FFD866;color:#0a0e1f;box-shadow:0 0 16px rgba(255,216,102,0.7);transform:scale(1.08);}
#dUp{grid-column:2;grid-row:1;} #dLeft{grid-column:1;grid-row:2;} #dRight{grid-column:3;grid-row:2;} #dDown{grid-column:2;grid-row:3;}
</style></head><body>
<h1>🐍 Snake — Live</h1>
<div id="scoreRow">Score: <b id="scoreVal">0</b> &nbsp;|&nbsp; High Score: <b id="highScoreVal">0</b></div>
<div id="boardWrap"><canvas id="board"></canvas></div>
<div id="dpad">
  <div class="dbtn" id="dUp">▲</div>
  <div class="dbtn" id="dLeft">◀</div>
  <div class="dbtn" id="dRight">▶</div>
  <div class="dbtn" id="dDown">▼</div>
</div>
<div class="flash" id="flash"></div>
<script>
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
      osc.connect(g).connect(audioCtx.destination); osc.start(tt); osc.stop(tt+0.18);
    });
  }catch(e){}
}
document.body.addEventListener("click", () => { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); }, { once: true });

let lastStatus = "", lastScore = 0;
let prevBody = null, curBody = null, curFood = null, lastTickTime = performance.now();
const TICK_MS = 220;

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
  if (!curBody) return;
  const t = Math.min(1, (now - lastTickTime) / TICK_MS);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    ctx.fillStyle = (r+c)%2===0 ? "#1c2338" : "#161b2e";
    ctx.fillRect(c*cellSize, r*cellSize, cellSize, cellSize);
  }
  // খাবার — একটু pulsating, চোখে পড়ার মতো
  const pulse = 1 + Math.sin(now/220)*0.08;
  ctx.fillStyle = "#E8443D";
  ctx.beginPath();
  ctx.arc(curFood.c*cellSize+cellSize/2, curFood.r*cellSize+cellSize/2, cellSize*0.36*pulse, 0, Math.PI*2);
  ctx.fill();

  // সাপ — আলাদা আলাদা বক্স না, একটানা মসৃণ "worm" আকৃতি, আগের ও এখনকার অবস্থানের মাঝে interpolate করা
  let body = curBody;
  if (prevBody && prevBody.length === curBody.length) {
    body = curBody.map((seg, i) => ({
      r: prevBody[i].r + (seg.r - prevBody[i].r) * t,
      c: prevBody[i].c + (seg.c - prevBody[i].c) * t,
    }));
  }
  ctx.strokeStyle = "#8BE28B";
  ctx.lineWidth = cellSize * 0.78;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  body.forEach((seg, i) => {
    const x = seg.c*cellSize+cellSize/2, y = seg.r*cellSize+cellSize/2;
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
  // মাথা — আলাদা রঙ + চোখ, যাতে বোঝা যায় কোনদিকে যাচ্ছে
  const head = body[0];
  const hx = head.c*cellSize+cellSize/2, hy = head.r*cellSize+cellSize/2;
  ctx.fillStyle = "#FFD866";
  ctx.beginPath(); ctx.arc(hx, hy, cellSize*0.42, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#0a0e1f";
  ctx.beginPath(); ctx.arc(hx-cellSize*0.12, hy-cellSize*0.1, cellSize*0.07, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx+cellSize*0.12, hy-cellSize*0.1, cellSize*0.07, 0, Math.PI*2); ctx.fill();
}
requestAnimationFrame(render);

async function poll(){
  try{
    const res = await fetch("/gaming/state/snake.json?t="+Date.now());
    const data = await res.json();
    prevBody = curBody || data.body;
    curBody = data.body;
    curFood = data.food;
    lastTickTime = performance.now();
    updateDpad(data.dir);
    document.getElementById("scoreVal").textContent = data.score;
    document.getElementById("highScoreVal").textContent = data.highScore;
    if (data.score > lastScore) playEatSound();
    lastScore = data.score;
    if (data.status === "gameover" && lastStatus !== "gameover") {
      const flashEl = document.getElementById("flash");
      flashEl.textContent = "💀 Game Over — Score: " + data.score;
      flashEl.classList.remove("show"); void flashEl.offsetWidth; flashEl.classList.add("show");
    }
    lastStatus = data.status;
  }catch(e){}
}
setInterval(poll, 220); poll();
</script></body></html>`;

const BALLSORT_OVERLAY_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Ball Sort Puzzle — Live</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box;}
body{margin:0;background:linear-gradient(160deg,#0a0e1f 0%,#12081f 60%,#0a0e1f 100%);color:#F5F7FA;
font-family:'Segoe UI',sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:14px;}
h1{color:#FFD866;font-size:22px;margin:0 0 4px;text-shadow:0 2px 12px rgba(255,216,102,0.35);}
#statusLine{color:#7C8AAD;font-size:13px;margin-bottom:14px;font-weight:700;min-height:18px;}
#statusLine.solved{color:#8BE28B;}
#tubesWrap{flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;}
.tube{width:50px;height:216px;background:#161b2e;border:3px solid #2a3352;border-radius:0 0 20px 20px;
display:flex;flex-direction:column-reverse;padding:4px;gap:4px;box-shadow:0 10px 24px rgba(0,0,0,0.5);position:relative;}
.ball{width:100%;aspect-ratio:1;border-radius:50%;box-shadow:inset 0 -4px 8px rgba(0,0,0,0.35),inset 0 3px 4px rgba(255,255,255,0.4);}
.flyingBall{border-radius:50%;box-shadow:inset 0 -4px 8px rgba(0,0,0,0.35),inset 0 3px 4px rgba(255,255,255,0.4),0 6px 14px rgba(0,0,0,0.6);z-index:20;}
.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:900;
color:#8BE28B;opacity:0;pointer-events:none;text-shadow:0 0 30px rgba(0,0,0,0.9);}
.flash.show{animation:pop 2.2s ease-out forwards;}
@keyframes pop{0%{opacity:0;transform:scale(0.6);}15%{opacity:1;transform:scale(1.05);}80%{opacity:1;}100%{opacity:0;}}
</style></head><body>
<h1>🧪 Ball Sort Puzzle — Live</h1>
<div id="statusLine">Thinking...</div>
<div id="tubesWrap"></div>
<div class="flash" id="flash"></div>
<script>
let lastStatus = "";
let lastMoveSig = "";
let animating = false;

let audioCtx = null;
document.body.addEventListener("click", () => { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); }, { once: true });
// মিষ্টি, নরম "জল ঢালার" মতো শব্দ — বল টিউব থেকে বেরিয়ে অন্য টিউবে পড়ার মুহূর্তে বাজে
function playPourSound(){
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.28);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t+0.03); g.gain.exponentialRampToValueAtTime(0.001, t+0.32);
    osc.connect(g).connect(audioCtx.destination); osc.start(t); osc.stop(t+0.34);
    // ছোট্ট "প্লিং" — বল টিউবে গিয়ে বসার মুহূর্তে
    const osc2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    osc2.type = "triangle"; osc2.frequency.setValueAtTime(1100, t+0.26);
    g2.gain.setValueAtTime(0.0001, t+0.26); g2.gain.exponentialRampToValueAtTime(0.12, t+0.27); g2.gain.exponentialRampToValueAtTime(0.001, t+0.4);
    osc2.connect(g2).connect(audioCtx.destination); osc2.start(t+0.26); osc2.stop(t+0.42);
  }catch(e){}
}

function renderStatic(tubes, colors){
  const wrap = document.getElementById("tubesWrap");
  wrap.innerHTML = "";
  tubes.forEach((tube) => {
    const tubeEl = document.createElement("div");
    tubeEl.className = "tube";
    tube.forEach((colorIdx) => {
      const ball = document.createElement("div");
      ball.className = "ball";
      ball.style.background = colors[colorIdx];
      tubeEl.appendChild(ball);
    });
    wrap.appendChild(tubeEl);
  });
}

// আসল "বল বেরিয়ে অন্য টিউবে ঢোকা" অ্যানিমেশন — আগে বল সরাসরি লাফিয়ে অন্য জায়গায় দেখা যেত, এখন
// বল টিউব থেকে উপরে উঠে, বাঁক নিয়ে, তারপর নতুন টিউবে নেমে যায় — যেন সত্যিই কেউ ঢালছে
function animateMove(mv, tubesAfter, colors){
  animating = true;
  const before = tubesAfter.map((t) => [...t]);
  const movedColor = before[mv.to].pop();
  before[mv.from].push(movedColor);
  renderStatic(before, colors);

  const wrap = document.getElementById("tubesWrap");
  const fromTubeEl = wrap.children[mv.from];
  const toTubeEl = wrap.children[mv.to];
  if (!fromTubeEl || !toTubeEl) { animating = false; renderStatic(tubesAfter, colors); return; }
  const fromRect = fromTubeEl.getBoundingClientRect();
  const toRect = toTubeEl.getBoundingClientRect();
  const ballSize = fromRect.width - 10;

  const flyBall = document.createElement("div");
  flyBall.className = "ball flyingBall";
  flyBall.style.background = colors[movedColor];
  flyBall.style.position = "fixed";
  flyBall.style.width = ballSize + "px"; flyBall.style.height = ballSize + "px";
  const startX = fromRect.left + fromRect.width/2 - ballSize/2;
  const startY = fromRect.top + 6;
  flyBall.style.left = startX + "px"; flyBall.style.top = startY + "px";
  document.body.appendChild(flyBall);

  playPourSound();
  const riseTop = Math.min(fromRect.top, toRect.top) - 55;
  requestAnimationFrame(() => {
    flyBall.style.transition = "top 0.22s ease-out";
    flyBall.style.top = riseTop + "px";
    setTimeout(() => {
      const endX = toRect.left + toRect.width/2 - ballSize/2;
      const endY = toRect.top + 6;
      flyBall.style.transition = "left 0.28s ease-in-out, top 0.3s ease-in";
      flyBall.style.left = endX + "px";
      flyBall.style.top = endY + "px";
      setTimeout(() => {
        flyBall.remove();
        renderStatic(tubesAfter, colors);
        animating = false;
      }, 310);
    }, 230);
  });
}

async function poll(){
  if (animating) return; // একটা অ্যানিমেশন চলাকালীন নতুন poll-এর জন্য অপেক্ষা, নাহলে ছন্দ ভেঙে যাবে
  try{
    const res = await fetch("/gaming/state/ballsort.json?t="+Date.now());
    const data = await res.json();
    const statusEl = document.getElementById("statusLine");

    if (data.status === "solving") {
      statusEl.textContent = "🤔 একটা বড় পাজল — সমাধান খুঁজে বের করছে...";
      statusEl.classList.remove("solved");
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
</script></body></html>`;

// ---------------------------------------------------------------------------
// ৮. মূল mount ফাংশন — server.js থেকে কল হয়
// ---------------------------------------------------------------------------
module.exports = function mountGaming(app) {
  app.use("/gaming/state", express.static(STATE_DIR));
  app.use("/gaming/audio", express.static(AUDIO_DIR));
  app.use("/gaming/uploads", express.static(CHALLENGE_UPLOAD_DIR));
  app.get("/gaming/overlay/chess", (req, res) => res.type("html").send(CHESS_OVERLAY_HTML));
  app.get("/gaming/overlay/sports", (req, res) => res.type("html").send(SPORTS_OVERLAY_HTML));
  app.get("/gaming/status", (req, res) => res.json({ ok: true, activeBlockId }));

  // --- লাইভ চ্যালেঞ্জ / queue রুটগুলো ---
  app.get("/gaming/challenge/join", (req, res) => res.type("html").send(CHALLENGE_JOIN_HTML));
  app.get("/gaming/challenge/status", (req, res) => res.type("html").send(CHALLENGE_STATUS_HTML));
  app.get("/gaming/challenge/play", (req, res) => res.type("html").send(CHALLENGE_PLAY_HTML));
  app.get("/gaming/challenge/tip-info", (req, res) => res.json({ tipUrl: TIP_URL }));

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
  runSnakeLoop().catch((e) => console.error("❌ Snake loop-এ error:", e));
  runBallSortLoop().catch((e) => console.error("❌ Ball Sort loop-এ error:", e));

  console.log("✅ gaming.js mount হয়েছে — /gaming/overlay/chess, /gaming/overlay/sports, /gaming/overlay/snake, /gaming/overlay/ballsort, /gaming/challenge/join এ পাওয়া যাবে।");
};

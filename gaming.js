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
    if (position === 3) {
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
    queue: getQueuePublicState(),
    candidates: [],
    chosenMove: null,
    lastMove: null,
    capturedByWhite,
    capturedByBlack,
  };
  writeState("chess", state);

  const TURN_TIMEOUT_MS = 90000; // মানুষ ৯০ সেকেন্ডের মধ্যে চাল না দিলে random বৈধ চাল অটো খেলে দেওয়া হয়, স্ট্রিম আটকে থাকে না
  let moveCount = 0;
  while (!chess.isGameOver() && moveCount < 150 && chessLoopActive) {
    if (chess.turn() === "w") {
      const thinkTimeMs = 1200 + Math.floor(Math.random() * 1200);
      const { bestmove } = await getCandidateMoves(engine, chess.fen(), thinkTimeMs);
      if (!bestmove) break;
      const mv = chess.move(bestmove, { sloppy: true });
      if (!mv) break;
      state.lastMove = { from: mv.from, to: mv.to };
      if (mv.captured) capturedByWhite.push(mv.captured);
    } else {
      const beforeFen = chess.fen();
      const deadline = Date.now() + TURN_TIMEOUT_MS;
      while (Date.now() < deadline && chess.fen() === beforeFen && chessLoopActive) {
        await sleep(500);
      }
      if (chess.fen() === beforeFen) {
        // টাইমআউট — random বৈধ চাল অটো খেলে দেওয়া, যাতে স্ট্রিম আটকে না থাকে
        const legal = chess.moves();
        if (legal.length) {
          const mv = chess.move(legal[Math.floor(Math.random() * legal.length)]);
          if (mv && mv.captured) capturedByBlack.push(mv.captured);
          state.lastMove = mv ? { from: mv.from, to: mv.to } : state.lastMove;
        }
      } else {
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
    if (activeChallenge) activeChallenge.lastMove = state.lastMove; // play পেজে move animation-এর জন্য দরকার
    writeState("chess", state);
    await sleep(1200);
  }

  engine.proc.kill();
  const winnerName = chess.isCheckmate() ? (chess.turn() === "w" ? challenger.name : YOUR_DISPLAY_NAME) : null;
  state.status = "finished";
  state.result = winnerName ? `চেকমেট — ${winnerName} জিতেছে` : "ড্র";
  state.lastCommentaryBn = winnerName
    ? `🎉 ${winnerName} এই চ্যালেঞ্জ ম্যাচে ${YOUR_DISPLAY_NAME}-কে হারিয়ে দিল! দারুণ খেলা।`
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

function spawnStockfish(skillLevel) {
  // Windows-এ ডিফল্ট হিসেবে এই ফাইলের পাশে রাখা stockfish.exe খোঁজে;
  // Linux/Mac/VPS-এ (Docker) সিস্টেম PATH-এ থাকা "stockfish" ব্যবহার করে।
  const bin = process.env.STOCKFISH_PATH || (process.platform === "win32" ? path.join(__dirname, "stockfish.exe") : "stockfish");
  const engine = spawn(bin);
  engine.on("error", (err) => {
    console.error("❌ Stockfish চালু করা যায়নি:", err.message, "| ব্যবহৃত path:", bin);
  });
  const send = (cmd) => engine.stdin.write(cmd + "\n");
  send("uci");
  send(`setoption name Skill Level value ${skillLevel}`);
  send("setoption name MultiPV value 3"); // top ৩টা candidate move বের করার জন্য — দর্শকদের প্রেডিকশনের জন্য দরকার
  return { proc: engine, send };
}

// শুধু বেস্ট মুভ না, top ৩টা candidate move (UCI ফরম্যাটে, যেমন "e2e4") ফেরত দেয় —
// দর্শকদের আগে prediction দেখানো, পরে সবচেয়ে ভালোটা highlight করার জন্য এটা দরকার
function getCandidateMoves(engine, fen, movetimeMs = 1200) {
  return new Promise((resolve) => {
    const candidates = {}; // multipv index -> {uci, cp}
    let resolved = false;
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
      if (bmMatch && !resolved) {
        resolved = true;
        engine.proc.stdout.off("data", onData);
        const list = Object.keys(candidates)
          .sort((a, b) => a - b)
          .map((k) => candidates[k]);
        resolve({ bestmove: bmMatch[1] === "(none)" ? null : bmMatch[1], candidates: list.slice(0, 3) });
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
const YOUR_DISPLAY_NAME = process.env.CHESS_YOUR_NAME || "Nur";
const YOUR_AVATAR_URL = process.env.CHESS_YOUR_AVATAR_URL || ""; // চাইলে নিজের ছবির লিংক .env-এ CHESS_YOUR_AVATAR_URL হিসেবে বসান

async function playOneChessGame(Chess) {
  const chess = new Chess();
  const opening = OPENING_BOOK[Math.floor(Math.random() * OPENING_BOOK.length)];
  opening.moves.forEach((m) => chess.move(m));

  const skillOptions = [12, 15, 18, 20];
  const white = spawnStockfish(skillOptions[Math.floor(Math.random() * skillOptions.length)]);
  const black = spawnStockfish(skillOptions[Math.floor(Math.random() * skillOptions.length)]);

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
  };
  writeState("chess", state);

  let moveCount = 0;
  const MAX_MOVES = 140;
  while (!chess.isGameOver() && moveCount < MAX_MOVES && chessLoopActive) {
    const isWhiteTurn = chess.turn() === "w";
    const engine = isWhiteTurn ? white : black;

    // "ভাবার সময়" মানুষের মতো এলোমেলো — কখনো তাড়াতাড়ি সহজ চাল, কখনো ধীরে জটিল চাল ভাবছে এমন অনুভূতি
    const thinkTimeMs = 1000 + Math.floor(Math.random() * 1600); // 1.0s–2.6s
    const { bestmove, candidates } = await getCandidateMoves(engine, chess.fen(), thinkTimeMs);
    if (!bestmove) break;

    // ধাপ ১ — সম্ভাব্য candidate move গুলো বোর্ডে হালকা করে দেখানো, দর্শককে "প্রেডিক্ট" করার সময় দেওয়া
    state.candidates = candidates.map((c) => uciToSquares(c.uci)).filter(Boolean);
    state.chosenMove = null;
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

  white.proc.kill();
  black.proc.kill();

  const winnerName = chess.isCheckmate() ? (chess.turn() === "w" ? state.blackName : state.whiteName) : null;
  const resultText = winnerName ? `চেকমেট — ${winnerName} জিতেছে` : chess.isDraw() ? "ড্র" : "গেম থেমে গেছে";
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
const CHESS_OVERLAY_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>Chess</title>
<style>
*{box-sizing:border-box;}
body{margin:0;background:linear-gradient(160deg,#0a0e1f 0%,#12081f 60%,#0a0e1f 100%);color:#F5F7FA;font-family:'Segoe UI',sans-serif;
padding:16px 20px;height:100vh;overflow:hidden;}
h1{text-align:center;margin:0 0 12px;font-size:24px;letter-spacing:0.5px;font-weight:800;
color:#FFD866;text-shadow:0 2px 12px rgba(255,216,102,0.35);}
.layout{display:grid;grid-template-columns:260px 520px 260px;gap:22px;align-items:start;justify-content:center;max-width:1200px;margin:0 auto;}
.sideCol{display:flex;flex-direction:column;gap:12px;max-height:calc(100vh - 90px);}
.rulesBox{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:12px 14px;
box-shadow:0 10px 24px rgba(0,0,0,0.5);font-family:'Segoe UI',sans-serif;overflow-y:auto;}
.rulesBox h3{margin:0 0 8px;font-size:11px;color:#FFD866;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;}
.ruleRow{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #202a44;}
.ruleRow:last-child{border-bottom:none;}
.ruleGlyph{font-size:20px;width:26px;text-align:center;filter:drop-shadow(0 0 6px rgba(255,216,102,0.5));}
.ruleGlyph.hi{animation:glow 1.4s ease-in-out infinite;}
@keyframes glow{0%,100%{filter:drop-shadow(0 0 6px rgba(255,216,102,0.4));}50%{filter:drop-shadow(0 0 14px rgba(255,216,102,1));}}
.ruleText{font-size:10px;color:#B8C4D9;line-height:1.35;}
.ruleText b{color:#fff;}
.playerCard{background:#161b2e;border:1px solid #2a3352;border-radius:16px;padding:14px;
box-shadow:0 10px 24px rgba(0,0,0,0.55);text-align:center;}
.playerCard.active{border-color:#FFD866;box-shadow:0 0 0 2px #FFD866, 0 10px 30px rgba(255,216,102,0.3);}
.avatar{width:88px;height:88px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;
font-size:36px;font-weight:800;color:#0a0e1f;background:#4FC3F7;border:4px solid #2a3352;overflow:hidden;}
.avatar.black{background:#B0BEC5;}
.avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
.pName{font-size:16px;font-weight:700;color:#fff;}
.pLabel{font-size:10px;color:#7C8AAD;margin-top:2px;text-transform:uppercase;letter-spacing:1px;}
.captured{margin-top:10px;min-height:26px;font-size:18px;letter-spacing:2px;color:#FFD866;opacity:0.9;}
.centerCol{display:flex;flex-direction:column;align-items:center;}
#opening{color:#7C8AAD;font-size:13px;margin-bottom:8px;font-weight:600;}
#boardWrap{position:relative;width:496px;}
#board{display:grid;grid-template-columns:repeat(8,62px);grid-template-rows:repeat(8,62px);
width:496px;border:10px solid;border-image:linear-gradient(135deg,#B8874A,#3E2712) 1;border-radius:8px;
box-shadow:0 20px 46px rgba(0,0,0,0.75), inset 0 0 0 2px rgba(0,0,0,0.5);}
#arrowLayer{position:absolute;top:10px;left:10px;width:476px;height:476px;pointer-events:none;}
.sq{display:flex;align-items:center;justify-content:center;font-size:44px;user-select:none;position:relative;}
.light{background:#EFE0BF;}
.dark{background:#5C3A21;}
.sq.lastFrom{box-shadow:inset 0 0 0 4px rgba(76,217,100,0.85);}
.sq.lastTo{box-shadow:inset 0 0 0 4px #FFD866;}
.piece{display:inline-block;position:relative;transform:translateY(-2px);}
.piece-w{background:linear-gradient(160deg,#ffffff 0%,#f0ede4 40%,#d4cbb8 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 2px 0 #6b6252) drop-shadow(0 6px 5px rgba(0,0,0,0.6));}
.piece-b{background:linear-gradient(160deg,#3a3a3a 0%,#181818 45%,#000000 100%);
-webkit-background-clip:text;background-clip:text;color:transparent;
filter:drop-shadow(0 2px 0 #000) drop-shadow(0 6px 5px rgba(0,0,0,0.7));}
#thinking{color:#7C8AAD;font-size:12px;margin-top:10px;min-height:16px;}
#thinking.active{animation:pulse 1.2s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:0.35;}50%{opacity:1;}}
#predictLabel{color:#FFD866;font-size:15px;min-height:20px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;}
#moveCount{color:#7C8AAD;font-size:11px;margin-top:6px;}
#commentary{margin-top:10px;font-size:15px;color:#FFD866;max-width:480px;text-align:center;min-height:20px;font-weight:600;}
.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;
font-size:76px;font-weight:900;opacity:0;pointer-events:none;text-align:center;padding:20px;background:rgba(0,0,0,0.45);}
.flash.show{animation:pop 3.2s ease-out forwards;}
.flash .confetti{font-size:36px;}
@keyframes pop{0%{opacity:0;transform:scale(0.5) rotate(-5deg);}12%{opacity:1;transform:scale(1.1) rotate(1deg);}
25%{transform:scale(1) rotate(0);}85%{opacity:1;}100%{opacity:0;}}

/* সরাসরি টিপস QR — বাম পাশের নিয়মের বক্সের ঠিক নিচে, স্থায়ীভাবে বসানো একটা ছোট কার্ড */
#tipBoxOverlay{position:fixed;left:20px;bottom:16px;width:220px;z-index:15;}
#tipQrWrap{background:#161b2e;border:1px solid #2a3352;border-radius:14px;padding:10px;text-align:center;
box-shadow:0 10px 24px rgba(0,0,0,0.5);}
#tipQrImg{width:96px;height:96px;border-radius:8px;background:#fff;padding:4px;display:block;margin:0 auto;}
.tipLabel{color:#FFD866;font-weight:800;font-size:13px;margin-top:6px;}
.tipSub{color:#5a6a8a;font-size:8.5px;margin-top:3px;line-height:1.3;}
#donorPopup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:#0f1526;border:2px solid #FFD866;border-radius:14px;padding:10px;text-align:center;opacity:0;
pointer-events:none;transition:opacity 0.5s;box-shadow:0 0 30px rgba(255,216,102,0.4);}
#donorPopup.show{opacity:1;}
#donorPopup .rankTag{font-size:10px;font-weight:800;color:#0a0e1f;background:#FFD866;border-radius:20px;
padding:2px 10px;margin-bottom:6px;letter-spacing:0.5px;}
#donorPopup .dAvatar{width:56px;height:56px;border-radius:50%;object-fit:cover;border:3px solid #FFD866;margin-bottom:6px;}
#donorPopup .dAvatarFallback{width:56px;height:56px;border-radius:50%;background:#4FC3F7;color:#0a0e1f;
font-weight:900;font-size:22px;display:flex;align-items:center;justify-content:center;margin-bottom:6px;}
#donorPopup .dName{color:#fff;font-weight:800;font-size:13px;}
#donorPopup .dAmount{color:#FFD866;font-size:12px;font-weight:700;margin-top:2px;}
</style></head><body>
<h1>♟️ Chess Battle — Live</h1>
<div class="layout">
  <div class="sideCol">
    <div class="playerCard" id="whiteCard">
      <div class="avatar" id="whiteAvatar">N</div>
      <div class="pName" id="whiteName">—</div>
      <div class="pLabel">সাদা</div>
      <div class="captured" id="capturedByWhite"></div>
    </div>
    <!-- গুটির নিয়ম শেখানোর বক্স — English-এ, প্রতি কয়েক সেকেন্ডে একটা গুটি হাইলাইট হয় -->
    <div class="rulesBox" id="rulesBox">
      <h3>How Pieces Move</h3>
      <div id="rulesList"></div>
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
    <div id="thinking">চাল ভাবা হচ্ছে...</div>
    <div id="predictLabel"></div>
    <div id="moveCount"></div>
    <div id="commentary"></div>
  </div>

  <div class="sideCol">
    <div class="playerCard" id="blackCard">
      <div class="avatar black" id="blackAvatar">?</div>
      <div class="pName" id="blackName">—</div>
      <div class="pLabel">কালো</div>
      <div class="captured" id="capturedByBlack"></div>
    </div>
    <!-- লাইভ চ্যালেঞ্জ queue-তে কারা অপেক্ষা করছে, তাদের ছবি/নাম/টিপস এখানে দেখাবে (queue না থাকলে খালি থাকবে) -->
    <div class="rulesBox" id="queuePanel" style="display:none;">
      <h3>🔴 Up Next — Challenge Queue</h3>
      <div id="queueList"></div>
      <div style="font-size:9px;color:#5a6a8a;margin-top:6px;">খেলতে চান? Description-এ লিংকে ক্লিক করুন</div>
    </div>
  </div>
</div>

<div class="flash" id="flash"></div>

<!-- সরাসরি টিপস — স্ক্যানারটা স্থায়ীভাবে এখানেই থাকবে, তার উপরে মাঝেমধ্যে টপ ৩ ডোনার/হেল্পারের নাম পপ-আপ হয়ে ভেসে উঠবে -->
<div id="tipBoxOverlay" style="display:none;">
  <div id="tipQrWrap">
    <img id="tipQrImg" src="" alt="Scan to help">
    <div class="tipLabel">🙏 Help Me</div>
    <div class="tipSub">স্বেচ্ছায় সাপোর্ট — গেমের সাথে সম্পর্কিত নয়, বাধ্যতামূলক নয়</div>
  </div>
  <div id="donorPopup"></div>
</div>

<button id="soundBtn" style="position:fixed;top:12px;right:12px;background:#E8B33D;border:none;
border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600;">🔊 সাউন্ড চালু করুন</button>
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
renderRules();
setInterval(() => { ruleIdx = (ruleIdx + 1) % PIECE_RULES.length; renderRules(); }, 4000);

let lastKey="";const audioEl=document.getElementById("narrator");let queue=[];
let audioCtx = null;
document.getElementById("soundBtn").addEventListener("click", () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  audioEl.play().catch(()=>{});
  document.getElementById("soundBtn").style.display = "none";
});
function playQueue(){if(queue.length===0)return;audioEl.src=queue.shift();audioEl.play().catch(()=>{});}
audioEl.addEventListener("ended",playQueue);

// প্রফেশনাল, তীক্ষ্ণ "wood tap" শব্দ — দুটো স্তর (আঘাত + হালকা অনুরণন), খুব সংক্ষিপ্ত, বিরক্তিকর না
function playMoveSound(isCapture) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator(); const g1 = audioCtx.createGain();
    osc1.type = "square"; osc1.frequency.setValueAtTime(isCapture ? 180 : 260, t);
    g1.gain.setValueAtTime(0.22, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc1.connect(g1).connect(audioCtx.destination); osc1.start(t); osc1.stop(t + 0.05);

    const osc2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    osc2.type = "sine"; osc2.frequency.setValueAtTime(isCapture ? 90 : 130, t);
    g2.gain.setValueAtTime(0.12, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc2.connect(g2).connect(audioCtx.destination); osc2.start(t); osc2.stop(t + 0.1);
  } catch (e) {}
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
    // চাল দেওয়ার মুহূর্তে গুটিটা এক ঘর থেকে পরের ঘরে চোখের সামনে দিয়ে "হেঁটে" যাবে,
    // আচমকা টেলিপোর্ট করবে না — এই জন্যই আগে destination square-এ গুটি লুকিয়ে,
    // একটা ghost piece আসল from→to বরাবর slide করানো হচ্ছে
    drawGrid(boardEl, grid, lastFromRC, lastToRC, lastToRC); // destination আপাতত খালি দেখানো হচ্ছে
    const fromEl = boardEl.querySelector('[data-square="' + lastMove.from + '"]');
    const toEl = boardEl.querySelector('[data-square="' + lastMove.to + '"]');
    const movingPiece = grid.find(g => rcToSquare(g.r, g.c) === lastMove.to);
    if (fromEl && toEl && movingPiece && movingPiece.piece) {
      const wrap = document.getElementById("boardWrap");
      const wrapRect = wrap.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const ghost = document.createElement("div");
      const isWhite = movingPiece.piece === movingPiece.piece.toUpperCase();
      ghost.className = "ghostPieceMain piece " + (isWhite ? "piece-w" : "piece-b");
      ghost.textContent = PIECE_GLYPH[movingPiece.piece] || "";
      ghost.style.cssText = "position:absolute;z-index:30;display:flex;align-items:center;justify-content:center;font-size:44px;pointer-events:none;transition:left 0.55s ease,top 0.55s ease;";
      ghost.style.left = (fromRect.left - wrapRect.left) + "px";
      ghost.style.top = (fromRect.top - wrapRect.top) + "px";
      ghost.style.width = fromRect.width + "px";
      ghost.style.height = fromRect.height + "px";
      wrap.appendChild(ghost);
      requestAnimationFrame(() => {
        ghost.style.left = (toRect.left - wrapRect.left) + "px";
        ghost.style.top = (toRect.top - wrapRect.top) + "px";
      });
      setTimeout(() => {
        ghost.remove();
        drawGrid(boardEl, grid, lastFromRC, lastToRC, null);
        playMoveSound(false);
      }, 580);
      prevFenBoard = boardPart;
      return;
    }
  }
  drawGrid(boardEl, grid, lastFromRC, lastToRC, null);
  const changed = prevFenBoard && prevFenBoard !== boardPart;
  if (changed) playMoveSound(false);
  prevFenBoard = boardPart;
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
function renderArrows(candidates, chosenMove) {
  const svg = document.getElementById("arrowLayer");
  svg.innerHTML = '<defs><marker id="ah1" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#E8B33D"/></marker><marker id="ah2" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="rgba(232,179,61,0.5)"/></marker></defs>';
  (candidates || []).forEach((c) => {
    if (chosenMove && c.from === chosenMove.from && c.to === chosenMove.to) return; // chosen আলাদাভাবে আঁকা হবে, ডুপ্লিকেট না
    const p1 = squareCenter(c.from), p2 = squareCenter(c.to);
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
    line.setAttribute("stroke", "rgba(232,179,61,0.45)"); line.setAttribute("stroke-width", "4");
    line.setAttribute("marker-end", "url(#ah2)");
    svg.appendChild(line);
  });
  if (chosenMove) {
    const p1 = squareCenter(chosenMove.from), p2 = squareCenter(chosenMove.to);
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
    line.setAttribute("stroke", "#E8B33D"); line.setAttribute("stroke-width", "6");
    line.setAttribute("marker-end", "url(#ah1)"); line.style.filter = "drop-shadow(0 0 4px rgba(232,179,61,0.8))";
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
  renderBoard(data.fen, data.lastMove);
  renderArrows(data.candidates, data.chosenMove);

  document.getElementById("opening").textContent = data.mode === "challenge" ? "🔴 LIVE — " + data.blackName + " vs " + data.whiteName : (data.openingName?("ওপেনিং: "+data.openingName):"");

  const qp = document.getElementById("queuePanel");
  if (data.queue && data.queue.length) {
    qp.style.display = "block";
    document.getElementById("queueList").innerHTML = data.queue.slice(0,5).map(q =>
      '<div class="ruleRow"><div class="ruleGlyph" style="font-size:0;">' +
      (q.photoUrl ? '<img src="'+q.photoUrl+'" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">' : '<div style="width:26px;height:26px;border-radius:50%;background:#4FC3F7;display:flex;align-items:center;justify-content:center;font-size:12px;color:#0a0e1f;font-weight:800;">'+(q.name[0]||"?")+'</div>') +
      '</div><div class="ruleText"><b>#'+q.position+'</b> '+q.name+ (q.tipAmount ? ' <span style="color:#FFD866;font-weight:700;">৳'+q.tipAmount+'</span>' : '') + '</div></div>'
    ).join("");
  } else {
    qp.style.display = "none";
  }
  document.getElementById("moveCount").textContent=data.moves?(data.moves.length+" চাল খেলা হয়েছে"):"";
  document.getElementById("commentary").textContent=data.lastCommentaryBn||"";

  document.getElementById("whiteName").textContent = data.whiteName || "—";
  document.getElementById("blackName").textContent = data.blackName || "—";
  const wAv = document.getElementById("whiteAvatar");
  if (data.whiteAvatarUrl) wAv.innerHTML = '<img src="'+data.whiteAvatarUrl+'">';
  else wAv.textContent = (data.whiteName || "N")[0].toUpperCase();
  const bAv = document.getElementById("blackAvatar");
  if (data.blackAvatarUrl) bAv.innerHTML = '<img src="'+data.blackAvatarUrl+'">';
  else bAv.textContent = (data.blackName || "?")[0].toUpperCase();
  renderCaptured(document.getElementById("capturedByWhite"), data.capturedByWhite);
  renderCaptured(document.getElementById("capturedByBlack"), data.capturedByBlack);

  document.getElementById("whiteCard").classList.toggle("active", data.fen && data.fen.includes(" w "));
  document.getElementById("blackCard").classList.toggle("active", data.fen && data.fen.includes(" b "));

  document.getElementById("thinking").style.display = data.status === "playing" ? "block" : "none";
  document.getElementById("thinking").classList.toggle("active", data.status === "playing");
  document.getElementById("predictLabel").textContent = (data.candidates && data.candidates.length)
    ? (data.chosenMove ? "BEST MOVE HIGHLIGHTED ⭐" : "PREDICT THE NEXT MOVE 🤔")
    : "";

  if (data.status === "finished" && lastStatus !== "finished-" + data.result) {
    lastStatus = "finished-" + data.result;
    const isWin = data.result && data.result.includes("চেকমেট");
    showFlash(isWin ? "🎉 " + data.result : "🤝 " + (data.result || "ড্র"), isWin ? "#FFD866" : "#8FA3C0", isWin);
    playEndGameSound(isWin);
  }
  if (data.status === "playing") lastStatus = "";

  const key=JSON.stringify(data.audioPlaylist||[]);
  if(data.audioPlaylist&&key!==lastKey){lastKey=key;queue=[...data.audioPlaylist];playQueue();}
}catch(e){}}
setInterval(poll,1200);poll();

// ---------- সরাসরি টিপস QR + টপ ৩ ডোনার সাইকেল ----------
fetch("/gaming/challenge/tip-info").then(r=>r.json()).then(d=>{
  if (d.tipUrl) {
    document.getElementById("tipQrImg").src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(d.tipUrl);
    document.getElementById("tipBoxOverlay").style.display = "block";
  }
});

let topDonors = [];
let donorCycleIdx = 0;
async function refreshTopDonors(){
  try {
    const res = await fetch("/top-donors/chessbattle");
    const data = await res.json();
    topDonors = data.top || [];
  } catch(e){}
}
function showDonorPopup(){
  if (!topDonors.length) return;
  const d = topDonors[donorCycleIdx % topDonors.length];
  donorCycleIdx++;
  const rankLabel = ["🥇 নাম্বার ওয়ান হেল্পার","🥈 নাম্বার টু হেল্পার","🥉 নাম্বার থ্রি হেল্পার"][topDonors.indexOf(d)] || "🏅 টপ হেল্পার";
  const popup = document.getElementById("donorPopup");
  popup.innerHTML =
    '<div class="rankTag">' + rankLabel + '</div>' +
    (d.photo ? '<img class="dAvatar" src="'+d.photo+'">' : '<div class="dAvatarFallback">'+((d.name&&d.name[0])||"?")+'</div>') +
    '<div class="dName">' + d.name + '</div>' +
    '<div class="dAmount">৳' + Math.round(d.amount) + '</div>';
  popup.classList.add("show");
  setTimeout(() => { popup.classList.remove("show"); }, 4500); // এই সময়টায় কেউ চাইলে স্ক্রিনশট নিতে পারবে
}
refreshTopDonors();
setInterval(refreshTopDonors, 20000); // প্রতি ২০ সেকেন্ডে সবশেষ টপ ৩ রিফ্রেশ
setInterval(showDonorPopup, 7000); // পপ-আপ আসবে, কিছুক্ষণ থেকে আবার মিলিয়ে যাবে, ঘুরেফিরে ১→২→৩→১...

// নতুন কোনো real payment এলে (verified, চেস চ্যানেলের) নাম নিয়ে সেলিব্রেশন
async function pollChessTips(){
  try {
    const res = await fetch("/events/chessbattle");
    const data = await res.json();
    (data.events || []).forEach(ev => {
      showFlash("🙏 ধন্যবাদ " + (ev.name || "Anonymous") + "!", "#FFD866", true);
      playEndGameSound(true);
    });
  } catch(e){}
}
setInterval(pollChessTips, 4000);
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
  const options = {
    body: data.body || '',
    tag: data.tag || 'general',
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    vibrate: data.requireInteraction ? [300, 100, 300, 100, 300] : [150, 60, 150],
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
    if (statusEl) statusEl.textContent = 'এই ব্রাউজারে push notification সাপোর্ট নেই — ট্যাব খোলা রাখলে এখানেই লাইভ আপডেট দেখা যাবে।';
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.register('/gaming/sw.js', { scope: '/gaming/' });
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (statusEl) statusEl.textContent = 'নোটিফিকেশন অনুমতি দেননি — চাইলে ব্রাউজার সেটিংস থেকে পরে চালু করতে পারবেন।';
      return false;
    }
    const keyRes = await fetch('/gaming/vapid-public-key');
    const { key } = await keyRes.json();
    if (!key) { if (statusEl) statusEl.textContent = 'সার্ভারে push সেটআপ হয়নি।'; return false; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await fetch('/gaming/challenge/push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, subscription: sub }) });
    if (statusEl) statusEl.textContent = '🔔 নোটিফিকেশন চালু হয়েছে — এবার আপনার পালা এলে মোবাইলেই জানিয়ে দেওয়া হবে।';
    return true;
  } catch (e) {
    if (statusEl) statusEl.textContent = 'নোটিফিকেশন চালু করতে সমস্যা হয়েছে।';
    return false;
  }
}
`;

const CHALLENGE_JOIN_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>Challenge Nur</title>
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
<p style="text-align:center;color:#7C8AAD;font-size:14px;">নাম আর ছবি দিয়ে লাইনে দাঁড়ান, turn এলে সরাসরি বোর্ডে চাল দিতে পারবেন।</p>
<form id="joinForm" enctype="multipart/form-data">
  <label>আপনার নাম</label>
  <input type="text" name="name" required maxlength="30" placeholder="যেমন: Rahim">
  <label>আপনার ছবি (ঐচ্ছিক)</label>
  <input type="file" name="photo" accept="image/*">
  <div class="tipBox" id="tipBox" style="display:none;">
    <b>ইচ্ছা হলে সাপোর্ট/টিপস দিতে পারেন</b>
    <img id="tipQr" src="" alt="Scan to tip">
    <div>QR স্ক্যান করুন অথবা <a id="tipLink" href="#" target="_blank">এই লিংকে</a> ক্লিক করুন</div>
    <label style="text-align:left;">টিপস দিয়ে থাকলে কত টাকা, লিখে দিন (ঐচ্ছিক)</label>
    <input type="number" name="tipAmount" min="0" step="1" placeholder="যেমন: 50">
    <div class="disclaimer">
      ⚠️ এই টিপস সম্পূর্ণ স্বেচ্ছামূলক — <b>গেম খেলার সাথে এর কোনো সম্পর্ক নেই, টিপস না দিয়েও খেলা যাবে।</b>
      এটা কোনো টুর্নামেন্ট ফি, এন্ট্রি ফি বা জুয়া না। উপরের অ্যামাউন্টটা শুধু স্ক্রিনে আপনার নামের পাশে দেখানোর জন্য, নিজে লিখে দিচ্ছেন — এটা স্বয়ংক্রিয়ভাবে পেমেন্ট যাচাই করে না।
    </div>
  </div>
  <button type="submit">লাইনে দাঁড়ান (Skip & Play)</button>
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
  btn.disabled = true; btn.textContent = "লাইনে দাঁড়ানো হচ্ছে...";
  const fd = new FormData(e.target);
  const res = await fetch("/gaming/challenge/join", { method: "POST", body: fd });
  const data = await res.json();
  if (data.id) {
    setupPush(data.id, null).catch(()=>{}); // ব্যাকগ্রাউন্ডে চেষ্টা করবে, আটকাবে না
    location.href = "/gaming/challenge/status?id=" + data.id;
  }
});
</script></body></html>`;

const CHALLENGE_STATUS_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>Queue Status</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; }
html,body{margin:0;height:100%;background:#0a0e1f;color:#F5F7FA;font-family:sans-serif;overflow:hidden;}
#liveFrame{position:fixed;inset:0;width:100%;height:100%;border:0;}
#hud{position:fixed;left:0;right:0;bottom:0;background:linear-gradient(0deg,rgba(10,14,31,0.97) 60%,rgba(10,14,31,0.0));
  padding:16px 16px 20px;text-align:center;}
#posRow{display:flex;align-items:center;justify-content:center;gap:10px;}
#pos{font-size:40px;font-weight:900;color:#FFD866;}
#msg{color:#B8C4D9;font-size:13px;margin-top:2px;}
.btnRow{display:flex;gap:10px;margin-top:12px;}
button{flex:1;padding:12px;border-radius:10px;border:none;font-weight:700;font-size:14px;cursor:pointer;}
#notifyBtn{background:#4FC3F7;color:#0a0e1f;}
#leaveBtn{background:#26314f;color:#F5F7FA;border:1px solid #3a4a70;}
#pushStatus{color:#5a6a8a;font-size:11px;margin-top:8px;min-height:14px;}
#alertBanner{position:fixed;top:0;left:0;right:0;background:#E8443D;color:#fff;font-weight:800;font-size:15px;
  text-align:center;padding:12px;display:none;animation:pulse 1s infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.55;}}
</style></head><body>
<div id="alertBanner">🔔 প্রায় আপনার পালা — মাত্র ২ জন বাকি, তৈরি থাকুন!</div>
<iframe id="liveFrame" src="/gaming/overlay/chess"></iframe>
<div id="hud">
  <div id="posRow"><div id="pos">...</div></div>
  <div id="msg">লোড হচ্ছে...</div>
  <div class="btnRow">
    <button id="notifyBtn">🔔 নোটিফিকেশন চালু করুন</button>
    <button id="leaveBtn">✖ লাইন থেকে সরে যান</button>
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
  if (!confirm("আপনি কি সত্যিই লাইন থেকে সরে যেতে চান?")) return;
  await fetch("/gaming/challenge/leave", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id }) });
  document.getElementById("msg").textContent = "আপনি লাইন থেকে সরে গেছেন। ধন্যবাদ!";
  document.getElementById("pos").textContent = "—";
});
let lastPosition = null;
async function poll(){
  try{
    const res = await fetch("/gaming/challenge/queue-state?id="+id);
    const data = await res.json();
    if (data.isYourTurn) { location.href = "/gaming/challenge/play?id="+id; return; }
    if (data.position) {
      document.getElementById("pos").textContent = "#"+data.position;
      document.getElementById("msg").textContent = "মোট "+data.total+" জন লাইনে আছেন, অপেক্ষা করুন...";
      const banner = document.getElementById("alertBanner");
      if (data.position <= 3 && lastPosition !== data.position) {
        if (data.position === 3) { banner.style.display = "block"; beep([880,660,880,660],true); setTimeout(()=>banner.style.display="none", 6000); }
        else beep([520,700], false);
      }
      lastPosition = data.position;
    } else {
      document.getElementById("pos").textContent = "—";
      document.getElementById("msg").textContent = "আপনার সময় শেষ হয়ে থাকতে পারে বা লাইন খুঁজে পাওয়া যাচ্ছে না।";
    }
  }catch(e){}
}
setInterval(poll, 3000); poll();
</script></body></html>`;

const CHALLENGE_PLAY_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>Your Move!</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;background:#0a0e1f;color:#fff;font-family:sans-serif;padding:16px;text-align:center;}
h1{color:#FFD866;font-size:20px;}
#boardWrap{position:relative;width:320px;margin:16px auto;}
#board{display:grid;grid-template-columns:repeat(8,40px);grid-template-rows:repeat(8,40px);width:320px;border:4px solid #8a5a2a;
transition:transform 0.3s;}
#board.flipped{transform:rotate(180deg);}
.sq{display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer;position:relative;}
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
.ghostPiece{position:absolute;font-size:26px;pointer-events:none;z-index:20;transition:left 0.45s ease,top 0.45s ease;}
#status{color:#7C8AAD;font-size:14px;margin-top:10px;}
#ytWrap{margin-top:20px;}
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
  <div class="cSub">আপনার পালা শুরু হয়ে গেছে!</div>
  <div class="confetti">🎉 ♟️ 🎊 ✨</div>
</div>
<h1>আপনার চাল! আপনি কালো ঘুঁটি খেলছেন</h1>
<div id="boardWrap"><div id="board"></div></div>
<div id="status">লোড হচ্ছে...</div>
<div id="ytWrap">
  <iframe id="ytFrame" src="https://www.youtube.com/embed/live_stream?channel=UCVP5_uwrKIp7rfMNgolnEqA&autoplay=1&mute=1"
    frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
  <div class="ytNote">🔴 লাইভে যা দেখছেন সেটা কয়েক সেকেন্ড দেরিতে আসতে পারে (স্ট্রিমিং delay)</div>
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
function runCelebration(name, photoUrl){
  hasCelebrated = true;
  const wrap = document.getElementById("celebAvatarWrap");
  wrap.innerHTML = photoUrl
    ? '<img src="'+photoUrl+'">'
    : '<div class="avatarFallback">'+((name&&name[0])||"?")+'</div>';
  document.getElementById("celebName").textContent = "🎉 " + (name||"খেলোয়াড়") + " 🎉";
  document.getElementById("celebrate").style.display = "flex";
  document.getElementById("celebrate").style.opacity = "1";
  smallAlarm();
  setTimeout(() => {
    document.getElementById("celebrate").style.opacity = "0";
    setTimeout(() => { document.getElementById("celebrate").style.display = "none"; }, 500);
  }, 2500); // ২.৫ সেকেন্ড সেলিব্রেশন, তারপর অটোমেটিক্যালি সরে গিয়ে বোর্ড দেখাবে
}
function squareName(r,c){ return "abcdefgh"[c] + (8-r); }
let lastRenderedMoveKey = "";
function renderBoard(fen, lastMove, animate){
  const boardEl = document.getElementById("board");
  boardEl.classList.add("flipped"); // আপনি সবসময় কালো ঘুঁটি খেলছেন — নিজের গুটি সবসময় নিচে দেখানোই স্বাভাবিক
  const rows = fen.split(" ")[0].split("/");
  const grid = [];
  for (let r=0;r<8;r++){
    let col=0;
    for (const ch of rows[r]) {
      if (/[0-9]/.test(ch)) { const n=parseInt(ch,10); for(let i=0;i<n;i++){grid.push({r,c:col,piece:""});col++;} }
      else { grid.push({r,c:col,piece:ch}); col++; }
    }
  }
  const moveKey = lastMove ? (lastMove.from+lastMove.to+fen.length) : "";
  const shouldAnimate = animate && lastMove && moveKey !== lastRenderedMoveKey;
  lastRenderedMoveKey = moveKey;

  if (shouldAnimate) {
    // চাল দেওয়ার সময় গুটিটা যেন এক ঘর থেকে আরেক ঘরে চোখের সামনে দিয়ে সরে যায় (হুট করে "টেলিপোর্ট" না করে) —
    // destination square-এর গুটিটা প্রথমে লুকিয়ে, তার জায়গায় from→to বরাবর একটা ghost piece slide করানো হচ্ছে
    const fromEl = boardEl.querySelector('[data-square="'+lastMove.from+'"]');
    const toEl = boardEl.querySelector('[data-square="'+lastMove.to+'"]');
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
      drawGrid(grid, lastMove, true); // destination square-এ আপাতত গুটি লুকানো থাকবে animation শেষ না হওয়া পর্যন্ত
      requestAnimationFrame(() => {
        ghost.style.left = (toRect.left - wrapRect.left) + "px";
        ghost.style.top = (toRect.top - wrapRect.top) + "px";
      });
      setTimeout(() => { ghost.remove(); drawGrid(grid, lastMove, false); }, 480);
      return;
    }
  }
  drawGrid(grid, lastMove, false);
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
      if (!d.ok) document.getElementById("status").textContent = "❌ " + (d.error||"অবৈধ চাল, আবার চেষ্টা করুন");
    });
  }
}
let gameEndedRedirectStarted = false;
async function poll(){
  try{
    const res = await fetch("/gaming/challenge/play-state?id="+id);
    const data = await res.json();
    if (!data.active) {
      document.getElementById("status").textContent = "গেম শেষ হয়ে গেছে। ধন্যবাদ খেলার জন্য! এখনই আপনাকে লাইভে ফিরিয়ে নিয়ে যাচ্ছি...";
      if (!gameEndedRedirectStarted) {
        gameEndedRedirectStarted = true;
        setTimeout(() => { location.href = "/gaming/overlay/chess"; }, 3000); // খেলা শেষে সাথে সাথেই চলমান লাইভে ফিরিয়ে দেওয়া
      }
      return;
    }
    if (!hasCelebrated) runCelebration(data.name, data.photoUrl);
    renderBoard(data.fen, data.lastMove, hasCelebrated);
    document.getElementById("status").textContent = data.turn === "b" ? "✅ আপনার turn — একটা ঘুঁটি ক্লিক করুন, তারপর কোথায় নিতে চান সেখানে ক্লিক করুন" : "⏳ Nur ভাবছে...";
  }catch(e){}
}
setInterval(poll, 1500); poll();
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

  app.post("/gaming/challenge/join", (req, res, next) => {
    if (upload) return upload.single("photo")(req, res, next);
    next();
  }, express.urlencoded({ extended: true }), (req, res) => {
    const id = nextQueueId();
    const name = ((req.body && req.body.name) || "Guest").toString().slice(0, 30);
    const photoUrl = req.file ? `/gaming/uploads/${path.basename(req.file.path)}` : "";
    // "কত টাকা টিপস দিলেন" — দর্শক নিজে QR স্ক্যান করে পাঠানোর পর এখানে (ঐচ্ছিক) লিখে দেয়,
    // এটা payment gateway থেকে auto-verify হয় না, শুধু queue-তে তার নামের পাশে দেখানোর জন্য
    let tipAmount = parseInt((req.body && req.body.tipAmount) || "0", 10);
    if (!Number.isFinite(tipAmount) || tipAmount < 0) tipAmount = 0;
    if (tipAmount > 1000000) tipAmount = 1000000; // অস্বাভাবিক বড় সংখ্যা আটকানো
    challengeQueue.push({ id, name, photoUrl, tipAmount, joinedAt: Date.now() });
    res.json({ id });
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
    });
  });

  app.post("/gaming/challenge/move", express.json(), (req, res) => {
    const { id, from, to } = req.body || {};
    if (!activeChallenge || activeChallenge.id !== id) return res.json({ ok: false, error: "এই মুহূর্তে আপনার turn না" });
    if (activeChallenge.chess.turn() !== "b") return res.json({ ok: false, error: "এখনো আপনার turn আসেনি" });
    const move = activeChallenge.chess.move({ from, to, promotion: "q" });
    if (!move) return res.json({ ok: false, error: "অবৈধ চাল" });
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

  console.log("✅ gaming.js mount হয়েছে — /gaming/overlay/chess, /gaming/overlay/sports, /gaming/challenge/join এ পাওয়া যাবে।");
};

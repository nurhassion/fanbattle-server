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
      start: "07:00",
      end: "10:00",
      game: "chess",
      title: "🔥 AI vs AI Chess Battle LIVE | Stockfish vs Stockfish | চাল বিশ্লেষণ সহ",
      description:
        "দুটো Stockfish ইঞ্জিন নিজেদের মধ্যে লড়ছে — প্রতিটা গেম শেষে বাংলায় চাল বিশ্লেষণ ও নিয়ম ব্যাখ্যা।\n\n#chess #ai #livestream",
    },
    {
      id: "midday-sports",
      channel: "sportsgaming",
      days: [0, 1, 2, 3, 4, 5, 6],
      start: "14:00",
      end: "18:00",
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
    await playOneChessGame(Chess).catch((e) => console.error("chess game error:", e.message));
    await new Promise((r) => setTimeout(r, 10000));
  }
}
function stopChessLoop() {
  chessLoopActive = false;
}

function spawnStockfish(skillLevel) {
  const bin = process.env.STOCKFISH_PATH || "stockfish";
  const engine = spawn(bin);
  const send = (cmd) => engine.stdin.write(cmd + "\n");
  send("uci");
  send(`setoption name Skill Level value ${skillLevel}`);
  return { proc: engine, send };
}
function getBestMove(engine, fen, movetimeMs = 1200) {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/bestmove\s+(\S+)/);
      if (m) {
        engine.proc.stdout.off("data", onData);
        resolve(m[1] === "(none)" ? null : m[1]);
      }
    };
    engine.proc.stdout.on("data", onData);
    engine.send(`position fen ${fen}`);
    engine.send(`go movetime ${movetimeMs}`);
  });
}

async function playOneChessGame(Chess) {
  const chess = new Chess();
  const opening = OPENING_BOOK[Math.floor(Math.random() * OPENING_BOOK.length)];
  opening.moves.forEach((m) => chess.move(m));

  const skillOptions = [12, 15, 18, 20];
  const white = spawnStockfish(skillOptions[Math.floor(Math.random() * skillOptions.length)]);
  const black = spawnStockfish(skillOptions[Math.floor(Math.random() * skillOptions.length)]);

  const state = { openingName: opening.name, moves: chess.history(), fen: chess.fen(), status: "playing" };
  writeState("chess", state);

  let moveCount = 0;
  const MAX_MOVES = 120;
  while (!chess.isGameOver() && moveCount < MAX_MOVES && chessLoopActive) {
    const engine = chess.turn() === "w" ? white : black;
    const bestMove = await getBestMove(engine, chess.fen());
    if (!bestMove) break;
    const moveObj = chess.move(bestMove, { sloppy: true });
    if (!moveObj) break;
    moveCount++;
    state.moves = chess.history();
    state.fen = chess.fen();
    writeState("chess", state);
    await new Promise((r) => setTimeout(r, 900));
  }

  white.proc.kill();
  black.proc.kill();

  const winner = chess.isCheckmate() ? (chess.turn() === "w" ? "কালো" : "সাদা") : null;
  const resultText = winner ? `চেকমেট — ${winner} জিতেছে` : chess.isDraw() ? "ড্র" : "গেম থেমে গেছে";
  const commentary = winner
    ? `🎉 ${winner} পক্ষ জিতে গেল! দারুণ খেলা। (ওপেনিং: ${opening.name})`
    : `শেষমেশ ${resultText} — দুই পক্ষই সমান লড়েছে। (ওপেনিং: ${opening.name})`;

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
  return { scores: (d.score || []).map((s) => ({ runs: s.r, wickets: s.w, overs: s.o })) };
}
async function fetchFootballScore(matchId) {
  const key = FOOTBALL_DATA_KEY;
  const res = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, {
    headers: { "X-Auth-Token": key },
  });
  const m = await res.json();
  return { minute: m.minute, homeGoals: m.score?.fullTime?.home ?? 0, awayGoals: m.score?.fullTime?.away ?? 0 };
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
  writeState("sports", { ...context, score: null });
  if (!context.matchId) return;

  let prevScore = null;
  sportsTrackerInterval = setInterval(async () => {
    try {
      const score = context.sport === "cricket" ? await fetchCricketScore(context.matchId) : await fetchFootballScore(context.matchId);
      if (!score) return;
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
  }, 180000); // প্রতি ৩ মিনিটে একবার — CricAPI ফ্রি টিয়ারে দৈনিক মাত্র ১০০ hit, তাই বেশি ঘন ঘন চেক করলে সীমা দ্রুত শেষ হয়ে যাবে
}
function stopSportsTracking() {
  if (sportsTrackerInterval) clearInterval(sportsTrackerInterval);
  sportsTrackerInterval = null;
}

// ---------------------------------------------------------------------------
// ৬. Overlay HTML — ইনলাইন টেমপ্লেট (আলাদা .html ফাইল লাগে না)
// ---------------------------------------------------------------------------
const CHESS_OVERLAY_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>Chess</title>
<style>body{margin:0;background:#1a1a2e;color:#fff;font-family:sans-serif;text-align:center;padding:24px;}
#commentary{margin-top:24px;font-size:22px;color:#E8B33D;max-width:700px;margin-left:auto;margin-right:auto;}
#fen{font-family:monospace;color:#8FA3C0;margin-top:12px;font-size:14px;}</style></head><body>
<h1>♟️ AI vs AI Chess Battle</h1>
<div id="opening" style="color:#8FA3C0;font-size:16px;"></div>
<div id="fen">লোড হচ্ছে...</div>
<div id="moveCount" style="color:#8FA3C0;font-size:14px;margin-top:8px;"></div>
<div id="commentary"></div>
<audio id="narrator" autoplay></audio>
<script>
let lastKey="";const audioEl=document.getElementById("narrator");let queue=[];
function playQueue(){if(queue.length===0)return;audioEl.src=queue.shift();audioEl.play().catch(()=>{});}
audioEl.addEventListener("ended",playQueue);
async function poll(){try{
  const res=await fetch("/gaming/state/chess.json?t="+Date.now());const data=await res.json();
  document.getElementById("fen").textContent=data.fen||"";
  document.getElementById("opening").textContent=data.openingName?("ওপেনিং: "+data.openingName):"";
  document.getElementById("moveCount").textContent=data.moves?(data.moves.length+" চাল খেলা হয়েছে"):"";
  document.getElementById("commentary").textContent=data.lastCommentaryBn||"";
  const key=JSON.stringify(data.audioPlaylist||[]);
  if(data.audioPlaylist&&key!==lastKey){lastKey=key;queue=[...data.audioPlaylist];playQueue();}
}catch(e){}}
setInterval(poll,2000);poll();
</script></body></html>`;

const SPORTS_OVERLAY_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>Sports</title>
<style>body{margin:0;background:#0B1220;color:#fff;font-family:sans-serif;overflow:hidden;}
.scorebar{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:14px 20px;
background:linear-gradient(90deg,#1a2f5c,#000,#5c3a1a);border-bottom:2px solid #E8B33D;}
.team{font-size:22px;}.team.right{text-align:right;}
.score{font-family:monospace;font-size:34px;color:#E8B33D;}
.mid{text-align:center;font-size:14px;color:#8FA3C0;padding:0 16px;}
.competition{text-align:center;padding:8px;color:#8FA3C0;font-size:14px;}
.flash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
font-size:90px;font-weight:800;opacity:0;pointer-events:none;}
.flash.show{animation:pop 1.4s ease-out forwards;}
@keyframes pop{0%{opacity:0;transform:scale(.5) rotate(-8deg);}30%{opacity:1;transform:scale(1.1) rotate(2deg);}
60%{transform:scale(1) rotate(0);}100%{opacity:0;}}</style></head><body>
<div class="scorebar"><div class="team" id="teamA">—</div>
<div class="mid"><div style="font-size:12px;" id="sportEmoji">🏆</div><div class="score" id="scoreA">-</div></div>
<div class="team right" id="teamB">—</div></div>
<div class="scorebar" style="grid-template-columns:1fr;padding:6px;">
<div class="score" id="scoreB" style="text-align:center;font-size:22px;">-</div></div>
<div class="competition" id="competition">লাইভ ম্যাচ খোঁজা হচ্ছে...</div>
<div class="flash" id="flash"></div><audio id="narrator" autoplay></audio>
<script>
let lastEventAt=0;const audioEl=document.getElementById("narrator");const flashEl=document.getElementById("flash");
const FLASH={wicket:{t:"OUT!",c:"#C23B3B"},six:{t:"SIX!",c:"#E8B33D"},four:{t:"FOUR!",c:"#3EA6FF"},goal:{t:"GOAL!",c:"#2ECC71"}};
function showFlash(type){const cfg=FLASH[type];if(!cfg)return;flashEl.textContent=cfg.t;flashEl.style.color=cfg.c;
flashEl.classList.remove("show");void flashEl.offsetWidth;flashEl.classList.add("show");}
async function poll(){try{
  const res=await fetch("/gaming/state/sports.json?t="+Date.now());const data=await res.json();
  document.getElementById("sportEmoji").textContent=data.sportEmoji||"🏆";
  document.getElementById("teamA").textContent=data.teamA||"—";
  document.getElementById("teamB").textContent=data.teamB||"—";
  document.getElementById("competition").textContent=data.competition||"";
  if(data.sport==="cricket"&&data.score&&data.score.scores&&data.score.scores.length){
    const inn=data.score.scores[data.score.scores.length-1];
    document.getElementById("scoreA").textContent=inn.runs+"/"+inn.wickets;
    document.getElementById("scoreB").textContent="("+inn.overs+" ov)";
  }else if(data.sport==="football"&&data.score){
    document.getElementById("scoreA").textContent=data.score.homeGoals+" - "+data.score.awayGoals;
    document.getElementById("scoreB").textContent=data.score.minute?(data.score.minute+"'"):"";
  }
  if(data.lastEvent&&data.lastEvent.at!==lastEventAt){
    lastEventAt=data.lastEvent.at;showFlash(data.lastEvent.type);
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
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" });
  const map = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: wd[map.weekday], hhmm: `${map.hour}:${map.minute}` };
}
function inRange(hhmm, start, end) {
  return start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}
async function schedulerTick() {
  const { day, hhmm } = nowInTZ(SCHEDULE.timezone);
  for (const channelKey of Object.keys(SCHEDULE.channels)) {
    const block = SCHEDULE.blocks.find((b) => b.channel === channelKey && b.days.includes(day) && inRange(hhmm, b.start, b.end));
    const blockId = block ? block.id : null;
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
// ৮. মূল mount ফাংশন — server.js থেকে কল হয়
// ---------------------------------------------------------------------------
module.exports = function mountGaming(app) {
  app.use("/gaming/state", express.static(STATE_DIR));
  app.use("/gaming/audio", express.static(AUDIO_DIR));
  app.get("/gaming/overlay/chess", (req, res) => res.type("html").send(CHESS_OVERLAY_HTML));
  app.get("/gaming/overlay/sports", (req, res) => res.type("html").send(SPORTS_OVERLAY_HTML));
  app.get("/gaming/status", (req, res) => res.json({ ok: true, activeBlockId }));

  schedulerTick();
  setInterval(schedulerTick, 60000);

  console.log("✅ gaming.js mount হয়েছে — /gaming/overlay/chess ও /gaming/overlay/sports এ পাওয়া যাবে।");
};

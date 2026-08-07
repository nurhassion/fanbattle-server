// chessRunner.js
// দুটো Stockfish ইনস্ট্যান্স একে অপরের বিরুদ্ধে খেলায় (UCI প্রোটোকল দিয়ে),
// chess.js দিয়ে প্রতিটা চাল বৈধ কিনা যাচাই করে এবং গেম-শেষ (mate/stalemate/
// threefold repetition/50-move rule) নিজে থেকে ধরে। প্রতিটা চাল state.json এ
// লেখা হয় যাতে overlay পেজ বোর্ড আঁকতে পারে। গেম শেষ হলে ছোট বাংলা বিশ্লেষণ
// তৈরি হয়, আর পরের গেম ভিন্ন ওপেনিং/skill দিয়ে শুরু হয় — একঘেয়ে/রিপিট এড়াতে।
//
// *** দরকার: sudo apt install stockfish   &&   npm install chess.js ***

const { spawn } = require("child_process");
const { Chess } = require("chess.js");
const fs = require("fs");
const path = require("path");
const { getFullRulesText } = require("./rulesExplainer");
const { textToSpeech } = require("./ttsGenerator");

// Docker/Render কন্টেইনারে stockfish সাধারণত PATH-এ থাকে ("stockfish" নামে চলে)।
// Windows-এ লোকাল টেস্ট করলে STOCKFISH_PATH env var দিয়ে .exe এর পুরো path
// বসাতে পারেন (.env এ STOCKFISH_PATH=C:\path\to\stockfish.exe)।
const STOCKFISH_BIN = process.env.STOCKFISH_PATH || "stockfish";

const STATE_DIR = path.join(__dirname, "..", "public", "state");
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

const activeGames = {}; // channelKey -> { stop: fn }

// পরপর গেম একঘেয়ে না লাগার জন্য কয়েকটা জনপ্রিয় ওপেনিং লাইন (SAN মুভ) —
// এখান থেকে একটা র‍্যান্ডমলি বেছে প্রথম কয়েকটা চাল "ফিক্সড" রাখা হয়,
// তারপর থেকে দুই ইঞ্জিনই নিজে থেকে খেলে।
const OPENING_BOOK = [
  { name: "Ruy Lopez", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"] },
  { name: "Sicilian Defence", moves: ["e4", "c5", "Nf3", "d6", "d4"] },
  { name: "Queen's Gambit", moves: ["d4", "d5", "c4"] },
  { name: "King's Indian Defence", moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"] },
  { name: "English Opening", moves: ["c4", "e5", "Nc3"] },
  { name: "Caro-Kann Defence", moves: ["e4", "c6", "d4", "d5"] },
];

// প্রতিটা গেমে ইঞ্জিনের strength একটু বদলে দেওয়া হয় (Skill Level 0-20),
// যাতে সবসময় "নিখুঁত" রোবোটিক খেলা না হয়ে মাঝেমধ্যে ছোটখাটো ভুলও দেখা যায় —
// এতে ধারাভাষ্যে "এখানে ভুল হয়েছে" বলার মতো বাস্তব মুহূর্তও আসে।
function randomSkillLevel() {
  const options = [12, 15, 18, 20]; // 20 = full strength
  return options[Math.floor(Math.random() * options.length)];
}

function statePath(channelKey) {
  return path.join(STATE_DIR, `chess-${channelKey}.json`);
}

function writeState(channelKey, state) {
  fs.writeFileSync(statePath(channelKey), JSON.stringify(state, null, 2));
}

function spawnEngine(skillLevel) {
  const engine = spawn(STOCKFISH_BIN);
  const send = (cmd) => engine.stdin.write(cmd + "\n");
  send("uci");
  send(`setoption name Skill Level value ${skillLevel}`);
  send("isready");
  return { proc: engine, send };
}

// stockfish-কে একটা position দিয়ে "go movetime" চালিয়ে bestmove ফেরত আনা —
// UCI আউটপুট লাইন-বাই-লাইন আসে, "bestmove xxxx" খুঁজে বের করি।
function getBestMove(engine, fen, movetimeMs = 1200) {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (data) => {
      buffer += data.toString();
      const match = buffer.match(/bestmove\s+(\S+)/);
      if (match) {
        engine.proc.stdout.off("data", onData);
        resolve(match[1] === "(none)" ? null : match[1]);
      }
    };
    engine.proc.stdout.on("data", onData);
    engine.send(`position fen ${fen}`);
    engine.send(`go movetime ${movetimeMs}`);
  });
}

async function playOneGame(channelKey) {
  const chess = new Chess();
  const opening = OPENING_BOOK[Math.floor(Math.random() * OPENING_BOOK.length)];
  opening.moves.forEach((m) => chess.move(m)); // ওপেনিং লাইন বসিয়ে দেওয়া, র‍্যান্ডমনেস আনতে

  const skillWhite = randomSkillLevel();
  const skillBlack = randomSkillLevel();
  const engineWhite = spawnEngine(skillWhite);
  const engineBlack = spawnEngine(skillBlack);
  activeGames[channelKey] = { engines: [engineWhite, engineBlack], stopped: false };

  const state = {
    openingName: opening.name,
    moves: chess.history(),
    fen: chess.fen(),
    status: "playing",
    lastCommentaryBn: `আজকের ওপেনিং: ${opening.name}। খেলা শুরু হচ্ছে...`,
    mistakes: [], // { moveNumber, side, evalDropCp } — বড় ভুল হলে এখানে জমা হয়
    startedAt: Date.now(),
  };
  writeState(channelKey, state);

  const MAX_MOVES = 120; // অসীম দীর্ঘ গেম আটকাতে একটা সীমা
  let moveCount = chess.history().length;

  while (!chess.isGameOver() && moveCount < MAX_MOVES) {
    if (activeGames[channelKey]?.stopped) break;

    const turnEngine = chess.turn() === "w" ? engineWhite : engineBlack;
    const sideLabel = chess.turn() === "w" ? "সাদা" : "কালো";

    const evalBefore = await getEvalCp(turnEngine, chess.fen());
    const bestMove = await getBestMove(turnEngine, chess.fen());
    if (!bestMove) break;

    const moveObj = chess.move(bestMove, { sloppy: true }); // UCI ফরম্যাট (e2e4) parse
    if (!moveObj) break; // অবৈধ হলে নিরাপদে থেমে যাওয়া

    const evalAfter = await getEvalCp(turnEngine, chess.fen());
    const evalDrop = evalBefore !== null && evalAfter !== null ? evalBefore + evalAfter : 0;

    // eval অনেকটা খারাপ হলে (>150 centipawn) সেটাকে "ভুল চাল" হিসেবে নোট করা,
    // পরে কমেন্ট্রিতে ব্যবহারের জন্য
    if (Math.abs(evalDrop) > 150) {
      state.mistakes.push({ moveNumber: moveCount + 1, side: sideLabel, san: moveObj.san });
    }

    moveCount++;
    state.moves = chess.history();
    state.fen = chess.fen();
    writeState(channelKey, state);

    await new Promise((r) => setTimeout(r, 900)); // দর্শক পড়তে পারার মতো গতি
  }

  state.status = "finished";
  state.result = chess.isCheckmate()
    ? `চেকমেট — ${chess.turn() === "w" ? "কালো" : "সাদা"} জিতেছে`
    : chess.isDraw()
    ? "ড্র"
    : "গেম থেমে গেছে";
  state.lastCommentaryBn = generateCommentaryBn(state, opening);
  writeState(channelKey, state);

  // --- Real voice narration ---
  // ১. এই গেমের ফলাফল ও ভুল-বিশ্লেষণ অংশটুকু TTS করা (প্রতিবার নতুন, কারণ টেক্সট আলাদা)
  // ২. তার পরে গুটির নিয়মের ব্যাখ্যা জোড়া হয় (স্থির টেক্সট, cache থেকে সরাসরি আসবে
  //    দ্বিতীয়বার থেকে — তাই বারবার TTS বানানোর খরচ/সময় লাগবে না)
  try {
    const resultAudioUrl = await textToSpeech(state.lastCommentaryBn);
    const rulesAudioUrl = await textToSpeech(getFullRulesText());
    state.audioPlaylist = [resultAudioUrl, rulesAudioUrl]; // overlay পেজ এই দুটো পরপর বাজাবে
    writeState(channelKey, state);
  } catch (err) {
    console.error(
      "TTS তৈরি করতে সমস্যা হয়েছে (edge-tts ইনস্টল আছে কিনা চেক করুন: pip install edge-tts):",
      err.message
    );
  }

  engineWhite.proc.kill();
  engineBlack.proc.kill();
}

// eval আলাদাভাবে একবার query করার helper (centipawn score)
function getEvalCp(engine, fen) {
  return new Promise((resolve) => {
    let buffer = "";
    let resolved = false;
    const onData = (data) => {
      buffer += data.toString();
      const scoreMatch = buffer.match(/score cp (-?\d+)/);
      const mateMatch = buffer.match(/score mate (-?\d+)/);
      if ((scoreMatch || mateMatch) && buffer.includes("bestmove") && !resolved) {
        resolved = true;
        engine.proc.stdout.off("data", onData);
        resolve(mateMatch ? (parseInt(mateMatch[1]) > 0 ? 1000 : -1000) : parseInt(scoreMatch[1]));
      }
    };
    engine.proc.stdout.on("data", onData);
    engine.send(`position fen ${fen}`);
    engine.send("go movetime 300");
    setTimeout(() => {
      if (!resolved) {
        engine.proc.stdout.off("data", onData);
        resolve(null);
      }
    }, 800);
  });
}

function generateCommentaryBn(state, opening) {
  const winner = state.result.includes("সাদা জিতেছে")
    ? "সাদা"
    : state.result.includes("কালো জিতেছে")
    ? "কালো"
    : null;

  let openingLine = "";
  if (winner) {
    openingLine = `🎉 ${winner} পক্ষ জিতে গেল! দারুণ খেলা দেখাল। অন্য পক্ষের জন্য একটু দুঃখ লাগছে, কিন্তু চলুন দেখি কোথায় খেলাটা ঘুরে গিয়েছিল। `;
  } else {
    openingLine = `শেষমেশ ড্র হলো — দুই পক্ষই সমান শক্তি নিয়ে লড়েছে, কেউ কাউকে ছাড় দেয়নি। `;
  }

  if (state.mistakes.length === 0) {
    return `${openingLine}এই গেমে (ওপেনিং: ${opening.name}) দুই পক্ষই মোটামুটি নিখুঁত খেলেছে, বড় কোনো ভুল হয়নি।`;
  }

  const bigMistake = state.mistakes[state.mistakes.length - 1];
  return (
    `${openingLine}এই গেমে (ওপেনিং: ${opening.name}) সবচেয়ে বড় মোড় ছিল ${bigMistake.moveNumber} নম্বর চালে — ` +
    `${bigMistake.side} পক্ষের ${bigMistake.san} চালটা সুবিধা হাতছাড়া করে দেয়। এখানে যদি অন্য চাল খেলা হতো, ফলাফল অন্যরকম হতে পারত।`
  );
}

async function startNewMatchLoop(channelKey) {
  stop(channelKey);
  const loop = async () => {
    if (activeGames[channelKey]?.stopped) return;
    await playOneGame(channelKey);
    if (activeGames[channelKey] && !activeGames[channelKey].stopped) {
      activeGames[channelKey].timer = setTimeout(loop, 10000); // বিরতি, তারপর নতুন গেম (নতুন ওপেনিং/skill)
    }
  };
  activeGames[channelKey] = { stopped: false };
  loop();
}

function stop(channelKey) {
  const g = activeGames[channelKey];
  if (!g) return;
  g.stopped = true;
  if (g.timer) clearTimeout(g.timer);
  g.engines?.forEach((e) => e.proc.kill());
  delete activeGames[channelKey];
}

module.exports = { startNewMatchLoop, stop };


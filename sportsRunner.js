// sportsRunner.js
// লাইভ স্কোর ডেটা (রান/গোল/ওভার/মিনিট) টানে ফ্রি, legal score API থেকে —
// raw ফুটেজ/broadcast কোনোটাই ব্যবহার হয় না, শুধু সংখ্যা/তথ্য (কপিরাইট-মুক্ত)।
// প্রতিটা নতুন event (উইকেট/চার-ছয়/গোল) ধরলেই TTS দিয়ে সাথে সাথে
// real-voice commentary বলা হয় — শুধু লেখা না।
//
// *** দরকার (ফ্রি সাইনআপ) ***
//   ক্রিকেট:  https://cricketdata.org  → CRICAPI_KEY
//   ফুটবল:   https://www.football-data.org → FOOTBALL_DATA_KEY
// দুটোই .env ফাইলে বসান।

const fs = require("fs");
const path = require("path");
const { textToSpeech } = require("./ttsGenerator");

const STATE_DIR = path.join(__dirname, "..", "public", "state");
if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

const trackers = {}; // channelKey -> { intervalId, lastSnapshot }

function statePath(channelKey) {
  return path.join(STATE_DIR, `sports-${channelKey}.json`);
}
function writeState(channelKey, state) {
  fs.writeFileSync(statePath(channelKey), JSON.stringify(state, null, 2));
}

// --- ক্রিকেট: CricAPI ---
async function findLiveCricketMatch() {
  const key = process.env.CRICAPI_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${key}&offset=0`);
  const json = await res.json();
  const matches = (json.data || []).filter((m) => m.matchStarted && !m.matchEnded);
  if (matches.length === 0) return null;

  // priority: বড় টুর্নামেন্ট (নামে IPL/World Cup/ইত্যাদি থাকলে) আগে দেখানো
  const priorityKeywords = ["world cup", "ipl", "t20 world cup", "champions trophy", "asia cup"];
  matches.sort((a, b) => {
    const aScore = priorityKeywords.some((k) => (a.series_id + a.name).toLowerCase().includes(k)) ? 1 : 0;
    const bScore = priorityKeywords.some((k) => (b.series_id + b.name).toLowerCase().includes(k)) ? 1 : 0;
    return bScore - aScore;
  });

  const m = matches[0];
  return {
    sport: "cricket",
    sportEmoji: "🏏",
    matchId: m.id,
    teamA: m.teams?.[0] || "Team A",
    teamB: m.teams?.[1] || "Team B",
    competition: m.name || m.series_id || "লাইভ ক্রিকেট ম্যাচ",
  };
}

async function fetchCricketScore(matchId) {
  const key = process.env.CRICAPI_KEY;
  const res = await fetch(`https://api.cricapi.com/v1/match_info?apikey=${key}&id=${matchId}`);
  const json = await res.json();
  const d = json.data;
  if (!d) return null;
  return {
    status: d.status,
    scores: (d.score || []).map((s) => ({
      inningsLabel: s.inning,
      runs: s.r,
      wickets: s.w,
      overs: s.o,
    })),
  };
}

// --- ফুটবল: football-data.org ---
async function findLiveFootballMatch() {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return null;
  const res = await fetch("https://api.football-data.org/v4/matches?status=LIVE", {
    headers: { "X-Auth-Token": key },
  });
  const json = await res.json();
  const matches = json.matches || [];
  if (matches.length === 0) return null;

  const priorityLeagues = ["Champions League", "Premier League", "FIFA World Cup", "Copa America", "European Championship"];
  matches.sort((a, b) => {
    const aScore = priorityLeagues.includes(a.competition?.name) ? 1 : 0;
    const bScore = priorityLeagues.includes(b.competition?.name) ? 1 : 0;
    return bScore - aScore;
  });

  const m = matches[0];
  return {
    sport: "football",
    sportEmoji: "⚽",
    matchId: m.id,
    teamA: m.homeTeam?.shortName || m.homeTeam?.name || "Team A",
    teamB: m.awayTeam?.shortName || m.awayTeam?.name || "Team B",
    competition: m.competition?.name || "লাইভ ফুটবল ম্যাচ",
  };
}

async function fetchFootballScore(matchId) {
  const key = process.env.FOOTBALL_DATA_KEY;
  const res = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, {
    headers: { "X-Auth-Token": key },
  });
  const json = await res.json();
  const m = json;
  if (!m) return null;
  return {
    status: m.status,
    minute: m.minute,
    homeGoals: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? 0,
    awayGoals: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? 0,
  };
}

// "এখন সবচেয়ে বড় ম্যাচ কোনটা" — ক্রিকেট আর ফুটবল দুটোই চেক করে, যেটা পাওয়া
// যায় এবং schedule.json এর preferredSport মিললে সেটা অগ্রাধিকার পায়।
async function detectBestMatch(preferredSport) {
  const [cricket, football] = await Promise.all([
    findLiveCricketMatch().catch(() => null),
    findLiveFootballMatch().catch(() => null),
  ]);

  if (preferredSport === "cricket" && cricket) return cricket;
  if (preferredSport === "football" && football) return football;

  // auto-detect: যেটাই পাওয়া যায়, cricket কে সামান্য অগ্রাধিকার (upo অন্য কিছু না থাকলে)
  if (cricket) return cricket;
  if (football) return football;

  return {
    sport: null,
    sportEmoji: "📺",
    matchId: null,
    teamA: "কোনো",
    teamB: "লাইভ ম্যাচ নেই",
    competition: "এই মুহূর্তে কোনো বড় ম্যাচ চলছে না",
  };
}

function detectEvents(prevScore, newScore, sport) {
  const events = [];
  if (!prevScore || !newScore) return events;

  if (sport === "cricket") {
    const prevInn = prevScore.scores?.[prevScore.scores.length - 1];
    const newInn = newScore.scores?.[newScore.scores.length - 1];
    if (prevInn && newInn) {
      const runDiff = newInn.runs - prevInn.runs;
      const wicketDiff = newInn.wickets - prevInn.wickets;
      if (wicketDiff > 0) events.push({ type: "wicket", textBn: "উইকেট পড়ল! বড় ধাক্কা।" });
      else if (runDiff === 6) events.push({ type: "six", textBn: "ছক্কা! বল সীমানার বাইরে।" });
      else if (runDiff === 4) events.push({ type: "four", textBn: "চার! দারুণ শট।" });
    }
  } else if (sport === "football") {
    const goalDiff = newScore.homeGoals + newScore.awayGoals - (prevScore.homeGoals + prevScore.awayGoals);
    if (goalDiff > 0) events.push({ type: "goal", textBn: "গোওল!! দুর্দান্ত ফিনিশ।" });
  }
  return events;
}

async function startTracking(channelKey, context) {
  stop(channelKey);

  const state = { ...context, score: null, updatedAt: Date.now() };
  writeState(channelKey, state);
  let prevScore = null;

  trackers[channelKey] = { lastSnapshot: null };
  trackers[channelKey].intervalId = setInterval(async () => {
    if (!context.matchId) return;
    try {
      const score =
        context.sport === "cricket" ? await fetchCricketScore(context.matchId) : await fetchFootballScore(context.matchId);
      if (!score) return;

      const events = detectEvents(prevScore, score, context.sport);
      state.score = score;
      state.updatedAt = Date.now();
      writeState(channelKey, state);
      prevScore = score;

      // গুরুত্বপূর্ণ event ঘটলেই সাথে সাথে সেটা voice করে দেওয়া (state এ audioUrl বসানো,
      // overlay পেজ সেটা পড়ে বাজাবে)
      for (const ev of events) {
        try {
          const audioUrl = await textToSpeech(ev.textBn);
          state.lastEvent = { ...ev, audioUrl, at: Date.now() };
          writeState(channelKey, state);
        } catch (err) {
          console.error("event TTS সমস্যা:", err.message);
        }
      }
    } catch (err) {
      console.error(`[${channelKey}] score fetch সমস্যা:`, err.message);
    }
  }, 15000); // প্রতি ১৫ সেকেন্ডে চেক
}

function stop(channelKey) {
  if (trackers[channelKey]?.intervalId) {
    clearInterval(trackers[channelKey].intervalId);
  }
  delete trackers[channelKey];
}

module.exports = { detectBestMatch, startTracking, stop };


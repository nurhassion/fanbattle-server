// scheduler.js
// প্রতি মিনিটে চেক করে — এখন কোন block টা চলার কথা, আর সেটা অনুযায়ী
// broadcast শুরু/বদল/বন্ধ করার নির্দেশ দেয়। এটাই পুরো সিস্টেমের "ব্রেন"।

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const youtube = require("./youtubeClient");
const thumbnails = require("./thumbnailGenerator");
const gameRunners = require("./gameRunners");

const SCHEDULE_PATH = path.join(__dirname, "..", "config", "schedule.json");

// প্রতিটা চ্যানেলের এই মুহূর্তে কী চলছে সেটা মেমোরিতে রাখা হয়,
// যাতে একই block বারবার restart না হয়ে যায়।
const activeState = {}; // { [channelKey]: { blockId, broadcastId } }

function loadSchedule() {
  const raw = fs.readFileSync(SCHEDULE_PATH, "utf-8");
  return JSON.parse(raw);
}

function nowInTZ(timezone) {
  const now = new Date();
  // en-CA locale দেয় YYYY-MM-DD, HH:mm:ss ফরম্যাট — parse করা সহজ
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: weekdayMap[map.weekday],
    hhmm: `${map.hour}:${map.minute}`,
  };
}

function timeInRange(hhmm, start, end) {
  // end < start হলে (মধ্যরাত পার হওয়া ব্লক) সেটাও ঠিকঠাক হ্যান্ডল করে
  if (start <= end) return hhmm >= start && hhmm < end;
  return hhmm >= start || hhmm < end;
}

function findActiveBlock(schedule, channelKey) {
  const { day, hhmm } = nowInTZ(schedule.timezone);
  return schedule.blocks.find(
    (b) => b.channel === channelKey && b.days.includes(day) && timeInRange(hhmm, b.start, b.end)
  );
}

async function applyBlock(schedule, channelKey, block) {
  const channelCfg = schedule.channels[channelKey];
  const current = activeState[channelKey];

  if (block && current?.blockId === block.id) {
    return; // এই ব্লক আগে থেকেই চলছে, কিছু করার দরকার নেই
  }

  // আগের ব্রডকাস্ট (যদি থাকে) বন্ধ করা
  if (current?.broadcastId) {
    console.log(`[${channelKey}] আগের broadcast (${current.blockId}) বন্ধ করা হচ্ছে...`);
    await youtube.endBroadcast(channelCfg, current.broadcastId).catch((e) =>
      console.error("broadcast বন্ধ করতে সমস্যা:", e.message)
    );
    await gameRunners.stop(channelKey);
    activeState[channelKey] = null;
  }

  if (!block) return; // এখন এই চ্যানেলে কিছু চালানোর কথা না

  console.log(`[${channelKey}] নতুন ব্লক শুরু হচ্ছে: ${block.id} (${block.game})`);

  // ১. গেম ইঞ্জিন/স্কোরবোর্ড ব্যাকএন্ড চালু করা (এটা লোকাল ডেটা/state তৈরি করে,
  //    যেটা overlay পেজ পড়ে দেখাবে)
  const gameContext = await gameRunners.start(channelKey, block);

  // ২. টাইটেল/ডেসক্রিপশন টেমপ্লেট থেকে আসল টেক্সট বসানো
  const title = fillTemplate(block.titleTemplate, gameContext);
  const description = fillTemplate(block.descriptionTemplate, gameContext);

  // ৩. থাম্বনেইল বানানো
  const thumbnailPath = await thumbnails.generate(block.thumbnailTheme, gameContext);

  // ৪. YouTube-এ broadcast তৈরি ও লাইভ করা
  const broadcastId = await youtube.createAndGoLive(channelCfg, {
    title,
    description,
    thumbnailPath,
  });

  activeState[channelKey] = { blockId: block.id, broadcastId };
}

function fillTemplate(template, ctx) {
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_, key) => ctx[key] ?? "");
}

async function tick() {
  const schedule = loadSchedule();
  for (const channelKey of Object.keys(schedule.channels)) {
    const block = findActiveBlock(schedule, channelKey);
    try {
      await applyBlock(schedule, channelKey, block);
    } catch (err) {
      console.error(`[${channelKey}] scheduler error:`, err);
    }
  }
}

function startScheduler() {
  console.log("Scheduler চালু হলো — প্রতি মিনিটে schedule.json চেক হবে।");
  tick(); // অ্যাপ চালু হওয়ার সাথে সাথেই একবার চেক
  cron.schedule("* * * * *", tick);
}

module.exports = { startScheduler, tick, loadSchedule };

if (require.main === module && process.argv.includes("--dry-run")) {
  const schedule = loadSchedule();
  for (const channelKey of Object.keys(schedule.channels)) {
    const block = findActiveBlock(schedule, channelKey);
    console.log(channelKey, "→", block ? block.id : "(কিছু শিডিউল করা নেই এখন)");
  }
}

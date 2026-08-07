// gameRunners.js
// প্রতিটা "game" টাইপের জন্য (chess / sports-scoreboard) একটা লোকাল ওয়েব ওভারলে
// চালু করে, তারপর সেই ওভারলে পেজটাকে Xvfb (ভার্চুয়াল ডিসপ্লে) + Chrome + FFmpeg
// দিয়ে ক্যাপচার করে YouTube-এ RTMP push করে।
//
// *** VPS-এ আগে থেকে ইনস্টল থাকা দরকার (একবারই, README-তে কমান্ড দেওয়া আছে) ***
//   sudo apt install xvfb ffmpeg chromium-browser stockfish

const { spawn } = require("child_process");
const path = require("path");
const chessRunner = require("./chessRunner");
const sportsRunner = require("./sportsRunner");

const running = {}; // channelKey -> { overlayProcess, ffmpegProcess, xvfbDisplay }
const pendingStreamTargets = {}; // channelKey -> { ingestUrl, streamKey }

async function start(channelKey, block) {
  stop(channelKey); // আগে কিছু চলে থাকলে বন্ধ করে নতুন করে শুরু

  let overlayUrl;
  let context = {};

  if (block.game === "chess") {
    await chessRunner.startNewMatchLoop(channelKey);
    overlayUrl = `http://localhost:${process.env.PORT || 4500}/gaming/overlay/chess?channel=${channelKey}`;
    context = {}; // চেসের টাইটেলে কোনো টিম-নাম বসাতে হয় না
  } else if (block.game === "sports-scoreboard") {
    context = await sportsRunner.detectBestMatch(block.sport === "auto-detect" ? null : block.sport);
    await sportsRunner.startTracking(channelKey, context);
    overlayUrl = `http://localhost:${process.env.PORT || 4500}/gaming/overlay/sports?channel=${channelKey}`;
  } else {
    throw new Error(`অজানা game টাইপ: ${block.game}`);
  }

  running[channelKey] = { overlayUrl, ffmpegProcess: null, xvfbDisplay: null };

  // যদি YouTube stream target ইতিমধ্যে সেট হয়ে থাকে (createAndGoLive আগে কল হলে),
  // সাথে সাথেই ক্যাপচার+push শুরু করি। না হলে setStreamTarget() কল হলে শুরু হবে।
  if (pendingStreamTargets[channelKey]) {
    launchCapturePipeline(channelKey);
  }

  return context;
}

function setStreamTarget(channelCfg, ingestUrl, streamKey) {
  const channelKey = Object.keys(running).find((k) => running[k]); // সরল বাইন্ডিং; একাধিক চ্যানেল একসাথে চাইলে channelCfg দিয়ে ম্যাপ করুন
  if (!channelKey) return;
  pendingStreamTargets[channelKey] = { ingestUrl, streamKey };
  launchCapturePipeline(channelKey);
}

function launchCapturePipeline(channelKey) {
  const state = running[channelKey];
  const target = pendingStreamTargets[channelKey];
  if (!state || !target || state.ffmpegProcess) return;

  const display = `:${90 + Math.floor(Math.random() * 9)}`; // প্রতিটা চ্যানেলের জন্য আলাদা virtual display
  const scriptPath = path.join(__dirname, "..", "scripts", "stream-launcher.sh");

  const proc = spawn("bash", [scriptPath, state.overlayUrl, `${target.ingestUrl}/${target.streamKey}`, display], {
    stdio: "inherit",
  });

  state.ffmpegProcess = proc;
  state.xvfbDisplay = display;
  console.log(`[${channelKey}] ক্যাপচার+স্ট্রিম পাইপলাইন চালু: display ${display}`);
}

function stop(channelKey) {
  const state = running[channelKey];
  if (state?.ffmpegProcess) {
    state.ffmpegProcess.kill("SIGTERM");
  }
  delete running[channelKey];
  delete pendingStreamTargets[channelKey];
  chessRunner.stop(channelKey);
  sportsRunner.stop(channelKey);
}

module.exports = { start, stop, setStreamTarget };

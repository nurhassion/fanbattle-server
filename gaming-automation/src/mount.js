// mount.js
// এটা gaming-automation কে আলাদা সার্ভার হিসেবে না চালিয়ে, আপনার
// Fan Battle Live server.js-এর ভেতরেই যুক্ত করে দেয় — একই পোর্ট, একই process,
// একই pm2 entry। এতে VPS-এ আলাদা করে দ্বিতীয় সার্ভিস ম্যানেজ করার দরকার নেই।
//
// ব্যবহার (server.js এর মধ্যে, app.listen()-এর ঠিক আগে):
//
//   const mountGamingAutomation = require('./gaming-automation/src/mount');
//   mountGamingAutomation(app);
//
// এটা যা যোগ করে:
//   GET  /gaming/overlay/chess?channel=sportsgaming
//   GET  /gaming/overlay/sports?channel=sportsgaming
//   GET  /gaming/state/...      (JSON score/board state, ওভারলে পেজ নিজেই fetch করে)
//   GET  /gaming/audio/...      (TTS narration mp3)
//   GET  /gaming/thumbnails/... (auto-generated PNG)
// এবং ব্যাকগ্রাউন্ডে scheduler.js চালু করে দেয় (config/schedule.json অনুযায়ী)।

const path = require("path");
const express = require("express");

module.exports = function mountGamingAutomation(app) {
  const base = __dirname; // gaming-automation/src

  app.use("/gaming/state", express.static(path.join(base, "..", "public", "state")));
  app.use("/gaming/thumbnails", express.static(path.join(base, "..", "public", "thumbnails")));
  app.use("/gaming/audio", express.static(path.join(base, "..", "public", "audio")));

  app.get("/gaming/overlay/chess", (req, res) =>
    res.sendFile(path.join(base, "..", "public", "chess-overlay.html"))
  );
  app.get("/gaming/overlay/sports", (req, res) =>
    res.sendFile(path.join(base, "..", "public", "sports-overlay.html"))
  );

  // scheduler.js এর ভেতরের /state fetch path গুলো "/state/..." আকারে লেখা ছিল
  // (আলাদা সার্ভার হিসেবে চলার সময়)। এখন mount হওয়ার ফলে সেগুলো "/gaming/state/..."
  // হওয়া উচিত। overlay HTML দুটোতে (chess-overlay.html, sports-overlay.html)
  // fetch() কল করার সময় `/state/...` কে `/gaming/state/...` দিয়ে বদলে নিন —
  // (নিচে README-তে ঠিক কোন লাইন বদলাতে হবে, দেখানো আছে)।

  const { startScheduler } = require("./scheduler");
  startScheduler();

  console.log("✅ Gaming automation mount হয়েছে — /gaming/overlay/chess ও /gaming/overlay/sports এ পাওয়া যাবে।");
};

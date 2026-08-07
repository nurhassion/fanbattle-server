// index.js
// এটাই চালানোর মূল ফাইল: `npm start` বা `node src/index.js`
// এটা overlay পেজ সার্ভ করে (localhost:4500) এবং scheduler চালু করে,
// যেটা প্রতি মিনিটে schedule.json চেক করে সঠিক গেম/চ্যানেল চালু-বন্ধ করবে।

require("dotenv").config();
const express = require("express");
const path = require("path");
const { startScheduler } = require("./scheduler");

const app = express();
const PORT = process.env.PORT || 4500;

app.use("/state", express.static(path.join(__dirname, "..", "public", "state")));
app.use("/thumbnails", express.static(path.join(__dirname, "..", "public", "thumbnails")));
app.use("/audio", express.static(path.join(__dirname, "..", "public", "audio")));
app.get("/overlay/chess", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "chess-overlay.html")));
app.get("/overlay/sports", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "sports-overlay.html")));

app.get("/status", (req, res) => {
  res.json({ ok: true, message: "Gaming automation service চলছে।" });
});

app.listen(PORT, () => {
  console.log(`Overlay server: http://localhost:${PORT}`);
  startScheduler();
});

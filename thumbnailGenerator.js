// thumbnailGenerator.js
// প্রতিটা লাইভের জন্য নিজস্ব থাম্বনেইল আঁকে (node-canvas দিয়ে) — কোনো
// সোশ্যাল মিডিয়া থেকে ছবি স্ক্র্যাপ করা হয় না, তাই কপিরাইট-নিরাপদ।

const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "public", "thumbnails");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const THEMES = {
  chess: { bg: ["#1a1a2e", "#0f3460"], accent: "#E8B33D", label: "♟️ AI CHESS BATTLE" },
  sports: { bg: ["#0B1220", "#1A5C2E"], accent: "#3EA6FF", label: "🔴 LIVE SCORE" },
};

async function generate(theme, ctx) {
  const cfg = THEMES[theme] || THEMES.sports;
  const width = 1280,
    height = 720;
  const canvas = createCanvas(width, height);
  const g = canvas.getContext("2d");

  const gradient = g.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, cfg.bg[0]);
  gradient.addColorStop(1, cfg.bg[1]);
  g.fillStyle = gradient;
  g.fillRect(0, 0, width, height);

  g.fillStyle = cfg.accent;
  g.font = "bold 52px sans-serif";
  g.fillText(cfg.label, 60, 100);

  g.fillStyle = "#FFFFFF";
  g.font = "bold 72px sans-serif";
  const mainText = theme === "sports" && ctx.teamA ? `${ctx.teamA} vs ${ctx.teamB}` : "LIVE NOW";
  g.fillText(mainText, 60, 220);

  if (theme === "sports" && ctx.competition) {
    g.fillStyle = "#8FA3C0";
    g.font = "36px sans-serif";
    g.fillText(ctx.competition, 60, 280);
  }

  // "LIVE" ব্যাজ
  g.fillStyle = "#C23B3B";
  g.fillRect(width - 220, 40, 160, 60);
  g.fillStyle = "#FFFFFF";
  g.font = "bold 32px sans-serif";
  g.fillText("● LIVE", width - 195, 80);

  const outPath = path.join(OUT_DIR, `${theme}-${Date.now()}.png`);
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { generate };

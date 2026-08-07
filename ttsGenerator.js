// ttsGenerator.js
// ফ্রি Microsoft Edge TTS (neural voice, বাংলা সাপোর্ট করে) দিয়ে টেক্সট থেকে
// real voice audio বানায়। এটা কোনো Anthropic/Claude ফিচার না — এটা একটা
// আলাদা, ফ্রি ওপেন-সোর্স টুল (`edge-tts`), যেটা VPS-এ ইনস্টল করতে হবে:
//
//   pip install edge-tts
//
// বাংলা voice অপশন: bn-BD-NabanitaNeural (মহিলা), bn-BD-PradeepNeural (পুরুষ),
// bn-IN-TanishaaNeural, bn-IN-BashkarNeural — যেকোনো একটা বেছে নিতে পারেন।

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const AUDIO_DIR = path.join(__dirname, "..", "public", "audio");
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const VOICE = process.env.TTS_VOICE || "bn-BD-NabanitaNeural";

function hashText(text) {
  return crypto.createHash("md5").update(text).digest("hex").slice(0, 12);
}

// একই টেক্সটের জন্য বারবার নতুন audio বানানো এড়াতে — hash-ভিত্তিক cache।
// নিয়মের ব্যাখ্যা (rulesExplainer.js) স্থির টেক্সট, তাই এটা একবার বানালেই
// প্রতিটা গেমের শেষে reuse হবে — TTS কল/সময় বাঁচবে।
async function textToSpeech(text) {
  const filename = `${hashText(text)}.mp3`;
  const outPath = path.join(AUDIO_DIR, filename);

  if (fs.existsSync(outPath)) {
    return `/audio/${filename}`; // cache hit
  }

  await new Promise((resolve, reject) => {
    const proc = spawn("edge-tts", ["--voice", VOICE, "--text", text, "--write-media", outPath]);
    proc.on("error", reject); // edge-tts ইনস্টল না থাকলে এখানে ধরা পড়বে
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`edge-tts exited ${code}`))));
  });

  return `/audio/${filename}`;
}

module.exports = { textToSpeech };

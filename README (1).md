# Gaming Channel Automation

শিডিউল অনুযায়ী automatic গেম (চেস ইঞ্জিন ব্যাটেল / স্পোর্টস স্কোরবোর্ড) চালিয়ে,
টাইটেল-ডেসক্রিপশন-থাম্বনেইল নিজে বানিয়ে, YouTube-এ লাইভ শুরু-বন্ধ করে দেয়।

এটা আপনার আগের Fan Battle Live / Zero to Trader / Daily Needle সার্ভারের
**পাশে আলাদা সার্ভিস হিসেবে** চলবে — সেগুলোকে ছোঁয় না, ভাঙে না।

---

## ⚠️ সততার সাথে বলে রাখা দরকার — এই কোডে কী সম্পূর্ণ, কী placeholder

**✅ এখন সম্পূর্ণ:**
- চেস game loop (chess.js + Stockfish, র‍্যান্ডম ওপেনিং, র‍্যান্ডম skill level,
  eval-ড্রপ ধরে ভুল-চাল চিহ্নিতকরণ, threefold-repetition/checkmate handling)
- প্রতিটা গেম শেষে বাংলা ফলাফল + ভুল-বিশ্লেষণ + সেলিব্রেশন/সমবেদনা লাইন +
  সম্পূর্ণ গুটির নিয়ম ব্যাখ্যা (`rulesExplainer.js`)
- **Sports scoreboard — CricAPI (ক্রিকেট) + football-data.org (ফুটবল) দিয়ে
  আসল লাইভ ডেটা, priority-ভিত্তিক "সবচেয়ে বড় ম্যাচ" অটো-ডিটেকশন**
- **প্রতিটা উইকেট/চার/ছয়/গোল ধরা পড়লেই সাথে সাথে TTS দিয়ে real-voice
  event commentary + on-screen flash animation**
- Real voice narration — `edge-tts` (ফ্রি) দিয়ে TTS, নিয়মের অংশ cache হয়ে
  পুনরায় ব্যবহার হয় (বারবার নতুন করে বানাতে হয় না)
- Overlay পেজে audio auto-play queue

**⚠️ এখনও placeholder (বাইরের key/account লাগবে):**
1. **YouTube OAuth** — আপনার নিজের Google অনুমতি, একবার নিতে হবে (নিচে ধাপ)।
2. **CRICAPI_KEY / FOOTBALL_DATA_KEY** — দুটোই ফ্রি সাইনআপ করে `.env` এ বসাতে
   হবে, নইলে sports স্লট "কোনো লাইভ ম্যাচ নেই" দেখাবে।

---

## ধাপে ধাপে সেটআপ (VPS-এ, যেমন Hostinger VPS)

### ১. সার্ভার প্রস্তুত করা
```bash
sudo apt update
sudo apt install -y nodejs npm xvfb ffmpeg chromium-browser stockfish pulseaudio python3-pip
pip3 install edge-tts   # real voice narration-এর জন্য (ফ্রি, Microsoft Edge neural voice)
```

**বাংলা voice টেস্ট করতে:**
```bash
edge-tts --list-voices | grep bn-
edge-tts --voice bn-BD-NabanitaNeural --text "নমস্কার" --write-media test.mp3
```
`.env` ফাইলে `TTS_VOICE=bn-BD-NabanitaNeural` (বা পছন্দমতো অন্য voice) বসাতে পারেন।

### ২. এই ফোল্ডারটা VPS-এ আপলোড করে
```bash
cd gaming-automation
npm install
cp .env.example .env
# .env খুলে আপনার API key গুলো বসান
```

### ৩. YouTube API অনুমতি নেওয়া (একবারই)
1. https://console.cloud.google.com — নতুন প্রজেক্ট
2. "APIs & Services" → "YouTube Data API v3" enable করুন
3. "Credentials" → "Create Credentials" → "OAuth client ID" → "Desktop app"
4. JSON ডাউনলোড করে `config/credentials.json` নামে রাখুন
5. চালান: `node src/authorize.js` — একটা লিংক আসবে, ব্রাউজারে খুলে অনুমতি দিন,
   যে কোড পাবেন সেটা টার্মিনালে পেস্ট করুন

### ৪. `config/schedule.json` আপনার মতো করে সাজান
- কোন সময় কোন চ্যানেলে কোন গেম চলবে
- আপনার আসল YouTube Channel ID বসান

### ৫. Sports API key নেওয়া (ফ্রি)
1. **ক্রিকেট:** https://cricketdata.org → সাইনআপ → free plan এ API key পাবেন
2. **ফুটবল:** https://www.football-data.org/client/register → সাইনআপ → free tier key
3. দুটো key `.env` ফাইলে বসান (`CRICAPI_KEY`, `FOOTBALL_DATA_KEY`)

**ফ্রি tier-এর সীমা মাথায় রাখুন:** CricAPI ফ্রি প্ল্যানে দৈনিক request সীমিত
(সাধারণত ~100/day), football-data.org ফ্রি প্ল্যানেও রেট-লিমিট আছে
(প্রতি মিনিটে ~10 কল)। আমাদের কোড ১৫ সেকেন্ড পরপর poll করে — যদি ফ্রি-টিয়ারে
রেট-লিমিট এরর আসে, `sportsRunner.js`-এর `15000` (ms) সংখ্যাটা বাড়িয়ে দিন
(যেমন 30000 বা 60000)।

### ৬. চালু করুন
```bash
npm start
```
এটা `pm2` দিয়ে সবসময় background-এ চালিয়ে রাখা ভালো:
```bash
npm install -g pm2
pm2 start src/index.js --name gaming-automation
pm2 save
pm2 startup   # রিবুট হলেও যেন নিজে থেকে চালু হয়
```

---

## এটা কীভাবে কাজ করে (সংক্ষেপে)

```
schedule.json  →  scheduler.js (প্রতি মিনিটে চেক)
                       │
                       ├─ chessRunner.js / sportsRunner.js  (game state তৈরি)
                       ├─ thumbnailGenerator.js              (PNG থাম্বনেইল)
                       └─ youtubeClient.js                   (broadcast + go live)
                                │
                                └─ gameRunners.js → stream-launcher.sh
                                       (Xvfb + Chrome + FFmpeg → YouTube RTMP)
```

## পরের ধাপ কী হতে পারে

বলুন কোনটা আগে সম্পূর্ণ করব:
- চেস game loop (chess.js দিয়ে full legal move handling + eval-based ভুল ধরা)
- ক্রিকেট/ফুটবল score API-র আসল integration
- `authorize.js` চালিয়ে token নেওয়ার সময় কোনো সমস্যা হলে সাথে সাথে সমাধান

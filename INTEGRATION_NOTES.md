# Integration Notes — server.js + gaming-automation

## যা বদলানো হলো আপনার `server.js`-এ

1. **`CHANNELS`** অবজেক্টে দুটো নতুন এন্ট্রি যোগ হলো: `sportsgaming` ও `boardgames`
   (এখনো `youtubeUrl` placeholder — নিজের চ্যানেল লিংক বসিয়ে দিন)।
2. একদম নিচে, `app.listen()`-এর ঠিক আগে, gaming-automation mount করার কোড যোগ হলো —
   এটা `/gaming/overlay/chess` ও `/gaming/overlay/sports` রুট চালু করে এবং
   scheduler ব্যাকগ্রাউন্ডে শুরু করে দেয়।

## VPS-এ ফোল্ডার গঠন এরকম হতে হবে

```
your-project/
├── server.js              ← এই আপডেটেড ফাইলটা
├── (আপনার বাকি সব পুরনো ফাইল — records.json, overlay html, ইত্যাদি)
└── gaming-automation/      ← পুরো ফোল্ডারটা এখানে, server.js এর পাশে
    ├── src/
    ├── config/
    ├── public/
    └── package.json
```

## ইনস্টল করার সময় দুই জায়গায় `npm install` লাগবে

```bash
npm install                       # মূল প্রজেক্টে (server.js এর dependencies)
cd gaming-automation && npm install   # gaming-automation এর নিজস্ব dependencies
cd ..
```

## পরীক্ষা করুন

```bash
node server.js
```
কনসোলে এই লাইনটা দেখা উচিত:
```
✅ Gaming automation mount হয়েছে — /gaming/overlay/chess ও /gaming/overlay/sports এ পাওয়া যাবে।
```
যদি এর বদলে `⚠️ Gaming automation mount করা যায়নি...` দেখেন, তার মানে
`gaming-automation` ফোল্ডারটা ঠিক জায়গায় নেই বা তার ভেতরে `npm install` হয়নি —
error message-টা কপি করে পাঠান, ঠিক করে দেব।

## ব্রাউজারে চেক

`http://your-server:PORT/gaming/overlay/chess` খুললে চেসের ওভারলে পেজ আসা উচিত
(শুরুতে খালি/loading দেখাবে যতক্ষণ না `config/schedule.json` অনুযায়ী সেই সময়ে
চেস ব্লক active হয়)।

## Render-এ Docker দিয়ে deploy করবেন কীভাবে (VPS ছাড়াই, আপনার existing workflow ধরে রেখে)

আপনার আগের workflow-ই থাকছে — GitHub-এ ফাইল push/paste করলেই Render auto-deploy করবে। শুধু **একবারই** নিচের সেটআপ পরিবর্তন লাগবে:

### ১. GitHub রিপোতে নতুন ফাইল/ফোল্ডার যোগ করুন
- রিপোর **রুটে** `Dockerfile` (এই zip-এ দেওয়া আছে) আপলোড করুন
- `gaming-automation/` পুরো ফোল্ডারটা (সব সাব-ফোল্ডার সহ) রিপোতে আপলোড করুন —
  GitHub-এর web UI দিয়ে "Add file" → "Upload files" করলে ড্র্যাগ-ড্রপ দিয়ে পুরো
  ফোল্ডার একসাথে আপলোড করা যায়
- আপডেটেড `server.js` দিয়ে পুরনোটা replace করুন (Commit changes)

### ২. Render Dashboard-এ সার্ভিসের Environment বদলান
1. আপনার **fanbattle-server** সার্ভিসে যান
2. **Settings** ট্যাবে যান
3. **"Environment"** সেকশনে — এটা যদি "Node" হিসেবে সেট করা থাকে, **"Docker"**-এ বদলে দিন
   (Render আপনার রিপোর রুটে `Dockerfile` পেলে নিজে থেকেই সেটা ব্যবহার করে বিল্ড করবে)
4. **Save** করুন — Render নিজে থেকেই নতুন করে (Docker দিয়ে) rebuild/redeploy শুরু করবে
   এবার একটু বেশি সময় লাগবে (৫-১০ মিনিট, কারণ Xvfb/Chromium/FFmpeg ইনস্টল হচ্ছে)

### ৩. Environment Variables যোগ করুন (আগের মতোই "+ Add Environment Variable" দিয়ে)
- `CRICAPI_KEY`
- `FOOTBALL_DATA_KEY`
- `TTS_VOICE` (চাইলে, না দিলে ডিফল্ট `bn-BD-NabanitaNeural` ব্যবহার হবে)

### ৪. YouTube OAuth — এইটুকু লোকাল কম্পিউটার থেকে একবার করতে হবে
`config/credentials.json` ও `config/token.json` — এই দুটো ফাইল **একবার আপনার
নিজের কম্পিউটারে** (`node gaming-automation/src/authorize.js` চালিয়ে) বানাতে
হবে, তারপর সেই দুটো ফাইল GitHub রিপোতে (`gaming-automation/config/` এ) আপলোড
করে দিলেই Render-এর deploy-এ চলে যাবে।

### ৫. Deploy সফল হলে যা টেস্ট করবেন
`https://your-render-url.onrender.com/gaming/overlay/chess` ব্রাউজারে খুলে দেখুন।

---

## যদি এখনই Windows ল্যাপটপে টেস্ট করতে চান (Docker ছাড়াই, দ্রুত)

শুধু **overlay পেজ ও স্কোর লজিক** (streaming বাদে) টেস্ট করতে:
```
npm install
cd gaming-automation && npm install && cd ..
node server.js
```
তারপর ব্রাউজারে `http://localhost:3000/gaming/overlay/chess` খুলে দেখুন। এখানে
streaming pipeline চলবে না (Xvfb/Chromium Windows-এ নেই), কিন্তু বাকি সব
(scheduler, YouTube API কল, TTS, chess/sports logic) টেস্ট করতে পারবেন।


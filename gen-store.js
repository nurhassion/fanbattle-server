'use strict';
/*
 * gen-store.js — Play Store-এ তোলার জন্য যা যা লাগে
 *
 *   app.json          অ্যাপের নাম, আইকন, প্যাকেজ নাম
 *   eas.json          .apk (নিজের ফোনে) আর .aab (Play Store)
 *   make-icon.js      আইকন বানায় — প্রতিটা অ্যাপের আলাদা নকশা
 *   PRIVACY.md        প্রাইভেসি পলিসির খসড়া (বাধ্যতামূলক)
 *   STORE-LISTING.md  Play Console-এ যা যা লিখতে হবে, তৈরি করা
 *
 * ⚠️ সবচেয়ে জরুরি : প্যাকেজ নাম (com.___.___) পৃথিবীতে একটাই হতে পারে।
 *    তাই ইচ্ছে করে 'yourname' বসানো আছে — দর্শক নিজের নাম না বসানো পর্যন্ত
 *    app.json-এ সতর্কবার্তা থাকবে, আর DEPLOY.md-র STEP 18 সেটা ধরে ফেলবে।
 *    এতে দুজন দর্শকের অ্যাপ কখনো সংঘর্ষে পড়বে না।
 *
 * ⚠️ আইকন ZIP-এ ছবি হিসেবে যায় না — make-icon.js দর্শকের কম্পিউটারে
 *    সেটা বানায়। কারণ প্যাকেজে সব ফাইল লেখা (text), ছবি ঢোকালে নষ্ট হয়।
 */

/* স্লাগ থেকে স্থির সংখ্যা — একই অ্যাপে সবসময় একই নকশা */
function hash(s) {
  var h = 2166136261;
  s = String(s || 'app');
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

function pkgSlug(app) {
  return String(app.slug || 'app').toLowerCase().replace(/[^a-z0-9]/g, '') || 'app';
}

/* com.yourname.chatly0001 — সেট নম্বর জোড়া থাকায় ১০০০টা আলাদা */
function pkgName(app) {
  return 'com.yourname.' + pkgSlug(app) + String(app.num || '0000');
}

function accentOf(app) {
  var a = String(app.accent || '');
  return /^#[0-9a-fA-F]{6}$/.test(a) ? a : '#4F46E5';
}

/* ───────────────────────── app.json ───────────────────────── */
function appJson(app) {
  var o = {
    expo: {
      name: String(app.name || 'App'),
      slug: pkgSlug(app),
      version: '1.0.0',
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'automatic',
      splash: {
        image: './assets/icon.png',
        resizeMode: 'contain',
        backgroundColor: accentOf(app)
      },
      assetBundlePatterns: ['**/*'],
      android: {
        package: pkgName(app),
        versionCode: 1,
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: accentOf(app)
        }
      },
      ios: {
        bundleIdentifier: pkgName(app),
        supportsTablet: true
      },
      _README: [
        'CHANGE THIS BEFORE BUILDING / बनाने से पहले यह बदलिए:',
        '1. android.package and ios.bundleIdentifier — replace "yourname" with',
        '   your own name or website, e.g. com.rahulsharma.' + pkgSlug(app) + String(app.num || '0000'),
        '   This must be unique in the world. Two people cannot publish the same one.',
        '2. name — what users see under the icon. Make it yours.',
        '3. version — the number people see. versionCode — must go UP every upload.',
        'See DEPLOY.md STEP 18.'
      ]
    }
  };
  return JSON.stringify(o, null, 2) + '\n';
}

/* ───────────────────────── eas.json ───────────────────────── */
function easJson() {
  return JSON.stringify({
    cli: { version: '>= 5.0.0' },
    build: {
      development: { developmentClient: true, distribution: 'internal' },
      preview: {
        distribution: 'internal',
        android: { buildType: 'apk' }
      },
      production: {
        autoIncrement: true,
        android: { buildType: 'app-bundle' }
      }
    },
    submit: { production: {} }
  }, null, 2) + '\n';
}

/* ───────────────────────── make-icon.js ───────────────────────── */
/* খাঁটি Node, কোনো লাইব্রেরি লাগে না — zlib Node-এর ভেতরেই আছে */
function makeIcon(app) {
  var seed = hash(pkgSlug(app) + String(app.num || ''));
  var acc  = accentOf(app);
  return "'use strict';\n" +
"/*\n" +
" * make-icon.js — " + String(app.name || 'App') + "-এর আইকন বানায়\n" +
" *\n" +
" *   node make-icon.js\n" +
" *\n" +
" * assets/icon.png আর assets/adaptive-icon.png তৈরি হবে (1024x1024)।\n" +
" * নকশাটা এই অ্যাপের নিজস্ব — অন্য কোনো সেটের সাথে মিলবে না।\n" +
" *\n" +
" * নিজের আইকন থাকলে এটা চালানোর দরকার নেই — শুধু নিজের ছবি দুটো\n" +
" * assets/ ফোল্ডারে ওই নামে রাখুন (1024x1024 PNG)।\n" +
" */\n" +
"var fs = require('fs'), zlib = require('zlib'), path = require('path');\n" +
"\n" +
"var SEED = " + seed + ";\n" +
"var ACCENT = '" + acc + "';\n" +
"var SIZE = 1024, GRID = 5, CELL = 160, PAD = (SIZE - GRID * CELL) / 2;\n" +
"\n" +
"function hex(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}\n" +
"function mix(c,t,f){return c.map(function(v,i){return Math.round(v+(t[i]-v)*f);});}\n" +
"\n" +
"/* প্রতিবার একই ফল দেয় — তাই আইকনও প্রতিবার একই */\n" +
"var s = SEED;\n" +
"function rnd(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }\n" +
"\n" +
"function crc32(buf){\n" +
"  var t = crc32.t || (crc32.t = (function(){var a=[],c,n,k;for(n=0;n<256;n++){c=n;for(k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;a[n]=c>>>0;}return a;})());\n" +
"  var c = 0xFFFFFFFF;\n" +
"  for (var i=0;i<buf.length;i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);\n" +
"  return (c ^ 0xFFFFFFFF) >>> 0;\n" +
"}\n" +
"function chunk(type, data){\n" +
"  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);\n" +
"  var td  = Buffer.concat([Buffer.from(type, 'ascii'), data]);\n" +
"  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);\n" +
"  return Buffer.concat([len, td, crc]);\n" +
"}\n" +
"function png(pixels, w, h){\n" +
"  var raw = Buffer.alloc((w * 3 + 1) * h);\n" +
"  var o = 0;\n" +
"  for (var y = 0; y < h; y++){\n" +
"    raw[o++] = 0;\n" +
"    for (var x = 0; x < w; x++){\n" +
"      var p = (y * w + x) * 3;\n" +
"      raw[o++] = pixels[p]; raw[o++] = pixels[p+1]; raw[o++] = pixels[p+2];\n" +
"    }\n" +
"  }\n" +
"  var ihdr = Buffer.alloc(13);\n" +
"  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);\n" +
"  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;\n" +
"  return Buffer.concat([\n" +
"    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),\n" +
"    chunk('IHDR', ihdr),\n" +
"    chunk('IDAT', zlib.deflateSync(raw, {level: 9})),\n" +
"    chunk('IEND', Buffer.alloc(0))\n" +
"  ]);\n" +
"}\n" +
"\n" +
"function draw(){\n" +
"  var A = hex(ACCENT);\n" +
"  var bg  = mix(A, [0,0,0], 0.78);\n" +
"  var on  = A;\n" +
"  var on2 = mix(A, [255,255,255], 0.35);\n" +
"  var px = Buffer.alloc(SIZE * SIZE * 3);\n" +
"  for (var i = 0; i < SIZE * SIZE; i++){ px[i*3]=bg[0]; px[i*3+1]=bg[1]; px[i*3+2]=bg[2]; }\n" +
"\n" +
"  /* বাঁ অর্ধেক ঠিক করে ডানদিকে আয়নার মতো — তাই নকশা ভারসাম্যপূর্ণ দেখায় */\n" +
"  var half = Math.ceil(GRID / 2), cells = [];\n" +
"  for (var gy = 0; gy < GRID; gy++){\n" +
"    cells[gy] = [];\n" +
"    for (var gx = 0; gx < half; gx++) cells[gy][gx] = rnd() > 0.45 ? (rnd() > 0.7 ? 2 : 1) : 0;\n" +
"    for (var gx2 = half; gx2 < GRID; gx2++) cells[gy][gx2] = cells[gy][GRID - 1 - gx2];\n" +
"  }\n" +
"  cells[Math.floor(GRID/2)][Math.floor(GRID/2)] = 2;   /* মাঝখানটা সবসময় ভরা */\n" +
"\n" +
"  for (var y = 0; y < GRID; y++) for (var x = 0; x < GRID; x++){\n" +
"    var v = cells[y][x]; if (!v) continue;\n" +
"    var col = v === 2 ? on2 : on;\n" +
"    var x0 = Math.round(PAD + x * CELL), y0 = Math.round(PAD + y * CELL);\n" +
"    var g = 14;\n" +
"    for (var yy = y0 + g; yy < y0 + CELL - g; yy++)\n" +
"      for (var xx = x0 + g; xx < x0 + CELL - g; xx++){\n" +
"        var p = (yy * SIZE + xx) * 3;\n" +
"        px[p] = col[0]; px[p+1] = col[1]; px[p+2] = col[2];\n" +
"      }\n" +
"  }\n" +
"  return px;\n" +
"}\n" +
"\n" +
"try {\n" +
"  var dir = path.join(__dirname, 'assets');\n" +
"  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});\n" +
"  var buf = png(draw(), SIZE, SIZE);\n" +
"  fs.writeFileSync(path.join(dir, 'icon.png'), buf);\n" +
"  fs.writeFileSync(path.join(dir, 'adaptive-icon.png'), buf);\n" +
"  console.log('OK  assets/icon.png           ' + buf.length + ' bytes');\n" +
"  console.log('OK  assets/adaptive-icon.png  ' + buf.length + ' bytes');\n" +
"  console.log('');\n" +
"  console.log('Open the file to see it. Want your own picture instead?');\n" +
"  console.log('Just replace both files with your own 1024x1024 PNG.');\n" +
"} catch (e) {\n" +
"  console.log('FAILED: ' + e.message);\n" +
"  process.exit(1);\n" +
"}\n";
}

/* ───────────────────────── PRIVACY.md ───────────────────────── */
function privacy(app) {
  var name = String(app.name || 'App');
  return [
    '# Privacy Policy — ' + name,
    '',
    '> ## ⚠️ THIS IS A TEMPLATE — you must edit it',
    '>',
    '> Replace every **`[...]`** below with your own details, delete anything your app',
    '> does not do, then put this on a public web page. **Google will not publish your',
    '> app without a working privacy policy link.**',
    '>',
    '> ## ⚠️ यह एक नमूना है — इसे बदलना ज़रूरी है',
    '>',
    '> नीचे हर **`[...]`** की जगह अपनी जानकारी लिखिए, जो आपका app नहीं करता उसे हटा',
    '> दीजिए, फिर इसे किसी सार्वजनिक वेब पन्ने पर डालिए. **काम करने वाले privacy',
    '> policy लिंक के बिना Google आपका app प्रकाशित नहीं करेगा.**',
    '',
    '**Last updated: [date]**',
    '',
    '---',
    '',
    '## Who we are',
    '',
    'This app is operated by **[your name or company]**. You can reach us at **[your email]**.',
    '',
    '## What we collect',
    '',
    'Delete any line that does not apply to your app:',
    '',
    '- **Account information** — the name, phone number or email you give when signing up',
    '- **Content you create** — the things you post, send or upload inside the app',
    '- **Usage information** — basic records of actions taken in the app, used to keep it working',
    '- **Device information** — device type and app version, used to fix crashes',
    '',
    'We do **not** collect: [list anything you want to be explicit about].',
    '',
    '## Why we collect it',
    '',
    'To run the app, keep your account secure, show you your own content, and fix problems.',
    'We do not sell your personal information.',
    '',
    '## Who else sees it',
    '',
    'Your information is stored on **[your hosting provider]**. We share it only when the',
    'law requires it, or with services needed to run the app — **[list them, e.g. the',
    'hosting provider, any payment or messaging service]**.',
    '',
    '## How long we keep it',
    '',
    'While your account exists. Delete your account and we remove your personal data within',
    '**[number]** days, except anything we must keep by law.',
    '',
    '## Your choices',
    '',
    'You may ask us to show, correct or delete your data. Write to **[your email]** and we',
    'will respond within **[number]** days.',
    '',
    '## Children',
    '',
    'This app is not intended for children under **[age]**. We do not knowingly collect',
    'their information.',
    '',
    '## Changes',
    '',
    'If this policy changes we will update this page and change the date at the top.',
    '',
    '## Contact',
    '',
    '**[your name]** — **[your email]**',
    '',
    '---',
    '',
    '> **Not legal advice.** This template is a starting point written for a small app.',
    '> Laws differ by country, and if you take payments or handle health or financial data',
    '> the rules are stricter. Have a lawyer look at it before you rely on it.',
    '>',
    '> **यह कानूनी सलाह नहीं है.** यह एक छोटे app के लिए शुरुआती नमूना भर है. हर देश के',
    '> कानून अलग होते हैं — भरोसा करने से पहले किसी वकील को दिखा लीजिए.',
    ''
  ].join('\n');
}

/* ───────────────────────── STORE-LISTING.md ───────────────────────── */
function listing(app) {
  var name  = String(app.name || 'App');
  var clone = app.cloneOf ? String(app.cloneOf) : '';
  return [
    '# Store listing — ' + name,
    '',
    'Everything Play Console asks you to type, prepared. **Edit it — do not paste it as is.**',
    'Play Console जो-जो माँगता है, सब तैयार. **इसे बदलिए — जस का तस मत चिपकाइए.**',
    '',
    '> ⚠️ **Thousands of people have this same package.** If you paste this unchanged,',
    '> your listing will look identical to theirs and Google may treat it as spam.',
    '> **Change the words. Make them yours.** Five minutes of rewriting is the difference',
    '> between an app that gets published and one that gets rejected.',
    '>',
    '> ⚠️ **यही package हज़ारों लोगों के पास है.** बिना बदले चिपकाया तो आपकी listing उनके',
    '> जैसी दिखेगी और Google इसे spam मान सकता है. **शब्द बदलिए, अपने बनाइए.**',
    '',
    '---',
    '',
    '## App name  (30 characters max)',
    '',
    '```',
    name,
    '```',
    'Make it yours — add a word, change it completely. It must not copy a famous app\'s name.',
    (clone ? 'Do **not** use the word "' + clone + '" anywhere. That is a trademark.' : null),
    '',
    '## Short description  (80 characters max)',
    '',
    '```',
    '[what your app does, in one line]',
    '```',
    'This is the line people read first. Write it about **your** users, not about features.',
    '',
    '## Full description  (4000 characters max)',
    '',
    '```',
    '[Open with one sentence: who is this for, and what does it let them do?]',
    '',
    'What you can do:',
    '• [main thing]',
    '• [second thing]',
    '• [third thing]',
    '',
    'Why we built it:',
    '[two or three lines in your own voice — this is the part nobody else can copy]',
    '',
    'Questions or problems: [your email]',
    '```',
    '',
    '## Graphics you must provide',
    '',
    '| What | Size | Where to get it |',
    '|---|---|---|',
    '| App icon | 512 × 512 PNG | `assets/icon.png`, resized |',
    '| Feature graphic | 1024 × 500 | make one, or a plain colour with your app name |',
    '| Phone screenshots | at least 2 | take them on your own phone at DEPLOY.md STEP 21 |',
    '',
    '> **Screenshots are the most important thing on the page.** Most people decide from',
    '> those alone. Take them of real screens with real-looking content, not empty ones.',
    '>',
    '> **Screenshots सबसे ज़रूरी हैं** — ज़्यादातर लोग उन्हीं से तय करते हैं. खाली नहीं,',
    '> असली दिखने वाली screens की लीजिए.',
    '',
    '## Other fields',
    '',
    '- **Category** — pick what fits; you can change it later',
    '- **Contact email** — must be one you actually read; Google writes to it',
    '- **Privacy policy URL** — from `PRIVACY.md`, put on a public page. **Required.**',
    '',
    '## Data safety form — answer truthfully',
    '',
    'Google asks exactly what your app collects. **Wrong answers get apps removed later,**',
    '**sometimes after they are already published.** To find out what yours actually stores,',
    'open `server/db.js` and look at the tables — or give `AI-HELP.md` to an AI and ask:',
    '',
    '```',
    'Looking at the file map in this document, what user data does this app collect?',
    'Help me fill in the Google Play Data safety form honestly.',
    '```',
    '',
    'हिंदी: Google पूछता है कि app क्या-क्या इकट्ठा करता है. **सच लिखिए** — ग़लत जवाब',
    'बाद में app हटवा देते हैं. पता न हो तो `AI-HELP.md` लगाकर AI से पूछिए.',
    '',
    '---',
    '',
    '> **One honest warning.** Do not describe your app as a clone of a famous one, do not',
    '> use another company\'s name, logo or colours, and do not upload screenshots of their',
    '> app. That is the fastest way to lose a developer account. Build on this code, then',
    '> present it as **your own product** — because by the time you have changed the name,',
    '> the colours and the words, it is.',
    '>',
    '> **एक ज़रूरी चेतावनी.** अपने app को किसी मशहूर app की नकल मत कहिए, किसी और कंपनी',
    '> का नाम, logo या रंग मत इस्तेमाल कीजिए. यही developer account गँवाने का सबसे तेज़',
    '> तरीका है. इस code पर अपना app बनाइए और उसे **अपना product** कहकर पेश कीजिए.',
    ''
  ].filter(function (x) { return x !== null; }).join('\n');
}

module.exports = { appJson, easJson, makeIcon, privacy, listing, pkgName };

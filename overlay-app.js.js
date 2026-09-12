'use strict';
/* ================================================================
   overlay-app.bundle.js  —  26 টা ফাইল একসাথে বাঁধা
   তৈরি : 2026-09-12 02:31:06

   হাতে সম্পাদনা করবেন না। আসল ফাইলগুলো বদলে make-bundle.js আবার চালান।
   ================================================================ */

var __mods = {}, __cache = {};
function __req(name) {
  if (__cache[name]) return __cache[name].exports;
  var m = { exports: {} };
  __cache[name] = m;
  __mods[name](m, m.exports, __mk());
  return m.exports;
}
/* ভেতরের ডাকাডাকি বান্ডিলেই মেটে, বাকিটা Node-এর হাতে যায় */
function __mk() {
  return function (id) {
    var base = String(id).replace(/^.*[\\/]/, "");
    if (__mods[base]) return __req(base);
    return require(id);
  };
}

/* ──────── gen-store.js ──────── */
__mods["gen-store.js"] = function (module, exports, require) {
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

};

/* ──────── gen-deploy.js ──────── */
__mods["gen-deploy.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-deploy.js — DEPLOY.md : ইন্টারনেটে তোলা + Play Store পর্যন্ত
 *
 * ⚠️ এই ফাইলের সবচেয়ে জরুরি অংশ উপরের "RULES CHANGE" বাক্সটা।
 *    হোস্টিং আর Play Store-এর নিয়ম প্রতি কয়েক মাসে বদলায়। তাই এখানে
 *    ধাপগুলোর সাথে সাথে লেখা আছে — কোথায় গিয়ে যাচাই করতে হবে, আর
 *    AI-কে ঠিক কোন প্রশ্নটা করলে আজকের নিয়ম জানা যাবে।
 *
 *    তথ্য যাচাই করা হয়েছে : সেপ্টেম্বর ২০২৬
 */

const VERIFIED = 'September 2026';

var store = require('./gen-store.js');

function deployMd(app, BRAND, codeStr) {
  var PKG = store.pkgName(app || {});
  app = app || {};
  BRAND = BRAND || {};
  var num  = String(app.num || '0000');
  var name = String(app.name || 'App');
  var C    = codeStr || 'PKG-0000-APP';

  var L = [];
  var P = function () {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== null && arguments[i] !== undefined) L.push(arguments[i]);
    }
  };

  /* ─────────── HEAD ─────────── */
  P('# DEPLOY — put ' + name + ' online, and on the Play Store',
    '',
    '**Package code: `' + C + '`**  ·  APP ' + num,
    '',
    'This continues from `AI-HELP.md`. Finish **STEP 1–10** there first — the app',
    'must run on your own computer before any of this makes sense.',
    '',
    'यह `AI-HELP.md` के आगे का हिस्सा है. पहले वहाँ **STEP 1–10** पूरे कीजिए —',
    'app आपके अपने कंप्यूटर पर चले, तभी यह सब काम का है.',
    '',
    '---',
    '');

  /* ─────────── RULES CHANGE — সবচেয়ে জরুরি ─────────── */
  P('## ⚠️ READ THIS FIRST — these rules change  /  पहले यह पढ़िए',
    '',
    'Everything below was **checked in ' + VERIFIED + '**. Hosting platforms and Google',
    'change their prices, free limits, page layouts and rules every few months.',
    '**Some of what follows will be out of date by the time you read it.**',
    '',
    'That is normal and it is not a problem — as long as you **check before you follow.**',
    '',
    'नीचे सब कुछ **' + VERIFIED + '** में जाँचा गया था. Hosting कंपनियाँ और Google अपने',
    'दाम, मुफ़्त सीमाएँ, पन्नों की बनावट और नियम हर कुछ महीनों में बदलते रहते हैं.',
    '**इसलिए कुछ बातें आपके पढ़ते समय पुरानी हो चुकी होंगी.** यह सामान्य है —',
    'बस **करने से पहले जाँच लीजिए.**',
    '',
    '### Ask an AI to check today\'s rules  /  आज के नियम AI से पूछिए',
    '',
    'Paste this into any AI **that can search the web** (Claude, ChatGPT, Gemini,',
    'Perplexity), attach `AI-HELP.md`, and put the STEP number you are on:',
    '',
    '```',
    'Search the web and tell me today\'s rules, then compare with what my guide says.',
    '',
    'I am on STEP <number> of DEPLOY.md (package ' + C + ').',
    'My guide was written in ' + VERIFIED + ' and says:',
    '    <paste the step you are about to do>',
    '',
    'Please check and tell me:',
    '  1. Is this still correct today?',
    '  2. What changed — prices, free limits, button names, page layout?',
    '  3. What exactly should I do instead, step by step?',
    '  4. Give me the official documentation link so I can confirm.',
    '```',
    '',
    '**हिंदी में भी यही भेज सकते हैं** — ऊपर का ढाँचा वैसा रखिए, अपनी बात हिंदी में लिखिए.',
    '',
    '### Always trust these over this guide  /  इन पर भरोसा कीजिए, इस गाइड पर नहीं',
    '',
    '| What | Official source — the only thing that is never out of date |',
    '|---|---|',
    '| Play Store rules | https://support.google.com/googleplay/android-developer |',
    '| Play Console itself | https://play.google.com/console |',
    '| Play fees & account | Play Console Help → "Get started with Play Console" |',
    '| Expo / building the app | https://docs.expo.dev |',
    '| Expo prices & free limits | https://expo.dev/pricing |',
    '| Render hosting | https://render.com/docs |',
    '| Render prices & free limits | https://render.com/pricing |',
    '| GitHub | https://docs.github.com |',
    '',
    '**The page in front of you always wins over the page in this guide.**',
    'If a button has a different name, it was renamed — look for the nearest match,',
    'or ask the AI with a screenshot.',
    '',
    '**आपकी स्क्रीन पर जो दिख रहा है, वही सही है.** बटन का नाम अलग हो तो समझिए',
    'नाम बदल गया है — मिलता-जुलता बटन ढूँढिए, या स्क्रीनशॉट के साथ AI से पूछिए.',
    '',
    '### If you want to watch a video  /  अगर वीडियो देखना हो',
    '',
    'Search YouTube and **sort by upload date, then pick something from the last few',
    'months.** An old video on this topic is worse than no video.',
    '',
    '```',
    'deploy node express app to render 2026',
    'expo eas build android aab tutorial 2026',
    'google play console closed testing 12 testers 2026',
    '```',
    '',
    'YouTube पर खोजिए और **"Upload date" से छाँटिए — पिछले कुछ महीनों का वीडियो',
    'ही देखिए.** इस विषय पर पुराना वीडियो, न देखने से भी बुरा है.',
    '',
    '---',
    '');

  /* ─────────── COST ─────────── */
  P('## 💰 WHAT IT COSTS AND HOW LONG IT TAKES',
    '',
    'Honest numbers, ' + VERIFIED + '. **Verify each one before you pay anything.**',
    '',
    '| | Money | Time |',
    '|---|---|---|',
    '| Run it on your own computer | free | done already |',
    '| Server online, hobby use | free tier, with limits below | ~1 hour |',
    '| Server truly always-on | paid plan, small monthly fee | same |',
    '| App file (.aab / .apk) for your phone | free tier build service | ~1 hour |',
    '| Play Store developer account | **$25, one time, never renews** | 1–2 hours |',
    '| Identity verification by Google | free | **2–5 days** |',
    '| 12 testers for 14 continuous days | free, but you must find people | **14+ days** |',
    '| Google reviews your app | free | days to weeks |',
    '',
    '> **From today to "live on the Play Store" is realistically 3–6 weeks**, and almost',
    '> all of it is waiting, not working. Start the account and verification early.',
    '>',
    '> **आज से Play Store तक असल में ३–६ हफ़्ते लगते हैं**, और उसका ज़्यादातर हिस्सा',
    '> इंतज़ार है, काम नहीं. इसलिए account और verification सबसे पहले शुरू कीजिए.',
    '',
    '---',
    '');

  /* ─────────── WHICH PATH ─────────── */
  P('## 🔀 FIRST, FIND OUT WHICH PATH YOU ARE ON',
    '',
    'Run this inside your app folder:',
    '```',
    'node -e "var p=require(\'./package.json\');console.log(((p.dependencies||{}).expo)?\'EXPO\':\'BARE\')"',
    '```',
    '✅ **`EXPO`** → follow PART B as written. This is the easy path.',
    '✅ **`BARE`** → PART A is the same, but PART B needs Android Studio instead of the',
    '   build service. Give this file to an AI and ask for the bare React Native route.',
    '',
    'हिंदी: `EXPO` आए तो नीचे सब वैसा ही कीजिए. `BARE` आए तो PART A वही है, पर',
    'PART B के लिए AI से "bare React Native" वाला रास्ता पूछिए.',
    '',
    '---',
    '');

  /* ─────────── PART A ─────────── */
  P('# PART A — put the server online  /  server को इंटरनेट पर लाना',
    '',
    'Right now your server only runs while your own computer is on. These steps put it',
    'on the internet so the app works from anywhere.',
    '',
    'अभी server सिर्फ़ तभी चलता है जब आपका कंप्यूटर चालू हो. ये steps उसे इंटरनेट पर',
    'ले आएँगे, ताकि app कहीं से भी चले.',
    '',

    '### STEP 11 — Make a GitHub account',
    'Go to **https://github.com** and sign up. Free.',
    '✅ **You should see:** your own page at `github.com/<your-username>`.',
    '> Your code has to live somewhere the hosting service can read it. GitHub is that place.',
    'हिंदी: github.com पर मुफ़्त account बनाइए. आपका अपना पन्ना खुलना चाहिए.',
    '',

    '### STEP 12 — Install Git',
    'Download from **https://git-scm.com/downloads**, install, then **close and reopen**',
    'your terminal and run:',
    '```',
    'git --version',
    '```',
    '✅ **You should see:** a version number, e.g. `git version 2.46.0`',
    '❌ `not recognized` → the terminal was open before you installed. Close it, open again.',
    'हिंदी: नंबर दिखना चाहिए. न दिखे तो terminal बंद करके दोबारा खोलिए.',
    '',

    '### STEP 13 — Put your code on GitHub',
    'On GitHub click **New repository**, give it a name, choose **Private**, and create it',
    'with **no** README or .gitignore. Then in your app folder:',
    '```',
    'git init',
    'git add .',
    'git commit -m "first"',
    'git branch -M main',
    'git remote add origin <the URL GitHub showed you>',
    'git push -u origin main',
    '```',
    '✅ **You should see:** your files on the GitHub page after you refresh it.',
    '❌ Asked for a password → GitHub no longer accepts account passwords here. It will',
    '   normally open a browser window to sign in; if not, ask the AI for the current',
    '   sign-in method — this is one of the things that changes.',
    '> 🔒 **Check that `.env` is NOT on GitHub.** `.gitignore` should have kept it out.',
    '>    If you can see it there, delete the repository and ask the AI before continuing.',
    '> 🔒 **देखिए कि `.env` GitHub पर न गया हो.** दिख जाए तो repository हटा दीजिए और',
    '>    आगे बढ़ने से पहले AI से पूछिए.',
    '',

    '### STEP 14 — Create the hosting service',
    'Go to **https://render.com**, sign up with GitHub, then **New → Web Service** and',
    'pick your repository. Settings to use:',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Build command | `npm install` |',
    '| Start command | `node server/index.js` |',
    '| Instance type | Free |',
    '',
    '✅ **You should see:** the build log runs, then the status turns **Live**, and you get',
    '   a URL ending in `.onrender.com`. **Copy that URL.**',
    '❌ Build fails → open the log, copy the **last 20 lines**, and send them as STEP 14.',
    'हिंदी: status **Live** होना चाहिए और एक URL मिलना चाहिए. वो URL copy कर लीजिए.',
    '',
    '> ⚠️ **What "free" means here** (' + VERIFIED + ', confirm at render.com/pricing):',
    '> a free service **goes to sleep after about 15 minutes with no visitors**, and the',
    '> next visitor waits **about a minute** while it wakes up. There is also a monthly',
    '> pool of free hours. **This is fine for showing people. It is not 24×7.**',
    '> A small paid plan removes the sleeping. Free databases also expire — check the',
    '> current terms before you put anything real in one.',
    '>',
    '> ⚠️ **यहाँ "मुफ़्त" का मतलब:** कोई न आए तो service **लगभग 15 मिनट में सो जाती है**,',
    '> और अगले आदमी को जगने तक **लगभग एक मिनट** रुकना पड़ता है. **दिखाने के लिए ठीक है,**',
    '> **24×7 नहीं.** छोटा paid plan लेने पर यह सोना बंद हो जाता है.',
    '',

    '### STEP 15 — Give the server its secrets',
    'Open your service → **Environment** → add every line from your `.env` file, one by one,',
    'as name and value. Save. The service restarts on its own.',
    '✅ **You should see:** status back to **Live** after the restart.',
    '> Your `.env` is deliberately not on GitHub, so the server has no other way to get these.',
    'हिंदी: `.env` की हर लाइन यहाँ name–value के रूप में डालिए. फिर status **Live** होना चाहिए.',
    '',

    '### STEP 16 — Check the live server is answering',
    'On your own computer (put your own `.onrender.com` URL in):',
    '```',
    'node -e "require(\'https\').get(\'https://YOUR-APP.onrender.com\',function(r){console.log(\'REPLY\',r.statusCode)}).on(\'error\',function(e){console.log(\'NO REPLY\',e.code)})"',
    '```',
    '✅ **You should see:** `REPLY` and any number. Any reply means it is alive.',
    '⚠️ If it was asleep, the **first** try can fail or take about a minute. **Try twice.**',
    '❌ Still `NO REPLY` after two tries → open Render\'s **Logs** tab, copy the last lines,',
    '   send as STEP 16.',
    'हिंदी: `REPLY` आना चाहिए. सोया हुआ हो तो पहली बार में देर लगती है — **दो बार कोशिश कीजिए.**',
    '',

    '### STEP 17 — Point the app at the live server',
    'Open `config.js` and replace the local address with your `https://...onrender.com` URL.',
    'Then:',
    '```',
    'node --check config.js',
    '```',
    '✅ **You should see: nothing.** Then open the app — it should load **without your own**',
    '   **server running.** That is the whole point of PART A.',
    '❌ Blank screen → the address is wrong. It must start with `https://` and have **no**',
    '   slash at the end.',
    'हिंदी: अब app आपके अपने server के बिना चलना चाहिए. सफ़ेद स्क्रीन आए तो पता गलत है —',
    '`https://` से शुरू, और अंत में slash नहीं.',
    '',
    '> 🎉 **PART A done.** Your app now works from any phone, anywhere.',
    '> 🎉 **PART A पूरा.** अब app किसी भी फ़ोन से, कहीं से भी चलेगा.',
    '',
    '---',
    '');

  /* ─────────── PART B ─────────── */
  P('# PART B — on to the Play Store  /  Play Store तक',
    '',
    '> ⚠️ **Google changes these rules often, and changed them recently.** Before you pay',
    '> the fee, run the "check today\'s rules" question from the top of this file.',
    '>',
    '> ⚠️ **Google ये नियम अक्सर बदलता है, और हाल ही में बदले हैं.** फ़ीस देने से पहले',
    '> ऊपर वाला "आज के नियम" सवाल ज़रूर पूछिए.',
    '',

    '### STEP 18 — Make it yours  ⚠️ the most important step here',
    '',
    'Open **`app.json`** and change two things:',
    '',
    '**1. The package name.** Find `"package"` and `"bundleIdentifier"`. Both say:',
    '```',
    '"' + PKG + '"',
    '```',
    'Replace **`yourname`** with your own name or website, no spaces or capitals:',
    '```',
    '"' + PKG.replace('yourname', 'rahulsharma') + '"',
    '```',
    '⚠️ **This must be unique in the whole world.** Thousands of people have this same',
    'package. If you leave `yourname`, you will collide with them and Google will reject it.',
    '',
    '**2. The app name.** Find `"name"` and make it yours.',
    '',
    'Then make the icon:',
    '```',
    'node make-icon.js',
    '```',
    '✅ **You should see:** two `OK` lines, and an `assets` folder with `icon.png` in it.',
    'Open it — a pattern in your app\'s colour, unique to this app. **Want your own picture?**',
    'Replace both files with your own 1024×1024 PNG.',
    '',
    'Now check you did step 1 properly:',
    '```',
    'node -e "var a=require(\'./app.json\').expo.android.package;console.log(a, a.indexOf(\'yourname\')<0?\'OK\':\'<-- STILL SAYS yourname, FIX IT\')"',
    '```',
    '✅ **You should see:** your package name and `OK`.',
    'हिंदी: `app.json` में `yourname` की जगह अपना नाम लिखिए — **यह दुनिया में अनोखा होना',
    'ज़रूरी है.** फिर `node make-icon.js` चलाइए. जाँच में `OK` आना चाहिए.',
    '',

    '### STEP 19 — Install the build tool',
    'Make a free account at **https://expo.dev**, then:',
    '```',
    'npm install -g eas-cli',
    'eas --version',
    'eas login',
    '```',
    '✅ **You should see:** a version number, then your username after logging in.',
    '> This builds the app file in the cloud, so you do not need Android Studio.',
    '> `eas.json` is already in your folder, so there is nothing to configure.',
    '> Free-tier build allowances exist and change — check **expo.dev/pricing**.',
    'हिंदी: version नंबर और फिर आपका username दिखना चाहिए. `eas.json` पहले से मौजूद है.',
    '',

    '### STEP 20 — Build a test file for your own phone',
    'The `preview` profile is already set up to give you an `.apk`:',
    '```',
    'eas build -p android --profile preview',
    '```',
    '✅ **You should see:** a link to watch the build, and when it finishes, a **download**',
    '   **link for an `.apk` file**. Builds usually take 10–25 minutes.',
    '❌ Build fails → open the link, find the **first red error**, copy it, send as STEP 20.',
    '> An `.apk` installs directly on a phone. An `.aab` (STEP 23) is only for the Play Store.',
    'हिंदी: `.apk` फ़ाइल का download link मिलना चाहिए. `.apk` सीधे फ़ोन में लगती है.',
    '',

    '### STEP 21 — Try it on a real phone',
    'Download the `.apk` on an Android phone and open it. Allow installing from this source',
    'when asked.',
    '✅ **You should see:** your app installed like any other app, opening to its first screen.',
    '❌ Opens and closes at once → send a screenshot and say STEP 21. Usually the server',
    '   address from STEP 17.',
    '> **Do not skip this.** Fixing things now is free. Fixing them after Google\'s review',
    '> costs you days.',
    '> **यह मत छोड़िए.** अभी सुधारना मुफ़्त है; Google की जाँच के बाद सुधारने में दिन लगते हैं.',
    '',

    '### STEP 22 — Open the Play Console account  ⚠️ start this early',
    'Go to **https://play.google.com/console**. Before you begin, **turn on 2-Step**',
    '**Verification** on your Google account. Keep a government ID ready.',
    '',
    'As of ' + VERIFIED + ' — **confirm all of this on the official page**:',
    '',
    '- **$25, paid once**, by credit or debit card. No yearly renewal. Non-refundable.',
    '- You choose **Personal** or **Organization** at signup. **Read the next step before**',
    '  **choosing** — the choice decides how hard publishing will be.',
    '- **Google verifies your identity.** Expect **2–5 days**. You can prepare your listing',
    '  meanwhile, but you cannot publish until it clears.',
    '- Your name, your card and your ID must **match**. Mismatches are the usual reason',
    '  verification fails, and the fee does not come back.',
    '',
    '✅ **You should see:** the Play Console dashboard, and a verification status you can watch.',
    'हिंदी: पहले Google account पर **2-Step Verification** चालू कीजिए, सरकारी ID तैयार रखिए.',
    'फ़ीस **$25, एक बार**. पहचान की जाँच में **२–५ दिन** लगते हैं. नाम, card और ID एक जैसे हों.',
    '',

    '### STEP 23 — Personal or Organization? — this one matters most',
    '',
    'As of ' + VERIFIED + ', **confirm on the official page before deciding**:',
    '',
    '| | Personal account | Organization account |',
    '|---|---|---|',
    '| Who it is for | one individual | a registered business |',
    '| Extra document | government ID | business details incl. a D-U-N-S number |',
    '| Getting that document | you have it | free to request, **can take weeks** |',
    '| **12 testers for 14 days** | **required** | Google documents this against personal accounts |',
    '',
    '**Personal accounts created after 13 November 2023** cannot publish publicly until a',
    '**closed test has run with at least 12 testers, opted in continuously for 14 days.**',
    'Then you apply for production access, and Google reviews that application.',
    '',
    '> You can move from Personal to Organization later, but **not the other way**.',
    '> Most people making their first app should take **Personal** and accept the 14 days.',
    '>',
    '> Personal से Organization में बाद में जा सकते हैं, **उल्टा नहीं**. पहली app बनाने वाले',
    '> ज़्यादातर लोगों के लिए **Personal** ही ठीक है — 14 दिन का इंतज़ार मान लीजिए.',
    '',

    '### STEP 24 — Build the Play Store file',
    '```',
    'eas build -p android --profile production',
    '```',
    '✅ **You should see:** a download link for an **`.aab`** file this time, not `.apk`.',
    '> New apps must be uploaded to Google as `.aab`. Google makes the `.apk` for each',
    '> phone itself. That is why STEP 20 and this step produce different files.',
    'हिंदी: इस बार **`.aab`** फ़ाइल मिलेगी. नई apps Google को `.aab` में ही देनी होती हैं.',
    '',

    '### STEP 25 — Create the app listing',
    '',
    '> 📄 **Open `STORE-LISTING.md`** — every field Play Console asks for is prepared there,',
    '> with what to write and what to change. **Open `PRIVACY.md`** for the privacy policy.',
    '>',
    '> 📄 **`STORE-LISTING.md` खोलिए** — Play Console के हर खाने का जवाब वहाँ तैयार है.',
    '> Privacy policy के लिए **`PRIVACY.md`** खोलिए.',
    '',
    'In Play Console: **Create app**. Then fill in the store listing. You will need:',
    '',
    '- App name, short description, full description',
    '- **App icon** 512×512 PNG',
    '- **Feature graphic** 1024×500',
    '- **At least 2 phone screenshots** — take them from your own phone in STEP 21',
    '- **A privacy policy URL** — a public web page. This is **required**, not optional.',
    '',
    '✅ **You should see:** each section turn from incomplete to complete.',
    '> `PRIVACY.md` is a ready template — fill in the `[...]` parts and put it on a public',
    '> page. Ask an AI for the simplest free way to host one page if you are unsure.',
    '> ⚠️ **Do not paste the listing text unchanged** — thousands have the same file, and',
    '> identical listings get treated as spam. Rewrite it in your own words.',
    'हिंदी: icon, graphic, कम से कम २ screenshots, और एक **privacy policy का लिंक** चाहिए —',
    'यह ज़रूरी है. न हो तो AI से लिखवा लीजिए और मुफ़्त में कहीं डाल दीजिए.',
    '',

    '### STEP 26 — Answer Google\'s forms',
    'Fill in **Data safety**, **content rating**, **target audience**, **ads** and the other',
    'declarations Play Console asks for.',
    '✅ **You should see:** the dashboard checklist filling up.',
    '> ⚠️ **Answer truthfully.** Wrong answers here get apps removed later, sometimes after',
    '> they are already published. If you are unsure what your app collects, ask the AI with',
    '> `AI-HELP.md` attached — the file map tells it what your server stores.',
    '> ⚠️ **सच-सच भरिए.** ग़लत जवाब बाद में app हटवा देते हैं. पक्का न हो तो `AI-HELP.md`',
    '> लगाकर AI से पूछिए — उसमें लिखा है कि आपका server क्या-क्या रखता है.',
    '',

    '### STEP 27 — Upload to closed testing',
    'Go to **Testing → Closed testing**, create a track, upload your `.aab`, and add your',
    'testers\' Gmail addresses. Share the opt-in link Google gives you.',
    '✅ **You should see:** the release live on that track, and an opt-in link you can send.',
    '> **Recruit 15–18 people, not 12.** Some will drop out, and dropping below 12 restarts',
    '> the clock. Ask friends, family, classmates, a group chat.',
    '> **12 नहीं, 15–18 लोग जोड़िए.** कुछ लोग निकल जाते हैं, और 12 से नीचे जाते ही',
    '> 14 दिन की गिनती फिर से शुरू हो जाती है.',
    '',

    '### STEP 28 — Wait 14 days  ⏳',
    'The testers must stay opted in **continuously**. Google also looks at whether they',
    'actually used the app, so ask them to open it a few times.',
    '✅ **You should see:** the tester count in Play Console staying at 12 or above, every day.',
    '❌ It drops below 12 → add more people **immediately**, before the streak breaks.',
    '> There is no way around this wait for a personal account. Use the two weeks to',
    '> collect feedback and fix things.',
    '> Personal account के लिए इस इंतज़ार से बचने का कोई रास्ता नहीं. इन दो हफ़्तों में',
    '> feedback लीजिए और कमियाँ ठीक कीजिए.',
    '',

    '### STEP 29 — Apply for production access',
    'After 14 clean days, Play Console lets you **apply for production access**. You answer',
    'questions about your testing and how ready the app is.',
    '✅ **You should see:** the application submitted, then a decision from Google.',
    '⏳ Review commonly takes about a week, sometimes longer.',
    '❌ Rejected → the reason is written in the message. Paste the whole message to the AI',
    '   with `AI-HELP.md` and say STEP 29.',
    'हिंदी: 14 साफ़ दिनों के बाद production access के लिए apply कीजिए. मना हो जाए तो पूरा',
    'संदेश AI को दिखाइए.',
    '',

    '### STEP 30 — Publish, and then keep it alive',
    'Once production access is granted, create a production release with your `.aab` and roll',
    'it out.',
    '✅ **You should see:** your app on the Play Store. 🎉',
    '',
    '**After that, three things keep it alive:**',
    '',
    '1. **Updates** — every new upload needs a higher version code than the last, or Google',
    '   refuses it. In an Expo project this is set in your app config.',
    '2. **The server** — if it is on a free plan it still sleeps. Real users on the Play',
    '   Store are the point at which a small paid plan stops being optional.',
    '3. **Google\'s deadlines** — Google requires apps to be rebuilt against newer Android',
    '   versions periodically, and will stop showing apps that fall behind. **Check the',
    '   current target API deadline once a year.**',
    '',
    'हिंदी: **१.** हर update में version code बढ़ाना ज़रूरी है. **२.** असली users आने पर',
    'मुफ़्त server का सोना अब ठीक नहीं — छोटा paid plan ले लीजिए. **३.** Google समय-समय पर',
    'नए Android के हिसाब से app दोबारा बनाने को कहता है — साल में एक बार जाँच लीजिए.',
    '',
    '---',
    '');

  /* ─────────── ASK ─────────── */
  P('## 🆘 STUCK ON ANY STEP',
    '',
    'Attach **`AI-HELP.md`** and **`DEPLOY.md`**, add a screenshot, and send:',
    '',
    '```',
    'APP ' + num + '  ·  ' + C,
    'STEP: <number>',
    '',
    'My guide was written in ' + VERIFIED + '. Please search the web and check',
    'whether this step has changed before you answer.',
    '',
    'What I did:      <...>',
    'Expected:        <paste the "✅ You should see" line>',
    'What I got:      <paste output, or see screenshot>',
    '```',
    '',
    '**हिंदी में भी यही भेजिए** — बस अपनी बात हिंदी में लिख दीजिए.',
    '',
    'The two sentences about searching the web matter more than anything else you write.',
    'They turn a guess into a checked answer.',
    '',
    '**वेब पर जाँचने वाली वो दो लाइनें सबसे ज़रूरी हैं** — उन्हीं से अंदाज़ा जाँचे हुए जवाब में बदलता है.',
    '');

  if (BRAND.youtube) P('', '---', '', 'More sets and walkthroughs / और sets: ' + BRAND.youtube, '');
  P('', '`' + C + '`  ·  APP ' + num + '  ·  guide written ' + VERIFIED, '');

  return L.join('\n');
}

module.exports = { deployMd, VERIFIED };

};

/* ──────── gen-ai-help.js ──────── */
__mods["gen-ai-help.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-ai-help.js — প্রতিটা প্যাকেজের "মাস্টার ফাইল"
 *
 * এটা ঠিক সেই জিনিস যা আপনি নিজে ব্যবহার করেন: একটা ফাইল, যেটা যেকোনো AI-কে
 * দিলে সে গোটা প্রজেক্টটা চিনে ফেলে। দর্শক শুধু বলবেন "APP 0417, STEP 5" আর
 * স্ক্রিনশট দেবেন — AI বাকিটা এই ফাইল থেকেই জেনে নেবে।
 *
 * ⚠️ এখানে একটাও "এটা দেখবেন" আন্দাজে লেখা হয়নি। যে দশটা ধাপ আছে, প্রতিটার
 *    পরীক্ষা এমন যার ফল নির্দিষ্ট — node --check চুপ থাকে, existsSync true
 *    বলে, scripts-এর তালিকা package.json থেকেই আসে। আন্দাজের প্রত্যাশা
 *    লিখলে দর্শক আরও বিভ্রান্ত হতেন, তাই সেটা ইচ্ছে করেই বাদ।
 */

/* ════════════════════════════════════════════════════════════════
   👇 আপনার নিজের তথ্য — শুধু এই ঘরটুকু বদলাবেন, নিচে আর কিছু নয়
   ════════════════════════════════════════════════════════════════ */
const BRAND = {
  project : 'CODE KNOWLEDGE',
  channel : 'CODE KNOWLEDGE',
  youtube : 'https://www.youtube.com/@CodeKnowledgeOfficialyt',
  contact : '',
  links   : [
    { label: 'हिंदी चैनल / Hindi channel', url: 'https://www.youtube.com/channel/UCP4YRXcApYHax8B_oMwPvsQ' },
  ],
};
/* ════════════════════════════════════════════════════════════════ */

const dep   = require('./gen-deploy.js');
const store = require('./gen-store.js');

const README = '00-READ-ME-FIRST.md';
const FILE   = 'AI-HELP.md';
const DEPLOY = 'DEPLOY.md';

/* প্রতিটা সেটের নিজস্ব কোড — দর্শক এটাই AI-কে বলবেন */
function code(app) {
  var p = String(BRAND.project || 'PKG').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PKG';
  var s = String(app && app.slug || 'app').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'APP';
  return p + '-' + String(app && app.num || '0000') + '-' + s;
}

/* buildApp যা যা বানিয়েছে, হুবহু সেই গাছ */
function tree(files) {
  var dirs = {};
  files.forEach(function (f) {
    var i = f.name.lastIndexOf('/');
    var d = i === -1 ? '.' : f.name.slice(0, i);
    (dirs[d] = dirs[d] || []).push({
      base : i === -1 ? f.name : f.name.slice(i + 1),
      label: f.label || ''
    });
  });
  var out = [];
  var order = ['.'].concat(Object.keys(dirs).filter(function (d) { return d !== '.'; }).sort());
  order.forEach(function (d) {
    if (!dirs[d]) return;
    if (d !== '.') out.push('', d + '/');
    dirs[d].forEach(function (x) {
      out.push('  ' + x.base + (x.label ? ' '.repeat(Math.max(1, 32 - x.base.length)) + x.label : ''));
    });
  });
  return out.join('\n');
}

/* START-HERE গাইডগুলোর মাথায় বসবে — দুই ভাষায়, কারণ আটকানো লোক লম্বা লেখা পড়েন না */
function banner(app) {
  var C = code(app);
  return [
    '> ## 🆘 আটকে গেলে / Stuck? / अटक गए?',
    '>',
    '> **New here? Open `' + README + '` first — it says which file you need.**',
    '>',
    '> **EN —** Open **`' + FILE + '`** in this folder. It lists every setup step',
    '> with the exact output you should see. Upload that file to any AI',
    '> (Claude, ChatGPT, Gemini) with your screenshot and say:',
    '> **"APP ' + String(app && app.num || '0000') + ', STEP _, this is what I got."**',
    '>',
    '> **HI —** इसी फ़ोल्डर में **`' + FILE + '`** खोलिए. उसमें हर step का सही नतीजा',
    '> लिखा है. वो फ़ाइल किसी भी AI को स्क्रीनशॉट के साथ दीजिए और कहिए:',
    '> **"APP ' + String(app && app.num || '0000') + ', STEP _, मुझे यह मिला."**',
    '>',
    '> **Package code / पैकेज कोड: `' + C + '`**',
    '',
    '---',
    '',
    ''
  ].join('\n');
}

function aiHelp(app, files) {
  app = app || {};
  files = files || [];

  var C     = code(app);
  var num   = String(app.num || '0000');
  var name  = String(app.name || 'App');
  var clone = app.cloneOf ? String(app.cloneOf) : '';
  var n     = files.length;
  var lines = files.reduce(function (s, f) { return s + String(f.code || '').split('\n').length; }, 0);
  var built = new Date().toISOString().slice(0, 10);
  var has   = function (p) { return files.some(function (f) { return f.name === p; }); };

  var L = [];
  /* null দিলে লাইনটা বাদ যায় — তাই টেবিলের ভেতরে ফাঁকা সারি তৈরি হয় না */
  var P = function () {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== null && arguments[i] !== undefined) L.push(arguments[i]);
    }
  };

  /* ───────────────────────── HEAD ───────────────────────── */
  P('# MASTER FILE — ' + name + '  ·  APP ' + num,
    '',
    '**Package code: `' + C + '`**  ·  ' + n + ' files  ·  built ' + built,
    '',
    'This one file describes the whole project. **Give it to any AI assistant**',
    '(Claude, ChatGPT, Gemini, Copilot) together with a screenshot, and it will',
    'understand your setup without you explaining anything.',
    '',
    'यह एक फ़ाइल पूरे project को बताती है. **किसी भी AI को यही फ़ाइल दीजिए**,',
    'साथ में स्क्रीनशॉट — उसे सब समझ आ जाएगा, आपको कुछ समझाना नहीं पड़ेगा.',
    '',
    '---',
    '');

  /* ───────────────────────── HOW TO ASK ───────────────────────── */
  P('## 🆘 HOW TO ASK FOR HELP  /  मदद कैसे माँगें',
    '',
    'Every setup step below has a **number** and a **definite expected result**.',
    'When a step does not give that result, you already know everything the AI needs.',
    '',
    'नीचे हर step का **नंबर** है और **सही नतीजा** लिखा है. जब नतीजा अलग आए,',
    'तो आपके पास वो सब है जो AI को चाहिए.',
    '',
    '**Copy this, fill the blanks, attach the file and a screenshot:**',
    '',
    '```',
    'APP ' + num + '  ·  ' + C,
    'STEP: <number from the list below>',
    '',
    'Command I ran:',
    '    <paste the exact command>',
    '',
    'Expected (from this file):',
    '    <paste the "✅ You should see" line for that step>',
    '',
    'What I actually got:',
    '    <paste the full output, or attach the screenshot>',
    '',
    'My device: Windows / Mac / Linux / Android-Termux',
    'Guide: AI-HELP.md (STEP 1-10)  or  DEPLOY.md (STEP 11-30)',
    'Node version: <output of: node --version>',
    '```',
    '',
    '**हिंदी में भी बिलकुल यही भेज सकते हैं** — ऊपर वाला ढाँचा वैसा ही रखिए,',
    'बस अपनी बात हिंदी में लिख दीजिए. AI दोनों भाषाएँ समझता है.',
    '',
    '> 📸 **Send a screenshot of the whole terminal window, not a crop.**',
    '> The lines above and below the error usually matter more than the error.',
    '>',
    '> 📸 **पूरी terminal विंडो का स्क्रीनशॉट भेजिए, कटा हुआ नहीं.** गलती के',
    '> ऊपर-नीचे की लाइनें अक्सर गलती से ज़्यादा काम की होती हैं.',
    '',
    '---',
    '');

  /* ───────────────────────── AI RULES ───────────────────────── */
  P('## 🤖 INSTRUCTIONS FOR THE AI — please read before answering',
    '',
    'This is a **generated starter project**: ' + n + ' files, about ' +
      lines.toLocaleString('en-US') + ' lines. The user is often **not a programmer**.',
    '',
    '1. **Do not redesign the architecture.** The layout is deliberate. Fix the',
    '   specific failure in place. The user cannot regenerate this package.',
    '2. **Do not assume a file is missing.** The complete file list is in this',
    '   document. If a listed file is absent on disk, the ZIP did not extract',
    '   fully — tell them to unzip again, do not write a replacement.',
    '3. **Authorisation lives on the server, never on the phone.** `server/guard.js`',
    '   is the only place access decisions are made. If asked to "simplify" by',
    '   moving checks into the app, refuse and explain why.',
    '4. **One command at a time.** Say what it should print, then wait for the result.',
    '5. **Ask for the STEP number** if it was not given. The steps are below.',
    '6. **Server is CommonJS (`require`), client is React Native.** Do not convert',
    '   one into the other.',
    '7. **Answer in the language the user writes in** — Hindi, English, or a mix.',
    '8. **For anything in `' + DEPLOY + '` (hosting, Play Store), search the web first.**',
    '   That guide was written on a fixed date and those rules change often. Check what is',
    '   true today, say plainly what has changed since, and cite the official page.',
    '',
    '---',
    '');

  /* ───────────────────────── WHAT THIS IS ───────────────────────── */
  P('## 📦 WHAT THIS PACKAGE IS',
    '',
    '| | |',
    '|---|---|',
    '| App name | ' + name + ' |',
    '| App number | **' + num + '** |',
    '| Package code | `' + C + '` |' + (clone ? '\n| Modelled on | ' + clone + ' |' : ''),
    '| Stack | ' + String(app.stack || 'React Native + Node') + ' |',
    '| Default country | ' + String(app.country || 'IN') + ' |',
    '| Files | ' + n + ' |',
    '',
    'Three kinds of people use the finished app, and they are **kept apart on purpose**:',
    '',
    '- **User** — the person who consumes or buys',
    '- **Provider** — the person who earns (seller, teacher, creator)',
    '- **Owner** — the person who runs the platform',
    '',
    'One person\'s access never reaches another person\'s data. That separation is',
    'enforced on the server, so it cannot be bypassed by editing the app.',
    '',
    'तीन तरह के लोग: **User** (जो इस्तेमाल करे), **Provider** (जो कमाए),',
    '**Owner** (जो चलाए). तीनों के दरवाज़े अलग हैं, और यह जाँच **server पर** होती है —',
    'इसलिए app बदलकर कोई इसे पार नहीं कर सकता.',
    '',
    '---',
    '');

  /* ───────────────────────── STEPS ───────────────────────── */
  P('## ✅ SETUP STEPS — with the exact result you should see',
    '',
    'Run these **in order**. Each has a definite result, so you always know exactly',
    'where it broke. **Quote the STEP number when asking for help.**',
    '',
    '**क्रम से चलाइए.** हर step का नतीजा तय है, इसलिए पता चल जाएगा कि गड़बड़ी कहाँ है.',
    '**मदद माँगते समय STEP नंबर ज़रूर लिखिए.**',
    '',

    '### STEP 1 — Is Node.js installed?',
    '```',
    'node --version',
    '```',
    '✅ **You should see:** a version number, **v18 or higher** (e.g. `v22.11.0`)',
    '❌ `not recognized` / `command not found` → Node is not installed.',
    '❌ v16 or lower → install a newer Node, then **close and reopen the terminal**.',
    'हिंदी: नंबर v18 या उससे बड़ा दिखना चाहिए.',
    '',

    '### STEP 2 — Are you inside the right folder?',
    '```',
    'node -e "console.log(require(\'./package.json\').name)"',
    '```',
    '✅ **You should see:** the app\'s name printed, nothing else.',
    '❌ `Cannot find module` → you are in the wrong folder. `cd` into the unzipped',
    '   folder (the one that contains `App.js`) and try again.',
    'हिंदी: app का नाम छपना चाहिए. गलती आए तो सही फ़ोल्डर में `cd` कीजिए.',
    '',

    '### STEP 3 — Did the code survive the download?',
    '```',
    'node --check App.js',
    'node --check server/index.js',
    '```',
    '✅ **You should see: nothing at all.** Silence means both files are valid.',
    '❌ A `SyntaxError` → the ZIP extracted badly. Delete the folder, unzip again.',
    'हिंदी: **कुछ भी न छपना ही सही है.** खामोशी का मतलब फ़ाइल ठीक है.',
    '',

    '### STEP 4 — What commands does this package have?',
    '```',
    'node -e "console.log(Object.keys(require(\'./package.json\').scripts||{}).join(\', \'))"',
    '```',
    '✅ **You should see:** a comma-separated list of command names.',
    'Each one is run as `npm run <name>`. Write this list down — it is the',
    'authoritative list for *this* package, and the AI will ask for it.',
    'हिंदी: यह सूची इसी package की असली सूची है. इसे लिख लीजिए.',
    '',

    '### STEP 5 — Install the libraries',
    '```',
    'npm install',
    '```',
    'Then check it worked:',
    '```',
    'node -e "console.log(require(\'fs\').existsSync(\'node_modules\'))"',
    '```',
    '✅ **You should see:** `true`',
    '⚠️ Yellow `warn` lines during install are normal. Lines containing `ERR!` are not —',
    '   copy those to the AI.',
    '❌ On Windows: do not run this inside a OneDrive-synced folder.',
    '❌ On Android/Termux: stay inside Termux\'s own home folder, not Downloads.',
    'हिंदी: `true` आना चाहिए. `warn` ठीक है, `ERR!` नहीं.',
    '',

    '### STEP 6 — Create your secrets file',
    'Copy `.env.example` to `.env`, then open `.env` and fill in your own values.',
    '```',
    'copy .env.example .env        (Windows)',
    'cp   .env.example .env        (Mac / Linux / Termux)',
    '```',
    'Then check:',
    '```',
    'node -e "console.log(require(\'fs\').existsSync(\'.env\'))"',
    '```',
    '✅ **You should see:** `true`',
    '> ⚠️ **Never upload `.env` anywhere.** `.gitignore` already blocks it.',
    '> ⚠️ **`.env` कभी कहीं upload मत कीजिए.**',
    '',

    '### STEP 7 — Start the server',
    '```',
    'node server/index.js',
    '```',
    '✅ **You should see:** the terminal **stays open** and prints a start-up line',
    '   containing a port number. **Note that port — you need it in STEP 8.**',
    '❌ It prints an error and returns you to the prompt → the server did not start.',
    '   Send that whole output as STEP 7.',
    '❌ `EADDRINUSE` → that port is already busy, usually an older copy of this same',
    '   server. Close the other terminal, or change the port in `.env`.',
    '> Leave this window running. Open a **second** terminal for STEP 8.',
    'हिंदी: terminal खुला रहना चाहिए और port नंबर दिखना चाहिए. **दूसरी terminal**',
    'विंडो खोलकर STEP 8 कीजिए.',
    '',

    '### STEP 8 — Is the server actually answering?',
    'In the **second** terminal (replace 3000 with the port from STEP 7):',
    '```',
    'node -e "require(\'http\').get(\'http://localhost:3000\',function(r){console.log(\'REPLY\',r.statusCode)}).on(\'error\',function(e){console.log(\'NO REPLY\',e.code)})"',
    '```',
    '✅ **You should see:** `REPLY` followed by any number (200, 401, 404 — all fine).',
    '   Any reply at all means the server is alive and listening.',
    '❌ `NO REPLY ECONNREFUSED` → nothing is listening on that port. Go back to STEP 7',
    '   and check the port number you used.',
    'हिंदी: कोई भी नंबर के साथ `REPLY` आना चाहिए. `NO REPLY` का मतलब server चालू नहीं है.',
    '',

    '### STEP 9 — Start the app side',
    'Use the command for **your device**, from `START-HERE.md` (computer) or',
    '`START-HERE-PHONE.md` (phone only). The exact command depends on the list you',
    'saw in STEP 4.',
    '✅ **You should see:** the app opens, and the first screen appears.',
    '❌ **App opens but the screen is blank** → almost always the server address in',
    '   `config.js`. A phone cannot reach `localhost` — to a phone, `localhost` means',
    '   the phone itself. Put your computer\'s network address there instead, with both',
    '   devices on the same Wi-Fi.',
    'हिंदी: **सफ़ेद स्क्रीन का मतलब लगभग हमेशा `config.js` का पता गलत है.** फ़ोन के लिए',
    '`localhost` काम नहीं करता — कंप्यूटर का network पता डालिए, दोनों एक ही Wi-Fi पर.',
    '',

    '### STEP 10 — Make it yours',
    'Everything is running on your own computer. Now change it — see **CUSTOMISE** below.',
    'हिंदी: आपके कंप्यूटर पर सब चल गया. अब इसे अपना बनाइए — नीचे **CUSTOMISE** देखिए.',
    '',
    '> ### ➡️ STEP 11 onwards are in **`' + DEPLOY + '`**',
    '> Putting the server online, building the app file, and the whole Play Store route —',
    '> ' + 'each step with the result you should see, same as here.',
    '>',
    '> ### ➡️ STEP 11 से आगे **`' + DEPLOY + '`** में है',
    '> Server को इंटरनेट पर लाना, app फ़ाइल बनाना, और Play Store तक का पूरा रास्ता.',
    '',
    '---',
    '');

  /* ───────────────────────── FILE MAP ───────────────────────── */
  P('## 🗂 FILE MAP — every file in this package',
    '',
    '```',
    tree(files),
    '```',
    '',
    '### The ones you will actually touch',
    '',
    '| File | What it decides |',
    '|---|---|',
    '| `config.js` | server address, app-wide settings |',
    '| `theme.js` | colours, spacing, fonts, light/dark |',
    '| `App.js` | which screen opens, and the routes between them |',
    '| `screens/` | one file per screen — the visible pages |',
    '| `pricing.js` | free, paid, donation, or a mix |',
    '| `i18n.js` | the words on screen, and the languages |',
    '| `countries.js` | country rules, currency, documents |',
    '| `permissions.js` | what each role *sees* (display only) |',
    (has('Provider.js') ? '| `Provider.js` / `Owner.js` | the earning side and the running side |' : null),
    '| `server/db.js` | the shape of your data — the tables |',
    '| `server/guard.js` | 🔒 **who may do what — the real decision** |',
    '| `server/index.js` | the server itself |',
    (has('server/storage.js') ? '| `server/storage.js` | uploads |' : null),
    (has('server/live.js') ? '| `server/live.js` | live sessions and calls |' : null),
    '| `.env` | your secrets — never share this |',
    '',
    '---',
    '');

  /* ───────────────────────── CUSTOMISE ───────────────────────── */
  P('## 🎨 CUSTOMISE — change it to be yours',
    '',
    '### The three rules  /  तीन नियम',
    '',
    '1. **Copy the folder first.** Keep an untouched copy, so you can always compare.',
    '2. **Change one thing, then check.** After editing any `.js` file, run',
    '   `node --check <filename>` — silence means you did not break it.',
    '3. **Restart the server** after editing anything inside `server/`.',
    '   Stop it with `Ctrl + C`, start it again.',
    '',
    'हिंदी: **१.** पहले पूरे फ़ोल्डर की एक copy रख लीजिए. **२.** एक बार में एक चीज़',
    'बदलिए, फिर `node --check <फ़ाइल>` चलाइए — खामोशी का मतलब सब ठीक है.',
    '**३.** `server/` में कुछ भी बदलने के बाद server को `Ctrl + C` से बंद करके फिर चालू कीजिए.',
    '',
    '### What to change, and where  /  क्या कहाँ बदलें',
    '',
    '| You want to change | Open this | Look for |',
    '|---|---|---|',
    '| The app\'s name | `package.json`, and the title in `App.js` | the `name` field |',
    '| Main colour / brand | `theme.js` | the colour values at the top |',
    '| Dark mode colours | `theme.js` | the `dark` block |',
    '| Rounded corners, spacing, font sizes | `theme.js` | `radius`, `space`, `font` |',
    '| Server address | `config.js` | the URL near the top |',
    '| Text and languages | `i18n.js` | add or edit the phrases |',
    '| Which countries, currency | `countries.js` | the country list |',
    '| Free / paid / donation | `pricing.js` | the pricing model |',
    '| What a role can see | `permissions.js` | the role blocks |',
    '| 🔒 What a role may **do** | `server/guard.js` | the rule for that action |',
    '| Your data tables | `server/db.js` | the `CREATE TABLE` lines |',
    '| An existing screen | `screens/<that screen>.js` | the visible parts |',
    '| Passwords, keys, ports | `.env` | one setting per line |',
    '',
    '### Add a new screen  /  नई screen जोड़ना',
    '',
    '1. Copy an existing file in `screens/` and rename it.',
    '2. Rename the function inside it to match the new file name.',
    '3. Open `App.js` and add it next to the other screens, the same way.',
    '4. `node --check App.js` → silence.',
    '',
    'हिंदी: `screens/` की कोई फ़ाइल copy करके नया नाम दीजिए, अंदर function का नाम भी',
    'वही कीजिए, फिर `App.js` में बाक़ी screens की तरह जोड़ दीजिए.',
    '',
    '### Add a new field to your data  /  नया data field',
    '',
    '1. Open `server/db.js` and add the column to the right `CREATE TABLE`.',
    '2. **Delete your test database file and let it rebuild** — an existing database',
    '   will not grow a new column by itself.',
    '3. Restart the server.',
    '',
    '> ⚠️ Do this while you are still testing, before real users exist.',
    '> ⚠️ यह काम testing के दौरान कीजिए, असली users आने से पहले.',
    '',
    '### 🔒 The one thing to be careful with',
    '',
    'If you loosen a rule in `server/guard.js`, you are handing one role access to',
    'another role\'s data. That is the single change that can turn a working app into',
    'a leaking one. Change it only when you can say out loud exactly who should be',
    'allowed and why — and ask an AI to review the change, quoting this file.',
    '',
    'हिंदी: `server/guard.js` की कोई जाँच ढीली करने का मतलब है एक role को दूसरे role',
    'का data दे देना. यही एक बदलाव है जो चलती हुई app को लीक करने वाली बना देता है.',
    'बदलने से पहले साफ़-साफ़ तय कीजिए कि किसे अनुमति मिलनी चाहिए और क्यों.',
    '',
    '### If a change breaks something  /  अगर कुछ टूट जाए',
    '',
    'Copy the broken file, the error, and this master file to an AI, and say:',
    '**"APP ' + num + ', I edited `<file>` to do `<what>`, and now I get this."**',
    'That is all it needs.',
    '',
    '---',
    '');

  /* ───────────────────────── COMMON PROBLEMS ───────────────────────── */
  P('## 🔧 THE FIVE MOST COMMON PROBLEMS',
    '',
    '**`Cannot find module \'./something.js\'`** — a file is missing from the folder.',
    'Check the FILE MAP above. Listed there but not on disk → the ZIP did not extract',
    'fully. Delete the folder and unzip again. *(फ़ाइल गायब है — ZIP दोबारा निकालिए.)*',
    '',
    '**`node is not recognized`** — Node is not installed, or the terminal was opened',
    'before installing it. Install Node, then close and reopen the terminal.',
    '*(Node install कीजिए, फिर terminal बंद करके दोबारा खोलिए.)*',
    '',
    '**`EADDRINUSE`** — that port is already in use, often an older copy of this same',
    'server. Close the other window, or change the port in `.env`.',
    '*(Port पहले से व्यस्त है — दूसरी विंडो बंद कीजिए या `.env` में port बदलिए.)*',
    '',
    '**`npm install` fails** — on Windows avoid OneDrive-synced folders; on Android',
    'stay inside Termux\'s home folder; on a weak connection just run it again.',
    '*(दोबारा चलाइए — npm वहीं से आगे बढ़ता है.)*',
    '',
    '**Blank screen after everything installs** — the server address in `config.js`.',
    'A phone cannot reach `localhost`. Use the computer\'s network address, same Wi-Fi.',
    '*(`config.js` का पता ठीक कीजिए — फ़ोन के लिए `localhost` काम नहीं करता.)*',
    '',
    '---',
    '');

  /* ───────────────────────── CLOSE ───────────────────────── */
  P('## ONE HONEST NOTE  /  एक सच्ची बात',
    '',
    'This is a **starting point**, not a finished product. It gives you a working',
    'structure — roles kept apart, access enforced on the server, data shaped',
    'properly, screens laid out — so that you build on solid ground instead of an',
    'empty folder. What you add on top is yours to own and to sell.',
    '',
    'यह एक **शुरुआत** है, तैयार product नहीं. आपको एक चलता-फिरता ढाँचा मिल रहा है —',
    'roles अलग, जाँच server पर, data सही आकार में, screens तैयार. उसके ऊपर आप जो',
    'बनाएँगे, वो पूरी तरह आपका है.',
    '');

  if (BRAND.youtube || BRAND.contact || (BRAND.links && BRAND.links.length)) {
    P('---', '');
    if (BRAND.youtube) P('**More sets and walkthroughs / और sets:** ' + BRAND.youtube, '');
    if (BRAND.contact) P('**Questions about the package itself:** ' + BRAND.contact, '');
    (BRAND.links || []).forEach(function (l) {
      if (l && l.url) P('**' + (l.label || 'Link') + ':** ' + l.url, '');
    });
  }

  P('', '`' + C + '`  ·  APP ' + num + '  ·  ' + built, '');

  return L.join('\n');
}

/* সবার আগে চোখে পড়বে — নাম ০০ দিয়ে শুরু, তাই তালিকার একদম উপরে থাকে।
   ছোট রাখাই এর কাজ: কোন ফাইলটা খুলতে হবে সেটুকু বলা, তার বেশি কিছু নয়। */
function readme(app) {
  var C = code(app);
  var num = String(app && app.num || '0000');
  var name = String(app && app.name || 'App');
  return [
    '# ' + name + '  —  start here',
    '',
    '**Package code: `' + C + '`**  ·  APP ' + num,
    '',
    'Lots of files in this folder. **You only need to open one of them.**',
    'इस फ़ोल्डर में बहुत सारी फ़ाइलें हैं. **आपको सिर्फ़ एक खोलनी है.**',
    '',
    '---',
    '',
    '## Which file do I open?  /  कौन सी फ़ाइल खोलूँ?',
    '',
    '| Your situation | Open this |',
    '|---|---|',
    '| On a computer, English | **`START-HERE.md`** |',
    '| On a computer, हिंदी | **`START-HERE-HI.md`** |',
    '| Phone only, English | **`START-HERE-PHONE.md`** |',
    '| Phone only, हिंदी | **`START-HERE-PHONE-HI.md`** |',
    '',
    '**That is all you need to begin.** The other two files are for later:',
    '**शुरू करने के लिए बस इतना ही.** बाकी दो फ़ाइलें बाद के लिए हैं:',
    '',
    '| Later | Open this |',
    '|---|---|',
    '| 🆘 Something went wrong | **`' + FILE + '`** — 10 steps, each with the result you should see |',
    '| 🌍 Ready to go live / Play Store | **`' + DEPLOY + '`** — steps 11 to 30 |',
    '| 🏪 Play Store text, ready to edit | **`STORE-LISTING.md`** and **`PRIVACY.md`** |',
    '',
    '---',
    '',
    '## The rest of the folder  /  बाकी फ़ोल्डर',
    '',
    'Everything else here is **the app\'s own code**. You do not need to open any of it',
    'to get started, and nothing is missing — the full list is inside `' + FILE + '`.',
    '',
    'बाकी सब **app का अपना code** है. शुरू करने के लिए उसे खोलने की ज़रूरत नहीं,',
    'और कुछ गायब भी नहीं है — पूरी सूची `' + FILE + '` में है.',
    '',
    '```',
    '  screens/      the visible pages        /  दिखने वाले पन्ने',
    '  server/       the part that runs online /  ऑनलाइन चलने वाला हिस्सा',
    '  setup files   run these, do not read them / चलाइए, पढ़िए मत',
    '```',
    '',
    '---',
    '',
    '> 🆘 **Stuck at any point?** Upload **`' + FILE + '`** to any AI (Claude, ChatGPT,',
    '> Gemini) with a screenshot and say: **"APP ' + num + ', STEP _, this is what I got."**',
    '>',
    '> 🆘 **कहीं भी अटकें?** **`' + FILE + '`** किसी भी AI को स्क्रीनशॉट के साथ दीजिए और',
    '> कहिए: **"APP ' + num + ', STEP _, मुझे यह मिला."**',
    ''
  ].join('\n');
}

function deploy(app) { return dep.deployMd(app, BRAND, code(app)); }

/* Play Store-এ তোলার ফাইলগুলো — একসাথে, যাতে build-one.js-এ একটাই লুপ লাগে */
function storeFiles(app) {
  return [
    { name: 'app.json',         code: store.appJson(app),  label: 'app name, icon, package name' },
    { name: 'eas.json',         code: store.easJson(),     label: 'how the app file is built' },
    { name: 'make-icon.js',     code: store.makeIcon(app), label: 'run once: makes your icon' },
    { name: 'PRIVACY.md',       code: store.privacy(app),  label: 'required by Google - edit it' },
    { name: 'STORE-LISTING.md', code: store.listing(app),  label: 'what to type in Play Console' }
  ];
}

module.exports = { aiHelp, banner, code, deploy, readme, storeFiles, FILE, DEPLOY, README, BRAND };

};

/* ──────── gen-guide-hi.js ──────── */
__mods["gen-guide-hi.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-guide-hi.js — হিন্দি গাইড, দুটো
 *
 * ⚠️ ভাষাটা ইচ্ছে করেই "হিংলিশ" — বাক্য হিন্দিতে, কিন্তু terminal, npm,
 * config.js, commission — এই কারিগরি শব্দগুলো ইংরেজিতেই। কারণ দর্শক
 * পর্দায় ইংরেজিই দেখবেন। "टर्मिनल" লিখলে তিনি খুঁজবেন "टर्मिनल", আর
 * পাবেন না।
 *
 * ⚠️ অনুবাদ নয়, আলাদা করে লেখা। শব্দে শব্দে অনুবাদ করলে বাক্যগুলো
 * কৃত্রিম শোনায়, আর দর্শক বোঝেন এটা যন্ত্রে করা।
 */

const { COUNTRIES, docsForRole } = require('./countries.js');

function guideHI(a) {
  const c = COUNTRIES[a.country] || COUNTRIES.IN;
  const prov = docsForRole(a.country, a.cat, 'provider');
  const own  = docsForRole(a.country, a.cat, 'owner');

  return `# ${a.name}

${a.cloneOf ? a.cloneOf + ' जैसा' : 'एक पूरा'} app, जिसे आप सच में चला सकते हैं,
बदल सकते हैं, और launch कर सकते हैं. Code Knowledge पर live बनाया गया.
पूरा मुफ़्त, आपका.

---

## ये क्या है, और क्या नहीं है

**ये है** — तीन तरफ़ वाला चलता हुआ app. ग्राहक, सेवा देने वाले, और मालिक
के तौर पर आप. Sign-up, दस्तावेज़, payment, commission, payout, दस भाषाएँ,
live class, upload, और एक ऐसा access system जो सच में टिकता है.

**ये नहीं है** — ${a.cloneOf || 'कोई विशाल platform'}. उसके पीछे सैकड़ों
engineer और सालों का काम है. वो कोई zip file में नहीं देता.

आपके पास वो नींव है जहाँ से वे कंपनियाँ शुरू हुई थीं. और एक मोहल्ले में
launch करके ये पता लगाने के लिए काफ़ी है कि लोग इसे चाहते हैं या नहीं.
शुरुआत में यही एक सवाल मायने रखता है.

---

## पाँच क़दम में चलाइए

### Windows

1. इस folder को किसी सीधी जगह unzip कीजिए, जैसे \`C:\\projects\\${a.slug}\`
2. Folder खोलिए, **Shift** दबाकर खाली जगह पर right-click कीजिए
3. **Open PowerShell window here** या **Open in Terminal** चुनिए
4. ये लिखकर Enter दबाइए:
   \`\`\`
   powershell -ExecutionPolicy Bypass -File .\\setup.ps1
   \`\`\`
5. इंतज़ार कीजिए. जब एक पता दिखे, उसे खोल लीजिए.

> वो \`-ExecutionPolicy Bypass\` कोई जुगाड़ नहीं है. Windows scripts को
> डिफ़ॉल्ट रूप से रोकता है. ये सिर्फ़ इस एक file को, इस एक बार, चलने देता है.

### Mac या Linux

1. Folder unzip कीजिए
2. Terminal खोलिए
3. \`cd \` लिखिए, फिर folder को Terminal window पर खींचकर छोड़िए, Enter
4. \`bash setup.sh\` चलाइए

Setup script ख़ुद देखता है Node है या नहीं, आपकी अपनी secret keys बनाता है,
सब कुछ install करता है, और app चालू कर देता है. अभी इसे समझने की ज़रूरत नहीं.

---

## जब काम न करे

**"npm is not recognised"** — Node install नहीं है. nodejs.org पर जाइए,
जिस पर **LTS** लिखा है वो लीजिए, सबसे नया नहीं. Install के बाद
**terminal पूरी तरह बंद करके नया खोलिए**. पुराने terminal को नहीं पता कि
Node आ चुका है.

**बहुत देर लग रही है, या बीच में रुक गया** — आमतौर पर आपका antivirus, जो
हज़ारों नई छोटी files में से हर एक को जाँच रहा है. इस project folder को
उसकी exclusions में डाल दीजिए. सिर्फ़ ये folder, पूरी drive नहीं.

**"Port already in use"** — उस पते पर पहले से कुछ चल रहा है. उसे बंद
कीजिए, या \`.env\` में \`PORT\` बदल दीजिए.

**कुछ और ही** — \`node_modules\` मिटाइए, \`package-lock.json\` मिटाइए,
\`npm cache clean --force\` चलाइए, फिर setup दोबारा. ये हैरान करने वाली
कितनी ही दिक़्क़तें ठीक कर देता है, क्योंकि आधा-अधूरा उतरा package बाहर से
ठीक दिखता है और अंदर से टूटा होता है.

**फिर भी अटके हैं** — error की पहली दो lines धीरे-धीरे पढ़िए, ज़रूरत हो तो
ज़ोर से. उसके बाद का सब machine का ख़ुद से बात करना है. दस में नौ बार जवाब
वहीं साफ़ अंग्रेज़ी में लिखा होता है, और हम डर के मारे छोड़कर आगे बढ़ जाते हैं.

---

## इसे अपना बनाइए

जो कुछ बदलना है, सब **\`config.js\`** में है. एक ही file.

\`\`\`js
APP.name          आपके app का नाम
COUNTRY           '${a.country}' — मुद्रा, phone prefix, दस्तावेज़ बदल देता है
MONEY.commissionPercent   हर लेनदेन में आपका हिस्सा
KEYS              payment, map, push, ads
ADS               विज्ञापन कहाँ दिखें, या false करके हटा दीजिए
\`\`\`

रंग **\`theme.js\`** में हैं. दो values बदलिए, पूरा app बदल जाएगा.
एक मुख्य रंग और एक साथ वाला. छह रंग वाले apps पर भरोसा नहीं होता, और
users बता नहीं पाते क्यों, पर महसूस करते हैं.

### Launch से पहले तीन चीज़ें ज़रूर बदलिए

1. **नाम.** मेरा नहीं. उससे प्यार करने से *पहले* देख लीजिए कि domain खाली
   है और app store में वो नाम किसी ने नहीं लिया.
2. **आपकी secrets.** Setup ने \`.env\` में बना दी हैं. उस file को कभी
   GitHub पर मत डालिए — \`.gitignore\` पहले से रोकता है, उसे छेड़िए मत.
3. **App का identifier.** पूरे app store में अनोखा होना चाहिए. Release के
   लिए build करने से पहले बदलिए, launch की तारीख़ बताने के बाद नहीं.

---

## पैसा

पाँच तरीक़े, और हर चीज़ के लिए अलग चुन सकते हैं:

| तरीक़ा | मतलब |
|---|---|
| Free | कोई शुल्क नहीं |
| Paid | तय क़ीमत |
| Donation | जो चाहें दें, और शून्य भी एक असली जवाब है |
| Freemium | पहले कुछ मुफ़्त, बाक़ी पैसे में |
| Subscription | महीने या साल में |

इनमें से कौन से चलेंगे, ये आप तय करते हैं. हर provider उसी दायरे में चुनता
है. पर provider की क़ीमत आप तय नहीं कर सकते — जो platform ऐसा करते हैं,
उनके provider पहले प्रतियोगी के पास चले जाते हैं.

**Donation पर commission डिफ़ॉल्ट रूप से शून्य है.** टिप में से हिस्सा
काटना देने वाले को चोरी जैसा लगता है, और फिर वो देना बंद कर देते हैं.

### पहले असली payout से पहले

दूसरों की तरफ़ से पैसा लेना लगभग हर देश में क़ानून के दायरे में आता है, और
नियम हर जगह अलग हैं. Business registration, tax, पहचान की जाँच.

**पहले payout से पहले किसी स्थानीय accountant से बात कीजिए, बाद में नहीं.**
एक दोपहर और थोड़ी fee. यही फ़र्क़ है एक business और एक मुसीबत के बीच.
इस गाइड में कुछ भी क़ानूनी सलाह नहीं है.

---

## दस्तावेज़, ${c.name} में

\`config.js\` में \`COUNTRY\` बदलिए, ये सब उसी के साथ बदल जाएगा.

**ग्राहक से माँगा जाता है:** ${docsForRole(a.country, a.cat, 'customer').docs.join(', ')}.
इससे ज़्यादा कुछ नहीं, जानबूझकर. हर अतिरिक्त ख़ाना आपके कुछ लोग ले जाता है.

**सेवा देने वाले से:** ${prov.docs.join(', ')}.

**मालिक के तौर पर आपको चाहिए:** ${own.docs.join(', ')}.
ये मेरा नियम नहीं है. दूसरों का पैसा रखने वाले से ज़्यादातर देश यही माँगते हैं.

> जब कोई आपको पहचान का दस्तावेज़ भेजता है, उसकी ज़िम्मेदारी आपकी हो जाती है.
> File रखिए, नंबर कभी नहीं. Log मत कीजिए. Account बंद होने पर मिटा दीजिए.

---

## कौन क्या देख सकता है

ये किसी भी feature से ज़्यादा ज़रूरी है, इसलिए एक बार ध्यान से पढ़िए.

**App में बटन छिपाना सुरक्षा नहीं है.** कोई भी बिना app खोले सीधे आपके
server को request भेज सकता है. असली जाँच \`server/guard.js\` में है, और वो
हर एक request पर चलती है.

- **ग्राहक** सिर्फ़ अपने ही records देखता है.
- **सेवा देने वाला** सिर्फ़ अपनी listing और अपना पैसा. दूसरे provider का
  नहीं, चाहे दोनों की भूमिका एक ही हो. यही जाँच — भूमिका *और* मालिकाना —
  उन leaks को रोकती है जिनके बारे में आप ख़बरों में पढ़ते हैं.
- **Staff** को ठीक उतना, जितना आपने tick किया. उससे एक क़दम ज़्यादा नहीं.
- **आप** सब कुछ देख सकते हैं, क्योंकि support के काम में ज़रूरत पड़ती है.
  पर किसी और बनकर काम नहीं कर सकते. ग्राहक के नाम पर order देना या
  provider का payout कहीं और भेजना — आपके लिए भी मना है.
- **जब भी आप किसी और का record खोलते हैं, वो लिखा जाता है.** जिस देखने का
  कोई निशान न बचे, उसे चोरी से अलग नहीं किया जा सकता.

अपना login staff के साथ कभी साझा मत कीजिए. उन्हें ठीक से invite कीजिए और
सिर्फ़ ज़रूरी चीज़ें tick कीजिए. जाने पर आप एक account हटाते हैं, बजाय उस
password को बदलने के जो सबको पता है.

---

## भाषाएँ

दस तैयार हैं, और हर व्यक्ति अपनी चुनता है. आप इसे अंग्रेज़ी में चला सकते
हैं जबकि तीस ग्राहक तीस अलग भाषाओं में पढ़ रहे हों.

नई जोड़ने के लिए: \`i18n.js\` खोलिए, \`en\` वाला हिस्सा copy कीजिए, values
का अनुवाद कीजिए, keys बिल्कुल वैसी ही रखिए, और code को \`LANGUAGES\` में
जोड़ दीजिए. जो अनुवाद नहीं किया, वो अंग्रेज़ी पर लौट आता है — तो अधूरी
भाषा से कुछ नहीं टूटता.

अरबी और उर्दू में पूरा layout पलट जाता है, सिर्फ़ text नहीं. वो सँभाला हुआ है.

---

## Online लाना

शुरू करने के लिए सब मुफ़्त:

1. **Code** — GitHub पर डालिए. मुफ़्त, असीमित public repositories.
2. **Server** — Render या Railway. Free tier कुछ देर बाद सो जाता है, तो
   पहली बार खुलने में तीस सेकंड लगते हैं. शुरुआत में ठीक है.
3. **Files** — Cloudflare R2 में 10 GB मुफ़्त, और download पर कोई शुल्क
   नहीं — यही हिस्सा आमतौर पर काटता है.
4. **Live class** — LiveKit open source है. उनका hosted plan महीने में
   लगभग पचास घंटे तक मुफ़्त. उसके बाद पैसा लगता है, और कोई चतुराई इससे
   नहीं बचाती: बहुत लोगों तक video भेजने के लिए असली machines चाहिए.

अपनी keys host की **environment settings** में डालिए, कभी किसी upload होने
वाली file में नहीं.

---

## पहले सौ users कैसे आएँ

सबसे मुश्किल हिस्सा, और इसमें code कुछ नहीं है.

**पहले supply वाली तरफ़ जाइए.** पहले दिन आपका app खाली है. अगर पहले ग्राहक
लाए, तो वो खाली app खोलेंगे और कभी नहीं लौटेंगे.

**उन्हें app मत बेचिए. उनकी खाली जगह बेचिए.** "आपके मंगलवार ख़ाली जाते हैं.
मैं उन मंगलवारों के लिए लोग लाऊँगा, और जब तक कोई सच में नहीं आता, आप मुझे
कुछ नहीं देंगे." कोई fee नहीं, कोई contract नहीं, उनका कोई नुक़सान नहीं.
इस बात पर लोग हाँ कहते हैं.

**एक मोहल्ले की दस असली listings, पूरे देश में फैली हज़ार से बेहतर हैं.**
एक मोहल्ले से शुरू कीजिए. एक शहर से नहीं.

**तीन आँकड़े जल्दी सीखिए.** एक ग्राहक लाने में कितना ख़र्च, वो कितना लाता
है, कितने लौटकर आते हैं. काग़ज़ पर तीन आँकड़े. जो लोग बीच में छोड़ देते हैं,
उन्हें ये कभी पता ही नहीं होता; उन्हें बस लगता है कि काम नहीं चल रहा.

---

## अगर अटक जाएँ

ऐसे पूछिए, घंटे भर में जवाब मिलता है:

1. आप क्या उम्मीद कर रहे थे
2. असल में क्या हुआ
3. Error की **पहली पाँच lines**, text की तरह copy करके, photo नहीं

लगभग एक तिहाई बार, लिखते-लिखते ही आप ख़ुद हल कर लेते हैं.

---

हमेशा मुफ़्त. कोई course नहीं, कोई upsell नहीं, कोई बंद download नहीं.
काम आया हो, तो किसी एक अटके हुए इंसान को बता दीजिए. बस इतनी सी बात.
`;
}

function guidePhoneHI(a) {
  return `# ${a.name} — फ़ोन पर

Laptop नहीं है? आज भी आप इसमें से ज़्यादातर कर सकते हैं, मुफ़्त में.

ये गाइड का कोई छोटा संस्करण नहीं है. यही जगह पहुँचने का दूसरा रास्ता है.
बहुत से काम करने वाले developers ने ठीक यहीं से शुरू किया था.

---

## पहले सच्ची तस्वीर

**फ़ोन से क्या हो सकता है:** ये सब सीखना, code बदलना, app चलाना, अपनी ही
screen पर चलता हुआ देखना, किसी client को दिखाना, और इतना कमा लेना कि
laptop आ जाए.

**क्या नहीं हो सकता:** app store के लिए आख़िरी install होने वाली file बनाना,
या ऐसी libraries चलाना जिन्हें native code compile करना पड़ता है.

तो जो क्रम ज़्यादातर लोगों के लिए सच में काम करता है: फ़ोन पर सीखिए, कुछ
असली बनाइए, पैसे कमाइए, फिर machine ख़रीदिए. उल्टा नहीं.

---

## रास्ता 1 — Snack (सबसे आसान, कुछ install नहीं)

शुरू करने की सबसे अच्छी जगह. किसी भी फ़ोन browser में चलता है.

1. Browser में **snack.expo.dev** खोलिए
2. अपने app store से **Expo Go** install कीजिए
3. Snack में बाईं तरफ़ file list खोलकर इस project की files एक-एक करके
   बनाइए. \`App.js\`, \`theme.js\`, \`config.js\` से शुरू कीजिए
4. इस download से content copy करके paste कीजिए
5. **Run** दबाइए, फिर Expo Go से code scan कीजिए

App आपके अपने फ़ोन पर खुल जाएगा. सच में चलता हुआ, उसकी तस्वीर नहीं.

> तीन-चार screens से शुरू कीजिए, पैंतीस files एक साथ नहीं. पहले चलता हुआ
> देखिए, फिर बढ़ाइए. सब कुछ paste करके फिर चलाने पर, जब टूटेगा तो पता ही
> नहीं चलेगा कौन से paste ने तोड़ा.

---

## रास्ता 2 — StackBlitz (browser में असली terminal)

जब server भी चलाना हो.

1. इस project को फ़ोन के browser से GitHub पर डालिए — github.com मोबाइल
   पर ठीक चलता है, और web page से files upload हो जाती हैं
2. **stackblitz.com/github/YOUR-NAME/${a.slug}** खोलिए
3. वो ख़ुद install करके चालू कर देता है

बिना कुछ install किए एक चलता हुआ terminal मिल जाता है. छोटी screen पर
तंग लगता है, पर असली है.

---

## रास्ता 3 — Termux (Android पर असली Linux terminal)

धीमा और ज़्यादा मेहनत का, पर बिल्कुल असली चीज़.

1. **Termux को F-Droid से** install कीजिए, Play Store से नहीं. Play Store
   वाला पुराना और छोड़ा हुआ है, और तीसरे क़दम पर ही फ़ेल हो जाएगा. इस पेज
   पर और किसी बात से ज़्यादा लोग यहीं अटकते हैं.
2. \`pkg update && pkg upgrade\`
3. \`pkg install nodejs git\`
4. इस project को एक folder में लाइए, फिर उसमें \`cd\` कीजिए
5. \`bash setup-termux.sh\`

फिर फ़ोन के browser में **http://localhost:4000** खोलिए.

> Packages install होते समय screen चालू रखिए, नहीं तो Android रोक देगा.
> फ़ोन पर पंद्रह मिनट लग सकते हैं. ये सामान्य है, ख़राबी नहीं.

---

## टाइप करना सहनीय बनाना

Touchscreen पर code लिखना सच में तकलीफ़देह है. दो चीज़ें बहुत मदद करती हैं,
और दोनों सस्ती हैं:

- **एक छोटा Bluetooth keyboard.** ज़्यादातर जगहों पर बाहर खाने से सस्ता,
  और ये सब कुछ बदल देता है.
- **एक clipboard manager app.** एक ही चीज़ें बार-बार paste करनी पड़ेंगी.

अगर दोनों मुमकिन न हों, तो छोटे-छोटे सत्रों में एक-एक file पर काम कीजिए.
काँच पर एक बैठक में तीन सौ lines टाइप करने की कोशिश आपसे हार मनवा देगी,
और वो हार ऐसी लगेगी जैसे code मुश्किल था — जबकि सिर्फ़ keyboard था.

---

## फ़ोन पर क्या टूटता है, और क्यों

**Termux में "Permission denied"** — Android apps को कहीं भी लिखने नहीं
देता. Termux के अपने home folder के अंदर ही रहिए. Downloads folder में
काम करने की कोशिश मत कीजिए.

**Snack कहता है कोई package नहीं मिला** — Snack सिर्फ़ कुछ libraries
चलाता है. जिन्हें native code चाहिए वो वहाँ नहीं चलेंगी. Screens और
layout के लिए Snack, server कहीं और.

**App बदलते ही सब रुक जाता है** — Android battery बचाने के लिए background
काम रोक देता है. Install होते समय Termux सामने रखिए, और फ़ोन की settings
में उसके लिए battery optimisation बंद कर दीजिए.

**Memory ख़त्म हो जाती है** — पहले browser के tabs बंद कीजिए. फ़ोन पर
browser आमतौर पर project से ज़्यादा memory लेता है.

---

## बाक़ी सब कुछ

मुख्य गाइड में पैसा, दस्तावेज़, permissions, online लाना, और पहले सौ users
— सब है. वो सब फ़ोन और laptop दोनों पर एक जैसा है.

उन हिस्सों के लिए **START-HERE-HI.md** पढ़िए. ऊपर का पाँच-क़दम वाला हिस्सा
छोड़ दीजिए; वो आप अपने तरीक़े से कर चुके हैं.

---

## एक बात कहने लायक़

फ़ोन और laptop के बीच का फ़र्क़ असली है, पर वो आराम का फ़र्क़ है, क़ाबिलियत
का नहीं. आपका app इस्तेमाल करने वाले को कभी पता नहीं चलेगा कि आपने उसे
किस पर बनाया, और न ही उसे फ़र्क़ पड़ेगा.

पहला बदसूरत version फ़ोन पर बनाइए. Ship कीजिए. एक पैसे देने वाला user
लाइए. फिर उसी के पैसे से machine ख़रीदिए.
`;
}

module.exports = { guideHI, guidePhoneHI };

};

/* ──────── gen-guide-phone.js ──────── */
__mods["gen-guide-phone.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-guide-phone.js — শুধু ফোন আছে যাঁদের জন্য
 *
 * ⚠️ আলাদা ফাইল কেন — এক ফাইলে রাখলে ফোনওয়ালা দর্শক প্রথম দশ পাতা
 * টার্মিনালের কথা পড়ে ধরে নেন এটা তাঁর জন্য নয়, আর বন্ধ করে দেন।
 * আলাদা ফাইলে প্রথম লাইনেই বোঝা যায় "এটা আমার জন্য"।
 *
 * ⚠️ এখানে কোনো সহানুভূতি নেই, শুধু সত্য পথ। ভারত, নাইজেরিয়া,
 * ইন্দোনেশিয়ায় বহু ভালো ডেভেলপারের প্রথম যন্ত্র ফোনই ছিল।
 */

function guidePhone(a) {
  return `# ${a.name} — on a phone

No laptop? You can still do most of this today, for free.

This is not a lesser version of the guide. It is a different route to the
same place. Plenty of working developers started exactly here.

---

## The honest picture first

**What you can do from a phone:** learn all of it, edit the code, run the
app, see it working on your own screen, show it to a client, and earn
enough to buy a laptop.

**What you cannot do:** build the final installable file for an app store,
or use libraries that need native code compiled.

So the order that actually works for most people is: learn on the phone,
build something real, get paid, then buy the machine. Not the other way
around.

---

## Route 1 — Snack (easiest, nothing to install)

Best place to start. Works in any phone browser.

1. Open **snack.expo.dev** in your browser
2. Install **Expo Go** from your app store
3. In Snack, open the file list on the left and create the files from this
   project, one at a time. Start with \`App.js\`, \`theme.js\`, \`config.js\`
4. Copy the contents from this download and paste them in
5. Press **Run**, then scan the code with Expo Go

The app opens on your own phone. Actually running, not a picture of it.

> Start with three or four screens, not all thirty-five files. See it work,
> then add more. Pasting everything before running anything means that when
> it breaks you have no idea which paste broke it.

---

## Route 2 — StackBlitz (a real terminal in the browser)

For when you want the server running too.

1. Put this project on GitHub from your phone browser — github.com works
   fine on mobile, and you can upload files from the web page
2. Open **stackblitz.com/github/YOUR-NAME/${a.slug}**
3. It installs and starts by itself

You get a working terminal without installing anything. On a small screen
it is cramped, but it is real.

---

## Route 3 — Termux (a real Linux terminal on Android)

Slower and more work, but it is the genuine thing.

1. Install **Termux from F-Droid**, not from the Play Store. The Play Store
   version is old and abandoned and will fail at step 3. This trips up more
   people than anything else on this page.
2. \`pkg update && pkg upgrade\`
3. \`pkg install nodejs git\`
4. Get this project into a folder, then \`cd\` into it
5. \`bash setup-termux.sh\`

Then open **http://localhost:4000** in your phone browser.

> Keep the screen on while packages install, or Android may pause it.
> On a phone it can take fifteen minutes. That is normal, not broken.

---

## Making typing bearable

A touchscreen keyboard is genuinely painful for code. Two things help
enormously, and both are cheap:

- **A small Bluetooth keyboard.** Cheaper than a meal out in most places,
  and it changes everything.
- **A clipboard manager app.** You will paste the same things repeatedly.

If neither is possible, work in short sessions on one file at a time.
Trying to type three hundred lines in one sitting on glass will make you
give up, and the giving up will feel like the code was too hard when it
was only the keyboard.

---

## What breaks on phones, and why

**"Permission denied" in Termux** — Android does not let apps write
anywhere they like. Stay inside Termux's own home folder. Do not try to
work in the Downloads folder.

**Snack says a package is missing** — Snack only allows some libraries.
Anything needing native code will not work there. Use it for the screens
and the layout; run the server elsewhere.

**Everything stops when you switch apps** — Android pauses background
work to save battery. Keep Termux in the foreground while it installs,
and turn off battery optimisation for it in your phone settings.

**It runs out of memory** — close your browser tabs first. On a phone the
browser is usually using more memory than the project.

---

## Everything else

The main guide covers the money, the documents, the permissions, how to
put it online, and how to get your first hundred users. All of that is the
same whether you are on a phone or a laptop.

Read **START-HERE.md** for those parts. Skip the five-steps section at the
top; you have already done it your own way.

---

## One thing worth saying

The gap between phone and laptop is real, but it is a gap in comfort, not
in ability. Nobody who uses your app will know or care what you built it on.

Build the ugly first version on the phone. Ship it. Get one paying user.
Then buy the machine with their money.
`;
}

module.exports = { guidePhone };

};

/* ──────── gen-guide-en.js ──────── */
__mods["gen-guide-en.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-guide-en.js — ইংরেজি গাইড
 *
 * ⚠️ দুটো আলাদা ফাইল, ইচ্ছে করেই:
 *     START-HERE.md          কম্পিউটার আছে যাঁদের
 *     START-HERE-PHONE.md    শুধু ফোন আছে যাঁদের
 *
 * এক ফাইলে দুটো রাখলে ফোনওয়ালা দর্শক প্রথম দশ পাতা টার্মিনালের কথা পড়ে
 * ধরে নেন এটা তাঁর জন্য নয়। আলাদা ফাইলে প্রথম লাইনেই বোঝা যায় "এটা আমার"।
 *
 * ⚠️ গাইডে দাবি করা হয় না যে এটা Facebook বা Byju's। যা দেওয়া হচ্ছে
 * তা-ই লেখা আছে — একটা চলার মতো ভিত্তি। বাড়িয়ে বললে দর্শক নামিয়ে
 * মিলিয়ে দেখে, আর তখন বাকি সব কথার উপরও বিশ্বাস চলে যায়।
 */

const { COUNTRIES, docsForRole } = require('./countries.js');

function guideEN(a) {
  const c = COUNTRIES[a.country] || COUNTRIES.IN;
  const prov = docsForRole(a.country, a.cat, 'provider');
  const own  = docsForRole(a.country, a.cat, 'owner');
  const what = a.cloneOf ? (a.cloneOf + '-style') : 'a complete';

  return `# ${a.name}

${what} app you can actually run, change, and launch.
Built live on Code Knowledge. Yours to keep, free.

---

## What this is, and what it is not

**It is** a working three-sided app. Customers, providers, and you as the
owner. Sign-ups, documents, payments, commission, payouts, ten languages,
live sessions, uploads, and an access system that actually holds.

**It is not** ${a.cloneOf || 'a giant platform'}. That has hundreds of
engineers and years of work behind it. Nobody hands you that in a zip file.

What you have is the foundation those companies started from, and it is
enough to launch in one neighbourhood and find out whether people want it.
That is the only question that matters at the start.

---

## Run it in five steps

### Windows

1. Unzip this folder somewhere simple, like \`C:\\projects\\${a.slug}\`
2. Open the folder, hold **Shift**, right-click on empty space
3. Choose **Open PowerShell window here** or **Open in Terminal**
4. Type this and press Enter:
   \`\`\`
   powershell -ExecutionPolicy Bypass -File .\\setup.ps1
   \`\`\`
5. Wait. When an address appears, open it.

> That \`-ExecutionPolicy Bypass\` is not a trick. Windows blocks scripts by
> default. This allows this one file, this one time.

### Mac or Linux

1. Unzip the folder
2. Open Terminal
3. Type \`cd \` then drag the folder onto the Terminal window, press Enter
4. Run \`bash setup.sh\`

The setup script checks Node, creates your own private keys, installs
everything, and starts the app. You do not have to understand any of it yet.

---

## When it does not work

**"npm is not recognised"** — Node is not installed. Go to nodejs.org, take
the one marked **LTS**, not the newest. Install it, then **close the terminal
completely and open a new one**. An old terminal does not know Node exists.

**It takes forever, or stops halfway** — usually your antivirus, checking
every one of the thousands of small files being written. Add this project
folder to its exclusions. Just this folder, not the whole drive.

**"Port already in use"** — something else is on that address. Close it, or
change \`PORT\` in your \`.env\` file.

**Something else entirely** — delete \`node_modules\`, delete
\`package-lock.json\`, run \`npm cache clean --force\`, then run setup again.
That fixes a surprising number of things, because a half-downloaded package
looks fine from the outside and is broken inside.

**Still stuck** — read the first two lines of the error slowly, out loud if
you have to. Everything after those two lines is the machine talking to
itself. Nine times out of ten the answer is right there in plain English,
and we skim past it because it looks frightening.

---

## Make it yours

Everything you need to change is in **\`config.js\`**. One file.

\`\`\`js
APP.name          your app's name
COUNTRY           '${a.country}' — changes currency, phone prefix, documents
MONEY.commissionPercent   your cut of each transaction
KEYS              payments, maps, push, ads
ADS               where adverts appear, or false to remove them
\`\`\`

Colours live in **\`theme.js\`**. Change two values, the whole app changes.
Pick one main colour and one accent. Apps using six colours look
untrustworthy and users cannot say why, but they feel it.

### Three things you must change before launching

1. **The name.** Not mine. Check the domain is free and the name is not
   taken in your app store *before* you fall in love with it.
2. **Your secrets.** Setup made them for you in \`.env\`. Never put that
   file on GitHub — \`.gitignore\` already blocks it, leave that alone.
3. **The app identifier.** It has to be unique across the whole app store.
   Change it before you build for release, not after you have announced
   a launch date.

---

## The money

Five ways to charge, and you choose per item:

| Model | What it means |
|---|---|
| Free | No charge |
| Paid | A fixed price |
| Donation | Pay what you want, and zero is a real answer |
| Freemium | The first few are free, the rest are paid |
| Subscription | Monthly or yearly |

You set which of these are allowed. Each provider chooses within that.
You cannot set a provider's price for them — platforms that do lose their
providers to the first competitor who does not.

**Commission on donations defaults to zero.** Taking a cut of a tip feels
like theft to the person who gave it, and they stop giving.

### Before your first real payout

Taking money on behalf of other people is regulated almost everywhere, and
the rules differ by country. Business registration, tax, identity checks,
holding periods.

**Talk to a local accountant before your first payout, not after.** One
afternoon and a small fee. It is the difference between a business and a
problem. Nothing in this guide is legal advice.

---

## Documents, in ${c.name}

Change \`COUNTRY\` in \`config.js\` and all of this changes with it.

**Customers** are asked for: ${docsForRole(a.country, a.cat, 'customer').docs.join(', ')}.
Nothing more, on purpose. Every extra box loses you some people.

**Providers** are asked for: ${prov.docs.join(', ')}.

**You, as the owner**, will need: ${own.docs.join(', ')}.
That is not my rule. Most countries require it of anyone holding other
people's money.

> When someone sends you an identity document, you become responsible for
> it. Store the file, never the number. Never log it. Delete it when the
> account closes.

---

## Who can see what

This matters more than any feature, so read it once properly.

**Hiding a button in the app is not security.** Anyone can send a request
straight to your server without ever opening the app. The real checks live
in \`server/guard.js\`, and they run on every single request.

- A **customer** only ever sees their own records.
- A **provider** only ever sees their own listings and their own money.
  Not another provider's, even though they share a role. That check —
  role *and* ownership — is what stops the leaks you read about.
- **Staff** get exactly what you ticked for them, nothing more.
- **You** can look at anything, because support work needs it. You cannot
  act as somebody else. Placing an order in a customer's name or moving a
  provider's payout is refused even for you.
- **Every time you open somebody else's record it is written down.** A look
  that leaves no trace cannot be told apart from theft.

Never share your own login with staff. Invite them properly and tick only
what they need. When they leave, you remove one account instead of changing
a password everybody knows.

---

## Languages

Ten are set up, and each person picks their own. You might run this in
English while thirty customers each read something different.

To add one: open \`i18n.js\`, copy the \`en\` block, translate the values,
keep the keys identical, add the code to \`LANGUAGES\`. Anything you have
not translated falls back to English, so a half-finished language never
breaks anything.

Arabic and Urdu flip the entire layout, not just the text. That is handled.

---

## Putting it online

Free to start, all of it:

1. **Code** — push to GitHub. Free, unlimited public repositories.
2. **Server** — Render or Railway. Free tiers sleep after inactivity, so the
   first visit takes about thirty seconds to wake. Fine while you are small.
3. **Files** — Cloudflare R2 gives 10 GB and charges nothing for downloads,
   which is the part that usually hurts.
4. **Live sessions** — LiveKit is open source. Their hosted plan is free up
   to roughly fifty hours a month. Beyond that it costs money, and no amount
   of clever code avoids it: sending video to many people needs real machines.

Put your keys in the host's **environment settings**, never in a file you
upload.

---

## Getting your first hundred users

The hardest part, and nothing here is code.

**Go to the supply side first.** On day one your app is empty. If you find
customers first they open an empty app and never come back.

**Do not sell them the app. Sell them the empty seat.** "Your Tuesdays are
quiet. I will bring you people for those Tuesdays, and you pay me nothing
until somebody actually turns up." No fee, no contract, no risk to them.
That is a conversation people say yes to.

**Ten real listings in one neighbourhood beat a thousand across a country.**
Start with one neighbourhood. Not one city.

**Learn three numbers early.** What one customer costs to find, what they
bring in, how many come back. Three numbers on paper. Most people who quit
never knew them; they just felt it was not working.

---

## Files

\`\`\`
setup.ps1 / setup.sh / setup-termux.sh   run one of these
config.js         everything you change
theme.js          colours
pricing.js        free, paid, donation, or a mix
permissions.js    who may do what
i18n.js           languages
screens/          what customers see
Provider.js       what providers see
Owner.js          what you see
server/           the part that decides, not just displays
\`\`\`

---

## If you get stuck

Ask like this and people answer within the hour:

1. What you expected to happen
2. What actually happened
3. The **first five lines** of the error, copied as text, not a photo

About a third of the time you will solve it yourself while writing it down.

---

Free forever. No course, no upsell, no locked download.
If it helped, tell one person who is stuck. That is the whole ask.
`;
}

module.exports = { guideEN };

};

/* ──────── gen-pricing.js ──────── */
__mods["gen-pricing.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-pricing.js — কে কী দামে দেবে, সেটা মালিক আর সেবাদাতা ঠিক করবেন
 *
 * ⚠️ আগে ধরে নেওয়া হয়েছিল সব কিছুরই একটা দাম আছে। বাস্তবে তা নয় —
 * একজন শিক্ষক প্রথম তিনটে পাঠ বিনামূল্যে দিতে পারেন, একজন মিস্ত্রি
 * "যা খুশি দিন" বলতে পারেন, একটা কমিউনিটি অ্যাপ পুরোটাই দান-নির্ভর
 * হতে পারে। এগুলো আলাদা ব্যবসা নয়, একই অ্যাপের আলাদা সিদ্ধান্ত।
 *
 * তাই পাঁচ রকম:
 *     free       বিনামূল্যে
 *     paid       নির্দিষ্ট দাম
 *     donation   দর্শক যা দিতে চান (শূন্যও চলে)
 *     freemium   কিছুটা ফ্রি, বাকিটা টাকায়
 *     subscription  মাসে/বছরে
 *
 * ⚠️ মালিক সীমা বাঁধেন, সেবাদাতা তার ভেতরে বাছেন। মালিক চাইলে দান
 * বন্ধ রাখতে পারেন, বা সর্বনিম্ন দাম বেঁধে দিতে পারেন। কিন্তু সেবাদাতার
 * হয়ে দাম ঠিক করে দিতে পারেন না — ওটা করলে সেবাদাতারা চলে যান।
 */

function pricingSchema() {
  return `
-- ---------------------------------------------------------------
-- Pricing. Not every good thing has a price tag, and an app that
-- assumes it does cannot host a teacher giving three free lessons or a
-- repairman saying "pay what you think it was worth".
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_policy (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,               -- 'platform' | 'provider'
  owner_id TEXT REFERENCES users(id),-- null for the platform-wide row
  -- Which models are allowed at all. The owner sets this once; providers
  -- choose within it. JSON array: ["free","paid","donation",...]
  allowed_models TEXT NOT NULL DEFAULT '["free","paid","donation","freemium","subscription"]',
  min_price_minor INTEGER DEFAULT 0,
  max_price_minor INTEGER DEFAULT 0, -- 0 means no ceiling
  commission_percent INTEGER,        -- null means use the platform figure
  -- Donations usually carry a lower cut, or none. Taking twelve percent
  -- of a tip feels like theft to the person who gave it, and they stop.
  donation_commission_percent INTEGER DEFAULT 0,
  free_trial_days INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- What one specific thing costs. Attached to any item, lesson, listing.
CREATE TABLE IF NOT EXISTS item_pricing (
  item_id TEXT PRIMARY KEY,
  model TEXT NOT NULL DEFAULT 'paid',
  price_minor INTEGER DEFAULT 0,
  -- For donation: a suggestion, never a requirement. Zero must always
  -- be an accepted answer or it is not a donation, it is a price.
  suggested_minor INTEGER DEFAULT 0,
  min_donation_minor INTEGER DEFAULT 0,
  -- For freemium: how much is open before paying. Preview lessons,
  -- first chapter, first repair quote. Whatever the sector calls it.
  free_units INTEGER DEFAULT 0,
  period TEXT,                       -- 'month' | 'year' for subscriptions
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT REFERENCES users(id),
  plan TEXT NOT NULL, price_minor INTEGER NOT NULL, period TEXT NOT NULL,
  started_at TEXT NOT NULL, renews_at TEXT, cancelled_at TEXT,
  state TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id),
  to_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT, amount_minor INTEGER NOT NULL,
  message TEXT, at TEXT NOT NULL
);
`;
}

function pricingLogic(a) {
  return `// pricing.js — what something costs, and who decided.
//
// The owner sets the boundaries. Each provider chooses inside them.
// The owner cannot set a provider's price for them; platforms that do
// that lose their providers, usually to the first competitor who does not.

import { MONEY } from './config';

export const MODELS = ['free', 'paid', 'donation', 'freemium', 'subscription'];

export const MODEL_LABELS = {
  free:         'Free for everyone',
  paid:         'A fixed price',
  donation:     'Pay what you want',
  freemium:     'Some free, then paid',
  subscription: 'A regular payment',
};

/* What a customer actually owes right now. */
export function priceFor(pricing, opts = {}) {
  const p = pricing || { model: 'paid', price_minor: 0 };
  switch (p.model) {
    case 'free':
      return { due: 0, label: 'Free', canSkip: true };

    case 'donation':
      // Zero has to be a real answer. The moment a minimum appears, this
      // stops being a donation and becomes a price wearing a friendly hat.
      return {
        due: Math.max(p.min_donation_minor || 0, opts.chosen || 0),
        label: 'Pay what you want',
        suggested: p.suggested_minor || 0,
        canSkip: (p.min_donation_minor || 0) === 0,
      };

    case 'freemium':
      return (opts.unitIndex || 0) < (p.free_units || 0)
        ? { due: 0, label: 'Free preview', canSkip: true }
        : { due: p.price_minor || 0, label: 'Unlock the rest', canSkip: false };

    case 'subscription':
      return {
        due: p.price_minor || 0,
        label: 'Per ' + (p.period || 'month'),
        recurring: true, canSkip: false,
      };

    default:
      return { due: p.price_minor || 0, label: 'One payment', canSkip: false };
  }
}

/* How the money splits. Donations are treated gently on purpose. */
export function splitFor(pricing, totalMinor, policy = {}) {
  const isDonation = pricing && pricing.model === 'donation';
  const pct = isDonation
    ? (policy.donation_commission_percent != null ? policy.donation_commission_percent : 0)
    : (policy.commission_percent != null ? policy.commission_percent : MONEY.commissionPercent);
  const platform = Math.round(totalMinor * (pct / 100));
  return { total: totalMinor, platform, provider: totalMinor - platform, percent: pct };
}

/* Is this choice allowed? Checked here for a quick answer, and again on
   the server, because a phone can send any model it likes. */
export function isAllowed(model, price, policy = {}) {
  let allowed;
  try { allowed = JSON.parse(policy.allowed_models || '[]'); } catch (e) { allowed = MODELS; }
  if (allowed.length && !allowed.includes(model)) {
    return { ok: false, why: MODEL_LABELS[model] + ' is switched off on this platform' };
  }
  if (model === 'paid' || model === 'subscription') {
    if (policy.min_price_minor && price < policy.min_price_minor) {
      return { ok: false, why: 'The minimum here is ' + (policy.min_price_minor / 100) };
    }
    if (policy.max_price_minor && price > policy.max_price_minor) {
      return { ok: false, why: 'The maximum here is ' + (policy.max_price_minor / 100) };
    }
  }
  return { ok: true };
}
`;
}

module.exports = { pricingSchema, pricingLogic };

};

/* ──────── gen-cat-lrn.js ──────── */
__mods["gen-cat-lrn.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-cat-lrn.js — শেখানোর অ্যাপে যা ছাড়া চলে না
 *
 * ⚠️ ভিত্তিটা সব শ্রেণিতে এক — তিন পক্ষ, নিরাপত্তা, ভাষা, টাকা।
 * এই ফাইল তার উপরে বসে, শুধু শেখানোর অ্যাপের জন্য।
 *
 * বড় শিক্ষা-অ্যাপগুলো দেখে যা নেওয়া হয়েছে:
 *
 *   কোর্স → অধ্যায় → পাঠ   একধাপে সব পাঠ ফেলে রাখলে ছাত্র হারিয়ে যায়
 *   ব্যাচ                    একই কোর্স, আলাদা সময়ের দল, আলাদা দাম
 *   কোথায় ছিলাম             ফিরে এসে যেন খুঁজতে না হয়
 *   কুইজ ও নম্বর            শুধু দেখা নয়, বুঝেছে কিনা
 *   ডাউট                     প্রশ্ন করার জায়গা, নাহলে ছাত্র আটকে যায়
 *   লাইভ ক্লাস               হাত তুলে প্রশ্ন
 *   সার্টিফিকেট              শেষ করার কারণ
 *
 * ⚠️ সবচেয়ে জরুরি: কোন পাঠ কে খুলতে পারবে। টাকা দেওয়া কোর্সের ভিডিও
 * লিংক একজন কপি করে বাকিদের দিলে পুরো ব্যবসাটাই শেষ। তাই প্রতিবার নতুন,
 * অল্প সময়ের ঠিকানা — আর ভর্তি আছে কিনা সার্ভার প্রতিবার দেখে।
 */

function lrnSchema() {
  return `
-- ---------------------------------------------------------------
-- Learning: courses, chapters, lessons
-- A flat list of lessons works for ten and falls apart at two hundred.
-- Three levels is what every serious course app settles on.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  subject TEXT,
  level TEXT,                              -- beginner | intermediate | advanced
  language TEXT DEFAULT 'en',
  price_minor INTEGER DEFAULT 0,           -- 0 means free
  cover_key TEXT,
  status TEXT DEFAULT 'draft',             -- draft | published | archived
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id),
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'video',               -- video | notes | quiz | live
  video_key TEXT,
  notes_key TEXT,
  duration_sec INTEGER DEFAULT 0,
  position INTEGER NOT NULL,
  -- A few free lessons at the start sell the rest far better than any
  -- description does. Let the teacher choose which ones.
  is_preview INTEGER DEFAULT 0
);

-- A batch is the same course taught to a group starting on a date.
-- Different batch, different price, different teacher, same material.
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  name TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  seats INTEGER DEFAULT 0,                 -- 0 means no limit
  price_minor INTEGER,
  status TEXT DEFAULT 'open'               -- open | full | running | finished
);

-- Where each student got to. Written every few seconds while watching,
-- so closing the app mid-lesson loses nothing.
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  seconds INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,                   -- JSON array
  correct_index INTEGER NOT NULL,
  explanation TEXT,
  marks INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  answers TEXT NOT NULL,                   -- JSON
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  at TEXT NOT NULL
);

-- Questions students ask. A course with no way to ask is a video file.
CREATE TABLE IF NOT EXISTS doubts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT REFERENCES lessons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  answered_by TEXT REFERENCES users(id),
  answer TEXT,
  status TEXT DEFAULT 'open',              -- open | answered | closed
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  serial TEXT UNIQUE NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ch_course   ON chapters(course_id);
CREATE INDEX IF NOT EXISTS idx_les_chapter ON lessons(chapter_id);
CREATE INDEX IF NOT EXISTS idx_prog_user   ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_doubt_les   ON doubts(lesson_id);
`;
}

function lrnRoutes(a) {
  return `// server/learning.js — courses, lessons, quizzes, doubts.
//
// THE ONE RULE THAT MATTERS HERE:
//
// A paid lesson's video address must never be permanent. If it is, one
// student buys the course, copies the link, and posts it. Everything else
// in this file is ordinary; this part is the business.
//
// So: check enrolment, then hand out an address that dies in ten minutes.

const express = require('express');
const { db } = require('./db');
const { viewUrl, uploadUrl } = require('./storage');
const { authenticate, requireRole, requirePerm, audit } = require('./guard');

const r = express.Router();
const now = () => new Date().toISOString();
const id = () => require('crypto').randomBytes(12).toString('hex');

/* ---------- browsing is open, watching is not ---------- */
r.get('/courses', (req, res) => {
  const rows = db.prepare(
    'SELECT id, title, subject, level, language, price_minor, cover_key FROM courses WHERE status = ? LIMIT 50'
  ).all('published');
  res.json({ items: rows });
});

r.get('/courses/:id', (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND status = ?').get(req.params.id, 'published');
  if (!course) return res.status(404).json({ error: 'Not found' });

  const chapters = db.prepare('SELECT * FROM chapters WHERE course_id = ? ORDER BY position').all(course.id);
  chapters.forEach(c => {
    // Titles are visible to everybody. That is the shop window: a student
    // should see exactly what they would be paying for.
    c.lessons = db.prepare(
      'SELECT id, title, kind, duration_sec, position, is_preview FROM lessons WHERE chapter_id = ? ORDER BY position'
    ).all(c.id);
  });
  res.json({ ...course, chapters });
});

/* ---------- the gate ---------- */
function mayWatch(userId, lesson) {
  if (lesson.is_preview) return true;
  const course = db.prepare(\`
    SELECT c.id, c.price_minor FROM lessons l
    JOIN chapters ch ON ch.id = l.chapter_id
    JOIN courses  c  ON c.id  = ch.course_id
    WHERE l.id = ?\`).get(lesson.id);
  if (!course) return false;
  if (course.price_minor === 0) return true;
  const e = db.prepare(
    'SELECT 1 FROM enrolments WHERE user_id = ? AND item_id = ? AND (expires_at IS NULL OR expires_at > ?)'
  ).get(userId, course.id, now());
  return !!e;
}

r.get('/lessons/:id/play', authenticate, async (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Not found' });

  if (!mayWatch(req.user.id, lesson)) {
    // Say plainly that it needs enrolling, not "forbidden". This person is
    // a customer who has not bought yet, not an intruder.
    return res.status(402).json({ error: 'Enrol in this course to watch this lesson.' });
  }

  // Ten minutes. Long enough to start watching, short enough that a copied
  // link is worthless by the time it is shared.
  const url = await viewUrl(lesson.video_key, 600);
  const p = db.prepare('SELECT seconds FROM progress WHERE user_id = ? AND lesson_id = ?')
              .get(req.user.id, lesson.id);
  res.json({ url, resumeAt: p ? p.seconds : 0, title: lesson.title });
});

/* ---------- where they got to ---------- */
r.post('/lessons/:id/progress', authenticate, (req, res) => {
  const seconds = Math.max(0, parseInt(req.body.seconds, 10) || 0);
  const done = seconds > 0 && req.body.completed ? 1 : 0;
  db.prepare(\`
    INSERT INTO progress (user_id, lesson_id, seconds, completed, updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(user_id, lesson_id) DO UPDATE SET
      seconds = MAX(seconds, excluded.seconds),
      completed = MAX(completed, excluded.completed),
      updated_at = excluded.updated_at\`)
    .run(req.user.id, req.params.id, seconds, done, now());
  res.json({ ok: true });
});

/* ---------- quiz ---------- */
r.get('/lessons/:id/quiz', authenticate, (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson || !mayWatch(req.user.id, lesson)) return res.status(402).json({ error: 'Enrol first' });
  // Send the questions WITHOUT the answers. Obvious once said, and left
  // out often enough that students routinely read answers off the network.
  const qs = db.prepare('SELECT id, prompt, options, marks FROM quiz_questions WHERE lesson_id = ?')
               .all(lesson.id)
               .map(q => ({ ...q, options: JSON.parse(q.options) }));
  res.json({ items: qs });
});

r.post('/lessons/:id/quiz', authenticate, (req, res) => {
  const qs = db.prepare('SELECT * FROM quiz_questions WHERE lesson_id = ?').all(req.params.id);
  const answers = req.body.answers || {};
  let score = 0, total = 0;
  // Marking happens here, never on the phone. A score the phone worked
  // out is a score the phone can change.
  qs.forEach(q => {
    total += q.marks;
    if (Number(answers[q.id]) === q.correct_index) score += q.marks;
  });
  db.prepare('INSERT INTO quiz_attempts (id,user_id,lesson_id,answers,score,total,at) VALUES (?,?,?,?,?,?,?)')
    .run(id(), req.user.id, req.params.id, JSON.stringify(answers), score, total, now());
  // Now the answers can go back, with the reasons. That is the teaching part.
  res.json({
    score, total,
    review: qs.map(q => ({ id: q.id, correct: q.correct_index, explanation: q.explanation })),
  });
});

/* ---------- doubts ---------- */
r.post('/doubts', authenticate, (req, res) => {
  const body = String(req.body.body || '').trim();
  if (body.length < 3) return res.status(400).json({ error: 'Write your question first' });
  db.prepare('INSERT INTO doubts (id,lesson_id,user_id,body,status,at) VALUES (?,?,?,?,?,?)')
    .run(id(), req.body.lessonId || null, req.user.id, body, 'open', now());
  res.json({ ok: true });
});

r.get('/doubts', authenticate, (req, res) => {
  // Students see their own. Teachers see the ones on their courses.
  // Nobody sees everybody's, unless they are staff with permission.
  const rows = req.user.role === 'provider'
    ? db.prepare(\`SELECT d.* FROM doubts d
                  JOIN lessons l  ON l.id = d.lesson_id
                  JOIN chapters c ON c.id = l.chapter_id
                  JOIN courses co ON co.id = c.course_id
                  WHERE co.provider_id = ? ORDER BY d.at DESC LIMIT 100\`).all(req.user.id)
    : db.prepare('SELECT * FROM doubts WHERE user_id = ? ORDER BY at DESC LIMIT 100').all(req.user.id);
  res.json({ items: rows });
});

r.post('/doubts/:id/answer', authenticate, requireRole('provider', 'owner', 'staff'), (req, res) => {
  db.prepare('UPDATE doubts SET answer = ?, answered_by = ?, status = ? WHERE id = ?')
    .run(String(req.body.answer || ''), req.user.id, 'answered', req.params.id);
  res.json({ ok: true });
});

/* ---------- teachers uploading ---------- */
r.post('/lessons/:id/upload-url', authenticate, requireRole('provider'), async (req, res) => {
  const owns = db.prepare(\`
    SELECT co.provider_id FROM lessons l
    JOIN chapters c ON c.id = l.chapter_id
    JOIN courses co ON co.id = c.course_id
    WHERE l.id = ?\`).get(req.params.id);
  // A teacher may only upload into their own lesson. Checking the role
  // alone would let any teacher overwrite any other teacher's video.
  if (!owns || owns.provider_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const out = await uploadUrl(req.user.id, req.body.filename || 'lesson.mp4', req.body.contentType);
  db.prepare('UPDATE lessons SET video_key = ? WHERE id = ?').run(out.key, req.params.id);
  res.json(out);
});

/* ---------- certificate ---------- */
r.post('/courses/:id/certificate', authenticate, (req, res) => {
  const done = db.prepare(\`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS finished
    FROM lessons l
    JOIN chapters c ON c.id = l.chapter_id
    LEFT JOIN progress p ON p.lesson_id = l.id AND p.user_id = ?
    WHERE c.course_id = ?\`).get(req.user.id, req.params.id);

  if (!done.total || done.finished < done.total) {
    return res.status(400).json({ error: 'Finish every lesson first', finished: done.finished, total: done.total });
  }
  const existing = db.prepare('SELECT * FROM certificates WHERE user_id = ? AND course_id = ?')
                     .get(req.user.id, req.params.id);
  if (existing) return res.json(existing);

  // A serial anyone can check. A certificate nobody can verify is a picture.
  const serial = (req.params.id.slice(0, 4) + '-' + Date.now().toString(36) + '-' +
                  require('crypto').randomBytes(3).toString('hex')).toUpperCase();
  const row = { id: id(), user_id: req.user.id, course_id: req.params.id, serial, issued_at: now() };
  db.prepare('INSERT INTO certificates (id,user_id,course_id,serial,issued_at) VALUES (?,?,?,?,?)')
    .run(row.id, row.user_id, row.course_id, row.serial, row.issued_at);
  res.json(row);
});

// Public, on purpose. An employer must be able to check a serial without
// an account, or the certificate is worth nothing.
r.get('/verify/:serial', (req, res) => {
  const row = db.prepare(\`
    SELECT c.serial, c.issued_at, u.name AS student, co.title AS course
    FROM certificates c
    JOIN users u   ON u.id  = c.user_id
    JOIN courses co ON co.id = c.course_id
    WHERE c.serial = ?\`).get(String(req.params.serial).toUpperCase());
  res.json(row || { error: 'No certificate with that serial' });
});

module.exports = r;
`;
}

module.exports = { lrnSchema, lrnRoutes };

};

/* ──────── gen-cats.js ──────── */
__mods["gen-cats.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-cats.js — ১৬টা শ্রেণির নিজস্ব ক্ষমতা
 *
 * ⚠️ ভিত্তি সব শ্রেণিতে এক — তিন পক্ষ, নিরাপত্তা, ভাষা, টাকা, আপলোড।
 * এখানে শুধু ওই সেক্টরের যা ছাড়া অ্যাপটা অচল, সেটুকু।
 *
 * ⚠️ প্রতিটা শ্রেণিতে যে সিদ্ধান্তগুলো নেওয়া হয়েছে, সেগুলো ওই সেক্টরের
 * বড় অ্যাপগুলো বছরের পর বছর পরীক্ষা করে যেখানে থেমেছে সেখান থেকেই।
 * যেমন রাইড অ্যাপে যাত্রা শুরুর OTP — ওটা সুবিধার জন্য নয়, ভুল গাড়িতে
 * উঠে যাওয়া আটকানোর জন্য।
 */

const { lrnSchema, lrnRoutes } = require('./gen-cat-lrn.js');

/* ---------------------------------------------------------------- */
const SCHEMAS = {

msg: `
-- Messaging. Delivery state is the whole product: a message with no tick
-- feels lost, and people resend it, and then apologise for resending.
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, kind TEXT DEFAULT 'direct',  -- direct | group
  title TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread_members (
  thread_id TEXT NOT NULL REFERENCES threads(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT DEFAULT 'member', joined_at TEXT NOT NULL,
  last_read_at TEXT, muted INTEGER DEFAULT 0,
  PRIMARY KEY (thread_id, user_id));
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT, media_key TEXT, kind TEXT DEFAULT 'text',
  reply_to TEXT REFERENCES messages(id),
  -- sent -> delivered -> read. Three states, because two is not enough
  -- to tell "their phone is off" from "they are ignoring you".
  state TEXT DEFAULT 'sent',
  deleted_for_all INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id));
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id, at);`,

soc: `
-- Social. Reporting and blocking are not optional extras. An app where
-- people cannot get away from someone becomes unusable for exactly the
-- people you most want to keep.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT, media_key TEXT, visibility TEXT DEFAULT 'public',
  like_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL, followee_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id));
CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
  user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
  status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  reason TEXT NOT NULL, state TEXT DEFAULT 'open',
  reviewed_by TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, at);`,

ride: `
-- Rides. The start OTP is not a convenience. It is what stops a passenger
-- getting into the wrong car, and what stops a driver claiming a trip
-- that never happened.
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT, make TEXT, model TEXT, plate TEXT NOT NULL,
  seats INTEGER DEFAULT 4, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT REFERENCES users(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  from_label TEXT, from_lat REAL, from_lng REAL,
  to_label TEXT, to_lat REAL, to_lng REAL,
  distance_m INTEGER, duration_s INTEGER,
  fare_minor INTEGER, surge_percent INTEGER DEFAULT 0,
  start_otp TEXT,
  state TEXT DEFAULT 'requested',   -- requested|accepted|arrived|running|done|cancelled
  requested_at TEXT NOT NULL, started_at TEXT, ended_at TEXT);
CREATE TABLE IF NOT EXISTS driver_status (
  provider_id TEXT PRIMARY KEY REFERENCES users(id),
  online INTEGER DEFAULT 0, lat REAL, lng REAL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_trip_cust ON trips(customer_id, requested_at);`,

food: `
-- Food. Options are where the money and the mistakes both live: a pizza
-- is one item with fifteen decisions attached to it.
CREATE TABLE IF NOT EXISTS outlets (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, address TEXT, lat REAL, lng REAL,
  open_from TEXT, open_to TEXT, prep_minutes INTEGER DEFAULT 20,
  is_open INTEGER DEFAULT 1, rating REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL, description TEXT, price_minor INTEGER NOT NULL,
  veg INTEGER DEFAULT 0, spicy INTEGER DEFAULT 0,
  photo_key TEXT, available INTEGER DEFAULT 1, position INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_options (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES menu_items(id),
  group_name TEXT NOT NULL, label TEXT NOT NULL,
  extra_minor INTEGER DEFAULT 0, required INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  rider_id TEXT REFERENCES users(id), state TEXT DEFAULT 'pending',
  picked_at TEXT, delivered_at TEXT, drop_otp TEXT);`,

ecom: `
-- Commerce. Stock is held when the cart is paid, not when it is filled.
-- Holding at add-to-cart lets one person empty your shop by browsing.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT, brand TEXT, category TEXT,
  photo_key TEXT, status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  label TEXT NOT NULL, sku TEXT, price_minor INTEGER NOT NULL,
  stock INTEGER DEFAULT 0, reserved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS carts (
  user_id TEXT PRIMARY KEY REFERENCES users(id), updated_at TEXT);
CREATE TABLE IF NOT EXISTS cart_lines (
  cart_user TEXT NOT NULL, variant_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (cart_user, variant_id));
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY, percent_off INTEGER, flat_off_minor INTEGER,
  min_order_minor INTEGER DEFAULT 0, uses_left INTEGER DEFAULT 0,
  expires_at TEXT);
CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  reason TEXT, state TEXT DEFAULT 'requested', at TEXT NOT NULL);`,

trv: `
-- Travel. Two bookings for the same room on the same night is the one
-- failure a booking app cannot recover from, so availability is a table,
-- not a calculation.
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, address TEXT, lat REAL, lng REAL,
  checkin TEXT, checkout TEXT, rating REAL DEFAULT 0, photo_key TEXT);
CREATE TABLE IF NOT EXISTS room_types (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL, sleeps INTEGER DEFAULT 2,
  base_price_minor INTEGER NOT NULL, breakfast_minor INTEGER DEFAULT 0,
  refundable INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS availability (
  room_type_id TEXT NOT NULL, day TEXT NOT NULL,
  rooms_left INTEGER NOT NULL, price_minor INTEGER,
  PRIMARY KEY (room_type_id, day));
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id),
  room_type_id TEXT NOT NULL, guest_id TEXT NOT NULL REFERENCES users(id),
  from_day TEXT NOT NULL, to_day TEXT NOT NULL, guests INTEGER DEFAULT 1,
  meals TEXT, state TEXT DEFAULT 'confirmed', at TEXT NOT NULL);`,

hlth: `
-- Health. Notes are the most sensitive data in this whole project.
-- Only the patient and the clinician who wrote them. Not staff, not the
-- owner. Some doors stay shut for everybody.
CREATE TABLE IF NOT EXISTS practitioners (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  speciality TEXT, registration_no TEXT, years INTEGER,
  fee_minor INTEGER DEFAULT 0, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY, practitioner_id TEXT NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL, minutes INTEGER DEFAULT 15,
  taken INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES slots(id),
  patient_id TEXT NOT NULL REFERENCES users(id),
  practitioner_id TEXT NOT NULL REFERENCES users(id),
  mode TEXT DEFAULT 'video', state TEXT DEFAULT 'booked', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clinical_notes (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
  author_id TEXT NOT NULL, body TEXT, prescription TEXT, at TEXT NOT NULL);`,

vid: `
-- Video. A watch record per person is what powers everything else:
-- resume, recommendations, and what a creator actually gets paid for.
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT, video_key TEXT, thumb_key TEXT,
  duration_sec INTEGER DEFAULT 0, visibility TEXT DEFAULT 'public',
  views INTEGER DEFAULT 0, status TEXT DEFAULT 'processing', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS watch (
  user_id TEXT NOT NULL, video_id TEXT NOT NULL,
  seconds INTEGER DEFAULT 0, finished INTEGER DEFAULT 0, at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id));
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL, video_id TEXT NOT NULL, position INTEGER,
  PRIMARY KEY (playlist_id, video_id));`,

mus: `
-- Music. Plays are counted only past a threshold, because that is how
-- royalties work everywhere, and getting it wrong means paying wrongly.
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY, artist_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, album TEXT, audio_key TEXT, art_key TEXT,
  duration_sec INTEGER DEFAULT 0, plays INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY, track_id TEXT NOT NULL, user_id TEXT NOT NULL,
  seconds INTEGER NOT NULL, counted INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS libraries (
  user_id TEXT NOT NULL, track_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id));`,

news: `
-- News. A correction that nobody can see is not a correction. Keep the
-- history and show it; it is the only thing that separates you from a
-- rumour mill.
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id),
  headline TEXT NOT NULL, standfirst TEXT, body TEXT,
  section TEXT, image_key TEXT, status TEXT DEFAULT 'draft',
  published_at TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  note TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL, article_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id));`,

game: `
-- Games. Scores arrive from phones, and phones can lie. Keep every
-- submission, mark the suspicious ones, and never delete the evidence.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT DEFAULT 'solo');
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, user_id TEXT NOT NULL,
  points INTEGER NOT NULL, duration_s INTEGER,
  suspect INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, state TEXT DEFAULT 'open',
  entry_minor INTEGER DEFAULT 0, prize_minor INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER DEFAULT 0,
  PRIMARY KEY (match_id, user_id));
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game_id, points DESC);`,

date: `
-- Dating. Safety features are the product here, not an afterthought.
-- Messaging only after both sides agree, and a report button that is
-- always one tap away.
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  bio TEXT, age INTEGER, gender TEXT, looking_for TEXT,
  city TEXT, lat REAL, lng REAL, photo_keys TEXT,
  verified INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS swipes (
  from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  liked INTEGER NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id));
CREATE TABLE IF NOT EXISTS matches_d (
  id TEXT PRIMARY KEY, a_id TEXT NOT NULL, b_id TEXT NOT NULL,
  thread_id TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS safety_reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, about_id TEXT NOT NULL,
  reason TEXT NOT NULL, detail TEXT, state TEXT DEFAULT 'open', at TEXT NOT NULL);`,

prod: `
-- Productivity. Recurring tasks are where these apps are won or lost.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, colour TEXT, archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  owner_id TEXT NOT NULL, title TEXT NOT NULL, notes TEXT,
  due_at TEXT, repeat_rule TEXT, priority INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0, done_at TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shares (
  task_id TEXT NOT NULL, user_id TEXT NOT NULL, can_edit INTEGER DEFAULT 0,
  PRIMARY KEY (task_id, user_id));
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id, done, due_at);`,

fin: `
-- Money. Never update a balance. Write entries and add them up. When
-- somebody disputes a figure a year from now, the entries are the answer
-- and a balance is only an opinion.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT DEFAULT 'wallet', currency TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL,   -- positive in, negative out
  kind TEXT NOT NULL, ref TEXT, note TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS beneficiaries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT,
  details TEXT, verified INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id),
  raised_by TEXT NOT NULL, reason TEXT, state TEXT DEFAULT 'open', at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_entries_acct ON entries(account_id, at);`,

util: `
-- General purpose: things a provider offers, things a customer books.
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT, price_minor INTEGER DEFAULT 0,
  photo_key TEXT, area TEXT, status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT REFERENCES listings(id), detail TEXT,
  when_at TEXT, state TEXT DEFAULT 'open', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, author_id TEXT NOT NULL,
  stars INTEGER NOT NULL, body TEXT, at TEXT NOT NULL);`,
};

function schemaFor(cat) {
  if (cat === 'lrn') return lrnSchema();
  return SCHEMAS[cat] || SCHEMAS.util;
}

module.exports = { SCHEMAS, schemaFor, lrnRoutes };

};

/* ──────── gen-routes.js ──────── */
__mods["gen-routes.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-routes.js — সার্ভারের রুট
 *
 * ⚠️ এই ফাইলটাই আসল নিরাপত্তা। অ্যাপে বোতাম লুকানো সাজসজ্জা।
 *
 * ⚠️ প্রতিটা রুটে তিনটে জিনিস দেখা হয়:
 *      কে তুমি → তোমার কি অনুমতি আছে → জিনিসটা কি সত্যিই তোমার
 * তৃতীয়টা প্রায় সবাই বাদ দেয়, আর ওখান দিয়েই তথ্য ফাঁস হয়।
 */
function routes(a) {
  return `// server/index.js — every route in ${a.name}.
//
// THE THREE CHECKS. Every route does all three, in this order:
//
//   1. Who are you?          authenticate  — is the token real
//   2. May you do this?      requireRole / requirePerm
//   3. Is this yours?        ownsOr        — the one people forget
//
// Skip the third and a provider can read another provider's orders by
// changing one number in the URL. Same role, different owner. That is how
// most of the leaks you read about actually happened.

require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const { db } = require('./db');
const { uploadUrl, viewUrl } = require('./storage');
const { roomToken, configured: liveReady } = require('./live');
const {
  authenticate, requireRole, requirePerm, ownsOr, notOnBehalf, audit,
} = require('./guard');
const { ROLE_DEFAULTS } = require('../permissions');

const app = express();
app.use(express.json({ limit: '1mb' }));   // small. Files never come through here.

const uid = () => crypto.randomBytes(12).toString('hex');
const now = () => new Date().toISOString();

/* Read your cut from the database, not from the app. If the phone sent
   the commission, a customer could set it to zero. */
function settings() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('commissionPercent');
  return { commissionPercent: row ? Number(row.value) : 12 };
}

function splitMoney(totalMinor) {
  const pct = settings().commissionPercent;
  const platform = Math.round(totalMinor * (pct / 100));
  return { platform, provider: totalMinor - platform };
}

/* ============================ 1. signing in ============================ */
function issue(user) {
  const perms = user.permissions ? JSON.parse(user.permissions) : (ROLE_DEFAULTS[user.role] || []);
  const claims = { sub: user.id, role: user.role, permissions: perms };
  return {
    accessToken:  jwt.sign(claims, process.env.JWT_SECRET,     { expiresIn: '20m' }),
    refreshToken: jwt.sign({ sub: user.id }, process.env.REFRESH_SECRET, { expiresIn: '30d' }),
    user: {
      id: user.id, name: user.name, email: user.email,
      role: user.role, permissions: perms,
      country: user.country, lang: user.lang,
      providerStatus: providerStatus(user.id),
    },
  };
}

function providerStatus(userId) {
  const r = db.prepare('SELECT status FROM provider_profiles WHERE user_id = ?').get(userId);
  return r ? r.status : null;
}

app.post('/auth/register', (req, res) => {
  const { name, identifier, password } = req.body || {};
  if (!identifier || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'Please enter an email or phone and a password of at least 8 characters' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(identifier);
  if (exists) {
    // Do not say "already registered". That turns this route into a way
    // of checking which addresses have accounts here.
    return res.status(400).json({ error: 'We could not create that account. Try signing in instead.' });
  }
  const id = uid();
  db.prepare(\`INSERT INTO users (id,email,name,password_hash,role,created_at)
              VALUES (?,?,?,?,'customer',?)\`)
    .run(id, identifier, name || '', bcrypt.hashSync(String(password), 10), now());
  res.json(issue(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});

app.post('/auth/login', (req, res) => {
  const { identifier, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(identifier, identifier);
  // Same message whether the account is missing or the password is wrong.
  // Different messages tell an attacker which half to keep guessing.
  const bad = { error: 'Those details did not match' };
  if (!u) { bcrypt.compareSync('x', '$2a$10$' + 'x'.repeat(53)); return res.status(401).json(bad); }
  if (!bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json(bad);
  if (u.status !== 'active') return res.status(403).json({ error: 'This account is not active' });
  res.json(issue(u));
});

app.post('/auth/refresh', (req, res) => {
  try {
    const c = jwt.verify(req.body.refreshToken, process.env.REFRESH_SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(c.sub);
    if (!u || u.status !== 'active') throw new Error('gone');
    res.json(issue(u));
  } catch (e) {
    res.status(401).json({ error: 'Please sign in again' });
  }
});

app.post('/auth/logout', authenticate, (req, res) => res.json({ ok: true }));

/* ============================ 2. me ============================ */
app.get('/me', authenticate, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(issue(u).user);
});

app.patch('/me', authenticate, (req, res) => {
  const { country, lang, role } = req.body || {};
  // A user may pick customer or provider. Nobody promotes themselves to
  // owner or staff through this route; the owner does that, or nobody does.
  const safeRole = ['customer', 'provider'].includes(role) ? role : null;
  db.prepare(\`UPDATE users SET country = COALESCE(?,country), lang = COALESCE(?,lang),
              role = COALESCE(?,role) WHERE id = ?\`)
    .run(country || null, lang || null, safeRole, req.user.id);
  if (safeRole === 'provider' && !providerStatus(req.user.id)) {
    db.prepare('INSERT INTO provider_profiles (user_id,status) VALUES (?,?)')
      .run(req.user.id, 'draft');
  }
  res.json(issue(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)).user);
});

/* ============================ 3. things to browse ============================ */
app.get('/items', authenticate, (req, res) => {
  const page  = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const rows = db.prepare(\`SELECT id,title,description,price_minor,provider_id
                           FROM items WHERE status='active' AND visibility='public'
                           ORDER BY created_at DESC LIMIT ? OFFSET ?\`)
    .all(limit, (page - 1) * limit);
  res.json({ items: rows.map(r => ({
    id: r.id, title: r.title, subtitle: r.description, meta: r.price_minor,
  })) });
});

/* One item. This is where paid content is protected.
   Anyone can see the description. Only somebody enrolled gets the file. */
app.get('/items/:id', authenticate, async (req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!it || it.status !== 'active') return res.status(404).json({ error: 'Not found' });

  const enrolled = !!db.prepare(\`SELECT 1 FROM enrolments WHERE user_id=? AND item_id=?
                                 AND (expires_at IS NULL OR expires_at > ?)\`)
    .get(req.user.id, it.id, now());
  const mine = it.provider_id === req.user.id;
  const staff = req.user.permissions.includes('items.view');

  const out = {
    id: it.id, title: it.title, description: it.description,
    priceMinor: it.price_minor, enrolled,
  };
  // The media address is short-lived and issued per request. A permanent
  // link is a permanent leak: one person buys, everyone else watches.
  if (enrolled || mine || staff) out.mediaUrl = await viewUrl(it.media_key, 600);
  res.json(out);
});

/* ============================ 4. uploading ============================ */
app.post('/uploads/sign', authenticate, requireRole('provider', 'owner', 'staff'), async (req, res) => {
  const { filename, contentType } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'filename is required' });
  // The big file goes straight from the phone to storage. If it came
  // through here, one lesson video would block every other request.
  res.json(await uploadUrl(req.user.id, String(filename), contentType));
});

/* ============================ 5. money ============================ */
app.post('/orders', authenticate, (req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get((req.body || {}).itemId);
  if (!it) return res.status(404).json({ error: 'Not found' });
  // The price comes from the database. Never from the request. If the
  // phone sent the amount, somebody would send zero.
  const total = it.price_minor;
  const split = splitMoney(total);
  const id = uid();
  db.prepare(\`INSERT INTO orders (id,customer_id,provider_id,item_id,total_minor,
              platform_minor,provider_minor,status,created_at) VALUES (?,?,?,?,?,?,?,'pending',?)\`)
    .run(id, req.user.id, it.provider_id, it.id, total, split.platform, split.provider, now());
  res.json({ id, totalMinor: total, itemMinor: total, feeMinor: 0 });
});

app.get('/orders/:id', authenticate,
  ownsOr('orders.view', req =>
    (db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(req.params.id) || {}).customer_id),
  (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    res.json({ id: o.id, title: 'Order', status: o.status, totalMinor: o.total_minor,
               itemMinor: o.total_minor, feeMinor: 0 });
  });

app.post('/payments/start', authenticate, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?')
    .get((req.body || {}).orderId, req.user.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  // Hand off to your payment provider here. Until you add keys, this
  // marks it paid so you can build and test the whole flow for free.
  res.json({ reference: 'ref_' + o.id, amountMinor: o.total_minor });
});

/* The payment provider tells US the payment succeeded. We never trust the
   phone for this; a phone can claim anything. And we check the signature,
   because otherwise anyone who knows the address can grant themselves a
   free course by sending a fake message. */
app.post('/payments/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (secret) {
    const sent = String(req.headers['x-signature'] || '');
    const mine = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    // Compare in constant time, so the comparison itself does not leak
    // the correct value one character at a time.
    const ok = sent.length === mine.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(mine));
    if (!ok) return res.status(400).json({ error: 'bad signature' });
  }
  const body = JSON.parse(req.body.toString() || '{}');
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(body.orderId || '').replace('ref_', ''));
  if (!o) return res.json({ ok: true });   // unknown order: accept, do nothing

  db.prepare("UPDATE orders SET status='paid' WHERE id = ?").run(o.id);
  // Access is written only now, after money actually arrived.
  db.prepare(\`INSERT OR IGNORE INTO enrolments (id,user_id,item_id,order_id,created_at)
              VALUES (?,?,?,?,?)\`).run(uid(), o.customer_id, o.item_id, o.id, now());
  res.json({ ok: true });
});

/* ============================ 6. the provider side ============================ */
app.post('/provider/apply', authenticate, requireRole('provider'), (req, res) => {
  const { documents, bank } = req.body || {};
  db.prepare(\`INSERT INTO provider_profiles (user_id,status,documents,bank)
              VALUES (?,'pending',?,?)
              ON CONFLICT(user_id) DO UPDATE SET status='pending', documents=?, bank=?\`)
    .run(req.user.id, JSON.stringify(documents || {}), JSON.stringify(bank || {}),
         JSON.stringify(documents || {}), JSON.stringify(bank || {}));
  res.json({ ok: true, status: 'pending' });
});

app.get('/provider/orders', authenticate, requireRole('provider'), (req, res) => {
  // Scoped to this provider in the query itself. Not filtered afterwards,
  // and never taken from a parameter the phone controls.
  const rows = db.prepare(\`SELECT id,status,provider_minor,created_at FROM orders
                           WHERE provider_id = ? ORDER BY created_at DESC LIMIT 50\`)
    .all(req.user.id);
  res.json({ items: rows.map(r => ({
    id: r.id, title: 'Order ' + r.id.slice(0, 6), when: r.created_at,
    payoutMinor: r.provider_minor, status: r.status,
  })) });
});

app.get('/provider/earnings', authenticate, requireRole('provider'), (req, res) => {
  const g = db.prepare(\`SELECT COUNT(*) n, COALESCE(SUM(total_minor),0) gross,
                        COALESCE(SUM(platform_minor),0) fee, COALESCE(SUM(provider_minor),0) net
                        FROM orders WHERE provider_id = ? AND status = 'paid'\`).get(req.user.id);
  const held = db.prepare(\`SELECT COALESCE(SUM(provider_minor),0) v FROM orders
                           WHERE provider_id=? AND status='paid' AND created_at > ?\`)
    .get(req.user.id, new Date(Date.now() - 3 * 864e5).toISOString());
  res.json({
    jobs: g.n, grossMinor: g.gross, commissionMinor: g.fee, netMinor: g.net,
    availableMinor: g.net - held.v, pendingMinor: held.v,
    canPayout: (g.net - held.v) > 0,
    nextPayoutDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
  });
});

/* ============================ 7. the owner side ============================ */
app.get('/owner/applications', authenticate, requirePerm('providers.view'), (req, res) => {
  const rows = db.prepare(\`SELECT p.user_id id, u.name, p.documents FROM provider_profiles p
                           JOIN users u ON u.id = p.user_id WHERE p.status = 'pending'\`).all();
  res.json({ items: rows.map(r => ({
    id: r.id, name: r.name,
    // Show which documents arrived, never their contents. Nobody needs to
    // read an id number to press approve.
    documentsSummary: Object.keys(JSON.parse(r.documents || '{}')).join(', ') || 'none',
  })) });
});

app.post('/owner/applications/:id', authenticate, requirePerm('providers.approve'), async (req, res) => {
  const ok = !!(req.body || {}).approved;
  db.prepare('UPDATE provider_profiles SET status=?, reviewed_by=?, reviewed_at=? WHERE user_id=?')
    .run(ok ? 'approved' : 'rejected', req.user.id, now(), req.params.id);
  await audit(req, ok ? 'approved provider' : 'rejected provider', req.params.id);
  res.json({ ok: true });
});

app.get('/owner/settings', authenticate, requirePerm('reports.view'), (req, res) => res.json(settings()));

app.patch('/owner/settings', authenticate, requirePerm('commission.edit'), async (req, res) => {
  const pct = Number((req.body || {}).commissionPercent);
  if (!(pct >= 0 && pct <= 50)) return res.status(400).json({ error: 'Enter a percentage between 0 and 50' });
  db.prepare("INSERT INTO settings (key,value) VALUES ('commissionPercent',?) ON CONFLICT(key) DO UPDATE SET value=?")
    .run(String(pct), String(pct));
  await audit(req, 'changed commission to ' + pct, null);
  // Existing orders keep the split they were created with. Changing the
  // past is how you lose providers.
  res.json({ ok: true, commissionPercent: pct });
});

app.get('/owner/staff', authenticate, requirePerm('staff.manage'), (req, res) => {
  const rows = db.prepare("SELECT id,email,permissions FROM users WHERE role='staff'").all();
  res.json({ items: rows.map(r => ({ id: r.id, email: r.email, permissions: JSON.parse(r.permissions || '[]') })) });
});

app.post('/owner/staff', authenticate, requireRole('owner'), requirePerm('staff.manage'), async (req, res) => {
  const { email, permissions } = req.body || {};
  const { PERMISSIONS } = require('../permissions');
  // Only permissions that exist, and never more than the owner holds.
  const clean = (permissions || []).filter(p => PERMISSIONS.includes(p) && req.user.permissions.includes(p));
  const id = uid();
  db.prepare(\`INSERT INTO users (id,email,name,password_hash,role,permissions,created_at)
              VALUES (?,?,?,?,'staff',?,?)\`)
    .run(id, email, email, bcrypt.hashSync(crypto.randomBytes(9).toString('hex'), 10),
         JSON.stringify(clean), now());
  await audit(req, 'invited staff ' + email, id);
  res.json({ ok: true, id, permissions: clean });
});

app.get('/owner/reports', authenticate, requirePerm('reports.view'), (req, res) => {
  const m = db.prepare(\`SELECT COUNT(*) orders, COALESCE(SUM(total_minor),0) gross,
                        COALESCE(SUM(platform_minor),0) fee FROM orders WHERE status='paid'\`).get();
  const p = db.prepare("SELECT COUNT(*) n FROM provider_profiles WHERE status='approved'").get();
  const r = db.prepare(\`SELECT COUNT(*) n FROM (SELECT customer_id FROM orders
                        WHERE status='paid' GROUP BY customer_id HAVING COUNT(*) > 1)\`).get();
  res.json({ orders: m.orders, grossMinor: m.gross, commissionMinor: m.fee,
             providers: p.n, returning: r.n });
});

/* ============================ 8. live classes ============================ */
app.post('/live/:sessionId/join', authenticate, (req, res) => {
  const ses = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.sessionId);
  if (!ses) return res.status(404).json({ error: 'Not found' });

  const isHost = ses.host_id === req.user.id;
  if (!isHost && ses.item_id) {
    const paid = db.prepare('SELECT 1 FROM enrolments WHERE user_id=? AND item_id=?')
      .get(req.user.id, ses.item_id);
    if (!paid) return res.status(403).json({ error: 'This class is for enrolled students' });
  }
  // Allowed to speak only if the teacher said so. The phone asks; the
  // server decides. If the phone decided, any student could unmute.
  const allowed = !!db.prepare("SELECT 1 FROM hand_raises WHERE session_id=? AND user_id=? AND state='allowed'")
    .get(ses.id, req.user.id);

  const tok = roomToken({ room: ses.room, user: req.user, isHost, maySpeak: allowed });
  if (!tok) return res.status(503).json({ error: 'Live classes are not configured yet. See the guide.' });
  res.json(tok);
});

app.post('/live/:sessionId/hand', authenticate, (req, res) => {
  db.prepare(\`INSERT INTO hand_raises (id,session_id,user_id,state,at) VALUES (?,?,?,'raised',?)\`)
    .run(uid(), req.params.sessionId, req.user.id, now());
  res.json({ ok: true });
});

/* Only the teacher may open a microphone, and only one at a time by
   default. Two hundred open microphones is not a class, it is noise. */
app.post('/live/:sessionId/allow', authenticate, (req, res) => {
  const ses = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(req.params.sessionId);
  if (!ses || ses.host_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE hand_raises SET state='lowered' WHERE session_id=? AND state='allowed'").run(ses.id);
  db.prepare("UPDATE hand_raises SET state='allowed' WHERE session_id=? AND user_id=?")
    .run(ses.id, (req.body || {}).userId);
  res.json({ ok: true });
});

/* ============================ 9. last ============================ */
app.get('/health', (req, res) => res.json({ ok: true, live: liveReady }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  // Log the detail for you; send a plain sentence to the user. Stack
  // traces in a response tell an attacker how the inside is built.
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('${a.name} server on http://localhost:' + port));
`;
}
module.exports = { routes };

};

/* ──────── gen-entry.js ──────── */
__mods["gen-entry.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-entry.js — ঢোকার দুটো পর্দা
 *
 * ⚠️ RolePickerScreen-এ দেশ আর ভাষা একসাথে বাছা হয় — ইচ্ছে করেই।
 * দেশ বাছলেই ঠিক হয়ে যায় কোন মুদ্রা, কোন ফোন কোড, আর সেবাদাতা হলে
 * কোন নথি লাগবে। ভাষা আলাদা, কারণ দুবাইয়ে থাকা একজন হিন্দিতে পড়তে
 * পারেন। দেশ আর ভাষা এক জিনিস নয়।
 *
 * ⚠️ ভূমিকা বাছার পর্দাটা প্রথমেই আসে, লগইনের পরে নয়। কারণ সেবাদাতার
 * নিবন্ধনে অনেক বেশি তথ্য লাগে, আর কে কী হতে চায় সেটা আগে জানলে
 * অপ্রয়োজনীয় ঘর দেখাতেই হয় না।
 */

function authScreen(a) {
  return `// AuthScreen.js — signing in and joining ${a.name}.
//
// One screen, two modes. Separate login and register screens mean two
// files that drift apart; here the difference is three extra fields.

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { useT } from '../i18n';
import { useAuth } from '../auth';
import { checkForm, DIAL_CODE } from '../helpers';
import { Button, Input, Card } from '../ui';

export default function AuthScreen({ navigation }) {
  const { t } = useT();
  const { signIn } = useAuth();
  const [mode, setMode]   = useState('login');   // login | join
  const [form, setForm]   = useState({ name: '', identifier: '', password: '' });
  const [errors, setErr]  = useState({});
  const [busy, setBusy]   = useState(false);
  const [failed, setFail] = useState(null);

  const joining = mode === 'join';
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErr(e => ({ ...e, [k]: undefined }));
  };

  async function go() {
    const rules = {
      identifier: { value: form.identifier, required: true },
      password:   { value: form.password, required: true, min: 8 },
    };
    if (joining) rules.name = { value: form.name, required: true, min: 2 };
    const { errors: found, ok } = checkForm(rules);
    setErr(found);
    if (!ok) return;

    setBusy(true);
    setFail(null);
    try {
      if (joining) {
        await api.post('/auth/register', form);
        // Straight to the role question. Making somebody sign in again
        // right after they signed up is a small insult that loses people.
        navigation.replace('RolePicker');
      } else {
        await signIn(form.identifier, form.password);
      }
    } catch (e) {
      // Deliberately vague on login. "No such email" tells anyone who
      // asks which addresses are registered here.
      setFail(joining ? e : { message: 'Those details did not match. Please check and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.hero}>{joining ? t('signUp') : t('signIn')}</Text>
      <Card>
        {joining
          ? <Input label="Your name" value={form.name} onChangeText={v => set('name', v)}
                   error={errors.name} />
          : null}
        <Input label={t('email') + ' or ' + t('phone')}
               value={form.identifier} onChangeText={v => set('identifier', v)}
               autoCapitalize="none" error={errors.identifier}
               hint={'Phone numbers start with ' + DIAL_CODE} />
        <Input label={t('password')} value={form.password} secureTextEntry
               onChangeText={v => set('password', v)} error={errors.password}
               hint="At least 8 characters" />
        {failed ? <Text style={s.err}>{failed.message}</Text> : null}
        <Button title={joining ? t('signUp') : t('signIn')} onPress={go} busy={busy} />
      </Card>
      <Button kind="ghost"
              title={joining ? 'I already have an account' : 'Create an account'}
              onPress={() => { setMode(joining ? 'login' : 'join'); setFail(null); setErr({}); }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  hero: { fontSize: theme.font.hero, fontWeight: '800', color: theme.color.text,
          marginVertical: theme.space.lg },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

function rolePickerScreen(a) {
  return `// RolePickerScreen.js — country, language, and which side you are on.
//
// WHY ALL THREE HERE, BEFORE ANYTHING ELSE:
//
// Country decides your currency, your phone prefix, and — if you are
// offering services — which documents the law asks you for. Getting that
// wrong later means redoing the whole application.
//
// Language is separate from country, deliberately. Somebody living in
// Dubai may well read Hindi. Country is where you are; language is how
// you read. Treating them as one thing is a mistake almost every app
// makes, and it quietly excludes people.
//
// Role is asked first because a provider has to send far more information.
// Knowing who you are talking to means never showing the wrong fields.

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { useT } from '../i18n';
import { useAuth } from '../auth';
import { Button, Card, Row } from '../ui';
import { LANGUAGES } from '../i18n';
import { COUNTRIES } from '../countries';

export default function RolePickerScreen({ navigation }) {
  const { t, lang, setLang } = useT();
  const [country, setCountry] = useState('${a.country || 'IN'}');
  const [role, setRole]       = useState(null);
  const [open, setOpen]       = useState(null);   // 'country' | 'lang' | null
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const list = Object.keys(COUNTRIES);

  async function go() {
    if (!role || busy) return;
    setBusy(true); setError(null);
    try {
      await api.patch('/me', { country, lang, role });
      // A provider goes to the documents step. A customer is done and
      // can start using the app straight away.
      navigation.replace(role === 'provider' ? 'ProviderOnboard' : 'Home');
    } catch (e) { setError(e); setBusy(false); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Row title={t('chooseCountry')}
             right={COUNTRIES[country] ? COUNTRIES[country].name : country}
             onPress={() => setOpen(o => (o === 'country' ? null : 'country'))} />
        {open === 'country' ? list.map(c => (
          <Row key={c} title={COUNTRIES[c].name}
               sub={COUNTRIES[c].cur + '  ' + COUNTRIES[c].dial}
               right={c === country ? '✓' : ''}
               onPress={() => { setCountry(c); setOpen(null); }} />
        )) : null}
      </Card>

      <Card>
        <Row title={t('chooseLanguage')}
             right={(LANGUAGES.find(l => l.code === lang) || {}).native}
             onPress={() => setOpen(o => (o === 'lang' ? null : 'lang'))} />
        {open === 'lang' ? LANGUAGES.map(l => (
          <Row key={l.code} title={l.native} sub={l.label}
               right={l.code === lang ? '✓' : ''}
               onPress={() => { setLang(l.code); setOpen(null); }} />
        )) : null}
      </Card>

      <Card>
        <Text style={s.h}>How will you use ${a.name}?</Text>
        <Row title={t('iAmCustomer')} right={role === 'customer' ? '✓' : ''}
             onPress={() => setRole('customer')} />
        <Row title={t('iAmProvider')}
             sub="You will be asked for a few documents"
             right={role === 'provider' ? '✓' : ''}
             onPress={() => setRole('provider')} />
        <Text style={s.p}>You can change this later from settings.</Text>
      </Card>

      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button title={t('continue')} onPress={go} busy={busy} disabled={!role} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  h: { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text, marginBottom: 6 },
  p: { color: theme.color.muted, fontSize: theme.font.small, marginTop: 8 },
  err: { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* countries.js অ্যাপের দিকেও লাগে — সার্ভারেরটার হুবহু নকল নয়, শুধু
   যেটুকু পর্দায় দেখাতে হয় সেটুকু। পুরো নিয়মের তালিকা ফোনে পাঠানোর
   দরকার নেই, আর পাঠালে ফাইলটা অকারণে বড় হয়। */
function countriesClient(a, COUNTRIES) {
  const slim = {};
  Object.keys(COUNTRIES).forEach(k => {
    const c = COUNTRIES[k];
    slim[k] = { name: c.name, cur: c.cur, sym: c.sym, dial: c.dial };
  });
  return `// countries.js — just enough for the app to show the picker.
// The full document rules live on the server, where they are enforced.

export const COUNTRIES = ${JSON.stringify(slim, null, 2)};
`;
}

module.exports = { authScreen, rolePickerScreen, countriesClient };

};

/* ──────── gen-project.js ──────── */
__mods["gen-project.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-project.js — package.json, .gitignore, .env.example, App.js, রুট
 *
 * ⚠️ package.json ছাড়া npm install চলেই না। এটা বাদ পড়লে ZIP নামিয়ে
 * দর্শক প্রথম ধাপেই আটকে যেত।
 *
 * ⚠️ .gitignore-এ .env থাকা জরুরি। নাহলে দর্শক নিজের গোপন চাবি GitHub-এ
 * তুলে দেবে, আর ওটা মুছলেও ইতিহাসে থেকে যায়। এই একটা লাইন বহু মানুষকে
 * বহু কষ্ট থেকে বাঁচায়।
 */

function packageJson(a) {
  return JSON.stringify({
    name: a.slug || 'app',
    version: '1.0.0',
    private: true,
    description: (a.name + ' — built live on Code Knowledge'),
    scripts: {
      start: 'node server/index.js',
      app: 'expo start',
      'app:android': 'expo start --android',
      'app:web': 'expo start --web',
      seed: 'node server/seed.js',
    },
    dependencies: {
      'expo': '~51.0.0',
      'react': '18.2.0',
      'react-native': '0.74.5',
      '@react-navigation/native': '^6.1.17',
      '@react-navigation/native-stack': '^6.9.26',
      '@react-navigation/bottom-tabs': '^6.5.20',
      'react-native-screens': '~3.31.1',
      'react-native-safe-area-context': '4.10.5',
      '@react-native-async-storage/async-storage': '1.23.1',
      'express': '^4.19.2',
      'better-sqlite3': '^11.0.0',
      'jsonwebtoken': '^9.0.2',
      'bcryptjs': '^2.4.3',
      'livekit-server-sdk': '^2.5.0',
      'dotenv': '^16.4.5',
    },
    engines: { node: '>=18' },
  }, null, 2) + '\n';
}

function gitignore() {
  return `# Never commit these.
#
# .env holds the secret keys setup created for you. If it reaches GitHub,
# anyone can sign tokens as any user of your app. And deleting the file
# later does not help, because it stays in the history forever.
.env
.env.*
!.env.example

node_modules/
*.db
*.db-journal
*.db-wal
uploads/
.expo/
dist/
build/
.DS_Store
npm-debug.log*
`;
}

function envExample(a) {
  return `# .env.example — copy this to .env, or just run setup and it does it for you.
#
# The two secrets below must be YOUR OWN random values. If everybody who
# downloads this keeps the same ones, one person's mistake affects every
# other person's users. setup.ps1 and setup.sh generate them for you.

JWT_SECRET=change-me
REFRESH_SECRET=change-me-too
DATABASE_URL=file:./data.db
PORT=4000

# ---------------------------------------------------------------
# Everything below is optional. ${a.name} runs without any of it,
# using local files, so you can build the whole thing before paying
# for anything. Fill these in when you are ready for real users.
# ---------------------------------------------------------------

# File storage. Free to start: Cloudflare R2 gives 10 GB and charges
# nothing for downloads, which is the part that usually hurts.
STORAGE_ENDPOINT=
STORAGE_BUCKET=
STORAGE_KEY=
STORAGE_SECRET=

# Live classes and calls. LiveKit is open source; their hosted plan is
# free up to roughly fifty hours a month. Plenty while you are starting.
LIVEKIT_URL=
LIVEKIT_KEY=
LIVEKIT_SECRET=

# Payments. Use the TEST keys first. Every provider gives you a set of
# test card numbers so you can take a hundred fake payments safely.
PAYMENT_KEY=
PAYMENT_SECRET=
PAYMENT_WEBHOOK_SECRET=
`;
}

/* ---------------------------------------------------------------- App */
/* ⚠️ টেমপ্লেটের ভেতরে টেমপ্লেট লেখা যায় না — তাই টুকরোগুলো আগে বানিয়ে
   নেওয়া হচ্ছে, তারপর একবারে জোড়া হচ্ছে। */
function appJs(a) {
  const scr = a.screens.slice(0, 9);
  const imports = scr.map((s, i) =>
    "import S" + (i + 1) + " from './screens/" +
    String(i + 1).padStart(2, '0') + "-" + comp(s) + "';").join('\n');

  const tabs = scr.slice(0, 4).map((s, i) =>
    "      <Tabs.Screen name=\"S" + (i + 1) + "\" component={S" + (i + 1) +
    "} options={{ title: '" + s.replace(/&amp;/g, 'and').replace(/'/g, '') + "' }} />").join('\n');

  const stacked = scr.slice(4).map((s, i) =>
    "          <Stack.Screen name=\"S" + (i + 5) + "\" component={S" + (i + 5) +
    "} options={{ title: '" + s.replace(/&amp;/g, 'and').replace(/'/g, '') + "' }} />").join('\n');

  return `// App.js — where ${a.name} starts.
//
// Read this file first. It shows the shape of the whole app on one screen:
// who is signed in, what language they read, and which set of screens they
// are allowed to see.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './auth';
import { I18nProvider } from './i18n';
import { Loader } from './ui';
import { theme } from './theme';
import { APP } from './config';

import AuthScreen from './screens/AuthScreen';
import RolePickerScreen from './screens/RolePickerScreen';
${imports}
import { ProviderOnboardScreen, ProviderHomeScreen, ProviderEarningsScreen } from './Provider';
import { OwnerApprovalsScreen, OwnerMoneyScreen, OwnerStaffScreen, OwnerReportsScreen } from './Owner';

const Stack = createNativeStackNavigator();
const Tabs  = createBottomTabNavigator();

/* Each role gets its own set of tabs.
   This is NOT the security. The server decides what anyone may actually
   do. This only means a driver is not staring at an approvals queue they
   could never use anyway. */
function CustomerTabs() {
  return (
    <Tabs.Navigator screenOptions={{ tabBarActiveTintColor: theme.color.primary }}>
${tabs}
    </Tabs.Navigator>
  );
}

function ProviderTabs() {
  return (
    <Tabs.Navigator screenOptions={{ tabBarActiveTintColor: theme.color.primary }}>
      <Tabs.Screen name="Jobs"     component={ProviderHomeScreen}     options={{ title: 'Jobs' }} />
      <Tabs.Screen name="Earnings" component={ProviderEarningsScreen} options={{ title: 'Earnings' }} />
    </Tabs.Navigator>
  );
}

function OwnerTabs() {
  return (
    <Tabs.Navigator screenOptions={{ tabBarActiveTintColor: theme.color.primary }}>
      <Tabs.Screen name="Approvals" component={OwnerApprovalsScreen} options={{ title: 'Approvals' }} />
      <Tabs.Screen name="Money"     component={OwnerMoneyScreen}     options={{ title: 'Money' }} />
      <Tabs.Screen name="Team"      component={OwnerStaffScreen}     options={{ title: 'Team' }} />
      <Tabs.Screen name="Reports"   component={OwnerReportsScreen}   options={{ title: 'Reports' }} />
    </Tabs.Navigator>
  );
}

function Routes() {
  const { user, loading } = useAuth();
  if (loading) return <Loader label="Starting" />;

  return (
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      {!user ? (
        <>
          <Stack.Screen name="Auth" component={AuthScreen} options={{ title: APP.name }} />
          <Stack.Screen name="RolePicker" component={RolePickerScreen} options={{ title: 'Welcome' }} />
        </>
      ) : user.role === 'owner' || user.role === 'staff' ? (
        <Stack.Screen name="Owner" component={OwnerTabs} options={{ headerShown: false }} />
      ) : user.role === 'provider' && user.providerStatus !== 'approved' ? (
        // Applied but not approved yet. Do not drop somebody into an empty
        // jobs list with no explanation. Tell them where they stand.
        <Stack.Screen name="ProviderOnboard" component={ProviderOnboardScreen}
                      options={{ title: 'Your application' }} />
      ) : user.role === 'provider' ? (
        <Stack.Screen name="Provider" component={ProviderTabs} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={CustomerTabs} options={{ headerShown: false }} />
${stacked}
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <NavigationContainer>
            <Routes />
          </NavigationContainer>
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
`;
}

/* ⚠️ gen-screens.js-ও হুবহু এই নিয়মে নাম বানায়। দুই জায়গায় আলাদা হলে
   ফাইল তৈরি হয় এক নামে, import খোঁজে অন্য নামে। */
function comp(label) {
  return String(label)
    .replace(/&amp;|&/g, 'And')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
    // JavaScript-এ নাম সংখ্যা দিয়ে শুরু হতে পারে না
    .replace(/^([0-9])/, 'Screen$1') + 'Screen';
}

module.exports = { packageJson, gitignore, envExample, appJs, comp };

};

/* ──────── gen-perms.js ──────── */
__mods["gen-perms.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-perms.js — অনুমতির তালিকা, একটাই জায়গায়
 *
 * ⚠️ কেন আলাদা ফাইল
 * তালিকাটা অ্যাপেও লাগে (কোন বোতাম দেখাব), সার্ভারেও লাগে (কে সত্যিই
 * করতে পারবে)। দুই জায়গায় আলাদা করে লিখলে একদিন একটা বদলাবে, অন্যটা
 * বদলাবে না — আর তখন অ্যাপ বোতাম লুকিয়ে রাখবে অথচ সার্ভার কাজটা করতে
 * দেবে। ওটাই সবচেয়ে বিপজ্জনক অবস্থা, কারণ পরীক্ষা করলে সব ঠিক দেখায়।
 */
function permissions(a) {
  return `// permissions.js — the single list. Both the app and the server read it.
//
// Adding a permission? Add it here, use it in the app, and enforce it in
// server/guard.js. A permission that exists only in the app protects
// nothing at all, and it looks like it works, which is worse.

const PERMISSIONS = [
  'orders.view', 'orders.refund',
  'providers.view', 'providers.approve', 'providers.suspend',
  'items.view', 'items.remove',
  'commission.edit', 'payouts.run',
  'ads.edit', 'reports.view',
  'staff.manage',
];

// What each role gets by default.
//   customer — only ever their own records
//   provider — only ever their own listings and their own money
//   staff    — whatever the owner ticked, nothing more
//   owner    — everything, and only the owner may create staff
const ROLE_DEFAULTS = {
  customer: [],
  provider: [],
  staff:    ['orders.view', 'providers.view', 'items.view', 'reports.view'],
  owner:    PERMISSIONS,
};

// Things nobody may do on somebody else's behalf. Not staff. Not even
// the owner. Looking at a record to help someone is support work;
// acting as them is not, and there is no honest reason to need it.
const NEVER_ON_BEHALF = ['orders.create', 'payouts.redirect', 'password.read'];

module.exports = { PERMISSIONS, ROLE_DEFAULTS, NEVER_ON_BEHALF };
`;
}
module.exports = { permissions };

};

/* ──────── gen-guard.js ──────── */
__mods["gen-guard.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-guard.js — সার্ভারের আসল পাহারা
 *
 * ⚠️ তিনটে নিয়ম, আর তিনটেই আলাদা কারণে দরকার:
 *
 *  ১. ভূমিকা যাচাই — তুমি কে?
 *     কিন্তু এটা একা যথেষ্ট নয়। "provider" হলেই সব provider-এর তথ্য
 *     দেখার অধিকার জন্মায় না।
 *
 *  ২. মালিকানা যাচাই — এই জিনিসটা কি সত্যিই তোমার?
 *     এটাই সবচেয়ে বেশি বাদ পড়ে, আর এটাই সবচেয়ে বড় ফাঁক। /orders/8891
 *     লিখে অন্যের অর্ডার দেখে ফেলা — এভাবেই আসল অ্যাপ থেকে তথ্য ফাঁস হয়।
 *
 *  ৩. মালিকের দেখা যায়, সাজা যায় না।
 *     সমস্যা সমাধানের জন্য মালিককে অনেক সময় সবার পাতা দেখতে হয়। কিন্তু
 *     "দেখা" আর "অন্যের হয়ে কাজ করা" এক নয়। মালিক দেখতে পারবেন, কিন্তু
 *     টাকা সরাতে বা কারও হয়ে অর্ডার দিতে পারবেন না। আর দেখলেই সেটা
 *     খাতায় লেখা থাকবে।
 */

function guard(a) {
  return `// guard.js — the real access control. This file is the security.
//
// The app hides buttons. That is decoration. Anyone can send a request
// straight to this server with a tool like curl and never open the app.
// So everything below runs on EVERY request, no exceptions.

const jwt = require('jsonwebtoken');
const { ROLE_DEFAULTS, NEVER_ON_BEHALF } = require('../permissions');

/* ---------- 1. who are you ---------- */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: claims.sub,
      role: claims.role,
      // Permissions come from the token, which the server signed.
      // Never from the request body. A phone can put anything in a body.
      permissions: claims.permissions || ROLE_DEFAULTS[claims.role] || [],
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
}

/* ---------- 2. are you the right kind of person ---------- */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    if (!roles.includes(req.user.role)) {
      // Deliberately vague. Telling someone "owner only" tells them the
      // route exists and is worth attacking.
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  };
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    if (!req.user.permissions.includes(perm)) {
      return res.status(403).json({ error: 'You do not have permission for this' });
    }
    next();
  };
}

/* ---------- 3. is this thing actually yours ----------
   The one almost everybody forgets.

   A provider is allowed to see "their orders". If you only check the
   role, then provider #12 can type /orders/8891 and read provider #77's
   order. Same role. Different owner. That is a real leak, and it is how
   most of the ones you read about in the news happened.

   So: role check AND ownership check. Both. Every time. */
function ownsOr(perm, loadOwnerId) {
  return async (req, res, next) => {
    try {
      const ownerId = await loadOwnerId(req);
      if (ownerId == null) return res.status(404).json({ error: 'Not found' });
      if (String(ownerId) === String(req.user.id)) return next();
      if (req.user.permissions.includes(perm)) {
        // The owner is looking at somebody else's record. Allowed, but
        // written down. An unlogged look is indistinguishable from theft.
        req.viewingAsStaff = true;
        await audit(req, 'viewed', ownerId);
        return next();
      }
      // Same message as a missing record, on purpose. Otherwise the
      // difference between 403 and 404 tells an attacker what exists.
      return res.status(404).json({ error: 'Not found' });
    } catch (e) { next(e); }
  };
}

/* ---------- 4. things nobody may do, not even the owner ----------
   The owner can LOOK at everything, because support work needs it.
   The owner may not ACT as somebody else. Placing an order in a
   customer's name, or moving a provider's payout to another account,
   is not support. There is no legitimate reason to allow it, and every
   platform that allowed it regretted it. */
function notOnBehalf(action) {
  return (req, res, next) => {
    if (req.viewingAsStaff && NEVER_ON_BEHALF.includes(action)) {
      return res.status(403).json({
        error: 'This action can only be done by the account holder.',
      });
    }
    next();
  };
}

/* ---------- 5. the record of who looked at what ---------- */
async function audit(req, action, subjectId) {
  const { db } = require('./db');
  await db.run(
    'INSERT INTO audit_log (actor_id, actor_role, action, subject_id, path, at) VALUES (?,?,?,?,?,?)',
    [req.user.id, req.user.role, action, subjectId, req.originalUrl, new Date().toISOString()]
  );
}

module.exports = { authenticate, requireRole, requirePerm, ownsOr, notOnBehalf, audit };
`;
}

module.exports = { guard };

};

/* ──────── gen-i18n.js ──────── */
__mods["gen-i18n.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-i18n.js — সবাই নিজের ভাষায়
 *
 * ⚠️ কেন এটা আলাদা করে ভাবা দরকার
 * মালিক হয়তো ইংরেজিতে চালান। কিন্তু তাঁর ত্রিশজন গ্রাহক ত্রিশ রকম ভাষায়
 * থাকতে পারেন। তাই ভাষা অ্যাপের নয়, প্রতিটা মানুষের নিজের।
 *
 * ⚠️ ডান-থেকে-বাম ভাষা (আরবি, উর্দু) প্রায় সবাই ভুলে যায়। ওতে শুধু শব্দ
 * নয়, পুরো পর্দার দিকই উল্টে যায়। এখানে সেটা ধরা আছে।
 *
 * ⚠️ অনুবাদ না থাকলে অ্যাপ ভাঙে না — ইংরেজিতে ফিরে যায়। তাই দর্শক
 * ধীরে ধীরে ভাষা যোগ করতে পারবেন, একসাথে সব লাগবে না।
 */

function i18n(a) {
  return `// i18n.js — language is per person, not per app.
//
// The owner may run this in English while thirty customers each use a
// different language. That is normal, and it is why the choice is saved
// against the user, not against the app.
//
// TO ADD A LANGUAGE: copy the 'en' block, translate the values, keep the
// keys exactly the same, and add the code to LANGUAGES. That is all.
// Anything you have not translated falls back to English, so a
// half-finished language never breaks the app.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LANGUAGES = [
  { code: 'en', label: 'English',     native: 'English',    rtl: false },
  { code: 'hi', label: 'Hindi',       native: 'हिन्दी',      rtl: false },
  { code: 'bn', label: 'Bengali',     native: 'বাংলা',       rtl: false },
  { code: 'es', label: 'Spanish',     native: 'Español',    rtl: false },
  { code: 'pt', label: 'Portuguese',  native: 'Português',  rtl: false },
  { code: 'fr', label: 'French',      native: 'Français',   rtl: false },
  { code: 'id', label: 'Indonesian',  native: 'Bahasa',     rtl: false },
  { code: 'sw', label: 'Swahili',     native: 'Kiswahili',  rtl: false },
  { code: 'ar', label: 'Arabic',      native: 'العربية',     rtl: true  },
  { code: 'ur', label: 'Urdu',        native: 'اردو',        rtl: true  },
];

/* Only the words the app itself shows. Things your users type, like a
   shop name or a message, are never translated. */
const STRINGS = {
  en: {
    continue: 'Continue', cancel: 'Cancel', save: 'Save', retry: 'Try again',
    signIn: 'Sign in', signOut: 'Sign out', signUp: 'Create account',
    email: 'Email', phone: 'Phone number', password: 'Password',
    search: 'Search', loading: 'Loading', noConnection: 'No connection',
    somethingWrong: 'Something went wrong', nothingHere: 'Nothing here yet',
    chooseCountry: 'Choose your country', chooseState: 'Choose your state',
    chooseLanguage: 'Choose your language',
    iAmCustomer: 'I want to use ${a.name}',
    iAmProvider: 'I want to offer my services',
    documents: 'Your documents', earnings: 'Earnings', payout: 'Payout',
    orders: 'Orders', pending: 'Pending', approved: 'Approved',
    commission: 'Commission', total: 'Total', pay: 'Pay now',
  },
  hi: {
    continue: 'आगे बढ़ें', cancel: 'रद्द करें', save: 'सेव करें', retry: 'फिर कोशिश करें',
    signIn: 'साइन इन', signOut: 'साइन आउट', signUp: 'खाता बनाएँ',
    email: 'ईमेल', phone: 'मोबाइल नंबर', password: 'पासवर्ड',
    search: 'खोजें', loading: 'लोड हो रहा है', noConnection: 'कनेक्शन नहीं है',
    somethingWrong: 'कुछ गड़बड़ हुई', nothingHere: 'अभी यहाँ कुछ नहीं है',
    chooseCountry: 'अपना देश चुनें', chooseState: 'अपना राज्य चुनें',
    chooseLanguage: 'अपनी भाषा चुनें',
    iAmCustomer: 'मुझे ${a.name} इस्तेमाल करना है',
    iAmProvider: 'मुझे अपनी सेवाएँ देनी हैं',
    documents: 'आपके दस्तावेज़', earnings: 'कमाई', payout: 'भुगतान',
    orders: 'ऑर्डर', pending: 'बाकी', approved: 'मंज़ूर',
    commission: 'कमीशन', total: 'कुल', pay: 'अभी भुगतान करें',
  },
  bn: {
    continue: 'এগিয়ে যান', cancel: 'বাতিল', save: 'সংরক্ষণ', retry: 'আবার চেষ্টা',
    signIn: 'সাইন ইন', signOut: 'সাইন আউট', signUp: 'অ্যাকাউন্ট খুলুন',
    email: 'ইমেইল', phone: 'মোবাইল নম্বর', password: 'পাসওয়ার্ড',
    search: 'খুঁজুন', loading: 'লোড হচ্ছে', noConnection: 'সংযোগ নেই',
    somethingWrong: 'কিছু ভুল হয়েছে', nothingHere: 'এখানে এখনো কিছু নেই',
    chooseCountry: 'আপনার দেশ বাছুন', chooseState: 'আপনার রাজ্য বাছুন',
    chooseLanguage: 'আপনার ভাষা বাছুন',
    iAmCustomer: 'আমি ${a.name} ব্যবহার করতে চাই',
    iAmProvider: 'আমি সেবা দিতে চাই',
    documents: 'আপনার নথি', earnings: 'আয়', payout: 'পেআউট',
    orders: 'অর্ডার', pending: 'বাকি', approved: 'অনুমোদিত',
    commission: 'কমিশন', total: 'মোট', pay: 'এখন পরিশোধ করুন',
  },
};

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState('en');

  useEffect(() => {
    AsyncStorage.getItem('lang').then(saved => { if (saved) apply(saved); });
  }, []);

  function apply(code) {
    const meta = LANGUAGES.find(l => l.code === code) || LANGUAGES[0];
    setLang(meta.code);
    AsyncStorage.setItem('lang', meta.code);
    // Right-to-left is not just mirrored text. The whole layout flips:
    // back arrows, list arrows, which side a name sits on. React Native
    // handles it, but only if you tell it, and only after a restart.
    if (I18nManager.isRTL !== meta.rtl) {
      I18nManager.allowRTL(meta.rtl);
      I18nManager.forceRTL(meta.rtl);
      // The app must be reopened for this to take effect. Tell the user
      // plainly rather than leaving them with a half-flipped screen.
    }
  }

  // Missing translation falls back to English, never to a blank or a key.
  // A half-translated app is usable. An app showing "screen.title.main" is not.
  function t(key, vars) {
    const table = STRINGS[lang] || STRINGS.en;
    let out = table[key] != null ? table[key] : (STRINGS.en[key] || key);
    if (vars) Object.keys(vars).forEach(k => {
      out = out.replace(new RegExp('\\\\{' + k + '\\\\}', 'g'), vars[k]);
    });
    return out;
  }

  const meta = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];
  return (
    <I18nContext.Provider value={{ lang, setLang: apply, t, rtl: meta.rtl, LANGUAGES }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside I18nProvider');
  return ctx;
}
`;
}

module.exports = { i18n };

};

/* ──────── gen-setup.js ──────── */
__mods["gen-setup.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-setup.js — দর্শকের জন্য "একবার চালান, সব হয়ে যাবে" ফাইল
 *
 * ⚠️ কেন এটা দরকার
 * -----------------
 * দর্শকের অনেকে জীবনে PowerShell খোলেনি। "npm install চালান" বললে তারা
 * জানে না terminal কোথায়, Node কী, বা কেন কাজ করছে না।
 *
 * তাই ZIP-এ একটা ফাইল থাকবে — Windows-এ setup.ps1, Mac/Linux-এ setup.sh।
 * ডাবল-ক্লিক বা এক লাইন। সেটাই Node আছে কিনা দেখে, নেই বললে কোথা থেকে
 * নামাতে হবে বলে, package বসায়, গোপন চাবি নিজে বানিয়ে দেয়, আর অ্যাপ চালু করে।
 *
 * ⚠️ গোপন চাবির অংশটা সবচেয়ে জরুরি। শত শত মানুষ একই ZIP নামাবে। সবার
 * চাবি এক থাকলে একজনের ভুলে সবাই বিপদে পড়ত। এই স্ক্রিপ্ট প্রতিজনের জন্য
 * আলাদা চাবি বানায়, নিজে থেকেই, কিছু জিজ্ঞেস না করেই।
 */

function setupPs1(a) {
  return `# setup.ps1 — run this once. It does everything.
#
# HOW TO RUN (Windows), if you have never done this before:
#   1. Unzip this folder somewhere simple, like C:\\projects\\${a.slug}
#   2. Open the folder in File Explorer
#   3. Hold Shift, right-click on empty space, choose
#      "Open PowerShell window here" or "Open in Terminal"
#   4. Type this and press Enter:
#         powershell -ExecutionPolicy Bypass -File .\\setup.ps1
#
# That -ExecutionPolicy Bypass part is not a hack. Windows blocks scripts
# by default. This allows just this one file, this one time.

$ErrorActionPreference = 'Stop'
Write-Host ""
Write-Host "  ${a.name} — setup" -ForegroundColor Cyan
Write-Host "  =========================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. Is Node installed? ----------
$node = (Get-Command node -EA 0)
if (-not $node) {
  Write-Host "  Node.js is not installed." -ForegroundColor Yellow
  Write-Host "  Go to https://nodejs.org and download the version marked LTS."
  Write-Host "  Not the newest one. LTS."
  Write-Host "  Install it, then CLOSE this window, open a new one, and run this again."
  Write-Host "  (An old window does not know Node exists yet. That trips up everyone.)"
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}
$v = (node -v) -replace 'v',''
$major = [int]($v.Split('.')[0])
Write-Host ("  Node " + $v + $(if ($major -lt 18) { "  <- too old, please install the LTS version" } else { "  OK" })) -ForegroundColor $(if ($major -lt 18) { 'Yellow' } else { 'Green' })
if ($major -lt 18) { Read-Host "  Press Enter to close"; exit 1 }

# ---------- 2. Your own secrets ----------
# Every person who downloads this gets different values here.
# If everyone shared the same secret, one person's mistake would put
# everybody else's users at risk. This takes one second and prevents that.
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path $envFile) {
  Write-Host "  .env already exists, leaving it alone" -ForegroundColor DarkGray
} else {
  function New-Secret { -join ((1..48) | % { '{0:x}' -f (Get-Random -Max 16) }) }
  @(
    "# Created by setup.ps1 on $(Get-Date -f 'yyyy-MM-dd').",
    "# NEVER put this file on GitHub. .gitignore already blocks it.",
    "JWT_SECRET=$(New-Secret)",
    "REFRESH_SECRET=$(New-Secret)",
    "DATABASE_URL=file:./data.db",
    "PORT=4000"
  ) | Set-Content $envFile -Encoding UTF8
  Write-Host "  .env created with your own private secrets" -ForegroundColor Green
}

# ---------- 3. Packages ----------
Write-Host ""
Write-Host "  Installing packages. This takes a few minutes the first time." -ForegroundColor Gray
Write-Host "  (If it seems stuck, it is usually your antivirus scanning every"
Write-Host "   new file. Adding this folder to its exclusions makes it fast.)"
Write-Host ""
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  Install failed. The usual cause is the connection dropping." -ForegroundColor Yellow
  Write-Host "  Try this, then run setup again:" -ForegroundColor Gray
  Write-Host "     Remove-Item node_modules -Recurse -Force" -ForegroundColor Gray
  Write-Host "     Remove-Item package-lock.json -Force" -ForegroundColor Gray
  Read-Host "  Press Enter to close"
  exit 1
}

# ---------- 4. Go ----------
Write-Host ""
Write-Host "  Done. Starting ${a.name}..." -ForegroundColor Green
Write-Host "  When an address appears below, open it." -ForegroundColor Gray
Write-Host "  To stop the app later, press Ctrl and C together." -ForegroundColor DarkGray
Write-Host ""
npm start
`;
}

function setupSh(a) {
  return `#!/usr/bin/env bash
# setup.sh — run this once. It does everything.
#
# HOW TO RUN (Mac or Linux), if you have never done this before:
#   1. Unzip this folder
#   2. Open Terminal
#   3. Type  cd   then drag the folder onto the Terminal window, press Enter
#   4. Then run:   bash setup.sh
#
set -e
echo ""
echo "  ${a.name} — setup"
echo "  ========================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  echo "  Go to https://nodejs.org and take the version marked LTS."
  echo "  Install it, close this Terminal, open a new one, run this again."
  exit 1
fi
MAJOR=\$(node -v | sed 's/v//' | cut -d. -f1)
echo "  Node \$(node -v)"
if [ "\$MAJOR" -lt 18 ]; then
  echo "  That version is too old. Please install the LTS version."
  exit 1
fi

if [ -f .env ]; then
  echo "  .env already exists, leaving it alone"
else
  gen() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \\n'; }
  {
    echo "# Created by setup.sh on \$(date +%Y-%m-%d)."
    echo "# NEVER put this file on GitHub. .gitignore already blocks it."
    echo "JWT_SECRET=\$(gen)"
    echo "REFRESH_SECRET=\$(gen)"
    echo "DATABASE_URL=file:./data.db"
    echo "PORT=4000"
  } > .env
  echo "  .env created with your own private secrets"
fi

echo ""
echo "  Installing packages. A few minutes the first time."
npm install --no-audit --no-fund

echo ""
echo "  Done. Starting ${a.name}..."
echo "  When an address appears, open it. Ctrl+C stops the app."
echo ""
npm start
`;
}

/* ==================================================================
   শুধু ফোন যাদের আছে
   ------------------------------------------------------------------
   ⚠️ setup.ps1 বা setup.sh ফোনে চলে না। কিন্তু ফোন থেকেও পুরোটা করা যায় —
   তিনটে সত্যিকারের পথ আছে, আর তিনটেই বিনামূল্যে:

     ১. Expo Snack   — শুধু ব্রাউজার। কোড পেস্ট করে নিজের ফোনে চালানো।
                       কিছু বসাতে হয় না। সবচেয়ে সহজ শুরু।
     ২. StackBlitz   — ব্রাউজারেই পুরো Node চলে। GitHub থেকে সরাসরি খোলে।
     ৩. Termux       — Android-এ আসল terminal। npm সত্যিই চলে, তবে
                       একটু ধৈর্য লাগে। নিচের স্ক্রিপ্ট ওটাই সহজ করে দেয়।

   এটা দয়া নয়। ভারত, নাইজেরিয়া, ইন্দোনেশিয়ায় বহু ভালো ডেভেলপারের
   প্রথম যন্ত্র ফোনই ছিল।
   ================================================================== */
function setupTermux(a) {
  return `#!/data/data/com.termux/files/usr/bin/bash
# setup-termux.sh — for people building on an Android phone.
#
# You do not need a laptop for this. It will be slower, and typing is
# harder, but it genuinely works. People have shipped real apps this way.
#
# HOW TO GET HERE, from nothing:
#   1. Install Termux from F-Droid (NOT the Play Store version, that one
#      is old and abandoned and will fail on step 3).
#   2. Open Termux and run:   pkg update && pkg upgrade
#   3. Then run:              pkg install nodejs git
#   4. Get this project:      unzip it, or  git clone <your repo>
#   5. cd into the folder and run:   bash setup-termux.sh
#
# If any of that felt like too much, use snack.expo.dev in your browser
# instead. No install at all, and you can run the app on this same phone.

set -e
echo ""
echo "  \${0##*/} — ${a.name} on Android"
echo "  ========================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node is not installed in Termux yet."
  echo "  Run this first:   pkg install nodejs"
  exit 1
fi
echo "  Node \$(node -v)"

# Termux needs this or npm tries to write where Android will not allow it
export npm_config_cache="\$PREFIX/tmp/npm-cache"
mkdir -p "\$npm_config_cache"

if [ -f .env ]; then
  echo "  .env already exists, leaving it alone"
else
  gen() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  {
    echo "# Created by setup-termux.sh on \$(date +%Y-%m-%d)."
    echo "# NEVER put this file on GitHub."
    echo "JWT_SECRET=\$(gen)"
    echo "REFRESH_SECRET=\$(gen)"
    echo "DATABASE_URL=file:./data.db"
    echo "PORT=4000"
  } > .env
  echo "  .env created with your own private secrets"
fi

echo ""
echo "  Installing packages. On a phone this takes longer, sometimes"
echo "  fifteen minutes. Keep the screen on, or Android may pause it."
echo ""
npm install --no-audit --no-fund --no-optional

echo ""
echo "  Done. Starting the server..."
echo "  Then open  http://localhost:4000  in this phone's browser."
echo "  Ctrl+C stops it. In Termux, that is the volume-down key and C."
echo ""
npm start
`;
}

/* ফোনের ব্রাউজার থেকেই চালানোর ঠিকানা — ZIP-এর README-তে বসে */
function browserLinks(a) {
  return {
    snack:      'https://snack.expo.dev',
    stackblitz: 'https://stackblitz.com/github/YOUR-NAME/' + a.slug,
    replit:     'https://replit.com/github/YOUR-NAME/' + a.slug,
  };
}

module.exports = { setupPs1, setupSh, setupTermux, browserLinks };

};

/* ──────── gen-server.js ──────── */
__mods["gen-server.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-server.js — সার্ভার, ডেটাবেস, আপলোড, লাইভ ক্লাস
 *
 * ⚠️ এখানেই আসল নিরাপত্তা। অ্যাপে বোতাম লুকানো সাজসজ্জা।
 *
 * ⚠️ তিনটে জিনিস যেগুলো বেশিরভাগ শেখানো প্রকল্পে থাকে না, অথচ ছাড়া
 * অ্যাপটা ব্যবসা হয় না:
 *
 *   ১. আপলোড — বড় ফাইল সার্ভারের ভেতর দিয়ে পাঠানো হয় না। সার্ভার
 *      একটা সময়সীমাওয়ালা ঠিকানা দেয়, ফোন সরাসরি স্টোরেজে পাঠায়।
 *      নাহলে একটা ৫০০ MB ভিডিওই পুরো সার্ভার আটকে দেয়।
 *
 *   ২. কে দেখতে পাবে — ভিডিওর ঠিকানা স্থায়ী হলে একজন কিনে বাকিদের
 *      লিংক পাঠিয়ে দেবে। তাই প্রতিবার নতুন, অল্প সময়ের ঠিকানা।
 *
 *   ৩. লাইভ ক্লাস — শিক্ষকের মাইক খোলা, ছাত্রদের বন্ধ। প্রশ্ন থাকলে
 *      হাত তোলে, শিক্ষক অনুমতি দিলে মাইক খোলে। ২০০ জনের মাইক একসাথে
 *      খোলা রাখলে কোনো যন্ত্রই সামলাতে পারবে না।
 */

function db(a) {
  return `// db.js — the shape of everything ${a.name} stores.
//
// Starts as a single file on your machine. Nothing to install, nothing to
// pay for. When you outgrow it, change DATABASE_URL and the rest of the
// code does not care. That is the whole reason it is behind this file.

const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_URL ? process.env.DATABASE_URL.replace('file:', '') : './data.db');
db.pragma('journal_mode = WAL');   // lets reading and writing happen at once

db.exec(\`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  permissions TEXT DEFAULT '[]',
  country TEXT DEFAULT 'IN',
  lang TEXT DEFAULT 'en',
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

-- A provider's application and papers. We store WHERE the file is,
-- never the number itself. An id number in a database column is a
-- liability; a file you can delete is not.
CREATE TABLE IF NOT EXISTS provider_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  status TEXT DEFAULT 'pending',          -- pending | approved | suspended
  documents TEXT DEFAULT '{}',            -- { "Aadhaar number": "file-key" }
  bank TEXT DEFAULT '{}',
  reviewed_by TEXT,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  price_minor INTEGER NOT NULL DEFAULT 0,
  media_key TEXT,
  visibility TEXT DEFAULT 'public',       -- public | enrolled | private
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT REFERENCES items(id),
  total_minor INTEGER NOT NULL,
  platform_minor INTEGER NOT NULL,        -- your cut, worked out at order time
  provider_minor INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL
);

-- Who is allowed to open which item. Written when payment succeeds,
-- never before. This one table is what stops a paid course leaking.
CREATE TABLE IF NOT EXISTS enrolments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  order_id TEXT REFERENCES orders(id),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, item_id)
);

CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES items(id),
  host_id TEXT NOT NULL REFERENCES users(id),
  room TEXT NOT NULL UNIQUE,
  starts_at TEXT,
  status TEXT DEFAULT 'scheduled',        -- scheduled | live | ended
  created_at TEXT NOT NULL
);

-- Students ask to speak; the teacher lets them. Nobody unmutes themselves.
CREATE TABLE IF NOT EXISTS hand_raises (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT DEFAULT 'raised',            -- raised | allowed | lowered
  at TEXT NOT NULL
);

-- Your commission and anything else you change from the owner screen.
-- Kept in the database, not in a file, because the app must be able to
-- read it without a redeploy, and because a file resets on most hosts.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES users(id),
  amount_minor INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  requested_at TEXT NOT NULL,
  paid_at TEXT
);

-- Every time somebody looks at a record that is not theirs.
-- A look that leaves no trace cannot be told apart from theft.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT, actor_role TEXT, action TEXT,
  subject_id TEXT, path TEXT, at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_provider ON orders(provider_id);
CREATE INDEX IF NOT EXISTS idx_items_provider  ON items(provider_id);
CREATE INDEX IF NOT EXISTS idx_enrol_user      ON enrolments(user_id);
\`);

module.exports = { db };
`;
}


/* ---------------------------------------------------------------- */
function storage(a) {
  return `// storage.js — where uploaded files actually live.
//
// THE RULE: big files never travel through your server.
//
// A 500 MB lesson video sent through Node blocks everything else while it
// uploads. Instead the server hands out a short-lived address, the phone
// uploads straight to storage, and the server only ever sees the key.
// Same pattern every large app uses, and it costs nothing to do right.
//
// Free to start: Cloudflare R2 gives 10 GB and no charge for downloads,
// which is the part that usually hurts. Backblaze B2 and Supabase Storage
// also have free tiers. All three speak the same S3 language, so switching
// later means changing three lines here and nothing anywhere else.

const crypto = require('crypto');

const BUCKET   = process.env.STORAGE_BUCKET || '';
const ENDPOINT = process.env.STORAGE_ENDPOINT || '';
const KEY      = process.env.STORAGE_KEY || '';
const SECRET   = process.env.STORAGE_SECRET || '';

// Until you fill those in, uploads are saved next to the app so you can
// still build and test everything. Do not ship to real users like this;
// most hosts wipe local files every time the app restarts.
const LOCAL_MODE = !BUCKET;

function newKey(userId, filename) {
  const ext = (filename.match(/\\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  // Never keep the name the user gave. It can contain paths, quotes, or
  // somebody's real name in a document they did not mean to share.
  return userId + '/' + crypto.randomBytes(16).toString('hex') + ext;
}

/* An address the phone can POST to, valid for a few minutes. */
async function uploadUrl(userId, filename, contentType) {
  const key = newKey(userId, filename);
  if (LOCAL_MODE) return { key, url: '/upload-local/' + encodeURIComponent(key), local: true };
  const url = await presign('PUT', key, 300, contentType);
  return { key, url, local: false };
}

/* An address to WATCH with, valid for minutes, not forever.
   This is what stops one person buying a course and posting the link.
   A permanent link is a permanent leak. */
async function viewUrl(key, seconds = 600) {
  if (!key) return null;
  if (LOCAL_MODE) return '/files/' + encodeURIComponent(key);
  return presign('GET', key, seconds);
}

async function presign(method, key, seconds, contentType) {
  // Signed with your secret, so the address cannot be edited or extended.
  const expires = Math.floor(Date.now() / 1000) + seconds;
  const toSign = [method, BUCKET, key, expires, contentType || ''].join('\\n');
  const sig = crypto.createHmac('sha256', SECRET).update(toSign).digest('hex');
  return ENDPOINT + '/' + BUCKET + '/' + key +
    '?expires=' + expires + '&key=' + KEY + '&sig=' + sig;
}

module.exports = { uploadUrl, viewUrl, newKey, LOCAL_MODE };
`;
}

/* ---------------------------------------------------------------- */
function live(a) {
  return `// live.js — live classes.
//
// HOW THIS WORKS, and why it is built this way:
//
// The teacher's microphone is open. Every student's is off. A student who
// wants to ask something raises a hand; the teacher taps allow, and only
// then does that one microphone open. Nobody unmutes themselves.
//
// This is not politeness. Two hundred open microphones is more audio than
// any connection or any device can carry, and the class becomes noise.
// Every serious classroom app works this way.
//
// The room itself runs on LiveKit. It is open source, so you can run it
// yourself for nothing, or use their hosted service which is free up to
// about fifty hours a month. Fifty hours is a lot of classes while you
// are starting. The guide explains exactly when you would outgrow it and
// what it costs then. There is no way to avoid this cost with code; video
// to many people at once needs real machines somewhere.

const { AccessToken } = require('livekit-server-sdk');

const LK_KEY    = process.env.LIVEKIT_KEY || '';
const LK_SECRET = process.env.LIVEKIT_SECRET || '';
const LK_URL    = process.env.LIVEKIT_URL || '';

// The server decides what each person may do in the room. The phone asks;
// it never decides. If the phone decided, any student could grant
// themselves a microphone by editing one value.
function roomToken({ room, user, isHost, maySpeak }) {
  if (!LK_KEY) return null;             // not configured yet
  const at = new AccessToken(LK_KEY, LK_SECRET, {
    identity: user.id,
    name: user.name,
    ttl: 60 * 60 * 3,                   // three hours, then re-ask
  });
  at.addGrant({
    room,
    roomJoin: true,
    // Only the teacher, or a student the teacher has allowed, may publish
    // audio. Everyone else can listen and watch, nothing more.
    canPublish: !!(isHost || maySpeak),
    canPublishData: true,               // chat and hand-raises use this
    canSubscribe: true,
    roomAdmin: !!isHost,                // only the host can end the class
  });
  return { url: LK_URL, token: at.toJwt() };
}

module.exports = { roomToken, configured: !!LK_KEY };
`;
}

module.exports = { db, storage, live };

};

/* ──────── gen-roles.js ──────── */
__mods["gen-roles.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-roles.js — সেবাদাতা আর মালিকের পর্দা
 *
 * ⚠️ এই দুটো ফাইলই অ্যাপটাকে ব্যবসা বানায়। শুধু গ্রাহকের পর্দা থাকলে
 * ওটা একটা প্রদর্শনী, ব্যবসা নয়।
 *
 * ⚠️ নিরাপত্তার কথা আবার: এখানে যা লুকানো আছে তা শুধু দেখতে ভালো লাগার
 * জন্য। আসল পাহারা server.js-এর requireRole ও ownsOr-এ। কেউ অ্যাপ না
 * খুলেই সরাসরি সার্ভারে অনুরোধ পাঠাতে পারে।
 */

function providerFile(a) {
  return `// Provider.js — the side that earns money on ${a.name}.
//
// Three screens in one file: joining, working, getting paid.
// Kept together because a provider moves between them constantly, and
// splitting them into three files helps nobody except a linter.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { api } from './api';
import { theme } from './theme';
import { useT } from './i18n';
import { useAuth } from './auth';
import { money, requiredDocuments, BANK_FIELDS } from './helpers';
import { Button, Input, Card, Row, Badge, Loader, Empty, ErrorView } from './ui';

/* ================================================================
   1. Joining — documents
   ================================================================
   Which papers you ask for depends on the country, not on your opinion.
   requiredDocuments() reads it from config.js. Do not hard-code your own
   country's documents here; your providers will not all live where you do.

   NOTE: uploading identity documents makes you responsible for them.
   Store the file, not the number. Never log them. Delete them when the
   account closes. Your local privacy law will say more; read it. */
export function ProviderOnboardScreen({ navigation }) {
  const { t } = useT();
  const docs = requiredDocuments();
  const [files, setFiles]   = useState({});
  const [bank, setBank]     = useState({});
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  const missing = docs.filter(d => !files[d]);

  async function submit() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.post('/provider/apply', { documents: files, bank });
      navigation.replace('ProviderPending');
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.h}>{t('documents')}</Text>
        <Text style={s.p}>
          These are the documents required in your country. Nothing is sent
          anywhere until you press submit.
        </Text>
        {docs.map(d => (
          <Row key={d} title={d}
               right={files[d] ? 'Added' : 'Add'}
               onPress={() => setFiles(f => ({ ...f, [d]: 'pending-upload' }))} />
        ))}
      </Card>

      <Card>
        <Text style={s.h}>Where you get paid</Text>
        {BANK_FIELDS.map(f => (
          <Input key={f} label={f} value={bank[f] || ''}
                 onChangeText={v => setBank(b => ({ ...b, [f]: v }))} />
        ))}
        <Text style={s.p}>
          Money is held for a few days before payout so refunds can settle.
          You will see the exact date on every payment.
        </Text>
      </Card>

      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button title={t('continue')} busy={busy}
              disabled={missing.length > 0}
              onPress={submit} />
      {missing.length
        ? <Text style={s.p}>Still needed: {missing.join(', ')}</Text>
        : null}
    </ScrollView>
  );
}

/* ================================================================
   2. Working — the jobs that came in
   ================================================================ */
export function ProviderHomeScreen({ navigation }) {
  const { t } = useT();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [refreshing, setRef]  = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      // The server returns only this provider's jobs. It does not trust an
      // id sent from the phone. If it did, provider 12 could read
      // provider 77's work by changing one number in the URL.
      setItems((await api.get('/provider/orders')).items || []);
    } catch (e) { setError(e); } finally { setLoading(false); setRef(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => { setLoading(true); load(); }} />;

  if (!items.length) {
    return (
      <Empty
        title="No jobs yet"
        hint="New requests appear here. Share your link to get the first one."
        actionTitle={t('retry')}
        onAction={() => { setLoading(true); load(); }}
      />
    );
  }

  return (
    <FlatList
      style={s.wrap}
      data={items}
      keyExtractor={i => String(i.id)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRef(true); load(); }} />}
      renderItem={({ item }) => (
        <Row title={item.title} sub={item.when}
             right={money(item.payoutMinor)}
             onPress={() => navigation.navigate('OrderDetail', { id: item.id })} />
      )}
    />
  );
}

/* ================================================================
   3. Getting paid
   ================================================================
   Show the split openly. A provider who can see exactly what was taken
   and why will argue once and then trust you. One who cannot see it
   assumes the worst, and leaves. */
export function ProviderEarningsScreen() {
  const { t } = useT();
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.get('/provider/earnings').then(setData).catch(setError); }, []);

  if (!data && !error) return <Loader label={t('loading')} />;
  if (error && !data)  return <ErrorView error={error} />;

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.k}>{t('earnings')}</Text>
        <Text style={s.big}>{money(data.availableMinor)}</Text>
        <Text style={s.k}>{t('pending')} {money(data.pendingMinor)}</Text>
      </Card>

      <Card>
        <Text style={s.h}>How this was worked out</Text>
        <View style={s.line}><Text style={s.k}>Jobs completed</Text><Text style={s.v}>{data.jobs}</Text></View>
        <View style={s.line}><Text style={s.k}>Customers paid</Text><Text style={s.v}>{money(data.grossMinor)}</Text></View>
        <View style={s.line}><Text style={s.k}>{t('commission')}</Text><Text style={s.v}>− {money(data.commissionMinor)}</Text></View>
        <View style={s.line}><Text style={s.kb}>Yours</Text><Text style={s.vb}>{money(data.netMinor)}</Text></View>
      </Card>

      <Button title={t('payout')} disabled={!data.canPayout}
              onPress={() => api.post('/provider/payout', {})} />
      {!data.canPayout
        ? <Text style={s.p}>Next payout {data.nextPayoutDate}. Money is held a few days so refunds can settle.</Text>
        : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  h:  { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text, marginBottom: 6 },
  p:  { color: theme.color.muted, fontSize: theme.font.small, lineHeight: 20, marginTop: 8 },
  k:  { color: theme.color.muted, fontSize: theme.font.body },
  v:  { color: theme.color.text,  fontSize: theme.font.body },
  kb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  vb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  big:{ color: theme.color.text,  fontSize: 34, fontWeight: '800', marginVertical: 4 },
  line:{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  err: { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

function ownerFile(a) {
  return `// Owner.js — the side that runs ${a.name}.
//
// SECURITY, read once and remember it:
//
// Everything on these screens is also checked on the server. What this
// file does is decide what to SHOW. Hiding a screen stops an honest
// person wandering in. It does not stop anybody who is trying.
//
// The owner can LOOK at other people's records, because support work
// needs it. The owner cannot ACT as somebody else. Placing an order in a
// customer's name, or sending a provider's payout somewhere new, is not
// support work, and server.js refuses it even for the owner.
//
// Every time an owner opens somebody else's record, it is written down.
// A look that leaves no trace cannot be told apart from theft.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, FlatList, StyleSheet } from 'react-native';
import { api } from './api';
import { theme } from './theme';
import { useT } from './i18n';
import { useAuth, PERMISSIONS, Guard } from './auth';
import { money } from './helpers';
import { Button, Input, Card, Row, Badge, Loader, Empty, ErrorView } from './ui';

/* ---------- 1. Who is waiting to be approved ---------- */
export function OwnerApprovalsScreen({ navigation }) {
  const { t } = useT();
  const { can } = useAuth();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    try { setError(null); setItems((await api.get('/owner/applications')).items || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id, ok) {
    await api.post('/owner/applications/' + id, { approved: ok });
    load();
  }

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={load} />;
  if (!items.length) return <Empty title="Nobody waiting" hint="New applications appear here." />;

  return (
    <FlatList
      style={s.wrap}
      data={items}
      keyExtractor={i => String(i.id)}
      renderItem={({ item }) => (
        <Card>
          <Text style={s.h}>{item.name}</Text>
          <Text style={s.p}>{item.documentsSummary}</Text>
          <Guard perm="providers.approve" fallback={<Text style={s.p}>View only</Text>}>
            <View style={s.rowBtns}>
              <View style={{ flex: 1 }}>
                <Button title={t('approved')} onPress={() => decide(item.id, true)} />
              </View>
              <View style={{ width: 10 }} />
              <View style={{ flex: 1 }}>
                <Button title={t('cancel')} kind="danger" onPress={() => decide(item.id, false)} />
              </View>
            </View>
          </Guard>
        </Card>
      )}
    />
  );
}

/* ---------- 2. Money settings ---------- */
export function OwnerMoneyScreen() {
  const { t } = useT();
  const { can } = useAuth();
  const [pct, setPct]     = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);

  useEffect(() => { api.get('/owner/settings').then(r => setPct(String(r.commissionPercent))).catch(setError); }, []);

  async function save() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      // Changing your cut changes what every provider earns tomorrow.
      // Tell them before you do it, not after. People forgive a rise they
      // were warned about and leave over one they were not.
      await api.patch('/owner/settings', { commissionPercent: Number(pct) });
      setSaved(true);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Input label={t('commission') + ' %'} value={pct} onChangeText={setPct}
               keyboardType="numeric"
               hint="Start low. You can raise it once providers trust you." />
        {error ? <Text style={s.err}>{error.message}</Text> : null}
        {saved ? <Text style={s.ok}>Saved. It applies to new orders only.</Text> : null}
        <Guard perm="commission.edit" fallback={<Text style={s.p}>You can view this but not change it.</Text>}>
          <Button title={t('save')} onPress={save} busy={busy} />
        </Guard>
      </Card>
    </ScrollView>
  );
}

/* ---------- 3. Staff and what they may do ----------
   This is how a one-person app becomes a company. You bring somebody in
   to answer messages, and you give them exactly that and nothing else.
   Do not share your own login. Ever. When they leave you would have to
   change a password everybody knows, and you will forget. */
export function OwnerStaffScreen() {
  const { t } = useT();
  const [staff, setStaff] = useState([]);
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setStaff((await api.get('/owner/staff')).items || []); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    try {
      await api.post('/owner/staff', { email, permissions: picked });
      setEmail(''); setPicked([]); load();
    } catch (e) { setError(e); }
  }

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.h}>Your team</Text>
        {staff.length
          ? staff.map(m => (
              <Row key={m.id} title={m.email} sub={(m.permissions || []).join(', ') || 'no permissions'}
                   right="Edit" onPress={() => {}} />
            ))
          : <Text style={s.p}>Nobody yet. It is just you.</Text>}
      </Card>

      <Guard perm="staff.manage" fallback={null}>
        <Card>
          <Text style={s.h}>Invite someone</Text>
          <Input label="Their email" value={email} onChangeText={setEmail}
                 autoCapitalize="none" keyboardType="email-address" />
          <Text style={s.p}>Tick only what they need. You can change it later.</Text>
          {PERMISSIONS.map(p => (
            <Row key={p} title={p}
                 right={picked.includes(p) ? '✓' : ''}
                 onPress={() => setPicked(v => v.includes(p) ? v.filter(x => x !== p) : v.concat(p))} />
          ))}
          {error ? <Text style={s.err}>{error.message}</Text> : null}
          <Button title="Send invite" onPress={invite} disabled={!email.trim()} />
        </Card>
      </Guard>
    </ScrollView>
  );
}

/* ---------- 4. How the business is doing ---------- */
export function OwnerReportsScreen() {
  const { t } = useT();
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.get('/owner/reports').then(setData).catch(setError); }, []);

  if (!data && !error) return <Loader label={t('loading')} />;
  if (error && !data)  return <ErrorView error={error} />;

  // Three numbers. Not forty. The day you know these three you stop
  // guessing and start running a business.
  return (
    <ScrollView style={s.wrap}>
      <Card>
        <View style={s.line}><Text style={s.k}>Orders this month</Text><Text style={s.v}>{data.orders}</Text></View>
        <View style={s.line}><Text style={s.k}>Money through the app</Text><Text style={s.v}>{money(data.grossMinor)}</Text></View>
        <View style={s.line}><Text style={s.kb}>Your earnings</Text><Text style={s.vb}>{money(data.commissionMinor)}</Text></View>
      </Card>
      <Card>
        <View style={s.line}><Text style={s.k}>Active providers</Text><Text style={s.v}>{data.providers}</Text></View>
        <View style={s.line}><Text style={s.k}>Customers who came back</Text><Text style={s.v}>{data.returning}</Text></View>
      </Card>
      <Text style={s.p}>
        The one to watch is the last line. New customers cost money to find.
        Returning ones are free, and they are the whole business.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  h:  { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text, marginBottom: 6 },
  p:  { color: theme.color.muted, fontSize: theme.font.small, lineHeight: 20, marginTop: 8 },
  k:  { color: theme.color.muted, fontSize: theme.font.body },
  v:  { color: theme.color.text,  fontSize: theme.font.body },
  kb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  vb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  line:{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowBtns: { flexDirection: 'row', marginTop: theme.space.md },
  err: { color: theme.color.danger, marginBottom: theme.space.md },
  ok:  { color: theme.color.success, marginBottom: theme.space.md },
});
`;
}

module.exports = { providerFile, ownerFile };

};

/* ──────── gen-screens.js ──────── */
__mods["gen-screens.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-screens.js — গ্রাহকের নয়টা স্ক্রিন
 *
 * ⚠️ স্ক্রিনের ধরন ঠিক হয় নাম দেখে, শ্রেণি দেখে নয়।
 * ১০০০টা অ্যাপে ২৮৮ রকম স্ক্রিনের নাম আছে, আর নামই সবচেয়ে নির্ভরযোগ্যভাবে
 * বলে দেয় ওখানে কী থাকা উচিত। "Wallet home"-এ টাকার অঙ্ক, "Chat room"-এ
 * কথার বুদবুদ, "Scan QR"-এ ক্যামেরা।
 *
 * ⚠️ প্রতিটা স্ক্রিনে চারটে অবস্থা থাকে, ব্যতিক্রম নেই:
 *     loading → error → empty → data
 * বেশিরভাগ শেখানো প্রকল্পে শুধু শেষেরটা থাকে। কিন্তু নতুন ব্যবহারকারী
 * প্রথমেই খালি পর্দা দেখে, আর দুর্বল নেটে ভুলের পর্দা। ওই দুটোই ঠিক করে
 * সে থাকবে না চলে যাবে।
 */

/* ⚠️ গোটা শব্দ মেলানো হয়, ভেতরের টুকরো নয় — "transaction hi-story"-তে
   "story" মিলে গিয়ে ক্যামেরার পর্দা বসে যাচ্ছিল। শুধু বহুবচনটুকু ছাড়
   দেওয়া হচ্ছে, নাহলে "Settings" আর "Setting"-এ আলাদা ফল আসে। */
const has = (label, ...needles) => {
  const words = String(label).toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
  return needles.some(n => {
    const t = n.toLowerCase();
    if (t.includes(' ')) return String(label).toLowerCase().includes(t);
    return words.some(w => w === t || w === t + 's' || w + 's' === t);
  });
};

/* ⚠️ App.js-ও ঠিক এই নিয়মেই নাম বানায়। দুই জায়গায় দুই নিয়ম হলে
   ফাইল তৈরি হয় এক নামে আর import খোঁজে অন্য নামে — অ্যাপ চালু হওয়ার
   মুহূর্তে ভেঙে পড়ে। "&" কে "And" করা হয়, ফেলে দেওয়া হয় না, নাহলে
   "Profile & Settings" থেকে "ProfileSettings" হয়ে অর্থ হারায়। */
function comp(label) {
  return String(label)
    .replace(/&amp;|&/g, 'And')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
    // ⚠️ JavaScript-এ নাম সংখ্যা দিয়ে শুরু হতে পারে না। "10-min slot"
    // থেকে "10MinSlot" হলে ফাইলটা লেখা হতো কিন্তু চালাতে গিয়ে ভাঙত।
    // ১০০০টা অ্যাপে এমন একটাই আছে, আর সেটাই যথেষ্ট।
    .replace(/^([0-9])/, 'Screen$1') + 'Screen';
}

/* কোন স্ক্রিন কোন ছাঁচে — নাম দেখে */
function kindOf(label) {
  // ক্রমটাই সব — উপরেরটা আগে জেতে। তাই সবচেয়ে নির্দিষ্টগুলো উপরে।
  if (has(label, 'scan', 'qr', 'camera', 'capture')) return 'scan';
  if (has(label, 'checkout', 'payment', 'pay', 'billing', 'invoice')) return 'pay';
  if (has(label, 'chat room', 'conversation', 'message thread', 'dm')) return 'chat';
  if (has(label, 'map', 'track', 'ride', 'trip', 'route', 'nearby', 'navigation')) return 'map';
  if (has(label, 'wallet', 'balance', 'earning', 'summary', 'dashboard', 'stat', 'analytic', 'report')) return 'summary';
  if (has(label, 'setting', 'preference', 'privacy', 'about', 'help', 'support')) return 'settings';
  if (has(label, 'profile', 'account')) return 'settings';
  if (has(label, 'login', 'signin', 'signup', 'register', 'otp', 'pin', 'password', 'verify', 'kyc')) return 'form';
  if (has(label, 'add', 'send', 'request', 'create', 'compose', 'new', 'upload', 'edit')) return 'form';
  if (has(label, 'detail', 'viewer', 'lesson', 'article', 'recipe', 'player')) return 'detail';
  return 'list';
}

/* ---------------------------------------------------------------- */
/* সব স্ক্রিনে এই মাথাটা এক — তাই শেখানোর সময় একবার বুঝলেই যথেষ্ট */
function head(a, label, extraImports) {
  return `// ${comp(label)} — ${label}
//
// Every screen in ${a.name} follows the same four states:
//   loading, error, empty, data.
// Learn it once here and the other eight screens hold no surprises.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { useT } from '../i18n';
import { useAuth } from '../auth';
import { Button, Input, Card, Row, Badge, Loader, Empty, ErrorView, AdSlot } from '../ui';
${extraImports || ''}`;
}

/* ---------------------------------------------------------------- list */
function listScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [refreshing, setRef]  = useState(false);
  const [page, setPage]       = useState(1);
  const [done, setDone]       = useState(false);

  const load = useCallback(async (p = 1, replace = true) => {
    try {
      setError(null);
      // Ask for one page at a time. Loading everything works fine with
      // twenty rows and falls over at twenty thousand. Build it right now,
      // while the list is small and the bug is invisible.
      const r = await api.get('${path}?page=' + p + '&limit=20');
      const rows = r.items || [];
      setItems(prev => (replace ? rows : prev.concat(rows)));
      setDone(rows.length < 20);
      setPage(p);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
      setRef(false);
    }
  }, []);

  useEffect(() => { load(1, true); }, [load]);

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => { setLoading(true); load(1, true); }} />;

  if (!items.length) {
    return (
      <Empty
        title={t('nothingHere')}
        hint="When something arrives it will show up here."
        actionTitle={t('retry')}
        onAction={() => { setLoading(true); load(1, true); }}
      />
    );
  }

  return (
    <View style={s.wrap}>
      <AdSlot where="onList" />
      <FlatList
        data={items}
        keyExtractor={it => String(it.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRef(true); load(1, true); }} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (!done) load(page + 1, false); }}
        renderItem={({ item }) => (
          <Row
            title={item.title}
            sub={item.subtitle}
            right={item.meta}
            onPress={() => navigation.navigate('Detail', { id: item.id })}
          />
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- form */
function formScreen(a, label, path) {
  return `${head(a, label, "import { checkForm } from '../helpers';")}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [form, setForm]   = useState({ title: '', note: '' });
  const [errors, setErr]  = useState({});
  const [busy, setBusy]   = useState(false);
  const [failed, setFail] = useState(null);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    // Clear that field's error the moment they start fixing it. Leaving
    // red text under a box someone is actively correcting feels like nagging.
    if (errors[k]) setErr(e => ({ ...e, [k]: undefined }));
  };

  async function submit() {
    // Check here so the answer is instant. The server checks again,
    // because anything sent from a phone can be faked. Both, always.
    const { errors: found, ok } = checkForm({
      title: { value: form.title, required: true, min: 2 },
    });
    setErr(found);
    if (!ok) return;

    setBusy(true);
    setFail(null);
    try {
      await api.post('${path}', form);
      navigation.goBack();
    } catch (e) {
      setFail(e);
    } finally {
      // finally, not inside try. If it throws and busy stays true, the
      // button is dead forever and the user has to restart the app.
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Input label="${label}" value={form.title}
               onChangeText={v => set('title', v)} error={errors.title} />
        <Input label="Notes" value={form.note} multiline
               onChangeText={v => set('note', v)} hint="Optional" />
        {failed ? <Text style={s.err}>{failed.message}</Text> : null}
        <Button title={t('save')} onPress={submit} busy={busy} />
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- detail */
function detailScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ route, navigation }) {
  const { t } = useT();
  const id = route.params && route.params.id;
  const [item, setItem]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      // The server decides whether this record is yours. Never trust an
      // id that arrived from a phone. Someone will change it by hand.
      setItem(await api.get('${path}/' + id));
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => { setLoading(true); load(); }} />;
  if (!item)   return <Empty title={t('nothingHere')} />;

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.title}>{item.title}</Text>
        {item.status ? <View style={s.badge}><Badge text={item.status} tone="ok" /></View> : null}
        <Text style={s.body}>{item.description}</Text>
      </Card>
      <AdSlot where="onDetail" />
      <Button title={t('continue')} onPress={() => navigation.navigate('Checkout', { id })} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap:  { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  title: { fontSize: theme.font.hero, fontWeight: '800', color: theme.color.text },
  badge: { flexDirection: 'row', marginTop: theme.space.sm },
  body:  { fontSize: theme.font.body, color: theme.color.muted, marginTop: theme.space.md, lineHeight: 22 },
});
`;
}



/* ---------------------------------------------------------------- pay */
function payScreen(a, label, path) {
  return `${head(a, label, "import { money, splitPayment } from '../helpers';")}
export default function ${comp(label)}({ route, navigation }) {
  const { t } = useT();
  const [order, setOrder] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('${path}/' + (route.params && route.params.id))
      .then(setOrder).catch(setError);
  }, [route.params]);

  async function pay() {
    if (busy) return;              // a second tap here charges twice
    setBusy(true); setError(null);
    try {
      // The server calculates the real amount. Never send a price the
      // phone worked out; someone will edit it before it leaves.
      const r = await api.post('/payments/start', { orderId: order.id });
      navigation.replace('PaymentResult', { ref: r.reference });
    } catch (e) { setError(e); setBusy(false); }
  }

  if (!order && !error) return <Loader label={t('loading')} />;
  if (error && !order)  return <ErrorView error={error} onRetry={() => setError(null)} />;

  const split = splitPayment(order.totalMinor);
  return (
    <ScrollView style={s.wrap}>
      <Card>
        <View style={s.line}><Text style={s.k}>Item</Text><Text style={s.v}>{money(order.itemMinor)}</Text></View>
        <View style={s.line}><Text style={s.k}>Fees</Text><Text style={s.v}>{money(order.feeMinor)}</Text></View>
        <View style={s.line}><Text style={s.kb}>{t('total')}</Text><Text style={s.vb}>{money(split.total)}</Text></View>
      </Card>
      <Card>
        <Text style={s.note}>
          Provider receives {money(split.provider)} · platform fee {money(split.platform)}
        </Text>
      </Card>
      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button title={t('pay')} onPress={pay} busy={busy} />
      {/* No AdSlot here, deliberately. An advert beside a Pay button costs
          more in abandoned payments than it earns in a year. */}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  k:  { color: theme.color.muted, fontSize: theme.font.body },
  v:  { color: theme.color.text,  fontSize: theme.font.body },
  kb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  vb: { color: theme.color.text,  fontSize: theme.font.title, fontWeight: '800' },
  note: { color: theme.color.muted, fontSize: theme.font.small, lineHeight: 20 },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- chat */
function chatScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ route }) {
  const { t } = useT();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const id = route.params && route.params.id;

  useEffect(() => {
    let alive = true;
    const tick = () => api.get('${path}/' + id + '/messages')
      .then(r => { if (alive) setMsgs(r.items || []); })
      .catch(e => { if (alive) setError(e); });
    tick();
    // Polling, not sockets. Sockets are better and much harder to get
    // right. Ship this, get users, then switch. A working poll beats a
    // broken socket every single time.
    const timer = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [id]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    // Show it straight away, marked as sending. On a slow connection the
    // user must see their own words, or they type them a second time.
    const temp = { id: 'tmp' + Date.now(), body, mine: true, pending: true };
    setMsgs(m => m.concat(temp));
    try {
      await api.post('${path}/' + id + '/messages', { body });
    } catch (e) {
      setMsgs(m => m.map(x => (x.id === temp.id ? { ...x, failed: true, pending: false } : x)));
    }
  }

  if (error && !msgs.length) return <ErrorView error={error} />;

  return (
    <View style={s.wrap}>
      <FlatList
        data={msgs}
        inverted
        keyExtractor={m => String(m.id)}
        ListEmptyComponent={<Empty title={t('nothingHere')} hint="Say hello." />}
        renderItem={({ item }) => (
          <View style={[s.b, item.mine ? s.out : s.in]}>
            <Text style={item.mine ? s.tOut : s.tIn}>{item.body}</Text>
            {item.pending ? <Text style={s.meta}>sending…</Text> : null}
            {item.failed ? <Text style={s.fail}>not sent · tap to retry</Text> : null}
          </View>
        )}
      />
      <View style={s.bar}>
        <View style={{ flex: 1 }}>
          <Input value={text} onChangeText={setText} placeholder="Message" />
        </View>
        <Button title="Send" onPress={send} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.sm },
  b:   { maxWidth: '80%', padding: 10, borderRadius: theme.radius.md, marginVertical: 4 },
  in:  { alignSelf: 'flex-start', backgroundColor: theme.color.surface },
  out: { alignSelf: 'flex-end',   backgroundColor: theme.color.primary },
  tIn:  { color: theme.color.text },
  tOut: { color: theme.color.onPrimary },
  meta: { color: theme.color.onPrimary, fontSize: 11, marginTop: 2, opacity: 0.8 },
  fail: { color: theme.color.danger, fontSize: 11, marginTop: 2 },
  bar: { flexDirection: 'row', alignItems: 'flex-start' },
});
`;
}

/* ---------------------------------------------------------------- summary */
function summaryScreen(a, label, path) {
  return `${head(a, label, "import { money } from '../helpers';")}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [data, setData]      = useState(null);
  const [error, setError]    = useState(null);
  const [refreshing, setRef] = useState(false);

  const load = useCallback(async () => {
    try { setError(null); setData(await api.get('${path}')); }
    catch (e) { setError(e); } finally { setRef(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data && !error) return <Loader label={t('loading')} />;
  if (error && !data)  return <ErrorView error={error} onRetry={load} />;

  return (
    <ScrollView
      style={s.wrap}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRef(true); load(); }} />}
    >
      <Card>
        <Text style={s.k}>{t('total')}</Text>
        <Text style={s.big}>{money(data.balanceMinor)}</Text>
        {data.pendingMinor ? <Text style={s.k}>{t('pending')} {money(data.pendingMinor)}</Text> : null}
      </Card>
      <AdSlot where="onHome" />
      {(data.recent || []).length
        ? (data.recent || []).map(r => (
            <Row key={r.id} title={r.title} sub={r.when} right={money(r.amountMinor)}
                 onPress={() => navigation.navigate('Detail', { id: r.id })} />
          ))
        : <Empty title={t('nothingHere')} hint="Your activity will appear here." />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  k:   { color: theme.color.muted, fontSize: theme.font.small },
  big: { color: theme.color.text, fontSize: 34, fontWeight: '800', marginVertical: 4 },
});
`;
}

/* ---------------------------------------------------------------- map */
function mapScreen(a, label, path) {
  return `${head(a, label, "import { KEYS } from '../config';")}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [options, setOptions] = useState([]);
  const [picked, setPicked]   = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('${path}').then(r => setOptions(r.items || []))
      .catch(setError).finally(() => setLoading(false));
  }, []);

  // A map needs a key from your map provider. Until it is filled in,
  // show a plain panel instead of a broken grey box. See config.js, KEYS.maps.
  const mapReady = !!KEYS.maps;

  if (loading) return <Loader label={t('loading')} />;
  if (error)   return <ErrorView error={error} onRetry={() => setError(null)} />;

  return (
    <View style={s.wrap}>
      <View style={s.map}>
        <Text style={s.mapText}>
          {mapReady ? 'Map' : 'Add your map key in config.js to show the map here'}
        </Text>
      </View>
      {options.length
        ? options.map(o => (
            <Row key={o.id} title={o.title} sub={o.eta} right={o.price}
                 onPress={() => setPicked(o.id)} />
          ))
        : <Empty title={t('nothingHere')} hint="Nothing available nearby right now." />}
      <Button title={t('continue')} disabled={!picked}
              onPress={() => navigation.navigate('Checkout', { id: picked })} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  map:  { height: 200, borderRadius: theme.radius.md, backgroundColor: theme.color.surface,
          alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.md },
  mapText: { color: theme.color.muted, textAlign: 'center', paddingHorizontal: 20 },
});
`;
}

/* ---------------------------------------------------------------- scan */
function scanScreen(a, label, path) {
  return `${head(a, label)}
export default function ${comp(label)}({ navigation }) {
  const { t } = useT();
  const [manual, setManual] = useState('');
  const [error, setError]   = useState(null);

  // Camera permission is refused far more often than people expect, and a
  // scanner with no fallback is a dead end. Always let them type it in.
  return (
    <View style={s.wrap}>
      <View style={s.frame}><Text style={s.hint}>Point the camera at the code</Text></View>
      <Text style={s.or}>or enter it by hand</Text>
      <Input value={manual} onChangeText={setManual} placeholder="Code" autoCapitalize="characters" />
      {error ? <Text style={s.err}>{error.message}</Text> : null}
      <Button
        title={t('continue')}
        disabled={!manual.trim()}
        onPress={() => api.post('${path}', { code: manual.trim() })
          .then(r => navigation.navigate('Detail', { id: r.id }))
          .catch(setError)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap:  { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  frame: { height: 240, borderRadius: theme.radius.md, borderWidth: 2, borderStyle: 'dashed',
           borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center',
           marginBottom: theme.space.md },
  hint: { color: theme.color.muted },
  or:   { color: theme.color.muted, textAlign: 'center', marginBottom: theme.space.sm },
  err:  { color: theme.color.danger, marginBottom: theme.space.md },
});
`;
}

/* ---------------------------------------------------------------- settings */
function settingsScreen(a, label, path) {
  return `${head(a, label, "import { LANGUAGES } from '../i18n';")}
export default function ${comp(label)}({ navigation }) {
  const { t, lang, setLang } = useT();
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <ScrollView style={s.wrap}>
      <Card>
        <Text style={s.name}>{user ? user.name : ''}</Text>
        <Text style={s.sub}>{user ? user.email : ''}</Text>
        {user ? <View style={s.badge}><Badge text={user.role} /></View> : null}
      </Card>

      {/* Language belongs to the person, not to the app. The owner can run
          this in English while every customer uses their own. */}
      <Card>
        <Row title={t('chooseLanguage')}
             right={(LANGUAGES.find(l => l.code === lang) || {}).native}
             onPress={() => setOpen(o => !o)} />
        {open ? LANGUAGES.map(l => (
          <Row key={l.code} title={l.native} sub={l.label}
               right={l.code === lang ? '✓' : ''}
               onPress={() => { setLang(l.code); setOpen(false); }} />
        )) : null}
      </Card>

      <Card>
        <Row title="Country and region" right="›" onPress={() => navigation.navigate('Region')} />
        <Row title="Privacy" right="›" onPress={() => navigation.navigate('Privacy')} />
        <Row title="Help" right="›" onPress={() => navigation.navigate('Help')} />
      </Card>

      <Button title={t('signOut')} kind="ghost" onPress={signOut} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.bg, padding: theme.space.md },
  name: { fontSize: theme.font.title, fontWeight: '800', color: theme.color.text },
  sub:  { color: theme.color.muted, marginTop: 2 },
  badge:{ flexDirection: 'row', marginTop: theme.space.sm },
});
`;
}

const BUILDERS = {
  list: listScreen, form: formScreen, detail: detailScreen, pay: payScreen,
  chat: chatScreen, summary: summaryScreen, map: mapScreen,
  scan: scanScreen, settings: settingsScreen,
};

function screenCode(a, label, path) {
  return BUILDERS[kindOf(label)](a, label, path);
}

module.exports = { comp, kindOf, screenCode, BUILDERS, has };

};

/* ──────── gen-ui.js ──────── */
__mods["gen-ui.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-ui.js — সব উপাদান এক ফাইলে
 *
 * ⚠️ কেন এক ফাইলে, আলাদা করে নয়
 * Button.js, Input.js, Card.js — এভাবে দশটা ফাইল করলে দর্শক ফোল্ডার খুলে
 * ঘাবড়ে যায়। তাই সব একসাথে। খুঁজতে সহজ, বোঝাতেও সহজ।
 *
 * ⚠️ Empty আর ErrorView কেন আছে
 * বেশিরভাগ শেখানো প্রকল্পে থাকে না, আর সেটাই আসল পার্থক্য। নতুন
 * ব্যবহারকারী প্রথমেই খালি পর্দা দেখে, আর দুর্বল নেটে ভুলের পর্দা দেখে।
 * ওই দুটো পর্দাই ঠিক করে সে থাকবে না চলে যাবে।
 */

function ui(a) {
  return `// ui.js — every reusable piece of ${a.name} lives here.
//
// One file on purpose. Ten tiny files called Button.js, Input.js, Card.js
// look tidy to a senior developer and terrifying to everyone else.

import React from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { theme, shadow } from './theme';
import { ADS, KEYS } from './config';

/* ---------- Button ---------- */
// busy blocks a second tap. Without it, an impatient user on a slow
// connection sends the same payment twice, and you refund it out of your
// own pocket. This one prop has saved me real money.
export function Button({ title, onPress, busy, kind = 'primary', disabled }) {
  const dead = busy || disabled;
  const bg = kind === 'primary' ? theme.color.primary
           : kind === 'danger'  ? theme.color.danger
           : 'transparent';
  const fg = kind === 'ghost' ? theme.color.primary : theme.color.onPrimary;
  return (
    <Pressable
      onPress={dead ? undefined : onPress}
      style={[s.btn, { backgroundColor: bg, opacity: dead ? 0.55 : 1 },
              kind === 'ghost' && s.btnGhost]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!dead, busy: !!busy }}
    >
      {busy
        ? <ActivityIndicator color={fg} />
        : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

/* ---------- Input ---------- */
// The error sits under the field, not in a popup. Popups make people
// forget which box was wrong.
export function Input({ label, error, hint, ...rest }) {
  return (
    <View style={{ marginBottom: theme.space.md }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        style={[s.input, error && { borderColor: theme.color.danger }]}
        placeholderTextColor={theme.color.muted}
        {...rest}
      />
      {error ? <Text style={s.err}>{error}</Text>
             : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/* ---------- Card / Row ---------- */
export function Card({ children, style }) {
  return <View style={[s.card, shadow, style]}>{children}</View>;
}

export function Row({ title, sub, right, onPress }) {
  const Body = (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={s.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right ? <Text style={s.rowRight}>{right}</Text> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{Body}</Pressable> : Body;
}

export function Badge({ text, tone = 'muted' }) {
  const c = tone === 'ok'   ? theme.color.success
          : tone === 'bad'  ? theme.color.danger
          : theme.color.muted;
  return (
    <View style={[s.badge, { borderColor: c }]}>
      <Text style={[s.badgeText, { color: c }]}>{text}</Text>
    </View>
  );
}

/* ---------- the three states everyone forgets ---------- */
export function Loader({ label = 'Loading' }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={theme.color.primary} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

// Say what the user can DO, not just that something is empty.
// "No orders yet" is a dead end. "No orders yet, share your link" is a path.
export function Empty({ title, hint, actionTitle, onAction }) {
  return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>{title}</Text>
      {hint ? <Text style={s.muted}>{hint}</Text> : null}
      {actionTitle
        ? <View style={{ marginTop: theme.space.md, alignSelf: 'stretch' }}>
            <Button title={actionTitle} onPress={onAction} />
          </View>
        : null}
    </View>
  );
}

// Never show the raw technical error. Show what happened and a way out.
export function ErrorView({ error, onRetry }) {
  const offline = error && error.status === 0;
  return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>
        {offline ? 'No connection' : 'Something went wrong'}
      </Text>
      <Text style={s.muted}>
        {offline
          ? 'Check your network and try again. Nothing was lost.'
          : (error && error.message) || 'Please try again.'}
      </Text>
      {onRetry
        ? <View style={{ marginTop: theme.space.md, alignSelf: 'stretch' }}>
            <Button title="Try again" onPress={onRetry} kind="ghost" />
          </View>
        : null}
    </View>
  );
}

/* ---------- ads ----------
   One component, used in a few places, switched off from config.js.
   Never place this on a payment screen. An advert next to a Pay button
   costs you more in abandoned payments than it earns in a year. */
export function AdSlot({ where }) {
  if (!ADS.enabled || !KEYS.ads) return null;
  if (where && ADS[where] === false) return null;
  return (
    <View style={s.ad}>
      <Text style={s.adLabel}>Sponsored</Text>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { paddingVertical: 14, borderRadius: theme.radius.md, alignItems: 'center' },
  btnGhost: { borderWidth: 1, borderColor: theme.color.primary },
  btnText: { fontSize: theme.font.body, fontWeight: '700' },
  label: { fontSize: theme.font.small, color: theme.color.muted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.sm,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: theme.font.body, color: theme.color.text,
  },
  err:  { color: theme.color.danger, fontSize: theme.font.small, marginTop: 6 },
  hint: { color: theme.color.muted,  fontSize: theme.font.small, marginTop: 6 },
  card: {
    backgroundColor: theme.color.bg, borderRadius: theme.radius.md,
    padding: theme.space.md, marginBottom: theme.space.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  rowTitle: { fontSize: theme.font.body, color: theme.color.text, fontWeight: '600' },
  rowSub:   { fontSize: theme.font.small, color: theme.color.muted, marginTop: 2 },
  rowRight: { fontSize: theme.font.small, color: theme.color.muted, marginLeft: 12 },
  badge: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: theme.font.small, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space.xl },
  muted: { color: theme.color.muted, fontSize: theme.font.body, textAlign: 'center', marginTop: 6 },
  emptyTitle: { fontSize: theme.font.title, fontWeight: '700', color: theme.color.text, textAlign: 'center' },
  ad: {
    height: 64, borderRadius: theme.radius.sm, backgroundColor: theme.color.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.space.md,
  },
  adLabel: { fontSize: theme.font.small, color: theme.color.muted },
});
`;
}

module.exports = { ui };

};

/* ──────── gen-auth.js ──────── */
__mods["gen-auth.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-auth.js — কে কী দেখতে পাবে, কে কী করতে পারবে
 *
 * ⚠️ এখানে একটাই নিয়ম সবচেয়ে জরুরি, আর সেটা গাইডেও বড় করে লেখা:
 *
 *     অ্যাপে বোতাম লুকিয়ে রাখা নিরাপত্তা নয়।
 *
 * যে কেউ ফোন থেকে সরাসরি সার্ভারে অনুরোধ পাঠাতে পারে — অ্যাপ না খুলেই।
 * তাই আসল পাহারা সার্ভারে বসে (server.js-এর requireRole ও requirePerm)।
 * অ্যাপের লুকোনোটা শুধু দেখতে ভালো লাগার জন্য, নিরাপত্তার জন্য নয়।
 *
 * আর মালিক চাইলে অনুমতি ভাগ করে দিতে পারেন — যেমন একজনকে শুধু
 * "অর্ডার দেখা", কিন্তু "কমিশন বদলানো" নয়। বড় অ্যাপগুলো ঠিক এভাবেই
 * কর্মী রাখে, আর মালিকের নিজের অ্যাকাউন্ট আলাদা থাকে।
 */

/* ---------------------------------------------------------------- 4 */
function auth(a) {
  return `// auth.js — who is signed in, and what they are allowed to do.
//
// READ THIS BEFORE YOU CHANGE ANYTHING HERE.
//
// Hiding a button in the app is not security. Anyone can send a request
// straight to your server without ever opening the app. The real guard
// lives in server.js. What this file does is decide what to *show*, so
// the app feels right. Those are two different jobs. Keep both.

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setTokens, clearTokens } from './api';

/* ⚠️ তালিকাটা এখানে লেখা নেই — permissions.js থেকে আসে, আর সার্ভারও
   ঠিক ওই ফাইলটাই পড়ে। দুই জায়গায় আলাদা লিখলে একদিন একটা বদলাবে,
   অন্যটা বদলাবে না, আর তখন অ্যাপ বোতাম লুকাবে অথচ সার্ভার কাজটা করতে
   দেবে। পরীক্ষা করলে সব ঠিক দেখাবে — সেটাই সবচেয়ে বিপজ্জনক। */
export { PERMISSIONS, ROLE_DEFAULTS } from './permissions';
import { ROLE_DEFAULTS } from './permissions';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // On start, see if we already have a session saved on the device.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('session');
        if (raw) {
          const s = JSON.parse(raw);
          setTokens(s.accessToken, s.refreshToken);
          const me = await api.get('/me');   // server confirms, not the phone
          setUser(me);
        }
      } catch (e) {
        await AsyncStorage.removeItem('session');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (identifier, password) => {
    const r = await api.post('/auth/login', { identifier, password });
    setTokens(r.accessToken, r.refreshToken);
    await AsyncStorage.setItem('session', JSON.stringify(r));
    setUser(r.user);
    return r.user;
  }, []);

  const signOut = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch (e) {}
    await AsyncStorage.removeItem('session');
    clearTokens();
    setUser(null);
  }, []);

  const value = {
    user, loading, signIn, signOut,
    role: user ? user.role : null,
    // NOTE: convenience only. The server checks this again, every time.
    can: perm => !!user && (user.permissions || []).includes(perm),
    isOwner:    !!user && user.role === 'owner',
    isProvider: !!user && user.role === 'provider',
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/* Wrap any screen that not everyone should see.
   Again: this hides it. It does not protect it. */
export function Guard({ perm, role, children, fallback = null }) {
  const { user, can } = useAuth();
  if (!user) return fallback;
  if (role && user.role !== role) return fallback;
  if (perm && !can(perm)) return fallback;
  return children;
}
`;
}

/* ---------------------------------------------------------------- 5 */
function apiFile(a) {
  return `// api.js — every network call in ${a.name} goes through this file.
//
// One file. Not one per screen. When your server address changes, or you
// add a header, you change it here once instead of hunting through
// twenty screens for the same fetch written twenty slightly different ways.

import { API } from './config';

let accessToken  = null;
let refreshToken = null;
let refreshing   = null;   // so ten screens do not all refresh at once

export function setTokens(a, r) { accessToken = a; refreshToken = r; }
export function clearTokens()   { accessToken = null; refreshToken = null; }

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function raw(path, options = {}, retry = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API.timeoutMs);

  let res;
  try {
    res = await fetch(API.baseUrl + path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    clearTimeout(timer);
    // A network failure is not a bug in your code. Say so plainly, so the
    // user retries instead of assuming the app is broken.
    throw new ApiError(0, 'No connection. Check your network and try again.', null);
  }
  clearTimeout(timer);

  // Access tokens are short lived on purpose. When one expires we quietly
  // swap it for a new one and repeat the call. The user notices nothing.
  if (res.status === 401 && retry && refreshToken) {
    if (!refreshing) {
      refreshing = fetch(API.baseUrl + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) setTokens(d.accessToken, d.refreshToken); return d; })
        .finally(() => { refreshing = null; });
    }
    const got = await refreshing;
    if (got) return raw(path, options, false);
    clearTokens();
    throw new ApiError(401, 'Your session ended. Please sign in again.', null);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Something went wrong', data);
  return data;
}

export const api = {
  get:   (p)    => raw(p),
  post:  (p, b) => raw(p, { method: 'POST',  body: JSON.stringify(b) }),
  patch: (p, b) => raw(p, { method: 'PATCH', body: JSON.stringify(b) }),
  del:   (p)    => raw(p, { method: 'DELETE' }),
};
`;
}

module.exports = { auth, apiFile };

};

/* ──────── gen-palette.js ──────── */
__mods["gen-palette.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-palette.js — প্রতিটা শ্রেণির নিজস্ব রঙের বিন্যাস
 *
 * ⚠️ কেন শ্রেণি ধরে রং, অ্যাপ ধরে নয়
 * টাকার অ্যাপ শান্ত আর গাঢ় হলে মানুষ বিশ্বাস করে; উজ্জ্বল গোলাপি হলে
 * করে না। খাবারের অ্যাপে উষ্ণ কমলা-লাল ক্ষুধা জাগায়। স্বাস্থ্যে সবুজ-নীল
 * শান্ত করে। এগুলো রুচির ব্যাপার নয় — প্রতিটা সেক্টরের বড় অ্যাপগুলো
 * বছরের পর বছর পরীক্ষা করে একই জায়গায় এসে থেমেছে।
 *
 * ⚠️ প্রতিটা বিন্যাসে হালকা আর অন্ধকার — দুই রকমই আছে। ফোনের সেটিংস
 * অনুযায়ী নিজে বদলাবে। রাতে সাদা পর্দা চোখে লাগে, আর মানুষ রাতেই
 * সবচেয়ে বেশি ফোন দেখে।
 *
 * ⚠️ লেখা আর পটভূমির পার্থক্য সব জোড়ায় যাচাই করা — WCAG AA মান।
 * কম আলোয় বা রোদে পড়া যায় না এমন রং সুন্দর হলেও অকেজো।
 */

/* প্রতিটা: [primary, accent, tint] — tint হলো হালকা পটভূমির ছোঁয়া */
const BY_CAT = {
  fin:  { primary: '#0B5FFF', accent: '#00C48C', tint: '#F2F6FF', mood: 'calm, trustworthy, never loud' },
  ecom: { primary: '#FF6B35', accent: '#004E89', tint: '#FFF4EF', mood: 'warm, urgent, easy to scan' },
  food: { primary: '#CB202D', accent: '#FFB800', tint: '#FFF3F3', mood: 'appetite: warm reds and yellows' },
  ride: { primary: '#111418', accent: '#00D179', tint: '#F4F5F7', mood: 'near-black, one bright go colour' },
  trv:  { primary: '#0071C2', accent: '#FFB700', tint: '#F0F7FC', mood: 'open sky blue, gold highlights' },
  hlth: { primary: '#12A594', accent: '#4C6FFF', tint: '#F0FAF8', mood: 'clinical calm, green and blue' },
  lrn:  { primary: '#5A31F4', accent: '#00C48C', tint: '#F5F2FF', mood: 'focused purple, progress green' },
  msg:  { primary: '#0A7CFF', accent: '#25D366', tint: '#F3F8FF', mood: 'clean blue, bubbles carry the colour' },
  soc:  { primary: '#C13584', accent: '#405DE6', tint: '#FFF2F6', mood: 'expressive, gradient friendly' },
  vid:  { primary: '#FF0033', accent: '#111418', tint: '#FFF2F4', mood: 'red on near-black, content first' },
  mus:  { primary: '#1DB954', accent: '#191414', tint: '#F1FBF4', mood: 'dark by default, green accent' },
  news: { primary: '#B31217', accent: '#1A1A1A', tint: '#FFF3F3', mood: 'serious, high contrast, readable' },
  game: { primary: '#7B2FF7', accent: '#00E5FF', tint: '#F6F1FF', mood: 'energetic purple and cyan' },
  date: { primary: '#FD5068', accent: '#FF8A5B', tint: '#FFF3F4', mood: 'warm coral, soft and inviting' },
  prod: { primary: '#2563EB', accent: '#F59E0B', tint: '#F1F5FF', mood: 'plain, quiet, gets out of the way' },
  util: { primary: '#4F46E5', accent: '#10B981', tint: '#F3F3FF', mood: 'neutral and dependable' },
};

const FALLBACK = BY_CAT.util;

/* ---- পার্থক্য মাপা (WCAG) ---- */
function lum(hex) {
  const v = hex.replace('#', '');
  const p = [0, 2, 4].map(i => {
    const c = parseInt(v.substr(i, 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/* পটভূমির উপর সাদা না কালো লেখা — অনুমান নয়, মেপে */
function onColor(bg) {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#111418') ? '#FFFFFF' : '#111418';
}

/* ==================================================================
   রং নিজে থেকে গাঢ় করা
   ------------------------------------------------------------------
   ⚠️ ১০০০ অ্যাপের প্রত্যেকের নিজের রং আছে, আর অনেকগুলোই হালকা —
   হলুদ, হালকা সবুজ, ফিকে নীল। ওই রঙের বোতামে সাদা লেখা রোদে বা কম
   আলোয় পড়াই যায় না।

   তাই রংটা যতক্ষণ না পড়ার মতো হয়, ততক্ষণ একটু একটু করে গাঢ় করা হয়।
   চেহারা প্রায় একই থাকে, কিন্তু লেখা পড়া যায়। সুন্দর অথচ অপাঠ্য রং
   সুন্দর নয়, শুধু অপাঠ্য।
   ================================================================== */
function darken(hex, amount) {
  const v = hex.replace('#', '');
  const out = [0, 2, 4].map(i => {
    const c = Math.round(parseInt(v.substr(i, 2), 16) * (1 - amount));
    return Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
  });
  return '#' + out.join('');
}

function readable(hex) {
  let c = hex;
  for (let step = 0; step < 12; step++) {
    if (Math.max(contrast(c, '#FFFFFF'), contrast(c, '#111418')) >= 4.5) return c;
    c = darken(c, 0.08);
  }
  return c;
}

function paletteFor(a) {
  const p = BY_CAT[a.cat] || FALLBACK;
  // ⚠️ অ্যাপের নিজের রং (apps-list.json-এর accent) থাকলে সেটাই primary,
  // কারণ থাম্বনেইল ওই রঙেই তৈরি। দুটো আলাদা হলে দর্শক থাম্বনেইলে এক রং
  // দেখে অ্যাপে ঢুকে অন্য রং পেত।
  const raw = a.accent && /^#[0-9A-Fa-f]{6}$/.test(a.accent) ? a.accent : p.primary;
  const primary = readable(raw);
  return {
    mood: p.mood,
    light: {
      primary,   onPrimary: onColor(primary),
      accent: p.accent, onAccent: onColor(p.accent),
      bg: '#FFFFFF', surface: p.tint, text: '#111418',
      muted: '#6B7280', border: '#E5E7EB',
      danger: '#DC2626', success: '#16A34A', warning: '#D97706',
    },
    dark: {
      primary,   onPrimary: onColor(primary),
      accent: p.accent, onAccent: onColor(p.accent),
      bg: '#0B0E13', surface: '#161A21', text: '#F3F5F9',
      muted: '#98A2B3', border: '#242A33',
      danger: '#F87171', success: '#4ADE80', warning: '#FBBF24',
    },
  };
}

module.exports = { BY_CAT, paletteFor, contrast, onColor, readable, darken };

};

/* ──────── countries.js ──────── */
__mods["countries.js"] = function (module, exports, require) {
'use strict';
/*
 * countries.js — সেবাদাতার নথি কোন দেশে কী লাগে
 *
 * ⚠️ কেন এই ফাইলটা আলাদা
 * ----------------------
 * প্রথমে ভেবেছিলাম Aadhaar আর PAN বসিয়ে দেব। কিন্তু চ্যানেল সারা
 * পৃথিবীর দর্শকের জন্য — নাইজেরিয়ায় Aadhaar নেই, ব্রাজিলে CPF লাগে,
 * আমেরিকায় SSN। একটা দেশের নথি সবার উপর চাপিয়ে দিলে বাকি দর্শকের
 * কাছে অ্যাপটা অচল হয়ে যেত।
 *
 * তাই অ্যাপ দেশ দেখে নিজেই ঠিক করে কী চাইবে। config.js-এ দেশ বদলালেই
 * পুরো নিবন্ধনের ধাপ বদলে যায় — কোড ছুঁতে হয় না।
 *
 * ⚠️ এগুলো সাধারণ নিয়ম, আইনি পরামর্শ নয়। গাইডে স্পষ্ট করে লেখা আছে
 * যে নিজের দেশের নিয়ম যাচাই করে নিতে হবে।
 */

const COUNTRIES = {
  IN: { name: 'India',        cur: 'INR', sym: '\u20B9', dial: '+91',
        id: ['Aadhaar number', 'PAN card'],
        driving: 'Driving licence', tax: 'GST number (if registered)',
        bank: ['Account number', 'IFSC code'] },
  US: { name: 'United States', cur: 'USD', sym: '$', dial: '+1',
        id: ['Government photo ID', 'SSN (last 4 digits)'],
        driving: "Driver's license", tax: 'EIN or SSN for 1099',
        bank: ['Routing number', 'Account number'] },
  GB: { name: 'United Kingdom', cur: 'GBP', sym: '\u00A3', dial: '+44',
        id: ['Passport or driving licence', 'Proof of address'],
        driving: 'UK driving licence', tax: 'UTR number',
        bank: ['Sort code', 'Account number'] },
  NG: { name: 'Nigeria',       cur: 'NGN', sym: '\u20A6', dial: '+234',
        id: ['NIN slip', 'BVN'],
        driving: 'Driving licence', tax: 'TIN',
        bank: ['Bank name', 'Account number'] },
  BR: { name: 'Brazil',        cur: 'BRL', sym: 'R$', dial: '+55',
        id: ['CPF', 'RG'],
        driving: 'CNH', tax: 'CNPJ (if a company)',
        bank: ['Banco', 'Ag\u00EAncia e conta'] },
  ID: { name: 'Indonesia',     cur: 'IDR', sym: 'Rp', dial: '+62',
        id: ['KTP', 'NPWP'],
        driving: 'SIM', tax: 'NPWP',
        bank: ['Bank name', 'Account number'] },
  PH: { name: 'Philippines',   cur: 'PHP', sym: '\u20B1', dial: '+63',
        id: ['PhilSys ID', 'TIN'],
        driving: "Driver's license", tax: 'TIN',
        bank: ['Bank name', 'Account number'] },
  BD: { name: 'Bangladesh',    cur: 'BDT', sym: '\u09F3', dial: '+880',
        id: ['NID number'],
        driving: 'Driving licence', tax: 'TIN certificate',
        bank: ['Bank name', 'Account number'] },
  PK: { name: 'Pakistan',      cur: 'PKR', sym: 'Rs', dial: '+92',
        id: ['CNIC'],
        driving: 'Driving licence', tax: 'NTN',
        bank: ['Bank name', 'IBAN'] },
  KE: { name: 'Kenya',         cur: 'KES', sym: 'KSh', dial: '+254',
        id: ['National ID', 'KRA PIN'],
        driving: 'Driving licence', tax: 'KRA PIN',
        bank: ['Bank name', 'Account number'] },
  AE: { name: 'UAE',           cur: 'AED', sym: 'AED', dial: '+971',
        id: ['Emirates ID', 'Passport'],
        driving: 'UAE driving licence', tax: 'TRN (if registered)',
        bank: ['Bank name', 'IBAN'] },
  DE: { name: 'Germany',       cur: 'EUR', sym: '\u20AC', dial: '+49',
        id: ['Personalausweis or passport', 'Meldebescheinigung'],
        driving: 'F\u00FChrerschein', tax: 'Steuernummer',
        bank: ['IBAN'] }
};

const DEFAULT_CC = 'IN';

/* কোন শ্রেণিতে সেবাদাতার কী কী নথি লাগে — দেশের নিয়মের উপর বসে */
const EXTRA_BY_CAT = {
  ride: ['Vehicle registration', 'Vehicle insurance', 'Vehicle photo'],
  trv:  ['Property ownership or lease', 'Local trade licence'],
  food: ['Food safety licence', 'Kitchen photos'],
  hlth: ['Professional registration number', 'Qualification certificate'],
  lrn:  ['Qualification certificate', 'Sample lesson'],
  fin:  ['Proof of address', 'Source of funds declaration'],
  ecom: ['Business registration', 'Return policy'],
  prod: ['Business registration'],
  soc:  [], msg: [], vid: [], mus: [], news: [], game: [], date: [], util: []
};

/* ==================================================================
   তিন পক্ষের তিন রকম নথি
   ------------------------------------------------------------------
   ⚠️ একটা ভুল ধারণা আগে ছিল: শুধু সেবাদাতার নথি ভাবা হয়েছিল। কিন্তু
   তিন পক্ষের চাহিদা তিন রকম, আর তিনজনই আলাদা দেশে থাকতে পারেন।

     গ্রাহক   — যত কম চাওয়া যায় তত ভালো। প্রতিটা বাড়তি ঘর মানে কিছু
                লোক ওখানেই ছেড়ে চলে যায়। ফোন নম্বরই সাধারণত যথেষ্ট।
                টাকা বা বয়সের ব্যাপার এলে তখনই পরিচয় চাওয়া হয়, আগে নয়।

     সেবাদাতা — পরিচয় + কাজের কাগজ। কারণ ইনি টাকা নেবেন আর মানুষের
                সাথে সরাসরি মিশবেন। এখানে ঢিলে দেওয়া যায় না।

     মালিক    — সবচেয়ে বেশি। ইনি অন্যের টাকা ধরছেন, তাই ব্যবসার
                নিবন্ধন আর কর সংক্রান্ত কাগজ লাগে। এটা আমার নিয়ম নয়,
                প্রায় সব দেশের আইনের নিয়ম।

   ⚠️ ডেভেলপার আর ব্যবহারকারী আলাদা দেশে থাকতে পারেন — একজন দুবাই
   থেকে অ্যাপ চালাতে পারেন যার গ্রাহক ভারতে। তাই দেশ তিন জায়গায়
   আলাদা করে বাছা যায়, একটায় নয়।
   ================================================================== */

const OWNER_DOCS = {
  IN: ['PAN card of the business', 'GST certificate (if turnover requires it)', 'Cancelled cheque or bank letter'],
  US: ['EIN letter', 'Business formation document', 'Bank account details'],
  GB: ['Company registration number', 'UTR number', 'Business bank account'],
  NG: ['CAC certificate', 'TIN', 'Corporate bank account'],
  BR: ['CNPJ', 'Contrato social', 'Conta bancária empresarial'],
  ID: ['NIB', 'NPWP perusahaan', 'Rekening perusahaan'],
  PH: ['DTI or SEC registration', 'BIR certificate', 'Business bank account'],
  BD: ['Trade licence', 'TIN certificate', 'Company bank account'],
  PK: ['NTN of the business', 'Chamber of commerce registration', 'Business bank account'],
  KE: ['Business registration certificate', 'KRA PIN of the business', 'Business bank account'],
  AE: ['Trade licence', 'TRN', 'Corporate bank account'],
  DE: ['Gewerbeanmeldung', 'Umsatzsteuer-ID', 'Gesch\u00e4ftskonto'],
};

/* গ্রাহকের কাছে কখন কী চাওয়া হবে।
   'always' = নিবন্ধনের সময়। 'onPay' = প্রথমবার টাকা দেওয়ার সময়।
   'onAge'  = বয়স যাচাই লাগে এমন শ্রেণিতে (ওষুধ, বাজি, ডেটিং)। */
const CUSTOMER_DOCS = {
  always: ['Phone number'],
  onPay:  ['Name as on your card or bank account'],
  onAge:  ['Any government photo ID showing date of birth'],
};

const AGE_CHECK_CATS = ['date', 'hlth', 'fin'];

function docsFor(cc, cat) {
  const c = COUNTRIES[cc] || COUNTRIES[DEFAULT_CC];
  const base = c.id.slice();
  if (cat === 'ride') base.push(c.driving);
  const extra = EXTRA_BY_CAT[cat] || [];
  return { country: c, docs: base.concat(extra) };
}

/* একটাই ফাংশন, তিন পক্ষের উত্তর দেয় */
function docsForRole(cc, cat, role) {
  const c = COUNTRIES[cc] || COUNTRIES[DEFAULT_CC];
  if (role === 'provider') return docsFor(cc, cat);
  if (role === 'owner') {
    return { country: c, docs: (OWNER_DOCS[cc] || OWNER_DOCS[DEFAULT_CC]).slice() };
  }
  // গ্রাহক
  const need = CUSTOMER_DOCS.always.slice();
  const later = CUSTOMER_DOCS.onPay.slice();
  if (AGE_CHECK_CATS.includes(cat)) later.push.apply(later, CUSTOMER_DOCS.onAge);
  return { country: c, docs: need, laterDocs: later };
}

module.exports = {
  COUNTRIES, DEFAULT_CC, EXTRA_BY_CAT, OWNER_DOCS, CUSTOMER_DOCS,
  AGE_CHECK_CATS, docsFor, docsForRole,
};

};

/* ──────── gen-core.js ──────── */
__mods["gen-core.js"] = function (module, exports, require) {
'use strict';
/*
 * gen-core.js — ভিত্তির সাতটা ফাইল তৈরি করে
 *
 * ⚠️ config.js সবচেয়ে গুরুত্বপূর্ণ। দর্শকের নিজের সব তথ্য ওই একটা
 * ফাইলেই — key, কমিশন, দেশ, ব্যাংক। বাকি কোডে কোথাও হাতড়াতে হয় না।
 * এটাই কমেন্ট্রির "53-yours-details" ক্লিপে বলা ফাইল।
 */
const { COUNTRIES, docsFor } = require('./countries.js');

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ⚠️ অ্যাপের নামে উদ্ধৃতি চিহ্ন থাকতে পারে — "BYJU'S"-এর ক্লোন যেমন।
   সরাসরি বসালে তৈরি হওয়া কোডের স্ট্রিং ওখানেই ভেঙে যায়। ১০০০টায়
   এমন একটাই আছে, কিন্তু একটাই যথেষ্ট। */
function q(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/* ---------------------------------------------------------------- 1 */
function config(a) {
  const cc = a.country || 'IN';
  const c = COUNTRIES[cc];
  return `// config.js — EVERYTHING YOU NEED TO CHANGE IS IN THIS ONE FILE.
//
// Read this file top to bottom before you launch. Nothing else in the
// project needs editing to make ${a.name} yours.
//
// WARNING: never commit real secret keys to a public repository.
// Put them in your host's environment settings instead. The README
// shows you how, and it takes two minutes.

export const APP = {
  name:        '${q(a.name)}',
  tagline:     '${q(a.cloneOf ? a.cloneOf + ' style, built better for your market' : 'Built for your market')}',
  supportEmail:'support@example.com',   // <- yours
  website:     'https://example.com',   // <- yours
};

// Which country you operate in. This one line changes the documents
// you ask providers for, the currency, and the phone prefix.
// Supported today: ${Object.keys(COUNTRIES).join(', ')}
export const COUNTRY = '${cc}';

export const MONEY = {
  code:   '${c.cur}',
  symbol: '${c.sym}',
  // Your cut of every transaction, as a percentage.
  // Start low. You can raise it once providers trust you.
  commissionPercent: 12,
  // Some platforms also take a small flat fee. 0 disables it.
  flatFee: 0,
  // Money is held this many days before payout, so refunds can settle.
  payoutHoldDays: 3,
};

export const API = {
  baseUrl: 'http://localhost:4000',     // <- your server, once deployed
  timeoutMs: 15000,
};

// Third party keys. Get each one from the provider's dashboard.
// The README explains where to click, for every single one of these.
export const KEYS = {
  payments:  '',   // Stripe / Razorpay / Paystack publishable key
  maps:      '',   // only needed if this app shows a map
  push:      '',   // push notification key
  analytics: '',   // optional
  ads:       '',   // ad network unit id, leave empty to hide all ads
};

// Where ads appear. Set any of these to false to remove that slot.
// Do not put ads on the payment screen. It costs you more than it earns.
export const ADS = {
  enabled:   false,
  onHome:    true,
  onList:    true,
  onDetail:  false,
  onPayment: false,
};

export const ROLES = ['customer', 'provider', 'owner'];
`;
}

/* ---------------------------------------------------------------- 2 */
/* ⚠️ রং আর হাতে লেখা নয় — gen-palette.js থেকে আসে, শ্রেণি ধরে।
   টাকার অ্যাপ শান্ত, খাবারের উষ্ণ, স্বাস্থ্যের ঠান্ডা। আর প্রতিটা জোড়ার
   পার্থক্য মাপা, যাতে রোদে বা কম আলোয় লেখা পড়া যায়। */
function theme(a) {
  const { paletteFor } = require('./gen-palette.js');
  const p = paletteFor(a);
  return `// theme.js — change these values and the whole app changes.
//
// ${p.mood}.
//
// Two colours carry everything. Apps that use six look untrustworthy and
// nobody can say why, but they feel it and they leave.
//
// Light and dark are both here. The app follows the phone's setting,
// because people use phones at night and a white screen at 1am hurts.

import { useColorScheme } from 'react-native';

const light = ${JSON.stringify(p.light, null, 2).replace(/\n/g, '\n')};

const dark = ${JSON.stringify(p.dark, null, 2).replace(/\n/g, '\n')};

export const theme = {
  color: light,
  space:  { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font:   { small: 13, body: 15, title: 18, hero: 26 },
};

/* Use this inside a component to follow the phone's light/dark setting. */
export function useTheme() {
  const scheme = useColorScheme();
  return { ...theme, color: scheme === 'dark' ? dark : light };
}

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};
`;
}

/* ---------------------------------------------------------------- 3 */
function helpers(a) {
  const cc = a.country || 'IN';
  const { country, docs } = docsFor(cc, a.cat || 'util');
  return `// helpers.js — small functions the whole app uses.
// Formatting, validation, and the document rules for your country.

import { MONEY, COUNTRY } from './config';

/* ---------- money ---------- */
// Never store money as a float. Store paise/cents as whole numbers and
// divide only when showing it. Floats lose money, slowly, invisibly.
export function money(minor) {
  const n = Number(minor || 0) / 100;
  return MONEY.symbol + n.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export function splitPayment(totalMinor) {
  const fee = Math.round(totalMinor * (MONEY.commissionPercent / 100)) + MONEY.flatFee;
  return { total: totalMinor, platform: fee, provider: totalMinor - fee };
}

/* ---------- time ---------- */
export function when(iso) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return mins + ' min ago';
  if (mins < 1440) return Math.round(mins / 60) + ' h ago';
  return d.toLocaleDateString();
}

/* ---------- validation ---------- */
// Check on the device so the user gets an answer immediately.
// Then check again on the server, because anything sent from a phone
// can be faked. Both. Always.
export const isEmail = v => /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(v || '').trim());
export const isPhone = v => /^[0-9]{7,15}$/.test(String(v || '').replace(/[^0-9]/g, ''));

export function checkForm(fields) {
  const errors = {};
  Object.keys(fields).forEach(k => {
    const { value, required, type, min } = fields[k];
    const v = String(value == null ? '' : value).trim();
    if (required && !v)                 errors[k] = 'Required';
    else if (v && type === 'email' && !isEmail(v)) errors[k] = 'Not a valid email';
    else if (v && type === 'phone' && !isPhone(v)) errors[k] = 'Not a valid phone number';
    else if (v && min && v.length < min) errors[k] = 'At least ' + min + ' characters';
  });
  return { errors, ok: Object.keys(errors).length === 0 };
}

/* ---------- who has to send what ----------
   These change by country. Do not hard-code one country's documents;
   your users will not all live where you live.
   This is general guidance, not legal advice. Check your local rules. */
export const DOCUMENTS = {
  ${cc}: ${JSON.stringify(docs)},
};

export function requiredDocuments() {
  return DOCUMENTS[COUNTRY] || DOCUMENTS['${cc}'];
}

export const BANK_FIELDS = ${JSON.stringify(country.bank)};
export const DIAL_CODE = '${country.dial}';
`;
}

module.exports = { config, theme, helpers, cap };

};

/* ──────── build-one.js ──────── */
__mods["build-one.js"] = function (module, exports, require) {
'use strict';
/*
 * build-one.js — একটা অ্যাপের সব ফাইল একসাথে
 *
 * make-packages.js এটাকে ডাকবে, gaming.js-ও এটাকেই ডাকবে। তাই ZIP-এ যা
 * যায় আর পর্দায় যা টাইপ হয়, দুটো এক ফাইল থেকে আসে — আলাদা হতেই পারে না।
 */
const core   = require('./gen-core.js');
const auth   = require('./gen-auth.js');
const ui     = require('./gen-ui.js');
const scr    = require('./gen-screens.js');
const roles  = require('./gen-roles.js');
const srv    = require('./gen-server.js');
const setup  = require('./gen-setup.js');
const i18n   = require('./gen-i18n.js');
const guard  = require('./gen-guard.js');
const perms  = require('./gen-perms.js');
const proj   = require('./gen-project.js');
const entry  = require('./gen-entry.js');
const rt     = require('./gen-routes.js');
const { COUNTRIES } = require('./countries.js');
const cats    = require('./gen-cats.js');
const pricing = require('./gen-pricing.js');
const gEN     = require('./gen-guide-en.js');
const gPH     = require('./gen-guide-phone.js');
const gHI     = require('./gen-guide-hi.js');
const aihelp = require('./gen-ai-help.js');

/* ⚠️ apps-list.json-এ কোনো এন্ট্রিতে একটা ঘর না থাকলে আগে পুরো প্রোগ্রাম
   ভেঙে পড়ত। ১০০০টার মধ্যে একটা এন্ট্রিতে ভুল থাকলেই সেদিনের স্ট্রিম
   বন্ধ — তাই এখানে প্রতিটা ঘরের একটা নিরাপদ বিকল্প রাখা হচ্ছে। */
function normalise(a) {
  const x = a || {};
  const name = String(x.name || 'App').trim() || 'App';
  return {
    num:     String(x.num || '0001'),
    name,
    slug:    String(x.slug || name.toLowerCase().replace(/[^a-z0-9]/g, '')) || 'app',
    cloneOf: String(x.cloneOf || ''),
    accent:  /^#[0-9A-Fa-f]{6}$/.test(x.accent || '') ? x.accent : '#4F46E5',
    stack:   String(x.stack || 'React Native + Node'),
    cat:     String(x.cat || 'util'),
    country: String(x.country || 'IN'),
    screens: (Array.isArray(x.screens) && x.screens.length
      ? x.screens
      : ['Login', 'Home', 'Detail', 'Search', 'Create', 'List', 'Profile', 'Settings', 'About']
    ).slice(0, 9).map(s => String(s || 'Screen')),
  };
}

function buildApp(a) {
  const app = normalise(a);
  const files = [];
  const add = (name, code, label) => files.push({ name, code, label });

  /* ---- দর্শক প্রথমে যা দেখবে ---- */
  add('setup.ps1',        setup.setupPs1(app),   'run this on Windows');
  add('setup.sh',         setup.setupSh(app),    'run this on Mac or Linux');
  add('setup-termux.sh',  setup.setupTermux(app),'run this on an Android phone');
  add('package.json',     proj.packageJson(app), 'what the project needs');
  add('.env.example',     proj.envExample(app),  'your keys go here');
  add('.gitignore',       proj.gitignore(),      'what must never be uploaded');

  /* ---- চারটে গাইড ----
     ⚠️ ফোনের গাইড আলাদা ফাইলে, ইচ্ছে করেই। এক ফাইলে রাখলে ফোনওয়ালা
     দর্শক প্রথম দশ পাতা terminal-এর কথা পড়ে ধরে নেন এটা তাঁর জন্য নয়। */
  add('START-HERE.md',           gEN.guideEN(app),       'read this first');
  add('START-HERE-PHONE.md',     gPH.guidePhone(app),    'if you only have a phone');
  add('START-HERE-HI.md',        gHI.guideHI(app),       'हिंदी में');
  add('START-HERE-PHONE-HI.md',  gHI.guidePhoneHI(app),  'सिर्फ़ फ़ोन है? हिंदी में');

  /* ---- অ্যাপ ---- */
  add('App.js',        proj.appJs(app),         'where the app starts');
  add('config.js',     core.config(app),        'everything you change is here');
  add('theme.js',      core.theme(app),         'colours and spacing');
  add('helpers.js',    core.helpers(app),       'money, dates, validation');
  add('permissions.js',perms.permissions(app),  'who may do what');
  add('api.js',        auth.apiFile(app),       'every network call');
  add('auth.js',       auth.auth(app),          'who is signed in');
  add('i18n.js',       i18n.i18n(app),          'languages');
  add('countries.js',  entry.countriesClient(app, COUNTRIES), 'country list');
  add('ui.js',         ui.ui(app),              'buttons, inputs, cards');

  /* ---- পর্দা ---- */
  add('screens/AuthScreen.js',       entry.authScreen(app),       'sign in or join');
  add('screens/RolePickerScreen.js', entry.rolePickerScreen(app), 'country, language, role');
  (app.screens || []).slice(0, 9).forEach((s, i) => {
    add('screens/' + String(i + 1).padStart(2, '0') + '-' + scr.comp(s) + '.js',
        scr.screenCode(app, s, '/items'), s);
  });

  /* ---- তিন পক্ষ ---- */
  add('Provider.js', roles.providerFile(app), 'the side that earns');
  add('Owner.js',    roles.ownerFile(app),    'the side that runs it');

  /* ---- সার্ভার ---- */
  add('server/index.js',   rt.routes(app),   'every route, and the checks on each');
  add('server/db.js',      srv.db(app),      'the shape of your data');
  add('server/guard.js',   guard.guard(app), 'the real access control');
  add('server/storage.js', srv.storage(app), 'uploads');
  add('server/live.js',    srv.live(app),    'live classes and calls');

  /* ---- এই সেক্টরের নিজস্ব ---- */
  // ⚠️ শ্রেণির টেবিলগুলো db.js-এর সাথে জুড়ে দেওয়া হয়, আলাদা ফাইলে নয় —
  // দর্শকের সামনে ফাইল যত কম তত ভালো।
  const dbIdx = files.findIndex(f => f.name === 'server/db.js');
  files[dbIdx].code = files[dbIdx].code.replace(
    'module.exports = { db };',
    'db.exec(`' + cats.schemaFor(app.cat) + pricing.pricingSchema() + '`);\n\nmodule.exports = { db };');

  add('pricing.js', pricing.pricingLogic(app), 'free, paid, donation, or a mix');


  /* ---- মাস্টার ফাইল ----
     ⚠️ সবার শেষে বসাতে হয়, কারণ এতে বাকি সব ফাইলের তালিকা লাগে।
     দর্শক আটকে গেলে এই এক ফাইল যেকোনো AI-কে দিলেই পুরো কাঠামো বোঝা যায় —
     কারো স্মৃতির উপর নির্ভর করতে হয় না। */
  add(aihelp.DEPLOY, aihelp.deploy(app), 'STEP 11-30: online + Play Store');
  add(aihelp.README, aihelp.readme(app), 'open this first');
  aihelp.storeFiles(app).forEach(function (f) { add(f.name, f.code, f.label); });
  add(aihelp.FILE, aihelp.aiHelp(app, files), 'STEP 1-10: stuck? give this to any AI');
  files.forEach(function (f) {
    if (/^START-HERE.*\.md$/.test(f.name)) f.code = aihelp.banner(app) + f.code;
  });
  return files;
}

module.exports = { buildApp, normalise };

};

/* ──────── overlay-app.js  (ঢোকার মুখ) ──────── */
__mods["overlay-app.js"] = function (module, exports, require) {
'use strict';
/*
 * overlay-app2.js — পর্দার লেখা এখন থেকে ZIP-এর আসল ফাইল থেকে আসবে
 *
 * install-overlay.js চালালে এটাই overlay-app.js হয়ে বসবে।
 *
 * gaming.js যা যা চায়, হুবহু তাই দেয় — তাই gaming.js-এ কিচ্ছু বদলাতে হয় না:
 *
 *   appForSet(setNo) → { num, name, tag, accent, lang, cloneOf, screens }
 *   screens[i]       → { file, label, ui, code }      code = লাইনের array
 *   count()          → 1000
 *   uiFor, tagFor    → আগের মতোই আছে
 *
 * পুরনোটার সাথে তফাত :
 *   ৯টা বানানো স্ক্রিন      →  ৪৭টা আসল ফাইল
 *   codegen.js-এর নমুনা লেখা →  code-packages/*.zip-এর হুবহু কোড
 *
 * অর্থাৎ দর্শক পর্দায় যা টাইপ হতে দেখবেন, আর যা ডাউনলোড করবেন — এক জিনিস।
 *
 * ⚠️ কোনো বাইরের লাইব্রেরি লাগে না। ZIP খোলার কাজটা নিচে নিজেই করা,
 *    Node-এর ভেতরের zlib দিয়ে।
 */

var fs   = require('fs');
var path = require('path');
var zlib = require('zlib');

var PKG_DIR = path.join(__dirname, 'code-packages');
var APPS    = require(path.join(__dirname, 'apps-list.json'));

/* ════════════════════════════════════════════════════════════
   ১. ZIP পড়া — সূচিপত্র দেখে প্রতিটা ফাইল বের করে আনে
   ════════════════════════════════════════════════════════════ */
function readZip(file) {
  var buf = fs.readFileSync(file);
  var end = -1;

  /* শেষ থেকে পিছিয়ে সূচিপত্রের ঠিকানা খুঁজি */
  for (var i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP-এর সূচিপত্র পাওয়া গেল না: ' + path.basename(file));

  var total = buf.readUInt16LE(end + 10);
  var pos   = buf.readUInt32LE(end + 16);
  var out   = [];

  for (var n = 0; n < total; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;

    var method  = buf.readUInt16LE(pos + 10);
    var csize   = buf.readUInt32LE(pos + 20);
    var nameLen = buf.readUInt16LE(pos + 28);
    var extLen  = buf.readUInt16LE(pos + 30);
    var comLen  = buf.readUInt16LE(pos + 32);
    var lho     = buf.readUInt32LE(pos + 42);
    var name    = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

    /* আসল তথ্য কোথায় শুরু, সেটা local header দেখে ঠিক করতে হয় */
    var lfn  = buf.readUInt16LE(lho + 26);
    var lex  = buf.readUInt16LE(lho + 28);
    var from = lho + 30 + lfn + lex;
    var raw  = buf.slice(from, from + csize);

    if (!/\/$/.test(name)) {
      var data;
      try {
        data = method === 0 ? raw : zlib.inflateRawSync(raw);
      } catch (e) {
        data = Buffer.from('');
      }
      out.push({ name: name.replace(/\\/g, '/'), text: data.toString('utf8') });
    }
    pos += 46 + nameLen + extLen + comLen;
  }
  return out;
}

/* setNo → ZIP ফাইল। ফোল্ডারটা একবারই পড়ি */
var zipIndex = null;
function zipFor(num) {
  if (!zipIndex) {
    zipIndex = {};
    try {
      fs.readdirSync(PKG_DIR).forEach(function (f) {
        var m = /^set-(\d{1,6})-.*\.zip$/i.exec(f);
        if (m) zipIndex[String(parseInt(m[1], 10))] = path.join(PKG_DIR, f);
      });
    } catch (e) { /* ফোল্ডার নেই — নিচে সামলানো আছে */ }
  }
  return zipIndex[String(parseInt(num, 10))] || null;
}

/* ════════════════════════════════════════════════════════════
   ২. পর্দার ডানপাশের ফোনের ছবি — কোড দেখে বানানো হয়
   ════════════════════════════════════════════════════════════ */

/* 05-SignupKycScreen.js → "Signup Kyc" */
function pretty(file) {
  var b = String(file).split('/').pop().replace(/\.[a-z]+$/i, '');
  b = b.replace(/^\d+[-_]?/, '').replace(/Screen$/i, '');
  b = b.replace(/[-_]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return b.trim() || 'Screen';
}

function grab(re, code, max) {
  var out = [], m, n = 0;
  re.lastIndex = 0;
  while ((m = re.exec(code)) !== null && n < (max || 3)) {
    var v = (m[1] || '').trim();
    if (v && v.length < 32 && out.indexOf(v) < 0) { out.push(v); n++; }
  }
  return out;
}

function uiFromCode(app, file, code) {
  var ui = [{ t: 'status' }];
  var name = String(app.name || 'App');

  ui.push({ t: 'hero', title: name, sub: pretty(file) });

  /* ইনপুটের ঘরগুলো আসল কোডের placeholder থেকেই নেওয়া */
  var phs = grab(/placeholder\s*=\s*["'{`]+\s*([^"'`}]+)/g, code, 3);
  phs.forEach(function (p) { ui.push({ t: 'input', ph: p }); });

  /* বোতামের লেখা */
  var btns = grab(/<(?:Pressable|TouchableOpacity|Button)[^>]*>[\s\S]{0,220}?<Text[^>]*>\s*([^<{]{2,24})\s*</g, code, 1);
  if (!btns.length) btns = grab(/\btitle\s*=\s*["']([^"']{2,24})["']/g, code, 1);

  if (btns.length) ui.push({ t: 'btn', label: btns[0] });
  else if (phs.length) ui.push({ t: 'btn', label: 'Continue' });

  if (!phs.length && !btns.length) {
    ui.push({ t: 'note', text: pretty(file) });
  }
  return ui;
}

/* ════════════════════════════════════════════════════════════
   ৩. ফাইলের ক্রম — দর্শক যেন গল্পের মতো এগোতে দেখেন
   ════════════════════════════════════════════════════════════ */
var ORDER = [
  '00-READ-ME-FIRST.md', 'package.json', 'app.json', 'eas.json',
  'config.js', 'theme.js', 'ui.js', 'i18n.js', 'countries.js',
  'api.js', 'auth.js', 'helpers.js', 'permissions.js', 'pricing.js',
  'App.js'
];

function rank(name) {
  var i = ORDER.indexOf(name);
  if (i >= 0) return 100 + i;
  if (/^screens\//.test(name))  return 300;
  if (/^(Provider|Owner)\.js$/.test(name)) return 400;
  if (/^server\//.test(name))   return 500;
  if (/^assets\//.test(name))   return 600;
  if (/\.(md|sh|ps1)$/i.test(name)) return 700;
  return 250;
}

function sortFiles(list) {
  return list.slice().sort(function (a, b) {
    var ra = rank(a.name), rb = rank(b.name);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

/* ════════════════════════════════════════════════════════════
   ৪. একটা সেট তৈরি — মনে রেখে দেয়, তাই দ্বিতীয়বার সঙ্গে সঙ্গে
   ════════════════════════════════════════════════════════════ */
var cache = new Map();
var CACHE_MAX = 6;

function meta(num) {
  var n = parseInt(num, 10);
  for (var i = 0; i < APPS.length; i++) {
    if (parseInt(APPS[i].num, 10) === n) return APPS[i];
  }
  return null;
}

function build(num) {
  var a = meta(num);
  if (!a) return null;

  var zip = zipFor(num);
  var files;

  if (zip) {
    try { files = readZip(zip); }
    catch (e) { files = null; }
  }

  /* ZIP না থাকলে সরাসরি বানিয়ে নেয় — লাইভ কখনো ফাঁকা যাবে না */
  if (!files || !files.length) {
    try {
      /* সরাসরি নামে ডাকা — তাই make-bundle.js একে খুঁজে পায় ও সাথে বেঁধে নেয় */
      var built = require('./build-one.js').buildApp(a);
      files = built.map(function (f) { return { name: f.name, text: f.code }; });
    } catch (e) {
      return null;
    }
  }

  var screens = sortFiles(files).map(function (f) {
    var lines = String(f.text).replace(/\r\n/g, '\n').split('\n');
    return {
      file : f.name,
      label: pretty(f.name),
      ui   : uiFromCode(a, f.name, f.text),
      code : lines
    };
  });

  return {
    num     : String(a.num || num),
    name    : String(a.name || 'App'),
    tag     : String(a.tag || a.cat || ''),
    accent  : String(a.accent || '#4F46E5'),
    lang    : String(a.lang || a.stack || 'React Native'),
    cloneOf : String(a.cloneOf || ''),
    screens : screens
  };
}

function appForSet(setNo) {
  var key = String(parseInt(setNo, 10));
  if (cache.has(key)) return cache.get(key);

  var app = build(key);
  if (!app) return null;

  cache.set(key, app);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return app;
}

/* ════════════════════════════════════════════════════════════
   ৫. আগের রপ্তানিগুলো — যা যা দিলে সবই সামলায়
   ════════════════════════════════════════════════════════════ */
function uiFor(x, y) {
  if (x && typeof x === 'object' && Array.isArray(x.ui)) return x.ui;
  if (x && typeof x === 'object' && Array.isArray(x.screens) && x.screens[0]) return x.screens[0].ui;

  if ((typeof x === 'number' || /^\d+$/.test(String(x)))) {
    var app = appForSet(x);
    if (!app) return [];
    if (y === undefined || y === null) {
      /* ঘর না বললে আসল একটা স্ক্রিন দেখাই, README নয় */
      var first = app.screens.filter(function (s) { return /^screens\//.test(s.file); })[0] || app.screens[0];
      return first ? first.ui : [];
    }
    if (typeof y === 'number') return app.screens[y] ? app.screens[y].ui : [];
    var hit = app.screens.filter(function (s) { return s.file === y; })[0];
    return hit ? hit.ui : [];
  }
  return [];
}

function tagFor(x) {
  if (x && typeof x === 'object') return String(x.tag || x.cat || '');
  if (typeof x === 'number' || /^\d+$/.test(String(x))) {
    var a = meta(x);
    return a ? String(a.tag || a.cat || '') : '';
  }
  var s = String(x || '').toLowerCase();
  if (/chat|messeng|talk/.test(s))      return 'Messaging App';
  if (/shop|store|market|cart/.test(s)) return 'Shopping App';
  if (/food|delivery|tiffin/.test(s))   return 'Food Delivery App';
  if (/ride|taxi|cab/.test(s))          return 'Ride Booking App';
  if (/learn|course|class|edu/.test(s)) return 'Learning App';
  if (/video|stream|watch/.test(s))     return 'Video App';
  if (/pay|wallet|money/.test(s))       return 'Payments App';
  if (/health|doctor|clinic/.test(s))   return 'Health App';
  return 'Mobile App';
}

function count() { return APPS.length; }

module.exports = { appForSet, uiFor, tagFor, count };

};

module.exports = __req("overlay-app.js");

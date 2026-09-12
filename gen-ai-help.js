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

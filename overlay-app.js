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
      var built = require(path.join(__dirname, 'build-one.js')).buildApp(a);
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

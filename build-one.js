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

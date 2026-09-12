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

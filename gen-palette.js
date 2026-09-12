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

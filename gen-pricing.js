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

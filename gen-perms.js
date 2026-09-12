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

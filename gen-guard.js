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

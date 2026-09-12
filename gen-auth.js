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

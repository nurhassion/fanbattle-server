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

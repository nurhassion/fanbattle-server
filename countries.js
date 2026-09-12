'use strict';
/*
 * countries.js — সেবাদাতার নথি কোন দেশে কী লাগে
 *
 * ⚠️ কেন এই ফাইলটা আলাদা
 * ----------------------
 * প্রথমে ভেবেছিলাম Aadhaar আর PAN বসিয়ে দেব। কিন্তু চ্যানেল সারা
 * পৃথিবীর দর্শকের জন্য — নাইজেরিয়ায় Aadhaar নেই, ব্রাজিলে CPF লাগে,
 * আমেরিকায় SSN। একটা দেশের নথি সবার উপর চাপিয়ে দিলে বাকি দর্শকের
 * কাছে অ্যাপটা অচল হয়ে যেত।
 *
 * তাই অ্যাপ দেশ দেখে নিজেই ঠিক করে কী চাইবে। config.js-এ দেশ বদলালেই
 * পুরো নিবন্ধনের ধাপ বদলে যায় — কোড ছুঁতে হয় না।
 *
 * ⚠️ এগুলো সাধারণ নিয়ম, আইনি পরামর্শ নয়। গাইডে স্পষ্ট করে লেখা আছে
 * যে নিজের দেশের নিয়ম যাচাই করে নিতে হবে।
 */

const COUNTRIES = {
  IN: { name: 'India',        cur: 'INR', sym: '\u20B9', dial: '+91',
        id: ['Aadhaar number', 'PAN card'],
        driving: 'Driving licence', tax: 'GST number (if registered)',
        bank: ['Account number', 'IFSC code'] },
  US: { name: 'United States', cur: 'USD', sym: '$', dial: '+1',
        id: ['Government photo ID', 'SSN (last 4 digits)'],
        driving: "Driver's license", tax: 'EIN or SSN for 1099',
        bank: ['Routing number', 'Account number'] },
  GB: { name: 'United Kingdom', cur: 'GBP', sym: '\u00A3', dial: '+44',
        id: ['Passport or driving licence', 'Proof of address'],
        driving: 'UK driving licence', tax: 'UTR number',
        bank: ['Sort code', 'Account number'] },
  NG: { name: 'Nigeria',       cur: 'NGN', sym: '\u20A6', dial: '+234',
        id: ['NIN slip', 'BVN'],
        driving: 'Driving licence', tax: 'TIN',
        bank: ['Bank name', 'Account number'] },
  BR: { name: 'Brazil',        cur: 'BRL', sym: 'R$', dial: '+55',
        id: ['CPF', 'RG'],
        driving: 'CNH', tax: 'CNPJ (if a company)',
        bank: ['Banco', 'Ag\u00EAncia e conta'] },
  ID: { name: 'Indonesia',     cur: 'IDR', sym: 'Rp', dial: '+62',
        id: ['KTP', 'NPWP'],
        driving: 'SIM', tax: 'NPWP',
        bank: ['Bank name', 'Account number'] },
  PH: { name: 'Philippines',   cur: 'PHP', sym: '\u20B1', dial: '+63',
        id: ['PhilSys ID', 'TIN'],
        driving: "Driver's license", tax: 'TIN',
        bank: ['Bank name', 'Account number'] },
  BD: { name: 'Bangladesh',    cur: 'BDT', sym: '\u09F3', dial: '+880',
        id: ['NID number'],
        driving: 'Driving licence', tax: 'TIN certificate',
        bank: ['Bank name', 'Account number'] },
  PK: { name: 'Pakistan',      cur: 'PKR', sym: 'Rs', dial: '+92',
        id: ['CNIC'],
        driving: 'Driving licence', tax: 'NTN',
        bank: ['Bank name', 'IBAN'] },
  KE: { name: 'Kenya',         cur: 'KES', sym: 'KSh', dial: '+254',
        id: ['National ID', 'KRA PIN'],
        driving: 'Driving licence', tax: 'KRA PIN',
        bank: ['Bank name', 'Account number'] },
  AE: { name: 'UAE',           cur: 'AED', sym: 'AED', dial: '+971',
        id: ['Emirates ID', 'Passport'],
        driving: 'UAE driving licence', tax: 'TRN (if registered)',
        bank: ['Bank name', 'IBAN'] },
  DE: { name: 'Germany',       cur: 'EUR', sym: '\u20AC', dial: '+49',
        id: ['Personalausweis or passport', 'Meldebescheinigung'],
        driving: 'F\u00FChrerschein', tax: 'Steuernummer',
        bank: ['IBAN'] }
};

const DEFAULT_CC = 'IN';

/* কোন শ্রেণিতে সেবাদাতার কী কী নথি লাগে — দেশের নিয়মের উপর বসে */
const EXTRA_BY_CAT = {
  ride: ['Vehicle registration', 'Vehicle insurance', 'Vehicle photo'],
  trv:  ['Property ownership or lease', 'Local trade licence'],
  food: ['Food safety licence', 'Kitchen photos'],
  hlth: ['Professional registration number', 'Qualification certificate'],
  lrn:  ['Qualification certificate', 'Sample lesson'],
  fin:  ['Proof of address', 'Source of funds declaration'],
  ecom: ['Business registration', 'Return policy'],
  prod: ['Business registration'],
  soc:  [], msg: [], vid: [], mus: [], news: [], game: [], date: [], util: []
};

/* ==================================================================
   তিন পক্ষের তিন রকম নথি
   ------------------------------------------------------------------
   ⚠️ একটা ভুল ধারণা আগে ছিল: শুধু সেবাদাতার নথি ভাবা হয়েছিল। কিন্তু
   তিন পক্ষের চাহিদা তিন রকম, আর তিনজনই আলাদা দেশে থাকতে পারেন।

     গ্রাহক   — যত কম চাওয়া যায় তত ভালো। প্রতিটা বাড়তি ঘর মানে কিছু
                লোক ওখানেই ছেড়ে চলে যায়। ফোন নম্বরই সাধারণত যথেষ্ট।
                টাকা বা বয়সের ব্যাপার এলে তখনই পরিচয় চাওয়া হয়, আগে নয়।

     সেবাদাতা — পরিচয় + কাজের কাগজ। কারণ ইনি টাকা নেবেন আর মানুষের
                সাথে সরাসরি মিশবেন। এখানে ঢিলে দেওয়া যায় না।

     মালিক    — সবচেয়ে বেশি। ইনি অন্যের টাকা ধরছেন, তাই ব্যবসার
                নিবন্ধন আর কর সংক্রান্ত কাগজ লাগে। এটা আমার নিয়ম নয়,
                প্রায় সব দেশের আইনের নিয়ম।

   ⚠️ ডেভেলপার আর ব্যবহারকারী আলাদা দেশে থাকতে পারেন — একজন দুবাই
   থেকে অ্যাপ চালাতে পারেন যার গ্রাহক ভারতে। তাই দেশ তিন জায়গায়
   আলাদা করে বাছা যায়, একটায় নয়।
   ================================================================== */

const OWNER_DOCS = {
  IN: ['PAN card of the business', 'GST certificate (if turnover requires it)', 'Cancelled cheque or bank letter'],
  US: ['EIN letter', 'Business formation document', 'Bank account details'],
  GB: ['Company registration number', 'UTR number', 'Business bank account'],
  NG: ['CAC certificate', 'TIN', 'Corporate bank account'],
  BR: ['CNPJ', 'Contrato social', 'Conta bancária empresarial'],
  ID: ['NIB', 'NPWP perusahaan', 'Rekening perusahaan'],
  PH: ['DTI or SEC registration', 'BIR certificate', 'Business bank account'],
  BD: ['Trade licence', 'TIN certificate', 'Company bank account'],
  PK: ['NTN of the business', 'Chamber of commerce registration', 'Business bank account'],
  KE: ['Business registration certificate', 'KRA PIN of the business', 'Business bank account'],
  AE: ['Trade licence', 'TRN', 'Corporate bank account'],
  DE: ['Gewerbeanmeldung', 'Umsatzsteuer-ID', 'Gesch\u00e4ftskonto'],
};

/* গ্রাহকের কাছে কখন কী চাওয়া হবে।
   'always' = নিবন্ধনের সময়। 'onPay' = প্রথমবার টাকা দেওয়ার সময়।
   'onAge'  = বয়স যাচাই লাগে এমন শ্রেণিতে (ওষুধ, বাজি, ডেটিং)। */
const CUSTOMER_DOCS = {
  always: ['Phone number'],
  onPay:  ['Name as on your card or bank account'],
  onAge:  ['Any government photo ID showing date of birth'],
};

const AGE_CHECK_CATS = ['date', 'hlth', 'fin'];

function docsFor(cc, cat) {
  const c = COUNTRIES[cc] || COUNTRIES[DEFAULT_CC];
  const base = c.id.slice();
  if (cat === 'ride') base.push(c.driving);
  const extra = EXTRA_BY_CAT[cat] || [];
  return { country: c, docs: base.concat(extra) };
}

/* একটাই ফাংশন, তিন পক্ষের উত্তর দেয় */
function docsForRole(cc, cat, role) {
  const c = COUNTRIES[cc] || COUNTRIES[DEFAULT_CC];
  if (role === 'provider') return docsFor(cc, cat);
  if (role === 'owner') {
    return { country: c, docs: (OWNER_DOCS[cc] || OWNER_DOCS[DEFAULT_CC]).slice() };
  }
  // গ্রাহক
  const need = CUSTOMER_DOCS.always.slice();
  const later = CUSTOMER_DOCS.onPay.slice();
  if (AGE_CHECK_CATS.includes(cat)) later.push.apply(later, CUSTOMER_DOCS.onAge);
  return { country: c, docs: need, laterDocs: later };
}

module.exports = {
  COUNTRIES, DEFAULT_CC, EXTRA_BY_CAT, OWNER_DOCS, CUSTOMER_DOCS,
  AGE_CHECK_CATS, docsFor, docsForRole,
};

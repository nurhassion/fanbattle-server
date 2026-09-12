'use strict';
/*
 * gen-guide-en.js — ইংরেজি গাইড
 *
 * ⚠️ দুটো আলাদা ফাইল, ইচ্ছে করেই:
 *     START-HERE.md          কম্পিউটার আছে যাঁদের
 *     START-HERE-PHONE.md    শুধু ফোন আছে যাঁদের
 *
 * এক ফাইলে দুটো রাখলে ফোনওয়ালা দর্শক প্রথম দশ পাতা টার্মিনালের কথা পড়ে
 * ধরে নেন এটা তাঁর জন্য নয়। আলাদা ফাইলে প্রথম লাইনেই বোঝা যায় "এটা আমার"।
 *
 * ⚠️ গাইডে দাবি করা হয় না যে এটা Facebook বা Byju's। যা দেওয়া হচ্ছে
 * তা-ই লেখা আছে — একটা চলার মতো ভিত্তি। বাড়িয়ে বললে দর্শক নামিয়ে
 * মিলিয়ে দেখে, আর তখন বাকি সব কথার উপরও বিশ্বাস চলে যায়।
 */

const { COUNTRIES, docsForRole } = require('./countries.js');

function guideEN(a) {
  const c = COUNTRIES[a.country] || COUNTRIES.IN;
  const prov = docsForRole(a.country, a.cat, 'provider');
  const own  = docsForRole(a.country, a.cat, 'owner');
  const what = a.cloneOf ? (a.cloneOf + '-style') : 'a complete';

  return `# ${a.name}

${what} app you can actually run, change, and launch.
Built live on Code Knowledge. Yours to keep, free.

---

## What this is, and what it is not

**It is** a working three-sided app. Customers, providers, and you as the
owner. Sign-ups, documents, payments, commission, payouts, ten languages,
live sessions, uploads, and an access system that actually holds.

**It is not** ${a.cloneOf || 'a giant platform'}. That has hundreds of
engineers and years of work behind it. Nobody hands you that in a zip file.

What you have is the foundation those companies started from, and it is
enough to launch in one neighbourhood and find out whether people want it.
That is the only question that matters at the start.

---

## Run it in five steps

### Windows

1. Unzip this folder somewhere simple, like \`C:\\projects\\${a.slug}\`
2. Open the folder, hold **Shift**, right-click on empty space
3. Choose **Open PowerShell window here** or **Open in Terminal**
4. Type this and press Enter:
   \`\`\`
   powershell -ExecutionPolicy Bypass -File .\\setup.ps1
   \`\`\`
5. Wait. When an address appears, open it.

> That \`-ExecutionPolicy Bypass\` is not a trick. Windows blocks scripts by
> default. This allows this one file, this one time.

### Mac or Linux

1. Unzip the folder
2. Open Terminal
3. Type \`cd \` then drag the folder onto the Terminal window, press Enter
4. Run \`bash setup.sh\`

The setup script checks Node, creates your own private keys, installs
everything, and starts the app. You do not have to understand any of it yet.

---

## When it does not work

**"npm is not recognised"** — Node is not installed. Go to nodejs.org, take
the one marked **LTS**, not the newest. Install it, then **close the terminal
completely and open a new one**. An old terminal does not know Node exists.

**It takes forever, or stops halfway** — usually your antivirus, checking
every one of the thousands of small files being written. Add this project
folder to its exclusions. Just this folder, not the whole drive.

**"Port already in use"** — something else is on that address. Close it, or
change \`PORT\` in your \`.env\` file.

**Something else entirely** — delete \`node_modules\`, delete
\`package-lock.json\`, run \`npm cache clean --force\`, then run setup again.
That fixes a surprising number of things, because a half-downloaded package
looks fine from the outside and is broken inside.

**Still stuck** — read the first two lines of the error slowly, out loud if
you have to. Everything after those two lines is the machine talking to
itself. Nine times out of ten the answer is right there in plain English,
and we skim past it because it looks frightening.

---

## Make it yours

Everything you need to change is in **\`config.js\`**. One file.

\`\`\`js
APP.name          your app's name
COUNTRY           '${a.country}' — changes currency, phone prefix, documents
MONEY.commissionPercent   your cut of each transaction
KEYS              payments, maps, push, ads
ADS               where adverts appear, or false to remove them
\`\`\`

Colours live in **\`theme.js\`**. Change two values, the whole app changes.
Pick one main colour and one accent. Apps using six colours look
untrustworthy and users cannot say why, but they feel it.

### Three things you must change before launching

1. **The name.** Not mine. Check the domain is free and the name is not
   taken in your app store *before* you fall in love with it.
2. **Your secrets.** Setup made them for you in \`.env\`. Never put that
   file on GitHub — \`.gitignore\` already blocks it, leave that alone.
3. **The app identifier.** It has to be unique across the whole app store.
   Change it before you build for release, not after you have announced
   a launch date.

---

## The money

Five ways to charge, and you choose per item:

| Model | What it means |
|---|---|
| Free | No charge |
| Paid | A fixed price |
| Donation | Pay what you want, and zero is a real answer |
| Freemium | The first few are free, the rest are paid |
| Subscription | Monthly or yearly |

You set which of these are allowed. Each provider chooses within that.
You cannot set a provider's price for them — platforms that do lose their
providers to the first competitor who does not.

**Commission on donations defaults to zero.** Taking a cut of a tip feels
like theft to the person who gave it, and they stop giving.

### Before your first real payout

Taking money on behalf of other people is regulated almost everywhere, and
the rules differ by country. Business registration, tax, identity checks,
holding periods.

**Talk to a local accountant before your first payout, not after.** One
afternoon and a small fee. It is the difference between a business and a
problem. Nothing in this guide is legal advice.

---

## Documents, in ${c.name}

Change \`COUNTRY\` in \`config.js\` and all of this changes with it.

**Customers** are asked for: ${docsForRole(a.country, a.cat, 'customer').docs.join(', ')}.
Nothing more, on purpose. Every extra box loses you some people.

**Providers** are asked for: ${prov.docs.join(', ')}.

**You, as the owner**, will need: ${own.docs.join(', ')}.
That is not my rule. Most countries require it of anyone holding other
people's money.

> When someone sends you an identity document, you become responsible for
> it. Store the file, never the number. Never log it. Delete it when the
> account closes.

---

## Who can see what

This matters more than any feature, so read it once properly.

**Hiding a button in the app is not security.** Anyone can send a request
straight to your server without ever opening the app. The real checks live
in \`server/guard.js\`, and they run on every single request.

- A **customer** only ever sees their own records.
- A **provider** only ever sees their own listings and their own money.
  Not another provider's, even though they share a role. That check —
  role *and* ownership — is what stops the leaks you read about.
- **Staff** get exactly what you ticked for them, nothing more.
- **You** can look at anything, because support work needs it. You cannot
  act as somebody else. Placing an order in a customer's name or moving a
  provider's payout is refused even for you.
- **Every time you open somebody else's record it is written down.** A look
  that leaves no trace cannot be told apart from theft.

Never share your own login with staff. Invite them properly and tick only
what they need. When they leave, you remove one account instead of changing
a password everybody knows.

---

## Languages

Ten are set up, and each person picks their own. You might run this in
English while thirty customers each read something different.

To add one: open \`i18n.js\`, copy the \`en\` block, translate the values,
keep the keys identical, add the code to \`LANGUAGES\`. Anything you have
not translated falls back to English, so a half-finished language never
breaks anything.

Arabic and Urdu flip the entire layout, not just the text. That is handled.

---

## Putting it online

Free to start, all of it:

1. **Code** — push to GitHub. Free, unlimited public repositories.
2. **Server** — Render or Railway. Free tiers sleep after inactivity, so the
   first visit takes about thirty seconds to wake. Fine while you are small.
3. **Files** — Cloudflare R2 gives 10 GB and charges nothing for downloads,
   which is the part that usually hurts.
4. **Live sessions** — LiveKit is open source. Their hosted plan is free up
   to roughly fifty hours a month. Beyond that it costs money, and no amount
   of clever code avoids it: sending video to many people needs real machines.

Put your keys in the host's **environment settings**, never in a file you
upload.

---

## Getting your first hundred users

The hardest part, and nothing here is code.

**Go to the supply side first.** On day one your app is empty. If you find
customers first they open an empty app and never come back.

**Do not sell them the app. Sell them the empty seat.** "Your Tuesdays are
quiet. I will bring you people for those Tuesdays, and you pay me nothing
until somebody actually turns up." No fee, no contract, no risk to them.
That is a conversation people say yes to.

**Ten real listings in one neighbourhood beat a thousand across a country.**
Start with one neighbourhood. Not one city.

**Learn three numbers early.** What one customer costs to find, what they
bring in, how many come back. Three numbers on paper. Most people who quit
never knew them; they just felt it was not working.

---

## Files

\`\`\`
setup.ps1 / setup.sh / setup-termux.sh   run one of these
config.js         everything you change
theme.js          colours
pricing.js        free, paid, donation, or a mix
permissions.js    who may do what
i18n.js           languages
screens/          what customers see
Provider.js       what providers see
Owner.js          what you see
server/           the part that decides, not just displays
\`\`\`

---

## If you get stuck

Ask like this and people answer within the hour:

1. What you expected to happen
2. What actually happened
3. The **first five lines** of the error, copied as text, not a photo

About a third of the time you will solve it yourself while writing it down.

---

Free forever. No course, no upsell, no locked download.
If it helped, tell one person who is stuck. That is the whole ask.
`;
}

module.exports = { guideEN };

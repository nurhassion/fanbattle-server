'use strict';
/*
 * gen-guide-phone.js — শুধু ফোন আছে যাঁদের জন্য
 *
 * ⚠️ আলাদা ফাইল কেন — এক ফাইলে রাখলে ফোনওয়ালা দর্শক প্রথম দশ পাতা
 * টার্মিনালের কথা পড়ে ধরে নেন এটা তাঁর জন্য নয়, আর বন্ধ করে দেন।
 * আলাদা ফাইলে প্রথম লাইনেই বোঝা যায় "এটা আমার জন্য"।
 *
 * ⚠️ এখানে কোনো সহানুভূতি নেই, শুধু সত্য পথ। ভারত, নাইজেরিয়া,
 * ইন্দোনেশিয়ায় বহু ভালো ডেভেলপারের প্রথম যন্ত্র ফোনই ছিল।
 */

function guidePhone(a) {
  return `# ${a.name} — on a phone

No laptop? You can still do most of this today, for free.

This is not a lesser version of the guide. It is a different route to the
same place. Plenty of working developers started exactly here.

---

## The honest picture first

**What you can do from a phone:** learn all of it, edit the code, run the
app, see it working on your own screen, show it to a client, and earn
enough to buy a laptop.

**What you cannot do:** build the final installable file for an app store,
or use libraries that need native code compiled.

So the order that actually works for most people is: learn on the phone,
build something real, get paid, then buy the machine. Not the other way
around.

---

## Route 1 — Snack (easiest, nothing to install)

Best place to start. Works in any phone browser.

1. Open **snack.expo.dev** in your browser
2. Install **Expo Go** from your app store
3. In Snack, open the file list on the left and create the files from this
   project, one at a time. Start with \`App.js\`, \`theme.js\`, \`config.js\`
4. Copy the contents from this download and paste them in
5. Press **Run**, then scan the code with Expo Go

The app opens on your own phone. Actually running, not a picture of it.

> Start with three or four screens, not all thirty-five files. See it work,
> then add more. Pasting everything before running anything means that when
> it breaks you have no idea which paste broke it.

---

## Route 2 — StackBlitz (a real terminal in the browser)

For when you want the server running too.

1. Put this project on GitHub from your phone browser — github.com works
   fine on mobile, and you can upload files from the web page
2. Open **stackblitz.com/github/YOUR-NAME/${a.slug}**
3. It installs and starts by itself

You get a working terminal without installing anything. On a small screen
it is cramped, but it is real.

---

## Route 3 — Termux (a real Linux terminal on Android)

Slower and more work, but it is the genuine thing.

1. Install **Termux from F-Droid**, not from the Play Store. The Play Store
   version is old and abandoned and will fail at step 3. This trips up more
   people than anything else on this page.
2. \`pkg update && pkg upgrade\`
3. \`pkg install nodejs git\`
4. Get this project into a folder, then \`cd\` into it
5. \`bash setup-termux.sh\`

Then open **http://localhost:4000** in your phone browser.

> Keep the screen on while packages install, or Android may pause it.
> On a phone it can take fifteen minutes. That is normal, not broken.

---

## Making typing bearable

A touchscreen keyboard is genuinely painful for code. Two things help
enormously, and both are cheap:

- **A small Bluetooth keyboard.** Cheaper than a meal out in most places,
  and it changes everything.
- **A clipboard manager app.** You will paste the same things repeatedly.

If neither is possible, work in short sessions on one file at a time.
Trying to type three hundred lines in one sitting on glass will make you
give up, and the giving up will feel like the code was too hard when it
was only the keyboard.

---

## What breaks on phones, and why

**"Permission denied" in Termux** — Android does not let apps write
anywhere they like. Stay inside Termux's own home folder. Do not try to
work in the Downloads folder.

**Snack says a package is missing** — Snack only allows some libraries.
Anything needing native code will not work there. Use it for the screens
and the layout; run the server elsewhere.

**Everything stops when you switch apps** — Android pauses background
work to save battery. Keep Termux in the foreground while it installs,
and turn off battery optimisation for it in your phone settings.

**It runs out of memory** — close your browser tabs first. On a phone the
browser is usually using more memory than the project.

---

## Everything else

The main guide covers the money, the documents, the permissions, how to
put it online, and how to get your first hundred users. All of that is the
same whether you are on a phone or a laptop.

Read **START-HERE.md** for those parts. Skip the five-steps section at the
top; you have already done it your own way.

---

## One thing worth saying

The gap between phone and laptop is real, but it is a gap in comfort, not
in ability. Nobody who uses your app will know or care what you built it on.

Build the ugly first version on the phone. Ship it. Get one paying user.
Then buy the machine with their money.
`;
}

module.exports = { guidePhone };

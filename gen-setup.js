'use strict';
/*
 * gen-setup.js — দর্শকের জন্য "একবার চালান, সব হয়ে যাবে" ফাইল
 *
 * ⚠️ কেন এটা দরকার
 * -----------------
 * দর্শকের অনেকে জীবনে PowerShell খোলেনি। "npm install চালান" বললে তারা
 * জানে না terminal কোথায়, Node কী, বা কেন কাজ করছে না।
 *
 * তাই ZIP-এ একটা ফাইল থাকবে — Windows-এ setup.ps1, Mac/Linux-এ setup.sh।
 * ডাবল-ক্লিক বা এক লাইন। সেটাই Node আছে কিনা দেখে, নেই বললে কোথা থেকে
 * নামাতে হবে বলে, package বসায়, গোপন চাবি নিজে বানিয়ে দেয়, আর অ্যাপ চালু করে।
 *
 * ⚠️ গোপন চাবির অংশটা সবচেয়ে জরুরি। শত শত মানুষ একই ZIP নামাবে। সবার
 * চাবি এক থাকলে একজনের ভুলে সবাই বিপদে পড়ত। এই স্ক্রিপ্ট প্রতিজনের জন্য
 * আলাদা চাবি বানায়, নিজে থেকেই, কিছু জিজ্ঞেস না করেই।
 */

function setupPs1(a) {
  return `# setup.ps1 — run this once. It does everything.
#
# HOW TO RUN (Windows), if you have never done this before:
#   1. Unzip this folder somewhere simple, like C:\\projects\\${a.slug}
#   2. Open the folder in File Explorer
#   3. Hold Shift, right-click on empty space, choose
#      "Open PowerShell window here" or "Open in Terminal"
#   4. Type this and press Enter:
#         powershell -ExecutionPolicy Bypass -File .\\setup.ps1
#
# That -ExecutionPolicy Bypass part is not a hack. Windows blocks scripts
# by default. This allows just this one file, this one time.

$ErrorActionPreference = 'Stop'
Write-Host ""
Write-Host "  ${a.name} — setup" -ForegroundColor Cyan
Write-Host "  =========================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. Is Node installed? ----------
$node = (Get-Command node -EA 0)
if (-not $node) {
  Write-Host "  Node.js is not installed." -ForegroundColor Yellow
  Write-Host "  Go to https://nodejs.org and download the version marked LTS."
  Write-Host "  Not the newest one. LTS."
  Write-Host "  Install it, then CLOSE this window, open a new one, and run this again."
  Write-Host "  (An old window does not know Node exists yet. That trips up everyone.)"
  Write-Host ""
  Read-Host "  Press Enter to close"
  exit 1
}
$v = (node -v) -replace 'v',''
$major = [int]($v.Split('.')[0])
Write-Host ("  Node " + $v + $(if ($major -lt 18) { "  <- too old, please install the LTS version" } else { "  OK" })) -ForegroundColor $(if ($major -lt 18) { 'Yellow' } else { 'Green' })
if ($major -lt 18) { Read-Host "  Press Enter to close"; exit 1 }

# ---------- 2. Your own secrets ----------
# Every person who downloads this gets different values here.
# If everyone shared the same secret, one person's mistake would put
# everybody else's users at risk. This takes one second and prevents that.
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path $envFile) {
  Write-Host "  .env already exists, leaving it alone" -ForegroundColor DarkGray
} else {
  function New-Secret { -join ((1..48) | % { '{0:x}' -f (Get-Random -Max 16) }) }
  @(
    "# Created by setup.ps1 on $(Get-Date -f 'yyyy-MM-dd').",
    "# NEVER put this file on GitHub. .gitignore already blocks it.",
    "JWT_SECRET=$(New-Secret)",
    "REFRESH_SECRET=$(New-Secret)",
    "DATABASE_URL=file:./data.db",
    "PORT=4000"
  ) | Set-Content $envFile -Encoding UTF8
  Write-Host "  .env created with your own private secrets" -ForegroundColor Green
}

# ---------- 3. Packages ----------
Write-Host ""
Write-Host "  Installing packages. This takes a few minutes the first time." -ForegroundColor Gray
Write-Host "  (If it seems stuck, it is usually your antivirus scanning every"
Write-Host "   new file. Adding this folder to its exclusions makes it fast.)"
Write-Host ""
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  Install failed. The usual cause is the connection dropping." -ForegroundColor Yellow
  Write-Host "  Try this, then run setup again:" -ForegroundColor Gray
  Write-Host "     Remove-Item node_modules -Recurse -Force" -ForegroundColor Gray
  Write-Host "     Remove-Item package-lock.json -Force" -ForegroundColor Gray
  Read-Host "  Press Enter to close"
  exit 1
}

# ---------- 4. Go ----------
Write-Host ""
Write-Host "  Done. Starting ${a.name}..." -ForegroundColor Green
Write-Host "  When an address appears below, open it." -ForegroundColor Gray
Write-Host "  To stop the app later, press Ctrl and C together." -ForegroundColor DarkGray
Write-Host ""
npm start
`;
}

function setupSh(a) {
  return `#!/usr/bin/env bash
# setup.sh — run this once. It does everything.
#
# HOW TO RUN (Mac or Linux), if you have never done this before:
#   1. Unzip this folder
#   2. Open Terminal
#   3. Type  cd   then drag the folder onto the Terminal window, press Enter
#   4. Then run:   bash setup.sh
#
set -e
echo ""
echo "  ${a.name} — setup"
echo "  ========================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  echo "  Go to https://nodejs.org and take the version marked LTS."
  echo "  Install it, close this Terminal, open a new one, run this again."
  exit 1
fi
MAJOR=\$(node -v | sed 's/v//' | cut -d. -f1)
echo "  Node \$(node -v)"
if [ "\$MAJOR" -lt 18 ]; then
  echo "  That version is too old. Please install the LTS version."
  exit 1
fi

if [ -f .env ]; then
  echo "  .env already exists, leaving it alone"
else
  gen() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \\n'; }
  {
    echo "# Created by setup.sh on \$(date +%Y-%m-%d)."
    echo "# NEVER put this file on GitHub. .gitignore already blocks it."
    echo "JWT_SECRET=\$(gen)"
    echo "REFRESH_SECRET=\$(gen)"
    echo "DATABASE_URL=file:./data.db"
    echo "PORT=4000"
  } > .env
  echo "  .env created with your own private secrets"
fi

echo ""
echo "  Installing packages. A few minutes the first time."
npm install --no-audit --no-fund

echo ""
echo "  Done. Starting ${a.name}..."
echo "  When an address appears, open it. Ctrl+C stops the app."
echo ""
npm start
`;
}

/* ==================================================================
   শুধু ফোন যাদের আছে
   ------------------------------------------------------------------
   ⚠️ setup.ps1 বা setup.sh ফোনে চলে না। কিন্তু ফোন থেকেও পুরোটা করা যায় —
   তিনটে সত্যিকারের পথ আছে, আর তিনটেই বিনামূল্যে:

     ১. Expo Snack   — শুধু ব্রাউজার। কোড পেস্ট করে নিজের ফোনে চালানো।
                       কিছু বসাতে হয় না। সবচেয়ে সহজ শুরু।
     ২. StackBlitz   — ব্রাউজারেই পুরো Node চলে। GitHub থেকে সরাসরি খোলে।
     ৩. Termux       — Android-এ আসল terminal। npm সত্যিই চলে, তবে
                       একটু ধৈর্য লাগে। নিচের স্ক্রিপ্ট ওটাই সহজ করে দেয়।

   এটা দয়া নয়। ভারত, নাইজেরিয়া, ইন্দোনেশিয়ায় বহু ভালো ডেভেলপারের
   প্রথম যন্ত্র ফোনই ছিল।
   ================================================================== */
function setupTermux(a) {
  return `#!/data/data/com.termux/files/usr/bin/bash
# setup-termux.sh — for people building on an Android phone.
#
# You do not need a laptop for this. It will be slower, and typing is
# harder, but it genuinely works. People have shipped real apps this way.
#
# HOW TO GET HERE, from nothing:
#   1. Install Termux from F-Droid (NOT the Play Store version, that one
#      is old and abandoned and will fail on step 3).
#   2. Open Termux and run:   pkg update && pkg upgrade
#   3. Then run:              pkg install nodejs git
#   4. Get this project:      unzip it, or  git clone <your repo>
#   5. cd into the folder and run:   bash setup-termux.sh
#
# If any of that felt like too much, use snack.expo.dev in your browser
# instead. No install at all, and you can run the app on this same phone.

set -e
echo ""
echo "  \${0##*/} — ${a.name} on Android"
echo "  ========================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node is not installed in Termux yet."
  echo "  Run this first:   pkg install nodejs"
  exit 1
fi
echo "  Node \$(node -v)"

# Termux needs this or npm tries to write where Android will not allow it
export npm_config_cache="\$PREFIX/tmp/npm-cache"
mkdir -p "\$npm_config_cache"

if [ -f .env ]; then
  echo "  .env already exists, leaving it alone"
else
  gen() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  {
    echo "# Created by setup-termux.sh on \$(date +%Y-%m-%d)."
    echo "# NEVER put this file on GitHub."
    echo "JWT_SECRET=\$(gen)"
    echo "REFRESH_SECRET=\$(gen)"
    echo "DATABASE_URL=file:./data.db"
    echo "PORT=4000"
  } > .env
  echo "  .env created with your own private secrets"
fi

echo ""
echo "  Installing packages. On a phone this takes longer, sometimes"
echo "  fifteen minutes. Keep the screen on, or Android may pause it."
echo ""
npm install --no-audit --no-fund --no-optional

echo ""
echo "  Done. Starting the server..."
echo "  Then open  http://localhost:4000  in this phone's browser."
echo "  Ctrl+C stops it. In Termux, that is the volume-down key and C."
echo ""
npm start
`;
}

/* ফোনের ব্রাউজার থেকেই চালানোর ঠিকানা — ZIP-এর README-তে বসে */
function browserLinks(a) {
  return {
    snack:      'https://snack.expo.dev',
    stackblitz: 'https://stackblitz.com/github/YOUR-NAME/' + a.slug,
    replit:     'https://replit.com/github/YOUR-NAME/' + a.slug,
  };
}

module.exports = { setupPs1, setupSh, setupTermux, browserLinks };

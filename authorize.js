// authorize.js
// এটা একবারই চালাতে হয়: `node src/authorize.js`
// এটা একটা লিংক দেখাবে, সেটা ব্রাউজারে খুলে আপনার YouTube অ্যাকাউন্ট দিয়ে লগইন/অনুমতি দিন,
// তারপর যে কোডটা পাবেন সেটা টার্মিনালে পেস্ট করুন। token.json সেভ হয়ে যাবে।

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/youtube"];
const TOKEN_PATH = path.join(__dirname, "..", "config", "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "..", "config", "credentials.json");

function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error("❌ config/credentials.json পাওয়া যায়নি। আগে Google Cloud Console থেকে ডাউনলোড করুন।");
    process.exit(1);
  }
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = creds.installed || creds.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const authUrl = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES });
  console.log("এই লিংকটা ব্রাউজারে খুলুন এবং অনুমতি দিন:\n", authUrl);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("\nঅনুমতি দেওয়ার পর যে কোডটা পেলেন সেটা এখানে পেস্ট করুন: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("টোকেন নিতে সমস্যা হয়েছে:", err);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
      console.log("✅ token.json সেভ হয়ে গেছে। এখন থেকে আর লগইন লাগবে না।");
    });
  });
}

main();

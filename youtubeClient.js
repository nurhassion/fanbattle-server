// youtubeClient.js
// YouTube Data API v3 দিয়ে broadcast তৈরি, থাম্বনেইল সেট, এবং লাইভে নেওয়া/বন্ধ করা।
//
// *** এটা কাজ করার আগে আপনাকে যা করতে হবে (একবারই) ***
// ১. https://console.cloud.google.com এ গিয়ে একটা প্রজেক্ট বানান
// ২. "YouTube Data API v3" enable করুন
// ৩. OAuth Client ID (Desktop app টাইপ) বানিয়ে credentials.json ডাউনলোড করুন,
//    এই ফোল্ডারে রাখুন: config/credentials.json
// ৪. প্রথমবার `node src/authorize.js` চালিয়ে ব্রাউজারে লগইন করে token নিন
//    (এই স্ক্রিপ্টটা নিচে আলাদা ফাইলে দেওয়া আছে — authorize.js)
// ৫. টোকেন সেভ হবে config/token.json এ, তারপর থেকে আর লগইন লাগবে না

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const TOKEN_PATH = path.join(__dirname, "..", "config", "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "..", "config", "credentials.json");

function getAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      "config/credentials.json পাওয়া যায়নি। Google Cloud Console থেকে OAuth credentials ডাউনলোড করে এখানে রাখুন। (উপরের কমেন্ট দেখুন)"
    );
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      "config/token.json পাওয়া যায়নি। প্রথমে `node src/authorize.js` চালান এবং ব্রাউজারে লগইন করুন।"
    );
  }
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = creds.installed || creds.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
  return oAuth2Client;
}

function ytClient() {
  return google.youtube({ version: "v3", auth: getAuthClient() });
}

async function createAndGoLive(channelCfg, { title, description, thumbnailPath }) {
  const yt = ytClient();

  // ১. Broadcast তৈরি
  const broadcastRes = await yt.liveBroadcasts.insert({
    part: ["snippet", "contentDetails", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        scheduledStartTime: new Date().toISOString(),
      },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: true,
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    },
  });
  const broadcastId = broadcastRes.data.id;

  // ২. Stream তৈরি (RTMP ingest — এই key টা OBS/FFmpeg-এ বসাতে হবে)
  const streamRes = await yt.liveStreams.insert({
    part: ["snippet", "cdn"],
    requestBody: {
      snippet: { title: `${title} — stream` },
      cdn: { frameRate: "30fps", resolution: "1080p", ingestionType: "rtmp" },
    },
  });
  const streamId = streamRes.data.id;
  const ingestUrl = streamRes.data.cdn.ingestionInfo.ingestionAddress;
  const streamKey = streamRes.data.cdn.ingestionInfo.streamName;

  // ৩. Broadcast আর Stream বাইন্ড করা
  await yt.liveBroadcasts.bind({ id: broadcastId, part: ["id"], streamId });

  // ৪. থাম্বনেইল আপলোড (যদি বানানো থাকে)
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    await yt.thumbnails.set({
      videoId: broadcastId,
      media: { body: fs.createReadStream(thumbnailPath) },
    });
  }

  console.log(`✅ Broadcast তৈরি হলো: ${title}`);
  console.log(`   RTMP ingest URL: ${ingestUrl}`);
  console.log(`   Stream key: ${streamKey}`);
  console.log(`   (এই key টা FFmpeg/gameRunner-এর কাছে পাঠানো হবে, যাতে সেই encoder এখানেই push করে)`);

  // এই key/url ffmpeg lanucher কে দিয়ে দিচ্ছি যাতে ওটা ঠিক এখানেই স্ট্রিম করে
  require("./gameRunners").setStreamTarget(channelCfg, ingestUrl, streamKey);

  return broadcastId;
}

async function endBroadcast(channelCfg, broadcastId) {
  const yt = ytClient();
  await yt.liveBroadcasts.transition({
    broadcastStatus: "complete",
    id: broadcastId,
    part: ["status"],
  });
}

module.exports = { createAndGoLive, endBroadcast };

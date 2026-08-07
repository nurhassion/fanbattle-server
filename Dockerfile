# Dockerfile — Render-এ এই Docker ফাইল দিয়ে deploy করলে Xvfb/Chromium/
# FFmpeg/Stockfish/edge-tts আগে থেকেই ইনস্টল করা একটা environment তৈরি হবে,
# যাতে gaming-automation-এর streaming pipeline সরাসরি Render-এই চলতে পারে।
#
# Render-এ ব্যবহার: নতুন Web Service বানানোর সময় "Environment" এ Docker
# বেছে নিন — Render নিজে থেকেই এই Dockerfile খুঁজে বিল্ড করবে (রিপোর
# রুটে এই ফাইলটা থাকলেই যথেষ্ট)।

FROM node:20-bullseye

# সিস্টেম প্যাকেজ — streaming pipeline + chess engine + TTS এর জন্য দরকার
RUN apt-get update && apt-get install -y \
    xvfb \
    ffmpeg \
    chromium \
    stockfish \
    pulseaudio \
    python3-pip \
    && pip3 install edge-tts \
    && rm -rf /var/lib/apt/lists/*

# Render-এর কন্টেইনারে chromium-browser নামে না থেকে "chromium" নামে থাকে —
# stream-launcher.sh যেন দুটো নামই চিনতে পারে, তার জন্য একটা symlink রাখা হলো
RUN ln -sf /usr/bin/chromium /usr/bin/chromium-browser || true

WORKDIR /app

# আগে dependency ফাইলগুলো কপি করে npm install — এতে Docker layer caching
# কাজে লাগে, বারবার পুরো rebuild লাগবে না
COPY package*.json ./
RUN npm install --omit=dev

COPY gaming-automation/package*.json ./gaming-automation/
RUN cd gaming-automation && npm install --omit=dev

# বাকি সব কোড কপি
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]

#!/bin/bash
# stream-launcher.sh <overlay_url> <rtmp_target> <xvfb_display>
# ব্যবহার: gameRunners.js এটা নিজে থেকেই কল করে, ম্যানুয়ালি রান করার দরকার নেই।
#
# এটা করে: একটা ভার্চুয়াল স্ক্রিন (Xvfb) খোলে -> সেখানে Chrome দিয়ে overlay পেজ
# ফুলস্ক্রিন খোলে -> ffmpeg দিয়ে সেই স্ক্রিন রেকর্ড করে সরাসরি YouTube RTMP-তে পাঠায়।

OVERLAY_URL="$1"
RTMP_TARGET="$2"
DISPLAY_NUM="$3"

WIDTH=1080
HEIGHT=1920   # পোর্ট্রেট মোবাইল-স্টাইল স্ট্রিমের জন্য; ল্যান্ডস্কেপ চাইলে 1920x1080 করুন

echo "Xvfb শুরু হচ্ছে ডিসপ্লে $DISPLAY_NUM এ..."
Xvfb "$DISPLAY_NUM" -screen 0 "${WIDTH}x${HEIGHT}x24" &
XVFB_PID=$!
sleep 2

export DISPLAY="$DISPLAY_NUM"

# Chrome-এর অডিও ক্যাপচার করার জন্য একটা ভার্চুয়াল PulseAudio sink বানানো —
# TTS narration (edge-tts) সহ Chrome যা-ই বাজাক, সেটা এখান দিয়ে ffmpeg-এ যাবে।
SINK_NAME="chrome_sink_${DISPLAY_NUM//:/}"
pulseaudio --start 2>/dev/null
pactl load-module module-null-sink sink_name="$SINK_NAME" sink_properties=device.description="ChromeCapture" >/dev/null 2>&1
export PULSE_SINK="$SINK_NAME"

echo "Chrome-এ overlay খোলা হচ্ছে: $OVERLAY_URL"
chromium-browser \
  --kiosk \
  --no-sandbox \
  --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --window-size=${WIDTH},${HEIGHT} \
  --window-position=0,0 \
  "$OVERLAY_URL" &
CHROME_PID=$!
sleep 4

echo "FFmpeg দিয়ে স্ট্রিম শুরু হচ্ছে -> $RTMP_TARGET"
ffmpeg -y \
  -f x11grab -video_size ${WIDTH}x${HEIGHT} -framerate 30 -i "$DISPLAY_NUM" \
  -f pulse -i "${SINK_NAME}.monitor" \
  -c:v libx264 -preset veryfast -b:v 4500k -maxrate 4500k -bufsize 9000k \
  -pix_fmt yuv420p -g 60 \
  -c:a aac -b:a 128k \
  -f flv "$RTMP_TARGET"

pactl unload-module module-null-sink 2>/dev/null

# ffmpeg বন্ধ হলে (SIGTERM পেলে) Chrome আর Xvfb-ও বন্ধ করে দেয়
kill "$CHROME_PID" 2>/dev/null
kill "$XVFB_PID" 2>/dev/null

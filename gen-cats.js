'use strict';
/*
 * gen-cats.js — ১৬টা শ্রেণির নিজস্ব ক্ষমতা
 *
 * ⚠️ ভিত্তি সব শ্রেণিতে এক — তিন পক্ষ, নিরাপত্তা, ভাষা, টাকা, আপলোড।
 * এখানে শুধু ওই সেক্টরের যা ছাড়া অ্যাপটা অচল, সেটুকু।
 *
 * ⚠️ প্রতিটা শ্রেণিতে যে সিদ্ধান্তগুলো নেওয়া হয়েছে, সেগুলো ওই সেক্টরের
 * বড় অ্যাপগুলো বছরের পর বছর পরীক্ষা করে যেখানে থেমেছে সেখান থেকেই।
 * যেমন রাইড অ্যাপে যাত্রা শুরুর OTP — ওটা সুবিধার জন্য নয়, ভুল গাড়িতে
 * উঠে যাওয়া আটকানোর জন্য।
 */

const { lrnSchema, lrnRoutes } = require('./gen-cat-lrn.js');

/* ---------------------------------------------------------------- */
const SCHEMAS = {

msg: `
-- Messaging. Delivery state is the whole product: a message with no tick
-- feels lost, and people resend it, and then apologise for resending.
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, kind TEXT DEFAULT 'direct',  -- direct | group
  title TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread_members (
  thread_id TEXT NOT NULL REFERENCES threads(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT DEFAULT 'member', joined_at TEXT NOT NULL,
  last_read_at TEXT, muted INTEGER DEFAULT 0,
  PRIMARY KEY (thread_id, user_id));
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT, media_key TEXT, kind TEXT DEFAULT 'text',
  reply_to TEXT REFERENCES messages(id),
  -- sent -> delivered -> read. Three states, because two is not enough
  -- to tell "their phone is off" from "they are ignoring you".
  state TEXT DEFAULT 'sent',
  deleted_for_all INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id));
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id, at);`,

soc: `
-- Social. Reporting and blocking are not optional extras. An app where
-- people cannot get away from someone becomes unusable for exactly the
-- people you most want to keep.
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT, media_key TEXT, visibility TEXT DEFAULT 'public',
  like_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL, followee_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id));
CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL, user_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
  user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
  status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  reason TEXT NOT NULL, state TEXT DEFAULT 'open',
  reviewed_by TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, at);`,

ride: `
-- Rides. The start OTP is not a convenience. It is what stops a passenger
-- getting into the wrong car, and what stops a driver claiming a trip
-- that never happened.
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT, make TEXT, model TEXT, plate TEXT NOT NULL,
  seats INTEGER DEFAULT 4, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT REFERENCES users(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  from_label TEXT, from_lat REAL, from_lng REAL,
  to_label TEXT, to_lat REAL, to_lng REAL,
  distance_m INTEGER, duration_s INTEGER,
  fare_minor INTEGER, surge_percent INTEGER DEFAULT 0,
  start_otp TEXT,
  state TEXT DEFAULT 'requested',   -- requested|accepted|arrived|running|done|cancelled
  requested_at TEXT NOT NULL, started_at TEXT, ended_at TEXT);
CREATE TABLE IF NOT EXISTS driver_status (
  provider_id TEXT PRIMARY KEY REFERENCES users(id),
  online INTEGER DEFAULT 0, lat REAL, lng REAL, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_trip_cust ON trips(customer_id, requested_at);`,

food: `
-- Food. Options are where the money and the mistakes both live: a pizza
-- is one item with fifteen decisions attached to it.
CREATE TABLE IF NOT EXISTS outlets (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, address TEXT, lat REAL, lng REAL,
  open_from TEXT, open_to TEXT, prep_minutes INTEGER DEFAULT 20,
  is_open INTEGER DEFAULT 1, rating REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL REFERENCES outlets(id),
  name TEXT NOT NULL, description TEXT, price_minor INTEGER NOT NULL,
  veg INTEGER DEFAULT 0, spicy INTEGER DEFAULT 0,
  photo_key TEXT, available INTEGER DEFAULT 1, position INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_options (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES menu_items(id),
  group_name TEXT NOT NULL, label TEXT NOT NULL,
  extra_minor INTEGER DEFAULT 0, required INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  rider_id TEXT REFERENCES users(id), state TEXT DEFAULT 'pending',
  picked_at TEXT, delivered_at TEXT, drop_otp TEXT);`,

ecom: `
-- Commerce. Stock is held when the cart is paid, not when it is filled.
-- Holding at add-to-cart lets one person empty your shop by browsing.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT, brand TEXT, category TEXT,
  photo_key TEXT, status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  label TEXT NOT NULL, sku TEXT, price_minor INTEGER NOT NULL,
  stock INTEGER DEFAULT 0, reserved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS carts (
  user_id TEXT PRIMARY KEY REFERENCES users(id), updated_at TEXT);
CREATE TABLE IF NOT EXISTS cart_lines (
  cart_user TEXT NOT NULL, variant_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (cart_user, variant_id));
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY, percent_off INTEGER, flat_off_minor INTEGER,
  min_order_minor INTEGER DEFAULT 0, uses_left INTEGER DEFAULT 0,
  expires_at TEXT);
CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  reason TEXT, state TEXT DEFAULT 'requested', at TEXT NOT NULL);`,

trv: `
-- Travel. Two bookings for the same room on the same night is the one
-- failure a booking app cannot recover from, so availability is a table,
-- not a calculation.
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, address TEXT, lat REAL, lng REAL,
  checkin TEXT, checkout TEXT, rating REAL DEFAULT 0, photo_key TEXT);
CREATE TABLE IF NOT EXISTS room_types (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL, sleeps INTEGER DEFAULT 2,
  base_price_minor INTEGER NOT NULL, breakfast_minor INTEGER DEFAULT 0,
  refundable INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS availability (
  room_type_id TEXT NOT NULL, day TEXT NOT NULL,
  rooms_left INTEGER NOT NULL, price_minor INTEGER,
  PRIMARY KEY (room_type_id, day));
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id),
  room_type_id TEXT NOT NULL, guest_id TEXT NOT NULL REFERENCES users(id),
  from_day TEXT NOT NULL, to_day TEXT NOT NULL, guests INTEGER DEFAULT 1,
  meals TEXT, state TEXT DEFAULT 'confirmed', at TEXT NOT NULL);`,

hlth: `
-- Health. Notes are the most sensitive data in this whole project.
-- Only the patient and the clinician who wrote them. Not staff, not the
-- owner. Some doors stay shut for everybody.
CREATE TABLE IF NOT EXISTS practitioners (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  speciality TEXT, registration_no TEXT, years INTEGER,
  fee_minor INTEGER DEFAULT 0, verified INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY, practitioner_id TEXT NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL, minutes INTEGER DEFAULT 15,
  taken INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, slot_id TEXT NOT NULL REFERENCES slots(id),
  patient_id TEXT NOT NULL REFERENCES users(id),
  practitioner_id TEXT NOT NULL REFERENCES users(id),
  mode TEXT DEFAULT 'video', state TEXT DEFAULT 'booked', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clinical_notes (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
  author_id TEXT NOT NULL, body TEXT, prescription TEXT, at TEXT NOT NULL);`,

vid: `
-- Video. A watch record per person is what powers everything else:
-- resume, recommendations, and what a creator actually gets paid for.
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT, video_key TEXT, thumb_key TEXT,
  duration_sec INTEGER DEFAULT 0, visibility TEXT DEFAULT 'public',
  views INTEGER DEFAULT 0, status TEXT DEFAULT 'processing', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS watch (
  user_id TEXT NOT NULL, video_id TEXT NOT NULL,
  seconds INTEGER DEFAULT 0, finished INTEGER DEFAULT 0, at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id));
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL, video_id TEXT NOT NULL, position INTEGER,
  PRIMARY KEY (playlist_id, video_id));`,

mus: `
-- Music. Plays are counted only past a threshold, because that is how
-- royalties work everywhere, and getting it wrong means paying wrongly.
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY, artist_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, album TEXT, audio_key TEXT, art_key TEXT,
  duration_sec INTEGER DEFAULT 0, plays INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plays (
  id TEXT PRIMARY KEY, track_id TEXT NOT NULL, user_id TEXT NOT NULL,
  seconds INTEGER NOT NULL, counted INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS libraries (
  user_id TEXT NOT NULL, track_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id));`,

news: `
-- News. A correction that nobody can see is not a correction. Keep the
-- history and show it; it is the only thing that separates you from a
-- rumour mill.
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id),
  headline TEXT NOT NULL, standfirst TEXT, body TEXT,
  section TEXT, image_key TEXT, status TEXT DEFAULT 'draft',
  published_at TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id),
  note TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL, article_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id));`,

game: `
-- Games. Scores arrive from phones, and phones can lie. Keep every
-- submission, mark the suspicious ones, and never delete the evidence.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT DEFAULT 'solo');
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, user_id TEXT NOT NULL,
  points INTEGER NOT NULL, duration_s INTEGER,
  suspect INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, state TEXT DEFAULT 'open',
  entry_minor INTEGER DEFAULT 0, prize_minor INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER DEFAULT 0,
  PRIMARY KEY (match_id, user_id));
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game_id, points DESC);`,

date: `
-- Dating. Safety features are the product here, not an afterthought.
-- Messaging only after both sides agree, and a report button that is
-- always one tap away.
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  bio TEXT, age INTEGER, gender TEXT, looking_for TEXT,
  city TEXT, lat REAL, lng REAL, photo_keys TEXT,
  verified INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS swipes (
  from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  liked INTEGER NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id));
CREATE TABLE IF NOT EXISTS matches_d (
  id TEXT PRIMARY KEY, a_id TEXT NOT NULL, b_id TEXT NOT NULL,
  thread_id TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS safety_reports (
  id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, about_id TEXT NOT NULL,
  reason TEXT NOT NULL, detail TEXT, state TEXT DEFAULT 'open', at TEXT NOT NULL);`,

prod: `
-- Productivity. Recurring tasks are where these apps are won or lost.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, colour TEXT, archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
  owner_id TEXT NOT NULL, title TEXT NOT NULL, notes TEXT,
  due_at TEXT, repeat_rule TEXT, priority INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0, done_at TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shares (
  task_id TEXT NOT NULL, user_id TEXT NOT NULL, can_edit INTEGER DEFAULT 0,
  PRIMARY KEY (task_id, user_id));
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id, done, due_at);`,

fin: `
-- Money. Never update a balance. Write entries and add them up. When
-- somebody disputes a figure a year from now, the entries are the answer
-- and a balance is only an opinion.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT DEFAULT 'wallet', currency TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL,   -- positive in, negative out
  kind TEXT NOT NULL, ref TEXT, note TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS beneficiaries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT,
  details TEXT, verified INTEGER DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id),
  raised_by TEXT NOT NULL, reason TEXT, state TEXT DEFAULT 'open', at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_entries_acct ON entries(account_id, at);`,

util: `
-- General purpose: things a provider offers, things a customer books.
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT, price_minor INTEGER DEFAULT 0,
  photo_key TEXT, area TEXT, status TEXT DEFAULT 'active', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT REFERENCES listings(id), detail TEXT,
  when_at TEXT, state TEXT DEFAULT 'open', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, author_id TEXT NOT NULL,
  stars INTEGER NOT NULL, body TEXT, at TEXT NOT NULL);`,
};

function schemaFor(cat) {
  if (cat === 'lrn') return lrnSchema();
  return SCHEMAS[cat] || SCHEMAS.util;
}

module.exports = { SCHEMAS, schemaFor, lrnRoutes };

'use strict';
/*
 * gen-cat-lrn.js — শেখানোর অ্যাপে যা ছাড়া চলে না
 *
 * ⚠️ ভিত্তিটা সব শ্রেণিতে এক — তিন পক্ষ, নিরাপত্তা, ভাষা, টাকা।
 * এই ফাইল তার উপরে বসে, শুধু শেখানোর অ্যাপের জন্য।
 *
 * বড় শিক্ষা-অ্যাপগুলো দেখে যা নেওয়া হয়েছে:
 *
 *   কোর্স → অধ্যায় → পাঠ   একধাপে সব পাঠ ফেলে রাখলে ছাত্র হারিয়ে যায়
 *   ব্যাচ                    একই কোর্স, আলাদা সময়ের দল, আলাদা দাম
 *   কোথায় ছিলাম             ফিরে এসে যেন খুঁজতে না হয়
 *   কুইজ ও নম্বর            শুধু দেখা নয়, বুঝেছে কিনা
 *   ডাউট                     প্রশ্ন করার জায়গা, নাহলে ছাত্র আটকে যায়
 *   লাইভ ক্লাস               হাত তুলে প্রশ্ন
 *   সার্টিফিকেট              শেষ করার কারণ
 *
 * ⚠️ সবচেয়ে জরুরি: কোন পাঠ কে খুলতে পারবে। টাকা দেওয়া কোর্সের ভিডিও
 * লিংক একজন কপি করে বাকিদের দিলে পুরো ব্যবসাটাই শেষ। তাই প্রতিবার নতুন,
 * অল্প সময়ের ঠিকানা — আর ভর্তি আছে কিনা সার্ভার প্রতিবার দেখে।
 */

function lrnSchema() {
  return `
-- ---------------------------------------------------------------
-- Learning: courses, chapters, lessons
-- A flat list of lessons works for ten and falls apart at two hundred.
-- Three levels is what every serious course app settles on.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  subject TEXT,
  level TEXT,                              -- beginner | intermediate | advanced
  language TEXT DEFAULT 'en',
  price_minor INTEGER DEFAULT 0,           -- 0 means free
  cover_key TEXT,
  status TEXT DEFAULT 'draft',             -- draft | published | archived
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id),
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'video',               -- video | notes | quiz | live
  video_key TEXT,
  notes_key TEXT,
  duration_sec INTEGER DEFAULT 0,
  position INTEGER NOT NULL,
  -- A few free lessons at the start sell the rest far better than any
  -- description does. Let the teacher choose which ones.
  is_preview INTEGER DEFAULT 0
);

-- A batch is the same course taught to a group starting on a date.
-- Different batch, different price, different teacher, same material.
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  name TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  seats INTEGER DEFAULT 0,                 -- 0 means no limit
  price_minor INTEGER,
  status TEXT DEFAULT 'open'               -- open | full | running | finished
);

-- Where each student got to. Written every few seconds while watching,
-- so closing the app mid-lesson loses nothing.
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  seconds INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,                   -- JSON array
  correct_index INTEGER NOT NULL,
  explanation TEXT,
  marks INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  answers TEXT NOT NULL,                   -- JSON
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  at TEXT NOT NULL
);

-- Questions students ask. A course with no way to ask is a video file.
CREATE TABLE IF NOT EXISTS doubts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT REFERENCES lessons(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  answered_by TEXT REFERENCES users(id),
  answer TEXT,
  status TEXT DEFAULT 'open',              -- open | answered | closed
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id),
  serial TEXT UNIQUE NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ch_course   ON chapters(course_id);
CREATE INDEX IF NOT EXISTS idx_les_chapter ON lessons(chapter_id);
CREATE INDEX IF NOT EXISTS idx_prog_user   ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_doubt_les   ON doubts(lesson_id);
`;
}

function lrnRoutes(a) {
  return `// server/learning.js — courses, lessons, quizzes, doubts.
//
// THE ONE RULE THAT MATTERS HERE:
//
// A paid lesson's video address must never be permanent. If it is, one
// student buys the course, copies the link, and posts it. Everything else
// in this file is ordinary; this part is the business.
//
// So: check enrolment, then hand out an address that dies in ten minutes.

const express = require('express');
const { db } = require('./db');
const { viewUrl, uploadUrl } = require('./storage');
const { authenticate, requireRole, requirePerm, audit } = require('./guard');

const r = express.Router();
const now = () => new Date().toISOString();
const id = () => require('crypto').randomBytes(12).toString('hex');

/* ---------- browsing is open, watching is not ---------- */
r.get('/courses', (req, res) => {
  const rows = db.prepare(
    'SELECT id, title, subject, level, language, price_minor, cover_key FROM courses WHERE status = ? LIMIT 50'
  ).all('published');
  res.json({ items: rows });
});

r.get('/courses/:id', (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND status = ?').get(req.params.id, 'published');
  if (!course) return res.status(404).json({ error: 'Not found' });

  const chapters = db.prepare('SELECT * FROM chapters WHERE course_id = ? ORDER BY position').all(course.id);
  chapters.forEach(c => {
    // Titles are visible to everybody. That is the shop window: a student
    // should see exactly what they would be paying for.
    c.lessons = db.prepare(
      'SELECT id, title, kind, duration_sec, position, is_preview FROM lessons WHERE chapter_id = ? ORDER BY position'
    ).all(c.id);
  });
  res.json({ ...course, chapters });
});

/* ---------- the gate ---------- */
function mayWatch(userId, lesson) {
  if (lesson.is_preview) return true;
  const course = db.prepare(\`
    SELECT c.id, c.price_minor FROM lessons l
    JOIN chapters ch ON ch.id = l.chapter_id
    JOIN courses  c  ON c.id  = ch.course_id
    WHERE l.id = ?\`).get(lesson.id);
  if (!course) return false;
  if (course.price_minor === 0) return true;
  const e = db.prepare(
    'SELECT 1 FROM enrolments WHERE user_id = ? AND item_id = ? AND (expires_at IS NULL OR expires_at > ?)'
  ).get(userId, course.id, now());
  return !!e;
}

r.get('/lessons/:id/play', authenticate, async (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Not found' });

  if (!mayWatch(req.user.id, lesson)) {
    // Say plainly that it needs enrolling, not "forbidden". This person is
    // a customer who has not bought yet, not an intruder.
    return res.status(402).json({ error: 'Enrol in this course to watch this lesson.' });
  }

  // Ten minutes. Long enough to start watching, short enough that a copied
  // link is worthless by the time it is shared.
  const url = await viewUrl(lesson.video_key, 600);
  const p = db.prepare('SELECT seconds FROM progress WHERE user_id = ? AND lesson_id = ?')
              .get(req.user.id, lesson.id);
  res.json({ url, resumeAt: p ? p.seconds : 0, title: lesson.title });
});

/* ---------- where they got to ---------- */
r.post('/lessons/:id/progress', authenticate, (req, res) => {
  const seconds = Math.max(0, parseInt(req.body.seconds, 10) || 0);
  const done = seconds > 0 && req.body.completed ? 1 : 0;
  db.prepare(\`
    INSERT INTO progress (user_id, lesson_id, seconds, completed, updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(user_id, lesson_id) DO UPDATE SET
      seconds = MAX(seconds, excluded.seconds),
      completed = MAX(completed, excluded.completed),
      updated_at = excluded.updated_at\`)
    .run(req.user.id, req.params.id, seconds, done, now());
  res.json({ ok: true });
});

/* ---------- quiz ---------- */
r.get('/lessons/:id/quiz', authenticate, (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson || !mayWatch(req.user.id, lesson)) return res.status(402).json({ error: 'Enrol first' });
  // Send the questions WITHOUT the answers. Obvious once said, and left
  // out often enough that students routinely read answers off the network.
  const qs = db.prepare('SELECT id, prompt, options, marks FROM quiz_questions WHERE lesson_id = ?')
               .all(lesson.id)
               .map(q => ({ ...q, options: JSON.parse(q.options) }));
  res.json({ items: qs });
});

r.post('/lessons/:id/quiz', authenticate, (req, res) => {
  const qs = db.prepare('SELECT * FROM quiz_questions WHERE lesson_id = ?').all(req.params.id);
  const answers = req.body.answers || {};
  let score = 0, total = 0;
  // Marking happens here, never on the phone. A score the phone worked
  // out is a score the phone can change.
  qs.forEach(q => {
    total += q.marks;
    if (Number(answers[q.id]) === q.correct_index) score += q.marks;
  });
  db.prepare('INSERT INTO quiz_attempts (id,user_id,lesson_id,answers,score,total,at) VALUES (?,?,?,?,?,?,?)')
    .run(id(), req.user.id, req.params.id, JSON.stringify(answers), score, total, now());
  // Now the answers can go back, with the reasons. That is the teaching part.
  res.json({
    score, total,
    review: qs.map(q => ({ id: q.id, correct: q.correct_index, explanation: q.explanation })),
  });
});

/* ---------- doubts ---------- */
r.post('/doubts', authenticate, (req, res) => {
  const body = String(req.body.body || '').trim();
  if (body.length < 3) return res.status(400).json({ error: 'Write your question first' });
  db.prepare('INSERT INTO doubts (id,lesson_id,user_id,body,status,at) VALUES (?,?,?,?,?,?)')
    .run(id(), req.body.lessonId || null, req.user.id, body, 'open', now());
  res.json({ ok: true });
});

r.get('/doubts', authenticate, (req, res) => {
  // Students see their own. Teachers see the ones on their courses.
  // Nobody sees everybody's, unless they are staff with permission.
  const rows = req.user.role === 'provider'
    ? db.prepare(\`SELECT d.* FROM doubts d
                  JOIN lessons l  ON l.id = d.lesson_id
                  JOIN chapters c ON c.id = l.chapter_id
                  JOIN courses co ON co.id = c.course_id
                  WHERE co.provider_id = ? ORDER BY d.at DESC LIMIT 100\`).all(req.user.id)
    : db.prepare('SELECT * FROM doubts WHERE user_id = ? ORDER BY at DESC LIMIT 100').all(req.user.id);
  res.json({ items: rows });
});

r.post('/doubts/:id/answer', authenticate, requireRole('provider', 'owner', 'staff'), (req, res) => {
  db.prepare('UPDATE doubts SET answer = ?, answered_by = ?, status = ? WHERE id = ?')
    .run(String(req.body.answer || ''), req.user.id, 'answered', req.params.id);
  res.json({ ok: true });
});

/* ---------- teachers uploading ---------- */
r.post('/lessons/:id/upload-url', authenticate, requireRole('provider'), async (req, res) => {
  const owns = db.prepare(\`
    SELECT co.provider_id FROM lessons l
    JOIN chapters c ON c.id = l.chapter_id
    JOIN courses co ON co.id = c.course_id
    WHERE l.id = ?\`).get(req.params.id);
  // A teacher may only upload into their own lesson. Checking the role
  // alone would let any teacher overwrite any other teacher's video.
  if (!owns || owns.provider_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  const out = await uploadUrl(req.user.id, req.body.filename || 'lesson.mp4', req.body.contentType);
  db.prepare('UPDATE lessons SET video_key = ? WHERE id = ?').run(out.key, req.params.id);
  res.json(out);
});

/* ---------- certificate ---------- */
r.post('/courses/:id/certificate', authenticate, (req, res) => {
  const done = db.prepare(\`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS finished
    FROM lessons l
    JOIN chapters c ON c.id = l.chapter_id
    LEFT JOIN progress p ON p.lesson_id = l.id AND p.user_id = ?
    WHERE c.course_id = ?\`).get(req.user.id, req.params.id);

  if (!done.total || done.finished < done.total) {
    return res.status(400).json({ error: 'Finish every lesson first', finished: done.finished, total: done.total });
  }
  const existing = db.prepare('SELECT * FROM certificates WHERE user_id = ? AND course_id = ?')
                     .get(req.user.id, req.params.id);
  if (existing) return res.json(existing);

  // A serial anyone can check. A certificate nobody can verify is a picture.
  const serial = (req.params.id.slice(0, 4) + '-' + Date.now().toString(36) + '-' +
                  require('crypto').randomBytes(3).toString('hex')).toUpperCase();
  const row = { id: id(), user_id: req.user.id, course_id: req.params.id, serial, issued_at: now() };
  db.prepare('INSERT INTO certificates (id,user_id,course_id,serial,issued_at) VALUES (?,?,?,?,?)')
    .run(row.id, row.user_id, row.course_id, row.serial, row.issued_at);
  res.json(row);
});

// Public, on purpose. An employer must be able to check a serial without
// an account, or the certificate is worth nothing.
r.get('/verify/:serial', (req, res) => {
  const row = db.prepare(\`
    SELECT c.serial, c.issued_at, u.name AS student, co.title AS course
    FROM certificates c
    JOIN users u   ON u.id  = c.user_id
    JOIN courses co ON co.id = c.course_id
    WHERE c.serial = ?\`).get(String(req.params.serial).toUpperCase());
  res.json(row || { error: 'No certificate with that serial' });
});

module.exports = r;
`;
}

module.exports = { lrnSchema, lrnRoutes };

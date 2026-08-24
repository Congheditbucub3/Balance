// routes/nightmode.js
// Simplified server-verified "Healthy Disengagement" check.
//
// The client pings /api/nightmode/ping while the app is open/active. We keep
// only the single most recent ping per student. If a student calls /claim
// during the 6:00-10:00 AM window and their last recorded activity predates
// 10:00 PM the previous night, that means no ping was logged overnight —
// i.e. the app was closed/unused through the night — so we award the pass.
//
// This is a real, extendable heuristic for a prototype; a production version
// would log every session start/end and verify a true gap, rather than
// trusting "no ping" as a proxy for "was offline".
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { awardCredits, todayStr } = require('../lib/credits');

const NIGHT_START_HOUR = 22; // 10 PM
const MORNING_END_HOUR = 10; // claim window closes 10 AM
const MORNING_START_HOUR = 6; // claim window opens 6 AM
const NIGHT_CREDITS = 15;

function ping(body, req, res, ctx) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Not logged in' });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_pings (student_id, last_seen) VALUES (?, ?)
     ON CONFLICT(student_id) DO UPDATE SET last_seen = excluded.last_seen`
  ).run(ctx.session.userId, now);
  sendJson(res, 200, { ok: true });
}

function claim(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });

  const now = new Date();
  const hour = now.getHours();
  if (hour < MORNING_START_HOUR || hour >= MORNING_END_HOUR) {
    return sendJson(res, 200, { credits_granted: 0, reason: 'Claim only available 6:00-10:00 AM' });
  }

  const today = todayStr();
  const already = db
    .prepare('SELECT night_off_passed FROM daily_wellness WHERE student_id = ? AND log_date = ?')
    .get(ctx.session.userId, today);
  if (already && already.night_off_passed) {
    return sendJson(res, 200, { credits_granted: 0, reason: 'Already claimed today' });
  }

  const lastPing = db.prepare('SELECT last_seen FROM activity_pings WHERE student_id = ?').get(ctx.session.userId);
  const cutoff = new Date(now);
  cutoff.setHours(NIGHT_START_HOUR, 0, 0, 0);
  if (cutoff > now) cutoff.setDate(cutoff.getDate() - 1); // previous night's 10PM

  const noOvernightActivity = !lastPing || new Date(lastPing.last_seen) < cutoff;
  if (!noOvernightActivity) {
    return sendJson(res, 200, { credits_granted: 0, reason: 'Activity detected during night window' });
  }

  const granted = awardCredits(ctx.session.userId, NIGHT_CREDITS, 'night_off');
  db.prepare(
    `INSERT INTO daily_wellness (student_id, log_date, step_count, steps_credited, timer_bonus_count, night_off_passed)
     VALUES (?, ?, 0, 0, 0, 1)
     ON CONFLICT(student_id, log_date) DO UPDATE SET night_off_passed = 1`
  ).run(ctx.session.userId, today);

  sendJson(res, 200, { credits_granted: granted });
}

module.exports = { ping, claim };

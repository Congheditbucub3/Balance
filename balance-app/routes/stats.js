// routes/stats.js — all-time progress stats for a student, shown on the dashboard.
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');

function studentProgress(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });
  const studentId = ctx.session.userId;

  const homework = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(on_time) AS onTime
       FROM submissions WHERE student_id = ?`
    )
    .get(studentId);

  const sessions = db
    .prepare(`SELECT COALESCE(SUM(sessions_completed), 0) AS total FROM daily_wellness WHERE student_id = ?`)
    .get(studentId);

  const steps = db
    .prepare(`SELECT COALESCE(SUM(step_count), 0) AS total, COUNT(*) AS daysLogged FROM daily_wellness WHERE student_id = ?`)
    .get(studentId);

  const nightsOff = db
    .prepare(`SELECT COALESCE(SUM(night_off_passed), 0) AS total FROM daily_wellness WHERE student_id = ?`)
    .get(studentId);

  sendJson(res, 200, {
    homeworkCompleted: homework.total || 0,
    homeworkOnTime: homework.onTime || 0,
    focusSessionsCompleted: sessions.total || 0,
    stepsAllTime: steps.total || 0,
    daysLogged: steps.daysLogged || 0,
    nightsLoggedOff: nightsOff.total || 0,
  });
}

module.exports = { studentProgress };

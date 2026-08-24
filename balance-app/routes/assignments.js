// routes/assignments.js
const db = require('../db');
const { sendJson } = require('../lib/http-helpers');
const { awardCredits } = require('../lib/credits');

function createAssignment(body, req, res, ctx) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });
  const { title, due_date, credit_value } = body;
  if (!title || !due_date) return sendJson(res, 400, { error: 'title and due_date are required' });

  const info = db
    .prepare(`INSERT INTO assignments (teacher_id, title, due_date, credit_value, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(ctx.session.userId, title, due_date, Number(credit_value) || 10, new Date().toISOString());

  sendJson(res, 201, { assignment_id: info.lastInsertRowid });
}

function listAssignments(body, req, res, ctx) {
  if (!ctx.session) return sendJson(res, 401, { error: 'Not logged in' });
  const rows = db.prepare('SELECT * FROM assignments ORDER BY due_date ASC').all();

  if (ctx.session.role === 'student') {
    const mySubs = db.prepare('SELECT * FROM submissions WHERE student_id = ?').all(ctx.session.userId);
    const byAssignment = Object.fromEntries(mySubs.map((s) => [s.assignment_id, s]));
    return sendJson(res, 200, {
      assignments: rows.map((a) => ({ ...a, mySubmission: byAssignment[a.assignment_id] || null })),
    });
  }
  sendJson(res, 200, { assignments: rows });
}

function submitAssignment(body, req, res, ctx, params) {
  if (!ctx.session || ctx.session.role !== 'student') return sendJson(res, 403, { error: 'Students only' });
  const assignmentId = Number(params.id);
  const assignment = db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(assignmentId);
  if (!assignment) return sendJson(res, 404, { error: 'Assignment not found' });

  const existing = db
    .prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?')
    .get(assignmentId, ctx.session.userId);
  if (existing) return sendJson(res, 409, { error: 'Already submitted' });

  const now = new Date();
  const onTime = now <= new Date(assignment.due_date) ? 1 : 0;

  db.prepare(
    `INSERT INTO submissions (assignment_id, student_id, status, on_time, submitted_at) VALUES (?, ?, 'submitted', ?, ?)`
  ).run(assignmentId, ctx.session.userId, onTime, now.toISOString());

  const creditValue = onTime ? assignment.credit_value : Math.floor(assignment.credit_value / 2);
  const granted = awardCredits(ctx.session.userId, creditValue, 'homework');

  sendJson(res, 201, { on_time: !!onTime, credits_granted: granted });
}

function listSubmissions(body, req, res, ctx, params) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });
  const assignmentId = Number(params.id);
  const assignment = db.prepare('SELECT * FROM assignments WHERE assignment_id = ?').get(assignmentId);
  if (!assignment || assignment.teacher_id !== ctx.session.userId) {
    return sendJson(res, 404, { error: 'Assignment not found' });
  }
  const rows = db
    .prepare(
      `SELECT s.*, u.name AS student_name, u.email AS student_email
       FROM submissions s JOIN users u ON u.user_id = s.student_id
       WHERE s.assignment_id = ?`
    )
    .all(assignmentId);
  sendJson(res, 200, { submissions: rows });
}

function updateSubmissionStatus(body, req, res, ctx, params) {
  if (!ctx.session || ctx.session.role !== 'teacher') return sendJson(res, 403, { error: 'Teachers only' });
  const submissionId = Number(params.id);
  const { status } = body;
  if (!status) return sendJson(res, 400, { error: 'status is required' });

  const sub = db
    .prepare(
      `SELECT s.*, a.teacher_id FROM submissions s JOIN assignments a ON a.assignment_id = s.assignment_id WHERE s.submission_id = ?`
    )
    .get(submissionId);
  if (!sub || sub.teacher_id !== ctx.session.userId) return sendJson(res, 404, { error: 'Submission not found' });

  db.prepare('UPDATE submissions SET status = ? WHERE submission_id = ?').run(status, submissionId);
  sendJson(res, 200, { ok: true });
}

module.exports = { createAssignment, listAssignments, submitAssignment, listSubmissions, updateSubmissionStatus };

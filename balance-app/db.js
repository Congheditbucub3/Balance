// db.js — schema + connection, built on Node's native `node:sqlite` (no npm install required)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'data', 'balance.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('student','teacher')),
    webauthn_id   TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallets (
    student_id           INTEGER PRIMARY KEY REFERENCES users(user_id),
    balance               INTEGER NOT NULL DEFAULT 0,
    daily_earned_credits  INTEGER NOT NULL DEFAULT 0,
    last_earn_date        TEXT,
    last_monthly_reset    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_wellness (
    log_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id        INTEGER NOT NULL REFERENCES users(user_id),
    log_date          TEXT NOT NULL,
    step_count         INTEGER NOT NULL DEFAULT 0,
    steps_credited      INTEGER NOT NULL DEFAULT 0,
    timer_bonus_count   INTEGER NOT NULL DEFAULT 0,
    night_off_passed   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(student_id, log_date)
  );

  CREATE TABLE IF NOT EXISTS assignments (
    assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id     INTEGER NOT NULL REFERENCES users(user_id),
    title          TEXT NOT NULL,
    due_date       TEXT NOT NULL,
    credit_value   INTEGER NOT NULL DEFAULT 10,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submissions (
    submission_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id   INTEGER NOT NULL REFERENCES assignments(assignment_id),
    student_id       INTEGER NOT NULL REFERENCES users(user_id),
    status           TEXT NOT NULL DEFAULT 'submitted',
    on_time           INTEGER NOT NULL DEFAULT 1,
    submitted_at      TEXT NOT NULL,
    UNIQUE(assignment_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS activity_pings (
    student_id  INTEGER PRIMARY KEY REFERENCES users(user_id),
    last_seen    TEXT NOT NULL
  );
`);

// --- Lightweight migrations -------------------------------------------
// CREATE TABLE IF NOT EXISTS won't add new columns to a table that already
// exists on disk (e.g. someone's existing data/balance.db from before this
// column existed). This adds any column that's missing without touching
// existing rows or requiring the user to delete their database.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Total valid (>=15 min) focus sessions completed, tracked separately from
// timer_bonus_count (which stops incrementing once the daily 3-bonus cap is
// hit) — this one keeps counting every real session, capped or not, so
// students can see their total study effort, not just their credited days.
ensureColumn('daily_wellness', 'sessions_completed', 'INTEGER NOT NULL DEFAULT 0');

module.exports = db;


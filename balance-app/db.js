// db.js — schema + connection, built on Node's native `node:sqlite` (no npm install required)
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'balance.db');

// SQLite will NOT create a missing parent directory for you — it just
// throws "unable to open database file". The data/ folder is normally
// present via data/.gitkeep, but that's a fragile thing to depend on (lost
// in some zip/unzip round-trips, some GitHub upload flows, etc.), so this
// makes the app self-heal regardless of how it got deployed.
fs.mkdirSync(DATA_DIR, { recursive: true });

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

  CREATE TABLE IF NOT EXISTS classes (
    class_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS purchases (
    purchase_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    INTEGER NOT NULL REFERENCES users(user_id),
    item_id        TEXT NOT NULL,
    item_name      TEXT NOT NULL,
    item_cost      INTEGER NOT NULL,
    purchased_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS class_monthly_credits (
    class_id       INTEGER NOT NULL REFERENCES classes(class_id),
    year_month      TEXT NOT NULL,
    total_credits    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (class_id, year_month)
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

// Which class a user belongs to (student) or manages (teacher). Nullable so
// accounts created before this feature existed don't break — the UI treats
// a null class_id as "no class assigned" rather than crashing.
ensureColumn('users', 'class_id', 'INTEGER REFERENCES classes(class_id)');

// Lifetime credits ever earned — unlike wallets.balance (spendable, and
// wiped by shop purchases) or daily_earned_credits (resets every day),
// this number only ever goes up. It's what the Profile page shows as
// "total credits gained since the beginning."
ensureColumn('wallets', 'lifetime_earned', 'INTEGER NOT NULL DEFAULT 0');

// Seed a starter set of classes so the registration dropdown isn't empty
// on a fresh install. Only runs once — if any class already exists
// (including ones a teacher renamed or added), this is a no-op.
const classCount = db.prepare('SELECT COUNT(*) AS n FROM classes').get().n;
if (classCount === 0) {
  const insertClass = db.prepare('INSERT INTO classes (name, created_at) VALUES (?, ?)');
  const now = new Date().toISOString();
  ['10A', '10B', '11A', '11B', '12A'].forEach((name) => insertClass.run(name, now));
}

module.exports = db;


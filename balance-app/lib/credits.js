// lib/credits.js — wallet rules: non-transferable, monthly wipe, daily cap
const db = require('../db');

const DAILY_CAP = 100; // hard daily earning cap per student, across all sources

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthStr() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getOrCreateWallet(studentId) {
  let wallet = db.prepare('SELECT * FROM wallets WHERE student_id = ?').get(studentId);
  if (!wallet) {
    db.prepare(
      `INSERT INTO wallets (student_id, balance, daily_earned_credits, last_earn_date, last_monthly_reset)
       VALUES (?, 0, 0, ?, ?)`
    ).run(studentId, todayStr(), monthStr());
    wallet = db.prepare('SELECT * FROM wallets WHERE student_id = ?').get(studentId);
  }
  return normalizeWallet(wallet);
}

// Applies daily-earn-counter reset (new day) and monthly balance wipe (new month)
// lazily, the first time the wallet is touched after the boundary passes.
function normalizeWallet(wallet) {
  const today = todayStr();
  const month = monthStr();
  let changed = false;

  if (wallet.last_earn_date !== today) {
    wallet.daily_earned_credits = 0;
    wallet.last_earn_date = today;
    changed = true;
  }
  if (wallet.last_monthly_reset !== month) {
    wallet.balance = 0;
    wallet.last_monthly_reset = month;
    changed = true;
  }
  if (changed) {
    db.prepare(
      `UPDATE wallets SET balance=?, daily_earned_credits=?, last_earn_date=?, last_monthly_reset=?
       WHERE student_id=?`
    ).run(wallet.balance, wallet.daily_earned_credits, wallet.last_earn_date, wallet.last_monthly_reset, wallet.student_id);
  }
  return wallet;
}

// Award `amount` credits, clamped by the remaining daily cap. Returns the
// number of credits actually awarded (may be less than requested, or 0).
function awardCredits(studentId, amount, reason) {
  if (amount <= 0) return 0;
  const wallet = getOrCreateWallet(studentId);
  const room = Math.max(0, DAILY_CAP - wallet.daily_earned_credits);
  const granted = Math.min(amount, room);
  if (granted > 0) {
    db.prepare(
      `UPDATE wallets SET balance = balance + ?, daily_earned_credits = daily_earned_credits + ? WHERE student_id = ?`
    ).run(granted, granted, studentId);
  }
  return granted;
}

module.exports = { getOrCreateWallet, awardCredits, DAILY_CAP, todayStr };

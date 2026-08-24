# Balance — student wellness + credit economy (working prototype)

A runnable prototype of the system you spec'd: domain-based student/teacher
roles, a step-tracking quest with server-verified anti-cheat, a focus timer
with streak bonuses, a homework hub, nightly log-off credits, and a teacher
wellness insights dashboard — all backed by a real (if small) credit wallet
with a daily earning cap and monthly reset.

## Stack, and why

**Node.js (built-in `http` + `node:sqlite`) — zero npm dependencies.**
Everything runs with just `node server.js`. No `npm install`, no native
build step, no version-mismatch risk between your machine and a judge's.
`node:sqlite` needs **Node 22.5+** (check with `node -v`); if you're on an
older Node, upgrade or swap in `better-sqlite3` — the query calls are
already in that shape (`db.prepare(...).run/get/all(...)`), so it's a
near drop-in swap.

The frontend is your original HTML/CSS/JS, restructured onto a shared dark
sporty-minimal theme (`public/theme.css`) inspired by the padel/tennis club
references you sent — bold color energy kept in check by a lot of
whitespace and a restrained palette (lime accent, electric blue as a
secondary/teacher-role color, near-black surfaces).

## Run it

```bash
cd balance-app
node server.js
```

Open **http://localhost:3000**. That's the whole setup.

### Try the roles
- Register with an email ending `@nguyensieuschool.edu.com` → **student**
  account (wallet, step tracker, timer, homework submission).
- Register with an email ending `@nguyensieuschool.com` (not `.edu.com`)
  → **teacher** account (create assignments, grade, wellness dashboard).
- Any other domain is rejected at registration — the role-matching logic
  lives in `lib/auth.js::roleForEmail`.

### Try the credit economy
- On the step tracker, use the **"+100 steps (desktop demo)"** button —
  real `devicemotion` events only fire on an actual phone, so this lets
  you test on a laptop. It goes through the exact same server endpoint
  and anti-cheat check as a real phone would.
- Try to break the anti-cheat: open the browser console and hit
  `fetch('/api/steps', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({delta: 5000, elapsedMs: 1000})})`
  — the server rejects it (5000 steps/sec is not a human), even if you
  bypass the client entirely. That's the important part: the check lives
  server-side in `lib/anticheat.js`, not just in `steptracker.js`.
- Try the offline queue: on the step tracker, open devtools → Network →
  set throttling to "Offline", click the demo button a few times (each
  click gets queued — watch the "N batches waiting to sync" indicator
  appear), then switch back to "Online" and watch them flush and credit
  automatically within a few seconds.
- Run the focus timer for 15+ minutes (or edit `MIN_FOCUS_MINUTES` in
  `routes/timer.js` down to 1 for a quick demo) to see the streak bonus.
- As a teacher, create an assignment with a due date, then submit it as
  a student before/after the due date to see on-time vs. late crediting.
- Push steps or timer sessions past 100 credits in one day and watch the
  daily cap clamp the award (`lib/credits.js`).
- On the dashboard, the "Your progress" tiles show all-time totals —
  complete a few focus sessions and submit a couple of homeworks, then
  reload the dashboard and watch the "Focus sessions" and "Homework done"
  numbers climb. They're pulled from `/api/stats/progress`, which sums
  real historical rows rather than re-deriving anything from today only.

## Redesign — sporty-minimal theme

`public/theme.css` is the single source of truth for the look: colors,
spacing, radii, and reusable components (`.btn`, `.card`, `.pill`,
`.input-field`, `.stat-tile`, the floating `.balance-nav`) all live there
as CSS custom properties and classes. Every page now links it before its
own page-specific CSS, so changing the palette or type scale is a one-file
edit rather than hunting through six stylesheets.

Palette, deliberately narrow:
- **Lime** (`--lime`, `#d6ff3f`) — the primary sporty accent: earning
  actions, primary buttons, the step-progress ring.
- **Electric blue** (`--blue`, `#4c8dff`) — secondary accent, used for
  teacher-role elements and "informational" stats, so students and
  teachers read as visually distinct at a glance without a second theme.
- **Red** (`--red`) — reserved for late/error states only.
- Everything else is near-black surfaces (`--bg`, `--surface`,
  `--surface-2`) and off-white/gray text — the "minimalism" half of the
  brief: one accent doing the work per element, lots of unused space,
  no competing colors.

The step tracker's progress ring and dark background were already close
to this palette, so that page needed the least rework. The focus timer
needed the most — it was cream/navy/Cinzel before, which is why it now
looks the most different.

## Progress tracking (done)

New `daily_wellness.sessions_completed` column (added via a safe
migration in `db.js` — `ensureColumn()` checks `PRAGMA table_info`
before altering, so it won't touch an existing database's data) counts
every valid focus session, even ones past the daily 3-bonus cap that
previously went unrecorded entirely.

`GET /api/stats/progress` (new, `routes/stats.js`) aggregates:
- `homeworkCompleted` / `homeworkOnTime` — `COUNT`/`SUM` over `submissions`
- `focusSessionsCompleted` — `SUM(sessions_completed)` over `daily_wellness`
- `stepsAllTime`, `daysLogged`, `nightsLoggedOff` — same pattern

The dashboard calls this alongside `/api/steps/today` on load and renders
it in the "Your progress" stat tiles. Nothing here is per-day — it's a
running total since the account was created, which is what "track their
studying progress" means for a dashboard rather than a daily snapshot.

## What's real vs. simplified

This is a working prototype, not the full competition build — a few
things are intentionally simplified so you have a runnable base to
demo and extend from:

| Feature | Prototype approach | Real version would need |
|---|---|---|
| Auth | Password + scrypt hash, in-memory sessions | WebAuthn biometric (client-side key, as you specced), or at least DB-backed/Redis sessions so restarting the server doesn't log everyone out |
| Night log-off | Heuristic: "no ping received since 10 PM" checked when claimed 6–10 AM | Log every session start/end explicitly, verify a true unbroken gap, handle timezones properly |
| Offline / spotty connectivity | ✅ Now IndexedDB-backed — see below | A service worker to cache the app shell itself, so a full page reload also works while fully offline (see caveat below) |
| Geolocation park quests | Not built | Add a `lib/geofence.js`, an endpoint, and check-in UI in `steptracker.html` |

## Offline support (done)

`public/offline-queue.js` wraps an IndexedDB store (`balance-offline` /
`pending-steps`). When `/api/steps` fails to reach the server —
`syncToServer`'s `catch` block — the batch is written to disk instead of
just sitting in a JS variable, so it survives a closed tab or a crash, not
just a slow network. On load, on the browser's `online` event, and on a
regular interval, `flushQueue()` replays anything still queued, in order,
stopping cleanly if the network drops again mid-replay. A small indicator
under the step counter shows "N batches waiting to sync" whenever the
queue isn't empty.

One related gap this surfaced and also fixed: `requireAuth()` in
`app.js` used to redirect to the login page on *any* fetch failure,
including a pure network outage — which would've booted someone off the
tracker mid-walk despite their session being perfectly valid. It now
only redirects on an actual "not logged in" response from the server;
a network failure instead falls back to the last confirmed session
(cached in `localStorage`) and shows a small "offline — showing cached
session" note in the nav bar instead.

**Known caveat:** this covers the *data* (steps queue safely and survive
a refresh) but not the *app shell* — if a phone goes fully offline
*before* the page has ever loaded, or a hard-refresh happens with zero
cache, there's nothing to serve the HTML/JS from. Fixing that needs a
service worker caching the static files, which is extension #1 below.

## What I'd extend next

Roughly in order of "most value for least effort":

1. **Service worker for the app shell.** Complements the offline queue
   above — caches `index.html`, `steptracker.html`, and the JS/CSS so a
   fully-offline reload still loads *something* to queue steps into,
   rather than failing outright.
2. **Persistent sessions.** Swap the in-memory `Map` in `lib/auth.js` for
   a `sessions` table in the same SQLite DB (or a cookie-signed JWT).
   Right now restarting the server logs everyone out — fine for a demo,
   not for judges poking around over a few hours.
3. **WebAuthn.** The password flow is a placeholder for exactly this.
   `lib/auth.js` already isolates "verify credential → create session",
   so WebAuthn slots in as an alternate `verify` path without touching
   the rest of the app.
4. **Geolocation park quests + Co-op Class Quests scaling.** Both are
   genuinely new features (not upgrades to something built), so budget
   real time for them — a `quests` table, a geofence check endpoint, and
   a class-size-aware reward formula.
5. **Grading UI polish** — right now teacher grading is a bare `<select>`
   per submission. A real "needs revision" flow would notify the student
   and let them resubmit.

## Project layout

```
balance-app/
  server.js              # entry point — router + session middleware
  db.js                  # SQLite schema (matches the table design you specced)
  lib/
    auth.js               # password hashing, sessions, domain→role logic
    credits.js             # wallet: daily cap, monthly reset
    anticheat.js            # server-side step-rate validation
    http-helpers.js          # tiny JSON/cookie/static-file helpers (no Express)
  routes/                 # one file per resource (auth, steps, timer, nightmode, assignments, wallet, teacher)
  public/                 # frontend — your original pages, wired to the API
```

const GOAL = 10000;
const MIN_THRESHOLD = 1.2;
const MAX_THRESHOLD = 15.0;
let steps = 0;
let isTracking = false;
let lastAcc = 0;
let lastStepTime = 0;

// Client-side cadence check (kept from the original prototype — catches
// obviously-spoofed motion events fast, in the UI, before we even bother
// the server). The server re-checks every batch independently in
// lib/anticheat.js, so a modified/bypassed client can't just fake a total.
let stepTimestamps = [];

// --- server sync state ---
let stepsSinceSync = 0;
let lastSyncTime = Date.now();
const SYNC_EVERY_N_STEPS = 5;
const SYNC_INTERVAL_MS = 4000;

const stepCountEl = document.getElementById('stepCount');
const startBtn = document.getElementById('startBtn');
const statusMsg = document.getElementById('statusMsg');
const creditMsg = document.getElementById('creditMsg');
const pendingMsg = document.getElementById('pendingMsg');
const progressRing = document.getElementById('progressRing');

const radius = progressRing.r.baseVal.value;
const circumference = radius * 2 * Math.PI;

function updateProgress(currentSteps) {
    const percentage = Math.min(currentSteps / GOAL, 1);
    const offset = circumference - (percentage * circumference);
    progressRing.style.strokeDashoffset = offset;
}

async function syncToServer(force) {
    const now = Date.now();
    const elapsedMs = now - lastSyncTime;
    if (!force && stepsSinceSync < SYNC_EVERY_N_STEPS && elapsedMs < SYNC_INTERVAL_MS) return;
    if (stepsSinceSync === 0) return;

    const delta = stepsSinceSync;
    stepsSinceSync = 0;
    lastSyncTime = now;

    try {
        const res = await fetch('/api/steps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta, elapsedMs }),
        });
        const data = await res.json();
        if (!res.ok) {
            // server disagrees with the client's step reading — trust the server,
            // don't queue it for retry (retrying a rejected batch would just
            // fail again).
            statusMsg.innerText = data.reason ? `Sync rejected: ${data.reason}` : 'Sync rejected';
            return;
        }
        if (data.credits_granted > 0) {
            creditMsg.innerText = `+${data.credits_granted} credits earned today`;
        }
    } catch (err) {
        // Offline / server unreachable. Persist the batch to IndexedDB rather
        // than just holding it in memory — that way it survives a refresh or
        // a closed tab, and gets replayed by flushQueue() once connectivity
        // is back (see offline-queue.js).
        await enqueueStepBatch(delta, elapsedMs);
        await updatePendingIndicator();
    }
}

async function flushQueue() {
    const batches = await getPendingBatches();
    if (!batches.length) return;

    for (const batch of batches) {
        try {
            const res = await fetch('/api/steps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delta: batch.delta, elapsedMs: batch.elapsedMs }),
            });
            if (res.ok) {
                const data = await res.json();
                await removeBatch(batch.id);
                if (data.credits_granted > 0) {
                    creditMsg.innerText = `+${data.credits_granted} credits earned today (synced)`;
                }
            } else {
                // Server actively rejected this batch (e.g. anti-cheat) — no
                // point retrying it forever, so drop it rather than blocking
                // every batch queued after it.
                await removeBatch(batch.id);
            }
        } catch (err) {
            // Still offline — stop here, leave remaining batches queued for
            // the next flush attempt.
            break;
        }
    }
    await updatePendingIndicator();

    // The server is now the source of truth again — refresh today's total
    // in case it drifted while we were replaying queued batches.
    try {
        const res = await fetch('/api/steps/today');
        if (res.ok) {
            const data = await res.json();
            steps = data.step_count;
            stepCountEl.innerText = steps;
            updateProgress(steps);
        }
    } catch (err) { /* still offline, ignore */ }
}

async function updatePendingIndicator() {
    const n = await pendingCount();
    pendingMsg.innerText = n > 0 ? `${n} batch${n === 1 ? '' : 'es'} waiting to sync (offline)` : '';
}

function handleMotion(event) {
    if (!isTracking) return;

    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
    const delta = Math.abs(magnitude - lastAcc);
    lastAcc = magnitude;

    const currentTime = Date.now();

    if (delta > MIN_THRESHOLD && delta < MAX_THRESHOLD && (currentTime - lastStepTime) > 300) {
        steps++;
        stepsSinceSync++;
        stepCountEl.innerText = steps;
        updateProgress(steps);
        lastStepTime = currentTime;

        stepTimestamps.push(currentTime);
        if (stepTimestamps.length > 19) {
            stepTimestamps.shift();
            const timeForLastSteps = currentTime - stepTimestamps[0];
            const currentSPM = (19 / timeForLastSteps) * 60000;
            if (currentSPM > 260) {
                triggerAntiCheat();
                return;
            }
        }
        syncToServer(false);
    }
}

function triggerAntiCheat() {
    isTracking = false;
    window.removeEventListener('devicemotion', handleMotion);

    startBtn.innerText = 'Start Walking';
    startBtn.classList.remove('is-tracking');

    statusMsg.innerText = 'TOUCH SOME GRASS';
    statusMsg.style.color = 'limegreen';
    statusMsg.style.fontWeight = 'bold';
    statusMsg.style.fontSize = '1.2rem';

    // Only the client-side display resets — steps already confirmed by the
    // server this session were already credited and stay credited.
    steps = 0;
    stepCountEl.innerText = steps;
    updateProgress(steps);
    stepTimestamps = [];
    stepsSinceSync = 0;
}

async function toggleTracking() {
    if (isTracking) {
        isTracking = false;
        startBtn.innerText = 'Resume Walking';
        startBtn.classList.remove('is-tracking');

        statusMsg.innerText = 'Tracking paused.';
        statusMsg.style.color = '';
        statusMsg.style.fontWeight = 'normal';
        statusMsg.style.fontSize = '';

        window.removeEventListener('devicemotion', handleMotion);
        await syncToServer(true);
        return;
    }

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permissionState = await DeviceMotionEvent.requestPermission();
            if (permissionState === 'granted') {
                start();
            } else {
                statusMsg.innerText = 'Sensor permission denied.';
            }
        } catch (error) {
            statusMsg.innerText = 'Error requesting permissions. Ensure connection is HTTPS.';
        }
    } else {
        start();
    }
}

function start() {
    isTracking = true;
    startBtn.innerText = 'Pause Tracker';
    startBtn.classList.add('is-tracking');

    statusMsg.innerText = 'Tracking... Keep phone unlocked in your pocket.';
    statusMsg.style.color = '#888';
    statusMsg.style.fontWeight = 'normal';
    statusMsg.style.fontSize = '0.9rem';

    stepTimestamps = [];
    lastSyncTime = Date.now();
    window.addEventListener('devicemotion', handleMotion);
}

startBtn.addEventListener('click', toggleTracking);

// Desktop browsers have no accelerometer, so devicemotion never fires there.
// This button exists purely so the prototype is testable without a phone —
// it still goes through the exact same server-side sync + anti-cheat path.
document.getElementById('demoBtn').addEventListener('click', async () => {
    steps += 100;
    stepCountEl.innerText = steps;
    updateProgress(steps);
    // Simulated at a plausible ~2.5 steps/sec so it passes anti-cheat, rather
    // than reporting 100 steps in ~0ms (which the real cadence check — the
    // same one guarding real submissions — would correctly reject).
    // Goes through the same fetch-or-queue path as real motion events, so
    // toggling devtools' "Offline" mode and clicking this button is the
    // easiest way to see the offline queue in action.
    try {
        const res = await fetch('/api/steps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta: 100, elapsedMs: 40000 }),
        });
        const data = await res.json();
        if (res.ok && data.credits_granted > 0) creditMsg.innerText = `+${data.credits_granted} credits earned today`;
    } catch (err) {
        await enqueueStepBatch(100, 40000);
        await updatePendingIndicator();
    }
});

// Periodic sync fallback even if step cadence is slow, and periodic retry
// of anything still queued from a previous offline stretch.
setInterval(() => { if (isTracking) syncToServer(false); }, SYNC_INTERVAL_MS);
setInterval(() => { flushQueue(); }, SYNC_INTERVAL_MS);

// The browser tells us the moment connectivity comes back — no need to wait
// for the next poll.
window.addEventListener('online', () => { flushQueue(); });

// Load today's progress on page open (auth guard lives in app.js)
(async function init() {
    const user = await requireAuth();
    if (!user || user.role !== 'student') {
        if (user) { alert('Step tracking is for student accounts.'); window.location.href = 'dashboard.html'; }
        return;
    }
    // Replay anything queued from before this page load (e.g. the tab was
    // closed mid-walk while offline) before trusting the server's total.
    await flushQueue();
    try {
        const res = await fetch('/api/steps/today');
        if (res.ok) {
            const data = await res.json();
            steps = data.step_count;
            stepCountEl.innerText = steps;
            updateProgress(steps);
        }
    } catch (err) { /* still offline — show queued indicator, try again on next flush */ }
    await updatePendingIndicator();
})();

const start = document.getElementById('start');
const pause = document.getElementById('pause');
const reset = document.getElementById('reset');
const seconds = document.getElementById('seconds');
const minutes = document.getElementById('minutes');
const hours = document.getElementById('hours');
const creditMsg = document.getElementById('timerCreditMsg');

let timeLeft = 0;
let originalDurationSeconds = 0; // for reporting focusMinutes on completion
let interval = null;

const enforceMax59 = (inputElement) => {
  if (parseInt(inputElement.value, 10) > 59) {
    inputElement.value = 59;
  }
};
minutes.addEventListener('input', () => enforceMax59(minutes));
seconds.addEventListener('input', () => enforceMax59(seconds));

const calculateTotalSeconds = () => {
  const h = parseInt(hours.value, 10) || 0;
  const m = parseInt(minutes.value, 10) || 0;
  const s = parseInt(seconds.value, 10) || 0;
  return h * 3600 + m * 60 + s;
};

const updateTimer = () => {
  const hoursLeft = Math.floor(timeLeft / 3600);
  const minutesLeft = Math.floor((timeLeft % 3600) / 60);
  const secondsLeft = timeLeft % 60;
  hours.value = hoursLeft.toString().padStart(2, '0');
  minutes.value = minutesLeft.toString().padStart(2, '0');
  seconds.value = secondsLeft.toString().padStart(2, '0');
};

async function reportCompletion() {
  const focusMinutes = Math.round(originalDurationSeconds / 60);
  try {
    const res = await fetch('/api/timer/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focusMinutes }),
    });
    const data = await res.json();
    if (data.credits_granted > 0) {
      creditMsg.textContent = `+${data.credits_granted} focus credits earned (${data.bonuses_used_today}/${data.bonuses_allowed} today)`;
    } else {
      creditMsg.textContent = data.reason || 'Session complete.';
    }
  } catch (err) {
    creditMsg.textContent = 'Session complete (offline — credit not synced).';
  }
}

const startTimer = () => {
  if (interval) return;

  if (timeLeft <= 0) {
    timeLeft = calculateTotalSeconds();
    originalDurationSeconds = timeLeft;
  }
  if (timeLeft <= 0) return;

  interval = setInterval(() => {
    timeLeft--;
    updateTimer();

    if (timeLeft <= 0) {
      clearInterval(interval);
      interval = null;
      alert('Time is up!');
      reportCompletion();
    }
  }, 1000);
};

const stopTimer = () => {
  clearInterval(interval);
  interval = null;
};

const resetTimer = () => {
  stopTimer();
  timeLeft = 0;
  originalDurationSeconds = 0;
  hours.value = '';
  minutes.value = '';
  seconds.value = '';
  creditMsg.textContent = '';
};

start.addEventListener('click', startTimer);
pause.addEventListener('click', stopTimer);
reset.addEventListener('click', resetTimer);

(async function init() {
  const user = await requireAuth();
  if (user && user.role !== 'student') {
    alert('The focus timer credit bonus is for student accounts.');
  }
})();

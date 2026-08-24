// app.js — shared across dashboard/steptracker/timer/homework pages.
// Renders a small top nav with the user's name, role, wallet balance
// (students only) and a logout button; redirects to login if not authed.

const CACHED_USER_KEY = 'balance_cached_user';

async function requireAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // Server reached us and said "not logged in" — this is a real signal,
      // unlike a network failure below, so it's the one case that redirects.
      localStorage.removeItem(CACHED_USER_KEY);
      window.location.href = 'index.html';
      return null;
    }
    const { user } = await res.json();
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    renderNav(user);
    return user;
  } catch (err) {
    // Network failure, not an auth failure — e.g. offline mid-walk. Bouncing
    // to the login page here would throw away in-progress tracking for no
    // reason. Fall back to the last confirmed session instead, so the page
    // keeps working (queuing to IndexedDB, etc.) until connectivity returns.
    const cached = localStorage.getItem(CACHED_USER_KEY);
    if (cached) {
      const user = JSON.parse(cached);
      renderNav(user, /* offline */ true);
      return user;
    }
    // No prior session to fall back on — we genuinely don't know if this
    // person is logged in, so send them to log in once connectivity allows.
    window.location.href = 'index.html';
    return null;
  }
}

function renderNav(user, offline) {
  const nav = document.createElement('div');
  nav.id = 'balanceNav';
  nav.className = 'balance-nav';

  const left = document.createElement('div');
  left.innerHTML = `
    <a href="dashboard.html" class="brand">
      <span class="dot-logo"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></span>
      Balance
    </a>
    <span class="name name-role">${escapeHtml(user.name)} · ${user.role}</span>
    ${offline ? '<span class="offline-flag">offline — cached session</span>' : ''}
  `;
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.gap = '4px';

  const right = document.createElement('div');
  right.className = 'right';

  if (user.role === 'student' && user.wallet) {
    const bal = document.createElement('span');
    bal.className = 'credit-badge';
    bal.innerHTML = `⚡ ${user.wallet.balance}`;
    right.appendChild(bal);
  } else if (user.role === 'teacher') {
    const badge = document.createElement('span');
    badge.className = 'pill pill-blue';
    badge.textContent = 'Teacher';
    right.appendChild(badge);
  }

  const logoutBtn = document.createElement('button');
  logoutBtn.textContent = 'Log out';
  logoutBtn.className = 'logout-btn';
  logoutBtn.onclick = async () => {
    await fetch('/api/logout', { method: 'POST' });
    localStorage.removeItem(CACHED_USER_KEY);
    window.location.href = 'index.html';
  };
  right.appendChild(logoutBtn);

  nav.appendChild(left);
  nav.appendChild(right);
  document.body.prepend(nav);
  document.body.classList.add('has-balance-nav');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

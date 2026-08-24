let currentUser = null;

async function loadAssignments() {
  const res = await fetch('/api/assignments');
  const data = await res.json();
  renderAssignments(data.assignments || []);
}

function renderAssignments(assignments) {
  const listEl = document.getElementById('assignmentList');
  if (!assignments.length) {
    listEl.innerHTML = '<p class="empty-msg">No assignments yet.</p>';
    return;
  }

  listEl.innerHTML = '';
  assignments.forEach((a) => {
    const card = document.createElement('div');
    card.className = 'assignment-card';
    const due = new Date(a.due_date).toLocaleString();

    if (currentUser.role === 'student') {
      const sub = a.mySubmission;
      let statusHtml = '';
      let actionHtml = '';
      if (sub) {
        statusHtml = sub.on_time
          ? '<span class="pill pill-lime">on time</span>'
          : '<span class="pill pill-red">late</span>';
      } else {
        actionHtml = `<button data-id="${a.assignment_id}" class="btn btn-primary submitBtn">Submit</button>`;
      }
      card.innerHTML = `
        <div class="a-title">${escapeHtml(a.title)} ${statusHtml}</div>
        <div class="a-meta">Due ${due} &middot; worth ${a.credit_value} credits</div>
        ${actionHtml}
      `;
    } else {
      card.innerHTML = `
        <div class="a-title">${escapeHtml(a.title)}</div>
        <div class="a-meta">Due ${due} &middot; worth ${a.credit_value} credits</div>
        <button data-id="${a.assignment_id}" class="btn btn-ghost viewSubsBtn">View submissions</button>
        <div class="subsContainer" id="subs-${a.assignment_id}"></div>
      `;
    }
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('.submitBtn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const res = await fetch(`/api/assignments/${btn.dataset.id}/submit`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(data.on_time ? `Submitted on time! +${data.credits_granted} credits` : `Submitted late. +${data.credits_granted} credits`);
        loadAssignments();
      } else {
        alert(data.error || 'Could not submit.');
      }
    })
  );

  listEl.querySelectorAll('.viewSubsBtn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const res = await fetch(`/api/assignments/${id}/submissions`);
      const data = await res.json();
      const container = document.getElementById(`subs-${id}`);
      if (!data.submissions || !data.submissions.length) {
        container.innerHTML = '<p class="empty-msg" style="font-size:0.8rem;margin-top:10px;">No submissions yet.</p>';
        return;
      }
      container.innerHTML = data.submissions
        .map(
          (s) => `
        <div class="sub-row">
          <span>${escapeHtml(s.student_name)} ${s.on_time ? '<span class="pill pill-lime">on time</span>' : '<span class="pill pill-red">late</span>'}</span>
          <select data-sub="${s.submission_id}">
            <option value="submitted" ${s.status === 'submitted' ? 'selected' : ''}>submitted</option>
            <option value="graded" ${s.status === 'graded' ? 'selected' : ''}>graded</option>
            <option value="needs_revision" ${s.status === 'needs_revision' ? 'selected' : ''}>needs revision</option>
          </select>
        </div>`
        )
        .join('');
      container.querySelectorAll('select').forEach((sel) =>
        sel.addEventListener('change', async () => {
          await fetch(`/api/submissions/${sel.dataset.sub}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: sel.value }),
          });
        })
      );
    })
  );
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

(async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (currentUser.role === 'teacher') {
    document.getElementById('teacherForm').innerHTML = `
      <form class="new-assignment" id="newAssignmentForm">
        <div class="eyebrow" style="margin-bottom:14px;">New assignment</div>
        <div class="field-row">
          <div class="field" style="margin-bottom:0;">
            <label>Title</label>
            <input type="text" id="newTitle" class="input-field" required>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Due date</label>
            <input type="datetime-local" id="newDue" class="input-field" required>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Credits</label>
            <input type="number" id="newCredits" class="input-field" value="10" min="1">
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:16px;">Create assignment</button>
      </form>
    `;
    document.getElementById('newAssignmentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('newTitle').value;
      const due_date = new Date(document.getElementById('newDue').value).toISOString();
      const credit_value = document.getElementById('newCredits').value;
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due_date, credit_value }),
      });
      if (res.ok) {
        e.target.reset();
        document.getElementById('newCredits').value = 10;
        loadAssignments();
      }
    });
  }

  loadAssignments();
})();

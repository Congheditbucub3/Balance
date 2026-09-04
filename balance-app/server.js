// server.js — entry point. Zero npm dependencies: pure Node `http` + `node:sqlite`.
const http = require('node:http');
const path = require('node:path');
const { readJsonBody, sendJson, serveStatic } = require('./lib/http-helpers');
const { getSession, parseCookies } = require('./lib/auth');

const authRoutes = require('./routes/auth');
const stepRoutes = require('./routes/steps');
const timerRoutes = require('./routes/timer');
const nightRoutes = require('./routes/nightmode');
const walletRoutes = require('./routes/wallet');
const assignmentRoutes = require('./routes/assignments');
const teacherRoutes = require('./routes/teacher');
const statsRoutes = require('./routes/stats');
const classRoutes = require('./routes/classes');
const profileRoutes = require('./routes/profile');
const shopRoutes = require('./routes/shop');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Route table: [method, path-pattern, handler]. Patterns support a single
// `:id` segment; everything else must match exactly.
const routes = [
  ['POST', '/api/register', authRoutes.register],
  ['POST', '/api/login', authRoutes.login],
  ['POST', '/api/logout', authRoutes.logout],
  ['GET', '/api/me', authRoutes.me],

  ['POST', '/api/steps', stepRoutes.submitSteps],
  ['GET', '/api/steps/today', stepRoutes.todaySteps],

  ['POST', '/api/timer/complete', timerRoutes.completeSession],

  ['POST', '/api/nightmode/ping', nightRoutes.ping],
  ['POST', '/api/nightmode/claim', nightRoutes.claim],

  ['GET', '/api/wallet', walletRoutes.getWallet],

  ['POST', '/api/assignments', assignmentRoutes.createAssignment],
  ['GET', '/api/assignments', assignmentRoutes.listAssignments],
  ['POST', '/api/assignments/:id/submit', assignmentRoutes.submitAssignment],
  ['GET', '/api/assignments/:id/submissions', assignmentRoutes.listSubmissions],
  ['POST', '/api/submissions/:id/status', assignmentRoutes.updateSubmissionStatus],

  ['GET', '/api/teacher/wellness-summary', teacherRoutes.wellnessSummary],

  ['GET', '/api/stats/progress', statsRoutes.studentProgress],

  ['GET', '/api/classes', classRoutes.listClasses],

  ['GET', '/api/profile', profileRoutes.getProfile],

  ['GET', '/api/shop/catalog', shopRoutes.getCatalog],
  ['GET', '/api/shop/progress', shopRoutes.getClassProgress],
  ['POST', '/api/shop/buy', shopRoutes.buyItem],
];

function matchRoute(method, urlPath) {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const patternParts = pattern.split('/').filter(Boolean);
    const urlParts = urlPath.split('/').filter(Boolean);
    if (patternParts.length !== urlParts.length) continue;

    const params = {};
    let ok = true;
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = urlParts[i];
      } else if (patternParts[i] !== urlParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler, params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  if (!urlPath.startsWith('/api/')) {
    return serveStatic(req, res, PUBLIC_DIR);
  }

  const match = matchRoute(req.method, urlPath);
  if (!match) return sendJson(res, 404, { error: 'Not found' });

  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.sid ? getSession(cookies.sid) : null;
  const ctx = { cookies, session };

  try {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    match.handler(body, req, res, ctx, match.params);
  } catch (err) {
    sendJson(res, 400, { error: err.message || 'Bad request' });
  }
});

server.listen(PORT, () => {
  console.log(`Balance app running at http://localhost:${PORT}`);
});

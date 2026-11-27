const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT_DIR = __dirname;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_GITHUB_RETRIES = 5;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const BLOCKED_STATIC_NAMES = new Set([
  'index.js',
  'package.json',
  'package-lock.json'
]);

let writeQueue = Promise.resolve();

function enqueueWrite(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function getGitHubConfig() {
  const token = (process.env.GITHUB_TOKEN || '').trim();
  const repo = (process.env.GITHUB_REPO || 'mcfaith9/dmbbdbb').trim();
  const branch = (process.env.GITHUB_BRANCH || 'main').trim();
  const rawPath = (process.env.GITHUB_LEADERBOARD_PATH || 'data/leaderboard.json').trim();
  const filePath = rawPath.replace(/^\/+/, '');

  if (!token) {
    return { configured: false, reason: 'GITHUB_TOKEN is not configured.' };
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return { configured: false, reason: 'Invalid GITHUB_REPO format.' };
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) {
    return { configured: false, reason: 'Invalid GITHUB_BRANCH format.' };
  }
  if (!filePath || filePath.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(filePath)) {
    return { configured: false, reason: 'Invalid GITHUB_LEADERBOARD_PATH format.' };
  }

  return {
    configured: true,
    token,
    repo,
    branch,
    filePath
  };
}

function buildGitHubContentsUrl(cfg, includeRef) {
  const encodedPath = cfg.filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const baseUrl = `https://api.github.com/repos/${cfg.repo}/contents/${encodedPath}`;
  if (includeRef) {
    return `${baseUrl}?ref=${encodeURIComponent(cfg.branch)}`;
  }
  return baseUrl;
}

function getGitHubHeaders(token, withBody) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dmbb-dbb-matching-game'
  };
  if (withBody) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  return headers;
}

function compareLeaderboardEntries(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.attempts !== b.attempts) {
    return a.attempts - b.attempts;
  }
  if (a.completionTimeMs !== b.completionTimeMs) {
    return a.completionTimeMs - b.completionTimeMs;
  }
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || id.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    return null;
  }

  const playerName =
    typeof raw.playerName === 'string' && raw.playerName.trim().length > 0
      ? raw.playerName.trim().slice(0, 32)
      : 'Player';

  const matches = Number(raw.matches);
  const totalPairs = Number(raw.totalPairs);
  const attempts = Number(raw.attempts);
  const completionTimeMs = Number(raw.completionTimeMs);
  const score = Number(raw.score);
  const createdAt = Number(raw.createdAt);
  const updatedAt = Number(raw.updatedAt);

  if (
    !Number.isFinite(matches) || matches < 1 || matches > 200 ||
    !Number.isFinite(totalPairs) || totalPairs < matches || totalPairs > 200 ||
    !Number.isFinite(attempts) || attempts < 1 || attempts > 10000 ||
    !Number.isFinite(completionTimeMs) || completionTimeMs < 0 || completionTimeMs > 86400000 ||
    !Number.isFinite(score) || score < 0 || score > 1000000
  ) {
    return null;
  }

  const safeCreatedAt = Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : Date.now();
  const safeUpdatedAt = Number.isFinite(updatedAt) && updatedAt >= safeCreatedAt ? Math.floor(updatedAt) : safeCreatedAt;

  return {
    id,
    playerName,
    score: Math.round(score),
    attempts: Math.round(attempts),
    completionTimeMs: Math.round(completionTimeMs),
    matches: Math.round(matches),
    totalPairs: Math.round(totalPairs),
    createdAt: safeCreatedAt,
    updatedAt: safeUpdatedAt
  };
}

function parseLeaderboardContent(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const parsed = JSON.parse(rawText);
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.entries) ? parsed.entries : []);
  const byId = new Map();

  for (const item of list) {
    const clean = sanitizeEntry(item);
    if (clean && !byId.has(clean.id)) {
      byId.set(clean.id, clean);
    }
  }

  return Array.from(byId.values()).sort(compareLeaderboardEntries);
}

function mergeEntries(remoteEntries, incomingEntries) {
  const byId = new Map();
  let changed = false;

  for (const item of remoteEntries) {
    byId.set(item.id, item);
  }

  for (const incoming of incomingEntries) {
    const existing = byId.get(incoming.id);
    if (!existing) {
      byId.set(incoming.id, incoming);
      changed = true;
    } else if (
      incoming.playerName !== existing.playerName &&
      incoming.updatedAt >= existing.updatedAt
    ) {
      byId.set(incoming.id, {
        ...existing,
        playerName: incoming.playerName,
        updatedAt: incoming.updatedAt
      });
      changed = true;
    }
  }

  const merged = Array.from(byId.values()).sort(compareLeaderboardEntries);
  return { merged, changed };
}

async function fetchGitHubLeaderboard(cfg) {
  const url = buildGitHubContentsUrl(cfg, true);
  const response = await fetch(url, {
    method: 'GET',
    headers: getGitHubHeaders(cfg.token, false)
  });

  if (response.status === 404) {
    return { entries: [], sha: null, exists: false };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const err = new Error(`GitHub read failed (${response.status})`);
    err.status = response.status;
    err.details = errText.slice(0, 200);
    throw err;
  }

  const data = await response.json();
  let decoded = '';

  if (typeof data.content === 'string') {
    decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  } else if (data.download_url) {
    const rawResp = await fetch(data.download_url, {
      headers: getGitHubHeaders(cfg.token, false)
    });
    if (!rawResp.ok) {
      throw new Error(`GitHub raw download failed (${rawResp.status})`);
    }
    decoded = await rawResp.text();
  }

  let entries = [];
  try {
    entries = parseLeaderboardContent(decoded);
  } catch (_parseErr) {
    const err = new Error('Remote leaderboard JSON is malformed.');
    err.status = 502;
    throw err;
  }

  return {
    entries,
    sha: typeof data.sha === 'string' ? data.sha : null,
    exists: true
  };
}

async function commitGitHubLeaderboard(cfg, entries, sha, commitMessage) {
  const url = buildGitHubContentsUrl(cfg, false);
  const payload = {
    entries,
    updatedAt: new Date().toISOString()
  };
  const encodedContent = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf-8').toString('base64');

  const body = {
    message: commitMessage,
    content: encodedContent,
    branch: cfg.branch
  };
  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: getGitHubHeaders(cfg.token, true),
    body: JSON.stringify(body)
  });

  return response;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        const err = new Error('Request payload too large');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_err) {
        const err = new Error('Invalid JSON payload');
        err.status = 400;
        reject(err);
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleGetLeaderboard(_req, res) {
  const cfg = getGitHubConfig();
  if (!cfg.configured) {
    sendJson(res, 503, {
      ok: false,
      configured: false,
      error: cfg.reason
    });
    return;
  }

  try {
    const remote = await fetchGitHubLeaderboard(cfg);
    sendJson(res, 200, {
      ok: true,
      configured: true,
      entries: remote.entries,
      initialized: remote.exists
    });
  } catch (err) {
    const status = err.status === 401 || err.status === 403 ? 502 : (err.status || 502);
    sendJson(res, status, {
      ok: false,
      configured: true,
      error: 'Unable to fetch shared leaderboard from GitHub.'
    });
  }
}

async function handlePostLeaderboard(req, res) {
  const cfg = getGitHubConfig();
  if (!cfg.configured) {
    sendJson(res, 503, {
      ok: false,
      configured: false,
      error: cfg.reason
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.status || 400, { ok: false, error: err.message });
    return;
  }

  const rawIncoming = Array.isArray(body.entries)
    ? body.entries
    : (body.entry ? [body.entry] : []);

  if (rawIncoming.length === 0 || rawIncoming.length > 100) {
    sendJson(res, 400, {
      ok: false,
      error: 'Provide between 1 and 100 valid leaderboard entries.'
    });
    return;
  }

  const incomingEntries = [];
  for (const raw of rawIncoming) {
    const clean = sanitizeEntry(raw);
    if (!clean) {
      sendJson(res, 400, { ok: false, error: 'Invalid leaderboard entry fields.' });
      return;
    }
    incomingEntries.push(clean);
  }

  try {
    const result = await enqueueWrite(async () => {
      for (let attempt = 1; attempt <= MAX_GITHUB_RETRIES; attempt++) {
        const remote = await fetchGitHubLeaderboard(cfg);
        const { merged, changed } = mergeEntries(remote.entries, incomingEntries);

        if (!changed) {
          return {
            entries: merged,
            syncedIds: incomingEntries.map((e) => e.id),
            committed: false
          };
        }

        const commitMessage =
          incomingEntries.length === 1
            ? `Update leaderboard: ${incomingEntries[0].playerName} (${incomingEntries[0].score} pts)`
            : `Sync ${incomingEntries.length} leaderboard entries`;

        const putResp = await commitGitHubLeaderboard(cfg, merged, remote.sha, commitMessage);

        if (putResp.ok) {
          return {
            entries: merged,
            syncedIds: incomingEntries.map((e) => e.id),
            committed: true
          };
        }

        // Retry on SHA conflict / concurrent update from another PC
        if ((putResp.status === 409 || putResp.status === 422) && attempt < MAX_GITHUB_RETRIES) {
          await sleep(150 * attempt + Math.floor(Math.random() * 120));
          continue;
        }

        const err = new Error(`GitHub write failed (${putResp.status})`);
        err.status = putResp.status === 401 || putResp.status === 403 ? 502 : 502;
        throw err;
      }

      const conflictErr = new Error('Concurrent update conflict on GitHub.');
      conflictErr.status = 409;
      throw conflictErr;
    });

    sendJson(res, 200, {
      ok: true,
      configured: true,
      entries: result.entries,
      syncedIds: result.syncedIds
    });
  } catch (err) {
    sendJson(res, err.status || 502, {
      ok: false,
      configured: true,
      error: 'Unable to synchronize leaderboard to GitHub right now.'
    });
  }
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/api/leaderboard') {
    if (req.method === 'GET') {
      handleGetLeaderboard(req, res);
      return;
    }
    if (req.method === 'POST') {
      handlePostLeaderboard(req, res);
      return;
    }
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const safePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const segments = safePath.split('/').filter(Boolean);
  const hasHiddenSegment = segments.some((seg) => seg.startsWith('.'));
  if (
    hasHiddenSegment ||
    segments[0] === 'node_modules' ||
    BLOCKED_STATIC_NAMES.has(safePath)
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const resolvedPath = path.resolve(ROOT_DIR, safePath);

  // Prevent directory traversal outside project root
  if (!resolvedPath.startsWith(ROOT_DIR + path.sep) && resolvedPath !== path.join(ROOT_DIR, 'index.html')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(resolvedPath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Christmas Memory Match running at http://${HOST}:${PORT}`);
});

import fs from 'node:fs';
import path from 'node:path';

const LEADERBOARD_PATH = process.env.LEADERBOARD_PATH || 'data/leaderboard.json';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

function setOutput(name, value) {
  if (!GITHUB_OUTPUT) return;
  const safe = String(value).replace(/\r?\n/g, ' ');
  fs.appendFileSync(GITHUB_OUTPUT, `${name}=${safe}\n`, 'utf8');
}

function compareLeaderboardEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.attempts !== b.attempts) return a.attempts - b.attempts;
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

function extractPayloadFromIssueBody(body) {
  const fencedMatch = body.match(/```json\s*([\s\S]*?)\s*```/i);
  const rawJson = fencedMatch ? fencedMatch[1] : body.trim();
  const parsed = JSON.parse(rawJson);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
  if (parsed && parsed.entry) return [parsed.entry];
  if (parsed && typeof parsed === 'object' && parsed.id) return [parsed];
  return [];
}

function readExistingLeaderboard(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.entries) ? parsed.entries : []);
  const byId = new Map();
  for (const item of list) {
    const clean = sanitizeEntry(item);
    if (clean && !byId.has(clean.id)) {
      byId.set(clean.id, clean);
    }
  }
  return Array.from(byId.values());
}

function main() {
  let rawIncoming;
  try {
    rawIncoming = extractPayloadFromIssueBody(ISSUE_BODY);
  } catch {
    setOutput('valid', 'false');
    setOutput('changed', 'false');
    setOutput('message', 'Could not parse valid JSON leaderboard data from the issue body.');
    return;
  }

  if (!Array.isArray(rawIncoming) || rawIncoming.length === 0 || rawIncoming.length > 50) {
    setOutput('valid', 'false');
    setOutput('changed', 'false');
    setOutput('message', 'Submission must contain between 1 and 50 leaderboard entries.');
    return;
  }

  const incoming = [];
  for (const raw of rawIncoming) {
    const clean = sanitizeEntry(raw);
    if (!clean) {
      setOutput('valid', 'false');
      setOutput('changed', 'false');
      setOutput('message', 'One or more leaderboard entries failed validation.');
      return;
    }
    incoming.push(clean);
  }

  const resolvedPath = path.resolve(LEADERBOARD_PATH);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const existingEntries = readExistingLeaderboard(resolvedPath);
  const byId = new Map(existingEntries.map((item) => [item.id, item]));

  let addedCount = 0;
  let updatedCount = 0;

  for (const entry of incoming) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      addedCount += 1;
    } else if (entry.playerName !== existing.playerName && entry.updatedAt >= existing.updatedAt) {
      byId.set(entry.id, {
        ...existing,
        playerName: entry.playerName,
        updatedAt: entry.updatedAt
      });
      updatedCount += 1;
    }
  }

  const changed = addedCount > 0 || updatedCount > 0;
  if (changed) {
    const merged = Array.from(byId.values()).sort(compareLeaderboardEntries);
    const output = {
      entries: merged,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(resolvedPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  setOutput('valid', 'true');
  setOutput('changed', changed ? 'true' : 'false');
  setOutput(
    'message',
    changed
      ? `Synced ${addedCount} new and ${updatedCount} updated record(s) to ${LEADERBOARD_PATH}.`
      : 'All submitted records were already present on the leaderboard (no duplicates added).'
  );
}

main();

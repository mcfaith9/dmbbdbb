const token = (process.env.GITHUB_TOKEN || '').trim();
const repo = (process.env.GITHUB_REPOSITORY || '').trim();
const issueNumber = (process.env.ISSUE_NUMBER || '').trim();
const mergeValid = process.env.MERGE_VALID === 'true';
const mergeMessage = process.env.MERGE_MESSAGE || 'Processed leaderboard submission.';
const jobStatus = process.env.JOB_STATUS || 'success';

async function main() {
  if (!token || !repo || !issueNumber) {
    console.log('Missing GitHub context for closing issue; skipping.');
    return;
  }

  const baseUrl = `https://api.github.com/repos/${repo}/issues/${encodeURIComponent(issueNumber)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dmbb-dbb-matching-game-actions',
    'Content-Type': 'application/json; charset=utf-8'
  };

  let commentBody;
  if (jobStatus === 'success' && mergeValid) {
    commentBody = `Leaderboard sync complete: ${mergeMessage}`;
  } else if (!mergeValid) {
    commentBody = `Leaderboard submission rejected: ${mergeMessage}`;
  } else {
    commentBody = 'Leaderboard sync encountered an error while committing the update. Please retry from the game.';
  }

  await fetch(`${baseUrl}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: commentBody })
  });

  await fetch(baseUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'closed' })
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

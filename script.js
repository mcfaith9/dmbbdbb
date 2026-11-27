/* ============================================================================
 * CHRISTMAS PARTY MEMORY MATCH — PICTURE CONFIGURATION
 * ============================================================================
 * How to use your own pictures:
 *   1. Put your photos inside the "images" folder (next to index.html).
 *   2. Update the filenames in the "images" list below.
 *   3. Save this file and refresh the browser (or click Restart Game).
 *
 * Notes:
 *   - Each filename listed below is automatically duplicated into a matching pair.
 *   - Supported image formats: .jpg, .jpeg, .png, .webp, .gif
 *   - Add or remove filenames anytime; the "Pairs" dropdown updates automatically.
 * ========================================================================== */
const GAME_CONFIG = {
  imageFolder: 'images/',

  images: [
    '1.jpg',
    '2.jpg',
    '3.jpg',
    '4.jpg',
    '5.jpg',
    '6.jpg',
    '7.jpg',
    '8.jpg',
    '9.jpg',
    '10.jpg',
    '11.jpg',
    '12.jpg',
    '13.jpg',
    '14.jpg',
    '15.jpg',
    '16.jpg',
    '17.jpg',
    '18.jpg',
    '19.jpg',
    '20.jpg'
  ],

  defaultPairs: 6,
  mismatchDelayMs: 1000
};

/* ============================================================================
 * GAME STATE & DOM REFERENCES
 * ========================================================================== */
(function () {
  'use strict';

  const LEADERBOARD_STORAGE_KEY = 'dmbb_dbb_matching_leaderboard_v1';
  const SYNC_QUEUE_STORAGE_KEY = 'dmbb_dbb_matching_sync_queue_v1';
  const LEADERBOARD_API_URL = '/api/leaderboard';
  const SYNC_RETRY_INTERVAL_MS = 15000;

  const els = {
    board: document.getElementById('gameBoard'),
    movesCount: document.getElementById('movesCount'),
    matchedCount: document.getElementById('matchedCount'),
    totalPairsLabel: document.getElementById('totalPairsLabel'),
    remainingCount: document.getElementById('remainingCount'),
    timerCount: document.getElementById('timerCount'),
    pairSelect: document.getElementById('pairCountSelect'),
    restartBtn: document.getElementById('restartBtn'),
    soundToggleBtn: document.getElementById('soundToggleBtn'),
    leaderboardBtn: document.getElementById('leaderboardBtn'),
    winModal: document.getElementById('winModal'),
    winSummary: document.getElementById('winSummary'),
    winScoreValue: document.getElementById('winScoreValue'),
    winAttemptsValue: document.getElementById('winAttemptsValue'),
    winTimeValue: document.getElementById('winTimeValue'),
    winMatchesValue: document.getElementById('winMatchesValue'),
    winNameForm: document.getElementById('winNameForm'),
    playerNameInput: document.getElementById('playerNameInput'),
    saveNameStatus: document.getElementById('saveNameStatus'),
    playAgainBtn: document.getElementById('playAgainBtn'),
    viewLeaderboardBtn: document.getElementById('viewLeaderboardBtn'),
    closeWinBtn: document.getElementById('closeWinBtn'),
    leaderboardModal: document.getElementById('leaderboardModal'),
    closeLeaderboardBtn: document.getElementById('closeLeaderboardBtn'),
    leaderboardDoneBtn: document.getElementById('leaderboardDoneBtn'),
    leaderboardEmpty: document.getElementById('leaderboardEmpty'),
    leaderboardListWrap: document.getElementById('leaderboardListWrap'),
    leaderboardList: document.getElementById('leaderboardList'),
    syncStatusBadge: document.getElementById('syncStatusBadge'),
    syncStatusText: document.getElementById('syncStatusText'),
    snowLayer: document.getElementById('snowLayer')
  };

  const state = {
    pairCount: 6,
    moves: 0,
    matchedPairs: 0,
    flippedCards: [],
    isBoardLocked: false,
    mismatchTimer: null,
    soundEnabled: true,
    audioCtx: null,
    gameStartTimeMs: null,
    elapsedMs: 0,
    timerInterval: null,
    leaderboardEntries: [],
    pendingSyncQueue: [],
    lastCompletedEntryId: null,
    syncStatus: 'offline',
    activeSyncPromise: null,
    syncRetryTimer: null
  };

  /* --------------------------------------------------------------------------
   * Audio Feedback (Offline Web Audio API — no external files required)
   * ------------------------------------------------------------------------ */
  function getAudioContext() {
    if (!state.soundEnabled) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!state.audioCtx) {
      state.audioCtx = new AudioCtx();
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(function () {});
    }
    return state.audioCtx;
  }

  function playTone(freq, durationSec, type, startOffsetSec, gainPeak) {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime + (startOffsetSec || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  function playFlipSound() {
    playTone(440, 0.07, 'triangle', 0, 0.07);
  }

  function playMatchSound() {
    playTone(523.25, 0.14, 'sine', 0, 0.12);
    playTone(659.25, 0.16, 'sine', 0.08, 0.12);
    playTone(783.99, 0.24, 'sine', 0.16, 0.13);
  }

  function playMismatchSound() {
    playTone(260, 0.12, 'triangle', 0, 0.08);
    playTone(210, 0.16, 'triangle', 0.1, 0.08);
  }

  function playWinSound() {
    playTone(523.25, 0.16, 'sine', 0, 0.13);
    playTone(659.25, 0.16, 'sine', 0.12, 0.13);
    playTone(783.99, 0.16, 'sine', 0.24, 0.13);
    playTone(1046.5, 0.42, 'sine', 0.36, 0.15);
  }

  /* --------------------------------------------------------------------------
   * Helpers & Formatting
   * ------------------------------------------------------------------------ */
  function shuffleArray(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  }

  function buildImagePath(filename) {
    const folder = GAME_CONFIG.imageFolder || '';
    if (!folder) return filename;
    return folder.endsWith('/') ? folder + filename : folder + '/' + filename;
  }

  function getConfiguredImages() {
    if (!Array.isArray(GAME_CONFIG.images)) return [];
    return GAME_CONFIG.images.filter(function (name) {
      return typeof name === 'string' && name.trim().length > 0;
    });
  }

  function formatHudTime(ms) {
    const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  function formatCompletionTime(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalTenths = Math.floor(safeMs / 100);
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds + '.' + tenths;
  }

  function calculateScore(matches, attempts, completionTimeMs) {
    const safeMatches = Math.max(1, Number(matches) || 1);
    const safeAttempts = Math.max(safeMatches, Number(attempts) || safeMatches);
    const completionSec = Math.max(0, Math.round((Number(completionTimeMs) || 0) / 1000));

    const basePoints = safeMatches * 100;
    const extraAttempts = Math.max(0, safeAttempts - safeMatches);
    const efficiencyBonus = Math.max(0, safeMatches * 100 - extraAttempts * 25);
    const speedBonus = Math.max(0, safeMatches * 30 - completionSec * 2);

    return Math.max(safeMatches * 50, basePoints + efficiencyBonus + speedBonus);
  }

  function computeGridDimensions(totalCards) {
    const presets = {
      4: { cols: 2, rows: 2 },
      6: { cols: 3, rows: 2 },
      8: { cols: 4, rows: 2 },
      10: { cols: 5, rows: 2 },
      12: { cols: 4, rows: 3 },
      14: { cols: 4, rows: 4 },
      16: { cols: 4, rows: 4 },
      18: { cols: 6, rows: 3 },
      20: { cols: 5, rows: 4 },
      24: { cols: 6, rows: 4 },
      30: { cols: 6, rows: 5 },
      36: { cols: 6, rows: 6 }
    };

    if (presets[totalCards]) return presets[totalCards];

    const cols = Math.ceil(Math.sqrt(totalCards * 1.25));
    const rows = Math.ceil(totalCards / cols);
    return { cols: cols, rows: rows };
  }

  function populatePairOptions() {
    const available = getConfiguredImages().length;
    const standardCounts = [4, 6, 8, 10, 12, 15, 18];
    const options = standardCounts.filter(function (n) {
      return n <= available;
    });

    if (available > 0 && options.indexOf(available) === -1) {
      options.push(available);
      options.sort(function (a, b) {
        return a - b;
      });
    }

    if (options.length === 0 && available > 0) {
      options.push(available);
    }

    els.pairSelect.innerHTML = '';
    options.forEach(function (count) {
      const opt = document.createElement('option');
      opt.value = String(count);
      opt.textContent = count + ' Pairs (' + count * 2 + ' Cards)';
      els.pairSelect.appendChild(opt);
    });

    const preferred = Math.min(GAME_CONFIG.defaultPairs || 6, available);
    if (options.indexOf(preferred) !== -1) {
      state.pairCount = preferred;
    } else if (options.length > 0) {
      state.pairCount = options[0];
    } else {
      state.pairCount = 0;
    }

    els.pairSelect.value = String(state.pairCount);
  }

  function updateHud() {
    const remaining = Math.max(0, state.pairCount - state.matchedPairs);
    els.movesCount.textContent = String(state.moves);
    els.matchedCount.textContent = String(state.matchedPairs);
    els.totalPairsLabel.textContent = String(state.pairCount);
    els.remainingCount.textContent = String(remaining);
    if (els.timerCount) {
      els.timerCount.textContent = formatHudTime(state.elapsedMs);
    }
  }

  /* --------------------------------------------------------------------------
   * Game Timer
   * ------------------------------------------------------------------------ */
  function startGameTimer() {
    if (state.gameStartTimeMs !== null) return;
    state.gameStartTimeMs = Date.now();
    state.elapsedMs = 0;

    if (state.timerInterval) {
      clearInterval(state.timerInterval);
    }

    state.timerInterval = setInterval(function () {
      if (state.gameStartTimeMs === null) return;
      state.elapsedMs = Date.now() - state.gameStartTimeMs;
      if (els.timerCount) {
        els.timerCount.textContent = formatHudTime(state.elapsedMs);
      }
    }, 250);
  }

  function stopGameTimer() {
    if (state.gameStartTimeMs !== null) {
      state.elapsedMs = Date.now() - state.gameStartTimeMs;
    }
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    if (els.timerCount) {
      els.timerCount.textContent = formatHudTime(state.elapsedMs);
    }
  }

  function resetGameTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    state.gameStartTimeMs = null;
    state.elapsedMs = 0;
  }

  /* --------------------------------------------------------------------------
   * Leaderboard Persistence, Ranking & GitHub Sync
   * ------------------------------------------------------------------------ */
  function generateEntryId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'entry-' + window.crypto.randomUUID();
    }
    return 'entry-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
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
    const matches = Math.max(1, Number(raw.matches) || 1);
    const totalPairs = Math.max(matches, Number(raw.totalPairs) || matches);
    const attempts = Math.max(1, Number(raw.attempts) || matches);
    const completionTimeMs = Math.max(0, Number(raw.completionTimeMs) || 0);
    const score = Number.isFinite(Number(raw.score))
      ? Number(raw.score)
      : calculateScore(matches, attempts, completionTimeMs);
    const playerName =
      typeof raw.playerName === 'string' && raw.playerName.trim().length > 0
        ? raw.playerName.trim().slice(0, 32)
        : 'Player';
    const createdAt = Number(raw.createdAt) || Date.now();
    const updatedAt = Number(raw.updatedAt) >= createdAt ? Number(raw.updatedAt) : createdAt;

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : generateEntryId(),
      playerName: playerName,
      score: Math.round(score),
      attempts: Math.round(attempts),
      completionTimeMs: Math.round(completionTimeMs),
      matches: Math.round(matches),
      totalPairs: Math.round(totalPairs),
      createdAt: Math.floor(createdAt),
      updatedAt: Math.floor(updatedAt)
    };
  }

  function mergeEntryLists(baseList, incomingList) {
    const byId = new Map();
    (baseList || []).forEach(function (item) {
      const clean = sanitizeEntry(item);
      if (clean) byId.set(clean.id, clean);
    });
    (incomingList || []).forEach(function (item) {
      const clean = sanitizeEntry(item);
      if (!clean) return;
      const existing = byId.get(clean.id);
      if (!existing) {
        byId.set(clean.id, clean);
      } else if (clean.updatedAt >= existing.updatedAt) {
        byId.set(clean.id, {
          id: existing.id,
          playerName: clean.playerName,
          score: existing.score,
          attempts: existing.attempts,
          completionTimeMs: existing.completionTimeMs,
          matches: existing.matches,
          totalPairs: existing.totalPairs,
          createdAt: existing.createdAt,
          updatedAt: clean.updatedAt
        });
      }
    });
    return Array.from(byId.values()).sort(compareLeaderboardEntries);
  }

  function loadLeaderboard() {
    try {
      const stored = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY);
      if (!stored) {
        state.leaderboardEntries = [];
        return;
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        state.leaderboardEntries = [];
        return;
      }
      state.leaderboardEntries = mergeEntryLists([], parsed);
    } catch (_err) {
      state.leaderboardEntries = [];
    }
  }

  function saveLeaderboard() {
    state.leaderboardEntries.sort(compareLeaderboardEntries);
    try {
      window.localStorage.setItem(
        LEADERBOARD_STORAGE_KEY,
        JSON.stringify(state.leaderboardEntries)
      );
    } catch (_err) {
      // Ignore storage quota/access errors; in-memory leaderboard still works
    }
  }

  function loadSyncQueue() {
    try {
      const stored = window.localStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
      if (!stored) {
        state.pendingSyncQueue = [];
        return;
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        state.pendingSyncQueue = [];
        return;
      }
      state.pendingSyncQueue = mergeEntryLists([], parsed);
    } catch (_err) {
      state.pendingSyncQueue = [];
    }
  }

  function saveSyncQueue() {
    try {
      window.localStorage.setItem(
        SYNC_QUEUE_STORAGE_KEY,
        JSON.stringify(state.pendingSyncQueue)
      );
    } catch (_err) {
      // Ignore storage errors
    }
  }

  function updateSyncStatusUI() {
    if (!els.syncStatusBadge || !els.syncStatusText) return;

    els.syncStatusBadge.classList.remove(
      'sync-status-synced',
      'sync-status-syncing',
      'sync-status-offline'
    );

    if (state.syncStatus === 'syncing') {
      els.syncStatusBadge.classList.add('sync-status-syncing');
      els.syncStatusText.textContent = 'Syncing';
    } else if (state.syncStatus === 'synced') {
      els.syncStatusBadge.classList.add('sync-status-synced');
      els.syncStatusText.textContent = 'Synced';
    } else {
      els.syncStatusBadge.classList.add('sync-status-offline');
      const queuedCount = state.pendingSyncQueue.length;
      els.syncStatusText.textContent =
        queuedCount > 0 ? 'Offline (' + queuedCount + ' queued)' : 'Offline';
    }
  }

  function setSyncStatus(status) {
    state.syncStatus = status;
    updateSyncStatusUI();
  }

  function scheduleSyncRetry() {
    if (state.syncRetryTimer || state.pendingSyncQueue.length === 0) return;
    state.syncRetryTimer = setTimeout(function () {
      state.syncRetryTimer = null;
      if (state.pendingSyncQueue.length > 0) {
        refreshLeaderboardFromServer();
      }
    }, SYNC_RETRY_INTERVAL_MS);
  }

  function clearSyncRetry() {
    if (state.syncRetryTimer) {
      clearTimeout(state.syncRetryTimer);
      state.syncRetryTimer = null;
    }
  }

  function enqueueEntryForSync(entry) {
    const clean = sanitizeEntry(entry);
    if (!clean) return;
    const filtered = state.pendingSyncQueue.filter(function (item) {
      return item.id !== clean.id;
    });
    filtered.push(clean);
    state.pendingSyncQueue = filtered;
    saveSyncQueue();
    updateSyncStatusUI();
  }

  function applyServerEntries(remoteEntries) {
    state.leaderboardEntries = mergeEntryLists(remoteEntries, state.pendingSyncQueue);
    saveLeaderboard();
    renderLeaderboard();
  }

  function flushSyncQueue() {
    if (state.pendingSyncQueue.length === 0) {
      return Promise.resolve(true);
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncStatus('offline');
      scheduleSyncRetry();
      return Promise.resolve(false);
    }

    if (state.activeSyncPromise) {
      return state.activeSyncPromise.then(function () {
        if (state.pendingSyncQueue.length > 0) {
          return flushSyncQueue();
        }
        return true;
      });
    }

    const batch = state.pendingSyncQueue.slice();
    const sentVersions = new Map();
    batch.forEach(function (item) {
      sentVersions.set(item.id, item.updatedAt);
    });

    setSyncStatus('syncing');

    state.activeSyncPromise = fetch(LEADERBOARD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ entries: batch })
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok || !data || !data.ok) {
              throw new Error((data && data.error) || 'Sync failed');
            }
            return data;
          });
      })
      .then(function (data) {
        const syncedIdSet = new Set(Array.isArray(data.syncedIds) ? data.syncedIds : []);
        state.pendingSyncQueue = state.pendingSyncQueue.filter(function (item) {
          if (!syncedIdSet.has(item.id)) return true;
          // Keep in queue if the user edited the name while this upload was in flight
          return item.updatedAt > (sentVersions.get(item.id) || 0);
        });
        saveSyncQueue();

        if (Array.isArray(data.entries)) {
          applyServerEntries(data.entries);
        }

        if (state.pendingSyncQueue.length === 0) {
          clearSyncRetry();
          setSyncStatus('synced');
          if (els.winModal && !els.winModal.hidden && els.saveNameStatus) {
            els.saveNameStatus.textContent = 'Synced to shared GitHub Leaderboard.';
          }
          return true;
        }

        // Flush any newer edits made mid-flight
        state.activeSyncPromise = null;
        return flushSyncQueue();
      })
      .catch(function () {
        setSyncStatus('offline');
        scheduleSyncRetry();
        if (els.winModal && !els.winModal.hidden && els.saveNameStatus) {
          els.saveNameStatus.textContent = 'Saved locally. Will sync when connection is available.';
        }
        return false;
      })
      .finally(function () {
        state.activeSyncPromise = null;
      });

    return state.activeSyncPromise;
  }

  function refreshLeaderboardFromServer() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncStatus('offline');
      if (state.pendingSyncQueue.length > 0) scheduleSyncRetry();
      return Promise.resolve(false);
    }

    const preFlush = state.pendingSyncQueue.length > 0 ? flushSyncQueue() : Promise.resolve(true);

    return preFlush.then(function (flushedOk) {
      if (state.pendingSyncQueue.length > 0 && !flushedOk) {
        setSyncStatus('offline');
        scheduleSyncRetry();
        return false;
      }

      setSyncStatus('syncing');
      return fetch(LEADERBOARD_API_URL, {
        method: 'GET',
        cache: 'no-store'
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              if (!response.ok || !data || !data.ok) {
                throw new Error((data && data.error) || 'Fetch failed');
              }
              return data;
            });
        })
        .then(function (data) {
          if (Array.isArray(data.entries)) {
            applyServerEntries(data.entries);
          }
          if (state.pendingSyncQueue.length > 0) {
            setSyncStatus('offline');
            scheduleSyncRetry();
          } else {
            clearSyncRetry();
            setSyncStatus('synced');
          }
          return true;
        })
        .catch(function () {
          setSyncStatus('offline');
          if (state.pendingSyncQueue.length > 0) scheduleSyncRetry();
          return false;
        });
    });
  }

  function recordGameResult(result) {
    const now = Date.now();
    const defaultName = 'Player ' + (state.leaderboardEntries.length + 1);
    const entry = sanitizeEntry({
      id: generateEntryId(),
      playerName: defaultName,
      score: result.score,
      attempts: result.attempts,
      completionTimeMs: result.completionTimeMs,
      matches: result.matches,
      totalPairs: result.totalPairs,
      createdAt: now,
      updatedAt: now
    });

    state.leaderboardEntries = mergeEntryLists(state.leaderboardEntries, [entry]);
    state.lastCompletedEntryId = entry.id;
    saveLeaderboard();
    renderLeaderboard();
    enqueueEntryForSync(entry);
    flushSyncQueue();
    return entry;
  }

  function updateEntryPlayerName(entryId, newName) {
    if (!entryId) return false;
    const trimmed = (newName || '').trim().slice(0, 32);
    if (!trimmed) return false;

    const target = state.leaderboardEntries.find(function (item) {
      return item.id === entryId;
    });
    if (!target) return false;

    if (target.playerName !== trimmed) {
      target.playerName = trimmed;
      target.updatedAt = Date.now();
      saveLeaderboard();
      renderLeaderboard();
      enqueueEntryForSync(target);
      flushSyncQueue();
    }
    return true;
  }

  function renderLeaderboard() {
    if (!els.leaderboardList || !els.leaderboardEmpty || !els.leaderboardListWrap) return;

    const sorted = state.leaderboardEntries.slice().sort(compareLeaderboardEntries);
    els.leaderboardList.innerHTML = '';

    if (sorted.length === 0) {
      els.leaderboardEmpty.hidden = false;
      els.leaderboardListWrap.hidden = true;
      return;
    }

    els.leaderboardEmpty.hidden = true;
    els.leaderboardListWrap.hidden = false;

    sorted.forEach(function (entry, index) {
      const rank = index + 1;
      const li = document.createElement('li');
      li.className = 'lb-row lb-item';
      if (rank === 1) li.classList.add('lb-rank-1');
      else if (rank === 2) li.classList.add('lb-rank-2');
      else if (rank === 3) li.classList.add('lb-rank-3');
      if (entry.id === state.lastCompletedEntryId) {
        li.classList.add('is-latest');
      }

      const rankCol = document.createElement('div');
      rankCol.className = 'lb-col-rank';
      const rankBadge = document.createElement('span');
      rankBadge.className = 'lb-rank-badge tabular';
      rankBadge.textContent = '#' + rank;
      rankCol.appendChild(rankBadge);

      const playerCol = document.createElement('div');
      playerCol.className = 'lb-col-player lb-player-cell';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'lb-player-name';
      nameSpan.textContent = entry.playerName;
      playerCol.appendChild(nameSpan);

      if (entry.id === state.lastCompletedEntryId) {
        const latestTag = document.createElement('span');
        latestTag.className = 'lb-latest-tag';
        latestTag.textContent = 'Latest';
        playerCol.appendChild(latestTag);
      }

      const scoreCol = document.createElement('div');
      scoreCol.className = 'lb-col-score tabular';
      const scoreLabel = document.createElement('span');
      scoreLabel.className = 'lb-cell-label';
      scoreLabel.textContent = 'Score';
      const scoreVal = document.createElement('span');
      scoreVal.className = 'lb-score-val';
      scoreVal.textContent = entry.score.toLocaleString();
      scoreCol.appendChild(scoreLabel);
      scoreCol.appendChild(scoreVal);

      const attemptsCol = document.createElement('div');
      attemptsCol.className = 'lb-col-attempts tabular';
      const attemptsLabel = document.createElement('span');
      attemptsLabel.className = 'lb-cell-label';
      attemptsLabel.textContent = 'Attempts';
      const attemptsVal = document.createElement('span');
      attemptsVal.textContent = String(entry.attempts);
      attemptsCol.appendChild(attemptsLabel);
      attemptsCol.appendChild(attemptsVal);

      const timeCol = document.createElement('div');
      timeCol.className = 'lb-col-time tabular';
      const timeLabel = document.createElement('span');
      timeLabel.className = 'lb-cell-label';
      timeLabel.textContent = 'Time';
      const timeVal = document.createElement('span');
      timeVal.textContent = formatCompletionTime(entry.completionTimeMs);
      timeCol.appendChild(timeLabel);
      timeCol.appendChild(timeVal);

      const matchesCol = document.createElement('div');
      matchesCol.className = 'lb-col-matches tabular';
      const matchesLabel = document.createElement('span');
      matchesLabel.className = 'lb-cell-label';
      matchesLabel.textContent = 'Matches';
      const matchesVal = document.createElement('span');
      matchesVal.textContent = entry.matches + '/' + entry.totalPairs;
      matchesCol.appendChild(matchesLabel);
      matchesCol.appendChild(matchesVal);

      li.appendChild(rankCol);
      li.appendChild(playerCol);
      li.appendChild(scoreCol);
      li.appendChild(attemptsCol);
      li.appendChild(timeCol);
      li.appendChild(matchesCol);

      els.leaderboardList.appendChild(li);
    });
  }

  /* --------------------------------------------------------------------------
   * Deck & Card Rendering
   * ------------------------------------------------------------------------ */
  function createCardElement(cardData, displayNumber) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'memory-card';
    button.dataset.pairId = String(cardData.pairId);
    button.dataset.filename = cardData.filename;
    button.dataset.cardNumber = String(displayNumber);
    button.setAttribute('aria-label', 'Card ' + displayNumber + ', face down');

    const inner = document.createElement('div');
    inner.className = 'card-inner';

    // Back face (face down)
    const back = document.createElement('div');
    back.className = 'card-face card-back';

    const backFrame = document.createElement('div');
    backFrame.className = 'card-back-frame';

    const ornamentSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ornamentSvg.setAttribute('viewBox', '0 0 24 24');
    ornamentSvg.setAttribute('class', 'card-back-ornament');
    ornamentSvg.setAttribute('aria-hidden', 'true');
    const starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    starPath.setAttribute('d', 'M12 2 L14.6 8.2 L21 9 L16.2 13.5 L17.6 20 L12 16.6 L6.4 20 L7.8 13.5 L3 9 L9.4 8.2 Z');
    starPath.setAttribute('fill', '#e6b44c');
    ornamentSvg.appendChild(starPath);

    const numberLabel = document.createElement('span');
    numberLabel.className = 'card-number tabular';
    numberLabel.textContent = String(displayNumber);

    backFrame.appendChild(ornamentSvg);
    backFrame.appendChild(numberLabel);
    back.appendChild(backFrame);

    // Front face (picture)
    const front = document.createElement('div');
    front.className = 'card-face card-front';

    const img = document.createElement('img');
    img.className = 'card-photo';
    img.src = cardData.src;
    img.alt = 'Party picture ' + cardData.pairId;
    img.draggable = false;

    img.addEventListener('load', function () {
      front.classList.remove('is-missing-image');
    });

    img.addEventListener('error', function () {
      front.classList.add('is-missing-image');
    });

    // Clean fallback if an image is missing
    const fallback = document.createElement('div');
    fallback.className = 'card-fallback';

    const fallbackLabel = document.createElement('span');
    fallbackLabel.className = 'fallback-pair-label';
    fallbackLabel.textContent = 'Pair #' + cardData.pairId;

    const fallbackFile = document.createElement('span');
    fallbackFile.className = 'fallback-filename';
    fallbackFile.textContent = cardData.src;

    fallback.appendChild(fallbackLabel);
    fallback.appendChild(fallbackFile);

    // Match checkmark indicator
    const matchBadge = document.createElement('span');
    matchBadge.className = 'card-match-badge';
    matchBadge.setAttribute('aria-hidden', 'true');
    matchBadge.innerHTML =
      '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M5 10.5 L8.5 14 L15 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    front.appendChild(img);
    front.appendChild(fallback);
    front.appendChild(matchBadge);

    inner.appendChild(back);
    inner.appendChild(front);
    button.appendChild(inner);

    button.addEventListener('click', function () {
      handleCardClick(button);
    });

    return button;
  }

  function startNewGame() {
    if (state.mismatchTimer) {
      clearTimeout(state.mismatchTimer);
      state.mismatchTimer = null;
    }

    resetGameTimer();
    hideWinModal();

    const allImages = getConfiguredImages();
    const chosenImages = shuffleArray(allImages).slice(0, state.pairCount);

    // Duplicate each selected picture to create matching pairs
    const deck = [];
    chosenImages.forEach(function (filename, idx) {
      const pairId = idx + 1;
      const src = buildImagePath(filename);
      deck.push({ pairId: pairId, filename: filename, src: src });
      deck.push({ pairId: pairId, filename: filename, src: src });
    });

    const shuffledDeck = shuffleArray(deck);

    state.moves = 0;
    state.matchedPairs = 0;
    state.flippedCards = [];
    state.isBoardLocked = false;
    updateHud();

    const dims = computeGridDimensions(shuffledDeck.length);
    els.board.style.setProperty('--grid-cols', String(dims.cols));
    els.board.style.setProperty('--grid-rows', String(dims.rows));
    els.board.innerHTML = '';

    shuffledDeck.forEach(function (cardData, index) {
      const cardEl = createCardElement(cardData, index + 1);
      els.board.appendChild(cardEl);
    });
  }

  /* --------------------------------------------------------------------------
   * Card Interaction & Matching Logic
   * ------------------------------------------------------------------------ */
  function handleCardClick(cardEl) {
    if (state.isBoardLocked) return;
    if (cardEl.classList.contains('is-flipped') || cardEl.classList.contains('is-matched')) {
      return;
    }

    startGameTimer();

    cardEl.classList.add('is-flipped');
    cardEl.setAttribute('aria-label', 'Card ' + cardEl.dataset.cardNumber + ', revealed');
    state.flippedCards.push(cardEl);
    playFlipSound();

    if (state.flippedCards.length < 2) {
      return;
    }

    state.moves += 1;
    updateHud();

    const firstCard = state.flippedCards[0];
    const secondCard = state.flippedCards[1];
    const isMatch = firstCard.dataset.pairId === secondCard.dataset.pairId;

    if (isMatch) {
      firstCard.classList.add('is-matched');
      secondCard.classList.add('is-matched');
      firstCard.disabled = true;
      secondCard.disabled = true;
      firstCard.setAttribute('aria-label', 'Card ' + firstCard.dataset.cardNumber + ', matched');
      secondCard.setAttribute('aria-label', 'Card ' + secondCard.dataset.cardNumber + ', matched');

      state.flippedCards = [];
      state.matchedPairs += 1;
      updateHud();

      if (state.matchedPairs === state.pairCount) {
        stopGameTimer();
        const completionTimeMs = state.elapsedMs;
        const attempts = state.moves;
        const matches = state.matchedPairs;
        const totalPairs = state.pairCount;
        const score = calculateScore(matches, attempts, completionTimeMs);
        const savedEntry = recordGameResult({
          score: score,
          attempts: attempts,
          completionTimeMs: completionTimeMs,
          matches: matches,
          totalPairs: totalPairs
        });

        setTimeout(function () {
          playWinSound();
          showWinModal(savedEntry);
        }, 380);
      } else {
        playMatchSound();
      }
    } else {
      state.isBoardLocked = true;
      setTimeout(playMismatchSound, 180);

      state.mismatchTimer = setTimeout(function () {
        firstCard.classList.remove('is-flipped');
        secondCard.classList.remove('is-flipped');
        firstCard.setAttribute('aria-label', 'Card ' + firstCard.dataset.cardNumber + ', face down');
        secondCard.setAttribute('aria-label', 'Card ' + secondCard.dataset.cardNumber + ', face down');
        state.flippedCards = [];
        state.isBoardLocked = false;
        state.mismatchTimer = null;
      }, GAME_CONFIG.mismatchDelayMs || 1000);
    }
  }

  /* --------------------------------------------------------------------------
   * Modals
   * ------------------------------------------------------------------------ */
  function showWinModal(entry) {
    els.winSummary.innerHTML =
      'You found all <strong class="tabular">' +
      entry.matches +
      '</strong> matching pairs in <strong class="tabular">' +
      entry.attempts +
      '</strong> attempts!';
    els.winScoreValue.textContent = entry.score.toLocaleString();
    els.winAttemptsValue.textContent = String(entry.attempts);
    els.winTimeValue.textContent = formatCompletionTime(entry.completionTimeMs);
    els.winMatchesValue.textContent = entry.matches + '/' + entry.totalPairs;

    els.playerNameInput.value = entry.playerName;
    if (state.syncStatus === 'synced' && state.pendingSyncQueue.length === 0) {
      els.saveNameStatus.textContent = 'Synced to shared GitHub Leaderboard.';
    } else if (state.syncStatus === 'syncing') {
      els.saveNameStatus.textContent = 'Saved locally · Syncing to shared Leaderboard...';
    } else {
      els.saveNameStatus.textContent = 'Saved locally · Will sync when online.';
    }
    els.winModal.hidden = false;
    els.playerNameInput.focus();
    els.playerNameInput.select();
  }

  function syncCurrentPlayerName() {
    if (!els.winModal || els.winModal.hidden || !state.lastCompletedEntryId || !els.playerNameInput) return;
    const typed = els.playerNameInput.value.trim();
    if (typed) {
      updateEntryPlayerName(state.lastCompletedEntryId, typed);
    }
  }

  function hideWinModal() {
    syncCurrentPlayerName();
    els.winModal.hidden = true;
  }

  function openLeaderboardModal() {
    syncCurrentPlayerName();
    renderLeaderboard();
    updateSyncStatusUI();
    els.leaderboardModal.hidden = false;
    els.closeLeaderboardBtn.focus();
    refreshLeaderboardFromServer();
  }

  function closeLeaderboardModal() {
    els.leaderboardModal.hidden = true;
  }

  /* --------------------------------------------------------------------------
   * Subtle Snowfall Atmosphere
   * ------------------------------------------------------------------------ */
  function createSnowflakes() {
    if (!els.snowLayer) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const flakeCount = 24;
    for (let i = 0; i < flakeCount; i++) {
      const flake = document.createElement('span');
      flake.className = 'snowflake';
      const size = 3 + Math.random() * 5;
      flake.style.width = size.toFixed(1) + 'px';
      flake.style.height = size.toFixed(1) + 'px';
      flake.style.left = (Math.random() * 100).toFixed(2) + '%';
      flake.style.animationDuration = (9 + Math.random() * 11).toFixed(2) + 's';
      flake.style.animationDelay = (-Math.random() * 15).toFixed(2) + 's';
      els.snowLayer.appendChild(flake);
    }
  }

  /* --------------------------------------------------------------------------
   * Event Listeners & Initialization
   * ------------------------------------------------------------------------ */
  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    els.soundToggleBtn.textContent = state.soundEnabled ? 'Sound: On' : 'Sound: Off';
    els.soundToggleBtn.setAttribute('aria-pressed', String(state.soundEnabled));
  }

  els.pairSelect.addEventListener('change', function () {
    const val = parseInt(els.pairSelect.value, 10);
    if (!isNaN(val) && val > 0) {
      state.pairCount = val;
      startNewGame();
    }
  });

  els.winNameForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const typed = els.playerNameInput.value.trim();
    if (!typed) {
      els.saveNameStatus.textContent = 'Please enter a player or team name.';
      els.playerNameInput.focus();
      return;
    }
    if (updateEntryPlayerName(state.lastCompletedEntryId, typed)) {
      els.saveNameStatus.textContent = 'Saved as "' + typed + '" on the Leaderboard!';
    }
  });

  els.restartBtn.addEventListener('click', startNewGame);
  els.playAgainBtn.addEventListener('click', startNewGame);
  els.closeWinBtn.addEventListener('click', hideWinModal);
  els.viewLeaderboardBtn.addEventListener('click', function () {
    hideWinModal();
    openLeaderboardModal();
  });
  els.soundToggleBtn.addEventListener('click', toggleSound);

  els.leaderboardBtn.addEventListener('click', openLeaderboardModal);
  els.closeLeaderboardBtn.addEventListener('click', closeLeaderboardModal);
  els.leaderboardDoneBtn.addEventListener('click', closeLeaderboardModal);

  els.winModal.addEventListener('click', function (e) {
    if (e.target === els.winModal) hideWinModal();
  });

  els.leaderboardModal.addEventListener('click', function (e) {
    if (e.target === els.leaderboardModal) closeLeaderboardModal();
  });

  document.addEventListener('keydown', function (e) {
    const tag = e.target && e.target.tagName;
    const isTyping =
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (e.target && e.target.isContentEditable);

    if (e.key === 'Escape') {
      hideWinModal();
      closeLeaderboardModal();
      return;
    }

    if (isTyping) return;

    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
      startNewGame();
    } else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) {
      toggleSound();
    } else if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey) {
      if (els.leaderboardModal.hidden) {
        openLeaderboardModal();
      } else {
        closeLeaderboardModal();
      }
    }
  });

  window.addEventListener('online', function () {
    refreshLeaderboardFromServer();
  });

  window.addEventListener('offline', function () {
    setSyncStatus('offline');
  });

  loadLeaderboard();
  loadSyncQueue();
  renderLeaderboard();
  updateSyncStatusUI();
  populatePairOptions();
  createSnowflakes();
  startNewGame();
  refreshLeaderboardFromServer();
})();

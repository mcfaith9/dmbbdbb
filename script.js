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

  const els = {
    board: document.getElementById('gameBoard'),
    movesCount: document.getElementById('movesCount'),
    matchedCount: document.getElementById('matchedCount'),
    totalPairsLabel: document.getElementById('totalPairsLabel'),
    remainingCount: document.getElementById('remainingCount'),
    pairSelect: document.getElementById('pairCountSelect'),
    restartBtn: document.getElementById('restartBtn'),
    soundToggleBtn: document.getElementById('soundToggleBtn'),
    setupGuideBtn: document.getElementById('setupGuideBtn'),
    winModal: document.getElementById('winModal'),
    winSummary: document.getElementById('winSummary'),
    playAgainBtn: document.getElementById('playAgainBtn'),
    closeWinBtn: document.getElementById('closeWinBtn'),
    guideModal: document.getElementById('guideModal'),
    closeGuideBtn: document.getElementById('closeGuideBtn'),
    guideDoneBtn: document.getElementById('guideDoneBtn'),
    imageChecklist: document.getElementById('imageChecklist'),
    loadedCountText: document.getElementById('loadedCountText'),
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
    imageStatus: new Map()
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
   * Helpers
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
      state.imageStatus.set(cardData.filename, 'found');
      front.classList.remove('is-missing-image');
    });

    img.addEventListener('error', function () {
      state.imageStatus.set(cardData.filename, 'missing');
      front.classList.add('is-missing-image');
    });

    // Clean fallback if the user has not dropped their image into images/ yet
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
        setTimeout(function () {
          playWinSound();
          showWinModal();
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
   * Modals & Setup Checklist
   * ------------------------------------------------------------------------ */
  function showWinModal() {
    els.winSummary.innerHTML =
      'You found all <strong class="tabular">' +
      state.pairCount +
      '</strong> matching pairs in <strong class="tabular">' +
      state.moves +
      '</strong> moves!';
    els.winModal.hidden = false;
    els.playAgainBtn.focus();
  }

  function hideWinModal() {
    els.winModal.hidden = true;
  }

  function probeConfiguredImages(callback) {
    const filenames = getConfiguredImages();
    if (filenames.length === 0) {
      callback();
      return;
    }

    let completed = 0;
    filenames.forEach(function (filename) {
      const tester = new Image();
      tester.onload = function () {
        state.imageStatus.set(filename, 'found');
        completed += 1;
        if (completed === filenames.length) callback();
      };
      tester.onerror = function () {
        state.imageStatus.set(filename, 'missing');
        completed += 1;
        if (completed === filenames.length) callback();
      };
      tester.src = buildImagePath(filename);
    });
  }

  function renderImageChecklist() {
    const filenames = getConfiguredImages();
    els.imageChecklist.innerHTML = '';

    let foundCount = 0;
    filenames.forEach(function (filename) {
      const status = state.imageStatus.get(filename) || 'missing';
      if (status === 'found') foundCount += 1;

      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = filename;

      const statusSpan = document.createElement('span');
      statusSpan.className = status === 'found' ? 'status-found' : 'status-missing';
      statusSpan.textContent = status === 'found' ? 'Ready' : 'Not added';

      li.appendChild(nameSpan);
      li.appendChild(statusSpan);
      els.imageChecklist.appendChild(li);
    });

    els.loadedCountText.textContent = foundCount + ' / ' + filenames.length;
  }

  function openGuideModal() {
    renderImageChecklist();
    els.guideModal.hidden = false;
    probeConfiguredImages(renderImageChecklist);
  }

  function closeGuideModal() {
    els.guideModal.hidden = true;
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

  els.restartBtn.addEventListener('click', startNewGame);
  els.playAgainBtn.addEventListener('click', startNewGame);
  els.closeWinBtn.addEventListener('click', hideWinModal);
  els.soundToggleBtn.addEventListener('click', toggleSound);

  els.setupGuideBtn.addEventListener('click', openGuideModal);
  els.closeGuideBtn.addEventListener('click', closeGuideModal);
  els.guideDoneBtn.addEventListener('click', closeGuideModal);

  els.winModal.addEventListener('click', function (e) {
    if (e.target === els.winModal) hideWinModal();
  });

  els.guideModal.addEventListener('click', function (e) {
    if (e.target === els.guideModal) closeGuideModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      hideWinModal();
      closeGuideModal();
    } else if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
      startNewGame();
    } else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) {
      toggleSound();
    }
  });

  populatePairOptions();
  createSnowflakes();
  startNewGame();
})();

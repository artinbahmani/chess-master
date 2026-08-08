'use strict';
/*
 * app.js — UI layer: board rendering, pointer input (drag-and-drop and
 * click-to-move), promotion picker, move list, material counter, PGN export,
 * settings persistence. Depends on engine.js (Game, WHITE, BLACK, FILES,
 * pieceColor) and ai.js (AI). Plain script — safe under file://.
 */
(function () {
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const MAT_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const LEVEL_NAME = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };
  const STORE_KEY = 'chess-master.settings';

  // ---- state -------------------------------------------------------------
  const settings = loadSettings();
  let game = new Game();
  let level = settings.level;
  let playerColor = settings.color;
  let orientation = settings.orientation;

  let selected = null;      // {r,c} of the selected square
  let selMoves = [];        // legal moves leaving the selected square
  let drag = null;          // {from:{r,c}, ghost, moved, x0, y0}
  let pendingPromo = null;  // candidate moves awaiting promotion choice
  let aiBusy = false;

  let rowsOrder = [0, 1, 2, 3, 4, 5, 6, 7];
  let colsOrder = [0, 1, 2, 3, 4, 5, 6, 7];

  // ---- dom ---------------------------------------------------------------
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status-bar');
  const moveTbody = document.querySelector('#move-table tbody');
  const matYou = document.getElementById('mat-you');
  const matAi = document.getElementById('mat-ai');
  const promoModal = document.getElementById('promo-modal');
  const difficultySel = document.getElementById('difficulty');
  const playAsSel = document.getElementById('play-as');
  const btnNew = document.getElementById('btn-new');
  const btnUndo = document.getElementById('btn-undo');
  const btnFlip = document.getElementById('btn-flip');
  const btnPgn = document.getElementById('btn-pgn');

  function loadSettings() {
    const def = { level: 2, color: 'w', orientation: 'w' };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return def;
      const s = JSON.parse(raw);
      return {
        level: [1, 2, 3, 4].includes(s.level) ? s.level : def.level,
        color: s.color === 'b' ? 'b' : 'w',
        orientation: s.orientation === 'b' ? 'b' : (s.color === 'b' ? 'b' : 'w')
      };
    } catch (e) {
      return def;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ level, color: playerColor, orientation }));
    } catch (e) { /* private mode etc. — settings just won't persist */ }
  }

  // ---- rendering ---------------------------------------------------------
  function render() {
    const st = game.status();
    rowsOrder = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    colsOrder = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    boardEl.innerHTML = '';

    const last = game.history.length ? game.history[game.history.length - 1].m : null;
    const checkSq = game.inCheck(game.turn) ? game.kingSquare(game.turn) : null;

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const r = rowsOrder[i];
        const c = colsOrder[j];
        const sq = document.createElement('div');
        sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        sq.dataset.r = r;
        sq.dataset.c = c;

        if (last && ((last.fr === r && last.fc === c) || (last.tr === r && last.tc === c))) sq.classList.add('last-move');
        if (checkSq && checkSq[0] === r && checkSq[1] === c) sq.classList.add('check');
        if (selected && selected.r === r && selected.c === c) sq.classList.add('selected');

        const target = selMoves.find(m => m.tr === r && m.tc === c);
        if (target) sq.classList.add((game.board[r][c] || target.ep) ? 'capture-hint' : 'hint');

        if (j === 0) {
          const lab = document.createElement('span');
          lab.className = 'coord rank';
          lab.textContent = String(8 - r);
          sq.appendChild(lab);
        }
        if (i === 7) {
          const lab = document.createElement('span');
          lab.className = 'coord file';
          lab.textContent = FILES[c];
          sq.appendChild(lab);
        }

        const p = game.board[r][c];
        if (p) {
          const el = document.createElement('span');
          el.className = 'piece ' + (pieceColor(p) === WHITE ? 'white' : 'black');
          el.textContent = GLYPH[p.toLowerCase()];
          sq.appendChild(el);
        }
        boardEl.appendChild(sq);
      }
    }
    updateSize();
    renderMoves();
    renderMaterial();
    renderStatus(st);
  }

  function updateSize() {
    boardEl.style.setProperty('--sq', (boardEl.clientWidth / 8) + 'px');
  }

  function renderMoves() {
    let html = '';
    for (let i = 0; i < game.sanList.length; i += 2) {
      html += '<tr><td class="num">' + (i / 2 + 1) + '.</td><td>' + game.sanList[i] + '</td><td>' +
        (game.sanList[i + 1] || '') + '</td></tr>';
    }
    moveTbody.innerHTML = html;
    const scroller = moveTbody.closest('.moves-scroll');
    scroller.scrollTop = scroller.scrollHeight;
  }

  function renderMaterial() {
    const init = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const on = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = game.board[r][c];
        if (p && p.toLowerCase() !== 'k') on[pieceColor(p)][p.toLowerCase()]++;
      }
    }
    const score =
      Object.keys(MAT_VAL).reduce((s, k) => s + MAT_VAL[k] * on.w[k], 0) -
      Object.keys(MAT_VAL).reduce((s, k) => s + MAT_VAL[k] * on.b[k], 0);

    // What each side has captured = what the opponent is missing.
    const row = (label, missingOf, lead) => {
      let icons = '';
      for (const k of ['q', 'r', 'b', 'n', 'p']) {
        for (let n = 0; n < init[k] - on[missingOf][k]; n++) {
          icons += '<span class="cap ' + (missingOf === 'w' ? 'white' : 'black') + '">' + GLYPH[k] + '</span>';
        }
      }
      return '<span class="mat-label">' + label + '</span>' +
        '<span class="mat-icons">' + (icons || '<span class="none">—</span>') + '</span>' +
        (lead ? '<span class="mat-score">' + lead + '</span>' : '');
    };

    const meWhite = playerColor === 'w';
    const myLead = meWhite ? score : -score;
    matYou.innerHTML = row('You captured', meWhite ? 'b' : 'w', myLead > 0 ? '+' + myLead : '');
    matAi.innerHTML = row('AI captured', meWhite ? 'w' : 'b', myLead < 0 ? '+' + (-myLead) : '');
  }

  function renderStatus(st) {
    if (aiBusy) {
      statusEl.innerHTML = '<span class="thinking"></span> AI (' + LEVEL_NAME[level] + ') is thinking…';
      return;
    }
    const youWhite = playerColor === 'w';
    if (st.over) {
      let msg;
      if (st.reason === 'checkmate') {
        const whiteWon = st.result === '1-0';
        const youWon = whiteWon === youWhite;
        msg = 'Checkmate — ' + (youWon ? 'you win!' : 'AI wins.');
      } else {
        msg = 'Draw — ' + st.reason + '.';
      }
      statusEl.innerHTML = '<b>' + msg + '</b> ' + st.result + ' · <span class="dim">N for a new game</span>';
      return;
    }
    const turn = game.turn === 'w' ? 'White' : 'Black';
    const yours = game.turn === playerColor;
    statusEl.textContent = turn + ' to move' + (yours ? ' — your turn' : '') + (st.check ? ' · check!' : '');
  }

  // ---- moves & flow ------------------------------------------------------
  function canPlay() {
    return !aiBusy && !pendingPromo && game.turn === playerColor && !game.status().over;
  }

  function select(sq) {
    selected = sq;
    selMoves = game.legalMoves(game.turn).filter(m => m.fr === sq.r && m.fc === sq.c);
    render();
  }

  function clearSelection() {
    selected = null;
    selMoves = [];
  }

  // Several candidate moves from->to only when promoting; otherwise exactly one.
  function commitOrAskPromo(moves) {
    if (moves[0].promo) {
      pendingPromo = moves;
      showPromo();
      return;
    }
    game.makeMove(moves[0]);
    postMove();
  }

  function postMove() {
    clearSelection();
    render();
    const st = game.status();
    if (!st.over && game.turn !== playerColor) queueAi();
  }

  function queueAi() {
    aiBusy = true;
    renderStatus(game.status());
    // Defer so the board paints before the (blocking) search runs.
    setTimeout(() => {
      const m = AI.choose(game, level);
      if (m) game.makeMove(m);
      aiBusy = false;
      postMove();
    }, 60);
  }

  function takeback() {
    if (aiBusy || pendingPromo || !game.history.length) return;
    game.undoMove();
    // Vs the AI a takeback should return to the player's turn.
    while (game.history.length && game.turn !== playerColor) game.undoMove();
    postMove();
  }

  function newGame() {
    if (aiBusy) return;
    if (pendingPromo) hidePromo(); // dismiss a pending promotion picker first
    game = new Game();
    clearSelection();
    postMove();
  }

  function flip() {
    orientation = orientation === 'w' ? 'b' : 'w';
    saveSettings();
    render();
  }

  // ---- promotion picker --------------------------------------------------
  function showPromo() {
    promoModal.querySelectorAll('button').forEach(btn => {
      btn.textContent = GLYPH[btn.dataset.p];
      btn.className = 'promo-btn ' + (playerColor === 'w' ? 'white' : 'black');
    });
    promoModal.classList.remove('hidden');
  }

  function hidePromo() {
    promoModal.classList.add('hidden');
    pendingPromo = null;
    clearSelection();
    render();
  }

  promoModal.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!pendingPromo) return hidePromo();
      const m = pendingPromo.find(x => x.promo === btn.dataset.p) || pendingPromo[0];
      promoModal.classList.add('hidden');
      pendingPromo = null;
      game.makeMove(m);
      postMove();
    });
  });

  // Clicking the backdrop cancels the pending promotion, same as Escape.
  promoModal.addEventListener('click', (e) => {
    if (e.target === promoModal && pendingPromo) hidePromo();
  });

  // ---- input: click-to-move + drag-and-drop ------------------------------
  function squareFromPoint(x, y) {
    const rect = boardEl.getBoundingClientRect();
    const sq = rect.width / 8;
    const j = Math.floor((x - rect.left) / sq);
    const i = Math.floor((y - rect.top) / sq);
    if (i < 0 || i > 7 || j < 0 || j > 7) return null;
    return { r: rowsOrder[i], c: colsOrder[j] };
  }

  boardEl.addEventListener('pointerdown', (e) => {
    if (pendingPromo) return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();

    // Second click of click-to-move: target of the selected piece.
    if (selected && !aiBusy) {
      const mv = selMoves.filter(m => m.tr === sq.r && m.tc === sq.c);
      if (mv.length) { commitOrAskPromo(mv); return; }
    }

    const p = game.board[sq.r][sq.c];
    if (p && pieceColor(p) === playerColor && canPlay()) {
      select(sq);
      startDrag(sq, e, p);
    } else if (selected) {
      clearSelection();
      render();
    }
  });

  function startDrag(sq, e, pieceChar) {
    const ghost = document.createElement('span');
    ghost.className = 'drag-ghost ' + (pieceColor(pieceChar) === WHITE ? 'white' : 'black');
    ghost.textContent = GLYPH[pieceChar.toLowerCase()];
    ghost.style.fontSize = boardEl.style.getPropertyValue('--sq') ?
      'calc(' + boardEl.style.getPropertyValue('--sq') + ' * 0.74)' : '48px';
    document.body.appendChild(ghost);
    drag = { from: sq, ghost, moved: false, x0: e.clientX, y0: e.clientY };
    moveGhost(e.clientX, e.clientY);
  }

  function moveGhost(x, y) {
    const half = boardEl.clientWidth / 16;
    drag.ghost.style.transform = 'translate(' + (x - half) + 'px,' + (y - half) + 'px)';
  }

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) {
      drag.moved = true;
      drag.ghost.classList.add('active');
    }
    if (drag.moved) moveGhost(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.remove();
    if (!d.moved || !canPlay()) return; // a plain click — selection already handled
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq || (sq.r === d.from.r && sq.c === d.from.c)) return;
    const mv = selMoves.filter(m => m.tr === sq.r && m.tc === sq.c);
    if (mv.length) commitOrAskPromo(mv);
  });

  window.addEventListener('resize', updateSize);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pendingPromo) hidePromo();
      else if (selected) { clearSelection(); render(); }
      return;
    }
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') newGame();
    else if (k === 'u') takeback();
    else if (k === 'f') flip();
  });

  // ---- pgn export --------------------------------------------------------
  function buildPgn() {
    const st = game.status();
    const result = st.over ? st.result : '*';
    const d = new Date();
    const date = d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
    const aiTag = 'AI (' + LEVEL_NAME[level] + ')';
    const whiteName = playerColor === 'w' ? 'You' : aiTag;
    const blackName = playerColor === 'w' ? aiTag : 'You';
    let out = '[Event "Casual game — Chess Master"]\n[Site "chess-master (local)"]\n[Date "' + date + '"]\n' +
      '[White "' + whiteName + '"]\n[Black "' + blackName + '"]\n[Result "' + result + '"]\n\n';
    for (let i = 0; i < game.sanList.length; i += 2) {
      out += (i / 2 + 1) + '. ' + game.sanList[i] + (game.sanList[i + 1] ? ' ' + game.sanList[i + 1] : '') + ' ';
    }
    return out + result;
  }

  function copyPgn() {
    const pgn = buildPgn();
    const done = () => flash(btnPgn, 'Copied!');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pgn).then(done, () => fallbackCopy(pgn, done));
    } else {
      fallbackCopy(pgn, done);
    }
  }

  // Fallback for contexts where the async clipboard API is unavailable.
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { flash(btnPgn, 'Copy failed'); }
    ta.remove();
  }

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1200);
  }

  // ---- wiring ------------------------------------------------------------
  difficultySel.value = String(level);
  playAsSel.value = playerColor;
  difficultySel.addEventListener('change', () => {
    level = parseInt(difficultySel.value, 10);
    saveSettings();
  });
  playAsSel.addEventListener('change', () => {
    playerColor = playAsSel.value === 'b' ? 'b' : 'w';
    orientation = playerColor;
    saveSettings();
    newGame(); // switching sides starts a fresh game
  });
  btnNew.addEventListener('click', newGame);
  btnUndo.addEventListener('click', takeback);
  btnFlip.addEventListener('click', flip);
  btnPgn.addEventListener('click', copyPgn);

  // Go.
  postMove();
})();

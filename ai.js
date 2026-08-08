'use strict';
/*
 * ai.js — negamax with alpha-beta pruning, piece-square-table evaluation,
 * quiescence-lite (captures only, limited depth), MVV-LVA move ordering,
 * and a node/time budget so deep levels never freeze the UI.
 * Depends on engine.js globals: Game, WHITE, BLACK, pieceColor.
 */

const AI = (() => {
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const MATE = 100000;

  // Piece-square tables, indexed [row][col] with row 0 = rank 8, from White's
  // perspective (black mirrors vertically). Classic simplified evaluation set.
  const PST = {
    p: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [50, 50, 50, 50, 50, 50, 50, 50],
      [10, 10, 20, 30, 30, 20, 10, 10],
      [5, 5, 10, 25, 25, 10, 5, 5],
      [0, 0, 0, 20, 20, 0, 0, 0],
      [5, -5, -10, 0, 0, -10, -5, 5],
      [5, 10, 10, -20, -20, 10, 10, 5],
      [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    n: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20, 0, 0, 0, 0, -20, -40],
      [-30, 0, 10, 15, 15, 10, 0, -30],
      [-30, 5, 15, 20, 20, 15, 5, -30],
      [-30, 0, 15, 20, 20, 15, 0, -30],
      [-30, 5, 10, 15, 15, 10, 5, -30],
      [-40, -20, 0, 5, 5, 0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    b: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 10, 10, 5, 0, -10],
      [-10, 5, 5, 10, 10, 5, 5, -10],
      [-10, 0, 10, 10, 10, 10, 0, -10],
      [-10, 10, 10, 10, 10, 10, 10, -10],
      [-10, 5, 0, 0, 0, 0, 5, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    r: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [5, 10, 10, 10, 10, 10, 10, 5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [0, 0, 0, 5, 5, 0, 0, 0]
    ],
    q: [
      [-20, -10, -10, -5, -5, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 5, 5, 5, 0, -10],
      [-5, 0, 5, 5, 5, 5, 0, -5],
      [0, 0, 5, 5, 5, 5, 0, -5],
      [-10, 5, 5, 5, 5, 5, 0, -10],
      [-10, 0, 5, 0, 0, 0, 0, -10],
      [-20, -10, -10, -5, -5, -10, -10, -20]
    ],
    k: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [20, 20, 0, 0, 0, 0, 20, 20],
      [20, 30, 10, 0, 0, 10, 30, 20]
    ]
  };

  // Difficulty: search depth, root randomness window (centipawns), time budget.
  const LEVELS = {
    1: { depth: 1, noise: 150, time: 500 },
    2: { depth: 2, noise: 25, time: 1500 },
    3: { depth: 3, noise: 0, time: 4000 },
    4: { depth: 4, noise: 0, time: 8000 }
  };

  let nodes = 0;
  let deadline = 0;

  class SearchAbort extends Error {}

  function checkTime() {
    nodes++;
    if ((nodes & 1023) === 0 && Date.now() > deadline) throw new SearchAbort();
  }

  // Static evaluation in centipawns, from White's perspective.
  function evaluate(game) {
    let s = 0;
    const b = game.board;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (!p) continue;
        const white = p === p.toUpperCase();
        const kind = p.toLowerCase();
        const v = VAL[kind] + (white ? PST[kind][r][c] : PST[kind][7 - r][c]);
        s += white ? v : -v;
      }
    }
    return s;
  }

  // MVV-LVA-ish ordering: good captures and promotions first.
  function orderMoves(moves) {
    for (const m of moves) {
      let s = 0;
      if (m.captured) s = 10 * VAL[m.captured.toLowerCase()] - VAL[m.piece.toLowerCase()];
      if (m.promo) s += 900 + VAL[m.promo];
      m._s = s;
    }
    moves.sort((a, b) => b._s - a._s);
    return moves;
  }

  function quiesce(game, alpha, beta, qd) {
    checkTime();
    const stand = (game.turn === WHITE ? 1 : -1) * evaluate(game);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qd <= 0) return alpha;
    const caps = game.legalMoves(game.turn).filter(m => m.captured || m.promo);
    orderMoves(caps);
    for (const m of caps) {
      game.doMove(m);
      const s = -quiesce(game, -beta, -alpha, qd - 1);
      game.undo();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function search(game, depth, alpha, beta, ply) {
    checkTime();
    if (game.halfmove >= 100) return 0;
    if (depth <= 0) return quiesce(game, alpha, beta, 2);
    const moves = orderMoves(game.legalMoves(game.turn));
    if (!moves.length) return game.inCheck(game.turn) ? -MATE + ply : 0;
    let best = -Infinity;
    for (const m of moves) {
      game.doMove(m);
      const s = -search(game, depth - 1, -beta, -alpha, ply + 1);
      game.undo();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Pick a move for the side to move. `level` is 1..4.
  function choose(game, level) {
    const cfg = LEVELS[level] || LEVELS[2];
    nodes = 0;
    deadline = Date.now() + cfg.time;
    const moves = orderMoves(game.legalMoves(game.turn));
    if (!moves.length) return null;

    let best = null;
    let bestScore = -Infinity;
    const scored = [];
    try {
      for (const m of moves) {
        game.doMove(m);
        const s = -search(game, cfg.depth - 1, -Infinity, Infinity, 1);
        game.undo();
        scored.push({ m, s });
        if (s > bestScore) { bestScore = s; best = m; }
      }
    } catch (e) {
      if (!(e instanceof SearchAbort)) throw e;
      // Time ran out mid-root: keep the best fully-searched move.
    }
    if (!best) best = moves[0];

    if (cfg.noise > 0 && scored.length) {
      // Easy/Medium: pick at random among near-best moves for human variety.
      const pool = scored.filter(x => x.s >= bestScore - cfg.noise);
      return pool[Math.floor(Math.random() * pool.length)].m;
    }
    return best;
  }

  return { choose, evaluate, LEVELS };
})();

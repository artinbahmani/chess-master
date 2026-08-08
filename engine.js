'use strict';
/*
 * engine.js — complete chess rules engine.
 * Board: 8x8 array, board[0] is rank 8 (top). Pieces are single chars:
 * uppercase = white (P N B R Q K), lowercase = black. null = empty.
 * No dependencies; used by app.js (UI) and ai.js (search).
 */

const WHITE = 'w';
const BLACK = 'b';
const FILES = 'abcdefgh';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_D = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const BISHOP_D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_D = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function pieceColor(p) {
  return p === p.toUpperCase() ? WHITE : BLACK;
}

/*
 * A move is a plain object:
 * { fr, fc, tr, tc, piece, captured, promo, ep, castle, double }
 *  - captured: captured piece char or null (en passant stores the pawn char)
 *  - promo: 'q'|'r'|'b'|'n' or null
 *  - ep: true for en passant captures
 *  - castle: 'K'|'Q'|null
 *  - double: true for a two-square pawn push (sets the en passant target)
 */
class Game {
  constructor(fen) {
    this.load(fen || START_FEN);
  }

  load(fen) {
    const parts = fen.trim().split(/\s+/);
    this.board = [];
    const rows = parts[0].split('/');
    for (let r = 0; r < 8; r++) {
      this.board[r] = new Array(8).fill(null);
      let c = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          c += parseInt(ch, 10);
        } else {
          this.board[r][c] = ch;
          c++;
        }
      }
    }
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    this.castling = parts[2] && parts[2] !== '-' ? parts[2] : '';
    this.ep = parts[3] && parts[3] !== '-' ? this.squareFromAlg(parts[3]) : null;
    this.halfmove = parseInt(parts[4] || '0', 10);
    this.fullmove = parseInt(parts[5] || '1', 10);
    this.history = [];      // undo records
    this.sanList = [];      // SAN strings for every played move
    this.posCounts = new Map(); // position key -> occurrence count (threefold)
    this.posCounts.set(this.positionKey(), 1);
  }

  squareFromAlg(s) {
    return [8 - parseInt(s[1], 10), FILES.indexOf(s[0])];
  }

  alg(r, c) {
    return FILES[c] + (8 - r);
  }

  inB(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  get(r, c) {
    return this.inB(r, c) ? this.board[r][c] : null;
  }

  // FEN-like key used for repetition detection (board + side + rights + ep).
  positionKey() {
    let out = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p) {
          if (empty) { row += empty; empty = 0; }
          row += p;
        } else {
          empty++;
        }
      }
      if (empty) row += empty;
      out.push(row);
    }
    return out.join('/') + ' ' + this.turn + ' ' + (this.castling || '-') +
      ' ' + (this.ep ? this.alg(this.ep[0], this.ep[1]) : '-');
  }

  fen() {
    return this.positionKey() + ' ' + this.halfmove + ' ' + this.fullmove;
  }

  kingSquare(color) {
    const k = color === WHITE ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.board[r][c] === k) return [r, c];
      }
    }
    return null;
  }

  inCheck(color) {
    const k = this.kingSquare(color);
    return k ? this.isAttacked(k[0], k[1], color === WHITE ? BLACK : WHITE) : false;
  }

  // Is square (r,c) attacked by any piece of color `by`?
  isAttacked(r, c, by) {
    // Pawns: a white pawn attacking (r,c) sits one rank below it (r+1).
    const pr = by === WHITE ? r + 1 : r - 1;
    const pawn = by === WHITE ? 'P' : 'p';
    for (const dc of [-1, 1]) {
      if (this.get(pr, c + dc) === pawn) return true;
    }
    const knight = by === WHITE ? 'N' : 'n';
    for (const [dr, dc] of KNIGHT_D) {
      if (this.get(r + dr, c + dc) === knight) return true;
    }
    const king = by === WHITE ? 'K' : 'k';
    for (const [dr, dc] of KING_D) {
      if (this.get(r + dr, c + dc) === king) return true;
    }
    // Sliders: walk each ray until blocked.
    for (const [dirs, kinds] of [[BISHOP_D, 'bq'], [ROOK_D, 'rq']]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (this.inB(rr, cc)) {
          const p = this.board[rr][cc];
          if (p) {
            if (pieceColor(p) === by && kinds.includes(p.toLowerCase())) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
    }
    return false;
  }

  // Pseudo-legal moves: may leave own king in check; filter via legalMoves().
  pseudoMoves(color) {
    const moves = [];
    const b = this.board;
    const dir = color === WHITE ? -1 : 1;
    const startRow = color === WHITE ? 6 : 1;
    const promoRow = color === WHITE ? 0 : 7;
    const mk = (fr, fc, tr, tc, piece, captured, promo, ep, castle, dbl) =>
      moves.push({ fr, fc, tr, tc, piece, captured, promo, ep, castle, double: dbl });

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (!p || pieceColor(p) !== color) continue;
        const kind = p.toLowerCase();

        if (kind === 'p') {
          const r1 = r + dir;
          if (this.inB(r1, c) && !b[r1][c]) {
            if (r1 === promoRow) {
              for (const promo of ['q', 'r', 'b', 'n']) mk(r, c, r1, c, p, null, promo, false, null, false);
            } else {
              mk(r, c, r1, c, p, null, null, false, null, false);
              if (r === startRow && !b[r + 2 * dir][c]) mk(r, c, r + 2 * dir, c, p, null, null, false, null, true);
            }
          }
          for (const dc of [-1, 1]) {
            const cc = c + dc;
            if (!this.inB(r1, cc)) continue;
            const t = b[r1][cc];
            if (t && pieceColor(t) !== color) {
              if (r1 === promoRow) {
                for (const promo of ['q', 'r', 'b', 'n']) mk(r, c, r1, cc, p, t, promo, false, null, false);
              } else {
                mk(r, c, r1, cc, p, t, null, false, null, false);
              }
            } else if (this.ep && this.ep[0] === r1 && this.ep[1] === cc) {
              mk(r, c, r1, cc, p, color === WHITE ? 'p' : 'P', null, true, null, false);
            }
          }
        } else if (kind === 'n' || kind === 'k') {
          const dirs = kind === 'n' ? KNIGHT_D : KING_D;
          for (const [dr, dc] of dirs) {
            const rr = r + dr;
            const cc = c + dc;
            if (!this.inB(rr, cc)) continue;
            const t = b[rr][cc];
            if (!t) mk(r, c, rr, cc, p, null, null, false, null, false);
            else if (pieceColor(t) !== color) mk(r, c, rr, cc, p, t, null, false, null, false);
          }
          if (kind === 'k') this.castleMoves(moves, color, r, c);
        } else {
          const dirs = kind === 'b' ? BISHOP_D : kind === 'r' ? ROOK_D : BISHOP_D.concat(ROOK_D);
          for (const [dr, dc] of dirs) {
            let rr = r + dr;
            let cc = c + dc;
            while (this.inB(rr, cc)) {
              const t = b[rr][cc];
              if (!t) {
                mk(r, c, rr, cc, p, null, null, false, null, false);
              } else {
                if (pieceColor(t) !== color) mk(r, c, rr, cc, p, t, null, false, null, false);
                break;
              }
              rr += dr;
              cc += dc;
            }
          }
        }
      }
    }
    return moves;
  }

  castleMoves(moves, color, r, c) {
    const b = this.board;
    const home = color === WHITE ? 7 : 0;
    const opp = color === WHITE ? BLACK : WHITE;
    if (r !== home || c !== 4) return;
    if (this.isAttacked(home, 4, opp)) return; // can't castle out of check
    const rights = color === WHITE ? 'KQ' : 'kq';
    const rook = color === WHITE ? 'R' : 'r';
    // King side: squares f,g empty, not attacked, rook on h.
    if (this.castling.includes(rights[0]) && !b[home][5] && !b[home][6] &&
        b[home][7] === rook &&
        !this.isAttacked(home, 5, opp) && !this.isAttacked(home, 6, opp)) {
      moves.push({ fr: home, fc: 4, tr: home, tc: 6, piece: b[home][4], captured: null, promo: null, ep: false, castle: 'K', double: false });
    }
    // Queen side: squares b,c,d empty, c,d not attacked, rook on a.
    if (this.castling.includes(rights[1]) && !b[home][1] && !b[home][2] && !b[home][3] &&
        b[home][0] === rook &&
        !this.isAttacked(home, 3, opp) && !this.isAttacked(home, 2, opp)) {
      moves.push({ fr: home, fc: 4, tr: home, tc: 2, piece: b[home][4], captured: null, promo: null, ep: false, castle: 'Q', double: false });
    }
  }

  // Fully legal moves for `color` (king safety enforced).
  legalMoves(color) {
    const out = [];
    for (const m of this.pseudoMoves(color)) {
      this.doMove(m);
      if (!this.inCheck(color)) out.push(m);
      this.undo();
    }
    return out;
  }

  // Low-level apply: switches side, updates rights/clocks/ep, records undo.
  doMove(m) {
    const u = { m, castling: this.castling, ep: this.ep, halfmove: this.halfmove, fullmove: this.fullmove, capSq: null, key: null };
    const b = this.board;
    const movingWhite = m.piece === m.piece.toUpperCase();

    b[m.fr][m.fc] = null;
    b[m.tr][m.tc] = m.promo ? (movingWhite ? m.promo.toUpperCase() : m.promo.toLowerCase()) : m.piece;
    if (m.ep) {
      u.capSq = [m.fr, m.tc]; // captured pawn sits beside the mover
      b[m.fr][m.tc] = null;
    }
    if (m.castle === 'K') { b[m.tr][5] = b[m.tr][7]; b[m.tr][7] = null; }
    if (m.castle === 'Q') { b[m.tr][3] = b[m.tr][0]; b[m.tr][0] = null; }

    // Castling rights: touched king or corner squares strip the right.
    let rights = this.castling;
    const from = this.alg(m.fr, m.fc);
    const to = this.alg(m.tr, m.tc);
    if (from === 'e1' || to === 'e1') rights = rights.replace('K', '').replace('Q', '');
    if (from === 'e8' || to === 'e8') rights = rights.replace('k', '').replace('q', '');
    if (from === 'h1' || to === 'h1') rights = rights.replace('K', '');
    if (from === 'a1' || to === 'a1') rights = rights.replace('Q', '');
    if (from === 'h8' || to === 'h8') rights = rights.replace('k', '');
    if (from === 'a8' || to === 'a8') rights = rights.replace('q', '');
    this.castling = rights;

    this.ep = m.double ? [(m.fr + m.tr) / 2, m.fc] : null;
    this.halfmove = (m.piece.toLowerCase() === 'p' || m.captured) ? 0 : this.halfmove + 1;
    if (this.turn === BLACK) this.fullmove++;
    this.turn = this.turn === WHITE ? BLACK : WHITE;

    u.key = this.positionKey();
    this.posCounts.set(u.key, (this.posCounts.get(u.key) || 0) + 1);
    this.history.push(u);
  }

  undo() {
    const u = this.history.pop();
    if (!u) return;
    const m = u.m;
    const b = this.board;
    this.turn = this.turn === WHITE ? BLACK : WHITE;

    const n = this.posCounts.get(u.key);
    if (n > 1) this.posCounts.set(u.key, n - 1);
    else this.posCounts.delete(u.key);

    b[m.fr][m.fc] = m.piece;
    b[m.tr][m.tc] = m.ep ? null : m.captured;
    if (m.ep) b[u.capSq[0]][u.capSq[1]] = m.captured;
    if (m.castle === 'K') { b[m.tr][7] = b[m.tr][5]; b[m.tr][5] = null; }
    if (m.castle === 'Q') { b[m.tr][0] = b[m.tr][3]; b[m.tr][3] = null; }

    this.castling = u.castling;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
    this.fullmove = u.fullmove;
  }

  // Public move entry point: computes SAN (with +/# suffix) and applies.
  makeMove(m) {
    let s = this.san(m);
    this.doMove(m);
    if (this.inCheck(this.turn)) s += this.legalMoves(this.turn).length ? '+' : '#';
    this.sanList.push(s);
  }

  // Take back the last move (and its SAN entry). Returns false if none.
  undoMove() {
    if (!this.history.length) return false;
    this.undo();
    this.sanList.pop();
    return true;
  }

  // SAN for a move, computed against the CURRENT position (before applying).
  san(m) {
    if (m.castle === 'K') return 'O-O';
    if (m.castle === 'Q') return 'O-O-O';
    const dest = this.alg(m.tr, m.tc);
    let s;
    if (m.piece.toLowerCase() === 'p') {
      s = m.captured ? FILES[m.fc] + 'x' + dest : dest;
    } else {
      s = m.piece.toUpperCase();
      const others = this.legalMoves(this.turn).filter(x =>
        x.piece === m.piece && x.tr === m.tr && x.tc === m.tc &&
        !(x.fr === m.fr && x.fc === m.fc));
      if (others.length) {
        const sameFile = others.some(x => x.fc === m.fc);
        const sameRank = others.some(x => x.fr === m.fr);
        if (!sameFile) s += FILES[m.fc];
        else if (!sameRank) s += String(8 - m.fr);
        else s += FILES[m.fc] + String(8 - m.fr);
      }
      if (m.captured) s += 'x';
      s += dest;
    }
    if (m.promo) s += '=' + m.promo.toUpperCase();
    return s;
  }

  // K vs K, or K + single minor vs K.
  insufficientMaterial() {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.toLowerCase() !== 'k') pieces.push(p.toLowerCase());
      }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n')) return true;
    return false;
  }

  // Full game state for the side to move.
  status() {
    const moves = this.legalMoves(this.turn);
    const check = this.inCheck(this.turn);
    if (!moves.length) {
      return check
        ? { over: true, result: this.turn === WHITE ? '0-1' : '1-0', reason: 'checkmate', check: true }
        : { over: true, result: '1/2-1/2', reason: 'stalemate', check: false };
    }
    if (this.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: '50-move rule', check };
    if ((this.posCounts.get(this.positionKey()) || 0) >= 3) {
      return { over: true, result: '1/2-1/2', reason: 'threefold repetition', check };
    }
    if (this.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material', check };
    return { over: false, result: null, reason: null, check };
  }
}

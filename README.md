# chess-master

Full-rules chess vs an in-browser AI: castling, en passant, promotion picker, draws, minimax with alpha-beta. Vanilla JS, no dependencies

## Features

- Complete rule set: legal move generation with king-safety filtering, castling (rights tracking, through-check rules), en passant, promotion with a piece picker
- Game-end detection: checkmate, stalemate, threefold repetition, 50-move rule, insufficient material
- AI with negamax + alpha-beta pruning, piece-square-table evaluation, MVV-LVA move ordering and quiescence-lite (capture search, 2 plies past the horizon)
- 4 difficulty levels: depth 1–4, with a randomness window on Easy/Medium and a per-move time budget so deep levels never freeze the UI
- Drag-and-drop and click-to-move input with touch support (pointer events)
- Legal move dots and capture rings, last-move highlight, check highlight
- Move list in SAN notation (with disambiguation and +/# suffixes)
- Takeback vs the AI (rolls back to your turn), undo-safe engine internals
- PGN export to clipboard with headers and result
- Material counter showing captured pieces and point lead
- Flip board, play as White or Black, difficulty persisted in localStorage
- Unicode pieces with styled rendering — zero external assets

## Run

Open index.html in any modern browser. No build step, no dependencies.

## Controls / Usage

- Drag a piece, or click it then click a target square; dots mark legal moves
- **N** new game · **U** takeback · **F** flip board · **Esc** cancel selection/promotion
- Sidebar: difficulty (Easy→Expert), play as White/Black, New Game, Takeback, Flip Board, Copy PGN

## Tech notes

- The engine is a dependency-free class (`engine.js`) with make/undo on a single 8×8 board; every move records enough state (castling rights, ep target, clocks, position key) for instant, exact takebacks
- Repetition detection hashes board + side + castling + en-passant into a position key and counts occurrences in a Map, updated symmetrically by make/undo
- The AI (`ai.js`) is negamax with alpha-beta and a time-budget abort: if the deadline hits mid-root, the best fully-searched move is kept, so Expert stays responsive
- SAN generation computes disambiguation by re-running legal move generation for same-type pieces targeting the same square — simple and always correct

## Roadmap

- Iterative deepening with an on-screen evaluation bar and principal variation
- Small opening book so the AI varies its first moves
- Game clocks (blitz/rapid) with flag-fall detection
- Sound effects and piece-drag animations (smooth slide on AI moves)
- Hint button that shows the engine's best move for the human side
- Board/piece theme picker persisted alongside the other settings

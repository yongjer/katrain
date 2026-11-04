# KaTrain 2 (Tauri v2 + React + TypeScript)

This branch ports KaTrain from Python + Kivy to a [Tauri v2](https://v2.tauri.app/) desktop app.
The Python sources under `katrain/` are kept for now as the reference implementation and because the new app
reuses their assets directly (KataGo binaries and config, the default model, `config.json` defaults,
the `.po` translations and the sounds).

## Architecture

```
src/core/        Game logic, ported 1:1 from katrain/core and pysgf (no UI or Tauri dependencies)
  move.ts          pysgf.Move
  sgf.ts           SGF / NGF / GIB parsing, SGF writing
  gameNode.ts      game tree node + analysis bookkeeping (candidate moves, point loss, KT analysis cache)
  game.ts          board state and capture rules, navigation, analysis requests and extra analysis modes
  engine.ts        KataGo analysis-engine client: query ids, priorities, pondering, result dispatch
  ai.ts            AI strategies and rank estimation
  i18n.ts          gettext lookup + Python-style format strings
src/state/       zustand store and the controller logic from katrain/__main__.py (AI turns, pondering, files)
src/ui/          React components (SVG board, graph, panels, dialogs)
src-tauri/       Rust backend: spawns KataGo and streams its stdout/stderr as events, reads/writes files
                 (with the same encoding detection as pysgf), stores the user config
```

The Rust side deliberately knows nothing about go: it only owns the KataGo process. KataGo's analysis engine
already speaks JSON over stdin/stdout, so the TypeScript `KataGoEngine` talks to it through a small
`EngineTransport` interface. The desktop app uses the Tauri transport; the tests use a `child_process`
transport, and `scripts/engine-bridge.mjs` provides one for working on the UI in a normal browser.

## Development

Prerequisites: Node 20+, Rust (stable), and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)
(on Debian/Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev libssl-dev`).

```sh
npm install
npm run tauri dev        # desktop app with hot reload
npm run tauri build      # installers in src-tauri/target/release/bundle
npm test                 # unit tests (parsing, rules, analysis bookkeeping, float16 packing vs. Python)
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

KataGo is bundled for Windows and Linux exactly as before (`katrain/KataGo`). On macOS it is looked up on `PATH`
and in Homebrew's folders (`brew install katago`), or set its path under *General & Engine Settings*.

UI work in a browser (no Tauri), with a real engine:

```sh
node scripts/engine-bridge.mjs     # runs KataGo on http://localhost:8765
npm run dev                        # open http://localhost:1420/?bridge=http://localhost:8765
```

End-to-end tests drive the real bundled KataGo from the TypeScript core:

```sh
KATAGO_E2E=1 npx vitest run tests-ts/engine.e2e.test.ts
```

## Status

Ported in this first phase:

- Board with eval dots, top-move hints (configurable stats, low-visit hints), PV preview on hover,
  next-move markers, policy heatmap, territory, move numbers, region of interest display
- SGF / NGF / GIB loading (with encoding detection) and SGF saving, including KaTrain's `KT` analysis cache
  (compatible with files written by the Python version) and feedback comments
- Analysis: per-move analysis, deeper analysis, equalize, sweep, alternatives, continuous (pondering),
  full game re-analysis, reset
- Score / win rate graph, move statistics, move info, details and notes
- Play against KataGo and the Calibrated Rank, Handicap, Score Loss, Policy, Policy Weighted, Blinded Policy,
  Local, Tenuki, Territorial and Influential AIs, with rank estimates and AI settings
- New game (size incl. non-square, handicap, komi, rules), general/engine/teaching settings, all 11 languages
- Keyboard shortcuts as in KaTrain (arrows/z/x, up/down branches, home/end, b, n, p, enter, space, q w e r t,
  a s d f h, m, tab, ctrl+n/l/s/d, F7, F8) and mouse wheel navigation

Not yet ported (next phase): teaching mode auto-undo, timers, the move tree widget, insert mode, self-play / setup
position, tsumego frame, the performance report, the Simple/Settle/Jigo/AntiMirror/Human-like/Historical Pro AIs,
the remote (WebSocket) engine, KataGo model/binary downloads, contribute mode, and clipboard copy/paste.
Until then the Python app remains in `katrain/` and still runs as before.

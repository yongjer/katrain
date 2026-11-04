// Application state and controller logic (the TypeScript counterpart of katrain/__main__.py's message loop).

import { create } from "zustand";
import { aiRankEstimation, generateAiMove, rankLabel } from "../core/ai";
import {
  MODE_ANALYZE,
  MODE_PLAY,
  PLAYER_AI,
  PLAYING_TEACHING,
  PLAYER_HUMAN,
  PRIORITY_GAME_ANALYSIS,
  SGF_INTERNAL_COMMENTS_MARKER,
  type Player,
  type PlayerType,
  type UiMode,
} from "../core/constants";
import { KataGoEngine, type LogLevel } from "../core/engine";
import { Game, IllegalMoveException, type ExtraAnalysisMode, type GameHost, type NewGameSettings, type StatusLevel } from "../core/game";
import type { GameNode } from "../core/gameNode";
import { t, tf } from "../core/i18n";
import { Move, type Coords } from "../core/move";
import { parseGameFile, parseSgf, writeSgf } from "../core/sgf";
import { addTsumegoFrame } from "../core/tsumego";
import { setLanguage } from "../ui/i18nLoader";
import { sounds } from "../ui/sounds";
import { parseSavedConfig, type AnalysisToggles, type AppConfig } from "./config";
import { platform } from "./platform";

export interface Status {
  message: string;
  level: StatusLevel;
}

export interface LogEntry {
  message: string;
  level: LogLevel;
}

export type DialogKind = null | "newgame" | "settings" | "ai" | "log" | "timer" | "tsumego";

/** What the clock shows: main time, or the current byo-yomi period and the periods left. */
export interface TimerState {
  paused: boolean;
  /** seconds left, of main time or of the current period */
  remaining: number;
  /** byo-yomi periods left, or null during main time */
  periods: number | null;
  /** the player on the clock is an AI */
  ai: boolean;
}

interface State {
  ready: boolean;
  config: AppConfig;
  game: Game | null;
  /** Incremented whenever the (mutable) game tree or analysis changes. */
  tick: number;
  mode: UiMode;
  pondering: boolean;
  aiThinking: boolean;
  status: Status | null;
  logs: LogEntry[];
  dialog: DialogKind;
  /** Loaded UI language; the app re-renders fully when it changes. */
  lang: string;
  timer: TimerState;
}

export const useStore = create<State>(() => ({
  ready: false,
  config: parseSavedConfig(null),
  game: null,
  tick: 0,
  mode: MODE_PLAY,
  pondering: false,
  aiThinking: false,
  status: null,
  logs: [],
  dialog: null,
  lang: "en",
  timer: { paused: true, remaining: 30, periods: 5, ai: false },
}));

const get = useStore.getState;
const set = useStore.setState;

// ---------------------------------------------------------------- logging & refresh
function log(message: string, level: LogLevel = "info") {
  if (level === "error") console.error(message);
  if (level === "debug" && get().config.general.debug_level < 1) return;
  set((s) => ({ logs: [...s.logs.slice(-499), { message, level }] }));
}

let refreshScheduled = false;
/** Re-render (at most once per frame) and run the AI / pondering logic. */
export function refresh() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  const run = () => {
    refreshScheduled = false;
    set((s) => ({ tick: s.tick + 1 }));
    updateState();
  };
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

export function setStatus(message: string, level: StatusLevel = "info") {
  set({ status: message ? { message, level } : null });
}

// ---------------------------------------------------------------- engine
let engine: KataGoEngine | null = null;
export function getEngine(): KataGoEngine | null {
  return engine;
}

const host: GameHost = {
  trainer: () => get().config.trainer,
  isAi: (p: Player) => get().config.ui.players[p].type === PLAYER_AI,
  setStatus: (m, l) => setStatus(m, l),
  log: (m) => log(m, "debug"),
};

async function startEngine() {
  const cfg = get().config;
  if (!engine) {
    engine = new KataGoEngine(platform.makeTransport(), cfg.engine, (m, l) => log(m, l));
    engine.subscribe(() => {
      if (engine?.state === "dead") setStatus(engine.lastError ?? "KataGo stopped", "error");
      refresh();
    });
    await engine.start();
  } else {
    await engine.restart(cfg.engine);
  }
}

// ---------------------------------------------------------------- AI & trainer loop
const mistakeSoundPlayed = new WeakSet<GameNode>();

function updateState() {
  const { game, mode, config, aiThinking, pondering } = get();
  if (!game) return;
  const cn = game.currentNode;
  const players = config.ui.players;
  if (mode === MODE_PLAY && cn.move) {
    const last = players[cn.player];
    const pl = cn.pointsLost;
    if (
      last.type === PLAYER_HUMAN &&
      cn.analysisComplete &&
      pl !== null &&
      pl > config.trainer.eval_thresholds.at(-4)! &&
      !mistakeSoundPlayed.has(cn)
    ) {
      mistakeSoundPlayed.add(cn);
      sounds.mistake();
    }
  }
  // teaching games: undo the human's move if it lost too many points
  const teaching =
    mode === MODE_PLAY && !!cn.move && !!cn.parent && players[cn.player].type === PLAYER_HUMAN && players[cn.player].subtype === PLAYING_TEACHING;
  if (teaching && cn.analysisComplete && cn.parent!.analysisComplete && !cn.children.length && !game.endResult) {
    if (game.analyzeUndo(cn)) {
      refresh();
      return;
    }
  }
  if (
    mode === MODE_PLAY &&
    !aiThinking &&
    get().dialog === null &&
    cn.analysisComplete &&
    players[cn.nextPlayer].type === PLAYER_AI &&
    !cn.children.length &&
    !game.endResult &&
    !(teaching && cn.autoUndo === null)
  ) {
    void aiMove(cn);
  }
  if (engine && engine.isAlive) {
    if (pondering) game.analyzeExtra("ponder");
    else engine.stopPondering();
  }
}

async function aiMove(node: GameNode) {
  const { game, config } = get();
  if (!game || game.currentNode !== node) return;
  const strategy = config.ui.players[node.nextPlayer].strategy;
  set({ aiThinking: true });
  try {
    const played = await generateAiMove(game, strategy, config.ai[strategy] ?? {});
    if (played && get().game === game) sounds.stone();
  } catch (e) {
    log(`AI move failed: ${e}`, "error");
    setStatus(`AI move failed: ${e}`, "error");
  } finally {
    set({ aiThinking: false });
    refresh();
  }
}

// ---------------------------------------------------------------- lifecycle
let initialized = false;
export async function init() {
  if (initialized) return;
  initialized = true;
  const config = parseSavedConfig(await platform.loadConfig().catch(() => null));
  await setLanguage(config.general.lang).catch(() => {});
  set({ config, ready: true, lang: config.general.lang });
  await startEngine();
  newGame(undefined, { fromConfig: true });
}

function persistConfig() {
  void platform.saveConfig(JSON.stringify(get().config, null, 2)).catch((e) => log(`Saving config failed: ${e}`, "error"));
}

export function updateConfig(mutator: (c: AppConfig) => void) {
  const config = structuredClone(get().config);
  const before = JSON.stringify(config.engine);
  const lang = config.general.lang;
  mutator(config);
  set({ config });
  persistConfig();
  if (config.general.lang !== lang) void setLanguage(config.general.lang).then(() => set({ lang: config.general.lang }));
  if (JSON.stringify(config.engine) !== before) {
    setStatus(t("restarting engine"), "info");
    void startEngine().then(() => {
      const game = get().game;
      if (!game) return;
      for (const n of game.root.nodesInTree) if (!n.analysisComplete) game.analyze(n, { priority: PRIORITY_GAME_ANALYSIS });
      refresh();
    });
  }
  refresh();
}

function startGame(game: Game, mode: UiMode) {
  const old = get().game;
  if (old) old.active = false;
  resetTimer();
  const engineError = engine && engine.state === "dead" ? engine.lastError : null;
  set({ game, mode, pondering: false, status: engineError ? { message: engineError, level: "error" } : null });
  refresh();
}

export function newGame(settings?: NewGameSettings, opts: { fromConfig?: boolean } = {}) {
  const cfg = get().config;
  const s: NewGameSettings = settings ?? {
    size: String(cfg.game.size),
    komi: cfg.game.komi,
    handicap: cfg.game.handicap,
    rules: cfg.game.rules,
  };
  if (settings && !opts.fromConfig) {
    updateConfig((c) => {
      c.game.size = settings.size;
      c.game.komi = settings.komi;
      c.game.handicap = settings.handicap;
      c.game.rules = settings.rules;
    });
  }
  engine?.onNewGame();
  startGame(new Game(host, engine, { newGame: s, analyzeFast: true }), MODE_PLAY);
}

export function loadGameFromString(contents: string, filename: string, path: string | null) {
  try {
    const tree = parseGameFile(contents, filename);
    engine?.onNewGame();
    const cfg = get().config;
    const game = new Game(host, engine, { moveTree: tree, sgfFilename: path, analyzeFast: cfg.general.load_fast_analysis });
    if (!cfg.general.load_sgf_rewind) game.redo(9999);
    // loaded games are reviewed by humans
    updateConfig((c) => {
      c.ui.players.B.type = PLAYER_HUMAN;
      c.ui.players.W.type = PLAYER_HUMAN;
    });
    startGame(game, MODE_ANALYZE);
    setStatus(`${filename}`, "info");
  } catch (e) {
    setStatus(tf("Failed to load SGF", { error: String(e) }), "error");
  }
}

export async function loadGame() {
  try {
    const file = await platform.openGameFile();
    if (file) loadGameFromString(file.contents, file.name, file.path);
  } catch (e) {
    setStatus(tf("Failed to load SGF", { error: String(e) }), "error");
  }
}

function playerName(p: Player): string | null {
  const setup = get().config.ui.players[p];
  if (setup.type !== PLAYER_AI) return null;
  return `${t(PLAYER_AI)} (${t(setup.strategy)})${SGF_INTERNAL_COMMENTS_MARKER}`;
}

export async function saveGame(saveAs = false) {
  const { game, config } = get();
  if (!game) return;
  game.updateRootProperties({ B: playerName("B"), W: playerName("W") });
  for (const p of ["B", "W"] as Player[]) {
    const setup = config.ui.players[p];
    if (setup.type === PLAYER_AI && !game.externalGame) {
      game.root.setProperty(`${p}R`, rankLabel(aiRankEstimation(setup.strategy, config.ai[setup.strategy] ?? {})));
    }
  }
  const showDotsFor = {
    B: config.trainer.eval_show_ai || config.ui.players.B.type === PLAYER_HUMAN,
    W: config.trainer.eval_show_ai || config.ui.players.W.type === PLAYER_HUMAN,
  };
  try {
    const sgf = game.toSgf(config.trainer, showDotsFor);
    const path = await platform.saveTextFile(sgf, game.generateFilename(), saveAs ? null : game.sgfFilename);
    if (path) {
      game.sgfFilename = platform.isDesktop ? path : null;
      setStatus(tf("sgf written", { file_name: path }), "info");
    }
  } catch (e) {
    setStatus(`Saving failed: ${e}`, "error");
  }
}

// ---------------------------------------------------------------- moves & navigation
export function playAt(coords: Coords | null) {
  const { game, config, mode } = get();
  if (!game) return;
  const cn = game.currentNode;
  const minUse = config.timer.minimal_use;
  if (
    coords &&
    minUse &&
    mode === MODE_PLAY &&
    !get().timer.paused &&
    !cn.children.length &&
    config.ui.players[cn.nextPlayer].type !== PLAYER_AI &&
    config.timer.main_time * 60 - game.mainTimeUsed <= 0 &&
    cn.timeUsed < minUse
  ) {
    setStatus(tf("move too fast", { num: minUse }), "teaching");
    return;
  }
  const before = game.prisonerCount.B + game.prisonerCount.W;
  try {
    game.play(new Move(coords, game.currentNode.nextPlayer));
    const after = game.prisonerCount.B + game.prisonerCount.W;
    if (after > before) sounds.capture();
    else if (coords) sounds.stone();
    setStatus("");
  } catch (e) {
    if (e instanceof IllegalMoveException) setStatus(`Illegal Move: ${e.message}`, "error");
    else throw e;
  }
  refresh();
}

export function undo(n: number | "smart" | "branch" | "main-branch" = 1) {
  const { game, mode, config } = get();
  if (!game) return;
  let times = n;
  if (n === "smart") {
    const cn = game.currentNode;
    times =
      mode === MODE_PLAY && config.ui.players[cn.player].type === PLAYER_AI && config.ui.players[cn.nextPlayer].type === PLAYER_HUMAN
        ? 2
        : 1;
  }
  game.undo(times as number | "branch" | "main-branch");
  refresh();
}

export function redo(n = 1) {
  get().game?.redo(n);
  refresh();
}

export function goTo(node: GameNode) {
  get().game?.setCurrentNode(node);
  refresh();
}

export function switchBranch(direction: 1 | -1) {
  get().game?.switchBranch(direction);
  refresh();
}

export function findMistake(direction: "undo" | "redo") {
  const { game, config } = get();
  if (!game) return;
  const threshold = config.trainer.eval_thresholds.at(-4)!;
  if (direction === "redo") game.redo(9999, threshold);
  else game.undo(9999, threshold);
  refresh();
}

export function resign() {
  const game = get().game;
  if (!game) return;
  game.currentNode.endState = `${game.currentNode.player}+R`;
  refresh();
}

export function aiMoveNow() {
  const game = get().game;
  if (!game || get().aiThinking) return;
  void aiMove(game.currentNode);
}

// ---------------------------------------------------------------- analysis
export function analyzeExtra(mode: ExtraAnalysisMode, kwargs: { mistakesOnly?: boolean; visits?: number } = {}) {
  const game = get().game;
  if (!game) return;
  if (mode === "stop") set({ pondering: false });
  game.analyzeExtra(mode, kwargs);
  refresh();
}

export function togglePondering() {
  set((s) => ({ pondering: !s.pondering }));
  refresh();
}

export function resetAnalysis() {
  get().game?.resetCurrentAnalysis();
  refresh();
}

export function setRegionOfInterest(region: [number, number, number, number] | null) {
  get().game?.setRegionOfInterest(region);
  refresh();
}

// ---------------------------------------------------------------- UI state
export function setMode(mode: UiMode) {
  set({ mode });
  refresh();
}

export function toggleControl(key: keyof AnalysisToggles) {
  const mode = get().mode;
  updateConfig((c) => {
    c.ui[mode][key] = !c.ui[mode][key];
  });
}

export function setPlayer(p: Player, change: { type?: PlayerType; strategy?: string; subtype?: string }) {
  updateConfig((c) => {
    if (change.type) c.ui.players[p].type = change.type;
    if (change.strategy) c.ui.players[p].strategy = change.strategy;
    if (change.subtype) c.ui.players[p].subtype = change.subtype;
  });
}

// ---------------------------------------------------------------- move tree editing
export type TreeEdit = "delete" | "prune" | "main" | "collapse";

export function editTree(edit: TreeEdit, node?: GameNode) {
  const game = get().game;
  if (!game) return;
  const target = node ?? game.currentNode;
  if (edit === "delete") game.deleteNode(target);
  else if (edit === "prune") game.pruneBranch(target);
  else if (edit === "main") game.makeMainBranch(target);
  else game.toggleCollapse(target);
  refresh();
}

export function setNote(note: string) {
  const game = get().game;
  if (game) game.currentNode.note = note;
}

export function openDialog(dialog: DialogKind) {
  set((s) => ({ dialog, timer: dialog ? { ...s.timer, paused: true } : s.timer })); // popups pause the clock, as in KaTrain
  if (dialog === null) refresh();
}

// ---------------------------------------------------------------- timer (ControlsPanel.update_timer)
const TIMER_INTERVAL = 0.07;
const BEEP_START = 5.2;
const periodsUsed: Record<Player, number> = { B: 0, W: 0 };
let lastTimerUpdate: { node: GameNode | null; time: number; beeping: boolean } = { node: null, time: 0, beeping: false };

export function resetTimer() {
  periodsUsed.B = periodsUsed.W = 0;
  const game = get().game;
  if (game) {
    game.mainTimeUsed = 0;
    game.currentNode.timeUsed = 0;
  }
  set((s) => ({ timer: { ...s.timer, paused: true } }));
  tickTimer();
}

export function toggleTimerPaused() {
  set((s) => ({ timer: { ...s.timer, paused: !s.timer.paused } }));
}

export function tickTimer() {
  const { game, config, mode, timer } = get();
  if (!game) return;
  const cn = game.currentNode;
  const now = performance.now() / 1000;
  const t = config.timer;
  const mainTime = t.main_time * 60;
  const byoLen = Math.max(1, t.byo_length);
  const byoNum = Math.max(1, t.byo_periods);
  const player = cn.nextPlayer;
  const ai = config.ui.players[player].type === PLAYER_AI;
  let { beeping } = lastTimerUpdate;
  let usedPeriod = false;
  const boingAt = byoLen - t.minimal_use;
  let mainRemaining = mainTime - game.mainTimeUsed;
  let remaining: number;
  if (!timer.paused && !ai && mode === MODE_PLAY && !game.endResult) {
    if (lastTimerUpdate.node === cn && !cn.children.length) {
      const dt = now - lastTimerUpdate.time;
      if (mainRemaining > 0) game.mainTimeUsed += dt;
      else cn.timeUsed += dt;
      mainRemaining = mainTime - game.mainTimeUsed;
    } else {
      cn.timeUsed = 0;
      beeping = false;
    }
    remaining = byoLen - cn.timeUsed;
    while (remaining < 0 && periodsUsed[player] < byoNum) {
      cn.timeUsed -= byoLen;
      remaining += byoLen;
      periodsUsed[player]++;
      usedPeriod = true;
    }
    const wasBeeping = beeping;
    if (BEEP_START - 2 * TIMER_INTERVAL < remaining && remaining < BEEP_START && periodsUsed[player] < byoNum) beeping = true;
    else if (remaining > BEEP_START) beeping = false;
    if (
      t.minimal_use &&
      !beeping &&
      boingAt - TIMER_INTERVAL < remaining &&
      remaining < boingAt + TIMER_INTERVAL &&
      periodsUsed[player] < byoNum &&
      t.sound
    ) {
      sounds.minimalTimePassed();
    }
    if (t.sound && mainRemaining <= 0) {
      const periodsLeft = byoNum - periodsUsed[player];
      if (wasBeeping && !beeping && !usedPeriod) sounds.stopCountdown();
      else if (!wasBeeping && beeping) sounds.countdown(periodsLeft > 1 ? 0.5 : 1);
    }
  } else {
    beeping = false;
  }
  remaining = periodsUsed[player] >= byoNum ? 0 : byoLen - cn.timeUsed;
  const periodsLeft = byoNum - periodsUsed[player];
  lastTimerUpdate = { node: cn, time: now, beeping };
  const next: TimerState =
    mainRemaining > 0
      ? { paused: timer.paused, remaining: mainRemaining, periods: null, ai }
      : { paused: timer.paused, remaining: Math.max(0, remaining), periods: Math.max(0, periodsLeft), ai };
  const cur = get().timer;
  if (cur.paused !== next.paused || cur.periods !== next.periods || cur.ai !== next.ai || Math.floor(cur.remaining * 10) !== Math.floor(next.remaining * 10)) {
    set({ timer: next });
  }
}

export function updateTimerSettings(timer: AppConfig["timer"]) {
  updateConfig((c) => void (c.timer = timer));
  resetTimer();
}

// ---------------------------------------------------------------- insert mode, self-play, tsumego frame
export function toggleInsertMode() {
  const game = get().game;
  if (!game) return;
  game.setInsertMode("toggle");
  if (game.insertMode && get().mode !== MODE_ANALYZE) set({ mode: MODE_ANALYZE });
  refresh();
}

export function selfplayToEnd() {
  const game = get().game;
  if (!game || !game.engine) return;
  game.selfplay("end");
  refresh();
}

/** New game, then AI self-play until `untilMove` aiming for `blackScore` ("Set up Position"). */
export function setupPosition(settings: NewGameSettings, untilMove: number, blackScore: number) {
  updateConfig((c) => {
    c.game.setup_move = untilMove;
    c.game.setup_advantage = blackScore;
  });
  newGame(settings);
  const game = get().game!;
  const start = () => {
    if (get().game !== game || !game.active) return;
    if (!game.root.analysisExists) {
      setTimeout(start, 100); // self-play steers from the root score
      return;
    }
    game.selfplay(untilMove, blackScore);
  };
  start();
}

export function tsumegoFrame(ko: boolean, margin: number) {
  const game = get().game;
  if (!game || !game.stones.length) return;
  const [node, region] = addTsumegoFrame(game, ko, margin);
  game.setCurrentNode(node);
  set({ mode: MODE_ANALYZE });
  if (region) game.setRegionOfInterest(region);
  game.analyze(node);
  refresh();
}

// ---------------------------------------------------------------- clipboard
export async function copySgf() {
  const game = get().game;
  if (!game) return;
  try {
    await platform.writeClipboard(writeSgf(game.root));
    setStatus(t("Copied SGF to clipboard."), "info");
  } catch (e) {
    setStatus(String(e), "error");
  }
}

export async function pasteSgf() {
  let text: string;
  try {
    text = (await platform.readClipboard()) ?? "";
  } catch (e) {
    setStatus(String(e), "error");
    return;
  }
  if (!text.trim()) {
    setStatus("Ctrl-V pressed but clipboard is empty.", "info");
    return;
  }
  const url = /^(https?:\/\/\S+)/.exec(text.trim());
  if (url) {
    log(`Recognized url: ${url[1]}`, "info");
    try {
      text = await platform.fetchText(url[1]);
    } catch (e) {
      setStatus(tf("Failed to import from clipboard", { error: String(e), contents: text.slice(0, 50) }), "error");
      return;
    }
  }
  let tree: GameNode;
  try {
    tree = parseSgf(text);
  } catch (e) {
    setStatus(tf("Failed to import from clipboard", { error: String(e), contents: text.slice(0, 50) }), "error");
    return;
  }
  engine?.onNewGame();
  const game = new Game(host, engine, { moveTree: tree, analyzeFast: true });
  game.redo(9999);
  startGame(game, MODE_ANALYZE);
  log("Imported game from clipboard.", "info");
}

// Ported from katrain/core/game.py: board state with capture rules, navigation and analysis requests.

import {
  PRIORITY_ALTERNATIVES,
  PRIORITY_DEFAULT,
  PRIORITY_EQUALIZE,
  PRIORITY_EXTRA_ANALYSIS,
  PRIORITY_GAME_ANALYSIS,
  PRIORITY_SWEEP,
  PROGRAM_NAME,
  type Player,
} from "./constants";
import { getRules, type KataGoEngine, type Rules } from "./engine";
import { GameNode, type SgfSaveOptions } from "./gameNode";
import { t, tf } from "./i18n";
import { Move, type Coords } from "./move";
import { writeSgf } from "./sgf";
import { varToGrid } from "./utils";

export class IllegalMoveException extends Error {}

export type StatusLevel = "analysis" | "info" | "teaching" | "error";

export interface TrainerSettings {
  eval_thresholds: number[];
  show_dots: boolean[];
  save_feedback: boolean[];
  save_analysis: boolean;
  save_marks: boolean;
  eval_show_ai: boolean;
  eval_on_show_last: number;
  low_visits: number;
  top_moves_show: string;
  top_moves_show_secondary: string;
  extra_precision: boolean;
  theme: string;
}

/** What a Game needs from the application around it. */
export interface GameHost {
  trainer(): TrainerSettings;
  isAi(player: Player): boolean;
  setStatus(message: string, level: StatusLevel): void;
  log(message: string): void;
}

export interface NewGameSettings {
  size: string;
  komi: number;
  handicap: number;
  rules: string;
}

export type ExtraAnalysisMode = "stop" | "ponder" | "extra" | "game" | "sweep" | "equalize" | "alternative" | "local";

function timestampId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())} ${p(d.getMinutes())} ${p(d.getSeconds())}`;
}

export class Game {
  readonly gameId = timestampId();
  root: GameNode;
  currentNode!: GameNode;
  sgfFilename: string | null;
  externalGame = false;
  regionOfInterest: number[] | null = null;

  // board state: board[y][x] = chain id or -1
  board: number[][] = [];
  chains: Move[][] = [];
  prisoners: Move[] = [];
  lastCapture: Move[] = [];

  constructor(
    private host: GameHost,
    public engine: KataGoEngine | null,
    opts: { moveTree?: GameNode; newGame?: NewGameSettings; sgfFilename?: string | null; analyzeFast?: boolean } = {},
  ) {
    this.sgfFilename = opts.sgfFilename ?? null;
    if (opts.moveTree) {
      this.root = opts.moveTree;
      this.externalGame = !this.root.getProperty("AP", "").includes(PROGRAM_NAME);
      const handicap = Math.trunc(this.root.handicap);
      let numStartingMovesBlack = 0;
      let node = this.root;
      while (node.children.length) {
        node = node.children[0];
        if (node.player === "B") numStartingMovesBlack++;
        else break;
      }
      if (
        handicap >= 2 &&
        !this.root.placements.length &&
        numStartingMovesBlack !== handicap &&
        !(this.root.children.length && this.root.children[0].placements.length)
      ) {
        this.root.placeHandicapStones(handicap);
      }
    } else {
      const s = opts.newGame ?? { size: "19", komi: 6.5, handicap: 0, rules: "japanese" };
      this.root = new GameNode(null, { GM: 1, FF: 4, DT: this.gameId, SZ: s.size, KM: s.komi, RU: s.rules });
      if (s.handicap) {
        this.root.setProperty("HA", s.handicap);
        this.root.placeHandicapStones(s.handicap);
      }
    }
    if (!this.root.getProperty("RU")) this.root.setProperty("RU", opts.newGame?.rules ?? "japanese");
    this.setCurrentNode(this.root);
    this.analyzeAllNodes(PRIORITY_GAME_ANALYSIS, opts.analyzeFast ?? !opts.moveTree, false);
  }

  // ---------------------------------------------------------------- board state
  private initState() {
    const [sx, sy] = this.boardSize;
    this.board = Array.from({ length: sy }, () => new Array<number>(sx).fill(-1));
    this.chains = [];
    this.prisoners = [];
    this.lastCapture = [];
  }

  private calculateGroups() {
    this.initState();
    try {
      for (const node of this.currentNode.nodesFromRoot) {
        for (const m of node.moveWithPlacements) this.validateMoveAndUpdateChains(m, true); // ko unknown when replaying
        const clear = node.clearPlacements;
        if (clear.length) {
          // handle AE by replaying all stones that remain on an empty board
          const clearKeys = new Set(clear.filter((c) => c.coords).map((c) => `${c.coords![0]},${c.coords![1]}`));
          const stones = this.chains.flat().filter((m) => !clearKeys.has(`${m.coords![0]},${m.coords![1]}`));
          this.initState();
          for (const m of stones) this.validateMoveAndUpdateChains(m, true);
        }
      }
    } catch (e) {
      if (e instanceof IllegalMoveException) throw new Error(`Unexpected illegal move (${e.message})`);
      throw e;
    }
  }

  private validateMoveAndUpdateChains(move: Move, ignoreKo: boolean) {
    const [sx, sy] = this.boardSize;
    const neighbours = (moves: Move[]): Set<number> => {
      const out = new Set<number>();
      for (const m of moves) {
        const [x, y] = m.coords!;
        for (const [dy, dx] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          if (x + dx >= 0 && x + dx < sx && y + dy >= 0 && y + dy < sy) out.add(this.board[y + dy][x + dx]);
        }
      }
      return out;
    };

    const koOrSnapback = this.lastCapture.length === 1 && this.lastCapture[0].equals(move);
    this.lastCapture = [];
    if (move.isPass) return;
    const [mx, my] = move.coords!;
    if (this.board[my][mx] !== -1) throw new IllegalMoveException("Space occupied");

    // merge chains connected by this move, or create a new one
    const nbChains = [...neighbours([move])].filter((c) => c >= 0 && this.chains[c][0].player === move.player);
    let thisChain: number;
    if (nbChains.length) {
      thisChain = nbChains[0];
      const others = new Set(nbChains);
      for (const line of this.board) for (let x = 0; x < line.length; x++) if (others.has(line[x])) line[x] = thisChain;
      for (const oc of nbChains.slice(1)) {
        this.chains[thisChain].push(...this.chains[oc]);
        this.chains[oc] = [];
      }
      this.chains[thisChain].push(move);
    } else {
      thisChain = this.chains.length;
      this.chains.push([move]);
    }
    this.board[my][mx] = thisChain;

    // captures
    const oppChains = [...neighbours([move])].filter((c) => c >= 0 && this.chains[c][0].player !== move.player);
    for (const c of oppChains) {
      if (!neighbours(this.chains[c]).has(-1)) {
        this.lastCapture.push(...this.chains[c]);
        for (const om of this.chains[c]) this.board[om.coords![1]][om.coords![0]] = -1;
        this.chains[c] = [];
      }
    }
    if (koOrSnapback && this.lastCapture.length === 1 && !ignoreKo) throw new IllegalMoveException("Ko");
    this.prisoners.push(...this.lastCapture);

    // suicide
    if (!neighbours(this.chains[thisChain]).has(-1)) {
      const rules = this.rules;
      if (this.chains[thisChain].length === 1) throw new IllegalMoveException("Single stone suicide");
      const suicideAllowed =
        (typeof rules === "string" && ["tromp-taylor", "new zealand"].includes(rules)) ||
        (typeof rules === "object" && Boolean(rules.suicide));
      if (!suicideAllowed) throw new IllegalMoveException("Suicide");
      this.lastCapture.push(...this.chains[thisChain]);
      for (const om of this.chains[thisChain]) this.board[om.coords![1]][om.coords![0]] = -1;
      this.chains[thisChain] = [];
      this.prisoners.push(...this.lastCapture);
    }
  }

  get boardSize(): [number, number] {
    return this.root.boardSize;
  }
  get komi(): number {
    return this.root.komi;
  }
  get rules(): Rules {
    return getRules(this.root.ruleset);
  }
  get stones(): Move[] {
    return this.chains.flat();
  }

  /** player at each point, indexed [y][x]. */
  get stoneGrid(): (Player | null)[][] {
    return this.board.map((line) => line.map((c) => (c >= 0 ? this.chains[c][0].player : null)));
  }

  get prisonerCount(): Record<Player, number> {
    return {
      B: this.prisoners.filter((m) => m.player === "B").length,
      W: this.prisoners.filter((m) => m.player === "W").length,
    };
  }

  // ---------------------------------------------------------------- navigation
  setCurrentNode(node: GameNode) {
    this.currentNode = node;
    this.calculateGroups();
  }

  /** Play a move from the current position. Throws IllegalMoveException if invalid. */
  play(move: Move, opts: { ignoreKo?: boolean; analyze?: boolean; expectedNode?: GameNode } = {}): GameNode | null {
    const [sx, sy] = this.boardSize;
    if (!move.isPass && !(move.coords![0] >= 0 && move.coords![0] < sx && move.coords![1] >= 0 && move.coords![1] < sy)) {
      throw new IllegalMoveException(`Move ${move} outside of board coordinates`);
    }
    if (opts.expectedNode && this.currentNode !== opts.expectedNode) return null;
    try {
      this.validateMoveAndUpdateChains(move, opts.ignoreKo ?? false);
    } catch (e) {
      this.calculateGroups(); // roll the half-applied move back off the board
      throw e;
    }
    const played = this.currentNode.play(move);
    this.currentNode = played;
    if (opts.analyze ?? true) {
      if (this.regionOfInterest) {
        this.analyze(played, { analyzeFast: true });
        this.analyze(played, { regionOfInterest: this.regionOfInterest });
      } else {
        this.analyze(played);
      }
    }
    return played;
  }

  undo(nTimes: number | "branch" | "main-branch" = 1, stopOnMistake: number | null = null) {
    let cn = this.currentNode;
    let breakOnBranch = false;
    let breakOnMainBranch = false;
    let lastBranchingNode = cn;
    let n: number;
    if (nTimes === "branch") {
      n = 9999;
      breakOnBranch = true;
    } else if (nTimes === "main-branch") {
      n = 9999;
      breakOnMainBranch = true;
    } else n = nTimes;
    for (let i = 0; i < n; i++) {
      const pl = cn.pointsLost;
      if (stopOnMistake !== null && pl !== null && pl >= stopOnMistake && !this.host.isAi(cn.player)) {
        this.setCurrentNode(cn.parent!);
        return;
      }
      const previous = cn;
      if (cn.isRoot) break;
      cn = cn.parent!;
      if (breakOnBranch && cn.children.length > 1) break;
      if (breakOnMainBranch && cn.orderedChildren[0] !== previous) lastBranchingNode = cn;
    }
    if (breakOnMainBranch) cn = lastBranchingNode;
    if (cn !== this.currentNode) this.setCurrentNode(cn);
  }

  redo(nTimes = 1, stopOnMistake: number | null = null) {
    let cn = this.currentNode;
    for (let i = 0; i < nTimes; i++) {
      if (cn.children.length) cn = cn.orderedChildren[0];
      const pl = cn.pointsLost;
      if (i > 0 && stopOnMistake !== null && pl !== null && pl >= stopOnMistake && !this.host.isAi(cn.player)) {
        this.setCurrentNode(cn.parent!);
        return;
      }
    }
    if (stopOnMistake === null) this.setCurrentNode(cn);
  }

  /** Move to the sibling branch above/below the current one at the nearest branching point. */
  switchBranch(direction: 1 | -1) {
    const path = this.currentNode.nodesFromRoot;
    for (let i = path.length - 1; i > 0; i--) {
      const parent = path[i - 1];
      if (parent.children.length > 1) {
        const siblings = parent.orderedChildren;
        const ix = siblings.indexOf(path[i]);
        const target = siblings[ix + direction];
        if (!target) return;
        // keep the same depth below the branching point if possible
        let node = target;
        for (let k = i + 1; k < path.length && node.children.length; k++) node = node.orderedChildren[0];
        this.setCurrentNode(node);
        return;
      }
    }
  }

  /** The main line through the current node: root..current, then first children to the end. */
  get mainLineThroughCurrent(): GameNode[] {
    const nodes = this.currentNode.nodesFromRoot;
    let n = this.currentNode;
    while (n.children.length) {
      n = n.orderedChildren[0];
      nodes.push(n);
    }
    return nodes;
  }

  get endResult(): string | null {
    const cn = this.currentNode;
    if (cn.endState) return cn.endState;
    if (cn.parent && cn.isPass && cn.parent.isPass) return this.manualScore ?? t("board-game-end");
    return null;
  }

  get manualScore(): string | null {
    const cn = this.currentNode;
    const rules = this.rules;
    if (
      !cn.ownership ||
      !["jp", "japanese"].includes(String(rules).toLowerCase()) ||
      !cn.parent ||
      !cn.parent.ownership
    ) {
      if (!cn.score) return null;
      return cn.formatScore(Math.round(2 * cn.score) / 2) + "?";
    }
    const [sx, sy] = this.boardSize;
    const mean = cn.ownership.map((c, i) => (c + cn.parent!.ownership![i]) / 2);
    const grid = varToGrid(mean, [sx, sy]);
    const stones = new Map(this.stones.map((m) => [`${m.coords![0]},${m.coords![1]}`, m.player]));
    const lo = 0.15;
    const hi = 0.85;
    const scoreSquare = (key: string, owner: number): number => {
      const player = stones.get(key);
      if ((player === "B" && owner > hi) || (player === "W" && owner < -hi) || Math.abs(owner) < lo) return 0;
      if (player === undefined && Math.abs(owner) >= hi) return Math.round(owner);
      if ((player === "B" && owner < -hi) || (player === "W" && owner > hi)) return 2 * Math.round(owner);
      return NaN;
    };
    const scored: number[] = [];
    for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) scored.push(scoreSquare(`${x},${y}`, grid[y][x]));
    const count = (v: number) => scored.filter((s) => s === v).length;
    const unknown = scored.filter((s) => Number.isNaN(s)).length;
    const prisoners = this.prisonerCount;
    const score =
      [-2, -1, 0, 1, 2].reduce((acc, v) => acc + v * count(v), 0) + prisoners.W - prisoners.B - this.komi;
    if (unknown > 10 || count(0) - stones.size > 4 * (sx + sy)) return null;
    return cn.formatScore(score);
  }

  // ---------------------------------------------------------------- analysis
  analyze(
    node: GameNode,
    opts: {
      priority?: number;
      visits?: number;
      ponder?: boolean;
      timeLimit?: boolean;
      refineMove?: Move | null;
      analyzeFast?: boolean;
      findAlternatives?: boolean;
      regionOfInterest?: number[] | null;
      reportEvery?: number | null;
    } = {},
  ) {
    if (!this.engine) return;
    const refineMove = opts.refineMove ?? null;
    this.engine.requestAnalysis(node, {
      callback: (result, partial) =>
        node.setAnalysis(result, refineMove, opts.findAlternatives ?? false, opts.regionOfInterest ?? null, partial),
      priority: opts.priority ?? PRIORITY_DEFAULT,
      visits: opts.visits,
      ponder: opts.ponder,
      analyzeFast: opts.analyzeFast,
      timeLimit: opts.timeLimit,
      nextMove: refineMove,
      findAlternatives: opts.findAlternatives,
      regionOfInterest: opts.regionOfInterest,
      reportEvery: opts.reportEvery === undefined ? 1 : opts.reportEvery,
    });
  }

  analyzeAllNodes(priority = PRIORITY_GAME_ANALYSIS, analyzeFast = false, evenIfPresent = true) {
    for (const node of this.root.nodesInTree) {
      // forced, or not present, or something went wrong in loading
      if (evenIfPresent || !node.analysisFromSgf || !node.loadAnalysis()) {
        node.clearAnalysis();
        this.analyze(node, { priority, analyzeFast });
      }
    }
  }

  resetCurrentAnalysis() {
    const cn = this.currentNode;
    this.engine?.terminateQueries(cn);
    cn.clearAnalysis();
    this.analyze(cn);
  }

  setRegionOfInterest(region: [number, number, number, number] | null) {
    if (!region) {
      this.regionOfInterest = null;
      return;
    }
    const [x1, x2, y1, y2] = region;
    const [xmin, xmax] = [Math.min(x1, x2), Math.max(x1, x2)];
    const [ymin, ymax] = [Math.min(y1, y2), Math.max(y1, y2)];
    const [szx, szy] = this.boardSize;
    if (!(xmin === xmax && ymin === ymax) && !(xmax - xmin + 1 >= szx && ymax - ymin + 1 >= szy)) {
      this.regionOfInterest = [xmin, xmax, ymin, ymax];
    } else {
      this.regionOfInterest = null;
    }
  }

  analyzeExtra(mode: ExtraAnalysisMode, kwargs: { mistakesOnly?: boolean; visits?: number } = {}) {
    const engine = this.engine;
    if (!engine) return;
    const cn = this.currentNode;
    const stoneKeys = new Set(this.stones.map((s) => `${s.coords![0]},${s.coords![1]}`));

    if (mode === "stop") {
      engine.stopPondering();
      engine.terminateQueries();
      return;
    }
    if (mode === "ponder") {
      this.analyze(cn, {
        ponder: true,
        priority: PRIORITY_EXTRA_ANALYSIS,
        regionOfInterest: this.regionOfInterest,
        timeLimit: false,
      });
      return;
    }
    if (mode === "extra") {
      const visits = cn.analysisVisitsRequested + engine.settings.max_visits;
      this.host.setStatus(tf("extra analysis", { visits }), "analysis");
      this.analyze(cn, { visits, priority: PRIORITY_EXTRA_ANALYSIS, regionOfInterest: this.regionOfInterest, timeLimit: false });
      return;
    }
    if (mode === "game") {
      const nodes = this.root.nodesInTree;
      const threshold = this.host.trainer().eval_thresholds.at(-4)!;
      const visits =
        kwargs.visits ?? Math.min(...nodes.map((n) => n.analysisVisitsRequested)) + engine.settings.max_visits;
      for (const node of nodes) {
        const maxLoss = Math.max(...[node, ...node.children].map((c) => c.pointsLost ?? 0));
        if (kwargs.mistakesOnly && maxLoss <= threshold) continue;
        this.analyze(node, { visits, priority: -1_000_000, timeLimit: false, reportEvery: null });
      }
      this.host.setStatus(tf("game re-analysis", { visits }), "analysis");
      return;
    }

    let analyzeMoves: Move[];
    let visits: number;
    let priority: number;
    const [sx, sy] = this.boardSize;
    if (mode === "sweep") {
      analyzeMoves = [];
      const policyGrid = cn.policy ? varToGrid(cn.policy, [sx, sy]) : null;
      for (let x = 0; x < sx; x++) {
        for (let y = 0; y < sy; y++) {
          if (policyGrid ? policyGrid[y][x] >= 0 : !stoneKeys.has(`${x},${y}`)) {
            analyzeMoves.push(new Move([x, y], cn.nextPlayer));
          }
        }
      }
      if (policyGrid) analyzeMoves.sort((a, b) => policyGrid[b.coords![1]][b.coords![0]] - policyGrid[a.coords![1]][a.coords![0]]);
      visits = engine.settings.fast_visits;
      this.host.setStatus(tf("sweep analysis", { visits }), "analysis");
      priority = PRIORITY_SWEEP;
    } else {
      if (!cn.analysisComplete && mode !== "local") {
        this.host.setStatus(t("wait-before-extra-analysis"), "info");
        return;
      }
      if (mode === "alternative") {
        this.host.setStatus(t("alternative analysis"), "analysis");
        this.analyze(cn, { priority: PRIORITY_ALTERNATIVES, timeLimit: false, findAlternatives: true });
        visits = engine.settings.fast_visits;
      } else {
        visits = Math.max(...Object.values(cn.analysis.moves).map((d) => d.visits));
        this.host.setStatus(tf("equalizing analysis", { visits }), "analysis");
      }
      priority = PRIORITY_EQUALIZE;
      analyzeMoves = Object.keys(cn.analysis.moves).map((gtp) => Move.fromGtp(gtp, cn.nextPlayer));
    }
    for (const move of analyzeMoves) {
      if ((cn.analysis.moves[move.gtp()]?.visits ?? 0) < visits) {
        this.analyze(cn, { priority, visits, refineMove: move, timeLimit: false }); // explicitly requested
      }
    }
  }

  // ---------------------------------------------------------------- saving
  updateRootProperties(playerNames: Record<Player, string | null>) {
    for (const bw of ["B", "W"] as Player[]) {
      const name = playerNames[bw];
      if (!this.externalGame && name) this.root.setProperty("P" + bw, name);
    }
    const result = this.endResult;
    if (result && result.includes("+")) this.root.setProperty("RE", result);
  }

  generateFilename(): string {
    const clean = (s: string) => s.replace(/[​ㅤ'<>:"/\\|?*]/g, "");
    const b = clean(this.root.getProperty("PB", "B"));
    const w = clean(this.root.getProperty("PW", "W"));
    return `${PROGRAM_NAME}_${b} vs ${w} ${this.gameId}.sgf`;
  }

  toSgf(trainer: TrainerSettings, showDotsFor: Record<Player, boolean>): string {
    const opts: SgfSaveOptions = {
      saveCommentsPlayer: showDotsFor,
      saveCommentsClass: trainer.save_feedback,
      evalThresholds: trainer.eval_thresholds,
      saveAnalysis: trainer.save_analysis,
      saveMarks: trainer.save_marks,
    };
    return writeSgf(this.root, opts);
  }

  isStoneAt(c: Coords): boolean {
    return this.board[c[1]]?.[c[0]] !== undefined && this.board[c[1]][c[0]] >= 0;
  }
}

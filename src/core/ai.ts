// Ported from katrain/core/ai.py: AI move generation strategies.
// Strategies not yet ported (simple ownership, settle stones, jigo, antimirror, human-like, pro)
// fall back to the default strategy.

import {
  AI_DEFAULT,
  AI_HANDICAP,
  AI_INFLUENCE,
  AI_INFLUENCE_ELO_GRID,
  AI_JIGO,
  AI_LOCAL,
  AI_LOCAL_ELO_GRID,
  AI_PICK,
  AI_PICK_ELO_GRID,
  AI_POLICY,
  AI_PRO,
  AI_RANK,
  AI_SCORELOSS,
  AI_SCORELOSS_ELO,
  AI_STRENGTH,
  AI_TENUKI,
  AI_TENUKI_ELO_GRID,
  AI_TERRITORY,
  AI_TERRITORY_ELO_GRID,
  AI_WEIGHTED,
  AI_WEIGHTED_ELO,
  AI_HUMAN,
  CALIBRATED_RANK_ELO,
  PRIORITY_EXTRA_AI_QUERY,
  type EloGrid,
} from "./constants";
import type { Game } from "./game";
import type { GameNode, KataGoResponse } from "./gameNode";
import { Move } from "./move";
import { nLargest, varToGrid, weightedSelectionWithoutReplacement } from "./utils";

export type AiSettings = Record<string, number | boolean>;

export class AnalysisDiscardedError extends Error {}

function interpIx(lst: number[], x: number): [number, number] {
  let i = 0;
  while (i + 1 < lst.length - 1 && lst[i + 1] < x) i++;
  const t = Math.max(0, Math.min(1, (x - lst[i]) / (lst[i + 1] - lst[i])));
  return [i, t];
}

function interp1d(lst: [number, number][], x: number): number {
  const xs = lst.map((p) => p[0]);
  const ys = lst.map((p) => p[1]);
  const [i, t] = interpIx(xs, x);
  return (1 - t) * ys[i] + t * ys[i + 1];
}

function interp2d(gridspec: EloGrid, x: number, y: number): number {
  const [xs, ys, matrix] = gridspec;
  const [i, t] = interpIx(xs, x);
  const [j, s] = interpIx(ys, y);
  return (
    matrix[j][i] * (1 - t) * (1 - s) +
    matrix[j][i + 1] * t * (1 - s) +
    matrix[j + 1][i] * (1 - t) * s +
    matrix[j + 1][i + 1] * t * s
  );
}

/** Estimated strength in dan (1 = 1d, 0 = 1k, -4 = 5k). */
export function aiRankEstimation(strategy: string, settings: AiSettings): number {
  const n = (k: string) => Number(settings[k]);
  if ([AI_DEFAULT, AI_HANDICAP, AI_JIGO, AI_PRO].includes(strategy)) return 9;
  if (strategy === AI_RANK) return 1 - n("kyu_rank");
  if (strategy === AI_HUMAN) return 1 - n("human_kyu_rank");
  let elo: number | null = null;
  if (strategy === AI_WEIGHTED) elo = interp1d(AI_WEIGHTED_ELO, n("weaken_fac"));
  if (strategy === AI_SCORELOSS) elo = interp1d(AI_SCORELOSS_ELO, n("strength"));
  const grids: Record<string, EloGrid> = {
    [AI_PICK]: AI_PICK_ELO_GRID,
    [AI_LOCAL]: AI_LOCAL_ELO_GRID,
    [AI_TENUKI]: AI_TENUKI_ELO_GRID,
    [AI_TERRITORY]: AI_TERRITORY_ELO_GRID,
    [AI_INFLUENCE]: AI_INFLUENCE_ELO_GRID,
  };
  if (grids[strategy]) elo = interp2d(grids[strategy], n("pick_frac"), n("pick_n"));
  if (elo !== null) return 1 - interp1d(CALIBRATED_RANK_ELO, elo);
  return AI_STRENGTH[strategy] ?? NaN;
}

export function rankLabel(rank: number | null | undefined): string {
  if (rank === null || rank === undefined || Number.isNaN(rank)) return "??";
  const r = Math.round(rank);
  return r >= 1 ? `${r}d` : `${1 - r}k`;
}

const fmtMoves = (moves: [number, Move][]) => moves.map(([p, mv]) => `${mv.gtp()} (${(100 * p).toFixed(2)}%)`).join(", ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type WeightedCoord = [number, number, number, number]; // policy, weight, x, y

abstract class AIStrategy {
  readonly cn: GameNode;
  private readonly generation: number;

  constructor(
    protected game: Game,
    protected settings: AiSettings,
  ) {
    this.cn = game.currentNode;
    this.generation = game.engine?.queryGeneration ?? 0;
  }

  abstract generateMove(): Promise<[Move, string]>;

  protected s(key: string, fallback = 0): number {
    const v = this.settings[key];
    return v === undefined ? fallback : Number(v);
  }

  protected raiseIfDiscarded() {
    const engine = this.game.engine;
    if (!engine) throw new AnalysisDiscardedError("no engine");
    if (engine.queryGeneration !== this.generation) {
      throw new AnalysisDiscardedError("analysis discarded by a new game or an engine restart");
    }
    if (engine.state === "dead" || engine.state === "stopped") throw new AnalysisDiscardedError("engine is not running");
  }

  protected async waitForAnalysis() {
    while (!this.cn.analysisComplete) {
      this.raiseIfDiscarded();
      await sleep(20);
    }
  }

  protected async requestAnalysis(extraSettings: Record<string, unknown>): Promise<KataGoResponse | null> {
    const engine = this.game.engine!;
    let analysis: KataGoResponse | null = null;
    let error = false;
    engine.requestAnalysis(this.cn, {
      callback: (a, partial) => {
        if (!partial) analysis = a;
      },
      errorCallback: () => {
        error = true;
      },
      priority: PRIORITY_EXTRA_AI_QUERY,
      ownership: false,
      extraSettings,
    });
    while (!error && !analysis) {
      this.raiseIfDiscarded();
      await sleep(20);
    }
    return analysis;
  }

  protected shouldPlayTopMove(
    policyMoves: [number, Move][],
    top5Pass: boolean,
    override = 0.0,
    overrideTwo = 1.0,
  ): [Move | null, string] {
    const top = policyMoves[0][1];
    if (top5Pass) return [top, "Playing top one because one of them is pass."];
    if (policyMoves[0][0] > override) {
      return [top, `Top policy move has weight > ${(100 * override).toFixed(1)}%, so overriding other strategies.`];
    }
    if (policyMoves[0][0] + policyMoves[1][0] > overrideTwo) {
      return [
        top,
        `Top two policy moves have cumulative weight > ${(100 * overrideTwo).toFixed(1)}%, so overriding other strategies.`,
      ];
    }
    return [null, ""];
  }
}

class DefaultStrategy extends AIStrategy {
  async generateMove(): Promise<[Move, string]> {
    await this.waitForAnalysis();
    const cands = this.cn.candidateMoves;
    const top = cands.length ? Move.fromGtp(cands[0].move, this.cn.nextPlayer) : Move.pass(this.cn.nextPlayer);
    return [
      top,
      `Default strategy found ${cands.length} moves returned from the engine and chose ${top.gtp()} as top move`,
    ];
  }
}

class HandicapStrategy extends AIStrategy {
  async generateMove(): Promise<[Move, string]> {
    let pda = this.s("pda");
    if (this.settings.automatic) {
      const nHandicaps = (this.game.root.getListProperty("AB") ?? []).length;
      const MOVE_VALUE = 14; // could be rules dependent
      const bStonesAdvantage = Math.max(nHandicaps - 1, 0) - (this.cn.komi - MOVE_VALUE / 2) / MOVE_VALUE;
      pda = Math.min(3, Math.max(-3, -bStonesAdvantage * (3 / 8))); // max PDA at 8 stone adv
    }
    const analysis = await this.requestAnalysis({ playoutDoublingAdvantage: pda, playoutDoublingAdvantagePla: "BLACK" });
    if (!analysis) return new DefaultStrategy(this.game, this.settings).generateMove();
    await this.waitForAnalysis();
    const cands = analysis.moveInfos;
    const top = Move.fromGtp(cands[0].move, this.cn.nextPlayer);
    return [
      top,
      `Handicap strategy found ${cands.length} moves returned from the engine and chose ${top.gtp()} as top move. PDA based score ${this.cn.formatScore(analysis.rootInfo.scoreLead)} and win rate ${this.cn.formatWinrate(analysis.rootInfo.winrate)}`,
    ];
  }
}

class ScoreLossStrategy extends AIStrategy {
  async generateMove(): Promise<[Move, string]> {
    await this.waitForAnalysis();
    const cands = this.cn.candidateMoves;
    if (!cands.length) return [Move.pass(this.cn.nextPlayer), "No candidate moves found, passing"];
    const top = Move.fromGtp(cands[0].move, this.cn.nextPlayer);
    if (top.isPass) return [top, "Top move is pass, so passing regardless of strategy."];
    const c = this.s("strength");
    const moves = cands.map(
      (d) =>
        [d.pointsLost, Math.exp(Math.min(200, -c * Math.max(0, d.pointsLost))), Move.fromGtp(d.move, this.cn.nextPlayer)] as [
          number,
          number,
          Move,
        ],
    );
    const [pointsLost, weight, aimove] = weightedSelectionWithoutReplacement(moves, (m) => m[1], 1)[0];
    return [
      aimove,
      `ScoreLoss strategy found ${cands.length} candidate moves (best ${top.gtp()}) and chose ${aimove.gtp()} (weight ${weight.toFixed(3)}, point loss ${pointsLost.toFixed(1)}) based on score weights.`,
    ];
  }
}

class PolicyStrategy extends AIStrategy {
  async generateMove(): Promise<[Move, string]> {
    await this.waitForAnalysis();
    if (!this.cn.policy) return new DefaultStrategy(this.game, this.settings).generateMove();
    const policyMoves = this.cn.policyRanking!;
    const top5Pass = policyMoves.slice(0, 5).some(([, m]) => m.isPass);
    if (this.cn.depth <= this.s("opening_moves")) {
      return new WeightedStrategy(this.game, { pick_override: 0.9, weaken_fac: 1, lower_bound: 0.02 }).generateMove();
    }
    const aimove = policyMoves[0][1];
    if (top5Pass) return [aimove, "Playing top one because one of them is pass."];
    return [aimove, `Playing top policy move ${aimove.gtp()}.`];
  }
}

class WeightedStrategy extends AIStrategy {
  async generateMove(): Promise<[Move, string]> {
    await this.waitForAnalysis();
    if (!this.cn.policy) return new DefaultStrategy(this.game, this.settings).generateMove();
    const policyMoves = this.cn.policyRanking!;
    const top5Pass = policyMoves.slice(0, 5).some(([, m]) => m.isPass);
    const [override, thoughts] = this.shouldPlayTopMove(policyMoves, top5Pass, this.s("pick_override", 0));
    if (override) return [override, thoughts];
    const lowerBound = Math.max(0, this.s("lower_bound", 0.02));
    const weakenFac = Math.max(0.01, this.s("weaken_fac", 1.0));
    const weighted = policyMoves
      .filter(([pv, m]) => pv > lowerBound && !m.isPass)
      .map(([pv, m]) => [pv, pv ** (1 / weakenFac), m] as [number, number, Move]);
    if (weighted.length) {
      const [prob, , move] = weightedSelectionWithoutReplacement(weighted, (w) => w[1], 1)[0];
      return [
        move,
        `Playing policy-weighted random move ${move.gtp()} (${(100 * prob).toFixed(1)}%) from ${weighted.length} moves above lower_bound of ${(100 * lowerBound).toFixed(1)}%.`,
      ];
    }
    return [
      policyMoves[0][1],
      `Playing top policy move because no non-pass move > above lower_bound of ${(100 * lowerBound).toFixed(1)}%.`,
    ];
  }
}

class PickBasedStrategy extends AIStrategy {
  protected getNMoves(legal: [number, Move][]): number {
    if (this.settings.pick_frac !== undefined) {
      return Math.max(1, Math.trunc(this.s("pick_frac") * legal.length + this.s("pick_n")));
    }
    return 1;
  }

  protected generateWeightedCoords(_legal: [number, Move][], policyGrid: number[][], size: [number, number]): [WeightedCoord[], string] {
    const coords: WeightedCoord[] = [];
    for (let x = 0; x < size[0]; x++) for (let y = 0; y < size[1]; y++) if (policyGrid[y][x] > 0) coords.push([policyGrid[y][x], 1, x, y]);
    return [coords, "Generated equal weights for all moves. "];
  }

  protected handleEndgame(legal: [number, Move][], size: [number, number]): [WeightedCoord[], string, number] | null {
    const threshold = this.s("endgame", 0.75) * size[0] * size[1];
    if (this.cn.depth > threshold) {
      const coords = legal.map(([pol, mv]) => [pol, 1, mv.coords![0], mv.coords![1]] as WeightedCoord);
      const nMoves = Math.trunc(Math.max(this.getNMoves(legal), Math.floor(legal.length / 2)));
      return [coords, `Generated equal weights as move number >= ${threshold}. `, nMoves];
    }
    return null;
  }

  protected selectFromWeightedCoords(coords: WeightedCoord[], nMoves: number, passPolicy: number): [Move, string] {
    const picked = weightedSelectionWithoutReplacement(coords, (c) => c[1], nMoves);
    if (!picked.length) {
      const top = this.cn.policyRanking![0][1];
      return [top, `Pick policy strategy failed to find legal moves, so is playing top policy move ${top.gtp()}.`];
    }
    // heapq.nlargest(5, pick_moves) compares tuples: policy first
    const topPicked = [...picked].sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || b[3] - a[3]).slice(0, 5);
    const newTop = topPicked.map(([p, , x, y]) => [p, new Move([x, y], this.cn.nextPlayer)] as [number, Move]);
    let aimove = newTop[0][1];
    let thoughts = `Top 5 among these were ${fmtMoves(newTop)} and picked top ${aimove.gtp()}. `;
    if (newTop[0][0] < passPolicy) {
      const top = this.cn.policyRanking![0][1];
      thoughts += `But found pass (${(100 * passPolicy).toFixed(2)}% to be higher rated than ${aimove.gtp()} (${(100 * newTop[0][0]).toFixed(2)}%) so will play top policy move instead.`;
      aimove = top;
    }
    return [aimove, thoughts];
  }

  protected overrides(): [number, number] {
    return [this.s("pick_override", 0), this.s("pick_override_two", 1.0)];
  }

  async generateMove(): Promise<[Move, string]> {
    await this.waitForAnalysis();
    if (!this.cn.policy) return new DefaultStrategy(this.game, this.settings).generateMove();
    const policyMoves = this.cn.policyRanking!;
    const passPolicy = this.cn.policy[this.cn.policy.length - 1];
    const top5Pass = policyMoves.slice(0, 5).some(([, m]) => m.isPass);
    const [ov, ov2] = this.overrides();
    const [override, overrideThoughts] = this.shouldPlayTopMove(policyMoves, top5Pass, ov, ov2);
    if (override) return [override, overrideThoughts];

    const legal = policyMoves.filter(([pol, mv]) => !mv.isPass && pol > 0);
    const size = this.game.boardSize;
    const policyGrid = varToGrid(this.cn.policy, size);
    const endgame = this.handleEndgame(legal, size);
    if (endgame) {
      const [coords, endThoughts, nMoves] = endgame;
      const [move, thoughts] = this.selectFromWeightedCoords(coords, nMoves, passPolicy);
      return [move, endThoughts + thoughts];
    }
    const [coords, weightThoughts] = this.generateWeightedCoords(legal, policyGrid, size);
    const nMoves = this.getNMoves(legal);
    const [move, thoughts] = this.selectFromWeightedCoords(coords, nMoves, passPolicy);
    return [
      move,
      weightThoughts + `Picked ${Math.min(nMoves, coords.length)} random moves according to weights. ` + thoughts,
    ];
  }
}

class PickStrategy extends PickBasedStrategy {
  protected handleEndgame(): null {
    return null;
  }
}

class RankStrategy extends PickBasedStrategy {
  protected getNMoves(legal: [number, Move][]): number {
    const [sx, sy] = this.game.boardSize;
    const squares = sx * sy;
    const norm = legal.length / squares;
    const kyu = this.s("kyu_rank");
    const orig = 0.063015 + (0.7624 * squares) / 10 ** (-0.05737 * kyu + 1.9482);
    const exponent = 3.002 * norm * norm - norm - 0.034889 * kyu - 0.5097;
    const modified = (0.3931 + 0.6559 * norm * Math.exp(-1 * exponent ** 2) - 0.01093 * kyu) * orig;
    const denominator = 1.31165 * (modified + 1) - 0.082653;
    return Math.max(1, pyRound((squares * norm) / denominator));
  }

  protected overrides(): [number, number] {
    const [sx, sy] = this.game.boardSize;
    const squares = sx * sy;
    const legal = this.cn.policyRanking!.filter(([pol, mv]) => !mv.isPass && pol > 0);
    const override = 0.8 * (1 - 0.5 * ((squares - legal.length) / squares));
    const overrideTwo = 0.85 + Math.max(0, 0.02 * (this.s("kyu_rank") - 8));
    return [override, overrideTwo];
  }

  protected handleEndgame(): null {
    return null;
  }
}

class InfluenceTerritoryStrategy extends PickBasedStrategy {
  constructor(
    game: Game,
    settings: AiSettings,
    private mode: typeof AI_INFLUENCE | typeof AI_TERRITORY,
  ) {
    super(game, settings);
  }

  protected generateWeightedCoords(_legal: [number, Move][], policyGrid: number[][], size: [number, number]): [WeightedCoord[], string] {
    const thrLine = this.s("threshold") - 1; // zero-based
    const lw = this.s("line_weight");
    const weight =
      this.mode === AI_INFLUENCE
        ? (x: number, y: number) =>
            (1 / lw) ** (Math.max(0, thrLine - Math.min(size[0] - 1 - x, x)) + Math.max(0, thrLine - Math.min(size[1] - 1 - y, y)))
        : (x: number, y: number) => (1 / lw) ** Math.max(0, Math.min(size[0] - 1 - x, x, size[1] - 1 - y, y) - thrLine);
    const coords: WeightedCoord[] = [];
    for (let x = 0; x < size[0]; x++) {
      for (let y = 0; y < size[1]; y++) {
        if (policyGrid[y][x] > 0) coords.push([policyGrid[y][x] * weight(x, y), weight(x, y), x, y]);
      }
    }
    return [coords, `Generated weights for ${this.mode} according to weight factor ${lw} and distance from ${thrLine + 1}th line. `];
  }
}

class LocalTenukiStrategy extends PickBasedStrategy {
  constructor(
    game: Game,
    settings: AiSettings,
    private mode: typeof AI_LOCAL | typeof AI_TENUKI,
  ) {
    super(game, settings);
  }

  async generateMove(): Promise<[Move, string]> {
    if (!(this.cn.move && this.cn.move.coords)) {
      return new WeightedStrategy(this.game, { pick_override: 0.9, weaken_fac: 1, lower_bound: 0.02 }).generateMove();
    }
    return super.generateMove();
  }

  protected generateWeightedCoords(_legal: [number, Move][], policyGrid: number[][], size: [number, number]): [WeightedCoord[], string] {
    const variance = this.s("stddev") ** 2;
    const [mx, my] = this.cn.move!.coords!;
    const coords: WeightedCoord[] = [];
    for (let x = 0; x < size[0]; x++) {
      for (let y = 0; y < size[1]; y++) {
        if (policyGrid[y][x] <= 0) continue;
        const g = Math.exp((-0.5 * ((x - mx) ** 2 + (y - my) ** 2)) / variance);
        coords.push([policyGrid[y][x], this.mode === AI_TENUKI ? 1 - g : g, x, y]);
      }
    }
    return [coords, `Generated weights based on one minus gaussian with variance ${variance} around coordinates ${mx},${my}. `];
  }
}

function pyRound(x: number): number {
  // Python's round() is round-half-to-even
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function makeStrategy(game: Game, mode: string, settings: AiSettings): AIStrategy {
  switch (mode) {
    case AI_HANDICAP:
      return new HandicapStrategy(game, settings);
    case AI_SCORELOSS:
      return new ScoreLossStrategy(game, settings);
    case AI_POLICY:
      return new PolicyStrategy(game, settings);
    case AI_WEIGHTED:
      return new WeightedStrategy(game, settings);
    case AI_PICK:
      return new PickStrategy(game, settings);
    case AI_RANK:
      return new RankStrategy(game, settings);
    case AI_INFLUENCE:
    case AI_TERRITORY:
      return new InfluenceTerritoryStrategy(game, settings, mode);
    case AI_LOCAL:
    case AI_TENUKI:
      return new LocalTenukiStrategy(game, settings, mode);
    default:
      return new DefaultStrategy(game, settings);
  }
}

/**
 * Generate and play an AI move at the current node. Returns the played node, or null when the
 * position changed or the analysis was discarded while thinking.
 */
export async function generateAiMove(game: Game, mode: string, settings: AiSettings): Promise<GameNode | null> {
  const strategy = makeStrategy(game, mode, settings);
  let move: Move;
  let thoughts: string;
  try {
    [move, thoughts] = await strategy.generateMove();
  } catch (e) {
    if (e instanceof AnalysisDiscardedError) return null;
    throw e;
  }
  const played = game.play(move, { expectedNode: strategy.cn });
  if (played) played.aiThoughts = thoughts;
  return played;
}

/** Exposed for tests: the n-largest helper with Python heapq semantics on the first element. */
export const _internals = { interp1d, interp2d, pyRound, nLargest };

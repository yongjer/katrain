// Player performance report, ported from game_report in katrain/core/ai.py.

import { ADDITIONAL_MOVE_ORDER } from "./constants";
import type { GameNode } from "./gameNode";
import type { Player } from "./constants";
import { evaluationClass } from "./utils";

export interface PlayerStats {
  accuracy: number;
  complexity: number;
  mean_ptloss: number;
  weighted_ptloss: number;
  ai_top_move: number;
  ai_top5_move: number;
}

export interface GameReport {
  /** Empty for a player without any evaluated moves. */
  sumStats: Record<Player, Partial<PlayerStats>>;
  /** One bucket per threshold, the biggest mistakes last (as in KaTrain). */
  histogram: Record<Player, number>[];
  playerPtloss: Record<Player, number[]>;
}

/** Depth filters of the report popup, as fractions of the board area. */
export const REPORT_FILTERS: Record<string, [number, number] | null> = {
  "Entire Game": null,
  Opening: [0, 0.14],
  Midgame: [0.14, 0.4],
  Endgame: [0.4, 10],
};

/**
 * Statistics over the moves of the main branch through `current` (from the root, then first children),
 * restricted to depths in `depthFilter` (fractions of the board area).
 */
export function gameReport(
  current: GameNode,
  thresholds: number[],
  depthFilter: [number, number] | null = null,
): GameReport {
  let cn = current;
  const line = cn.nodesFromRoot;
  while (cn.children.length) {
    cn = cn.children[0];
    line.push(cn);
  }
  const [x, y] = current.boardSize;
  const [lo, hi] = (depthFilter ?? [0, 1e9]).map((f) => Math.ceil(f * x * y));
  const nodes = line.filter((n) => n.move && !n.isRoot && lo <= n.depth && n.depth < hi);

  const histogram = thresholds.map(() => ({ B: 0, W: 0 }) as Record<Player, number>);
  const aiTopMove = { B: 0, W: 0 };
  const aiApproved = { B: 0, W: 0 };
  const playerPtloss: Record<Player, number[]> = { B: [], W: [] };
  const weights: Record<Player, [number, number][]> = { B: [], W: [] };

  for (const n of nodes) {
    const raw = n.pointsLost;
    if (raw === null) continue;
    const pointsLost = Math.max(0, raw);
    const player = n.player as Player;
    const bucket = thresholds.length - 1 - evaluationClass(pointsLost, thresholds);
    playerPtloss[player].push(pointsLost);
    histogram[bucket][player] += 1;
    const cands = n.parent!.candidateMoves;
    const filtered = cands.filter((d) => d.order < ADDITIONAL_MOVE_ORDER && d.prior !== undefined);
    const priorSum = filtered.reduce((s, d) => s + d.prior!, 0);
    // complexity, capped at 1
    const weight = Math.min(1, filtered.reduce((s, d) => s + Math.max(d.pointsLost, 0) * d.prior!, 0) / (priorSum || 1e-6));
    // between 0.05 and 1, dependent on difficulty and points lost
    const adjWeight = Math.max(0.05, Math.min(1, Math.max(weight, pointsLost / 4)));
    weights[player].push([weight, adjWeight]);
    if (n.parent!.analysisComplete) {
      const gtp = n.move!.gtp();
      if (cands[0].move === gtp) aiTopMove[player] += 1;
      if (filtered.some((d) => d.move === gtp && (d.order === 0 || (d.pointsLost < 0.5 && d.order < 5)))) aiApproved[player] += 1;
    }
  }

  const sumStats = {} as Record<Player, Partial<PlayerStats>>;
  for (const bw of ["B", "W"] as Player[]) {
    const losses = playerPtloss[bw];
    const ws = weights[bw];
    const wtLoss = losses.reduce((s, l, i) => s + l * ws[i][1], 0) / (ws.reduce((s, [, aw]) => s + aw, 0) || 1e-6);
    sumStats[bw] = losses.length
      ? {
          accuracy: 100 * 0.75 ** wtLoss,
          complexity: ws.reduce((s, [w]) => s + w, 0) / losses.length,
          mean_ptloss: losses.reduce((s, l) => s + l, 0) / losses.length,
          weighted_ptloss: wtLoss,
          ai_top_move: aiTopMove[bw] / losses.length,
          ai_top5_move: aiApproved[bw] / losses.length,
        }
      : {};
  }
  return { sumStats, histogram, playerPtloss };
}

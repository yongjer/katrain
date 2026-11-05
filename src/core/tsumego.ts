// Tsumego frame, ported from katrain/core/tsumego_frame.py (itself from lizgoban by kaorahi).
// Fills the rest of the board so KataGo reads a corner/edge problem as a life-and-death problem.
// Coordinates here are (i, j) = (row from the top, column), as in the original.

import type { Game } from "./game";
import { GameNode } from "./gameNode";
import { Move } from "./move";

const NEAR_TO_EDGE = 2;
const OFFENCE_TO_WIN = 5;

interface Cell {
  stone?: boolean;
  black?: boolean;
  frame?: boolean;
  regionMark?: boolean;
}
type Stones = Cell[][];
type FlipSpec = [boolean, boolean, boolean];
type Range = [number, number, number, number];

const xor = (a: unknown, b: unknown) => Boolean(a) !== Boolean(b);
const ijSizes = (s: unknown[][]): [number, number] => [s.length, s[0].length];

export interface TsumegoResult {
  blacks: [number, number][];
  whites: [number, number][];
  /** [[imin, imax], [jmin, jmax]] of the problem area, or null */
  region: [[number, number], [number, number]] | null;
}

/** bwBoard[i][j] is "B", "W" or "-" (i = row from the top). */
export function tsumegoFrame(bwBoard: string[][], komi: number, blackToPlay: boolean, ko: boolean, margin: number): TsumegoResult {
  const stones: Stones = bwBoard.map((row) => row.map((s) => (s === "B" || s === "W" ? { stone: true, black: s === "B" } : {})));
  const filled = frameStones(stones, komi, blackToPlay, ko, margin);
  const pick = (key: "frame" | "regionMark") =>
    filled.flatMap((row, i) => row.map((s, j) => [i, j, s] as const)).filter(([, , s]) => s?.[key]);
  const regionPos = pick("regionMark");
  const bw = pick("frame");
  return {
    blacks: bw.filter(([, , s]) => s.black).map(([i, j]) => [i, j]),
    whites: bw.filter(([, , s]) => !s.black).map(([i, j]) => [i, j]),
    region: analysisRegion(regionPos.map(([i, j]) => [i, j])),
  };
}

function analysisRegion(pos: [number, number][]): TsumegoResult["region"] {
  if (!pos.length) return null;
  const is = pos.map((p) => p[0]);
  const js = pos.map((p) => p[1]);
  const ri: [number, number] = [Math.min(...is), Math.max(...is)];
  const rj: [number, number] = [Math.min(...js), Math.max(...js)];
  return ri[0] < ri[1] && rj[0] < rj[1] ? [ri, rj] : null;
}

function frameStones(stones: Stones, komi: number, blackToPlay: boolean, ko: boolean, margin: number): Stones {
  const sizes = ijSizes(stones);
  const [isize, jsize] = sizes;
  const ijs = stones.flatMap((row, i) => row.flatMap((h, j) => (h.stone ? [{ i, j, black: !!h.black }] : [])));
  if (!ijs.length) return [];
  const minBy = (key: "i" | "j", sign: number) => ijs.reduce((best, z) => (sign * z[key] < sign * best[key] ? z : best));
  const top = minBy("i", 1);
  const left = minBy("j", 1);
  const bottom = minBy("i", -1);
  const right = minBy("j", -1);
  const imin = snap(top.i, 0);
  const jmin = snap(left.j, 0);
  const imax = snap(bottom.i, isize - 1);
  const jmax = snap(right.j, jsize - 1);
  // flip/rotate into the standard position (don't mix flip and swap)
  const flipSpec: FlipSpec = imin < jmin ? [false, false, true] : [needFlip(imin, imax, isize), needFlip(jmin, jmax, jsize), false];
  if (flipSpec.includes(true)) {
    const flipped = flipStones(stones, flipSpec);
    const filled = frameStones(flipped, komi, blackToPlay, ko, margin);
    return flipStones(filled, flipSpec);
  }
  const range: Range = [imin - margin, imax + margin, jmin - margin, jmax + margin];
  const blackToAttack = [top, bottom, left, right].reduce((acc, z) => acc + (z.black ? 1 : -1) * (height(z.i, isize) + height(z.j, jsize)), 0) > 0;
  putBorder(stones, sizes, range, blackToAttack);
  putOutside(stones, sizes, range, blackToAttack, komi);
  putKoThreat(stones, sizes, range, blackToAttack, blackToPlay, ko);
  return stones;
}

const snap = (k: number, to: number) => (Math.abs(k - to) <= NEAR_TO_EDGE ? to : k);
const needFlip = (kmin: number, kmax: number, size: number) => kmin < size - kmax - 1;
const height = (k: number, size: number) => size - Math.abs(k - (size - 1) / 2);
const inside = (i: number, j: number, [i0, i1, j0, j1]: Range) => i0 <= i && i <= i1 && j0 <= j && j <= j1;

function putStone(stones: Stones, [isize, jsize]: [number, number], i: number, j: number, black: boolean, empty: boolean, regionMark = false) {
  if (i < 0 || isize <= i || j < 0 || jsize <= j) return;
  stones[i][j] = empty ? {} : { stone: true, frame: true, black, regionMark };
}

function putBorder(stones: Stones, sizes: [number, number], [i0, i1, j0, j1]: Range, isBlack: boolean) {
  for (const at of [j0, j1]) for (let k = i0; k <= i1; k++) putStone(stones, sizes, k, at, isBlack, false, true);
  for (const at of [i0, i1]) for (let k = j0; k <= j1; k++) putStone(stones, sizes, at, k, isBlack, false, true);
}

function putOutside(stones: Stones, sizes: [number, number], range: Range, blackToAttack: boolean, komi: number) {
  const [isize, jsize] = sizes;
  let count = 0;
  const offenseKomi = (blackToAttack ? 1 : -1) * komi;
  const defenseArea = (isize * jsize - offenseKomi - OFFENCE_TO_WIN) / 2;
  for (let i = 0; i < isize; i++) {
    for (let j = 0; j < jsize; j++) {
      if (inside(i, j, range)) continue;
      count++;
      const black = xor(blackToAttack, count <= defenseArea);
      const empty = (i + j) % 2 === 0 && Math.abs(count - defenseArea) > isize;
      putStone(stones, sizes, i, j, black, empty);
    }
  }
}

// standard position: ? = problem, X = offense, O = defense (see the Python source for the diagram)
const OFFENSE_KO_THREAT: [string[], boolean, boolean] = [["....OOOX.", ".....XXXX"], true, false];
const DEFENSE_KO_THREAT: [string[], boolean, boolean] = [["..", "..", "X.", "XO", "OO", ".O"], false, true];

function putKoThreat(stones: Stones, sizes: [number, number], range: Range, blackToAttack: boolean, blackToPlay: boolean, ko: boolean) {
  const [isize, jsize] = sizes;
  const forOffense = xor(ko, xor(blackToAttack, blackToPlay));
  const [pattern, topP, leftP] = forOffense ? OFFENSE_KO_THREAT : DEFENSE_KO_THREAT;
  const h = pattern.length;
  const w = pattern[0].length;
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < pattern[i].length; j++) {
      const ai = i + (topP ? 0 : isize - h);
      const aj = j + (leftP ? 0 : jsize - w);
      if (inside(ai, aj, range)) return;
      const ch = pattern[i][j];
      putStone(stones, sizes, ai, aj, xor(blackToAttack, ch === "O"), ch === ".");
    }
  }
}

function flipStones(stones: Stones, [flipI, flipJ, swap]: FlipSpec): Stones {
  const [isize, jsize] = ijSizes(stones);
  const [ni, nj] = swap ? [jsize, isize] : [isize, jsize];
  const out: Stones = Array.from({ length: ni }, () => new Array<Cell>(nj));
  stones.forEach((row, i) =>
    row.forEach((z, j) => {
      const fi = flipI ? isize - 1 - i : i;
      const fj = flipJ ? jsize - 1 - j : j;
      const [a, b] = swap ? [fj, fi] : [fi, fj];
      out[a][b] = z;
    }),
  );
  return out;
}

/**
 * Add a tsumego frame around the stones of the current position as a new setup node (AB/AW),
 * returning the node and the region of interest [xmin, xmax, ymin, ymax].
 * Like the Python version, rows are KaTrain's y (0 at the bottom); the frame is symmetric under flips.
 */
export function addTsumegoFrame(game: Game, ko: boolean, margin: number): [GameNode, [number, number, number, number] | null] {
  const [sx, sy] = game.boardSize;
  const bw = game.stoneGrid.map((row) => row.map((p) => p ?? "-"));
  const blackToPlay = game.currentNode.nextPlayer === "B";
  const { blacks, whites, region } = tsumegoFrame(bw, game.komi, blackToPlay, ko, margin);
  const toSgf = (ijs: [number, number][]) => ijs.map(([i, j]) => new Move([j, i]).sgf([sx, sy]));
  const props: Record<string, string[]> = {};
  if (blacks.length) props.AB = toSgf(blacks);
  if (whites.length) props.AW = toSgf(whites);
  const node = new GameNode(game.currentNode, props); // the side to move stays the same (no B/W in this node)
  const roi: [number, number, number, number] | null = region ? [region[1][0], region[1][1], region[0][0], region[0][1]] : null;
  return [node, roi];
}

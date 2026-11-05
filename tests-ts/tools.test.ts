import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalysisRequest, KataGoEngine } from "../src/core/engine";
import { Game } from "../src/core/game";
import { GameNode, type KataGoResponse } from "../src/core/gameNode";
import { Move } from "../src/core/move";
import { parseSgf } from "../src/core/sgf";
import { addTsumegoFrame, tsumegoFrame } from "../src/core/tsumego";
import { setRng } from "../src/core/utils";
import { host } from "./helpers";

interface TsumegoCase {
  size: number;
  stones: [number, number, string][];
  komi: number;
  black_to_play: boolean;
  ko: boolean;
  margin: number;
  blacks: [number, number][];
  whites: [number, number][];
  region: [[number, number], [number, number]] | false | null;
}

describe("tsumego frame matches katrain/core/tsumego_frame.py", () => {
  const cases = JSON.parse(readFileSync(join(__dirname, "golden/tsumego.json"), "utf-8")) as TsumegoCase[];
  it(`reproduces all ${cases.length} golden cases`, () => {
    const sort = (a: [number, number][]) => [...a].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (const c of cases) {
      const board = Array.from({ length: c.size }, () => new Array<string>(c.size).fill("-"));
      for (const [i, j, color] of c.stones) board[i][j] = color;
      const r = tsumegoFrame(board, c.komi, c.black_to_play, c.ko, c.margin);
      expect(sort(r.blacks)).toEqual(c.blacks);
      expect(sort(r.whites)).toEqual(c.whites);
      expect(r.region).toEqual(c.region || null);
    }
  });

  it("adds a setup node and a region of interest to a game", () => {
    const g = new Game(host, null, { moveTree: parseSgf("(;SZ[19];B[ab];W[bb];B[ca];W[cb])") });
    g.redo(9999);
    const before = g.currentNode;
    const [node, roi] = addTsumegoFrame(g, false, 4);
    expect(node.parent).toBe(before);
    expect(node.placements.length).toBeGreaterThan(100);
    expect(node.nextPlayer).toBe(before.nextPlayer);
    g.setCurrentNode(node); // the frame must be a legal position
    expect(roi).not.toBeNull();
    const [xmin, xmax, ymin, ymax] = roi!;
    expect(xmin).toBeLessThanOrEqual(0);
    expect(xmax).toBeGreaterThanOrEqual(2);
    expect(ymax).toBe(18);
    expect(ymin).toBeLessThanOrEqual(17);
  });
});

describe("insert mode (Game.set_insert_mode)", () => {
  it("inserts an exchange and copies the rest of the game after it", () => {
    const g = new Game(host, null, { moveTree: parseSgf("(;SZ[9];B[ee];W[cc];B[gg];W[cg])") });
    g.redo(1); // after B E5
    g.setInsertMode(true);
    expect(g.insertMode).toBe(true);
    g.play(Move.fromGtp("G3", "W"), { analyze: false });
    g.play(Move.fromGtp("G2", "B"), { analyze: false });
    g.setCurrentNode(g.root); // navigation is blocked while inserting
    expect(g.currentNode.move!.gtp()).toBe("G2");
    g.setInsertMode(false);
    expect(g.insertMode).toBe(false);
    // the original line after E5 is W C7, B G3, W C3. C7 is copied; B G3 is now occupied (W G3), which ends the copy.
    const branch = g.root.children[0].children.find((c) => c.move!.gtp() === "G3")!;
    const line = branch.nodesInTree.map((n) => n.move!.player + n.move!.gtp());
    expect(line).toEqual(["WG3", "BG2", "WC7"]);
    expect(g.root.children[0].children[0].move!.gtp()).toBe("C7"); // the original line is untouched
  });

  it("undo in insert mode deletes inserted moves only", () => {
    const g = new Game(host, null, { moveTree: parseSgf("(;SZ[9];B[ee];W[cc])") });
    g.redo(1);
    g.setInsertMode(true);
    const inserted = g.play(Move.fromGtp("A1", "W"), { analyze: false })!;
    g.undo(1);
    expect(inserted.parent!.children).not.toContain(inserted);
    g.undo(1); // E5 is above the insertion point: not deleted
    expect(g.currentNode.move!.gtp()).toBe("E5");
    g.setInsertMode(false);
  });
});

describe("self-play (Game.selfplay)", () => {
  /** Engine stand-in that always suggests the first empty point of a fixed list. */
  function playingEngine() {
    const order = ["E5", "C3", "G7", "C7", "G3", "pass"];
    return {
      queryGeneration: 0,
      state: "ready",
      settings: { fast_visits: 5 },
      requestAnalysis(node: GameNode, req: AnalysisRequest) {
        const played = new Set(node.nodesFromRoot.flatMap((n) => n.moves.map((m) => m.gtp())));
        const move = order.find((m) => !played.has(m))!;
        const r: KataGoResponse = {
          id: "s",
          moveInfos: [{ move, order: 0, visits: 5, winrate: 0.5, scoreLead: 0, pv: [move] }],
          rootInfo: { visits: 5, winrate: 0.5, scoreLead: 0 },
        };
        setTimeout(() => req.callback(r, false), 0);
      },
    } as unknown as KataGoEngine;
  }
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("plays to the end in a collapsed branch and shows the final position", async () => {
    const g = new Game(host, playingEngine(), { moveTree: new GameNode(null, { SZ: 9 }) });
    await settle();
    g.selfplay("end");
    await settle();
    const [to] = g.root.shortcutsTo.at(-1)!;
    expect(g.currentNode).toBe(to); // like KaTrain, it jumps to the end when the AI passes
    expect(to.nodesFromRoot.slice(1).map((n) => n.move!.gtp())).toEqual(["E5", "C3", "G7", "C7", "G3"]);
    expect(to.aiThoughts).toContain("self-play");
  });

  it("sets up a position up to the requested move", async () => {
    setRng(() => 0.5);
    const g = new Game(host, playingEngine(), { moveTree: new GameNode(null, { SZ: 9 }) });
    await settle();
    g.selfplay(3, 0);
    await settle();
    expect(g.currentNode.depth).toBe(3);
    setRng(Math.random);
  });
});

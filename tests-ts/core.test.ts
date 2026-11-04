import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Game, IllegalMoveException } from "../src/core/game";
import { host } from "./helpers";
import { GameNode, type KataGoResponse } from "../src/core/gameNode";
import { pyFormat, parsePo } from "../src/core/i18n";
import { Move } from "../src/core/move";
import { parseGameFile, parseGib, parseSgf, writeSgf } from "../src/core/sgf";
import { packFloats, unpackFloats, varToGrid } from "../src/core/utils";

const root = join(__dirname, "..");
const golden = (name: string) => JSON.parse(readFileSync(join(__dirname, "golden", name), "utf-8"));

const newBoard = (props: Record<string, unknown> = { SZ: 19 }) => new Game(host, null, { moveTree: new GameNode(null, props) });
const play = (g: Game, gtp: string, player: "B" | "W", ignoreKo = false) =>
  g.play(Move.fromGtp(gtp, player), { ignoreKo });
const chains = (g: Game) => g.chains.filter((c) => c.length);

describe("float16 packing matches Python struct 'e'", () => {
  const data = golden("float16.json");
  it("packs identically", () => {
    expect(Buffer.from(packFloats(data.values)).toString("hex")).toBe(data.packed_hex);
  });
  it("unpacks identically", () => {
    const unpacked = unpackFloats(new Uint8Array(Buffer.from(data.packed_hex, "hex")), data.values.length)!;
    unpacked.forEach((v, i) => expect(Object.is(v, data.unpacked[i]) || v === data.unpacked[i]).toBe(true));
  });
});

describe("Move", () => {
  it("converts gtp and sgf coordinates", () => {
    const m = Move.fromGtp("Q16", "W");
    expect(m.coords).toEqual([15, 15]);
    expect(m.sgf([19, 19])).toBe("pd");
    expect(Move.fromSgf("pd", [19, 19]).gtp()).toBe("Q16");
    expect(Move.fromSgf("tt", [19, 19]).isPass).toBe(true);
    expect(Move.fromSgf("", [19, 19]).isPass).toBe(true);
    expect(Move.fromGtp("pass").gtp()).toBe("pass");
    expect(Move.fromGtp("AA30").coords).toEqual([25, 29]);
  });
});

describe("varToGrid", () => {
  it("puts the first row of KataGo output at the top (highest y)", () => {
    const grid = varToGrid([1, 2, 3, 4, 5, 6], [3, 2]);
    expect(grid[1]).toEqual([1, 2, 3]);
    expect(grid[0]).toEqual([4, 5, 6]);
  });
});

describe("handicap placement matches pysgf", () => {
  const data = golden("handicap.json") as Record<string, string[]>;
  for (const [key, expected] of Object.entries(data)) {
    it(key, () => {
      const [size, n] = key.split("-").map(Number);
      const node = new GameNode(null, { SZ: size });
      node.placeHandicapStones(n);
      const ab = [...(node.getListProperty("AB") ?? [])].sort();
      // >9 stones: CPython set iteration order decides ties, which is not worth emulating
      if (n > 9) expect(ab.length).toBe(expected.length);
      else expect(ab).toEqual(expected);
    });
  }
});

describe("parsing matches pysgf on tests/data", () => {
  const data = golden("parse.json") as Record<string, any>;
  for (const [fn, expected] of Object.entries(data)) {
    it(fn, () => {
      const contents = readFileSync(join(root, "tests/data", fn), "utf-8");
      if (expected.error) {
        expect(() => parseGameFile(contents, fn)).toThrow();
        return;
      }
      const tree = parseGameFile(contents, fn);
      const nodes = tree.nodesInTree;
      expect(nodes.length).toBe(expected.num_nodes);
      nodes.forEach((n, i) => {
        const exp = expected.nodes[i];
        // generated handicap stones come from a Python set, so their order is arbitrary
        const sortAB = (k: string, v: string[]) => (k === "AB" ? [...v].sort() : v);
        const props = Object.fromEntries([...n.properties].filter(([k]) => k !== "C").map(([k, v]) => [k, sortAB(k, v)]));
        const expProps = Object.fromEntries(
          Object.entries(exp.props as Record<string, unknown[]>)
            .filter(([k]) => k !== "C")
            .map(([k, v]) => [k, sortAB(k, v.map((x) => (typeof x === "number" && Number.isInteger(x) && k === "KM" ? x.toFixed(1) : String(x))))]),
        );
        expect(props).toEqual(expProps);
        expect(n.moves.map((m) => m.player + m.gtp())).toEqual(exp.moves);
        expect(n.placements.map((m) => m.player + m.gtp()).sort()).toEqual(exp.placements);
        expect(n.depth).toBe(exp.depth);
        expect(n.nextPlayer).toBe(exp.next_player);
      });
    });
  }

  it("round trips through writeSgf", () => {
    for (const fn of Object.keys(data).filter((f) => f.endsWith(".sgf"))) {
      const tree = parseGameFile(readFileSync(join(root, "tests/data", fn), "utf-8"), fn);
      const again = parseSgf(writeSgf(tree));
      const strip = (n: GameNode) =>
        [...n.properties].filter(([k]) => !["C", "AP", "CA", "KTV"].includes(k)).map(([k, v]) => `${k}=${v.join("|")}`);
      expect(again.nodesInTree.map(strip)).toEqual(tree.nodesInTree.map(strip));
      expect(again.nodesInTree.map((n) => n.note)).toEqual(tree.nodesInTree.map((n) => n.note));
    }
  });

  it("handles escapes and variations", () => {
    const tree = parseSgf("(;GM[1]FF[4]SZ[19]AB[dd][dj]C[a \\] b\\\\ c];B[dp];W[pp](;B[pj])(;B[pd]))");
    expect(tree.note).toBe("a ] b\\ c");
    expect(tree.placements.map((m) => m.gtp()).sort()).toEqual(["D10", "D16"]);
    expect(tree.children[0].children[0].children.length).toBe(2);
    expect(writeSgf(tree)).toContain("C[a \\] b\\\\ c");
  });

  it("expands compressed point lists", () => {
    const tree = parseSgf("(;SZ[9]AB[aa:cb]AE[ee])");
    expect(tree.placements.length).toBe(6);
    expect(tree.clearPlacements.map((m) => m.gtp())).toEqual(["E5"]);
  });
});

describe("GIB robustness (ported from tests/test_parser.py)", () => {
  const gib = readFileSync(join(root, "tests/data/test.gib"), "utf-8");
  it("survives malformed INI lines", () => {
    for (const broken of ["INI 0 1", "INI 0 1 0 x", "INI"]) {
      const mangled = gib.replace(/^INI .*$/m, broken);
      expect(parseGib(mangled).children[0].getProperty("B")).toBe("pd");
    }
  });
  it("survives malformed metadata", () => {
    const tree = parseGib(
      [
        "\\[GAMEBLACKNAME=kim (2D)\\]",
        "\\[GAMEWHITENAME=wildsim1 (2D)\\]",
        "\\[GAMEINFOMAIN=GRLT:0,ZIPSU:x,GONGJE:oops,\\]",
        "\\[GAMETAG=Cxxxx:yy:zz,W:nope,G:nope,\\]",
        "STO 0 1 1 15 3",
      ].join("\n"),
    );
    expect(tree.getProperty("PB")).toBe("kim");
    expect(tree.getProperty("KM")).toBeUndefined();
    expect(tree.getProperty("DT")).toBeUndefined();
  });
  it("fox files have no spurious handicap placements and a single line", () => {
    for (const fn of ["fox sgf error.sgf", "fox sgf works.sgf"]) {
      const tree = parseSgf(readFileSync(join(root, "tests/data", fn), "utf-8"));
      const g = new Game(host, null, { moveTree: tree });
      expect(g.root.placements).toEqual([]);
      while (g.currentNode.children.length) {
        expect(g.currentNode.children.length).toBe(1);
        g.redo(1);
      }
    }
  });
});

describe("board rules (ported from tests/test_board.py)", () => {
  it("merges chains", () => {
    const b = newBoard();
    play(b, "B9", "B");
    play(b, "A3", "B");
    play(b, "A9", "B");
    expect(chains(b).length).toBe(2);
    expect(b.stones.length).toBe(3);
    expect(b.prisoners.length).toBe(0);
  });

  it("rejects occupied points", () => {
    const b = newBoard();
    play(b, "B9", "B");
    expect(() => play(b, "B9", "W")).toThrow(IllegalMoveException);
    expect(chains(b).length).toBe(1);
    expect(b.stones.length).toBe(1);
  });

  it("captures and rejects single stone suicide", () => {
    const b = newBoard();
    play(b, "A2", "B");
    play(b, "B1", "W");
    play(b, "A1", "W");
    play(b, "C1", "B");
    expect(chains(b).length).toBe(3);
    expect(b.stones.length).toBe(4);
    play(b, "B2", "B");
    expect(chains(b).length).toBe(2);
    expect(b.stones.length).toBe(3);
    expect(b.prisoners.length).toBe(2);
    play(b, "B1", "B");
    expect(() => play(b, "A1", "W")).toThrow("Single stone suicide");
    expect(chains(b).length).toBe(1);
    expect(b.stones.length).toBe(4);
    expect(b.prisoners.length).toBe(2);
  });

  it("handles snapback", () => {
    const b = newBoard();
    for (const m of ["C1", "D1", "E1", "C2", "D3", "E4", "F2", "F3", "F4"]) play(b, m, "B");
    for (const m of ["D2", "E2", "C3", "D4", "C4"]) play(b, m, "W");
    expect(chains(b).length).toBe(5);
    expect(b.stones.length).toBe(14);
    play(b, "E3", "W");
    expect(chains(b).length).toBe(4);
    expect(b.stones.length).toBe(14);
    expect(b.prisoners.length).toBe(1);
    play(b, "D3", "B");
    expect(chains(b).length).toBe(4);
    expect(b.stones.length).toBe(12);
    expect(b.prisoners.length).toBe(4);
  });

  it("handles ko", () => {
    const b = newBoard();
    for (const m of ["A2", "B1"]) play(b, m, "B");
    for (const m of ["B2", "C1"]) play(b, m, "W");
    play(b, "A1", "W");
    expect(chains(b).length).toBe(4);
    expect(b.prisoners.length).toBe(1);
    expect(() => play(b, "B1", "B")).toThrow("Ko");
    play(b, "B1", "B", true);
    expect(b.prisoners.length).toBe(2);
    expect(() => play(b, "A1", "W")).toThrow(IllegalMoveException);
    play(b, "F1", "W");
    b.play(Move.pass("B"));
    play(b, "A1", "W");
    expect(b.prisoners.length).toBe(3);
  });

  it("loads handicap games", () => {
    const sgf =
      "(;GM[1]FF[4]CA[UTF-8]AP[CGoban:3]ST[2]RU[Chinese]SZ[19]HA[2]KM[0.50]TM[600]OT[5x30 byo-yomi]PW[kneh]PB[ayabot003]WR[4k]BR[6k]DT[2021-01-04]PC[The KGS Go Server at http://www.gokgs.com/]C[ayabot003 [6k\\]: GTP Engine for ayabot003 (black): Aya version 7.85x]RE[W+Resign];B[pd]BL[599.647];B[dp]BL[599.477];W[pp]WL[597.432];B[cd]BL[598.896];W[ed]WL[595.78];B[ec]BL[598.558])";
    expect(new Game(host, null, { moveTree: parseSgf(sgf) }).root.placements.length).toBe(0);
    expect(new Game(host, null, { moveTree: parseSgf("(;GM[1]FF[4]SZ[19]HA[2];)") }).root.placements.length).toBe(2);
  });

  it("applies suicide rules per ruleset", () => {
    const rulesets = ["jp", "cn", "ko", "aga", "tt", "nz", "stone_scoring", '{"suicide":true}', '{"suicide":false}'];
    for (const rule of rulesets) {
      const b = newBoard({ SZ: 19, RU: rule });
      play(b, "A18", "B");
      play(b, "B18", "B");
      play(b, "C19", "B");
      play(b, "A19", "W");
      expect(b.stones.length).toBe(4);
      if (["tt", "nz", '{"suicide":true}'].includes(rule)) {
        play(b, "B19", "W");
        expect(b.stones.length).toBe(3);
        expect(b.prisoners.length).toBe(2);
      } else {
        expect(() => play(b, "B19", "W")).toThrow("Suicide");
        expect(b.stones.length).toBe(4);
      }
    }
  });

  it("navigates with undo/redo and branches", () => {
    const b = newBoard({ SZ: 9 });
    for (const [m, p] of [
      ["E5", "B"],
      ["C3", "W"],
      ["G7", "B"],
    ] as const)
      play(b, m, p);
    b.undo(2);
    play(b, "D4", "W");
    expect(b.currentNode.parent!.children.length).toBe(2);
    b.undo(9999);
    expect(b.currentNode.isRoot).toBe(true);
    b.redo(9999);
    expect(b.currentNode.move!.gtp()).toBe("G7");
    b.undo(1);
    b.switchBranch(1);
    expect(b.currentNode.move!.gtp()).toBe("D4");
  });
});

describe("analysis bookkeeping", () => {
  const response = (moves: [string, number, number, number][], root: [number, number, number]): KataGoResponse => ({
    id: "QUERY:1",
    moveInfos: moves.map(([move, visits, winrate, scoreLead], order) => ({ move, order, visits, winrate, scoreLead, pv: [move] })),
    rootInfo: { visits: root[0], winrate: root[1], scoreLead: root[2] },
    policy: new Array(82).fill(0.01),
    ownership: new Array(81).fill(0),
  });

  it("computes candidate moves and points lost like KaTrain", () => {
    const b = newBoard({ SZ: 9 });
    const root = b.root;
    root.setAnalysis(response([["E5", 100, 0.6, 3], ["D4", 50, 0.55, 1.5]], [150, 0.58, 2.5]));
    const cands = root.candidateMoves;
    expect(cands.map((c) => c.move)).toEqual(["E5", "D4"]);
    expect(cands[0].pointsLost).toBeCloseTo(-0.5);
    expect(cands[1].pointsLost).toBeCloseTo(1.0);
    expect(cands[1].relativePointsLost).toBeCloseTo(1.5);

    const child = play(b, "D4", "B")!;
    child.setAnalysis(response([["F6", 80, 0.47, -1]], [80, 0.45, -1.2]));
    // white to move: score is still from black's perspective
    expect(child.pointsLost).toBeCloseTo(2.5 - -1.2);
    // the parent's entry for D4 is replaced by the child's more visited root info
    expect(root.analysis.moves["D4"].visits).toBe(80);
    expect(root.analysis.moves["D4"].pv).toEqual(["D4", "F6"]);
    expect(child.analysisComplete).toBe(true);
  });

  it("decodes KT analysis written by Python KaTrain and re-encodes it", () => {
    const kt = golden("kt.json");
    const tree = parseSgf(kt.sgf);
    const node = tree.children[0];
    expect(node.loadAnalysis()).toBe(true);
    expect(node.analysis.root).toEqual(kt.analysis.root);
    expect(node.analysis.moves).toEqual(kt.analysis.moves);
    expect(node.ownership).toEqual(kt.ownership16);
    expect(node.policy).toEqual(kt.policy16);

    const again = parseSgf(writeSgf(tree, { saveAnalysis: true }));
    expect(again.children[0].loadAnalysis()).toBe(true);
    expect(again.children[0].policy).toEqual(kt.policy16);
  });
});

describe("i18n", () => {
  it("formats Python format specs", () => {
    expect(pyFormat("Move was #{rank} ({probability:.2%}).", { rank: 3, probability: 0.1234 })).toBe("Move was #3 (12.34%).");
    expect(pyFormat("loss {points_lost:.1f}", { points_lost: 2.345 })).toBe("loss 2.3");
  });
  it("parses KaTrain's .po catalogs", () => {
    const en = parsePo(readFileSync(join(root, "katrain/i18n/locales/en/LC_MESSAGES/katrain.po"), "utf-8"));
    expect(en["Info:score"]).toBe("Score: {score}");
    const tw = parsePo(readFileSync(join(root, "katrain/i18n/locales/tw/LC_MESSAGES/katrain.po"), "utf-8"));
    expect(Object.keys(tw).length).toBeGreaterThan(200);
  });
});

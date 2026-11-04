import { describe, expect, it } from "vitest";
import { aiRankEstimation, generateAiMove } from "../src/core/ai";
import { AI_ANTIMIRROR, AI_HUMAN, AI_JIGO, AI_PRO, AI_SIMPLE_OWNERSHIP } from "../src/core/constants";
import type { AnalysisRequest, KataGoEngine } from "../src/core/engine";
import { Game } from "../src/core/game";
import { GameNode, type KataGoResponse, type MoveInfo } from "../src/core/gameNode";
import { Move } from "../src/core/move";
import { setRng } from "../src/core/utils";
import defaults from "../katrain/config.json";
import { host } from "./helpers";

/** Engine stand-in: records requests and answers them with `respond`. */
function fakeEngine(respond: (node: GameNode, req: AnalysisRequest) => KataGoResponse | null) {
  const requests: { node: GameNode; req: AnalysisRequest }[] = [];
  const engine = {
    queryGeneration: 0,
    state: "ready",
    requestAnalysis(node: GameNode, req: AnalysisRequest) {
      requests.push({ node, req });
      const r = respond(node, req);
      if (r) setTimeout(() => req.callback(r, false), 0);
    },
  };
  /** requests the AI made itself (the game also asks for normal analysis of new nodes) */
  const aiRequests = () => requests.filter((r) => r.req.extraSettings);
  return { engine: engine as unknown as KataGoEngine, requests, aiRequests };
}

const info = (move: string, order: number, scoreLead: number, extra: Partial<MoveInfo> = {}): MoveInfo => ({
  move,
  order,
  visits: 50,
  winrate: 0.5,
  scoreLead,
  pv: [move],
  ...extra,
});

function analyzedGame(engine: KataGoEngine, moves: MoveInfo[], root = { visits: 100, winrate: 0.5, scoreLead: 0 }) {
  const g = new Game(host, engine, { moveTree: new GameNode(null, { SZ: 9 }) });
  g.currentNode.setAnalysis({ id: "x", moveInfos: moves, rootInfo: root, policy: new Array(82).fill(0.01), ownership: new Array(81).fill(0) });
  return g;
}

const settings = (k: string) => (defaults.ai as Record<string, Record<string, number | boolean>>)[k];

describe("KataJigo", () => {
  it("plays the move closest to winning by 0.5", async () => {
    const { engine } = fakeEngine(() => null);
    const g = analyzedGame(engine, [info("E5", 0, 6), info("C3", 1, 0.7), info("A1", 2, -3)]);
    const played = await generateAiMove(g, AI_JIGO, settings(AI_JIGO));
    expect(played!.move!.gtp()).toBe("C3");
  });
});

describe("AntiMirror", () => {
  it("asks KataGo for antiMirror analysis and plays its top move", async () => {
    const { engine, aiRequests } = fakeEngine((_n, req) =>
      req.extraSettings?.antiMirror ? { id: "a", moveInfos: [info("G3", 0, 1)], rootInfo: { visits: 10, winrate: 0.5, scoreLead: 1 } } : null,
    );
    const g = analyzedGame(engine, [info("E5", 0, 1)]);
    const played = await generateAiMove(g, AI_ANTIMIRROR, {});
    expect(aiRequests()[0].req.extraSettings).toEqual({ antiMirror: true });
    expect(played!.move!.gtp()).toBe("G3");
  });
});

describe("Simple Style", () => {
  const own = (v: number) => new Array(81).fill(v);

  it("prefers settled territory within the point loss limit", async () => {
    const { engine } = fakeEngine(() => null);
    const g = analyzedGame(engine, [
      info("E5", 0, 0, { ownership: own(0.1) }),
      info("C3", 1, -0.5, { ownership: own(0.6) }), // loses 0.5 but settles far more
      info("G7", 2, -5, { ownership: own(0.9) }), // too big a loss (max_points_lost 1.75)
    ]);
    const played = await generateAiMove(g, AI_SIMPLE_OWNERSHIP, settings(AI_SIMPLE_OWNERSHIP));
    expect(played!.move!.gtp()).toBe("C3");
    expect(played!.aiThoughts).toContain("ai:simple strategy");
  });

  it("penalises attachments without support", async () => {
    const { engine } = fakeEngine(() => null);
    const g = new Game(host, engine, { moveTree: new GameNode(null, { SZ: 9 }) });
    g.play(Move.fromGtp("E5", "B"), { analyze: false });
    g.play(Move.fromGtp("E6", "W"), { analyze: false }); // black to move; F6 attaches to E6
    g.currentNode.setAnalysis({
      id: "x",
      moveInfos: [info("F6", 0, 0, { ownership: own(0.3) }), info("C3", 1, -0.2, { ownership: own(0.3) })],
      rootInfo: { visits: 100, winrate: 0.5, scoreLead: 0 },
    });
    // F6 is adjacent to white's E6 and has no own stone in KaTrain's (asymmetric) support area
    const played = await generateAiMove(g, AI_SIMPLE_OWNERSHIP, { ...settings(AI_SIMPLE_OWNERSHIP), attach_penalty: 5, tenuki_penalty: 0 });
    expect(played!.move!.gtp()).toBe("C3");
  });

  it("explains when KataGo gave no per-move ownership", async () => {
    const { engine } = fakeEngine(() => null);
    const g = analyzedGame(engine, [info("E5", 0, 0), info("C3", 1, -0.5)]);
    await expect(generateAiMove(g, AI_SIMPLE_OWNERSHIP, settings(AI_SIMPLE_OWNERSHIP))).rejects.toThrow(/per-move ownership/);
  });
});

describe("Human-like and Historical Pro", () => {
  function humanPolicy(best: string) {
    const p = new Array(82).fill(0);
    const m = Move.fromGtp(best);
    p[(9 - m.coords![1] - 1) * 9 + m.coords![0]] = 1;
    return p;
  }

  it("requests the right humanSLProfile and samples the human policy", async () => {
    setRng(() => 0.5);
    const { engine, aiRequests } = fakeEngine(() => ({
      id: "h",
      moveInfos: [info("E5", 0, 0)],
      rootInfo: { visits: 1, winrate: 0.5, scoreLead: 0 },
      humanPolicy: humanPolicy("C7"),
    }));
    const g = analyzedGame(engine, [info("E5", 0, 0)]);
    const played = await generateAiMove(g, AI_HUMAN, { human_kyu_rank: 8, modern_style: false });
    expect(aiRequests()[0].req.extraSettings).toEqual({ humanSLProfile: "preaz_8k", ignorePreRootHistory: false });
    expect(played!.move!.gtp()).toBe("C7");

    g.undo(1);
    await generateAiMove(g, AI_HUMAN, { human_kyu_rank: -2, modern_style: true });
    expect(aiRequests()[1].req.extraSettings!.humanSLProfile).toBe("rank_3d");
    g.undo(1);
    await generateAiMove(g, AI_PRO, { pro_year: 1914 });
    expect(aiRequests()[2].req.extraSettings!.humanSLProfile).toBe("proyear_1914");
    setRng(Math.random);
  });

  it("tells the user to set up the human-like model when KataGo has none", async () => {
    const { engine } = fakeEngine(() => ({ id: "h", moveInfos: [info("E5", 0, 0)], rootInfo: { visits: 1, winrate: 0.5, scoreLead: 0 } }));
    const g = analyzedGame(engine, [info("E5", 0, 0)]);
    await expect(generateAiMove(g, AI_HUMAN, { human_kyu_rank: 8, modern_style: false })).rejects.toThrow(/human model/);
  });

  it("estimates human-like strength from the rank setting", () => {
    expect(aiRankEstimation(AI_HUMAN, { human_kyu_rank: 8 })).toBe(-7);
    expect(aiRankEstimation(AI_PRO, { pro_year: 1914 })).toBe(9);
  });
});

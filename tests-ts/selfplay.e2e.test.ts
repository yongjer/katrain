// Self-play and the tsumego frame against a real KataGo. Opt-in like engine.e2e.test.ts (KATAGO_E2E=1).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KataGoEngine, type EngineSettings, type EngineTransport } from "../src/core/engine";
import { Game } from "../src/core/game";
import { addTsumegoFrame } from "../src/core/tsumego";
import { parseSgf } from "../src/core/sgf";
import defaultConfig from "../src/state/defaults.json";
import { host, resourcePath } from "./helpers";

const enabled = process.env.KATAGO_E2E === "1";
const dataDir = process.env.KATRAIN_DATA_DIR || join(tmpdir(), "katrain-e2e");

function transport(): EngineTransport {
  let handlers: Parameters<EngineTransport["setHandlers"]>[0];
  let proc: ReturnType<typeof spawn> | null = null;
  return {
    setHandlers: (h) => (handlers = h),
    async start(s: EngineSettings) {
      mkdirSync(dataDir, { recursive: true });
      const overrides = [`homeDataDir=${dataDir}`, "numAnalysisThreads=2", "numSearchThreads=2", "nnMaxBatchSize=8"].join(",");
      proc = spawn(resourcePath("katrain/KataGo/katago"), ["analysis", "-model", resourcePath(s.model), "-config", resourcePath(s.config), "-override-config", overrides]);
      createInterface({ input: proc.stdout! }).on("line", (l) => handlers.onStdout(l));
      createInterface({ input: proc.stderr! }).on("line", (l) => handlers.onStderr(l));
      proc.on("exit", (c) => handlers.onExit(c));
    },
    async send(line) {
      proc?.stdin?.write(line + "\n");
    },
    async stop() {
      proc?.kill();
    },
  };
}

async function until(cond: () => boolean, ms: number) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!enabled)("self-play and tsumego with KataGo", () => {
  const settings = { ...(defaultConfig.engine as unknown as EngineSettings), max_visits: 10, fast_visits: 4, max_time: 3 };
  const engine = new KataGoEngine(transport(), settings);
  beforeAll(() => engine.start(), 600_000);
  afterAll(() => engine.shutdown());

  it("sets up a 7x7 position up to move 6", async () => {
    const g = new Game(host, engine, { newGame: { size: "7", komi: 7, handicap: 0, rules: "japanese" } });
    await until(() => g.root.analysisExists, 600_000);
    g.selfplay(6, 0);
    await until(() => g.currentNode.depth >= 6, 600_000);
    expect(g.currentNode.depth).toBe(6);
    expect(g.currentNode.nodesFromRoot.every((n) => n.isRoot || n.move)).toBe(true);
  }, 1_300_000);

  it("analyzes a tsumego frame position", async () => {
    const g = new Game(host, engine, { moveTree: parseSgf("(;SZ[9];B[ab];W[bb];B[ca];W[cb];B[da];W[db])") });
    g.redo(9999);
    const [node, roi] = addTsumegoFrame(g, false, 2);
    g.setCurrentNode(node);
    g.setRegionOfInterest(roi);
    g.analyze(node); // like KaTrain: a normal whole-board query first
    await until(() => node.analysisExists, 600_000);
    expect(node.candidateMoves.length).toBeGreaterThan(0);
    // then a query restricted to the problem (deeper analysis uses the region of interest)
    let restricted = null as string[] | null;
    engine.requestAnalysis(node, {
      callback: (r, partial) => {
        if (!partial) restricted = r.moveInfos.map((m) => m.move);
      },
      regionOfInterest: g.regionOfInterest,
      visits: 10,
    });
    await until(() => restricted !== null, 600_000);
    const [xmin, xmax, ymin, ymax] = g.regionOfInterest!;
    for (const move of restricted!) {
      if (move === "pass") continue;
      const m = /^([A-HJ-T])(\d+)$/.exec(move)!;
      const x = "ABCDEFGHJKLMNOPQRST".indexOf(m[1]);
      const y = Number(m[2]) - 1;
      expect(x >= xmin && x <= xmax && y >= ymin && y <= ymax).toBe(true); // KataGo only searched inside the problem
    }
  }, 700_000);
});

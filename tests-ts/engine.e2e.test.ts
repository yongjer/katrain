// End-to-end: the TypeScript core driving a real KataGo analysis engine through a child_process transport.
// Skipped unless KATAGO_E2E=1 (needs a working KataGo; see README-tauri.md).
//
//   KATAGO_E2E=1 KATRAIN_DATA_DIR=/path/to/katago-home npx vitest run tests-ts/engine.e2e.test.ts

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAiMove } from "../src/core/ai";
import { AI_STRATEGIES_AVAILABLE } from "../src/core/constants";
import { KataGoEngine, type EngineSettings, type EngineTransport } from "../src/core/engine";
import { Game } from "../src/core/game";
import { Move } from "../src/core/move";
import { parseSgf, writeSgf } from "../src/core/sgf";
import defaultConfig from "../katrain/config.json";
import { host, TRAINER } from "./helpers";

const enabled = process.env.KATAGO_E2E === "1";
const repo = join(__dirname, "..");
const dataDir = process.env.KATRAIN_DATA_DIR || join(tmpdir(), "katrain-e2e");

class NodeTransport implements EngineTransport {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private handlers!: Parameters<EngineTransport["setHandlers"]>[0];
  stderr: string[] = [];
  setHandlers(h: Parameters<EngineTransport["setHandlers"]>[0]) {
    this.handlers = h;
  }
  async start(s: EngineSettings) {
    mkdirSync(dataDir, { recursive: true });
    const exe = process.env.KATAGO_EXE || join(repo, "katrain/KataGo/katago");
    const overrides = [`homeDataDir=${dataDir}`, "numAnalysisThreads=2", "numSearchThreads=2", "nnMaxBatchSize=8"].join(",");
    this.proc = spawn(exe, ["analysis", "-model", join(repo, s.model), "-config", join(repo, s.config), "-override-config", overrides]);
    createInterface({ input: this.proc.stdout }).on("line", (l) => this.handlers.onStdout(l));
    createInterface({ input: this.proc.stderr }).on("line", (l) => {
      this.stderr.push(l);
      this.handlers.onStderr(l);
    });
    this.proc.on("exit", (code) => this.handlers.onExit(code));
  }
  async send(line: string) {
    this.proc?.stdin.write(line + "\n");
  }
  async stop() {
    this.proc?.kill();
  }
}

async function until(cond: () => boolean, ms = 120_000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skipIf(!enabled)("KataGo end-to-end", () => {
  const transport = new NodeTransport();
  const settings: EngineSettings = {
    ...(defaultConfig.engine as unknown as EngineSettings),
    model: "katrain/models/b10c384h6nbttflrs.bin.gz",
    config: "katrain/KataGo/analysis_config.cfg",
    max_visits: 40,
    fast_visits: 8,
    max_time: 5,
  };
  const engine = new KataGoEngine(transport, settings, (m, l) => l === "error" && console.error(m));
  let game: Game;

  beforeAll(async () => {
    await engine.start();
    game = new Game(host, engine, { newGame: { size: "9", komi: 7, handicap: 0, rules: "japanese" } });
    await until(() => game.root.analysisComplete, 600_000);
  }, 650_000);

  afterAll(async () => {
    await engine.shutdown();
  });

  it("analyzes the empty board", () => {
    const root = game.root;
    expect(root.candidateMoves.length).toBeGreaterThan(0);
    expect(root.policy!.length).toBe(82);
    expect(root.ownership!.length).toBe(81);
    expect(root.rootVisits).toBeGreaterThan(0);
    expect(engine.state).toBe("ready");
  });

  it("analyzes a played move and computes point loss", async () => {
    const node = game.play(Move.fromGtp("A1", "B"))!;
    await until(() => node.analysisComplete);
    expect(node.pointsLost).not.toBeNull();
    expect(node.pointsLost!).toBeGreaterThan(1); // first line corner is a clear mistake
    // the parent learns about the played move from the child's root info
    expect(game.root.analysis.moves["A1"]).toBeDefined();
    game.undo(1);
  });

  for (const strategy of AI_STRATEGIES_AVAILABLE) {
    it(`plays a legal move with ${strategy}`, async () => {
      const cn = game.currentNode;
      const ai = (defaultConfig.ai as Record<string, Record<string, number | boolean>>)[strategy] ?? {};
      const played = await generateAiMove(game, strategy, ai);
      expect(played).not.toBeNull();
      expect(played!.parent).toBe(cn);
      expect(played!.aiThoughts.length).toBeGreaterThan(0);
      await until(() => played!.analysisComplete);
    }, 120_000);
  }

  it("runs extra analysis modes", async () => {
    const cn = game.currentNode;
    await until(() => cn.analysisComplete);
    const before = cn.rootVisits;
    game.analyzeExtra("extra");
    await until(() => cn.rootVisits > before && engine.isIdle());
    const nMoves = Object.keys(cn.analysis.moves).length;
    game.analyzeExtra("alternative");
    await until(() => engine.isIdle());
    expect(Object.keys(cn.analysis.moves).length).toBeGreaterThanOrEqual(nMoves);
    game.analyzeExtra("equalize");
    await until(() => engine.isIdle());
    game.analyzeExtra("sweep");
    await until(() => engine.isIdle(), 300_000);
    // sweep refines every legal point
    const legal = cn.policy!.slice(0, 81).filter((p) => p >= 0).length;
    expect(Object.keys(cn.analysis.moves).length).toBeGreaterThanOrEqual(legal);
  }, 400_000);

  it("ponders and stops", async () => {
    const cn = game.currentNode;
    const before = cn.rootVisits;
    game.analyzeExtra("ponder");
    expect(engine.isPondering).toBe(true);
    await until(() => cn.rootVisits > before + 50, 120_000);
    engine.stopPondering();
    expect(engine.isPondering).toBe(false);
  }, 130_000);

  it("saves analysis to SGF and restores it without the engine", () => {
    const sgf = writeSgf(game.root, { ...TRAINER, saveAnalysis: true, evalThresholds: TRAINER.eval_thresholds, saveCommentsClass: TRAINER.save_feedback });
    const reloaded = new Game(host, null, { moveTree: parseSgf(sgf) });
    const nodes = reloaded.root.nodesInTree;
    expect(nodes.length).toBe(game.root.nodesInTree.length);
    for (const n of nodes) {
      expect(n.loadAnalysis()).toBe(true);
      expect(n.policy?.length).toBe(82);
    }
    const original = game.root.candidateMoves[0];
    expect(reloaded.root.candidateMoves[0].move).toBe(original.move);
  });

  it("ignores results after a new game", async () => {
    const old = game.currentNode;
    old.clearAnalysis();
    game.analyze(old);
    engine.onNewGame();
    await new Promise((r) => setTimeout(r, 1500));
    expect(old.analysisExists).toBe(false);
  });
});

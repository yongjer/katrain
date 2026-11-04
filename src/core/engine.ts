// Ported from katrain/core/engine.py: drives the KataGo *analysis* engine over a JSON-lines transport.
// The transport (Tauri backend in the app, child_process in tests) owns the process; this class owns
// query bookkeeping, priorities, pondering and result dispatch.

import { PONDERING_REPORT_DT, type Player } from "./constants";
import type { GameNode, KataGoResponse } from "./gameNode";
import { Move } from "./move";

export interface EngineSettings {
  katago: string;
  altcommand: string;
  model: string;
  humanlike_model: string;
  config: string;
  max_visits: number;
  fast_visits: number;
  max_time: number;
  wide_root_noise: number;
  _enable_ownership: boolean;
}

export type EngineState = "stopped" | "starting" | "ready" | "dead";

export interface EngineTransport {
  /** Spawn the engine. Resolves once the process is running (not necessarily ready). */
  start(settings: EngineSettings): Promise<void>;
  send(line: string): Promise<void>;
  stop(): Promise<void>;
  /** Install handlers; called once by the engine before start. */
  setHandlers(handlers: {
    onStdout: (line: string) => void;
    onStderr: (line: string) => void;
    onExit: (code: number | null) => void;
  }): void;
}

export type LogLevel = "error" | "stderr" | "info" | "debug";
export type Logger = (message: string, level: LogLevel) => void;

type AnalysisCallback = (result: KataGoResponse, partial: boolean) => void;
type ErrorCallback = (result: KataGoResponse) => void;

interface PendingQuery {
  callback: AnalysisCallback | null;
  errorCallback: ErrorCallback | null;
  startTime: number;
  nextMove: Move | null;
  node: GameNode | null;
}

export type Rules = string | Record<string, unknown>;

const RULESETS_ABBR: [string, string][] = [
  ["jp", "japanese"],
  ["cn", "chinese"],
  ["ko", "korean"],
  ["aga", "aga"],
  ["tt", "tromp-taylor"],
  ["nz", "new zealand"],
  ["stone_scoring", "stone_scoring"],
];
export const RULESETS: Record<string, string> = Object.fromEntries(
  RULESETS_ABBR.flatMap(([abbr, name]) => [
    [abbr, name],
    [name, name],
  ]),
);

export function getRules(ruleset: string | Record<string, unknown>): Rules {
  if (typeof ruleset === "string" && ruleset.trim().startsWith("{")) {
    try {
      return JSON.parse(ruleset) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  if (typeof ruleset === "object") return ruleset;
  return RULESETS[String(ruleset).toLowerCase()] ?? "japanese";
}

export interface AnalysisRequest {
  callback: AnalysisCallback;
  errorCallback?: ErrorCallback;
  visits?: number;
  analyzeFast?: boolean;
  timeLimit?: boolean;
  findAlternatives?: boolean;
  regionOfInterest?: number[] | null;
  priority?: number;
  ponder?: boolean;
  ownership?: boolean;
  nextMove?: Move | null;
  extraSettings?: Record<string, unknown>;
  includePolicy?: boolean;
  reportEvery?: number | null;
}

const PONDER_KEY = "_kt_continuous";

type Query = Record<string, unknown> & { id?: string };

export class KataGoEngine {
  settings: EngineSettings;
  state: EngineState = "stopped";
  queryGeneration = 0;
  lastError: string | null = null;

  private queries = new Map<string, PendingQuery>();
  private ponderQuery: Query | null = null;
  private queryCounter = 0;
  private basePriority = 0;
  private listeners = new Set<() => void>();
  private readonly overrideSettings = { reportAnalysisWinratesAs: "BLACK" };

  constructor(
    private transport: EngineTransport,
    settings: EngineSettings,
    private log: Logger = () => {},
  ) {
    this.settings = settings;
    transport.setHandlers({
      onStdout: (line) => this.handleLine(line),
      onStderr: (line) => this.handleStderr(line),
      onExit: (code) => this.handleExit(code),
    });
  }

  /** Subscribe to "something changed" notifications (results arrived, state changed). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  private setState(state: EngineState) {
    this.state = state;
    this.notify();
  }

  async start() {
    this.lastError = null;
    this.setState("starting");
    try {
      await this.transport.start(this.settings);
    } catch (e) {
      this.lastError = String(e);
      this.log(`Starting KataGo failed: ${e}`, "error");
      this.setState("dead");
    }
  }

  async restart(settings?: EngineSettings) {
    if (settings) this.settings = settings;
    this.queryGeneration++;
    this.queries.clear();
    this.ponderQuery = null;
    await this.shutdown();
    await this.start();
  }

  async shutdown() {
    if (this.state === "stopped") return;
    this.state = "stopped"; // so the exit event is not reported as a crash
    await this.transport.stop().catch(() => {});
    this.notify();
  }

  get isAlive(): boolean {
    return this.state === "starting" || this.state === "ready";
  }

  onNewGame() {
    this.basePriority++;
    this.queryGeneration++;
    this.terminateQueries(null);
    this.ponderQuery = null;
    this.queries.clear();
  }

  terminateQueries(onlyForNode: GameNode | null = null) {
    for (const [id, q] of [...this.queries]) {
      if (onlyForNode === null || q.node === onlyForNode) this.terminateQuery(id);
    }
  }

  stopPondering() {
    const pq = this.ponderQuery;
    this.ponderQuery = null;
    if (pq?.id) this.terminateQuery(pq.id, false);
  }

  get isPondering(): boolean {
    return this.ponderQuery !== null;
  }

  terminateQuery(queryId: string, ignoreFurtherResults = true) {
    this.log(`Terminating query ${queryId}`, "debug");
    this.sendQuery({ action: "terminate", terminateId: queryId }, null, null);
    if (ignoreFurtherResults) this.queries.delete(queryId);
  }

  isIdle(): boolean {
    return this.queries.size === 0;
  }

  queriesRemaining(): number {
    return this.queries.size;
  }

  sendQuery(
    query: Query,
    callback: AnalysisCallback | null,
    errorCallback: ErrorCallback | null,
    nextMove: Move | null = null,
    node: GameNode | null = null,
  ) {
    if (!this.isAlive) {
      if (query.action !== "terminate") this.log("Query dropped: engine is not running", "debug");
      return;
    }
    if (!query.id) query.id = `QUERY:${++this.queryCounter}`;
    const ponder = Boolean(query[PONDER_KEY]);
    delete query[PONDER_KEY];
    if (ponder) {
      const pq = this.ponderQuery ?? {};
      const ignored = new Set(["id", "maxVisits", "reportDuringSearchEvery"]);
      const keys = new Set([...Object.keys(query), ...Object.keys(pq)]);
      const differs = [...keys].some((k) => !ignored.has(k) && JSON.stringify(pq[k]) !== JSON.stringify(query[k]));
      if (!differs) return; // same position and settings: keep the running ponder query
      this.stopPondering();
      query.maxVisits = 10_000_000;
      query.reportDuringSearchEvery = PONDERING_REPORT_DT;
      this.ponderQuery = query;
    }
    const terminate = query.action === "terminate";
    if (!terminate) {
      this.queries.set(query.id, { callback, errorCallback, startTime: performance.now(), nextMove, node });
    }
    const payload = JSON.stringify(query);
    this.log(`Sending ${ponder ? "ponder " : terminate ? "terminate " : ""}query ${query.id}: ${payload}`, "debug");
    this.transport.send(payload).catch((e) => this.log(`Exception in writing to katago: ${e}`, "error"));
  }

  requestAnalysis(node: GameNode, req: AnalysisRequest) {
    const nodes = node.nodesFromRoot;
    const moves = nodes.flatMap((n) => n.moves);
    const initialStones = nodes.flatMap((n) => n.placements);
    if (nodes.some((n) => n.clearPlacements.length)) {
      this.log(`Not analyzing node ${node.id} as there are AE commands in the path`, "debug");
      return;
    }
    const nextMove = req.nextMove ?? null;
    if (nextMove) moves.push(nextMove);
    const ownership = req.ownership ?? (this.settings._enable_ownership && !nextMove);
    let visits = req.visits;
    if (visits === undefined) {
      visits = this.settings.max_visits;
      if (req.analyzeFast && this.settings.fast_visits) visits = this.settings.fast_visits;
    }
    const [sizeX, sizeY] = node.boardSize;

    let avoid: Record<string, unknown>[] = [];
    if (req.findAlternatives) {
      avoid = [{ moves: Object.keys(node.analysis.moves), player: node.nextPlayer, untilDepth: 1 }];
    } else if (req.regionOfInterest) {
      const [xmin, xmax, ymin, ymax] = req.regionOfInterest;
      const outside: string[] = [];
      for (let x = 0; x < sizeX; x++) {
        for (let y = 0; y < sizeY; y++) {
          if (x < xmin || x > xmax || y < ymin || y > ymax) outside.push(new Move([x, y]).gtp());
        }
      }
      avoid = (["B", "W"] as Player[]).map((player) => ({ moves: outside, player, untilDepth: 1 }));
    }

    const settings: Record<string, unknown> = { ...this.overrideSettings, wideRootNoise: this.settings.wide_root_noise };
    if (req.timeLimit ?? true) settings.maxTime = this.settings.max_time;

    const query: Query = {
      rules: getRules(node.ruleset),
      priority: this.basePriority + (req.priority ?? 0),
      analyzeTurns: [moves.length],
      maxVisits: visits,
      komi: node.komi,
      boardXSize: sizeX,
      boardYSize: sizeY,
      includeOwnership: ownership && !nextMove,
      includeMovesOwnership: ownership && !nextMove,
      includePolicy: req.includePolicy ?? true,
      initialStones: initialStones.map((m) => [m.player, m.gtp()]),
      initialPlayer: node.initialPlayer,
      moves: moves.map((m) => [m.player, m.gtp()]),
      overrideSettings: { ...settings, ...(req.extraSettings ?? {}) },
      [PONDER_KEY]: req.ponder ?? false,
    };
    if (req.reportEvery !== undefined && req.reportEvery !== null) query.reportDuringSearchEvery = req.reportEvery;
    if (avoid.length) query.avoidMoves = avoid;
    this.sendQuery(query, req.callback, req.errorCallback ?? null, nextMove, node);
    node.analysisVisitsRequested = Math.max(node.analysisVisitsRequested, visits);
  }

  private handleStderr(line: string) {
    if (line.includes("Uncaught exception") || line.includes("what()")) {
      this.lastError = `KataGo Engine Failed: ${line.slice(9).trim()}`;
      this.log(this.lastError, "error");
      this.setState("dead");
      return;
    }
    // KataGo prints this once the analysis engine accepts queries.
    if (this.state === "starting" && line.includes("Started, ready to begin handling requests")) this.setState("ready");
    this.log(line, "stderr");
  }

  private handleExit(code: number | null) {
    if (this.state === "stopped") return;
    this.lastError = this.lastError ?? `Engine died unexpectedly (status ${code})`;
    this.log(this.lastError, "error");
    this.queries.clear();
    this.ponderQuery = null;
    this.setState("dead");
  }

  private handleLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    if (line.includes("Uncaught exception")) {
      this.lastError = `KataGo Engine Failed: ${line}`;
      this.log(this.lastError, "error");
      this.setState("dead");
      return;
    }
    let analysis: KataGoResponse;
    try {
      analysis = JSON.parse(line) as KataGoResponse;
    } catch (e) {
      this.log(`Unexpected exception ${e} while processing KataGo output ${line}`, "error");
      return;
    }
    if (this.state === "starting") this.state = "ready";
    if (!("id" in analysis)) {
      this.log(`Error without ID ${line} received from KataGo`, "error");
      return;
    }
    const queryId = analysis.id;
    const query = this.queries.get(queryId);
    if (!query) {
      if (analysis.action !== "terminate") {
        this.log(`Query result ${queryId} discarded -- recent new game or node reset?`, "debug");
      }
      return;
    }
    if (analysis.error !== undefined) {
      this.queries.delete(queryId);
      if (query.errorCallback) query.errorCallback(analysis);
      else if (!(query.nextMove && analysis.error.includes("Illegal move"))) {
        this.log(`${line} received from KataGo`, "error");
      }
    } else if (analysis.warning !== undefined || analysis.terminateId !== undefined) {
      this.log(`${line} received from KataGo`, "debug");
    } else {
      const partial = analysis.isDuringSearch ?? false;
      if (!partial) this.queries.delete(queryId);
      const resultsExist = !analysis.noResults;
      const dt = ((performance.now() - query.startTime) / 1000).toFixed(1);
      this.log(
        `[${dt}][${queryId}][${partial ? "...." : "done"}] KataGo analysis received: ${analysis.moveInfos?.length ?? 0} candidate moves, ${resultsExist ? analysis.rootInfo.visits : "n/a"} visits`,
        "debug",
      );
      try {
        if (query.callback && resultsExist) query.callback(analysis, partial);
      } catch (e) {
        this.log(`Error in engine callback for query ${queryId}: ${e}`, "error");
        console.error(e);
      }
    }
    this.notify();
  }
}

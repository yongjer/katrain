// Ported from pysgf.BaseGoNode and katrain/core/game_node.py

import { gunzipSync, gzipSync } from "fflate";
import {
  ADDITIONAL_MOVE_ORDER,
  ANALYSIS_FORMAT_VERSION,
  PROGRAM_NAME,
  SGF_INTERNAL_COMMENTS_MARKER,
  SGF_SEPARATOR_MARKER,
  VERSION,
  type Player,
} from "./constants";
import { t, tf } from "./i18n";
import { Move, type Coords } from "./move";
import { base64Decode, base64Encode, evaluationClass, packFloats, random, unpackFloats, varToGrid } from "./utils";

/** One candidate move as reported by KataGo (moveInfos[i]) and stored in node.analysis.moves. */
export interface MoveInfo {
  move: string;
  order: number;
  visits: number;
  winrate: number;
  scoreLead: number;
  scoreMean?: number;
  scoreStdev?: number;
  prior?: number;
  lcb?: number;
  utility?: number;
  pv?: string[];
  ownership?: number[];
  [key: string]: unknown;
}

export interface RootInfo {
  visits: number;
  winrate: number;
  scoreLead: number;
  scoreStdev?: number;
  currentPlayer?: string;
  pv?: string[];
  [key: string]: unknown;
}

export interface KataGoResponse {
  id: string;
  isDuringSearch?: boolean;
  turnNumber?: number;
  moveInfos: MoveInfo[];
  rootInfo: RootInfo;
  ownership?: number[];
  policy?: number[];
  noResults?: boolean;
  error?: string;
  warning?: string;
  field?: string;
  action?: string;
  terminateId?: string;
}

export interface NodeAnalysis {
  moves: Record<string, MoveInfo>;
  root: RootInfo | null;
  ownership: number[] | null;
  policy: number[] | null;
  completed: boolean;
}

export type CandidateMove = MoveInfo & { pointsLost: number; relativePointsLost?: number; winrateLost: number };

export interface SgfSaveOptions {
  saveCommentsPlayer?: Partial<Record<Player, boolean>>;
  saveCommentsClass?: boolean[];
  evalThresholds?: number[];
  saveAnalysis?: boolean;
  saveMarks?: boolean;
}

export function analysisDumps(analysis: NodeAnalysis): string[] {
  const copy = JSON.parse(JSON.stringify(analysis)) as NodeAnalysis;
  for (const moveDict of Object.values(copy.moves)) delete moveDict.ownership; // per-move ownership rarely used
  const ownershipData = packFloats(copy.ownership);
  const policyData = packFloats(copy.policy);
  const { ownership: _o, policy: _p, ...main } = copy;
  const mainData = new TextEncoder().encode(JSON.stringify(main));
  return [ownershipData, policyData, mainData].map((d) => base64Encode(gzipSync(d)));
}

let nextNodeId = 1;

export class GameNode {
  readonly id = nextNodeId++;
  children: GameNode[] = [];
  properties = new Map<string, string[]>();
  private _parent: GameNode | null = null;
  private _root: GameNode | null = null;
  private _depth: number | null = null;
  private movesCache: Move[] | null = null;

  // KaTrain specific state
  autoUndo: boolean | null = null; // null = not analyzed. false: not undone (good move). true: undone (bad move)
  aiThoughts = "";
  note = "";
  timeUsed = 0;
  undoThreshold = random(); // for fractional undos
  endState: string | null = null;
  analysisFromSgf: string[] | null = null;
  analysisVisitsRequested = 0;
  /** Collapsed branches: [node shown as direct child, first real child on the way there]. */
  shortcutsTo: [GameNode, GameNode][] = [];
  shortcutFrom: GameNode | null = null;
  analysis: NodeAnalysis = GameNode.emptyAnalysis();

  constructor(parent: GameNode | null = null, properties?: Record<string, unknown>, move?: Move) {
    if (properties) for (const [k, v] of Object.entries(properties)) this.setProperty(k, v);
    this.parent = parent;
    if (parent) parent.children.push(this);
    if (parent && move) this.setProperty(move.player, move.sgf(this.boardSize));
  }

  static emptyAnalysis(): NodeAnalysis {
    return { moves: {}, root: null, ownership: null, policy: null, completed: false };
  }

  // ---------------------------------------------------------------- properties
  get parent(): GameNode | null {
    return this._parent;
  }
  set parent(p: GameNode | null) {
    this._parent = p;
    this._root = null;
    this._depth = null;
  }

  addListProperty(rawProperty: string, values: string[]) {
    const property = rawProperty.replace(/[a-z]/g, ""); // FF[1-3] long names, e.g. Comment -> C
    if (property === "KT") {
      this.analysisFromSgf = values;
      return;
    }
    if (property === "C") {
      // strip out all previously auto generated comments, keep the rest as an editable note
      const comments = values
        .flatMap((v) => v.split(SGF_SEPARATOR_MARKER))
        .filter((c) => c.trim() && !c.includes(SGF_INTERNAL_COMMENTS_MARKER));
      this.note = comments.join("").trim();
      return;
    }
    this.movesCache = null;
    this.properties.set(property, [...(this.properties.get(property) ?? []), ...values]);
  }

  getListProperty(property: string): string[] | undefined {
    return this.properties.get(property);
  }

  setProperty(property: string, value: unknown) {
    const list = Array.isArray(value) ? value.map(String) : [String(value)];
    this.movesCache = null;
    this.properties.set(property, list);
  }

  getProperty(property: string): string | undefined;
  getProperty(property: string, defaultValue: string): string;
  getProperty(property: string, defaultValue?: string): string | undefined {
    const v = this.properties.get(property);
    return v && v.length ? v[0] : defaultValue;
  }

  clearProperty(property: string) {
    this.movesCache = null;
    this.properties.delete(property);
  }

  hasProperty(property: string): boolean {
    return this.properties.has(property);
  }

  // ---------------------------------------------------------------- tree
  /** Collapse the line between this node and a descendant, so the descendant shows as a direct child. */
  addShortcut(toNode: GameNode) {
    const nodes: GameNode[] = [toNode];
    while (nodes[nodes.length - 1].parent && nodes[nodes.length - 1] !== this) nodes.push(nodes[nodes.length - 1].parent!);
    if (nodes[nodes.length - 1] === this && nodes.length > 2) {
      const via = nodes[nodes.length - 2];
      this.shortcutsTo.push([toNode, via]);
      toNode.shortcutFrom = this;
    }
  }

  removeShortcut() {
    const from = this.shortcutFrom;
    if (from) {
      from.shortcutsTo = from.shortcutsTo.filter(([m]) => m !== this);
      this.shortcutFrom = null;
    }
  }

  get root(): GameNode {
    if (!this._root) this._root = this._parent ? this._parent.root : this;
    return this._root;
  }

  get depth(): number {
    if (this._depth === null) this._depth = this.isRoot ? 0 : this._parent!.depth + this.moves.length;
    return this._depth;
  }

  get isRoot(): boolean {
    return this._parent === null;
  }

  get empty(): boolean {
    return this.children.length === 0 && this.properties.size === 0;
  }

  /** Breadth first list of all nodes in the subtree. */
  get nodesInTree(): GameNode[] {
    const nodes: GameNode[] = [];
    const queue: GameNode[] = [this];
    for (let i = 0; i < queue.length; i++) {
      nodes.push(queue[i]);
      queue.push(...queue[i].children);
    }
    return nodes;
  }

  get nodesFromRoot(): GameNode[] {
    const nodes: GameNode[] = [];
    for (let n: GameNode | null = this; n; n = n.parent) nodes.push(n);
    return nodes.reverse();
  }

  /** Analyzed/not undone moves first, unanalyzed second, undone (teaching mode) last. */
  get orderedChildren(): GameNode[] {
    const rank = (c: GameNode) => (c.autoUndo === null ? 0.5 : Number(c.autoUndo));
    return [...this.children].sort((a, b) => rank(a) - rank(b));
  }

  play(move: Move): GameNode {
    for (const child of this.children) {
      const m = child.move;
      if (m && m.equals(move)) return child;
    }
    return new GameNode(this, undefined, move);
  }

  // ---------------------------------------------------------------- game info
  get boardSize(): [number, number] {
    const size = String(this.root.getProperty("SZ", "19"));
    if (size.includes(":")) {
      const [x, y] = size.split(":").map((s) => parseInt(s, 10));
      return [x, y];
    }
    const x = parseInt(size, 10);
    return [x, x];
  }

  get komi(): number {
    const k = parseFloat(this.root.getProperty("KM", "6.5"));
    return Number.isNaN(k) ? 6.5 : k;
  }

  get handicap(): number {
    const h = parseInt(this.root.getProperty("HA", "0"), 10);
    return Number.isNaN(h) ? 0 : h;
  }

  get ruleset(): string {
    return this.root.getProperty("RU", "japanese");
  }

  get moves(): Move[] {
    if (this.movesCache === null) {
      const bs = this.boardSize;
      this.movesCache = Move.PLAYERS.flatMap((player) =>
        (this.getListProperty(player) ?? []).map((m) => Move.fromSgf(m, bs, player)),
      );
    }
    return this.movesCache;
  }

  private expandedPlacements(player: Player | null): Move[] {
    const placements = this.getListProperty("A" + (player ?? "E")) ?? [];
    if (!placements.length) return [];
    const bs = this.boardSize;
    // AE (clear) placements have no meaningful player; only their coordinates are used.
    const pl: Player = player ?? "B";
    if (!placements.some((p) => p.includes(":"))) return placements.map((p) => Move.fromSgf(p, bs, pl));
    const seen = new Map<string, Move>();
    const add = (c: Coords) => seen.set(`${c[0]},${c[1]}`, new Move(c, pl));
    for (const p of placements) {
      if (!p.includes(":")) {
        const c = Move.fromSgf(p, bs).coords;
        if (c) add(c);
        continue;
      }
      const [from, to] = p.split(":").slice(0, 2).map((c) => Move.fromSgf(c, bs));
      for (let x = from.coords![0]; x <= to.coords![0]; x++) {
        for (let y = to.coords![1]; y <= from.coords![1]; y++) {
          if (x >= 0 && x < bs[0] && y >= 0 && y < bs[1]) add([x, y]);
        }
      }
    }
    return [...seen.values()];
  }

  get placements(): Move[] {
    return Move.PLAYERS.flatMap((p) => this.expandedPlacements(p));
  }

  get clearPlacements(): Move[] {
    return this.expandedPlacements(null);
  }

  get moveWithPlacements(): Move[] {
    return [...this.placements, ...this.moves];
  }

  get move(): Move | null {
    const moves = this.moves;
    return moves.length === 1 ? moves[0] : null;
  }

  get isPass(): boolean {
    const m = this.move;
    return this.placements.length === 0 && !!m && m.isPass;
  }

  get initialPlayer(): Player {
    const root = this.root;
    if (root.hasProperty("PL")) return root.getProperty("PL", "").toUpperCase().trim() === "B" ? "B" : "W";
    for (const child of root.children) {
      for (const color of Move.PLAYERS) if (child.hasProperty(color)) return color;
    }
    if (this.hasProperty("AB") && !this.hasProperty("AW")) return "W";
    return "B";
  }

  get nextPlayer(): Player {
    if (this.isRoot) return this.initialPlayer;
    if (this.hasProperty("B")) return "W";
    if (this.hasProperty("W")) return "B";
    return this.parent!.nextPlayer;
  }

  get player(): Player {
    if (this.hasProperty("B") || (this.hasProperty("AB") && !this.hasProperty("W"))) return "B";
    return "W";
  }

  placeHandicapStones(nHandicaps: number, tygem = false) {
    const [bx, by] = this.boardSize;
    if (Math.min(bx, by) < 3) return;
    let nearX = bx >= 13 ? 3 : Math.min(2, bx - 1);
    const nearY = by >= 13 ? 3 : Math.min(2, by - 1);
    let farX = bx - 1 - nearX;
    const farY = by - 1 - nearY;
    const middleX = Math.floor(bx / 2);
    const middleY = Math.floor(by / 2);
    let stones: Coords[];
    if (nHandicaps > 9 && bx === by) {
      const stonesPerRow = Math.ceil(Math.sqrt(nHandicaps));
      let spacing = (farX - nearX) / (stonesPerRow - 1);
      if (spacing < nearX) {
        farX += 1;
        nearX -= 1;
        spacing = (farX - nearX) / (stonesPerRow - 1);
      }
      const coords = [...new Set(Array.from({ length: stonesPerRow }, (_, i) => Math.floor(0.5 + nearX + i * spacing)))];
      const cx = (bx - 1) / 2;
      const cy = (by - 1) / 2;
      stones = coords
        .flatMap((x) => coords.map((y) => [x, y] as Coords))
        .sort((a, b) => (b[0] - cx) ** 2 + (b[1] - cy) ** 2 - ((a[0] - cx) ** 2 + (a[1] - cy) ** 2));
    } else {
      stones = [
        [farX, farY],
        [nearX, nearY],
        [farX, nearY],
        [nearX, farY],
      ];
      if (nHandicaps % 2 === 1) stones.push([middleX, middleY]);
      stones.push([nearX, middleY], [farX, middleY], [middleX, nearY], [middleX, farY]);
    }
    if (tygem) [stones[2], stones[3]] = [stones[3], stones[2]];
    const sgf = [...new Set(stones.slice(0, nHandicaps).map((s) => new Move(s).sgf([bx, by])))];
    this.setProperty("AB", sgf);
  }

  // ---------------------------------------------------------------- analysis
  clearAnalysis() {
    this.analysisVisitsRequested = 0;
    this.analysis = GameNode.emptyAnalysis();
  }

  loadAnalysis(): boolean {
    if (!this.analysisFromSgf) return false;
    try {
      const [szx, szy] = this.root.boardSize;
      const squares = szx * szy;
      const version = this.root.getProperty("KTV", ANALYSIS_FORMAT_VERSION);
      if (version > ANALYSIS_FORMAT_VERSION) {
        throw new Error(`Can not decode analysis data with version ${version}, please update ${PROGRAM_NAME}`);
      }
      const [ownershipData, policyData, mainData] = this.analysisFromSgf.map((d) => gunzipSync(base64Decode(d)));
      const main = JSON.parse(new TextDecoder().decode(mainData)) as Omit<NodeAnalysis, "ownership" | "policy">;
      this.analysis = {
        ...main,
        policy: unpackFloats(policyData, squares + 1),
        ownership: unpackFloats(ownershipData, squares),
      };
      return true;
    } catch (e) {
      console.warn(`Error in loading analysis: ${e}`);
      return false;
    }
  }

  updateMoveAnalysis(moveAnalysis: Partial<MoveInfo> & { visits: number }, moveGtp: string) {
    const cur = this.analysis.moves[moveGtp];
    if (!cur) {
      this.analysis.moves[moveGtp] = { move: moveGtp, order: ADDITIONAL_MOVE_ORDER, ...moveAnalysis } as MoveInfo;
      return;
    }
    cur.order = Math.min(cur.order, moveAnalysis.order ?? ADDITIONAL_MOVE_ORDER); // parent arriving after child
    if (cur.visits < moveAnalysis.visits) {
      Object.assign(cur, moveAnalysis);
    } else {
      for (const [k, v] of Object.entries(moveAnalysis)) if (!(k in cur)) cur[k] = v; // prior etc only
    }
  }

  setAnalysis(
    analysisJson: KataGoResponse,
    refineMove: Move | null = null,
    additionalMoves = false,
    regionOfInterest: number[] | null = null,
    partialResult = false,
  ) {
    if (refineMove) {
      const pvtail = analysisJson.moveInfos.length ? (analysisJson.moveInfos[0].pv ?? []) : [];
      this.updateMoveAnalysis({ pv: [refineMove.gtp(), ...pvtail], ...analysisJson.rootInfo }, refineMove.gtp());
      return;
    }
    if (additionalMoves) {
      for (const m of analysisJson.moveInfos) delete (m as Partial<MoveInfo>).order; // old order matters
    } else {
      for (const moveDict of Object.values(this.analysis.moves)) moveDict.order = ADDITIONAL_MOVE_ORDER; // old moves to end
    }
    for (const moveAnalysis of analysisJson.moveInfos) this.updateMoveAnalysis(moveAnalysis, moveAnalysis.move);
    this.analysis.ownership = analysisJson.ownership ?? null;
    this.analysis.policy = analysisJson.policy ?? null;
    if (!additionalMoves && !regionOfInterest) {
      this.analysis.root = analysisJson.rootInfo;
      const move = this.move;
      if (this.parent && move) {
        analysisJson.rootInfo.pv = [
          move.gtp(),
          ...(analysisJson.moveInfos.length ? (analysisJson.moveInfos[0].pv ?? []) : []),
        ];
        this.parent.updateMoveAnalysis(analysisJson.rootInfo, move.gtp()); // keep the parent consistent
      }
    }
    const isNormalQuery = !additionalMoves;
    this.analysis.completed = this.analysis.completed || (isNormalQuery && !partialResult);
  }

  get ownership(): number[] | null {
    return this.analysis.ownership;
  }
  get policy(): number[] | null {
    return this.analysis.policy;
  }
  get analysisExists(): boolean {
    return this.analysis.root !== null;
  }
  get analysisComplete(): boolean {
    return this.analysis.completed && this.analysis.root !== null;
  }
  get rootVisits(): number {
    return this.analysis.root?.visits ?? 0;
  }
  get score(): number | null {
    return this.analysis.root ? this.analysis.root.scoreLead : null;
  }
  get winrate(): number | null {
    return this.analysis.root ? this.analysis.root.winrate : null;
  }

  formatScore(score: number | null = null): string | null {
    const s = score ?? this.score;
    if (s === null || s === undefined) return null;
    const leader = s >= 0 ? "B" : "W";
    return `${t(`short color ${leader}`)}+${Math.abs(s).toFixed(1)}`;
  }

  formatWinrate(winRate: number | null = null): string | null {
    const w = winRate ?? this.winrate;
    if (w === null || w === undefined) return null;
    const leader = w > 0.5 ? "B" : "W";
    return `${t(`short color ${leader}`)} ${(100 * Math.max(w, 1 - w)).toFixed(1)}%`;
  }

  static playerSign(player: Player | null | undefined): number {
    return player === "B" ? 1 : player === "W" ? -1 : 0;
  }

  get pointsLost(): number | null {
    const move = this.move;
    if (move && this.parent && this.analysisExists && this.parent.analysisExists) {
      return GameNode.playerSign(move.player) * (this.parent.score! - this.score!);
    }
    return null;
  }

  get parentRealizedPointsLost(): number | null {
    const move = this.move;
    const gp = this.parent?.parent;
    if (move && gp && this.analysisExists && gp.analysisExists) {
      return GameNode.playerSign(move.player) * (this.score! - gp.score!);
    }
    return null;
  }

  get candidateMoves(): CandidateMove[] {
    const root = this.analysis.root;
    if (!root) return [];
    const moveDicts = Object.values(this.analysis.moves);
    if (!moveDicts.length) {
      const polmoves = this.policyRanking;
      const top = polmoves && polmoves.length ? polmoves[0][1] : Move.pass();
      return [
        { ...root, pointsLost: 0, winrateLost: 0, order: 0, move: top.gtp(), pv: [top.gtp()] } as CandidateMove,
      ]; // single visit -> go by policy/root
    }
    const sign = GameNode.playerSign(this.nextPlayer);
    const topMove = moveDicts.find((d) => d.order === 0);
    const topScoreLead = topMove ? topMove.scoreLead : root.scoreLead;
    return moveDicts
      .map((d) => ({
        pointsLost: sign * (root.scoreLead - d.scoreLead),
        relativePointsLost: sign * (topScoreLead - d.scoreLead),
        winrateLost: sign * (root.winrate - d.winrate),
        ...d,
      }))
      .sort((a, b) => a.order - b.order || a.pointsLost - b.pointsLost);
  }

  /** Moves from highest policy value to lowest, with pass included (policy -1 = illegal). */
  get policyRanking(): [number, Move][] | null {
    const policy = this.policy;
    if (!policy) return null;
    const [szx, szy] = this.boardSize;
    const grid = varToGrid(policy, [szx, szy]);
    const np = this.nextPlayer;
    const moves: [number, Move][] = [];
    for (let x = 0; x < szx; x++) for (let y = 0; y < szy; y++) moves.push([grid[y][x], new Move([x, y], np)]);
    moves.push([policy[policy.length - 1], Move.pass(np)]);
    return moves.sort((a, b) => b[0] - a[0]);
  }

  movePolicyStats(): [number | null, number, [number, Move][]] {
    const move = this.move;
    if (move && this.parent) {
      const ranking = this.parent.policyRanking;
      if (ranking) {
        for (let ix = 0; ix < ranking.length; ix++) {
          if (ranking[ix][1].equals(move)) return [ix + 1, ranking[ix][0], ranking];
        }
      }
    }
    return [null, 0, []];
  }

  /** Human readable info text for the move leading to this node (plain text version of Kivy markup). */
  comment(opts: { sgf?: boolean; teach?: boolean; details?: boolean } = {}): string {
    const { sgf = false, teach = false, details = false } = opts;
    const move = this.move;
    if (!this.parent || !move) {
      let rules = this.getProperty("RU", "Japanese");
      if (!rules.trim().startsWith("{")) rules = t(rules.toLowerCase());
      return `${t("komi")}: ${this.komi.toFixed(1)}\n${t("ruleset")}: ${rules}\n`;
    }
    let text = tf("move", { number: this.depth }) + `: ${move.player} ${move.gtp()}\n`;
    if (this.analysisExists) {
      if (sgf) {
        text += tf("Info:score", { score: this.formatScore() }) + "\n";
        text += tf("Info:winrate", { winrate: this.formatWinrate() }) + "\n";
      }
      if (this.parent.analysisExists) {
        const prevTop = this.parent.candidateMoves[0];
        if (sgf || details) {
          if (prevTop.move !== move.gtp()) {
            const pl = this.pointsLost!;
            if (sgf && pl > 0.5) text += tf("Info:point loss", { points_lost: pl }) + "\n";
            text += tf("Info:top move", { top_move: prevTop.move, score: this.formatScore(prevTop.scoreLead) }) + "\n";
          } else {
            text += t("Info:best move") + "\n";
          }
          if (prevTop.pv) text += tf("Info:PV", { pv: `${move.player}${prevTop.pv.join(" ")}` }) + "\n";
        }
        if (sgf || details || teach) {
          const [rank, prob, ranking] = this.movePolicyStats();
          if (rank !== null) text += tf("Info:policy rank", { rank, probability: prob }) + "\n";
          if (rank !== 1 && ranking.length && (sgf || details)) {
            text += tf("Info:policy best", { move: ranking[0][1].gtp(), probability: ranking[0][0] }) + "\n";
          }
        }
      }
      if (this.autoUndo && sgf) {
        text += t("Info:teaching undo") + "\n";
        const topPv = this.candidateMoves[0]?.pv;
        if (topPv) text += tf("Info:undo predicted PV", { pv: `${this.nextPlayer}${topPv.join(" ")}` }) + "\n";
      }
    } else {
      text = sgf ? t("No analysis available") : t("Analyzing move...");
    }
    if (this.aiThoughts && (sgf || details)) text += "\n" + tf("Info:AI thoughts", { thoughts: this.aiThoughts });
    const c = this.getListProperty("C");
    if (c) text += "\nSGF Comments:\n" + c.join("\n");
    return text;
  }

  /** Properties to write for this node, including KaTrain feedback comments and packed analysis. */
  sgfProperties(opts: SgfSaveOptions = {}): Map<string, string[]> {
    const properties = new Map([...this.properties].map(([k, v]) => [k, [...v]] as [string, string[]]));
    const note = this.note.trim();
    if (opts.saveAnalysis && this.analysisComplete) {
      try {
        properties.set("KT", analysisDumps(this.analysis));
      } catch (e) {
        console.warn(`Error in saving analysis: ${e}`);
      }
    }
    const pl = this.pointsLost;
    const showClass =
      pl && opts.saveCommentsClass && opts.evalThresholds
        ? opts.saveCommentsClass[evaluationClass(pl, opts.evalThresholds)]
        : false;
    let comments = properties.get("C") ?? [];
    if (
      this.parent &&
      this.parent.analysisExists &&
      this.analysisExists &&
      (note || ((opts.saveCommentsPlayer ?? {})[this.player] && showClass))
    ) {
      if (opts.saveMarks) {
        const bs = this.boardSize;
        const cands = this.parent.candidateMoves;
        const topX = Move.fromGtp(cands[0].move).sgf(bs);
        const bestSq = cands
          .filter((d) => d.pointsLost <= 0.5 && d.move !== "pass" && d.order !== 0)
          .map((d) => Move.fromGtp(d.move).sgf(bs));
        if (bestSq.length && !properties.has("SQ")) properties.set("SQ", bestSq);
        if (topX && !properties.has("MA")) properties.set("MA", [topX]);
      }
      comments.push("\n" + this.comment({ sgf: true }) + SGF_INTERNAL_COMMENTS_MARKER);
    }
    if (this.isRoot) {
      comments = opts.saveMarks ? [t("SGF start message") + SGF_INTERNAL_COMMENTS_MARKER + "\n"] : [];
      comments.push(`\nSGF generated by ${PROGRAM_NAME} ${VERSION}${SGF_INTERNAL_COMMENTS_MARKER}\n`);
      properties.set("CA", ["UTF-8"]);
      properties.set("AP", [`${PROGRAM_NAME}:${VERSION}`]);
      properties.set("KTV", [ANALYSIS_FORMAT_VERSION]);
    }
    if (this.shortcutFrom) properties.set("KTSF", [String(this.shortcutFrom.id)]);
    else properties.delete("KTSF");
    if (this.shortcutsTo.length) properties.set("KTSID", [String(this.id)]);
    else properties.delete("KTSID");
    if (note) comments.unshift(`${this.note}\n`); // user notes at top
    if (comments.length) {
      properties.set("C", [trimNewlines(comments.join(SGF_SEPARATOR_MARKER))]);
    } else {
      properties.delete("C");
    }
    return properties;
  }

  toString(): string {
    return `GameNode(${JSON.stringify(Object.fromEntries(this.properties))})`;
  }
}

function trimNewlines(s: string): string {
  return s.replace(/^\n+|\n+$/g, "");
}

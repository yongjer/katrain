// The go board, ported from katrain/gui/badukpan.py. Drawn as SVG in board units: one grid cell = 1.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { MODE_PLAY, PLAYER_AI, TOP_MOVE_DELTA_SCORE, TOP_MOVE_DELTA_WINRATE, TOP_MOVE_NOTHING, TOP_MOVE_SCORE, TOP_MOVE_VISITS, TOP_MOVE_WINRATE, type Player } from "../core/constants";
import { GameNode, type CandidateMove } from "../core/gameNode";
import { t } from "../core/i18n";
import { Move, type Coords } from "../core/move";
import { formatVisits, varToGrid } from "../core/utils";
import { playAt, useStore } from "../state/store";
import { EVAL_COLORS, THEME, evalColor, gtpColumn } from "./theme";

const STONE_R = 0.48;

interface PvOverlay {
  moves: string[];
  startPlayer: Player;
}

function formatLoss(x: number, extraPrecision: boolean): string {
  if (extraPrecision) {
    if (Math.abs(x) < 0.005) return "0.0";
    if (x > 0 && x <= 0.995) return "+" + x.toFixed(2).slice(1);
    if (x < 0 && x >= -0.995) return "-" + x.toFixed(2).slice(2);
  }
  const s = x.toFixed(1);
  return x >= 0 && !s.startsWith("-") ? `+${s}` : s;
}

export function Board() {
  const game = useStore((s) => s.game);
  const tick = useStore((s) => s.tick);
  const config = useStore((s) => s.config);
  const mode = useStore((s) => s.mode);
  const aiThinking = useStore((s) => s.aiThinking);
  const teachingStatus = useStore((s) => s.status?.level === "teaching");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Coords | null>(null);

  const toggles = config.ui[mode];
  const trainer = config.trainer;
  const theme = trainer.theme;

  const content = useMemo(() => {
    if (!game) return null;
    const [sx, sy] = game.boardSize;
    const px = (x: number) => x;
    const py = (y: number) => sy - 1 - y;
    const cn = game.currentNode;
    const nextPlayer = cn.nextPlayer;
    const stoneGrid = game.stoneGrid;
    const endResult = game.endResult;
    const layers: ReactNode[] = [];

    // ---------------------------------------------------- board
    const lines: ReactNode[] = [];
    for (let x = 0; x < sx; x++) lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={sy - 1} />);
    for (let y = 0; y < sy; y++) lines.push(<line key={`h${y}`} x1={0} y1={y} x2={sx - 1} y2={y} />);
    const starCoords = (size: number) => {
      if (size < 7) return [];
      const edge = size >= 13 ? 3 : 2;
      const pts = [edge, size - 1 - edge];
      if (size % 2 === 1 && size > 9) pts.splice(1, 0, (size - 1) / 2);
      return pts;
    };
    const stars: ReactNode[] = [];
    for (const x of starCoords(sx)) for (const y of starCoords(sy)) stars.push(<circle key={`s${x},${y}`} cx={x} cy={py(y)} r={0.1} />);
    if (sx === sy && sx % 2 === 1 && sx <= 9 && sx >= 7) stars.push(<circle key="tengen" cx={(sx - 1) / 2} cy={(sy - 1) / 2} r={0.1} />);
    const coords: ReactNode[] = [];
    for (let x = 0; x < sx; x++) {
      coords.push(<text key={`cx${x}`} x={x} y={sy - 1 + 0.82} className="coord">{gtpColumn(x)}</text>);
      coords.push(<text key={`cxt${x}`} x={x} y={-0.62} className="coord">{gtpColumn(x)}</text>);
    }
    for (let y = 0; y < sy; y++) {
      coords.push(<text key={`cy${y}`} x={-0.8} y={py(y)} className="coord">{y + 1}</text>);
      coords.push(<text key={`cyr${y}`} x={sx - 1 + 0.8} y={py(y)} className="coord">{y + 1}</text>);
    }
    layers.push(
      <g key="board">
        <rect x={-1.05} y={-1.05} width={sx + 1.1} height={sy + 1.1} rx={0.15} className="board-bg" />
        <g className="grid">{lines}</g>
        <g className="stars">{stars}</g>
        <g className="coords">{coords}</g>
      </g>,
    );

    // ---------------------------------------------------- ownership
    const ownership = cn.ownership ?? cn.parent?.ownership ?? null;
    let ownershipGrid: number[][] | null = null;
    const undone = cn.children.at(-1);
    if (toggles.ownership && ownership) {
      const cells: ReactNode[] = [];
      if (teachingStatus && undone?.autoUndo && undone.ownership && undone.move) {
        // teaching undo: show where the undone move lost territory
        const sign = undone.move.player === "B" ? -1 : 1;
        const loss = varToGrid(undone.ownership.map((o, i) => Math.max(0, sign * (o - ownership[i]))), [sx, sy]);
        const lossColor = (EVAL_COLORS[theme] ?? EVAL_COLORS["theme:normal"])[1];
        for (let y = 0; y < sy; y++) {
          for (let x = 0; x < sx; x++) {
            const alpha = Math.min(1, loss[y][x]) ** (1 / THEME.ownershipGamma) * THEME.hintsAlpha;
            if (alpha < 0.02) continue;
            cells.push(<rect key={`l${x},${y}`} x={x - 0.5} y={py(y) - 0.5} width={1} height={1} fill={lossColor} opacity={alpha} />);
          }
        }
      } else {
        ownershipGrid = varToGrid(ownership, [sx, sy]);
        for (let y = 0; y < sy; y++) {
          for (let x = 0; x < sx; x++) {
            const o = ownershipGrid[y][x];
            const alpha = Math.min(1, Math.abs(o)) ** (1 / THEME.ownershipGamma);
            if (alpha < 0.02) continue;
            cells.push(
              <rect key={`o${x},${y}`} x={x - 0.5} y={py(y) - 0.5} width={1} height={1} fill={THEME.ownership[o > 0 ? "B" : "W"]} opacity={alpha} />,
            );
          }
        }
      }
      layers.push(
        <g key="ownership" clipPath="url(#board-clip)">
          <g filter="url(#territory-blur)">{cells}</g>
        </g>,
      );
    }

    // ---------------------------------------------------- policy
    let policy = cn.policy;
    if (!policy && cn.parent?.policy && config.ui.players[cn.player].type === PLAYER_AI && config.ui.players[nextPlayer].type === PLAYER_AI) {
      policy = cn.parent.policy; // AI self-play: allow one step out of date
    }
    if (toggles.policy && policy) {
      const grid = varToGrid(policy, [sx, sy]);
      const best = Math.max(...policy);
      const colors = EVAL_COLORS[theme] ?? EVAL_COLORS["theme:normal"];
      const items: ReactNode[] = [];
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          const p = grid[y][x];
          if (p < 0) continue;
          const order = Math.max(0, 5 + Math.trunc(Math.log10(Math.max(1e-9, p - 1e-9))));
          const big = p > 1e-4;
          items.push(
            <g key={`p${x},${y}`}>
              {big && <circle cx={x} cy={py(y)} r={STONE_R * THEME.hintScale * 0.98} fill={THEME.boardApprox} />}
              <circle cx={x} cy={py(y)} r={STONE_R * THEME.hintScale * (big ? 0.95 : 0.5)} fill={colors[Math.min(order, colors.length - 1)]} opacity={THEME.policyAlpha} />
              {big && (
                <text x={x} y={py(y)} className="hint-text single">
                  {`${(100 * p).toFixed(2).slice(0, 4)}%`}
                </text>
              )}
              {p === best && <circle cx={x} cy={py(y)} r={STONE_R - 0.03} className="top-ring" opacity={THEME.policyAlpha} />}
            </g>,
          );
        }
      }
      layers.push(<g key="policy">{items}</g>);
    }

    // ---------------------------------------------------- stones
    const showDotsFor: Record<Player, boolean> = {
      B: trainer.eval_show_ai || config.ui.players.B.type !== PLAYER_AI,
      W: trainer.eval_show_ai || config.ui.players.W.type !== PLAYER_AI,
    };
    const drawn = new Set<string>();
    const stones: ReactNode[] = [];
    const nodes = cn.nodesFromRoot.reverse();
    let realized: number | null = null;
    nodes.forEach((node, i) => {
      const pl = node.pointsLost;
      let evalScale = 1;
      if (pl && realized) {
        if (pl <= 0.5 && realized <= 1.5) evalScale = 0;
        else evalScale = Math.min(1, Math.max(0, realized / pl));
      }
      const placements = node.placements;
      for (const m of [...node.moves, ...placements]) {
        if (!m.coords) continue;
        const key = `${m.coords[0]},${m.coords[1]}`;
        if (stoneGrid[m.coords[1]][m.coords[0]] !== m.player || drawn.has(key)) continue;
        drawn.add(key);
        const isPlacement = placements.includes(m);
        const evalOn = toggles.eval && showDotsFor[m.player] && i < trainer.eval_on_show_last;
        const evalCol = evalOn && pl !== null ? evalColor(pl, trainer.eval_thresholds, theme, trainer.show_dots) : null;
        const newMove = cn.move?.coords && m.sameCoords(cn.move) && !cn.ownership;
        const own = ownershipGrid && !newMove ? ownershipGrid[m.coords[1]][m.coords[0]] : null;
        stones.push(
          <Stone
            key={key}
            x={m.coords[0]}
            y={py(m.coords[1])}
            player={m.player}
            ownership={own}
            evalColor={evalCol}
            evalScale={evalScale}
            last={i === 0 && !isPlacement}
            number={config.trainer.show_move_numbers ? node.depth : null}
          />,
        );
      }
      realized = node.parentRealizedPointsLost;
    });
    // stones present on the board but not found walking the moves (should not happen) are still drawn
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const p = stoneGrid[y][x];
        if (p && !drawn.has(`${x},${y}`)) stones.push(<Stone key={`x${x},${y}`} x={x} y={py(y)} player={p} />);
      }
    }
    layers.push(<g key="stones">{stones}</g>);

    // ---------------------------------------------------- hints (top moves)
    const hintTargets: { coords: Coords; pv: string[] }[] = [];
    let topMoveCoords: Coords | null = null;
    let hintMoves: CandidateMove[] = toggles.hints && !toggles.policy && !endResult ? cn.candidateMoves : [];
    if (!hintMoves.length && teachingStatus) {
      // after a teaching undo, show the evaluation of the move that was undone
      const undoneMoves = new Set(cn.children.filter((c) => c.autoUndo && c.move).map((c) => c.move!.gtp()));
      hintMoves = cn.candidateMoves.filter((m) => undoneMoves.has(m.move));
    }
    if (hintMoves.length) {
      const childMoves = new Set(cn.children.map((c) => c.move?.gtp()).filter(Boolean));
      const show = [trainer.top_moves_show, trainer.top_moves_show_secondary].filter((o) => o && o !== TOP_MOVE_NOTHING);
      const sign = GameNode.playerSign(nextPlayer);
      const items: ReactNode[] = [];
      for (const d of hintMoves) {
        const move = Move.fromGtp(d.move);
        if (!move.coords) continue;
        const best = (d.order ?? 99) === 0;
        let scale = THEME.hintScale;
        let textOn = true;
        let alpha = THEME.hintsAlpha;
        if (d.visits < trainer.low_visits && !best && !childMoves.has(d.move)) {
          scale = THEME.uncertainHintScale;
          textOn = false;
          alpha = THEME.hintsLoAlpha;
        }
        if (d.pv) hintTargets.push({ coords: move.coords, pv: d.pv });
        const [x, y] = [px(move.coords[0]), py(move.coords[1])];
        const values: Record<string, string> = {
          [TOP_MOVE_DELTA_SCORE]: formatLoss(-d.pointsLost, trainer.extra_precision),
          [TOP_MOVE_SCORE]: (sign * d.scoreLead).toFixed(1),
          [TOP_MOVE_WINRATE]: (100 * (sign === 1 ? d.winrate : 1 - d.winrate)).toFixed(1),
          [TOP_MOVE_DELTA_WINRATE]: `${-d.winrateLost >= 0 ? "+" : ""}${(-100 * d.winrateLost).toFixed(1)}%`,
          [TOP_MOVE_VISITS]: formatVisits(d.visits),
        };
        const col = evalColor(d.pointsLost, trainer.eval_thresholds, theme)!;
        items.push(
          <g key={`h${d.move}`} className="hint">
            {textOn && show.length > 0 && <circle cx={x} cy={y} r={STONE_R * scale * 0.98} fill={THEME.boardApprox} />}
            <circle cx={x} cy={y} r={STONE_R * scale} fill={col} opacity={alpha} />
            {textOn && show.length === 1 && (
              <text x={x} y={y} className="hint-text single">
                {values[show[0]]}
              </text>
            )}
            {textOn && show.length === 2 && (
              <>
                <text x={x} y={y - 0.12} className="hint-text primary">
                  {values[show[0]]}
                </text>
                <text x={x} y={y + 0.2} className="hint-text secondary">
                  {values[show[1]]}
                </text>
              </>
            )}
            {best && <circle cx={x} cy={y} r={STONE_R - 0.03} className="top-ring" />}
          </g>,
        );
        if (best) topMoveCoords = move.coords;
      }
      layers.push(<g key="hints">{items}</g>);
    }

    // ---------------------------------------------------- next moves (children)
    if (toggles.show_children) {
      const items: ReactNode[] = [];
      for (const child of cn.children) {
        const m = child.move;
        if (!m?.coords) continue;
        if (child.analysisExists) hintTargets.push({ coords: m.coords, pv: [m.gtp(), ...(child.candidateMoves[0]?.pv ?? [])] });
        const top = topMoveCoords && m.sameCoords(new Move(topMoveCoords));
        items.push(
          <g key={`c${child.id}`}>
            {!top && <circle cx={m.coords[0]} cy={py(m.coords[1])} r={STONE_R - 0.03} className={`child-ring contrast-${child.player}`} />}
            <circle cx={m.coords[0]} cy={py(m.coords[1])} r={STONE_R - 0.03} className={`child-ring dashed-${child.player} ${top ? "short" : ""}`} />
          </g>,
        );
      }
      layers.push(<g key="children">{items}</g>);
    }

    // ---------------------------------------------------- region of interest
    if (game.regionOfInterest) {
      const [xmin, xmax, ymin, ymax] = game.regionOfInterest;
      layers.push(<rect key="roi" x={xmin - 0.5} y={py(ymax) - 0.5} width={xmax - xmin + 1} height={ymax - ymin + 1} className="roi" />);
    }

    return { layers, hintTargets, sx, sy, py, stoneGrid, endResult, nextPlayer };
  }, [game, tick, toggles, trainer, theme, config.ui.players, config.trainer.show_move_numbers, teachingStatus]);

  if (!game || !content) return <div className="board-wrap" />;
  const { layers, hintTargets, sx, sy, py, stoneGrid, endResult, nextPlayer } = content;
  const cn = game.currentNode;

  // hover: PV preview over a hint / next move, otherwise a ghost stone
  const hoverTarget = hover && hintTargets.find((h) => h.coords[0] === hover[0] && h.coords[1] === hover[1]);
  const pv: PvOverlay | null = hoverTarget ? { moves: hoverTarget.pv, startPlayer: nextPlayer } : null;
  const canPlay = !endResult && !(mode === MODE_PLAY && aiThinking);
  const ghost = !pv && hover && canPlay && !stoneGrid[hover[1]][hover[0]] ? hover : null;

  const toBoard = (e: React.MouseEvent): Coords | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    const x = Math.round(p.x);
    const y = sy - 1 - Math.round(p.y);
    if (x < 0 || x >= sx || y < 0 || y >= sy) return null;
    if (Math.abs(p.x - Math.round(p.x)) > 0.5 || Math.abs(p.y - Math.round(p.y)) > 0.5) return null;
    return [x, y];
  };

  return (
    <div className="board-wrap">
      <svg
        ref={svgRef}
        className="board"
        viewBox={`-1.1 -1.1 ${sx + 1.2} ${sy + 1.2}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={(e) => {
          const c = toBoard(e);
          if (c?.[0] !== hover?.[0] || c?.[1] !== hover?.[1]) setHover(c);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const c = toBoard(e);
          if (c && canPlay && !stoneGrid[c[1]][c[0]]) playAt(c);
        }}
      >
        <defs>
          <clipPath id="board-clip">
            <rect x={-0.5} y={-0.5} width={sx} height={sy} />
          </clipPath>
          <radialGradient id="stone-B" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#5a5a5a" />
            <stop offset="45%" stopColor="#1c1c1c" />
            <stop offset="100%" stopColor="#030303" />
          </radialGradient>
          <radialGradient id="stone-W" cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#ececec" />
            <stop offset="100%" stopColor="#bdbdbd" />
          </radialGradient>
          <radialGradient id="eval-dot" cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0.6" />
          </radialGradient>
          <filter id="territory-blur" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="0.28" />
          </filter>
          <filter id="stone-shadow" x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="0.05" dy="0.07" stdDeviation="0.05" floodOpacity="0.45" />
          </filter>
        </defs>
        {layers}
        {pv && <PvStones pv={pv} py={py} />}
        {ghost && <Stone x={ghost[0]} y={py(ghost[1])} player={nextPlayer} opacity={THEME.ghostAlpha} />}
        {(cn.isPass || endResult) && (
          <g className="pass-circle">
            <circle cx={(sx - 1) / 2} cy={(sy - 1) / 2} r={Math.min(sx, sy) * 0.12} />
            <text x={(sx - 1) / 2} y={(sy - 1) / 2}>
              {(endResult ?? t("board-pass")).replace(/\n/g, " ")}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function Stone(props: {
  x: number;
  y: number;
  player: Player;
  opacity?: number;
  ownership?: number | null;
  evalColor?: string | null;
  evalScale?: number;
  last?: boolean;
  number?: number | null;
}) {
  const { x, y, player, ownership = null, evalColor: ec = null, evalScale = 1, last = false, number = null } = props;
  let opacity = props.opacity ?? 1;
  let mark: ReactNode = null;
  if (ownership !== null && ownership !== undefined) {
    const owner: Player = ownership > 0 ? "B" : "W";
    opacity = player === owner ? THEME.stoneMinAlpha + (1 - THEME.stoneMinAlpha) * Math.abs(ownership) : THEME.stoneMinAlpha;
    if (player !== owner) {
      const size = THEME.markSize * Math.abs(ownership) * STONE_R * 2;
      mark = <rect x={x - size / 2} y={y - size / 2} width={size} height={size} className={`mark mark-${owner}`} />;
    }
  }
  const evalR = STONE_R * (THEME.evalDotMin + Math.sqrt(evalScale) * (THEME.evalDotMax - THEME.evalDotMin));
  return (
    <g opacity={opacity}>
      <circle cx={x} cy={y} r={STONE_R} fill={`url(#stone-${player})`} className={`stone stone-${player}`} />
      {mark}
      {ec && <circle cx={x} cy={y} r={evalR} fill={ec} className="eval-dot" />}
      {last && <circle cx={x} cy={y} r={STONE_R * 0.4} className={`last-move last-${player}`} />}
      {number !== null && number > 0 && (
        <text x={x} y={y} className={`stone-number on-${player}`}>
          {number}
        </text>
      )}
    </g>
  );
}

function PvStones({ pv, py }: { pv: PvOverlay; py: (y: number) => number }) {
  const players: Player[] = [pv.startPlayer, Move.opponentPlayer(pv.startPlayer)];
  const seen = new Set<string>();
  const items: ReactNode[] = [];
  pv.moves.forEach((gtp, i) => {
    const m = Move.fromGtp(gtp, players[i % 2]);
    if (!m.coords) return;
    const key = `${m.coords[0]},${m.coords[1]}`;
    if (seen.has(key)) return; // later recaptures at the same point are not drawn, like KaTrain
    seen.add(key);
    const [x, y] = [m.coords[0], py(m.coords[1])];
    items.push(
      <g key={`pv${i}`}>
        <circle cx={x} cy={y} r={STONE_R} fill={`url(#stone-${m.player})`} className={`stone stone-${m.player}`} />
        <text x={x} y={y} className={`stone-number pv on-${m.player}`}>
          {i + 1}
        </text>
      </g>,
    );
  });
  return <g className="pv">{items}</g>;
}

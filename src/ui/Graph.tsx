// Score / win rate graph over the line through the current move (katrain/gui/widgets/graph.py).

import { useMemo, useRef } from "react";
import { t } from "../core/i18n";
import { goTo, updateConfig, useStore } from "../state/store";
import { THEME } from "./theme";

const W = 1000;
const H = 300;

export function Graph() {
  const game = useStore((s) => s.game);
  const tick = useStore((s) => s.tick);
  const show = useStore((s) => s.config.ui.graph);
  const ref = useRef<SVGSVGElement>(null);

  const data = useMemo(() => {
    if (!game) return null;
    const nodes = game.mainLineThroughCurrent;
    const scores = nodes.map((n) => n.score);
    const winrates = nodes.map((n) => n.winrate);
    const maxAbs = Math.max(5, ...scores.filter((s): s is number => s !== null).map(Math.abs));
    const scoreRange = Math.ceil(maxAbs / 5) * 5;
    const n = Math.max(nodes.length - 1, 1);
    const x = (i: number) => (i / n) * W;
    const path = (values: (number | null)[], y: (v: number) => number) => {
      let d = "";
      let pen = false;
      values.forEach((v, i) => {
        if (v === null || v === undefined) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    const scorePath = path(scores, (v) => H / 2 - (v / scoreRange) * (H / 2));
    const winratePath = path(winrates, (v) => H - v * H);
    const current = nodes.indexOf(game.currentNode);
    return { nodes, scorePath, winratePath, scoreRange, current, x, n };
  }, [game, tick]);

  if (!game || !data) return null;
  const { nodes, scorePath, winratePath, scoreRange, current, x } = data;
  const cn = game.currentNode;

  const onClick = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const ix = Math.round(frac * (nodes.length - 1));
    const node = nodes[Math.max(0, Math.min(nodes.length - 1, ix))];
    if (node) goTo(node);
  };

  return (
    <div className="graph panel">
      <div className="graph-header">
        <label className="legend score">
          <input
            type="checkbox"
            checked={show.score}
            onChange={() => updateConfig((c) => void (c.ui.graph.score = !c.ui.graph.score))}
          />
          {t("tab:score")}
          {show.score && cn.score !== null && <b>{cn.formatScore()}</b>}
        </label>
        <label className="legend winrate">
          <input
            type="checkbox"
            checked={show.winrate}
            onChange={() => updateConfig((c) => void (c.ui.graph.winrate = !c.ui.graph.winrate))}
          />
          {t("tab:winrate")}
          {show.winrate && cn.winrate !== null && <b>{cn.formatWinrate()}</b>}
        </label>
        <span className="graph-range">±{scoreRange}</span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onClick={onClick} className="graph-svg">
        <rect x={0} y={0} width={W} height={H / 2} className="graph-bg-b" />
        <rect x={0} y={H / 2} width={W} height={H / 2} className="graph-bg-w" />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="graph-mid" />
        {show.winrate && <path d={winratePath} stroke={THEME.winrate} className="graph-line" />}
        {show.score && <path d={scorePath} stroke={THEME.score} className="graph-line" />}
        {current >= 0 && <line x1={x(current)} y1={0} x2={x(current)} y2={H} className="graph-cursor" />}
      </svg>
      <div className="graph-footer">
        <span>{t("move").replace("{number}", String(cn.depth))}</span>
        <span>{nodes.length - 1}</span>
      </div>
    </div>
  );
}

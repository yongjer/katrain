// The move tree, ported from katrain/gui/widgets/movetree.py: one column per move, one row per branch.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GameNode } from "../core/gameNode";
import { t } from "../core/i18n";
import { editTree, goTo, useStore, type TreeEdit } from "../state/store";

const SIZE = 22; // node diameter in px
const GAP = 5;
const STEP = SIZE + GAP;

interface Layout {
  pos: Map<GameNode, [number, number]>;
  children: Map<GameNode, GameNode[]>;
  width: number;
  height: number;
}

/** Children as drawn: a collapsed branch shows its end node in place of the first node on the way. */
function childrenWithShortcuts(node: GameNode): GameNode[] {
  const via = new Map(node.shortcutsTo.map(([to, v]) => [v, to]));
  return node.orderedChildren.map((c) => via.get(c) ?? c);
}

export function layoutTree(root: GameNode): Layout {
  const pos = new Map<GameNode, [number, number]>([[root, [0, 0]]]);
  const children = new Map<GameNode, GameNode[]>();
  const nextY = new Map<number, number>();
  const rootChildren = childrenWithShortcuts(root);
  children.set(root, rootChildren);
  const stack = [...rootChildren].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    const parent = node.shortcutFrom && pos.has(node.shortcutFrom) ? node.shortcutFrom : node.parent!;
    const [px, py] = pos.get(parent)!;
    const x = px + 1;
    const y = Math.max(nextY.get(x) ?? 0, py);
    nextY.set(x, y + 1);
    nextY.set(x - 1, Math.max(y + 1, nextY.get(x - 1) ?? 0));
    pos.set(node, [x, y]);
    const kids = childrenWithShortcuts(node);
    children.set(node, kids);
    stack.push(...[...kids].reverse()); // first child is processed first
  }
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of pos.values()) {
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { pos, children, width: (maxX + 1) * STEP + GAP, height: (maxY + 1) * STEP + GAP };
}

const cx = (x: number) => GAP + x * STEP + SIZE / 2;

export function MoveTree() {
  const game = useStore((s) => s.game);
  const tick = useStore((s) => s.tick);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ node: GameNode; x: number; y: number } | null>(null);

  const layout = useMemo(() => (game ? layoutTree(game.root) : null), [game, tick]);
  const current = game?.currentNode ?? null;

  // keep the current move in view
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = current && layout?.pos.get(current);
    if (!el || !p) return;
    const [x, y] = [cx(p[0]), cx(p[1])];
    if (x < el.scrollLeft + STEP || x > el.scrollLeft + el.clientWidth - STEP) el.scrollLeft = x - el.clientWidth / 2;
    if (y < el.scrollTop + SIZE / 2 || y > el.scrollTop + el.clientHeight - SIZE / 2) el.scrollTop = y - el.clientHeight / 2;
  }, [current, layout]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  if (!game || !layout) return null;
  const { pos, children, width, height } = layout;
  // insert mode: green = where the moves are inserted, orange = the inserted moves (current one darker)
  const insertClass = new Map<GameNode, string>();
  if (game.insertAfter) {
    insertClass.set(game.insertAfter.parent!, "insert-parent");
    for (let n: GameNode | null = current; n && n !== game.insertAfter.parent; n = n.parent) {
      insertClass.set(n, n === current ? "insert-current" : "insert-other");
    }
  }

  const lines: string[] = [];
  for (const [node, [x, y]] of pos) {
    for (const c of children.get(node) ?? []) {
      const p = pos.get(c);
      if (p) lines.push(`M${cx(x)},${cx(y)}V${cx(p[1])}H${cx(p[0])}`);
    }
  }

  const act = (edit: TreeEdit) => {
    if (menu) editTree(edit, menu.node);
    setMenu(null);
  };

  return (
    <div className="move-tree panel">
      <div className="move-tree-scroll" ref={scrollRef} role="tree" aria-label="Move tree">
        <svg width={width} height={height} className="move-tree-svg">
          <path d={lines.join("")} className="tree-line" />
          {[...pos].map(([node, [x, y]]) => {
            const placements = node.placements.length + node.clearPlacements.length > 0;
            const label = placements ? "+" : String(node.depth);
            const special = insertClass.get(node) ?? (node === current ? "current" : node === menu?.node ? "selected" : "");
            return (
              <g
                key={node.id}
                className={`tree-node ${special}`}
                onClick={() => goTo(node)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!node.isRoot) setMenu({ node, x: e.clientX, y: e.clientY });
                }}
              >
                {special && <rect x={cx(x) - STEP / 2} y={cx(y) - STEP / 2} width={STEP} height={STEP} rx={4} className="tree-highlight" />}
                <circle
                  cx={cx(x)}
                  cy={cx(y)}
                  r={SIZE / 2 - 1}
                  className={`tree-stone ${node.shortcutFrom || placements ? "collapsed" : `stone-${node.player}`} ${node.autoUndo ? "undone" : ""}`}
                />
                <text x={cx(x)} y={cx(y)} className={`tree-label on-${node.shortcutFrom ? "collapsed" : node.player}`} fontSize={label.length > 2 ? 8 : 10}>
                  {label}
                </text>
                <title>{node.move ? `${node.depth}: ${node.move.player} ${node.move.gtp()}` : label}</title>
              </g>
            );
          })}
        </svg>
      </div>
      {menu && (
        <div className="tree-menu dropdown" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button className="menu-item" onClick={() => act("delete")}>
            <span>{t("Delete Node")}</span>
            <kbd>Ctrl+Del</kbd>
          </button>
          <button className="menu-item" onClick={() => act("main")}>
            <span>{t("Make Main Branch")}</span>
            <kbd>PgUp</kbd>
          </button>
          <button className="menu-item" onClick={() => act("collapse")}>
            <span>{t("Toggle Collapse Branch")}</span>
            <kbd>C</kbd>
          </button>
          <button className="menu-item" onClick={() => act("prune")}>
            <span>{t("Prune Branch")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

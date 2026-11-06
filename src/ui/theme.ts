// Visual constants, ported from katrain/gui/theme.py.

import { evaluationClass } from "../core/utils";

export const IS_MAC = navigator.platform.startsWith("Mac");
/** How the menus show the shortcut modifier. The key handler takes Ctrl or Cmd everywhere. */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl+";

export const EVAL_COLORS: Record<string, string[]> = {
  "theme:normal": ["#72216b", "#cc0000", "#e6661a", "#f2f200", "#abe62e", "#1e9600"],
  "theme:red-green-colourblind": ["#ff00ff", "#ff0000", "#ff8000", "#ffff00", "#00ffff", "#0000ff"],
};

export const THEME = {
  board: "#d9ad66",
  boardApprox: "#f2bf78",
  line: "#000000",
  topMoveBorder: "#0ac8fa",
  hintText: "#0d0d0d",
  number: "rgba(217,173,102,0.85)",
  passCircle: "rgba(115,13,115,0.7)",
  ownership: { B: "rgba(0,0,26,0.75)", W: "rgba(235,235,255,0.8)" },
  ownershipGamma: 1.33,
  stoneMinAlpha: 0.85,
  markSize: 0.42,
  hintsAlpha: 0.8,
  hintsLoAlpha: 0.6,
  hintScale: 0.98,
  uncertainHintScale: 0.7,
  ghostAlpha: 0.6,
  policyAlpha: 0.5,
  evalDotMin: 0.25,
  evalDotMax: 0.5,
  score: "#4db3e6",
  winrate: "#1acc1a",
  pointLoss: "#cccc1a",
  engine: { dead: "#cc0000", busy: "#e6661a", ready: "#1e9600", pondering: "#cccc1a" },
};

export function evalColor(pointsLost: number, thresholds: number[], theme: string, showClass?: boolean[]): string | null {
  const i = evaluationClass(pointsLost, thresholds);
  if (showClass && !showClass[i]) return null;
  return (EVAL_COLORS[theme] ?? EVAL_COLORS["theme:normal"])[i];
}

export function gtpColumn(x: number): string {
  return "ABCDEFGHJKLMNOPQRSTUVWXYZ"[x] ?? String(x + 1);
}

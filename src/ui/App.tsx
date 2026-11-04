import { useEffect } from "react";
import { MODE_ANALYZE, MODE_PLAY } from "../core/constants";
import type { AnalysisToggles } from "../state/config";
import {
  aiMoveNow,
  analyzeExtra,
  editTree,
  findMistake,
  init,
  loadGame,
  openDialog,
  playAt,
  redo,
  resetAnalysis,
  saveGame,
  setMode,
  switchBranch,
  toggleControl,
  togglePondering,
  undo,
  updateConfig,
  useStore,
} from "../state/store";
import { ControlsBar, TopBar } from "./Bars";
import { Board } from "./Board";
import { Dialogs } from "./Dialogs";
import { Graph } from "./Graph";
import { MoveTree } from "./MoveTree";
import { InfoPanel, PlayersPanel, StatsPanel } from "./Panels";

const TOGGLE_KEYS: Record<string, keyof AnalysisToggles> = {
  q: "show_children",
  w: "eval",
  e: "hints",
  r: "policy",
  t: "ownership",
};

function onKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable]")) return;
  const s = useStore.getState();
  if (s.dialog) {
    if (e.key === "Escape") openDialog(null);
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const handled = () => e.preventDefault();

  if (ctrl) {
    if (key === "Delete" || key === "Backspace") editTree("delete");
    else if (key === "n") openDialog("newgame");
    else if (key === "l") void loadGame();
    else if (key === "s") void saveGame(false);
    else if (key === "d") void saveGame(true);
    else return;
    return handled();
  }
  switch (key) {
    case "ArrowLeft":
    case "z":
      undo(e.shiftKey ? 10 : 1);
      break;
    case "ArrowRight":
    case "x":
      redo(e.shiftKey ? 10 : 1);
      break;
    case "ArrowUp":
      switchBranch(-1);
      break;
    case "ArrowDown":
      switchBranch(1);
      break;
    case "Home":
      undo(9999);
      break;
    case "End":
      redo(9999);
      break;
    case "b":
      undo(e.shiftKey ? "main-branch" : "branch");
      break;
    case "n":
      findMistake(e.shiftKey ? "undo" : "redo");
      break;
    case "p":
      playAt(null);
      break;
    case "Enter":
      aiMoveNow();
      break;
    case " ":
      togglePondering();
      break;
    case "Escape":
      analyzeExtra("stop");
      break;
    case "a":
      analyzeExtra("extra");
      break;
    case "s":
      analyzeExtra("equalize");
      break;
    case "d":
      analyzeExtra("sweep");
      break;
    case "f":
      analyzeExtra("alternative");
      break;
    case "h":
      resetAnalysis();
      break;
    case "m":
      updateConfig((c) => void (c.trainer.show_move_numbers = !c.trainer.show_move_numbers));
      break;
    case "PageUp":
      editTree("main");
      break;
    case "c":
      editTree("collapse");
      break;
    case "Tab":
      setMode(s.mode === MODE_PLAY ? MODE_ANALYZE : MODE_PLAY);
      break;
    case "F7":
      openDialog("ai");
      break;
    case "F8":
      openDialog("settings");
      break;
    default:
      if (key in TOGGLE_KEYS) toggleControl(TOGGLE_KEYS[key]);
      else return;
  }
  handled();
}

function onWheel(e: WheelEvent) {
  if ((e.target as HTMLElement).closest(".board-wrap")) {
    if (e.deltaY > 0) redo(1);
    else if (e.deltaY < 0) undo(1);
  }
}

export function App() {
  const ready = useStore((s) => s.ready);
  const lang = useStore((s) => s.lang);
  useEffect(() => {
    void init();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);
  if (!ready) return <div className="loading">KaTrain</div>;
  return (
    <div className="app" key={lang}>
      <TopBar />
      <main className="main">
        <section className="board-area">
          <Board />
        </section>
        <aside className="sidebar">
          <PlayersPanel />
          <MoveTree />
          <Graph />
          <StatsPanel />
          <InfoPanel />
        </aside>
      </main>
      <ControlsBar />
      <Dialogs />
    </div>
  );
}

import { useEffect } from "react";
import { MODE_ANALYZE, MODE_PLAY } from "../core/constants";
import type { AnalysisToggles } from "../state/config";
import {
  aiMoveNow,
  analyzeExtra,
  copySgf,
  editTree,
  pasteSgf,
  selfplayToEnd,
  toggleInsertMode,
  toggleTimerPaused,
  findMistake,
  init,
  loadGame,
  openDialog,
  playAt,
  redo,
  resetAnalysis,
  saveGame,
  loadGameFromString,
  setMode,
  startRegionSelect,
  switchBranch,
  toggleCoordinates,
  toggleControl,
  togglePondering,
  undo,
  updateConfig,
  useStore,
} from "../state/store";
import { platform } from "../state/platform";
import { ControlsBar, TopBar } from "./Bars";
import { Board } from "./Board";
import { Dialogs } from "./Dialogs";
import { Graph } from "./Graph";
import { MoveTree } from "./MoveTree";
import { TimerPanel } from "./Timer";
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
  // Letter shortcuts go by the physical key, like Kivy's keycodes: with a Chinese/Japanese input method active (or a
  // non-Latin layout) e.key is "Process" or another character, but e.code is still "KeyI".
  const letter = /^Key([A-Z])$/.exec(e.code);
  const key = letter && !e.altKey ? letter[1].toLowerCase() : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const handled = () => e.preventDefault();

  if (ctrl) {
    if (key === "c") void copySgf();
    else if (key === "v") void pasteSgf();
    else if (key === "Delete" || key === "Backspace") editTree("delete");
    else if (key === "n") openDialog("newgame");
    else if (key === "l") void loadGame();
    else if (key === "s") void saveGame(false);
    else if (key === "d") void saveGame(true);
    else if (key === "ArrowLeft") undo(9999);
    else if (key === "ArrowRight") redo(9999);
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
    case "i":
      toggleInsertMode();
      break;
    case "l":
      selfplayToEnd();
      break;
    case "Pause":
      toggleTimerPaused();
      break;
    case "g":
      startRegionSelect();
      break;
    case "k":
      toggleCoordinates();
      break;
    case "F2":
      openDialog("reanalyze");
      break;
    case "F3":
      openDialog("report");
      break;
    case "F5":
      openDialog("timer");
      break;
    case "F10":
      openDialog("tsumego");
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
  const mode = useStore((s) => s.mode);
  useEffect(() => {
    void init();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    // drop an .sgf / .gib / .ngf anywhere on the window to load it
    const stopDrop = platform.onFileDrop((f) => {
      if (/\.(sgf|gib|ngf)$/i.test(f.name)) loadGameFromString(f.contents, f.name, f.path);
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
      void stopDrop.then((stop) => stop());
    };
  }, []);
  if (!ready) return <div className="loading">Katraineo</div>;
  return (
    <div className="app" key={lang}>
      <TopBar />
      <main className="main">
        <section className="board-area">
          <Board />
        </section>
        <aside className="sidebar">
          <PlayersPanel />
          {mode === MODE_PLAY ? <TimerPanel /> : <MoveTree />}
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

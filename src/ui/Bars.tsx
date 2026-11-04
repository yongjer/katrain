// Top bar (menu, mode tabs, analysis toggles) and bottom bar (navigation, status, engine indicator).

import { useEffect, useRef, useState } from "react";
import { MODE_ANALYZE, MODE_PLAY } from "../core/constants";
import { t } from "../core/i18n";
import type { AnalysisToggles } from "../state/config";
import {
  aiMoveNow,
  analyzeExtra,
  copySgf,
  pasteSgf,
  selfplayToEnd,
  toggleInsertMode,
  findMistake,
  getEngine,
  loadGame,
  openDialog,
  playAt,
  redo,
  resetAnalysis,
  resign,
  saveGame,
  setMode,
  toggleControl,
  togglePondering,
  undo,
  useStore,
} from "../state/store";
import { THEME } from "./theme";

const TOGGLES: [keyof AnalysisToggles, string, string][] = [
  ["show_children", "analysis:nextmoves", "Q"],
  ["eval", "analysis:dots", "W"],
  ["hints", "analysis:topmoves", "E"],
  ["policy", "analysis:policy", "R"],
  ["ownership", "analysis:territory", "T"],
];

function oneLine(s: string) {
  return s.replace(/\s*\n\s*/g, " ");
}

export function TopBar() {
  const mode = useStore((s) => s.mode);
  const toggles = useStore((s) => s.config.ui[s.mode]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  return (
    <header className="topbar">
      <div className="menu-anchor">
        <button className="icon-button" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          ☰
        </button>
        {menuOpen && (
          <Dropdown onClose={() => setMenuOpen(false)}>
            <MenuItem label={t("menu:newgame")} shortcut="Ctrl+N" onClick={() => openDialog("newgame")} />
            <MenuItem label={t("menu:load")} shortcut="Ctrl+L" onClick={() => void loadGame()} />
            <MenuItem label={t("menu:save")} shortcut="Ctrl+S" onClick={() => void saveGame(false)} />
            <MenuItem label={t("menu:save-as")} shortcut="Ctrl+D" onClick={() => void saveGame(true)} />
            <hr />
            <MenuItem label={t("menu:settings")} shortcut="F8" onClick={() => openDialog("settings")} />
            <MenuItem label={t("menu:aisettings")} shortcut="F7" onClick={() => openDialog("ai")} />
            <MenuItem label={t("menu:clocksettings")} shortcut="F5" onClick={() => openDialog("timer")} />
            <hr />
            <MenuItem label="Copy SGF" shortcut="Ctrl+C" onClick={() => void copySgf()} />
            <MenuItem label="Paste SGF / link" shortcut="Ctrl+V" onClick={() => void pasteSgf()} />
            <MenuItem label="KataGo log" onClick={() => openDialog("log")} />
          </Dropdown>
        )}
      </div>
      <div className="mode-tabs" role="tablist">
        <button role="tab" aria-selected={mode === MODE_PLAY} className={mode === MODE_PLAY ? "active" : ""} onClick={() => setMode(MODE_PLAY)}>
          {t("btn:Play")}
        </button>
        <button role="tab" aria-selected={mode === MODE_ANALYZE} className={mode === MODE_ANALYZE ? "active" : ""} onClick={() => setMode(MODE_ANALYZE)}>
          {t("btn:Analysis")}
        </button>
      </div>
      <div className="toggles">
        {TOGGLES.map(([key, label, shortcut]) => (
          <button key={key} className={`toggle ${toggles[key] ? "on" : ""}`} onClick={() => toggleControl(key)} title={`${oneLine(t(label))} (${shortcut})`}>
            <span className="check">{toggles[key] ? "●" : "○"}</span>
            {oneLine(t(label))}
            <kbd>{shortcut}</kbd>
          </button>
        ))}
      </div>
      <div className="menu-anchor right">
        <button className="text-button" onClick={() => setExtraOpen((o) => !o)}>
          {t("btn:Analyze")} ▾
        </button>
        {extraOpen && (
          <Dropdown onClose={() => setExtraOpen(false)} align="right">
            <MenuItem label={t("analysis:extra")} shortcut="A" onClick={() => analyzeExtra("extra")} />
            <MenuItem label={t("analysis:equalize")} shortcut="S" onClick={() => analyzeExtra("equalize")} />
            <MenuItem label={t("analysis:sweep")} shortcut="D" onClick={() => analyzeExtra("sweep")} />
            <MenuItem label={t("analysis:alternatives")} shortcut="F" onClick={() => analyzeExtra("alternative")} />
            <MenuItem label={t("analysis:reset")} shortcut="H" onClick={resetAnalysis} />
            <hr />
            <MenuItem label={t("analysis:continuous")} shortcut="Space" onClick={togglePondering} />
            <MenuItem label={t("analysis:game")} onClick={() => analyzeExtra("game")} />
            <MenuItem label={t("analysis:report")} shortcut="F3" onClick={() => openDialog("report")} />
            <MenuItem label={t("analysis:aimove")} shortcut="Enter" onClick={aiMoveNow} />
            <MenuItem label={t("analysis:playtoend")} shortcut="L" onClick={selfplayToEnd} />
            <MenuItem label={t("analysis:insert")} shortcut="I" onClick={toggleInsertMode} />
            <MenuItem label={t("analysis:tsumegoframe")} shortcut="F10" onClick={() => openDialog("tsumego")} />
          </Dropdown>
        )}
      </div>
    </header>
  );
}

function Dropdown({ children, onClose, align = "left" }: { children: React.ReactNode; onClose: () => void; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);
  return (
    <div ref={ref} className={`dropdown ${align}`} onClick={onClose}>
      {children}
    </div>
  );
}

function MenuItem({ label, shortcut, onClick }: { label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button className="menu-item" onClick={onClick}>
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

export function ControlsBar() {
  const status = useStore((s) => s.status);
  const pondering = useStore((s) => s.pondering);
  useStore((s) => s.tick);
  const engine = getEngine();
  const remaining = engine?.queriesRemaining() ?? 0;
  let engineColor: string = THEME.engine.ready;
  let engineTitle = "KataGo ready";
  if (!engine || engine.state === "dead" || engine.state === "stopped") {
    engineColor = THEME.engine.dead;
    engineTitle = engine?.lastError ?? "KataGo not running";
  } else if (pondering) {
    engineColor = THEME.engine.pondering;
    engineTitle = "Continuous analysis";
  } else if (engine.state === "starting" || remaining > 0) {
    engineColor = THEME.engine.busy;
    engineTitle = engine.state === "starting" ? "Starting KataGo…" : `${remaining} queries`;
  }
  return (
    <footer className="controls">
      <div className="nav">
        <NavButton label="⇤✗" title="Previous mistake (N)" onClick={() => findMistake("undo")} mistake />
        <NavButton label="⏮" title="Start (Home)" onClick={() => undo(9999)} />
        <NavButton label="⏪" title="-10 (Shift+Left)" onClick={() => undo(10)} />
        <NavButton label="◀" title="Previous (Left / Z)" onClick={() => undo(1)} />
        <NavButton label="▶" title="Next (Right / X)" onClick={() => redo(1)} />
        <NavButton label="⏩" title="+10 (Shift+Right)" onClick={() => redo(10)} />
        <NavButton label="⏭" title="End (End)" onClick={() => redo(9999)} />
        <NavButton label="✗⇥" title="Next mistake (Shift+N)" onClick={() => findMistake("redo")} mistake />
      </div>
      <div className="actions">
        <button className="text-button" onClick={() => playAt(null)} title="P">
          {t("pass-button-text")}
        </button>
        <button className="text-button" onClick={() => undo("smart")}>
          {t("undo-button-text")}
        </button>
        <button className="text-button" onClick={resign}>
          {t("resign")}
        </button>
      </div>
      <div className={`status ${status?.level ?? ""}`} title={status?.message}>
        {status?.message.replace(/\n/g, " ")}
      </div>
      <button className="engine-dot" style={{ background: engineColor }} title={engineTitle} aria-label={engineTitle} onClick={togglePondering} />
    </footer>
  );
}

function NavButton({ label, title, onClick, mistake = false }: { label: string; title: string; onClick: () => void; mistake?: boolean }) {
  return (
    <button className={`nav-button ${mistake ? "mistake" : ""}`} title={title} aria-label={title} onClick={onClick}>
      {label}
    </button>
  );
}

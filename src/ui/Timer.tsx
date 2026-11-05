// The game clock shown in Play mode (katrain/gui.kv <Timer>): mm:ss, byo-yomi periods left, pause button.

import { useEffect } from "react";
import { t } from "../core/i18n";
import { openDialog, tickTimer, toggleTimerPaused, useStore } from "../state/store";

export function TimerPanel() {
  const timer = useStore((s) => s.timer);
  const settings = useStore((s) => s.config.timer);
  useEffect(() => {
    const id = setInterval(tickTimer, 70);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor(timer.remaining + 0.99);
  const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const timeout = timer.periods !== null && timer.periods <= 0;
  const inByoYomi = timer.periods !== null;
  return (
    <div className={`timer panel ${timeout ? "timeout" : ""} ${timer.ai ? "ai" : ""}`}>
      <span className="timer-digits" aria-label="Time remaining">
        {text}
      </span>
      {inByoYomi && <span className="timer-periods">×{timer.periods}</span>}
      <span className="timer-desc">
        {settings.main_time > 0 ? `${settings.main_time}′ + ` : ""}
        {settings.byo_periods}×{settings.byo_length}″
      </span>
      <button
        className={`timer-pause ${timer.paused ? "paused" : ""}`}
        onClick={toggleTimerPaused}
        title={timer.paused ? "Start clock (Pause)" : "Pause clock (Pause)"}
        aria-pressed={timer.paused}
      >
        {timer.paused ? "▶" : "❚❚"}
      </button>
      <button className="link-button" onClick={() => openDialog("timer")}>
        {t("menu:clocksettings")}
      </button>
    </div>
  );
}

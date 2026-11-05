// Right-hand panels: player setup, move statistics, info & notes.

import { useEffect, useState } from "react";
import { aiRankEstimation, rankLabel } from "../core/ai";
import { AI_STRATEGIES_AVAILABLE, PLAYER_AI, PLAYER_HUMAN, PLAYING_NORMAL, PLAYING_TEACHING, type Player, type PlayerType } from "../core/constants";
import { t } from "../core/i18n";
import { openDialog, setNote, setPlayer, useStore } from "../state/store";
import { THEME, evalColor } from "./theme";

export function PlayersPanel() {
  const players = useStore((s) => s.config.ui.players);
  const ai = useStore((s) => s.config.ai);
  const game = useStore((s) => s.game);
  useStore((s) => s.tick);
  const aiThinking = useStore((s) => s.aiThinking);
  if (!game) return null;
  const next = game.currentNode.nextPlayer;
  const captures = game.prisonerCount;
  return (
    <div className="players">
      {(["B", "W"] as Player[]).map((p) => {
        const setup = players[p];
        const isAi = setup.type === PLAYER_AI;
        const name = game.root.getProperty(`P${p}`);
        const rank = isAi ? rankLabel(aiRankEstimation(setup.strategy, ai[setup.strategy] ?? {})) : game.root.getProperty(`${p}R`);
        return (
          <div key={p} className={`player-card ${next === p ? "to-move" : ""}`}>
            <div className={`player-stone stone-${p}`} />
            <div className="player-body">
              <div className="player-row">
                <select
                  value={setup.type}
                  onChange={(e) => setPlayer(p, { type: e.target.value as PlayerType })}
                  aria-label={t("player:type")}
                >
                  <option value={PLAYER_HUMAN}>{t(PLAYER_HUMAN)}</option>
                  <option value={PLAYER_AI}>{t(PLAYER_AI)}</option>
                </select>
                {!isAi && (
                  <select value={setup.subtype} onChange={(e) => setPlayer(p, { subtype: e.target.value })} aria-label={t("gametype")}>
                    <option value={PLAYING_NORMAL}>{t(PLAYING_NORMAL)}</option>
                    <option value={PLAYING_TEACHING}>{t(PLAYING_TEACHING)}</option>
                  </select>
                )}
                {isAi && (
                  <select value={setup.strategy} onChange={(e) => setPlayer(p, { strategy: e.target.value })} aria-label={t("aistrategy")}>
                    {AI_STRATEGIES_AVAILABLE.map((s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="player-meta">
                <span className="player-name">{name && !name.includes("ㅤ") ? name : isAi ? t(setup.strategy) : t(PLAYER_HUMAN)}</span>
                {rank && <span className="player-rank">{rank}</span>}
                <span className="captures" title="captures">
                  ⊙ {p === "B" ? captures.W : captures.B}
                </span>
                {isAi && aiThinking && next === p && <span className="thinking">…</span>}
              </div>
            </div>
          </div>
        );
      })}
      <button className="link-button" onClick={() => openDialog("ai")}>
        {t("menu:aisettings")}
      </button>
    </div>
  );
}

export function StatsPanel() {
  const game = useStore((s) => s.game);
  useStore((s) => s.tick);
  const trainer = useStore((s) => s.config.trainer);
  if (!game) return null;
  const cn = game.currentNode;
  const pl = cn.pointsLost;
  const col = pl !== null ? evalColor(pl, trainer.eval_thresholds, trainer.theme) : null;
  const visits = cn.rootVisits;
  return (
    <div className="stats panel">
      <div className="stat">
        <span className="stat-label">{t("stats:winrate")}</span>
        <span className="stat-value" style={{ color: THEME.winrate }}>
          {cn.formatWinrate() ?? "…"}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{t("stats:score")}</span>
        <span className="stat-value" style={{ color: THEME.score }}>
          {cn.formatScore() ?? "…"}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">{pl !== null && pl < 0 ? t("stats:pointsgained") : t("stats:pointslost")}</span>
        <span className="stat-value" style={{ color: col ?? THEME.pointLoss }}>
          {pl !== null ? `${cn.move?.player ?? ""} ${Math.abs(pl).toFixed(1)}` : "…"}
        </span>
      </div>
      <div className="stat visits">
        <span className="stat-label">{t("top_move_visits")}</span>
        <span className="stat-value">{visits || "…"}</span>
      </div>
    </div>
  );
}

export function InfoPanel() {
  const game = useStore((s) => s.game);
  useStore((s) => s.tick);
  const [tab, setTab] = useState<"info" | "details" | "notes">("info");
  const node = game?.currentNode;
  const [note, setNoteText] = useState(node?.note ?? "");
  useEffect(() => setNoteText(node?.note ?? ""), [node]);
  if (!game || !node) return null;
  const text = node.comment({ details: tab === "details" });
  return (
    <div className="info panel">
      <div className="tabs">
        {(["info", "details", "notes"] as const).map((k) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {t(k === "info" ? "tab:info" : k === "details" ? "tab:info-details" : "tab:notes")}
          </button>
        ))}
      </div>
      {tab === "notes" ? (
        <textarea
          className="notes"
          placeholder={t("SGF Notes Hint")}
          value={note}
          onChange={(e) => {
            setNoteText(e.target.value);
            setNote(e.target.value);
          }}
        />
      ) : (
        <pre className="info-text">
          {text}
          {node.note ? `\n${node.note}` : ""}
        </pre>
      )}
    </div>
  );
}

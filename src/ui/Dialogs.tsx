// Modal dialogs: new game, general & engine settings, AI settings, engine log.

import { useState, type ReactNode } from "react";
import { aiRankEstimation, rankLabel } from "../core/ai";
import { AI_STRATEGIES_AVAILABLE, AI_STRATEGIES_HUMAN_MODEL, PLAYER_AI, TOP_MOVE_OPTIONS, type Player } from "../core/constants";
import { t } from "../core/i18n";
import { ENGINE_BACKENDS, resolveEngineBackend } from "../core/engine";
import { gameReport, REPORT_FILTERS } from "../core/report";
import type { AppConfig } from "../state/config";
import { platform } from "../state/platform";
import { newGame, openDialog, setupPosition, tsumegoFrame, updateConfig, updateTimerSettings, useStore } from "../state/store";
import { LANGUAGES } from "./i18nLoader";
import { ModelPicker } from "./ModelPicker";
import { EVAL_COLORS } from "./theme";

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

const RULES = ["japanese", "chinese", "korean", "aga", "tromp-taylor", "new zealand", "stone_scoring"];

export function NewGameDialog() {
  const cfg = useStore((s) => s.config.game);
  const [mode, setMode] = useState<"newgame" | "setupposition">("newgame");
  const [setupMove, setSetupMove] = useState(String(cfg.setup_move));
  const [setupScore, setSetupScore] = useState(String(cfg.setup_advantage));
  const [size, setSize] = useState(String(cfg.size));
  const [komi, setKomi] = useState(String(cfg.komi));
  const [handicap, setHandicap] = useState(String(cfg.handicap));
  const [rules, setRules] = useState(cfg.rules);
  const close = () => openDialog(null);
  const valid = /^\d{1,2}(:\d{1,2})?$/.test(size.trim()) && size.split(":").every((v) => +v >= 2 && +v <= 52) && !Number.isNaN(parseFloat(komi));
  const setupValid = mode === "newgame" || (parseInt(setupMove, 10) > 0 && !Number.isNaN(parseFloat(setupScore)));
  const settings = () => ({ size: size.trim(), komi: parseFloat(komi), handicap: parseInt(handicap, 10), rules });
  return (
    <Modal title={t("New Game title")} onClose={close}>
      <div className="tabs" role="tablist">
        {(["newgame", "setupposition"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
            {t(m)}
          </button>
        ))}
      </div>
      <Field label={t("board size")} hint={t("non square board hint")}>
        <input value={size} onChange={(e) => setSize(e.target.value)} list="board-sizes" />
        <datalist id="board-sizes">
          {["9", "13", "19"].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label={t("handicap")}>
        <select value={handicap} onChange={(e) => setHandicap(e.target.value)}>
          {Array.from({ length: 10 }, (_, i) => i).filter((i) => i !== 1).map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("komi")}>
        <input type="number" step={0.5} value={komi} onChange={(e) => setKomi(e.target.value)} />
      </Field>
      <Field label={t("ruleset")}>
        <select value={rules} onChange={(e) => setRules(e.target.value)}>
          {RULES.map((r) => (
            <option key={r} value={r}>
              {t(r)}
            </option>
          ))}
        </select>
      </Field>
      {mode === "setupposition" && (
        <>
          <p className="muted">{t("setup position explanation")}</p>
          <Field label={t("setup position move number")}>
            <input type="number" min={1} value={setupMove} onChange={(e) => setSetupMove(e.target.value)} />
          </Field>
          <Field label={t("setup position black score")}>
            <input type="number" step={0.5} value={setupScore} onChange={(e) => setSetupScore(e.target.value)} />
          </Field>
        </>
      )}
      <div className="modal-actions">
        <button
          className="primary"
          disabled={!valid || !setupValid}
          onClick={() => {
            close();
            if (mode === "newgame") newGame(settings());
            else setupPosition(settings(), parseInt(setupMove, 10), parseFloat(setupScore));
          }}
        >
          {t(mode)}
        </button>
      </div>
    </Modal>
  );
}

export function SettingsDialog() {
  const config = useStore((s) => s.config);
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(config));
  const close = () => openDialog(null);
  const edit = (f: (c: AppConfig) => void) =>
    setDraft((d) => {
      const c = structuredClone(d);
      f(c);
      return c;
    });
  const num = (v: string, fallback: number) => (Number.isNaN(parseFloat(v)) ? fallback : parseFloat(v));
  const e = draft.engine;
  const backend = resolveEngineBackend(e);
  const tr = draft.trainer;
  return (
    <Modal title={t("general settings title")} onClose={close}>
      <h3>{t("general settings")}</h3>
      <Field label={t("menu:lang")}>
        <select value={draft.general.lang} onChange={(ev) => edit((c) => void (c.general.lang = ev.target.value))}>
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("load sgf rewind")}>
        <input type="checkbox" checked={draft.general.load_sgf_rewind} onChange={(ev) => edit((c) => void (c.general.load_sgf_rewind = ev.target.checked))} />
      </Field>
      <Field label={t("load sgf fast analysis")}>
        <input type="checkbox" checked={draft.general.load_fast_analysis} onChange={(ev) => edit((c) => void (c.general.load_fast_analysis = ev.target.checked))} />
      </Field>

      <h3>{t("engine settings")}</h3>
      <div className="backend-tabs">
        <div className="tabs" role="tablist">
          {ENGINE_BACKENDS.map((b) => (
            <button key={b} role="tab" aria-selected={backend === b} className={backend === b ? "active" : ""} onClick={() => edit((c) => void (c.engine.backend = b))}>
              {t(`engine:tab:${b}`)}
            </button>
          ))}
        </div>
        <span className="backend-note">{t("engine:backend:note")}</span>
      </div>
      {backend === "local" && (
        <>
          <Field label={t("engine:katago")} hint={t("engine:katago:hint")}>
            <input value={e.katago} onChange={(ev) => edit((c) => void (c.engine.katago = ev.target.value))} spellCheck={false} />
          </Field>
          <ModelPicker
            model={e.model}
            humanlikeModel={e.humanlike_model}
            onModel={(v) => edit((c) => void (c.engine.model = v))}
            onHumanlikeModel={(v) => edit((c) => void (c.engine.humanlike_model = v))}
          />
          {!platform.isDesktop && (
            <>
              <Field label={t("engine:model")}>
                <input value={e.model} onChange={(ev) => edit((c) => void (c.engine.model = ev.target.value))} spellCheck={false} />
              </Field>
              <Field label={t("engine:humanlike_model")}>
                <input value={e.humanlike_model} onChange={(ev) => edit((c) => void (c.engine.humanlike_model = ev.target.value))} spellCheck={false} />
              </Field>
            </>
          )}
          <Field label={t("engine:config")}>
            <input value={e.config} onChange={(ev) => edit((c) => void (c.engine.config = ev.target.value))} spellCheck={false} />
          </Field>
        </>
      )}
      {backend === "remote" && (
        <Field label={t("engine:remote_url")} hint={t("engine:remote_url:hint")}>
          <input
            value={e.remote_url ?? ""}
            placeholder="wss://"
            onChange={(ev) => edit((c) => void (c.engine.remote_url = ev.target.value))}
            spellCheck={false}
          />
        </Field>
      )}
      {backend === "custom" && (
        <Field label={t("engine:altcommand")} hint={t("engine:altcommand:hint")}>
          <input value={e.altcommand} onChange={(ev) => edit((c) => void (c.engine.altcommand = ev.target.value))} spellCheck={false} />
        </Field>
      )}
      <Field label={t("engine:max_visits")}>
        <input type="number" min={1} value={e.max_visits} onChange={(ev) => edit((c) => void (c.engine.max_visits = Math.max(1, Math.round(num(ev.target.value, 500)))))} />
      </Field>
      <Field label={t("engine:fast_visits")}>
        <input type="number" min={1} value={e.fast_visits} onChange={(ev) => edit((c) => void (c.engine.fast_visits = Math.max(1, Math.round(num(ev.target.value, 25)))))} />
      </Field>
      <Field label={t("engine:max_time")} hint={t("engine:time:hint")}>
        <input type="number" min={0.1} step={0.5} value={e.max_time} onChange={(ev) => edit((c) => void (c.engine.max_time = num(ev.target.value, 8)))} />
      </Field>
      <Field label={t("engine:wide_root_noise")} hint={t("engine:wide_root_noise:hint")}>
        <input type="number" min={0} step={0.01} value={e.wide_root_noise} onChange={(ev) => edit((c) => void (c.engine.wide_root_noise = num(ev.target.value, 0.04)))} />
      </Field>

      <h3>{t("teacher settings")}</h3>
      <Field label={t("theme")}>
        <select value={tr.theme} onChange={(ev) => edit((c) => void (c.trainer.theme = ev.target.value))}>
          {Object.keys(EVAL_COLORS).map((k) => (
            <option key={k} value={k}>
              {t(k)}
            </option>
          ))}
        </select>
      </Field>
      <div className="threshold-table">
        <span>{t("point loss threshold")}</span>
        <span>{t("dot color")}</span>
        <span>{t("show dots")}</span>
        <span>{t("save dots")}</span>
        <span>{t("num undos").replace(/\s*\n\s*/g, " ")}</span>
        {tr.eval_thresholds.map((thr, i) => (
          <ThresholdRow key={i} i={i} thr={thr} draft={draft} edit={edit} />
        ))}
      </div>
      <Field label={t("show last n dots")}>
        <input type="number" min={0} value={tr.eval_on_show_last} onChange={(ev) => edit((c) => void (c.trainer.eval_on_show_last = Math.max(0, Math.round(num(ev.target.value, 3)))))} />
      </Field>
      <Field label={t("show ai dots")}>
        <input type="checkbox" checked={tr.eval_show_ai} onChange={(ev) => edit((c) => void (c.trainer.eval_show_ai = ev.target.checked))} />
      </Field>
      <Field label={t("show move numbers")}>
        <input type="checkbox" checked={tr.show_move_numbers} onChange={(ev) => edit((c) => void (c.trainer.show_move_numbers = ev.target.checked))} />
      </Field>
      <Field label={t("stats on top move")}>
        <span className="pair">
          {(["top_moves_show", "top_moves_show_secondary"] as const).map((key) => (
            <select key={key} value={tr[key]} onChange={(ev) => edit((c) => void (c.trainer[key] = ev.target.value))}>
              {TOP_MOVE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {t(o)}
                </option>
              ))}
            </select>
          ))}
        </span>
      </Field>
      <Field label={t("show stats if")}>
        <input type="number" min={0} value={tr.low_visits} onChange={(ev) => edit((c) => void (c.trainer.low_visits = Math.max(0, Math.round(num(ev.target.value, 25)))))} />
      </Field>
      <Field label={t("show two digits for point loss near zero")}>
        <input type="checkbox" checked={tr.extra_precision} onChange={(ev) => edit((c) => void (c.trainer.extra_precision = ev.target.checked))} />
      </Field>
      <Field label={t("cache analysis to sgf")}>
        <input type="checkbox" checked={tr.save_analysis} onChange={(ev) => edit((c) => void (c.trainer.save_analysis = ev.target.checked))} />
      </Field>
      <p className="muted">{platform.isDesktop ? t("config file path") + " config.json" : "Settings are stored in this browser."}</p>
      <div className="modal-actions">
        <button
          className="primary"
          onClick={() => {
            close();
            updateConfig((c) => {
              c.general = draft.general;
              c.engine = draft.engine;
              c.trainer = draft.trainer;
            });
          }}
        >
          {t("update settings")}
        </button>
      </div>
    </Modal>
  );
}

function ThresholdRow({ i, thr, draft, edit }: { i: number; thr: number; draft: AppConfig; edit: (f: (c: AppConfig) => void) => void }) {
  const colors = EVAL_COLORS[draft.trainer.theme] ?? EVAL_COLORS["theme:normal"];
  return (
    <>
      <input
        type="number"
        step={0.5}
        min={0}
        value={thr}
        onChange={(ev) => edit((c) => void (c.trainer.eval_thresholds[i] = Math.max(0, parseFloat(ev.target.value) || 0)))}
      />
      <span className="swatch" style={{ background: colors[i] }} />
      <input type="checkbox" checked={draft.trainer.show_dots[i]} onChange={(ev) => edit((c) => void (c.trainer.show_dots[i] = ev.target.checked))} />
      <input type="checkbox" checked={draft.trainer.save_feedback[i]} onChange={(ev) => edit((c) => void (c.trainer.save_feedback[i] = ev.target.checked))} />
      <input
        type="number"
        step={0.1}
        min={0}
        value={draft.trainer.num_undo_prompts[i] ?? 0}
        onChange={(ev) => edit((c) => void (c.trainer.num_undo_prompts[i] = Math.max(0, parseFloat(ev.target.value) || 0)))}
      />
    </>
  );
}

export function AiSettingsDialog() {
  const config = useStore((s) => s.config);
  const players = config.ui.players;
  const [strategy, setStrategy] = useState<string>(players.W.type === "player:ai" ? players.W.strategy : players.B.strategy);
  const [draft, setDraft] = useState(() => structuredClone(config.ai));
  const settings = draft[strategy] ?? {};
  const close = () => openDialog(null);
  return (
    <Modal title={t("ai settings")} onClose={close}>
      <Field label={t("Select AI")}>
        <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          {AI_STRATEGIES_AVAILABLE.map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      </Field>
      <p className="ai-help">{t(`aihelp:${strategy.replace(/^ai:/, "")}`).replace(/\[\/?[a-z]+[^\]]*\]/g, "")}</p>
      {AI_STRATEGIES_HUMAN_MODEL.includes(strategy) && !config.engine.humanlike_model && (
        <p className="warning">
          {t("engine:humanlike_model")}: — {t("menu:settings")} → {t("download models button")}
        </p>
      )}
      {Object.keys(settings).length === 0 && <p className="muted">—</p>}
      {Object.entries(settings).map(([key, value]) => (
        <Field key={key} label={key.replace(/_/g, " ")}>
          {typeof value === "boolean" ? (
            <input type="checkbox" checked={value} onChange={(e) => setDraft((d) => ({ ...d, [strategy]: { ...d[strategy], [key]: e.target.checked } }))} />
          ) : (
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => setDraft((d) => ({ ...d, [strategy]: { ...d[strategy], [key]: parseFloat(e.target.value) || 0 } }))}
            />
          )}
        </Field>
      ))}
      <p>
        {t("estimated strength")}: <b>{rankLabel(aiRankEstimation(strategy, settings))}</b>
      </p>
      <div className="modal-actions">
        <button
          className="primary"
          onClick={() => {
            close();
            updateConfig((c) => void (c.ai = draft));
          }}
        >
          {t("update ai settings")}
        </button>
      </div>
    </Modal>
  );
}

export function LogDialog() {
  const logs = useStore((s) => s.logs);
  return (
    <Modal title="KataGo log" onClose={() => openDialog(null)}>
      <pre className="log">
        {logs.slice(-300).map((l, i) => (
          <div key={i} className={`log-${l.level}`}>
            {l.message}
          </div>
        ))}
      </pre>
    </Modal>
  );
}

export function TimerDialog() {
  const timer = useStore((s) => s.config.timer);
  const [draft, setDraft] = useState(() => ({ ...timer }));
  const close = () => openDialog(null);
  const num = (key: keyof typeof draft, v: string, min: number) =>
    setDraft((d) => ({ ...d, [key]: Math.max(min, Number.isNaN(parseFloat(v)) ? min : parseFloat(v)) }));
  return (
    <Modal title={t("timer settings")} onClose={close}>
      <Field label={t("main time")}>
        <input type="number" min={0} value={draft.main_time} onChange={(e) => num("main_time", e.target.value, 0)} />
      </Field>
      <Field label={t("byoyomi length")}>
        <input type="number" min={1} value={draft.byo_length} onChange={(e) => num("byo_length", e.target.value, 1)} />
      </Field>
      <Field label={t("byoyomi periods")}>
        <input type="number" min={1} value={draft.byo_periods} onChange={(e) => num("byo_periods", e.target.value, 1)} />
      </Field>
      <Field label={t("minimal time use")}>
        <input type="number" min={0} value={draft.minimal_use} onChange={(e) => num("minimal_use", e.target.value, 0)} />
      </Field>
      <Field label={t("count down sound")}>
        <input type="checkbox" checked={draft.sound} onChange={(e) => setDraft((d) => ({ ...d, sound: e.target.checked }))} />
      </Field>
      <div className="modal-actions">
        <button
          className="primary"
          onClick={() => {
            close();
            updateTimerSettings(draft);
          }}
        >
          {t("update timer")}
        </button>
      </div>
    </Modal>
  );
}

export function TsumegoDialog() {
  const [margin, setMargin] = useState("4");
  const [ko, setKo] = useState(false);
  const close = () => openDialog(null);
  return (
    <Modal title={t("analysis:tsumegoframe")} onClose={close}>
      <Field label={t("tsumego:walldistance")}>
        <input type="number" min={1} max={8} value={margin} onChange={(e) => setMargin(e.target.value)} />
      </Field>
      <Field label={t("tsumego:ko")}>
        <input type="checkbox" checked={ko} onChange={(e) => setKo(e.target.checked)} />
      </Field>
      <div className="modal-actions">
        <button
          className="primary"
          onClick={() => {
            close();
            tsumegoFrame(ko, Math.max(1, parseInt(margin, 10) || 4));
          }}
        >
          {t("analysis:tsumegoframe")}
        </button>
      </div>
    </Modal>
  );
}

const STAT_BETTER = "#337f1a";
const STAT_WORSE = "#cc6633";

function darken(hex: string, f = 0.75) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `rgb(${c.join(",")})`;
}

/** A table cell with a bar showing value/scale, growing from the middle column outwards (TableStatLabel). */
function StatCell({ text, value, scale, color, side }: { text: string; value: number; scale: number; color: string; side: "left" | "right" }) {
  const pct = Math.max(0, Math.min(1, value / scale)) * 100;
  return (
    <div className={`report-cell report-stat ${side}`}>
      <div className="report-bar" style={{ width: `${pct}%`, background: color, [side === "left" ? "right" : "left"]: 0 }} />
      <span>{text}</span>
    </div>
  );
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Player performance report (GameReportPopup), for the main branch through the current move. */
export function ReportDialog() {
  const game = useStore((s) => s.game);
  const config = useStore((s) => s.config);
  useStore((s) => s.tick); // refresh while analysis comes in
  const [filter, setFilter] = useState<keyof typeof REPORT_FILTERS>("Entire Game");
  const close = () => openDialog(null);
  if (!game) return null;
  const thresholds = config.trainer.eval_thresholds;
  const { sumStats, histogram, playerPtloss } = gameReport(game.currentNode, thresholds, REPORT_FILTERS[filter]);
  const colors = (EVAL_COLORS[config.trainer.theme] ?? EVAL_COLORS["theme:normal"]).map((c) => darken(c));
  const labels = thresholds.map((pt) => (pt > 0 ? `≥ ${pt}` : `< ${thresholds.at(-2)}`));
  const stats: [string, (v: number) => string, "accuracy" | "mean_ptloss" | "ai_top_move" | "ai_top5_move", number, boolean][] = [
    ["accuracy", (v) => v.toFixed(1), "accuracy", 100, true],
    ["meanpointloss", (v) => v.toFixed(2), "mean_ptloss", 5, false],
    ["aitopmove", pct1, "ai_top_move", 1, true],
    ["aitop5", pct1, "ai_top5_move", 1, true],
  ];
  const sides: [Player, "left" | "right"][] = [
    ["B", "left"],
    ["W", "right"],
  ];
  const players = config.ui.players;
  return (
    <Modal title={t("analysis:report")} onClose={close}>
      <div className="tabs report-filters" role="tablist">
        {Object.keys(REPORT_FILTERS).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
            {t(f)}
          </button>
        ))}
      </div>
      <div className="report-players">
        {sides.map(([p]) => {
          const setup = players[p];
          const isAi = setup.type === PLAYER_AI;
          const name = game.root.getProperty(`P${p}`);
          const rank = isAi ? rankLabel(aiRankEstimation(setup.strategy, config.ai[setup.strategy] ?? {})) : game.root.getProperty(`${p}R`);
          return (
            <div key={p} className={`report-player ${p === "W" ? "right" : ""}`}>
              <div className={`player-stone stone-${p}`} />
              <div>
                <div className="player-name">{name && !name.includes("ㅤ") ? name : isAi ? t(setup.strategy) : t(setup.subtype)}</div>
                <div className="muted">
                  {t(setup.type)}
                  {rank ? ` · ${rank}` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="report-table">
        <div className="report-cell report-header" />
        <div className="report-cell report-header">{t("header:keystats")}</div>
        <div className="report-cell report-header" />
        {stats.map(([label, fmt, key, scale, moreIsBetter]) =>
          sides.flatMap(([p, side], i) => {
            const v = sumStats[p][key];
            const other = sumStats[p === "B" ? "W" : "B"][key] ?? 0;
            const better = ((v ?? 0) < other) !== moreIsBetter;
            const cell = (
              <StatCell key={`${label}${p}`} side={side} text={v === undefined ? "" : fmt(v)} value={v ?? 0} scale={scale} color={better ? STAT_BETTER : STAT_WORSE} />
            );
            return i === 0
              ? [
                  cell,
                  <div key={label} className="report-cell report-label">
                    {t(`stat:${label}`)}
                  </div>,
                ]
              : [cell];
          }),
        )}
        <div className="report-cell report-header">{t("header:num moves")}</div>
        <div className="report-cell report-header">{t("stats:pointslost")}</div>
        <div className="report-cell report-header">{t("header:num moves")}</div>
        {[...thresholds.keys()].reverse().map((ti, i) => [
          <StatCell key={`hb${ti}`} side="left" text={String(histogram[i].B)} value={histogram[i].B} scale={playerPtloss.B.length + 1e-6} color={colors[ti]} />,
          <div key={`hl${ti}`} className="report-cell report-label" style={{ background: colors[ti] }}>
            {labels[ti]}
          </div>,
          <StatCell key={`hw${ti}`} side="right" text={String(histogram[i].W)} value={histogram[i].W} scale={playerPtloss.W.length + 1e-6} color={colors[ti]} />,
        ])}
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (dialog === "report") return <ReportDialog />;
  if (dialog === "timer") return <TimerDialog />;
  if (dialog === "tsumego") return <TsumegoDialog />;
  if (dialog === "newgame") return <NewGameDialog />;
  if (dialog === "settings") return <SettingsDialog />;
  if (dialog === "ai") return <AiSettingsDialog />;
  if (dialog === "log") return <LogDialog />;
  return null;
}

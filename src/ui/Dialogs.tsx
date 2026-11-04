// Modal dialogs: new game, general & engine settings, AI settings, engine log.

import { useState, type ReactNode } from "react";
import { aiRankEstimation, rankLabel } from "../core/ai";
import { AI_STRATEGIES_AVAILABLE, TOP_MOVE_OPTIONS } from "../core/constants";
import { t } from "../core/i18n";
import type { AppConfig } from "../state/config";
import { platform } from "../state/platform";
import { newGame, openDialog, updateConfig, useStore } from "../state/store";
import { LANGUAGES } from "./i18nLoader";
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
  const [size, setSize] = useState(String(cfg.size));
  const [komi, setKomi] = useState(String(cfg.komi));
  const [handicap, setHandicap] = useState(String(cfg.handicap));
  const [rules, setRules] = useState(cfg.rules);
  const close = () => openDialog(null);
  const valid = /^\d{1,2}(:\d{1,2})?$/.test(size.trim()) && size.split(":").every((v) => +v >= 2 && +v <= 52) && !Number.isNaN(parseFloat(komi));
  return (
    <Modal title={t("New Game title")} onClose={close}>
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
      <div className="modal-actions">
        <button
          className="primary"
          disabled={!valid}
          onClick={() => {
            close();
            newGame({ size: size.trim(), komi: parseFloat(komi), handicap: parseInt(handicap, 10), rules });
          }}
        >
          {t("newgame")}
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
      <Field label={t("engine:katago")} hint={t("engine:katago:hint")}>
        <input value={e.katago} onChange={(ev) => edit((c) => void (c.engine.katago = ev.target.value))} spellCheck={false} />
      </Field>
      <Field label={t("engine:model")}>
        <input value={e.model} onChange={(ev) => edit((c) => void (c.engine.model = ev.target.value))} spellCheck={false} />
      </Field>
      <Field label={t("engine:humanlike_model")}>
        <input value={e.humanlike_model} onChange={(ev) => edit((c) => void (c.engine.humanlike_model = ev.target.value))} spellCheck={false} />
      </Field>
      <Field label={t("engine:config")}>
        <input value={e.config} onChange={(ev) => edit((c) => void (c.engine.config = ev.target.value))} spellCheck={false} />
      </Field>
      <Field label={t("engine:altcommand")}>
        <input value={e.altcommand} onChange={(ev) => edit((c) => void (c.engine.altcommand = ev.target.value))} spellCheck={false} />
      </Field>
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

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (dialog === "newgame") return <NewGameDialog />;
  if (dialog === "settings") return <SettingsDialog />;
  if (dialog === "ai") return <AiSettingsDialog />;
  if (dialog === "log") return <LogDialog />;
  return null;
}

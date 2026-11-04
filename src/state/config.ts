// User configuration. Defaults are KaTrain's config.json (src/state/defaults.json), so configs stay compatible.

import packagedConfig from "./defaults.json";
import type { AiSettings } from "../core/ai";
import type { EngineSettings } from "../core/engine";
import type { TrainerSettings } from "../core/game";

export interface AnalysisToggles {
  show_children: boolean;
  eval: boolean;
  hints: boolean;
  policy: boolean;
  ownership: boolean;
}

export interface PlayerSetup {
  type: string;
  strategy: string;
  /** human players: "game:normal" or "game:teach" */
  subtype: string;
}

export interface TimerSettings {
  /** minutes */
  main_time: number;
  /** seconds per byo-yomi period */
  byo_length: number;
  byo_periods: number;
  /** seconds a move must take at least in byo-yomi (0 = off) */
  minimal_use: number;
  sound: boolean;
}

export interface AppConfig {
  engine: EngineSettings;
  timer: TimerSettings;
  game: { size: string; komi: number; handicap: number; rules: string; setup_move: number; setup_advantage: number };
  trainer: TrainerSettings & { show_move_numbers: boolean; lock_ai: boolean };
  ai: Record<string, AiSettings>;
  general: { lang: string; sgf_load: string; sgf_save: string; load_fast_analysis: boolean; load_sgf_rewind: boolean; anim_pv_time: number; debug_level: number };
  ui: {
    play: AnalysisToggles;
    analyze: AnalysisToggles;
    graph: { score: boolean; winrate: boolean };
    players: { B: PlayerSetup; W: PlayerSetup };
  };
}

export function defaultConfig(): AppConfig {
  const p = structuredClone(packagedConfig) as unknown as Record<string, any>;
  return {
    engine: p.engine,
    timer: p.timer,
    game: p.game,
    trainer: p.trainer,
    ai: p.ai,
    general: p.general,
    ui: {
      play: p.ui_state.play.analysis_controls,
      analyze: p.ui_state.analyze.analysis_controls,
      graph: { score: true, winrate: true },
      players: {
        B: { type: "player:human", strategy: "ai:p:rank", subtype: "game:normal" },
        W: { type: "player:ai", strategy: "ai:p:rank", subtype: "game:normal" },
      },
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge saved values over defaults, ignoring keys that no longer exist and type changes. */
export function mergeConfig<T>(defaults: T, saved: unknown): T {
  if (!isObject(defaults) || !isObject(saved)) return defaults;
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, dv] of Object.entries(defaults)) {
    if (!(k in saved)) continue;
    const sv = saved[k];
    if (isObject(dv)) out[k] = isObject(sv) ? mergeConfig(dv, sv) : dv;
    else if (k === "ai" || dv === null || typeof dv === typeof sv || (Array.isArray(dv) && Array.isArray(sv))) out[k] = sv;
  }
  // AI strategy sections are open-ended
  if ("ai" in out && isObject(saved.ai)) out.ai = { ...(out.ai as object), ...(saved.ai as object) };
  return out as T;
}

export function parseSavedConfig(text: string | null): AppConfig {
  const defaults = defaultConfig();
  if (!text) return defaults;
  try {
    return mergeConfig(defaults, JSON.parse(text));
  } catch {
    return defaults;
  }
}

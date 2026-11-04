import type { GameHost, TrainerSettings } from "../src/core/game";

export const TRAINER: TrainerSettings = {
  eval_thresholds: [12, 6, 3, 1.5, 0.5, 0],
  num_undo_prompts: [1, 1, 1, 0.5, 0, 0],
  show_dots: [true, true, true, true, true, true],
  save_feedback: [true, true, true, true, false, false],
  save_analysis: false,
  save_marks: false,
  eval_show_ai: true,
  eval_on_show_last: 3,
  low_visits: 25,
  top_moves_show: "top_move_delta_score",
  top_moves_show_secondary: "top_move_visits",
  extra_precision: false,
  theme: "theme:normal",
};

export const host: GameHost = {
  trainer: () => TRAINER,
  isAi: () => false,
  setStatus: () => {},
  log: () => {},
};

